/**
 * Tenant Dashboard – for Wix tenant dashboard page (租客仪表盘).
 * Uses MySQL: tenantdetail, tenancy, roomdetail, propertydetail, operatordetail,
 * bankdetail, agreement, agreementtemplate, rentalcollection, meterdetail, lockdetail.
 * All operations resolve tenant by email (tenantdetail.email) and verify tenancy belongs to tenant.
 */

const { randomUUID, createHash } = require('crypto');
const pool = require('../../config/db');
const {
  loadFeedbackThread,
  appendMessage,
  remarkPreviewVisibleToTenant,
  filterMessagesVisibleToTenant,
  isMissingMessagesJsonColumn
} = require('../../utils/feedbackMessages');
const { getOwnerTenantAgreementHtml } = require('../agreement/agreement.service');
const { generateFromTenancyByTenancyId } = require('../booking/booking.service');
const { ACCOUNTING_PLAN_IDS } = require('../access/access.service');
const { signatureValueToPublicUrl } = require('../upload/signature-image-to-oss-url');
const contactSync = require('../contact/contact-sync.service');
const lockWrapper = require('../ttlock/wrappers/lock.wrapper');
const lockdetailLog = require('../smartdoorsetting/lockdetail-log.service');
const syncWrapper = require('../cnyiot/wrappers/sync.wrapper');
const meterWrapper = require('../cnyiot/wrappers/meter.wrapper');
const { getPortalProfile, updatePortalProfile } = require('../portal-auth/portal-auth.service');
const { appendHandoverScheduleLog, normalizeScheduleForLog } = require('../tenancysetting/handover-schedule-log.service');
const {
  getHandoverScheduleWindowFromAdmin,
  validateTenantHandoverScheduleAgainstCompanyWindow
} = require('../tenancysetting/handover-schedule-window');
const {
  getBukkuSubdomainForClientInvoiceLink,
  buildRentalInvoiceDisplayUrl,
  buildRentalReceiptDisplayUrl,
  parseAccountingReceiptSnapshotJson,
  formatAccountingInvoiceReceiptLabel
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const { getTopupAircondAccountId } = require('../tenantinvoice/tenantinvoice.service');
const { getTodayMalaysiaDate, utcDatetimeFromDbToMalaysiaDateOnly } = require('../../utils/dateMalaysia');

if (process.env.NODE_ENV !== 'test') {
  console.log('[tenantdashboard] service loaded from', __filename);
}

const RENTAL_EXCLUDED_TYPE_IDS = [
  '1c7e41b6-9d57-4c03-8122-a76baad3b592',
  '86da59c0-992c-4e40-8efd-9d6d793eaf6a'
];

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

function getEmailNorm(email) {
  return email && String(email).trim() ? String(email).trim().toLowerCase() : '';
}

/**
 * Get tenant by email. Returns null if not found.
 */
async function getTenantByEmail(email) {
  const norm = getEmailNorm(email);
  if (!norm) return null;
  const [rows] = await pool.query(
    `SELECT id, fullname, email, phone, address, nric, bankname_id, bankaccount, accountholder,
            nricfront, nricback, approval_request_json
       FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    [norm]
  );
  const r = rows[0];
  if (!r) return null;
  let profile = null;
  let account = null;
  try {
    const [pRows] = await pool.query('SELECT profile FROM tenantdetail WHERE id = ? LIMIT 1', [r.id]);
    if (pRows && pRows[0] && pRows[0].profile != null) profile = parseJson(pRows[0].profile);
  } catch (e) {
    console.error('[tenantdashboard] read tenantdetail.profile failed (run migration 0131_tenantdetail_profile.sql):', e?.message || e);
  }
  try {
    const [aRows] = await pool.query('SELECT account FROM tenantdetail WHERE id = ? LIMIT 1', [r.id]);
    if (aRows && aRows[0] && aRows[0].account != null) account = parseJson(aRows[0].account);
  } catch (_) { /* account column may not exist */ }

  let fullname = r.fullname;
  let phone = r.phone;
  let address = r.address;
  let nric = r.nric;
  let bankName = r.bankname_id;
  let bankAccount = r.bankaccount;
  let accountholder = r.accountholder;
  try {
    const portalRes = await getPortalProfile(norm);
    if (portalRes.ok && portalRes.profile) {
      const p = portalRes.profile;
      if (p.fullname != null) fullname = p.fullname;
      if (p.phone != null) phone = p.phone;
      if (p.address != null) address = p.address;
      if (p.nric != null) nric = p.nric;
      if (p.bankname_id != null) bankName = p.bankname_id;
      if (p.bankaccount != null) bankAccount = p.bankaccount;
      if (p.accountholder != null) accountholder = p.accountholder;
    }
  } catch (_) { /* portal_account profile columns may not exist yet */ }

  return {
    _id: r.id,
    id: r.id,
    fullname,
    email: r.email,
    phone,
    address,
    nric,
    bankName,
    bankAccount,
    accountholder,
    nricFront: r.nricfront,
    nricback: r.nricback,
    approvalRequest: parseJson(r.approval_request_json),
    profile,
    account
  };
}

/**
 * Verify tenancy belongs to tenant (tenant_id = tenant.id).
 */
async function assertTenancyBelongsToTenant(tenantId, tenancyId) {
  const [rows] = await pool.query(
    'SELECT id, tenant_id FROM tenancy WHERE id = ? AND tenant_id = ? LIMIT 1',
    [tenancyId, tenantId]
  );
  return rows.length > 0;
}

function normalizeMysqlDateToYmdLifecycle(val) {
  if (val == null || val === '') return null;
  const my = utcDatetimeFromDbToMalaysiaDateOnly(val);
  if (my && /^\d{4}-\d{2}-\d{2}$/.test(my)) return my;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Portal lifecycle for a tenancy row: active tenants may pay, unlock, submit feedback, etc.
 * Terminated = DB status 0; expired = end date before Malaysia calendar today (status still active).
 */
function computePortalTenancyLifecycle(dbStatus, endVal) {
  const statusNum =
    dbStatus === null || dbStatus === undefined || dbStatus === '' ? null : Number(dbStatus);
  if (statusNum === 0 || dbStatus === false) return 'terminated';
  const endYmd = normalizeMysqlDateToYmdLifecycle(endVal);
  const todayYmd = getTodayMalaysiaDate();
  if (endYmd && todayYmd && endYmd < todayYmd) return 'expired';
  return 'active';
}

/** False when tenancy is expired or terminated — tenant may view history only. */
async function assertTenancyPortalWritable(tenantId, tenancyId) {
  if (!tenantId || !tenancyId) return false;
  const [rows] = await pool.query(
    'SELECT status, `end` FROM tenancy WHERE id = ? AND tenant_id = ? LIMIT 1',
    [tenancyId, tenantId]
  );
  if (!rows.length) return false;
  return computePortalTenancyLifecycle(rows[0].status, rows[0].end) === 'active';
}

/**
 * Get tenancy IDs that currently have overdue unpaid invoices (due date on or before Malaysia "today").
 * Must match tenant payment page: unpaid + due <= calendar today (Asia/Kuala_Lumpur calendar via UTC+8 date).
 * Scope matches getTenanciesForTenant() so old/irrelevant tenancy rows are ignored.
 */
async function getOverdueTenancyIds(tenantId) {
  if (!tenantId) return [];
  const tenancies = await getTenanciesForTenant(tenantId);
  const tenancyIds = (tenancies || [])
    .filter((t) => t && t.portalLifecycle === 'active')
    .map((t) => t.id)
    .filter(Boolean);
  if (!tenancyIds.length) return [];

  const excluded = RENTAL_EXCLUDED_TYPE_IDS.map(() => '?').join(',');
  const placeholders = tenancyIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT DISTINCT r.tenancy_id FROM rentalcollection r
     WHERE r.tenancy_id IN (${placeholders})
       AND (r.ispaid = 0 OR r.ispaid IS NULL)
       AND r.date <= DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)
       AND (r.type_id IS NULL OR r.type_id NOT IN (${excluded}))
     LIMIT 200`,
    [...tenancyIds, ...RENTAL_EXCLUDED_TYPE_IDS]
  );
  return (rows || []).map((r) => String(r.tenancy_id)).filter(Boolean);
}

/**
 * Whether tenant has any unpaid rental that is overdue (due date on or before Malaysia today).
 * Used for tenant portal payment gate (layer 4).
 */
async function getHasOverduePayment(tenantId) {
  const ids = await getOverdueTenancyIds(tenantId);
  return ids.length > 0;
}

/**
 * Get tenancies for tenant (including expired / terminated), with property, client, room, and agreements.
 * Only rows where the tenant has approved / linked this operator (tenant_client) are returned.
 * Expired = end date before Malaysia today; terminated = status 0. Those are view-only in the portal.
 */
async function getTenanciesForTenant(tenantId) {
  if (!tenantId) return [];
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT t.id, t.tenant_id, t.room_id, t.client_id, t.begin, t.\`end\`, t.rental, t.status AS tenancy_status, t.agreement, t.parkinglot_json, t.handover_checkin_json, t.handover_checkout_json,
              p.id AS property_id, p.shortname AS property_shortname, p.smartdoor_id AS property_smartdoor_id,
              c.id AS client_id, c.title AS client_title, c.currency AS client_currency,
              r.id AS room_id, r.roomname AS room_roomname, r.title_fld AS room_title_fld, r.meter_id AS room_meter_id, r.smartdoor_id AS room_smartdoor_id,
              td.fullname AS tenant_fullname
         FROM tenancy t
         INNER JOIN tenant_client tc ON tc.tenant_id = t.tenant_id AND tc.client_id = t.client_id
         LEFT JOIN roomdetail r ON r.id = t.room_id
         LEFT JOIN propertydetail p ON p.id = r.property_id
         LEFT JOIN operatordetail c ON c.id = t.client_id
         LEFT JOIN tenantdetail td ON td.id = t.tenant_id
         WHERE t.tenant_id = ?
         ORDER BY t.begin DESC
         LIMIT 1000`,
      [tenantId]
    );
  } catch (e) {
    if (!isUnknownColumnError(e)) throw e;
    [rows] = await pool.query(
      `SELECT t.id, t.tenant_id, t.room_id, t.client_id, t.begin, t.\`end\`, t.rental, t.status AS tenancy_status, t.agreement, t.parkinglot_json,
              p.id AS property_id, p.shortname AS property_shortname, p.smartdoor_id AS property_smartdoor_id,
              c.id AS client_id, c.title AS client_title, c.currency AS client_currency,
              r.id AS room_id, r.roomname AS room_roomname, r.title_fld AS room_title_fld, r.meter_id AS room_meter_id, r.smartdoor_id AS room_smartdoor_id,
              td.fullname AS tenant_fullname
         FROM tenancy t
         INNER JOIN tenant_client tc ON tc.tenant_id = t.tenant_id AND tc.client_id = t.client_id
         LEFT JOIN roomdetail r ON r.id = t.room_id
         LEFT JOIN propertydetail p ON p.id = r.property_id
         LEFT JOIN operatordetail c ON c.id = t.client_id
         LEFT JOIN tenantdetail td ON td.id = t.tenant_id
         WHERE t.tenant_id = ?
         ORDER BY t.begin DESC
         LIMIT 1000`,
      [tenantId]
    );
  }

  const tenancyIds = (rows || []).map((x) => x.id);
  let agreementMap = {};
  let draftAgreementMap = {};
  if (tenancyIds.length) {
    const placeholders = tenancyIds.map(() => '?').join(',');
    let agRows;
    try {
      [agRows] = await pool.query(
        `SELECT id, tenancy_id, agreementtemplate_id, mode, status, ownersign, owner_signed_at, tenantsign, tenant_signed_at,
                pdfurl, url, created_at, updated_at, columns_locked
           FROM agreement
           WHERE tenancy_id IN (${placeholders})
             AND status IN ('ready_for_signature', 'locked', 'completed')
             AND (url IS NOT NULL OR pdfurl IS NOT NULL)
           ORDER BY created_at DESC`,
        tenancyIds
      );
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if ((e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054) && msg.includes('tenant_signed_at')) {
        [agRows] = await pool.query(
          `SELECT id, tenancy_id, agreementtemplate_id, mode, status, ownersign, owner_signed_at, tenantsign,
                  pdfurl, url, created_at, updated_at, columns_locked
             FROM agreement
             WHERE tenancy_id IN (${placeholders})
               AND status IN ('ready_for_signature', 'locked', 'completed')
               AND (url IS NOT NULL OR pdfurl IS NOT NULL)
             ORDER BY created_at DESC`,
          tenancyIds
        );
      } else {
        throw e;
      }
    }
    for (const a of agRows || []) {
      if (!agreementMap[a.tenancy_id]) agreementMap[a.tenancy_id] = [];
      agreementMap[a.tenancy_id].push({
        _id: a.id,
        _createdDate: a.created_at,
        agreementtemplate_id: a.agreementtemplate_id,
        mode: a.mode,
        status: a.status,
        tenantsign: a.tenantsign,
        tenant_signed_at: a.tenant_signed_at != null ? a.tenant_signed_at : null,
        agreement_updated_at: a.updated_at != null ? a.updated_at : null,
        ownersign: a.ownersign,
        operatorsign: a.ownersign,
        url: a.url || a.pdfurl,
        columns_locked: Number(a.columns_locked) === 1
      });
    }
    const [draftRows] = await pool.query(
      `SELECT id, tenancy_id, agreementtemplate_id, mode, status, pdf_generating, created_at
         FROM agreement
         WHERE tenancy_id IN (${placeholders})
           AND status = 'pending'
           AND (url IS NULL OR url = '')
           AND (pdfurl IS NULL OR pdfurl = '')
           AND mode IN ('tenant_operator', 'owner_tenant')
         ORDER BY created_at DESC`,
      tenancyIds
    );
    for (const a of draftRows || []) {
      if (!draftAgreementMap[a.tenancy_id]) draftAgreementMap[a.tenancy_id] = [];
      draftAgreementMap[a.tenancy_id].push({
        _id: a.id,
        _createdDate: a.created_at,
        agreementtemplate_id: a.agreementtemplate_id,
        mode: a.mode,
        status: a.status,
        pdf_generating: Number(a.pdf_generating) === 1
      });
    }
  }

  const clientIds = [...new Set((rows || []).map((r) => r.client_id).filter(Boolean))];
  let contactByClient = {};
  let uenByClient = {};
  let adminByClient = {};
  const parkingNameById = {};
  if (clientIds.length > 0) {
    const ph = clientIds.map(() => '?').join(',');
    const [adminRows] = await pool.query(`SELECT id, admin FROM operatordetail WHERE id IN (${ph})`, clientIds);
    for (const r of adminRows || []) {
      adminByClient[r.id] = r.admin;
    }
    const [profileRows] = await pool.query(
      `SELECT client_id, contact, uen FROM client_profile WHERE client_id IN (${ph})`,
      clientIds
    );
    for (const r of profileRows || []) {
      if (r.contact != null && String(r.contact).trim() !== '') {
        contactByClient[r.client_id] = String(r.contact).trim().replace(/\D/g, '');
      }
      if (r.uen != null && String(r.uen).trim() !== '') {
        uenByClient[r.client_id] = String(r.uen).trim();
      }
    }
  }

  const selectedParkingIds = new Set();
  for (const t of rows || []) {
    const arr = parseJson(t.parkinglot_json);
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const id = typeof item === 'string'
        ? item
        : (item && (item.id || item._id || item.value)) ? String(item.id || item._id || item.value) : '';
      if (id) selectedParkingIds.add(String(id));
    }
  }
  if (selectedParkingIds.size > 0) {
    const ids = [...selectedParkingIds];
    const placeholders = ids.map(() => '?').join(',');
    const [parkingRows] = await pool.query(
      `SELECT id, parkinglot FROM parkinglot WHERE id IN (${placeholders})`,
      ids
    );
    for (const p of parkingRows || []) {
      parkingNameById[p.id] = (p.parkinglot || '').trim() || p.id;
    }
  }

  let cleaningByRoomId = {};
  try {
    const roomIds = [...new Set((rows || []).map((x) => x.room_id).filter(Boolean))];
    if (roomIds.length) {
      const ph = roomIds.map(() => '?').join(',');
      const [crows] = await pool.query(
        `SELECT r.id AS room_id, r.cleanlemons_cleaning_tenant_price_myr AS rp, p.cleanlemons_cleaning_tenant_price_myr AS pp
           FROM roomdetail r
           LEFT JOIN propertydetail p ON p.id = r.property_id
          WHERE r.id IN (${ph})`,
        roomIds
      );
      for (const c of crows || []) {
        const rp = c.rp != null ? Number(c.rp) : null;
        const pp = c.pp != null ? Number(c.pp) : null;
        const eff = rp != null && !Number.isNaN(rp) && rp > 0 ? rp : pp != null && !Number.isNaN(pp) && pp > 0 ? pp : null;
        cleaningByRoomId[c.room_id] = eff;
      }
    }
  } catch (e) {
    if (!isUnknownColumnError(e)) throw e;
  }

  const mapped = (rows || []).map(t => {
    const agreements = agreementMap[t.id] || [];
    const pendingDraftAgreements = draftAgreementMap[t.id] || [];
    const clientContact = t.client_id ? contactByClient[t.client_id] || null : null;
    const clientUen = t.client_id ? uenByClient[t.client_id] || null : null;
    const handoverScheduleWindow = t.client_id
      ? getHandoverScheduleWindowFromAdmin(adminByClient[t.client_id])
      : null;
    const rawParking = parseJson(t.parkinglot_json);
    const parkingLots = Array.isArray(rawParking)
      ? rawParking
          .map((item) => {
            const id = typeof item === 'string'
              ? item
              : (item && (item.id || item._id || item.value)) ? String(item.id || item._id || item.value) : '';
            if (!id) return null;
            return { _id: id, id, parkinglot: parkingNameById[id] || id };
          })
          .filter(Boolean)
      : [];
    const parkingLotDisplay = parkingLots.map((p) => p.parkinglot).join(', ');
    const cleaningTenantPriceMyr = t.room_id ? cleaningByRoomId[t.room_id] : null;
    const hasCleaningOrder = cleaningTenantPriceMyr != null && cleaningTenantPriceMyr > 0;
    const portalLifecycle = computePortalTenancyLifecycle(t.tenancy_status, t.end);
    const isPortalReadOnly = portalLifecycle !== 'active';
    return {
      _id: t.id,
      id: t.id,
      begin: t.begin,
      end: t.end,
      rental: t.rental,
      portalLifecycle,
      isPortalReadOnly,
      tenant: t.tenant_id ? { _id: t.tenant_id, fullname: t.tenant_fullname || '' } : null,
      hasCleaningOrder,
      cleaningTenantPriceMyr: hasCleaningOrder ? cleaningTenantPriceMyr : null,
      room: t.room_id
        ? {
            _id: t.room_id,
            title_fld: t.room_title_fld,
            roomname: t.room_roomname,
            hasMeter: !!t.room_meter_id,
            hasSmartDoor: !!t.room_smartdoor_id
          }
        : null,
      property: t.property_id
        ? {
            _id: t.property_id,
            shortname: t.property_shortname,
            hasSmartDoor: !!t.property_smartdoor_id
          }
        : null,
      client: t.client_id ? { _id: t.client_id, title: t.client_title, currency: t.client_currency, contact: clientContact, uen: clientUen } : null,
      handoverScheduleWindow,
      handoverCheckinAt: parseJson(t.handover_checkin_json)?.scheduledAt || null,
      handoverCheckoutAt: parseJson(t.handover_checkout_json)?.scheduledAt || null,
      parkingLots,
      parkingLotDisplay,
      agreements,
      pendingDraftAgreements
    };
  });
  mapped.sort((a, b) => {
    const ao = a.portalLifecycle === 'active' ? 0 : 1;
    const bo = b.portalLifecycle === 'active' ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const ad = a.begin ? new Date(a.begin).getTime() : 0;
    const bd = b.begin ? new Date(b.begin).getTime() : 0;
    return bd - ad;
  });
  return mapped;
}

