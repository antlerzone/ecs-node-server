/**
 * Company Setting – migrated from Wix companysetting page.
 * Uses MySQL: staffdetail, clientdetail, client_profile, client_integration, bankdetail.
 * All functions that need auth take email and resolve via getAccessContextByEmail.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { getAccessContextByEmail } = require('../access/access.service');
const { getClientAddonCapabilities, getClientMaxStaffAllowed } = require('../billing/billing.service');
const { ensureClientCnyiotSubuser } = require('../cnyiot/lib/cnyiotSubuser');
const { ensureTTLockSubuser, ensureTTLockIntegrationRow, getTTLockIntegration, updateTTLockIntegration } = require('../ttlock/lib/ttlockSubuser');

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

function getEmail(req) {
  return req?.body?.email ?? req?.query?.email ?? null;
}

async function requireCtx(email, permissionKeys = ['profilesetting', 'usersetting', 'integration', 'admin']) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx?.ok) throw new Error(ctx?.reason || 'ACCESS_DENIED');
  const clientId = ctx.client?.id;
  if (!clientId) throw new Error('NO_CLIENT_ID');
  const staff = ctx.staff || {};
  const perms = staff.permission || {};
  const allowed = permissionKeys.some(k => perms[k] || perms.admin);
  if (!allowed) throw new Error('NO_PERMISSION');
  return { ctx, clientId, staffId: staff.id };
}

/**
 * Staff list for current client (user setting section).
 */
async function getStaffList(email) {
  const { clientId } = await requireCtx(email, ['usersetting', 'admin']);
  const [clientRows] = await pool.query(
    'SELECT email FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  const mainAdminEmail = (clientRows[0] && clientRows[0].email)
    ? String(clientRows[0].email).trim().toLowerCase()
    : '';
  const [rows] = await pool.query(
    'SELECT id, name, email, salary, bankaccount, bank_name_id, permission_json, status, profile FROM staffdetail WHERE client_id = ? ORDER BY status DESC, name',
    [clientId]
  );
  const list = rows.map(r => ({
    _id: r.id,
    id: r.id,
    name: r.name || '',
    email: r.email || '',
    salary: r.salary != null ? String(r.salary) : '',
    bankAccount: r.bankaccount || '',
    bankName: r.bank_name_id,
    permission: parseJson(r.permission_json),
    status: r.status === 1 || r.status === true,
    profile: parseJson(r.profile)
  }));
  const maxStaffAllowed = await getClientMaxStaffAllowed(clientId);
  return { ok: true, items: list, mainAdminEmail, maxStaffAllowed };
}

/**
 * Create staff (contact); permission can be array of keys.
 */
async function createStaff(email, payload) {
  const { clientId, staffId: currentStaffId } = await requireCtx(email, ['usersetting', 'admin']);
  const maxStaffAllowed = await getClientMaxStaffAllowed(clientId);
  const [[countRow]] = await pool.query('SELECT COUNT(*) AS c FROM staffdetail WHERE client_id = ?', [clientId]);
  const currentCount = Number(countRow?.c ?? 0) || 0;
  if (currentCount >= maxStaffAllowed) {
    throw new Error('STAFF_LIMIT_REACHED');
  }
  const id = randomUUID();
  const name = (payload.name || '').trim();
  const emailVal = (payload.email || '').trim().toLowerCase();
  const salary = payload.salary != null ? payload.salary : null;
  const bankAccount = (payload.bankAccount || '').replace(/\s+/g, '');
  const bankNameId = payload.bankName || null;
  let permission = payload.permission;
  if (Array.isArray(permission)) {
    permission = JSON.stringify(permission);
  } else if (permission && typeof permission === 'object') {
    permission = JSON.stringify(Object.keys(permission).filter(k => permission[k]));
  } else {
    permission = '[]';
  }
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  await pool.query(
    `INSERT INTO staffdetail (id, name, email, salary, bankaccount, bank_name_id, permission_json, status, client_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [id, name, emailVal, salary, bankAccount, bankNameId, permission, clientId, now, now]
  );
  if (payload.syncToAccounting) {
    const contactSync = require('../contact/contact-sync.service');
    await contactSync.syncStaffToAllAccountingProviders(id, clientId);
  }
  return { ok: true, staff: { _id: id, id } };
}

/**
 * Update staff by id.
 */
async function updateStaff(email, staffId, payload) {
  const { clientId } = await requireCtx(email, ['usersetting', 'admin']);
  const [existing] = await pool.query(
    'SELECT id FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [staffId, clientId]
  );
  if (!existing.length) throw new Error('STAFF_NOT_FOUND');
  const name = (payload.name || '').trim();
  const emailVal = (payload.email || '').trim().toLowerCase();
  const salary = payload.salary != null ? payload.salary : null;
  const bankAccount = (payload.bankAccount || '').replace(/\s+/g, '');
  const bankNameId = payload.bankName || null;
  let permission = payload.permission;
  if (Array.isArray(permission)) {
    permission = JSON.stringify(permission);
  } else if (permission && typeof permission === 'object') {
    permission = JSON.stringify(Object.keys(permission).filter(k => permission[k]));
  }
  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (emailVal !== undefined) { updates.push('email = ?'); params.push(emailVal); }
  if (salary !== undefined) { updates.push('salary = ?'); params.push(salary); }
  if (bankAccount !== undefined) { updates.push('bankaccount = ?'); params.push(bankAccount); }
  if (bankNameId !== undefined) { updates.push('bank_name_id = ?'); params.push(bankNameId); }
  if (permission !== undefined) { updates.push('permission_json = ?'); params.push(permission); }
  if (payload.status !== undefined) {
    updates.push('status = ?');
    params.push(payload.status ? 1 : 0);
  }
  if (payload.profile !== undefined) {
    updates.push('profile = ?');
    params.push(typeof payload.profile === 'string' ? payload.profile : JSON.stringify(payload.profile || {}));
  }
  if (updates.length === 0 && !payload.syncToAccounting) return { ok: true };
  if (updates.length > 0) {
    params.push(staffId);
    await pool.query(
      `UPDATE staffdetail SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );
  }
  if (payload.syncToAccounting) {
    const contactSync = require('../contact/contact-sync.service');
    await contactSync.syncStaffToAllAccountingProviders(staffId, clientId);
  }
  return { ok: true };
}

