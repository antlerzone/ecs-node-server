/**
 * Enquiry – public page (no login).
 * Lists pricing plans, addons, banks for display; submits lead (client + client_profile only).
 * Demo 统一用 demo.colivingjb.com；live 用 portal.colivingjb.com。不再为填写 enquiry 的顾客创建 demo 户口（staff）。
 * New clients are status=0 (inactive); activation and billing are done via Indoor Admin manual billing; 開戶時會新建 master admin。
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { isRetiredPricingPlanAddon } = require('../../utils/pricingPlanAddonCatalog');
const { normalizeEmail } = require('../access/access.service');

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
  return rows.filter((r) => !isRetiredPricingPlanAddon(r.title)).map((r) => {
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

/**
 * Public: list credit plans for pricing page (no auth). From creditplan table.
 * Returns array of { id, title, sellingprice, credit } for Flex Credit display.
 */
async function getCreditPlansPublic() {
  const [rows] = await pool.query(
    'SELECT id, title, sellingprice, credit FROM creditplan ORDER BY credit ASC'
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title || '',
    sellingprice: r.sellingprice != null ? Number(r.sellingprice) : 0,
    credit: r.credit != null ? Number(r.credit) : 0
  }));
}

/**
 * Submit enquiry: 只建立 lead（client + client_profile），不创建 demo 户口。
 * 顾客试用请用 demo.colivingjb.com；正式用 portal.colivingjb.com。
 * client status=0；Indoor Admin manual billing 開戶後會為該 client 新建 master admin（ensureMasterAdminStaffForClient）。
 * Body: { title, email, currency?, country?, profilePhotoUrl?, contact?, accountNumber?, bankId?, remark?, number_of_units?, plan_of_interest? }
 */
async function submitEnquiry(payload) {
  const title = (payload.title || '').trim();
  const email = (payload.email || '').trim().toLowerCase();
  if (!title || !email) {
    return { ok: false, reason: 'MISSING_REQUIRED_FIELDS' };
  }

  const [existing] = await pool.query(
    'SELECT id FROM operatordetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [email]
  );
  if (existing.length) {
    return { ok: false, reason: 'EMAIL_ALREADY_REGISTERED' };
  }

  const clientId = randomUUID();
  const profileId = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  const rawCurrency = payload.currency != null ? String(payload.currency).trim().toUpperCase() : '';
  const derivedFromCountry = (() => {
    const c = payload.country != null ? String(payload.country).trim().toUpperCase() : '';
    if (!c) return '';
    if (c === 'SG' || c === 'SINGAPORE') return 'SGD';
    if (c === 'MY' || c === 'MALAYSIA') return 'MYR';
    return '';
  })();
  const currency = rawCurrency || derivedFromCountry;
  if (!currency) return { ok: false, reason: 'MISSING_CLIENT_CURRENCY' };
  if (!['MYR', 'SGD'].includes(currency)) return { ok: false, reason: 'UNSUPPORTED_CLIENT_CURRENCY' };
  const profilePhotoUrl = payload.profilePhotoUrl && String(payload.profilePhotoUrl).trim() ? String(payload.profilePhotoUrl).trim() : null;
  const contact = (payload.contact || '').trim().replace(/\D/g, '').slice(0, 50) || null;
  const accountNumber = (payload.accountNumber || '').replace(/\D/g, '').slice(0, 100) || null;
  const bankId = payload.bankId && String(payload.bankId).trim() ? String(payload.bankId).trim() : null;
  const enquiryRemark = (payload.remark || payload.enquiry_remark || '').trim().slice(0, 500) || null;
  const enquiryUnits = (payload.number_of_units != null ? String(payload.number_of_units) : payload.numberOfUnits != null ? String(payload.numberOfUnits) : '').trim().slice(0, 50) || null;
  const enquiryPlan = (payload.plan_of_interest || payload.planOfInterest || '').trim().slice(0, 255) || null;

  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO operatordetail (id, title, email, status, currency, profilephoto, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
      [clientId, title, email, currency, profilePhotoUrl, now, now]
    );

    try {
      await conn.query(
        `INSERT INTO client_profile (id, client_id, currency, contact, accountnumber, bank_id, is_demo, enquiry_remark, enquiry_units, enquiry_plan_of_interest, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [profileId, clientId, currency, contact, accountNumber, bankId, enquiryRemark, enquiryUnits, enquiryPlan, now, now]
      );
    } catch (profileErr) {
      if (profileErr?.code === 'ER_BAD_FIELD_ERROR' || (profileErr?.message && /Unknown column 'enquiry_/.test(profileErr.message))) {
        await conn.query(
          `INSERT INTO client_profile (id, client_id, currency, contact, accountnumber, bank_id, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [profileId, clientId, currency, contact, accountNumber, bankId, now, now]
        );
      } else {
        throw profileErr;
      }
    }

    return {
      ok: true,
      clientId,
      email
    };
  } catch (err) {
    const isStaffFk = err?.message && /staffdetail.*foreign key|fk_staffdetail_client/i.test(err.message);
    console.error('[enquiry] submit', err);
    if (isStaffFk) {
      return {
        ok: false,
        reason: 'DB_TRIGGER_STAFF_FK',
        message: 'Enquiry could not be saved: a database trigger on operatordetail/client_profile inserts into staffdetail before the client row is visible. Ask DBA to drop BEFORE INSERT triggers on operatordetail or fix the trigger to use AFTER INSERT.'
      };
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Portal JWT 已驗證 email：查是否已有 operatordetail。
 */
async function getOperatorProfileByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };
  const [rows] = await pool.query(
    `SELECT od.id, od.title, od.email, od.status, od.currency, od.expired, od.pricingplandetail, cp.contact AS profile_contact
     FROM operatordetail od
     LEFT JOIN client_profile cp ON cp.client_id = od.id
     WHERE LOWER(TRIM(od.email)) = ? LIMIT 1`,
    [normalized]
  );
  if (!rows.length) return { ok: true, hasOperator: false };
  const od = rows[0];
  let hasActivePlan = false;
  try {
    const raw = od.pricingplandetail;
    const ppd = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    hasActivePlan = Array.isArray(ppd) && ppd.some((x) => x && x.type === 'plan');
  } catch (_) {
    hasActivePlan = false;
  }
  const contactRaw = od.profile_contact != null ? String(od.profile_contact).trim() : '';
  const contact = contactRaw ? contactRaw.replace(/\D/g, '').slice(0, 50) : null;
  return {
    ok: true,
    hasOperator: true,
    operator: {
      id: od.id,
      title: od.title,
      email: od.email,
      status: od.status,
      currency: od.currency,
      expired: od.expired,
      hasActivePlan,
      contact: contact || null
    }
  };
}