/**
 * Get clients by ids (for approval list). No tenant check needed if clientIds come from tenant's approvalRequest.
 */
async function getClientsByIds(clientIds) {
  if (!Array.isArray(clientIds) || clientIds.length === 0) return [];
  const placeholders = clientIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, title, email, currency FROM operatordetail WHERE id IN (${placeholders})`,
    clientIds
  );
  return (rows || []).map(c => ({
    _id: c.id,
    id: c.id,
    title: c.title || 'Unnamed'
  }));
}

/**
 * Get room by id with meter. Caller must ensure room is in tenant's tenancies.
 */
async function getRoomWithMeter(roomId) {
  if (!roomId) return null;
  const [rows] = await pool.query(
    `SELECT r.id, r.roomname, r.title_fld, r.property_id, r.meter_id,
            m.id AS meter_id, m.meterid AS meter_meterid, m.balance AS meter_balance, m.rate AS meter_rate, m.mode AS meter_mode, m.client_id AS meter_client
       FROM roomdetail r
       LEFT JOIN meterdetail m ON m.id = r.meter_id
       WHERE r.id = ? LIMIT 1`,
    [roomId]
  );
  const r = rows[0];
  if (!r) return null;
  const meter = r.meter_id ? {
    _id: r.meter_id,
    meterId: r.meter_meterid,
    balance: r.meter_balance,
    rate: r.meter_rate,
    mode: r.meter_mode || 'prepaid',
    client: r.meter_client,
    canTopup: (r.meter_mode || 'prepaid').toLowerCase() !== 'postpaid'
  } : null;
  return {
    _id: r.id,
    id: r.id,
    roomname: r.roomname,
    title_fld: r.title_fld,
    property: r.property_id,
    meter
  };
}

function isUnknownColumnError(e) {
  return (
    e &&
    (e.code === 'ER_BAD_FIELD_ERROR' ||
      e.errno === 1054 ||
      (e.message && String(e.message).includes('Unknown column')))
  );
}

const SMART_DOOR_SCOPES = ['all', 'property', 'room'];

function normalizeSmartDoorScope(scope) {
  const v = String(scope || 'all').toLowerCase();
  return SMART_DOOR_SCOPES.includes(v) ? v : 'all';
}

/**
 * TTLock lockId from DB may be number/string/BigInt; normalize for API + stable deduping.
 * Large numeric strings stay as string to avoid precision loss.
 */
function normalizeTtlockLockId(lockId) {
  if (lockId == null || lockId === '') return null;
  const s = String(lockId).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    if (s.length > 15) return s;
    const n = Number(s);
    if (!Number.isSafeInteger(n)) return s;
    return n;
  }
  return s;
}

/** Property lock first, then room; dedupe by string key (avoids number vs string missing a second lock). */
function distinctLockIdsInOrder(propertyLockId, roomLockId) {
  const seen = new Set();
  const out = [];
  for (const raw of [propertyLockId, roomLockId]) {
    const id = normalizeTtlockLockId(raw);
    if (id == null) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/** TTLock rejects invalid ranges (end before begin, or end in the past). */
function tenancyKeyboardPwdValidityMs(info) {
  const now = Date.now();
  let beginMs = info.begin ? new Date(info.begin).getTime() : now;
  let endMs = info.end ? new Date(info.end).getTime() : beginMs + 365 * 86400000;
  if (!Number.isFinite(beginMs)) beginMs = now;
  if (!Number.isFinite(endMs)) endMs = beginMs + 365 * 86400000;
  if (endMs <= beginMs) endMs = beginMs + 86400000;
  if (endMs < now) endMs = now + 365 * 86400000;
  if (beginMs > now) beginMs = now;
  return { beginMs, endMs };
}

function smartDoorConflictLabel(type) {
  return type === 'property' ? 'Property (main / gate) door' : 'Room door';
}

function passcodeAlreadyUsedResponse(tgtType, lockId) {
  const label = smartDoorConflictLabel(tgtType);
  const lid = lockId != null ? String(lockId) : '';
  const message = `This PIN is already in use on the ${label} (lock ID: ${lid}). It may belong to another tenant. Please choose a different PIN.`;
  return {
    ok: false,
    reason: 'PASSCODE_ALREADY_USED_ON_LOCK',
    conflictScope: tgtType,
    conflictLockId: lockId,
    conflictLabel: label,
    message
  };
}

/**
 * List TTLock passcodes: if this plain PIN exists on a lock and is not the tenancy's own keyboardPwdId → reject.
 */
async function rejectIfPasscodeBelongsToSomeoneElse(clientId, targets, pwd, ownedKidByType) {
  const pwdStr = String(pwd ?? '');
  for (const tgt of targets) {
    const existingKid = await lockWrapper.findKeyboardPwdIdByPlainPassword(clientId, tgt.lockId, pwdStr);
    if (existingKid == null) continue;
    const ours = tgt.type === 'property' ? ownedKidByType.property : ownedKidByType.room;
    if (ours != null && String(ours) === String(existingKid)) continue;
    return passcodeAlreadyUsedResponse(tgt.type, tgt.lockId);
  }
  return null;
}

function shouldSkipTtlockPasscodeNoOp(tgt, pwd, info, kidProp, kidRoom) {
  if (tgt.type === 'property') {
    return (
      info.password_property != null &&
      String(info.password_property) === String(pwd) &&
      kidProp != null
    );
  }
  return info.password_room != null && String(info.password_room) === String(pwd) && kidRoom != null;
}

async function queryTenancyLockRow(tenancyId, tenantId) {
  const sqlFull = `SELECT client_id, room_id, password, passwordid, title, \`begin\`, \`end\`,
    password_property, password_room, passwordid_property, passwordid_room
    FROM tenancy WHERE id = ? AND tenant_id = ? LIMIT 1`;
  const sqlLegacy = `SELECT client_id, room_id, password, passwordid, title, \`begin\`, \`end\`
    FROM tenancy WHERE id = ? AND tenant_id = ? LIMIT 1`;
  try {
    const [tRows] = await pool.query(sqlFull, [tenancyId, tenantId]);
    return { row: tRows[0] || null, perLockColumns: true };
  } catch (e) {
    if (!isUnknownColumnError(e)) throw e;
    const [tRows] = await pool.query(sqlLegacy, [tenancyId, tenantId]);
    return { row: tRows[0] || null, perLockColumns: false };
  }
}

