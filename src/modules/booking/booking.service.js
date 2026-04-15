/**
 * Booking – create tenancy from Wix Booking page.
 * Uses MySQL: operatordetail (admin), staffdetail, tenantdetail, tenant_client, propertydetail,
 * roomdetail, tenancy, rentalcollection, account (type_id), parkinglot.
 * All functions that need auth use email and resolve via getAccessContextByEmail.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { upsertCommissionReleaseForTenancy } = require('../commission-release/commission-release.service');
const { getAccessContextByEmail } = require('../access/access.service');
const { createInvoicesForRentalRecords } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const {
  getTodayMalaysiaDate,
  getTodayPlusDaysMalaysia,
  utcDatetimeFromDbToMalaysiaDateOnly,
  tenancyBeginEndToMysql
} = require('../../utils/dateMalaysia');

/** Same window as tenancy-active.service.js AVAILABLE_SOON_DAYS (occupied → soon label). */
const BOOKING_ROOM_AVAILABLE_SOON_DAYS = 60;

/** roomdetail.availablefrom: DATE/DATETIME → Malaysia YYYY-MM-DD for comparisons */
function roomAvailableFromToMalaysiaYmd(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const s = raw.trim().substring(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return utcDatetimeFromDbToMalaysiaDateOnly(raw);
}

/** Canonical account template ids — migrations 0154 + 0155 */
const BUKKUID_WIX = {
  FORFEIT_DEPOSIT: '2020b22b-028e-4216-906c-c816dcb33a85',
  MAINTENANCE_FEES: '94b4e060-3999-4c76-8189-f969615c0a7d',
  TOPUP_AIRCOND: 'a1b2c3d4-1001-4000-8000-000000000101',
  OWNER_COMMISSION: '86da59c0-992c-4e40-8efd-9d6d793eaf6a',
  TENANT_COMMISSION: 'e1b2c3d4-2002-4000-8000-000000000302',
  RENTAL_INCOME: 'ae94f899-7f34-4aba-b6ee-39b97496e2a3',
  REFERRAL_FEES: 'e1b2c3d4-2006-4000-8000-000000000306',
  PARKING_FEES: 'e1b2c3d4-2004-4000-8000-000000000304',
  MANAGEMENT_FEES: 'a1b2c3d4-0002-4000-8000-000000000002',
  DEPOSIT: '18ba3daf-7208-46fc-8e97-43f34e898401',
  AGREEMENT_FEES: 'e1b2c3d4-2003-4000-8000-000000000303',
  OWNER_PAYOUT: 'a1b2c3d4-0003-4000-8000-000000000003',
  OTHER: '94b4e060-3999-4c76-8189-f969615c0a7d',
  PROCESSING_FEES: 'e1b2c3d4-2007-4000-8000-000000000307'
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
  const [rows] = await pool.query('SELECT id FROM account WHERE id = ? LIMIT 1', [wixId]);
  return rows[0] ? rows[0].id : null;
}

async function requireCtx(email, permissionKey = 'booking') {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx || !ctx.ok) throw new Error(ctx?.reason || 'ACCESS_DENIED');
  const perms = ctx.staff?.permission || {};
  if (!perms[permissionKey] && !perms.admin) throw new Error('NO_PERMISSION');
  if (!ctx.client?.id) throw new Error('NO_CLIENT_ID');
  return ctx;
}

/**
 * Get client admin rules (operatordetail.admin JSON).
 */
async function getAdminRules(email) {
  const ctx = await requireCtx(email);
  const [rows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [ctx.client.id]);
  const admin = rows[0] ? parseJson(rows[0].admin) : null;
  return { ok: true, admin };
}

/**
 * Get current staff (from access context).
 */
async function getStaff(email) {
  const ctx = await requireCtx(email);
  const clientId = ctx.client.id;
  let rows = [];
  try {
    const [r] = await pool.query(
      `SELECT id, name, email, active
       FROM staffdetail
       WHERE client_id = ?
       ORDER BY active DESC, name ASC, email ASC
       LIMIT 1000`,
      [clientId]
    );
    rows = r;
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    const isMissingActiveColumn =
      (e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054 || /Unknown column/i.test(msg)) &&
      /active/i.test(msg);
    if (isMissingActiveColumn) {
      const [r] = await pool.query(
        `SELECT id, name, email
         FROM staffdetail
         WHERE client_id = ?
         ORDER BY name ASC, email ASC
         LIMIT 1000`,
        [clientId]
      );
      rows = r;
    } else {
      throw e;
    }
  }
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name || '',
    email: r.email || '',
    active: r.active == null ? true : Number(r.active || 0) === 1
  }));
  return { ok: true, items, currentStaffId: ctx.staffDetailId || ctx.staff?.id || null };
}

