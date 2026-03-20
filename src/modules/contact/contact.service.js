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

async function getClientId(email) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok || !ctx.client?.id) return null;
  return ctx.client.id;
}

/** Resolve clientId: use override when provided (e.g. from API user scope), else from email. */
async function resolveClientId(email, overrideClientId) {
  if (overrideClientId) return overrideClientId;
  return await getClientId(email);
}

function isSchemaError(err) {
  const code = err?.code || err?.name || '';
  const msg = (err?.sqlMessage || err?.message || '').toString();
  return code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR' ||
    msg.includes("doesn't exist") || msg.includes('Unknown column');
}

/** Safe empty contact list so /list never 500s; caller should log err. */
function emptyContactListResult() {
  return { ok: true, items: [], total: 0, totalPages: 1, currentPage: 1 };
}

const ACCOUNT_PROVIDERS = ['sql', 'autocount', 'bukku', 'xero'];

/**
 * Resolve current visitor client's account system. Used to decide which provider key to read/write in ownerdetail/tenantdetail/supplierdetail.account.
 * Returns one of 'sql' | 'autocount' | 'bukku' | 'xero'. Default 'sql' when no addonAccount integration.
 */
async function getAccountProvider(email, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
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
async function getBanks(email, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID', items: [] };
  const [rows] = await pool.query('SELECT id, bankname FROM bankdetail ORDER BY bankname');
  return { ok: true, items: rows.map((r) => ({ id: r.id, bankname: r.bankname })) };
}

/**
 * List all contacts (owners, tenants, suppliers) for current client.
 * 三个来源表：#repeatercontact 显示：
 *   table1 supplierdetail：client_id = 当前 client 的全部显示；
 *   table2 ownerdetail：owner_client 有该 client 的显示；若仅出现在 approvalpending 中且 status=pending 也显示，且文案带 (Pending Approval)；
 *   table3 tenantdetail：同上，client_id / tenant_client；若仅出现在 approval_request_json 中且 status=pending 也显示，且文案带 (Pending Approval)。
 * opts: { type?, search?, sort?, page?, pageSize?, limit? }
 * Returns { ok, items, total, totalPages?, currentPage? }.
 */
async function getContactList(email, opts = {}, overrideClientId) {
  let clientId;
  try {
    clientId = await resolveClientId(email, overrideClientId);
  } catch (e) {
    console.error('[contact] getContactList resolveClientId error:', e?.code || e?.name, e?.message, e?.sqlMessage || '');
    return emptyContactListResult();
  }
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID', items: [], total: 0 };

  try {
    return await getContactListInner(clientId, opts);
  } catch (e) {
    console.error('[contact] getContactList error:', e?.code || e?.name, e?.message, e?.sqlMessage || '');
    return emptyContactListResult();
  }
}

async function getContactListInner(clientId, opts) {
  const items = [];

  // --- Owners（ownerdetail：owner_client 有值则显示；approvalpending 有本 client 且 pending 也显示，并标 Pending Approval）
  try {
    const approvedOwnerIdSet = new Set();
    try {
      const [fromJunction] = await pool.query('SELECT owner_id FROM owner_client WHERE client_id = ?', [clientId]);
      fromJunction.forEach((r) => approvedOwnerIdSet.add(r.owner_id));
    } catch (_) { /* owner_client 表可能不存在 */ }
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
  } catch (e) {
    if (isSchemaError(e)) {
      console.warn('[contact] list owners skipped (schema):', (e?.sqlMessage || e?.message || '').slice(0, 120));
    } else throw e;
  }

  // --- Tenants（tenantdetail：client_id 或 tenant_client 有值则显示；approval_request_json 有本 client 且 pending 也显示，并标 Pending Approval）
  try {
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
  } catch (e) {
    if (isSchemaError(e)) {
      console.warn('[contact] list tenants skipped (schema):', (e?.sqlMessage || e?.message || '').slice(0, 120));
    } else throw e;
  }

  // --- Suppliers（supplierdetail：client_id = 当前 client 的全部显示）
  try {
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
  } catch (e) {
    if (isSchemaError(e)) {
      console.warn('[contact] list suppliers skipped (schema):', (e?.sqlMessage || e?.message || '').slice(0, 120));
    } else throw e;
  }

  // --- Staff（staffdetail：client_id = 当前 client 的全部显示，用于 Contact Setting 编辑 account id）
  try {
    let staffRows;
    try {
      [staffRows] = await pool.query(
        'SELECT id, name, email, account FROM staffdetail WHERE client_id = ?',
        [clientId]
      );
    } catch (colErr) {
      if (isSchemaError(colErr) && /Unknown column 'account'/.test(colErr?.sqlMessage || colErr?.message || '')) {
        [staffRows] = await pool.query(
          'SELECT id, name, email FROM staffdetail WHERE client_id = ?',
          [clientId]
        );
      } else throw colErr;
    }
    for (const s of staffRows) {
      const account = parseJson(s.account) || [];
      const fullText = s.name || s.email || '(No name)';
      items.push({
        _id: `staff-${s.id}`,
        type: 'staff',
        text: truncate(fullText, 50),
        value: truncate(fullText, 50),
        searchText: fullText,
        role: 'Staff',
        roleColor: '#9B59B6',
        raw: {
          _id: s.id,
          name: s.name,
          fullname: s.name,
          email: s.email,
          account
        },
        __pending: false
      });
    }
  } catch (e) {
    if (isSchemaError(e)) {
      console.warn('[contact] list staff skipped (schema):', (e?.sqlMessage || e?.message || '').slice(0, 120));
    } else throw e;
  }

  // --- Filter by type
  let list = items;
  const typeVal = opts.type && ['owner', 'tenant', 'supplier', 'staff'].includes(opts.type) ? opts.type : null;
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

async function getOwner(email, ownerId, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
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

async function getTenant(email, tenantId, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
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

async function getSupplier(email, supplierId, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
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

async function updateOwnerAccount(email, { ownerId, contactId }, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const provider = await getAccountProvider(email, overrideClientId);
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

async function updateTenantAccount(email, { tenantId, contactId }, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const provider = await getAccountProvider(email, overrideClientId);
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

async function updateStaffAccount(email, { staffId, contactId }, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const provider = await getAccountProvider(email, overrideClientId);
  const [rows] = await pool.query(
    'SELECT id, account FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [staffId, clientId]
  );
  if (!rows.length) return { ok: false, reason: 'STAFF_NOT_FOUND' };
  const account = parseJson(rows[0].account) || [];
  const merged = mergeAccount(account, { clientId, provider, id: String(contactId || '').trim() });
  await pool.query('UPDATE staffdetail SET account = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [
    JSON.stringify(merged),
    staffId,
    clientId
  ]);
  return { ok: true };
}

async function deleteOwnerOrCancel(email, { ownerId, isPending }, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
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

async function deleteTenantOrCancel(email, { tenantId, isPending }, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
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

async function deleteSupplierAccount(email, { supplierId }, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
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
async function ensureSupplierContactInAccounting(email, payload, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
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
 * Ensure owner contact in accounting (by operator when adding/linking owner). Find by email/name or create; write ownerdetail.account.
 * Requires: client has account pricing plan + connect with accounting (bukku/xero/autocount/sql). Owner must be linked to client (owner_client).
 */
async function ensureOwnerContactInAccountingByOperator(email, ownerId, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };

  const [linked] = await pool.query(
    'SELECT 1 FROM owner_client WHERE owner_id = ? AND client_id = ? LIMIT 1',
    [ownerId, clientId]
  );
  if (!linked.length) return { ok: false, reason: 'OWNER_NOT_LINKED_TO_CLIENT' };

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
  if (!provider || !ACCOUNT_PROVIDERS.includes(provider)) {
    return { ok: false, reason: 'NO_ACCOUNT_INTEGRATION' };
  }

  const [ownerRows] = await pool.query(
    'SELECT id, ownername, email, mobilenumber, account FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  if (!ownerRows.length) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const o = ownerRows[0];
  const account = parseJson(o.account) || [];
  const existingMapping = account.find((a) => a.clientId === clientId && a.provider === provider);
  const existingId = existingMapping?.id ?? existingMapping?.contactId ?? null;

  const record = {
    name: (o.ownername || '').trim(),
    fullname: (o.ownername || '').trim(),
    email: (o.email || '').trim().toLowerCase(),
    phone: (o.mobilenumber || '').trim()
  };

  const syncRes = await contactSync.ensureContactInAccounting(clientId, provider, 'owner', record, existingId);
  if (!syncRes.ok) return { ok: false, reason: syncRes.reason || 'SYNC_FAILED' };

  const writeRes = await contactSync.writeOwnerAccount(ownerId, clientId, provider, syncRes.contactId);
  if (!writeRes.ok) return { ok: false, reason: writeRes.reason || 'WRITE_FAILED' };
  return { ok: true, contactId: syncRes.contactId };
}

/**
 * Ensure tenant contact in accounting (by operator when adding/linking tenant). Find by email/name or create; write tenantdetail.account.
 * Requires: client has account pricing plan + connect with accounting (bukku/xero/autocount/sql). Tenant must be linked to client (tenant_client).
 */
async function ensureTenantContactInAccountingByOperator(email, tenantId, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };

  const [linked] = await pool.query(
    'SELECT 1 FROM tenant_client WHERE tenant_id = ? AND client_id = ? LIMIT 1',
    [tenantId, clientId]
  );
  if (!linked.length) return { ok: false, reason: 'TENANT_NOT_LINKED_TO_CLIENT' };

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
  if (!provider || !ACCOUNT_PROVIDERS.includes(provider)) {
    return { ok: false, reason: 'NO_ACCOUNT_INTEGRATION' };
  }

  const [tenantRows] = await pool.query(
    'SELECT id, fullname, email, phone, account FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  if (!tenantRows.length) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const t = tenantRows[0];
  const account = parseJson(t.account) || [];
  const existingMapping = account.find((a) => a.clientId === clientId && a.provider === provider);
  const existingId = existingMapping?.id ?? existingMapping?.contactId ?? null;

  const record = {
    name: (t.fullname || '').trim(),
    fullname: (t.fullname || '').trim(),
    email: (t.email || '').trim().toLowerCase(),
    phone: (t.phone || '').trim()
  };

  const syncRes = await contactSync.ensureContactInAccounting(clientId, provider, 'tenant', record, existingId);
  if (!syncRes.ok) return { ok: false, reason: syncRes.reason || 'SYNC_FAILED' };

  const writeRes = await contactSync.writeTenantAccount(tenantId, clientId, provider, syncRes.contactId);
  if (!writeRes.ok) return { ok: false, reason: writeRes.reason || 'WRITE_FAILED' };
  return { ok: true, contactId: syncRes.contactId };
}

/**
 * Create or update Bukku contact for supplier (Jompay/Bank). Returns { ok, provider, contactId }.
 * Prefer ensureSupplierContactInAccounting for all 4 providers (find by email/name then create).
 */
async function upsertContactTransit(email, payload, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
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

/**
 * Add/link owner to client (direct mapping). No approval flow: always insert owner_client (and optionally owner_property).
 * @param {object} [opts] - { directMap?: boolean (default true), propertyId?: string }
 */
async function submitOwnerApproval(email, ownerEmail, overrideClientId, opts = {}) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const normalized = String(ownerEmail || '').trim().toLowerCase();
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };

  const directMap = opts.directMap !== false;
  const propertyId = opts.propertyId || null;

  const [existing] = await pool.query(
    'SELECT id, account, approvalpending FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  const now = new Date();
  const entry = { clientId, status: 'pending', createdAt: now };

  let ownerId;
  if (existing.length === 0) {
    ownerId = require('crypto').randomUUID();
    const approvalpending = directMap ? '[]' : JSON.stringify([entry]);
    const account = JSON.stringify([]);
    await pool.query(
      'INSERT INTO ownerdetail (id, email, ownername, account, approvalpending, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [ownerId, normalized, '', account, approvalpending]
    );
  } else {
    const o = existing[0];
    ownerId = o.id;
    const alreadyInClient = await (async () => {
      const [oc] = await pool.query(
        'SELECT 1 FROM owner_client WHERE owner_id = ? AND client_id = ? LIMIT 1',
        [ownerId, clientId]
      );
      return oc.length > 0;
    })();
    if (alreadyInClient) return { ok: true };

    if (directMap) {
      await pool.query(
        'INSERT IGNORE INTO owner_client (id, client_id, owner_id, created_at) VALUES (UUID(), ?, ?, NOW())',
        [clientId, ownerId]
      );
      if (propertyId) {
        await pool.query(
          'INSERT IGNORE INTO owner_property (id, owner_id, property_id, created_at) VALUES (UUID(), ?, ?, NOW())',
          [ownerId, propertyId]
        );
        await pool.query(
          'UPDATE propertydetail SET owner_id = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
          [ownerId, propertyId, clientId]
        );
      }
      try {
        await ensureOwnerContactInAccountingByOperator(email, ownerId, overrideClientId);
      } catch (e) {
        console.warn('[contact] ensureOwnerContactInAccountingByOperator after directMap', e?.message || e);
      }
      return { ok: true };
    }

    const approvalpending = parseJson(o.approvalpending) || [];
    const alreadyPending = approvalpending.some(
      (r) => r.clientId === clientId && r.status === 'pending'
    );
    if (!alreadyPending) {
      approvalpending.push(entry);
      await pool.query('UPDATE ownerdetail SET approvalpending = ?, updated_at = NOW() WHERE id = ?', [
        JSON.stringify(approvalpending),
        ownerId
      ]);
    }
  }

  if (directMap && ownerId) {
    await pool.query(
      'INSERT IGNORE INTO owner_client (id, client_id, owner_id, created_at) VALUES (UUID(), ?, ?, NOW())',
      [clientId, ownerId]
    );
    if (propertyId) {
      await pool.query(
        'INSERT IGNORE INTO owner_property (id, owner_id, property_id, created_at) VALUES (UUID(), ?, ?, NOW())',
        [ownerId, propertyId]
      );
      await pool.query(
        'UPDATE propertydetail SET owner_id = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
        [ownerId, propertyId, clientId]
      );
    }
    try {
      await ensureOwnerContactInAccountingByOperator(email, ownerId, overrideClientId);
    } catch (e) {
      console.warn('[contact] ensureOwnerContactInAccountingByOperator after directMap new owner', e?.message || e);
    }
  }

  return { ok: true };
}

/**
 * Add/link tenant to client (direct mapping). No approval flow: always insert tenant_client.
 * @param {object} [opts] - { directMap?: boolean (default true) }
 */
async function submitTenantApproval(email, tenantEmail, overrideClientId, opts = {}) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const normalized = String(tenantEmail || '').trim().toLowerCase();
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };

  const directMap = opts.directMap !== false;

  const [existing] = await pool.query(
    'SELECT id, account, approval_request_json FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  const now = new Date();
  const entry = { clientId, status: 'pending', createdAt: now };

  let tenantId;
  if (existing.length === 0) {
    tenantId = require('crypto').randomUUID();
    const approvalRequest = directMap ? '[]' : JSON.stringify([entry]);
    const account = JSON.stringify([]);
    await pool.query(
      'INSERT INTO tenantdetail (id, email, fullname, account, approval_request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [tenantId, normalized, '', account, approvalRequest]
    );
  } else {
    const t = existing[0];
    tenantId = t.id;
    const [tc] = await pool.query(
      'SELECT 1 FROM tenant_client WHERE tenant_id = ? AND client_id = ? LIMIT 1',
      [tenantId, clientId]
    );
    if (tc.length > 0) return { ok: true };

    if (directMap) {
      await pool.query(
        'INSERT IGNORE INTO tenant_client (tenant_id, client_id) VALUES (?, ?)',
        [tenantId, clientId]
      );
      try {
        await ensureTenantContactInAccountingByOperator(email, tenantId, overrideClientId);
      } catch (e) {
        console.warn('[contact] ensureTenantContactInAccountingByOperator after directMap', e?.message || e);
      }
      return { ok: true };
    }

    const approvalRequest = parseJson(t.approval_request_json) || [];
    const alreadyPending = approvalRequest.some(
      (r) => r.clientId === clientId && r.status === 'pending'
    );
    if (!alreadyPending) {
      approvalRequest.push(entry);
      await pool.query(
        'UPDATE tenantdetail SET approval_request_json = ?, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(approvalRequest), tenantId]
      );
    }
    return { ok: true };
  }

  if (directMap && tenantId) {
    await pool.query(
      'INSERT IGNORE INTO tenant_client (tenant_id, client_id) VALUES (?, ?)',
      [tenantId, clientId]
    );
    try {
      await ensureTenantContactInAccountingByOperator(email, tenantId, overrideClientId);
    } catch (e) {
      console.warn('[contact] ensureTenantContactInAccountingByOperator after directMap new tenant', e?.message || e);
    }
  }
  return { ok: true };
}

/**
 * Create supplier. account[] uses current client's account system (sql/autocount/bukku/xero).
 */
async function createSupplier(email, payload, contactId, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const provider = await getAccountProvider(email, overrideClientId);
  const id = require('crypto').randomUUID();
  const account = JSON.stringify([
    { clientId, provider, id: String(contactId || '').trim() }
  ]);
  const productid = payload.productid != null && String(payload.productid).trim() !== '' ? String(payload.productid).trim().slice(0, 100) : null;
  const supplierEmail = (payload.email || '').toString().trim().toLowerCase();

  // Backward compatibility:
  // Some DBs don't have `supplierdetail.productid` yet (migration not applied).
  try {
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
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (msg.includes("Unknown column 'productid'") || msg.includes('Unknown column "productid"')) {
      await pool.query(
        `INSERT INTO supplierdetail (id, title, email, billercode, bankaccount, bankholder, bankdetail_id, client_id, account, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [
          id,
          payload.name || '',
          supplierEmail,
          payload.billerCode || null,
          payload.bankAccount || null,
          payload.bankHolder || null,
          payload.bankName || null,
          clientId,
          account
        ]
      );
    } else {
      throw e;
    }
  }
  return { ok: true, id };
}

/**
 * Update supplier. account[] is keyed by current client's account system (sql/autocount/bukku/xero). If contactId (or bukkuId) provided, merge that; else if provider is bukku call upsertContactTransit and merge. bankName = bankdetail_id.
 */
async function updateSupplier(email, supplierId, payload, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const provider = await getAccountProvider(email, overrideClientId);
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
  try {
    await pool.query(
      `UPDATE supplierdetail SET ${setCols.join(', ')}, updated_at = NOW() WHERE id = ? AND client_id = ?`,
      setVals
    );
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if ((msg.includes("Unknown column 'productid'") || msg.includes('Unknown column "productid"')) && productid !== undefined) {
      // Retry without touching productid (older DB schema).
      const setColsNoProductid = setCols.filter((c) => c !== 'productid = ?');
      const baseSetVals = [
        payload.name || '',
        supplierEmail !== undefined ? supplierEmail : (supplier.email || ''),
        payload.billerCode || null,
        payload.bankAccount || null,
        payload.bankHolder || null,
        payload.bankName || null,
        JSON.stringify(merged)
      ];
      baseSetVals.push(supplierId, clientId);
      await pool.query(
        `UPDATE supplierdetail SET ${setColsNoProductid.join(', ')}, updated_at = NOW() WHERE id = ? AND client_id = ?`,
        baseSetVals
      );
    } else {
      throw e;
    }
  }
  return { ok: true };
}

/**
 * Create staffdetail row (booking/commission staff, not necessarily portal login user).
 * This bypasses companysetting client_user quota.
 *
 * @returns { ok: true, staffId: string } or { ok:false, reason: string }
 */
async function createStaffContact(email, payload, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };

  const staffEmail = (payload?.staffEmail ?? payload?.email ?? '').toString().trim().toLowerCase();
  const name = (payload?.name ?? '').toString().trim();
  if (!staffEmail) return { ok: false, reason: 'NO_EMAIL' };

  // Avoid duplicates for same client.
  const [existRows] = await pool.query(
    'SELECT id FROM staffdetail WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
    [clientId, staffEmail]
  );
  if (existRows.length) return { ok: false, reason: 'EMAIL_ALREADY_ADDED' };

  const id = require('crypto').randomUUID();

  // Minimal staffdetail fields for booking/commission recipient usage.
  await pool.query(
    `INSERT INTO staffdetail (id, name, email, permission_json, status, client_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, NOW(), NOW())`,
    [
      id,
      name || staffEmail.split('@')[0] || '',
      staffEmail,
      JSON.stringify([]),
      clientId
    ]
  );

  return { ok: true, staffId: id };
}

/**
 * Update staffdetail fields for booking/commission recipients.
 * Only updates name + email (other UI fields are not persisted in staffdetail table by default).
 */
async function updateStaffContact(email, staffId, payload, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };

  if (!staffId) return { ok: false, reason: 'NO_STAFF_ID' };

  const staffEmail = (payload?.staffEmail ?? payload?.email ?? '').toString().trim().toLowerCase();
  const name = (payload?.name ?? '').toString().trim();
  if (!staffEmail) return { ok: false, reason: 'NO_EMAIL' };

  const [[exists]] = await pool.query(
    'SELECT id FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [staffId, clientId]
  );
  if (!exists) return { ok: false, reason: 'STAFF_NOT_FOUND' };

  await pool.query(
    `UPDATE staffdetail SET name = ?, email = ?, updated_at = NOW() WHERE id = ? AND client_id = ?`,
    [name || staffEmail.split('@')[0] || '', staffEmail, staffId, clientId]
  );

  return { ok: true, staffId };
}

function normalizeText(v) {
  return String(v || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function upsertAccountEntry(account, clientId, provider, contactId) {
  return contactSync.mergeAccountEntry(account, clientId, provider, contactId);
}

async function writeSupplierAccount(supplierId, clientId, provider, contactId) {
  const [rows] = await pool.query('SELECT id, account FROM supplierdetail WHERE id = ? AND client_id = ? LIMIT 1', [supplierId, clientId]);
  if (!rows.length) return { ok: false, reason: 'SUPPLIER_NOT_FOUND' };
  const merged = upsertAccountEntry(parseJson(rows[0].account) || [], clientId, provider, contactId);
  await pool.query('UPDATE supplierdetail SET account = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [JSON.stringify(merged), supplierId, clientId]);
  return { ok: true };
}

async function listRemoteContacts(clientId, provider) {
  const { req } = await contactSync.buildReqForProvider(clientId, provider);
  if (provider === 'bukku') {
    const res = await bukkuContactWrapper.list(req, {});
    if (!res.ok) return { ok: false, reason: res.error || 'BUKKU_LIST_FAILED', items: [] };
    const raw = res.data;
    const list = Array.isArray(raw?.contacts) ? raw.contacts : (Array.isArray(raw) ? raw : []);
    return {
      ok: true,
      items: list.map((c) => ({
        id: String(c.id || ''),
        name: String(c.name || ''),
        email: String(c.email || '').trim().toLowerCase(),
        role: String(c.type || 'customer').toLowerCase()
      })).filter((c) => c.id)
    };
  }
  if (provider === 'xero') {
    const res = await xeroContactWrapper.list(req, {});
    if (!res.ok) return { ok: false, reason: res.error || 'XERO_LIST_FAILED', items: [] };
    const list = Array.isArray(res.data?.Contacts) ? res.data.Contacts : [];
    return {
      ok: true,
      items: list.map((c) => ({
        id: String(c.ContactID || c.contactID || ''),
        name: String(c.Name || ''),
        email: String(c.EmailAddress || '').trim().toLowerCase(),
        role: 'customer'
      })).filter((c) => c.id)
    };
  }
  if (provider === 'autocount') {
    const [debtorRes, creditorRes] = await Promise.all([
      autocountContactWrapper.listDebtors(req, {}),
      autocountContactWrapper.listCreditors(req, {})
    ]);
    const items = [];
    if (debtorRes.ok) {
      const raw = debtorRes.data || {};
      const debtors = Array.isArray(raw.debtors) ? raw.debtors : (Array.isArray(raw) ? raw : []);
      for (const d of debtors) {
        const id = d.id ?? d.Id ?? d.code;
        if (!id) continue;
        items.push({
          id: String(id),
          name: String(d.name || d.Name || ''),
          email: String(d.email || d.Email || '').trim().toLowerCase(),
          role: 'customer'
        });
      }
    }
    if (creditorRes.ok) {
      const raw = creditorRes.data || {};
      const creditors = Array.isArray(raw.creditors) ? raw.creditors : (Array.isArray(raw) ? raw : []);
      for (const c of creditors) {
        const id = c.id ?? c.Id ?? c.code;
        if (!id) continue;
        items.push({
          id: String(id),
          name: String(c.name || c.Name || ''),
          email: String(c.email || c.Email || '').trim().toLowerCase(),
          role: 'supplier'
        });
      }
    }
    if (!debtorRes.ok && !creditorRes.ok) return { ok: false, reason: 'AUTOCOUNT_LIST_FAILED', items: [] };
    return { ok: true, items };
  }
  if (provider === 'sql') {
    const res = await sqlaccountContactWrapper.listContacts(req, {});
    if (!res.ok) return { ok: false, reason: res.error || 'SQL_LIST_FAILED', items: [] };
    const raw = res.data || {};
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw.Contacts) ? raw.Contacts : (Array.isArray(raw.contacts) ? raw.contacts : []));
    return {
      ok: true,
      items: list.map((c) => ({
        id: String(c.id || c.Id || c.Code || ''),
        name: String(c.name || c.Name || ''),
        email: String(c.email || c.Email || '').trim().toLowerCase(),
        role: 'customer'
      })).filter((c) => c.id)
    };
  }
  return { ok: false, reason: 'UNSUPPORTED_PROVIDER', items: [] };
}

async function syncContactsToAccounting(clientId, provider) {
  const counters = { scanned: 0, synced: 0, created: 0, failed: 0 };
  const [owners] = await pool.query(
    `SELECT DISTINCT o.id, o.ownername, o.email, o.account
     FROM ownerdetail o
     LEFT JOIN owner_client oc ON oc.owner_id = o.id
     WHERE oc.client_id = ?`,
    [clientId]
  );
  const [tenants] = await pool.query(
    `SELECT t.id, t.fullname, t.email, t.account
     FROM tenantdetail t
     LEFT JOIN tenant_client tc ON tc.tenant_id = t.id
     WHERE tc.client_id = ? OR t.client_id = ?`,
    [clientId, clientId]
  );
  const [suppliers] = await pool.query('SELECT id, title, email, account FROM supplierdetail WHERE client_id = ?', [clientId]);
  const [staffs] = await pool.query('SELECT id, name, email, account FROM staffdetail WHERE client_id = ?', [clientId]);

  const runEnsure = async (kind, row, getExistingId, writeFn) => {
    counters.scanned += 1;
    const existingId = getExistingId();
    const beforeId = existingId ? String(existingId) : '';
    const syncRes = await contactSync.ensureContactInAccounting(clientId, provider, kind, row, existingId);
    if (!syncRes.ok || !syncRes.contactId) {
      counters.failed += 1;
      return;
    }
    if (!beforeId) counters.created += 1;
    const writeRes = await writeFn(syncRes.contactId);
    if (!writeRes.ok) {
      counters.failed += 1;
      return;
    }
    counters.synced += 1;
  };

  for (const o of owners) {
    const account = parseJson(o.account) || [];
    const existing = account.find((a) => a?.clientId === clientId && String(a?.provider || '').toLowerCase() === provider);
    await runEnsure('owner', { name: o.ownername || '', email: o.email || '' }, () => existing?.id || existing?.contactId, (cid) => contactSync.writeOwnerAccount(o.id, clientId, provider, cid));
  }
  for (const t of tenants) {
    const account = parseJson(t.account) || [];
    const existing = account.find((a) => a?.clientId === clientId && String(a?.provider || '').toLowerCase() === provider);
    await runEnsure('tenant', { fullname: t.fullname || '', email: t.email || '' }, () => existing?.id || existing?.contactId, (cid) => contactSync.writeTenantAccount(t.id, clientId, provider, cid));
  }
  for (const s of suppliers) {
    const account = parseJson(s.account) || [];
    const existing = account.find((a) => a?.clientId === clientId && String(a?.provider || '').toLowerCase() === provider);
    await runEnsure('supplier', { name: s.title || '', email: s.email || '' }, () => existing?.id || existing?.contactId, (cid) => writeSupplierAccount(s.id, clientId, provider, cid));
  }
  for (const s of staffs) {
    const account = parseJson(s.account) || [];
    const existing = account.find((a) => a?.clientId === clientId && String(a?.provider || '').toLowerCase() === provider);
    await runEnsure('staff', { name: s.name || '', email: s.email || '' }, () => existing?.id || existing?.contactId, (cid) => contactSync.writeStaffAccount(s.id, clientId, provider, cid));
  }

  return { ok: true, ...counters };
}

async function syncContactsFromAccounting(clientId, provider) {
  const remoteRes = await listRemoteContacts(clientId, provider);
  if (!remoteRes.ok) return { ok: false, reason: remoteRes.reason || 'REMOTE_LIST_FAILED' };
  const remote = remoteRes.items || [];
  const counters = { scanned: remote.length, linked: 0, created: 0, failed: 0 };

  const [owners] = await pool.query(
    `SELECT DISTINCT o.id, o.ownername, o.email, o.account
     FROM ownerdetail o
     LEFT JOIN owner_client oc ON oc.owner_id = o.id
     WHERE oc.client_id = ?`,
    [clientId]
  );
  const [tenants] = await pool.query(
    `SELECT t.id, t.fullname, t.email, t.account
     FROM tenantdetail t
     LEFT JOIN tenant_client tc ON tc.tenant_id = t.id
     WHERE tc.client_id = ? OR t.client_id = ?`,
    [clientId, clientId]
  );
  const [suppliers] = await pool.query('SELECT id, title, email, account FROM supplierdetail WHERE client_id = ?', [clientId]);
  const [staffs] = await pool.query('SELECT id, name, email, account FROM staffdetail WHERE client_id = ?', [clientId]);

  const findByEmailOrName = (arr, emailKey, nameKey, email, name) =>
    arr.find((x) => (email && normalizeText(x[emailKey]) === email) || (name && normalizeText(x[nameKey]) === name));

  for (const rc of remote) {
    const email = normalizeText(rc.email);
    const name = normalizeText(rc.name);
    try {
      if (rc.role === 'supplier') {
        const s = findByEmailOrName(suppliers, 'email', 'title', email, name);
        if (s) {
          const res = await writeSupplierAccount(s.id, clientId, provider, rc.id);
          if (res.ok) counters.linked += 1; else counters.failed += 1;
          continue;
        }
      }

      const owner = findByEmailOrName(owners, 'email', 'ownername', email, name);
      if (owner) {
        const res = await contactSync.writeOwnerAccount(owner.id, clientId, provider, rc.id);
        if (res.ok) counters.linked += 1; else counters.failed += 1;
        continue;
      }
      const tenant = findByEmailOrName(tenants, 'email', 'fullname', email, name);
      if (tenant) {
        const res = await contactSync.writeTenantAccount(tenant.id, clientId, provider, rc.id);
        if (res.ok) counters.linked += 1; else counters.failed += 1;
        continue;
      }
      const staff = findByEmailOrName(staffs, 'email', 'name', email, name);
      if (staff) {
        const res = await contactSync.writeStaffAccount(staff.id, clientId, provider, rc.id);
        if (res.ok) counters.linked += 1; else counters.failed += 1;
        continue;
      }

      const newSupplierId = require('crypto').randomUUID();
      const account = JSON.stringify([{ clientId, provider, id: rc.id }]);
      await pool.query(
        `INSERT INTO supplierdetail (id, title, email, client_id, account, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [newSupplierId, rc.name || rc.email || 'Synced Contact', rc.email || '', clientId, account]
      );
      counters.created += 1;
    } catch (_) {
      counters.failed += 1;
    }
  }

  return { ok: true, ...counters };
}

async function syncAllContacts(email, params = {}, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const provider = await getAccountProvider(email, overrideClientId);
  if (!ACCOUNT_PROVIDERS.includes(provider)) return { ok: false, reason: 'NO_ACCOUNT_PROVIDER' };
  const direction = String(params.direction || 'to-accounting').toLowerCase();
  if (direction === 'to-accounting') {
    const res = await syncContactsToAccounting(clientId, provider);
    return { ...res, direction, provider };
  }
  if (direction === 'from-accounting') {
    const res = await syncContactsFromAccounting(clientId, provider);
    return { ...res, direction, provider };
  }
  return { ok: false, reason: 'INVALID_DIRECTION' };
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
  updateStaffAccount,
  deleteOwnerOrCancel,
  deleteTenantOrCancel,
  deleteSupplierAccount,
  ensureSupplierContactInAccounting,
  ensureOwnerContactInAccountingByOperator,
  ensureTenantContactInAccountingByOperator,
  upsertContactTransit,
  submitOwnerApproval,
  submitTenantApproval,
  createSupplier,
  updateSupplier,
  createStaffContact,
  updateStaffContact,
  syncAllContacts
};
