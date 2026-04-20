/**
 * Agreement context – migrated from Wix backend/access/agreementdetail.jsw.
 * Uses MySQL: agreementtemplate, tenancy, tenantdetail, roomdetail, propertydetail,
 * operatordetail (profile JSON), meterdetail, ownerdetail. All FK by _id (no _wixid).
 *
 * PDF flow (Node only): Google Docs + Drive API via operator OAuth (Company Settings) or
 * GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS.
 */

const { randomUUID, createHash } = require('crypto');
const pool = require('../../config/db');
const { getAccessContextByEmail } = require('../access/access.service');
const { generatePdfFromTemplate, getAuth, exportGoogleDocAsHtml, uploadPdfBufferToDriveFolder } = require('./google-docs-pdf');
const { buildSigningAuditPdfBuffer, mergePdfBuffers } = require('./agreement-pdf-appendix');
const { getOAuth2ClientForClient } = require('../companysetting/google-drive-oauth.service');
const { htmlToPdfBuffer } = require('./html-to-pdf');
const { signatureValueToPublicUrl } = require('../upload/signature-image-to-oss-url');

/** Single source for Cleanlemons General placeholder keys — keep in sync with operator portal UI. */
const CLN_AGREEMENT_VAR_REF = require('../cleanlemon/cln-agreement-variable-reference.json');

/** Prefer per-client Google OAuth (operator’s Drive); else service account. */
async function resolveAgreementPdfAuth(clientId) {
  const oauth = clientId ? await getOAuth2ClientForClient(clientId) : null;
  const sa = getAuth();
  return oauth || sa || null;
}

const TIMEZONE_MY = 'Asia/Kuala_Lumpur';

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

function nowMY() {
  const d = new Date();
  return new Date(d.getTime() + 8 * 60 * 60 * 1000);
}

