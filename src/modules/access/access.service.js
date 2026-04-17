/**
 * Access context – single source of truth (migrated from Wix backend/access/manage.jsw).
 * Uses MySQL: staffdetail, operatordetail, client_credit, client_pricingplan_detail, client_integration, account, account_client.
 * Member = one email; all email comparisons use LOWER(TRIM(email)) (case-insensitive).
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const {
  getOperatorMasterTableName,
  resetOperatorMasterTableCacheForTests
} = require('../../config/operatorMasterTable');
const { resolveClnOperatordetailTable } = require('../../config/clnOperatordetailTable');

/** MySQL 1146 on operator master table — clear cache and retry once (deploy/rename race). */
function isOperatorMasterTableMissingErr(err) {
  if (!err || err.code !== 'ER_NO_SUCH_TABLE') return false;
  const m = String(err.sqlMessage || err.message || '');
  return /[`']?(operatordetail|clientdetail)[`']?/i.test(m);
}

// Plan IDs that allow Accounting / Account capability (pricingplan.id from MySQL).
// Comma-separated override via env ACCOUNTING_PLAN_IDS.
// Default must use real pricingplan.id rows; legacy UUIDs kept for old DBs that still reference them.
const ACCOUNTING_PLAN_IDS =
  process.env.ACCOUNTING_PLAN_IDS && process.env.ACCOUNTING_PLAN_IDS.trim()
    ? process.env.ACCOUNTING_PLAN_IDS.split(',').map(s => s.trim()).filter(Boolean)
    : [
        '896357c8-1155-47de-9d3c-15055a4820aa',
        '06af7357-f9c8-4319-98c3-b24e1fa7ae27',
        'dd81f45d-62e0-428a-af9b-ce436735a08d',
        'd8bbcfcf-4e33-4fc5-8bcb-cbc0bb28fc1c',
        // Elite (pricingplan.id) — same as THIRD_PARTY_INTEGRATION_PLAN_IDS; was missing here so Company/Accounting stayed hidden
        '424d907f-d2bc-46f1-adc6-787ef2dc983b'
      ];

/** Elite + Enterprise + Enterprise Plus + legacy high-tier UUIDs (pricingplan.id). Env THIRD_PARTY_INTEGRATION_PLAN_IDS overrides default list. */
const THIRD_PARTY_INTEGRATION_PLAN_IDS =
  process.env.THIRD_PARTY_INTEGRATION_PLAN_IDS && process.env.THIRD_PARTY_INTEGRATION_PLAN_IDS.trim()
    ? process.env.THIRD_PARTY_INTEGRATION_PLAN_IDS.split(',').map(s => s.trim()).filter(Boolean)
    : Array.from(
        new Set([
          ...ACCOUNTING_PLAN_IDS,
          '424d907f-d2bc-46f1-adc6-787ef2dc983b', // Elite
          'e119144a-24b1-4fc6-ba0d-4c5c3f3184c6',
          '80991cd1-b17a-4d68-9b21-21a1df76120c'
        ])
      );

/** Cleanlemons B2B link is only offered to Malaysia (MYR) operators, not Singapore (SGD). */
function isCleanlemonsPartnerCurrency(currency) {
  return String(currency || '')
    .trim()
    .toUpperCase() === 'MYR';
}

/** Normalize email for member lookup: lowercase, trim. One email = one member. */
function normalizeEmail(email) {
  if (email == null || typeof email !== 'string') return '';
  return String(email).toLowerCase().trim();
}

/** True when MySQL rejects SELECT … profilephoto … (migration 0129 not applied yet). */
function isUnknownProfilephotoColumn(err) {
  return (
    err &&
    err.code === 'ER_BAD_FIELD_ERROR' &&
    /profilephoto/i.test(String(err.sqlMessage || ''))
  );
}

/**
 * client_user by email — prefers profilephoto column; falls back if column missing.
 */
async function selectClientUserByEmail(normalizedEmail) {
  try {
    const [rows] = await pool.query(
      'SELECT id, email, name, profilephoto, status, client_id, permission_json FROM client_user WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalizedEmail]
    );
    return rows;
  } catch (err) {
    if (!isUnknownProfilephotoColumn(err)) throw err;
    console.warn('[access] client_user.profilephoto missing — run migration 0129; using fallback query');
    const [rows] = await pool.query(
      'SELECT id, email, name, status, client_id, permission_json FROM client_user WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalizedEmail]
    );
    return rows.map((r) => ({ ...r, profilephoto: null }));
  }
}

async function selectClientUserByEmailAndClient(normalizedEmail, clientId) {
  try {
    const [rows] = await pool.query(
      'SELECT id, email, name, profilephoto, status, client_id, permission_json FROM client_user WHERE LOWER(TRIM(email)) = ? AND client_id = ? LIMIT 1',
      [normalizedEmail, clientId]
    );
    return rows;
  } catch (err) {
    if (!isUnknownProfilephotoColumn(err)) throw err;
    console.warn('[access] client_user.profilephoto missing — run migration 0129; using fallback query');
    const [rows] = await pool.query(
      'SELECT id, email, name, status, client_id, permission_json FROM client_user WHERE LOWER(TRIM(email)) = ? AND client_id = ? LIMIT 1',
      [normalizedEmail, clientId]
    );
    return rows.map((r) => ({ ...r, profilephoto: null }));
  }
}

async function selectStaffdetailByEmail(normalizedEmail) {
  try {
    const [rows] = await pool.query(
      'SELECT id, email, name, profilephoto, profile, status, client_id, permission_json FROM staffdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalizedEmail]
    );
    return rows;
  } catch (err) {
    if (!isUnknownProfilephotoColumn(err)) throw err;
    console.warn('[access] staffdetail.profilephoto missing — run migration 0129; using fallback query');
    const [rows] = await pool.query(
      'SELECT id, email, name, profile, status, client_id, permission_json FROM staffdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalizedEmail]
    );
    return rows.map((r) => ({ ...r, profilephoto: null }));
  }
}

async function selectStaffdetailByEmailAndClient(normalizedEmail, clientId) {
  try {
    const [rows] = await pool.query(
      'SELECT id, email, name, profilephoto, profile, status, client_id, permission_json FROM staffdetail WHERE LOWER(TRIM(email)) = ? AND client_id = ? LIMIT 1',
      [normalizedEmail, clientId]
    );
    return rows;
  } catch (err) {
    if (!isUnknownProfilephotoColumn(err)) throw err;
    console.warn('[access] staffdetail.profilephoto missing — run migration 0129; using fallback query');
    const [rows] = await pool.query(
      'SELECT id, email, name, profile, status, client_id, permission_json FROM staffdetail WHERE LOWER(TRIM(email)) = ? AND client_id = ? LIMIT 1',
      [normalizedEmail, clientId]
    );
    return rows.map((r) => ({ ...r, profilephoto: null }));
  }
}

/**
 * Normalize staff permission from DB (permission_json: array, string, or object) to array.
 */
function permissionToArray(permission) {
  if (Array.isArray(permission)) return permission;
  if (typeof permission === 'string') {
    return permission.split(',').map(p => p.trim()).filter(Boolean);
  }
  if (permission && typeof permission === 'object') {
    return Object.values(permission);
  }
  return [];
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

/**
 * Whether client purchased Bank Bulk Transfer addon.
 * Match by addon title from client_pricingplan_detail.title or pricingplanaddon.title.
 */
async function hasBankBulkTransferAddon(clientId) {
  if (!clientId) return false;
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(cpd.title), ''), ppa.title) AS title
     FROM client_pricingplan_detail cpd
     LEFT JOIN pricingplanaddon ppa ON ppa.id = cpd.plan_id
     WHERE cpd.client_id = ? AND cpd.type = 'addon'`,
    [clientId]
  );
  const bankPattern = /bank\s*bulk\s*transfer/i;
  return (rows || []).some((r) => bankPattern.test(String(r.title || '').trim()));
}

/**
 * Build permission object from permission array; admin => all true.
 */
function buildPermission(permissionArray) {
  const permission = {
    profilesetting: permissionArray.includes('profilesetting'),
    usersetting: permissionArray.includes('usersetting'),
    integration: permissionArray.includes('integration'),
    billing: permissionArray.includes('billing'),
    finance: permissionArray.includes('finance'),
    tenantdetail: permissionArray.includes('tenantdetail'),
    propertylisting: permissionArray.includes('propertylisting'),
    marketing: permissionArray.includes('marketing'),
    booking: permissionArray.includes('booking'),
    admin: permissionArray.includes('admin')
  };
  if (permission.admin) {
    Object.keys(permission).forEach(k => { permission[k] = true; });
  }
  return permission;
}

/**
 * Get access context by staff email. Returns { ok, reason, ... }.
 * Tables: staffdetail, operatordetail, client_credit, client_pricingplan_detail, client_integration.
 * capability.accounting = plan allows; capability.accountProvider = onboarded provider or null;
 * capability.accountingReady = onboarded + all Account Setting items synced (account_client mapping count = account count).
 */
async function getAccessContextByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { ok: false, reason: 'NO_EMAIL' };
  }

  try {
    // Operator identity: client_user (Company Setting users) first, then staffdetail (legacy / Contact staff).
    // staffDetailId: only set when resolved from staffdetail (for creditlogs.staff_id FK); null when from client_user.
    let staff = null;
    let fromStaffDetail = false;
    const userRows = await selectClientUserByEmail(normalizedEmail);
    if (userRows.length) {
      staff = userRows[0];
      console.log('[access] getAccessContextByEmail client_user FOUND email=%s clientId=%s userId=%s', normalizedEmail, staff.client_id, staff.id);
    }
    if (!staff) {
      console.log('[access] getAccessContextByEmail client_user NOT FOUND email=%s trying staffdetail', normalizedEmail);
      const staffRows = await selectStaffdetailByEmail(normalizedEmail);
      if (staffRows.length) {
        staff = staffRows[0];
        fromStaffDetail = true;
        console.log('[access] getAccessContextByEmail staffdetail FOUND email=%s clientId=%s', normalizedEmail, staff.client_id);
      }
    }

    if (!staff) {
      // SaaS Admin (platform admin): can use indoor-admin billing without being staff of a client
      const [saasAdminRows] = await pool.query(
        'SELECT id FROM saasadmin WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalizedEmail]
      );
      if (saasAdminRows.length) {
        console.log('[access] getAccessContextByEmail saasAdmin FOUND email=%s', normalizedEmail);
        return { ok: true, reason: 'OK', staff: null, client: null, isSaasAdmin: true };
      }
      console.log('[access] getAccessContextByEmail NO_STAFF email=%s (no client_user, no staffdetail, not saasAdmin)', normalizedEmail);
      return { ok: false, reason: 'NO_STAFF' };
    }
    // 若该邮箱同时在 saasadmin 表，也视为 SaaS Admin（例如既是某 client 的 staff 又是平台 admin）
    let isSaasAdmin = false;
    const [saasAdminRows] = await pool.query(
      'SELECT id FROM saasadmin WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalizedEmail]
    );
    if (saasAdminRows.length) isSaasAdmin = true;
    const staffId = staff.id;
    const clientId = staff.client_id;

    if (staff.status !== 1 && staff.status !== true) {
      return { ok: false, reason: 'STAFF_INACTIVE' };
    }

    if (!clientId) {
      return { ok: false, reason: 'NO_CLIENT' };
    }

    const opTable = await getOperatorMasterTableName();
    const [clientRows] = await pool.query(
      `SELECT id, title, status, currency, expired, pricingplan_id FROM \`${opTable}\` WHERE id = ? LIMIT 1`,
      [clientId]
    );

    if (!clientRows.length) {
      return { ok: false, reason: 'CLIENT_NOT_FOUND' };
    }

    const client = clientRows[0];

    if (client.status !== 1 && client.status !== true) {
      console.log('[access] getAccessContextByEmail CLIENT_INACTIVE email=%s clientId=%s', normalizedEmail, clientId);
      return { ok: false, reason: 'CLIENT_INACTIVE' };
    }

    // Permission: staffdetail.permission_json (JSON column; mysql2 may return object or string)
    const rawPermission = staff.permission_json;
    let permissionArray = [];
    if (rawPermission != null) {
      const parsed = typeof rawPermission === 'string' ? JSON.parse(rawPermission) : rawPermission;
      permissionArray = permissionToArray(parsed);
    }
    const permission = buildPermission(permissionArray);

    // Permission check disabled for now – will re-enable later.
    // const hasAnyPermission = Object.values(permission).some(Boolean);
    // if (!hasAnyPermission) { return { ok: false, reason: 'NO_PERMISSION', staffId, clientId: client.id }; }

    // Credit: SUM all client_credit rows (core + flex) = total balance from operatordetail.credit
    const [creditRows] = await pool.query(
      'SELECT amount FROM client_credit WHERE client_id = ?',
      [clientId]
    );
    let creditBalance = 0;
    for (const r of creditRows || []) {
      creditBalance += Number(r.amount) || 0;
    }
    const creditOk = creditBalance >= 0;

    // Expiry
    const expiredAt = client.expired || null;
    const isExpired = expiredAt ? new Date(expiredAt) < new Date() : false;

    // Plan: client_pricingplan_detail (type = 'plan' | 'addon', plan_id)
    const [planRows] = await pool.query(
      'SELECT id, type, plan_id, title, expired, qty FROM client_pricingplan_detail WHERE client_id = ? ORDER BY id',
      [clientId]
    );
    let mainPlan = null;
    const addons = [];
    for (const row of planRows) {
      const item = {
        planId: row.plan_id,
        type: row.type,
        title: row.title || undefined,
        expired: row.expired || undefined,
        qty: row.qty != null ? row.qty : undefined
      };
      if (row.type === 'plan') {
        mainPlan = item;
      } else {
        addons.push(item);
      }
    }

    // Account integration: client_integration addonAccount (Account/addonAccount, enabled=1) → provider for Company Setting / UI
    let accountProvider = null;
    const [intRows] = await pool.query(
      `SELECT provider FROM client_integration
       WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1
       ORDER BY \`key\` = 'Account' DESC LIMIT 1`,
      [clientId]
    );
    if (Array.isArray(intRows) && intRows.length > 0 && intRows[0].provider) {
      accountProvider = String(intRows[0].provider).trim().toLowerCase();
    }

    // Accounting ready = onboarded (accountProvider) + all Account Setting items synced (every account template has mapping for this client)
    let accountingSyncedTotal = 0;
    let accountingSyncedMapped = 0;
    let accountingReady = false;
    if (accountProvider) {
      const [[totRow]] = await pool.query('SELECT COUNT(*) AS c FROM account');
      const [[mapRow]] = await pool.query(
        `SELECT COUNT(*) AS c FROM account_client
         WHERE client_id = ? AND \`system\` = ? AND accountid IS NOT NULL AND TRIM(COALESCE(accountid, '')) != ''`,
        [clientId, accountProvider]
      );
      accountingSyncedTotal = Number(totRow?.c ?? 0) || 0;
      accountingSyncedMapped = Number(mapRow?.c ?? 0) || 0;
      accountingReady = accountingSyncedTotal > 0 && accountingSyncedMapped === accountingSyncedTotal;
    }

    const bankBulkTransfer = await hasBankBulkTransferAddon(clientId);
    const fallbackPlanId =
      client.pricingplan_id != null && String(client.pricingplan_id).trim()
        ? String(client.pricingplan_id).trim()
        : null;
    const tierPlanIdThirdParty = mainPlan?.planId || fallbackPlanId;
    const thirdPartyIntegration = !!(
      tierPlanIdThirdParty && THIRD_PARTY_INTEGRATION_PLAN_IDS.includes(tierPlanIdThirdParty)
    );
    const capability = {
      accounting: !!(mainPlan && ACCOUNTING_PLAN_IDS.includes(mainPlan.planId)),
      thirdPartyIntegration,
      /** Cleanlemons B2B link: Malaysia (MYR) operators only — not gated on pricing plan. */
      cleanlemonsPartner: isCleanlemonsPartnerCurrency(client.currency),
      bankBulkTransfer,
      accountProvider: accountProvider || null,
      accountingReady,
      accountingSyncedTotal: accountProvider ? accountingSyncedTotal : null,
      accountingSyncedMapped: accountProvider ? accountingSyncedMapped : null
    };

    // portal_account (single source of truth) fields for operator/profile UI.
    let portal = null;
    try {
      const [pRows] = await pool.query(
        'SELECT fullname, first_name, last_name, phone, address, nric, bankname_id, bankaccount, accountholder, avatar_url, nricfront, nricback, entity_type, reg_no_type, id_type, tax_id_no, bank_refund_remark FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalizedEmail]
      );
      portal = pRows?.[0] || null;
    } catch (_) {
      portal = null;
    }

    console.log('[access] getAccessContextByEmail OK email=%s clientId=%s', normalizedEmail, client.id);
    return {
      ok: true,
      reason: 'OK',
      staff: {
        id: staffId,
        email: staff.email,
        name: staff.name || null,
        profilephoto: staff.profilephoto || null,
        profile: parseJson(staff.profile) || null,
        /** Legal name (operator/profile — portal_account.fullname) for agreements {{username}} */
        fullname: portal?.fullname ?? null,
        first_name: portal?.first_name ?? null,
        last_name: portal?.last_name ?? null,
        phone: portal?.phone ?? null,
        address: portal?.address ?? null,
        nric: portal?.nric ?? null,
        bankname_id: portal?.bankname_id ?? null,
        bankaccount: portal?.bankaccount ?? null,
        accountholder: portal?.accountholder ?? null,
        avatar_url: portal?.avatar_url ?? null,
        nricfront: portal?.nricfront ?? null,
        nricback: portal?.nricback ?? null,
        entity_type: portal?.entity_type ?? null,
        reg_no_type: portal?.reg_no_type ?? null,
        id_type: portal?.id_type ?? null,
        tax_id_no: portal?.tax_id_no ?? null,
        bank_refund_remark: portal?.bank_refund_remark ?? null,
        active: true,
        permission
      },
      staffDetailId: fromStaffDetail ? staffId : null,
      client: {
        id: client.id,
        title: client.title,
        active: true,
        currency: client.currency
      },
      plan: { mainPlan, addons },
      capability,
      credit: { ok: creditOk, balance: creditBalance },
      expired: { isExpired, expiredAt },
      isSaasAdmin
    };
  } catch (err) {
    console.error('[access] getAccessContextByEmail error:', err.message || err.code || err);
    if (err.sqlMessage) console.error('[access] sqlMessage:', err.sqlMessage);
    return { ok: false, reason: 'DB_ERROR', message: err.message || 'Database error' };
  }
}