/** Map legacy single password/passwordid to property vs room for display and TTLock updates. */
function resolveEffectivePasswords(info) {
  const leg = info.password;
  if (info.perLockColumns) {
    let pp = info.password_property;
    let pr = info.password_room;
    if (pp == null && leg != null && info.propertyLockId) {
      if (!info.roomLockId) pp = leg;
      else pp = leg;
    }
    if (pr == null && leg != null && info.roomLockId && !info.propertyLockId) pr = leg;
    if (pp == null && leg != null && info.propertyLockId && info.roomLockId && pr == null) pp = leg;
    return { passwordProperty: pp != null ? String(pp) : null, passwordRoom: pr != null ? String(pr) : null };
  }
  if (info.propertyLockId && !info.roomLockId) {
    return { passwordProperty: leg != null ? String(leg) : null, passwordRoom: null };
  }
  if (!info.propertyLockId && info.roomLockId) {
    return { passwordProperty: null, passwordRoom: leg != null ? String(leg) : null };
  }
  if (info.propertyLockId && info.roomLockId) {
    return { passwordProperty: leg != null ? String(leg) : null, passwordRoom: null };
  }
  return { passwordProperty: null, passwordRoom: null };
}

function resolveKeyboardPwdIds(info) {
  const legacy = info.passwordid;
  let kidProp = info.passwordid_property;
  let kidRoom = info.passwordid_room;
  if (info.perLockColumns) {
    if (kidProp == null && kidRoom == null && legacy != null) {
      if (info.propertyLockId && info.roomLockId) kidProp = legacy;
      else if (info.propertyLockId) kidProp = legacy;
      else if (info.roomLockId) kidRoom = legacy;
    } else {
      if (kidProp == null && legacy != null && info.propertyLockId && !info.roomLockId) kidProp = legacy;
      if (kidRoom == null && legacy != null && !info.propertyLockId && info.roomLockId) kidRoom = legacy;
    }
  } else if (legacy != null) {
    if (info.propertyLockId && !info.roomLockId) kidProp = legacy;
    else if (!info.propertyLockId && info.roomLockId) kidRoom = legacy;
    else if (info.propertyLockId && info.roomLockId) kidProp = legacy;
  }
  return { kidProp, kidRoom };
}

/**
 * Get property with smartdoor (property + room smartdoor). lockId from property lockdetail or room lockdetail.
 * wifi_username / wifi_password are optional (migration 0105); omit from SELECT if DB not migrated yet.
 */
async function getPropertyWithSmartdoor(propertyId, roomId) {
  if (!propertyId) return null;
  const sqlWithWifi = `SELECT p.id, p.shortname, p.apartmentname, p.unitnumber,
            p.wifi_username, p.wifi_password,
            pl.id AS lock_id, pl.lockid AS lock_lockid
       FROM propertydetail p
       LEFT JOIN lockdetail pl ON pl.id = p.smartdoor_id
       WHERE p.id = ? LIMIT 1`;
  const sqlNoWifi = `SELECT p.id, p.shortname, p.apartmentname, p.unitnumber,
            pl.id AS lock_id, pl.lockid AS lock_lockid
       FROM propertydetail p
       LEFT JOIN lockdetail pl ON pl.id = p.smartdoor_id
       WHERE p.id = ? LIMIT 1`;
  let pRows;
  try {
    [pRows] = await pool.query(sqlWithWifi, [propertyId]);
  } catch (e) {
    if (isUnknownColumnError(e)) {
      [pRows] = await pool.query(sqlNoWifi, [propertyId]);
    } else {
      throw e;
    }
  }
  const p = pRows[0];
  if (!p) return null;
  const property = {
    _id: p.id,
    id: p.id,
    shortname: p.shortname || p.apartmentname || p.unitnumber,
    smartdoor: p.lock_id ? { lockId: p.lock_lockid } : null,
    wifiUsername: Object.prototype.hasOwnProperty.call(p, 'wifi_username') && p.wifi_username != null ? String(p.wifi_username) : '',
    wifiPassword: Object.prototype.hasOwnProperty.call(p, 'wifi_password') && p.wifi_password != null ? String(p.wifi_password) : ''
  };
  let roomSmartdoor = null;
  if (roomId) {
    const [rRows] = await pool.query(
      `SELECT rl.id, rl.lockid FROM roomdetail rd
       LEFT JOIN lockdetail rl ON rl.id = rd.smartdoor_id
       WHERE rd.id = ? LIMIT 1`,
      [roomId]
    );
    if (rRows[0] && rRows[0].lockid) roomSmartdoor = { lockId: rRows[0].lockid };
  }
  return { property, roomSmartdoor };
}

/**
 * Get TTLock clientId, property/room lock IDs, lockIds[], passcode fields (legacy + per-lock after migration 0130).
 * Verifies tenancy belongs to tenant. Returns null if tenancy not found or not owned.
 */
async function getLockInfoForTenantTenancy(tenantId, tenancyId) {
  const { row: t, perLockColumns } = await queryTenancyLockRow(tenancyId, tenantId);
  if (!t) return null;
  const clientId = t.client_id;
  const roomId = t.room_id;

  let keyboardPwdDisplayName = (t.title || 'Room').toString().trim().slice(0, 100);
  if (roomId) {
    const [nmRows] = await pool.query(
      'SELECT roomname, title_fld FROM roomdetail WHERE id = ? LIMIT 1',
      [roomId]
    );
    const rm = nmRows?.[0];
    if (rm) {
      keyboardPwdDisplayName = String(rm.roomname || rm.title_fld || t.title || 'Room')
        .trim()
        .slice(0, 100);
    }
  }

  const base = {
    clientId,
    roomId,
    keyboardPwdDisplayName,
    title: t.title,
    begin: t.begin,
    end: t.end,
    password: t.password,
    passwordid: t.passwordid,
    password_property: perLockColumns ? t.password_property : null,
    password_room: perLockColumns ? t.password_room : null,
    passwordid_property: perLockColumns ? t.passwordid_property : null,
    passwordid_room: perLockColumns ? t.passwordid_room : null,
    perLockColumns
  };
  if (!roomId) {
    return {
      ...base,
      propertyLockId: null,
      roomLockId: null,
      lockIds: [],
      primaryLockId: null,
      keyboardPwdId: t.passwordid
    };
  }

  const [rRows] = await pool.query(
    'SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1',
    [roomId]
  );
  const propertyId = rRows?.[0]?.property_id;
  if (!propertyId) {
    return {
      ...base,
      propertyLockId: null,
      roomLockId: null,
      lockIds: [],
      primaryLockId: null,
      keyboardPwdId: t.passwordid
    };
  }

  const data = await getPropertyWithSmartdoor(propertyId, roomId);
  if (!data) {
    return {
      ...base,
      propertyLockId: null,
      roomLockId: null,
      lockIds: [],
      primaryLockId: null,
      keyboardPwdId: t.passwordid
    };
  }

  const propertyLockId = normalizeTtlockLockId(data.property?.smartdoor?.lockId);
  const roomLockId = normalizeTtlockLockId(data.roomSmartdoor?.lockId);
  const lockIds = distinctLockIdsInOrder(propertyLockId, roomLockId);
  const primaryLockId = lockIds[0] || null;
  const { kidProp, kidRoom } = resolveKeyboardPwdIds({
    ...base,
    propertyLockId,
    roomLockId
  });
  const keyboardPwdId = kidProp != null ? kidProp : kidRoom != null ? kidRoom : t.passwordid;

  return {
    ...base,
    propertyLockId,
    roomLockId,
    lockIds,
    primaryLockId,
    keyboardPwdId
  };
}

/**
 * Remote unlock for tenant's tenancy (TTLock). smartDoorScope: all | property | room (default all).
 */
async function remoteUnlockForTenant(email, tenancyId, smartDoorScope) {
  const scope = normalizeSmartDoorScope(smartDoorScope);
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const writable = await assertTenancyPortalWritable(tenant._id, tenancyId);
  if (!writable) return { ok: false, reason: 'TENANCY_READ_ONLY' };
  const info = await getLockInfoForTenantTenancy(tenant._id, tenancyId);
  if (!info) return { ok: false, reason: 'TENANCY_OR_LOCK_NOT_FOUND' };

  const hasProp = info.propertyLockId != null && String(info.propertyLockId) !== '';
  const hasRoom = info.roomLockId != null && String(info.roomLockId) !== '';

  let toUnlock = [];
  if (scope === 'all') {
    toUnlock = [...info.lockIds];
  } else if (scope === 'property') {
    if (!hasProp) return { ok: false, reason: 'NO_PROPERTY_SMARTDOOR' };
    toUnlock = [info.propertyLockId];
  } else {
    if (!hasRoom) return { ok: false, reason: 'NO_ROOM_SMARTDOOR' };
    toUnlock = [info.roomLockId];
  }

  if (!toUnlock.length) return { ok: false, reason: 'NO_SMARTDOOR' };

  const unlockedLockIds = [];
  const failedUnlocks = [];
  for (const lockId of toUnlock) {
    try {
      await lockWrapper.remoteUnlock(info.clientId, lockId);
      unlockedLockIds.push(lockId);
      try {
        const ldId = await lockdetailLog.findLockdetailIdByColivingClientIdAndTtlockLockId(info.clientId, lockId);
        if (ldId) {
          await lockdetailLog.insertLockdetailRemoteUnlockLog({
            lockdetailId: ldId,
            actorEmail: email,
            portalSource: 'coliving_tenant_dashboard',
          });
        }
      } catch (logErr) {
        console.warn('[tenantdashboard] lockdetail_log', logErr?.message || logErr);
      }
    } catch (e) {
      const reason = e?.message || String(e);
      failedUnlocks.push({ lockId, reason });
      console.warn('[tenantdashboard] remoteUnlock lockId=', lockId, 'failed:', reason);
    }
  }

  if (unlockedLockIds.length === 0) {
    return {
      ok: false,
      reason: failedUnlocks[0]?.reason || 'TTLOCK_UNLOCK_FAILED',
      failedUnlocks
    };
  }

  const out = {
    ok: true,
    unlockedCount: unlockedLockIds.length,
    unlockedLockIds
  };
  if (failedUnlocks.length > 0) {
    out.partial = true;
    out.failedUnlocks = failedUnlocks;
    out.warning =
      'Some locks could not be opened via the cloud (e.g. model does not support remote unlock). Other locks were opened.';
  }
  return out;
}

/**
 * Get current passcode(s) for tenant's tenancy. smartDoorScope: all | property | room (default all).
 */
async function getPasscodeForTenant(email, tenancyId, smartDoorScope) {
  const scope = normalizeSmartDoorScope(smartDoorScope);
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const info = await getLockInfoForTenantTenancy(tenant._id, tenancyId);
  if (!info) return { ok: false, reason: 'TENANCY_OR_LOCK_NOT_FOUND' };

  const { passwordProperty, passwordRoom } = resolveEffectivePasswords({
    ...info,
    propertyLockId: info.propertyLockId,
    roomLockId: info.roomLockId
  });
  const hasPropertyLock = info.propertyLockId != null && String(info.propertyLockId) !== '';
  const hasRoomLock = info.roomLockId != null && String(info.roomLockId) !== '';
  const passwordMismatch =
    hasPropertyLock &&
    hasRoomLock &&
    passwordProperty &&
    passwordRoom &&
    passwordProperty !== passwordRoom;

  const { kidProp, kidRoom } = resolveKeyboardPwdIds(info);

  let password = info.password ?? null;
  if (scope === 'all') {
    if (passwordMismatch) password = null;
    else password = passwordProperty || passwordRoom || info.password || null;
  } else if (scope === 'property') {
    password = passwordProperty;
  } else {
    password = passwordRoom;
  }

  const keyboardPwdId =
    scope === 'property' ? kidProp : scope === 'room' ? kidRoom : info.keyboardPwdId ?? info.passwordid ?? null;

  return {
    ok: true,
    smartDoorScope: scope,
    hasPropertyLock,
    hasRoomLock,
    propertyLockId: info.propertyLockId,
    roomLockId: info.roomLockId,
    passwordProperty,
    passwordRoom,
    passwordMismatch: !!passwordMismatch,
    lockIds: info.lockIds,
    primaryLockId: info.primaryLockId,
    password,
    keyboardPwdId
  };
}

/**
 * Create or update tenant TTLock passcode(s) and persist on tenancy.
 * smartDoorScope: all | property | room — property+room need migration 0130 columns for separate PINs.
 */
