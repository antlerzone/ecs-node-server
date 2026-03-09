/**
 * Owner Portal – migrated from Wix Owner Detail + CMS.
 * Uses MySQL: ownerdetail, propertydetail, roomdetail, tenancy, tenantdetail, clientdetail,
 * bankdetail, ownerpayout, bills, agreement, agreementtemplate, client_integration, client_pricingplan_detail.
 * All endpoints require email; owner is resolved by email (ownerdetail.email).
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { ACCOUNTING_PLAN_IDS } = require('../access/access.service');
const contactSync = require('../contact/contact-sync.service');
const { malaysiaDateRangeToUtcForQuery } = require('../../utils/dateMalaysia');

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

/**
 * Get property ids for an owner from junction table owner_property (one owner -> many properties).
 */
async function getPropertyIdsByOwnerIdFromJunction(ownerId) {
  if (ownerId == null) return [];
  const [rows] = await pool.query(
    'SELECT property_id FROM owner_property WHERE owner_id = ? ORDER BY property_id',
    [ownerId]
  );
  return (rows || []).map((x) => x.property_id);
}

/**
 * Get client ids for an owner from junction table owner_client (one owner -> many clients).
 */
async function getClientIdsByOwnerIdFromJunction(ownerId) {
  if (ownerId == null) return [];
  const [rows] = await pool.query(
    'SELECT client_id FROM owner_client WHERE owner_id = ? ORDER BY client_id',
    [ownerId]
  );
  return (rows || []).map((x) => x.client_id);
}

/**
 * Enrich approvalpending entries with clientName (clientdetail.title) and propertyShortname (propertydetail.shortname) for owner portal display.
 */
async function enrichApprovalPending(approvalpending) {
  if (!Array.isArray(approvalpending) || approvalpending.length === 0) return approvalpending;
  const clientIds = [...new Set(approvalpending.map(p => p.clientId || p.clientid).filter(Boolean))];
  const propertyIds = [...new Set(approvalpending.map(p => p.propertyId || p.propertyid).filter(Boolean))];
  const clientMap = {};
  const propertyMap = {};
  if (clientIds.length) {
    const placeholders = clientIds.map(() => '?').join(',');
    const [cRows] = await pool.query(
      `SELECT id, title FROM clientdetail WHERE id IN (${placeholders})`,
      clientIds
    );
    (cRows || []).forEach(c => { clientMap[c.id] = { title: c.title || 'Operator' }; });
  }
  if (propertyIds.length) {
    const placeholders = propertyIds.map(() => '?').join(',');
    const [pRows] = await pool.query(
      `SELECT id, shortname FROM propertydetail WHERE id IN (${placeholders})`,
      propertyIds
    );
    (pRows || []).forEach(p => { propertyMap[p.id] = { shortname: p.shortname || 'Property' }; });
  }
  return approvalpending.map(p => {
    const cid = p.clientId || p.clientid;
    const pid = p.propertyId || p.propertyid;
    return {
      ...p,
      clientName: (cid && clientMap[cid]) ? clientMap[cid].title : 'Operator',
      propertyShortname: (pid && propertyMap[pid]) ? propertyMap[pid].shortname : 'Property'
    };
  });
}

/**
 * Resolve owner by email. Returns null if not found.
 * Returns owner with property and client as arrays from junction tables (owner_property, owner_client);
 * falls back to propertydetail.owner_id when junction has no properties.
 * approvalpending is enriched with clientName and propertyShortname for portal display.
 */
