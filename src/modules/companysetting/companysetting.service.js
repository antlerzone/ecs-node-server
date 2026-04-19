/**
 * Company Setting – migrated from Wix companysetting page.
 * Uses MySQL: staffdetail, operatordetail, client_profile, client_integration, bankdetail.
 * All functions that need auth take email and resolve via getAccessContextByEmail.
 */

const { randomUUID, createHash } = require('crypto');
const pool = require('../../config/db');
const { getAccessContextByEmail, getAccessContextByEmailAndClient, ACCOUNTING_PLAN_IDS } = require('../access/access.service');
const { getClientUserLimitBreakdown, getClientMaxUserAllowed } = require('../billing/billing.service');
const { ensureMasterAdminUserForClient } = require('../billing/indoor-admin.service');
const { ensureClientCnyiotSubuser, getCnyiotIntegrationAny } = require('../cnyiot/lib/cnyiotSubuser');
const { ensureTTLockSubuser, ensureTTLockIntegrationRow, getTTLockIntegration, updateTTLockIntegration } = require('../ttlock/lib/ttlockSubuser');
const { requestNewToken, saveToken } = require('../ttlock/lib/ttlockToken.service');
const { updatePortalBankFields, updatePortalProfile } = require('../portal-auth/portal-auth.service');
const {
  getPaymentGatewayDirectStatus,
  saveStripeDirectConfig,
  savePayexDirectConfig,
  saveBillplzDirectConfig
} = require('../payment-gateway/payment-gateway.service');

function isStaffdetailProfileBadFieldError(err) {
  return err?.code === 'ER_BAD_FIELD_ERROR' && /staffdetail\\.profile/i.test(String(err.sqlMessage || ''));
}

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

function getApiKeyMeta(values) {
  const key = (values?.api_key ?? values?.apiKey ?? '').toString().trim();
  if (!key) return { hasApiKey: false, apiKeyLast4: null, apiKeyHash: null };
  const hash = createHash('sha256').update(key).digest('hex');
  return {
    hasApiKey: true,
    apiKeyLast4: key.slice(-4),
    apiKeyHash: hash
  };
}

/** True when MySQL rejects SQL referencing profilephoto (column missing on that table). */
function isProfilephotoBadFieldError(err) {
  return err?.code === 'ER_BAD_FIELD_ERROR' && /profilephoto/i.test(String(err.sqlMessage || ''));
}

function getEmail(req) {
  return req?.body?.email ?? req?.query?.email ?? null;
}