function formatDateMY(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', {
    timeZone: TIMEZONE_MY,
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function formatDateUTC(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function calcPeriod(begin, end) {
  if (!begin || !end) return '';
  const b = new Date(begin);
  const e = new Date(end);
  const months =
    (e.getFullYear() - b.getFullYear()) * 12 +
    (e.getMonth() - b.getMonth());
  return months > 0 ? `${months} months` : '';
}

function formatMoney(amount, currency) {
  if (amount === undefined || amount === null) return '';
  if (!currency) return `${Number(amount).toFixed(2)}`;
  return `${currency} ${Number(amount).toFixed(2)}`;
}

function normalizeCurrencyCode(code) {
  const s = String(code || '').trim().toUpperCase();
  return s;
}

async function getClientCurrencyCode(clientId) {
  if (!clientId) return '';
  try {
    const client = await getClient(clientId);
    return normalizeCurrencyCode(client?.currency) || '';
  } catch {
    return '';
  }
}

function calcPaymentDate(begin) {
  if (!begin) return '';
  const d = new Date(begin);
  return d.getUTCDate().toString().padStart(2, '0');
}

function formatOwnerAddress(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const addr = profile.address;
  if (!addr || typeof addr !== 'object') return '';
  return [addr.street, addr.city, addr.state, addr.postcode].filter(Boolean).join(', ');
}

function hasValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function markMissing(list, key, value) {
  if (!hasValue(value)) list.push(key);
}

/** Prefer IANA JSON field legal_name; accept legalName if present. */
function profileLegalNameFromJson(profileJson) {
  const prof = parseJson(profileJson) || {};
  if (typeof prof !== 'object') return '';
  const a = prof.legal_name != null ? String(prof.legal_name).trim() : '';
  if (a) return a;
  const b = prof.legalName != null ? String(prof.legalName).trim() : '';
  return b || '';
}

/** Agreement PDF: prefer profile legal name, else ownerdetail.ownername. */
function ownerLegalNameForAgreement(owner) {
  if (!owner) return '';
  const legal = profileLegalNameFromJson(owner.profile);
  if (legal) return legal;
  return owner.ownername != null ? String(owner.ownername).trim() : '';
}

/** Agreement PDF: prefer profile legal name, else tenantdetail.fullname. */
function tenantLegalNameForAgreement(tenant) {
  if (!tenant) return '';
  const legal = profileLegalNameFromJson(tenant.profile);
  if (legal) return legal;
  return tenant.fullname != null ? String(tenant.fullname).trim() : '';
}

/**
 * @param {object} tenant - tenantdetail row
 * @param {string} [addressForAgreement] - when set, used for {{tenantaddress}} / required-field check (e.g. fallback from property)
 */
function validateTenantPersonalProfile(tenant, addressForAgreement) {
  const missing = [];
  const addr = addressForAgreement !== undefined ? addressForAgreement : tenant?.address;
  markMissing(missing, 'tenant.fullname', tenantLegalNameForAgreement(tenant));
  markMissing(missing, 'tenant.nric', tenant?.nric);
  markMissing(missing, 'tenant.address', addr);
  markMissing(missing, 'tenant.phone', tenant?.phone);
  markMissing(missing, 'tenant.email', tenant?.email);
  return missing;
}

function validateOwnerPersonalProfile(owner) {
  const missing = [];
  const ownerProfile = parseJson(owner?.profile) || {};
  const ownerAddress = formatOwnerAddress(ownerProfile);
  markMissing(missing, 'owner.ownername', ownerLegalNameForAgreement(owner));
  markMissing(missing, 'owner.nric', owner?.nric);
  markMissing(missing, 'owner.email', owner?.email);
  markMissing(missing, 'owner.mobilenumber', owner?.mobilenumber);
  markMissing(missing, 'owner.address', ownerAddress);
  return missing;
}

function validateOperatorCompanyProfile(client, clientProfile, clientssmVal) {
  const missing = [];
  markMissing(missing, 'operator.client_title', client?.title);
  markMissing(missing, 'operator.client_email', client?.email);
  markMissing(missing, 'operator.company_address', clientProfile?.address);
  markMissing(missing, 'operator.company_contact', clientProfile?.contact);
  markMissing(missing, 'operator.company_ssm_or_uen', clientssmVal);
  // company chop optional — template may show empty if not uploaded
  return missing;
}

async function getTemplate(agreementTemplateId) {
  const [rows] = await pool.query(
    'SELECT id, templateurl, folderurl, html, title FROM agreementtemplate WHERE id = ? LIMIT 1',
    [agreementTemplateId]
  );
  return rows[0] || null;
}

async function getTenancy(tenancyId) {
  const [rows] = await pool.query(
    'SELECT id, tenant_id, room_id, begin, `end`, rental, deposit, parkinglot_json, sign FROM tenancy WHERE id = ? LIMIT 1',
    [tenancyId]
  );
  return rows[0] || null;
}

async function getTenant(tenantId) {
  const [rows] = await pool.query(
    'SELECT id, fullname, nric, address, phone, email, profile FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  return rows[0] || null;
}

async function getRoom(roomId) {
  const [rows] = await pool.query(
    'SELECT id, roomname, property_id, meter_id FROM roomdetail WHERE id = ? LIMIT 1',
    [roomId]
  );
  return rows[0] || null;
}

/** Resolve tenancy.parkinglot_json (array of parkinglot IDs) to comma-separated names for template variable {{parkinglot}}. */
async function resolveParkingLotNames(clientId, propertyId, parkinglotJson) {
  const ids = parseJson(parkinglotJson);
  if (!Array.isArray(ids) || ids.length === 0) return '';
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, parkinglot FROM parkinglot WHERE client_id = ? AND property_id = ? AND id IN (${placeholders}) ORDER BY parkinglot ASC`,
    [clientId, propertyId, ...ids]
  );
  return (rows || []).map((r) => (r.parkinglot || '').trim() || r.id).filter(Boolean).join(', ') || '';
}

async function getProperty(propertyId) {
  try {
    const [rows] = await pool.query(
      'SELECT id, apartmentname, unitnumber, address, percentage, owner_settlement_model, fixed_rent_to_owner, client_id, owner_id FROM propertydetail WHERE id = ? LIMIT 1',
      [propertyId]
    );
    return rows[0] || null;
  } catch (e) {
    const isUnknownColumn = e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054 || (e.message && String(e.message).includes('Unknown column'));
    if (!isUnknownColumn) throw e;
    const [rows] = await pool.query(
      'SELECT id, apartmentname, unitnumber, address, percentage, client_id, owner_id FROM propertydetail WHERE id = ? LIMIT 1',
      [propertyId]
    );
    return rows[0] || null;
  }
}

function compactNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return String(Number(num.toFixed(2)));
}

function currencyPrefixForAgreement(currency) {
  const c = String(currency || '').trim().toUpperCase();
  if (c === 'MYR' || c === 'RM') return 'RM';
  if (c === 'SGD') return 'SGD';
  return c || '';
}

function normalizeSettlementModel(v) {
  const s = String(v || 'management_percent_gross').trim().toLowerCase().replace(/-/g, '_');
  if (s === 'management_percent_net') return 'management_percent_net';
  if (s === 'management_percent_rental_income_only') return 'management_percent_rental_income_only';
  if (s === 'guarantee_return_fixed_plus_share') return 'guarantee_return_fixed_plus_share';
  if (s === 'management_fees_fixed') return 'management_fees_fixed';
  if (s === 'rental_unit' || s === 'fixed_rent_to_owner') return 'rental_unit';
  return 'management_percent_gross';
}

function getPercentageDisplayText(property, currency) {
  const percentage = Number(property?.percentage || 0);
  const pctText = `${compactNumber(percentage)}%`;
  const fixedAmount = Number(property?.fixed_rent_to_owner || 0);
  const amountText = `${currencyPrefixForAgreement(currency)}${compactNumber(fixedAmount)}`;
  const model = normalizeSettlementModel(property?.owner_settlement_model);
  if (model === 'guarantee_return_fixed_plus_share') return `Guarantee return ${amountText}/month + ${pctText} of remaining`;
  if (model === 'management_percent_net') return `Management Fees ${pctText} of net income`;
  if (model === 'management_percent_rental_income_only') return `Management Fees ${pctText} of rental income only`;
  if (model === 'management_fees_fixed') return `Management Fees ${amountText} fixed amount/month`;
  if (model === 'rental_unit') return `Rental ${amountText}/month`;
  return `Management Fees ${pctText} of Gross income`;
}

async function getClient(clientId) {
  const [rows] = await pool.query(
    'SELECT id, title, email, currency, profile FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  return rows[0] || null;
}

/** Operator admin.rental.value = 每月几号收租（1–31）. For agreement {{paymentday}}. */
async function getClientAdminRentalDay(clientId) {
  if (!clientId) return null;
  const [rows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const raw = rows[0] && rows[0].admin != null ? rows[0].admin : null;
  const admin = parseJson(raw);
  const rental = (admin && typeof admin === 'object' && admin.rental) ? admin.rental : null;
  const value = rental != null && typeof rental.value === 'number' && rental.value >= 1 && rental.value <= 31
    ? rental.value
    : null;
  return value;
}

async function getMeter(meterId) {
  if (!meterId) return null;
  const [rows] = await pool.query(
    'SELECT id, meterid FROM meterdetail WHERE id = ? LIMIT 1',
    [meterId]
  );
  return rows[0] || null;
}

async function getOwner(ownerId) {
  const [rows] = await pool.query(
    'SELECT id, ownername, nric, email, mobilenumber, signature, nricfront, nricback, profile FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  return rows[0] || null;
}

function clientProfileFirst(client) {
  const raw = parseJson(client?.profile);
  if (Array.isArray(raw) && raw.length) return raw[0];
  return {};
}

/**
 * Merge operatordetail.profile[0] with MySQL client_profile row.
 * Next.js / portal often fills client_profile while legacy profile JSON stays null — agreements must still validate.
 */
async function mergeClientProfileForAgreement(client) {
  if (!client || !client.id) return clientProfileFirst(client);
  const base = clientProfileFirst(client);
  const [rows] = await pool.query(
    'SELECT address, contact, ssm, uen, subdomain FROM client_profile WHERE client_id = ? LIMIT 1',
    [client.id]
  );
  const r = rows[0];
  if (!r) return base;
  const out = { ...base };
  if (!hasValue(out.address) && r.address != null && String(r.address).trim()) {
    out.address = String(r.address).trim();
  }
  if (!hasValue(out.contact) && r.contact != null && String(r.contact).trim()) {
    out.contact = String(r.contact).trim();
  }
  if (!hasValue(out.ssm) && r.ssm != null && String(r.ssm).trim()) {
    out.ssm = String(r.ssm).trim();
  }
  if (!hasValue(out.uen) && r.uen != null && String(r.uen).trim()) {
    out.uen = String(r.uen).trim();
  }
  if (!hasValue(out.subdomain) && r.subdomain != null && String(r.subdomain).trim()) {
    out.subdomain = String(r.subdomain).trim();
  }
  return out;
}

/** When tenant.address is empty, use property + room context so draft PDF can generate (operator should still collect real address when possible). */
function resolveTenantAddressForAgreement(tenant, room, property) {
  if (hasValue(tenant?.address)) return String(tenant.address).trim();
  const parts = [];
  if (hasValue(property?.apartmentname)) parts.push(String(property.apartmentname).trim());
  if (hasValue(room?.roomname)) parts.push(String(room.roomname).trim());
  if (hasValue(property?.address)) parts.push(String(property.address).trim());
  return parts.filter(Boolean).join(', ').trim();
}

/** Company seal/chop URL from client_profile for agreement template {{clientchop}}. */
async function getClientChop(clientId) {
  if (!clientId) return '';
  const [rows] = await pool.query(
    'SELECT company_chop FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  return (rows[0] && rows[0].company_chop) ? String(rows[0].company_chop).trim() : '';
}

/** SSM and UEN from client_profile. For agreement {{clientssm}}: use UEN when client currency is SGD, else SSM. */
async function getClientProfileSsmUen(clientId) {
  if (!clientId) return { ssm: '', uen: '' };
  const [rows] = await pool.query(
    'SELECT ssm, uen FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const r = rows[0];
  const ssm = (r && r.ssm != null) ? String(r.ssm).trim() : '';
  const uen = (r && r.uen != null) ? String(r.uen).trim() : '';
  return { ssm, uen };
}

/**
 * Tenant ↔ Operator agreement context.
 * GET /api/agreement/tenant-context { email, tenancyId, agreementTemplateId, staffVars? }
 */
async function getTenantAgreementContext(tenancyId, agreementTemplateId, staffVars = {}) {
  if (!tenancyId) {
    return { ok: false, reason: 'missing_tenancy_id' };
  }

  const template = await getTemplate(agreementTemplateId);
  if (!template) {
    return { ok: false, reason: 'agreement_template_not_found' };
  }

  const tenancy = await getTenancy(tenancyId);
  if (!tenancy) {
    return { ok: false, reason: 'tenancy_not_found' };
  }

  const tenant = await getTenant(tenancy.tenant_id);
  if (!tenant) {
    return { ok: false, reason: 'tenant_not_found' };
  }

  const room = await getRoom(tenancy.room_id);
  if (!room) {
    return { ok: false, reason: 'room_not_found' };
  }

  const property = await getProperty(room.property_id);
  if (!property) {
    return { ok: false, reason: 'property_not_found' };
  }

  const client = await getClient(property.client_id);
  if (!client) {
    return { ok: false, reason: 'client_not_found' };
  }
  const percentage = Number(property.percentage || 0);
  const percentageDisplay = getPercentageDisplayText(property, client.currency);

  const clientProfile = await mergeClientProfileForAgreement(client);
  const clientchop = await getClientChop(client.id);
  const { ssm: profileSsm, uen: profileUen } = await getClientProfileSsmUen(client.id);
  const isSgd = (client.currency || '').toUpperCase() === 'SGD';
  const clientssmVal = isSgd ? (profileUen || profileSsm) : (profileSsm || profileUen);
  const tenantAddressResolved = resolveTenantAddressForAgreement(tenant, room, property);
  let meter = {};
  if (room.meter_id) {
    const m = await getMeter(room.meter_id);
    if (m) meter = m;
  }

  const parkingLotNames = await resolveParkingLotNames(property.client_id, room.property_id, tenancy.parkinglot_json);
  const adminRentalDay = await getClientAdminRentalDay(client.id);
  const paymentdateVal = calcPaymentDate(tenancy.begin);
  const paymentdayVal = adminRentalDay != null ? String(adminRentalDay) : (paymentdateVal || '');
  const variables = {
    date: formatDateMY(nowMY()),
    begin: formatDateUTC(tenancy.begin),
    end: formatDateUTC(tenancy.end),
    paymentdate: paymentdateVal,
    paymentday: paymentdayVal,
    client: client.title || '',
    clientname: client.title || '',
    clientssm: clientssmVal || clientProfile.ssm || '',
    clientuen: profileUen || '',
    clientaddress: clientProfile.address || '',
    clientphone: clientProfile.contact || '',
    clientemail: client.email || '',
    currency: client.currency || '',
    clientpicname: clientProfile.subdomain || '',
    clientchop,
    staffname: staffVars.staffname || '',
    staffnric: staffVars.staffnric || '',
    staffcontact: staffVars.staffcontact || '',
    staffemail: staffVars.staffemail || '',
    // Aliases: operator signature signer profile
    username: staffVars.staffname || '',
    usernric: staffVars.staffnric || '',
    useremail: staffVars.staffemail || '',
    userphone: staffVars.staffcontact || '',
    tenantname: tenantLegalNameForAgreement(tenant),
    tenantnric: tenant.nric || '',
    tenantaddress: tenantAddressResolved,
    tenantphone: tenant.phone || '',
    tenantemail: tenant.email || '',
    sign: tenancy.sign || '',
    rentalapartmentname: property.apartmentname || '',
    rentalunitnumber: property.unitnumber || '',
    rentalroomname: room.roomname || '',
    rentaladdress: `${room.roomname || ''} ${property.address || ''}`.trim(),
    period: calcPeriod(tenancy.begin, tenancy.end),
    rental: formatMoney(tenancy.rental, client.currency),
    deposit: formatMoney(tenancy.deposit, client.currency),
    parkinglot: parkingLotNames,
    meterid: meter.meterid || '',
    percentage,
    percentage_display: percentageDisplay
  };

  const missing = [
    ...validateTenantPersonalProfile(tenant, tenantAddressResolved),
    ...validateOperatorCompanyProfile(client, clientProfile, clientssmVal)
  ];
  if (missing.length) {
    return { ok: false, reason: 'profile_incomplete', missingFields: missing };
  }

  return {
    ok: true,
    agreementtype: 'tenant_operator',
    templateid: template.templateurl,
    folderid: template.folderurl,
    filename: `Tenancy Agreement - ${tenantLegalNameForAgreement(tenant) || 'Tenant'}`,
    callbackid: tenancy.id,
    variables
  };
}

/**
 * Owner ↔ Operator agreement context.
 * GET /api/agreement/owner-context { email, ownerId, propertyId, clientId, agreementTemplateId, staffVars? }
 */
async function getOwnerAgreementContext(ownerId, propertyId, clientId, agreementTemplateId, staffVars = {}) {
  if (!ownerId || !propertyId || !clientId) {
    return { ok: false, reason: 'missing_owner_property_or_client' };
  }

  const template = await getTemplate(agreementTemplateId);
  if (!template) {
    return { ok: false, reason: 'agreement_template_not_found' };
  }

  const owner = await getOwner(ownerId);
  if (!owner) {
    return { ok: false, reason: 'owner_not_found' };
  }

  const property = await getProperty(propertyId);
  if (!property) {
    return { ok: false, reason: 'property_not_found' };
  }

  const client = await getClient(clientId);
  if (!client) {
    return { ok: false, reason: 'client_not_found' };
  }
  const percentage = Number(property.percentage || 0);
  const percentageDisplay = getPercentageDisplayText(property, client.currency);

  const clientProfile = await mergeClientProfileForAgreement(client);
  const ownerProfile = parseJson(owner.profile) || {};
  const clientchop = await getClientChop(clientId);
  const { ssm: profileSsm, uen: profileUen } = await getClientProfileSsmUen(clientId);
  const isSgd = (client.currency || '').toUpperCase() === 'SGD';
  const clientssmVal = isSgd ? (profileUen || profileSsm) : (profileSsm || profileUen);
  const adminRentalDay = await getClientAdminRentalDay(clientId);
  const paymentdayVal = adminRentalDay != null ? String(adminRentalDay) : '1';

  const variables = {
    date: formatDateMY(nowMY()),
    client: client.title || '',
    clientname: client.title || '',
    clientssm: clientssmVal || clientProfile.ssm || '',
    clientuen: profileUen || '',
    paymentday: paymentdayVal,
    clientaddress: clientProfile.address || '',
    clientphone: clientProfile.contact || '',
    clientemail: client.email || '',
    clientchop,
    ownername: ownerLegalNameForAgreement(owner),
    ownernric: owner.nric || '',
    owneremail: owner.email || '',
    ownercontact: owner.mobilenumber || '',
    owneraddress: formatOwnerAddress(ownerProfile),
    sign: owner.signature || '',
    // Aliases: operator signature signer profile (if staffVars provided).
    username: staffVars.staffname || '',
    usernric: staffVars.staffnric || '',
    useremail: staffVars.staffemail || '',
    userphone: staffVars.staffcontact || '',
    nricfront: owner.nricfront || '',
    nricback: owner.nricback || '',
    rentalapartmentname: property.apartmentname || '',
    rentalunitnumber: property.unitnumber || '',
    rentalroomname: '',
    rentaladdress: property.address || '',
    percentage,
    percentage_display: percentageDisplay
  };

  const missing = [
    ...validateOwnerPersonalProfile(owner),
    ...validateOperatorCompanyProfile(client, clientProfile, clientssmVal)
  ];
  if (missing.length) {
    return { ok: false, reason: 'profile_incomplete', missingFields: missing };
  }

  return {
    ok: true,
    agreementtype: 'owner_operator',
    templateid: template.templateurl,
    folderid: template.folderurl,
    filename: `Management Agreement - ${property.apartmentname || 'Property'}`,
    callbackid: property.id,
    variables
  };
}

/**
 * Owner ↔ Tenant agreement context.
 * GET /api/agreement/owner-tenant-context { email, tenancyId, agreementTemplateId, staffVars? }
 */
async function getOwnerTenantAgreementContext(tenancyId, agreementTemplateId, staffVars = {}) {
  if (!tenancyId) {
    return { ok: false, reason: 'missing_tenancy_id' };
  }

  const template = await getTemplate(agreementTemplateId);
  if (!template) {
    return { ok: false, reason: 'agreement_template_not_found' };
  }

  const tenancy = await getTenancy(tenancyId);
  if (!tenancy) {
    return { ok: false, reason: 'tenancy_not_found' };
  }

  const tenant = await getTenant(tenancy.tenant_id);
  if (!tenant) {
    return { ok: false, reason: 'tenant_not_found' };
  }

  const room = await getRoom(tenancy.room_id);
  if (!room) {
    return { ok: false, reason: 'room_not_found' };
  }

  const property = await getProperty(room.property_id);
  if (!property) {
    return { ok: false, reason: 'property_not_found' };
  }

  const owner = await getOwner(property.owner_id);
  if (!owner) {
    return { ok: false, reason: 'owner_not_found' };
  }

  const client = await getClient(property.client_id);
  if (!client) {
    return { ok: false, reason: 'client_not_found' };
  }

  const clientProfile = await mergeClientProfileForAgreement(client);
  const ownerProfile = parseJson(owner.profile) || {};
  const percentage = Number(property.percentage || 0);
  const percentageDisplay = getPercentageDisplayText(property, client.currency);
  const tenantAddressResolved = resolveTenantAddressForAgreement(tenant, room, property);
  const clientchop = await getClientChop(client.id);
  const { ssm: profileSsm, uen: profileUen } = await getClientProfileSsmUen(client.id);
  const isSgd = (client.currency || '').toUpperCase() === 'SGD';
  const clientssmVal = isSgd ? (profileUen || profileSsm) : (profileSsm || profileUen);
  const parkingLotNames = await resolveParkingLotNames(property.client_id, room.property_id, tenancy.parkinglot_json);
  const adminRentalDay = await getClientAdminRentalDay(client.id);
  const paymentdateVal = calcPaymentDate(tenancy.begin);
  const paymentdayVal = adminRentalDay != null ? String(adminRentalDay) : (paymentdateVal || '');

  const variables = {
    date: formatDateMY(nowMY()),
    begin: formatDateUTC(tenancy.begin),
    end: formatDateUTC(tenancy.end),
    period: calcPeriod(tenancy.begin, tenancy.end),
    paymentdate: paymentdateVal,
    paymentday: paymentdayVal,
    ownername: ownerLegalNameForAgreement(owner),
    ownernric: owner.nric || '',
    owneremail: owner.email || '',
    ownercontact: owner.mobilenumber || '',
    owneraddress: formatOwnerAddress(ownerProfile),
    ownersign: owner.signature || '',
    nricfront: owner.nricfront || '',
    nricback: owner.nricback || '',
    tenantname: tenantLegalNameForAgreement(tenant),
    tenantnric: tenant.nric || '',
    tenantemail: tenant.email || '',
    tenantphone: tenant.phone || '',
    // Aliases: tenant profile (so templates can use {{username}} / {{usernric}} etc)
    username: tenantLegalNameForAgreement(tenant),
    usernric: tenant.nric || '',
    useremail: tenant.email || '',
    userphone: tenant.phone || '',
    tenantaddress: tenantAddressResolved,
    rentalapartmentname: property.apartmentname || '',
    rentalunitnumber: property.unitnumber || '',
    rentalroomname: room.roomname || '',
    rentaladdress: `${room.roomname || ''} ${property.address || ''}`.trim(),
    rental: formatMoney(tenancy.rental, client.currency),
    deposit: formatMoney(tenancy.deposit, client.currency),
    parkinglot: parkingLotNames,
    currency: client.currency || '',
    percentage,
    percentage_display: percentageDisplay,
    clientname: client.title || '',
    clientssm: clientssmVal || clientProfile.ssm || '',
    clientuen: profileUen || '',
    clientaddress: clientProfile.address || '',
    clientphone: clientProfile.contact || '',
    clientemail: client.email || '',
    clientchop
  };

  const missing = [
    ...validateTenantPersonalProfile(tenant, tenantAddressResolved),
    ...validateOwnerPersonalProfile(owner)
  ];
  if (missing.length) {
    return { ok: false, reason: 'profile_incomplete', missingFields: missing };
  }

  return {
    ok: true,
    agreementtype: 'owner_tenant',
    templateid: template.templateurl,
    folderid: template.folderurl,
    filename: `Owner-Tenant Agreement - ${tenantLegalNameForAgreement(tenant) || 'Tenant'}`,
    callbackid: tenancy.id,
    variables
  };
}

/**
 * Owner–Tenant agreement HTML (template variables replaced).
 * GET /api/agreement/owner-tenant-html { email, tenancyId, agreementTemplateId, staffVars? }
 */
async function getOwnerTenantAgreementHtml(tenancyId, agreementTemplateId, staffVars = {}) {
  const context = await getOwnerTenantAgreementContext(tenancyId, agreementTemplateId, staffVars);
  if (!context?.ok) return context;

  const template = await getTemplate(agreementTemplateId);
  if (!template?.html) {
    return { ok: false, reason: 'template_html_missing' };
  }

  let html = template.html;
  Object.keys(context.variables).forEach((key) => {
    html = html.replace(
      new RegExp(`{{\\s*${key}\\s*}}`, 'g'),
      String(context.variables[key] ?? '')
    );
  });

  return { ok: true, html };
}

function sanitizeStaffVars(staffVars = {}) {
  const clean = {};
  clean.staffname = staffVars.staffname != null ? String(staffVars.staffname).trim() : '';
  clean.staffnric = staffVars.staffnric != null ? String(staffVars.staffnric).trim() : '';
  clean.staffcontact = staffVars.staffcontact != null ? String(staffVars.staffcontact).trim() : '';
  clean.staffemail = staffVars.staffemail != null ? String(staffVars.staffemail).trim() : '';
  return clean;
}

/**
 * Operator/signing staff line in templates: {{username}} = legal name, {{usernric}} = NRIC / tax id no.
 * Source: portal_account (fullname, nric) merged on ctx.staff in access.service; profile JSON fallback.
 */
function operatorSignerStaffVarsFromAccessStaff(staff) {
  const s = staff && typeof staff === 'object' ? staff : {};
  const prof = s.profile && typeof s.profile === 'object' ? s.profile : {};
  const legalName =
    (s.fullname != null && String(s.fullname).trim()) ||
    [s.first_name, s.last_name].filter((v) => v != null && String(v).trim() !== '').join(' ').trim() ||
    (prof.fullname != null ? String(prof.fullname).trim() : '') ||
    (prof.legal_name != null ? String(prof.legal_name).trim() : '') ||
    (s.name != null ? String(s.name).trim() : '');
  const nricNo =
    (s.nric != null && String(s.nric).trim()) ||
    (prof.nric != null ? String(prof.nric).trim() : '') ||
    (s.tax_id_no != null && String(s.tax_id_no).trim()) ||
    (prof.tax_id_no != null ? String(prof.tax_id_no).trim() : '');
  return {
    staffname: legalName,
    staffnric: nricNo,
    staffcontact: s.phone != null ? String(s.phone).trim() : '',
    staffemail: s.email != null ? String(s.email).trim() : ''
  };
}

/** Prefer operator/profile (portal) over client-supplied staffVars for agreement PDFs. */
function mergeOperatorStaffVarsForAgreement(clientStaffVars, staffFromCtx) {
  const c = sanitizeStaffVars(clientStaffVars);
  const p = operatorSignerStaffVarsFromAccessStaff(staffFromCtx);
  return {
    staffname: p.staffname || c.staffname,
    staffnric: p.staffnric || c.staffnric,
    staffcontact: p.staffcontact || c.staffcontact,
    staffemail: p.staffemail || c.staffemail
  };
}

/**
 * Draft PDF (no logged-in ctx): resolve tenant_operator/owner_operator staff line from submitting staff → portal, else first client_user.
 */
async function loadOperatorStaffVarsForAgreementDraft(row) {
  if (!row?.client_id) return {};
  const clientId = row.client_id;
  const mode = row.mode;
  if (mode === 'tenant_operator' && row.tenancy_id) {
    try {
      const [tRows] = await pool.query('SELECT submitby_id FROM tenancy WHERE id = ? LIMIT 1', [row.tenancy_id]);
      const submitbyId = tRows[0]?.submitby_id;
      if (submitbyId) {
        const [sdRows] = await pool.query(
          'SELECT email FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1',
          [submitbyId, clientId]
        );
        const em = sdRows[0]?.email;
        if (em) {
          const ctx = await getAccessContextByEmail(String(em).trim());
          if (ctx?.ok && ctx.staff) return operatorSignerStaffVarsFromAccessStaff(ctx.staff);
        }
      }
    } catch (e) {
      console.warn('[agreement] loadOperatorStaffVarsForAgreementDraft tenancy submitby:', e?.message || e);
    }
  }
  try {
    const [uRows] = await pool.query(
      `SELECT email FROM client_user WHERE client_id = ? AND status = 1 ORDER BY updated_at DESC LIMIT 1`,
      [clientId]
    );
    const em = uRows[0]?.email;
    if (em) {
      const ctx = await getAccessContextByEmail(String(em).trim());
      if (ctx?.ok && ctx.staff) return operatorSignerStaffVarsFromAccessStaff(ctx.staff);
    }
  } catch (e) {
    console.warn('[agreement] loadOperatorStaffVarsForAgreementDraft client_user fallback:', e?.message || e);
  }
  return {};
}

/** Extract Google Doc/Folder ID from URL or return as-is if already id-like */
function extractIdFromUrlOrId(urlOrId) {
  if (!urlOrId) return null;
  const s = String(urlOrId).trim();
  if (/^[\w-]{25,}$/.test(s)) return s;
  const m = s.match(/[-\w]{25,}/);
  return m ? m[0] : null;
}

/** Status values for e-sign: only ready_for_signature | locked | completed show in repeater for signing */
const READY_FOR_SIGNATURE = 'ready_for_signature';
const LOCKED = 'locked';
const COMPLETED = 'completed';

/**
 * One-line JSON for pm2 logs — grep `agreement-final-pdf`. Copy the full line to support when
 * final PDF does not generate after both parties sign.
 * @param {object} payload use severity: 'info' for non-errors (default: error → stderr)
 */
function logAgreementFinalPdfDiagnostic(payload) {
  const { severity, ...rest } = payload || {};
  const line = JSON.stringify({
    tag: 'agreement-final-pdf',
    ts: new Date().toISOString(),
    ...rest
  });
  if (severity === 'info') console.log(line);
  else console.error(line);
}

/** Which signature columns are non-empty (signature blobs are never logged). */
function agreementSignSnapshot(row) {
  if (!row) return {};
  const has = (v) => v != null && String(v).trim() !== '';
  return {
    has_tenantsign: has(row.tenantsign),
    has_operatorsign: has(row.operatorsign),
    has_ownersign: has(row.ownersign)
  };
}

/**
 * Check if agreement has all data needed to generate PDF (owner/tenant/operator context complete).
 * Uses same context builders as PDF generation; if context returns ok, data is complete.
 */
async function isAgreementDataComplete(agreementId) {
  const [rows] = await pool.query(
    `SELECT id, mode, owner_id, property_id, tenancy_id, client_id, agreementtemplate_id
       FROM agreement WHERE id = ? LIMIT 1`,
    [agreementId]
  );
  const row = rows[0];
  if (!row || !row.mode || !row.agreementtemplate_id) {
    return { ok: false, reason: 'agreement_not_found_or_incomplete' };
  }
  const staffVars = {};
  let context;
  if (row.mode === 'tenant_operator') {
    if (!row.tenancy_id) return { ok: false, reason: 'missing_tenancy_id' };
    context = await getTenantAgreementContext(row.tenancy_id, row.agreementtemplate_id, staffVars);
  } else if (row.mode === 'owner_operator') {
    if (!row.owner_id || !row.property_id || !row.client_id) {
      return { ok: false, reason: 'missing_owner_property_or_client' };
    }
    context = await getOwnerAgreementContext(
      row.owner_id,
      row.property_id,
      row.client_id,
      row.agreementtemplate_id,
      staffVars
    );
  } else if (row.mode === 'owner_tenant') {
    if (!row.tenancy_id) return { ok: false, reason: 'missing_tenancy_id' };
    context = await getOwnerTenantAgreementContext(row.tenancy_id, row.agreementtemplate_id, staffVars);
  } else {
    return { ok: false, reason: 'invalid_agreement_mode' };
  }
  if (!context?.ok) {
    return {
      ok: false,
      reason: context.reason || 'data_incomplete',
      missingFields: Array.isArray(context.missingFields) ? context.missingFields : undefined
    };
  }
  return { ok: true };
}

/**
 * When agreement data is complete: generate draft PDF, store url + hash_draft, set status = ready_for_signature.
 * Only then should the agreement appear in repeater and allow signing.
 * Supports: owner_operator (1) owner & operator, (2) tenant_operator tenant & operator, (3) owner_tenant owner & tenant.
 * Requires Node PDF (OAuth or service account).
 */
async function prepareAgreementForSignature(agreementId) {
  console.log('[agreement] prepareAgreementForSignature start (Node + Google Docs/Drive API) agreementId=', agreementId);
  const [rows] = await pool.query(
    `SELECT id, mode, owner_id, property_id, tenancy_id, client_id, agreementtemplate_id, status, url, pdfurl, pdf_generating, hash_draft, columns_locked
       FROM agreement WHERE id = ? LIMIT 1`,
    [agreementId]
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'agreement_not_found' };
  if (row.columns_locked) return { ok: false, reason: 'agreement_already_completed' };
  if (row.pdf_generating) return { ok: false, reason: 'pdf_generating' };

  const signableStatuses = [READY_FOR_SIGNATURE, LOCKED, COMPLETED];
  if (signableStatuses.includes(row.status) && (row.url || row.pdfurl)) {
    return {
      ok: true,
      agreementId: row.id,
      pdfUrl: row.url || row.pdfurl,
      hash_draft: row.hash_draft ?? null,
      alreadyReady: true
    };
  }

  const dataComplete = await isAgreementDataComplete(agreementId);
  if (!dataComplete.ok) return dataComplete;

  let staffVars = {};
  if (row.mode === 'tenant_operator' || row.mode === 'owner_operator') {
    staffVars = await loadOperatorStaffVarsForAgreementDraft(row);
  }
  let context;
  if (row.mode === 'tenant_operator') {
    context = await getTenantAgreementContext(row.tenancy_id, row.agreementtemplate_id, staffVars);
  } else if (row.mode === 'owner_operator') {
    context = await getOwnerAgreementContext(
      row.owner_id,
      row.property_id,
      row.client_id,
      row.agreementtemplate_id,
      staffVars
    );
  } else if (row.mode === 'owner_tenant') {
    context = await getOwnerTenantAgreementContext(row.tenancy_id, row.agreementtemplate_id, staffVars);
  } else {
    return { ok: false, reason: 'invalid_agreement_mode' };
  }
  if (!context?.ok) return { ok: false, reason: context.reason || 'data_incomplete' };

  const templateId = extractIdFromUrlOrId(context.templateid);
  const folderId = extractIdFromUrlOrId(context.folderid);
  if (!templateId || !folderId) {
    return { ok: false, reason: 'template_or_folder_id_missing' };
  }
  const variables = context.variables || {};
  const authForPdf = await resolveAgreementPdfAuth(row.client_id);
  if (!authForPdf) {
    console.warn('[agreement] prepareAgreementForSignature abort: GOOGLE_CREDENTIALS_REQUIRED (connect Google Drive in Company Settings or set service account for Node PDF)');
    return { ok: false, reason: 'GOOGLE_CREDENTIALS_REQUIRED' };
  }

  console.log('[agreement] prepareAgreementForSignature calling generatePdfFromTemplate mode=', row.mode, 'templateId=', templateId, 'folderId=', folderId);

  try {
    const result = await generatePdfFromTemplate({
      templateId,
      folderId,
      filename: context.filename || 'Agreement',
      variables,
      authClient: authForPdf
    });
    const pdfUrl = result.pdfUrl;
    const hashDraft = result.hash || null;

    await pool.query(
      `UPDATE agreement SET url = ?, pdfurl = ?, hash_draft = ?, version = 1, status = ?, pdf_generating = 0, updated_at = NOW() WHERE id = ?`,
      [pdfUrl, pdfUrl, hashDraft, READY_FOR_SIGNATURE, agreementId]
    );
    console.log('[agreement] prepareAgreementForSignature ok agreementId=', agreementId, 'status=ready_for_signature pdfUrl=', pdfUrl ? String(pdfUrl).slice(0, 80) + '…' : '(none)');
    return {
      ok: true,
      agreementId,
      pdfUrl,
      hash_draft: hashDraft,
      alreadyReady: false
    };
  } catch (e) {
    console.error('[agreement] prepareAgreementForSignature failed (Node/Google API)', agreementId, e?.message || e);
    return {
      ok: false,
      reason: 'PDF_GENERATION_FAILED',
      message: e?.message,
      agreementId
    };
  }
}

/**
 * Request PDF generation: create agreement row, generate PDF with Node (Docs + Drive API), finalize row.
 *
 * @param {{ agreementType: string, agreementTemplateId: string, staffVars?: object, variablesOverride?: object, tenancyId?: string, ownerId?: string, propertyId?: string, clientId?: string }}
 * @returns {Promise<{ ok: boolean, agreementId?: string, pdfUrl?: string, reason?: string }>}
 */
async function requestPdfGeneration(params) {
  const {
    agreementType,
    agreementTemplateId,
    staffVars = {},
    variablesOverride = {},
    tenancyId,
    ownerId,
    propertyId,
    clientId
  } = params;

  let context;
  if (agreementType === 'tenant_operator') {
    if (!tenancyId) return { ok: false, reason: 'missing_tenancy_id' };
    context = await getTenantAgreementContext(tenancyId, agreementTemplateId, staffVars);
  } else if (agreementType === 'owner_operator') {
    if (!ownerId || !propertyId || !clientId) return { ok: false, reason: 'missing_owner_property_or_client' };
    context = await getOwnerAgreementContext(ownerId, propertyId, clientId, agreementTemplateId, staffVars);
  } else if (agreementType === 'owner_tenant') {
    if (!tenancyId) return { ok: false, reason: 'missing_tenancy_id' };
    context = await getOwnerTenantAgreementContext(tenancyId, agreementTemplateId, staffVars);
  } else {
    return { ok: false, reason: 'invalid_agreement_type' };
  }

  if (!context?.ok) return context;

  const templateId = extractIdFromUrlOrId(context.templateid);
  const folderId = extractIdFromUrlOrId(context.folderid);
  if (!templateId || !folderId) {
    return { ok: false, reason: 'template_or_folder_id_missing' };
  }

  const variables = { ...context.variables, ...variablesOverride };
  const mode = context.agreementtype;
  const propertyIdForRow = mode === 'owner_operator' ? (context.callbackid || propertyId) : null;
  const tenancyIdForRow = (mode === 'tenant_operator' || mode === 'owner_tenant') ? context.callbackid : null;

  let clientIdForRow = clientId || null;
  if (!clientIdForRow && propertyIdForRow) {
    const [cr] = await pool.query('SELECT client_id FROM propertydetail WHERE id = ? LIMIT 1', [propertyIdForRow]);
    if (cr?.[0]) clientIdForRow = cr[0].client_id;
  }
  if (!clientIdForRow && tenancyIdForRow) {
    const [tr] = await pool.query(
      'SELECT p.client_id FROM tenancy t JOIN roomdetail r ON r.id = t.room_id JOIN propertydetail p ON p.id = r.property_id WHERE t.id = ? LIMIT 1',
      [tenancyIdForRow]
    );
    if (tr?.[0]) clientIdForRow = tr[0].client_id;
  }

  const agreementId = randomUUID();
  const ownerIdForRow = mode === 'owner_operator' ? ownerId || null : null;
  await pool.query(
    `INSERT INTO agreement (id, client_id, mode, property_id, tenancy_id, owner_id, agreementtemplate_id, status, pdf_generating)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1)`,
    [
      agreementId,
      clientIdForRow,
      mode,
      propertyIdForRow,
      tenancyIdForRow,
      ownerIdForRow,
      agreementTemplateId || null
    ]
  );

  const authForPdf = await resolveAgreementPdfAuth(clientIdForRow);
  if (!authForPdf) {
    await pool.query(
      'UPDATE agreement SET pdf_generating = 0, status = ? WHERE id = ?',
      ['failed', agreementId]
    );
    return { ok: false, reason: 'GOOGLE_CREDENTIALS_REQUIRED', agreementId };
  }

  try {
    const { pdfUrl } = await generatePdfFromTemplate({
      templateId,
      folderId,
      filename: context.filename || 'Agreement',
      variables,
      authClient: authForPdf
    });
    await finalizeAgreementPdf(agreementId, pdfUrl);
    return { ok: true, agreementId, pdfUrl };
  } catch (e) {
    console.error('[agreement] Node PDF generation failed', e?.message || e);
    await pool.query(
      'UPDATE agreement SET pdf_generating = 0, status = ? WHERE id = ?',
      ['failed', agreementId]
    );
    return { ok: false, reason: 'PDF_GENERATION_FAILED', message: e?.message, agreementId };
  }
}

/**
 * After PDF URL is known: update agreement row, then propertydetail or tenancy snapshot.
 * Used by requestPdfGeneration (Node path).
 */
async function finalizeAgreementPdf(id, pdfUrl) {
  if (!id || !pdfUrl) {
    throw new Error('missing id or pdfUrl');
  }

  const [rows] = await pool.query(
    'SELECT id, mode, property_id, tenancy_id, sign1, sign2, tenantsign, operatorsign FROM agreement WHERE id = ? LIMIT 1',
    [id]
  );
  const agreement = rows[0];
  if (!agreement) {
    throw new Error('AGREEMENT_NOT_FOUND');
  }

  const now = new Date();

  await pool.query(
    `UPDATE agreement SET url = ?, status = 'completed', pdf_generating = 0, updated_at = ? WHERE id = ?`,
    [pdfUrl, now, id]
  );

  if (agreement.mode === 'owner_operator' && agreement.property_id) {
    const [propRows] = await pool.query(
      'SELECT id, signagreement, agreementstatus FROM propertydetail WHERE id = ? LIMIT 1',
      [agreement.property_id]
    );
    const property = propRows[0];
    if (property) {
      let list = [];
      try {
        if (property.agreementstatus) list = JSON.parse(property.agreementstatus);
      } catch {}
      if (!Array.isArray(list)) list = [];
      const snapshot = {
        agreementId: id,
        mode: agreement.mode,
        url: pdfUrl,
        sign1: agreement.sign1 || null,
        sign2: agreement.sign2 || null,
        updatedAt: now
      };
      const idx = list.findIndex((a) => a.agreementId === id);
      if (idx >= 0) list[idx] = snapshot;
      else list.push(snapshot);
      await pool.query(
        'UPDATE propertydetail SET signagreement = ?, agreementstatus = ?, updated_at = ? WHERE id = ?',
        [pdfUrl, JSON.stringify(list), now, property.id]
      );
    }
  }

  if ((agreement.mode === 'owner_tenant' || agreement.mode === 'tenant_operator') && agreement.tenancy_id) {
    const [tenRows] = await pool.query(
      'SELECT id, agreement FROM tenancy WHERE id = ? LIMIT 1',
      [agreement.tenancy_id]
    );
    const tenancy = tenRows[0];
    if (tenancy) {
      let agreements = [];
      try {
        if (tenancy.agreement) agreements = JSON.parse(tenancy.agreement);
      } catch {}
      if (!Array.isArray(agreements)) agreements = [];
      const snapshot = {
        agreementId: id,
        mode: agreement.mode,
        url: pdfUrl,
        sign1: agreement.sign1 || null,
        sign2: agreement.sign2 || null,
        updatedAt: now
      };
      const idx = agreements.findIndex((a) => a.agreementId === id);
      if (idx >= 0) agreements[idx] = snapshot;
      else agreements.push(snapshot);
      await pool.query(
        'UPDATE tenancy SET agreement = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(agreements), now, tenancy.id]
      );
    }
  }

  return { ok: true, id, url: pdfUrl };
}

/** Check if all required parties have signed for this mode. */
function isAgreementFullySigned(row) {
  if (!row || !row.mode) return false;
  const has = (v) => v != null && String(v).trim() !== '';
  if (row.mode === 'owner_operator') return has(row.ownersign) && has(row.operatorsign);
  if (row.mode === 'owner_tenant') return has(row.ownersign) && has(row.tenantsign);
  if (row.mode === 'tenant_operator') return has(row.operatorsign) && has(row.tenantsign);
  return false;
}

/**
 * Load agreement row for final PDF. Prefers full audit columns (migration 0090); falls back if operator_signed_at/hash missing.
 */
async function selectAgreementRowForFinalPdfComplete(agreementId) {
  const fullSql = `SELECT id, mode, owner_id, property_id, tenancy_id, client_id, agreementtemplate_id, status, url, pdfurl,
            ownersign, tenantsign, operatorsign, columns_locked, hash_draft,
            sign1,
            operator_signed_at, operator_signed_hash, operator_signed_ip,
            tenant_signed_at, tenant_signed_hash, tenant_signed_ip, owner_signed_at, owner_signed_hash, owner_signed_ip,
            created_at, updated_at
     FROM agreement WHERE id = ? LIMIT 1`;
  const legacySql = `SELECT id, mode, owner_id, property_id, tenancy_id, client_id, agreementtemplate_id, status, url, pdfurl,
            ownersign, tenantsign, operatorsign, columns_locked, hash_draft,
            sign1,
            created_at, updated_at
     FROM agreement WHERE id = ? LIMIT 1`;
  const legacySqlWithAuditButNoHash = `SELECT id, mode, owner_id, property_id, tenancy_id, client_id, agreementtemplate_id, status, url, pdfurl,
            ownersign, tenantsign, operatorsign, columns_locked, hash_draft,
            sign1,
            operator_signed_at, operator_signed_ip,
            tenant_signed_at, tenant_signed_hash, tenant_signed_ip, owner_signed_at, owner_signed_hash, owner_signed_ip,
            created_at, updated_at
     FROM agreement WHERE id = ? LIMIT 1`;
  const legacySqlWithIpsOnly = `SELECT id, mode, owner_id, property_id, tenancy_id, client_id, agreementtemplate_id, status, url, pdfurl,
            ownersign, tenantsign, operatorsign, columns_locked, hash_draft,
            sign1,
            operator_signed_ip,
            tenant_signed_ip, owner_signed_ip,
            created_at, updated_at
     FROM agreement WHERE id = ? LIMIT 1`;
  try {
    const [rows] = await pool.query(fullSql, [agreementId]);
    return rows[0] || null;
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (
      (e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054) &&
      (msg.includes('operator_signed_at') || msg.includes('operator_signed_hash'))
    ) {
      console.warn(
        '[agreement] agreement table missing 0090 columns (operator_signed_at/hash). Run src/db/migrations/0090_agreement_operator_signed_at_hash.sql — final PDF uses reduced audit appendix.'
      );
      // Prefer to preserve IPs and timestamps when those columns still exist,
      // even if operator_signed_at/hash columns are missing.
      try {
        const [rowsAudit] = await pool.query(legacySqlWithAuditButNoHash, [agreementId]);
        const r = rowsAudit[0];
        if (!r) return null;
        return { ...r, operator_signed_hash: null };
      } catch (_) {
        // Fallback again with a smaller set (IPs only).
        const [rowsIps] = await pool.query(legacySqlWithIpsOnly, [agreementId]);
        const r = rowsIps[0];
        if (!r) return null;
        return {
          ...r,
          operator_signed_at: null,
          operator_signed_hash: null,
          tenant_signed_at: null,
          tenant_signed_hash: null,
          owner_signed_at: null,
          owner_signed_hash: null
        };
      }
    }
    throw e;
  }
}

/**
 * When all parties have signed: generate final PDF (with signatures), set hash_final, status=completed, columns_locked=1.
 * Only call when columns_locked=0 and status in (ready_for_signature, locked).
 */
async function generateFinalPdfAndComplete(agreementId, options = {}) {
  const row = await selectAgreementRowForFinalPdfComplete(agreementId);
  if (!row) {
    logAgreementFinalPdfDiagnostic({
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'fail',
      reason: 'agreement_not_found'
    });
    return { ok: false, reason: 'agreement_not_found' };
  }
  if (row.columns_locked) {
    logAgreementFinalPdfDiagnostic({
      severity: 'info',
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'skip',
      reason: 'already_columns_locked',
      status: row.status,
      mode: row.mode
    });
    return { ok: true, alreadyCompleted: true };
  }
  if (row.status === COMPLETED) {
    logAgreementFinalPdfDiagnostic({
      severity: 'info',
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'skip',
      reason: 'already_completed_status'
    });
    return { ok: true, alreadyCompleted: true };
  }
  if (![READY_FOR_SIGNATURE, LOCKED].includes(row.status)) {
    logAgreementFinalPdfDiagnostic({
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'fail',
      reason: 'invalid_status',
      status: row.status,
      mode: row.mode,
      ...agreementSignSnapshot(row)
    });
    return { ok: false, reason: 'invalid_status' };
  }
  if (!isAgreementFullySigned(row)) {
    logAgreementFinalPdfDiagnostic({
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'fail',
      reason: 'not_fully_signed',
      mode: row.mode,
      status: row.status,
      ...agreementSignSnapshot(row)
    });
    return { ok: false, reason: 'not_fully_signed' };
  }

  const inlineStaffVars = sanitizeStaffVars(options.staffVars || {});
  let storedStaffVars = {};
  const rawSign1 = row.sign1 != null ? String(row.sign1).trim() : '';
  if (rawSign1) {
    const parsed = parseJson(rawSign1);
    if (parsed && typeof parsed === 'object') {
      storedStaffVars = sanitizeStaffVars(parsed);
    }
  }
  let staffVars = {
    staffname: inlineStaffVars.staffname || storedStaffVars.staffname || '',
    staffnric: inlineStaffVars.staffnric || storedStaffVars.staffnric || '',
    staffcontact: inlineStaffVars.staffcontact || storedStaffVars.staffcontact || '',
    staffemail: inlineStaffVars.staffemail || storedStaffVars.staffemail || ''
  };
  if (
    (row.mode === 'tenant_operator' || row.mode === 'owner_operator') &&
    !String(staffVars.staffname || '').trim() &&
    !String(staffVars.staffnric || '').trim()
  ) {
    const d = await loadOperatorStaffVarsForAgreementDraft(row);
    staffVars = {
      staffname: staffVars.staffname || d.staffname || '',
      staffnric: staffVars.staffnric || d.staffnric || '',
      staffcontact: staffVars.staffcontact || d.staffcontact || '',
      staffemail: staffVars.staffemail || d.staffemail || ''
    };
  }
  let context;
  if (row.mode === 'tenant_operator') {
    context = await getTenantAgreementContext(row.tenancy_id, row.agreementtemplate_id, staffVars);
  } else if (row.mode === 'owner_operator') {
    context = await getOwnerAgreementContext(row.owner_id, row.property_id, row.client_id, row.agreementtemplate_id, staffVars);
  } else if (row.mode === 'owner_tenant') {
    context = await getOwnerTenantAgreementContext(row.tenancy_id, row.agreementtemplate_id, staffVars);
  } else {
    logAgreementFinalPdfDiagnostic({
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'fail',
      reason: 'invalid_mode',
      mode: row.mode
    });
    return { ok: false, reason: 'invalid_mode' };
  }
  if (!context?.ok || !context.variables) {
    logAgreementFinalPdfDiagnostic({
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'fail',
      reason: context?.reason || 'context_failed',
      contextOk: context?.ok === true,
      mode: row.mode,
      tenancy_id: row.tenancy_id,
      property_id: row.property_id,
      owner_id: row.owner_id,
      agreementtemplate_id: row.agreementtemplate_id,
      client_id: row.client_id
    });
    return { ok: false, reason: context?.reason || 'context_failed' };
  }

  // If signatures were stored as data/base64, convert them to public https URLs
  // before generating final PDF (Google Docs needs https image URLs).
  async function convertSignatureFieldIfNeeded(field, signatureKey) {
    const raw = row[field];
    if (raw == null) return '';
    const s = String(raw).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;

    const res = await signatureValueToPublicUrl(s, {
      clientId: row.client_id,
      signatureKey
    });
    if (!res.ok || !res.value) return null;

    // Best-effort: persist converted https URL to DB to avoid re-upload on retries.
    if (!res.alreadyPublic) {
      try {
        await pool.query(
          `UPDATE agreement SET ${field} = ?, updated_at = NOW() WHERE id = ?`,
          [res.value, agreementId]
        );
      } catch (e) {
        console.warn('[agreement] signature conversion DB update failed:', field, e?.message || e);
      }
    }
    return res.value;
  }

  const ownersignPublic = await convertSignatureFieldIfNeeded('ownersign', 'ownersign');
  const tenantsignPublic = await convertSignatureFieldIfNeeded('tenantsign', 'tenantsign');
  const operatorsignPublic = await convertSignatureFieldIfNeeded('operatorsign', 'operatorsign');
  if (
    (row.ownersign && ownersignPublic == null) ||
    (row.tenantsign && tenantsignPublic == null) ||
    (row.operatorsign && operatorsignPublic == null)
  ) {
    logAgreementFinalPdfDiagnostic({
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'fail',
      reason: 'SIGNATURE_UPLOAD_FAILED',
      mode: row.mode,
      has_ownersign: Boolean(row.ownersign),
      has_tenantsign: Boolean(row.tenantsign),
      has_operatorsign: Boolean(row.operatorsign)
    });
    return { ok: false, reason: 'SIGNATURE_UPLOAD_FAILED' };
  }

  const variables = {
    ...context.variables,
    ownersign: ownersignPublic != null ? ownersignPublic : (row.ownersign || ''),
    tenantsign: tenantsignPublic != null ? tenantsignPublic : (row.tenantsign || ''),
    operatorsign: operatorsignPublic != null ? operatorsignPublic : (row.operatorsign || '')
  };
  /** Templates often use {{sign}} for tenant line; DB stores e-sign in tenantsign / ownersign.
   *  Do not reassign from row.* here — that would replace OSS/https URLs from convertSignatureFieldIfNeeded
   *  with raw data-URLs and break Google Docs inline images ({{operatorsign}} would stay as placeholder text). */
  if (row.mode === 'tenant_operator') {
    variables.sign = variables.tenantsign || variables.sign || '';
  } else if (row.mode === 'owner_tenant') {
    variables.sign = variables.tenantsign || variables.sign || '';
  } else if (row.mode === 'owner_operator') {
    variables.sign = variables.ownersign || variables.sign || '';
  }

  const templateId = extractIdFromUrlOrId(context.templateid);
  const folderId = extractIdFromUrlOrId(context.folderid);
  if (!templateId || !folderId) {
    logAgreementFinalPdfDiagnostic({
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'fail',
      reason: 'template_or_folder_missing',
      templateIdPresent: Boolean(templateId),
      folderIdPresent: Boolean(folderId),
      templateidRawLen: context.templateid != null ? String(context.templateid).length : 0,
      folderidRawLen: context.folderid != null ? String(context.folderid).length : 0
    });
    return { ok: false, reason: 'template_or_folder_missing' };
  }

  const authForPdf = await resolveAgreementPdfAuth(row.client_id);
  if (!authForPdf) {
    logAgreementFinalPdfDiagnostic({
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'fail',
      reason: 'GOOGLE_CREDENTIALS_REQUIRED',
      client_id: row.client_id,
      hint:
        'Set Company Settings Google Drive OAuth for this client, or env GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS'
    });
    return { ok: false, reason: 'GOOGLE_CREDENTIALS_REQUIRED' };
  }

  try {
    logAgreementFinalPdfDiagnostic({
      severity: 'info',
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'google_pdf_start',
      mode: row.mode,
      status: row.status,
      templateId,
      folderId,
      filename: (context.filename || 'Agreement') + '_final'
    });
    const genResult = await generatePdfFromTemplate({
      templateId,
      folderId,
      filename: (context.filename || 'Agreement') + '_final',
      variables,
      authClient: authForPdf,
      returnBufferOnly: true
    });
    const mainBodyBuf = genResult.pdfBuffer;
    const mainBodySha256 = createHash('sha256').update(mainBodyBuf).digest('hex');
    const generatedAt = new Date();
    // If operator_signed_hash is missing (DB not migrated with 0090),
    // we can still compute an audit hash from the available fields.
    let operatorSignedHash = row.operator_signed_hash || '';
    if (
      (!operatorSignedHash || operatorSignedHash === 'null' || operatorSignedHash === 'undefined') &&
      row.operator_signed_at &&
      row.operatorsign &&
      row.hash_draft
    ) {
      try {
        const d = new Date(row.operator_signed_at);
        if (!Number.isNaN(d.getTime())) {
          const operatorSignedAtIso = d.toISOString();
          const signStrRaw = String(row.operatorsign).trim();
          const hashDraft = String(row.hash_draft != null ? row.hash_draft : '');
          const payload = [agreementId, signStrRaw, operatorSignedAtIso, hashDraft].join('|');
          operatorSignedHash = createHash('sha256').update(payload, 'utf8').digest('hex');
        }
      } catch {
        // ignore; audit hash stays blank
      }
    }
    const appendixBuf = await buildSigningAuditPdfBuffer({
      agreementId: row.id,
      mode: row.mode,
      hashDraft: row.hash_draft || '',
      mainBodySha256,
      operatorSignedAt: row.operator_signed_at,
      operatorSignedHash: operatorSignedHash || '',
      operatorSignedIp: row.operator_signed_ip || '',
      tenantSignedAt: row.tenant_signed_at,
      tenantSignedHash: row.tenant_signed_hash || '',
      ownerSignedAt: row.owner_signed_at,
      ownerSignedHash: row.owner_signed_hash || '',
      ownerSignedIp: row.owner_signed_ip || '',
      tenantSignedIp: row.tenant_signed_ip || '',
      generatedAt
    });
    const mergedBuf = await mergePdfBuffers(mainBodyBuf, appendixBuf);
    const hashFinal = createHash('sha256').update(mergedBuf).digest('hex');
    const pdfUrl = await uploadPdfBufferToDriveFolder({
      pdfBuffer: mergedBuf,
      fileName: (context.filename || 'Agreement') + '_final',
      folderId,
      authClient: authForPdf
    });
    const now = generatedAt;

    await pool.query(
      `UPDATE agreement SET url = ?, pdfurl = ?, hash_final = ?, status = ?, columns_locked = 1, updated_at = ? WHERE id = ?`,
      [pdfUrl, pdfUrl, hashFinal, COMPLETED, now, agreementId]
    );

    const [ag] = await pool.query(
      'SELECT id, mode, property_id, tenancy_id FROM agreement WHERE id = ? LIMIT 1',
      [agreementId]
    );
    const agreement = ag[0];
    if (agreement?.mode === 'owner_operator' && agreement.property_id) {
      const [propRows] = await pool.query(
        'SELECT id, signagreement, agreementstatus FROM propertydetail WHERE id = ? LIMIT 1',
        [agreement.property_id]
      );
      const property = propRows[0];
      if (property) {
        let list = [];
        try {
          if (property.agreementstatus) list = JSON.parse(property.agreementstatus);
        } catch {}
        if (!Array.isArray(list)) list = [];
        const snapshot = { agreementId, mode: agreement.mode, url: pdfUrl, updatedAt: now };
        const idx = list.findIndex((a) => a.agreementId === agreementId);
        if (idx >= 0) list[idx] = snapshot;
        else list.push(snapshot);
        await pool.query(
          'UPDATE propertydetail SET signagreement = ?, agreementstatus = ?, updated_at = ? WHERE id = ?',
          [pdfUrl, JSON.stringify(list), now, property.id]
        );
      }
    }
    if ((agreement?.mode === 'owner_tenant' || agreement?.mode === 'tenant_operator') && agreement?.tenancy_id) {
      const [tenRows] = await pool.query(
        'SELECT id, agreement FROM tenancy WHERE id = ? LIMIT 1',
        [agreement.tenancy_id]
      );
      const tenancy = tenRows[0];
      if (tenancy) {
        let agreements = [];
        try {
          if (tenancy.agreement) agreements = JSON.parse(tenancy.agreement);
        } catch {}
        if (!Array.isArray(agreements)) agreements = [];
        const snapshot = { agreementId, mode: agreement.mode, url: pdfUrl, updatedAt: now };
        const idx = agreements.findIndex((a) => a.agreementId === agreementId);
        if (idx >= 0) agreements[idx] = snapshot;
        else agreements.push(snapshot);
        await pool.query(
          'UPDATE tenancy SET agreement = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify(agreements), now, tenancy.id]
        );
      }
    }

    logAgreementFinalPdfDiagnostic({
      severity: 'info',
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'ok',
      mode: row.mode,
      pdfUrl: pdfUrl ? String(pdfUrl).slice(0, 200) : null,
      hash_final_prefix: hashFinal ? String(hashFinal).slice(0, 16) : null
    });
    return { ok: true, pdfUrl, hash_final: hashFinal };
  } catch (e) {
    logAgreementFinalPdfDiagnostic({
      phase: 'generateFinalPdfAndComplete',
      agreementId,
      outcome: 'exception',
      reason: 'PDF_GENERATION_FAILED',
      mode: row?.mode,
      errorName: e?.name,
      errorMessage: e?.message,
      errorCode: e?.code,
      errno: e?.errno,
      stack: e?.stack ? String(e.stack).slice(0, 2500) : undefined
    });
    return { ok: false, reason: 'PDF_GENERATION_FAILED', message: e?.message };
  }
}

/**
 * Hook after any sign update: if status was ready_for_signature set to locked; if fully signed generate final PDF.
 * Call from admindashboard/tenantdashboard/ownerportal after updating operatorsign/tenantsign/ownersign.
 */
async function afterSignUpdate(agreementId, options = {}) {
  const [rows] = await pool.query(
    `SELECT id, mode, status, ownersign, tenantsign, operatorsign, columns_locked FROM agreement WHERE id = ? LIMIT 1`,
    [agreementId]
  );
  const row = rows[0];
  if (!row) {
    logAgreementFinalPdfDiagnostic({
      phase: 'afterSignUpdate',
      agreementId,
      outcome: 'fail',
      reason: 'agreement_not_found'
    });
    return;
  }
  if (row.columns_locked) {
    logAgreementFinalPdfDiagnostic({
      severity: 'info',
      phase: 'afterSignUpdate',
      agreementId,
      outcome: 'skip',
      reason: 'columns_locked',
      status: row.status,
      mode: row.mode
    });
    return;
  }

  if (row.status === READY_FOR_SIGNATURE) {
    await pool.query(
      `UPDATE agreement SET status = ?, updated_at = NOW() WHERE id = ?`,
      [LOCKED, agreementId]
    );
  }

  const [rows2] = await pool.query(
    `SELECT id, mode, status, ownersign, tenantsign, operatorsign, columns_locked FROM agreement WHERE id = ? LIMIT 1`,
    [agreementId]
  );
  const row2 = rows2[0];
  if (!row2) {
    logAgreementFinalPdfDiagnostic({
      phase: 'afterSignUpdate',
      agreementId,
      outcome: 'fail',
      reason: 'row_missing_after_lock_transition'
    });
    return;
  }

  if (!isAgreementFullySigned(row2)) {
    const st = String(row2.status || '').toLowerCase();
    if (st === 'locked' || st === 'ready_for_signature') {
      logAgreementFinalPdfDiagnostic({
        phase: 'afterSignUpdate',
        agreementId,
        outcome: 'skip',
        reason: 'not_fully_signed_yet',
        status: row2.status,
        mode: row2.mode,
        ...agreementSignSnapshot(row2),
        hint:
          'Final PDF only runs when isAgreementFullySigned; if both parties signed in UI, verify DB columns tenantsign/operatorsign/ownersign saved for this mode.'
      });
    }
    return;
  }

  logAgreementFinalPdfDiagnostic({
    severity: 'info',
    phase: 'afterSignUpdate',
    agreementId,
    outcome: 'finalize_attempt',
    mode: row2.mode,
    status: row2.status,
    ...agreementSignSnapshot(row2)
  });

  try {
    const fin = await generateFinalPdfAndComplete(agreementId, options);
    if (!fin || fin.ok !== true) {
      logAgreementFinalPdfDiagnostic({
        phase: 'afterSignUpdate',
        agreementId,
        outcome: 'finalize_returned_not_ok',
        finOk: fin?.ok,
        reason: fin?.reason,
        message: fin?.message || null,
        hint: 'See preceding generateFinalPdfAndComplete lines with same agreementId for details.'
      });
    } else {
      logAgreementFinalPdfDiagnostic({
        severity: 'info',
        phase: 'afterSignUpdate',
        agreementId,
        outcome: 'finalize_ok',
        pdfUrl: fin.pdfUrl ? String(fin.pdfUrl).slice(0, 200) : null
      });
    }
  } catch (e) {
    logAgreementFinalPdfDiagnostic({
      phase: 'afterSignUpdate',
      agreementId,
      outcome: 'finalize_threw',
      errorName: e?.name,
      errorMessage: e?.message,
      stack: e?.stack ? String(e.stack).slice(0, 2500) : undefined
    });
  }
}

/**
 * Hook: when profile/data is complete, generate draft PDF (prepare-for-signature).
 * Call from frontend or after profile save. Idempotent: if already ready/locked/completed with url, no-op.
 */
async function tryPrepareDraftForAgreement(agreementId) {
  const [rows] = await pool.query(
    `SELECT id, status, url, pdfurl, columns_locked FROM agreement WHERE id = ? LIMIT 1`,
    [agreementId]
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'agreement_not_found' };
  if (row.columns_locked) return { ok: true, skipped: 'already_completed' };
  if (row.url || row.pdfurl) return { ok: true, skipped: 'already_has_url' };
  const dataComplete = await isAgreementDataComplete(agreementId);
  if (!dataComplete.ok) {
    return {
      ok: false,
      reason: dataComplete.reason,
      missingFields: dataComplete.missingFields
    };
  }
  return prepareAgreementForSignature(agreementId);
}

/**
 * Variable names available in agreement templates per mode (for internal use).
 * Must match the keys in getTenantAgreementContext / getOwnerAgreementContext / getOwnerTenantAgreementContext.
 * - period: 租期长度，由 tenancy begin/end 算出，e.g. "12 months"
 * - paymentdate: 每月几号（来自 tenancy.begin 的日），e.g. "05"
 * - paymentday: 每月几号支付租金，优先 operator admin.rental.value，否则同 paymentdate；e.g. "5"
 */
const AGREEMENT_VARIABLES_BY_MODE = {
  tenant_operator: [
    'date', 'begin', 'end', 'paymentdate', 'paymentday', 'period', 'rental', 'deposit', 'parkinglot', 'currency',
    'tenantname', 'tenantnric', 'tenantaddress', 'tenantphone', 'tenantemail', 'sign', 'tenantsign',
    'client', 'clientname', 'clientssm', 'clientuen', 'clientaddress', 'clientphone', 'clientemail', 'clientpicname', 'clientchop', 'operatorsign',
    'staffname', 'staffnric', 'staffcontact', 'staffemail',
    // Aliases for template authors (operator signature signer profile)
    'username', 'usernric', 'useremail', 'userphone',
    'rentalapartmentname', 'rentalunitnumber', 'rentalroomname', 'rentaladdress',
    'meterid', 'percentage', 'percentage_display'
  ],
  owner_operator: [
    'date', 'client', 'clientname', 'clientssm', 'clientuen', 'paymentday', 'clientaddress', 'clientphone', 'clientemail', 'clientchop', 'operatorsign',
    'ownername', 'ownernric', 'owneremail', 'ownercontact', 'owneraddress', 'sign', 'ownersign',
    // Aliases: operator signature signer profile
    'username', 'usernric', 'useremail', 'userphone',
    'nricfront', 'nricback',
    'rentalapartmentname', 'rentalunitnumber', 'rentalroomname', 'rentaladdress',
    'percentage', 'percentage_display'
  ],
  owner_tenant: [
    'date', 'begin', 'end', 'paymentdate', 'paymentday', 'period', 'rental', 'deposit', 'parkinglot', 'currency',
    'ownername', 'ownernric', 'owneremail', 'ownercontact', 'owneraddress', 'ownersign',
    'nricfront', 'nricback',
    'tenantname', 'tenantnric', 'tenantemail', 'tenantphone', 'tenantaddress', 'tenantsign',
    'rentalapartmentname', 'rentalunitnumber', 'rentalroomname', 'rentaladdress',
    'percentage', 'percentage_display',
    'clientname', 'clientssm', 'clientuen', 'clientaddress', 'clientphone', 'clientemail', 'clientchop',
    // Aliases for template authors (tenant profile)
    'username', 'usernric', 'useremail', 'userphone'
  ],
  /** Cleanlemons — operator ↔ staff offer letter (minimal placeholder set). */
  operator_staff: [
    'agreement_date',
    'currency',
    'operator_company_name',
    'operator_ssm',
    'operator_chop',
    'operator_phone',
    'operator_email',
    'operator_pic_name',
    'operator_pic_nric',
    'operator_sign',
    'staff_name',
    'staff_nric',
    'staff_nricfront',
    'staff_nricback',
    'staff_email',
    'staff_phone',
    'staff_sign',
    'salary',
    'staff_start_date',
    'staff_address'
  ],
  /** Cleanlemons — operator ↔ client cleaning agreement (minimal placeholder set). */
  operator_client: [
    'agreement_date',
    'currency',
    'operator_company_name',
    'operator_ssm',
    'operator_chop',
    'operator_phone',
    'operator_email',
    'operator_pic_name',
    'operator_pic_nric',
    'operator_sign',
    'client_name',
    'client_nric',
    'client_contact',
    'client_phone',
    'client_email',
    'client_address',
    'client_sign'
  ]
};

/** Variables grouped by role for reference API and .docx: Owner / Tenant / Operator / General */
const VARIABLES_BY_ROLE = {
  owner: { label: 'Owner', vars: ['ownername', 'ownernric', 'owneremail', 'ownercontact', 'owneraddress', 'ownersign', 'nricfront', 'nricback'] },
  tenant: { label: 'Tenant', vars: ['tenantname', 'tenantnric', 'tenantemail', 'tenantphone', 'tenantaddress', 'sign', 'tenantsign', 'username', 'usernric', 'useremail', 'userphone'] },
  operator: { label: 'Operator', vars: ['client', 'clientname', 'clientssm', 'clientuen', 'clientaddress', 'clientphone', 'clientemail', 'clientpicname', 'clientchop', 'operatorsign', 'staffname', 'staffnric', 'staffcontact', 'staffemail', 'username', 'usernric', 'useremail', 'userphone'] },
  general: { label: 'General', vars: ['date', 'begin', 'end', 'paymentdate', 'paymentday', 'period', 'rental', 'deposit', 'parkinglot', 'currency', 'rentalapartmentname', 'rentalunitnumber', 'rentalroomname', 'rentaladdress', 'meterid', 'percentage', 'percentage_display'] }
};

function getAgreementVariablesReference() {
  return VARIABLES_BY_ROLE;
}

/** Sample value per variable for Word doc: {{varname}} e.g. sample */
const VARIABLE_SAMPLES = {
  date: '12 March 2025',
  begin: '1 January 2025',
  end: '31 December 2025',
  paymentdate: '5',
  paymentday: '5',
  period: '12 months',
  rental: 'MYR/SGD 1,500.00',
  currency: 'MYR or SGD',
  tenantname: 'John Doe',
  tenantnric: '900101-01-1234',
  tenantaddress: '123, Jalan Example, Kuala Lumpur',
  tenantphone: '+60 12-345 6789',
  tenantemail: 'john@example.com',
  sign: '(tenant signature image)',
  tenantsign: '(tenant e-signature image)',
  ownersign: '(owner signature image)',
  operatorsign: '(operator / staff signature image)',
  client: 'ABC Coliving Sdn Bhd',
  clientname: 'ABC Coliving Sdn Bhd',
  clientssm: '12345678-X',
  clientuen: '(Singapore UEN if SGD)',
  clientaddress: '456, Jalan Biz, KL',
  clientphone: '+60 3-1234 5678',
  clientemail: 'admin@abccoliving.com',
  clientpicname: 'abccoliving',
  clientchop: '(company chop image)',
  staffname: 'Ali Ahmad',
  staffnric: '880202-02-5678',
  staffcontact: '+60 12-987 6543',
  staffemail: 'ali@abccoliving.com',
  username: 'Ali Ahmad',
  usernric: '880202-02-5678',
  useremail: 'ali@abccoliving.com',
  userphone: '+60 12-987 6543',
  ownername: 'Jane Smith',
  ownernric: '850303-03-9012',
  owneremail: 'jane@example.com',
  ownercontact: '+60 12-111 2233',
  owneraddress: 'Kuala Lumpur',
  nricfront: '(NRIC front image)',
  nricback: '(NRIC back image)',
  rentalapartmentname: 'Sunway Residences',
  rentalunitnumber: 'B-13-07',
  rentalroomname: 'Room A',
  rentaladdress: 'Room A, Sunway Residences, Jalan PJ',
  deposit: 'MYR/SGD 1,100.00',
  parkinglot: 'Lot A, Lot B',
  meterid: 'METER001',
  percentage: '70',
  percentage_display: '70.00%',
  effective_date: '1 April 2026',
  agreement_date: '28 March 2026',
  start_date: '1 May 2026',
  end_date: '30 April 2027',
  notes: '(remarks)',
  service_scope: 'Weekly residential cleaning, supplies included',
  payment_terms: 'Net 14 days via bank transfer',
  salary: 'MYR 2,000.00',
  operator_company_name: 'Cleanlemons Sdn Bhd',
  operator_name: 'Cleanlemons Sdn Bhd',
  operator_ssm: '1234567-A',
  operator_uen: '1234567-A',
  operator_registered_address: 'Level 5, Menara Example, Kuala Lumpur',
  operator_chop: '(company chop image)',
  // operator_phone, operator_email, operator_pic_name, operator_pic_contact: supervisor/PIC acting for the operator signature
  operator_phone: '+60 3-1234 5678',
  operator_email: 'ops@cleanlemons.com',
  operator_pic_name: 'Ahmad Operations',
  operator_pic_contact: '+60 12-345 6789',
  operator_pic_nric: '900101-01-1234',
  operator_sign: '(operator signature image)',
  staff_name: 'Siti Aminah',
  staff_nric: '900101-01-1234',
  staff_nricfront: '(NRIC front image)',
  staff_nricback: '(NRIC back image)',
  staff_ic: '900101-01-1234',
  staff_email: 'siti@example.com',
  staff_phone: '+60 12-987 6543',
  staff_contact: '+60 12-987 6543',
  staff_sign: '(staff signature image)',
  staffsign: '(staff signature image)',
  staff_start_date: '1 May 2026',
  staff_address: 'No. 1, Jalan Contoh, Kuala Lumpur',
  client_name: 'Lee Trading Sdn Bhd',
  client_company: 'Lee Trading Sdn Bhd',
  client_nric: 'REG-998877',
  client_contact: '+60 16-111 2222',
  client_address: 'No. 88, Jalan Client, Petaling Jaya',
  client_phone: '+60 16-222 3333',
  client_email: 'invoices@customer.example.com',
  client_sign: '(client signature image)'
};

/**
 * Rows for Cleanlemons template-variable reference (.docx): variable key + example string.
 * @param {'operator_staff'|'operator_client'} mode
 */
function getClnAgreementVariablesReferenceRows(mode) {
  const m = String(mode || '').trim() === 'operator_client' ? 'operator_client' : 'operator_staff';
  const keys = AGREEMENT_VARIABLES_BY_MODE[m];
  if (!keys || !Array.isArray(keys)) return [];
  return keys.map((k) => ({ key: k, example: VARIABLE_SAMPLES[k] != null ? String(VARIABLE_SAMPLES[k]) : '' }));
}

/** Keys in mode lists but not shown again in Word “Other keys” appendix (legacy / empty). */
const CLN_WORD_EXCLUDE_KEYS = new Set([]);

/** Word reference only: optional display overrides. */
const CLN_WORD_EXAMPLE_OVERRIDES = {};

function exampleForClnWordRow(key) {
  const k = String(key || '');
  if (Object.prototype.hasOwnProperty.call(CLN_WORD_EXAMPLE_OVERRIDES, k)) {
    return CLN_WORD_EXAMPLE_OVERRIDES[k];
  }
  if (VARIABLE_SAMPLES[k] != null) return String(VARIABLE_SAMPLES[k]);
  return '';
}

/**
 * Structured rows for Cleanlemons operator-portal Word reference — matches portal UI sections
 * (General → Operator → Staff → Client), including repeated keys where the UI lists them twice.
 * @returns {Array<
 *   | { kind: 'section'; title: string; description: string }
 *   | { kind: 'subsection'; title: string }
 *   | { kind: 'var'; key: string; example: string }
 * >}
 */
function getClnAgreementVariablesReferenceDocxRows() {
  /** @type {Array<{ kind: 'section'; title: string; description: string } | { kind: 'subsection'; title: string } | { kind: 'var'; key: string; example: string }>} */
  const out = [];
  const sec = (title, description) => {
    out.push({ kind: 'section', title, description: description || '' });
  };
  const v = (key) => {
    out.push({ kind: 'var', key, example: exampleForClnWordRow(key) });
  };

  sec('General', 'Use in both template modes (staff offer letter and client agreement).');
  for (const k of CLN_AGREEMENT_VAR_REF.generalKeys) {
    v(k);
  }

  sec(
    'Operator',
    'From Company Settings → company profile (`cln_operator_settings.settings_json`). Chop: public image URL if used as inline image.'
  );
  for (const k of [
    'operator_company_name',
    'operator_ssm',
    'operator_chop',
    'operator_phone',
    'operator_email',
    'operator_pic_name',
    'operator_pic_nric',
    'operator_sign'
  ]) {
    v(k);
  }

  sec(
    'Staff (operator_staff mode only)',
    'Name, phone, salary (`salary_basic`), start date (`joined_at`) from `cln_employeedetail` + `cln_employee_operator` CRM JSON (operator + recipient email). NRIC / address from `portal_account` when the member has a profile. Fallback salary / start date from the agreement row if contact is missing or fields are empty.'
  );
  for (const k of [
    'staff_name',
    'staff_nric',
    'staff_nricfront',
    'staff_nricback',
    'staff_email',
    'staff_phone',
    'staff_sign',
    'salary',
    'staff_start_date',
    'staff_address'
  ]) {
    v(k);
  }

  sec(
    'Client (operator_client mode only)',
    '{{client_*}} = your customer. Filled from agreement row + portal profile when they have an account.'
  );
  for (const k of [
    'client_name',
    'client_nric',
    'client_contact',
    'client_phone',
    'client_email',
    'client_address',
    'client_sign'
  ]) {
    v(k);
  }

  const staffKeys = AGREEMENT_VARIABLES_BY_MODE.operator_staff || [];
  const clientKeys = AGREEMENT_VARIABLES_BY_MODE.operator_client || [];
  const seen = new Set();
  for (const row of out) {
    if (row.kind === 'var') seen.add(row.key);
  }
  const appendix = [];
  for (const k of [...staffKeys, ...clientKeys]) {
    if (CLN_WORD_EXCLUDE_KEYS.has(k)) continue;
    if (seen.has(k)) continue;
    appendix.push(k);
    seen.add(k);
  }
  if (appendix.length) {
    sec('Other keys in system templates', 'Present in mode lists but not in the sections above.');
    for (const k of appendix) v(k);
  }

  return out;
}

/** Flat {{key}}, example list in document order (includes duplicate keys when UI repeats them). */
function getClnAgreementVariablesReferenceRowsAll() {
  return getClnAgreementVariablesReferenceDocxRows()
    .filter((r) => r.kind === 'var')
    .map((r) => ({ key: r.key, example: r.example }));
}

/**
 * Sample variables for a template mode (for preview PDF). Keys from AGREEMENT_VARIABLES_BY_MODE, values from VARIABLE_SAMPLES.
 * @param {string} mode - owner_tenant | owner_operator | tenant_operator | operator_staff | operator_client
 * @returns {Record<string, string>}
 */
function getSampleVariablesForMode(mode) {
  const keys = AGREEMENT_VARIABLES_BY_MODE[mode];
  if (!keys || !Array.isArray(keys)) return {};
  const out = {};
  for (const k of keys) {
    out[k] = VARIABLE_SAMPLES[k] ?? '';
  }
  // Short aliases many templates use in Google Docs (long names in VARIABLE_SAMPLES)
  const aliasToSource = {
    apartmentname: 'rentalapartmentname',
    unitnumber: 'rentalunitnumber',
    roomname: 'rentalroomname',
    address: 'rentaladdress'
  };
  for (const [alias, src] of Object.entries(aliasToSource)) {
    if (!out[alias] && VARIABLE_SAMPLES[src]) out[alias] = VARIABLE_SAMPLES[src];
  }
  // Operator display name — templates often use {{client}}
  if (!out.client && VARIABLE_SAMPLES.client) out.client = VARIABLE_SAMPLES.client;
  return out;
}

function applySampleCurrency(variables, currencyCode) {
  const code = normalizeCurrencyCode(currencyCode);
  const out = { ...variables, currency: code };
  if (Object.prototype.hasOwnProperty.call(variables, 'rental')) {
    out.rental = `${code} 1,500.00`;
  }
  if (Object.prototype.hasOwnProperty.call(variables, 'deposit')) {
    out.deposit = `${code} 1,100.00`;
  }
  return out;
}

/** Same order as Portal "Template variables reference" (Owner → Tenant → Operator → General). */
const PREVIEW_VAR_KEYS_ORDERED = (() => {
  const a = [
    ...VARIABLES_BY_ROLE.owner.vars,
    ...VARIABLES_BY_ROLE.tenant.vars,
    ...VARIABLES_BY_ROLE.operator.vars,
    ...VARIABLES_BY_ROLE.general.vars
  ];
  const seen = new Set();
  const out = [];
  for (const k of a) {
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
})();

/**
 * Template preview (OSS / sample PDF): every reference variable + sample value; replaceOrder = longest key first.
 * @returns {{ variables: Record<string, string>, replaceOrder: string[] }}
 */
function getSampleVariablesForTemplatePreview() {
  const variables = {};
  for (const k of PREVIEW_VAR_KEYS_ORDERED) {
    variables[k] =
      VARIABLE_SAMPLES[k] != null && VARIABLE_SAMPLES[k] !== ''
        ? String(VARIABLE_SAMPLES[k])
        : '(sample)';
  }
  const replaceOrder = [...PREVIEW_VAR_KEYS_ORDERED].sort((a, b) => b.length - a.length);
  return { variables, replaceOrder };
}

/** Docs API replaceAllText / batchUpdate fails on some imported or legacy Google Docs. */
function isGoogleDocsBatchUpdateUnsupportedError(err) {
  const s = `${err?.message || ''} ${err?.response?.data?.error?.message || ''}`;
  return /not supported for this document/i.test(s);
}

function isDriveStorageQuotaError(err) {
  const s = `${err?.message || ''} ${err?.response?.data?.error?.message || ''}`;
  const reasons = err?.response?.data?.error?.errors;
  const reasonList = Array.isArray(reasons) ? reasons.map((e) => e.reason).join(' ') : '';
  return (
    s.includes('storageQuotaExceeded') ||
    reasonList.includes('storageQuotaExceeded') ||
    /storage quota/i.test(s)
  );
}

/**
 * Generate preview PDF from agreement template with sample variables; replaced text is styled red.
 * Template must have templateurl, folderurl, title, mode. Returns { pdfUrl, hash }.
 * @param {object} template - { templateurl, folderurl, title, mode }
 * @param {{ clientId?: string|null }} [opts]
 * @returns {Promise<{ pdfUrl: string, hash?: string }>}
 */
async function generateTemplatePreviewPdfUrl(template, opts = {}) {
  const templateId = extractIdFromUrlOrId(template.templateurl);
  const folderId = extractIdFromUrlOrId(template.folderurl);
  if (!templateId) throw new Error('missing template url');
  if (!folderId) throw new Error('missing folder url');
  const previewCurrency = await getClientCurrencyCode(opts.clientId);
  const variables = applySampleCurrency(getSampleVariablesForMode(template.mode || ''), previewCurrency);
  const authForPdf = await resolveAgreementPdfAuth(opts.clientId);
  if (!authForPdf) throw new Error('GOOGLE_CREDENTIALS_NOT_CONFIGURED');
  try {
    return await generatePdfFromTemplate({
      templateId,
      folderId,
      filename: `Preview-${template.title || 'Agreement'}`,
      variables,
      styleReplacedTextRed: true,
      authClient: authForPdf
    });
  } catch (err) {
    if (isGoogleDocsBatchUpdateUnsupportedError(err) || isDriveStorageQuotaError(err)) {
      console.warn(
        '[agreement] generateTemplatePreviewPdfUrl fallback (HTML export → PDF → Drive):',
        err.message
      );
      const fb = await generateTemplatePreviewPdfBufferNoDrive(template, opts);
      const pdfBuffer = fb.pdfBuffer;
      const hash = createHash('sha256').update(pdfBuffer).digest('hex');
      const pdfUrl = await uploadPdfBufferToDriveFolder({
        pdfBuffer,
        fileName: `Preview-${template.title || 'Agreement'}`,
        folderId,
        authClient: authForPdf
      });
      return { pdfUrl, hash };
    }
    throw err;
  }
}

/**
 * Same as generateTemplatePreviewPdfUrl but returns PDF buffer only (no Drive upload). Use for download to avoid Drive quota.
 * @param {object} template - { templateurl, folderurl, title, mode }
 * @param {{ clientId?: string|null }} [opts]
 * @returns {Promise<{ pdfBuffer: Buffer, hash: string }>}
 */
async function generateTemplatePreviewPdfBuffer(template, opts = {}) {
  const templateId = extractIdFromUrlOrId(template.templateurl);
  const folderId = extractIdFromUrlOrId(template.folderurl);
  if (!templateId) throw new Error('missing template url');
  if (!folderId) throw new Error('missing folder url');
  const previewCurrency = await getClientCurrencyCode(opts.clientId);
  const variables = applySampleCurrency(getSampleVariablesForMode(template.mode || ''), previewCurrency);
  const authForPdf = await resolveAgreementPdfAuth(opts.clientId);
  if (!authForPdf) throw new Error('GOOGLE_CREDENTIALS_NOT_CONFIGURED');
  try {
    return await generatePdfFromTemplate({
      templateId,
      folderId,
      filename: `Preview-${template.title || 'Agreement'}`,
      variables,
      styleReplacedTextRed: true,
      returnBufferOnly: true,
      authClient: authForPdf
    });
  } catch (err) {
    if (isGoogleDocsBatchUpdateUnsupportedError(err) || isDriveStorageQuotaError(err)) {
      console.warn(
        '[agreement] generateTemplatePreviewPdfBuffer fallback (HTML export + PDF):',
        err.message
      );
      const fb = await generateTemplatePreviewPdfBufferNoDrive(template, opts);
      const pdfBuffer = fb.pdfBuffer;
      const hash = createHash('sha256').update(pdfBuffer).digest('hex');
      return { pdfBuffer, hash };
    }
    throw err;
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  const str = String(s);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Replace {{varname}} and [[varname]] in HTML with values; optionally wrap replaced text in red span.
 * Word templates often use [[date]], [[client]] etc.; we support both.
 * @param {string} html
 * @param {Record<string, string>} variables
 * @param {boolean} styleReplacedRed
 * @returns {string}
 */
function replaceVariablesInHtml(html, variables, styleReplacedRed) {
  let out = html;
  for (const [key, value] of Object.entries(variables || {})) {
    const safe = escapeHtml(value);
    const replacement = styleReplacedRed && safe ? `<span style="color:red">${safe}</span>` : safe;
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\{\\{\\s*${esc}\\s*\\}\\}`, 'g'), replacement);
    out = out.replace(new RegExp(`\\[\\[\\s*${esc}\\s*\\]\\]`, 'g'), replacement);
    out = out.replace(new RegExp("\\(\\(\\s*" + esc + "\\s*\\)\\)", 'g'), replacement);
  }
  return out;
}