async function savePasscodeForTenant(email, tenancyId, newPassword, smartDoorScope) {
  const scope = normalizeSmartDoorScope(smartDoorScope);
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const writable = await assertTenancyPortalWritable(tenant._id, tenancyId);
  if (!writable) return { ok: false, reason: 'TENANCY_READ_ONLY' };
  const info = await getLockInfoForTenantTenancy(tenant._id, tenancyId);
  if (!info) return { ok: false, reason: 'TENANCY_OR_LOCK_NOT_FOUND' };

  const hasProp = info.propertyLockId != null && String(info.propertyLockId) !== '';
  const hasRoom = info.roomLockId != null && String(info.roomLockId) !== '';
  const sameLock = hasProp && hasRoom && String(info.propertyLockId) === String(info.roomLockId);

  if (scope === 'property' && !hasProp) return { ok: false, reason: 'NO_PROPERTY_SMARTDOOR' };
  if (scope === 'room' && !hasRoom) return { ok: false, reason: 'NO_ROOM_SMARTDOOR' };
  if (!info.perLockColumns && (scope === 'property' || scope === 'room')) {
    return { ok: false, reason: 'SMARTDOOR_SCOPE_REQUIRES_MIGRATION' };
  }

  const pwd = String(newPassword ?? '').trim();
  if (!pwd) return { ok: false, reason: 'INVALID_PASSWORD' };

  const name = (info.keyboardPwdDisplayName || info.title || 'Room').toString().trim().slice(0, 100);
  const { beginMs, endMs } = tenancyKeyboardPwdValidityMs(info);

  if (!info.perLockColumns) {
    if (!info.primaryLockId) return { ok: false, reason: 'NO_SMARTDOOR' };
    const hasPropLegacy = info.propertyLockId != null && String(info.propertyLockId) !== '';
    const legacyConflictType = hasPropLegacy ? 'property' : 'room';
    const existingOnPrimary = await lockWrapper.findKeyboardPwdIdByPlainPassword(
      info.clientId,
      info.primaryLockId,
      pwd
    );
    if (
      existingOnPrimary != null &&
      (info.keyboardPwdId == null || String(existingOnPrimary) !== String(info.keyboardPwdId))
    ) {
      return passcodeAlreadyUsedResponse(legacyConflictType, info.primaryLockId);
    }
    if (
      info.password != null &&
      String(info.password) === String(pwd) &&
      info.keyboardPwdId != null
    ) {
      return { ok: true, noop: true };
    }
    if (info.keyboardPwdId != null) {
      try {
        await lockWrapper.changePasscode(info.clientId, info.primaryLockId, {
          keyboardPwdId: info.keyboardPwdId,
          name,
          startDate: beginMs,
          endDate: endMs,
          newPassword: pwd
        });
      } catch (chgErr) {
        if (chgErr.code === 'TTLOCK_PASSCODE_ALREADY_IN_USE_ON_LOCK') {
          return passcodeAlreadyUsedResponse(legacyConflictType, chgErr.lockId ?? info.primaryLockId);
        }
        return { ok: false, reason: chgErr.message || 'TTLOCK_CHANGE_PASSCODE_FAILED' };
      }
      await pool.query('UPDATE tenancy SET password = ?, passwordid = ?, updated_at = NOW() WHERE id = ?', [
        pwd,
        info.keyboardPwdId,
        tenancyId
      ]);
    } else {
      let data;
      try {
        data = await lockWrapper.addPasscode(info.clientId, info.primaryLockId, {
          name,
          password: pwd,
          startDate: beginMs,
          endDate: endMs
        });
      } catch (addErr) {
        if (addErr.code === 'TTLOCK_PASSCODE_ALREADY_IN_USE_ON_LOCK') {
          return passcodeAlreadyUsedResponse(legacyConflictType, addErr.lockId ?? info.primaryLockId);
        }
        return { ok: false, reason: addErr.message || 'TTLOCK_ADD_PASSCODE_FAILED' };
      }
      const keyboardPwdId = data?.keyboardPwdId ?? null;
      await pool.query('UPDATE tenancy SET password = ?, passwordid = ?, updated_at = NOW() WHERE id = ?', [
        pwd,
        keyboardPwdId,
        tenancyId
      ]);
    }
    return { ok: true };
  }

  let { kidProp, kidRoom } = resolveKeyboardPwdIds(info);

  const targets = [];
  if (scope === 'all') {
    if (sameLock) {
      targets.push({ type: 'property', lockId: info.propertyLockId, oldKid: kidProp != null ? kidProp : kidRoom });
    } else {
      if (hasProp) targets.push({ type: 'property', lockId: info.propertyLockId, oldKid: kidProp });
      if (hasRoom && !sameLock) targets.push({ type: 'room', lockId: info.roomLockId, oldKid: kidRoom });
    }
  } else if (scope === 'property') {
    targets.push({ type: 'property', lockId: info.propertyLockId, oldKid: kidProp });
  } else {
    targets.push({ type: 'room', lockId: info.roomLockId, oldKid: kidRoom });
  }

  if (!targets.length) return { ok: false, reason: 'NO_SMARTDOOR' };

  const rejectDup = await rejectIfPasscodeBelongsToSomeoneElse(info.clientId, targets, pwd, {
    property: kidProp,
    room: kidRoom
  });
  if (rejectDup) return rejectDup;

  let password_property = info.password_property;
  let password_room = info.password_room;
  let passwordid_property = info.passwordid_property;
  let passwordid_room = info.passwordid_room;

  const updatedTargets = [];
  const failedTargets = [];

  for (const tgt of targets) {
    if (shouldSkipTtlockPasscodeNoOp(tgt, pwd, info, kidProp, kidRoom)) {
      continue;
    }
    let newKeyboardPwdId;
    if (tgt.oldKid != null) {
      try {
        await lockWrapper.changePasscode(info.clientId, tgt.lockId, {
          keyboardPwdId: tgt.oldKid,
          name,
          startDate: beginMs,
          endDate: endMs,
          newPassword: pwd
        });
      } catch (chgErr) {
        if (chgErr.code === 'TTLOCK_PASSCODE_ALREADY_IN_USE_ON_LOCK') {
          return passcodeAlreadyUsedResponse(tgt.type, chgErr.lockId ?? tgt.lockId);
        }
        const reason = chgErr?.message || 'TTLOCK_CHANGE_PASSCODE_FAILED';
        failedTargets.push({ type: tgt.type, lockId: tgt.lockId, reason });
        console.warn('[tenantdashboard] passcode-save change lockId=', tgt.lockId, 'failed:', reason);
        continue;
      }
      newKeyboardPwdId = tgt.oldKid;
    } else {
      let data;
      try {
        data = await lockWrapper.addPasscode(info.clientId, tgt.lockId, {
          name,
          password: pwd,
          startDate: beginMs,
          endDate: endMs
        });
      } catch (addErr) {
        if (addErr.code === 'TTLOCK_PASSCODE_ALREADY_IN_USE_ON_LOCK') {
          return passcodeAlreadyUsedResponse(tgt.type, addErr.lockId ?? tgt.lockId);
        }
        const reason = addErr?.message || 'TTLOCK_ADD_PASSCODE_FAILED';
        failedTargets.push({ type: tgt.type, lockId: tgt.lockId, reason });
        console.warn('[tenantdashboard] passcode-save add lockId=', tgt.lockId, 'failed:', reason);
        continue;
      }
      newKeyboardPwdId = data?.keyboardPwdId ?? null;
    }
    if (tgt.type === 'property') {
      password_property = pwd;
      passwordid_property = newKeyboardPwdId;
    } else {
      password_room = pwd;
      passwordid_room = newKeyboardPwdId;
    }
    updatedTargets.push(tgt.type);
  }

  if (!updatedTargets.length) {
    if (!failedTargets.length) {
      return { ok: true, noop: true };
    }
    return {
      ok: false,
      reason: failedTargets[0]?.reason || 'TTLOCK_ADD_PASSCODE_FAILED',
      failedTargets
    };
  }

  if (sameLock && info.perLockColumns) {
    password_room = pwd;
    passwordid_room = passwordid_property;
  }

  const legacyPwdId =
    passwordid_property != null ? passwordid_property : passwordid_room != null ? passwordid_room : null;

  const effectivePassword = pwd;
  if (info.perLockColumns) {
    await pool.query(
      `UPDATE tenancy SET password = ?, passwordid = ?, password_property = ?, password_room = ?, passwordid_property = ?, passwordid_room = ?, updated_at = NOW() WHERE id = ?`,
      [effectivePassword, legacyPwdId, password_property, password_room, passwordid_property, passwordid_room, tenancyId]
    );
  } else {
    await pool.query('UPDATE tenancy SET password = ?, passwordid = ?, updated_at = NOW() WHERE id = ?', [
      effectivePassword,
      legacyPwdId,
      tenancyId
    ]);
  }
  if (failedTargets.length > 0) {
    return {
      ok: true,
      partial: true,
      failedTargets,
      warning:
        'PIN was updated on some locks only. Some locks rejected this operation (e.g. unsupported model/lock mode).'
    };
  }
  return { ok: true };
}

/**
 * Get banks list.
 */
async function getBanks() {
  const [rows] = await pool.query(
    'SELECT id, bankname FROM bankdetail ORDER BY bankname ASC'
  );
  return (rows || []).map(b => ({
    _id: b.id,
    id: b.id,
    bankname: b.bankname || ''
  }));
}

/**
 * Update tenant profile. Only tenant identified by email can update.
 * When no tenant exists (public user), creates tenantdetail by email so they can edit profile.
 */