/** True when client has account pricing plan and Account/addonAccount integration (bukku/xero/autocount/sql). */
async function clientHasAccountingPlanAndIntegration(clientId) {
  if (!clientId) return false;
  const [[planRow]] = await pool.query(
    'SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const planId = planRow?.plan_id;
  if (!planId || !ACCOUNTING_PLAN_IDS.includes(planId)) return false;
  const [intRows] = await pool.query(
    `SELECT 1 FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  return intRows.length > 0;
}

/** Permission check disabled for now – will re-enable later. */
async function requireCtx(email, _permissionKeys = ['profilesetting', 'usersetting', 'integration', 'admin'], clientIdFromReq = null) {
  let ctx = clientIdFromReq
    ? await getAccessContextByEmailAndClient(email, clientIdFromReq)
    : await getAccessContextByEmail(email);

  // No context yet: try to fix missing master admin (e.g. manualRenew failed before ensureMasterAdminUserForClient).
  if (!ctx?.ok || !ctx?.client?.id) {
    console.log('[companysetting] requireCtx fallback: ctx missing, reason=%s email=%s clientIdFromReq=%s', ctx?.reason || 'none', email || '-', clientIdFromReq || '(none)');
    const reqEmail = email ? String(email).trim().toLowerCase() : '';
    let clientRow = null;
    if (clientIdFromReq) {
      const [[row]] = await pool.query(
        'SELECT id, title, email, status FROM operatordetail WHERE id = ? LIMIT 1',
        [clientIdFromReq]
      );
      clientRow = row;
      console.log('[companysetting] requireCtx fallback client by id: clientRow=%s', clientRow ? `id=${clientRow.id} email=${clientRow.email || '(empty)'} status=${clientRow.status}` : 'null');
      // Requested client does not exist (deleted or stale id from frontend): use context by email so user still gets a valid client
      if (!clientRow && reqEmail) {
        const ctxByEmail = await getAccessContextByEmail(email);
        if (ctxByEmail?.ok && ctxByEmail?.client?.id) {
          ctx = ctxByEmail;
          console.log('[companysetting] requireCtx fallback clientIdFromReq=%s not found, using getAccessContextByEmail clientId=%s', clientIdFromReq, ctx.client.id);
        }
      }
    }
    if (!clientIdFromReq) {
      // No clientId in request: find client whose company email is this user (include status=0 so we fix clients created by manualRenew that never got status=1)
      const [rows] = await pool.query(
        'SELECT id, title, email, status FROM operatordetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [reqEmail]
      );
      clientRow = rows[0] || null;
      console.log('[companysetting] requireCtx fallback client by email: clientRow=%s', clientRow ? `id=${clientRow.id} email=${clientRow.email || '(empty)'}` : 'null');
    }
    const clientEmailNorm = clientRow?.email ? String(clientRow.email).trim().toLowerCase() : '';
    const emailMatch = reqEmail && (clientEmailNorm === reqEmail);
    // When clientIdFromReq: allow if email matches or client has no company email yet (new client from manualRenew).
    const mayFix = clientRow && reqEmail && (emailMatch || (clientIdFromReq && !clientEmailNorm));
    console.log('[companysetting] requireCtx fallback emailMatch=%s mayFix=%s (clientEmailNorm=%s)', emailMatch, mayFix, clientEmailNorm || '(empty)');
    if (mayFix) {
      try {
        if (clientIdFromReq && !clientEmailNorm) {
          console.log('[companysetting] requireCtx fallback setting operatordetail.email=%s for clientId=%s', email.trim(), clientRow.id);
          await pool.query('UPDATE operatordetail SET email = ?, updated_at = NOW() WHERE id = ?', [email.trim(), clientRow.id]);
          clientRow = { ...clientRow, email: email.trim() };
        }
        console.log('[companysetting] requireCtx fallback calling ensureMasterAdminUserForClient clientId=%s', clientRow.id);
        await ensureMasterAdminUserForClient(clientRow.id);
        if (clientRow.status !== 1 && clientRow.status !== true) {
          await pool.query('UPDATE operatordetail SET status = 1, updated_at = NOW() WHERE id = ?', [clientRow.id]);
        }
        ctx = clientIdFromReq
          ? await getAccessContextByEmailAndClient(email, clientRow.id)
          : await getAccessContextByEmail(email);
        console.log('[companysetting] requireCtx fallback after fix ctx.ok=%s ctx.client?.id=%s', !!ctx?.ok, ctx?.client?.id || '(none)');
      } catch (e) {
        console.warn('[companysetting] requireCtx fallback ensureMasterAdminUserForClient failed', e?.message);
      }
    } else {
      console.log('[companysetting] requireCtx fallback mayFix=false, skip ensureMasterAdminUserForClient');
    }
    // If still no ctx and we had clientIdFromReq: allow SaaS admin to act as that client.
    if ((!ctx?.ok || !ctx?.client?.id) && clientIdFromReq && clientRow && (clientRow.status === 1 || clientRow.status === true)) {
      const byEmail = await getAccessContextByEmail(email);
      if (byEmail?.ok && byEmail?.isSaasAdmin) {
        ctx = { ok: true, client: { id: clientRow.id, title: clientRow.title }, staff: null, isSaasAdmin: true };
        console.log('[companysetting] requireCtx fallback using SaaS admin as client ctx clientId=%s', clientRow.id);
      }
    }
    // Last resort: requested client id not in DB (clientRow=null), use any valid context by email so operator can open Company Settings
    if ((!ctx?.ok || !ctx?.client?.id) && reqEmail) {
      const ctxByEmail = await getAccessContextByEmail(email);
      if (ctxByEmail?.ok && ctxByEmail?.client?.id) {
        ctx = ctxByEmail;
        console.log('[companysetting] requireCtx fallback last resort: using getAccessContextByEmail clientId=%s', ctx.client.id);
      }
    }
  }

  if (!ctx?.ok) {
    console.log('[companysetting] requireCtx THROW reason=%s (email=%s clientIdFromReq=%s)', ctx?.reason || 'ACCESS_DENIED', email || '-', clientIdFromReq || '(none)');
    throw new Error(ctx?.reason || 'ACCESS_DENIED');
  }
  const clientId = ctx.client?.id;
  if (!clientId) throw new Error('NO_CLIENT_ID');
  const staff = ctx.staff || {};
  return { ctx, clientId, staffId: staff.id };
}

/**
 * User list for current client (Company Setting – operator users; limit by pricing plan).
 * Uses client_user table. If no rows, returns a default master user from operatordetail so the list is never empty.
 */
async function getStaffList(email, clientIdFromReq) {
  const ALL_PERMISSION_KEYS = ['profilesetting', 'usersetting', 'integration', 'billing', 'finance', 'tenantdetail', 'propertylisting', 'marketing', 'booking', 'admin'];
  try {
    const { clientId } = await requireCtx(email, ['usersetting', 'admin'], clientIdFromReq);
    const [clientRows] = await pool.query(
      'SELECT id, title, email FROM operatordetail WHERE id = ? LIMIT 1',
      [clientId]
    );
    const client = clientRows[0] || {};
    const mainAdminEmail = (client.email && String(client.email).trim())
      ? String(client.email).trim().toLowerCase()
      : '';

    let rows = [];
    try {
      const [userRows] = await pool.query(
        'SELECT id, name, email, is_admin, permission_json, status FROM client_user WHERE client_id = ? ORDER BY is_admin DESC, name',
        [clientId]
      );
      rows = userRows || [];
    } catch (err) {
      console.warn('[companysetting] getStaffList client_user query failed', err?.message || err);
    }

    const list = rows.map(r => {
      const isAdmin = r.is_admin === 1 || r.is_admin === true;
      const rawPerm = parseJson(r.permission_json);
      const permission = isAdmin ? ALL_PERMISSION_KEYS : (Array.isArray(rawPerm) ? rawPerm : []);
      return {
        _id: r.id,
        id: r.id,
        name: r.name || '',
        email: r.email || '',
        salary: '',
        bankAccount: '',
        bankName: null,
        permission,
        status: r.status === 1 || r.status === true,
        profile: null,
        is_admin: isAdmin
      };
    });

    if (list.length === 0 && (client.id || clientId)) {
      list.push({
        _id: clientId,
        id: clientId,
        name: (client.title && String(client.title).trim()) || 'Master',
        email: (client.email && String(client.email).trim()) || '',
        salary: '',
        bankAccount: '',
        bankName: null,
        permission: ALL_PERMISSION_KEYS,
        status: true,
        profile: null,
        is_admin: true
      });
    }

    const userLimit = await getClientUserLimitBreakdown(clientId);
    const maxStaffAllowed = userLimit.maxTotal;
    return { ok: true, items: list, mainAdminEmail, maxStaffAllowed, userLimit };
  } catch (err) {
    console.warn('[companysetting] getStaffList', err?.message || err);
    return {
      ok: true,
      items: [],
      mainAdminEmail: '',
      maxStaffAllowed: 1,
      userLimit: { planId: null, planIncluded: 1, extraUserAddon: 0, maxTotal: 1 }
    };
  }
}

/**
 * One email can only represent one company (cannot be user/main-admin of another).
 * Returns true if this email is already bound to another company (client_user or operatordetail).
 */
async function isEmailBoundToOtherCompany(normalizedEmail, excludeUserId = null, excludeClientId = null) {
  if (!normalizedEmail) return false;
  const [userRows] = await pool.query(
    'SELECT id, client_id FROM client_user WHERE LOWER(TRIM(email)) = ? LIMIT 2',
    [normalizedEmail]
  );
  for (const r of userRows) {
    if (excludeUserId && r.id === excludeUserId) continue;
    if (excludeClientId && r.client_id === excludeClientId) continue;
    return true;
  }
  const [clientRows] = await pool.query(
    'SELECT id FROM operatordetail WHERE LOWER(TRIM(email)) = ? LIMIT 2',
    [normalizedEmail]
  );
  for (const r of clientRows) {
    if (excludeClientId && r.id === excludeClientId) continue;
    return true;
  }
  return false;
}

/**
 * Create user (Company Setting – operator user; no accounting sync).
 * Enforces: one email = one company; limit by pricing plan user count.
 */
async function createStaff(email, payload) {
  const { clientId } = await requireCtx(email, ['usersetting', 'admin']);
  const maxUserAllowed = await getClientMaxUserAllowed(clientId);
  const [[countRow]] = await pool.query('SELECT COUNT(*) AS c FROM client_user WHERE client_id = ?', [clientId]);
  const currentCount = Number(countRow?.c ?? 0) || 0;
  if (currentCount >= maxUserAllowed) {
    throw new Error('STAFF_LIMIT_REACHED');
  }
  const id = randomUUID();
  const name = (payload.name || '').trim();
  const emailVal = (payload.staffEmail || payload.email || '').trim().toLowerCase();
  if (emailVal) {
    const bound = await isEmailBoundToOtherCompany(emailVal, null, clientId);
    if (bound) throw new Error('EMAIL_ALREADY_BOUND_TO_ANOTHER_COMPANY');
    const [[existing]] = await pool.query(
      'SELECT 1 FROM client_user WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
      [clientId, emailVal]
    );
    if (existing) throw new Error('EMAIL_ALREADY_ADDED');
  }
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
    `INSERT INTO client_user (id, client_id, email, name, is_admin, permission_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, 1, ?, ?)`,
    [id, clientId, emailVal, name || emailVal.split('@')[0] || 'User', permission, now, now]
  );
  return { ok: true, staff: { _id: id, id } };
}

/**
 * Update user (Company Setting) by id. Main admin (is_admin=1) cannot be edited.
 */
async function updateStaff(email, staffId, payload) {
  const { clientId } = await requireCtx(email, ['usersetting', 'admin']);
  const [existing] = await pool.query(
    'SELECT id, is_admin, email FROM client_user WHERE id = ? AND client_id = ? LIMIT 1',
    [staffId, clientId]
  );
  if (!existing.length) throw new Error('STAFF_NOT_FOUND');
  const existingRow = existing[0];
  const isMainAccount = existingRow.is_admin === 1 || existingRow.is_admin === true;
  const existingEmail = String(existingRow.email || '').trim().toLowerCase();

  const hasName = Object.prototype.hasOwnProperty.call(payload, 'name');
  const hasEmail = Object.prototype.hasOwnProperty.call(payload, 'email');
  const hasStaffEmail = Object.prototype.hasOwnProperty.call(payload, 'staffEmail');
  const hasPermission = Object.prototype.hasOwnProperty.call(payload, 'permission');
  const hasStatus = Object.prototype.hasOwnProperty.call(payload, 'status');

  const name = hasName ? String(payload.name ?? '').trim() : undefined;
  let emailVal = (hasEmail || hasStaffEmail)
    ? String((payload.staffEmail ?? payload.email ?? '')).trim().toLowerCase()
    : undefined;
  // Treat empty string as "not updating"
  if (emailVal !== undefined && emailVal === '') emailVal = undefined;

  const willChangeEmail = !isMainAccount
    && (hasEmail || hasStaffEmail)
    && emailVal !== undefined
    && emailVal !== existingEmail;

  // Main account: freeze email only.
  // Ignore permission/status updates silently (do NOT throw), so user can still update other personal fields.
  if (isMainAccount) {
    const hasExistingEmail = !!existingEmail;
    const attemptedEmailChange =
      hasEmail && emailVal !== undefined && (!hasExistingEmail || emailVal !== existingEmail);

    // If we can confidently compare, only throw when it actually tries to change.
    // If DB email is empty, we treat it as "cannot update anyway" and just freeze.
    if (hasExistingEmail && attemptedEmailChange) throw new Error('MAIN_ACCOUNT_CANNOT_EDIT');

    // Freeze email: never update it.
    emailVal = undefined;

    // Freeze role-related fields: ignore updates.
    if (hasPermission) payload.permission = undefined;
    if (hasStatus) payload.status = undefined;
  }

  if (emailVal !== undefined) {
    const bound = await isEmailBoundToOtherCompany(emailVal, staffId, clientId);
    if (bound) throw new Error('EMAIL_ALREADY_BOUND_TO_ANOTHER_COMPANY');
  }

  let permission = payload.permission;
  if (permission !== undefined) {
    if (Array.isArray(permission)) {
      permission = JSON.stringify(permission);
    } else if (permission && typeof permission === 'object') {
      permission = JSON.stringify(Object.keys(permission).filter(k => permission[k]));
    }
  }
  const updates = [];
  const params = [];
  if (name !== undefined && name !== '') { updates.push('name = ?'); params.push(name); }
  if (emailVal !== undefined) { updates.push('email = ?'); params.push(emailVal); }
  if (permission !== undefined) { updates.push('permission_json = ?'); params.push(permission); }
  if (payload.status !== undefined) {
    updates.push('status = ?');
    params.push(payload.status ? 1 : 0);
  }
  // Even when client_user fields are unchanged, we still need to run portal sync
  // (operator/profile updates phone/address/nric/bank via portal_account + tenant/staff/owner).
  if (updates.length !== 0) {
    params.push(staffId);
    await pool.query(
      `UPDATE client_user SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );
  }

  // Portal profile sync: keep operator/company "staff detail" consistent for templates & portal.
  // We only sync when email is NOT being changed (updatePortalProfile doesn't support email changes).
  if (!willChangeEmail) {
    const profile = payload.profile && typeof payload.profile === 'object' ? payload.profile : null;
    const profileTaxIdNo = profile
      ? (profile.tax_id_no ?? profile.taxIdNo ?? profile.tax_id_no_val ?? profile.taxId)
      : undefined;
    const portalFullname =
      payload.fullname ?? name;

    const portalPayload = {
      fullname: portalFullname,
      phone: payload.phone ?? payload.mobileNumber ?? payload.mobile_number ?? payload.staffcontact ?? undefined,
      address: payload.address ?? payload.addr ?? payload.full_address ?? undefined,
      nric: payload.nric ?? payload.usernric ?? payload.tax_id_no ?? payload.taxIdNo ?? profileTaxIdNo ?? undefined,
      // Identity document fields: keep them in portal_account and then sync to tenant/owner/staff.
      entity_type: profile?.entity_type ?? profile?.entityType ?? undefined,
      reg_no_type: profile?.reg_no_type ?? profile?.regNoType ?? profile?.reg_no_type_val ?? undefined,
      id_type: profile?.reg_no_type ?? profile?.regNoType ?? profile?.reg_no_type_val ?? undefined,
      tax_id_no: profileTaxIdNo ?? undefined,
      nricfront: payload.nricfront ?? payload.nricFront ?? payload.nric_front ?? undefined,
      nricback: payload.nricback ?? payload.nricBack ?? payload.nric_back ?? undefined,
      bankname_id: payload.bankname_id ?? payload.bankNameId ?? payload.bankId ?? undefined,
      bankaccount: payload.bankaccount ?? payload.bankAccount ?? payload.bank_account ?? undefined,
      accountholder: payload.accountholder ?? payload.accountHolder ?? payload.account_holder ?? undefined,
    };

    const debug = {
      fullnameLen: portalPayload.fullname ? String(portalPayload.fullname).trim().length : 0,
      phoneLast4: portalPayload.phone ? String(portalPayload.phone).trim().slice(-4) : null,
      addressLen: portalPayload.address ? String(portalPayload.address).trim().length : 0,
      nricLast4: portalPayload.nric ? String(portalPayload.nric).trim().slice(-4) : null,
    };
    console.log('[companysetting] staff-update portal sync', { existingEmail, debug });

    const syncRes = await updatePortalProfile(existingEmail, portalPayload);
    if (!syncRes.ok) {
      throw new Error(syncRes.reason || 'SYNC_FAILED');
    }

    // Also store identity document fields into staffdetail.profile (if provided).
    if (profile) {
      const nextProfile = {
        entity_type: profile.entity_type ?? profile.entityType ?? undefined,
        reg_no_type: profile.reg_no_type ?? profile.regNoType ?? undefined,
        tax_id_no: profileTaxIdNo ?? undefined,
      };
      if (nextProfile.tax_id_no != null || nextProfile.reg_no_type != null || nextProfile.entity_type != null) {
        const profileJson = JSON.stringify(nextProfile);
        try {
          await pool.query(
            'UPDATE staffdetail SET profile = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
            [profileJson, existingEmail]
          );
        } catch (e) {
          if (!isStaffdetailProfileBadFieldError(e)) {
            throw e;
          }
        }
      }
    }
  }

  return { ok: true };
}

