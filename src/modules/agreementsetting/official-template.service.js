/**
 * Official agreement templates – credit purchase per client; .docx via Drive export (SA must access Doc).
 */

const fs = require('fs');
const { google } = require('googleapis');
const pool = require('../../config/db');
const { deductClientCreditSpending } = require('../billing/deduction.service');
const { clearBillingCacheByClientId } = require('../billing/billing.service');

function permissionToArray(permission) {
  if (Array.isArray(permission)) return permission;
  if (typeof permission === 'string') {
    return permission.split(',').map((p) => p.trim()).filter(Boolean);
  }
  if (permission && typeof permission === 'object') {
    return Object.values(permission);
  }
  return [];
}

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
    Object.keys(permission).forEach((k) => {
      permission[k] = true;
    });
  }
  return permission;
}

let _warnedMissingGoogleApplicationCredentialsFile = false;

function getGoogleAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (keyJson) {
    try {
      const key = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
      return new google.auth.GoogleAuth({
        credentials: key,
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive'
        ]
      });
    } catch {
      return null;
    }
  }
  const keyPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (keyPath) {
    if (!fs.existsSync(keyPath)) {
      if (!_warnedMissingGoogleApplicationCredentialsFile) {
        _warnedMissingGoogleApplicationCredentialsFile = true;
        console.warn(
          '[official-template] GOOGLE_APPLICATION_CREDENTIALS file missing; ignoring:',
          keyPath
        );
      }
      return null;
    }
    return new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive'
      ]
    });
  }
  return null;
}

function extractGoogleDocId(urlOrId) {
  if (!urlOrId) return null;
  const s = String(urlOrId).trim();
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  const m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function sanitizeFilename(name) {
  const base = String(name || 'agreement-template')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || 'agreement-template';
}

function staffHasFinanceOrBilling(permissionOrJson) {
  if (!permissionOrJson) return false;
  if (
    typeof permissionOrJson === 'object' &&
    !Array.isArray(permissionOrJson) &&
    ('finance' in permissionOrJson || 'billing' in permissionOrJson || 'admin' in permissionOrJson)
  ) {
    const p = permissionOrJson;
    return !!(p.finance || p.billing || p.admin);
  }
  const perm = buildPermission(permissionToArray(permissionOrJson));
  return !!(perm.finance || perm.billing || perm.admin);
}

async function listOfficialTemplates(clientId) {
  const [rows] = await pool.query(
    `SELECT t.id, t.agreementname, t.url, t.credit, t.sort_order,
            CASE WHEN p.client_id IS NOT NULL THEN 1 ELSE 0 END AS owned,
            p.purchased_at
       FROM official_agreement_template t
       LEFT JOIN client_official_template_purchase p
         ON p.template_id = t.id AND p.client_id = ?
      WHERE t.active = 1
      ORDER BY t.sort_order ASC, t.agreementname ASC`,
    [clientId]
  );
  return rows.map((r) => ({
    id: r.id,
    agreementname: r.agreementname,
    url: r.url,
    credit: Number(r.credit) || 0,
    sort_order: r.sort_order,
    owned: !!r.owned,
    purchased_at: r.purchased_at || null
  }));
}

/**
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} opts.clientId
 * @param {string[]} opts.templateIds
 * @param {object} opts.staffPermission - ctx.staff.permission or permission_json
 * @param {string|null} opts.staffDetailId - creditlogs.staff_id (staffdetail only; null for client_user)
 */
async function purchaseOfficialTemplates({ clientId, templateIds, staffPermission, staffDetailId }) {
  if (!staffHasFinanceOrBilling(staffPermission)) {
    return { ok: false, reason: 'NO_PERMISSION', message: 'Only Finance or Billing can purchase.' };
  }
  const ids = [...new Set((templateIds || []).filter(Boolean))];
  if (!ids.length) {
    return { ok: false, reason: 'NO_SELECTION' };
  }

  const placeholders = ids.map(() => '?').join(',');
  const [templates] = await pool.query(
    `SELECT id, agreementname, credit FROM official_agreement_template
      WHERE id IN (${placeholders}) AND active = 1`,
    ids
  );
  if (templates.length !== ids.length) {
    return { ok: false, reason: 'INVALID_TEMPLATE' };
  }

  const [ownedRows] = await pool.query(
    `SELECT template_id FROM client_official_template_purchase
      WHERE client_id = ? AND template_id IN (${placeholders})`,
    [clientId, ...ids]
  );
  const ownedSet = new Set(ownedRows.map((r) => r.template_id));
  const toBuy = templates.filter((t) => !ownedSet.has(t.id));
  if (!toBuy.length) {
    return { ok: false, reason: 'ALREADY_OWNED' };
  }

  const total = toBuy.reduce((s, t) => s + (Number(t.credit) || 0), 0);
  if (total <= 0) {
    return { ok: false, reason: 'ZERO_CREDIT' };
  }

  const staffId = staffDetailId || null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await deductClientCreditSpending(
      clientId,
      total,
      `Official template: ${toBuy.map((t) => t.agreementname).join(', ')}`.slice(0, 500),
      staffId,
      { officialTemplates: toBuy.map((t) => ({ id: t.id, credit: t.credit })) },
      conn
    );
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (const t of toBuy) {
      await conn.query(
        `INSERT INTO client_official_template_purchase (client_id, template_id, purchased_at)
         VALUES (?, ?, ?)`,
        [clientId, t.id, now]
      );
    }
    await conn.commit();
    clearBillingCacheByClientId(clientId);
    return {
      ok: true,
      purchased: toBuy.map((t) => ({ id: t.id, agreementname: t.agreementname })),
      deducted: total
    };
  } catch (err) {
    await conn.rollback();
    const msg = err?.message || String(err);
    if (msg.includes('CLIENT_INVALID')) {
      return { ok: false, reason: 'CLIENT_INVALID' };
    }
    if (msg.includes('INSUFFICIENT_CREDIT')) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_CREDIT',
        message: 'Not enough credits. Top up or use core credits with a valid expiry before purchasing.'
      };
    }
    console.error('[official-template] purchase', err);
    return { ok: false, reason: 'PURCHASE_FAILED', message: msg };
  } finally {
    conn.release();
  }
}