async function getOwnerByEmail(email) {
  if (!email || !String(email).trim()) return null;
  const [rows] = await pool.query(
    `SELECT id, ownername, nric, email, mobilenumber, bankname_id, bankaccount, accountholder,
            nricfront, nricback, signature, profile, approvalpending, account,
            property_id, client_id
       FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    [String(email).trim().toLowerCase()]
  );
  const r = rows[0];
  if (!r) return null;
  let propertyIds = await getPropertyIdsByOwnerIdFromJunction(r.id);
  let clientIds = await getClientIdsByOwnerIdFromJunction(r.id);
  if (propertyIds.length === 0) propertyIds = await getPropertyIdsByOwnerId(r.id);
  if (propertyIds.length === 0 && r.property_id) propertyIds = [r.property_id];
  if (clientIds.length === 0 && r.client_id) clientIds = [r.client_id];
  let approvalpending = parseJson(r.approvalpending);
  if (Array.isArray(approvalpending) && approvalpending.length > 0) {
    approvalpending = await enrichApprovalPending(approvalpending);
  } else {
    approvalpending = approvalpending || [];
  }
  return {
    _id: r.id,
    id: r.id,
    ownerName: r.ownername,
    nric: r.nric,
    email: r.email,
    mobileNumber: r.mobilenumber,
    bankName: r.bankname_id,
    bankAccount: r.bankaccount,
    accountholder: r.accountholder,
    nricFront: r.nricfront,
    nricback: r.nricback,
    signature: r.signature,
    profile: parseJson(r.profile),
    approvalpending,
    account: parseJson(r.account),
    property: propertyIds,
    client: clientIds
  };
}

/**
 * Get property ids by owner id (from propertydetail.owner_id). Used when ownerdetail.property_id is empty.
 */
async function getPropertyIdsByOwnerId(ownerId) {
  if (ownerId == null) return [];
  const [rows] = await pool.query(
    'SELECT id FROM propertydetail WHERE owner_id = ? ORDER BY id',
    [ownerId]
  );
  return (rows || []).map(r => r.id);
}

/**
 * Get properties by ids. Returns array of { _id, shortname, ... }.
 */
async function getPropertiesByIds(propertyIds) {
  if (!Array.isArray(propertyIds) || propertyIds.length === 0) return [];
  const placeholders = propertyIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, shortname, apartmentname, unitnumber, address, client_id, owner_id
       FROM propertydetail WHERE id IN (${placeholders})`,
    propertyIds
  );
  return (rows || []).map(p => ({
    _id: p.id,
    id: p.id,
    shortname: p.shortname || p.apartmentname || p.unitnumber || 'Unnamed',
    client_id: p.client_id,
    owner_id: p.owner_id
  }));
}

/**
 * Get rooms by property ids. Returns array with property ref.
 */
async function getRoomsByPropertyIds(propertyIds) {
  if (!Array.isArray(propertyIds) || propertyIds.length === 0) return [];
  const placeholders = propertyIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT r.id, r.roomname, r.property_id, p.shortname AS property_shortname
       FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       WHERE r.property_id IN (${placeholders})`,
    propertyIds
  );
  return (rows || []).map(r => ({
    _id: r.id,
    id: r.id,
    roomName: r.roomname,
    property: r.property_id ? { _id: r.property_id, shortname: r.property_shortname } : null
  }));
}

/**
 * Get tenancies by room ids. Include tenant, property, client for display.
 */
async function getTenanciesByRoomIds(roomIds) {
  if (!Array.isArray(roomIds) || roomIds.length === 0) return [];
  const placeholders = roomIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT t.id, t.tenant_id, t.room_id, t.begin, t.\`end\`, t.rental,
            tn.fullname AS tenant_fullname,
            p.id AS property_id, p.shortname AS property_shortname,
            c.id AS client_id, c.currency AS client_currency
       FROM tenancy t
       LEFT JOIN tenantdetail tn ON tn.id = t.tenant_id
       LEFT JOIN roomdetail r ON r.id = t.room_id
       LEFT JOIN propertydetail p ON p.id = r.property_id
       LEFT JOIN clientdetail c ON c.id = p.client_id
       WHERE t.room_id IN (${placeholders})`,
    roomIds
  );
  return (rows || []).map(t => ({
    _id: t.id,
    id: t.id,
    room: t.room_id,
    begin: t.begin,
    end: t.end,
    rental: t.rental,
    tenant: t.tenant_id ? { _id: t.tenant_id, fullname: t.tenant_fullname } : null,
    property: t.property_id ? { _id: t.property_id, shortname: t.property_shortname } : null,
    client: t.client_id ? { _id: t.client_id, currency: t.client_currency } : null
  }));
}