/**
 * Available rooms: client's properties, rooms with active=1 (client) and available=1 or availablesoon=1 (system).
 * available is system-only (set by booking/tenancy); client only controls active in Room Setting.
 */
async function getAvailableRooms(email, keyword = '') {
  const ctx = await requireCtx(email);
  const clientId = ctx.client.id;

  const [propertyRows] = await pool.query(
    'SELECT id FROM propertydetail WHERE client_id = ? LIMIT 1000',
    [clientId]
  );
  const propertyIds = propertyRows.map((p) => p.id);
  if (!propertyIds.length) {
    return { ok: true, items: [], message: 'No property' };
  }

  const placeholders = propertyIds.map(() => '?').join(',');
  let sql = `SELECT id, title_fld, price, property_id, available, availablesoon, availablefrom FROM roomdetail WHERE client_id = ? AND property_id IN (${placeholders}) AND (active = 1) AND (available = 1 OR availablesoon = 1)`;
  const params = [clientId, ...propertyIds];

  if (keyword && String(keyword).trim()) {
    sql += ' AND (title_fld LIKE ? OR roomname LIKE ?)';
    const k = `%${String(keyword).trim()}%`;
    params.push(k, k);
  }
  sql += ' ORDER BY title_fld ASC LIMIT 500';

  const [roomRows] = await pool.query(sql, params);
  const todayMy = getTodayMalaysiaDate();
  const todayPlusSoon = getTodayPlusDaysMalaysia(BOOKING_ROOM_AVAILABLE_SOON_DAYS);

  /** room_id → lease end (MY YMD) for tenancies covering today; same rules as updateRoomAvailableFromTenancy */
  const occupancyEndByRoom = new Map();
  const roomIds = roomRows.map((row) => row.id).filter(Boolean);
  if (roomIds.length) {
    const ph = roomIds.map(() => '?').join(',');
    const [tenRows] = await pool.query(
      `SELECT t.room_id, t.\`end\` FROM tenancy t
       WHERE t.client_id = ? AND t.room_id IN (${ph})
         AND (t.active = 1 OR t.active IS NULL)
         AND DATE(t.begin) <= ? AND DATE(t.\`end\`) >= ?
       ORDER BY t.room_id, t.\`end\` DESC`,
      [clientId, ...roomIds, todayMy, todayMy]
    );
    const seenRoom = new Set();
    for (const row of tenRows || []) {
      if (!row.room_id || seenRoom.has(row.room_id)) continue;
      seenRoom.add(row.room_id);
      const endYmd = roomAvailableFromToMalaysiaYmd(row.end);
      if (endYmd) occupancyEndByRoom.set(row.room_id, endYmd);
    }
  }

  const items = roomRows.map((r) => {
    let available = Number(r.available) === 1;
    let availablesoon = Number(r.availablesoon) === 1;
    let availableFrom = roomAvailableFromToMalaysiaYmd(r.availablefrom);

    const occEnd = occupancyEndByRoom.get(r.id);
    if (occEnd) {
      const withinSoon = occEnd <= todayPlusSoon;
      available = false;
      availablesoon = withinSoon;
      availableFrom = withinSoon ? occEnd : null;
    }

    // Stale flags: "available soon" date on or before today (MY) → vacancy already started; list as available now.
    if (!available && availablesoon && availableFrom && availableFrom <= todayMy) {
      available = true;
      availablesoon = false;
      availableFrom = null;
    }

    const title = r.title_fld || '';
    return {
      _id: r.id,
      title_fld: title,
      value: r.id,
      label: title || r.id,
      available,
      availablesoon,
      availableFrom
    };
  });
  return { ok: true, items };
}

/**
 * Search tenants by email/phone contains keyword.
 */