/**
 * Get access context for a staff member for a specific client (same email can be staff in multiple clients).
 * Email comparison is case-insensitive (LOWER(TRIM(email))).
 */
async function getAccessContextByEmailAndClient(email, clientId) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  if (!clientId) {
    return { ok: false, reason: 'NO_CLIENT_ID' };
  }

  try {
    console.log('[access] getAccessContextByEmailAndClient email=%s clientId=%s', normalizedEmail, clientId);
    let staff = null;
    let fromStaffDetail = false;
    const userRows = await selectClientUserByEmailAndClient(normalizedEmail, clientId);
    if (userRows.length) {
      staff = userRows[0];
      console.log('[access] getAccessContextByEmailAndClient client_user FOUND userId=%s', staff.id);
      // If identity/tax data is stored in staffdetail.profile, fetch it so operator/profile can initialize safely.
      if (staff && staff.profile === undefined) {
        try {
          const [pRows] = await pool.query(
            'SELECT profile FROM staffdetail WHERE LOWER(TRIM(email)) = ? AND client_id = ? LIMIT 1',
            [normalizedEmail, clientId]
          );
          staff.profile = pRows?.[0]?.profile ?? null;
        } catch (_) {
          // best-effort: staffdetail.profile may not exist on older DBs
        }
      }
    }
    if (!staff) {
      console.log('[access] getAccessContextByEmailAndClient client_user NOT FOUND trying staffdetail');
      const staffRows = await selectStaffdetailByEmailAndClient(normalizedEmail, clientId);
      if (staffRows.length) {
        staff = staffRows[0];
        fromStaffDetail = true;
        console.log('[access] getAccessContextByEmailAndClient staffdetail FOUND');
      }
    }
    if (!staff) {
      console.log('[access] getAccessContextByEmailAndClient NO_STAFF_FOR_CLIENT email=%s clientId=%s', normalizedEmail, clientId);
      return { ok: false, reason: 'NO_STAFF_FOR_CLIENT' };
    }
    const staffId = staff.id;
    const cid = staff.client_id;

    if (staff.status !== 1 && staff.status !== true) {
      return { ok: false, reason: 'STAFF_INACTIVE' };
    }
    if (!cid) {
      return { ok: false, reason: 'NO_CLIENT' };
    }

    const opTableAc = await getOperatorMasterTableName();
    const [clientRows] = await pool.query(
      `SELECT id, title, status, currency, expired, pricingplan_id FROM \`${opTableAc}\` WHERE id = ? LIMIT 1`,
      [cid]
    );
    if (!clientRows.length) {
      return { ok: false, reason: 'CLIENT_NOT_FOUND' };
    }
    const client = clientRows[0];
    if (client.status !== 1 && client.status !== true) {
      return { ok: false, reason: 'CLIENT_INACTIVE' };
    }

    const rawPermission = staff.permission_json;
    let permissionArray = [];
    if (rawPermission != null) {
      const parsed = typeof rawPermission === 'string' ? JSON.parse(rawPermission) : rawPermission;
      permissionArray = permissionToArray(parsed);
    }
    const permission = buildPermission(permissionArray);
    // Permission check disabled for now – will re-enable later.
    // const hasAnyPermission = Object.values(permission).some(Boolean);
    // if (!hasAnyPermission) { return { ok: false, reason: 'NO_PERMISSION', staffId, clientId: client.id }; }

    const [creditRows] = await pool.query(
      'SELECT amount FROM client_credit WHERE client_id = ?',
      [cid]
    );
    let creditBalance = 0;
    for (const r of creditRows || []) {
      creditBalance += Number(r.amount) || 0;
    }
    const creditOk = creditBalance >= 0;
    const expiredAt = client.expired || null;
    const isExpired = expiredAt ? new Date(expiredAt) < new Date() : false;

    const [planRows] = await pool.query(
      'SELECT id, type, plan_id, title, expired, qty FROM client_pricingplan_detail WHERE client_id = ? ORDER BY id',
      [cid]
    );
    let mainPlan = null;
    const addons = [];
    for (const row of planRows) {
      const item = {
        planId: row.plan_id,
        type: row.type,
        title: row.title || undefined,
        expired: row.expired || undefined,
        qty: row.qty != null ? row.qty : undefined
      };
      if (row.type === 'plan') mainPlan = item;
      else addons.push(item);
    }

    let accountProvider = null;
    const [intRows] = await pool.query(
      `SELECT provider FROM client_integration
       WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1
       ORDER BY \`key\` = 'Account' DESC LIMIT 1`,
      [cid]
    );
    if (Array.isArray(intRows) && intRows.length > 0 && intRows[0].provider) {
      accountProvider = String(intRows[0].provider).trim().toLowerCase();
    }
    let accountingSyncedTotal = 0;
    let accountingSyncedMapped = 0;
    let accountingReady = false;
    if (accountProvider) {
      const [[totRow]] = await pool.query('SELECT COUNT(*) AS c FROM account');
      const [[mapRow]] = await pool.query(
        `SELECT COUNT(*) AS c FROM account_client
         WHERE client_id = ? AND \`system\` = ? AND accountid IS NOT NULL AND TRIM(COALESCE(accountid, '')) != ''`,
        [cid, accountProvider]
      );
      accountingSyncedTotal = Number(totRow?.c ?? 0) || 0;
      accountingSyncedMapped = Number(mapRow?.c ?? 0) || 0;
      accountingReady = accountingSyncedTotal > 0 && accountingSyncedMapped === accountingSyncedTotal;
    }
    const bankBulkTransfer = await hasBankBulkTransferAddon(cid);
    const fallbackPlanIdAc =
      client.pricingplan_id != null && String(client.pricingplan_id).trim()
        ? String(client.pricingplan_id).trim()
        : null;
    const tierPlanIdThirdPartyAc = mainPlan?.planId || fallbackPlanIdAc;
    const thirdPartyIntegrationAc = !!(
      tierPlanIdThirdPartyAc && THIRD_PARTY_INTEGRATION_PLAN_IDS.includes(tierPlanIdThirdPartyAc)
    );
    const capability = {
      accounting: !!(mainPlan && ACCOUNTING_PLAN_IDS.includes(mainPlan.planId)),
      thirdPartyIntegration: thirdPartyIntegrationAc,
      cleanlemonsPartner: isCleanlemonsPartnerCurrency(client.currency),
      bankBulkTransfer,
      accountProvider: accountProvider || null,
      accountingReady,
      accountingSyncedTotal: accountProvider ? accountingSyncedTotal : null,
      accountingSyncedMapped: accountProvider ? accountingSyncedMapped : null
    };

    // portal_account (single source of truth) fields for operator/profile UI.
    let portal = null;
    try {
      const [pRows] = await pool.query(
        'SELECT fullname, first_name, last_name, phone, address, nric, bankname_id, bankaccount, accountholder, avatar_url, nricfront, nricback, entity_type, reg_no_type, id_type, tax_id_no, bank_refund_remark FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalizedEmail]
      );
      portal = pRows?.[0] || null;
    } catch (_) {
      portal = null;
    }

    console.log('[access] getAccessContextByEmailAndClient OK email=%s clientId=%s', normalizedEmail, clientId);
    return {
      ok: true,
      reason: 'OK',
      staff: {
        id: staffId,
        email: staff.email,
        name: staff.name || null,
        profilephoto: staff.profilephoto || null,
        profile: parseJson(staff.profile) || null,
        fullname: portal?.fullname ?? null,
        first_name: portal?.first_name ?? null,
        last_name: portal?.last_name ?? null,
        phone: portal?.phone ?? null,
        address: portal?.address ?? null,
        nric: portal?.nric ?? null,
        bankname_id: portal?.bankname_id ?? null,
        bankaccount: portal?.bankaccount ?? null,
        accountholder: portal?.accountholder ?? null,
        avatar_url: portal?.avatar_url ?? null,
        nricfront: portal?.nricfront ?? null,
        nricback: portal?.nricback ?? null,
        entity_type: portal?.entity_type ?? null,
        reg_no_type: portal?.reg_no_type ?? null,
        id_type: portal?.id_type ?? null,
        tax_id_no: portal?.tax_id_no ?? null,
        bank_refund_remark: portal?.bank_refund_remark ?? null,
        active: true,
        permission
      },
      staffDetailId: fromStaffDetail ? staffId : null,
      client: { id: client.id, title: client.title, active: true, currency: client.currency },
      plan: { mainPlan, addons },
      capability,
      credit: { ok: creditOk, balance: creditBalance },
      expired: { isExpired, expiredAt }
    };
  } catch (err) {
    console.error('[access] getAccessContextByEmailAndClient error:', err.message || err.code || err);
    if (err.sqlMessage) console.error('[access] sqlMessage:', err.sqlMessage);
    return { ok: false, reason: 'DB_ERROR', message: err.message || 'Database error' };
  }
}