async function updateTenantProfile(email, payload) {
  const norm = getEmailNorm(email);
  if (!norm) return { ok: false, reason: 'NO_EMAIL' };

  let tenant = await getTenantByEmail(email);
  if (!tenant) {
    const id = randomUUID();
    const fullname = (payload.fullname != null ? String(payload.fullname).trim() : null) || null;
    const phone = (payload.phone != null ? String(payload.phone).trim() : null) || null;
    const address = (payload.address != null ? String(payload.address).trim() : null) || null;
    const nric = (payload.nric != null ? String(payload.nric).trim() : null) || null;
    const banknameId = payload.bankName || null;
    const bankaccount = (payload.bankAccount != null ? String(payload.bankAccount).trim() : null) || null;
    const accountholder = (payload.accountholder != null ? String(payload.accountholder).trim() : null) || null;
    const nricfront = payload.nricFront || null;
    const nricback = payload.nricback || null;
    await pool.query(
      `INSERT INTO tenantdetail (id, email, fullname, phone, address, nric, bankname_id, bankaccount, accountholder, nricfront, nricback, approval_request_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', NOW(), NOW())`,
      [id, norm, fullname, phone, address, nric, banknameId, bankaccount, accountholder, nricfront, nricback]
    );
    try {
      const profileObj = payload.profile && typeof payload.profile === 'object' ? payload.profile : null;
      const portalPayload = {
        fullname,
        phone,
        address,
        nric,
        nricfront: nricfront,
        nricback: nricback,
        bankname_id: banknameId,
        bankaccount,
        accountholder,
      };
      if (profileObj) {
        if (profileObj.entity_type !== undefined) portalPayload.entity_type = profileObj.entity_type;
        if (profileObj.reg_no_type !== undefined) portalPayload.reg_no_type = profileObj.reg_no_type;
        if (profileObj.reg_no_type !== undefined) portalPayload.id_type = profileObj.reg_no_type;
        if (profileObj.tax_id_no !== undefined) portalPayload.tax_id_no = profileObj.tax_id_no;
        if (profileObj.avatar_url !== undefined) portalPayload.avatar_url = profileObj.avatar_url;
        if (profileObj.bank_refund_remark !== undefined) portalPayload.bank_refund_remark = profileObj.bank_refund_remark;
      }
      await updatePortalProfile(norm, portalPayload);
    } catch (_) { /* portal_account may not have profile columns yet */ }
    try {
      const profileJson = (payload.profile != null && typeof payload.profile === 'object') ? JSON.stringify(payload.profile) : null;
      if (profileJson != null) {
        await pool.query('UPDATE tenantdetail SET profile = ?, updated_at = NOW() WHERE id = ?', [profileJson, id]);
      }
    } catch (e) {
      const msg = e?.message || String(e);
      console.error('[tenantdashboard] new-tenant profile save failed:', msg);
      if (e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054) {
        return {
          ok: false,
          reason: 'PROFILE_COLUMN_MISSING',
          message: 'Database missing tenantdetail.profile — run migration 0131_tenantdetail_profile.sql'
        };
      }
    }
    const created = await getTenantByEmail(email);
    return { ok: true, tenant: created };
  }

  if (payload.email !== undefined) {
    const newNorm = getEmailNorm(payload.email);
    if (newNorm && newNorm !== getEmailNorm(tenant.email)) {
      return { ok: false, reason: 'EMAIL_CHANGE_REQUIRES_VERIFICATION' };
    }
  }

  const portalPayload = {};
  if (payload.fullname !== undefined) {
    portalPayload.fullname = payload.fullname;
  }
  if (payload.phone !== undefined) portalPayload.phone = payload.phone;
  if (payload.address !== undefined) portalPayload.address = payload.address;
  if (payload.nric !== undefined) portalPayload.nric = payload.nric;
  if (payload.nricFront !== undefined) portalPayload.nricfront = payload.nricFront;
  if (payload.nricback !== undefined) portalPayload.nricback = payload.nricback;
  if (payload.bankName !== undefined) portalPayload.bankname_id = payload.bankName;
  if (payload.bankAccount !== undefined) portalPayload.bankaccount = payload.bankAccount;
  if (payload.accountholder !== undefined) portalPayload.accountholder = payload.accountholder;
  if (payload.profile !== undefined && payload.profile != null && typeof payload.profile === 'object' && !Array.isArray(payload.profile)) {
    const p = payload.profile;
    if (p.entity_type !== undefined) portalPayload.entity_type = p.entity_type;
    if (p.reg_no_type !== undefined) portalPayload.reg_no_type = p.reg_no_type;
    if (p.reg_no_type !== undefined) portalPayload.id_type = p.reg_no_type;
    if (p.tax_id_no !== undefined) portalPayload.tax_id_no = p.tax_id_no;
    if (p.avatar_url !== undefined) portalPayload.avatar_url = p.avatar_url;
    if (p.bank_refund_remark !== undefined) portalPayload.bank_refund_remark = p.bank_refund_remark;
  }
  if (Object.keys(portalPayload).length > 0) {
    try {
      const pr = await updatePortalProfile(norm, portalPayload);
      if (!pr.ok) return { ok: false, reason: pr.reason || 'DB_ERROR' };
    } catch (_) {
      return { ok: false, reason: 'DB_ERROR' };
    }
  }

  const tenantOnlyUpdates = [];
  const tenantOnlyParams = [];
  if (payload.nricFront !== undefined) {
    tenantOnlyUpdates.push('nricfront = ?');
    tenantOnlyParams.push(payload.nricFront || null);
  }
  if (payload.nricback !== undefined) {
    tenantOnlyUpdates.push('nricback = ?');
    tenantOnlyParams.push(payload.nricback || null);
  }
  if (tenantOnlyUpdates.length > 0) {
    tenantOnlyParams.push(tenant._id);
    await pool.query(
      `UPDATE tenantdetail SET ${tenantOnlyUpdates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      tenantOnlyParams
    );
  }
  if (payload.profile !== undefined && typeof payload.profile === 'object') {
    try {
      const existing =
        tenant.profile != null && typeof tenant.profile === 'object' && !Array.isArray(tenant.profile)
          ? { ...tenant.profile }
          : {};
      const merged = { ...existing, ...payload.profile };
      await pool.query('UPDATE tenantdetail SET profile = ?, updated_at = NOW() WHERE id = ?', [
        JSON.stringify(merged),
        tenant._id
      ]);
    } catch (e) {
      const msg = e?.message || String(e);
      console.error('[tenantdashboard] update tenantdetail.profile failed:', msg);
      if (e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054) {
        return {
          ok: false,
          reason: 'PROFILE_COLUMN_MISSING',
          message: 'Database missing tenantdetail.profile — run migration 0131_tenantdetail_profile.sql'
        };
      }
      return { ok: false, reason: 'PROFILE_UPDATE_FAILED', message: msg };
    }
  }

  // After profile edit (fullname/phone etc.): sync tenant to accounting contact for each linked client so contact name/phone stay in sync.
  if (Object.keys(portalPayload).length > 0) {
    try {
      const [linkRows] = await pool.query('SELECT client_id FROM tenant_client WHERE tenant_id = ?', [tenant._id]);
      for (const row of linkRows || []) {
        if (row.client_id) {
          syncTenantForClient(email, row.client_id, {}).catch((e) =>
            console.warn('[tenantdashboard] syncTenantForClient after update-profile', row.client_id, e?.message || e)
          );
        }
      }
    } catch (_) { /* best-effort */ }
  }

  // After tenant profile updates, auto-prepare pending tenancy agreement drafts.
  // This removes the need for operator-side manual "redo" once tenant finishes profile.
  try {
    const [pendingRows] = await pool.query(
      `SELECT a.id
         FROM agreement a
         INNER JOIN tenancy t ON t.id = a.tenancy_id
        WHERE t.tenant_id = ?
          AND a.columns_locked = 0
          AND (a.url IS NULL OR TRIM(a.url) = '')
          AND (a.pdfurl IS NULL OR TRIM(a.pdfurl) = '')
          AND (a.status IS NULL OR a.status = '' OR a.status = 'pending')
        ORDER BY a.created_at DESC
        LIMIT 20`,
      [tenant._id]
    );
    if (Array.isArray(pendingRows) && pendingRows.length > 0) {
      const { tryPrepareDraftForAgreement } = require('../agreement/agreement.service');
      for (const row of pendingRows) {
        const agreementId = row?.id ? String(row.id) : '';
        if (!agreementId) continue;
        try {
          await tryPrepareDraftForAgreement(agreementId);
        } catch (e) {
          console.warn('[tenantdashboard] auto-prepare agreement draft failed:', agreementId, e?.message || e);
        }
      }
    }
  } catch (e) {
    console.warn('[tenantdashboard] query pending agreements after profile update failed:', e?.message || e);
  }

  const updated = await getTenantByEmail(email);
  return { ok: true, tenant: updated };
}

/**
 * Request email change: send verification code to new email. One pending per tenant.
 */
async function requestEmailChange(email, newEmail) {
  const norm = getEmailNorm(email);
  if (!norm) return { ok: false, reason: 'NO_EMAIL' };
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  const newNorm = getEmailNorm(newEmail);
  if (!newNorm) return { ok: false, reason: 'INVALID_NEW_EMAIL' };
  if (newNorm === norm) return { ok: false, reason: 'SAME_EMAIL' };

  const [existing] = await pool.query(
    'SELECT id FROM tenantdetail WHERE LOWER(TRIM(email)) = ? AND id != ? LIMIT 1',
    [newNorm, tenant._id]
  );
  if (existing && existing.length) return { ok: false, reason: 'EMAIL_TAKEN' };

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await pool.query(
    `INSERT INTO tenant_email_verification (tenant_id, new_email, code, expires_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE new_email = ?, code = ?, expires_at = ?`,
    [tenant._id, newNorm, code, expiresAt, newNorm, code, expiresAt]
  );

  try {
    const sender = require('./tenant-email-verification-sender');
    await sender.sendVerificationCode(newNorm, code);
  } catch (e) {
    console.log('[tenantdashboard] Email verification code for', newNorm, ':', code, '(wire SMTP in tenant-email-verification-sender.js to send email)');
  }
  return { ok: true };
}

/**
 * Confirm email change with code. On success updates tenantdetail.email and clears verification row.
 */
async function confirmEmailChange(email, newEmail, code) {
  const norm = getEmailNorm(email);
  if (!norm) return { ok: false, reason: 'NO_EMAIL' };
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  const newNorm = getEmailNorm(newEmail);
  if (!newNorm) return { ok: false, reason: 'INVALID_NEW_EMAIL' };

  const [rows] = await pool.query(
    'SELECT tenant_id FROM tenant_email_verification WHERE tenant_id = ? AND new_email = ? AND code = ? AND expires_at > NOW() LIMIT 1',
    [tenant._id, newNorm, String(code).trim()]
  );
  if (!rows || rows.length === 0) return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' };

  await pool.query('UPDATE tenantdetail SET email = ?, updated_at = NOW() WHERE id = ?', [newNorm, tenant._id]);
  await pool.query('UPDATE portal_account SET email = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?', [newNorm, norm]);
  await pool.query('UPDATE staffdetail SET email = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?', [newNorm, norm]);
  await pool.query('UPDATE ownerdetail SET email = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?', [newNorm, norm]);
  await pool.query('DELETE FROM tenant_email_verification WHERE tenant_id = ?', [tenant._id]);
  return { ok: true };
}

/**
 * Get agreement HTML for tenant signing. Verifies tenancy belongs to tenant; agreementTemplateId from latest agreement or tenancy.
 */
async function getAgreementHtml(email, tenancyId, agreementTemplateId, staffVars = {}) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };

  let templateId = agreementTemplateId;
  if (!templateId) {
    const [agRows] = await pool.query(
      'SELECT agreementtemplate_id FROM agreement WHERE tenancy_id = ? ORDER BY created_at DESC LIMIT 1',
      [tenancyId]
    );
    templateId = agRows[0]?.agreementtemplate_id;
  }
  if (!templateId) return { ok: false, reason: 'AGREEMENT_TEMPLATE_NOT_FOUND' };

  return getOwnerTenantAgreementHtml(tenancyId, templateId, staffVars);
}

/**
 * Update agreement tenant sign. Verifies agreement.tenancy belongs to tenant. Records client IP. Rejects when columns_locked=1.
 */
async function updateAgreementTenantSign(email, agreementId, { tenantsign, tenantSignedAt, status, tenantSignedIp }) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  const [rows] = await pool.query(
    'SELECT id, tenancy_id, mode, ownersign, operatorsign, client_id, columns_locked FROM agreement WHERE id = ? LIMIT 1',
    [agreementId]
  );
  const ag = rows[0];
  if (!ag) return { ok: false, reason: 'AGREEMENT_NOT_FOUND' };
  if (ag.columns_locked) return { ok: false, reason: 'AGREEMENT_COMPLETED' };
  const ok = await assertTenancyBelongsToTenant(tenant._id, ag.tenancy_id);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };
  const writable = await assertTenancyPortalWritable(tenant._id, ag.tenancy_id);
  if (!writable) return { ok: false, reason: 'TENANCY_READ_ONLY' };

  // Store signature as a public https URL so Google Docs can embed it in final PDF.
  const publicSign = await signatureValueToPublicUrl(tenantsign, {
    clientId: ag.client_id,
    signatureKey: 'tenantsign'
  });
  if (!publicSign.ok) {
    return { ok: false, reason: 'SIGNATURE_UPLOAD_FAILED', message: `tenant tenantsign: ${publicSign.reason}` };
  }

  const signedAt = tenantSignedAt instanceof Date ? tenantSignedAt : new Date(tenantSignedAt || Date.now());
  const signedAtIso = Number.isNaN(signedAt.getTime()) ? new Date().toISOString() : signedAt.toISOString();
  const signedAtStr = signedAtIso.replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const signStrRaw = String(tenantsign).trim();
  const [auditRows] = await pool.query('SELECT hash_draft FROM agreement WHERE id = ? LIMIT 1', [agreementId]);
  const hashDraft = auditRows?.[0]?.hash_draft != null ? String(auditRows[0].hash_draft) : '';
  const tenantSignedHash = createHash('sha256')
    .update([agreementId, signStrRaw, signedAtIso, hashDraft].join('|'), 'utf8')
    .digest('hex');

  const updates = ['tenantsign = ?', 'tenant_signed_ip = ?'];
  const ip = tenantSignedIp != null ? String(tenantSignedIp).trim().slice(0, 45) : null;
  const params = [publicSign.value, ip || null];
  if (status !== undefined) {
    updates.push('status = ?');
    params.push(status);
  }
  params.push(agreementId);
  const setClause = `${updates.join(', ')}, tenant_signed_at = ?, tenant_signed_hash = ?, updated_at = NOW()`;
  params.splice(2, 0, signedAtStr, tenantSignedHash);
  try {
    await pool.query(`UPDATE agreement SET ${setClause} WHERE id = ?`, params);
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054) {
      if (msg.includes('tenant_signed_hash')) {
        await pool.query(
          `UPDATE agreement SET ${updates.join(', ')}, tenant_signed_at = ?, updated_at = NOW() WHERE id = ?`,
          [publicSign.value, ip || null, signedAtStr, agreementId]
        );
      } else if (msg.includes('tenant_signed_at')) {
        await pool.query(
          `UPDATE agreement SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
          [publicSign.value, ip || null, agreementId]
        );
      } else {
        throw e;
      }
    } else {
      throw e;
    }
  }
  return { ok: true };
}

/**
 * Get agreement by id (for tenant). Verifies tenancy belongs to tenant.
 */
async function getAgreementByIdForTenant(email, agreementId) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return null;
  let rows;
  try {
    [rows] = await pool.query(
      'SELECT id, tenancy_id, mode, status, ownersign, tenantsign, tenant_signed_at, url, pdfurl, columns_locked FROM agreement WHERE id = ? LIMIT 1',
      [agreementId]
    );
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if ((e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054) && msg.includes('tenant_signed_at')) {
      [rows] = await pool.query(
        'SELECT id, tenancy_id, mode, status, ownersign, tenantsign, url, pdfurl, columns_locked FROM agreement WHERE id = ? LIMIT 1',
        [agreementId]
      );
    } else {
      throw e;
    }
  }
  const r = rows[0];
  if (!r) return null;
  const ok = await assertTenancyBelongsToTenant(tenant._id, r.tenancy_id);
  if (!ok) return null;
  return {
    _id: r.id,
    mode: r.mode,
    status: r.status,
    ownersign: r.ownersign,
    tenantsign: r.tenantsign,
    tenant_signed_at: r.tenant_signed_at != null ? r.tenant_signed_at : null,
    url: r.url || r.pdfurl,
    columns_locked: Number(r.columns_locked) === 1
  };
}

const TENANT_PAYMENT_METHOD_POLICIES = ['strictly', 'no_allow', 'flexible'];

function normalizeTenantPaymentMethodPolicy(raw) {
  const s = raw != null && String(raw).trim() ? String(raw).trim() : '';
  if (TENANT_PAYMENT_METHOD_POLICIES.includes(s)) return s;
  return 'flexible';
}

/** Operator (operatordetail.admin.tenantRentAutoDebitOffered): show "charge due rent automatically" on tenant portal. Default true. */
function normalizeTenantRentAutoDebitOffered(admin) {
  if (admin && admin.tenantRentAutoDebitOffered === false) return false;
  return true;
}

async function readClientAdminObject(clientId) {
  if (!clientId) return null;
  const [rows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) return null;
  let admin = parseJson(rows[0].admin);
  if (Array.isArray(admin) && admin.length > 0) admin = admin[0];
  return admin || null;
}

async function isSgdClient(clientId) {
  if (!clientId) return false;
  const [rows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) return false;
  return String(rows[0].currency || '').trim().toUpperCase() === 'SGD';
}

/**
 * True when any linked tenancy's operator has policy "strictly" and tenant has not completed
 * payment-method linking (tenantdetail.profile.payment_method_linked, set by bind webhook later).
 */
async function computeRequiresPaymentMethodLink(tenantId, profileObj) {
  if (!tenantId) return false;
  if (profileObj && profileObj.payment_method_linked === true) return false;
  const tenancies = await getTenanciesForTenant(tenantId);
  const clientIds = [
    ...new Set(
      (tenancies || [])
        .filter((t) => t && t.portalLifecycle === 'active' && t.client && t.client._id)
        .map((t) => t.client._id)
    )
  ];
  for (const cid of clientIds) {
    const pol = await getTenantPaymentMethodPolicyForClientId(cid);
    if (pol === 'strictly') return true;
  }
  return false;
}