/**
 * Integration template (static) – same shape as backend/integration/integrationtemplate.jsw.
 */
function getIntegrationTemplate() {
  return [
    {
      key: 'paymentGateway',
      title: 'Payment Gateway',
      version: 3,
      multiProvider: false,
      providers: ['stripe'],
      fields: [
        { key: 'provider', label: 'Provider', type: 'dropdown', options: [{ label: 'Stripe', value: 'stripe' }] },
        { key: 'stripe_secretKey', label: 'Stripe Secret Key', type: 'input', provider: 'stripe' },
        { key: 'stripe_webhookSecret', label: 'Stripe Webhook Secret', type: 'input', provider: 'stripe' }
      ]
    },
    {
      key: 'meter',
      title: 'Meter Integration',
      version: 3,
      multiProvider: false,
      providers: ['cnyiot'],
      fields: [
        { key: 'cnyiot_username', label: 'CNYIOT Username', type: 'input', provider: 'cnyiot' },
        { key: 'cnyiot_password', label: 'CNYIOT Password', type: 'input', provider: 'cnyiot' }
      ]
    },
    {
      key: 'smartDoor',
      title: 'Smart Door Integration',
      version: 3,
      multiProvider: false,
      providers: ['ttlock'],
      fields: [
        { key: 'ttlock_username', label: 'TTLock Username', type: 'input', provider: 'ttlock' },
        { key: 'ttlock_password', label: 'TTLock Password', type: 'input', provider: 'ttlock' }
      ]
    },
    {
      key: 'addonAccount',
      title: 'Accounting Integration',
      version: 1,
      multiProvider: true,
      providers: ['bukku', 'xero', 'autocount', 'sql'],
      fields: [
        { key: 'provider', label: 'Provider', type: 'dropdown', options: [{ label: 'Bukku', value: 'bukku' }, { label: 'Xero', value: 'xero' }, { label: 'AutoCount', value: 'autocount' }, { label: 'SQL Account', value: 'sql' }] },
        { key: 'bukku_secretKey', label: 'Bukku Secret Key', type: 'input', provider: 'bukku' },
        { key: 'bukku_subdomain', label: 'Bukku Subdomain', type: 'input', provider: 'bukku' },
        { key: 'xero_secretKey', label: 'Xero Secret Key', type: 'input', provider: 'xero' },
        { key: 'xero_subdomain', label: 'Xero Subdomain', type: 'input', provider: 'xero' },
        { key: 'autocount_apiKey', label: 'AutoCount API Key', type: 'input', provider: 'autocount' },
        { key: 'autocount_keyId', label: 'AutoCount Key ID', type: 'input', provider: 'autocount' },
        { key: 'autocount_accountBookId', label: 'AutoCount Account Book ID', type: 'input', provider: 'autocount' },
        { key: 'sqlaccount_access_key', label: 'SQL Account Access Key', type: 'input', provider: 'sql' },
        { key: 'sqlaccount_secret_key', label: 'SQL Account Secret Key', type: 'input', provider: 'sql' },
        { key: 'sqlaccount_base_url', label: 'SQL Account Base URL (optional)', type: 'input', provider: 'sql' }
      ]
    }
  ];
}

/**
 * Get profile (company profile section): clientdetail + client_profile.
 */