/** True when MySQL reports missing table (Cleanlemons tables optional on Coliving-only DBs). */
function isClnTableMissingErr(err) {
  const msg = String(err?.sqlMessage || err?.message || '');
  return /doesn't exist/i.test(msg) || /Unknown table/i.test(msg);
}

/**
 * Cleanlemons: one portal email → supervisor scope via `cln_employeedetail` + `cln_employee_operator` (staff_role supervisor)
 * + other junctions. Used for operator dropdown (supervisor + field staff).
 */
async function getCleanlemonsPortalContext(email) {
  const normalizedEmail = normalizeEmail(email);
  const empty = {
    supervisorOperators: [],
    employee: null,
    employeeOperators: [],
    operatorChoices: []
  };
  if (!normalizedEmail) return { ...empty };

  try {
    const clnMaster = await resolveClnOperatordetailTable();
    let supRows = [];
    try {
      const [rows] = await pool.query(
        `SELECT eo.id AS supervisorId, eo.operator_id AS operatorId, o.name AS operatorName
         FROM cln_employee_operator eo
         INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
         INNER JOIN \`${clnMaster}\` o ON o.id = eo.operator_id
         WHERE LOWER(TRIM(d.email)) = ? AND eo.staff_role = 'supervisor'`,
        [normalizedEmail]
      );
      supRows = rows || [];
    } catch (e) {
      if (!isClnTableMissingErr(e)) throw e;
    }

    const supervisorOperators = [];
    for (const row of supRows) {
      if (row.operatorId) {
        supervisorOperators.push({
          supervisorId: String(row.supervisorId),
          operatorId: String(row.operatorId),
          operatorName: String(row.operatorName || '').trim() || '(operator)'
        });
      }
    }

    let employee = null;
    let empRows = [];
    try {
      const [rows] = await pool.query(
        `SELECT id, email, full_name, legal_name, nickname, phone, address, entity_type, id_type, id_number, tax_id_no,
                bank_id, bank_account_no, bank_account_holder, nric_front_url, nric_back_url, avatar_url
         FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
        [normalizedEmail]
      );
      empRows = rows || [];
    } catch (e) {
      if (!isClnTableMissingErr(e)) throw e;
    }

    if (empRows.length) {
      const r = empRows[0];
      employee = {
        id: String(r.id),
        email: r.email != null ? String(r.email) : '',
        fullName: r.full_name != null ? String(r.full_name) : null,
        legalName: r.legal_name != null ? String(r.legal_name) : null,
        nickname: r.nickname != null ? String(r.nickname) : null,
        phone: r.phone != null ? String(r.phone) : null,
        address: r.address != null ? String(r.address) : null,
        entityType: r.entity_type != null ? String(r.entity_type) : null,
        idType: r.id_type != null ? String(r.id_type) : null,
        idNumber: r.id_number != null ? String(r.id_number) : null,
        taxIdNo: r.tax_id_no != null ? String(r.tax_id_no) : null,
        bankId: r.bank_id != null ? String(r.bank_id) : null,
        bankAccountNo: r.bank_account_no != null ? String(r.bank_account_no) : null,
        bankAccountHolder: r.bank_account_holder != null ? String(r.bank_account_holder) : null,
        nricFrontUrl: r.nric_front_url != null ? String(r.nric_front_url) : null,
        nricBackUrl: r.nric_back_url != null ? String(r.nric_back_url) : null,
        avatarUrl: r.avatar_url != null ? String(r.avatar_url) : null
      };
    }

    const employeeOperators = [];
    if (employee?.id) {
      try {
        const [eoRows] = await pool.query(
          `SELECT eo.id AS junctionId, eo.operator_id AS operatorId, eo.staff_role AS staffRole, o.name AS operatorName
           FROM cln_employee_operator eo
           INNER JOIN \`${clnMaster}\` o ON o.id = eo.operator_id
           WHERE eo.employee_id = ?`,
          [employee.id]
        );
        for (const row of eoRows || []) {
          employeeOperators.push({
            junctionId: String(row.junctionId),
            operatorId: String(row.operatorId),
            operatorName: String(row.operatorName || '').trim() || '(operator)',
            staffRole: String(row.staff_role || 'cleaner')
          });
        }
      } catch (e) {
        if (!isClnTableMissingErr(e)) throw e;
      }
    }

    const byOp = new Map();
    function addChoice(opId, name, source) {
      if (!opId) return;
      const o = String(opId);
      if (!byOp.has(o)) {
        byOp.set(o, { operatorId: o, operatorName: name || '(operator)', sources: [] });
      }
      const entry = byOp.get(o);
      if (name && name !== '(operator)') entry.operatorName = name;
      if (!entry.sources.includes(source)) entry.sources.push(source);
    }
    for (const s of supervisorOperators) addChoice(s.operatorId, s.operatorName, 'supervisor');
    for (const e of employeeOperators) addChoice(e.operatorId, e.operatorName, 'employee');

    // Cleanlemons: `cln_operatordetail.email` = company master account; product rule — it is the master supervisor
    // for subscribed operators (pricing plan) and must not be cleared. Also covers portal when junction rows lag.
    try {
      const [masterByEmail] = await pool.query(
        `SELECT id, name FROM \`${clnMaster}\` WHERE LOWER(TRIM(email)) = ?`,
        [normalizedEmail]
      );
      for (const row of masterByEmail || []) {
        if (row.id) {
          addChoice(String(row.id), String(row.name || '').trim() || '(operator)', 'master');
        }
      }
    } catch (e) {
      if (!isClnTableMissingErr(e)) {
        console.warn('[access] getCleanlemonsPortalContext cln_operatordetail by email:', e?.message || e);
      }
    }

    const operatorChoices = Array.from(byOp.values()).sort((a, b) =>
      a.operatorName.localeCompare(b.operatorName, 'en')
    );

    return { supervisorOperators, employee, employeeOperators, operatorChoices };
  } catch (err) {
    console.warn('[access] getCleanlemonsPortalContext:', err?.message || err);
    return { ...empty };
  }
}

