/**
 * SQL Account API: Customer + Supplier (Postman).
 * Create/Update bodies must match SQL dataset shape (companyname + sdsbranch[], etc.);
 * partial JSON triggers validation like "Please enter company name".
 */

const sqlaccountrequest = require('./sqlaccountrequest');
const { customer: PATH_CUSTOMER, supplier: PATH_SUPPLIER } = require('../lib/postmanPaths');
const partyCreateTemplate = require('../lib/sqlCustomerCreateTemplate.json');

const SQL_CONTACT_OMIT_KEYS = new Set(['role', 'entity_type', '_sqlRole', 'preserveLegalName']);

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function extractRows(body) {
  if (body == null) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

/** Normalize for app code that expects id / name / email (Bukku/Xero-ish). */
function normalizePartyRow(row, sqlRole) {
  if (!row || typeof row !== 'object') return row;
  const code = row.code ?? row.Code ?? '';
  const name =
    row.description ??
    row.Description ??
    row.companyname ??
    row.CompanyName ??
    row.name ??
    row.Name ??
    '';
  const email = String(row.email ?? row.Email ?? '').trim().toLowerCase();
  return {
    ...row,
    id: String(code || row.dockey || row.Dockey || ''),
    Code: code,
    name: String(name),
    Name: String(name),
    email,
    _sqlRole: sqlRole
  };
}

function stripInternalKeys(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (SQL_CONTACT_OMIT_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function sqlCompanyFromPayload(p) {
  const name = String(p.name || p.legal_name || p.displayName || '').trim();
  const email = p.email != null ? String(p.email).trim() : '';
  const emailLocal = email.includes('@') ? email.split('@')[0].trim() : '';
  let company = String(p.companyname || p.CompanyName || p.companyName || '').trim();
  if (!company) company = name;
  if (!company) company = emailLocal || email;
  if (!company) company = 'Contact';
  const display = name || company;
  return { company, email, display };
}

function applyPartyFieldsToBody(body, payload) {
  const p = stripInternalKeys(payload);
  const { company, email, display } = sqlCompanyFromPayload(p);
  body.companyname = company;
  if (display && display !== company) body.companyname2 = String(display).slice(0, 200);
  else if (p.companyname2 != null && String(p.companyname2).trim()) body.companyname2 = String(p.companyname2).trim();
  if (!String(body.remark || '').trim()) body.remark = display.slice(0, 500);
  if (email && Array.isArray(body.sdsbranch) && body.sdsbranch[0]) {
    body.sdsbranch[0].email = email;
  }
  return body;
}

function buildCreatePartyBody(payload) {
  const body = deepClone(partyCreateTemplate);
  const today = new Date().toISOString().slice(0, 10);
  if (!body.creationdate) body.creationdate = today;
  if (!body.taxexpdate) body.taxexpdate = today;
  applyPartyFieldsToBody(body, payload);
  return body;
}

function unwrapPartyRead(res) {
  if (!res || !res.ok || res.data == null) return null;
  const d = res.data;
  if (Array.isArray(d.data) && d.data[0]) return d.data[0];
  if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) return d.data;
  if (typeof d === 'object' && !Array.isArray(d) && d.companyname !== undefined) return d;
  return null;
}

async function listCustomers(req, params = {}) {
  return sqlaccountrequest({ req, method: 'get', path: PATH_CUSTOMER, params });
}

async function listSuppliers(req, params = {}) {
  return sqlaccountrequest({ req, method: 'get', path: PATH_SUPPLIER, params });
}

async function readCustomer(req, code) {
  const c = encodeURIComponent(String(code ?? '').trim());
  if (!c) return { ok: false, error: 'code is required' };
  return sqlaccountrequest({ req, method: 'get', path: `${PATH_CUSTOMER}/${c}` });
}

async function readSupplier(req, code) {
  const c = encodeURIComponent(String(code ?? '').trim());
  if (!c) return { ok: false, error: 'code is required' };
  return sqlaccountrequest({ req, method: 'get', path: `${PATH_SUPPLIER}/${c}` });
}

async function createCustomer(req, payload) {
  const body = buildCreatePartyBody(payload);
  return sqlaccountrequest({ req, method: 'post', path: PATH_CUSTOMER, data: body });
}

async function createSupplier(req, payload) {
  const body = buildCreatePartyBody(payload);
  return sqlaccountrequest({ req, method: 'post', path: PATH_SUPPLIER, data: body });
}

async function updateCustomer(req, code, payload) {
  const c = encodeURIComponent(String(code ?? '').trim());
  if (!c) return { ok: false, error: 'code is required' };
  const path = `${PATH_CUSTOMER}/${c}`;
  const readRes = await sqlaccountrequest({ req, method: 'get', path });
  const existing = unwrapPartyRead(readRes);
  if (!existing) {
    return sqlaccountrequest({ req, method: 'put', path, data: buildCreatePartyBody(payload) });
  }
  applyPartyFieldsToBody(existing, payload);
  if (!String(existing.companyname || '').trim()) {
    applyPartyFieldsToBody(existing, { name: 'Contact' });
  }
  return sqlaccountrequest({ req, method: 'put', path, data: existing });
}

async function updateSupplier(req, code, payload) {
  const c = encodeURIComponent(String(code ?? '').trim());
  if (!c) return { ok: false, error: 'code is required' };
  const path = `${PATH_SUPPLIER}/${c}`;
  const readRes = await sqlaccountrequest({ req, method: 'get', path });
  const existing = unwrapPartyRead(readRes);
  if (!existing) {
    return sqlaccountrequest({ req, method: 'put', path, data: buildCreatePartyBody(payload) });
  }
  applyPartyFieldsToBody(existing, payload);
  if (!String(existing.companyname || '').trim()) {
    applyPartyFieldsToBody(existing, { name: 'Contact' });
  }
  return sqlaccountrequest({ req, method: 'put', path, data: existing });
}

async function removeCustomer(req, code) {
  const c = encodeURIComponent(String(code ?? '').trim());
  if (!c) return { ok: false, error: 'code is required' };
  return sqlaccountrequest({ req, method: 'delete', path: `${PATH_CUSTOMER}/${c}` });
}

async function removeSupplier(req, code) {
  const c = encodeURIComponent(String(code ?? '').trim());
  if (!c) return { ok: false, error: 'code is required' };
  return sqlaccountrequest({ req, method: 'delete', path: `${PATH_SUPPLIER}/${c}` });
}

async function list(req, params = {}) {
  const [c, s] = await Promise.all([listCustomers(req, params), listSuppliers(req, params)]);
  if (!c.ok) return c;
  if (!s.ok) return s;
  const customers = extractRows(c.data).map((r) => normalizePartyRow(r, 'customer'));
  const suppliers = extractRows(s.data).map((r) => normalizePartyRow(r, 'supplier'));
  return { ok: true, data: [...customers, ...suppliers], status: 200 };
}

async function read(req, contactCode) {
  const code = String(contactCode ?? '').trim();
  if (!code) return { ok: false, error: 'contactCode is required' };
  let r = await readCustomer(req, code);
  if (r.ok) return r;
  r = await readSupplier(req, code);
  return r;
}

async function create(req, payload) {
  const isSupplier =
    payload &&
    (payload.role === 'supplier' ||
      payload.entity_type === 'supplier' ||
      payload._sqlRole === 'supplier');
  return isSupplier ? createSupplier(req, payload) : createCustomer(req, payload);
}

async function update(req, contactCode, payload) {
  const code = String(contactCode ?? '').trim();
  if (!code) return { ok: false, error: 'contactCode is required' };
  const isSupplier =
    payload &&
    (payload.role === 'supplier' ||
      payload.entity_type === 'supplier' ||
      payload._sqlRole === 'supplier');
  return isSupplier ? updateSupplier(req, code, payload) : updateCustomer(req, code, payload);
}

async function remove(req, contactCode) {
  const code = String(contactCode ?? '').trim();
  if (!code) return { ok: false, error: 'contactCode is required' };
  let r = await removeCustomer(req, code);
  if (r.ok) return r;
  return removeSupplier(req, code);
}

async function listContacts(req, params = {}) {
  return list(req, params);
}

async function createContact(req, payload) {
  return create(req, payload);
}

async function updateContact(req, contactId, payload) {
  return update(req, contactId, payload);
}

module.exports = {
  list,
  read,
  create,
  update,
  remove,
  listCustomers,
  listSuppliers,
  readCustomer,
  readSupplier,
  createCustomer,
  createSupplier,
  updateCustomer,
  updateSupplier,
  removeCustomer,
  removeSupplier,
  listContacts,
  createContact,
  updateContact
};