/**
 * Remove a non–main-account user from Company Setting (deletes client_user row).
 * Main admin (is_admin=1) cannot be deleted; caller cannot delete their own row.
 */
async function deleteStaff(email, staffId, clientIdFromReq) {
  const { clientId, staffId: operatorStaffId } = await requireCtx(email, ['usersetting', 'admin'], clientIdFromReq);
  if (!staffId) throw new Error('NO_STAFF_ID');
  if (operatorStaffId && staffId === operatorStaffId) {
    throw new Error('CANNOT_DELETE_SELF');
  }
  const [existing] = await pool.query(
    'SELECT id, is_admin FROM client_user WHERE id = ? AND client_id = ? LIMIT 1',
    [staffId, clientId]
  );
  if (!existing.length) throw new Error('STAFF_NOT_FOUND');
  const row = existing[0];
  if (row.is_admin === 1 || row.is_admin === true) {
    throw new Error('MAIN_ACCOUNT_CANNOT_DELETE');
  }
  await pool.query('DELETE FROM client_user WHERE id = ? AND client_id = ?', [staffId, clientId]);
  return { ok: true };
}

/**
 * Operator personal profile photo (avatar) — stored on client_user / staffdetail, NOT operatordetail.profilephoto (company logo).
 * @param {string} email
 * @param {string|null|undefined} profilephotoUrl
 * @param {string|null} [clientIdFromReq]
 */
async function updateOperatorProfilePhoto(email, profilephotoUrl, clientIdFromReq = null) {
  const ctx = clientIdFromReq
    ? await getAccessContextByEmailAndClient(email, clientIdFromReq)
    : await getAccessContextByEmail(email);
  if (!ctx?.ok || !ctx?.staff?.id) {
    throw new Error('NO_STAFF');
  }
  const url = profilephotoUrl != null ? String(profilephotoUrl).trim() : '';
  const val = url || null;
  const staffId = ctx.staff.id;
  try {
    if (ctx.staffDetailId) {
      await pool.query(
        'UPDATE staffdetail SET profilephoto = ?, updated_at = NOW() WHERE id = ?',
        [val, staffId]
      );
    } else {
      await pool.query(
        'UPDATE client_user SET profilephoto = ?, updated_at = NOW() WHERE id = ?',
        [val, staffId]
      );
    }
  } catch (e) {
    if (isProfilephotoBadFieldError(e)) {
      throw new Error('PROFILEPHOTO_MIGRATION_REQUIRED');
    }
    throw e;
  }

  // Keep portal_account as single source of avatar.
  try {
    const syncRes = await updatePortalProfile(email, { avatar_url: val });
    if (!syncRes.ok) {
      // Avatar already saved locally; portal sync might fail if portal_account columns not ready.
      console.warn('[companysetting] operator avatar portal sync failed:', syncRes.reason || syncRes);
    }
  } catch (e) {
    console.warn('[companysetting] operator avatar portal sync exception:', e?.message || e);
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
      version: 4,
      multiProvider: false,
      providers: ['stripe', 'payex', 'billplz'],
      fields: [
        { key: 'provider', label: 'Provider', type: 'dropdown', options: [{ label: 'Stripe', value: 'stripe' }, { label: 'Xendit', value: 'payex' }, { label: 'Billplz', value: 'billplz' }] },
        { key: 'stripe_secretKey', label: 'Stripe Secret Key', type: 'input', provider: 'stripe' },
        { key: 'stripe_webhookSecret', label: 'Stripe Webhook Secret', type: 'input', provider: 'stripe' },
        { key: 'xendit_sub_account_id', label: 'Xendit Sub-account ID (Platform flow)', type: 'input', provider: 'payex' },
        { key: 'xendit_test_secret_key', label: 'Xendit Secret Key (Test)', type: 'input', provider: 'payex' },
        { key: 'xendit_live_secret_key', label: 'Xendit Secret Key (Live)', type: 'input', provider: 'payex' },
        { key: 'xendit_use_test', label: 'Use test mode', type: 'checkbox', provider: 'payex' },
        { key: 'billplz_api_key', label: 'Billplz API Key', type: 'input', provider: 'billplz' },
        { key: 'billplz_collection_id', label: 'Billplz Collection ID', type: 'input', provider: 'billplz' },
        { key: 'billplz_x_signature_key', label: 'Billplz X Signature Key', type: 'input', provider: 'billplz' }
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
      providers: ['bukku', 'xero'],
      fields: [
        { key: 'provider', label: 'Provider', type: 'dropdown', options: [{ label: 'Bukku', value: 'bukku' }, { label: 'Xero', value: 'xero' }] },
        { key: 'bukku_secretKey', label: 'Bukku Secret Key', type: 'input', provider: 'bukku' },
        { key: 'bukku_subdomain', label: 'Bukku Subdomain', type: 'input', provider: 'bukku' },
        { key: 'xero_secretKey', label: 'Xero Secret Key', type: 'input', provider: 'xero' },
        { key: 'xero_subdomain', label: 'Xero Subdomain', type: 'input', provider: 'xero' }
      ]
    }
  ];
}