/**
 * Ensure `cln_employeedetail` has a row for this portal email (Staff/Driver/Dobi first visit).
 * Does not insert `cln_employee_operator` — binding remains via Operator Contacts only.
 */
async function ensureEmployeedetailForPortalEmail(email, fullNameOpt) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  try {
    const [exist] = await pool.query(
      'SELECT id, full_name FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalizedEmail]
    );
    if (exist.length) {
      const id = String(exist[0].id);
      const fn = exist[0].full_name;
      const wantName = fullNameOpt != null && String(fullNameOpt).trim() ? String(fullNameOpt).trim() : '';
      if (wantName && (fn == null || String(fn).trim() === '')) {
        await pool.query(
          'UPDATE cln_employeedetail SET full_name = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
          [wantName, id]
        );
      }
      return { ok: true, employeeId: id, created: false };
    }
    const id = randomUUID();
    const initialName =
      fullNameOpt != null && String(fullNameOpt).trim() ? String(fullNameOpt).trim() : null;
    await pool.query(
      `INSERT INTO cln_employeedetail (id, email, full_name, phone, account, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [id, normalizedEmail, initialName, '[]']
    );
    return { ok: true, employeeId: id, created: true };
  } catch (err) {
    if (isClnTableMissingErr(err)) {
      return { ok: false, reason: 'TABLE_MISSING' };
    }
    console.warn('[access] ensureEmployeedetailForPortalEmail:', err?.message || err);
    return { ok: false, reason: 'DB_ERROR', message: err.message || String(err) };
  }
}

/**
 * Get all roles for a member (one email = one member). Email comparison is case-insensitive.
 * Returns { ok, email (normalized), roles: [ { type, ... } ] } for use by portal "choose identity" UI.
 */
async function getMemberRoles(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { ok: false, reason: 'NO_EMAIL', roles: [] };
  }

  const roles = [];
  const clientIdsSeen = new Set();

  for (let attempt = 0; attempt < 2; attempt++) {
    roles.length = 0;
    clientIdsSeen.clear();
    try {
      // SaaS platform admin — no dependency on operatordetail / getOperatorMasterTableName (those can throw).
      const [saasAdminRowsFirst] = await pool.query(
        'SELECT id FROM saasadmin WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalizedEmail]
      );
      if (saasAdminRowsFirst.length > 0) {
        roles.push({ type: 'saas_admin', platformAdmin: true });
      }

      const opTable = await getOperatorMasterTableName();

      // Operator: client_user (Company Setting users) first
      const [userRows] = await pool.query(
        `SELECT u.id AS staffId, u.client_id AS clientId, c.title AS clientTitle
       FROM client_user u
       LEFT JOIN \`${opTable}\` c ON c.id = u.client_id
       WHERE LOWER(TRIM(u.email)) = ? AND u.status = 1 AND u.client_id IS NOT NULL`,
        [normalizedEmail]
      );
      for (const row of userRows) {
        if (row.clientId && row.clientTitle != null) {
          clientIdsSeen.add(row.clientId);
          roles.push({
            type: 'staff',
            staffId: row.staffId,
            clientId: row.clientId,
            clientTitle: row.clientTitle || ''
          });
        }
      }
      // Staff (Contact Setting): staffdetail rows for clients not already from client_user
      const [staffRows] = await pool.query(
        `SELECT s.id AS staffId, s.client_id AS clientId, c.title AS clientTitle
       FROM staffdetail s
       LEFT JOIN \`${opTable}\` c ON c.id = s.client_id
       WHERE LOWER(TRIM(s.email)) = ? AND s.status = 1 AND s.client_id IS NOT NULL`,
        [normalizedEmail]
      );
      for (const row of staffRows) {
        if (row.clientId && row.clientTitle != null && !clientIdsSeen.has(row.clientId)) {
          clientIdsSeen.add(row.clientId);
          roles.push({
            type: 'staff',
            staffId: row.staffId,
            clientId: row.clientId,
            clientTitle: row.clientTitle || ''
          });
        }
      }

      // Cleanlemons: portal.cleanlemons.com/operator — supervisor via employeedetail + employee_operator
      try {
        const clnMaster = await resolveClnOperatordetailTable();
        const [clnSupRows] = await pool.query(
          `SELECT eo.id AS staffId, eo.operator_id AS clientId, o.name AS clientTitle
           FROM cln_employee_operator eo
           INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
           INNER JOIN \`${clnMaster}\` o ON o.id = eo.operator_id
           WHERE LOWER(TRIM(d.email)) = ? AND eo.staff_role = 'supervisor'`,
          [normalizedEmail]
        );
        for (const row of clnSupRows) {
          if (row.clientId && row.clientTitle != null && !clientIdsSeen.has(row.clientId)) {
            clientIdsSeen.add(row.clientId);
            roles.push({
              type: 'staff',
              staffId: row.staffId,
              clientId: row.clientId,
              clientTitle: row.clientTitle || ''
            });
          }
        }
      } catch (e) {
        const msg = String(e?.sqlMessage || e?.message || '');
        if (!msg.includes("doesn't exist") && !msg.includes("Unknown table")) {
          console.warn('[access] getMemberRoles cln_employeedetail supervisor:', msg);
        }
      }

      // Cleanlemons: same as cln_operatordetail.company email = master supervisor (required for subscribed co.); not optional to remove in product.
      try {
        const clnMasterOd = await resolveClnOperatordetailTable();
        const [clnOdByEmail] = await pool.query(
          `SELECT id AS operatorId, name AS operatorName FROM \`${clnMasterOd}\` WHERE LOWER(TRIM(email)) = ?`,
          [normalizedEmail]
        );
        for (const row of clnOdByEmail || []) {
          const oid = row.operatorId;
          if (oid && !clientIdsSeen.has(oid)) {
            clientIdsSeen.add(oid);
            roles.push({
              type: 'staff',
              staffId: oid,
              clientId: oid,
              clientTitle: row.operatorName != null ? String(row.operatorName) : ''
            });
          }
        }
      } catch (e) {
        const msg = String(e?.sqlMessage || e?.message || '');
        if (!msg.includes("doesn't exist") && !msg.includes("Unknown table")) {
          console.warn('[access] getMemberRoles cln_operatordetail by email:', msg);
        }
      }

      // Tenant: at most one tenantdetail row
      const [tenantRows] = await pool.query(
        'SELECT id FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalizedEmail]
      );
      if (tenantRows.length) {
        roles.push({ type: 'tenant', tenantId: tenantRows[0].id });
      }

      // Owner: at most one ownerdetail row (optionally attach client list for display)
      const [ownerRows] = await pool.query(
        'SELECT id FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalizedEmail]
      );
      if (ownerRows.length) {
        roles.push({ type: 'owner', ownerId: ownerRows[0].id });
      }

      // registered = 可註冊/登入 Portal，只要 email 在任一身分表存在
      const [clientRows] = await pool.query(
        `SELECT 1 FROM \`${opTable}\` WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
        [normalizedEmail]
      );
      const registered = roles.length > 0 || clientRows.length > 0;
      let cleanlemons = null;
      try {
        cleanlemons = await getCleanlemonsPortalContext(normalizedEmail);
      } catch (e) {
        console.warn('[access] getCleanlemonsPortalContext (member-roles):', e?.message || e);
      }
      return { ok: true, email: normalizedEmail, roles, registered, cleanlemons };
    } catch (err) {
      if (attempt === 0 && isOperatorMasterTableMissingErr(err)) {
        console.warn('[access] getMemberRoles: operator table missing, clearing cache and retrying');
        resetOperatorMasterTableCacheForTests();
        continue;
      }
      /** SaaS row was already merged; later master-table / tenant queries may throw on local DB — still return portal card. */
      if (roles.some((r) => String(r.type || '').toLowerCase() === 'saas_admin')) {
        let cleanlemonsPartial = null;
        try {
          cleanlemonsPartial = await getCleanlemonsPortalContext(normalizedEmail);
        } catch (e) {
          console.warn('[access] getCleanlemonsPortalContext (saas partial recover):', e?.message || e);
        }
        return {
          ok: true,
          email: normalizedEmail,
          roles,
          registered: true,
          cleanlemons: cleanlemonsPartial
        };
      }
      console.error('[access] getMemberRoles error:', err.message || err.code || err);
      if (err.sqlMessage) console.error('[access] sqlMessage:', err.sqlMessage);

      // If staff/operator/cln queries failed, still allow SaaS Admin when email is in saasadmin (fixes missing Admin card).
      try {
        const [saasOnly] = await pool.query(
          'SELECT id FROM saasadmin WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalizedEmail]
        );
        if (saasOnly.length > 0) {
          let cleanlemons = null;
          try {
            cleanlemons = await getCleanlemonsPortalContext(normalizedEmail);
          } catch (e) {
            console.warn('[access] getCleanlemonsPortalContext (saas-only fallback):', e?.message || e);
          }
          return {
            ok: true,
            email: normalizedEmail,
            roles: [{ type: 'saas_admin', platformAdmin: true }],
            registered: true,
            cleanlemons
          };
        }
      } catch (e2) {
        console.warn('[access] getMemberRoles saasadmin fallback:', e2?.message || e2);
      }

      return { ok: false, reason: 'DB_ERROR', message: err.message || 'Database error', roles: [] };
    }
  }
  return { ok: false, reason: 'DB_ERROR', message: 'Database error', roles: [] };
}

module.exports = {
  normalizeEmail,
  getAccessContextByEmail,
  getAccessContextByEmailAndClient,
  getMemberRoles,
  getCleanlemonsPortalContext,
  ensureEmployeedetailForPortalEmail,
  ACCOUNTING_PLAN_IDS,
  THIRD_PARTY_INTEGRATION_PLAN_IDS,
  isCleanlemonsPartnerCurrency
};