/**
 * 已登入訪客提交資料：email 強制使用 JWT，忽略 body.email。
 */
async function submitEnquiryForVerifiedEmail(email, payload = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };
  return submitEnquiry({ ...(typeof payload === 'object' && payload ? payload : {}), email: normalized });
}

/**
 * Portal onboarding：若尚無 operatordetail，以 JWT email + country（MY|SG）建立最小 lead（title 用邮箱前缀）。
 * 若已有 operatordetail，直接返回與 getOperatorProfileByEmail 相同結構。
 * Body.contact：手機（Google OAuth 無號碼時必填於新戶）。
 */
function sanitizeEnquiryContact(payload) {
  const raw = payload.contact != null ? String(payload.contact).trim() : '';
  return raw.replace(/\D/g, '').slice(0, 50);
}

/**
 * JWT：補寫 client_profile.contact（已有 operatordetail、尚無有效號碼時）。
 */
async function updateEnquiryContactForVerifiedEmail(email, payload = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };
  const contact = sanitizeEnquiryContact(payload);
  if (contact.length < 6) return { ok: false, reason: 'INVALID_CONTACT' };

  const [odRows] = await pool.query(
    'SELECT id, currency FROM operatordetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  if (!odRows.length) return { ok: false, reason: 'NO_OPERATOR_PROFILE' };
  const clientId = odRows[0].id;
  const cur = String(odRows[0].currency || 'MYR')
    .trim()
    .toUpperCase();
  const currency = ['MYR', 'SGD'].includes(cur) ? cur : 'MYR';
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  const [profRows] = await pool.query('SELECT id FROM client_profile WHERE client_id = ? LIMIT 1', [clientId]);
  if (profRows.length) {
    await pool.query('UPDATE client_profile SET contact = ?, updated_at = ? WHERE client_id = ?', [contact, now, clientId]);
  } else {
    const profileId = randomUUID();
    await pool.query(
      `INSERT INTO client_profile (id, client_id, currency, contact, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [profileId, clientId, currency, contact, now, now]
    );
  }
  return getOperatorProfileByEmail(normalized);
}

async function ensureOperatorForVerifiedEmail(email, payload = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };
  const existing = await getOperatorProfileByEmail(normalized);
  if (!existing.ok) return existing;
  if (existing.hasOperator) return existing;
  const countryRaw = payload.country != null ? String(payload.country).trim().toUpperCase() : 'MY';
  const country = countryRaw === 'SG' ? 'SG' : 'MY';
  const titleBase = normalized.split('@')[0] || 'Coliving operator';
  const title = titleBase.slice(0, 200);
  const contact = sanitizeEnquiryContact(payload);
  if (contact.length < 6) {
    return { ok: false, reason: 'INVALID_CONTACT' };
  }
  const created = await submitEnquiry({
    title,
    email: normalized,
    country,
    currency: country === 'SG' ? 'SGD' : 'MYR',
    contact
  });
  if (created.ok === false) {
    if (created.reason === 'EMAIL_ALREADY_REGISTERED') {
      return getOperatorProfileByEmail(normalized);
    }
    return created;
  }
  return getOperatorProfileByEmail(normalized);
}

/**
 * SGD operatordetail: write plan + remark to client_profile so SaaS Admin → Enquiry tab shows the request (MYR uses Billplz).
 */
async function submitSgdPlanEnquiryForVerifiedEmail(email, payload = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };
  const planId = payload.planId != null ? String(payload.planId).trim() : '';
  if (!planId) return { ok: false, reason: 'MISSING_PLAN_ID' };

  const [odRows] = await pool.query(
    'SELECT id, currency FROM operatordetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  if (!odRows.length) return { ok: false, reason: 'NO_OPERATOR_PROFILE' };
  const od = odRows[0];
  const cur = String(od.currency || '').trim().toUpperCase();
  if (cur !== 'SGD' && cur !== 'MYR') {
    return { ok: false, reason: 'UNSUPPORTED_CURRENCY' };
  }

  const [planRows] = await pool.query('SELECT title FROM pricingplan WHERE id = ? LIMIT 1', [planId]);
  if (!planRows.length) return { ok: false, reason: 'INVALID_PLAN' };
  const planTitle = String(planRows[0].title || '').trim() || planId;

  const receiptUrl = payload.receiptUrl != null ? String(payload.receiptUrl).trim() : '';
  const receiptSuffix = receiptUrl ? ` Receipt: ${receiptUrl.slice(0, 400)}` : '';
  const remark =
    cur === 'SGD'
      ? `Portal /enquiry: SGD — manual billing requested (skip transaction fees)${receiptSuffix}`
      : `Portal /enquiry: MYR — manual billing requested (skip transaction fees)${receiptSuffix}`;
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  const [profRows] = await pool.query('SELECT id FROM client_profile WHERE client_id = ? LIMIT 1', [od.id]);

  try {
    if (profRows.length) {
      try {
        await pool.query(
          `UPDATE client_profile SET enquiry_plan_of_interest = ?, enquiry_remark = ?, enquiry_acknowledged_at = NULL, updated_at = ? WHERE client_id = ?`,
          [planTitle.slice(0, 255), remark.slice(0, 500), now, od.id]
        );
      } catch (e) {
        if (e?.code === 'ER_BAD_FIELD_ERROR' || (e?.message && /enquiry_acknowledged_at/.test(String(e.message)))) {
          await pool.query(
            `UPDATE client_profile SET enquiry_plan_of_interest = ?, enquiry_remark = ?, updated_at = ? WHERE client_id = ?`,
            [planTitle.slice(0, 255), remark.slice(0, 500), now, od.id]
          );
        } else {
          throw e;
        }
      }
    } else {
      const profileId = randomUUID();
      try {
        await pool.query(
          `INSERT INTO client_profile (id, client_id, currency, is_demo, enquiry_plan_of_interest, enquiry_remark, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
          [profileId, od.id, cur, planTitle.slice(0, 255), remark.slice(0, 500), now, now]
        );
      } catch (e) {
        if (e?.code === 'ER_BAD_FIELD_ERROR' && /enquiry_/.test(String(e.message))) {
          await pool.query(
            `INSERT INTO client_profile (id, client_id, currency, is_demo, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
            [profileId, od.id, cur, now, now]
          );
          console.warn('[enquiry] submitSgdPlanEnquiry: client_profile missing enquiry_* columns; plan not stored');
        } else {
          throw e;
        }
      }
    }
  } catch (err) {
    console.error('[enquiry] submitSgdPlanEnquiryForVerifiedEmail', err);
    return { ok: false, reason: 'UPDATE_FAILED' };
  }

  return { ok: true, planTitle };
}

module.exports = {
  getPlansPublic,
  getAddonsPublic,
  getBanksPublic,
  submitEnquiry,
  getOperatorProfileByEmail,
  submitEnquiryForVerifiedEmail,
  ensureOperatorForVerifiedEmail,
  updateEnquiryContactForVerifiedEmail,
  submitSgdPlanEnquiryForVerifiedEmail,
  getCreditPlansPublic
};