/**
 * Get profile (company profile section): operatordetail + client_profile.
 * @param {string} email
 * @param {string} [clientIdFromReq] - when provided (e.g. operator selects client), use for access context
 */
async function getProfile(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['profilesetting', 'admin'], clientIdFromReq);
  let clientRows;
  try {
    [clientRows] = await pool.query(
      'SELECT id, title, currency, profilephoto, subdomain, profile AS profile_json FROM operatordetail WHERE id = ? LIMIT 1',
      [clientId]
    );
  } catch (e) {
    if (isProfilephotoBadFieldError(e)) {
      console.warn('[companysetting] getProfile: operatordetail.profilephoto missing — retry without column');
      [clientRows] = await pool.query(
        'SELECT id, title, currency, subdomain, profile AS profile_json FROM operatordetail WHERE id = ? LIMIT 1',
        [clientId]
      );
      clientRows = clientRows.map((r) => ({ ...r, profilephoto: null }));
    } else {
      throw e;
    }
  }
  if (!clientRows.length) throw new Error('CLIENT_NOT_FOUND');
  const client = clientRows[0];
  const [profileRows] = await pool.query(
    'SELECT ssm, uen, address, contact, subdomain, tin, accountholder, accountnumber, bank_id, company_chop FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  let profile = profileRows[0] || {};
  // Fallback: client_profile may be empty if data only in operatordetail.profile (Wix JSON)
  if (!profile.ssm && !profile.contact && client.profile_json) {
    const arr = parseJson(client.profile_json);
    if (Array.isArray(arr) && arr.length > 0) {
      const p = arr[0];
      profile = {
        ssm: p.ssm || '',
        uen: p.uen || '',
        address: p.address || '',
        contact: p.contact || '',
        subdomain: p.subdomain || '',
        tin: p.tin || '',
        accountholder: p.accountHolder || p.accountholder || '',
        accountnumber: p.accountNumber || p.accountnumber || '',
        bank_id: p.bankId || null,
        company_chop: p.companyChop || ''
      };
    }
  }
  return {
    ok: true,
    client: {
      id: client.id,
      title: client.title,
      currency: client.currency,
      // Company logo / branding (not operator personal avatar — see client_user.profilephoto)
      profilephoto: client.profilephoto,
      subdomain: client.subdomain || profile.subdomain
    },
    profile: {
      ssm: profile.ssm || '',
      uen: (profile.uen != null ? profile.uen : '') || '',
      address: profile.address || '',
      contact: profile.contact || '',
      subdomain: profile.subdomain || '',
      tin: profile.tin || '',
      accountholder: profile.accountholder || '',
      accountnumber: profile.accountnumber || '',
      bankId: profile.bank_id || null,
      companyChop: profile.company_chop || '',
      paynowQr: '', // UEN-only; paynow_qr column optional
    }
  };
}

/**
 * Update company profile (operatordetail + client_profile).
 * @param {string} email
 * @param {object} payload
 * @param {string} [clientIdFromReq] - when provided (e.g. operator selects client), use for access context
 */
