/**
 * Tenancy Setting (Tenant Management) – list/extend/change/terminate/cancel/agreement.
 * Uses MySQL: tenancy, roomdetail, propertydetail, tenantdetail, agreement, agreementtemplate,
 * rentalcollection, refunddeposit, account (type_id), clientdetail. All FK by _id.
 * Pattern: cache + services filter like expenses (list with limit for cache; filters from API).
 *
 * Tenancy table has columns: password, passwordid (single lock for TTLock; extend/terminate
 * could call TTLock API with these when integrating door lock updates).
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { getAccessContextByEmail } = require('../access/access.service');
const {
  createInvoicesForRentalRecords,
  createReceiptForForfeitDepositRentalCollection,
  voidOrDeleteInvoicesForRentalCollectionIds
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const { setTenancyActive, updateRoomAvailableFromTenancy } = require('./tenancy-active.service');
const { tryPrepareDraftForAgreement } = require('../agreement/agreement.service');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const CACHE_LIMIT_MAX = 2000;

// Bukku type_id: resolve via account.wix_id (Wix legacy) or account.id
const BUKKUID_WIX = {
  DEPOSIT: 'd3f72d51-c791-4ef0-aeec-3ed1134e5c86',
  RENTAL_INCOME: 'cf4141b1-c24e-4fc1-930e-cfea4329b178',
  AGREEMENT_FEES: '3411c69c-bfec-4d35-a6b9-27929f9d5bf6',
  FORFEIT_DEPOSIT: '1c7e41b6-9d57-4c03-8122-a76baad3b592',
  OWNER_COMMISSION: '86da59c0-992c-4e40-8efd-9d6d793eaf6a',
  TENANT_COMMISSION: '94b4e060-3999-4c76-8189-f969615c0a7d'
};

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

async function getAccountIdByWixId(wixId) {
  if (!wixId) return null;
  const [rows] = await pool.query('SELECT id FROM account WHERE wix_id = ? LIMIT 1', [wixId]);
  return rows[0] ? rows[0].id : null;
}

/** Compute frontend status: "pending_approval" from tenancy_status_json (if column exists), else true/false by end date */
function computeStatus(row) {
  if (row.tenancy_status_json != null) {
    const statusJson = parseJson(row.tenancy_status_json);
    if (Array.isArray(statusJson)) {
      const pending = statusJson.find(
        (s) => s && (s.status === 'pending' || (s.key === 'contact_approval' && s.status !== 'completed'))
      );
      if (pending) return 'pending_approval';
    }
  }
  if (row.status !== 1 && row.status !== true) return false;
  const end = row.end ? new Date(row.end) : null;
  const today = new Date();
  return end && end >= today;
}

/**
 * List tenancies for client with optional limit (cache mode). Returns items with room, tenant, property, agreements.
 * opts: { propertyId, status, search, sort, page, pageSize, limit? }
 * limit: when set, return up to CACHE_LIMIT_MAX items in one response (for frontend cache).
 */