/**
 * Get clientdetail rows by ids (for operator dropdown). Returns { items: [...] }.
 */
async function getClientsByIds(clientIds) {
  if (!Array.isArray(clientIds) || clientIds.length === 0) return { items: [] };
  const placeholders = clientIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    'SELECT id, title, email, currency FROM clientdetail WHERE id IN (' + placeholders + ') ORDER BY title',
    clientIds
  );
  const items = (rows || []).map(c => ({
    _id: c.id,
    id: c.id,
    title: c.title || 'Unnamed Operator'
  }));
  return { items };
}

/**
 * Get banks list. Returns { items: [{ _id, bankname }] }.
 */
async function getBanks() {
  const [rows] = await pool.query(
    'SELECT id, bankname FROM bankdetail ORDER BY bankname ASC'
  );
  const items = (rows || []).map(b => ({
    _id: b.id,
    bankname: b.bankname || ''
  }));
  return { ok: true, items };
}

/**
 * Update owner profile (and optionally approvalpending, account). Only owner identified by email can update.
 */
async function updateOwnerProfile(email, payload) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const id = owner._id;

  const updates = [];
  const params = [];
  const allowed = [
    'ownerName', 'mobileNumber', 'nric', 'bankAccount', 'accountholder', 'bankName',
    'nricFront', 'nricback', 'profile', 'approvalpending', 'account'
  ];
  const dbMap = {
    ownerName: 'ownername',
    mobileNumber: 'mobilenumber',
    bankName: 'bankname_id',
    nricFront: 'nricfront'
  };

  if (payload.ownerName !== undefined) { updates.push('ownername = ?'); params.push(payload.ownerName); }
  if (payload.email !== undefined) { updates.push('email = ?'); params.push((payload.email || '').toString().trim().toLowerCase()); }
  if (payload.mobileNumber !== undefined) { updates.push('mobilenumber = ?'); params.push(payload.mobileNumber); }
  if (payload.nric !== undefined) { updates.push('nric = ?'); params.push(payload.nric); }
  if (payload.bankAccount !== undefined) { updates.push('bankaccount = ?'); params.push(payload.bankAccount); }
  if (payload.accountholder !== undefined) { updates.push('accountholder = ?'); params.push(payload.accountholder); }
  if (payload.bankName !== undefined) { updates.push('bankname_id = ?'); params.push(payload.bankName); }
  if (payload.nricFront !== undefined) { updates.push('nricfront = ?'); params.push(payload.nricFront); }
  if (payload.nricback !== undefined) { updates.push('nricback = ?'); params.push(payload.nricback); }
  if (payload.profile !== undefined) {
    updates.push('profile = ?');
    params.push(typeof payload.profile === 'string' ? payload.profile : JSON.stringify(payload.profile || {}));
  }
  if (payload.approvalpending !== undefined) {
    updates.push('approvalpending = ?');
    params.push(typeof payload.approvalpending === 'string' ? payload.approvalpending : JSON.stringify(payload.approvalpending || []));
  }
  if (payload.account !== undefined) {
    updates.push('account = ?');
    params.push(typeof payload.account === 'string' ? payload.account : JSON.stringify(payload.account || []));
  }

  if (updates.length === 0) return { ok: true, owner: await getOwnerByEmail(email) };
  params.push(id);
  await pool.query(
    `UPDATE ownerdetail SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
    params
  );
  return { ok: true, owner: await getOwnerByEmail(email) };
}

/**
 * Owner payout list by property and period range. Returns { items: [...] }.
 * startDate/endDate 来自 datepicker，视为 UTC+8 日历日；查询时转为 UTC 范围与 DB (UTC) 比较。
 */
async function getOwnerPayoutList(email, { propertyId, startDate, endDate }) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const fromStr = startDate && String(startDate).trim().substring(0, 10);
  const toStr = endDate && String(endDate).trim().substring(0, 10);
  const { fromUtc, toUtc } = malaysiaDateRangeToUtcForQuery(fromStr || null, toStr || null);
  if (!fromUtc || !toUtc) return { ok: false, reason: 'START_END_DATE_REQUIRED' };
  const [rows] = await pool.query(
    `SELECT id, property_id, period, totalrental, totalutility, totalcollection, expenses, netpayout, monthlyreport
       FROM ownerpayout
       WHERE property_id = ? AND period >= ? AND period <= ?
       ORDER BY period ASC`,
    [propertyId, fromUtc, toUtc]
  );
  const items = (rows || []).map(r => ({
    _id: r.id,
    period: r.period,
    totalrental: r.totalrental,
    totalutility: r.totalutility,
    totalcollection: r.totalcollection,
    expenses: r.expenses,
    netpayout: r.netpayout,
    monthlyreport: r.monthlyreport
  }));
  return { ok: true, items };
}

/**
 * Cost list (bills/UtilityBills) by property and period. Paginated.
 * startDate/endDate 来自 datepicker，视为 UTC+8 日历日；查询时转为 UTC 范围与 DB (UTC) 比较。
 */
async function getCostList(email, { propertyId, startDate, endDate, skip = 0, limit = 10 }) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const fromStr = startDate && String(startDate).trim().substring(0, 10);
  const toStr = endDate && String(endDate).trim().substring(0, 10);
  const { fromUtc, toUtc } = malaysiaDateRangeToUtcForQuery(fromStr || null, toStr || null);
  if (!fromUtc || !toUtc) return { ok: false, reason: 'START_END_DATE_REQUIRED' };
  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS total FROM bills WHERE property_id = ? AND period >= ? AND period <= ?',
    [propertyId, fromUtc, toUtc]
  );
  const totalCount = Number(countRows[0]?.total || 0);
  const [rows] = await pool.query(
    `SELECT b.id, b.period, b.amount, b.description, b.billurl AS bukkuurl, b.property_id,
            p.shortname AS property_shortname, c.currency AS client_currency
       FROM bills b
       LEFT JOIN propertydetail p ON p.id = b.property_id
       LEFT JOIN clientdetail c ON c.id = p.client_id
       WHERE b.property_id = ? AND b.period >= ? AND b.period <= ?
       ORDER BY b.period DESC LIMIT ? OFFSET ?`,
    [propertyId, fromUtc, toUtc, limit, skip]
  );
  const items = (rows || []).map(r => ({
    _id: r.id,
    period: r.period,
    amount: r.amount,
    description: r.description,
    bukkuurl: r.bukkuurl,
    listingTitle: r.property_shortname,
    property: r.property_id ? { _id: r.property_id, shortname: r.property_shortname } : null,
    client: r.client_currency ? { currency: r.client_currency } : null
  }));
  return { ok: true, items, totalCount };
}

/**
 * Agreement list by owner and mode. Returns rows for repeater (agreement + property).
 * Includes: (1) a.owner_id = ownerId, (2) a.owner_id IS NULL but a.property_id in owner's properties
 * so legacy rows without owner_id still show when the property belongs to this owner.
 */
async function getAgreementList(email, ownerId) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  if (String(owner._id) !== String(ownerId)) return { ok: false, reason: 'OWNER_MISMATCH' };

  const propertyIds = Array.isArray(owner.property) ? owner.property : [];
  const hasPropIds = propertyIds.length > 0;
  const placeholders = hasPropIds ? propertyIds.map(() => '?').join(',') : '';
  const modeCondition = `(a.mode IN ('owner_operator', 'owner_tenant') OR a.mode IS NULL)`;
  /* Only show in repeater when PDF is generated and ready for signing (e-sign: 先生成 PDF 才出现、才可签) */
  const signableCondition = `(a.status IN ('ready_for_signature', 'locked', 'completed') AND (a.url IS NOT NULL OR a.pdfurl IS NOT NULL))`;

  const [rows] = hasPropIds
    ? await pool.query(
        `SELECT a.id, a.owner_id, a.property_id, a.tenancy_id, a.client_id, a.agreementtemplate_id, a.mode, a.status,
                a.ownersign, a.owner_signed_at, a.tenantsign, a.pdfurl,
                p.shortname AS property_shortname
           FROM agreement a
           LEFT JOIN propertydetail p ON p.id = a.property_id
           WHERE (a.owner_id = ? OR (a.owner_id IS NULL AND a.property_id IN (${placeholders})))
             AND ${modeCondition}
             AND ${signableCondition}
           ORDER BY a.created_at DESC`,
        [ownerId, ...propertyIds]
      )
    : await pool.query(
        `SELECT a.id, a.owner_id, a.property_id, a.tenancy_id, a.client_id, a.agreementtemplate_id, a.mode, a.status,
                a.ownersign, a.owner_signed_at, a.tenantsign, a.pdfurl,
                p.shortname AS property_shortname
           FROM agreement a
           LEFT JOIN propertydetail p ON p.id = a.property_id
           WHERE a.owner_id = ? AND ${modeCondition}
             AND ${signableCondition}
           ORDER BY a.created_at DESC`,
        [ownerId]
      );
  const items = (rows || []).map(a => ({
    _id: a.id,
    agreementid: a.agreementtemplate_id,
    propertyid: a.property_id,
    tenancyid: a.tenancy_id,
    clientid: a.client_id,
    status: a.status,
    property: a.property_id ? { _id: a.property_id, shortname: a.property_shortname } : null,
    agreement: {
      _id: a.id,
      agreementtemplate: a.agreementtemplate_id,
      property: a.property_id,
      tenancy: a.tenancy_id,
      client: a.client_id,
      mode: a.mode,
      status: a.status,
      ownersign: a.ownersign,
      ownerSignedAt: a.owner_signed_at,
      tenantsign: a.tenantsign,
      pdfurl: a.pdfurl
    }
  }));
  return { ok: true, items };
}

/**
 * Get single agreement template by id. Returns { html, title, ... }.
 */
async function getAgreementTemplate(templateId) {
  const [rows] = await pool.query(
    'SELECT id, html, title, templateurl, folderurl FROM agreementtemplate WHERE id = ? LIMIT 1',
    [templateId]
  );
  const r = rows[0];
  if (!r) return null;
  return { _id: r.id, html: r.html, title: r.title };
}

/**
 * Get single agreement by id.
 */
async function getAgreementById(agreementId) {
  const [rows] = await pool.query(
    `SELECT id, owner_id, property_id, tenancy_id, client_id, agreementtemplate_id, mode, status,
            ownersign, owner_signed_at, tenantsign, pdfurl, columns_locked
       FROM agreement WHERE id = ? LIMIT 1`,
    [agreementId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    _id: r.id,
    owner: r.owner_id,
    property: r.property_id,
    tenancy: r.tenancy_id,
    client: r.client_id,
    agreementtemplate: r.agreementtemplate_id,
    mode: r.mode,
    status: r.status,
    ownersign: r.ownersign,
    ownerSignedAt: r.owner_signed_at,
    tenantsign: r.tenantsign,
    pdfurl: r.pdfurl,
    columns_locked: r.columns_locked
  };
}

/**
 * Update agreement: ownersign, owner_signed_at, owner_signed_ip, status (completed or waiting_third).
 */
async function updateAgreementSign(email, agreementId, { ownersign, ownerSignedAt, status, ownerSignedIp }) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const existing = await getAgreementById(agreementId);
  if (!existing) return { ok: false, reason: 'AGREEMENT_NOT_FOUND' };
  if (existing.owner !== owner._id) return { ok: false, reason: 'OWNER_MISMATCH' };
  if (existing.columns_locked) return { ok: false, reason: 'AGREEMENT_COMPLETED' };

  const updates = [];
  const params = [];
  if (ownersign !== undefined) { updates.push('ownersign = ?'); params.push(ownersign); }
  if (ownerSignedAt !== undefined) { updates.push('owner_signed_at = ?'); params.push(ownerSignedAt); }
  if (ownerSignedIp !== undefined) { updates.push('owner_signed_ip = ?'); params.push(String(ownerSignedIp).trim().slice(0, 45) || null); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (updates.length === 0) return { ok: true };
  params.push(agreementId);
  await pool.query(
    `UPDATE agreement SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
    params
  );
  return { ok: true };
}