async function getProfile(email) {
  const { clientId } = await requireCtx(email, ['profilesetting', 'admin']);
  const [clientRows] = await pool.query(
    'SELECT id, title, currency, profilephoto, subdomain FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length) throw new Error('CLIENT_NOT_FOUND');
  const client = clientRows[0];
  const [profileRows] = await pool.query(
    'SELECT ssm, address, contact, subdomain, tin, accountholder, accountnumber, bank_id, company_chop FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const profile = profileRows[0] || {};
  return {
    ok: true,
    client: {
      id: client.id,
      title: client.title,
      currency: client.currency || 'MYR',
      profilephoto: client.profilephoto,
      subdomain: client.subdomain || profile.subdomain
    },
    profile: {
      ssm: profile.ssm || '',
      address: profile.address || '',
      contact: profile.contact || '',
      subdomain: profile.subdomain || '',
      tin: profile.tin || '',
      accountholder: profile.accountholder || '',
      accountnumber: profile.accountnumber || '',
      bankId: profile.bank_id || null,
      companyChop: profile.company_chop || ''
    }
  };
}

/**
 * Update company profile (clientdetail + client_profile).
 */
async function updateProfile(email, payload) {
  const { clientId } = await requireCtx(email, ['profilesetting', 'admin']);
  const [clientRows] = await pool.query('SELECT id, currency FROM clientdetail WHERE id = ? LIMIT 1', [clientId]);
  if (!clientRows.length) throw new Error('CLIENT_NOT_FOUND');
  const existingCurrency = (clientRows[0].currency || 'MYR').toString().toUpperCase();

  const title = (payload.title || '').trim();
  const profilephoto = payload.profilephoto != null ? payload.profilephoto : undefined;
  // currency is not updatable here: only set at registration or by admin
  await pool.query(
    'UPDATE clientdetail SET title = ?, currency = ?, updated_at = NOW()' + (profilephoto !== undefined ? ', profilephoto = ?' : '') + ' WHERE id = ?',
    profilephoto !== undefined ? [title, existingCurrency, profilephoto, clientId] : [title, existingCurrency, clientId]
  );

  const [profileRows] = await pool.query('SELECT id FROM client_profile WHERE client_id = ? LIMIT 1', [clientId]);
  const ssm = (payload.ssm || '').trim();
  const address = (payload.address || '').trim();
  const contact = (payload.contact || '').replace(/\s+/g, '');
  const subdomain = (payload.subdomain || '').trim().toLowerCase();
  const tin = (payload.tin || '').trim();
  const accountholder = (payload.accountholder || '').trim();
  const accountnumber = (payload.accountnumber || '').trim();
  const bankId = payload.bankId || null;
  const companyChop = payload.companyChop != null ? String(payload.companyChop).trim() : undefined;

  if (profileRows.length > 0) {
    const updates = ['ssm = ?', 'address = ?', 'contact = ?', 'subdomain = ?', 'tin = ?', 'accountholder = ?', 'accountnumber = ?', 'bank_id = ?'];
    const params = [ssm, address, contact, subdomain, tin, accountholder, accountnumber, bankId];
    if (companyChop !== undefined) {
      updates.push('company_chop = ?');
      params.push(companyChop || null);
    }
    params.push(clientId);
    await pool.query(
      `UPDATE client_profile SET ${updates.join(', ')}, updated_at = NOW() WHERE client_id = ?`,
      params
    );
  } else {
    const profileId = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    await pool.query(
      `INSERT INTO client_profile (id, client_id, ssm, address, contact, subdomain, tin, accountholder, accountnumber, bank_id, company_chop, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [profileId, clientId, ssm, address, contact, subdomain, tin, accountholder, accountnumber, bankId, (companyChop !== undefined && companyChop) ? companyChop : null, now, now]
    );
  }
  if (profilephoto !== undefined) {
    await pool.query('UPDATE clientdetail SET profilephoto = ?, updated_at = NOW() WHERE id = ?', [profilephoto, clientId]);
  }
  return { ok: true };
}

/**
 * Bank dropdown options (BankDetail → bankdetail).
 */
async function getBanks() {
  const [rows] = await pool.query('SELECT id, bankname FROM bankdetail ORDER BY bankname');
  return {
    ok: true,
    items: rows.map(r => ({ label: r.bankname || '', value: r.id }))
  };
}

/**
 * Get admin detail (clientdetail.admin JSON).
 */
async function getAdmin(email) {
  const { clientId } = await requireCtx(email, ['admin']);
  const [rows] = await pool.query('SELECT admin FROM clientdetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) return { ok: true, admin: null };
  const admin = parseJson(rows[0].admin);
  return { ok: true, admin: admin || null };
}

/**
 * Save admin detail (clientdetail.admin JSON).
 */
async function saveAdmin(email, admin) {
  const { clientId } = await requireCtx(email, ['admin']);
  const json = typeof admin === 'object' ? JSON.stringify(admin) : (admin || '{}');
  await pool.query('UPDATE clientdetail SET admin = ?, updated_at = NOW() WHERE id = ?', [json, clientId]);
  return { ok: true };
}

/**
 * Onboard connection status for Integration section buttons.
 * cnyiotCreateEverUsed / ttlockCreateEverUsed: when true, frontend should hide "Create account" and only show "Existing" (disconnect = only break mapping).
 * @returns {Promise<{ ok: boolean, stripeConnected, cnyiotConnected, cnyiotCreateEverUsed, accountingConnected, accountingProvider, accountingEinvoice, ttlockConnected, ttlockCreateEverUsed }>}
 */
async function getOnboardStatus(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [profileRows] = await pool.query(
    'SELECT stripe_connected_account_id FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const stripeConnected = !!(profileRows[0] && profileRows[0].stripe_connected_account_id);

  const [intRows] = await pool.query(
    `SELECT \`key\`, provider, enabled, einvoice, values_json FROM client_integration WHERE client_id = ? AND (( \`key\` = 'meter' AND provider = 'cnyiot' ) OR ( \`key\` = 'addonAccount' ) OR ( \`key\` = 'smartDoor' AND provider = 'ttlock' ))`,
    [clientId]
  );
  let cnyiotConnected = false;
  let cnyiotCreateEverUsed = false;
  let cnyiotDisconnectedWithMode = null; // 'create' | 'existing' when disconnected
  let accountingConnected = false;
  let accountingProvider = null;
  let accountingEinvoice = false;
  let ttlockConnected = false;
  let ttlockCreateEverUsed = false;
  let ttlockDisconnectedWithMode = null; // 'create' | 'existing' when disconnected (had sub-account or own account)
  for (const r of intRows) {
    const values = typeof r.values_json === 'string' ? (() => { try { return JSON.parse(r.values_json || '{}'); } catch (_) { return {}; } })() : (r.values_json || {});
    if (r.key === 'meter' && r.provider === 'cnyiot') {
      if (r.enabled === 1) cnyiotConnected = true;
      if (values.cnyiot_subuser_ever_created) cnyiotCreateEverUsed = true;
      if (r.enabled !== 1 && (values.cnyiot_mode === 'create' || values.cnyiot_mode === 'existing')) {
        cnyiotDisconnectedWithMode = values.cnyiot_mode;
      }
    }
    if (r.key === 'addonAccount' && r.enabled === 1) {
      accountingConnected = true;
      accountingProvider = r.provider || null;
      accountingEinvoice = r.einvoice === 1 || r.einvoice === true;
    }
    if (r.key === 'smartDoor' && r.provider === 'ttlock') {
      if (r.enabled === 1) ttlockConnected = true;
      if (values.ttlock_subuser_ever_created) ttlockCreateEverUsed = true;
      if (r.enabled !== 1 && (values.ttlock_mode === 'create' || values.ttlock_mode === 'existing')) {
        ttlockDisconnectedWithMode = values.ttlock_mode;
      }
    }
  }
  return {
    ok: true,
    stripeConnected,
    cnyiotConnected,
    cnyiotCreateEverUsed,
    cnyiotDisconnectedWithMode,
    accountingConnected,
    accountingProvider,
    accountingEinvoice,
    ttlockConnected,
    ttlockCreateEverUsed,
    ttlockDisconnectedWithMode
  };
}

/**
 * Disconnect Stripe Connect: clear stripe_connected_account_id and stripe_connect_pending_id for the client.
 */
async function stripeDisconnect(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  await pool.query(
    'UPDATE client_profile SET stripe_connected_account_id = NULL, stripe_connect_pending_id = NULL, updated_at = NOW() WHERE client_id = ?',
    [clientId]
  );
  return { ok: true };
}

/**
 * Stripe Connect onboarding URL – delegate to stripe.service. MY 用 OAuth，SG 用 Express.
 */
async function getStripeConnectOnboardUrl(email, returnUrl, refreshUrl) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const { createConnectAccountAndLink } = require('../stripe/stripe.service');
  return createConnectAccountAndLink(clientId, returnUrl, refreshUrl);
}

/**
 * Complete Stripe Connect OAuth (MY Standard): exchange code, save stripe_connected_account_id.
 * state 必须等于当前 clientId，防止 CSRF。
 */
async function stripeConnectOAuthComplete(email, code, state) {
  console.log('[companysetting] stripeConnectOAuthComplete email=%s statePreview=%s', email, state ? String(state).substring(0, 8) + '...' : '');
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  console.log('[companysetting] stripeConnectOAuthComplete clientId=%s stateMatch=%s', clientId, state && String(state).trim() === String(clientId));
  if (!state || String(state).trim() !== String(clientId)) throw new Error('STRIPE_OAUTH_STATE_MISMATCH');
  const { completeStripeConnectOAuth } = require('../stripe/stripe.service');
  return completeStripeConnectOAuth(clientId, code);
}

/**
 * Complete Stripe Connect OAuth using only state (clientId). Used when return page has no session/email.
 * state 即我们生成 OAuth URL 时传的 clientId，校验其存在后换 code 并落库。
 */
async function stripeConnectOAuthCompleteByState(state, code) {
  if (!state || !String(state).trim() || !code || !String(code).trim()) {
    throw new Error('STRIPE_OAUTH_CODE_REQUIRED');
  }
  const clientId = String(state).trim();
  const [rows] = await pool.query('SELECT id FROM clientdetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) throw new Error('STRIPE_OAUTH_STATE_INVALID');
  const { completeStripeConnectOAuth } = require('../stripe/stripe.service');
  return completeStripeConnectOAuth(clientId, code);
}

/**
 * CNYIOT connect: existing = save username/password to client_integration (meter/cnyiot); create = ensure subuser.
 * contact & subdomain: 创建子账号时从 client_profile 表读取，不依赖前端传参。
 */
async function cnyiotConnect(email, { mode, username, password, tel } = {}) {
  const t0 = Date.now();
  console.log('[cnyiotConnect] start email=%s mode=%s', email, mode);
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  console.log('[cnyiotConnect] clientId=%s ms=%s', clientId, Date.now() - t0);
  if (mode === 'existing') {
    if (!username || !password) throw new Error('USERNAME_AND_PASSWORD_REQUIRED');
    const login = String(username).trim();
    await upsertClientIntegration(clientId, 'meter', 0, 'cnyiot', {
      cnyiot_username: login,
      cnyiot_password: String(password),
      cnyiot_mode: 'existing'
    }, true);
    await pool.query(
      'UPDATE clientdetail SET cnyiot_subuser_login = ?, cnyiot_subuser_manual = 1, updated_at = NOW() WHERE id = ?',
      [login, clientId]
    );
    return { ok: true, mode: 'existing' };
  }
  if (mode === 'create') {
    // contact: client_profile.contact（Profile 保存处）；subdomain 在 ensureClientCnyiotSubuser 内从 client_profile 取
    let telToUse = (tel != null && String(tel).trim() !== '') ? String(tel).trim() : null;
    if (telToUse == null) {
      const [profileRows] = await pool.query(
        'SELECT contact FROM client_profile WHERE client_id = ? LIMIT 1',
        [clientId]
      );
      const contact = profileRows[0] && profileRows[0].contact != null && String(profileRows[0].contact).trim() !== ''
        ? String(profileRows[0].contact).trim()
        : '';
      if (!contact) throw new Error('CONTACT_REQUIRED');
      telToUse = contact;
    }
    await upsertClientIntegration(clientId, 'meter', 0, 'cnyiot', {}, true);
    console.log('[cnyiotConnect] ensureClientCnyiotSubuser start clientId=%s telFromProfile=%s ms=%s', clientId, !!telToUse, Date.now() - t0);
    const result = await ensureClientCnyiotSubuser(clientId, { tel: telToUse });
    console.log('[cnyiotConnect] ensureClientCnyiotSubuser done clientId=%s subdomain=%s cnyiot_subuser_id=%s DURATION_MS=%s', clientId, result.subdomain, result.cnyiot_subuser_id, Date.now() - t0);
    await upsertClientIntegration(clientId, 'meter', 0, 'cnyiot', { cnyiot_mode: 'create' }, true);
    return { ok: true, mode: 'create', subdomain: result.subdomain, cnyiot_subuser_id: result.cnyiot_subuser_id, station_index: result.cnyiot_subuser_id };
  }
  throw new Error('INVALID_MODE');
}

/**
 * CNYIOT (Meter): disconnect = set enabled = 0. Keep values_json (cnyiot_mode etc.) so after disconnect dropdown shows "Connect old/own account".
 */
async function cnyiotDisconnect(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT id FROM client_integration WHERE client_id = ? AND \`key\` = 'meter' AND provider = 'cnyiot' LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    await pool.query('UPDATE client_integration SET enabled = 0, updated_at = NOW() WHERE id = ?', [rows[0].id]);
  }
  return { ok: true };
}

/**
 * Get CNYIOT 租客列表 (getUsers) 用 env 母账号 (CNYIOT_LOGIN_NAME/PSW)，测试页查「这个户口」下有哪些 user。
 * When opts.debug true, returns requestPayload + responsePayload for display.
 * Returns { ok: true, users, requestPayload?, responsePayload? } or { ok: false, reason }.
 */
async function getCnyiotUsers(email, opts = {}) {
  await requireCtx(email, ['integration', 'admin']);
  const userWrapper = require('../cnyiot/wrappers/user.wrapper');
  const clientId = 'platform';
  const res = await userWrapper.getUsers(clientId, { usePlatformAccount: true, returnPayloads: !!opts.debug });
  if (opts.debug && res && res.requestPayload != null) {
    const list = res.result?.value || [];
    return {
      ok: true,
      users: list,
      requestPayload: res.requestPayload,
      responsePayload: res.responsePayload
    };
  }
  const list = res?.value || [];
  return { ok: true, users: list };
}

/**
 * Create CNYIOT 租客 (addUser) 用 env 母账号，并返回发去的 payload 与返回的 body 供前端展示。
 * Body: { loginName, password, tel }. 接口要求 tel 必填。Returns { ok, requestPayload, responsePayload, result? } or { ok: false, reason }.
 */
async function createCnyiotUser(email, { loginName, password, tel } = {}) {
  await requireCtx(email, ['integration', 'admin']);
  const userWrapper = require('../cnyiot/wrappers/user.wrapper');
  const clientId = 'platform';
  const telStr = (tel != null && String(tel).trim() !== '') ? String(tel).trim() : (process.env.CNYIOT_CREATE_USER_DEFAULT_TEL || '60122113361');
  const res = await userWrapper.addUser(clientId, {
    loginName: loginName || '',
    uI: loginName,
    uN: loginName,
    tel: telStr,
    psw: password
  }, { usePlatformAccount: true, returnPayloads: true });
  if (res && res.requestPayload != null) {
    return {
      ok: true,
      requestPayload: res.requestPayload,
      responsePayload: res.responsePayload,
      result: res.result
    };
  }
  return { ok: true, requestPayload: null, responsePayload: res, result: res };
}

/**
 * Get current Meter (CNYIOT) username & password for the client (for pre-fill in UI). Requires integration/admin.
 * Returns cnyiot_username/cnyiot_password from client_integration (existing account) or cnyiot_subuser_login (create flow); password empty if not stored.
 */
async function getCnyiotCredentials(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'meter' AND provider = 'cnyiot' LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return { ok: true, username: '', password: '' };
  const raw = rows[0].values_json;
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw || '{}'); } catch (_) { return {}; } })() : (raw || {});
  const username = v.cnyiot_username ?? v.cnyiot_subuser_login ?? '';
  const password = v.cnyiot_password ?? '';
  return { ok: true, username, password };
}

/**
 * Get current TTLock (Smart Door) username & password for the client (for pre-fill in UI). Requires integration/admin.
 * Returns ttlock_username/ttlock_password from client_integration (key=smartDoor, provider=ttlock).
 */
async function getTtlockCredentials(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return { ok: true, username: '', password: '' };
  const raw = rows[0].values_json;
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw || '{}'); } catch (_) { return {}; } })() : (raw || {});
  const username = v.ttlock_username ?? '';
  const password = v.ttlock_password ?? '';
  return { ok: true, username, password };
}

/**
 * Bukku (addonAccount): save token + subdomain to client_integration. Optional einvoice for #checkboxeinvoiceonboard.
 */
async function bukkuConnect(email, { token, subdomain, einvoice }) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  if (!token || !subdomain) throw new Error('TOKEN_AND_SUBDOMAIN_REQUIRED');
  await upsertClientIntegration(clientId, 'addonAccount', 0, 'bukku', {
    bukku_secretKey: String(token).trim(),
    bukku_subdomain: String(subdomain).trim()
  }, true, einvoice);
  return { ok: true };
}

/**
 * Get current Bukku token & subdomain for the client (for pre-fill in UI). Requires integration/admin.
 */
async function getBukkuCredentials(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'bukku' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return { ok: true, token: '', subdomain: '' };
  const raw = rows[0].values_json;
  const v = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  return {
    ok: true,
    token: v.bukku_secretKey ?? v.bukku_token ?? '',
    subdomain: v.bukku_subdomain ?? ''
  };
}

/**
 * Bukku (addonAccount): no Bukku API to call; just clear stored token & subdomain and disable.
 */
async function bukkuDisconnect(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT id FROM client_integration WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'bukku' LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    const valuesJson = JSON.stringify({ bukku_secretKey: '', bukku_subdomain: '' });
    await pool.query(
      'UPDATE client_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?',
      [valuesJson, rows[0].id]
    );
  }
  return { ok: true };
}

/**
 * AutoCount (addonAccount): save API Key, Key ID, Account Book ID to client_integration.
 * From Cloud Accounting Settings > API Keys.
 */
async function autocountConnect(email, { apiKey, keyId, accountBookId, einvoice }) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  if (!apiKey || !keyId) throw new Error('API_KEY_AND_KEY_ID_REQUIRED');
  if (accountBookId == null || String(accountBookId).trim() === '') throw new Error('ACCOUNT_BOOK_ID_REQUIRED');
  await upsertClientIntegration(clientId, 'addonAccount', 0, 'autocount', {
    autocount_apiKey: String(apiKey).trim(),
    autocount_keyId: String(keyId).trim(),
    autocount_accountBookId: String(accountBookId).trim()
  }, true, einvoice);
  return { ok: true };
}

/**
 * Get current AutoCount apiKey, keyId, accountBookId for the client (for pre-fill in UI).
 */
async function getAutoCountCredentials(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'autocount' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return { ok: true, apiKey: '', keyId: '', accountBookId: '' };
  const raw = rows[0].values_json;
  const v = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  return {
    ok: true,
    apiKey: v.autocount_apiKey ?? v.autocount_api_key ?? '',
    keyId: v.autocount_keyId ?? v.autocount_key_id ?? '',
    accountBookId: v.autocount_accountBookId ?? v.autocount_account_book_id ?? ''
  };
}

/**
 * AutoCount (addonAccount): disable and clear stored credentials.
 */
async function autocountDisconnect(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT id FROM client_integration WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'autocount' LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    const valuesJson = JSON.stringify({ autocount_apiKey: '', autocount_keyId: '', autocount_accountBookId: '' });
    await pool.query(
      'UPDATE client_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?',
      [valuesJson, rows[0].id]
    );
  }
  return { ok: true };
}

/**
 * SQL Account (addonAccount): save Access Key + Secret Key to client_integration (provider=sql).
 * Optional baseUrl, einvoice. Used for AWS Sig v4 with SQL Account API.
 */
async function sqlAccountConnect(email, { accessKey, secretKey, baseUrl, einvoice }) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  if (!accessKey || !secretKey) throw new Error('ACCESS_KEY_AND_SECRET_KEY_REQUIRED');
  const values = {
    sqlaccount_access_key: String(accessKey).trim(),
    sqlaccount_secret_key: String(secretKey).trim()
  };
  if (baseUrl != null && String(baseUrl).trim()) values.sqlaccount_base_url = String(baseUrl).trim().replace(/\/$/, '');
  await upsertClientIntegration(clientId, 'addonAccount', 0, 'sql', values, true, einvoice);
  return { ok: true };
}

/**
 * Get current SQL Account accessKey, secretKey (and baseUrl if set) for the client.
 */
async function getSqlAccountCredentials(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'sql' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return { ok: true, accessKey: '', secretKey: '', baseUrl: '' };
  const raw = rows[0].values_json;
  const v = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  return {
    ok: true,
    accessKey: v.sqlaccount_access_key ?? v.access_key ?? '',
    secretKey: v.sqlaccount_secret_key ?? v.secret_key ?? '',
    baseUrl: v.sqlaccount_base_url ?? v.base_url ?? ''
  };
}

/**
 * SQL Account (addonAccount): disable and clear stored credentials.
 */
async function sqlAccountDisconnect(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT id FROM client_integration WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'sql' LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    const valuesJson = JSON.stringify({ sqlaccount_access_key: '', sqlaccount_secret_key: '', sqlaccount_base_url: '' });
    await pool.query(
      'UPDATE client_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?',
      [valuesJson, rows[0].id]
    );
  }
  return { ok: true };
}

/**
 * Xero (addonAccount): OAuth2. Accepts either { code, redirectUri } to exchange for tokens and save,
 * or { access_token, refresh_token, expires_in, tenant_id } to save directly (e.g. after frontend OAuth).
 */
async function xeroConnect(email, payload) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  if (!payload || typeof payload !== 'object') throw new Error('XERO_PAYLOAD_REQUIRED');

  const code = payload.code;
  const redirectUri = payload.redirectUri || payload.redirect_uri;

  if (code && redirectUri) {
    const axios = require('axios');
    const clientIdEnv = process.env.XERO_CLIENT_ID;
    const clientSecret = process.env.XERO_CLIENT_SECRET;
    if (!clientIdEnv || !clientSecret) throw new Error('XERO_APP_CREDENTIALS_MISSING');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    }).toString();
    const res = await axios.post('https://identity.xero.com/connect/token', body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientIdEnv}:${clientSecret}`).toString('base64')}`
      }
    }).catch(err => {
      const xeroMsg = err.response?.data?.error_description || err.response?.data?.error || err.message;
      if (err.response?.status === 400) console.log('[xero-connect] 400 response', err.response?.data);
      throw new Error(xeroMsg || 'XERO_TOKEN_EXCHANGE_FAILED');
    });
    const data = res.data;
    let tenantId = data.tenant_id || (Array.isArray(data.tenants) && data.tenants[0]?.id) || null;
    if (!tenantId && data.access_token) {
      const connRes = await axios.get('https://api.xero.com/connections', {
        headers: { Authorization: `Bearer ${data.access_token}` }
      }).catch(() => null);
      if (connRes?.data?.[0]?.tenantId) tenantId = connRes.data[0].tenantId;
    }
    if (!tenantId) throw new Error('XERO_TENANT_ID_REQUIRED');
    await upsertClientIntegration(clientId, 'addonAccount', 0, 'xero', {
      xero_access_token: data.access_token,
      xero_refresh_token: data.refresh_token || null,
      xero_expires_at: new Date(Date.now() + (data.expires_in || 1800) * 1000).toISOString(),
      xero_tenant_id: tenantId
    }, true);
    return { ok: true, tenantId };
  }

  const access_token = payload.access_token || payload.accessToken;
  const refresh_token = payload.refresh_token || payload.refreshToken;
  const expires_in = payload.expires_in ?? payload.expiresIn;
  const tenant_id = payload.tenant_id || payload.tenantId;
  if (!access_token || !tenant_id) throw new Error('XERO_ACCESS_TOKEN_AND_TENANT_ID_REQUIRED');
  await upsertClientIntegration(clientId, 'addonAccount', 0, 'xero', {
    xero_access_token: access_token,
    xero_refresh_token: refresh_token || null,
    xero_expires_at: expires_in
      ? new Date(Date.now() + (typeof expires_in === 'number' ? expires_in : 1800) * 1000).toISOString()
      : null,
    xero_tenant_id: tenant_id
  }, true);
  return { ok: true, tenantId: tenant_id };
}

/**
 * Get Xero OAuth2 authorization URL for the client. Redirect user here to start connect flow.
 * @param {string} redirectUri - Must match app config in Xero developer portal
 * @param {string} [state] - Optional state for CSRF
 */
function getXeroAuthUrl(redirectUri, state = '') {
  const clientId = process.env.XERO_CLIENT_ID;
  if (!clientId) throw new Error('XERO_APP_CREDENTIALS_MISSING');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email accounting.transactions accounting.contacts offline_access'
  });
  if (state) params.set('state', state);
  return { url: `https://login.xero.com/identity/connect/authorize?${params.toString()}` };
}

/**
 * Xero (addonAccount): disconnect by setting enabled = 0 for client_integration addonAccount/xero.
 */
async function xeroDisconnect(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT id FROM client_integration WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'xero' LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    await pool.query('UPDATE client_integration SET enabled = 0, updated_at = NOW() WHERE id = ?', [rows[0].id]);
  }
  return { ok: true };
}

