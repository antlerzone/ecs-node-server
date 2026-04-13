/**
 * Contact (Profile page) – migrated from Wix CMS + backend/access/accountaccess.
 * Uses MySQL: owner_client, ownerdetail (account, approvalpending), tenant_client,
 * tenantdetail (account, approval_request_json), supplierdetail (account), client_integration.
 * All operations require email → access context → client_id.
 */

const { formatIntegrationApiError } = require('../../utils/formatIntegrationApiError');
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
      'SELECT id, ownername, email, account, approvalpending, mobilenumber, bankname_id, bankaccount, accountholder, nric, profile FROM ownerdetail'
    );
    const pendingOwnerIds = new Set();
    for (const o of allOwners) {
      const arr = parseJson(o.approvalpending);
      if (
        Array.isArray(arr) &&
        arr.some((r) => {
          const cid = r.clientId ?? r.clientid;
          return cid === clientId && String(r.status || '').toLowerCase() === 'pending';
        })
      ) {
        pendingOwnerIds.add(o.id);
      }
    }
    const ownerIdsToLoad = new Set([...approvedOwnerIdSet, ...pendingOwnerIds]);
    if (ownerIdsToLoad.size > 0) {
      const placeholders = '?,'.repeat(ownerIdsToLoad.size).slice(0, -1);
      const [ownerRows] = await pool.query(
        `SELECT id, ownername, email, account, approvalpending, mobilenumber, bankname_id, bankaccount, accountholder, nric, profile FROM ownerdetail WHERE id IN (${placeholders})`,
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
          raw: {
            _id: o.id,
            ownerName: o.ownername,
            email: o.email,
            phone: o.mobilenumber != null ? String(o.mobilenumber) : undefined,
            bankName: o.bankname_id != null ? String(o.bankname_id) : undefined,
            bankAccount: o.bankaccount != null ? String(o.bankaccount) : undefined,
            bankHolder: o.accountholder != null ? String(o.accountholder) : undefined,
            nric: o.nric != null && String(o.nric).trim() ? String(o.nric).trim() : undefined,
            idType: (() => {
              const prof = parseJson(o.profile);
              if (!prof || typeof prof !== 'object') return undefined;
              const t = prof.id_type ?? prof.reg_no_type;
              return t != null && String(t).trim() ? String(t).trim() : undefined;
            })(),
            account: parseJson(o.account),
            approvalRequest: parseJson(o.approvalpending)
          },
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

    let tenantRows;
    try {
      [tenantRows] = await pool.query(
        'SELECT id, fullname, email, phone, account, approval_request_json, nric, profile FROM tenantdetail'
      );
    } catch (e) {
      if (isSchemaError(e) && /Unknown column.*profile/i.test(e?.sqlMessage || e?.message || '')) {
        [tenantRows] = await pool.query(
          'SELECT id, fullname, email, phone, account, approval_request_json, nric FROM tenantdetail'
        );
      } else {
        throw e;
      }
    }
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
        raw: {
          _id: t.id,
          fullname: t.fullname,
          email: t.email,
          phone: t.phone != null ? String(t.phone) : undefined,
          nric: t.nric != null && String(t.nric).trim() ? String(t.nric).trim() : undefined,
          idType: (() => {
            const prof = parseJson(t.profile);
            if (!prof || typeof prof !== 'object') return undefined;
            const ty = prof.id_type ?? prof.reg_no_type;
            return ty != null && String(ty).trim() ? String(ty).trim() : undefined;
          })(),
          account: parseJson(t.account),
          approvalRequest: parseJson(t.approval_request_json)
        },
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
  const limit = opts.limit != null ? Math.min(10000, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
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
  const pageSize = Math.min(200, Math.max(1, parseInt(opts.pageSize, 10) || 10));
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
    'SELECT id, ownername, email, account, approvalpending, bankname_id, bankaccount, accountholder FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  if (!rows.length) return null;
  const o = rows[0];
  return {
    _id: o.id,
    ownerName: o.ownername,
    email: o.email,
    bankName: o.bankname_id != null ? String(o.bankname_id) : '',
    bankAccount: o.bankaccount != null ? String(o.bankaccount) : '',
    bankHolder: o.accountholder != null ? String(o.accountholder) : '',
    account: parseJson(o.account),
    approvalRequest: parseJson(o.approvalpending)
  };
}

async function assertOwnerEditableForClient(ownerId, clientId) {
  try {
    const [r] = await pool.query('SELECT 1 FROM owner_client WHERE owner_id = ? AND client_id = ? LIMIT 1', [ownerId, clientId]);
    if (r.length) return true;
  } catch (_) {}
  const [rows] = await pool.query('SELECT approvalpending FROM ownerdetail WHERE id = ? LIMIT 1', [ownerId]);
  if (!rows.length) return false;
  const arr = parseJson(rows[0].approvalpending);
  return Array.isArray(arr) && arr.some((x) => x.clientId === clientId && x.status === 'pending');
}

/** Operator: owner bank (bankdetail id + account + holder). Jompay N/A for owner. */
async function updateOwnerBankFields(email, { ownerId, bankName, bankAccount, bankHolder }, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  if (!ownerId) return { ok: false, reason: 'NO_OWNER_ID' };
  const allowed = await assertOwnerEditableForClient(ownerId, clientId);
  if (!allowed) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const bankId = bankName != null && String(bankName).trim() !== '' ? String(bankName).trim() : null;
  const acct = bankAccount != null ? String(bankAccount).trim() : '';
  const holder = bankHolder != null ? String(bankHolder).trim() : '';
  await pool.query(
    'UPDATE ownerdetail SET bankname_id = ?, bankaccount = ?, accountholder = ?, updated_at = NOW() WHERE id = ?',
    [bankId, acct || null, holder || null, ownerId]
  );
  return { ok: true };
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
  const params = [supplierId, clientId];
  const sql =
    'SELECT id, title, email, billercode, bankaccount, bankholder, bankdetail_id, account FROM supplierdetail WHERE id = ? AND client_id = ? LIMIT 1';
  const [rows] = await pool.query(sql, params);
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
    productid: null,
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

/**
 * Push current DB name/email to accounting when account[] already has remote id for (clientId, provider).
 * @param {{ preserveLegalName?: boolean }} [opts] - If true (operator linking owner/tenant id only), do not overwrite remote legal/display name with profile fields.
 */
async function syncAccountingFromMergedAccount(clientId, kind, entityId, mergedAccount, opts = {}) {
  try {
    const [planRows] = await pool.query(
      `SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = 'plan' ORDER BY id LIMIT 1`,
      [clientId]
    );
    const planId = planRows[0]?.plan_id;
    if (!planId || !ACCOUNTING_PLAN_IDS.includes(planId)) return;

    const [intRows] = await pool.query(
      `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
      [clientId]
    );
    const provider = intRows[0]?.provider;
    if (!provider || !ACCOUNT_PROVIDERS.includes(provider)) return;

    const account = Array.isArray(mergedAccount) ? mergedAccount : [];
    const mapping = account.find((a) => a.clientId === clientId && a.provider === provider);
    const existingId = mapping?.id ?? mapping?.contactId;
    if (existingId == null || String(existingId).trim() === '') return;

    let record;
    let role;
    if (kind === 'owner') {
      role = 'owner';
      const [rows] = await pool.query('SELECT ownername, email, mobilenumber FROM ownerdetail WHERE id = ? LIMIT 1', [entityId]);
      if (!rows.length) return;
      const o = rows[0];
      record = {
        name: (o.ownername || '').trim(),
        fullname: (o.ownername || '').trim(),
        email: (o.email || '').trim().toLowerCase(),
        phone: (o.mobilenumber || '').trim()
      };
    } else if (kind === 'tenant') {
      role = 'tenant';
      const [rows] = await pool.query('SELECT fullname, email, phone FROM tenantdetail WHERE id = ? LIMIT 1', [entityId]);
      if (!rows.length) return;
      const t = rows[0];
      record = {
        name: (t.fullname || '').trim(),
        fullname: (t.fullname || '').trim(),
        email: (t.email || '').trim().toLowerCase(),
        phone: (t.phone || '').trim()
      };
    } else if (kind === 'staff') {
      role = 'staff';
      const [rows] = await pool.query('SELECT name, email FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1', [entityId, clientId]);
      if (!rows.length) return;
      const s = rows[0];
      const portalPhone = await contactSync.resolvePortalPhoneForEmail(s.email);
      record = {
        name: (s.name || '').trim(),
        fullname: (s.name || '').trim(),
        email: (s.email || '').trim().toLowerCase(),
        phone: portalPhone
      };
    } else {
      return;
    }

    const syncRes = await contactSync.ensureContactInAccounting(clientId, provider, role, record, existingId, {
      preserveLegalName: opts.preserveLegalName === true
    });
    if (!syncRes.ok) {
      console.warn('[contact] syncAccountingFromMergedAccount failed', kind, entityId, syncRes.reason);
      return;
    }
    const newId = syncRes.contactId;
    if (newId && String(newId) !== String(existingId)) {
      if (kind === 'owner') await contactSync.writeOwnerAccount(entityId, clientId, provider, newId);
      else if (kind === 'tenant') await contactSync.writeTenantAccount(entityId, clientId, provider, newId);
      else await contactSync.writeStaffAccount(entityId, clientId, provider, newId);
    }
  } catch (e) {
    console.warn('[contact] syncAccountingFromMergedAccount', e?.message || e);
  }
}

async function updatePortalPhoneForEmailIfExists(emailNorm, phone) {
  const e = String(emailNorm || '').trim().toLowerCase();
  if (!e) return;
  const p = phone != null ? String(phone).trim() : '';
  try {
    const [r] = await pool.query('SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [e]);
    if (!r.length) return;
    await pool.query('UPDATE portal_account SET phone = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?', [p, e]);
  } catch (_) {}
}

/** Operator may only set portal phone for emails that already appear as a contact of this client. */
async function isContactEmailForClient(clientId, emailNorm) {
  const e = String(emailNorm || '').trim().toLowerCase();
  if (!e || !clientId) return false;
  const [s] = await pool.query(
    'SELECT 1 FROM staffdetail WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
    [clientId, e]
  );
  if (s.length) return true;
  const [sup] = await pool.query(
    'SELECT 1 FROM supplierdetail WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
    [clientId, e]
  );
  if (sup.length) return true;
  try {
    const [o] = await pool.query(
      `SELECT 1 FROM ownerdetail od
       INNER JOIN owner_client oc ON oc.owner_id = od.id AND oc.client_id = ?
       WHERE LOWER(TRIM(od.email)) = ? LIMIT 1`,
      [clientId, e]
    );
    if (o.length) return true;
  } catch (_) {}
  try {
    const [t] = await pool.query(
      `SELECT 1 FROM tenantdetail td
       INNER JOIN tenant_client tc ON tc.tenant_id = td.id AND tc.client_id = ?
       WHERE LOWER(TRIM(td.email)) = ? LIMIT 1`,
      [clientId, e]
    );
    if (t.length) return true;
  } catch (_) {}
  try {
    const [tl] = await pool.query(
      'SELECT 1 FROM tenantdetail WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
      [clientId, e]
    );
    if (tl.length) return true;
  } catch (_) {}
  const [pendingO] = await pool.query('SELECT approvalpending FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1', [e]);
  if (pendingO.length) {
    const arr = parseJson(pendingO[0].approvalpending);
    if (Array.isArray(arr) && arr.some((r) => r.clientId === clientId && r.status === 'pending')) return true;
  }
  const [pendingT] = await pool.query('SELECT approval_request_json FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1', [e]);
  if (pendingT.length) {
    const arr = parseJson(pendingT[0].approval_request_json);
    if (Array.isArray(arr) && arr.some((r) => r.clientId === clientId && r.status === 'pending')) return true;
  }
  return false;
}

/**
 * Update portal_account.phone when the contact email belongs to this operator client (staff sync / list).
 * @param {string} operatorEmail - portal operator (req body email)
 * @param {{ contactEmail?: string, phone?: string }} payload - contact row email + new phone
 */
async function updatePortalPhoneForClientContact(operatorEmail, { contactEmail, phone }, overrideClientId) {
  const clientId = await resolveClientId(operatorEmail, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const e = String(contactEmail || '').trim().toLowerCase();
  if (!e) return { ok: false, reason: 'NO_EMAIL' };
  const allowed = await isContactEmailForClient(clientId, e);
  if (!allowed) return { ok: false, reason: 'EMAIL_NOT_A_CONTACT' };
  await updatePortalPhoneForEmailIfExists(e, phone);
  return { ok: true };
}

/**
 * Operator Contact: persist NRIC + ID type on tenantdetail / ownerdetail / staffdetail.profile and portal_account
 * so values match tenant/owner Portal profile (same keys as updatePortalProfile: nric, id_type, reg_no_type in profile JSON).
 */
async function syncOperatorContactIdentity(
  operatorEmail,
  { contactEmail, idType, idNumber },
  overrideClientId
) {
  const clientId = await resolveClientId(operatorEmail, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const e = String(contactEmail || '').trim().toLowerCase();
  if (!e) return { ok: false, reason: 'NO_EMAIL' };
  const allowed = await isContactEmailForClient(clientId, e);
  if (!allowed) return { ok: false, reason: 'EMAIL_NOT_A_CONTACT' };

  const idt = String(idType != null && String(idType).trim() ? idType : 'NRIC').trim();
  const nricVal = idNumber != null && String(idNumber).trim() !== '' ? String(idNumber).trim() : null;
  const rnt = idt;

  try {
    const [trows] = await pool.query('SELECT id, profile FROM tenantdetail WHERE LOWER(TRIM(email)) = ?', [e]);
    for (const row of trows || []) {
      const ex = parseJson(row.profile) || {};
      const next = { ...ex, id_type: idt, reg_no_type: rnt };
      await pool.query('UPDATE tenantdetail SET nric = ?, profile = ?, updated_at = NOW() WHERE id = ?', [
        nricVal,
        JSON.stringify(next),
        row.id
      ]);
    }
  } catch (err) {
    if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) {
      console.warn('[contact] syncOperatorContactIdentity tenantdetail', err?.message || err);
    }
  }

  try {
    const [orows] = await pool.query('SELECT id, profile FROM ownerdetail WHERE LOWER(TRIM(email)) = ?', [e]);
    for (const row of orows || []) {
      const ex = parseJson(row.profile) || {};
      const next = { ...ex, id_type: idt, reg_no_type: rnt };
      await pool.query('UPDATE ownerdetail SET nric = ?, profile = ?, updated_at = NOW() WHERE id = ?', [
        nricVal,
        JSON.stringify(next),
        row.id
      ]);
    }
  } catch (err) {
    if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) {
      console.warn('[contact] syncOperatorContactIdentity ownerdetail', err?.message || err);
    }
  }

  try {
    const [srows] = await pool.query('SELECT id, profile FROM staffdetail WHERE LOWER(TRIM(email)) = ?', [e]);
    for (const row of srows || []) {
      const ex = parseJson(row.profile) || {};
      const next = { ...ex, id_type: idt, reg_no_type: rnt };
      await pool.query('UPDATE staffdetail SET profile = ?, updated_at = NOW() WHERE id = ?', [
        JSON.stringify(next),
        row.id
      ]);
    }
  } catch (err) {
    if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) {
      console.warn('[contact] syncOperatorContactIdentity staffdetail', err?.message || err);
    }
  }

  try {
    const [pa] = await pool.query('SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [e]);
    if (pa.length) {
      await pool.query(
        'UPDATE portal_account SET nric = ?, id_type = ?, reg_no_type = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
        [nricVal, idt, rnt, e]
      );
    }
  } catch (err) {
    console.warn('[contact] syncOperatorContactIdentity portal_account', err?.message || err);
  }

  try {
    await syncAccountingContactsForProfileEmail(e);
  } catch (err) {
    console.warn('[contact] syncOperatorContactIdentity accounting', err?.message || err);
  }

  return { ok: true };
}

/**
 * Portal profile saved fullname/email: update accounting for each operator link that already has a contact id.
 */
async function syncAccountingContactsForProfileEmail(normalizedEmail) {
  const email = String(normalizedEmail || '').trim().toLowerCase();
  if (!email) return;

  const [tRows] = await pool.query(
    'SELECT id, fullname, email, phone, account FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [email]
  );
  if (tRows.length) {
    const t = tRows[0];
    let tcRows = [];
    try {
      const [r] = await pool.query('SELECT client_id FROM tenant_client WHERE tenant_id = ?', [t.id]);
      tcRows = r || [];
    } catch (_) {
      tcRows = [];
    }
    for (const row of tcRows) {
      const cid = row.client_id;
      if (!cid) continue;
      const account = parseJson(t.account) || [];
      await syncAccountingFromMergedAccount(cid, 'tenant', t.id, account);
    }
  }

  const [oRows] = await pool.query(
    'SELECT id, ownername, email, mobilenumber, account FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [email]
  );
  if (oRows.length) {
    const o = oRows[0];
    let ocRows = [];
    try {
      const [r] = await pool.query('SELECT client_id FROM owner_client WHERE owner_id = ?', [o.id]);
      ocRows = r || [];
    } catch (_) {
      ocRows = [];
    }
    for (const row of ocRows) {
      const cid = row.client_id;
      if (!cid) continue;
      const account = parseJson(o.account) || [];
      await syncAccountingFromMergedAccount(cid, 'owner', o.id, account);
    }
  }

  const [sRows] = await pool.query('SELECT id, client_id FROM staffdetail WHERE LOWER(TRIM(email)) = ?', [email]);
  for (const s of sRows) {
    try {
      await contactSync.syncStaffForClient(s.id, s.client_id);
    } catch (e) {
      console.warn('[contact] syncAccountingContactsForProfileEmail staff', e?.message || e);
    }
  }
}

/** After supplier update: push name/email to accounting (create or update remote). */
async function pushSupplierAccountingAfterUpdate(clientId, supplierId, payload, mergedAccount, emailForRecord) {
  try {
    const [planRows] = await pool.query(
      `SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = 'plan' ORDER BY id LIMIT 1`,
      [clientId]
    );
    const planId = planRows[0]?.plan_id;
    if (!planId || !ACCOUNTING_PLAN_IDS.includes(planId)) return;

    const [intRows] = await pool.query(
      `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
      [clientId]
    );
    const provider = intRows[0]?.provider;
    if (!provider || !ACCOUNT_PROVIDERS.includes(provider)) return;

    const account = Array.isArray(mergedAccount) ? mergedAccount : [];
    const mapping = account.find((a) => a.clientId === clientId && a.provider === provider);
    const existingId = mapping?.id ?? mapping?.contactId ?? null;

    const record = {
      name: (payload.name || '').trim(),
      fullname: (payload.name || '').trim(),
      email: (emailForRecord || '').trim().toLowerCase(),
      phone: (payload.phone || '').trim()
    };

    const syncRes = await contactSync.ensureContactInAccounting(clientId, provider, 'supplier', record, existingId || null);
    if (!syncRes.ok) {
      console.warn('[contact] pushSupplierAccountingAfterUpdate', supplierId, syncRes.reason);
      return;
    }
    if (syncRes.contactId && String(syncRes.contactId) !== String(existingId || '')) {
      const merged2 = mergeAccount(account, { clientId, provider, id: String(syncRes.contactId) });
      await pool.query('UPDATE supplierdetail SET account = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [
        JSON.stringify(merged2),
        supplierId,
        clientId
      ]);
    }
  } catch (e) {
    console.warn('[contact] pushSupplierAccountingAfterUpdate', e?.message || e);
  }
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
  await syncAccountingFromMergedAccount(clientId, 'owner', ownerId, merged, { preserveLegalName: true });
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
  // Persist accounting contact id in MySQL only — do not push tenantdetail profile (name/email/phone) to accounting.
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
  await syncAccountingFromMergedAccount(clientId, 'staff', staffId, merged);
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

  /** Align with `bukku/validators/contact.validator.js` (entity_type, legal_name, types[]). */
  const body = {
    entity_type: 'MALAYSIAN_COMPANY',
    legal_name: String(payload.name || '').trim().slice(0, 100) || 'Supplier',
    types: ['supplier'],
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
  try {
    console.log(
      '[bukku/contact]',
      JSON.stringify({
        op: 'upsertContactTransit',
        method: 'POST',
        path: '/contacts',
        sent: body,
        response: {
          ok: res.ok,
          status: res.status,
          data: res.data,
          error: res.error
        }
      })
    );
  } catch (_) {
    /* ignore log serialization errors */
  }
  if (!res.ok) {
    const err = res.error;
    const msg = typeof err === 'string' ? err : JSON.stringify(err);
    return { ok: false, reason: msg || 'BUKKU_CONTACT_FAILED' };
  }
  const contactId = res.data?.id ?? res.data?.data?.id;
  if (!contactId) return { ok: false, reason: 'BUKKU_CONTACT_FAILED' };
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
  const supplierEmailFinal = supplierEmail !== undefined ? supplierEmail : (supplier.email || '');
  await pushSupplierAccountingAfterUpdate(clientId, supplierId, payload, merged, supplierEmailFinal);
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

  try {
    await contactSync.syncStaffForClient(id, clientId);
  } catch (e) {
    console.warn('[contact] createStaffContact syncStaffForClient', e?.message || e);
  }

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

  try {
    await contactSync.syncStaffForClient(staffId, clientId);
  } catch (e) {
    console.warn('[contact] updateStaffContact syncStaffForClient', e?.message || e);
  }

  return { ok: true, staffId };
}

/**
 * Delete staffdetail row (Contact Setting). Blocked when the same email exists in client_user
 * (User management on Company settings) — remove there first.
 */
async function deleteStaffContact(email, staffId, overrideClientId) {
  const clientId = await resolveClientId(email, overrideClientId);
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  if (!staffId) return { ok: false, reason: 'NO_STAFF_ID' };

  const [rows] = await pool.query(
    'SELECT id, email FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [staffId, clientId]
  );
  if (!rows.length) return { ok: false, reason: 'STAFF_NOT_FOUND' };

  const staffEmail = String(rows[0].email || '').trim().toLowerCase();
  if (staffEmail) {
    const [cu] = await pool.query(
      'SELECT id FROM client_user WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
      [clientId, staffEmail]
    );
    if (cu.length) {
      return { ok: false, reason: 'STAFF_IN_USER_MANAGEMENT' };
    }
  }

  await pool.query('DELETE FROM staffdetail WHERE id = ? AND client_id = ?', [staffId, clientId]);
  return { ok: true };
}

function normalizeText(v) {
  return String(v || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findContactRowByEmailOrName(arr, emailKey, nameKey, email, name) {
  return arr.find(
    (x) => (email && normalizeText(x[emailKey]) === email) || (name && normalizeText(x[nameKey]) === name)
  );
}

/**
 * Bukku types[] → which local rows to ensure on pull:
 * - customer → tenant only (Bukku cannot distinguish owner vs tenant; operator adds Owner in Contact UI)
 * - supplier → supplier + owner
 * - employee → staff
 * (Combinations union: e.g. customer+supplier+employee → tenant + supplier + owner + staff.)
 */
function buildBukkuTypeSet(rc) {
  const arr = Array.isArray(rc.bukkuTypes) ? rc.bukkuTypes : [];
  const set = new Set(
    arr.map((x) => String(x).toLowerCase()).filter((t) => ['customer', 'supplier', 'employee'].includes(t))
  );
  if (set.size === 0) {
    if (rc.role === 'supplier') set.add('supplier');
    else if (rc.role === 'staff') set.add('employee');
    else set.add('customer');
  }
  return set;
}

/**
 * Pull from Bukku: ensure local rows per rules above and write the same accounting contact id to each
 * applicable account[] (requires non-empty email for creates).
 */
async function syncBukkuPullByTypes(clientId, provider, rc, email, name, ctx) {
  const { owners, tenants, suppliers, staffs, pushFail } = ctx;
  const displayName = String(rc.name || '').trim().slice(0, 255);
  const title = displayName || rc.email || 'Synced Contact';
  const contactId = String(rc.id || '').trim();
  if (!contactId) return { ok: false, reason: 'NO_REMOTE_ID' };

  const types = buildBukkuTypeSet(rc);
  const needOwner = types.has('supplier');
  const needTenant = types.has('customer');
  const needSupplier = types.has('supplier');
  const needStaff = types.has('employee');

  try {
    let owner;
    if (needOwner) {
      owner = findContactRowByEmailOrName(owners, 'email', 'ownername', email, name);
      if (!owner) {
        const [globalO] = await pool.query(
          'SELECT id, ownername, email FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [email]
        );
        if (globalO.length) {
          const oid = globalO[0].id;
          await pool.query(
            'INSERT IGNORE INTO owner_client (id, client_id, owner_id, created_at) VALUES (UUID(), ?, ?, NOW())',
            [clientId, oid]
          );
          owner = { id: oid, ownername: globalO[0].ownername, email: globalO[0].email };
          owners.push(owner);
        } else {
          const ownerId = require('crypto').randomUUID();
          const account = JSON.stringify([]);
          await pool.query(
            'INSERT INTO ownerdetail (id, email, ownername, account, approvalpending, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
            [ownerId, email, displayName, account, '[]']
          );
          await pool.query(
            'INSERT IGNORE INTO owner_client (id, client_id, owner_id, created_at) VALUES (UUID(), ?, ?, NOW())',
            [clientId, ownerId]
          );
          owner = { id: ownerId, ownername: displayName, email };
          owners.push(owner);
        }
      }
    }

    let tenant;
    if (needTenant) {
      tenant = findContactRowByEmailOrName(tenants, 'email', 'fullname', email, name);
      if (!tenant) {
        const [globalT] = await pool.query(
          'SELECT id, fullname, email FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [email]
        );
        if (globalT.length) {
          const tid = globalT[0].id;
          await pool.query('INSERT IGNORE INTO tenant_client (tenant_id, client_id) VALUES (?, ?)', [tid, clientId]);
          tenant = { id: tid, fullname: globalT[0].fullname, email: globalT[0].email };
          tenants.push(tenant);
        } else {
          const tenantId = require('crypto').randomUUID();
          const account = JSON.stringify([]);
          await pool.query(
            'INSERT INTO tenantdetail (id, email, fullname, account, approval_request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
            [tenantId, email, displayName, account, '[]']
          );
          await pool.query('INSERT IGNORE INTO tenant_client (tenant_id, client_id) VALUES (?, ?)', [tenantId, clientId]);
          tenant = { id: tenantId, fullname: displayName, email };
          tenants.push(tenant);
        }
      }
    }

    let supplier;
    if (needSupplier) {
      supplier = findContactRowByEmailOrName(suppliers, 'email', 'title', email, name);
      if (!supplier) {
        const newSupplierId = require('crypto').randomUUID();
        const account = JSON.stringify([]);
        const ins = await insertSupplierForAccountingSync(newSupplierId, title, rc.email || '', clientId, account);
        if (!ins.ok) {
          pushFail(rc, 'insertSupplierBukkuPull', ins.reason || 'INSERT_FAILED');
          return { ok: false, reason: ins.reason };
        }
        supplier = { id: newSupplierId, title, email: rc.email || '' };
        suppliers.push(supplier);
      }
    }

    let staff;
    if (needStaff) {
      staff = findContactRowByEmailOrName(staffs, 'email', 'name', email, name);
      if (!staff) {
        const staffId = require('crypto').randomUUID();
        const staffName = displayName || (email ? email.split('@')[0] : '') || 'Staff';
        await pool.query(
          `INSERT INTO staffdetail (id, name, email, permission_json, status, client_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, NOW(), NOW())`,
          [staffId, staffName.slice(0, 255), email, JSON.stringify([]), clientId]
        );
        staff = { id: staffId, name: staffName, email };
        staffs.push(staff);
      }
    }

    if (needOwner && owner) {
      const wOwner = await contactSync.writeOwnerAccount(owner.id, clientId, provider, contactId);
      if (!wOwner.ok) {
        pushFail(rc, 'writeOwnerBukkuPull', wOwner.reason || 'WRITE_FAILED');
        return { ok: false, reason: wOwner.reason };
      }
    }
    if (needTenant && tenant) {
      const wTenant = await contactSync.writeTenantAccount(tenant.id, clientId, provider, contactId);
      if (!wTenant.ok) {
        pushFail(rc, 'writeTenantBukkuPull', wTenant.reason || 'WRITE_FAILED');
        return { ok: false, reason: wTenant.reason };
      }
    }
    if (needSupplier && supplier) {
      const wSup = await writeSupplierAccount(supplier.id, clientId, provider, contactId);
      if (!wSup.ok) {
        pushFail(rc, 'writeSupplierBukkuPull', wSup.reason || 'WRITE_FAILED');
        return { ok: false, reason: wSup.reason };
      }
      await maybeRefreshSupplierTitleFromRemote(supplier.id, clientId, rc.name, email);
    }
    if (needStaff && staff) {
      const wStaff = await contactSync.writeStaffAccount(staff.id, clientId, provider, contactId);
      if (!wStaff.ok) {
        pushFail(rc, 'writeStaffBukkuPull', wStaff.reason || 'WRITE_FAILED');
        return { ok: false, reason: wStaff.reason };
      }
    }

    return { ok: true };
  } catch (err) {
    const msg = err?.sqlMessage || err?.message || String(err);
    pushFail(rc, 'syncBukkuPullByTypes', msg);
    return { ok: false, reason: msg };
  }
}

/**
 * Bukku GET /contacts returns legal_name, types[], email or email_addresses[] — not `name` / single `type`.
 * Map to our sync shape: name = display/legal name, email = primary, role = supplier | staff | customer.
 *
 * types[] is collapsed to one `role` for downstream matching: supplier > employee > customer (non-Bukku pull paths only).
 * Bukku pull uses bukkuTypes[] and syncBukkuPullByTypes (customer→tenant; supplier→supplier+owner; employee→staff).
 */
function normalizeBukkuContactListItem(c) {
  const raw = c || {};
  const legal = String(raw.legal_name || raw.legalName || raw.name || raw.other_name || '').trim();
  let email = '';
  if (raw.email != null && String(raw.email).trim() !== '') {
    email = String(raw.email).trim().toLowerCase();
  } else if (Array.isArray(raw.email_addresses) && raw.email_addresses.length) {
    const first = raw.email_addresses[0];
    email = String(first?.email ?? first?.address ?? first ?? '')
      .trim()
      .toLowerCase();
  }
  const typesArr = Array.isArray(raw.types)
    ? raw.types.map((x) => String(x).toLowerCase())
    : raw.type
      ? [String(raw.type).toLowerCase()]
      : ['customer'];
  let role = 'customer';
  if (typesArr.includes('supplier')) role = 'supplier';
  else if (typesArr.includes('employee')) role = 'staff';
  else if (typesArr.includes('customer')) role = 'customer';

  return {
    id: String(raw.id ?? ''),
    name: legal,
    email,
    role,
    bukkuTypes: typesArr.filter((t) => ['customer', 'supplier', 'employee'].includes(t)),
  };
}

async function maybeRefreshSupplierTitleFromRemote(supplierId, clientId, legalName, emailNorm) {
  const title = String(legalName || '').trim();
  if (!title || !supplierId) return;
  try {
    await pool.query(
      `UPDATE supplierdetail SET title = ?, updated_at = NOW()
       WHERE id = ? AND client_id = ?
         AND (title IS NULL OR TRIM(title) = '' OR LOWER(TRIM(title)) = LOWER(TRIM(COALESCE(?, ''))))`,
      [title.slice(0, 255), supplierId, clientId, emailNorm || '']
    );
  } catch (_) {
    /* ignore */
  }
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

/**
 * Insert a supplier row when pulling a contact from accounting with no local match.
 * Mirrors createSupplier fallbacks (productid / full row vs minimal) for older schemas.
 */
async function insertSupplierForAccountingSync(newId, title, email, clientId, accountJson) {
  const attempts = [
    {
      sql: `INSERT INTO supplierdetail (id, title, email, billercode, bankaccount, bankholder, bankdetail_id, client_id, account, productid, status, created_at, updated_at)
            VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL, 1, NOW(), NOW())`,
      params: [newId, title, email, clientId, accountJson],
    },
    {
      sql: `INSERT INTO supplierdetail (id, title, email, billercode, bankaccount, bankholder, bankdetail_id, client_id, account, status, created_at, updated_at)
            VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, 1, NOW(), NOW())`,
      params: [newId, title, email, clientId, accountJson],
    },
    {
      sql: `INSERT INTO supplierdetail (id, title, email, client_id, account, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      params: [newId, title, email, clientId, accountJson],
    },
  ];
  let lastErr;
  for (let i = 0; i < attempts.length; i += 1) {
    const { sql, params } = attempts[i];
    try {
      await pool.query(sql, params);
      return { ok: true };
    } catch (e) {
      lastErr = e;
      const msg = String(e?.sqlMessage || e?.message || '');
      if (/duplicate/i.test(msg)) return { ok: false, reason: msg };
      if (msg.includes('Unknown column') && i < attempts.length - 1) continue;
      return { ok: false, reason: msg || 'INSERT_FAILED' };
    }
  }
  return { ok: false, reason: String(lastErr?.sqlMessage || lastErr?.message || 'INSERT_FAILED') };
}

async function listRemoteContacts(clientId, provider) {
  const { req } = await contactSync.buildReqForProvider(clientId, provider);
  if (provider === 'bukku') {
    const list = [];
    const seenIds = new Set();
    // Bukku list API expects `page_size` (see list_contact_schema), not `per_page`; wrong param → every
    // request returns page 1, seenIds dedupes all rows → addedThisPage===0 → loop stops after 2 iterations.
    const perPage = 100;
    const maxPages = 100;
    let page = 1;
    while (page <= maxPages) {
      const res = await bukkuContactWrapper.list(req, { page, page_size: perPage });
      if (!res.ok) {
        return { ok: false, reason: formatIntegrationApiError(res.error) || 'BUKKU_LIST_FAILED', items: [] };
      }
      const raw = res.data;
      const pageList = Array.isArray(raw?.contacts) ? raw.contacts : (Array.isArray(raw) ? raw : []);
      let addedThisPage = 0;
      for (const c of pageList) {
        const id = String(c?.id ?? '').trim();
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        list.push(c);
        addedThisPage += 1;
      }

      // Do not trust total_pages alone — Bukku may under-report; stop on short/empty page only.
      if (!pageList.length) break;
      if (pageList.length < perPage) break;
      if (addedThisPage === 0) break;
      page += 1;
    }
    return {
      ok: true,
      items: list.map((c) => normalizeBukkuContactListItem(c)).filter((c) => c.id),
    };
  }
  if (provider === 'xero') {
    const res = await xeroContactWrapper.list(req, {});
    if (!res.ok)
      return { ok: false, reason: formatIntegrationApiError(res.error) || 'XERO_LIST_FAILED', items: [] };
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
    const [cRes, sRes] = await Promise.all([
      sqlaccountContactWrapper.listCustomers(req, {}),
      sqlaccountContactWrapper.listSuppliers(req, {})
    ]);
    if (!cRes.ok)
      return { ok: false, reason: formatIntegrationApiError(cRes.error) || 'SQL_LIST_FAILED', items: [] };
    if (!sRes.ok)
      return { ok: false, reason: formatIntegrationApiError(sRes.error) || 'SQL_LIST_FAILED', items: [] };
    const extract = (raw) => {
      if (Array.isArray(raw)) return raw;
      if (raw && Array.isArray(raw.data)) return raw.data;
      return [];
    };
    const items = [];
    for (const c of extract(cRes.data)) {
      const id = String(c.code ?? c.Code ?? c.dockey ?? '').trim();
      if (!id) continue;
      const nm =
        c.description ?? c.Description ?? c.companyname ?? c.CompanyName ?? c.name ?? c.Name ?? '';
      items.push({
        id,
        name: String(nm),
        email: String(c.email ?? c.Email ?? '')
          .trim()
          .toLowerCase(),
        role: 'customer'
      });
    }
    for (const s of extract(sRes.data)) {
      const id = String(s.code ?? s.Code ?? s.dockey ?? '').trim();
      if (!id) continue;
      const nm =
        s.description ?? s.Description ?? s.companyname ?? s.CompanyName ?? s.name ?? s.Name ?? '';
      items.push({
        id,
        name: String(nm),
        email: String(s.email ?? s.Email ?? '')
          .trim()
          .toLowerCase(),
        role: 'supplier'
      });
    }
    return { ok: true, items };
  }
  return { ok: false, reason: 'UNSUPPORTED_PROVIDER', items: [] };
}

async function syncContactsToAccounting(clientId, provider) {
  const counters = { scanned: 0, synced: 0, created: 0, failed: 0 };
  const failureSamples = [];
  const isSqlDatasetNotEditable = (reasonText) =>
    provider === 'sql' && /dataset not in edit or insert mode/i.test(String(reasonText || ''));
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
    /** Existing accounting contact id: keep remote legal/name on update (PUT collisions with portal display name). */
    const ensureOpts =
      beforeId && ['owner', 'tenant', 'supplier', 'staff'].includes(kind)
        ? { preserveLegalName: true }
        : {};
    const syncRes = await contactSync.ensureContactInAccounting(
      clientId,
      provider,
      kind,
      row,
      existingId,
      ensureOpts
    );
    if (!syncRes.ok || !syncRes.contactId) {
      const reason = String(syncRes.reason || 'SYNC_FAILED').slice(0, 500);
      if (isSqlDatasetNotEditable(reason)) {
        console.warn('[contact/sync-all] ensure skipped (sql non-editable existing)', {
          clientId,
          provider,
          kind,
          email: row?.email || '',
          reason
        });
        return;
      }
      counters.failed += 1;
      if (failureSamples.length < 20) {
        failureSamples.push({
          stage: 'ensureContactInAccounting',
          kind,
          name: String(row?.name || row?.fullname || '').slice(0, 120),
          email: String(row?.email || '').slice(0, 120),
          reason
        });
      }
      console.warn('[contact/sync-all] ensure failed', {
        clientId,
        provider,
        kind,
        email: row?.email || '',
        reason
      });
      return;
    }
    if (!beforeId) counters.created += 1;
    const writeRes = await writeFn(syncRes.contactId);
    if (!writeRes.ok) {
      counters.failed += 1;
      const reason = String(writeRes.reason || 'WRITE_FAILED').slice(0, 500);
      if (failureSamples.length < 20) {
        failureSamples.push({
          stage: 'writeMapping',
          kind,
          name: String(row?.name || row?.fullname || '').slice(0, 120),
          email: String(row?.email || '').slice(0, 120),
          reason
        });
      }
      console.warn('[contact/sync-all] write failed', {
        clientId,
        provider,
        kind,
        email: row?.email || '',
        reason
      });
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

  return { ok: true, ...counters, failureSamples };
}

/**
 * Pull: each remote row is matched by email/name — order: supplier branch (if normalized role is supplier) → owner → tenant → staff → supplier by email → insert supplierdetail.
 * Bukku only: syncBukkuPullByTypes applies type rules (customer→tenant; supplier→supplier+owner; employee→staff).
 * Other providers: each iteration writes that remote id into at most one local row (first match wins).
 */
async function syncContactsFromAccounting(clientId, provider) {
  const remoteRes = await listRemoteContacts(clientId, provider);
  if (!remoteRes.ok) return { ok: false, reason: remoteRes.reason || 'REMOTE_LIST_FAILED' };
  const remote = remoteRes.items || [];
  const counters = { scanned: remote.length, linked: 0, created: 0, failed: 0 };

  // Email/name matching only; `account` is written by write*Account (requires `account` column — migration 0145 / 0049 / 0057).
  const [owners] = await pool.query(
    `SELECT DISTINCT o.id, o.ownername, o.email
     FROM ownerdetail o
     LEFT JOIN owner_client oc ON oc.owner_id = o.id
     WHERE oc.client_id = ?`,
    [clientId]
  );
  const [tenants] = await pool.query(
    `SELECT t.id, t.fullname, t.email
     FROM tenantdetail t
     LEFT JOIN tenant_client tc ON tc.tenant_id = t.id
     WHERE tc.client_id = ? OR t.client_id = ?`,
    [clientId, clientId]
  );
  const [suppliers] = await pool.query('SELECT id, title, email FROM supplierdetail WHERE client_id = ?', [clientId]);
  const [staffs] = await pool.query('SELECT id, name, email FROM staffdetail WHERE client_id = ?', [clientId]);

  const failureSamples = [];
  const pushFail = (rc, stage, reason) => {
    if (failureSamples.length >= 15) return;
    failureSamples.push({
      remoteId: rc.id,
      email: String(rc.email || ''),
      name: String(rc.name || ''),
      stage,
      reason: String(reason || '').slice(0, 500),
    });
  };

  for (const rc of remote) {
    const email = normalizeText(rc.email);
    const name = normalizeText(rc.name);
    try {
      if (provider === 'bukku' && email) {
        const pullRes = await syncBukkuPullByTypes(clientId, provider, rc, email, name, {
          owners,
          tenants,
          suppliers,
          staffs,
          pushFail,
        });
        if (pullRes.ok) counters.linked += 1;
        else counters.failed += 1;
        continue;
      }

      if (rc.role === 'supplier') {
        const s = findContactRowByEmailOrName(suppliers, 'email', 'title', email, name);
        if (s) {
          const res = await writeSupplierAccount(s.id, clientId, provider, rc.id);
          if (res.ok) {
            counters.linked += 1;
            await maybeRefreshSupplierTitleFromRemote(s.id, clientId, rc.name, email);
          } else {
            counters.failed += 1;
            pushFail(rc, 'writeSupplier', res.reason || 'WRITE_FAILED');
          }
          continue;
        }
      }

      const owner = findContactRowByEmailOrName(owners, 'email', 'ownername', email, name);
      if (owner) {
        const res = await contactSync.writeOwnerAccount(owner.id, clientId, provider, rc.id);
        if (res.ok) counters.linked += 1;
        else {
          counters.failed += 1;
          pushFail(rc, 'writeOwner', res.reason || 'WRITE_FAILED');
        }
        continue;
      }
      const tenant = findContactRowByEmailOrName(tenants, 'email', 'fullname', email, name);
      if (tenant) {
        const res = await contactSync.writeTenantAccount(tenant.id, clientId, provider, rc.id);
        if (res.ok) counters.linked += 1;
        else {
          counters.failed += 1;
          pushFail(rc, 'writeTenant', res.reason || 'WRITE_FAILED');
        }
        continue;
      }
      const staff = findContactRowByEmailOrName(staffs, 'email', 'name', email, name);
      if (staff) {
        const res = await contactSync.writeStaffAccount(staff.id, clientId, provider, rc.id);
        if (res.ok) counters.linked += 1;
        else {
          counters.failed += 1;
          pushFail(rc, 'writeStaff', res.reason || 'WRITE_FAILED');
        }
        continue;
      }

      // Bukku type is often `customer`, not `supplier`, so the block above may skip supplierdetail
      // entirely. Without this, two remote rows with the same email each INSERT a new supplier.
      const supplierByEmail = findContactRowByEmailOrName(suppliers, 'email', 'title', email, name);
      if (supplierByEmail) {
        const res = await writeSupplierAccount(supplierByEmail.id, clientId, provider, rc.id);
        if (res.ok) {
          counters.linked += 1;
          await maybeRefreshSupplierTitleFromRemote(supplierByEmail.id, clientId, rc.name, email);
        } else {
          counters.failed += 1;
          pushFail(rc, 'writeSupplier', res.reason || 'WRITE_FAILED');
        }
        continue;
      }

      const newSupplierId = require('crypto').randomUUID();
      const account = JSON.stringify([{ clientId, provider, id: rc.id }]);
      const title = rc.name || rc.email || 'Synced Contact';
      const ins = await insertSupplierForAccountingSync(newSupplierId, title, rc.email || '', clientId, account);
      if (ins.ok) {
        counters.created += 1;
        suppliers.push({ id: newSupplierId, title, email: rc.email || '' });
      } else {
        counters.failed += 1;
        pushFail(rc, 'insertSupplier', ins.reason || 'INSERT_FAILED');
      }
    } catch (err) {
      counters.failed += 1;
      const msg = err?.sqlMessage || err?.message || String(err);
      console.warn('[contact] syncContactsFromAccounting row failed', msg);
      pushFail(rc, 'exception', msg);
    }
  }

  return { ok: true, ...counters, failureSamples };
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
  listRemoteContacts,
  updateOwnerAccount,
  updateOwnerBankFields,
  updateTenantAccount,
  updateStaffAccount,
  updatePortalPhoneForClientContact,
  syncOperatorContactIdentity,
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
  deleteStaffContact,
  syncAllContacts,
  syncAccountingContactsForProfileEmail
};