/**
 * completeAgreementApproval: update owner's approvalpending entry to completed for given propertyId/clientId/agreementId.
 */
async function completeAgreementApproval(email, { ownerId, propertyId, clientId, agreementId }) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  if (owner._id !== ownerId) return { ok: false, reason: 'OWNER_MISMATCH' };

  const [rows] = await pool.query(
    'SELECT id, approvalpending FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  const r = rows[0];
  if (!r) return { ok: false, message: 'Owner not found' };
  let pending = parseJson(r.approvalpending) || [];
  if (!Array.isArray(pending)) pending = [];
  const merged = pending.map(p => {
    const pid = p.propertyid ?? p.propertyId;
    const cid = p.clientid ?? p.clientId;
    const aid = p.agreementid ?? p.agreementId;
    if (pid === propertyId && cid === clientId && aid === agreementId && p.status === 'pending') {
      return { ...p, status: 'completed', signedAt: new Date() };
    }
    return p;
  });
  await pool.query(
    'UPDATE ownerdetail SET approvalpending = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(merged), ownerId]
  );

  // When owner approves this client: if client has account integration + pricing plan, sync contact (find by email/name or create) and write ownerdetail.account.
  try {
    await syncOwnerForClient(email, { ownerId, clientId });
  } catch (e) {
    console.warn('[ownerportal] syncOwnerForClient after completeAgreementApproval', e);
  }

  return { ok: true };
}