async function updateProfile(email, payload, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['profilesetting', 'admin'], clientIdFromReq);
  const [clientRows] = await pool.query('SELECT id, currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!clientRows.length) throw new Error('CLIENT_NOT_FOUND');
  const existingCurrencyRaw = clientRows[0].currency;
  if (existingCurrencyRaw == null || String(existingCurrencyRaw).trim() === '') {
    throw new Error('CLIENT_CURRENCY_MISSING');
  }
  const existingCurrency = String(existingCurrencyRaw).trim().toUpperCase();

  const title = (payload.title || '').trim();
  const profilephoto = payload.profilephoto != null ? payload.profilephoto : undefined;
  // currency is not updatable here: only set at registration or by admin
  const updateOperatordetailRow = async (includeLogoCol) => {
    const withPhoto = includeLogoCol && profilephoto !== undefined;
    await pool.query(
      'UPDATE operatordetail SET title = ?, currency = ?, updated_at = NOW()' + (withPhoto ? ', profilephoto = ?' : '') + ' WHERE id = ?',
      withPhoto ? [title, existingCurrency, profilephoto, clientId] : [title, existingCurrency, clientId]
    );
  };
  try {
    await updateOperatordetailRow(true);
  } catch (e) {
    if (isProfilephotoBadFieldError(e) && profilephoto !== undefined) {
      console.warn('[companysetting] updateProfile: operatordetail.profilephoto missing — saved without logo URL');
      await updateOperatordetailRow(false);
    } else {
      throw e;
    }
  }

  const [profileRows] = await pool.query('SELECT id FROM client_profile WHERE client_id = ? LIMIT 1', [clientId]);
  const ssm = (payload.ssm || '').trim();
  const uen = (payload.uen != null ? String(payload.uen).trim() : null);
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
    if (uen !== null) {
      updates.push('uen = ?');
      params.push(uen || null);
    }
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
      `INSERT INTO client_profile (id, client_id, ssm, address, contact, subdomain, tin, accountholder, accountnumber, bank_id, company_chop, uen, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [profileId, clientId, ssm, address, contact, subdomain, tin, accountholder, accountnumber, bankId, (companyChop !== undefined && companyChop) ? companyChop : null, uen || null, now, now]
    );
  }

  // New client first save: auto-create CNYIOT connect (platform only).
  // TTLock now uses the operator's own account and is connected manually from the portal.
  const contactVal = (contact || '').trim();
  const subdomainVal = (subdomain || '').trim().toLowerCase();
  if (contactVal && subdomainVal) {
    try {
      const cnyiotAny = await getCnyiotIntegrationAny(clientId);
      if (!cnyiotAny?.values?.cnyiot_subuser_ever_created && !cnyiotAny?.values?.cnyiot_subuser_id) {
        await upsertClientIntegration(clientId, 'meter', 0, 'cnyiot', {}, true);
        await ensureClientCnyiotSubuser(clientId, { tel: contactVal });
        await upsertClientIntegration(clientId, 'meter', 0, 'cnyiot', { cnyiot_mode: 'create' }, true);
        console.log('[companysetting] updateProfile auto cnyiot connect done clientId=%s', clientId);
      }
    } catch (e) {
      console.warn('[companysetting] updateProfile auto cnyiot connect', e?.message);
    }
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
 * Operator My Profile: bank fields from portal_account (same bankdetail id as Company Settings / Contact).
 */
async function getOperatorBankDetails(email, clientIdFromReq = null) {
  const ctx = clientIdFromReq
    ? await getAccessContextByEmailAndClient(email, clientIdFromReq)
    : await getAccessContextByEmail(email);
  if (!ctx?.ok) {
    throw new Error(ctx?.reason || 'ACCESS_DENIED');
  }
  const normalized = String(email).trim().toLowerCase();
  const [rows] = await pool.query(
    'SELECT bankname_id, bankaccount, accountholder FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  const r = rows[0] || {};
  return {
    ok: true,
    bankId: r.bankname_id || null,
    bankaccount: r.bankaccount || '',
    accountholder: r.accountholder || ''
  };
}

/**
 * Save operator bank (portal_account + sync staffdetail etc.). bankId = bankdetail.id UUID.
 */
async function saveOperatorBankDetails(email, payload, clientIdFromReq = null) {
  const ctx = clientIdFromReq
    ? await getAccessContextByEmailAndClient(email, clientIdFromReq)
    : await getAccessContextByEmail(email);
  if (!ctx?.ok) {
    throw new Error(ctx?.reason || 'ACCESS_DENIED');
  }
  const bankId = payload?.bankId != null && payload.bankId !== '' ? String(payload.bankId) : null;
  const bankaccount = payload?.bankaccount != null ? String(payload.bankaccount) : '';
  const accountholder = payload?.accountholder != null ? String(payload.accountholder) : '';
  const result = await updatePortalBankFields(email, {
    bankname_id: bankId,
    bankaccount,
    accountholder
  });
  if (!result.ok) {
    throw new Error(result.reason || 'SAVE_FAILED');
  }
  return { ok: true };
}

/**
 * Get admin detail (operatordetail.admin JSON).
 * @param {string} email
 * @param {string} [clientIdFromReq] - when provided (e.g. operator selects client), use for access context
 */
async function getAdmin(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['admin'], clientIdFromReq);
  const [rows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) return { ok: true, admin: null };
  let admin = parseJson(rows[0].admin);
  // Wix/legacy may store admin as array; use first element
  if (Array.isArray(admin) && admin.length > 0) admin = admin[0];
  return { ok: true, admin: admin || null };
}

/**
 * Save admin detail (operatordetail.admin JSON).
 * @param {string} email
 * @param {object} admin
 * @param {string} [clientIdFromReq] - when provided (e.g. operator selects client), use for access context
 */
async function saveAdmin(email, admin, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['admin'], clientIdFromReq);
  const json = typeof admin === 'object' ? JSON.stringify(admin) : (admin || '{}');
  await pool.query('UPDATE operatordetail SET admin = ?, updated_at = NOW() WHERE id = ?', [json, clientId]);
  return { ok: true };
}

async function getDirectPaymentGatewayStatus(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const stripe = await getPaymentGatewayDirectStatus(clientId, 'stripe');
  const payex = await getPaymentGatewayDirectStatus(clientId, 'payex');
  const billplz = await getPaymentGatewayDirectStatus(clientId, 'billplz');
  return { ok: true, stripe, payex, billplz };
}

async function saveDirectStripePaymentGateway(email, payload = {}, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const res = await saveStripeDirectConfig(clientId, {
    webhookSecret: payload.webhookSecret ?? payload.stripe_webhook_secret ?? payload.stripe_webhookSecret,
    webhookUrl: payload.webhookUrl ?? payload.stripe_webhook_url,
    allowPaynowWithGateway: payload.allow_paynow_with_gateway,
    mode: 'oauth_webhook'
  });
  return { ok: true, provider: 'stripe', ...res };
}

async function saveDirectPayexPaymentGateway(email, payload = {}, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const rawSecret = payload.secretKey
    ?? payload.xendit_secret_key
    ?? payload.xendit_live_secret_key
    ?? payload.xendit_test_secret_key;
  const res = await savePayexDirectConfig(clientId, {
    secretKey: rawSecret,
    webhookToken: payload.webhookToken ?? payload.xendit_webhook_token ?? payload.x_callback_token,
    webhookUrl: payload.webhookUrl ?? payload.xendit_webhook_url,
    useTest: payload.useTest ?? payload.xendit_use_test
  });
  return { ok: true, provider: 'payex', ...res };
}

async function saveDirectBillplzPaymentGateway(email, payload = {}, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const [rows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const currency = rows.length ? String(rows[0].currency || '').trim().toUpperCase() : '';
  if (currency !== 'MYR') throw new Error('BILLPLZ_MYR_ONLY');
  const res = await saveBillplzDirectConfig(clientId, {
    apiKey: payload.apiKey ?? payload.billplz_api_key,
    collectionId: payload.collectionId ?? payload.billplz_collection_id,
    xSignatureKey: payload.xSignatureKey ?? payload.billplz_x_signature_key,
    webhookUrl: payload.webhookUrl ?? payload.billplz_webhook_url,
    paymentOrderCallbackUrl: payload.paymentOrderCallbackUrl ?? payload.billplz_payment_order_callback_url,
    paymentGatewayCode: payload.paymentGatewayCode ?? payload.billplz_payment_gateway_code,
    useSandbox: payload.useSandbox ?? payload.billplz_use_sandbox
  });
  return { ok: true, provider: 'billplz', ...res };
}

async function triggerDirectStripeWebhookTest(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const { triggerStripeWebhookTest } = require('../stripe/stripe.service');
  const result = await triggerStripeWebhookTest(clientId);
  return { ok: true, provider: 'stripe', ...result };
}

/**
 * Onboard connection status for Integration section buttons.
 * cnyiotCreateEverUsed / ttlockCreateEverUsed: when true, frontend should hide "Create account" and only show "Existing" (disconnect = only break mapping).
 * @param {string} email
 * @param {string} [clientIdFromReq] - when provided (e.g. operator selects client), use for access context
 * @returns {Promise<{ ok: boolean, stripeConnected, cnyiotConnected, cnyiotCreateEverUsed, accountingConnected, accountingProvider, accountingEinvoice, ttlockConnected, ttlockCreateEverUsed, googleDriveConnected?, googleDriveEmail?, operatorCompanyEmail? }>}
 */
async function getOnboardStatus(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const stripeGatewayStatus = await getPaymentGatewayDirectStatus(clientId, 'stripe');
  const payexGatewayStatus = await getPaymentGatewayDirectStatus(clientId, 'payex');
  const billplzGatewayStatus = await getPaymentGatewayDirectStatus(clientId, 'billplz');
  const stripeConnected = !!stripeGatewayStatus.connected;
  const stripeConnectedAccountId = stripeGatewayStatus.mode === 'legacy_connect' && stripeConnected
    ? 'legacy_connect'
    : (stripeGatewayStatus.accountId || null);

  const [intRows] = await pool.query(
    `SELECT \`key\`, provider, enabled, einvoice, values_json FROM client_integration WHERE client_id = ? AND (( \`key\` = 'meter' AND provider = 'cnyiot' ) OR ( \`key\` = 'addonAccount' ) OR ( \`key\` = 'smartDoor' AND provider = 'ttlock' ) OR ( \`key\` = 'paymentGateway' ) OR ( \`key\` = 'aiProvider' ) OR ( \`key\` = 'bankData' AND provider = 'finverse' ) OR ( \`key\` = 'storage' AND provider = 'google_drive' ))`,
    [clientId]
  );
  let aiProviderName = null;
  let aiProviderHasApiKey = false;
  let bankReconcileConnected = false;
  let finverseHasCreds = false;
  let cnyiotConnected = false;
  let cnyiotCreateEverUsed = false;
  let cnyiotDisconnectedWithMode = null; // 'create' | 'existing' when disconnected
  let accountingConnected = false;
  let accountingProvider = null;
  let accountingEinvoice = false;
  let ttlockConnected = false;
  let ttlockCreateEverUsed = false;
  let ttlockDisconnectedWithMode = null; // 'create' | 'existing' when disconnected (had sub-account or own account)
  let paymentGatewayProvider = null; // enabled row provider
  let sgPaynowEnabledWithGateway = true;
  let payexHasSubAccount = false;
  let payexSubAccountEverCreated = false; // once true: after disconnect only "Connect sub account" allowed
  let googleDriveConnected = false;
  let googleDriveEmail = null;
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
    if (r.key === 'paymentGateway') {
      if (r.enabled === 1) {
        paymentGatewayProvider = (r.provider || '').toString().toLowerCase();
        if (!['stripe', 'payex', 'paynow', 'billplz'].includes(paymentGatewayProvider)) paymentGatewayProvider = 'stripe';
        if ((paymentGatewayProvider === 'stripe' || paymentGatewayProvider === 'payex') && values.allow_paynow_with_gateway === false) {
          sgPaynowEnabledWithGateway = false;
        }
        if (r.provider === 'payex' && values.xendit_sub_account_id) payexHasSubAccount = true;
      }
      if (r.provider === 'payex' && values.xendit_sub_account_ever_created) payexSubAccountEverCreated = true;
    }
    if (r.key === 'aiProvider' && r.enabled === 1) {
      aiProviderName = (r.provider || '').toString().toLowerCase() || null;
      aiProviderHasApiKey = !!(values.api_key || values.apiKey);
    }
    if (r.key === 'bankData' && r.provider === 'finverse' && r.enabled === 1) {
      finverseHasCreds = !!(values.finverse_client_id || values.finverse_client_secret);
      bankReconcileConnected = !!(values.finverse_login_identity_token);
    }
    if (r.key === 'storage' && r.provider === 'google_drive' && r.enabled === 1) {
      googleDriveConnected = true;
      googleDriveEmail = values.google_email ? String(values.google_email) : null;
    }
  }
  if (!finverseHasCreds && process.env.FINVERSE_CLIENT_ID) finverseHasCreds = true;
  const payex = require('../payex/payex.service');
  const payexPlatformMode = payex.isPlatformModeEnabled();
  const payexConfigured = payexGatewayStatus.connected;
  const [clientRows] = await pool.query('SELECT currency, email FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const clientCurrency = clientRows.length ? String(clientRows[0].currency || '').trim().toUpperCase() : 'MYR';
  const operatorCompanyEmail = clientRows.length && clientRows[0].email != null
    ? String(clientRows[0].email).trim().toLowerCase()
    : '';
  const paymentGatewayProviderOut = stripeGatewayStatus.connected
    ? 'stripe'
    : payexGatewayStatus.connected
      ? 'payex'
      : billplzGatewayStatus.connected
        ? 'billplz'
        : (['stripe', 'payex', 'paynow', 'billplz'].includes(paymentGatewayProvider || '')
            ? paymentGatewayProvider
            : (clientCurrency === 'SGD' ? 'paynow' : 'stripe'));
  return {
    ok: true,
    stripeConnected,
    stripe_connected_account_id: stripeConnectedAccountId || undefined,
    paymentGatewayProvider: paymentGatewayProviderOut,
    paymentGatewayPendingProvider:
      stripeGatewayStatus.connectionStatus === 'pending_verification'
        ? 'stripe'
        : (payexGatewayStatus.connectionStatus === 'pending_verification'
            ? 'payex'
            : (billplzGatewayStatus.connectionStatus === 'pending_verification' ? 'billplz' : undefined)),
    stripeConnectionStatus: stripeGatewayStatus.connectionStatus,
    stripeConnectionMode: stripeGatewayStatus.mode,
    payexConnectionStatus: payexGatewayStatus.connectionStatus,
    payexConnectionMode: payexGatewayStatus.mode,
    billplzConnectionStatus: billplzGatewayStatus.connectionStatus,
    billplzConnectionMode: billplzGatewayStatus.mode,
    sgPaynowEnabledWithGateway,
    payexConfigured,
    payexPlatformMode,
    payexHasSubAccount,
    payexSubAccountEverCreated,
    cnyiotConnected,
    cnyiotCreateEverUsed,
    cnyiotDisconnectedWithMode,
    accountingConnected,
    accountingProvider,
    accountingEinvoice,
    ttlockConnected,
    ttlockCreateEverUsed,
    ttlockDisconnectedWithMode,
    aiProvider: aiProviderName,
    aiProviderHasApiKey,
    bankReconcileConnected,
    finverseHasCreds,
    googleDriveConnected,
    googleDriveEmail: googleDriveEmail || undefined,
    /** operatordetail.email — master / company login; Contact Settings must not offer “remove” for this row */
    operatorCompanyEmail: operatorCompanyEmail || undefined
  };
}

