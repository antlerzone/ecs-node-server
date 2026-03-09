/**
 * Contact sync: find by email/full name in accounting system → if found update and return id, else create and return id.
 * Used when owner/tenant agrees (client accepts mapping) or staff is linked.
 * Writes contact id to: ownerdetail.account, tenantdetail.account, staffdetail.account.
 * role: owner = customer (and optionally supplier), tenant = customer, staff = employee.
 */

const pool = require('../../config/db');
const bukkuContactWrapper = require('../bukku/wrappers/contact.wrapper');
const xeroContactWrapper = require('../xero/wrappers/contact.wrapper');
const autocountContactWrapper = require('../autocount/wrappers/contact.wrapper');
const sqlaccountContactWrapper = require('../sqlaccount/wrappers/contact.wrapper');

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

function normalize(str) {
  return String(str || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Build req-like object for provider wrappers (they expect req.client.id and possibly creds on req.client).
 * @param {string} clientId
 * @param {string} provider - bukku|xero|autocount|sql
 * @returns {Promise<{ req: object }>}
 */
async function buildReqForProvider(clientId, provider) {
  const [rows] = await pool.query(
    `SELECT provider, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND provider = ? AND enabled = 1 LIMIT 1`,
    [clientId, provider]
  );
  if (!rows.length) throw new Error('NO_ACCOUNT_INTEGRATION');
  const values = parseJson(rows[0].values_json) || {};
  const req = { client: { id: clientId } };
  if (provider === 'bukku') {
    req.client.bukku_secretKey = values.bukku_secretKey || values.bukku_token;
    req.client.bukku_subdomain = values.bukku_subdomain;
    if (!req.client.bukku_secretKey || !req.client.bukku_subdomain) throw new Error('NO_BUKKU_CREDENTIALS');
  }
  return { req };
}

/**
 * Find or create contact in accounting system. First search by email or full name; if found return id (optionally update); else create and return id.
 * @param {string} clientId
 * @param {string} provider - bukku|xero|autocount|sql
 * @param {string} role - owner|tenant|staff|supplier (owner/tenant → customer, staff → employee, supplier → supplier/customer per provider)
 * @param {{ name?: string, fullname?: string, email?: string, phone?: string }} record
 * @param {string} [existingContactId] - if already in account JSON, try update first
 * @returns {Promise<{ ok: boolean, contactId?: string, reason?: string }>}
 */
async function ensureContactInAccounting(clientId, provider, role, record, existingContactId) {
  const name = (record.name || record.fullname || '').trim();
  const email = (record.email || '').trim().toLowerCase();
  const phone = (record.phone || '').trim();
  const { req } = await buildReqForProvider(clientId, provider);

  const contactType = role === 'staff' ? 'employee' : role === 'supplier' ? 'supplier' : 'customer'; // owner/tenant = customer

  try {
    if (provider === 'bukku') {
      const listRes = await bukkuContactWrapper.list(req, {});
      if (!listRes.ok) return { ok: false, reason: listRes.error || 'BUKKU_LIST_FAILED' };
      const raw = listRes.data;
      const contacts = Array.isArray(raw?.contacts) ? raw.contacts : (Array.isArray(raw) ? raw : []);
      let found = null;
      if (existingContactId) {
        found = contacts.find((c) => String(c.id) === String(existingContactId));
      }
      if (!found && (email || name)) {
        found = contacts.find(
          (c) =>
            (email && normalize((c.email || '').toString()) === email) ||
            (name && normalize((c.name || '').toString()) === normalize(name))
        );
      }
      if (found) {
        await bukkuContactWrapper.update(req, found.id, { name: name || found.name, email: email || found.email, phone: phone || found.phone });
        return { ok: true, contactId: String(found.id) };
      }
      const createRes = await bukkuContactWrapper.create(req, {
        name: name || 'Contact',
        email: email || undefined,
        phone: phone || undefined,
        type: contactType
      });
      const created = createRes?.data ?? createRes;
      if (!created?.id) return { ok: false, reason: 'BUKKU_CREATE_FAILED' };
      return { ok: true, contactId: String(created.id) };
    }

    if (provider === 'xero') {
      const listRes = await xeroContactWrapper.list(req, {});
      if (!listRes.ok) return { ok: false, reason: listRes.error || 'XERO_LIST_FAILED' };
      const contacts = listRes.data?.Contacts || [];
      let found = null;
      if (existingContactId) {
        found = contacts.find((c) => (c.ContactID || c.contactID) === existingContactId);
      }
      if (!found && (email || name)) {
        found = contacts.find(
          (c) =>
            (email && normalize((c.EmailAddress || '').toString()) === email) ||
            (name && normalize((c.Name || '').toString()) === normalize(name))
        );
      }
      if (found) {
        const cid = found.ContactID || found.contactID;
        await xeroContactWrapper.update(req, cid, { Name: name || found.Name, EmailAddress: email || found.EmailAddress });
        return { ok: true, contactId: cid };
      }
      const createRes = await xeroContactWrapper.create(req, {
        Name: name || 'Contact',
        EmailAddress: email || undefined
      });
      const created = createRes.data?.Contacts?.[0];
      if (!created) return { ok: false, reason: 'XERO_CREATE_FAILED' };
      return { ok: true, contactId: created.ContactID || created.contactID };
    }

    if (provider === 'autocount') {
      if (role === 'supplier') {
        const listRes = await autocountContactWrapper.listCreditors(req, {});
        if (!listRes.ok) return { ok: false, reason: listRes.error || 'AUTOCOUNT_LIST_CREDITORS_FAILED' };
        const raw = listRes.data || {};
        const creditors = Array.isArray(raw.creditors) ? raw.creditors : Array.isArray(raw) ? raw : [];
        let found = null;
        if (existingContactId) {
          found = creditors.find((c) => String(c.id || c.Id || c.code) === String(existingContactId));
        }
        if (!found && (email || name)) {
          found = creditors.find(
            (c) =>
              (email && normalize((c.email || c.Email || '').toString()) === email) ||
              (name && normalize((c.name || c.Name || '').toString()) === normalize(name))
          );
        }
        if (found) {
          const cid = found.id ?? found.Id ?? found.code;
          await autocountContactWrapper.updateCreditor(req, cid, { name: name || found.name, email: email || found.email });
          return { ok: true, contactId: String(cid) };
        }
        const createRes = await autocountContactWrapper.createCreditor(req, { name: name || 'Contact', email: email || undefined });
        const created = createRes.data?.creditor ?? createRes.data?.Creditor ?? createRes.data;
        if (!created) return { ok: false, reason: 'AUTOCOUNT_CREATE_CREDITOR_FAILED' };
        return { ok: true, contactId: String(created.id ?? created.Id ?? created.code) };
      }
      const listRes = await autocountContactWrapper.listDebtors(req, {});
      if (!listRes.ok) return { ok: false, reason: listRes.error || 'AUTOCOUNT_LIST_FAILED' };
      const raw = listRes.data || {};
      const debtors = Array.isArray(raw.debtors) ? raw.debtors : Array.isArray(raw) ? raw : [];
      let found = null;
      if (existingContactId) {
        found = debtors.find((d) => String(d.id || d.Id || d.code) === String(existingContactId));
      }
      if (!found && (email || name)) {
        found = debtors.find(
          (d) =>
            (email && normalize((d.email || d.Email || '').toString()) === email) ||
            (name && normalize((d.name || d.Name || '').toString()) === normalize(name))
        );
      }
      if (found) {
        const did = found.id ?? found.Id ?? found.code;
        await autocountContactWrapper.updateDebtor(req, did, { name: name || found.name, email: email || found.email });
        return { ok: true, contactId: String(did) };
      }
      const createRes = await autocountContactWrapper.createDebtor(req, { name: name || 'Contact', email: email || undefined });
      const created = createRes.data?.debtor ?? createRes.data?.Debtor ?? createRes.data;
      if (!created) return { ok: false, reason: 'AUTOCOUNT_CREATE_FAILED' };
      return { ok: true, contactId: String(created.id ?? created.Id ?? created.code) };
    }

    if (provider === 'sql') {
      const listRes = await sqlaccountContactWrapper.listContacts(req, {});
      if (!listRes.ok) return { ok: false, reason: listRes.error || 'SQL_LIST_FAILED' };
      const raw = listRes.data || {};
      const list = Array.isArray(raw) ? raw : Array.isArray(raw.Contacts) ? raw.Contacts : Array.isArray(raw.contacts) ? raw.contacts : [];
      let found = null;
      if (existingContactId) {
        found = list.find((c) => String(c.id || c.Id || c.Code) === String(existingContactId));
      }
      if (!found && (email || name)) {
        found = list.find(
          (c) =>
            (email && normalize((c.email || c.Email || '').toString()) === email) ||
            (name && normalize((c.name || c.Name || '').toString()) === normalize(name))
        );
      }
      if (found) {
        const cid = found.id ?? found.Id ?? found.Code;
        await sqlaccountContactWrapper.updateContact(req, cid, { name: name || found.name, email: email || found.email });
        return { ok: true, contactId: String(cid) };
      }
      const createRes = await sqlaccountContactWrapper.createContact(req, { name: name || 'Contact', email: email || undefined });
      const created = createRes.data?.Contact ?? createRes.data?.contact ?? createRes.data;
      if (!created) return { ok: false, reason: 'SQL_CREATE_FAILED' };
      return { ok: true, contactId: String(created.id ?? created.Id ?? created.Code) };
    }

    return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
  } catch (err) {
    return { ok: false, reason: err.message || 'SYNC_FAILED' };
  }
}

/**
 * Merge one (clientId, provider, id) into account JSON array; replace same client+provider.
 */
function mergeAccountEntry(accountArr, clientId, provider, contactId) {
  const list = Array.isArray(accountArr) ? [...accountArr] : [];
  const filtered = list.filter((a) => !(a.clientId === clientId && a.provider === provider));
  filtered.push({ clientId, provider, id: String(contactId) });
  return filtered;
}

/**
 * Write contact id to ownerdetail.account for (clientId, provider).
 */
async function writeOwnerAccount(ownerId, clientId, provider, contactId) {
  const [rows] = await pool.query('SELECT id, account FROM ownerdetail WHERE id = ? LIMIT 1', [ownerId]);
  if (!rows.length) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const account = parseJson(rows[0].account) || [];
  const merged = mergeAccountEntry(account, clientId, provider, contactId);
  await pool.query('UPDATE ownerdetail SET account = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(merged), ownerId]);
  return { ok: true };
}

/**
 * Write contact id to tenantdetail.account for (clientId, provider).
 */
async function writeTenantAccount(tenantId, clientId, provider, contactId) {
  const [rows] = await pool.query('SELECT id, account FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
  if (!rows.length) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const account = parseJson(rows[0].account) || [];
  const merged = mergeAccountEntry(account, clientId, provider, contactId);
  await pool.query('UPDATE tenantdetail SET account = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(merged), tenantId]);
  return { ok: true };
}

/**
 * Write contact id to staffdetail.account for (clientId, provider).
 */
async function writeStaffAccount(staffId, clientId, provider, contactId) {
  const [rows] = await pool.query('SELECT id, account FROM staffdetail WHERE id = ? LIMIT 1', [staffId]);
  if (!rows.length) return { ok: false, reason: 'STAFF_NOT_FOUND' };
  const account = parseJson(rows[0].account) || [];
  const merged = mergeAccountEntry(account, clientId, provider, contactId);
  await pool.query('UPDATE staffdetail SET account = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(merged), staffId]);
  return { ok: true };
}

/**
 * Sync staff (employee) to accounting contact for a client. Find by email/name → update or create; write to staffdetail.account.
 * Call when linking staff to client or from Company Setting. Requires staffdetail.account column (migration 0057).
 */
async function syncStaffForClient(staffId, clientId) {
  const [staffRows] = await pool.query(
    'SELECT id, name, email, account FROM staffdetail WHERE id = ? LIMIT 1',
    [staffId]
  );
  const s = staffRows[0];
  if (!s) return { ok: false, reason: 'STAFF_NOT_FOUND' };

  const [intRows] = await pool.query(
    `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  const provider = intRows[0]?.provider;
  if (!provider || !['bukku', 'xero', 'autocount', 'sql'].includes(provider)) {
    return { ok: false, reason: 'NO_ACCOUNT_INTEGRATION' };
  }

  const account = parseJson(s.account) || [];
  const existingMapping = account.find((a) => a.clientId === clientId && a.provider === provider);
  const existingId = existingMapping?.id ?? existingMapping?.contactId;

  const record = {
    name: s.name || '',
    fullname: s.name || '',
    email: s.email || '',
    phone: ''
  };

  const syncRes = await ensureContactInAccounting(clientId, provider, 'staff', record, existingId);
  if (!syncRes.ok) return { ok: false, reason: syncRes.reason || 'SYNC_FAILED' };

  const writeRes = await writeStaffAccount(staffId, clientId, provider, syncRes.contactId);
  if (!writeRes.ok) return { ok: false, reason: writeRes.reason || 'WRITE_FAILED' };

  return { ok: true, contactId: syncRes.contactId };
}

/**
 * Sync staff to all enabled accounting providers (xero/bukku/autocount/sql) for this client.
 * Get contact by email/name or create; write contactId to staffdetail.account.
 * Call from Company Setting when admin clicks #buttonupdateusersetting (after updateStaff/createStaff) if client has pricing plan & integration.
 */
async function syncStaffToAllAccountingProviders(staffId, clientId) {
  const [staffRows] = await pool.query(
    'SELECT id, name, email, account FROM staffdetail WHERE id = ? LIMIT 1',
    [staffId]
  );
  const s = staffRows[0];
  if (!s) return { ok: false, reason: 'STAFF_NOT_FOUND' };

  const [intRows] = await pool.query(
    `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1`,
    [clientId]
  );
  const providers = (intRows || []).map((r) => r.provider).filter((p) => ['bukku', 'xero', 'autocount', 'sql'].includes(p));
  if (providers.length === 0) return { ok: true, synced: [] };

  const account = parseJson(s.account) || [];
  const record = {
    name: s.name || '',
    fullname: s.name || '',
    email: s.email || '',
    phone: ''
  };
  const synced = [];
  for (const provider of providers) {
    const existingMapping = account.find((a) => a.clientId === clientId && a.provider === provider);
    const existingId = existingMapping?.id ?? existingMapping?.contactId;
    const syncRes = await ensureContactInAccounting(clientId, provider, 'staff', record, existingId);
    if (!syncRes.ok) continue;
    const writeRes = await writeStaffAccount(staffId, clientId, provider, syncRes.contactId);
    if (writeRes.ok) synced.push({ provider, contactId: syncRes.contactId });
  }
  return { ok: true, synced };
}

module.exports = {
  ensureContactInAccounting,
  mergeAccountEntry,
  writeOwnerAccount,
  writeTenantAccount,
  writeStaffAccount,
  syncStaffForClient,
  syncStaffToAllAccountingProviders,
  buildReqForProvider
};
