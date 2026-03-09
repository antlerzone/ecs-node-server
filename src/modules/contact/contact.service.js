/**
 * Contact (Profile page) – migrated from Wix CMS + backend/access/accountaccess.
 * Uses MySQL: owner_client, ownerdetail (account, approvalpending), tenant_client,
 * tenantdetail (account, approval_request_json), supplierdetail (account), client_integration.
 * All operations require email → access context → client_id.
 */

const pool = require('../../config/db');
const { getAccessContextByEmail, ACCOUNTING_PLAN_IDS } = require('../access/access.service');
const bukkurequest = require('../bukku/wrappers/bukkurequest');
const contactSync = require('./contact-sync.service');

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

async function getClientId(email) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok || !ctx.client?.id) return null;
  return ctx.client.id;
}

const ACCOUNT_PROVIDERS = ['sql', 'autocount', 'bukku', 'xero'];

/**
 * Resolve current visitor client's account system. Used to decide which provider key to read/write in ownerdetail/tenantdetail/supplierdetail.account.
 * Returns one of 'sql' | 'autocount' | 'bukku' | 'xero'. Default 'sql' when no addonAccount integration.
 */
async function getAccountProvider(email) {
  const clientId = await getClientId(email);
  if (!clientId) return 'sql';
  const [rows] = await pool.query(
    `SELECT provider FROM client_integration
     WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  const provider = rows[0]?.provider;
  if (provider && ACCOUNT_PROVIDERS.includes(provider)) return provider;
  return 'sql';
}

/**
 * Bank dropdown options from bankdetail (id → supplierdetail.bankdetail_id).
 */
async function getBanks(email) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID', items: [] };
  const [rows] = await pool.query('SELECT id, bankname FROM bankdetail ORDER BY bankname');
  return { ok: true, items: rows.map((r) => ({ id: r.id, bankname: r.bankname })) };
}

/**
 * List all contacts (owners, tenants, suppliers) for current client.
 * 三个来源表：#repeatercontact 显示：
 *   table1 supplierdetail：client_id = 当前 client 的全部显示；
 *   table2 ownerdetail：client_id = 当前 client 或 owner_client 有该 client 的显示；若仅出现在 approvalpending 中且 status=pending 也显示，且文案带 (Pending Approval)；
 *   table3 tenantdetail：同上，client_id / tenant_client；若仅出现在 approval_request_json 中且 status=pending 也显示，且文案带 (Pending Approval)。
 * opts: { type?, search?, sort?, page?, pageSize?, limit? }
 * Returns { ok, items, total, totalPages?, currentPage? }.
 */
async function getContactList(email, opts = {}) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID', items: [], total: 0 };

  const items = [];

  // --- Owners（ownerdetail：client_id 或 owner_client 有值则显示；approvalpending 有本 client 且 pending 也显示，并标 Pending Approval）
  const approvedOwnerIdSet = new Set();
  try {
    const [fromJunction] = await pool.query('SELECT owner_id FROM owner_client WHERE client_id = ?', [clientId]);
    fromJunction.forEach((r) => approvedOwnerIdSet.add(r.owner_id));
  } catch (_) { /* owner_client 表可能不存在 */ }
  const [fromLegacy] = await pool.query('SELECT id FROM ownerdetail WHERE client_id = ?', [clientId]);
  fromLegacy.forEach((r) => approvedOwnerIdSet.add(r.id));

  const [allOwners] = await pool.query(
    'SELECT id, ownername, email, account, approvalpending FROM ownerdetail'
  );
  const pendingOwnerIds = new Set();
  for (const o of allOwners) {
    const arr = parseJson(o.approvalpending);
    if (Array.isArray(arr) && arr.some((r) => r.clientId === clientId && r.status === 'pending')) {
      pendingOwnerIds.add(o.id);
    }
  }
  const ownerIdsToLoad = new Set([...approvedOwnerIdSet, ...pendingOwnerIds]);
  if (ownerIdsToLoad.size > 0) {
    const placeholders = '?,'.repeat(ownerIdsToLoad.size).slice(0, -1);
    const [ownerRows] = await pool.query(
      `SELECT id, ownername, email, account, approvalpending FROM ownerdetail WHERE id IN (${placeholders})`,
      [...ownerIdsToLoad]
    );
    for (const o of ownerRows) {
      const isPending = pendingOwnerIds.has(o.id) && !approvedOwnerIdSet.has(o.id);
      const fullText = (o.ownername || o.email || '(No Name)') + (isPending ? ' (Pending Approval)' : '');
      items.push({
        _id: `owner-${o.id}`,
        type: 'owner',
        text: truncate(fullText, 50),
        value: truncate(fullText, 50),
        searchText: fullText,
        role: 'Owner',
        roleColor: isPending ? '#D32F2F' : '#2F80ED',
        raw: { _id: o.id, ownerName: o.ownername, email: o.email, account: parseJson(o.account), approvalRequest: parseJson(o.approvalpending) },
        __pending: isPending
      });
    }
  }

  // --- Tenants（tenantdetail：client_id 或 tenant_client 有值则显示；approval_request_json 有本 client 且 pending 也显示，并标 Pending Approval）
  const approvedTenantIdSet = new Set();
  try {
    const [fromTenantJunction] = await pool.query('SELECT tenant_id FROM tenant_client WHERE client_id = ?', [clientId]);
    fromTenantJunction.forEach((r) => approvedTenantIdSet.add(r.tenant_id));
  } catch (_) { /* tenant_client 表可能不存在 */ }
  const [fromTenantLegacy] = await pool.query('SELECT id FROM tenantdetail WHERE client_id = ?', [clientId]);
  fromTenantLegacy.forEach((r) => approvedTenantIdSet.add(r.id));

  const [tenantRows] = await pool.query(
    'SELECT id, fullname, email, account, approval_request_json FROM tenantdetail'
  );
  const tenantPending = new Set();
  for (const t of tenantRows) {
    const arr = parseJson(t.approval_request_json);
    if (Array.isArray(arr) && arr.some((r) => r.clientId === clientId && r.status === 'pending')) {
      tenantPending.add(t.id);
    }
  }
  const tenantIdsToLoad = new Set([...approvedTenantIdSet, ...tenantPending]);
  for (const t of tenantRows) {
    if (!tenantIdsToLoad.has(t.id)) continue;
    const isPending = tenantPending.has(t.id) && !approvedTenantIdSet.has(t.id);
    let fullText = t.fullname || t.email || '(No Name)';
    if (isPending) fullText += ' (Pending Approval)';
    items.push({
      _id: `tenant-${t.id}`,
      type: 'tenant',
      text: truncate(fullText, 50),
      value: truncate(fullText, 50),
      searchText: fullText,
      role: 'Tenant',
      roleColor: isPending ? '#D32F2F' : '#27AE60',
      raw: { _id: t.id, fullname: t.fullname, email: t.email, account: parseJson(t.account), approvalRequest: parseJson(t.approval_request_json) },
      __pending: isPending
    });
  }

  // --- Suppliers（supplierdetail：client_id = 当前 client 的全部显示）
  const [supplierRows] = await pool.query(
    'SELECT id, title, email, billercode, bankaccount, bankholder, bankdetail_id, account FROM supplierdetail WHERE client_id = ?',
    [clientId]
  );
  for (const s of supplierRows) {
    let account = parseJson(s.account);
    if (!Array.isArray(account)) account = [];
    const fullText = s.title || '(No title)';
    items.push({
      _id: `supplier-${s.id}`,
      type: 'supplier',
      text: truncate(fullText, 50),
      value: truncate(fullText, 50),
      searchText: fullText,
      role: 'Supplier',
      roleColor: '#F2994A',
      raw: {
        _id: s.id,
        title: s.title,
        email: s.email,
        billerCode: s.billercode,
        bankName: s.bankdetail_id,
        bankAccount: s.bankaccount,
        bankHolder: s.bankholder,
        client: [clientId],
        account
      }
    });
  }

  // --- Filter by type
  let list = items;
  const typeVal = opts.type && ['owner', 'tenant', 'supplier'].includes(opts.type) ? opts.type : null;
  if (typeVal) list = list.filter((i) => i.type === typeVal);

  // --- Filter by search
  const search = (opts.search || '').trim().toLowerCase();
  if (search) {
    list = list.filter((i) => (i.searchText || i.text || '').toLowerCase().includes(search));
  }

  // --- Sort
  const sortKey = opts.sort === 'Z>a' ? 'Z>a' : 'A>z';
  list = [...list].sort((a, b) => {
    const ta = (a.text || '').localeCompare(b.text || '', undefined, { sensitivity: 'base' });
    return sortKey === 'Z>a' ? -ta : ta;
  });

  const total = list.length;

  // --- Limit (cache mode: first N items + total)
  const limit = opts.limit != null ? Math.min(2000, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  if (limit != null && limit > 0) {
    return {
      ok: true,
      items: list.slice(0, limit),
      total,
      totalPages: 1,
      currentPage: 1
    };
  }

  // --- Page + pageSize (server filter mode)
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(opts.pageSize, 10) || 10));
  const start = (page - 1) * pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    ok: true,
    items: list.slice(start, start + pageSize),
    total,
    totalPages,
    currentPage: page
  };
}

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 5) + '.....';
}

async function getOwner(email, ownerId) {
  const clientId = await getClientId(email);
  if (!clientId) return null;
  const [rows] = await pool.query(
    'SELECT id, ownername, email, account, approvalpending FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  if (!rows.length) return null;
  const o = rows[0];
  return {
    _id: o.id,
    ownerName: o.ownername,
    email: o.email,
    account: parseJson(o.account),
    approvalRequest: parseJson(o.approvalpending)
  };
}

async function getTenant(email, tenantId) {
  const clientId = await getClientId(email);
  if (!clientId) return null;
  const [rows] = await pool.query(
    'SELECT id, fullname, email, account, approval_request_json FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  if (!rows.length) return null;
  const t = rows[0];
  return {
    _id: t.id,
    fullname: t.fullname,
    email: t.email,
    account: parseJson(t.account),
    approvalRequest: parseJson(t.approval_request_json)
  };
}

async function getSupplier(email, supplierId) {
  const clientId = await getClientId(email);
  if (!clientId) return null;
  const [rows] = await pool.query(
    'SELECT id, title, email, billercode, bankaccount, bankholder, bankdetail_id, account, productid FROM supplierdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [supplierId, clientId]
  );
  if (!rows.length) return null;
  const s = rows[0];
  const account = parseJson(s.account) || [];
  return {
    _id: s.id,
    title: s.title,
    email: s.email,
    billerCode: s.billercode,
    bankName: s.bankdetail_id,
    bankAccount: s.bankaccount,
    bankHolder: s.bankholder,
    productid: s.productid != null ? String(s.productid).trim() || null : null,
    client: [clientId],
    account
  };
}

function mergeAccount(arr, next) {
  const list = Array.isArray(arr) ? arr : [];
  const others = list.filter(
    (a) => !(a.provider === next.provider && a.clientId === next.clientId)
  );
  return [...others, next];
}

async function updateOwnerAccount(email, { ownerId, contactId }) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const provider = await getAccountProvider(email);
  const [rows] = await pool.query(
    'SELECT id, account FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  if (!rows.length) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const account = parseJson(rows[0].account) || [];
  const merged = mergeAccount(account, { clientId, provider, id: String(contactId || '').trim() });
  await pool.query('UPDATE ownerdetail SET account = ?, updated_at = NOW() WHERE id = ?', [
    JSON.stringify(merged),
    ownerId
  ]);
  return { ok: true };
}

async function updateTenantAccount(email, { tenantId, contactId }) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const provider = await getAccountProvider(email);
  const [rows] = await pool.query(
    'SELECT id, account FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  if (!rows.length) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const account = parseJson(rows[0].account) || [];
  const merged = mergeAccount(account, { clientId, provider, id: String(contactId || '').trim() });
  await pool.query('UPDATE tenantdetail SET account = ?, updated_at = NOW() WHERE id = ?', [
    JSON.stringify(merged),
    tenantId
  ]);
  return { ok: true };
}

async function deleteOwnerOrCancel(email, { ownerId, isPending }) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const [rows] = await pool.query(
    'SELECT id, approvalpending FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  if (!rows.length) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  let approvalpending = parseJson(rows[0].approvalpending) || [];
  if (isPending) {
    approvalpending = approvalpending.filter(
      (r) => !(r.clientId === clientId && r.status === 'pending')
    );
  } else {
    await pool.query(
      'DELETE FROM owner_client WHERE owner_id = ? AND client_id = ?',
      [ownerId, clientId]
    );
    approvalpending = approvalpending.filter((r) => r.clientId !== clientId);
  }
  await pool.query('UPDATE ownerdetail SET approvalpending = ?, updated_at = NOW() WHERE id = ?', [
    JSON.stringify(approvalpending),
    ownerId
  ]);
  return { ok: true };
}

async function deleteTenantOrCancel(email, { tenantId, isPending }) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const [rows] = await pool.query(
    'SELECT id, approval_request_json FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  if (!rows.length) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  let approvalRequest = parseJson(rows[0].approval_request_json) || [];
  if (isPending) {
    approvalRequest = approvalRequest.filter(
      (r) => !(r.clientId === clientId && r.status === 'pending')
    );
  } else {
    await pool.query(
      'DELETE FROM tenant_client WHERE tenant_id = ? AND client_id = ?',
      [tenantId, clientId]
    );
    approvalRequest = approvalRequest.filter((r) => r.clientId !== clientId);
  }
  await pool.query(
    'UPDATE tenantdetail SET approval_request_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(approvalRequest), tenantId]
  );
  return { ok: true };
}

async function deleteSupplierAccount(email, { supplierId }) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const [result] = await pool.query(
    'DELETE FROM supplierdetail WHERE id = ? AND client_id = ?',
    [supplierId, clientId]
  );
  if (result.affectedRows === 0) return { ok: false, reason: 'SUPPLIER_NOT_FOUND' };
  return { ok: true };
}

/**
 * When creating supplier: if client has account integration + pricing plan, find contact by email/name in account system or create; return contactId.
 * Supports bukku, xero, autocount, sql. Returns { ok: true, contactId } or { ok: false, reason }.
 */
async function ensureSupplierContactInAccounting(email, payload) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };

  const [planRows] = await pool.query(
    'SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const planId = planRows[0]?.plan_id;
  const hasAccounting = planId && ACCOUNTING_PLAN_IDS.includes(planId);
  if (!hasAccounting) return { ok: false, reason: 'NO_ACCOUNTING_CAPABILITY' };

  const [intRows] = await pool.query(
    `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  const provider = intRows[0]?.provider;
  if (!provider || !['bukku', 'xero', 'autocount', 'sql'].includes(provider)) {
    return { ok: false, reason: 'NO_ACCOUNT_INTEGRATION' };
  }

  const record = {
    name: payload.name || '',
    fullname: payload.name || '',
    email: payload.email || '',
    phone: payload.phone || ''
  };

  const syncRes = await contactSync.ensureContactInAccounting(clientId, provider, 'supplier', record, null);
  if (!syncRes.ok) return { ok: false, reason: syncRes.reason || 'SYNC_FAILED' };
  return { ok: true, contactId: syncRes.contactId };
}

/**
 * Create or update Bukku contact for supplier (Jompay/Bank). Returns { ok, provider, contactId }.
 * Prefer ensureSupplierContactInAccounting for all 4 providers (find by email/name then create).
 */
async function upsertContactTransit(email, payload) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const [intRows] = await pool.query(
    `SELECT values_json FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account','addonAccount') AND provider = 'bukku' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  const integ = intRows[0];
  const values = integ ? parseJson(integ.values_json) : null;
  const token = values?.bukku_secretKey || values?.bukku_token;
  const subdomain = values?.bukku_subdomain;
  if (!token || !subdomain) return { ok: false, reason: 'NO_ACCOUNT_INTEGRATION' };

  const body = {
    legal_name: payload.name || '',
    email: payload.email || '',
    phone_no: payload.phone || ''
  };
  if (payload.billerCode) {
    body.reg_no = payload.billerCode;
  }
  const res = await bukkurequest({
    method: 'post',
    endpoint: '/contacts',
    token,
    subdomain,
    data: body
  });
  const contactId = res?.data?.id ?? res?.id;
  if (!res || !contactId) return { ok: false, reason: 'BUKKU_CONTACT_FAILED' };
  return { ok: true, provider: 'bukku', contactId: String(contactId) };
}

async function submitOwnerApproval(email, ownerEmail) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const normalized = String(ownerEmail || '').trim().toLowerCase();
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };

  const [existing] = await pool.query(
    'SELECT id, account, approvalpending FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  const now = new Date();
  const entry = { clientId, status: 'pending', createdAt: now };

  if (existing.length === 0) {
    const id = require('crypto').randomUUID();
    const approvalpending = JSON.stringify([entry]);
    const account = JSON.stringify([]);
    await pool.query(
      'INSERT INTO ownerdetail (id, email, ownername, account, approvalpending, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [id, normalized, '', account, approvalpending]
    );
    return { ok: true };
  }

  const o = existing[0];
  const approvalpending = parseJson(o.approvalpending) || [];
  const alreadyApproved = await (async () => {
    const [oc] = await pool.query(
      'SELECT 1 FROM owner_client WHERE owner_id = ? AND client_id = ? LIMIT 1',
      [o.id, clientId]
    );
    return oc.length > 0;
  })();
  if (alreadyApproved) return { ok: true };
  const alreadyPending = approvalpending.some(
    (r) => r.clientId === clientId && r.status === 'pending'
  );
  if (!alreadyPending) {
    approvalpending.push(entry);
    await pool.query('UPDATE ownerdetail SET approvalpending = ?, updated_at = NOW() WHERE id = ?', [
      JSON.stringify(approvalpending),
      o.id
    ]);
  }
  return { ok: true };
}

async function submitTenantApproval(email, tenantEmail) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const normalized = String(tenantEmail || '').trim().toLowerCase();
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };

  const [existing] = await pool.query(
    'SELECT id, account, approval_request_json FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  const now = new Date();
  const entry = { clientId, status: 'pending', createdAt: now };

  if (existing.length === 0) {
    const id = require('crypto').randomUUID();
    const approvalRequest = JSON.stringify([entry]);
    const account = JSON.stringify([]);
    await pool.query(
      'INSERT INTO tenantdetail (id, email, fullname, account, approval_request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [id, normalized, '', account, approvalRequest]
    );
    return { ok: true };
  }

  const t = existing[0];
  let approvalRequest = parseJson(t.approval_request_json) || [];
  const [tc] = await pool.query(
    'SELECT 1 FROM tenant_client WHERE tenant_id = ? AND client_id = ? LIMIT 1',
    [t.id, clientId]
  );
  if (tc.length > 0) return { ok: true };
  const alreadyPending = approvalRequest.some(
    (r) => r.clientId === clientId && r.status === 'pending'
  );
  if (!alreadyPending) {
    approvalRequest.push(entry);
    await pool.query(
      'UPDATE tenantdetail SET approval_request_json = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(approvalRequest), t.id]
    );
  }
  return { ok: true };
}

/**
 * Create supplier. account[] uses current client's account system (sql/autocount/bukku/xero).
 */
async function createSupplier(email, payload, contactId) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const provider = await getAccountProvider(email);
  const id = require('crypto').randomUUID();
  const account = JSON.stringify([
    { clientId, provider, id: String(contactId || '').trim() }
  ]);
  const productid = payload.productid != null && String(payload.productid).trim() !== '' ? String(payload.productid).trim().slice(0, 100) : null;
  const supplierEmail = (payload.email || '').toString().trim().toLowerCase();
  await pool.query(
    `INSERT INTO supplierdetail (id, title, email, billercode, bankaccount, bankholder, bankdetail_id, client_id, account, productid, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
    [
      id,
      payload.name || '',
      supplierEmail,
      payload.billerCode || null,
      payload.bankAccount || null,
      payload.bankHolder || null,
      payload.bankName || null,
      clientId,
      account,
      productid
    ]
  );
  return { ok: true, id };
}

/**
 * Update supplier. account[] is keyed by current client's account system (sql/autocount/bukku/xero). If contactId (or bukkuId) provided, merge that; else if provider is bukku call upsertContactTransit and merge. bankName = bankdetail_id.
 */
async function updateSupplier(email, supplierId, payload) {
  const clientId = await getClientId(email);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const provider = await getAccountProvider(email);
  const [rows] = await pool.query(
    'SELECT id, account, email FROM supplierdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [supplierId, clientId]
  );
  if (!rows.length) return { ok: false, reason: 'SUPPLIER_NOT_FOUND' };
  const supplier = rows[0];
  const account = parseJson(supplier.account) || [];

  const contactIdRaw = payload.contactId !== undefined ? payload.contactId : payload.bukkuId;
  const hasContactId = contactIdRaw !== undefined && contactIdRaw !== null && String(contactIdRaw).trim() !== '';

  let merged;
  if (hasContactId) {
    merged = mergeAccount(account, { clientId, provider, id: String(contactIdRaw).trim() });
  } else if (provider === 'bukku') {
    const transit = await upsertContactTransit(email, payload);
    if (!transit.ok) return transit;
    merged = mergeAccount(account, { clientId, provider: 'bukku', id: transit.contactId });
  } else {
    merged = account;
  }

  const productid = payload.productid !== undefined ? (payload.productid != null && String(payload.productid).trim() !== '' ? String(payload.productid).trim().slice(0, 100) : null) : undefined;
  const setCols = [
    'title = ?', 'email = ?', 'billercode = ?', 'bankaccount = ?', 'bankholder = ?', 'bankdetail_id = ?', 'account = ?'
  ];
  const supplierEmail = (payload.email !== undefined ? (payload.email || '').toString().trim().toLowerCase() : undefined);
  const setVals = [
    payload.name || '',
    supplierEmail !== undefined ? supplierEmail : (supplier.email || ''),
    payload.billerCode || null,
    payload.bankAccount || null,
    payload.bankHolder || null,
    payload.bankName || null,
    JSON.stringify(merged)
  ];
  if (productid !== undefined) {
    setCols.push('productid = ?');
    setVals.push(productid);
  }
  setVals.push(supplierId, clientId);
  await pool.query(
    `UPDATE supplierdetail SET ${setCols.join(', ')}, updated_at = NOW() WHERE id = ? AND client_id = ?`,
    setVals
  );
  return { ok: true };
}

module.exports = {
  getContactList,
  getOwner,
  getTenant,
  getSupplier,
  getBanks,
  getAccountProvider,
  updateOwnerAccount,
  updateTenantAccount,
  deleteOwnerOrCancel,
  deleteTenantOrCancel,
  deleteSupplierAccount,
  ensureSupplierContactInAccounting,
  upsertContactTransit,
  submitOwnerApproval,
  submitTenantApproval,
  createSupplier,
  updateSupplier
};