/**
 * TTLock: existing = save username/password; create = ensure subuser and save.
 */
async function ttlockConnect(email, { mode, username, password }) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  if (mode === 'existing') {
    if (!username || !password) throw new Error('USERNAME_AND_PASSWORD_REQUIRED');
    const login = String(username).trim();
    await ensureTTLockIntegrationRow(clientId);
    await updateTTLockIntegration(clientId, {
      ttlock_username: login,
      ttlock_password: String(password).trim(),
      ttlock_mode: 'existing'
    });
    await pool.query(
      'UPDATE client_integration SET enabled = 1, updated_at = NOW() WHERE client_id = ? AND `key` = ? AND provider = ?',
      [clientId, 'smartDoor', 'ttlock']
    );
    await pool.query(
      'UPDATE clientdetail SET ttlock_username = ?, ttlock_manual = 1, updated_at = NOW() WHERE id = ?',
      [login, clientId]
    );
    return { ok: true, mode: 'existing' };
  }
  if (mode === 'create') {
    const result = await ensureTTLockSubuser(clientId);
    await updateTTLockIntegration(clientId, { ttlock_mode: 'create' });
    return { ok: true, mode: 'create', username: result.username, created: result.created };
  }
  throw new Error('INVALID_MODE');
}

/**
 * TTLock: disconnect = set enabled = 0 for smartDoor/ttlock. Keep values_json (ttlock_mode, ttlock_username etc.) so after disconnect dropdown can show "Connect old account".
 */
