/**
 * Tenancy Setting (Tenant Management) – list/extend/change/terminate/cancel/agreement.
 * Uses MySQL: tenancy, roomdetail, propertydetail, tenantdetail, agreement, agreementtemplate,
 * rentalcollection, refunddeposit, account (type_id), operatordetail. All FK by _id.
 * Pattern: cache + services filter like expenses (list with limit for cache; filters from API).
 *
 * Tenancy table has columns: password, passwordid (single lock for TTLock; extend/terminate
 * could call TTLock API with these when integrating door lock updates).
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { normalizeAgreementStatusForStorage } = require('../../utils/agreement-status');
const { getAccessContextByEmail } = require('../access/access.service');
const {
  createInvoicesForRentalRecords,
  createReceiptForForfeitDepositRentalCollection,
  voidOrDeleteInvoicesForRentalCollectionIds
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const { setTenancyActive, updateRoomAvailableFromTenancy } = require('./tenancy-active.service');
const { tryPrepareDraftForAgreement } = require('../agreement/agreement.service');
const { deductClientCreditSpending } = require('../billing/deduction.service');
const { appendHandoverScheduleLog, normalizeScheduleForLog } = require('./handover-schedule-log.service');
const { validateTenantHandoverScheduleAgainstCompanyWindow } = require('./handover-schedule-window');
const {
  getTodayMalaysiaDate,
  getTodayPlusDaysMalaysia,
  malaysiaDateToUtcDatetimeForDb,
  malaysiaDateRangeToUtcForQuery,
  toSingaporeCalendarYmd,
  utcDatetimeFromDbToMalaysiaDateOnly,
  tenancyEndYmdToMysqlDatetime,
  tenancyEndInputToMysqlDatetime
} = require('../../utils/dateMalaysia');
const {
  buildExtendRentalIncomeLines,
  buildChangeRoomPriorOldRentLines,
  defaultFeeInvoiceYmd,
  formatProrateFormulaLine,
  compareYmd,
  addDaysYmd
} = require('./extend-rental-lines');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const CACHE_LIMIT_MAX = 2000;

/** Canonical account template ids — align with migration 0154_account_template_canonical_operator_chart.sql */
const BUKKUID_WIX = {
  DEPOSIT: '18ba3daf-7208-46fc-8e97-43f34e898401',
  RENTAL_INCOME: 'ae94f899-7f34-4aba-b6ee-39b97496e2a3',
  AGREEMENT_FEES: 'e1b2c3d4-2003-4000-8000-000000000303',
  PARKING_FEES: 'e1b2c3d4-2004-4000-8000-000000000304',
  FORFEIT_DEPOSIT: '2020b22b-028e-4216-906c-c816dcb33a85',
  OWNER_COMMISSION: '86da59c0-992c-4e40-8efd-9d6d793eaf6a',
  TENANT_COMMISSION: 'e1b2c3d4-2002-4000-8000-000000000302'
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

function tenancyHasParkingLots(parkinglotJson) {
  const arr = parseJson(parkinglotJson);
  return Array.isArray(arr) && arr.some((id) => String(id || '').trim() !== '');
}

function countAssignedParkingLots(parkinglotJson) {
  const arr = parseJson(parkinglotJson);
  if (!Array.isArray(arr)) return 0;
  return arr.filter((id) => String(id || '').trim() !== '').length;
}

function collectParkingLinesFromBilling(billingJson) {
  const billing = parseJson(billingJson);
  if (!Array.isArray(billing)) return [];
  const pid = String(BUKKUID_WIX.PARKING_FEES).toLowerCase();
  return billing.filter((b) => {
    if (!b || typeof b !== 'object') return false;
    const typeRaw = String(b.type || '');
    const type = typeRaw.toLowerCase();
    const bid = String(b.bukkuid || b.type_id || '').toLowerCase();
    const title = String(b.title || '').toLowerCase();
    const label = String(b.label || '').toLowerCase();
    return bid === pid || /parking/.test(type) || /parking/.test(title) || /parking/.test(label);
  });
}

/** Legacy: extrapolate from prorated segment amounts to an approximate full-month total (all lots combined). */
function inferLegacyExtrapolatedParkingMonthlyTotal(parkingLines) {
  const extrapolated = [];
  for (const line of parkingLines) {
    const amt = Number(line.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const ps = line.periodStart;
    const pe = line.periodEnd;
    if (ps == null || pe == null) {
      extrapolated.push(amt);
      continue;
    }
    const d1 = new Date(ps);
    const d2 = new Date(pe);
    if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) {
      extrapolated.push(amt);
      continue;
    }
    const y = d1.getFullYear();
    const m = d1.getMonth();
    const dim = new Date(y, m + 1, 0).getDate();
    const segDays = Math.floor((d2.getTime() - d1.getTime()) / 86400000) + 1;
    const ratio = segDays / dim;
    if (ratio > 0.001) extrapolated.push(amt / ratio);
  }
  if (!extrapolated.length) return null;
  const avg = extrapolated.reduce((a, b) => a + b, 0) / extrapolated.length;
  return Number(avg.toFixed(2));
}

/**
 * Parking fee per lot / month (same field as New booking). From blueprint `parkingFeePerLot`, or total ÷ lot count.
 */
function inferParkingFeePerLotFromBilling(billingJson, parkingLotCount) {
  const parkingLines = collectParkingLinesFromBilling(billingJson);
  if (!parkingLines.length) return null;
  const lc = Math.max(0, Number(parkingLotCount) || 0);

  for (const line of parkingLines) {
    const raw = line.parkingFeePerLot ?? line.parking_fee_per_lot;
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Number(n.toFixed(2));
  }

  for (const line of parkingLines) {
    const raw = line.monthlyParkingTotal ?? line.monthlyAmount ?? line.monthly_parking_total;
    if (raw == null || raw === '') continue;
    const total = Number(raw);
    if (Number.isFinite(total) && total > 0 && lc > 0) return Number((total / lc).toFixed(2));
  }

  const legacyTotal = inferLegacyExtrapolatedParkingMonthlyTotal(parkingLines);
  if (legacyTotal != null && legacyTotal > 0) {
    if (lc > 0) return Number((legacyTotal / lc).toFixed(2));
    return legacyTotal;
  }
  return null;
}

/**
 * Total monthly parking (all assigned lots) for rental lines: per lot × lot count, or explicit monthly total on blueprint.
 */
function inferMonthlyParkingTotalFromBilling(billingJson, parkingLotCount) {
  const parkingLines = collectParkingLinesFromBilling(billingJson);
  if (!parkingLines.length) return null;
  const lc = Math.max(0, Number(parkingLotCount) || 0);

  for (const line of parkingLines) {
    const raw = line.parkingFeePerLot ?? line.parking_fee_per_lot;
    if (raw == null || raw === '') continue;
    const perLot = Number(raw);
    if (Number.isFinite(perLot) && perLot > 0) {
      if (lc > 0) return Number((perLot * lc).toFixed(2));
      return Number(perLot.toFixed(2));
    }
  }

  for (const line of parkingLines) {
    const raw = line.monthlyParkingTotal ?? line.monthlyAmount ?? line.monthly_parking_total;
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Number(n.toFixed(2));
  }

  return inferLegacyExtrapolatedParkingMonthlyTotal(parkingLines);
}

/** mysql2 may return DATE/datetime as JS Date; String() → "Wed Mar 31 2026 ..." breaks SQL DATE compare. */
function normalizeMysqlDateToYmd(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Tenancy `begin` / `end` (stored as UTC instants in MySQL) → Malaysia calendar YYYY-MM-DD.
 * Matches portal check-in/out and proration; avoids `toISOString().slice(0,10)` UTC date (e.g. MY 8 Apr → wrong 7 Apr).
 */
function tenancyCalendarYmdFromDb(val) {
  const my = utcDatetimeFromDbToMalaysiaDateOnly(val);
  if (my && /^\d{4}-\d{2}-\d{2}$/.test(my)) return my;
  return normalizeMysqlDateToYmd(val);
}

/** DATETIME for JSON (ISO); used for last_room_change_at. */
function normalizeMysqlDatetimeIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString();
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** scheduledAt from handover_*_json for operator list / edit dialog */
function scheduledAtFromHandoverJson(val) {
  const p = parseJson(val);
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const s = p.scheduledAt != null ? String(p.scheduledAt).trim() : '';
  return s || null;
}

/** Same rule as portal: card + unit photos + tenant signature URL */
function hasHandoverProof(val) {
  const p = parseJson(val);
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  const cards = Array.isArray(p.handoverCardPhotos) ? p.handoverCardPhotos.filter((x) => String(x || '').trim()) : [];
  const units = Array.isArray(p.unitPhotos) ? p.unitPhotos.filter((x) => String(x || '').trim()) : [];
  const sign = String(p.tenantSignatureUrl || '').trim();
  return cards.length > 0 && units.length > 0 && !!sign;
}

async function getAccountIdByWixId(wixId) {
  if (!wixId) return null;
  const [rows] = await pool.query('SELECT id FROM account WHERE id = ? LIMIT 1', [wixId]);
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
  // tenancy.status is historical/int-like; treat NULL as active (same as list filter logic)
  const rawStatus = row.status;
  const statusNum =
    rawStatus === null || rawStatus === undefined || rawStatus === ''
      ? null
      : Number(rawStatus);
  if (statusNum === 0 || rawStatus === false) return false;
  // Compare by date-only to avoid "today at 00:00" being treated as already ended.
  const endYmd = tenancyCalendarYmdFromDb(row.end);
  const todayYmd = getTodayMalaysiaDate();
  if (!endYmd || !todayYmd) return false;
  return endYmd >= todayYmd;
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
    SELECT t.id, t.tenant_id, t.room_id, t.client_id, t.begin, t.\`end\`, t.previous_end, t.last_room_change_at, t.rental, t.deposit, t.status AS db_status,
           t.remark, t.title, t.parkinglot_json, t.billing_json,
           t.handover_checkin_json, t.handover_checkout_json,
           p.id AS property_id, p.shortname AS property_shortname,
           r.id AS room_id, r.title_fld AS room_title_fld,
           tn.id AS tenant_id, tn.fullname AS tenant_fullname, tn.phone AS tenant_phone, tn.email AS tenant_email,
           tn.bankaccount AS tenant_bankaccount, tn.accountholder AS tenant_accountholder,
           bd.bankname AS tenant_bankname
    FROM tenancy t
    LEFT JOIN roomdetail r ON r.id = t.room_id
    LEFT JOIN propertydetail p ON p.id = r.property_id
    LEFT JOIN tenantdetail tn ON tn.id = t.tenant_id
    LEFT JOIN bankdetail bd ON bd.id = tn.bankname_id
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
      sql += ' AND t.`end` >= DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR) AND (t.status = 1 OR t.status IS NULL)';
    } else if (opts.status === 'false') {
      sql += ' AND (t.`end` < DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR) OR t.status = 0)';
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
    ${opts.status && opts.status !== 'ALL' ? (opts.status === 'true' ? ' AND t.`end` >= DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR) AND (t.status = 1 OR t.status IS NULL)' : ' AND (t.`end` < DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR) OR t.status = 0)') : ''}
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
  let paidDepositByTenancy = new Map();
  if (tenancyIds.length) {
    paidDepositByTenancy = await sumPaidDepositRentalCollectionForTenancies(clientId, tenancyIds);
  }
  let agreementMap = {};
  const reviewedTenancyIds = new Set();
  if (tenancyIds.length) {
    try {
      const placeholders = tenancyIds.map(() => '?').join(',');
      const [revRows] = await pool.query(
        `SELECT tenancy_id FROM portal_account_review WHERE subject_kind = 'tenant' AND client_id = ? AND tenancy_id IN (${placeholders})`,
        [clientId, ...tenancyIds]
      );
      for (const rr of revRows || []) {
        if (rr?.tenancy_id) reviewedTenancyIds.add(String(rr.tenancy_id));
      }
    } catch (revErr) {
      console.warn('[tenancysetting/list] portal_account_review query skipped:', revErr.message);
    }
    try {
      const placeholders = tenancyIds.map(() => '?').join(',');
      const [agRows] = await pool.query(
        `SELECT id, tenancy_id, mode, status, url, pdfurl, hash_final, created_at,
                tenantsign, operatorsign, ownersign,
                extend_begin_date, extend_end_date
         FROM agreement WHERE tenancy_id IN (${placeholders}) ORDER BY created_at DESC`,
        tenancyIds
      );
      const hasSign = (v) => v != null && String(v).trim() !== '';
      for (const a of agRows || []) {
        if (!agreementMap[a.tenancy_id]) agreementMap[a.tenancy_id] = [];
        agreementMap[a.tenancy_id].push({
          _id: a.id,
          _createdDate: a.created_at,
          mode: a.mode,
          status: a.status,
          url: a.url || a.pdfurl,
          hash_final: a.hash_final,
          tenant_has_sign: hasSign(a.tenantsign),
          operator_has_sign: hasSign(a.operatorsign),
          owner_has_sign: hasSign(a.ownersign),
          extend_begin_date: a.extend_begin_date != null ? normalizeMysqlDateToYmd(a.extend_begin_date) : null,
          extend_end_date: a.extend_end_date != null ? normalizeMysqlDateToYmd(a.extend_end_date) : null
        });
      }
    } catch (agErr) {
      console.warn('[tenancysetting/list] agreement query skipped:', agErr.message);
    }
  }

  const items = (rows || []).map((t) => {
    const agreements = (agreementMap[t.id] || []).slice(0, 20);
    agreements.sort((a, b) => new Date(b._createdDate || 0) - new Date(a._createdDate || 0));
    const handoverIn = parseJson(t.handover_checkin_json);
    const handoverOut = parseJson(t.handover_checkout_json);
    const hasLots = tenancyHasParkingLots(t.parkinglot_json);
    const parkingLotCount = countAssignedParkingLots(t.parkinglot_json);
    const parkingInferred = inferMonthlyParkingTotalFromBilling(t.billing_json, parkingLotCount);
    const parkingFeePerLot = inferParkingFeePerLotFromBilling(t.billing_json, parkingLotCount);
    const extendHasParkingFees =
      (parkingInferred != null && parkingInferred > 0) || hasLots;
    const beginYmd = tenancyCalendarYmdFromDb(t.begin);
    const endYmd = tenancyCalendarYmdFromDb(t.end);
    const prevYmd = t.previous_end != null ? tenancyCalendarYmdFromDb(t.previous_end) : null;
    const depositColumn = Number(t.deposit || 0);
    const paidDepositSum = paidDepositByTenancy.get(String(t.id)) || 0;
    const depositForPortal = depositDisplayFromTenancyOrPaidRc(depositColumn, paidDepositSum);
    const depositInSync = depositInSyncBetweenTenancyColumnAndPaidRc(depositColumn, paidDepositSum);
    return {
      _id: t.id,
      id: t.id,
      /** Malaysia calendar YYYY-MM-DD — same normalization as server logic; avoids mixed DATE vs DATETIME JSON confusing the portal. */
      begin: beginYmd && /^\d{4}-\d{2}-\d{2}$/.test(beginYmd) ? beginYmd : t.begin,
      end: endYmd && /^\d{4}-\d{2}-\d{2}$/.test(endYmd) ? endYmd : t.end,
      previous_end: prevYmd && /^\d{4}-\d{2}-\d{2}$/.test(prevYmd) ? prevYmd : t.previous_end,
      last_room_change_at: t.last_room_change_at != null ? normalizeMysqlDatetimeIso(t.last_room_change_at) : null,
      rental: t.rental,
      deposit: depositForPortal,
      /** Raw tenancy.deposit — for与 RC 比对 */
      depositFromTenancy: Number.isFinite(depositColumn) ? Number(depositColumn.toFixed(2)) : 0,
      paidDepositFromRentalCollection: Number.isFinite(paidDepositSum) ? Number(paidDepositSum.toFixed(2)) : 0,
      depositInSync,
      remark: t.remark,
      title: t.title,
      status: computeStatus({ ...t, status: t.db_status }),
      room: t.room_id ? { _id: t.room_id, id: t.room_id, title_fld: t.room_title_fld } : null,
      tenant: t.tenant_id
        ? {
            _id: t.tenant_id,
            id: t.tenant_id,
            fullname: t.tenant_fullname,
            phone: t.tenant_phone,
            email: t.tenant_email || null,
            bankName: t.tenant_bankname || null,
            bankAccount: t.tenant_bankaccount || null,
            accountHolder: t.tenant_accountholder || null
          }
        : null,
      property: t.property_id ? { _id: t.property_id, id: t.property_id, shortname: t.property_shortname } : null,
      agreements,
      handoverCheckinAt: scheduledAtFromHandoverJson(t.handover_checkin_json),
      handoverCheckoutAt: scheduledAtFromHandoverJson(t.handover_checkout_json),
      handoverCheckin: handoverIn && typeof handoverIn === 'object' ? handoverIn : null,
      handoverCheckout: handoverOut && typeof handoverOut === 'object' ? handoverOut : null,
      hasCheckinHandover: hasHandoverProof(t.handover_checkin_json),
      hasCheckoutHandover: hasHandoverProof(t.handover_checkout_json),
      extendHasParkingFees,
      extendParkingLotCount: parkingLotCount,
      extendParkingFeePerLotSuggested:
        parkingFeePerLot != null && parkingFeePerLot > 0 ? parkingFeePerLot : null,
      extendParkingMonthlySuggested:
        parkingInferred != null && parkingInferred > 0 ? parkingInferred : null,
      reviewed: reviewedTenancyIds.has(t.id)
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
 * Operator UI preview. Rent from move date is billed as rental income lines (invoice date = move date when
 * the first segment is mid-month); no separate "prorate adjustment" row.
 */
async function previewChangeRoomProrate(clientId, { oldRental, newRental, changeDate }) {
  void clientId;
  void oldRental;
  void newRental;
  void changeDate;
  return { prorate: 0, cycleStart: null, cycleEnd: null };
}

async function getClientAdmin(clientId) {
  const [rows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
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
  const currentEnd = tenancyCalendarYmdFromDb(cur[0].end);
  if (!currentEnd) return null;
  const [next] = await pool.query(
    `SELECT MIN(t.begin) AS next_begin FROM tenancy t
     WHERE t.room_id = ? AND t.client_id = ? AND t.id != ?
       AND t.begin > ?`,
    [cur[0].room_id, clientId, tenancyId, currentEnd]
  );
  const nextBegin = next[0]?.next_begin ? tenancyCalendarYmdFromDb(next[0].next_begin) : null;
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
/**
 * Sum paid deposit-type rentalcollection rows for tenancy (actual cash in; may exceed tenancy.deposit if column stale).
 */
async function sumPaidDepositRentalCollectionForTenancy(clientId, tenancyId) {
  const typeId = await getAccountIdByWixId(BUKKUID_WIX.DEPOSIT);
  if (!typeId) return 0;
  try {
    const [rows] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM rentalcollection
       WHERE tenancy_id = ? AND client_id = ? AND type_id = ? AND (ispaid = 1 OR ispaid = TRUE)`,
      [tenancyId, clientId, typeId]
    );
    const s = Number(rows[0]?.s || 0);
    return Number.isFinite(s) ? Number(s.toFixed(2)) : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Batch: paid deposit-type rentalcollection sums per tenancy (same rules as sumPaidDepositRentalCollectionForTenancy).
 * @returns {Map<string, number>} keyed by tenancy id
 */
async function sumPaidDepositRentalCollectionForTenancies(clientId, tenancyIds) {
  const out = new Map();
  if (!clientId || !tenancyIds?.length) return out;
  const typeId = await getAccountIdByWixId(BUKKUID_WIX.DEPOSIT);
  if (!typeId) return out;
  try {
    const placeholders = tenancyIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT tenancy_id, COALESCE(SUM(amount), 0) AS s FROM rentalcollection
       WHERE client_id = ? AND tenancy_id IN (${placeholders}) AND type_id = ?
         AND (ispaid = 1 OR ispaid = TRUE)
       GROUP BY tenancy_id`,
      [clientId, ...tenancyIds, typeId]
    );
    for (const r of rows || []) {
      if (r?.tenancy_id == null) continue;
      const s = Number(r.s || 0);
      out.set(String(r.tenancy_id), Number.isFinite(s) ? Number(s.toFixed(2)) : 0);
    }
  } catch (e) {
    console.warn('[tenancysetting] sumPaidDepositRentalCollectionForTenancies:', e?.message || e);
  }
  return out;
}

/**
 * 展示用押金：有 tenancy.deposit（>0）则以合同列为准；若为 0/未导入则用 rentalcollection 已付「押金」科目合计（与账单一致）。
 * 不做 max：两者不一致时由 depositInSyncBetweenTenancyColumnAndPaidRc 标出，便于核对。
 */
function depositDisplayFromTenancyOrPaidRc(tenancyDepositColumn, paidDepositSum) {
  const col = Number(tenancyDepositColumn || 0);
  const paid = Number(paidDepositSum || 0);
  const c = Number.isFinite(col) ? col : 0;
  const p = Number.isFinite(paid) ? paid : 0;
  if (c > 0) return Number(c.toFixed(2));
  return Number(p.toFixed(2));
}

const DEPOSIT_RC_TENANCY_EPS = 0.02;

/**
 * 合同列 vs RC 已付押金合计是否一致。导入未写 tenancy.deposit（列=0 且 RC 有数）返回 null（仅信 RC，无「合同可对」）。
 * @returns {boolean|null} true 一致；false 不一致或合同有数但 RC 未体现；null 列无合同押金可比
 */
function depositInSyncBetweenTenancyColumnAndPaidRc(tenancyDepositColumn, paidDepositSum) {
  const col = Number(tenancyDepositColumn || 0);
  const paid = Number(paidDepositSum || 0);
  const c = Number.isFinite(col) ? col : 0;
  const p = Number.isFinite(paid) ? paid : 0;
  if (c <= 0) return null;
  if (p <= 0) return false;
  return Math.abs(c - p) < DEPOSIT_RC_TENANCY_EPS;
}

async function getExtendOptions(clientId, tenancyId) {
  const client = await getClientAdmin(clientId);
  const rental = client?.admin?.rental || { type: 'first', value: 1 };
  const paymentCycle = { type: rental.type || 'first', value: rental.value != null ? rental.value : 1 };
  const maxExtensionEnd = await getMaxExtensionEndDate(clientId, tenancyId);
  let depositFromTenancy = 0;
  try {
    const [depRows] = await pool.query('SELECT deposit FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1', [
      tenancyId,
      clientId
    ]);
    const raw = depRows[0]?.deposit;
    const n = Number(raw);
    if (Number.isFinite(n)) depositFromTenancy = Number(n.toFixed(2));
  } catch (_) {
    /* keep 0 */
  }
  const paidDepositSum = await sumPaidDepositRentalCollectionForTenancy(clientId, tenancyId);
  const deposit = depositDisplayFromTenancyOrPaidRc(depositFromTenancy, paidDepositSum);
  const depositInSync = depositInSyncBetweenTenancyColumnAndPaidRc(depositFromTenancy, paidDepositSum);
  return {
    paymentCycle,
    maxExtensionEnd,
    deposit,
    depositFromTenancy,
    paidDepositFromRentalCollection: paidDepositSum,
    depositInSync
  };
}

/**
 * Preview rentalcollection lines that extendTenancy would create (no DB writes).
 */
async function previewExtendTenancy(
  clientId,
  tenancyId,
  { newEnd, newRental, agreementFees, newDeposit, newParkingMonthly }
) {
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, begin, `end`, rental, deposit, title, status, active, parkinglot_json, billing_json FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const current = tenancyRows[0];
  const hasLots = tenancyHasParkingLots(current.parkinglot_json);
  const parkingLotCount = countAssignedParkingLots(current.parkinglot_json);
  const inferredParkingMonthly = inferMonthlyParkingTotalFromBilling(current.billing_json, parkingLotCount);
  const hadRecurringParkingFees =
    (inferredParkingMonthly != null && inferredParkingMonthly > 0) || hasLots;

  let parkingMonthlyEffective = null;
  if (hadRecurringParkingFees) {
    if (newParkingMonthly !== undefined && newParkingMonthly !== null && String(newParkingMonthly).trim() !== '') {
      const n = Number(newParkingMonthly);
      if (!Number.isFinite(n) || n < 0) throw new Error('INVALID_PARKING_MONTHLY');
      parkingMonthlyEffective = n;
    } else if (inferredParkingMonthly != null && inferredParkingMonthly > 0) {
      parkingMonthlyEffective = inferredParkingMonthly;
    } else {
      parkingMonthlyEffective = null;
    }
  } else if (
    newParkingMonthly !== undefined &&
    newParkingMonthly !== null &&
    String(newParkingMonthly).trim() !== '' &&
    Number(newParkingMonthly) > 0
  ) {
    throw new Error('EXTEND_PARKING_NOT_APPLICABLE');
  }

  const maxExtensionEnd = await getMaxExtensionEndDate(clientId, tenancyId);
  const newEndStr =
    newEnd instanceof Date && !Number.isNaN(newEnd.getTime())
      ? utcDatetimeFromDbToMalaysiaDateOnly(newEnd) || ''
      : String(newEnd || '')
          .trim()
          .substring(0, 10);
  if (maxExtensionEnd && newEndStr > maxExtensionEnd) {
    throw new Error('EXTEND_EXCEEDS_NEXT_BOOKING');
  }

  const oldEnd = current.end ? new Date(current.end) : null;
  const oldDeposit = Number(current.deposit || 0);
  const nextDeposit =
    newDeposit !== undefined && newDeposit !== null
      ? (() => {
          const n = Number(newDeposit);
          return Number.isFinite(n) ? n : oldDeposit;
        })()
      : oldDeposit;
  const depositDiff = nextDeposit - oldDeposit;
  const previousEndVal = oldEnd ? tenancyCalendarYmdFromDb(oldEnd) : null;
  const beginYmd = tenancyCalendarYmdFromDb(current.begin);

  const newEndMysql = tenancyEndYmdToMysqlDatetime(newEndStr);
  if (!newEndMysql) throw new Error('INVALID_NEW_END_DATE');

  const client = await getClientAdmin(clientId);
  const rentalConfig = client?.admin?.rental || { type: 'first', value: 1 };

  const rentalLines =
    previousEndVal && Number(newRental) > 0
      ? buildExtendRentalIncomeLines({
          oldEndYmd: previousEndVal,
          newEndYmd: newEndStr,
          newRental: Number(newRental),
          rentalType: rentalConfig.type || 'first',
          rentalValue: rentalConfig.value,
          beginYmd: beginYmd || null
        })
      : [];

  const feeYmd =
    rentalLines[0]?.invoiceYmd ||
    defaultFeeInvoiceYmd({
      oldEndYmd: previousEndVal || newEndStr,
      newEndYmd: newEndStr,
      rentalType: rentalConfig.type || 'first',
      rentalValue: rentalConfig.value,
      beginYmd: beginYmd || null
    });

  const parkingLines =
    hadRecurringParkingFees &&
    parkingMonthlyEffective != null &&
    Number(parkingMonthlyEffective) > 0 &&
    previousEndVal
      ? buildExtendRentalIncomeLines({
          oldEndYmd: previousEndVal,
          newEndYmd: newEndStr,
          newRental: Number(parkingMonthlyEffective),
          rentalType: rentalConfig.type || 'first',
          rentalValue: rentalConfig.value,
          beginYmd: beginYmd || null,
          titleFull: 'Parking Fees',
          titleProrate: 'Prorated Parking Fees'
        })
      : [];

  const oneTimeRows = [];
  if (depositDiff > 0) {
    oneTimeRows.push({
      key: 'deposit-topup',
      label: 'Deposit top-up',
      sub: `Invoice date ${feeYmd}`,
      amount: round2(Number(depositDiff))
    });
  }
  if (Number(agreementFees || 0) > 0) {
    oneTimeRows.push({
      key: 'agreement',
      label: 'Agreement fees',
      sub: `Extend · invoice date ${feeYmd}`,
      amount: round2(Number(agreementFees))
    });
  }

  const recurringRows = [];
  let rIdx = 0;
  for (const line of rentalLines) {
    const formula = formatProrateFormulaLine(line);
    recurringRows.push({
      key: `rent-${rIdx++}`,
      label: line.titleSuffix || 'Rental Income',
      sub: `Invoice date ${line.invoiceYmd}${line.prorate ? ' · prorated' : ''}`,
      amount: round2(Number(line.amount)),
      ...(formula ? { formula } : {})
    });
  }
  for (const line of parkingLines) {
    const formula = formatProrateFormulaLine(line);
    recurringRows.push({
      key: `park-${rIdx++}`,
      label: line.titleSuffix || 'Parking Fees',
      sub: `Invoice date ${line.invoiceYmd}${line.prorate ? ' · prorated' : ''}`,
      amount: round2(Number(line.amount)),
      ...(formula ? { formula } : {})
    });
  }

  const oneTimeSubtotal = round2(oneTimeRows.reduce((s, r) => s + r.amount, 0));
  const recurringSubtotal = round2(recurringRows.reduce((s, r) => s + r.amount, 0));
  const total = round2(oneTimeSubtotal + recurringSubtotal);

  const oldRentalSummary = round2(Number(current.rental || 0));
  const newRentalSummary = round2(Number(newRental || 0));
  const depositSummaryOld = round2(oldDeposit);
  const depositSummaryNew = round2(nextDeposit);
  let parkingMonthlySummary = null;
  if (hadRecurringParkingFees) {
    parkingMonthlySummary = {
      from: round2(Number(inferredParkingMonthly || 0)),
      to: round2(Number(parkingMonthlyEffective || 0))
    };
  }

  return {
    ok: true,
    tenancyTitle: current.title || '',
    previousEndYmd: previousEndVal,
    newEndYmd: newEndStr,
    rentalInvoiceRule: { type: rentalConfig.type || 'first', value: rentalConfig.value ?? 1 },
    oneTimeRows,
    recurringRows,
    oneTimeSubtotal,
    recurringSubtotal,
    total,
    maxExtensionEnd: maxExtensionEnd || null,
    /** Portal Summary: monthly rent / parking total / deposit before → after */
    rateSummary: {
      rent: { from: oldRentalSummary, to: newRentalSummary },
      parkingMonthlyTotal: parkingMonthlySummary,
      deposit: { from: depositSummaryOld, to: depositSummaryNew }
    }
  };
}

/**
 * Sum ispaid rentalcollection for type_id in Malaysia calendar month of anchorYmd (YYYY-MM match on invoice date).
 */
async function sumPaidRentalCollectionInMonth(clientId, tenancyId, typeId, anchorYmd) {
  if (!typeId || !/^\d{4}-\d{2}-\d{2}$/.test(String(anchorYmd || ''))) return 0;
  const ym = String(anchorYmd).slice(0, 7);
  const [rows] = await pool.query(
    `SELECT amount, date FROM rentalcollection
     WHERE tenancy_id = ? AND client_id = ? AND type_id = ? AND (ispaid = 1 OR ispaid = TRUE)`,
    [tenancyId, clientId, typeId]
  );
  let total = 0;
  for (const row of rows || []) {
    const ymd = utcDatetimeFromDbToMalaysiaDateOnly(row.date);
    if (ymd && ymd.slice(0, 7) === ym) {
      total += Number(row.amount || 0);
    }
  }
  return round2(total);
}

function formatChangeRoomNettingFormula(detail) {
  if (!detail) return null;
  const g = Number(detail.gross);
  const p = Number(detail.paidCredit);
  const n = Number(detail.net);
  return `Net: gross RM${g.toFixed(2)} − paid this month RM${p.toFixed(2)} = RM${n.toFixed(2)}`;
}

/**
 * If tenant already paid rent/parking in the move month, replace prior+new lines for that month with
 * one top-up row: max(0, gross − paid). If paidInMonth is 0, keep separate prorate lines (unpaid flow).
 */
function applyChangeRoomPaidMonthNetting(priorLines, newLines, changeYmd, paidInMonth, netTitleSuffix) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(changeYmd || ''))) {
    return { priorEffective: priorLines, newEffective: newLines, nettingMeta: null };
  }
  const ym = changeYmd.slice(0, 7);
  const inMoveMonth = (line) => line.invoiceYmd && String(line.invoiceYmd).slice(0, 7) === ym;
  const paidC = round2(Number(paidInMonth || 0));
  if (paidC <= 0) {
    return { priorEffective: priorLines, newEffective: newLines, nettingMeta: null };
  }
  const pIn = priorLines.filter(inMoveMonth);
  const nIn = newLines.filter(inMoveMonth);
  const pOut = priorLines.filter((l) => !inMoveMonth(l));
  const nOut = newLines.filter((l) => !inMoveMonth(l));
  const gross = round2(
    pIn.reduce((s, l) => s + Number(l.amount || 0), 0) + nIn.reduce((s, l) => s + Number(l.amount || 0), 0)
  );
  const net = round2(Math.max(0, gross - paidC));
  const netLines =
    net > 0
      ? [
          {
            invoiceYmd: changeYmd,
            amount: net,
            prorate: true,
            titleSuffix: netTitleSuffix,
            nettingDetail: { gross, paidCredit: paidC, net, monthLabel: ym }
          }
        ]
      : [];
  return {
    priorEffective: pOut,
    newEffective: netLines.concat(nOut),
    nettingMeta: { gross, paidCredit: paidC, net, monthLabel: ym, applied: true }
  };
}

/**
 * Preview rentalcollection lines that changeRoom would create (no DB writes).
 * Skips recurring lines whose invoice date already has a paid row after changeYmd (same as submit).
 */
async function previewChangeRoomTenancy(
  clientId,
  tenancyId,
  { newRoomId, newRental, newEnd, agreementFees, changeDate, newDeposit, newParkingMonthly }
) {
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, rental, deposit, title, begin, parkinglot_json, billing_json FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const current = tenancyRows[0];
  const originalRoomId = current.room_id;
  const oldRental = Number(current.rental || 0);
  const oldDeposit = Number(current.deposit || 0);
  const hasLots = tenancyHasParkingLots(current.parkinglot_json);
  const parkingLotCount = countAssignedParkingLots(current.parkinglot_json);
  const inferredParkingMonthly = inferMonthlyParkingTotalFromBilling(current.billing_json, parkingLotCount);
  const hadRecurringParkingFees =
    (inferredParkingMonthly != null && inferredParkingMonthly > 0) || hasLots;

  let parkingMonthlyEffective = null;
  if (hadRecurringParkingFees) {
    if (newParkingMonthly !== undefined && newParkingMonthly !== null && String(newParkingMonthly).trim() !== '') {
      const n = Number(newParkingMonthly);
      if (!Number.isFinite(n) || n < 0) throw new Error('INVALID_PARKING_MONTHLY');
      parkingMonthlyEffective = n;
    } else if (inferredParkingMonthly != null && inferredParkingMonthly > 0) {
      parkingMonthlyEffective = inferredParkingMonthly;
    } else {
      parkingMonthlyEffective = null;
    }
  } else if (
    newParkingMonthly !== undefined &&
    newParkingMonthly !== null &&
    String(newParkingMonthly).trim() !== '' &&
    Number(newParkingMonthly) > 0
  ) {
    throw new Error('EXTEND_PARKING_NOT_APPLICABLE');
  }

  const priorParkingMonthly =
    inferredParkingMonthly != null && inferredParkingMonthly > 0
      ? inferredParkingMonthly
      : parkingMonthlyEffective;
  const newDepositNum =
    newDeposit !== undefined && newDeposit !== null
      ? (() => {
          const n = Number(newDeposit);
          return Number.isFinite(n) ? n : oldDeposit;
        })()
      : oldDeposit;

  const finalRoomId = newRoomId || originalRoomId;
  const roomActuallyChanged = String(finalRoomId) !== String(originalRoomId);
  if (roomActuallyChanged) {
    const [newRoomRows] = await pool.query('SELECT id, available FROM roomdetail WHERE id = ? LIMIT 1', [newRoomId]);
    if (!newRoomRows.length || !newRoomRows[0].available) throw new Error('ROOM_NOT_AVAILABLE');
  }

  const changeYmd =
    changeDate != null && String(changeDate).trim() !== ''
      ? String(changeDate).trim().substring(0, 10)
      : getTodayMalaysiaDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(changeYmd)) {
    throw new Error('INVALID_CHANGE_DATE');
  }

  const newEndYmd = normalizeMysqlDateToYmd(newEnd);
  if (!newEndYmd) {
    throw new Error('INVALID_NEW_END');
  }
  if (compareYmd(newEndYmd, changeYmd) < 0) {
    throw new Error('INVALID_NEW_END_BEFORE_MOVE');
  }

  const newRentalNum = Number(newRental || 0);
  if (newRentalNum < oldRental) {
    throw new Error('CHANGE_ROOM_RENT_REDUCTION');
  }

  const [allRcRows] = await pool.query(
    'SELECT id, date, ispaid FROM rentalcollection WHERE tenancy_id = ?',
    [tenancyId]
  );
  const paidInvoiceYmdsAfterChange = new Set();
  for (const row of allRcRows || []) {
    const dateYmd = utcDatetimeFromDbToMalaysiaDateOnly(row.date);
    if (!dateYmd) continue;
    const paid = row.ispaid === 1 || row.ispaid === true;
    if (compareYmd(dateYmd, changeYmd) > 0 && paid) {
      paidInvoiceYmdsAfterChange.add(dateYmd);
    }
  }

  const client = await getClientAdmin(clientId);
  const rentalConfig = client?.admin?.rental || { type: 'first', value: 1 };
  const beginYmd = tenancyCalendarYmdFromDb(current.begin);
  const lastNightBeforeMoveYmd = addDaysYmd(changeYmd, -1);

  const priorOldRentLines = buildChangeRoomPriorOldRentLines({
    firstDayNewRentYmd: changeYmd,
    newEndYmd,
    oldRental,
    beginYmd: beginYmd || undefined,
    rentalType: rentalConfig.type || 'first',
    rentalValue: rentalConfig.value
  });

  const rentalLines = buildExtendRentalIncomeLines({
    oldEndYmd: lastNightBeforeMoveYmd,
    newEndYmd,
    newRental: newRentalNum,
    rentalType: rentalConfig.type || 'first',
    rentalValue: rentalConfig.value,
    beginYmd: beginYmd || undefined
  });

  const feeYmd = changeYmd;
  const depositDiff = newDepositNum - oldDeposit;
  const oneTimeRows = [];
  if (depositDiff > 0) {
    oneTimeRows.push({
      key: 'deposit-topup',
      label: 'Deposit top-up',
      sub: `Invoice date ${feeYmd}`,
      amount: round2(Number(depositDiff))
    });
  }
  if (Number(agreementFees || 0) > 0) {
    oneTimeRows.push({
      key: 'agreement',
      label: 'Agreement fees',
      sub: `Change room · invoice date ${feeYmd}`,
      amount: round2(Number(agreementFees))
    });
  }

  const priorOldParkingLines =
    hadRecurringParkingFees &&
    priorParkingMonthly != null &&
    Number(priorParkingMonthly) > 0
      ? buildChangeRoomPriorOldRentLines({
          firstDayNewRentYmd: changeYmd,
          newEndYmd,
          oldRental: Number(priorParkingMonthly),
          beginYmd: beginYmd || undefined,
          rentalType: rentalConfig.type || 'first',
          rentalValue: rentalConfig.value,
          titleFull: 'Parking Fees — prior room',
          titleProrate: 'Prorated Parking Fees — prior room'
        })
      : [];

  const newParkingLines =
    hadRecurringParkingFees &&
    parkingMonthlyEffective != null &&
    Number(parkingMonthlyEffective) > 0
      ? buildExtendRentalIncomeLines({
          oldEndYmd: lastNightBeforeMoveYmd,
          newEndYmd,
          newRental: Number(parkingMonthlyEffective),
          rentalType: rentalConfig.type || 'first',
          rentalValue: rentalConfig.value,
          beginYmd: beginYmd || undefined,
          titleFull: 'Parking Fees',
          titleProrate: 'Prorated Parking Fees'
        })
      : [];

  const rentalIncomeTypeIdForNet = await getAccountIdByWixId(BUKKUID_WIX.RENTAL_INCOME);
  const parkingFeesTypeIdForNet = await getAccountIdByWixId(BUKKUID_WIX.PARKING_FEES);
  const paidRentInMoveMonth = await sumPaidRentalCollectionInMonth(clientId, tenancyId, rentalIncomeTypeIdForNet, changeYmd);
  const rentNetResult = applyChangeRoomPaidMonthNetting(
    priorOldRentLines,
    rentalLines,
    changeYmd,
    paidRentInMoveMonth,
    'Rental Income — change room (net of paid rent)'
  );
  const priorOldRentEffective = rentNetResult.priorEffective;
  const rentalLinesEffective = rentNetResult.newEffective;

  const paidParkingInMoveMonth = parkingFeesTypeIdForNet
    ? await sumPaidRentalCollectionInMonth(clientId, tenancyId, parkingFeesTypeIdForNet, changeYmd)
    : 0;
  const parkingNetResult = applyChangeRoomPaidMonthNetting(
    priorOldParkingLines,
    newParkingLines,
    changeYmd,
    paidParkingInMoveMonth,
    'Parking Fees — change room (net of paid parking)'
  );
  const priorOldParkingEffective = parkingNetResult.priorEffective;
  const newParkingEffective = parkingNetResult.newEffective;

  const recurringRows = [];
  let rIdx = 0;
  const skippedPaidInvoiceYmds = [];
  const rentalTypeLower = String(rentalConfig.type || 'first').toLowerCase();
  const lastNightOnOldRateYmd = addDaysYmd(changeYmd, -1);
  const billingInvoiceDateHint =
    rentalTypeLower === 'last'
      ? `Company Settings: bill on last day of month. Old rate covers through ${lastNightOnOldRateYmd} (night before first day at new rent ${changeYmd}). For a partial month, the invoice date is that last old-rate day—not the move day.`
      : rentalTypeLower === 'first'
        ? `Company Settings: bill on first of month. Partial months use the first billed day in that segment as the invoice date when it is not a full calendar month.`
        : null;

  for (const line of priorOldRentEffective) {
    if (paidInvoiceYmdsAfterChange.has(line.invoiceYmd)) {
      skippedPaidInvoiceYmds.push(line.invoiceYmd);
      continue;
    }
    const formula = line.nettingDetail ? formatChangeRoomNettingFormula(line.nettingDetail) : formatProrateFormulaLine(line);
    recurringRows.push({
      key: `prior-${rIdx++}`,
      label: line.titleSuffix || 'Rental Income — prior room',
      sub: `Invoice date ${line.invoiceYmd}${line.prorate ? ' · prorated' : ''} · old rate (prior room)`,
      amount: round2(Number(line.amount)),
      ...(formula ? { formula } : {})
    });
  }
  for (const line of rentalLinesEffective) {
    if (paidInvoiceYmdsAfterChange.has(line.invoiceYmd)) {
      skippedPaidInvoiceYmds.push(line.invoiceYmd);
      continue;
    }
    const formula = line.nettingDetail ? formatChangeRoomNettingFormula(line.nettingDetail) : formatProrateFormulaLine(line);
    recurringRows.push({
      key: `new-${rIdx++}`,
      label: line.titleSuffix || 'Rental Income',
      sub: line.nettingDetail
        ? `Invoice date ${line.invoiceYmd} · net of rent already paid in ${line.nettingDetail.monthLabel}`
        : `Invoice date ${line.invoiceYmd}${line.prorate ? ' · prorated' : ''} · new rate`,
      amount: round2(Number(line.amount)),
      ...(formula ? { formula } : {})
    });
  }

  for (const line of priorOldParkingEffective) {
    if (paidInvoiceYmdsAfterChange.has(line.invoiceYmd)) {
      skippedPaidInvoiceYmds.push(line.invoiceYmd);
      continue;
    }
    const formula = line.nettingDetail ? formatChangeRoomNettingFormula(line.nettingDetail) : formatProrateFormulaLine(line);
    recurringRows.push({
      key: `park-prior-${rIdx++}`,
      label: line.titleSuffix || 'Parking Fees — prior room',
      sub: `Invoice date ${line.invoiceYmd}${line.prorate ? ' · prorated' : ''} · prior room (parking)`,
      amount: round2(Number(line.amount)),
      ...(formula ? { formula } : {})
    });
  }
  for (const line of newParkingEffective) {
    if (paidInvoiceYmdsAfterChange.has(line.invoiceYmd)) {
      skippedPaidInvoiceYmds.push(line.invoiceYmd);
      continue;
    }
    const formula = line.nettingDetail ? formatChangeRoomNettingFormula(line.nettingDetail) : formatProrateFormulaLine(line);
    recurringRows.push({
      key: `park-new-${rIdx++}`,
      label: line.titleSuffix || 'Parking Fees',
      sub: line.nettingDetail
        ? `Invoice date ${line.invoiceYmd} · net of parking already paid in ${line.nettingDetail.monthLabel}`
        : `Invoice date ${line.invoiceYmd}${line.prorate ? ' · prorated' : ''} · after move (parking)`,
      amount: round2(Number(line.amount)),
      ...(formula ? { formula } : {})
    });
  }

  const oneTimeSubtotal = round2(oneTimeRows.reduce((s, r) => s + r.amount, 0));
  const recurringSubtotal = round2(recurringRows.reduce((s, r) => s + r.amount, 0));
  const total = round2(oneTimeSubtotal + recurringSubtotal);

  const skippedUnique = [...new Set(skippedPaidInvoiceYmds)].sort();

  const oldRentalSummary = round2(oldRental);
  const newRentalSummary = round2(newRentalNum);
  const depositSummaryOld = round2(oldDeposit);
  const depositSummaryNew = round2(newDepositNum);
  let parkingMonthlySummary = null;
  if (hadRecurringParkingFees) {
    const oldPark =
      inferredParkingMonthly != null && inferredParkingMonthly > 0
        ? round2(Number(inferredParkingMonthly))
        : round2(0);
    const newPark = round2(Number(parkingMonthlyEffective || 0));
    parkingMonthlySummary = { from: oldPark, to: newPark };
  }

  return {
    ok: true,
    tenancyTitle: current.title || '',
    moveFirstDayYmd: changeYmd,
    newEndYmd,
    lastNightOnOldRateYmd,
    rentalInvoiceRule: { type: rentalConfig.type || 'first', value: rentalConfig.value ?? 1 },
    billingInvoiceDateHint: billingInvoiceDateHint || undefined,
    oneTimeRows,
    recurringRows,
    oneTimeSubtotal,
    recurringSubtotal,
    total,
    skippedPaidInvoiceYmds: skippedUnique.length ? skippedUnique : undefined,
    changeRoomRentNetting: rentNetResult.nettingMeta || undefined,
    changeRoomParkingNetting: parkingNetResult.nettingMeta || undefined,
    rateSummary: {
      rent: { from: oldRentalSummary, to: newRentalSummary },
      parkingMonthlyTotal: parkingMonthlySummary,
      deposit: { from: depositSummaryOld, to: depositSummaryNew }
    }
  };
}

function round2(n) {
  return Number(Number(n).toFixed(2));
}

/**
 * Extend tenancy: update end, rental, deposit; insert rental records (deposit topup, prorate, full cycles, agreement fees).
 * 若同房已有下一笔 booking，newEnd 不得超过下一笔的 begin 的前一天。
 * Rental：首段 prorate → 中间每月 cycle 日整月 → 末段 prorate（可延到任意日）。Commission：按 client 的 commission 配置 + 本次 extend 的期数（月数）决定规则，例如 extend 3 个月跟 3 个月 rules、6 个月跟 6 个月 rules；待接 client admin 后在此生成 commission 行（首尾 prorate）。
 * If tenancy is active (not frozen): extend TTLock passcode to new end. If inactive (unpaid, expired on ytd), skip –
 * when tenant pays, checkAndRestoreTenancyIfFullyPaid will use tenancy.end to update lock.
 */
async function extendTenancy(clientId, staffId, tenancyId, { newEnd, newRental, agreementFees, newDeposit, newParkingMonthly }) {
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, begin, `end`, rental, deposit, title, status, active, parkinglot_json, billing_json FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const current = tenancyRows[0];
  const hasLots = tenancyHasParkingLots(current.parkinglot_json);
  const parkingLotCount = countAssignedParkingLots(current.parkinglot_json);
  const inferredParkingMonthly = inferMonthlyParkingTotalFromBilling(current.billing_json, parkingLotCount);
  const hadRecurringParkingFees =
    (inferredParkingMonthly != null && inferredParkingMonthly > 0) || hasLots;

  let parkingMonthlyEffective = null;
  if (hadRecurringParkingFees) {
    if (newParkingMonthly !== undefined && newParkingMonthly !== null && String(newParkingMonthly).trim() !== '') {
      const n = Number(newParkingMonthly);
      if (!Number.isFinite(n) || n < 0) throw new Error('INVALID_PARKING_MONTHLY');
      parkingMonthlyEffective = n;
    } else if (inferredParkingMonthly != null && inferredParkingMonthly > 0) {
      parkingMonthlyEffective = inferredParkingMonthly;
    } else {
      parkingMonthlyEffective = null;
    }
  } else if (
    newParkingMonthly !== undefined &&
    newParkingMonthly !== null &&
    String(newParkingMonthly).trim() !== '' &&
    Number(newParkingMonthly) > 0
  ) {
    throw new Error('EXTEND_PARKING_NOT_APPLICABLE');
  }

  const maxExtensionEnd = await getMaxExtensionEndDate(clientId, tenancyId);
  const newEndStr =
    newEnd instanceof Date && !Number.isNaN(newEnd.getTime())
      ? utcDatetimeFromDbToMalaysiaDateOnly(newEnd) || ''
      : String(newEnd || '')
          .trim()
          .substring(0, 10);
  if (maxExtensionEnd && newEndStr > maxExtensionEnd) {
    throw new Error('EXTEND_EXCEEDS_NEXT_BOOKING');
  }
  const oldEnd = current.end ? new Date(current.end) : null;
  const oldRental = Number(current.rental || 0);
  const oldDeposit = Number(current.deposit || 0);
  const nextDeposit =
    newDeposit !== undefined && newDeposit !== null
      ? (() => {
          const n = Number(newDeposit);
          return Number.isFinite(n) ? n : oldDeposit;
        })()
      : oldDeposit;
  const depositDiff = nextDeposit - oldDeposit;
  const previousEndVal = oldEnd ? tenancyCalendarYmdFromDb(oldEnd) : null;
  const beginYmd = tenancyCalendarYmdFromDb(current.begin);

  const newEndMysql = tenancyEndYmdToMysqlDatetime(newEndStr);
  if (!newEndMysql) throw new Error('INVALID_NEW_END_DATE');
  await pool.query(
    'UPDATE tenancy SET `end` = ?, rental = ?, deposit = ?, previous_end = ?, last_extended_by_id = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
    [newEndMysql, newRental, nextDeposit, previousEndVal, staffId || null, tenancyId, clientId]
  );

  const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [current.room_id]);
  const propertyId = roomRows[0] ? roomRows[0].property_id : null;
  const client = await getClientAdmin(clientId);
  const rentalConfig = client?.admin?.rental || { type: 'first', value: 1 };
  const newRecords = [];
  /** Audit timestamps — UTC; rentalcollection.date uses MY business day via malaysiaDateToUtcDatetimeForDb. */
  const nowUtc = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  const rentalLines =
    previousEndVal && Number(newRental) > 0
      ? buildExtendRentalIncomeLines({
          oldEndYmd: previousEndVal,
          newEndYmd: newEndStr,
          newRental: Number(newRental),
          rentalType: rentalConfig.type || 'first',
          rentalValue: rentalConfig.value,
          beginYmd: beginYmd || null
        })
      : [];
  const feeYmd =
    rentalLines[0]?.invoiceYmd ||
    defaultFeeInvoiceYmd({
      oldEndYmd: previousEndVal || newEndStr,
      newEndYmd: newEndStr,
      rentalType: rentalConfig.type || 'first',
      rentalValue: rentalConfig.value,
      beginYmd: beginYmd || null
    });
  const feeDateDb = malaysiaDateToUtcDatetimeForDb(String(feeYmd).slice(0, 10));

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
        date: feeDateDb,
        title: `Extend Deposit Topup - ${current.title}`,
        ispaid: 0,
        created_at: nowUtc,
        updated_at: nowUtc
      });
    }
  }

  if (rentalLines.length) {
    const typeId = await getAccountIdByWixId(BUKKUID_WIX.RENTAL_INCOME);
    if (typeId) {
      for (const line of rentalLines) {
        newRecords.push({
          id: randomUUID(),
          tenancy_id: tenancyId,
          tenant_id: current.tenant_id,
          room_id: current.room_id,
          property_id: propertyId,
          client_id: clientId,
          type_id: typeId,
          amount: line.amount,
          date: malaysiaDateToUtcDatetimeForDb(String(line.invoiceYmd).slice(0, 10)),
          title: `${line.titleSuffix} - ${current.title}`,
          ispaid: 0,
          created_at: nowUtc,
          updated_at: nowUtc
        });
      }
    }
  }

  const parkingLines =
    hadRecurringParkingFees &&
    parkingMonthlyEffective != null &&
    Number(parkingMonthlyEffective) > 0 &&
    previousEndVal
      ? buildExtendRentalIncomeLines({
          oldEndYmd: previousEndVal,
          newEndYmd: newEndStr,
          newRental: Number(parkingMonthlyEffective),
          rentalType: rentalConfig.type || 'first',
          rentalValue: rentalConfig.value,
          beginYmd: beginYmd || null,
          titleFull: 'Parking Fees',
          titleProrate: 'Prorated Parking Fees'
        })
      : [];

  if (parkingLines.length) {
    const typeId = await getAccountIdByWixId(BUKKUID_WIX.PARKING_FEES);
    if (typeId) {
      for (const line of parkingLines) {
        newRecords.push({
          id: randomUUID(),
          tenancy_id: tenancyId,
          tenant_id: current.tenant_id,
          room_id: current.room_id,
          property_id: propertyId,
          client_id: clientId,
          type_id: typeId,
          amount: line.amount,
          date: malaysiaDateToUtcDatetimeForDb(String(line.invoiceYmd).slice(0, 10)),
          title: `${line.titleSuffix} - ${current.title}`,
          ispaid: 0,
          created_at: nowUtc,
          updated_at: nowUtc
        });
      }
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
        date: feeDateDb,
        title: `Extend Agreement Fees - ${current.title}`,
        ispaid: 0,
        created_at: nowUtc,
        updated_at: nowUtc
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
 * Change room (or same-room rent/deposit update): void unpaid invoices strictly after change date;
 * keep all rows on/before change date (old room period). Paid rows after change date are kept — skip recreating those billing dates.
 * Rental: old rate from lease begin through night before first new-rate day; new rate from first new-rate day (changeYmd)
 * through new end (calendar first/last: same proration as extend). Prior-room lines use original room_id; align skip those ids.
 * Deposit top-up / agreement fees on change date get new rows + invoices.
 * After tenancy update: sync available / availablesoon / availablefrom for old and new room.
 * When the physical room changes: realign unpaid rentalcollection.room_id/property_id to the new unit so operator
 * invoice list matches the tenancy (rows on/before change date are kept for amounts but may still show old room without this).
 */
async function changeRoom(clientId, staffId, tenancyId, { newRoomId, newRental, newEnd, agreementFees, changeDate, newDeposit, newParkingMonthly }) {
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, rental, deposit, title, begin, parkinglot_json, billing_json FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const current = tenancyRows[0];
  const originalRoomId = current.room_id;
  const oldRental = Number(current.rental || 0);
  const oldDeposit = Number(current.deposit || 0);
  const hasLots = tenancyHasParkingLots(current.parkinglot_json);
  const parkingLotCount = countAssignedParkingLots(current.parkinglot_json);
  const inferredParkingMonthly = inferMonthlyParkingTotalFromBilling(current.billing_json, parkingLotCount);
  const hadRecurringParkingFees =
    (inferredParkingMonthly != null && inferredParkingMonthly > 0) || hasLots;

  let parkingMonthlyEffective = null;
  if (hadRecurringParkingFees) {
    if (newParkingMonthly !== undefined && newParkingMonthly !== null && String(newParkingMonthly).trim() !== '') {
      const n = Number(newParkingMonthly);
      if (!Number.isFinite(n) || n < 0) throw new Error('INVALID_PARKING_MONTHLY');
      parkingMonthlyEffective = n;
    } else if (inferredParkingMonthly != null && inferredParkingMonthly > 0) {
      parkingMonthlyEffective = inferredParkingMonthly;
    } else {
      parkingMonthlyEffective = null;
    }
  } else if (
    newParkingMonthly !== undefined &&
    newParkingMonthly !== null &&
    String(newParkingMonthly).trim() !== '' &&
    Number(newParkingMonthly) > 0
  ) {
    throw new Error('EXTEND_PARKING_NOT_APPLICABLE');
  }

  const priorParkingMonthly =
    inferredParkingMonthly != null && inferredParkingMonthly > 0
      ? inferredParkingMonthly
      : parkingMonthlyEffective;
  /* UI sends absolute new deposit only when there is a top-up; if omitted, keep existing (same tenancy). */
  const newDepositNum =
    newDeposit !== undefined && newDeposit !== null
      ? (() => {
          const n = Number(newDeposit);
          return Number.isFinite(n) ? n : oldDeposit;
        })()
      : oldDeposit;
  const finalRoomId = newRoomId || originalRoomId;
  const roomActuallyChanged = String(finalRoomId) !== String(originalRoomId);

  if (roomActuallyChanged) {
    const [newRoomRows] = await pool.query('SELECT id, available FROM roomdetail WHERE id = ? LIMIT 1', [newRoomId]);
    if (!newRoomRows.length || !newRoomRows[0].available) throw new Error('ROOM_NOT_AVAILABLE');
  }

  const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [finalRoomId]);
  const propertyId = roomRows[0] ? roomRows[0].property_id : null;
  const [oldRoomPropRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [originalRoomId]);
  const propertyIdOld = oldRoomPropRows[0] ? oldRoomPropRows[0].property_id : null;

  const changeYmd =
    changeDate != null && String(changeDate).trim() !== ''
      ? String(changeDate).trim().substring(0, 10)
      : getTodayMalaysiaDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(changeYmd)) {
    throw new Error('INVALID_CHANGE_DATE');
  }

  const newEndYmd = normalizeMysqlDateToYmd(newEnd);
  if (!newEndYmd) {
    throw new Error('INVALID_NEW_END');
  }

  const [allRcRows] = await pool.query(
    'SELECT id, date, ispaid FROM rentalcollection WHERE tenancy_id = ?',
    [tenancyId]
  );

  const unpaidIdsToVoid = [];
  const paidInvoiceYmdsAfterChange = new Set();
  /* Operator picks change date in UI = first day in new room; same day can carry agreement fees / prorate.
     Keep all rows with date <= changeYmd (paid or not). Only strictly after changeYmd: void unpaid + rebuild rent for new room. */
  for (const row of allRcRows || []) {
    const dateYmd = utcDatetimeFromDbToMalaysiaDateOnly(row.date);
    if (!dateYmd) continue;
    const paid = row.ispaid === 1 || row.ispaid === true;
    if (compareYmd(dateYmd, changeYmd) > 0) {
      if (paid) {
        paidInvoiceYmdsAfterChange.add(dateYmd);
      } else {
        unpaidIdsToVoid.push(row.id);
      }
    }
  }

  if (unpaidIdsToVoid.length) {
    try {
      await voidOrDeleteInvoicesForRentalCollectionIds(clientId, unpaidIdsToVoid, {
        einvoiceCancelReason: 'change tenancy'
      });
    } catch (e) {
      console.warn('voidOrDeleteInvoicesForRentalCollectionIds (changeRoom) failed:', e?.message || e);
    }
    for (const id of unpaidIdsToVoid) {
      await pool.query('DELETE FROM rentalcollection WHERE id = ?', [id]);
    }
  }

  const nowUtc = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const dateStr = malaysiaDateToUtcDatetimeForDb(changeYmd);

  const client = await getClientAdmin(clientId);
  const rentalConfig = client?.admin?.rental || { type: 'first', value: 1 };
  const beginYmd = tenancyCalendarYmdFromDb(current.begin);
  /* First calendar day at new rent = changeYmd (operator enter 13 May if last old-rent day is 12 May). */
  const lastNightBeforeMoveYmd = addDaysYmd(changeYmd, -1);

  const priorOldRentLines = buildChangeRoomPriorOldRentLines({
    firstDayNewRentYmd: changeYmd,
    newEndYmd,
    oldRental,
    beginYmd: beginYmd || undefined,
    rentalType: rentalConfig.type || 'first',
    rentalValue: rentalConfig.value
  });

  const rentalLines = buildExtendRentalIncomeLines({
    oldEndYmd: lastNightBeforeMoveYmd,
    newEndYmd,
    newRental: Number(newRental || 0),
    rentalType: rentalConfig.type || 'first',
    rentalValue: rentalConfig.value,
    beginYmd: beginYmd || undefined
  });

  const priorOldParkingLines =
    hadRecurringParkingFees &&
    priorParkingMonthly != null &&
    Number(priorParkingMonthly) > 0
      ? buildChangeRoomPriorOldRentLines({
          firstDayNewRentYmd: changeYmd,
          newEndYmd,
          oldRental: Number(priorParkingMonthly),
          beginYmd: beginYmd || undefined,
          rentalType: rentalConfig.type || 'first',
          rentalValue: rentalConfig.value,
          titleFull: 'Parking Fees — prior room',
          titleProrate: 'Prorated Parking Fees — prior room'
        })
      : [];

  const newParkingLines =
    hadRecurringParkingFees &&
    parkingMonthlyEffective != null &&
    Number(parkingMonthlyEffective) > 0
      ? buildExtendRentalIncomeLines({
          oldEndYmd: lastNightBeforeMoveYmd,
          newEndYmd,
          newRental: Number(parkingMonthlyEffective),
          rentalType: rentalConfig.type || 'first',
          rentalValue: rentalConfig.value,
          beginYmd: beginYmd || undefined,
          titleFull: 'Parking Fees',
          titleProrate: 'Prorated Parking Fees'
        })
      : [];

  const rentalIncomeTypeId = await getAccountIdByWixId(BUKKUID_WIX.RENTAL_INCOME);
  const parkingFeesTypeId = await getAccountIdByWixId(BUKKUID_WIX.PARKING_FEES);
  const paidRentInMoveMonthSubmit = await sumPaidRentalCollectionInMonth(clientId, tenancyId, rentalIncomeTypeId, changeYmd);
  const rentNetSubmit = applyChangeRoomPaidMonthNetting(
    priorOldRentLines,
    rentalLines,
    changeYmd,
    paidRentInMoveMonthSubmit,
    'Rental Income — change room (net of paid rent)'
  );
  const priorOldRentEffective = rentNetSubmit.priorEffective;
  const rentalLinesEffective = rentNetSubmit.newEffective;

  const paidParkingInMoveMonthSubmit = parkingFeesTypeId
    ? await sumPaidRentalCollectionInMonth(clientId, tenancyId, parkingFeesTypeId, changeYmd)
    : 0;
  const parkingNetSubmit = applyChangeRoomPaidMonthNetting(
    priorOldParkingLines,
    newParkingLines,
    changeYmd,
    paidParkingInMoveMonthSubmit,
    'Parking Fees — change room (net of paid parking)'
  );
  const priorOldParkingEffective = parkingNetSubmit.priorEffective;
  const newParkingEffective = parkingNetSubmit.newEffective;

  const toInsert = [];
  const priorRoomRentalIds = [];
  if (Number(agreementFees || 0) > 0) {
    const typeId = await getAccountIdByWixId(BUKKUID_WIX.AGREEMENT_FEES);
    if (typeId) {
      toInsert.push({
        id: randomUUID(),
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: finalRoomId,
        property_id: propertyId,
        client_id: clientId,
        type_id: typeId,
        amount: Number(agreementFees),
        date: dateStr,
        title: 'Agreement Fees',
        ispaid: 0,
        created_at: nowUtc,
        updated_at: nowUtc
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
        room_id: finalRoomId,
        property_id: propertyId,
        client_id: clientId,
        type_id: typeId,
        amount: newDepositNum - oldDeposit,
        date: dateStr,
        title: 'Deposit Topup',
        ispaid: 0,
        created_at: nowUtc,
        updated_at: nowUtc
      });
    }
  }
  if (rentalIncomeTypeId && priorOldRentEffective.length) {
    for (const line of priorOldRentEffective) {
      if (paidInvoiceYmdsAfterChange.has(line.invoiceYmd)) continue;
      const rid = randomUUID();
      priorRoomRentalIds.push(rid);
      toInsert.push({
        id: rid,
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: originalRoomId,
        property_id: propertyIdOld,
        client_id: clientId,
        type_id: rentalIncomeTypeId,
        amount: line.amount,
        date: malaysiaDateToUtcDatetimeForDb(line.invoiceYmd),
        title: line.titleSuffix || 'Rental Income — prior room',
        ispaid: 0,
        created_at: nowUtc,
        updated_at: nowUtc
      });
    }
  }
  if (rentalIncomeTypeId && Number(newRental || 0) > 0 && rentalLinesEffective.length) {
    for (const line of rentalLinesEffective) {
      if (paidInvoiceYmdsAfterChange.has(line.invoiceYmd)) continue;
      toInsert.push({
        id: randomUUID(),
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: finalRoomId,
        property_id: propertyId,
        client_id: clientId,
        type_id: rentalIncomeTypeId,
        amount: line.amount,
        date: malaysiaDateToUtcDatetimeForDb(line.invoiceYmd),
        title: line.titleSuffix || 'Rental Income',
        ispaid: 0,
        created_at: nowUtc,
        updated_at: nowUtc
      });
    }
  }

  if (parkingFeesTypeId && priorOldParkingEffective.length) {
    for (const line of priorOldParkingEffective) {
      if (paidInvoiceYmdsAfterChange.has(line.invoiceYmd)) continue;
      const pid = randomUUID();
      priorRoomRentalIds.push(pid);
      toInsert.push({
        id: pid,
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: originalRoomId,
        property_id: propertyIdOld,
        client_id: clientId,
        type_id: parkingFeesTypeId,
        amount: line.amount,
        date: malaysiaDateToUtcDatetimeForDb(line.invoiceYmd),
        title: line.titleSuffix || 'Parking Fees — prior room',
        ispaid: 0,
        created_at: nowUtc,
        updated_at: nowUtc
      });
    }
  }
  if (parkingFeesTypeId && newParkingEffective.length) {
    for (const line of newParkingEffective) {
      if (paidInvoiceYmdsAfterChange.has(line.invoiceYmd)) continue;
      toInsert.push({
        id: randomUUID(),
        tenancy_id: tenancyId,
        tenant_id: current.tenant_id,
        room_id: finalRoomId,
        property_id: propertyId,
        client_id: clientId,
        type_id: parkingFeesTypeId,
        amount: line.amount,
        date: malaysiaDateToUtcDatetimeForDb(line.invoiceYmd),
        title: line.titleSuffix || 'Parking Fees',
        ispaid: 0,
        created_at: nowUtc,
        updated_at: nowUtc
      });
    }
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

  const newEndMysql = tenancyEndYmdToMysqlDatetime(newEndYmd);
  if (!newEndMysql) throw new Error('INVALID_NEW_END');
  if (roomActuallyChanged) {
    await pool.query(
      'UPDATE tenancy SET room_id = ?, rental = ?, deposit = ?, `end` = ?, last_room_change_at = NOW(), updated_at = NOW() WHERE id = ? AND client_id = ?',
      [finalRoomId, newRental, newDepositNum, newEndMysql, tenancyId, clientId]
    );
  } else {
    await pool.query(
      'UPDATE tenancy SET room_id = ?, rental = ?, deposit = ?, `end` = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
      [finalRoomId, newRental, newDepositNum, newEndMysql, tenancyId, clientId]
    );
  }

  if (roomActuallyChanged) {
    try {
      if (priorRoomRentalIds.length) {
        const ph = priorRoomRentalIds.map(() => '?').join(',');
        await pool.query(
          `UPDATE rentalcollection rc
           INNER JOIN roomdetail rm ON rm.id = ?
           SET rc.room_id = rm.id, rc.property_id = rm.property_id, rc.updated_at = NOW()
           WHERE rc.tenancy_id = ? AND rc.client_id = ? AND COALESCE(rc.ispaid, 0) = 0
             AND rc.room_id = ?
             AND rc.id NOT IN (${ph})`,
          [finalRoomId, tenancyId, clientId, originalRoomId, ...priorRoomRentalIds]
        );
      } else {
        await pool.query(
          `UPDATE rentalcollection rc
           INNER JOIN roomdetail rm ON rm.id = ?
           SET rc.room_id = rm.id, rc.property_id = rm.property_id, rc.updated_at = NOW()
           WHERE rc.tenancy_id = ? AND rc.client_id = ? AND COALESCE(rc.ispaid, 0) = 0`,
          [finalRoomId, tenancyId, clientId]
        );
      }
    } catch (e) {
      console.warn('[changeRoom] align unpaid rentalcollection room/property failed:', e?.message || e);
    }
  }

  try {
    if (String(originalRoomId) === String(finalRoomId)) {
      await updateRoomAvailableFromTenancy(finalRoomId);
    } else {
      await updateRoomAvailableFromTenancy(originalRoomId);
      await updateRoomAvailableFromTenancy(finalRoomId);
    }
  } catch (e) {
    console.warn('[changeRoom] updateRoomAvailableFromTenancy failed:', e?.message || e);
  }

  return { success: true, message: 'Change processed successfully' };
}

/**
 * Terminate tenancy: set status=0, end=yesterday; delete future unpaid rental; insert forfeit; insert refund if any; release room.
 */
async function terminateTenancy(clientId, tenancyId, forfeitAmount) {
  const todayYmd = getTodayMalaysiaDate();
  const yesterdayYmd = getTodayPlusDaysMalaysia(-1);
  const { toUtc: yesterdayTs } = malaysiaDateRangeToUtcForQuery(yesterdayYmd, yesterdayYmd);
  const forfeit = Number(forfeitAmount || 0);
  if (forfeit < 0) throw new Error('INVALID_FORFEIT_AMOUNT');

  const conn = await pool.getConnection();
  let tenancy = null;
  let futureUnpaidIds = [];
  let forfeitRecord = null;

  try {
    await conn.beginTransaction();

    const [tenancyRows] = await conn.query(
      'SELECT id, tenant_id, room_id, client_id, deposit, status FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1 FOR UPDATE',
      [tenancyId, clientId]
    );
    if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
    tenancy = tenancyRows[0];
    if (tenancy.status === 0) throw new Error('TENANCY_ALREADY_TERMINATED');

    const depositColumn = Number(tenancy.deposit || 0);
    const depTypeIdTerm = await getAccountIdByWixId(BUKKUID_WIX.DEPOSIT);
    let paidDeposit = 0;
    if (depTypeIdTerm) {
      const [paidDepositRows] = await conn.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM rentalcollection
         WHERE tenancy_id = ? AND client_id = ? AND type_id = ? AND ispaid = 1`,
        [tenancyId, clientId, depTypeIdTerm]
      );
      paidDeposit = Number(paidDepositRows?.[0]?.total || 0);
    }
    const refundableDeposit = round2(depositColumn > 0 ? Math.min(depositColumn, paidDeposit) : paidDeposit);
    if (forfeit > refundableDeposit) throw new Error('FORFEIT_EXCEEDS_DEPOSIT');

    const [futureUnpaid] = await conn.query(
      'SELECT id FROM rentalcollection WHERE tenancy_id = ? AND date >= ? AND ispaid = 0',
      [tenancyId, todayYmd]
    );
    futureUnpaidIds = (futureUnpaid || []).map((r) => r.id);

    await conn.query(
      'UPDATE tenancy SET status = 0, `end` = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
      [yesterdayTs, tenancyId, clientId]
    );
    await conn.query(
      'UPDATE roomdetail SET available = 1, availablesoon = 0, availableFrom = NULL, updated_at = NOW() WHERE id = ?',
      [tenancy.room_id]
    );

    if (forfeit > 0) {
      const typeId = await getAccountIdByWixId(BUKKUID_WIX.FORFEIT_DEPOSIT);
      if (typeId) {
        const id = randomUUID();
        const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
        await conn.query(
          `INSERT INTO rentalcollection (id, tenancy_id, tenant_id, room_id, property_id, client_id, type_id, amount, date, title, ispaid, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [id, tenancyId, tenancy.tenant_id, tenancy.room_id, null, clientId, typeId, forfeit, now, 'Forfeit Deposit', now, now]
        );
        forfeitRecord = {
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
      }
    }

    const refundAmount = refundableDeposit - forfeit;
    if (refundAmount > 0) {
      const [existingRefund] = await conn.query(
        'SELECT id FROM refunddeposit WHERE tenancy_id = ? LIMIT 1',
        [tenancyId]
      );
      if (!existingRefund.length) {
        const [roomRows] = await conn.query('SELECT title_fld FROM roomdetail WHERE id = ? LIMIT 1', [tenancy.room_id]);
        const [tenantRows] = await conn.query('SELECT fullname FROM tenantdetail WHERE id = ? LIMIT 1', [tenancy.tenant_id]);
        const roomTitle = roomRows[0] ? roomRows[0].title_fld : '';
        const tenantName = tenantRows[0] ? tenantRows[0].fullname : '';
        const id = randomUUID();
        await conn.query(
          `INSERT INTO refunddeposit (id, amount, roomtitle, tenantname, room_id, tenant_id, client_id, tenancy_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [id, refundAmount, roomTitle, tenantName, tenancy.room_id, tenancy.tenant_id, clientId, tenancyId]
        );
      }
    }

    if (futureUnpaidIds.length) {
      await conn.query(
        `DELETE FROM rentalcollection WHERE tenancy_id = ? AND date >= ? AND ispaid = 0`,
        [tenancyId, todayYmd]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  if (futureUnpaidIds.length) {
    try {
      await voidOrDeleteInvoicesForRentalCollectionIds(clientId, futureUnpaidIds, {
        einvoiceCancelReason: 'terminate tenancy'
      });
    } catch (e) {
      console.warn('voidOrDeleteInvoicesForRentalCollectionIds (terminateTenancy) failed:', e?.message || e);
    }
  }

  if (forfeitRecord) {
    try {
      await createInvoicesForRentalRecords(clientId, [forfeitRecord]);
      await createReceiptForForfeitDepositRentalCollection([forfeitRecord.id]);
    } catch (e) {
      console.warn('createInvoicesForRentalRecords / createReceiptForForfeitDepositRentalCollection (terminate forfeit) failed:', e?.message || e);
    }
  }

  return { success: true, message: 'Tenancy terminated successfully' };
}

/**
 * Fetch terminate dialog context for one tenancy only.
 * Deposit must be tenancy-scoped (never tenant-wide aggregated).
 */
async function getTerminateContext(clientId, tenancyId) {
  const [rows] = await pool.query(
    'SELECT id, deposit, status FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!rows.length) throw new Error('TENANCY_NOT_FOUND');
  const row = rows[0];
  const depositTypeId = await getAccountIdByWixId(BUKKUID_WIX.DEPOSIT);
  let paidDeposit = 0;
  if (depositTypeId) {
    const [paidDepositRows] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM rentalcollection
       WHERE tenancy_id = ? AND client_id = ? AND type_id = ? AND (ispaid = 1 OR ispaid = TRUE)`,
      [tenancyId, clientId, depositTypeId]
    );
    paidDeposit = Number(paidDepositRows?.[0]?.total || 0);
  }
  const depositColumn = Number(row.deposit || 0);
  const deposit = depositDisplayFromTenancyOrPaidRc(depositColumn, paidDeposit);
  const depositInSync = depositInSyncBetweenTenancyColumnAndPaidRc(depositColumn, paidDeposit);
  /** Cash basis when column is 0; else min(contract, paid). */
  const refundableDeposit = Number(
    Math.max(0, depositColumn > 0 ? Math.min(depositColumn, paidDeposit) : paidDeposit).toFixed(2)
  );
  return {
    ok: true,
    tenancyId: row.id,
    deposit,
    depositFromTenancy: Number.isFinite(depositColumn) ? Number(depositColumn.toFixed(2)) : 0,
    paidDeposit,
    depositInSync,
    refundableDeposit,
    skipDepositRefund: refundableDeposit <= 0,
    status: row.status
  };
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
      await voidOrDeleteInvoicesForRentalCollectionIds(clientId, rentalIds, {
        einvoiceCancelReason: 'cancel booking'
      });
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

/** Tenancy `end` column datetime — accepts YYYY-MM-DD or ISO / Date. */
/** Operator edit checkout: MY calendar / wall-clock → UTC for MySQL (same as booking extend). */
function endToMysqlDatetime(val) {
  return tenancyEndInputToMysqlDatetime(val);
}

function parseHandoverObj(v) {
  const p = parseJson(v);
  return p && typeof p === 'object' && !Array.isArray(p) ? { ...p } : {};
}

function isUnknownColumnError(e) {
  return e && (e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054);
}

function assertHandoverProofPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('HANDOVER_CARD_PHOTO_REQUIRED');
  const cards = Array.isArray(payload.handoverCardPhotos)
    ? payload.handoverCardPhotos.filter((x) => String(x || '').trim())
    : [];
  const units = Array.isArray(payload.unitPhotos) ? payload.unitPhotos.filter((x) => String(x || '').trim()) : [];
  const sign = String(payload.tenantSignatureUrl || '').trim();
  if (!cards.length) throw new Error('HANDOVER_CARD_PHOTO_REQUIRED');
  if (!units.length) throw new Error('HANDOVER_UNIT_PHOTO_REQUIRED');
  if (!sign) throw new Error('HANDOVER_TENANT_SIGNATURE_REQUIRED');
}

/**
 * Edit tenancy from Operator (rent, deposit, checkout date, handover appointment times). No rentalcollection rows.
 */
async function updateTenancy(clientId, tenancyId, opts = {}) {
  if (!clientId || !tenancyId) throw new Error('TENANCY_NOT_FOUND');
  const {
    rental,
    deposit,
    end,
    handoverCheckinAt,
    handoverCheckoutAt,
    actorEmail = null,
    actorType = 'operator'
  } = opts;

  const [rows] = await pool.query(
    'SELECT id, handover_checkin_json, handover_checkout_json FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!rows.length) throw new Error('TENANCY_NOT_FOUND');

  const checkin = parseHandoverObj(rows[0].handover_checkin_json);
  const checkout = parseHandoverObj(rows[0].handover_checkout_json);
  const oldCheckinNorm = normalizeScheduleForLog(checkin.scheduledAt);
  const oldCheckoutNorm = normalizeScheduleForLog(checkout.scheduledAt);

  if (handoverCheckinAt !== undefined) {
    if (handoverCheckinAt == null || String(handoverCheckinAt).trim() === '') delete checkin.scheduledAt;
    else checkin.scheduledAt = String(handoverCheckinAt);
  }
  if (handoverCheckoutAt !== undefined) {
    if (handoverCheckoutAt == null || String(handoverCheckoutAt).trim() === '') delete checkout.scheduledAt;
    else checkout.scheduledAt = String(handoverCheckoutAt);
  }

  if (actorType !== 'operator') {
    const [cdRows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
    const adminJson = cdRows[0]?.admin ?? null;
    const windowCheck = validateTenantHandoverScheduleAgainstCompanyWindow({
      handoverCheckinAt: handoverCheckinAt !== undefined ? checkin.scheduledAt : undefined,
      handoverCheckoutAt: handoverCheckoutAt !== undefined ? checkout.scheduledAt : undefined,
      adminJson
    });
    if (!windowCheck.ok) {
      return {
        success: false,
        message: windowCheck.message || windowCheck.reason,
        reason: windowCheck.reason,
        ...(windowCheck.window ? { window: windowCheck.window } : {})
      };
    }
  }

  const newCheckinNorm = normalizeScheduleForLog(checkin.scheduledAt);
  const newCheckoutNorm = normalizeScheduleForLog(checkout.scheduledAt);
  if (handoverCheckinAt !== undefined && oldCheckinNorm !== newCheckinNorm) {
    await appendHandoverScheduleLog({
      clientId,
      tenancyId,
      field: 'checkin',
      oldValue: oldCheckinNorm,
      newValue: newCheckinNorm,
      actorEmail,
      actorType: actorType || 'operator'
    });
  }
  if (handoverCheckoutAt !== undefined && oldCheckoutNorm !== newCheckoutNorm) {
    await appendHandoverScheduleLog({
      clientId,
      tenancyId,
      field: 'checkout',
      oldValue: oldCheckoutNorm,
      newValue: newCheckoutNorm,
      actorEmail,
      actorType: actorType || 'operator'
    });
  }

  const setParts = [];
  const params = [];

  if (rental !== undefined && rental !== null && rental !== '') {
    const r = Number(rental);
    if (!Number.isNaN(r)) {
      setParts.push('rental = ?');
      params.push(r);
    }
  }
  if (deposit !== undefined && deposit !== null && deposit !== '') {
    const d = Number(deposit);
    if (!Number.isNaN(d)) {
      setParts.push('deposit = ?');
      params.push(d);
    }
  }
  if (end !== undefined && end !== null && String(end).trim() !== '') {
    const endMysql = endToMysqlDatetime(end);
    if (endMysql) {
      setParts.push('`end` = ?');
      params.push(endMysql);
    }
  }

  const touchHandoverJson = handoverCheckinAt !== undefined || handoverCheckoutAt !== undefined;
  if (touchHandoverJson) {
    setParts.push('handover_checkin_json = ?');
    params.push(JSON.stringify(checkin));
    setParts.push('handover_checkout_json = ?');
    params.push(JSON.stringify(checkout));
  }

  if (!setParts.length) {
    return { success: true, message: 'No changes' };
  }

  try {
    await pool.query(
      `UPDATE tenancy SET ${setParts.join(', ')}, updated_at = NOW() WHERE id = ? AND client_id = ?`,
      [...params, tenancyId, clientId]
    );
  } catch (e) {
    if (isUnknownColumnError(e)) throw new Error('HANDOVER_COLUMN_MISSING');
    throw e;
  }

  const [trRows] = await pool.query('SELECT room_id FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
  const roomIdAfter = trRows[0]?.room_id;
  if (roomIdAfter) {
    try {
      await updateRoomAvailableFromTenancy(roomIdAfter);
    } catch (e) {
      console.warn('[updateTenancy] updateRoomAvailableFromTenancy:', e?.message || e);
    }
  }

  return { success: true, message: 'Tenancy updated' };
}

async function saveCheckinHandover(clientId, tenancyId, handoverCheckin) {
  assertHandoverProofPayload(handoverCheckin);
  const [rows] = await pool.query(
    'SELECT handover_checkin_json FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!rows.length) throw new Error('TENANCY_NOT_FOUND');
  const prev = parseHandoverObj(rows[0].handover_checkin_json);
  const next = { ...prev, ...handoverCheckin };
  try {
    await pool.query(
      'UPDATE tenancy SET handover_checkin_json = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
      [JSON.stringify(next), tenancyId, clientId]
    );
  } catch (e) {
    if (isUnknownColumnError(e)) throw new Error('HANDOVER_COLUMN_MISSING');
    throw e;
  }
  return { success: true, message: 'Check-in handover saved' };
}

async function saveCheckoutHandover(clientId, tenancyId, handoverCheckout) {
  assertHandoverProofPayload(handoverCheckout);
  const [rows] = await pool.query(
    'SELECT handover_checkout_json FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, clientId]
  );
  if (!rows.length) throw new Error('TENANCY_NOT_FOUND');
  const prev = parseHandoverObj(rows[0].handover_checkout_json);
  const next = { ...prev, ...handoverCheckout };
  try {
    await pool.query(
      'UPDATE tenancy SET handover_checkout_json = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
      [JSON.stringify(next), tenancyId, clientId]
    );
  } catch (e) {
    if (isUnknownColumnError(e)) throw new Error('HANDOVER_COLUMN_MISSING');
    throw e;
  }
  return { success: true, message: 'Check-out handover saved' };
}

/**
 * Retry draft PDF for a pending agreement (same client). Used by operator "retry draft" when quota/errors blocked first run.
 */
/** Credits per new tenancy agreement from template; `operatordetail.admin.agreementCreationCredits`, default 10. */
function getAgreementCreationCreditAmount(adminRaw) {
  let admin = adminRaw;
  if (adminRaw != null && typeof adminRaw !== 'object') admin = parseJson(adminRaw);
  if (Array.isArray(admin) && admin.length) admin = admin[0];
  if (!admin || typeof admin !== 'object') return 10;
  const n = Number(admin.agreementCreationCredits);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 10;
}

async function retryPendingAgreementDraftForClient(clientId, agreementId) {
  if (!clientId || !agreementId) return { ok: false, reason: 'MISSING_FIELDS' };
  const [rows] = await pool.query('SELECT id, client_id FROM agreement WHERE id = ? LIMIT 1', [agreementId]);
  if (!rows.length) return { ok: false, reason: 'agreement_not_found' };
  if (rows[0].client_id !== clientId) return { ok: false, reason: 'CLIENT_INVALID' };
  return tryPrepareDraftForAgreement(agreementId);
}

/**
 * Insert agreement (tenancy agreement: tenant_operator or owner_tenant).
 * Must pass agreementtemplate_id; default status='pending' (no url). If url provided (manual upload), status='completed', columns_locked=1 (no hash).
 * For extend agreement: pass extendBegin, extendEnd (datepickeragreement1/2), remark.
 * Template flow (no manual url): requires confirmCreditDeduction; deducts credits in same transaction as INSERT (see docs/db/agreement-flow-create-to-final.md).
 */
async function insertAgreement(clientId, {
  tenancyId, propertyId, ownerName, mode, type, url, templateId, status, createdBy,
  extendBegin, extendEnd, remark,
  confirmCreditDeduction = false,
  staffDetailId = null
}) {
  const id = randomUUID();
  const isManualUpload = url != null && String(url).trim() !== '';
  const hasTemplate = templateId != null && String(templateId).trim() !== '';
  const templateFlowChargesCredit = !isManualUpload && hasTemplate;

  if (templateFlowChargesCredit && confirmCreditDeduction !== true) {
    return { ok: false, reason: 'CREDIT_CONFIRM_REQUIRED' };
  }

  let creditAmount = 0;
  if (templateFlowChargesCredit) {
    try {
      const [cRows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
      creditAmount = getAgreementCreationCreditAmount(cRows[0]?.admin);
    } catch (e) {
      console.error('[tenancysetting] insertAgreement credit config query failed:', e);
      return {
        ok: false,
        reason: 'CREDIT_CONFIG_QUERY_FAILED',
        message: String(e?.message || e)
      };
    }
  }

  let finalStatus = status != null ? status : (isManualUpload ? 'completed' : 'pending');
  finalStatus = normalizeAgreementStatusForStorage(finalStatus);
  const columnsLocked = isManualUpload ? 1 : 0;
  const finalUrl = isManualUpload ? url.trim() : null;
  let extBegin = toDateOnly(extendBegin);
  let extEnd = toDateOnly(extendEnd);
  const remarkVal = remark != null && String(remark).trim() !== '' ? String(remark).trim() : null;

  /* Template PDF uses tenancy begin/end when datepickers omitted; persist same range so list/badge can match. */
  if (tenancyId && (!extBegin || !extEnd)) {
    try {
      const [tRows] = await pool.query(
        'SELECT begin, `end` FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
        [tenancyId, clientId]
      );
      const row = tRows[0];
      if (row) {
        if (!extBegin) extBegin = toDateOnly(row.begin);
        if (!extEnd) extEnd = toDateOnly(row.end);
      }
    } catch (e) {
      console.warn('[tenancysetting] insertAgreement tenancy date fallback:', e?.message || e);
    }
  }

  const conn = await pool.getConnection();
  let committed = false;
  try {
    await conn.beginTransaction();
    if (templateFlowChargesCredit && creditAmount > 0) {
      await deductClientCreditSpending(
        clientId,
        creditAmount,
        'Tenancy agreement creation',
        staffDetailId != null ? staffDetailId : null,
        { tenancyId: tenancyId || null, templateId: String(templateId).trim(), mode: mode || null, agreementId: id },
        conn
      );
    }
    await conn.query(
      `INSERT INTO agreement (id, client_id, tenancy_id, property_id, mode, agreementtemplate_id, url, status, columns_locked, extend_begin_date, extend_end_date, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [id, clientId, tenancyId, propertyId || null, mode, templateId || null, finalUrl, finalStatus, columnsLocked, extBegin, extEnd, remarkVal]
    );
    await conn.commit();
    committed = true;
  } catch (e) {
    await conn.rollback();
    const msg = String(e?.message || e);
    if (msg.includes('CLIENT_INVALID')) {
      return { ok: false, reason: 'CLIENT_INVALID' };
    }
    if (msg.includes('INSUFFICIENT_CREDIT')) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_CREDIT',
        message: 'Not enough credits. Top up on the Credit page before creating an agreement from a template.'
      };
    }
    console.error('[tenancysetting] insertAgreement failed:', e);
    return { ok: false, reason: 'INSERT_FAILED', message: msg };
  } finally {
    conn.release();
  }
  if (committed) {
    try {
      const { clearBillingCacheByClientId } = require('../billing/billing.service');
      clearBillingCacheByClientId(clientId);
    } catch (_) {
      /* ignore */
    }
  }

  const out = { _id: id, id, creditDeducted: templateFlowChargesCredit && creditAmount > 0 ? creditAmount : 0 };
  if (!isManualUpload && templateId) {
    try {
      const prep = await tryPrepareDraftForAgreement(id);
      if (prep?.ok && prep?.pdfUrl) {
        return { ...out, pdfUrl: prep.pdfUrl, status: 'ready_for_signature' };
      }
    } catch (e) {
      console.warn('[tenancysetting] insertAgreement try-prepare-draft failed:', id, e?.message || e);
    }
  }
  return out;
}

module.exports = {
  getTenancyList,
  getTenancyFilters,
  getRoomsForChange,
  previewChangeRoomProrate,
  previewChangeRoomTenancy,
  getExtendOptions,
  previewExtendTenancy,
  extendTenancy,
  changeRoom,
  terminateTenancy,
  getTerminateContext,
  cancelBooking,
  getAgreementTemplates,
  insertAgreement,
  updateTenancy,
  saveCheckinHandover,
  saveCheckoutHandover,
  retryPendingAgreementDraftForClient
};