async function assertClientOwnsTemplate(clientId, templateId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM client_official_template_purchase
      WHERE client_id = ? AND template_id = ? LIMIT 1`,
    [clientId, templateId]
  );
  return rows.length > 0;
}

async function exportOfficialTemplateDocx(clientId, templateId) {
  const owns = await assertClientOwnsTemplate(clientId, templateId);
  if (!owns) {
    return { ok: false, reason: 'NOT_PURCHASED', status: 403 };
  }
  const [rows] = await pool.query(
    `SELECT agreementname, url FROM official_agreement_template WHERE id = ? AND active = 1 LIMIT 1`,
    [templateId]
  );
  if (!rows.length) {
    return { ok: false, reason: 'TEMPLATE_NOT_FOUND', status: 404 };
  }
  const { agreementname, url } = rows[0];
  const docId = extractGoogleDocId(url);
  if (!docId) {
    return { ok: false, reason: 'BAD_DOC_URL', message: 'Invalid Google Doc URL.', status: 400 };
  }
  const auth = getGoogleAuth();
  if (!auth) {
    return {
      ok: false,
      reason: 'GOOGLE_NOT_CONFIGURED',
      message: 'Server Google credentials missing; cannot export .docx.',
      status: 503
    };
  }
  try {
    const client = await auth.getClient();
    const drive = google.drive({ version: 'v3', auth: client });
    const exportRes = await drive.files.export(
      {
        fileId: docId,
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(exportRes.data);
    const filename = `${sanitizeFilename(agreementname)}.docx`;
    return {
      ok: true,
      buffer,
      filename,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
  } catch (err) {
    console.error('[official-template] drive export', err?.message, err?.code);
    const status = err?.code === 404 ? 404 : 502;
    return {
      ok: false,
      reason: 'EXPORT_FAILED',
      message:
        err?.message ||
        'Export failed. Share the Google Doc with your service account email (Viewer).',
      status
    };
  }
}

module.exports = {
  listOfficialTemplates,
  purchaseOfficialTemplates,
  exportOfficialTemplateDocx,
  staffHasFinanceOrBilling,
  extractGoogleDocId
};
