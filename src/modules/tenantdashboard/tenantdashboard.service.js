/**
 * Tenant Dashboard – for Wix tenant dashboard page (租客仪表盘).
 * Uses MySQL: tenantdetail, tenancy, roomdetail, propertydetail, clientdetail,
 * bankdetail, agreement, agreementtemplate, rentalcollection, meterdetail, lockdetail.
 * All operations resolve tenant by email (tenantdetail.email) and verify tenancy belongs to tenant.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { getOwnerTenantAgreementHtml } = require('../agreement/agreement.service');
const { generateFromTenancyByTenancyId } = require('../booking/booking.service');
const { ACCOUNTING_PLAN_IDS } = require('../access/access.service');
const contactSync = require('../contact/contact-sync.service');

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
            nricfront, nricback, approval_request_json, account
       FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    [norm]
  );
  const r = rows[0];
  if (!r) return null;
  let profile = null;
  try {
    const [pRows] = await pool.query('SELECT profile FROM tenantdetail WHERE id = ? LIMIT 1', [r.id]);
    if (pRows && pRows[0] && pRows[0].profile != null) profile = parseJson(pRows[0].profile);
  } catch (_) { /* profile column may not exist */ }
  return {
    _id: r.id,
    id: r.id,
    fullname: r.fullname,
    email: r.email,
    phone: r.phone,
    address: r.address,
    nric: r.nric,
    bankName: r.bankname_id,
    bankAccount: r.bankaccount,
    accountholder: r.accountholder,
    nricFront: r.nricfront,
    nricback: r.nricback,
    approvalRequest: parseJson(r.approval_request_json),
    profile,
    account: parseJson(r.account)
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

/**
 * Get tenancies for tenant (status = 1), with property, client, room, and agreements.
 */
async function getTenanciesForTenant(tenantId) {
  if (!tenantId) return [];
  const [rows] = await pool.query(
    `SELECT t.id, t.tenant_id, t.room_id, t.client_id, t.begin, t.\`end\`, t.rental, t.agreement,
            p.id AS property_id, p.shortname AS property_shortname,
            c.id AS client_id, c.title AS client_title, c.currency AS client_currency,
            r.id AS room_id, r.roomname AS room_roomname, r.title_fld AS room_title_fld,
            td.fullname AS tenant_fullname
       FROM tenancy t
       LEFT JOIN roomdetail r ON r.id = t.room_id
       LEFT JOIN propertydetail p ON p.id = r.property_id
       LEFT JOIN clientdetail c ON c.id = t.client_id
       LEFT JOIN tenantdetail td ON td.id = t.tenant_id
       WHERE t.tenant_id = ? AND (t.status = 1 OR t.status IS NULL)
       ORDER BY t.begin DESC
       LIMIT 1000`,
    [tenantId]
  );

  const tenancyIds = (rows || []).map((x) => x.id);
  let agreementMap = {};
  if (tenancyIds.length) {
    const placeholders = tenancyIds.map(() => '?').join(',');
    const [agRows] = await pool.query(
      `SELECT id, tenancy_id, agreementtemplate_id, mode, status, ownersign, owner_signed_at, tenantsign, pdfurl, url, created_at
         FROM agreement
         WHERE tenancy_id IN (${placeholders})
           AND status IN ('ready_for_signature', 'locked', 'completed')
           AND (url IS NOT NULL OR pdfurl IS NOT NULL)
         ORDER BY created_at DESC`,
      tenancyIds
    );
    for (const a of agRows || []) {
      if (!agreementMap[a.tenancy_id]) agreementMap[a.tenancy_id] = [];
      agreementMap[a.tenancy_id].push({
        _id: a.id,
        _createdDate: a.created_at,
        agreementtemplate_id: a.agreementtemplate_id,
        mode: a.mode,
        tenantsign: a.tenantsign,
        ownersign: a.ownersign,
        operatorsign: a.ownersign,
        url: a.url || a.pdfurl
      });
    }
  }

  const clientIds = [...new Set((rows || []).map((r) => r.client_id).filter(Boolean))];
  let contactByClient = {};
  if (clientIds.length > 0) {
    const ph = clientIds.map(() => '?').join(',');
    const [profileRows] = await pool.query(
      `SELECT client_id, contact FROM client_profile WHERE client_id IN (${ph})`,
      clientIds
    );
    for (const r of profileRows || []) {
      if (r.contact != null && String(r.contact).trim() !== '') {
        contactByClient[r.client_id] = String(r.contact).trim().replace(/\D/g, '');
      }
    }
  }

  return (rows || []).map(t => {
    const agreements = agreementMap[t.id] || [];
    const clientContact = t.client_id ? contactByClient[t.client_id] || null : null;
    return {
      _id: t.id,
      id: t.id,
      begin: t.begin,
      end: t.end,
      rental: t.rental,
      tenant: t.tenant_id ? { _id: t.tenant_id, fullname: t.tenant_fullname || '' } : null,
      room: t.room_id ? { _id: t.room_id, title_fld: t.room_title_fld, roomname: t.room_roomname } : null,
      property: t.property_id ? { _id: t.property_id, shortname: t.property_shortname } : null,
      client: t.client_id ? { _id: t.client_id, title: t.client_title, currency: t.client_currency, contact: clientContact } : null,
      tenancystatus: t.tenancystatus != null ? parseJson(t.tenancystatus) : null,
      passcodes: t.passcodes != null ? parseJson(t.passcodes) : null,
      agreements
    };
  });
}

/**
 * Get clients by ids (for approval list). No tenant check needed if clientIds come from tenant's approvalRequest.
 */
async function getClientsByIds(clientIds) {
  if (!Array.isArray(clientIds) || clientIds.length === 0) return [];
  const placeholders = clientIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, title, email, currency FROM clientdetail WHERE id IN (${placeholders})`,
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

/**
 * Get property with smartdoor (property + room smartdoor). lockId from property lockdetail or room lockdetail.
 */
async function getPropertyWithSmartdoor(propertyId, roomId) {
  if (!propertyId) return null;
  const [pRows] = await pool.query(
    `SELECT p.id, p.shortname, p.apartmentname, p.unitnumber,
            pl.id AS lock_id, pl.lockid AS lock_lockid
       FROM propertydetail p
       LEFT JOIN lockdetail pl ON pl.id = p.smartdoor_id
       WHERE p.id = ? LIMIT 1`,
    [propertyId]
  );
  const p = pRows[0];
  if (!p) return null;
  const property = {
    _id: p.id,
    id: p.id,
    shortname: p.shortname || p.apartmentname || p.unitnumber,
    smartdoor: p.lock_id ? { lockId: p.lock_lockid } : null
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
      const profileJson = (payload.profile != null && typeof payload.profile === 'object') ? JSON.stringify(payload.profile) : null;
      if (profileJson != null) {
        await pool.query('UPDATE tenantdetail SET profile = ?, updated_at = NOW() WHERE id = ?', [profileJson, id]);
      }
    } catch (_) { /* profile column may not exist */ }
    const created = await getTenantByEmail(email);
    return { ok: true, tenant: created };
  }

  const updates = [];
  const params = [];
  const dbMap = {
    fullname: 'fullname',
    email: 'email',
    phone: 'phone',
    address: 'address',
    nric: 'nric',
    bankName: 'bankname_id',
    bankAccount: 'bankaccount',
    accountholder: 'accountholder',
    nricFront: 'nricfront',
    nricback: 'nricback'
  };
  const allowed = Object.keys(dbMap);
  for (const key of allowed) {
    if (payload[key] !== undefined) {
      updates.push(`${dbMap[key]} = ?`);
      const val = key === 'email' ? (payload[key] || '').toString().trim().toLowerCase() : payload[key];
      params.push(val);
    }
  }
  if (updates.length > 0) {
    params.push(tenant._id);
    await pool.query(
      `UPDATE tenantdetail SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );
  }
  if (payload.profile !== undefined && typeof payload.profile === 'object') {
    try {
      await pool.query('UPDATE tenantdetail SET profile = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(payload.profile), tenant._id]);
    } catch (_) { /* profile column may not exist */ }
  }
  const updated = await getTenantByEmail(email);
  return { ok: true, tenant: updated };
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
    'SELECT id, tenancy_id, mode, ownersign, operatorsign, columns_locked FROM agreement WHERE id = ? LIMIT 1',
    [agreementId]
  );
  const ag = rows[0];
  if (!ag) return { ok: false, reason: 'AGREEMENT_NOT_FOUND' };
  if (ag.columns_locked) return { ok: false, reason: 'AGREEMENT_COMPLETED' };
  const ok = await assertTenancyBelongsToTenant(tenant._id, ag.tenancy_id);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };

  const updates = ['tenantsign = ?', 'tenant_signed_ip = ?'];
  const ip = tenantSignedIp != null ? String(tenantSignedIp).trim().slice(0, 45) : null;
  const params = [tenantsign, ip || null];
  if (status !== undefined) {
    updates.push('status = ?');
    params.push(status);
  }
  params.push(agreementId);
  await pool.query(
    `UPDATE agreement SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
    params
  );
  return { ok: true };
}

/**
 * Get agreement by id (for tenant). Verifies tenancy belongs to tenant.
 */
async function getAgreementByIdForTenant(email, agreementId) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return null;
  const [rows] = await pool.query(
    'SELECT id, tenancy_id, mode, status, ownersign, tenantsign, pdfurl FROM agreement WHERE id = ? LIMIT 1',
    [agreementId]
  );
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
    url: r.pdfurl
  };
}

/**
 * List rental collection for tenancy (payment list). Excludes certain type_id. Verifies tenancy belongs to tenant.
 */
async function getRentalListForTenancy(email, tenancyId) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND', items: [] };
  const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH', items: [] };

  const [rows] = await pool.query(
    `SELECT r.id, r.tenancy_id, r.property_id, r.amount, r.date, r.title, r.ispaid, r.invoiceurl, r.receipturl, r.type_id,
            p.shortname AS property_shortname
       FROM rentalcollection r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       WHERE r.tenancy_id = ? ORDER BY r.date ASC LIMIT 1000`,
    [tenancyId]
  );

  let items = (rows || []).filter((i) => !RENTAL_EXCLUDED_TYPE_IDS.includes(i.type_id));
  items = items.map((i) => ({
    _id: i.id,
    property: i.property_id ? { _id: i.property_id, shortname: i.property_shortname } : null,
    amount: i.amount,
    dueDate: i.date,
    title: i.title,
    isPaid: !!(i.ispaid === 1 || i.ispaid === true),
    invoiceurl: i.invoiceurl,
    receipturl: i.receipturl
  }));
  return { ok: true, items };
}

/**
 * Tenant approve: remove from approvalRequest, add client to tenant, update tenancy tenancystatus, generateFromTenancy, syncTenantForClient (stub).
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
  for (const t of tenancyRows) {
    try {
      const [tenRows] = await pool.query(
        'SELECT id, tenancystatus FROM tenancy WHERE id = ? LIMIT 1',
        [t.id]
      );
      const ten = tenRows[0];
      if (ten && ten.tenancystatus != null) {
        let statusArr = parseJson(ten.tenancystatus) || [];
        statusArr = statusArr.map((s) => {
          if (s.key === 'contact_approval') return { ...s, status: 'completed', updatedAt: new Date() };
          if (s.key === 'first_payment') return { ...s, status: 'pending', updatedAt: new Date() };
          return s;
        });
        await pool.query(
          'UPDATE tenancy SET tenancystatus = ?, updated_at = NOW() WHERE id = ?',
          [JSON.stringify(statusArr), t.id]
        );
      }
    } catch (_) { /* tenancystatus column may not exist */ }
    try {
      await generateFromTenancyByTenancyId(t.id, tenant._id);
    } catch (e) {
      console.warn('[tenantdashboard] generateFromTenancyByTenancyId', e);
    }
  }

  // When tenant approves this client: if client has account integration + pricing plan, sync contact (find by email/name or create) and write tenantdetail.account.
  try {
    await syncTenantForClient(email, clientId, {});
  } catch (e) {
    console.warn('[tenantdashboard] syncTenantForClient after tenantApprove', e);
  }

  return { ok: true };
}

/**
 * Tenant reject: remove from approvalRequest.
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
    'SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? LIMIT 1',
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
 * Insert feedback. If feedback table does not exist, returns ok: false, reason: 'FEEDBACK_TABLE_MISSING'.
 * CMS feedback: tenancy, room, property, client, description, photo, video, tenant.
 */
async function insertFeedback(email, payload) {
  const tenant = await getTenantByEmail(email);
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const { tenancyId, roomId, propertyId, clientId, description, photo, video } = payload;
  const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
  if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };

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

module.exports = {
  getTenantByEmail,
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
  tenantApprove,
  tenantReject,
  generateFromTenancyForTenant,
  syncTenantForClient,
  insertFeedback,
  assertTenancyBelongsToTenant
};