/**
 * Get AI Agent config (provider + hasApiKey; api_key value never returned).
 */
async function getAiProviderConfig(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT provider, values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'aiProvider' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!rows.length) {
    return { ok: true, provider: null, hasApiKey: false, model: null, apiKeyLast4: null, apiKeyHash: null };
  }
  const values = typeof rows[0].values_json === 'string' ? JSON.parse(rows[0].values_json || '{}') : (rows[0].values_json || {});
  const provider = (rows[0].provider || '').toString().toLowerCase() || null;
  const meta = getApiKeyMeta(values);
  return {
    ok: true,
    provider,
    hasApiKey: meta.hasApiKey,
    model: values.model || null,
    apiKeyLast4: meta.apiKeyLast4,
    apiKeyHash: meta.apiKeyHash
  };
}

/**
 * Save AI Agent config (provider: deepseek | openai | gemini, api_key, model optional).
 */
async function saveAiProviderConfig(email, { provider, api_key, apiKey, model, ai_model, aiModel }) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const allowed = ['deepseek', 'openai', 'gemini'];
  let provRaw = (provider || '').toString().trim().toLowerCase();
  // Accept common UI labels so save is resilient across old/new frontends.
  if (provRaw === 'chatgpt' || provRaw === 'chatgpt (openai)' || provRaw === 'openai (chatgpt)') provRaw = 'openai';
  if (provRaw === 'google' || provRaw === 'google gemini') provRaw = 'gemini';
  const prov = provRaw;
  if (!allowed.includes(prov)) throw new Error('INVALID_AI_PROVIDER');
  const modelVal = model ?? ai_model ?? aiModel;
  const valuesMerge = { model: modelVal || undefined };
  const apiKeyVal = api_key ?? apiKey;
  if (apiKeyVal !== undefined && apiKeyVal !== null && String(apiKeyVal).trim() !== '') {
    valuesMerge.api_key = String(apiKeyVal).trim();
  }
  if (valuesMerge.api_key) {
    const { verifyAiProviderKey } = require('../ai-integration/verify-ai-provider-key');
    await verifyAiProviderKey(prov, valuesMerge.api_key);
  }
  await upsertClientIntegration(clientId, 'aiProvider', 0, prov, valuesMerge, true);
  return { ok: true, provider: prov };
}

/**
 * Payment verification (for operator approval page): list invoices, get one, approve, reject.
 * Client from requireCtx(email, ...).
 */
async function paymentVerificationListInvoices(email, clientIdFromReq, filters = {}) {
  try {
    const { clientId } = await requireCtx(email, ['finance', 'integration', 'admin'], clientIdFromReq);
    const pv = require('../payment-verification/payment-verification.service');
    const rows = await pv.listInvoices(clientId, filters);
    return { ok: true, data: rows };
  } catch (err) {
    console.warn('[companysetting] payment-verification-invoices', err?.message || err);
    return { ok: true, data: [] };
  }
}

async function paymentVerificationGetInvoice(email, clientIdFromReq, invoiceId) {
  const { clientId } = await requireCtx(email, ['finance', 'integration', 'admin'], clientIdFromReq);
  const pv = require('../payment-verification/payment-verification.service');
  const data = await pv.getInvoiceWithCandidates(clientId, invoiceId);
  if (!data) return { ok: false, reason: 'INVOICE_NOT_FOUND' };
  return { ok: true, data };
}

async function paymentVerificationApprove(email, clientIdFromReq, invoiceId, payload = {}) {
  const { clientId } = await requireCtx(email, ['finance', 'integration', 'admin'], clientIdFromReq);
  const pv = require('../payment-verification/payment-verification.service');
  const data = await pv.approve(clientId, invoiceId, payload);
  return { ok: true, data };
}

async function paymentVerificationReject(email, clientIdFromReq, invoiceId) {
  const { clientId } = await requireCtx(email, ['finance', 'integration', 'admin'], clientIdFromReq);
  const pv = require('../payment-verification/payment-verification.service');
  const data = await pv.reject(clientId, invoiceId);
  return { ok: true, data };
}

/**
 * Finverse: get link_url for operator to start "Connect bank" (Finverse Link). state = clientId for callback.
 */
async function getFinverseLinkUrl(email, clientIdFromReq) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const finverse = require('../finverse');
  const redirectUri = process.env.FINVERSE_REDIRECT_URI;
  if (!redirectUri) throw new Error('FINVERSE_REDIRECT_URI_REQUIRED');
  const { link_url } = await finverse.auth.generateLinkToken(clientId, {
    redirect_uri: redirectUri,
    state: clientId,
    response_mode: 'form_post',
    response_type: 'code'
  });
  return { ok: true, link_url };
}

/**
 * Disconnect Stripe Connect: clear all saved Stripe OAuth / webhook data so next setup starts from scratch.
 */
async function stripeDisconnect(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  await pool.query(
    'UPDATE client_profile SET stripe_connected_account_id = NULL, stripe_connect_pending_id = NULL, updated_at = NOW() WHERE client_id = ?',
    [clientId]
  );
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration
      WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = 'stripe' LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    const values = parseJson(rows[0].values_json) || {};
    const preserved = {
      allow_paynow_with_gateway: values.allow_paynow_with_gateway
    };
    await pool.query(
      'UPDATE client_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(preserved), rows[0].id]
    );
  }
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
  const [rows] = await pool.query('SELECT id FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) throw new Error('STRIPE_OAUTH_STATE_INVALID');
  const { completeStripeConnectOAuth } = require('../stripe/stripe.service');
  return completeStripeConnectOAuth(clientId, code);
}

