/**
 * Coliving Operator ↔ Cleanlemons: read cln_property pricing, schedule cln_schedule jobs, tenant price on propertydetail/roomdetail.
 */

const pool = require('../../config/db');
const { getCleanlemonsExportContext } = require('./coliving-cleanlemons-link.service');
const cleanlemonSvc = require('../cleanlemon/cleanlemon.service');

/** Default template `account.id` from migration 0226 (global row may have client_id NULL). */
const TENANT_CLEANING_ACCOUNT_ID = 'e1b2c3d4-2009-4000-8000-000000000309';

/**
 * Coliving `rentalcollection.type_id` → `account.id` for tenant cleaning charges.
 * Each operator (`clientdetail.id` = Coliving client_id on tenancy) should have an income product
 * row titled like "Cleaning Services"; otherwise fall back to {@link TENANT_CLEANING_ACCOUNT_ID}.
 *
 * Operator schedule jobs use {@link scheduleColivingCleaningJob} only — no rentalcollection / invoice.
 *
 * `cln_clientdetail.account` (Cleanlemons) is contact/provider mappings — not used here unless a future
 * convention stores an explicit Coliving `account.id` for tenant cleaning (confirm with maintainers).
 */
async function resolveTenantCleaningAccountTypeId(colivingClientId) {
  const cid = String(colivingClientId || '').trim();
  if (!cid) return TENANT_CLEANING_ACCOUNT_ID;
  try {
    const [rows] = await pool.query(
      `SELECT id FROM account
       WHERE client_id = ?
         AND LOWER(TRIM(COALESCE(title, ''))) IN ('cleaning services', 'cleaning service')
         AND is_product = 1
         AND (type = 'income' OR type IS NULL OR TRIM(COALESCE(type, '')) = '')
       ORDER BY updated_at DESC
       LIMIT 1`,
      [cid]
    );
    if (rows?.[0]?.id) return String(rows[0].id).trim();
  } catch (e) {
    console.warn('[coliving-cleanlemons] resolveTenantCleaningAccountTypeId', e?.message || e);
  }
  return TENANT_CLEANING_ACCOUNT_ID;
}