async function searchTenants(email, keyword) {
  await requireCtx(email);
  if (!keyword || String(keyword).trim().length < 2) {
    return { ok: true, items: [] };
  }
  const k = `%${String(keyword).trim().toLowerCase()}%`;
  const [rows] = await pool.query(
    'SELECT id, fullname, email, phone FROM tenantdetail WHERE LOWER(COALESCE(email,"")) LIKE ? OR LOWER(COALESCE(phone,"")) LIKE ? ORDER BY fullname ASC LIMIT 100',
    [k, k]
  );
  const items = rows.map((t) => ({
    _id: t.id,
    fullname: t.fullname || '',
    email: t.email || '',
    phone: t.phone || '',
    label: `${t.fullname || ''} (${t.email || t.phone || ''})`.trim(),
    value: t.id
  }));
  return { ok: true, items };
}

/**
 * Get single tenant by id.
 */
async function getTenant(email, tenantId) {
  const ctx = await requireCtx(email);
  const [rows] = await pool.query(
    'SELECT id, fullname, email, phone FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  if (!rows.length) throw new Error('TENANT_NOT_FOUND');
  const t = rows[0];
  return {
    ok: true,
    tenant: { _id: t.id, fullname: t.fullname || '', email: t.email || '', phone: t.phone || '' }
  };
}

/**
 * Check if tenant is approved for client (exists in tenant_client).
 */
async function isTenantApprovedForClient(tenantId, clientId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM tenant_client WHERE tenant_id = ? AND client_id = ? LIMIT 1',
    [tenantId, clientId]
  );
  return rows.length > 0;
}

/**
 * Ensure tenant exists and approval state; add pending request if needed. Returns { tenant, alreadyApproved }.
 */