/**
 * Preview PDF via Drive HTML export + in-memory replace + HTML→PDF (no new PDF file in target folder).
 * Needs Google auth and templateurl; folderurl optional for this path.
 * @param {object} template - { templateurl, title?, mode }
 * @param {{ clientId?: string|null }} [opts]
 * @returns {Promise<{ pdfBuffer: Buffer }>}
 */
async function generateTemplatePreviewPdfBufferNoDrive(template, opts = {}) {
  const docId = extractIdFromUrlOrId(template.templateurl);
  if (!docId) throw new Error('missing template url');
  const authForPdf = await resolveAgreementPdfAuth(opts.clientId);
  if (!authForPdf) throw new Error('GOOGLE_CREDENTIALS_NOT_CONFIGURED');
  const mode = template.mode || 'tenant_operator';
  const html = await exportGoogleDocAsHtml(docId, authForPdf);
  console.log('[agreement preview] docId=', docId, 'mode=', mode, 'htmlLength=', html?.length, 'htmlStart=', (html || '').substring(0, 200).replace(/\s+/g, ' '));
  const previewCurrency = await getClientCurrencyCode(opts.clientId);
  const variables = applySampleCurrency(getSampleVariablesForMode(mode), previewCurrency);
  const htmlWithVars = replaceVariablesInHtml(html, variables, true);
  console.log('[agreement preview] varsCount=', Object.keys(variables).length, 'htmlWithVarsLength=', htmlWithVars?.length);
  const pdfBuffer = await htmlToPdfBuffer(htmlWithVars);
  return { pdfBuffer };
}