/**
 * Operator setting (operatordetail.admin.tenantPaymentMethodPolicy): whether tenant portal shows "link card/bank".
 */
async function getTenantPaymentMethodPolicyForClientId(clientId) {
  const { getClientPaymentGateway } = require('../payment-gateway/payment-gateway.service');
  const gw = await getClientPaymentGateway(clientId);
  if (gw.provider === 'billplz') return 'no_allow';
  if (await isSgdClient(clientId) && gw.provider === 'paynow') return 'no_allow';
  const admin = await readClientAdminObject(clientId);
  return normalizeTenantPaymentMethodPolicy(admin && admin.tenantPaymentMethodPolicy);
}

async function getGatewayPaynowToggle(clientId, provider) {
  if (!clientId || !provider || provider === 'paynow') return true;
  const [rows] = await pool.query(
    "SELECT values_json FROM client_integration WHERE client_id = ? AND `key` = 'paymentGateway' AND provider = ? AND enabled = 1 LIMIT 1",
    [clientId, provider]
  );
  if (!rows.length) return true;
  const values = typeof rows[0].values_json === 'string' ? parseJson(rows[0].values_json) : (rows[0].values_json || {});
  return values && values.allow_paynow_with_gateway === false ? false : true;
}

/**
 * List rental collection for tenancy (payment list). Excludes certain type_id. Verifies tenancy belongs to tenant.
 * Also includes paid meter top-ups (metertransaction) so tenant sees the same cash invoice / receipt links as operator invoice list.
 */
async function getRentalListForTenancy(email, tenancyId) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND', items: [] };
  const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH', items: [] };

  const [tenancyRow] = await pool.query('SELECT client_id FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
  const clientId = tenancyRow && tenancyRow[0] ? tenancyRow[0].client_id : null;
  const admin = await readClientAdminObject(clientId);
  const { getClientPaymentGateway } = require('../payment-gateway/payment-gateway.service');
  const gateway = clientId ? await getClientPaymentGateway(clientId) : { provider: 'stripe', currency: 'MYR' };
  const paymentGatewayAllowPaynow = clientId ? await getGatewayPaynowToggle(clientId, gateway.provider) : true;
  const tenantPaymentMethodPolicy = normalizeTenantPaymentMethodPolicy(admin && admin.tenantPaymentMethodPolicy);
  const tenantRentAutoDebitOffered = normalizeTenantRentAutoDebitOffered(admin);

  const [rows] = await pool.query(
    `SELECT r.id, r.tenancy_id, r.property_id, r.amount, r.date, r.title, r.ispaid, r.invoiceid, r.invoiceurl, r.receipturl, r.type_id,
            r.accounting_document_number, r.accounting_receipt_document_number, r.accounting_receipt_snapshot, r.bukku_payment_id,
            p.shortname AS property_shortname,
            TRIM(COALESCE(a.title, '')) AS type_title
       FROM rentalcollection r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       LEFT JOIN account a ON a.id = r.type_id
       WHERE r.tenancy_id = ? ORDER BY r.date ASC LIMIT 1000`,
    [tenancyId]
  );

  const bukkuSub = clientId ? await getBukkuSubdomainForClientInvoiceLink(clientId) : null;

  let items = (rows || []).filter((i) => !RENTAL_EXCLUDED_TYPE_IDS.includes(i.type_id));
  items = items.map((i) => {
    const parsed = parseAccountingReceiptSnapshotJson(i.accounting_receipt_snapshot);
    const receiptNo =
      (i.accounting_receipt_document_number && String(i.accounting_receipt_document_number).trim()) ||
      (parsed?.number ? String(parsed.number).trim() : '');
    const payId =
      (i.bukku_payment_id && String(i.bukku_payment_id).trim()) ||
      (parsed?.id ? String(parsed.id).trim() : '');
    const typeTitle =
      i.type_title && String(i.type_title).trim() ? String(i.type_title).trim() : '';
    return {
    _id: i.id,
    property: i.property_id ? { _id: i.property_id, shortname: i.property_shortname } : null,
    amount: i.amount,
    dueDate: i.date,
    title: i.title,
    type: i.type_id
      ? { _id: i.type_id, title: typeTitle || 'Unknown' }
      : null,
    isPaid: !!(i.ispaid === 1 || i.ispaid === true),
    invoiceurl: buildRentalInvoiceDisplayUrl(i.invoiceurl, i.invoiceid, bukkuSub),
    receipturl: buildRentalReceiptDisplayUrl(i.receipturl, payId, bukkuSub),
    accountingDocLabel: formatAccountingInvoiceReceiptLabel(i.accounting_document_number, receiptNo)
  };
  });

  const topupAccountId = await getTopupAircondAccountId();
  let meterTypeTitle = 'Meter top-up';
  if (topupAccountId) {
    const [accRow] = await pool.query('SELECT title FROM account WHERE id = ? LIMIT 1', [topupAccountId]);
    if (accRow[0]?.title) meterTypeTitle = String(accRow[0].title).trim();
  }

  const [mtRows] = await pool.query(
    `SELECT mt.id, mt.property_id, mt.amount, mt.updated_at, mt.created_at, mt.receipturl, mt.invoiceurl, mt.invoiceid,
            mt.accounting_document_number, mt.accounting_invoice_snapshot,
            mt.accounting_receipt_document_number, mt.accounting_receipt_snapshot, mt.bukku_payment_id,
            p.shortname AS property_shortname
       FROM metertransaction mt
       LEFT JOIN propertydetail p ON p.id = mt.property_id
       WHERE mt.tenancy_id = ? AND mt.tenant_id = ?
         AND mt.ispaid = 1 AND (mt.status = 'success' OR mt.status IS NULL)
       ORDER BY mt.updated_at ASC
       LIMIT 500`,
    [tenancyId, tenant._id]
  );

  const meterItems = (mtRows || []).map((i) => {
    const parsedRec = parseAccountingReceiptSnapshotJson(i.accounting_receipt_snapshot);
    const receiptNo =
      (i.accounting_receipt_document_number && String(i.accounting_receipt_document_number).trim()) ||
      (parsedRec?.number ? String(parsedRec.number).trim() : '');
    const payId =
      (i.bukku_payment_id && String(i.bukku_payment_id).trim()) ||
      (parsedRec?.id ? String(parsedRec.id).trim() : '');
    const when = i.updated_at || i.created_at;
    return {
      _id: i.id,
      property: i.property_id ? { _id: i.property_id, shortname: i.property_shortname } : null,
      amount: i.amount,
      dueDate: when,
      title: meterTypeTitle,
      type: topupAccountId
        ? { _id: topupAccountId, title: meterTypeTitle }
        : null,
      isPaid: true,
      invoiceurl: buildRentalInvoiceDisplayUrl(i.invoiceurl, i.invoiceid, bukkuSub),
      receipturl: buildRentalReceiptDisplayUrl(i.receipturl, payId, bukkuSub),
      accountingDocLabel: formatAccountingInvoiceReceiptLabel(i.accounting_document_number, receiptNo)
    };
  });

  const merged = [...items, ...meterItems].sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate).getTime() : 0;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : 0;
    return da - db;
  });

  return {
    ok: true,
    items: merged,
    tenantPaymentMethodPolicy,
    tenantRentAutoDebitOffered,
    paymentGatewayProvider: gateway.provider,
    paymentGatewayAllowPaynow
  };
}

function toDateOnlyStr(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.length >= 10 ? val.slice(0, 10) : val;
  if (val instanceof Date && !Number.isNaN(val.getTime())) return val.toISOString().slice(0, 10);
  try {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {
    // ignore
  }
  return null;
}

function billingLabelFromType(item) {
  const type = item?.type ? String(item.type) : '';
  if (type === 'rental') {
    const s = toDateOnlyStr(item.periodStart);
    const e = toDateOnlyStr(item.periodEnd);
    if (s && e && s !== e) return 'Pro rate rental';
    return 'Rental';
  }
  if (type === 'deposit') return 'Deposit';
  if (type === 'agreement') return 'Agreement fee';
  if (type === 'parking') return 'Parking fees';
  if (type === 'commission') return 'Commission';
  if (type === 'addon') {
    const name = item?.name != null && String(item.name).trim() ? String(item.name).trim() : '';
    return name ? `Addon (${name})` : 'Addon';
  }
  return type ? type.replace(/_/g, ' ') : 'Item';
}

/**
 * Approval detail preview for tenant: show upcoming billing summary BEFORE accepting.
 * Finds latest tenancy for (tenant_id, client_id) and groups tenancy.billing_json by dueDate.
 */
async function getApprovalDetail(email, clientId) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };

  const [tenancyRows] = await pool.query(
    'SELECT id, title, `begin`, `end`, billing_json, created_at FROM tenancy WHERE tenant_id = ? AND client_id = ? ORDER BY created_at DESC LIMIT 1',
    [tenant._id, clientId]
  );
  if (!tenancyRows.length) return { ok: false, reason: 'TENANCY_NOT_FOUND' };
  const t = tenancyRows[0];
  const billing = parseJson(t.billing_json);
  const arr = Array.isArray(billing) ? billing : [];

  const groupsByDue = new Map();
  for (const item of arr) {
    const due = toDateOnlyStr(item?.dueDate) || '—';
    const list = groupsByDue.get(due) || [];
    list.push({
      type: item?.type ?? null,
      name: item?.name ?? null,
      label: billingLabelFromType({ ...item, name: item?.name }),
      amount: Number(item?.amount) || 0,
      dueDate: item?.dueDate ?? null,
      periodStart: item?.periodStart ?? null,
      periodEnd: item?.periodEnd ?? null,
      chargeon: item?.chargeon ?? null
    });
    groupsByDue.set(due, list);
  }

  const groups = Array.from(groupsByDue.entries())
    .map(([dueDate, items]) => ({
      dueDate,
      total: (items || []).reduce((sum, x) => sum + (Number(x.amount) || 0), 0),
      items
    }))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  return {
    ok: true,
    clientId,
    tenancy: { _id: t.id, title: t.title, begin: t.begin, end: t.end, created_at: t.created_at },
    groups
  };
}

/**
 * Mark contact_approval completed on tenancy status JSON (Operator list uses tenancy_status_json — see tenancysetting.computeStatus).
 * Legacy: same shape may exist in column `tenancystatus` on some DBs.
 */
function mapStatusAfterTenantApprove(statusArr) {
  const now = new Date();
  return (statusArr || []).map((s) => {
    if (!s || typeof s !== 'object') return s;
    if (s.key === 'contact_approval') return { ...s, status: 'completed', updatedAt: now };
    if (s.key === 'first_payment') return { ...s, status: 'pending', updatedAt: now };
    return s;
  });
}

/**
 * Tenant approve: remove from approvalRequest, add client to tenant, update tenancy_status_json, generateFromTenancy, syncTenantForClient (stub).
 */
async function tenantApprove(email, clientId) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  const approvalRequest = Array.isArray(tenant.approvalRequest) ? tenant.approvalRequest : [];
  const filtered = approvalRequest.filter(
    (r) => !(r.clientId === clientId && r.status === 'pending')
  );
  const [clientRows] = await pool.query(
    'SELECT 1 FROM tenant_client WHERE tenant_id = ? AND client_id = ? LIMIT 1',
    [tenant._id, clientId]
  );
  if (clientRows.length === 0) {
    await pool.query(
      'INSERT IGNORE INTO tenant_client (tenant_id, client_id) VALUES (?, ?)',
      [tenant._id, clientId]
    );
  }

  await pool.query(
    'UPDATE tenantdetail SET approval_request_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(filtered), tenant._id]
  );

  const [tenancyRows] = await pool.query(
    'SELECT id FROM tenancy WHERE tenant_id = ? AND client_id = ?',
    [tenant._id, clientId]
  );

  try {
    await syncTenantForClient(email, clientId, {});
  } catch (e) {
    console.warn('[tenantdashboard] syncTenantForClient before generate (tenantApprove)', e?.message || e);
  }

  for (const t of tenancyRows) {
    try {
      const [tenRows] = await pool.query(
        'SELECT id, tenancy_status_json FROM tenancy WHERE id = ? LIMIT 1',
        [t.id]
      );
      const ten = tenRows[0];
      if (ten && ten.tenancy_status_json != null) {
        let statusArr = parseJson(ten.tenancy_status_json) || [];
        if (Array.isArray(statusArr) && statusArr.length) {
          statusArr = mapStatusAfterTenantApprove(statusArr);
          await pool.query(
            'UPDATE tenancy SET tenancy_status_json = ?, updated_at = NOW() WHERE id = ?',
            [JSON.stringify(statusArr), t.id]
          );
        }
      }
    } catch (e) {
      console.warn('[tenantdashboard] tenantApprove tenancy_status_json', e?.message || e);
    }
    try {
      const [legacyRows] = await pool.query(
        'SELECT tenancystatus FROM tenancy WHERE id = ? LIMIT 1',
        [t.id]
      );
      const raw = legacyRows[0]?.tenancystatus;
      if (raw != null) {
        let legacyArr = parseJson(raw) || [];
        if (Array.isArray(legacyArr) && legacyArr.length) {
          legacyArr = mapStatusAfterTenantApprove(legacyArr);
          await pool.query(
            'UPDATE tenancy SET tenancystatus = ?, updated_at = NOW() WHERE id = ?',
            [JSON.stringify(legacyArr), t.id]
          );
        }
      }
    } catch (_) {
      /* tenancystatus column may not exist */
    }
    try {
      await generateFromTenancyByTenancyId(t.id, tenant._id);
    } catch (e) {
      console.warn('[tenantdashboard] generateFromTenancyByTenancyId', e);
    }
  }

  return { ok: true };
}

