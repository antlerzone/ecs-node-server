/**
 * Agreement context – migrated from Wix backend/access/agreementdetail.jsw.
 * Uses MySQL: agreementtemplate, tenancy, tenantdetail, roomdetail, propertydetail,
 * clientdetail (profile JSON), meterdetail, ownerdetail. All FK by _id (no _wixid).
 *
 * PDF flow (Node-first, no GAS required):
 * - If GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS is set, Node uses
 *   Google Docs + Drive API to generate PDF and then calls finalizeAgreementPdf directly.
 * - Otherwise falls back to GAS: requestPdfGeneration sends payload to GAS;
 *   GAS POSTs to /api/agreement/callback with { id, pdfUrl }; finalizeAgreementPdf updates DB.
 */

const { randomUUID } = require('crypto');
const axios = require('axios');
const pool = require('../../config/db');
const { getAccessContextByEmail } = require('../access/access.service');
const { generatePdfFromTemplate, getAuth } = require('./google-docs-pdf');

const GAS_ENDPOINT = process.env.AGREEMENT_GAS_ENDPOINT || '';
const GAS_FETCH_TIMEOUT_MS = 25000;

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

async function getTemplate(agreementTemplateId) {
  const [rows] = await pool.query(
    'SELECT id, templateurl, folderurl, html, title FROM agreementtemplate WHERE id = ? LIMIT 1',
    [agreementTemplateId]
  );
  return rows[0] || null;
}

async function getTenancy(tenancyId) {
  const [rows] = await pool.query(
    'SELECT id, tenant_id, room_id, begin, `end`, rental, sign FROM tenancy WHERE id = ? LIMIT 1',
    [tenancyId]
  );
  return rows[0] || null;
}