/**
 * Preview PDF for download: Node + Google API (copy template → replace → export PDF), or HTML-export fallback on storage quota.
 * @param {object} template - { templateurl?, folderurl?, title?, mode }
 * @param {{ clientId?: string|null }} [opts]
 * @returns {Promise<{ pdfBuffer: Buffer, source?: string }>}
 */
async function generateTemplatePreviewPdfBufferForDownload(template, opts = {}) {
  const authForPdf = await resolveAgreementPdfAuth(opts.clientId);
  if (!authForPdf) {
    throw new Error('GOOGLE_CREDENTIALS_NOT_CONFIGURED');
  }
  const templateId = extractIdFromUrlOrId(template.templateurl);
  const folderId = extractIdFromUrlOrId(template.folderurl || '');
  const tempFolderId = (process.env.AGREEMENT_PREVIEW_TEMP_FOLDER_ID || '').trim();
  console.log('[agreement preview] auth=', !!authForPdf, 'templateId=', templateId, 'folderId=', folderId || '(none)', 'AGREEMENT_PREVIEW_TEMP_FOLDER_ID=', tempFolderId || '(not set)');
  if (templateId && folderId) {
    const mode = template.mode || 'tenant_operator';
    const previewCurrency = await getClientCurrencyCode(opts.clientId);
    const variables = applySampleCurrency(getSampleVariablesForMode(mode), previewCurrency);
    console.log('[agreement preview] path=Node+GoogleAPI templateId=', templateId, 'folderId=', folderId, 'mode=', mode, 'returnBufferOnly=true');
    try {
      const result = await generatePdfFromTemplate({
        templateId,
        folderId,
        filename: `Preview-${template.title || 'Agreement'}`,
        variables,
        styleReplacedTextRed: true,
        returnBufferOnly: true,
        authClient: authForPdf
      });
      console.log('[agreement preview] Node+GoogleAPI success pdfBufferLength=', result.pdfBuffer?.length);
      return { pdfBuffer: result.pdfBuffer, source: 'google-api' };
    } catch (err) {
      console.error('[agreement preview] Node+GoogleAPI failed:', err.message, 'code=', err.code, 'status=', err.response?.status, 'data=', JSON.stringify(err.response?.data || {}));
      const isQuotaExceeded = isDriveStorageQuotaError(err);
      const unsupportedDoc = isGoogleDocsBatchUpdateUnsupportedError(err);
      if (isQuotaExceeded || unsupportedDoc) {
        console.warn(
          '[agreement preview] fallback to HTML export + Puppeteer:',
          unsupportedDoc ? 'batch_update_unsupported' : 'quota'
        );
        const fallback = await generateTemplatePreviewPdfBufferNoDrive(template, opts);
        return { pdfBuffer: fallback.pdfBuffer, source: 'html-export' };
      }
      throw err;
    }
  }
  console.log('[agreement preview] path=HTML export + Puppeteer (no folder url)');
  const fallback = await generateTemplatePreviewPdfBufferNoDrive(template, opts);
  return { pdfBuffer: fallback.pdfBuffer, source: 'html-export' };
}