/**
 * Tenant reject: remove from approvalRequest.
 * Scheme B: append tenant_rejected on pending-booking tenancies (billing not generated) for operator UI.
 */
async function tenantReject(email, clientId) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  const approvalRequest = Array.isArray(tenant.approvalRequest) ? tenant.approvalRequest : [];
  const filtered = approvalRequest.filter(
    (r) => !(r.clientId === clientId && r.status === 'pending')
  );
  await pool.query(
    'UPDATE tenantdetail SET approval_request_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(filtered), tenant._id]
  );

  try {
    const [pendingTenancies] = await pool.query(
      'SELECT id, remark_json FROM tenancy WHERE tenant_id = ? AND client_id = ? AND (billing_generated = 0 OR billing_generated IS NULL)',
      [tenant._id, clientId]
    );
    const now = new Date();
    for (const row of pendingTenancies || []) {
      const remarks = parseJson(row.remark_json) || [];
      const hasReject = remarks.some((e) => e && e.type === 'tenant_rejected' && e.clientId === clientId);
      if (hasReject) continue;
      remarks.push({
        type: 'tenant_rejected',
        clientId,
        at: now,
        note: 'Tenant declined operator invitation / booking'
      });
      await pool.query('UPDATE tenancy SET remark_json = ?, updated_at = NOW() WHERE id = ?', [
        JSON.stringify(remarks),
        row.id
      ]);
    }
  } catch (e) {
    console.warn('[tenantdashboard] tenantReject remark_json', e?.message || e);
  }

  return { ok: true };
}

/**
 * Generate rental from tenancy (tenant-scoped). Verifies tenancy belongs to tenant; calls booking.generateFromTenancyByTenancyId.
 */
async function generateFromTenancyForTenant(email, tenancyId) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };
  const writable = await assertTenancyPortalWritable(tenant._id, tenancyId);
  if (!writable) return { ok: false, reason: 'TENANCY_READ_ONLY' };
  try {
    await generateFromTenancyByTenancyId(tenancyId, tenant._id);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message || 'GENERATE_FAILED' };
  }
}

/**
 * Sync tenant to accounting contact for a client. Find by email/name → update or create; write to tenantdetail.account.
 * Supports bukku, xero, autocount, sql. Called when tenant agrees (client accepts mapping).
 */
async function syncTenantForClient(email, clientId, _opts) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const [linkRows] = await pool.query(
    'SELECT 1 FROM tenant_client WHERE tenant_id = ? AND client_id = ? LIMIT 1',
    [tenant._id, clientId]
  );
  if (!linkRows.length) return { ok: true };

  const [planRows] = await pool.query(
    `SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = 'plan' ORDER BY id LIMIT 1`,
    [clientId]
  );
  const planId = planRows[0]?.plan_id;
  const hasAccounting = planId && ACCOUNTING_PLAN_IDS.includes(planId);
  if (!hasAccounting) return { ok: true };

  const [intRows] = await pool.query(
    `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  const provider = intRows[0]?.provider;
  if (!provider || !['bukku', 'xero', 'autocount', 'sql'].includes(provider)) return { ok: true };

  const [tenantRows] = await pool.query(
    'SELECT id, fullname, email, phone, account FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenant._id]
  );
  const t = tenantRows[0];
  if (!t) return { ok: true };
  const account = parseJson(t.account) || [];
  const existingMapping = account.find((a) => a.clientId === clientId && a.provider === provider);
  const existingId = existingMapping?.id ?? existingMapping?.contactId;

  const record = {
    name: t.fullname || '',
    fullname: t.fullname || '',
    email: t.email || '',
    phone: t.phone || ''
  };

  const syncRes = await contactSync.ensureContactInAccounting(clientId, provider, 'tenant', record, existingId);
  if (!syncRes.ok) return { ok: false, reason: syncRes.reason || 'SYNC_FAILED' };

  const writeRes = await contactSync.writeTenantAccount(tenant._id, clientId, provider, syncRes.contactId);
  if (!writeRes.ok) return { ok: false, reason: writeRes.reason || 'WRITE_FAILED' };

  return { ok: true, contactId: syncRes.contactId };
}

/**
 * List feedback for tenant (by tenant_id). Returns array with messages thread + remark preview.
 */
async function getFeedbackListForTenant(email) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return [];

  const sqlWithMsg = `SELECT f.id, f.tenancy_id, f.description, f.photo, f.video, f.done, f.remark, f.messages_json, f.created_at, f.updated_at,
            f.room_id, f.property_id,
            rm.roomname AS room_roomname, rm.title_fld AS room_title_fld,
            p.shortname AS property_shortname
     FROM feedback f
     LEFT JOIN roomdetail rm ON rm.id = f.room_id
     LEFT JOIN propertydetail p ON p.id = f.property_id
     WHERE f.tenant_id = ?
     ORDER BY f.created_at DESC
     LIMIT 100`;
  const sqlLegacy = `SELECT f.id, f.tenancy_id, f.description, f.photo, f.video, f.done, f.remark, f.created_at, f.updated_at,
            f.room_id, f.property_id,
            rm.roomname AS room_roomname, rm.title_fld AS room_title_fld,
            p.shortname AS property_shortname
     FROM feedback f
     LEFT JOIN roomdetail rm ON rm.id = f.room_id
     LEFT JOIN propertydetail p ON p.id = f.property_id
     WHERE f.tenant_id = ?
     ORDER BY f.created_at DESC
     LIMIT 100`;

  let rows;
  try {
    ;[rows] = await pool.query(sqlWithMsg, [tenant._id]);
  } catch (e) {
    if (isMissingMessagesJsonColumn(e)) {
      ;[rows] = await pool.query(sqlLegacy, [tenant._id]);
    } else {
      throw e;
    }
  }

  return (rows || []).map((r) => {
    const lines = (r.description || '').split('\n').filter(Boolean);
    const category = lines[0] || 'General';
    const title = lines[1] || '';
    const details = lines.slice(2).join('\n') || '';
    const thread = loadFeedbackThread({
      messages_json: r.messages_json,
      remark: r.remark,
      updated_at: r.updated_at,
      created_at: r.created_at
    });
    const messages = filterMessagesVisibleToTenant(thread);
    return {
      _id: r.id,
      id: r.id,
      tenancyId: r.tenancy_id || null,
      category,
      title,
      details,
      description: r.description,
      photo: parseJson(r.photo),
      video: r.video,
      done: !!r.done,
      remark: remarkPreviewVisibleToTenant(thread) || '',
      messages,
      _createdDate: r.created_at,
      room: r.room_id ? { _id: r.room_id, roomname: r.room_roomname, title_fld: r.room_title_fld } : null,
      property: r.property_id ? { _id: r.property_id, shortname: r.property_shortname } : null
    };
  });
}

/**
 * Append a tenant message to feedback thread (messages_json). Requires migration 0134.
 */
async function appendFeedbackMessageForTenant(email, feedbackId, text, attachments) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const fid = String(feedbackId || '').trim();
  if (!fid) return { ok: false, reason: 'MISSING_ID' };
  const body = text == null ? '' : String(text || '').trim();
  const appendAttachments = Array.isArray(attachments) ? attachments : [];
  if (!body && appendAttachments.length === 0) return { ok: false, reason: 'EMPTY_MESSAGE' };

  let row;
  try {
    const [[r]] = await pool.query(
      'SELECT id, tenant_id, tenancy_id, done, messages_json, remark, created_at, updated_at FROM feedback WHERE id = ? LIMIT 1',
      [fid]
    );
    row = r;
  } catch (e) {
    if (isMissingMessagesJsonColumn(e)) {
      return { ok: false, reason: 'NEEDS_MIGRATION_0134' };
    }
    throw e;
  }
  if (!row || row.tenant_id !== tenant._id) return { ok: false, reason: 'NOT_FOUND' };
  if (row.done === 1 || row.done === true) {
    return { ok: false, reason: 'FEEDBACK_CLOSED' };
  }
  if (row.tenancy_id) {
    const allowAppend = await assertTenancyPortalWritable(tenant._id, row.tenancy_id);
    if (!allowAppend) return { ok: false, reason: 'TENANCY_READ_ONLY' };
  }

  const messages = appendMessage(loadFeedbackThread(row), 'tenant', body, { attachments: appendAttachments });
  const preview = remarkPreviewVisibleToTenant(messages) || null;
  const json = messages.length ? JSON.stringify(messages) : null;

  try {
    const [result] = await pool.query(
      'UPDATE feedback SET messages_json = ?, remark = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
      [json, preview, fid, tenant._id]
    );
    if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
    return { ok: true };
  } catch (e) {
    if (isMissingMessagesJsonColumn(e)) {
      return { ok: false, reason: 'NEEDS_MIGRATION_0134' };
    }
    throw e;
  }
}

/**
 * Insert feedback. If feedback table does not exist, returns ok: false, reason: 'FEEDBACK_TABLE_MISSING'.
 * CMS feedback: tenancy, room, property, client, description, photo, video, tenant.
 */
async function insertFeedback(email, payload) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const { tenancyId, roomId, propertyId, clientId, description, photo, video } = payload;
  const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };
  const writable = await assertTenancyPortalWritable(tenant._id, tenancyId);
  if (!writable) return { ok: false, reason: 'TENANCY_READ_ONLY' };

  try {
    await pool.query(
      `INSERT INTO feedback (id, tenancy_id, room_id, property_id, client_id, tenant_id, description, photo, video, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        tenancyId,
        roomId || null,
        propertyId || null,
        clientId || null,
        tenant._id,
        description || '',
        photo ? JSON.stringify(photo) : null,
        video || null
      ]
    );
    return { ok: true };
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return { ok: false, reason: 'FEEDBACK_TABLE_MISSING' };
    throw e;
  }
}

/**
 * Sync meter for tenant's room (CNYIoT → meterdetail). Room must belong to tenant's tenancy.
 */
async function syncMeterForTenantRoom(email, roomId) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const tenancies = await getTenanciesForTenant(tenant._id);
  const hasRoom = tenancies.some(
    (t) => t.room && (t.room._id === roomId || t.room.id === roomId || t.room === roomId)
  );
  if (!hasRoom) return { ok: false, reason: 'TENANCY_MISMATCH' };
  const room = await getRoomWithMeter(roomId);
  if (!room || !room.meter) return { ok: false, reason: 'NO_METER' };
  const clientId = room.meter.client;
  const meterId = room.meter.meterId;
  if (!clientId || !meterId) return { ok: false, reason: 'METER_NOT_CONFIGURED' };
  try {
    const result = await syncWrapper.syncMeterByCmsMeterId(clientId, String(meterId));
    return result && result.ok ? { ok: true, after: result.after } : { ok: false, reason: result?.reason || 'SYNC_FAILED' };
  } catch (e) {
    console.error('[tenantdashboard] syncMeterForTenantRoom', e?.message || e);
    return { ok: false, reason: 'SYNC_FAILED' };
  }
}

/**
 * Usage summary for tenant's room (date range). Returns { total, records, children } from CNYIoT getMonthBill.
 */
async function getUsageSummaryForTenantRoom(email, roomId, { start, end }) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const tenancies = await getTenanciesForTenant(tenant._id);
  const hasRoom = tenancies.some(
    (t) => t.room && (t.room._id === roomId || t.room.id === roomId || t.room === roomId)
  );
  if (!hasRoom) return { ok: false, reason: 'TENANCY_MISMATCH' };
  const room = await getRoomWithMeter(roomId);
  if (!room || !room.meter) return { ok: false, reason: 'NO_METER', total: 0, records: [], children: {} };
  const clientId = room.meter.client;
  const meterId = room.meter.meterId;
  if (!clientId || !meterId) return { ok: false, reason: 'METER_NOT_CONFIGURED', total: 0, records: [], children: {} };
  try {
    const summary = await meterWrapper.getUsageSummary(clientId, {
      meterIds: [String(meterId)],
      start: start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      end: end || new Date()
    });
    return {
      ok: true,
      total: summary.total ?? 0,
      records: summary.records ?? [],
      children: summary.children ?? {}
    };
  } catch (e) {
    console.error('[tenantdashboard] getUsageSummaryForTenantRoom', e?.message || e);
    return { ok: false, reason: 'USAGE_SUMMARY_FAILED', total: 0, records: [], children: {} };
  }
}

/**
 * Tenant updates handover schedule datetime on own tenancy.
 * Requires tenant has signed at least one agreement for the tenancy.
 */