function malaysiaDateTimeToMysqlLocal(dateStr, timeStr) {
  const d = String(dateStr || '').slice(0, 10);
  const t = String(timeStr || '09:00').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const tm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!tm) return null;
  const hh = Math.min(23, Math.max(0, parseInt(tm[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(tm[2], 10)));
  return `${d} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000`;
}

async function assertPropertyOwned(clientId, propertyId) {
  const pid = String(propertyId || '').trim();
  const cid = String(clientId || '').trim();
  if (!pid || !cid) return false;
  const [[row]] = await pool.query(
    'SELECT 1 AS ok FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1',
    [pid, cid]
  );
  return !!row;
}

async function assertRoomOwned(clientId, roomId, propertyId) {
  const rid = String(roomId || '').trim();
  const cid = String(clientId || '').trim();
  const pid = String(propertyId || '').trim();
  if (!rid || !cid) return false;
  const [[row]] = await pool.query(
    'SELECT property_id FROM roomdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [rid, cid]
  );
  if (!row) return false;
  if (pid && String(row.property_id) !== pid) return false;
  return true;
}

/**
 * Resolve cln_property row for Coliving property (+ optional room).
 */
async function getClnPropertyRowForColiving(propertydetailId, roomdetailId) {
  const pd = String(propertydetailId || '').trim();
  const rd = roomdetailId != null && String(roomdetailId).trim() !== '' ? String(roomdetailId).trim() : null;
  if (!pd) return null;
  const [rows] = await pool.query(
    `SELECT id, generalcleaning, warmcleaning, operator_id
       FROM cln_property
      WHERE coliving_propertydetail_id = ?
        AND (coliving_roomdetail_id <=> ?)
      LIMIT 1`,
    [pd, rd]
  );
  return rows[0] || null;
}

async function getCleanlemonsCleaningPricingForOperator(clientId, propertyId, roomId) {
  const ctx = await getCleanlemonsExportContext(clientId);
  if (!ctx) {
    return { ok: false, reason: 'CLEANLEMONS_NOT_LINKED', cleanlemonsLinked: false };
  }
  const ok = await assertPropertyOwned(clientId, propertyId);
  if (!ok) return { ok: false, reason: 'PROPERTY_NOT_FOUND' };
  if (roomId) {
    const rok = await assertRoomOwned(clientId, roomId, propertyId);
    if (!rok) return { ok: false, reason: 'ROOM_NOT_FOUND' };
  }
  const row = await getClnPropertyRowForColiving(propertyId, roomId || null);
  if (!row) {
    return {
      ok: true,
      cleanlemonsLinked: true,
      clnPropertyId: null,
      refGeneralCleaning: null,
      refWarmcleaning: null,
      showRefGeneralCleaning: false,
      showRefWarmcleaning: false
    };
  }
  const g = row.generalcleaning;
  const w = row.warmcleaning;
  const showG = g != null && Number(g) !== 0;
  const showW = w != null && Number(w) !== 0;
  return {
    ok: true,
    cleanlemonsLinked: true,
    clnPropertyId: row.id,
    cleanlemonsOperatorId: row.operator_id || null,
    refGeneralCleaning: showG ? Number(g) : null,
    refWarmcleaning: showW ? Number(w) : null,
    showRefGeneralCleaning: showG,
    showRefWarmcleaning: showW
  };
}

/**
 * Operator-initiated cleaning: creates Cleanlemons `cln_schedule` only.
 * Does not insert Coliving `rentalcollection` or tenant invoices (contrast: tenant portal cleaning order).
 */
async function scheduleColivingCleaningJob(clientId, { propertyId, roomId, date, time, serviceProvider }) {
  const ctx = await getCleanlemonsExportContext(clientId);
  if (!ctx) {
    const e = new Error('CLEANLEMONS_NOT_LINKED');
    e.code = 'CLEANLEMONS_NOT_LINKED';
    throw e;
  }
  if (!(await assertPropertyOwned(clientId, propertyId))) {
    const e = new Error('PROPERTY_NOT_FOUND');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }
  if (roomId && !(await assertRoomOwned(clientId, roomId, propertyId))) {
    const e = new Error('ROOM_NOT_FOUND');
    e.code = 'ROOM_NOT_FOUND';
    throw e;
  }
  const clnRow = await getClnPropertyRowForColiving(propertyId, roomId || null);
  if (!clnRow || !clnRow.id) {
    const e = new Error('CLN_PROPERTY_NOT_SYNCED');
    e.code = 'CLN_PROPERTY_NOT_SYNCED';
    throw e;
  }
  const dt = malaysiaDateTimeToMysqlLocal(date, time);
  if (!dt) {
    const e = new Error('INVALID_DATE_TIME');
    e.code = 'INVALID_DATE_TIME';
    throw e;
  }
  const oid = clnRow.operator_id != null ? String(clnRow.operator_id).trim() : '';
  const id = await cleanlemonSvc.createCleaningScheduleJobUnified({
    propertyId: clnRow.id,
    date: String(date).slice(0, 10),
    time: time || '09:00',
    serviceProvider: serviceProvider || 'general-cleaning',
    remarks: 'coliving-operator',
    operatorId: oid || undefined,
  });
  return { ok: true, id, clnPropertyId: clnRow.id };
}

async function getTenantCleaningPriceForTenancy(tenancyId) {
  const tid = String(tenancyId || '').trim();
  if (!tid) return { price: null, propertyId: null, roomId: null };
  const [[row]] = await pool.query(
    `SELECT t.room_id, r.property_id,
            r.cleanlemons_cleaning_tenant_price_myr AS room_price,
            p.cleanlemons_cleaning_tenant_price_myr AS property_price
       FROM tenancy t
       LEFT JOIN roomdetail r ON r.id = t.room_id
       LEFT JOIN propertydetail p ON p.id = r.property_id
      WHERE t.id = ?
      LIMIT 1`,
    [tid]
  );
  if (!row) return { price: null, propertyId: null, roomId: null };
  const rp = row.room_price != null ? Number(row.room_price) : null;
  const pp = row.property_price != null ? Number(row.property_price) : null;
  const price = rp != null && !Number.isNaN(rp) ? rp : pp != null && !Number.isNaN(pp) ? pp : null;
  return {
    price: price != null && price > 0 ? price : null,
    propertyId: row.property_id || null,
    roomId: row.room_id || null
  };
}

module.exports = {
  TENANT_CLEANING_ACCOUNT_ID,
  resolveTenantCleaningAccountTypeId,
  malaysiaDateTimeToMysqlLocal,
  getClnPropertyRowForColiving,
  getCleanlemonsCleaningPricingForOperator,
  scheduleColivingCleaningJob,
  getTenantCleaningPriceForTenancy,
  assertPropertyOwned,
  assertRoomOwned
};