/**
 * mergeOwnerMultiReference: add propertyId and clientId to owner's property/client (single-id columns; if multi needed later use junction).
 */
async function mergeOwnerMultiReference(email, { ownerId, propertyId, clientId }) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  if (owner._id !== ownerId) return { ok: false, reason: 'OWNER_MISMATCH' };

  const [rows] = await pool.query(
    'SELECT id, property_id, client_id FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  const r = rows[0];
  if (!r) return { ok: false, message: 'Owner not found' };
  let newPropertyId = r.property_id;
  let newClientId = r.client_id;
  if (propertyId && r.property_id !== propertyId) newPropertyId = propertyId;
  if (clientId && r.client_id !== clientId) newClientId = clientId;
  await pool.query(
    'UPDATE ownerdetail SET property_id = ?, client_id = ?, updated_at = NOW() WHERE id = ?',
    [newPropertyId, newClientId, ownerId]
  );
  return { ok: true };
}

/**
 * Remove one entry from owner's approvalpending (for reject).
 */
async function removeApprovalPending(email, { ownerId, propertyId, clientId }) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  if (owner._id !== ownerId) return { ok: false, reason: 'OWNER_MISMATCH' };

  const [rows] = await pool.query(
    'SELECT id, approvalpending FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  const r = rows[0];
  if (!r) return { ok: false };
  let pending = parseJson(r.approvalpending) || [];
  if (!Array.isArray(pending)) pending = [];
  const filtered = pending.filter((p) => {
    const pid = p.propertyid ?? p.propertyId;
    const cid = p.clientid ?? p.clientId;
    return !(pid === propertyId && cid === clientId);
  });
  await pool.query(
    'UPDATE ownerdetail SET approvalpending = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(filtered), ownerId]
  );
  return { ok: true };
}