async function updateTenantHandoverSchedule(email, tenancyId, { handoverCheckinAt, handoverCheckoutAt }) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };
  const writable = await assertTenancyPortalWritable(tenant._id, tenancyId);
  if (!writable) return { ok: false, reason: 'TENANCY_READ_ONLY' };

  const [agRows] = await pool.query(
    'SELECT id FROM agreement WHERE tenancy_id = ? AND tenantsign IS NOT NULL AND TRIM(tenantsign) <> "" LIMIT 1',
    [tenancyId]
  );
  if (!agRows.length) return { ok: false, reason: 'TENANT_SIGN_REQUIRED' };

  const [tenRows] = await pool.query(
    'SELECT handover_checkin_json, handover_checkout_json, client_id FROM tenancy WHERE id = ? LIMIT 1',
    [tenancyId]
  );
  if (!tenRows.length) return { ok: false, reason: 'TENANCY_NOT_FOUND' };
  const current = tenRows[0];
  const clientId = current.client_id;
  const parseObj = (v) => {
    const p = parseJson(v);
    return p && typeof p === 'object' && !Array.isArray(p) ? { ...p } : {};
  };
  const checkin = parseObj(current.handover_checkin_json);
  const checkout = parseObj(current.handover_checkout_json);
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

  let adminJson = null;
  if (clientId) {
    const [cdRows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
    adminJson = cdRows[0]?.admin ?? null;
  }
  const windowCheck = validateTenantHandoverScheduleAgainstCompanyWindow({
    handoverCheckinAt: handoverCheckinAt !== undefined ? checkin.scheduledAt : undefined,
    handoverCheckoutAt: handoverCheckoutAt !== undefined ? checkout.scheduledAt : undefined,
    adminJson
  });
  if (!windowCheck.ok) {
    return {
      ok: false,
      reason: windowCheck.reason,
      message: windowCheck.message,
      ...(windowCheck.window ? { window: windowCheck.window } : {})
    };
  }

  const newCheckinNorm = normalizeScheduleForLog(checkin.scheduledAt);
  const newCheckoutNorm = normalizeScheduleForLog(checkout.scheduledAt);
  if (handoverCheckinAt !== undefined && oldCheckinNorm !== newCheckinNorm && clientId) {
    await appendHandoverScheduleLog({
      clientId,
      tenancyId,
      field: 'checkin',
      oldValue: oldCheckinNorm,
      newValue: newCheckinNorm,
      actorEmail: email,
      actorType: 'tenant'
    });
  }
  if (handoverCheckoutAt !== undefined && oldCheckoutNorm !== newCheckoutNorm && clientId) {
    await appendHandoverScheduleLog({
      clientId,
      tenancyId,
      field: 'checkout',
      oldValue: oldCheckoutNorm,
      newValue: newCheckoutNorm,
      actorEmail: email,
      actorType: 'tenant'
    });
  }
  await pool.query(
    'UPDATE tenancy SET handover_checkin_json = ?, handover_checkout_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(checkin), JSON.stringify(checkout), tenancyId]
  ).catch((e) => {
    if (isUnknownColumnError(e)) {
      throw new Error('HANDOVER_COLUMN_MISSING');
    }
    throw e;
  });
  return { ok: true };
}

/**
 * Tenant removes saved card / Xendit token and auto-debit flags. Stripe: detach pm_* first when present.
 * @param {string} email
 * @param {string} tenancyId
 */
async function disconnectTenantPaymentMethod(email, tenancyId) {
  if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };
  const writable = await assertTenancyPortalWritable(tenant._id, tenancyId);
  if (!writable) return { ok: false, reason: 'TENANCY_READ_ONLY' };
  const [tenancyRows] = await pool.query('SELECT client_id FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
  if (!tenancyRows.length || !tenancyRows[0].client_id) {
    return { ok: false, reason: 'TENANCY_NOT_FOUND' };
  }
  const clientId = tenancyRows[0].client_id;
  const tenantId = tenant._id;

  const [tRows] = await pool.query('SELECT profile FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
  if (!tRows.length) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  let profile = parseJson(tRows[0].profile);
  if (!profile || Array.isArray(profile)) profile = {};

  const pmId = profile.stripe_payment_method_id ? String(profile.stripe_payment_method_id).trim() : '';
  if (pmId) {
    const { disconnectTenantStripePaymentMethod } = require('../stripe/stripe.service');
    await disconnectTenantStripePaymentMethod(clientId, pmId);
  }

  delete profile.stripe_customer_id;
  delete profile.stripe_payment_method_id;
  delete profile.payment_method_linked;
  delete profile.payment_method_linked_at;
  profile.rent_auto_debit_enabled = false;
  profile.xendit_auto_debit = false;
  delete profile.xendit_payment_token_id;
  delete profile.xendit_bind_type;

  await pool.query('UPDATE tenantdetail SET profile = ?, updated_at = NOW() WHERE id = ?', [
    JSON.stringify(profile),
    tenantId
  ]);

  return { ok: true };
}

/** Tenant cleaning: how staff may enter the room (stored on rentalcollection.description JSON + title suffix). */
const TENANT_CLEANING_ACCESS = {
  DOOR_UNLOCKED: 'door_unlocked',
  OTHER: 'other'
};

function truncateUtf16(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + '…';
}

function buildCleaningTitleWithAccess(dateStr, timeStr, roomAccessMode, roomAccessDetail) {
  const base = `Cleaning — ${dateStr} ${timeStr} (Malaysia)`;
  let suffix = '';
  if (roomAccessMode === TENANT_CLEANING_ACCESS.DOOR_UNLOCKED) {
    suffix = ' · Access: Did not lock the door';
  } else if (roomAccessMode === TENANT_CLEANING_ACCESS.OTHER && String(roomAccessDetail || '').trim()) {
    suffix = ` · Access: ${truncateUtf16(roomAccessDetail, 160)}`;
  }
  const full = base + suffix;
  return full.length > 255 ? truncateUtf16(full, 255) : full;
}

function buildCleaningRequestDescriptionJson({
  scheduledDate,
  scheduledTime,
  roomAccessMode,
  roomAccessDetail
}) {
  return JSON.stringify({
    cleaningTenantRequest: {
      businessTimeZone: 'Asia/Kuala_Lumpur',
      scheduledDate: String(scheduledDate || '').slice(0, 10),
      scheduledTime: String(scheduledTime || '09:00').trim(),
      roomAccessMode,
      roomAccessDetail:
        roomAccessMode === TENANT_CLEANING_ACCESS.OTHER
          ? String(roomAccessDetail || '').trim()
          : null
    }
  });
}

function mysqlDateValueToYmd(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function parseTenantCleaningRequestMeta(description, title) {
  const fallback = { scheduledDate: null, scheduledTime: null, roomAccessMode: null, roomAccessDetail: null };
  if (description != null && String(description).trim() !== '') {
    try {
      const o = JSON.parse(description);
      const m = o && typeof o === 'object' ? o.cleaningTenantRequest : null;
      if (m && typeof m === 'object') {
        return {
          scheduledDate: m.scheduledDate != null ? String(m.scheduledDate).slice(0, 10) : null,
          scheduledTime: m.scheduledTime != null ? String(m.scheduledTime).trim() : null,
          roomAccessMode: m.roomAccessMode != null ? String(m.roomAccessMode).trim() : null,
          roomAccessDetail: m.roomAccessDetail != null ? String(m.roomAccessDetail) : null
        };
      }
    } catch {
      /* fall through */
    }
  }
  const t = String(title || '');
  const m = t.match(/^Cleaning — (\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s+\(Malaysia\)/);
  if (m) {
    return {
      ...fallback,
      scheduledDate: m[1],
      scheduledTime: m[2].length === 5 ? m[2] : m[2]
    };
  }
  return fallback;
}

/**
 * Latest tenant cleaning charge row for a tenancy (same account type as {@link createTenantCleaningOrder}).
 */
async function getLatestTenantCleaningOrder(email, { tenancyId } = {}) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
  const belongs = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
  if (!belongs) return { ok: false, reason: 'TENANCY_MISMATCH' };

  const { resolveTenantCleaningAccountTypeId } = require('../coliving-cleanlemons/coliving-cleanlemons-cleaning.service');
  const [[ten]] = await pool.query('SELECT client_id FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
  if (!ten) return { ok: false, reason: 'TENANCY_NOT_FOUND' };
  const cleaningTypeId = await resolveTenantCleaningAccountTypeId(ten.client_id);

  const [rows] = await pool.query(
    `SELECT id, created_at, date, title, description
       FROM rentalcollection
      WHERE tenancy_id = ? AND tenant_id = ? AND type_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenancyId, tenant._id, cleaningTypeId]
  );
  const row = rows && rows[0];
  if (!row) return { ok: true, item: null };

  const meta = parseTenantCleaningRequestMeta(row.description, row.title);
  let createdAt = null;
  if (row.created_at != null) {
    createdAt =
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  }
  const billDateYmd = mysqlDateValueToYmd(row.date);
  return {
    ok: true,
    item: {
      id: row.id,
      createdAt,
      preferredDate: billDateYmd || meta.scheduledDate,
      scheduledDate: meta.scheduledDate || billDateYmd,
      scheduledTime: meta.scheduledTime,
      roomAccessMode: meta.roomAccessMode,
      roomAccessDetail: meta.roomAccessDetail
    }
  };
}

/**
 * Tenant orders one-off cleaning: rentalcollection + optional accounting invoice (same pipeline as rent charges).
 * Amount = operator-set price on room/property; never from client body.
 * `type_id` resolves per operator `account` row (Cleaning Services); not used for operator-scheduled jobs.
 */
async function createTenantCleaningOrder(
  email,
  { tenancyId, scheduledDate, scheduledTime, roomAccessMode, roomAccessDetail } = {}
) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
  const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };
  const writable = await assertTenancyPortalWritable(tenant._id, tenancyId);
  if (!writable) return { ok: false, reason: 'TENANCY_READ_ONLY' };

  const {
    getTenantCleaningPriceForTenancy,
    resolveTenantCleaningAccountTypeId
  } = require('../coliving-cleanlemons/coliving-cleanlemons-cleaning.service');
  const priced = await getTenantCleaningPriceForTenancy(tenancyId);
  if (priced.price == null || priced.price <= 0) {
    return { ok: false, reason: 'CLEANING_PRICE_NOT_CONFIGURED' };
  }

  const [[ten]] = await pool.query(
    'SELECT tenant_id, client_id, room_id FROM tenancy WHERE id = ? LIMIT 1',
    [tenancyId]
  );
  if (!ten) return { ok: false, reason: 'TENANCY_NOT_FOUND' };

  const cleaningTypeId = await resolveTenantCleaningAccountTypeId(ten.client_id);

  const dateStr = String(scheduledDate || '').slice(0, 10);
  const timeStr = scheduledTime != null && String(scheduledTime).trim() !== '' ? String(scheduledTime).trim() : '09:00';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { ok: false, reason: 'INVALID_DATE' };
  }

  const modeRaw = String(roomAccessMode || '').trim();
  const accessMode =
    modeRaw === TENANT_CLEANING_ACCESS.OTHER
      ? TENANT_CLEANING_ACCESS.OTHER
      : TENANT_CLEANING_ACCESS.DOOR_UNLOCKED;
  if (accessMode === TENANT_CLEANING_ACCESS.OTHER) {
    const detail = String(roomAccessDetail || '').trim();
    if (!detail) return { ok: false, reason: 'INVALID_ROOM_ACCESS_DETAIL' };
  }

  const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
  const rcDate = dateStr || getTodayMalaysiaDate();
  const id = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const title = buildCleaningTitleWithAccess(dateStr, timeStr, accessMode, roomAccessDetail);
  const descriptionJson = buildCleaningRequestDescriptionJson({
    scheduledDate: dateStr,
    scheduledTime: timeStr,
    roomAccessMode: accessMode,
    roomAccessDetail: accessMode === TENANT_CLEANING_ACCESS.OTHER ? String(roomAccessDetail || '').trim() : null
  });

  await pool.query(
    `INSERT INTO rentalcollection (id, tenancy_id, tenant_id, room_id, property_id, client_id, type_id, amount, date, title, description, ispaid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      tenancyId,
      ten.tenant_id,
      ten.room_id,
      priced.propertyId,
      ten.client_id,
      cleaningTypeId,
      priced.price,
      rcDate,
      title,
      descriptionJson,
      now,
      now
    ]
  );

  const { createInvoicesForRentalRecords } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
  try {
    await createInvoicesForRentalRecords(ten.client_id, [
      {
        id,
        client_id: ten.client_id,
        tenancy_id: tenancyId,
        tenant_id: ten.tenant_id,
        room_id: ten.room_id,
        property_id: priced.propertyId,
        type_id: cleaningTypeId,
        amount: priced.price,
        date: rcDate,
        title
      }
    ]);
  } catch (e) {
    console.warn('[tenantdashboard] createInvoicesForRentalRecords cleaning', e?.message || e);
  }

  return { ok: true, rentalcollectionId: id };
}

module.exports = {
  getTenantByEmail,
  computeRequiresPaymentMethodLink,
  getTenantPaymentMethodPolicyForClientId,
  getTenanciesForTenant,
  getClientsByIds,
  getRoomWithMeter,
  getPropertyWithSmartdoor,
  getBanks,
  updateTenantProfile,
  getAgreementHtml,
  updateAgreementTenantSign,
  getAgreementByIdForTenant,
  getRentalListForTenancy,
  getApprovalDetail,
  tenantApprove,
  tenantReject,
  generateFromTenancyForTenant,
  syncTenantForClient,
  insertFeedback,
  getFeedbackListForTenant,
  appendFeedbackMessageForTenant,
  assertTenancyBelongsToTenant,
  assertTenancyPortalWritable,
  remoteUnlockForTenant,
  getPasscodeForTenant,
  savePasscodeForTenant,
  getOverdueTenancyIds,
  getHasOverduePayment,
  requestEmailChange,
  confirmEmailChange,
  syncMeterForTenantRoom,
  getUsageSummaryForTenantRoom,
  updateTenantHandoverSchedule,
  disconnectTenantPaymentMethod,
  createTenantCleaningOrder,
  getLatestTenantCleaningOrder
};