async function getTenant(tenantId) {
  const [rows] = await pool.query(
    'SELECT id, fullname, nric, address, phone, email FROM tenantdetail WHERE id = ? LIMIT 1',
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

async function getProperty(propertyId) {
  const [rows] = await pool.query(
    'SELECT id, apartmentname, unitnumber, address, percentage, client_id, owner_id FROM propertydetail WHERE id = ? LIMIT 1',
    [propertyId]
  );
  return rows[0] || null;
}

async function getClient(clientId) {
  const [rows] = await pool.query(
    'SELECT id, title, email, currency, profile FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  return rows[0] || null;
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

/** Company seal/chop URL from client_profile for agreement template {{clientchop}}. */
async function getClientChop(clientId) {
  if (!clientId) return '';
  const [rows] = await pool.query(
    'SELECT company_chop FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  return (rows[0] && rows[0].company_chop) ? String(rows[0].company_chop).trim() : '';
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

  const percentage = Number(property.percentage || 0);
  const client = await getClient(property.client_id);
  if (!client) {
    return { ok: false, reason: 'client_not_found' };
  }

  const clientProfile = clientProfileFirst(client);
  const clientchop = await getClientChop(client.id);
  let meter = {};
  if (room.meter_id) {
    const m = await getMeter(room.meter_id);
    if (m) meter = m;
  }

  const variables = {
    date: formatDateMY(nowMY()),
    begin: formatDateUTC(tenancy.begin),
    end: formatDateUTC(tenancy.end),
    paymentdate: calcPaymentDate(tenancy.begin),
    client: client.title || '',
    clientname: client.title || '',
    clientssm: clientProfile.ssm || '',
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
    tenantname: tenant.fullname || '',
    tenantnric: tenant.nric || '',
    tenantaddress: tenant.address || '',
    tenantphone: tenant.phone || '',
    tenantemail: tenant.email || '',
    sign: tenancy.sign || '',
    rentalapartmentname: property.apartmentname || '',
    rentalunitnumber: property.unitnumber || '',
    rentalroomname: room.roomname || '',
    rentaladdress: `${room.roomname || ''} ${property.address || ''}`.trim(),
    period: calcPeriod(tenancy.begin, tenancy.end),
    rental: formatMoney(tenancy.rental, client.currency),
    meterid: meter.meterid || '',
    percentage,
    percentage_display: `${Number(percentage).toFixed(2)}%`
  };

  return {
    ok: true,
    agreementtype: 'tenant_operator',
    templateid: template.templateurl,
    folderid: template.folderurl,
    filename: `Tenancy Agreement - ${tenant.fullname || 'Tenant'}`,
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

  const percentage = Number(property.percentage || 0);
  const client = await getClient(clientId);
  if (!client) {
    return { ok: false, reason: 'client_not_found' };
  }

  const clientProfile = clientProfileFirst(client);
  const ownerProfile = parseJson(owner.profile) || {};
  const clientchop = await getClientChop(clientId);

  const variables = {
    date: formatDateMY(nowMY()),
    client: client.title || '',
    clientname: client.title || '',
    clientssm: clientProfile.ssm || '',
    clientaddress: clientProfile.address || '',
    clientphone: clientProfile.contact || '',
    clientemail: client.email || '',
    clientchop,
    ownername: owner.ownername || '',
    ownernric: owner.nric || '',
    owneremail: owner.email || '',
    ownercontact: owner.mobilenumber || '',
    owneraddress: formatOwnerAddress(ownerProfile),
    sign: owner.signature || '',
    nricfront: owner.nricfront || '',
    nricback: owner.nricback || '',
    rentalapartmentname: property.apartmentname || '',
    rentalunitnumber: property.unitnumber || '',
    rentalroomname: '',
    rentaladdress: property.address || '',
    percentage,
    percentage_display: `${Number(percentage).toFixed(2)}%`
  };

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

  const clientProfile = clientProfileFirst(client);
  const ownerProfile = parseJson(owner.profile) || {};
  const percentage = Number(property.percentage || 0);
  const clientchop = await getClientChop(client.id);

  const variables = {
    date: formatDateMY(nowMY()),
    begin: formatDateUTC(tenancy.begin),
    end: formatDateUTC(tenancy.end),
    period: calcPeriod(tenancy.begin, tenancy.end),
    ownername: owner.ownername || '',
    ownernric: owner.nric || '',
    owneremail: owner.email || '',
    ownercontact: owner.mobilenumber || '',
    owneraddress: formatOwnerAddress(ownerProfile),
    ownersign: owner.signature || '',
    nricfront: owner.nricfront || '',
    nricback: owner.nricback || '',
    tenantname: tenant.fullname || '',
    tenantnric: tenant.nric || '',
    tenantemail: tenant.email || '',
    tenantphone: tenant.phone || '',
    tenantaddress: tenant.address || '',
    rentalapartmentname: property.apartmentname || '',
    rentalunitnumber: property.unitnumber || '',
    rentalroomname: room.roomname || '',
    rentaladdress: `${room.roomname || ''} ${property.address || ''}`.trim(),
    rental: formatMoney(tenancy.rental, client.currency),
    currency: client.currency || '',
    percentage,
    percentage_display: `${Number(percentage).toFixed(2)}%`,
    clientname: client.title || '',
    clientssm: clientProfile.ssm || '',
    clientaddress: clientProfile.address || '',
    clientphone: clientProfile.contact || '',
    clientemail: client.email || '',
    clientchop
  };

  return {
    ok: true,
    agreementtype: 'owner_tenant',
    templateid: template.templateurl,
    folderid: template.folderurl,
    filename: `Owner-Tenant Agreement - ${tenant.fullname || 'Tenant'}`,
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
  if (!context?.ok) return { ok: false, reason: context.reason || 'data_incomplete' };
  return { ok: true };
}

/**
 * When agreement data is complete: generate draft PDF, store url + hash_draft, set status = ready_for_signature.
 * Only then should the agreement appear in repeater and allow signing.
 * Supports: owner_operator (1) owner & operator, (2) tenant_operator tenant & operator, (3) owner_tenant owner & tenant.
 * Requires Node PDF (getAuth()); GAS path does not set hash_draft.
 */
async function prepareAgreementForSignature(agreementId) {
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

  const staffVars = {};
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
  const auth = getAuth();
  if (!auth) {
    return { ok: false, reason: 'GOOGLE_CREDENTIALS_REQUIRED' };
  }

  try {
    const result = await generatePdfFromTemplate({
      templateId,
      folderId,
      filename: context.filename || 'Agreement',
      variables
    });
    const pdfUrl = result.pdfUrl;
    const hashDraft = result.hash || null;

    await pool.query(
      `UPDATE agreement SET url = ?, pdfurl = ?, hash_draft = ?, version = 1, status = ?, pdf_generating = 0, updated_at = NOW() WHERE id = ?`,
      [pdfUrl, pdfUrl, hashDraft, READY_FOR_SIGNATURE, agreementId]
    );
    return {
      ok: true,
      agreementId,
      pdfUrl,
      hash_draft: hashDraft,
      alreadyReady: false
    };
  } catch (e) {
    console.error('[agreement] prepareAgreementForSignature failed', e?.message || e);
    return {
      ok: false,
      reason: 'PDF_GENERATION_FAILED',
      message: e?.message,
      agreementId
    };
  }
}

/**
 * Request PDF generation: create agreement row, send payload to GAS.
 * Body for GAS: { templateId, folderId, filename, variables, callbackId }.
 * callbackId = agreement.id so GAS can call back with id + pdfUrl.
 *
 * @param {{ agreementType: string, agreementTemplateId: string, staffVars?: object, variablesOverride?: object, tenancyId?: string, ownerId?: string, propertyId?: string, clientId?: string }}
 * @returns {Promise<{ ok: boolean, task?: string, agreementId?: string, reason?: string }>}
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
  await pool.query(
    `INSERT INTO agreement (id, client_id, mode, property_id, tenancy_id, status, pdf_generating)
     VALUES (?, ?, ?, ?, ?, 'pending', 1)`,
    [agreementId, clientIdForRow, mode, propertyIdForRow, tenancyIdForRow]
  );

  const useNode = getAuth() != null;
  if (useNode) {
    try {
      const { pdfUrl } = await generatePdfFromTemplate({
        templateId,
        folderId,
        filename: context.filename || 'Agreement',
        variables
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

  if (!GAS_ENDPOINT) {
    return { ok: false, reason: 'GAS_OR_GOOGLE_CREDENTIALS_REQUIRED', agreementId };
  }

  const payload = {
    templateId,
    folderId,
    filename: context.filename || 'Agreement',
    variables,
    callbackId: agreementId
  };

  let result;
  try {
    const { data } = await axios.post(GAS_ENDPOINT, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: GAS_FETCH_TIMEOUT_MS,
      validateStatus: () => true
    });
    result = data;
  } catch (e) {
    if (e.code === 'ECONNABORTED' || e.message?.includes('timeout')) {
      return { ok: false, reason: 'GAS_TIMEOUT', agreementId };
    }
    return { ok: false, reason: 'GAS_REQUEST_FAILED', agreementId };
  }

  if (!result || typeof result !== 'object') {
    return { ok: false, reason: 'GAS_RESPONSE_NOT_JSON', agreementId };
  }

  if (result.status !== 'received') {
    return { ok: false, reason: 'GAS_REJECTED', message: result.message, agreementId };
  }

  return {
    ok: true,
    task: result.task || null,
    agreementId
  };
}

/**
 * Finalize agreement after GAS callback: update agreement row, then propertydetail or tenancy.
 * Called by POST /api/agreement/callback with body { id, pdfUrl }.
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
 * When all parties have signed: generate final PDF (with signatures), set hash_final, status=completed, columns_locked=1.
 * Only call when columns_locked=0 and status in (ready_for_signature, locked).
 */
async function generateFinalPdfAndComplete(agreementId) {
  const [rows] = await pool.query(
    `SELECT id, mode, owner_id, property_id, tenancy_id, client_id, agreementtemplate_id, status, url, pdfurl,
            ownersign, tenantsign, operatorsign, columns_locked
     FROM agreement WHERE id = ? LIMIT 1`,
    [agreementId]
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'agreement_not_found' };
  if (row.columns_locked) return { ok: true, alreadyCompleted: true };
  if (row.status === COMPLETED) return { ok: true, alreadyCompleted: true };
  if (![READY_FOR_SIGNATURE, LOCKED].includes(row.status)) return { ok: false, reason: 'invalid_status' };
  if (!isAgreementFullySigned(row)) return { ok: false, reason: 'not_fully_signed' };

  const staffVars = {};
  let context;
  if (row.mode === 'tenant_operator') {
    context = await getTenantAgreementContext(row.tenancy_id, row.agreementtemplate_id, staffVars);
  } else if (row.mode === 'owner_operator') {
    context = await getOwnerAgreementContext(row.owner_id, row.property_id, row.client_id, row.agreementtemplate_id, staffVars);
  } else if (row.mode === 'owner_tenant') {
    context = await getOwnerTenantAgreementContext(row.tenancy_id, row.agreementtemplate_id, staffVars);
  } else {
    return { ok: false, reason: 'invalid_mode' };
  }
  if (!context?.ok || !context.variables) return { ok: false, reason: context?.reason || 'context_failed' };

  const variables = {
    ...context.variables,
    ownersign: row.ownersign || '',
    tenantsign: row.tenantsign || '',
    operatorsign: row.operatorsign || ''
  };

  const templateId = extractIdFromUrlOrId(context.templateid);
  const folderId = extractIdFromUrlOrId(context.folderid);
  if (!templateId || !folderId) return { ok: false, reason: 'template_or_folder_missing' };

  const auth = getAuth();
  if (!auth) return { ok: false, reason: 'GOOGLE_CREDENTIALS_REQUIRED' };

  try {
    const result = await generatePdfFromTemplate({
      templateId,
      folderId,
      filename: (context.filename || 'Agreement') + '_final',
      variables
    });
    const pdfUrl = result.pdfUrl;
    const hashFinal = result.hash || null;
    const now = new Date();

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

    return { ok: true, pdfUrl, hash_final: hashFinal };
  } catch (e) {
    console.error('[agreement] generateFinalPdfAndComplete failed', e?.message || e);
    return { ok: false, reason: 'PDF_GENERATION_FAILED', message: e?.message };
  }
}

/**
 * Hook after any sign update: if status was ready_for_signature set to locked; if fully signed generate final PDF.
 * Call from admindashboard/tenantdashboard/ownerportal after updating operatorsign/tenantsign/ownersign.
 */
async function afterSignUpdate(agreementId) {
  const [rows] = await pool.query(
    `SELECT id, mode, status, ownersign, tenantsign, operatorsign, columns_locked FROM agreement WHERE id = ? LIMIT 1`,
    [agreementId]
  );
  const row = rows[0];
  if (!row) return;
  if (row.columns_locked) return;

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
  if (row2 && isAgreementFullySigned(row2)) {
    await generateFinalPdfAndComplete(agreementId);
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
  if (!dataComplete.ok) return { ok: false, reason: dataComplete.reason };
  return prepareAgreementForSignature(agreementId);
}

module.exports = {
  getTenantAgreementContext,
  getOwnerAgreementContext,
  getOwnerTenantAgreementContext,
  getOwnerTenantAgreementHtml,
  requestPdfGeneration,
  finalizeAgreementPdf,
  isAgreementDataComplete,
  prepareAgreementForSignature,
  tryPrepareDraftForAgreement,
  isAgreementFullySigned,
  generateFinalPdfAndComplete,
  afterSignUpdate,
  READY_FOR_SIGNATURE,
  LOCKED,
  COMPLETED
};