async function ttlockDisconnect(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT id FROM client_integration WHERE client_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    await pool.query('UPDATE client_integration SET enabled = 0, updated_at = NOW() WHERE id = ?', [rows[0].id]);
  }
  return { ok: true };
}

function upsertClientIntegration(clientId, key, slot, provider, valuesMerge, enabled = true, einvoice = null) {
  return pool.query(
    `SELECT id, values_json FROM client_integration WHERE client_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [clientId, key, provider]
  ).then(([rows]) => {
    const existing = rows[0];
    const values = existing?.values_json
      ? { ...(typeof existing.values_json === 'string' ? JSON.parse(existing.values_json) : existing.values_json), ...valuesMerge }
      : valuesMerge;
    const valuesStr = JSON.stringify(values);
    const einvoiceVal = einvoice === true || einvoice === 1 ? 1 : (einvoice === false || einvoice === 0 ? 0 : null);
    if (existing) {
      if (einvoiceVal !== null) {
        return pool.query(
          'UPDATE client_integration SET provider = ?, values_json = ?, enabled = ?, einvoice = ?, updated_at = NOW() WHERE id = ?',
          [provider, valuesStr, enabled ? 1 : 0, einvoiceVal, existing.id]
        );
      }
      return pool.query(
        'UPDATE client_integration SET provider = ?, values_json = ?, enabled = ?, updated_at = NOW() WHERE id = ?',
        [provider, valuesStr, enabled ? 1 : 0, existing.id]
      );
    }
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    return pool.query(
      `INSERT INTO client_integration (id, client_id, \`key\`, version, slot, enabled, provider, values_json, einvoice, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [id, clientId, key, slot, enabled ? 1 : 0, provider, valuesStr, einvoiceVal, now, now]
    );
  });
}

/**
 * Update e-invoice preference for current accounting provider (addonAccount).
 * @param {string} email
 * @param {{ provider: string, einvoice: boolean }} payload - provider: 'bukku'|'xero'|'autocount'|'sql'
 */
async function updateAccountingEinvoice(email, { provider, einvoice }) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  if (!provider || !['bukku', 'xero', 'autocount', 'sql'].includes(provider)) {
    throw new Error('INVALID_PROVIDER');
  }
  const [rows] = await pool.query(
    `SELECT id FROM client_integration WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = ? LIMIT 1`,
    [clientId, provider]
  );
  if (!rows.length) {
    throw new Error('INTEGRATION_NOT_FOUND');
  }
  const val = einvoice === true || einvoice === 1 ? 1 : 0;
  await pool.query(
    'UPDATE client_integration SET einvoice = ?, updated_at = NOW() WHERE id = ?',
    [val, rows[0].id]
  );
  return { ok: true, einvoice: !!val };
}

module.exports = {
  getStaffList,
  createStaff,
  updateStaff,
  getIntegrationTemplate,
  getProfile,
  updateProfile,
  getBanks,
  getAdmin,
  saveAdmin,
  getOnboardStatus,
  stripeDisconnect,
  getStripeConnectOnboardUrl,
  stripeConnectOAuthComplete,
  stripeConnectOAuthCompleteByState,
  cnyiotConnect,
  cnyiotDisconnect,
  getCnyiotCredentials,
  getCnyiotUsers,
  createCnyiotUser,
  getTtlockCredentials,
  bukkuConnect,
  getBukkuCredentials,
  bukkuDisconnect,
  autocountConnect,
  getAutoCountCredentials,
  autocountDisconnect,
  sqlAccountConnect,
  getSqlAccountCredentials,
  sqlAccountDisconnect,
  updateAccountingEinvoice,
  xeroConnect,
  getXeroAuthUrl,
  xeroDisconnect,
  ttlockConnect,
  ttlockDisconnect,
  getEmail,
  requireCtx
};