/**
 * Sync owner to accounting contact for a client (best-effort only).
 * Caller must complete owner approval (mergeOwnerMultiReference + removeApprovalPending) first; this must not block approval.
 * Uses client's integration: client_integration.provider in ('bukku','xero','autocount','sql'). If none or sync fails, returns { ok: false, reason }.
 * Never throws: any error returns { ok: false, reason } so route does not send 500 BACKEND_ERROR.
 */
async function syncOwnerForClient(email, { ownerId, clientId }) {
  try {
    const owner = await getOwnerByEmail(email);
    if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
    if (owner._id !== ownerId) return { ok: false, reason: 'OWNER_MISMATCH' };

    const [clientRows] = await pool.query(
      'SELECT id, title, email, currency FROM clientdetail WHERE id = ? LIMIT 1',
      [clientId]
    );
    const client = clientRows[0];
    if (!client) return { ok: false, reason: 'CLIENT_NOT_FOUND' };

    let planId = null;
    try {
      const [planRows] = await pool.query(
        `SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? LIMIT 1`,
        [clientId]
      );
      planId = planRows[0]?.plan_id;
    } catch (_) { /* table may not exist */ }
    const hasAccounting = planId && ACCOUNTING_PLAN_IDS.includes(planId);
    if (!hasAccounting) return { ok: false, reason: 'NO_ACCOUNTING_CAPABILITY' };

    let provider = null;
    try {
      const [intRows] = await pool.query(
        `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
        [clientId]
      );
      provider = intRows[0]?.provider;
    } catch (_) { /* table may not exist */ }
    if (!provider || !['bukku', 'xero', 'autocount', 'sql'].includes(provider)) {
      return { ok: false, reason: 'NO_ACCOUNT_INTEGRATION' };
    }

    const [ownerRow] = await pool.query(
      'SELECT id, ownername, email, mobilenumber, account FROM ownerdetail WHERE id = ? LIMIT 1',
      [ownerId]
    );
    const o = ownerRow[0];
    if (!o) return { ok: false, reason: 'OWNER_NOT_FOUND' };
    const account = parseJson(o.account) || [];
    const existingMapping = Array.isArray(account) ? account.find(a => a.clientId === clientId && a.provider === provider) : null;
    const existingId = existingMapping?.id ?? existingMapping?.contactId;

    const record = {
      name: o.ownername || '',
      fullname: o.ownername || '',
      email: o.email || '',
      phone: o.mobilenumber || ''
    };

    const syncRes = await contactSync.ensureContactInAccounting(clientId, provider, 'owner', record, existingId);
    if (!syncRes.ok) return { ok: false, reason: syncRes.reason || 'SYNC_FAILED' };

    const writeRes = await contactSync.writeOwnerAccount(ownerId, clientId, provider, syncRes.contactId);
    if (!writeRes.ok) return { ok: false, reason: writeRes.reason || 'WRITE_FAILED' };

    return { ok: true, contactId: syncRes.contactId };
  } catch (e) {
    console.warn('[ownerportal] syncOwnerForClient error', e?.message || e);
    return { ok: false, reason: 'BUKKU_SYNC_SKIPPED' };
  }
}

module.exports = {
  getOwnerByEmail,
  getPropertyIdsByOwnerId,
  getPropertiesByIds,
  getRoomsByPropertyIds,
  getTenanciesByRoomIds,
  getClientsByIds,
  getBanks,
  updateOwnerProfile,
  getOwnerPayoutList,
  getCostList,
  getAgreementList,
  getAgreementTemplate,
  getAgreementById,
  updateAgreementSign,
  completeAgreementApproval,
  mergeOwnerMultiReference,
  removeApprovalPending,
  syncOwnerForClient
};
