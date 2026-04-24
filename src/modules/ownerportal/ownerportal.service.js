/**
 * Owner Portal – migrated from Wix Owner Detail + CMS.
 * Uses MySQL: ownerdetail, propertydetail, roomdetail, tenancy, tenantdetail, operatordetail,
 * bankdetail, ownerpayout, bills, agreement, agreementtemplate, client_integration, client_pricingplan_detail.
 * All endpoints require email; owner is resolved by email (ownerdetail.email).
 */

const { randomUUID, createHash } = require('crypto');
const pool = require('../../config/db');
const { ACCOUNTING_PLAN_IDS } = require('../access/access.service');
const contactSync = require('../contact/contact-sync.service');
const { malaysiaDateRangeToUtcForQuery } = require('../../utils/dateMalaysia');
const { updatePortalProfile, getPortalProfile } = require('../portal-auth/portal-auth.service');
const lockWrapper = require('../ttlock/wrappers/lock.wrapper');
const lockdetailLog = require('../smartdoorsetting/lockdetail-log.service');
const { signatureValueToPublicUrl } = require('../upload/signature-image-to-oss-url');

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
 * Operator list for owner portal “Contact operator” (title + WhatsApp/contact from client_profile).
 */
async function getLinkedOperatorsForClientIds(clientIds) {
  if (!Array.isArray(clientIds) || clientIds.length === 0) return [];
  const unique = [...new Set(clientIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT c.id AS client_id, c.title,
            TRIM(COALESCE(cp.contact, '')) AS contact
       FROM operatordetail c
       LEFT JOIN client_profile cp ON cp.client_id = c.id
      WHERE c.id IN (${placeholders})
      ORDER BY COALESCE(c.title, '') ASC, c.id ASC`,
    unique
  );
  return (rows || []).map((row) => ({
    clientId: row.client_id,
    title: row.title || 'Operator',
    contact: row.contact || ''
  }));
}

/**
 * Enrich approvalpending entries with clientName (operatordetail.title) and propertyShortname (propertydetail.shortname) for owner portal display.
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
      `SELECT id, title FROM operatordetail WHERE id IN (${placeholders})`,
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
            nricfront, nricback, signature, profile, approvalpending, account
       FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    [String(email).trim().toLowerCase()]
  );
  const r = rows[0];
  if (!r) return null;
  let propertyIds = await getPropertyIdsByOwnerIdFromJunction(r.id);
  let clientIds = await getClientIdsByOwnerIdFromJunction(r.id);
  if (propertyIds.length === 0) propertyIds = await getPropertyIdsByOwnerId(r.id);
  if (propertyIds.length > 0) {
    const ph = propertyIds.map(() => '?').join(',');
    const [pRows] = await pool.query(
      `SELECT DISTINCT client_id FROM propertydetail WHERE id IN (${ph}) AND client_id IS NOT NULL AND TRIM(client_id) != ''`,
      propertyIds
    );
    for (const row of pRows || []) {
      if (row.client_id && !clientIds.includes(row.client_id)) {
        clientIds.push(row.client_id);
      }
    }
  }
  const linkedOperators = await getLinkedOperatorsForClientIds(clientIds);
  let profileSelfVerifiedAt = null;
  let portalAliyunEkycLocked = false;
  try {
    const portalRes = await getPortalProfile(String(email).trim().toLowerCase());
    if (portalRes.ok && portalRes.profile) {
      const p = portalRes.profile;
      if (p.profileSelfVerifiedAt != null) {
        const v = p.profileSelfVerifiedAt;
        if (String(v).trim() !== '') profileSelfVerifiedAt = v;
      }
      portalAliyunEkycLocked = !!p.aliyun_ekyc_locked;
    }
  } catch (_) {
    /* ignore */
  }
  const profileIdentityVerified =
    (profileSelfVerifiedAt != null && String(profileSelfVerifiedAt).trim() !== '') || portalAliyunEkycLocked;
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
    client: clientIds,
    linkedOperators,
    profileSelfVerifiedAt,
    profileIdentityVerified,
    aliyunEkycLocked: portalAliyunEkycLocked
  };
}

/**
 * Get property ids by owner id (from propertydetail.owner_id). Used when owner_property is empty.
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
       LEFT JOIN operatordetail c ON c.id = p.client_id
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
 * Get operatordetail rows by ids (for operator dropdown). Returns { items: [...] }.
 */
async function getClientsByIds(clientIds) {
  if (!Array.isArray(clientIds) || clientIds.length === 0) return { items: [] };
  const placeholders = clientIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    'SELECT id, title, email, currency FROM operatordetail WHERE id IN (' + placeholders + ') ORDER BY title',
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
 * When no ownerdetail row exists (portal user not yet mapped by any operator), create one so they can register profile.
 */
async function updateOwnerProfile(email, payload) {
  let owner = await getOwnerByEmail(email);
  if (!owner) {
    const norm = (email || '').toString().trim().toLowerCase();
    if (!norm) return { ok: false, reason: 'NO_EMAIL' };
    const id = randomUUID();
    await pool.query(
      `INSERT INTO ownerdetail (id, email, ownername, account, approvalpending, created_at, updated_at)
       VALUES (?, ?, '', '[]', '[]', NOW(), NOW())`,
      [id, norm]
    );
    owner = await getOwnerByEmail(email);
    if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  }
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
  const norm = (owner.email || email || '').toString().trim().toLowerCase();
  if (norm) {
    const profileObj = payload.profile && typeof payload.profile === 'object' ? payload.profile : null;
    const profileAddress =
      profileObj && profileObj.address && typeof profileObj.address === 'object' ? profileObj.address : null;
    const addressFull =
      profileAddress
        ? [profileAddress.street, profileAddress.city, profileAddress.state, profileAddress.postcode]
            .filter((s) => s != null && String(s).trim())
            .map((s) => String(s).trim())
            .join(', ')
        : undefined;

    const portalPayload = {};
    if (payload.ownerName !== undefined) {
      portalPayload.fullname = payload.ownerName;
    }
    if (payload.mobileNumber !== undefined) portalPayload.phone = payload.mobileNumber;
    if (payload.nric !== undefined) portalPayload.nric = payload.nric;
    if (payload.nricFront !== undefined) portalPayload.nricfront = payload.nricFront;
    if (payload.nricback !== undefined) portalPayload.nricback = payload.nricback;
    if (payload.bankName !== undefined) portalPayload.bankname_id = payload.bankName;
    if (payload.bankAccount !== undefined) portalPayload.bankaccount = payload.bankAccount;
    if (payload.accountholder !== undefined) portalPayload.accountholder = payload.accountholder;
    if (addressFull !== undefined) portalPayload.address = addressFull;
    if (profileObj) {
      if (profileObj.entity_type !== undefined) portalPayload.entity_type = profileObj.entity_type;
      if (profileObj.reg_no_type !== undefined) portalPayload.reg_no_type = profileObj.reg_no_type;
      if (profileObj.reg_no_type !== undefined) portalPayload.id_type = profileObj.reg_no_type;
      if (profileObj.tax_id_no !== undefined) portalPayload.tax_id_no = profileObj.tax_id_no;
      if (profileObj.avatar_url !== undefined) portalPayload.avatar_url = profileObj.avatar_url;
    }
    if (Object.keys(portalPayload).length > 0) {
      try {
        await updatePortalProfile(norm, portalPayload);
      } catch (_) { /* portal_account may not exist or have profile columns */ }
    }
  }

  // After profile edit (ownerName etc.): sync owner to accounting contact for each linked client so contact name/phone stay in sync.
  if (updates.length > 0) {
    try {
      const [linkRows] = await pool.query('SELECT client_id FROM owner_client WHERE owner_id = ?', [id]);
      for (const row of linkRows || []) {
        if (row.client_id) {
          syncOwnerForClient(email, { ownerId: id, clientId: row.client_id }).catch((e) =>
            console.warn('[ownerportal] syncOwnerForClient after update-profile', row.client_id, e?.message || e)
          );
        }
      }
    } catch (_) { /* best-effort */ }
  }

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
  let propertyIds = Array.isArray(owner.property) ? owner.property.map((p) => (typeof p === 'object' && p._id ? p._id : p)) : [];
  if (propertyIds.length === 0) propertyIds = await getPropertyIdsByOwnerId(owner._id);
  if (propertyIds.length === 0) return { ok: true, items: [] };
  propertyIds = [...new Set(propertyIds.filter(Boolean))];

  const allMode = !propertyId || String(propertyId).toLowerCase() === 'all';
  if (!allMode && !propertyIds.includes(propertyId)) return { ok: false, reason: 'FORBIDDEN_PROPERTY' };
  const targetPropertyIds = allMode ? propertyIds : [propertyId];
  const placeholders = targetPropertyIds.map(() => '?').join(',');

  const [rows] = await pool.query(
    `SELECT o.id, o.property_id, o.period, o.totalrental, o.totalutility, o.totalcollection, o.expenses, o.netpayout, o.monthlyreport, o.payment_date,
            o.bukkuinvoice, o.bukkubills,
            p.shortname AS property_shortname,
            p.client_id AS property_client_id
       FROM ownerpayout o
       LEFT JOIN propertydetail p ON p.id = o.property_id
       WHERE o.property_id IN (${placeholders}) AND o.period >= ? AND o.period <= ?
       ORDER BY o.period DESC, p.shortname ASC`,
    [...targetPropertyIds, fromUtc, toUtc]
  );
  const items = (rows || []).map(r => ({
    ...(function computeAccountingUrls() {
      const invoiceRaw = r.bukkuinvoice ? String(r.bukkuinvoice).trim() : '';
      const billsRaw = r.bukkubills ? String(r.bukkubills).trim() : '';
      const isXeroBillUrl = /go\.xero\.com\/AccountsPayable\/View\.aspx/i.test(billsRaw);
      const invoiceUrl = invoiceRaw || null;
      // Owner portal rule: hide only Xero AP bill links; keep Bukku links visible.
      const billsUrl = isXeroBillUrl ? null : (billsRaw || null);
      return { invoiceUrl, billsUrl };
    })(),
    _id: r.id,
    id: r.id,
    propertyId: r.property_id,
    propertyName: r.property_shortname || '',
    period: r.period,
    totalrental: r.totalrental,
    totalutility: r.totalutility,
    totalcollection: r.totalcollection,
    expenses: r.expenses,
    netpayout: r.netpayout,
    monthlyreport: r.monthlyreport,
    paymentDate: r.payment_date,
    bukkuinvoice: null,
    bukkubills: null
  })).map((item) => ({
    ...item,
    bukkuinvoice: item.invoiceUrl,
    bukkubills: item.billsUrl
  }));
  return { ok: true, items };
}

/**
 * Cost list (bills/UtilityBills + ownerpayout management_fee) by property and period. Paginated.
 * startDate/endDate 来自 datepicker，视为 UTC+8 日历日；查询时转为 UTC 范围与 DB (UTC) 比较。
 */
async function getCostList(email, { propertyId, startDate, endDate, skip = 0, limit = 10 }) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const fromStr = startDate && String(startDate).trim().substring(0, 10);
  const toStr = endDate && String(endDate).trim().substring(0, 10);
  const { fromUtc, toUtc } = malaysiaDateRangeToUtcForQuery(fromStr || null, toStr || null);
  if (!fromUtc || !toUtc) return { ok: false, reason: 'START_END_DATE_REQUIRED' };

  const [billRows, mgmtRows, countRows] = await Promise.all([
    pool.query(
      `SELECT b.id, b.period, b.amount, b.description, b.billurl AS bukkuurl, b.property_id,
              p.shortname AS property_shortname, c.currency AS client_currency
         FROM bills b
         LEFT JOIN propertydetail p ON p.id = b.property_id
         LEFT JOIN operatordetail c ON c.id = p.client_id
         WHERE b.property_id = ? AND b.period >= ? AND b.period <= ?
         ORDER BY b.period DESC`,
      [propertyId, fromUtc, toUtc]
    ),
    pool.query(
      `SELECT o.id, o.period, o.management_fee AS amount, p.shortname AS property_shortname
         FROM ownerpayout o
         LEFT JOIN propertydetail p ON p.id = o.property_id
         WHERE o.property_id = ? AND o.period >= ? AND o.period <= ? AND (o.management_fee IS NOT NULL AND o.management_fee > 0)
         ORDER BY o.period DESC`,
      [propertyId, fromUtc, toUtc]
    ),
    pool.query(
      'SELECT COUNT(*) AS total FROM bills WHERE property_id = ? AND period >= ? AND period <= ?',
      [propertyId, fromUtc, toUtc]
    )
  ]);

  const billItems = (billRows[0] || []).map(r => ({
    _id: r.id,
    period: r.period,
    amount: r.amount,
    description: r.description,
    bukkuurl: r.bukkuurl,
    listingTitle: r.property_shortname,
    property: r.property_id ? { _id: r.property_id, shortname: r.property_shortname } : null,
    client: r.client_currency ? { currency: r.client_currency } : null,
    costType: 'bill'
  }));

  const mgmtItems = (mgmtRows[0] || []).map(r => ({
    _id: `mgmt-${r.id}`,
    period: r.period,
    amount: r.amount,
    description: 'Management Fee',
    bukkuurl: null,
    listingTitle: r.property_shortname,
    property: { _id: propertyId, shortname: r.property_shortname },
    client: null,
    costType: 'management_fee'
  }));

  const allItems = [...billItems, ...mgmtItems].sort((a, b) => {
    const pa = a.period ? new Date(a.period).getTime() : 0;
    const pb = b.period ? new Date(b.period).getTime() : 0;
    return pb - pa;
  });

  const totalCount = Number(countRows[0]?.total || 0) + mgmtItems.length;
  const items = allItems.slice(skip, skip + limit);

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
  const signableCondition = `(a.status IN ('ready_for_signature', 'locked', 'completed', 'complete') AND (a.url IS NOT NULL OR a.pdfurl IS NOT NULL))`;

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
  let ownerSignRaw = '';
  let ownerSignedAtIso = null;
  let ownerSignedAtMysql = null;
  let ownerSignedHash = null;
  if (ownersign !== undefined) {
    ownerSignRaw = String(ownersign ?? '').trim();
    const publicSign = await signatureValueToPublicUrl(ownersign, {
      clientId: existing.client,
      signatureKey: 'ownersign'
    });
    if (!publicSign.ok) {
      return { ok: false, reason: 'SIGNATURE_UPLOAD_FAILED', message: `owner ownersign: ${publicSign.reason}` };
    }
    updates.push('ownersign = ?');
    params.push(publicSign.value);
  }
  if (ownerSignedAt !== undefined) {
    const d = ownerSignedAt instanceof Date ? ownerSignedAt : new Date(ownerSignedAt);
    if (!Number.isNaN(d.getTime())) ownerSignedAtIso = d.toISOString();
    // MySQL DATETIME doesn't accept ISO strings with trailing "Z" in our schema.
    // Use "YYYY-MM-DD HH:mm:ss" (drop milliseconds + timezone).
    ownerSignedAtMysql = ownerSignedAtIso
      ? ownerSignedAtIso.replace('T', ' ').replace(/\.\d{3}Z$/, '')
      : null;
    updates.push('owner_signed_at = ?');
    params.push(ownerSignedAtMysql);
  }
  if (ownersign !== undefined && ownerSignedAtIso) {
    const [rows] = await pool.query('SELECT hash_draft FROM agreement WHERE id = ? LIMIT 1', [agreementId]);
    const hashDraft = rows?.[0]?.hash_draft != null ? String(rows[0].hash_draft) : '';
    ownerSignedHash = createHash('sha256')
      .update([agreementId, ownerSignRaw, ownerSignedAtIso, hashDraft].join('|'), 'utf8')
      .digest('hex');
    updates.push('owner_signed_hash = ?');
    params.push(ownerSignedHash);
  }
  if (ownerSignedIp !== undefined) { updates.push('owner_signed_ip = ?'); params.push(String(ownerSignedIp).trim().slice(0, 45) || null); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (updates.length === 0) return { ok: true };
  params.push(agreementId);
  try {
    await pool.query(
      `UPDATE agreement SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if ((e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054) && msg.includes('owner_signed_hash')) {
      const updatesLegacy = [];
      const paramsLegacy = [];
      for (let i = 0; i < updates.length; i += 1) {
        if (updates[i].startsWith('owner_signed_hash')) continue;
        updatesLegacy.push(updates[i]);
        paramsLegacy.push(params[i]);
      }
      paramsLegacy.push(agreementId);
      await pool.query(
        `UPDATE agreement SET ${updatesLegacy.join(', ')}, updated_at = NOW() WHERE id = ?`,
        paramsLegacy
      );
    } else {
      throw e;
    }
  }
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
 * mergeOwnerMultiReference: add propertyId and clientId to owner junction tables.
 * When clientId is set, also INSERT IGNORE into owner_client so Contact list shows owner as approved.
 * When propertyId is set, also INSERT IGNORE into owner_property and set propertydetail.owner_id.
 */
async function mergeOwnerMultiReference(email, { ownerId, propertyId, clientId }) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  if (owner._id !== ownerId) return { ok: false, reason: 'OWNER_MISMATCH' };

  const [rows] = await pool.query('SELECT id FROM ownerdetail WHERE id = ? LIMIT 1', [ownerId]);
  const r = rows[0];
  if (!r) return { ok: false, message: 'Owner not found' };
  try {
    if (clientId) {
      await pool.query(
        'INSERT IGNORE INTO owner_client (id, client_id, owner_id, created_at) VALUES (UUID(), ?, ?, NOW())',
        [clientId, ownerId]
      );
    }
    if (propertyId) {
      let resolvedClientId = clientId || null;
      if (!resolvedClientId) {
        const [propRows] = await pool.query('SELECT client_id FROM propertydetail WHERE id = ? LIMIT 1', [propertyId]);
        resolvedClientId = propRows?.[0]?.client_id || null;
      }
      await pool.query(
        'INSERT IGNORE INTO owner_property (id, owner_id, property_id, created_at) VALUES (UUID(), ?, ?, NOW())',
        [ownerId, propertyId]
      );
      if (resolvedClientId) {
        await pool.query(
          'UPDATE propertydetail SET owner_id = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
          [ownerId, propertyId, resolvedClientId]
        );
      }
    }
  } catch (e) {
    console.warn('[ownerportal] mergeOwnerMultiReference junction/owner_id sync:', e?.message || e);
  }
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
    const matchProperty = (propertyId == null && pid == null) || pid === propertyId;
    const matchClient = cid === clientId;
    return !(matchProperty && matchClient);
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
      'SELECT id, title, email, currency FROM operatordetail WHERE id = ? LIMIT 1',
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

/**
 * Get smart door items for owner's properties. For Smart Door page.
 * 门锁可装在 property 大门 或 每个 room 门上。
 * - 只有 property 大门有锁 → 1 option: Property A
 * - 4 个 room 有锁、property 没有 → 4 options: Property A | Room A, ...
 * - property + 4 room 都有锁 → 5 options
 */
async function getRoomsWithLocksForOwner(email) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  let propertyIds = Array.isArray(owner.property) ? owner.property.map(p => (typeof p === 'object' && p._id ? p._id : p)) : [];
  if (propertyIds.length === 0) propertyIds = await getPropertyIdsByOwnerId(owner._id);
  if (propertyIds.length === 0) return { ok: true, items: [] };
  propertyIds = [...new Set(propertyIds)];

  const placeholders = propertyIds.map(() => '?').join(',');
  const [propRows] = await pool.query(
    `SELECT p.id AS property_id, p.shortname AS property_shortname, p.client_id,
            pl.lockid AS property_lockid
       FROM propertydetail p
       LEFT JOIN lockdetail pl ON pl.id = p.smartdoor_id
       WHERE p.id IN (${placeholders})`,
    propertyIds
  );

  const result = [];
  for (const p of propRows || []) {
    const propName = (p.property_shortname || '').trim() || String(p.property_id);

    if (p.property_lockid) {
      result.push({
        _id: `property:${p.property_id}`,
        itemId: `property:${p.property_id}`,
        type: 'property',
        propertyId: p.property_id,
        propertyShortname: propName,
        clientId: p.client_id,
        lockIds: [p.property_lockid],
        label: propName
      });
    }

    const [roomRows] = await pool.query(
      `SELECT rd.id AS room_id, rd.roomname, rl.lockid
       FROM roomdetail rd
       LEFT JOIN lockdetail rl ON rl.id = rd.smartdoor_id
       WHERE rd.property_id = ? AND rd.smartdoor_id IS NOT NULL AND rl.lockid IS NOT NULL
       ORDER BY rd.roomname, rd.id`,
      [p.property_id]
    );
    const seenRoomLabels = new Set();
    for (const r of roomRows || []) {
      let roomName = (r.roomname || '').trim() || String(r.room_id);
      let label = `${propName} | ${roomName}`;
      if (seenRoomLabels.has(label)) {
        label = `${propName} | ${roomName} (${String(r.room_id).slice(-4)})`;
      }
      seenRoomLabels.add(label);
      result.push({
        _id: `room:${r.room_id}`,
        itemId: `room:${r.room_id}`,
        type: 'room',
        propertyId: p.property_id,
        roomId: r.room_id,
        propertyShortname: propName,
        roomName,
        clientId: p.client_id,
        lockIds: [r.lockid],
        label
      });
    }
  }

  const labelCount = {};
  for (const item of result) {
    const base = item.label;
    labelCount[base] = (labelCount[base] || 0) + 1;
  }
  const labelIndex = {};
  for (const item of result) {
    if (labelCount[item.label] > 1) {
      labelIndex[item.label] = (labelIndex[item.label] || 0) + 1;
      item.label = `${item.label} (${labelIndex[item.label]})`;
    }
  }

  return { ok: true, items: result };
}

/**
 * Get lock info for owner's item. itemId = "property:${propertyId}" or "room:${roomId}".
 */
async function getLockInfoForOwner(email, itemId) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return null;
  const propertyIds = Array.isArray(owner.property) ? owner.property.map(p => (typeof p === 'object' && p._id ? p._id : p)) : [];
  if (propertyIds.length === 0) propertyIds.push(...(await getPropertyIdsByOwnerId(owner._id)));

  const propMatch = String(itemId || '').match(/^property:(.+)$/);
  const roomMatch = String(itemId || '').match(/^room:(.+)$/);

  if (propMatch) {
    const propertyId = propMatch[1];
    if (!propertyIds.includes(propertyId)) return null;
    const [pRows] = await pool.query(
      `SELECT p.client_id, pl.lockid AS property_lockid
         FROM propertydetail p
         LEFT JOIN lockdetail pl ON pl.id = p.smartdoor_id
         WHERE p.id = ? LIMIT 1`,
      [propertyId]
    );
    const p = pRows?.[0];
    if (!p || !p.property_lockid) return null;
    const profile = owner.profile && typeof owner.profile === 'object' ? owner.profile : parseJson(owner.profile) || {};
    const ownerPropertyPasscodes = profile.owner_property_passcodes || {};
    const propPass = ownerPropertyPasscodes[propertyId];
    return { clientId: p.client_id, lockIds: [p.property_lockid], primaryLockId: p.property_lockid, password: propPass?.password ?? null, keyboardPwdId: propPass?.keyboardPwdId ?? null };
  }

  if (roomMatch) {
    const roomId = roomMatch[1];
    const [rRows] = await pool.query(
      `SELECT rd.property_id, p.client_id, rl.lockid
         FROM roomdetail rd
         LEFT JOIN propertydetail p ON p.id = rd.property_id
         LEFT JOIN lockdetail rl ON rl.id = rd.smartdoor_id
         WHERE rd.id = ? AND rd.smartdoor_id IS NOT NULL LIMIT 1`,
      [roomId]
    );
    const r = rRows?.[0];
    if (!r || !r.lockid || !propertyIds.includes(r.property_id)) return null;
    const profile = owner.profile && typeof owner.profile === 'object' ? owner.profile : parseJson(owner.profile) || {};
    const ownerRoomPasscodes = profile.owner_room_passcodes || {};
    const roomPass = ownerRoomPasscodes[roomId];
    return { clientId: r.client_id, lockIds: [r.lockid], primaryLockId: r.lockid, password: roomPass?.password ?? null, keyboardPwdId: roomPass?.keyboardPwdId ?? null };
  }

  return null;
}