async function ensureTenantForBooking(email, { tenantId, email: tenantEmail }) {
  const ctx = await requireCtx(email);
  const clientId = ctx.client.id;
  let tenant;
  let alreadyApproved = false;

  if (tenantId) {
    const [rows] = await pool.query('SELECT id, fullname, email, phone, approval_request_json FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
    if (!rows.length) throw new Error('TENANT_NOT_FOUND');
    tenant = rows[0];
    alreadyApproved = await isTenantApprovedForClient(tenant.id, clientId);
    if (!alreadyApproved) {
      const arr = parseJson(tenant.approval_request_json) || [];
      const hasPending = arr.some((r) => r.clientId === clientId && r.status === 'pending');
      if (!hasPending) {
        arr.push({ clientId, status: 'pending', createdAt: new Date().toISOString() });
        await pool.query('UPDATE tenantdetail SET approval_request_json = ?, updated_at = NOW() WHERE id = ?', [
          JSON.stringify(arr),
          tenant.id
        ]);
      }
    }
    return { ok: true, tenant: { _id: tenant.id, fullname: tenant.fullname, email: tenant.email, phone: tenant.phone }, alreadyApproved };
  }

  const emailNorm = (tenantEmail || '').trim().toLowerCase();
  if (!emailNorm) throw new Error('TENANT_EMAIL_REQUIRED');

  const [existing] = await pool.query('SELECT id, fullname, email, phone, approval_request_json FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1', [emailNorm]);
  if (existing.length) {
    tenant = existing[0];
    alreadyApproved = await isTenantApprovedForClient(tenant.id, clientId);
    if (!alreadyApproved) {
      const arr = parseJson(tenant.approval_request_json) || [];
      const hasPending = arr.some((r) => r.clientId === clientId && r.status === 'pending');
      if (!hasPending) {
        arr.push({ clientId, status: 'pending', createdAt: new Date().toISOString() });
        await pool.query('UPDATE tenantdetail SET approval_request_json = ?, updated_at = NOW() WHERE id = ?', [
          JSON.stringify(arr),
          tenant.id
        ]);
      }
    }
    return { ok: true, tenant: { _id: tenant.id, fullname: tenant.fullname, email: tenant.email, phone: tenant.phone }, alreadyApproved };
  }

  const id = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const approvalRequest = JSON.stringify([{ clientId, status: 'pending', createdAt: new Date().toISOString() }]);
  await pool.query(
    'INSERT INTO tenantdetail (id, email, fullname, phone, approval_request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, emailNorm, '', '', approvalRequest, now, now]
  );
  return { ok: true, tenant: { _id: id, fullname: '', email: emailNorm, phone: '' }, alreadyApproved: false };
}

/**
 * Get room by id (roomdetail.price).
 */
async function getRoom(email, roomId) {
  const ctx = await requireCtx(email);
  const [rows] = await pool.query(
    'SELECT id, title_fld, price, property_id FROM roomdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [roomId, ctx.client.id]
  );
  if (!rows.length) throw new Error('ROOM_NOT_FOUND');
  const r = rows[0];
  return { ok: true, room: { _id: r.id, title_fld: r.title_fld, price: r.price, property_id: r.property_id } };
}

/**
 * Parking lots by property.
 */
/**
 * After operator enters tenant email: profile + portal_account_review + tenancy flags for this client.
 * Used by booking UI to tag New / Returning (avg score) / Former.
 */
async function lookupTenantForBooking(email, tenantEmailRaw) {
  const ctx = await requireCtx(email);
  const clientId = ctx.client.id;
  const emailNorm = String(tenantEmailRaw || '')
    .trim()
    .toLowerCase();
  if (!emailNorm || !emailNorm.includes('@')) {
    return { ok: true, hasValidEmail: false };
  }

  const [tenantRows] = await pool.query(
    'SELECT id, fullname, email, phone FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [emailNorm]
  );

  if (!tenantRows.length) {
    return {
      ok: true,
      hasValidEmail: true,
      hasRecord: false,
      tenantId: null,
      fullname: null,
      approvedForClient: false,
      hasActiveTenancy: false,
      hasPastTenancy: false,
      reviewCount: 0,
      averageOverallScore: null,
      latestReview: null
    };
  }

  const t = tenantRows[0];
  const tenantId = t.id;

  const [tc] = await pool.query(
    'SELECT 1 FROM tenant_client WHERE tenant_id = ? AND client_id = ? LIMIT 1',
    [tenantId, clientId]
  );
  const approvedForClient = tc.length > 0;

  const [activeRows] = await pool.query(
    `SELECT COUNT(*) AS c FROM tenancy
     WHERE tenant_id = ? AND client_id = ?
       AND DATE(\`begin\`) <= DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR) AND DATE(\`end\`) >= DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)
       AND (active = 1 OR active IS NULL)`,
    [tenantId, clientId]
  );
  const hasActiveTenancy = Number(activeRows[0]?.c || 0) > 0;

  const [pastRows] = await pool.query(
    `SELECT COUNT(*) AS c FROM tenancy
     WHERE tenant_id = ? AND client_id = ?
       AND DATE(\`end\`) < DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)`,
    [tenantId, clientId]
  );
  const hasPastTenancy = Number(pastRows[0]?.c || 0) > 0;

  const [revAgg] = await pool.query(
    `SELECT COUNT(*) AS cnt, AVG(overall_score) AS avg_overall
     FROM portal_account_review WHERE subject_kind = 'tenant' AND tenant_id = ? AND client_id = ?`,
    [tenantId, clientId]
  );
  const reviewCount = Number(revAgg[0]?.cnt || 0);
  let averageOverallScore = null;
  if (revAgg[0]?.avg_overall != null && reviewCount > 0) {
    averageOverallScore = Number(Number(revAgg[0].avg_overall).toFixed(2));
  }

  let latestReview = null;
  if (reviewCount > 0) {
    const [lr] = await pool.query(
      `SELECT overall_score, payment_score_final, unit_care_score, communication_score, created_at
       FROM portal_account_review WHERE subject_kind = 'tenant' AND tenant_id = ? AND client_id = ? ORDER BY created_at DESC LIMIT 1`,
      [tenantId, clientId]
    );
    if (lr[0]) {
      latestReview = {
        overallScore: Number(lr[0].overall_score || 0),
        paymentScoreFinal: Number(lr[0].payment_score_final || 0),
        unitCareScore: Number(lr[0].unit_care_score || 0),
        communicationScore: Number(lr[0].communication_score || 0),
        createdAt: lr[0].created_at
      };
    }
  }

  return {
    ok: true,
    hasValidEmail: true,
    hasRecord: true,
    tenantId,
    fullname: t.fullname || '',
    email: t.email || '',
    phone: t.phone || '',
    approvedForClient,
    hasActiveTenancy,
    hasPastTenancy,
    reviewCount,
    averageOverallScore,
    latestReview
  };
}

async function getParkingLotsByProperty(email, propertyId) {
  const ctx = await requireCtx(email);
  const [rows] = await pool.query(
    'SELECT id, parkinglot FROM parkinglot WHERE client_id = ? AND property_id = ? AND (available = 1 OR available IS NULL) ORDER BY parkinglot ASC',
    [ctx.client.id, propertyId]
  );
  const items = rows.map((p) => ({ _id: p.id, parkinglot: p.parkinglot || '', value: p.id, label: p.parkinglot || p.id }));
  return { ok: true, items };
}

/**
 * Create booking: tenancy insert, optional generate rental, lock room, lock parking.
 */
async function createBooking(email, payload) {
  const ctx = await requireCtx(email);
  const clientId = ctx.client.id;
  const staffId = ctx.staff?.id;
  if (!staffId) throw new Error('NO_STAFF');
  const {
    tenantIdSelected,
    emailInput,
    tenantBookingKind,
    roomId,
    beginDate,
    endDate,
    rental,
    deposit,
    agreementFees,
    parkingFees,
    selectedParkingLots = [],
    addOns = [],
    billingBlueprint = [],
    commissionSnapshot = [],
    adminRules,
    submitbyStaffId
  } = payload;
  /** tenancy.submitby_id FK → staffdetail.id only. Never use client_user.id (same email may not exist in staffdetail). */
  let submitbyIdForFk = null;
  const preferredSubmitbyId = String(submitbyStaffId || '').trim();
  if (preferredSubmitbyId) {
    const [selected] = await pool.query(
      'SELECT id FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1',
      [preferredSubmitbyId, clientId]
    );
    if (!selected.length) throw new Error('INVALID_SUBMITBY_STAFF_ID');
    submitbyIdForFk = selected[0].id;
  }
  const [sdByEmail] = await pool.query(
    'SELECT id FROM staffdetail WHERE client_id = ? AND LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1',
    [clientId, email]
  );
  if (!submitbyIdForFk && sdByEmail.length) {
    submitbyIdForFk = sdByEmail[0].id;
  } else if (!submitbyIdForFk && ctx.staffDetailId) {
    const [sd] = await pool.query('SELECT id FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1', [
      ctx.staffDetailId,
      clientId
    ]);
    if (sd.length) submitbyIdForFk = sd[0].id;
  }

  if (!roomId || !beginDate || !endDate) throw new Error('ROOM_AND_DATES_REQUIRED');

  const { beginMysql, endMysql } = tenancyBeginEndToMysql(beginDate, endDate);
  if (!beginMysql || !endMysql) throw new Error('INVALID_BEGIN_OR_END_DATE');

  const tenantRes = await ensureTenantForBooking(email, {
    tenantId: tenantIdSelected || null,
    email: emailInput || null
  });
  const tenantObj = tenantRes.tenant;
  const alreadyApproved = tenantRes.alreadyApproved;

  const [roomRows] = await pool.query('SELECT id, title_fld, property_id FROM roomdetail WHERE id = ? AND client_id = ? LIMIT 1', [roomId, clientId]);
  if (!roomRows.length) throw new Error('ROOM_NOT_FOUND');
  const room = roomRows[0];
  const title = `${tenantObj.fullname || tenantObj.email} - ${room.title_fld}`;
  const tenancyStatus = alreadyApproved ? 'active' : 'pending_approval';
  const now = new Date();

  const tenancyId = randomUUID();
  const tenancyNow = now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  const tenancyStatusJson = JSON.stringify([
    { key: 'contact_approval', label: 'Pending contact approval', status: alreadyApproved ? 'completed' : 'pending', updatedAt: now }
  ]);
  const remark0 = { type: 'booking_created', by: staffId, at: now, note: 'Booking created by admin' };
  if (tenantBookingKind && String(tenantBookingKind).trim()) {
    remark0.tenantBookingKind = String(tenantBookingKind).trim();
  }
  const remarkJson = JSON.stringify([remark0]);

  await pool.query(
    `INSERT INTO tenancy (id, tenant_id, room_id, client_id, submitby_id, begin, \`end\`, rental, deposit, title, status,
     parkinglot_json, addons_json, billing_json, commission_snapshot_json, billing_generated, tenancy_status_json, remark_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      tenancyId,
      tenantObj._id,
      roomId,
      clientId,
      submitbyIdForFk,
      beginMysql,
      endMysql,
      rental || 0,
      deposit || 0,
      title,
      Array.isArray(selectedParkingLots) ? JSON.stringify(selectedParkingLots) : null,
      Array.isArray(addOns) ? JSON.stringify(addOns) : null,
      Array.isArray(billingBlueprint) ? JSON.stringify(billingBlueprint) : null,
      Array.isArray(commissionSnapshot) ? JSON.stringify(commissionSnapshot) : null,
      tenancyStatusJson,
      remarkJson,
      tenancyNow,
      tenancyNow
    ]
  );

  try {
    await upsertCommissionReleaseForTenancy(clientId, tenancyId);
  } catch (e) {
    console.warn('[booking] upsertCommissionReleaseForTenancy', e?.message || e);
  }

  if (alreadyApproved) {
    await generateFromTenancy(email, tenancyId);
  }

  await pool.query('UPDATE roomdetail SET available = 0, availablesoon = 0, updated_at = NOW() WHERE id = ?', [roomId]);
  for (const parkingId of selectedParkingLots) {
    const [r] = await pool.query(
      'UPDATE parkinglot SET available = 0, updated_at = NOW() WHERE id = ? AND client_id = ? AND property_id = ? AND (available = 1 OR available IS NULL)',
      [parkingId, clientId, room.property_id]
    );
    if (!r || r.affectedRows === 0) {
      throw new Error('PARKING_NOT_AVAILABLE');
    }
  }

  return { ok: true, tenancyId };
}

/**
 * Generate RentalCollection from tenancy.billing_json; set billing_generated = 1.
 */
async function generateFromTenancy(email, tenancyId) {
  const ctx = await requireCtx(email);
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, billing_json, billing_generated, title FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, ctx.client.id]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const tenancy = tenancyRows[0];
  const billing = parseJson(tenancy.billing_json);
  if (!Array.isArray(billing) || !billing.length) {
    return { ok: true, inserted: 0 };
  }

  const [existing] = await pool.query('SELECT id FROM rentalcollection WHERE tenancy_id = ? LIMIT 1', [tenancyId]);
  if (existing.length) return { ok: true, inserted: 0, message: 'ALREADY_GENERATED' };

  const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [tenancy.room_id]);
  const propertyId = roomRows[0] ? roomRows[0].property_id : null;

  const records = [];
  for (const item of billing) {
    const wixId = item.bukkuid || item.type_id;
    const typeId = wixId ? await getAccountIdByWixId(wixId) : null;
    if (!typeId && wixId) continue; // skip if account not found for this wix_id
    const id = randomUUID();
    const dateVal = item.dueDate ? (item.dueDate instanceof Date ? item.dueDate : new Date(item.dueDate)) : null;
    const dateStr = dateVal ? dateVal.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') : null;
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const isOwnerCommission = typeId && (await getAccountIdByWixId(BUKKUID_WIX.OWNER_COMMISSION)) === typeId;
    records.push({
      id,
      tenancy_id: tenancyId,
      tenant_id: tenancy.tenant_id,
      room_id: tenancy.room_id,
      property_id: propertyId,
      client_id: tenancy.client_id,
      type_id: typeId,
      amount: item.amount,
      date: dateStr,
      title: `${item.type} - ${tenancy.title}`,
      ispaid: isOwnerCommission ? 1 : 0,
      created_at: now,
      updated_at: now
    });
  }

  if (records.length) {
    const conn = await pool.getConnection();
    try {
      for (const r of records) {
        await conn.query(
          `INSERT INTO rentalcollection (id, tenancy_id, tenant_id, room_id, property_id, client_id, type_id, amount, date, title, ispaid, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.id, r.tenancy_id, r.tenant_id, r.room_id, r.property_id, r.client_id, r.type_id, r.amount, r.date, r.title, r.ispaid, r.created_at, r.updated_at]
        );
      }
      await conn.query('UPDATE tenancy SET billing_generated = 1, updated_at = NOW() WHERE id = ?', [tenancyId]);
      try {
        await createInvoicesForRentalRecords(tenancy.client_id, records);
      } catch (e) {
        console.warn('createInvoicesForRentalRecords failed:', e?.message || e);
      }
    } finally {
      conn.release();
    }
  }

  try {
    await upsertCommissionReleaseForTenancy(tenancy.client_id, tenancyId);
  } catch (e) {
    console.warn('[booking] upsertCommissionReleaseForTenancy after generateFromTenancy', e?.message || e);
  }

  return { ok: true, inserted: records.length };
}