async function getTenancyList(clientId, opts = {}) {
  if (!clientId) return { items: [], total: 0, totalPages: 1, currentPage: 1 };

  const limit = opts.limit != null ? Math.min(CACHE_LIMIT_MAX, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;
  const page = useLimit ? 1 : Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = useLimit ? limit : Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  /* 不使用 tenancy_status_json 以兼容未跑 0032 的库；若库有该列，可在 SELECT 中加回并用于 computeStatus */
  let sql = `
    SELECT t.id, t.tenant_id, t.room_id, t.client_id, t.begin, t.\`end\`, t.previous_end, t.rental, t.deposit, t.status AS db_status,
           t.remark, t.title,
           p.id AS property_id, p.shortname AS property_shortname,
           r.id AS room_id, r.title_fld AS room_title_fld,
           tn.id AS tenant_id, tn.fullname AS tenant_fullname, tn.phone AS tenant_phone
    FROM tenancy t
    LEFT JOIN roomdetail r ON r.id = t.room_id
    LEFT JOIN propertydetail p ON p.id = r.property_id
    LEFT JOIN tenantdetail tn ON tn.id = t.tenant_id
    WHERE t.client_id = ?
  `;
  const params = [clientId];

  if (opts.staffId) {
    sql += ' AND (t.submitby_id = ? OR t.last_extended_by_id = ?)';
    params.push(opts.staffId, opts.staffId);
  }
  if (opts.propertyId && opts.propertyId !== 'ALL') {
    sql += ' AND p.id = ?';
    params.push(opts.propertyId);
  }
  if (opts.status && opts.status !== 'ALL') {
    if (opts.status === 'true') {
      sql += ' AND t.`end` >= CURDATE() AND (t.status = 1 OR t.status IS NULL)';
    } else if (opts.status === 'false') {
      sql += ' AND (t.`end` < CURDATE() OR t.status = 0)';
    }
  }
  const countParams = [...params];
  if (opts.search && String(opts.search).trim()) {
    sql += ' AND (t.remark LIKE ? OR r.title_fld LIKE ? OR tn.fullname LIKE ?)';
    const like = `%${String(opts.search).trim()}%`;
    params.push(like, like, like);
    countParams.push(like, like, like);
  }

  const countSql = `
    SELECT COUNT(*) AS total FROM tenancy t
    LEFT JOIN roomdetail r ON r.id = t.room_id
    LEFT JOIN propertydetail p ON p.id = r.property_id
    LEFT JOIN tenantdetail tn ON tn.id = t.tenant_id
    WHERE t.client_id = ?
    ${opts.staffId ? ' AND (t.submitby_id = ? OR t.last_extended_by_id = ?)' : ''}
    ${opts.propertyId && opts.propertyId !== 'ALL' ? ' AND p.id = ?' : ''}
    ${opts.status && opts.status !== 'ALL' ? (opts.status === 'true' ? ' AND t.`end` >= CURDATE() AND (t.status = 1 OR t.status IS NULL)' : ' AND (t.`end` < CURDATE() OR t.status = 0)') : ''}
    ${opts.search && String(opts.search).trim() ? ' AND (t.remark LIKE ? OR r.title_fld LIKE ? OR tn.fullname LIKE ?)' : ''}
  `;
  const [countRows] = await pool.query(countSql.trim(), countParams);
  const total = Number(countRows[0]?.total || 0);
  const totalPages = useLimit ? 1 : Math.max(1, Math.ceil(total / pageSize));

  sql += ' ORDER BY r.title_fld ASC, t.begin DESC';
  sql += ` LIMIT ? OFFSET ?`;
  params.push(pageSize, offset);

  let rows = [];
  try {
    const [listRows] = await pool.query(sql, params);
    rows = listRows || [];
  } catch (err) {
    console.error('[tenancysetting/list] main query failed:', err.message);
    return { items: [], total: 0, totalPages: 1, currentPage: 1 };
  }

  const tenancyIds = rows.map((x) => x.id);
  let agreementMap = {};
  if (tenancyIds.length) {
    try {
      const placeholders = tenancyIds.map(() => '?').join(',');
      const [agRows] = await pool.query(
        `SELECT id, tenancy_id, mode, status, url, pdfurl, created_at FROM agreement WHERE tenancy_id IN (${placeholders}) ORDER BY created_at DESC`,
        tenancyIds
      );
      for (const a of agRows || []) {
        if (!agreementMap[a.tenancy_id]) agreementMap[a.tenancy_id] = [];
        agreementMap[a.tenancy_id].push({
          _id: a.id,
          _createdDate: a.created_at,
          mode: a.mode,
          status: a.status,
          url: a.url || a.pdfurl
        });
      }
    } catch (agErr) {
      console.warn('[tenancysetting/list] agreement query skipped:', agErr.message);
    }
  }

  const items = (rows || []).map((t) => {
    const agreements = (agreementMap[t.id] || []).slice(0, 20);
    agreements.sort((a, b) => new Date(b._createdDate || 0) - new Date(a._createdDate || 0));
    return {
      _id: t.id,
      id: t.id,
      begin: t.begin,
      end: t.end,
      previous_end: t.previous_end,
      rental: t.rental,
      deposit: t.deposit,
      remark: t.remark,
      title: t.title,
      status: computeStatus({ ...t, status: t.db_status }),
      room: t.room_id ? { _id: t.room_id, id: t.room_id, title_fld: t.room_title_fld } : null,
      tenant: t.tenant_id ? { _id: t.tenant_id, id: t.tenant_id, fullname: t.tenant_fullname, phone: t.tenant_phone } : null,
      property: t.property_id ? { _id: t.property_id, id: t.property_id, shortname: t.property_shortname } : null,
      agreements
    };
  });

  return { items, total, totalPages, currentPage: page };
}

/**
 * Get filter options: properties (for dropdown), status options.
 */
async function getTenancyFilters(clientId) {
  if (!clientId) return { properties: [], statusOptions: [] };
  const [propRows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC LIMIT 1000',
    [clientId]
  );
  const properties = [
    { label: 'All', value: 'ALL' },
    ...(propRows || []).map((p) => ({ label: p.shortname || p.id, value: p.id }))
  ];
  const statusOptions = [
    { label: 'All', value: 'ALL' },
    { label: 'Active', value: 'true' },
    { label: 'Inactive', value: 'false' }
  ];
  return { properties, statusOptions };
}

/**
 * Get available rooms for change-room dropdown (excluding current; available = 1 or availablesoon = 1).
 */
async function getRoomsForChange(clientId, currentRoomId) {
  if (!clientId) return [];
  let sql = `
    SELECT r.id, r.title_fld, r.property_id, p.shortname AS property_shortname
    FROM roomdetail r
    JOIN propertydetail p ON p.id = r.property_id
    WHERE p.client_id = ? AND (r.available = 1 OR r.availablesoon = 1)
  `;
  const params = [clientId];
  if (currentRoomId) {
    sql += ' AND r.id != ?';
    params.push(currentRoomId);
  }
  sql += ' ORDER BY r.title_fld ASC LIMIT 1000';
  const [rows] = await pool.query(sql, params);
  return (rows || []).map((r) => ({ _id: r.id, id: r.id, title_fld: r.title_fld, shortname: r.property_shortname }));
}

/**
 * Preview change-room prorate (same logic as changeroom billing).
 */
async function previewChangeRoomProrate(clientId, { oldRental, newRental, changeDate }) {
  const client = await getClientAdmin(clientId);
  const rentalConfig = client?.admin?.rental || { type: 'first', value: 1 };
  const selected = new Date(changeDate);
  const diffRental = Number(newRental || 0) - Number(oldRental || 0);
  let cycleStart, cycleEnd;
  if (rentalConfig.type === 'specific') {
    const billingDay = Number(rentalConfig.value || 1);
    const thisMonthBilling = new Date(selected.getFullYear(), selected.getMonth(), billingDay);
    if (selected >= thisMonthBilling) {
      cycleStart = thisMonthBilling;
      cycleEnd = new Date(selected.getFullYear(), selected.getMonth() + 1, billingDay);
    } else {
      cycleStart = new Date(selected.getFullYear(), selected.getMonth() - 1, billingDay);
      cycleEnd = thisMonthBilling;
    }
  } else {
    cycleStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
    cycleEnd = new Date(selected.getFullYear(), selected.getMonth() + 1, 1);
  }
  const totalDays = (cycleEnd - cycleStart) / 86400000;
  const remainingDays = (cycleEnd - selected) / 86400000;
  let prorate = 0;
  if (diffRental > 0 && totalDays > 0 && remainingDays > 0) {
    prorate = (diffRental / totalDays) * remainingDays;
  }
  return { prorate: Number(prorate.toFixed(2)), cycleStart, cycleEnd };
}

async function getClientAdmin(clientId) {
  const [rows] = await pool.query('SELECT admin FROM clientdetail WHERE id = ? LIMIT 1', [clientId]);
  const admin = rows[0] ? parseJson(rows[0].admin) : null;
  return { admin };
}

/** 同房间已有下一租客/booking 时，当前租约最多只能延到 nextBegin 的前一天。返回 YYYY-MM-DD 或 null（无上限）。 */
async function getMaxExtensionEndDate(clientId, tenancyId) {
  const [cur] = await pool.query(
    'SELECT room_id, `end` FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!cur.length || !cur[0].room_id) return null;
  const currentEnd = cur[0].end ? String(cur[0].end).trim().substring(0, 10) : null;
  if (!currentEnd) return null;
  const [next] = await pool.query(
    `SELECT MIN(t.begin) AS next_begin FROM tenancy t
     WHERE t.room_id = ? AND t.client_id = ? AND t.id != ?
       AND t.begin > ?`,
    [cur[0].room_id, clientId, tenancyId, currentEnd]
  );
  const nextBegin = next[0]?.next_begin ? String(next[0].next_begin).trim().substring(0, 10) : null;
  if (!nextBegin) return null;
  const d = new Date(nextBegin + 'T12:00:00+08:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().substring(0, 10);
}

/**
 * 续约页用：payment cycle（client 资料）与可延至的最晚日期（若同房已有下一笔 booking 则最多到前一 day）。
 * Extend 可延到任意一天，不强制对齐 billing cycle；最后不足整月的一段按 prorate 入 rentalcollection（rental 已实现；若日后加 commission 也应按 prorate）。
 * #datepickerextension：maxExtensionEnd 为 datepicker 上限；paymentCycle 仅作参考，选任意日均可。
 */
async function getExtendOptions(clientId, tenancyId) {
  const client = await getClientAdmin(clientId);
  const rental = client?.admin?.rental || { type: 'first', value: 1 };
  const paymentCycle = { type: rental.type || 'first', value: rental.value != null ? rental.value : 1 };
  const maxExtensionEnd = await getMaxExtensionEndDate(clientId, tenancyId);
  return { paymentCycle, maxExtensionEnd };
}

/**
 * Extend tenancy: update end, rental, deposit; insert rental records (deposit topup, prorate, full cycles, agreement fees).
 * 若同房已有下一笔 booking，newEnd 不得超过下一笔的 begin 的前一天。
 * Rental：首段 prorate → 中间每月 cycle 日整月 → 末段 prorate（可延到任意日）。Commission：按 client 的 commission 配置 + 本次 extend 的期数（月数）决定规则，例如 extend 3 个月跟 3 个月 rules、6 个月跟 6 个月 rules；待接 client admin 后在此生成 commission 行（首尾 prorate）。
 * If tenancy is active (not frozen): extend TTLock passcode to new end. If inactive (unpaid, expired on ytd), skip –
 * when tenant pays, checkAndRestoreTenancyIfFullyPaid will use tenancy.end to update lock.
 */
async function extendTenancy(clientId, staffId, tenancyId, { newEnd, newRental, agreementFees, newDeposit }) {
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, begin, `end`, rental, deposit, title, status, active FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const current = tenancyRows[0];
  const maxExtensionEnd = await getMaxExtensionEndDate(clientId, tenancyId);
  const newEndStr = newEnd instanceof Date ? newEnd.toISOString().substring(0, 10) : String(newEnd || '').trim().substring(0, 10);
  if (maxExtensionEnd && newEndStr > maxExtensionEnd) {
    throw new Error('EXTEND_EXCEEDS_NEXT_BOOKING');
  }
  const oldEnd = current.end ? new Date(current.end) : null;
  const oldRental = Number(current.rental || 0);
  const oldDeposit = Number(current.deposit || 0);
  const depositDiff = Number(newDeposit || 0) - oldDeposit;
  const previousEndVal = oldEnd ? (oldEnd instanceof Date ? oldEnd.toISOString().slice(0, 10) : String(oldEnd).trim().slice(0, 10)) : null;

  await pool.query(
    'UPDATE tenancy SET `end` = ?, rental = ?, deposit = ?, previous_end = ?, last_extended_by_id = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
    [newEnd instanceof Date ? newEnd : newEnd, newRental, newDeposit || 0, previousEndVal, staffId || null, tenancyId, clientId]
  );

  const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [current.room_id]);
  const propertyId = roomRows[0] ? roomRows[0].property_id : null;
  const client = await getClientAdmin(clientId);
  const rentalConfig = client?.admin?.rental || { type: 'first', value: 1 };
  const newRecords = [];
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  if (depositDiff > 0) {
    const typeId = await getAccountIdByWixId(BUKKUID_WIX.DEPOSIT);
    if (typeId) {
      newRecords.push({
        id: randomUUID(),
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: current.room_id,
        property_id: propertyId,
        client_id: clientId,
        type_id: typeId,
        amount: depositDiff,
        date: now,
        title: `Extend Deposit Topup - ${current.title}`,
        ispaid: 0,
        created_at: now,
        updated_at: now
      });
    }
  }

  if (oldEnd && newRental) {
    const endDate = new Date(newEnd);
    const selected = new Date(oldEnd);
    const billingDay = rentalConfig.type === 'specific' ? Number(rentalConfig.value || 1) : 1;
    let cycleStart, cycleEnd;
    if (rentalConfig.type === 'specific') {
      const thisMonthBilling = new Date(selected.getFullYear(), selected.getMonth(), billingDay);
      if (selected >= thisMonthBilling) {
        cycleStart = thisMonthBilling;
        cycleEnd = new Date(selected.getFullYear(), selected.getMonth() + 1, billingDay);
      } else {
        cycleStart = new Date(selected.getFullYear(), selected.getMonth() - 1, billingDay);
        cycleEnd = thisMonthBilling;
      }
    } else {
      cycleStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
      cycleEnd = new Date(selected.getFullYear(), selected.getMonth() + 1, 1);
    }
    const totalDays = (cycleEnd - cycleStart) / 86400000;
    const remainingDays = (cycleEnd - selected) / 86400000;
    if (remainingDays > 0 && totalDays > 0) {
      const proratedAmount = (newRental / totalDays) * remainingDays;
      const typeId = await getAccountIdByWixId(BUKKUID_WIX.RENTAL_INCOME);
      if (typeId) {
        newRecords.push({
          id: randomUUID(),
          tenancy_id: tenancyId,
          tenant_id: current.tenant_id,
          room_id: current.room_id,
          property_id: propertyId,
          client_id: clientId,
          type_id: typeId,
          amount: Number(proratedAmount.toFixed(2)),
          date: selected.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
          title: `Prorated Rental Income - ${current.title}`,
          ispaid: 0,
          created_at: now,
          updated_at: now
        });
      }
    }
    let nextBillingDate = new Date(cycleEnd);
    while (nextBillingDate <= endDate) {
      const nextCycleEnd =
        rentalConfig.type === 'specific'
          ? new Date(nextBillingDate.getFullYear(), nextBillingDate.getMonth() + 1, billingDay)
          : new Date(nextBillingDate.getFullYear(), nextBillingDate.getMonth() + 1, 1);
      const cycleDays = (nextCycleEnd - nextBillingDate) / 86400000;
      const typeId = await getAccountIdByWixId(BUKKUID_WIX.RENTAL_INCOME);
      if (typeId) {
        if (nextCycleEnd > endDate) {
          const lastPeriodDays = (endDate - nextBillingDate) / 86400000;
          const proratedAmount = cycleDays > 0 ? (newRental / cycleDays) * lastPeriodDays : 0;
          newRecords.push({
            id: randomUUID(),
            tenancy_id: tenancyId,
            tenant_id: current.tenant_id,
            room_id: current.room_id,
            property_id: propertyId,
            client_id: clientId,
            type_id: typeId,
            amount: Number(proratedAmount.toFixed(2)),
            date: nextBillingDate.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
            title: `Prorated Rental Income - ${current.title}`,
            ispaid: 0,
            created_at: now,
            updated_at: now
          });
        } else {
          newRecords.push({
            id: randomUUID(),
            tenancy_id: tenancyId,
            tenant_id: current.tenant_id,
            room_id: current.room_id,
            property_id: propertyId,
            client_id: clientId,
            type_id: typeId,
            amount: newRental,
            date: nextBillingDate.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
            title: `Rental Income - ${current.title}`,
            ispaid: 0,
            created_at: now,
            updated_at: now
          });
        }
      }
      if (nextCycleEnd > endDate) break;
      nextBillingDate = nextCycleEnd;
    }
  }

  if (Number(agreementFees || 0) > 0) {
    const typeId = await getAccountIdByWixId(BUKKUID_WIX.AGREEMENT_FEES);
    if (typeId) {
      newRecords.push({
        id: randomUUID(),
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: current.room_id,
        property_id: propertyId,
        client_id: clientId,
        type_id: typeId,
        amount: Number(agreementFees),
        date: now,
        title: `Extend Agreement Fees - ${current.title}`,
        ispaid: 0,
        created_at: now,
        updated_at: now
      });
    }
  }

  if (newRecords.length) {
    for (const r of newRecords) {
      await pool.query(
        `INSERT INTO rentalcollection (id, tenancy_id, tenant_id, room_id, property_id, client_id, type_id, amount, date, title, ispaid, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.tenancy_id, r.tenant_id, r.room_id, r.property_id, r.client_id, r.type_id, r.amount, r.date, r.title, r.ispaid, r.created_at, r.updated_at]
      );
    }
    try {
      await createInvoicesForRentalRecords(clientId, newRecords);
    } catch (e) {
      console.warn('createInvoicesForRentalRecords (extend) failed:', e?.message || e);
    }
  }

  // Extend TTLock passcode to new end only when tenancy is active. If inactive (frozen, expired ytd), skip – restore flow will use tenancy.end when tenant pays.
  const isActive = current.active === 1 || current.active == null;
  if (isActive) {
    try {
      await setTenancyActive(tenancyId);
    } catch (e) {
      console.warn('[extendTenancy] setTenancyActive (TTLock extend) failed:', tenancyId, e?.message || e);
    }
  }

  // Update room available / availablesoon / availablefrom to new tenancy.end
  try {
    await updateRoomAvailableFromTenancy(current.room_id);
  } catch (e) {
    console.warn('[extendTenancy] updateRoomAvailableFromTenancy failed:', current.room_id, e?.message || e);
  }

  return { success: true, message: 'Tenancy extended successfully' };
}

/**
 * Change room: update tenancy room/rental/end/deposit; adjust room availability; rebuild rental records.
 */
async function changeRoom(clientId, staffId, tenancyId, { newRoomId, newRental, newEnd, agreementFees, changeDate, newDeposit }) {
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, rental, deposit, title FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const current = tenancyRows[0];
  const originalRoomId = current.room_id;
  const oldRental = Number(current.rental || 0);
  const oldDeposit = Number(current.deposit || 0);
  const newDepositNum = Number(newDeposit || 0);
  const changeD = new Date(changeDate || new Date());

  if (newRoomId !== originalRoomId) {
    const [newRoomRows] = await pool.query('SELECT id, available FROM roomdetail WHERE id = ? LIMIT 1', [newRoomId]);
    if (!newRoomRows.length || !newRoomRows[0].available) throw new Error('ROOM_NOT_AVAILABLE');
    await pool.query('UPDATE roomdetail SET available = 1, updated_at = NOW() WHERE id = ?', [originalRoomId]);
    await pool.query('UPDATE roomdetail SET available = 0, updated_at = NOW() WHERE id = ?', [newRoomId]);
  }

  const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [newRoomId || originalRoomId]);
  const propertyId = roomRows[0] ? roomRows[0].property_id : null;

  const today = new Date();
  const [futureUnpaid] = await pool.query(
    'SELECT id FROM rentalcollection WHERE tenancy_id = ? AND date >= ? AND ispaid = 0',
    [tenancyId, today.toISOString().split('T')[0]]
  );
  const futureUnpaidIds = (futureUnpaid || []).map((r) => r.id);
  if (futureUnpaidIds.length) {
    try {
      await voidOrDeleteInvoicesForRentalCollectionIds(clientId, futureUnpaidIds);
    } catch (e) {
      console.warn('voidOrDeleteInvoicesForRentalCollectionIds (changeRoom) failed:', e?.message || e);
    }
    for (const id of futureUnpaidIds) {
      await pool.query('DELETE FROM rentalcollection WHERE id = ?', [id]);
    }
  }

  const { prorate } = await previewChangeRoomProrate(clientId, {
    oldRental,
    newRental,
    changeDate: changeD
  });
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const dateStr = changeD.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  const toInsert = [];
  if (Number(agreementFees || 0) > 0) {
    const typeId = await getAccountIdByWixId(BUKKUID_WIX.AGREEMENT_FEES);
    if (typeId) {
      toInsert.push({
        id: randomUUID(),
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: newRoomId || originalRoomId,
        property_id: propertyId,
        client_id: clientId,
        type_id: typeId,
        amount: Number(agreementFees),
        date: dateStr,
        title: 'Agreement Fees',
        ispaid: 0,
        created_at: now,
        updated_at: now
      });
    }
  }
  if (newDepositNum - oldDeposit > 0) {
    const typeId = await getAccountIdByWixId(BUKKUID_WIX.DEPOSIT);
    if (typeId) {
      toInsert.push({
        id: randomUUID(),
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: newRoomId || originalRoomId,
        property_id: propertyId,
        client_id: clientId,
        type_id: typeId,
        amount: newDepositNum - oldDeposit,
        date: dateStr,
        title: 'Deposit Topup',
        ispaid: 0,
        created_at: now,
        updated_at: now
      });
    }
  }
  if (prorate > 0) {
    const typeId = await getAccountIdByWixId(BUKKUID_WIX.RENTAL_INCOME);
    if (typeId) {
      toInsert.push({
        id: randomUUID(),
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: newRoomId || originalRoomId,
        property_id: propertyId,
        client_id: clientId,
        type_id: typeId,
        amount: prorate,
        date: dateStr,
        title: 'Prorate Rental Adjustment',
        ispaid: 0,
        created_at: now,
        updated_at: now
      });
    }
  }

  const client = await getClientAdmin(clientId);
  const rentalConfig = client?.admin?.rental || { type: 'first', value: 1 };
  let nextBillingDate =
    rentalConfig.type === 'specific'
      ? new Date(changeD.getFullYear(), changeD.getMonth() + 1, Number(rentalConfig.value || 1))
      : new Date(changeD.getFullYear(), changeD.getMonth() + 1, 1);
  const endDate = new Date(newEnd);
  while (nextBillingDate <= endDate) {
    const typeId = await getAccountIdByWixId(BUKKUID_WIX.RENTAL_INCOME);
    if (typeId) {
      toInsert.push({
        id: randomUUID(),
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: newRoomId || originalRoomId,
        property_id: propertyId,
        client_id: clientId,
        type_id: typeId,
        amount: newRental,
        date: nextBillingDate.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
        title: 'Rental Income',
        ispaid: 0,
        created_at: now,
        updated_at: now
      });
    }
    nextBillingDate =
      rentalConfig.type === 'specific'
        ? new Date(nextBillingDate.getFullYear(), nextBillingDate.getMonth() + 1, Number(rentalConfig.value || 1))
        : new Date(nextBillingDate.getFullYear(), nextBillingDate.getMonth() + 1, 1);
  }

  for (const r of toInsert) {
    await pool.query(
      `INSERT INTO rentalcollection (id, tenancy_id, tenant_id, room_id, property_id, client_id, type_id, amount, date, title, ispaid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.tenancy_id, r.tenant_id, r.room_id, r.property_id, r.client_id, r.type_id, r.amount, r.date, r.title, r.ispaid, r.created_at, r.updated_at]
    );
  }
  if (toInsert.length) {
    try {
      await createInvoicesForRentalRecords(clientId, toInsert);
    } catch (e) {
      console.warn('createInvoicesForRentalRecords (changeRoom) failed:', e?.message || e);
    }
  }

  await pool.query(
    'UPDATE tenancy SET room_id = ?, rental = ?, deposit = ?, `end` = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
    [newRoomId || originalRoomId, newRental, newDepositNum, newEnd, tenancyId, clientId]
  );

  return { success: true, message: 'Change processed successfully' };
}

/**
 * Terminate tenancy: set status=0, end=yesterday; delete future unpaid rental; insert forfeit; insert refund if any; release room.
 */
async function terminateTenancy(clientId, tenancyId, forfeitAmount) {
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, deposit, status FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const tenancy = tenancyRows[0];
  if (tenancy.status === 0) throw new Error('TENANCY_ALREADY_TERMINATED');
  const deposit = Number(tenancy.deposit || 0);
  const forfeit = Number(forfeitAmount || 0);
  if (forfeit < 0) throw new Error('INVALID_FORFEIT_AMOUNT');
  if (forfeit > deposit) throw new Error('FORFEIT_EXCEEDS_DEPOSIT');

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const [futureUnpaid] = await pool.query(
    'SELECT id FROM rentalcollection WHERE tenancy_id = ? AND date >= ? AND ispaid = 0',
    [tenancyId, today.toISOString().split('T')[0]]
  );
  const futureUnpaidIds = (futureUnpaid || []).map((r) => r.id);
  if (futureUnpaidIds.length) {
    try {
      await voidOrDeleteInvoicesForRentalCollectionIds(clientId, futureUnpaidIds);
    } catch (e) {
      console.warn('voidOrDeleteInvoicesForRentalCollectionIds (terminateTenancy) failed:', e?.message || e);
    }
    for (const id of futureUnpaidIds) {
      await pool.query('DELETE FROM rentalcollection WHERE id = ?', [id]);
    }
  }

  if (forfeit > 0) {
    const typeId = await getAccountIdByWixId(BUKKUID_WIX.FORFEIT_DEPOSIT);
    if (typeId) {
      const id = randomUUID();
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      await pool.query(
        `INSERT INTO rentalcollection (id, tenancy_id, tenant_id, room_id, property_id, client_id, type_id, amount, date, title, ispaid, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, tenancyId, tenancy.tenant_id, tenancy.room_id, null, clientId, typeId, forfeit, now, 'Forfeit Deposit', now, now]
      );
      // Forfeit deposit = credit invoice to tenant (tenancy setting), then pay from Deposit (liability)
      const forfeitRecord = {
        id,
        client_id: clientId,
        property_id: null,
        room_id: tenancy.room_id,
        tenancy_id: tenancyId,
        tenant_id: tenancy.tenant_id,
        type_id: typeId,
        amount: forfeit,
        date: now,
        title: 'Forfeit Deposit'
      };
      try {
        await createInvoicesForRentalRecords(clientId, [forfeitRecord]);
        await createReceiptForForfeitDepositRentalCollection([id]);
      } catch (e) {
        console.warn('createInvoicesForRentalRecords / createReceiptForForfeitDepositRentalCollection (terminate forfeit) failed:', e?.message || e);
      }
    }
  }

  const refundAmount = deposit - forfeit;
  if (refundAmount > 0) {
    const [roomRows] = await pool.query('SELECT title_fld FROM roomdetail WHERE id = ? LIMIT 1', [tenancy.room_id]);
    const [tenantRows] = await pool.query('SELECT fullname FROM tenantdetail WHERE id = ? LIMIT 1', [tenancy.tenant_id]);
    const roomTitle = roomRows[0] ? roomRows[0].title_fld : '';
    const tenantName = tenantRows[0] ? tenantRows[0].fullname : '';
    const id = randomUUID();
    await pool.query(
      `INSERT INTO refunddeposit (id, amount, roomtitle, tenantname, room_id, tenant_id, client_id, tenancy_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [id, refundAmount, roomTitle, tenantName, tenancy.room_id, tenancy.tenant_id, clientId, tenancyId]
    );
  }

  await pool.query(
    'UPDATE tenancy SET status = 0, `end` = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
    [yesterday.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''), tenancyId, clientId]
  );
  await pool.query('UPDATE roomdetail SET available = 1, availablesoon = 0, availableFrom = NULL, updated_at = NOW() WHERE id = ?', [tenancy.room_id]);

  return { success: true, message: 'Tenancy terminated successfully' };
}

/**
 * Cancel booking (delete pending tenancy and remove client from tenant approval_request_json).
 */
async function cancelBooking(clientId, tenancyId) {
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const tenancy = tenancyRows[0];

  const [roomRows] = await pool.query('SELECT id FROM roomdetail WHERE id = ? LIMIT 1', [tenancy.room_id]);
  if (roomRows.length) {
    await pool.query('UPDATE roomdetail SET available = 1, availablesoon = 0, updated_at = NOW() WHERE id = ?', [tenancy.room_id]);
  }

  const [tenantRows] = await pool.query('SELECT id, approval_request_json FROM tenantdetail WHERE id = ? LIMIT 1', [tenancy.tenant_id]);
  if (tenantRows.length) {
    let arr = parseJson(tenantRows[0].approval_request_json) || [];
    arr = arr.filter((r) => r.clientId !== clientId);
    await pool.query('UPDATE tenantdetail SET approval_request_json = ?, updated_at = NOW() WHERE id = ?', [
      JSON.stringify(arr),
      tenancy.tenant_id
    ]);
  }

  const [rentalRows] = await pool.query('SELECT id FROM rentalcollection WHERE tenancy_id = ?', [tenancyId]);
  const rentalIds = (rentalRows || []).map((r) => r.id);
  if (rentalIds.length) {
    try {
      await voidOrDeleteInvoicesForRentalCollectionIds(clientId, rentalIds);
    } catch (e) {
      console.warn('voidOrDeleteInvoicesForRentalCollectionIds (cancelBooking) failed:', e?.message || e);
    }
  }
  await pool.query('DELETE FROM rentalcollection WHERE tenancy_id = ?', [tenancyId]);
  await pool.query('DELETE FROM tenancy WHERE id = ? AND client_id = ?', [tenancyId, clientId]);

  return { success: true, message: 'Booking cancelled' };
}

/**
 * Get agreement templates by client and mode.
 */
async function getAgreementTemplates(clientId, mode) {
  if (!clientId || !mode) return [];
  const [rows] = await pool.query(
    'SELECT id, title, mode FROM agreementtemplate WHERE client_id = ? AND mode = ? ORDER BY title ASC LIMIT 1000',
    [clientId, mode]
  );
  return (rows || []).map((r) => ({ _id: r.id, id: r.id, title: r.title, mode: r.mode }));
}

/**
 * Normalize value to MySQL date string YYYY-MM-DD or null.
 */
function toDateOnly(val) {
  if (val == null) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Insert agreement (tenancy agreement: tenant_operator or owner_tenant).
 * Must pass agreementtemplate_id; default status='pending' (no url). If url provided (manual upload), status='completed', columns_locked=1 (no hash).
 * For extend agreement: pass extendBegin, extendEnd (datepickeragreement1/2), remark.
 */
async function insertAgreement(clientId, {
  tenancyId, propertyId, ownerName, mode, type, url, templateId, status, createdBy,
  extendBegin, extendEnd, remark
}) {
  const id = randomUUID();
  const isManualUpload = url != null && String(url).trim() !== '';
  const finalStatus = status != null ? status : (isManualUpload ? 'completed' : 'pending');
  const columnsLocked = isManualUpload ? 1 : 0;
  const finalUrl = isManualUpload ? url.trim() : null;
  const extBegin = toDateOnly(extendBegin);
  const extEnd = toDateOnly(extendEnd);
  const remarkVal = remark != null && String(remark).trim() !== '' ? String(remark).trim() : null;
  await pool.query(
    `INSERT INTO agreement (id, client_id, tenancy_id, property_id, mode, agreementtemplate_id, url, status, columns_locked, extend_begin_date, extend_end_date, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [id, clientId, tenancyId, propertyId || null, mode, templateId || null, finalUrl, finalStatus, columnsLocked, extBegin, extEnd, remarkVal]
  );

  if (!isManualUpload && templateId) {
    try {
      const prep = await tryPrepareDraftForAgreement(id);
      if (prep?.ok && prep?.pdfUrl) {
        return { _id: id, id, pdfUrl: prep.pdfUrl, status: 'ready_for_signature' };
      }
    } catch (e) {
      console.warn('[tenancysetting] insertAgreement try-prepare-draft failed:', id, e?.message || e);
    }
  }
  return { _id: id, id };
}

module.exports = {
  getTenancyList,
  getTenancyFilters,
  getRoomsForChange,
  previewChangeRoomProrate,
  getExtendOptions,
  extendTenancy,
  changeRoom,
  terminateTenancy,
  cancelBooking,
  getAgreementTemplates,
  insertAgreement
};
