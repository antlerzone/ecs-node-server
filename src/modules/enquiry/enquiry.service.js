/**
 * Enquiry – public page (no login).
 * Lists pricing plans, addons, banks for display; submits demo registration (client + staff + client_profile).
 * New clients are status=0 (inactive); activation and billing are done via Indoor Admin manual billing.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');

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

/** Default admin permission for demo staff (full access). */
const DEMO_STAFF_PERMISSION = [
  'profilesetting', 'usersetting', 'integration', 'billing', 'finance',
  'tenantdetail', 'propertylisting', 'marketing', 'booking', 'admin'
];

/**
 * Public: list all pricing plans for enquiry page (no auth). No filter – pricingplan has no currency/country column.
 * Returns array of { id, _id, title, description, features, sellingprice, corecredit }.
 */
async function getPlansPublic() {
  const [rows] = await pool.query(
    'SELECT id, title, description, features_json, sellingprice, corecredit FROM pricingplan ORDER BY sellingprice ASC'
  );
  return rows.map((r) => {
    const features = parseJson(r.features_json);
    return {
      id: r.id,
      _id: r.id,
      title: r.title || '',
      description: r.description || '',
      features: Array.isArray(features) ? features : features != null ? [features] : [],
      sellingprice: r.sellingprice != null ? Number(r.sellingprice) : 0,
      corecredit: r.corecredit != null ? Number(r.corecredit) : 0
    };
  });
}

/**
 * Public: list pricing plan addons for enquiry page (no auth).
 * Returns array of { id, _id, title, description, credit, qty }; credit from credit_json for display.
 */
async function getAddonsPublic() {
  const [rows] = await pool.query(
    'SELECT id, title, description_json, credit_json, qty FROM pricingplanaddon ORDER BY id'
  );
  return rows.map((r) => {
    const desc = parseJson(r.description_json);
    const creditRaw = parseJson(r.credit_json);
    const creditDisplay = Array.isArray(creditRaw)
      ? (creditRaw[0] != null ? String(creditRaw[0]) : '')
      : (creditRaw != null ? String(creditRaw) : '');
    return {
      id: r.id,
      _id: r.id,
      title: r.title || '',
      description: Array.isArray(desc) ? desc : desc != null ? [desc] : [],
      credit: creditDisplay,
      qty: r.qty != null ? Number(r.qty) : 1
    };
  });
}

/**
 * Public: list banks for enquiry page dropdown (no auth).
 */
async function getBanksPublic() {
  const [rows] = await pool.query('SELECT id, bankname FROM bankdetail ORDER BY bankname');
  return {
    ok: true,
    items: rows.map((r) => ({ id: r.id, label: r.bankname || '', value: r.id }))
  };
}

/** SaaS 示範公司 client_id，訪客在 enquiry 階段先掛在此 client 下當 staff（master admin），manual billing 開戶後再轉到自家 client。 */
const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID || 'a0000001-0001-4000-8000-000000000001';

/**
 * Submit enquiry: 建立一間公司 (client) + 訪客 email 成為 demoaccount 下的 staff（master admin，不可刪）。
 * 不付款；client status=0，等 Indoor Admin 在 manual billing 開 package 後，該 staff 會從 demo 轉到該 client 名下。
 * Body: { title, email, currency?, country?, profilePhotoUrl?, contact?, accountNumber?, bankId? }
 */
async function submitEnquiry(payload) {
  const title = (payload.title || '').trim();
  const email = (payload.email || '').trim().toLowerCase();
  if (!title || !email) {
    return { ok: false, reason: 'MISSING_REQUIRED_FIELDS' };
  }

  const [existing] = await pool.query(
    'SELECT id FROM clientdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [email]
  );
  if (existing.length) {
    return { ok: false, reason: 'EMAIL_ALREADY_REGISTERED' };
  }

  const clientId = randomUUID();
  const staffId = randomUUID();
  const profileId = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  const currency = (payload.currency || 'MYR').toUpperCase();
  const profilePhotoUrl = payload.profilePhotoUrl && String(payload.profilePhotoUrl).trim() ? String(payload.profilePhotoUrl).trim() : null;
  const contact = (payload.contact || '').trim().replace(/\D/g, '').slice(0, 50) || null;
  const accountNumber = (payload.accountNumber || '').replace(/\D/g, '').slice(0, 100) || null;
  const bankId = payload.bankId && String(payload.bankId).trim() ? String(payload.bankId).trim() : null;

  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO clientdetail (id, title, email, status, currency, profilephoto, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
      [clientId, title, email, currency, profilePhotoUrl, now, now]
    );

    // 訪客先掛在 demoaccount（DEMO_CLIENT_ID）下當 master admin，開戶後再轉到自家 client
    await conn.query(
      `INSERT INTO staffdetail (id, name, email, permission_json, status, client_id, is_master, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?)`,
      [staffId, title || 'Demo User', email, JSON.stringify(DEMO_STAFF_PERMISSION), DEMO_CLIENT_ID, now, now]
    );

    await conn.query(
      `INSERT INTO client_profile (id, client_id, currency, contact, accountnumber, bank_id, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [profileId, clientId, currency, contact, accountNumber, bankId, now, now]
    );

    return {
      ok: true,
      clientId,
      staffId,
      email
    };
  } finally {
    conn.release();
  }
}

module.exports = {
  getPlansPublic,
  getAddonsPublic,
  getBanksPublic,
  submitEnquiry
};