/**
 * CNYIOT connect: only platform subuser (create). Operators cannot connect their own account.
 * contact & subdomain: 创建子账号时从 client_profile 表读取，不依赖前端传参。
 */
async function cnyiotConnect(email, { mode, tel } = {}) {
  const t0 = Date.now();
  const effectiveMode = mode === 'create' || mode == null ? 'create' : mode;
  if (effectiveMode !== 'create') {
    throw new Error('CNYIOT_PLATFORM_ONLY'); // Operator cannot connect own account; only SaaS platform subuser
  }
  console.log('[cnyiotConnect] start email=%s mode=create (platform only)', email);
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  console.log('[cnyiotConnect] clientId=%s ms=%s', clientId, Date.now() - t0);
  {
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
}

/**
 * CNYIOT (Meter): disconnect = set enabled = 0. Re-connect is always platform create (no own account).
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
  const res = await userWrapper.getUsers(clientId, { returnPayloads: !!opts.debug });
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
  }, { returnPayloads: true });
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
async function getTtlockCredentials(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
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
 * Payex/Xendit (paymentGateway): save Xendit keys and/or sub-account ID for platform flow.
 * Platform flow (like Stripe): set XENDIT_PLATFORM_SECRET_KEY in env and provide xendit_sub_account_id (Business ID). We create invoice with platform key + split rule (99% to operator). No operator keys needed.
 * Operator flow: provide xendit_test_secret_key and/or xendit_live_secret_key (payment goes to operator's Xendit).
 */
async function payexConnect(email, { xendit_test_secret_key, xendit_live_secret_key, xendit_use_test, xendit_sub_account_id }) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  let testKey = (xendit_test_secret_key || '').toString().trim();
  let liveKey = (xendit_live_secret_key || '').toString().trim();
  const subAccountId = (xendit_sub_account_id || '').toString().trim();
  const payex = require('../payex/payex.service');
  const platformMode = payex.isPlatformModeEnabled();

  // Operator modal may only send one key (often as xendit_live_secret_key).
  // Detect prefix so test/live environment will pick correct secretKey.
  // Typical formats:
  // - test:    xnd_development_...
  // - live:    xnd_production_...
  if (!testKey && liveKey) {
    if (/^xnd_development_/i.test(liveKey)) {
      testKey = liveKey;
      liveKey = '';
    } else if (/^xnd_production_/i.test(liveKey)) {
      // keep as liveKey
    }
  }

  if (subAccountId && platformMode) {
    await upsertClientIntegration(clientId, 'paymentGateway', 0, 'payex', {
      xendit_sub_account_id: subAccountId,
      xendit_test_secret_key: testKey,
      xendit_live_secret_key: liveKey,
      xendit_use_test: xendit_use_test === true || xendit_use_test === 1
    }, true);
  } else if (platformMode && !subAccountId) {
    const [existing] = await pool.query(
      `SELECT id, values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = 'payex' AND enabled = 1 LIMIT 1`,
      [clientId]
    );
    if (existing.length) {
      const v = typeof existing[0].values_json === 'string' ? JSON.parse(existing[0].values_json || '{}') : (existing[0].values_json || {});
      if (v.xendit_sub_account_id) {
        await pool.query(
          `UPDATE client_integration SET enabled = 0, updated_at = NOW() WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider IN ('stripe','paynow')`,
          [clientId]
        );
        return { ok: true };
      }
    }
    throw new Error('XENDIT_KEYS_OR_SUB_ACCOUNT_REQUIRED');
  } else if (testKey || liveKey) {
    if (!testKey && !liveKey) throw new Error('XENDIT_KEYS_REQUIRED');
    // Enforce "connect only" to the platform-created sub-account.
    // If client already has xendit_sub_account_id, do not allow operator to clear/replace it.
    let subAccountIdToSave = subAccountId || '';
    const [existing] = await pool.query(
      `SELECT values_json FROM client_integration
       WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = 'payex' AND enabled = 1 LIMIT 1`,
      [clientId]
    );
    if (existing.length) {
      const v = typeof existing[0].values_json === 'string' ? parseJson(existing[0].values_json || '{}') : (existing[0].values_json || {});
      const existingSub = (v?.xendit_sub_account_id || '').toString().trim();
      if (existingSub) {
        if (subAccountIdToSave && existingSub !== subAccountIdToSave) {
          throw new Error('XENDIT_SUB_ACCOUNT_ID_MISMATCH');
        }
        if (!subAccountIdToSave) subAccountIdToSave = existingSub; // keep platform id
      }
    }
    await upsertClientIntegration(clientId, 'paymentGateway', 0, 'payex', {
      xendit_sub_account_id: subAccountIdToSave || undefined,
      xendit_test_secret_key: testKey,
      xendit_live_secret_key: liveKey,
      xendit_use_test: xendit_use_test === true || xendit_use_test === 1,
      // Operator flow: always disable platform split_rules even if subAccountId exists.
      // This keeps payments using operator's secret key (no XenPlatform split rules).
      xendit_platform_flow_disabled: true
    }, true);
  } else {
    throw new Error('XENDIT_KEYS_OR_SUB_ACCOUNT_REQUIRED');
  }
  await pool.query(
    `UPDATE client_integration SET enabled = 0, updated_at = NOW() WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider IN ('stripe','paynow')`
  , [clientId]);
  return { ok: true };
}

async function getPayexCredentials(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const payex = require('../payex/payex.service');
  const creds = await payex.getPayexCredentials(clientId);
  return { ok: true, configured: !!creds };
}

async function payexDisconnect(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = 'payex' LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    const existing = typeof rows[0].values_json === 'string' ? parseJson(rows[0].values_json) : (rows[0].values_json || {});
    const preserved = {
      xendit_sub_account_ever_created: existing.xendit_sub_account_ever_created === true || !!existing.xendit_sub_account_id,
      xendit_sub_account_id: existing.xendit_sub_account_id || undefined
    };
    await pool.query(
      'UPDATE client_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(preserved), rows[0].id]
    );
  }
  return { ok: true };
}