module.exports = {
  operatorSignerStaffVarsFromAccessStaff,
  mergeOperatorStaffVarsForAgreement,
  getTenantAgreementContext,
  getOwnerAgreementContext,
  getOwnerTenantAgreementContext,
  getOwnerTenantAgreementHtml,
  requestPdfGeneration,
  isAgreementDataComplete,
  prepareAgreementForSignature,
  tryPrepareDraftForAgreement,
  isAgreementFullySigned,
  generateFinalPdfAndComplete,
  afterSignUpdate,
  logAgreementFinalPdfDiagnostic,
  getAgreementVariablesReference,
  getSampleVariablesForMode,
  getSampleVariablesForTemplatePreview,
  getClnAgreementVariablesReferenceRows,
  getClnAgreementVariablesReferenceRowsAll,
  getClnAgreementVariablesReferenceDocxRows,
  getClientCurrencyCode,
  applySampleCurrency,
  extractIdFromUrlOrId,
  resolveAgreementPdfAuth,
  generateTemplatePreviewPdfUrl,
  generateTemplatePreviewPdfBuffer,
  generateTemplatePreviewPdfBufferNoDrive,
  generateTemplatePreviewPdfBufferForDownload,
  READY_FOR_SIGNATURE,
  LOCKED,
  COMPLETED
};