/**
 * Remote unlock for owner's item. itemId = "property:${propertyId}" or "room:${roomId}".
 */
async function remoteUnlockForOwner(email, itemId) {
  const info = await getLockInfoForOwner(email, itemId);
  if (!info) return { ok: false, reason: 'PROPERTY_OR_LOCK_NOT_FOUND' };
  if (!info.lockIds.length) return { ok: false, reason: 'NO_SMARTDOOR' };
  for (const lockId of info.lockIds) {
    await lockWrapper.remoteUnlock(info.clientId, lockId);
    try {
      const ldId = await lockdetailLog.findLockdetailIdByColivingClientIdAndTtlockLockId(info.clientId, lockId);
      if (ldId) {
        await lockdetailLog.insertLockdetailRemoteUnlockLog({
          lockdetailId: ldId,
          actorEmail: email,
          portalSource: 'coliving_owner_portal',
        });
      }
    } catch (logErr) {
      console.warn('[ownerportal] lockdetail_log', logErr?.message || logErr);
    }
  }
  return { ok: true };
}

/**
 * Get owner passcode for item (from profile.owner_property_passcodes or owner_room_passcodes).
 */
async function getPasscodeForOwner(email, itemId) {
  const info = await getLockInfoForOwner(email, itemId);
  if (!info) return { ok: false, reason: 'PROPERTY_OR_LOCK_NOT_FOUND' };
  return { ok: true, password: info.password ?? null, keyboardPwdId: info.keyboardPwdId ?? null };
}

