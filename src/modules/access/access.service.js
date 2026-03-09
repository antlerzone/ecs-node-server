/**
 * Access context – single source of truth (migrated from Wix backend/access/manage.jsw).
 * Uses MySQL: staffdetail, clientdetail, client_credit, client_pricingplan_detail, client_integration, account, account_client.
 */

const pool = require('../../config/db');

// Plan IDs that allow Accounting / Account capability (pricingplan.id from MySQL)
const ACCOUNTING_PLAN_IDS = [
  '896357c8-1155-47de-9d3c-15055a4820aa',
  '06af7357-f9c8-4319-98c3-b24e1fa7ae27'
];

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
 * Tables: staffdetail, clientdetail, client_credit, client_pricingplan_detail, client_integration.
 * capability.accounting = plan allows; capability.accountProvider = onboarded provider or null;
 * capability.accountingReady = onboarded + all Account Setting items synced (account_client mapping count = account count).
 */
async function getAccessContextByEmail(email) {
  if (!email) {
    return { ok: false, reason: 'NO_EMAIL' };
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  try {
    const [staffRows] = await pool.query(
      'SELECT id, email, status, client_id, permission_json FROM staffdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalizedEmail]
    );

    if (!staffRows.length) {
      return { ok: false, reason: 'NO_STAFF' };
    }

    const staff = staffRows[0];
    const staffId = staff.id;
    const clientId = staff.client_id;

    if (staff.status !== 1 && staff.status !== true) {
      return { ok: false, reason: 'STAFF_INACTIVE' };
    }

    if (!clientId) {
      return { ok: false, reason: 'NO_CLIENT' };
    }

    const [clientRows] = await pool.query(
      'SELECT id, title, status, currency, expired FROM clientdetail WHERE id = ? LIMIT 1',
      [clientId]
    );

    if (!clientRows.length) {
      return { ok: false, reason: 'CLIENT_NOT_FOUND' };
    }

    const client = clientRows[0];

    if (client.status !== 1 && client.status !== true) {
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

    const hasAnyPermission = Object.values(permission).some(Boolean);
    if (!hasAnyPermission) {
      return {
        ok: false,
        reason: 'NO_PERMISSION',
        staffId,
        clientId: client.id
      };
    }

    // Credit: first row amount (match Velo client.credit[0].amount)
    const [creditRows] = await pool.query(
      'SELECT amount FROM client_credit WHERE client_id = ? ORDER BY id ASC LIMIT 1',
      [clientId]
    );
    let creditBalance = 0;
    if (creditRows.length) {
      creditBalance = Number(creditRows[0].amount) || 0;
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

    const capability = {
      accounting: !!(mainPlan && ACCOUNTING_PLAN_IDS.includes(mainPlan.planId)),
      accountProvider: accountProvider || null,
      accountingReady,
      accountingSyncedTotal: accountProvider ? accountingSyncedTotal : null,
      accountingSyncedMapped: accountProvider ? accountingSyncedMapped : null
    };

    return {
      ok: true,
      reason: 'OK',
      staff: {
        id: staffId,
        email: staff.email,
        active: true,
        permission
      },
      client: {
        id: client.id,
        title: client.title,
        active: true,
        currency: client.currency || 'MYR'
      },
      plan: { mainPlan, addons },
      capability,
      credit: { ok: creditOk, balance: creditBalance },
      expired: { isExpired, expiredAt }
    };
  } catch (err) {
    console.error('[access] getAccessContextByEmail error:', err.message || err.code || err);
    if (err.sqlMessage) console.error('[access] sqlMessage:', err.sqlMessage);
    return { ok: false, reason: 'DB_ERROR', message: err.message || 'Database error' };
  }
}

module.exports = {
  getAccessContextByEmail,
  ACCOUNTING_PLAN_IDS
};