/**
 * Generate RentalCollection from tenancy.billing_json by tenancyId and tenantId.
 * Used by tenant dashboard after verifying tenancy belongs to tenant. No staff auth.
 */
async function generateFromTenancyByTenancyId(tenancyId, tenantId) {
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, billing_json, billing_generated, title FROM tenancy WHERE id = ? AND tenant_id = ? LIMIT 1',
    [tenancyId, tenantId]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const tenancy = tenancyRows[0];
  const billing = parseJson(tenancy.billing_json);
  if (!Array.isArray(billing) || !billing.length) {
    return { ok: true, inserted: 0 };
  }

  const [existing] = await pool.query('SELECT id FROM rentalcollection WHERE tenancy_id = ? LIMIT 1', [tenancyId]);
  if (existing.length) return { ok: true, inserted: 0, message: 'ALREADY_GENERATED' };

  const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [tenancy.room_id]);
  const propertyId = roomRows[0] ? roomRows[0].property_id : null;

  const records = [];
  for (const item of billing) {
    const wixId = item.bukkuid || item.type_id;
    const typeId = wixId ? await getAccountIdByWixId(wixId) : null;
    if (!typeId && wixId) continue;
    const id = randomUUID();
    const dateVal = item.dueDate ? (item.dueDate instanceof Date ? item.dueDate : new Date(item.dueDate)) : null;
    const dateStr = dateVal ? dateVal.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') : null;
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const isOwnerCommission = typeId && (await getAccountIdByWixId(BUKKUID_WIX.OWNER_COMMISSION)) === typeId;
    records.push({
      id,
      tenancy_id: tenancyId,
      tenant_id: tenancy.tenant_id,
      room_id: tenancy.room_id,
      property_id: propertyId,
      client_id: tenancy.client_id,
      type_id: typeId,
      amount: item.amount,
      date: dateStr,
      title: `${item.type} - ${tenancy.title}`,
      ispaid: isOwnerCommission ? 1 : 0,
      created_at: now,
      updated_at: now
    });
  }

  if (records.length) {
    const conn = await pool.getConnection();
    try {
      for (const r of records) {
        await conn.query(
          `INSERT INTO rentalcollection (id, tenancy_id, tenant_id, room_id, property_id, client_id, type_id, amount, date, title, ispaid, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.id, r.tenancy_id, r.tenant_id, r.room_id, r.property_id, r.client_id, r.type_id, r.amount, r.date, r.title, r.ispaid, r.created_at, r.updated_at]
        );
      }
      await conn.query('UPDATE tenancy SET billing_generated = 1, updated_at = NOW() WHERE id = ?', [tenancyId]);
      try {
        await createInvoicesForRentalRecords(tenancy.client_id, records);
      } catch (e) {
        console.warn('createInvoicesForRentalRecords failed:', e?.message || e);
      }
    } finally {
      conn.release();
    }
  }

  try {
    await upsertCommissionReleaseForTenancy(tenancy.client_id, tenancyId);
  } catch (e) {
    console.warn('[booking] upsertCommissionReleaseForTenancy after generateFromTenancyByTenancyId', e?.message || e);
  }

  return { ok: true, inserted: records.length };
}

module.exports = {
  getAdminRules,
  getStaff,
  getAvailableRooms,
  searchTenants,
  getTenant,
  lookupTenantForBooking,
  getRoom,
  getParkingLotsByProperty,
  createBooking,
  generateFromTenancy,
  generateFromTenancyByTenancyId,
  BUKKUID_WIX,
  getAccountIdByWixId
};