async function billplzDisconnect(email) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query(
    `SELECT id FROM client_integration WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = 'billplz' LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    await pool.query(
      'UPDATE client_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify({}), rows[0].id]
    );
  }
  return { ok: true };
}

/**
 * SG tenant payment mode:
 * - paynow_only => provider=paynow (PayNow only)
 * - paynow_plus_stripe => provider=stripe (+PayNow)
 * - stripe_only => provider=stripe (no PayNow)
 * - paynow_plus_xendit => provider=payex
 */
async function setSgTenantPaymentMode(email, mode) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  const [rows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const currency = rows.length ? String(rows[0].currency || '').trim().toUpperCase() : '';
  if (currency !== 'SGD') throw new Error('ONLY_SGD_SUPPORTED');

  const m = String(mode || '').trim();
  if (!['paynow_only', 'paynow_plus_stripe', 'stripe_only', 'paynow_plus_xendit'].includes(m)) {
    throw new Error('INVALID_PAYMENT_MODE');
  }

  if (m === 'paynow_only') {
    await upsertClientIntegration(clientId, 'paymentGateway', 0, 'paynow', {}, true);
    await pool.query(
      "UPDATE client_integration SET enabled = 0, updated_at = NOW() WHERE client_id = ? AND `key` = 'paymentGateway' AND provider IN ('stripe','payex')",
      [clientId]
    );
    return { ok: true, mode: m, provider: 'paynow' };
  }

  if (m === 'paynow_plus_stripe') {
    await upsertClientIntegration(clientId, 'paymentGateway', 0, 'stripe', { allow_paynow_with_gateway: true }, true);
    await pool.query(
      "UPDATE client_integration SET enabled = 0, updated_at = NOW() WHERE client_id = ? AND `key` = 'paymentGateway' AND provider IN ('paynow','payex')",
      [clientId]
    );
    return { ok: true, mode: m, provider: 'stripe' };
  }

  if (m === 'stripe_only') {
    await upsertClientIntegration(clientId, 'paymentGateway', 0, 'stripe', { allow_paynow_with_gateway: false }, true);
    await pool.query(
      "UPDATE client_integration SET enabled = 0, updated_at = NOW() WHERE client_id = ? AND `key` = 'paymentGateway' AND provider IN ('paynow','payex')",
      [clientId]
    );
    return { ok: true, mode: m, provider: 'stripe' };
  }

  await upsertClientIntegration(clientId, 'paymentGateway', 0, 'payex', {}, true);
  await pool.query(
    "UPDATE client_integration SET enabled = 0, updated_at = NOW() WHERE client_id = ? AND `key` = 'paymentGateway' AND provider IN ('paynow','stripe')",
    [clientId]
  );
  return { ok: true, mode: m, provider: 'payex' };
}

/**
 * Create Xendit sub-account (platform flow) and save to client. Requires XENDIT_PLATFORM_SECRET_KEY in env.
 * One sub-account per operator: if they ever created one (or had one connected), they cannot create again—only connect existing.
 */
async function xenditCreateSubAccount(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const [payexRows] = await pool.query(
    `SELECT id, values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = 'payex' LIMIT 1`,
    [clientId]
  );
  if (payexRows.length) {
    const v = typeof payexRows[0].values_json === 'string' ? parseJson(payexRows[0].values_json) : (payexRows[0].values_json || {});
    if (v.xendit_sub_account_ever_created || v.xendit_sub_account_id) {
      throw new Error('XENDIT_ONE_SUB_ACCOUNT_ONLY');
    }
  }
  const [clientRows] = await pool.query('SELECT email, title FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!clientRows.length) throw new Error('CLIENT_NOT_FOUND');
  const payex = require('../payex/payex.service');
  const platform = payex.getPlatformXenditConfig();
  if (!platform) throw new Error('XENDIT_PLATFORM_NOT_CONFIGURED');
  const emailAddr = (clientRows[0].email || '').toString().trim() || null;
  if (!emailAddr) throw new Error('CLIENT_EMAIL_REQUIRED');
  const businessName = (clientRows[0].title || clientRows[0].email || 'Operator').toString().trim().slice(0, 255);
  const { id } = await payex.createXenditSubAccountViaApi(platform.secretKey, { email: emailAddr, businessName });
  await upsertClientIntegration(
    clientId,
    'paymentGateway',
    0,
    'payex',
    {
      xendit_sub_account_id: id,
      xendit_sub_account_ever_created: true,
      xendit_sub_account_type: 'MANAGED'
    },
    true
  );
  await pool.query(
    `UPDATE client_integration SET enabled = 0, updated_at = NOW() WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider IN ('stripe','paynow')`,
    [clientId]
  );
  return { ok: true, subAccountId: id };
}

/**
 * AutoCount (addonAccount): save API Key, Key ID, Account Book ID to client_integration.
 * From Cloud Accounting Settings > API Keys.
 */
async function autocountConnect(email, { apiKey, keyId, accountBookId, einvoice }) {
  throw new Error('ACCOUNTING_PROVIDER_REMOVED');
}

/**
 * Get current AutoCount apiKey, keyId, accountBookId for the client (for pre-fill in UI).
 */
async function getAutoCountCredentials(email) {
  throw new Error('ACCOUNTING_PROVIDER_REMOVED');
}

/**
 * AutoCount (addonAccount): disable and clear stored credentials.
 */
async function autocountDisconnect(email) {
  throw new Error('ACCOUNTING_PROVIDER_REMOVED');
}

/**
 * SQL Account (addonAccount): save Access Key + Secret Key to client_integration (provider=sql).
 * Optional baseUrl, einvoice. Used for AWS Sig v4 with SQL Account API.
 */
async function sqlAccountConnect(email, { accessKey, secretKey, baseUrl, einvoice, sqlaccount_payment_method_code_bank, sqlaccount_payment_method_code_cash, sqlaccount_receipt_account_code_bank, sqlaccount_receipt_account_code_cash }) {
  throw new Error('ACCOUNTING_PROVIDER_REMOVED');
}

/**
 * Get current SQL Account accessKey, secretKey (and baseUrl if set) for the client.
 */
async function getSqlAccountCredentials(email) {
  throw new Error('ACCOUNTING_PROVIDER_REMOVED');
}

/**
 * SQL Account (addonAccount): disable and clear stored credentials.
 */
async function sqlAccountDisconnect(email) {
  throw new Error('ACCOUNTING_PROVIDER_REMOVED');
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
    // `/Accounts` sync requires accounting settings scope.
    scope: 'openid profile email accounting.transactions accounting.contacts accounting.settings offline_access'
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
 * TTLock: operators connect their own TTLock account.
 * Current app credentials stay on the platform, while username/password belong to the operator company.
 * Legacy mode=create is kept only for backward compatibility and is no longer used by the portal UI.
 */
async function ttlockConnect(email, { mode, username, password } = {}, clientIdFromReq = null) {
  const effectiveMode = mode === 'create' ? 'create' : 'existing';
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);

  if (effectiveMode === 'create') {
    const cur = await getTTLockIntegration(clientId);
    if (cur?.values?.ttlock_subuser_ever_created || cur?.values?.ttlock_username) {
      throw new Error('TTLOCK_SUBUSER_ALREADY_CREATED');
    }
    const result = await ensureTTLockSubuser(clientId);
    await updateTTLockIntegration(clientId, { ttlock_mode: 'create' });
    return { ok: true, mode: 'create', username: result.username, created: result.created };
  }

  const usernameTrim = String(username || '').trim();
  const passwordTrim = String(password || '').trim();
  if (!usernameTrim || !passwordTrim) {
    throw new Error('TTLOCK_USERNAME_PASSWORD_REQUIRED');
  }

  const freshToken = await requestNewToken({
    username: usernameTrim,
    password: passwordTrim
  });

  await upsertClientIntegration(clientId, 'smartDoor', 0, 'ttlock', {
    ttlock_username: usernameTrim,
    ttlock_password: passwordTrim,
    ttlock_mode: 'existing'
  }, true);
  await saveToken(clientId, freshToken);
  await pool.query(
    'UPDATE operatordetail SET ttlock_username = ?, ttlock_manual = 1, updated_at = NOW() WHERE id = ?',
    [usernameTrim, clientId]
  );

  return { ok: true, mode: 'existing', username: usernameTrim };
}

/**
 * TTLock: disconnect only disables the integration row.
 * Saved credentials remain so the operator can reconnect later if needed.
 */
async function ttlockDisconnect(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
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
 * @param {{ provider: string, einvoice: boolean }} payload - provider: 'bukku'|'xero'
 */
async function updateAccountingEinvoice(email, { provider, einvoice }) {
  const { clientId } = await requireCtx(email, ['integration', 'admin']);
  if (!provider || !['bukku', 'xero'].includes(provider)) {
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

/**
 * Get PayNow QR upload log for client (audit: date, email, url/cleared).
 */
async function getPaynowQrLog(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['profilesetting', 'admin'], clientIdFromReq);
  const [rows] = await pool.query(
    'SELECT id, uploaded_at, uploaded_by_email, url FROM paynow_qr_log WHERE client_id = ? ORDER BY uploaded_at DESC LIMIT 100',
    [clientId]
  );
  return {
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      uploadedAt: r.uploaded_at,
      uploadedByEmail: r.uploaded_by_email || '',
      url: r.url,
      action: r.url ? 'upload/replace' : 'clear'
    }))
  };
}

module.exports = {
  getStaffList,
  createStaff,
  updateStaff,
  deleteStaff,
  updateOperatorProfilePhoto,
  getIntegrationTemplate,
  getProfile,
  updateProfile,
  getPaynowQrLog,
  getBanks,
  getOperatorBankDetails,
  saveOperatorBankDetails,
  getAdmin,
  saveAdmin,
  getDirectPaymentGatewayStatus,
  saveDirectStripePaymentGateway,
  saveDirectBillplzPaymentGateway,
  triggerDirectStripeWebhookTest,
  saveDirectPayexPaymentGateway,
  getOnboardStatus,
  getAiProviderConfig,
  saveAiProviderConfig,
  paymentVerificationListInvoices,
  paymentVerificationGetInvoice,
  paymentVerificationApprove,
  paymentVerificationReject,
  getFinverseLinkUrl,
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
  payexConnect,
  getPayexCredentials,
  payexDisconnect,
  billplzDisconnect,
  setSgTenantPaymentMode,
  xenditCreateSubAccount,
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
  requireCtx,
  upsertClientIntegration
};