/**
 * Create or update owner's TTLock passcode. property: one password; room: one password per room.
 */
async function savePasscodeForOwner(email, itemId, newPassword) {
  const owner = await getOwnerByEmail(email);
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const info = await getLockInfoForOwner(email, itemId);
  if (!info) return { ok: false, reason: 'PROPERTY_OR_LOCK_NOT_FOUND' };
  if (!info.primaryLockId) return { ok: false, reason: 'NO_SMARTDOOR' };
  const pwd = String(newPassword ?? '').trim();
  if (!pwd || pwd.length < 4 || pwd.length > 12) return { ok: false, reason: 'INVALID_PASSWORD' };

  const profile = owner.profile && typeof owner.profile === 'object' ? owner.profile : parseJson(owner.profile) || {};
  const name = 'Owner';
  const endMs = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;

  if (info.keyboardPwdId != null) {
    try {
      await lockWrapper.changePasscode(info.clientId, info.primaryLockId, {
        keyboardPwdId: info.keyboardPwdId,
        name,
        startDate: Date.now() - 60000,
        endDate: Date.now() - 60000
      });
    } catch (_) { /* best-effort expire old */ }
  }

  let data;
  try {
    data = await lockWrapper.addPasscode(info.clientId, info.primaryLockId, {
      name,
      password: pwd,
      startDate: Date.now(),
      endDate: endMs
    });
  } catch (addErr) {
    return { ok: false, reason: addErr.message || 'TTLOCK_ADD_PASSCODE_FAILED' };
  }

  const newKeyboardPwdId = data?.keyboardPwdId ?? info.keyboardPwdId;
  const propMatch = String(itemId || '').match(/^property:(.+)$/);
  const roomMatch = String(itemId || '').match(/^room:(.+)$/);

  if (propMatch) {
    const ownerPropertyPasscodes = profile.owner_property_passcodes || {};
    ownerPropertyPasscodes[propMatch[1]] = { password: pwd, keyboardPwdId: newKeyboardPwdId };
    profile.owner_property_passcodes = ownerPropertyPasscodes;
  } else if (roomMatch) {
    const ownerRoomPasscodes = profile.owner_room_passcodes || {};
    ownerRoomPasscodes[roomMatch[1]] = { password: pwd, keyboardPwdId: newKeyboardPwdId };
    profile.owner_room_passcodes = ownerRoomPasscodes;
  }

  await pool.query(
    'UPDATE ownerdetail SET profile = ? WHERE id = ?',
    [JSON.stringify(profile), owner._id]
  );

  return { ok: true, password: pwd };
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
  syncOwnerForClient,
  getRoomsWithLocksForOwner,
  remoteUnlockForOwner,
  getPasscodeForOwner,
  savePasscodeForOwner
};
