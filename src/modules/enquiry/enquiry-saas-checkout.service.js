/**
 * Portal /enquiry：MYR → 平台 Xendit（`XENDIT_PLATFORM_*`）；SGD → Coliving SaaS Stripe（`STRIPE_*`）。
 * Billplz webhook 仍處理歷史在途單。
 */

const pool = require('../../config/db');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
const { resolveUseSandbox } = require('../billplz/wrappers/billplzrequest');
const {
  insertPendingPlanLogForSaasBillplz,
  finalizeSaasPlanAfterBillplzPayment
} = require('../billing/indoor-admin.service');
const { verifyBillplzXSignature } = require('../billplz/lib/signature');
const { tryProcessOperatorBillplzWebhook } = require('../billing/billplz-operator-saas.service');

function normalizeText(value) {
  return String(value || '').trim();
}

function getSaasBillplzCreds() {
  const apiKey = normalizeText(process.env.SAAS_COLIVING_BILLPLZ_API_KEY);
  const collectionId = normalizeText(process.env.SAAS_COLIVING_BILLPLZ_COLLECTION_ID);
  const xSignatureKey = normalizeText(process.env.SAAS_COLIVING_BILLPLZ_X_SIGNATURE_KEY);
  const requestedSandbox =
    String(process.env.SAAS_COLIVING_BILLPLZ_USE_SANDBOX || '').trim() === '1' ||
    String(process.env.SAAS_COLIVING_BILLPLZ_USE_SANDBOX || '').toLowerCase() === 'true';
  const useSandbox = resolveUseSandbox(requestedSandbox);
  return { apiKey, collectionId, xSignatureKey, useSandbox };
}

function getEnquirySuccessRedirectUrl() {
  const u = normalizeText(process.env.SAAS_COLIVING_BILLPLZ_REDIRECT_URL);
  if (u) return u;
  return 'https://portal.colivingjb.com/enquiry?paid=1';
}

/** Xendit success URL：带 plan_finalize 供回跳后轮询补单（webhook 延迟/漏发时仍更新 operatordetail）。 */
function buildEnquiryXenditReturnUrl(pricingplanlogId) {
  const id = normalizeText(pricingplanlogId);
  const base = getEnquirySuccessRedirectUrl();
  try {
    const u = new URL(base);
    u.searchParams.set('paid', '1');
    if (id) u.searchParams.set('plan_finalize', id);
    return u.toString();
  } catch {
    const sep = base.includes('?') ? '&' : '?';
    const q = [`paid=1`];
    if (id) q.push(`plan_finalize=${encodeURIComponent(id)}`);
    return `${base.replace(/\/$/, '')}${sep}${q.join('&')}`;
  }
}

/**
 * @param {{ email: string, planId: string, remark?: string }} opts - email 來自已驗證 JWT
 */
async function createPlanBillplzCheckout(opts = {}) {
  const email = opts.email;
  const planId = opts.planId;
  const remark = opts.remark;
  const normalized = normalizeText(email).toLowerCase();
  if (!normalized || !planId) {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }

  const [odRows] = await pool.query(
    'SELECT id, title, email, currency, status FROM operatordetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  if (!odRows.length) {
    return { ok: false, reason: 'NO_OPERATOR_PROFILE' };
  }
  const od = odRows[0];
  const currency = String(od.currency || '').trim().toUpperCase();
  if (!['MYR', 'SGD'].includes(currency)) {
    return { ok: false, reason: 'UNSUPPORTED_CHECKOUT_CURRENCY' };
  }

  const [planAmtRows] = await pool.query('SELECT sellingprice FROM pricingplan WHERE id = ? LIMIT 1', [planId]);
  const planSellingPrice = Number(planAmtRows[0]?.sellingprice) || 0;
  if (currency === 'SGD' && planSellingPrice > 1000) {
    return {
      ok: false,
      reason: 'SGD_LARGE_AMOUNT_USE_ENQUIRY',
      message:
        'Plans over SGD 1,000 are handled by our team. Submit a plan enquiry — SaaS Admin will see it under Enquiry and contact you.'
    };
  }

  let remarkVal = remark && /^(new_customer|renew|upgrade)$/i.test(String(remark).trim()) ? String(remark).trim().toLowerCase() : null;
  if (!remarkVal) {
    remarkVal = Number(od.status) === 0 ? 'new_customer' : 'renew';
  }

  const prep = await insertPendingPlanLogForSaasBillplz({
    clientId: od.id,
    planId,
    remark: remarkVal
  });
  if (!prep.ok) return prep;

  const redirectUrl = buildEnquiryXenditReturnUrl(prep.logId);
  const successSep = redirectUrl.includes('?') ? '&' : '?';
  const successUrl = `${redirectUrl}${successSep}session_id={CHECKOUT_SESSION_ID}`;
  let cancelUrl = 'https://portal.colivingjb.com/enquiry';
  try {
    const u = new URL(getEnquirySuccessRedirectUrl());
    u.search = '';
    cancelUrl = u.toString();
  } catch (_) {}

  const amountCents = Math.round(Number(prep.amount) * 100);
  if (amountCents < 100) {
    try {
      await pool.query("DELETE FROM pricingplanlogs WHERE id = ? AND status = 'pending'", [prep.logId]);
    } catch (_) {}
    return { ok: false, reason: 'INVALID_PLAN_AMOUNT' };
  }

  const { getPlatformXenditConfig } = require('../payex/payex.service');

  if (currency === 'MYR') {
    if (!getPlatformXenditConfig()?.secretKey) {
      try {
        await pool.query("DELETE FROM pricingplanlogs WHERE id = ? AND status = 'pending'", [prep.logId]);
      } catch (_) {}
      return { ok: false, reason: 'SAAS_XENDIT_NOT_CONFIGURED' };
    }
    const { createEnquiryPricingPlanXendit } = require('../billing/xendit-saas-platform.service');
    const xRes = await createEnquiryPricingPlanXendit({
      pricingplanlogId: prep.logId,
      returnUrl: redirectUrl,
      email: normalized,
      amount: prep.amount,
      currency: 'MYR',
      planTitle: prep.planTitle,
      clientId: od.id
    });
    if (!xRes.ok) {
      try {
        await pool.query("DELETE FROM pricingplanlogs WHERE id = ? AND status = 'pending'", [prep.logId]);
      } catch (_) {}
      return { ok: false, reason: xRes.reason || 'XENDIT_CHECKOUT_FAILED', message: xRes.message };
    }
    return {
      ok: true,
      billUrl: normalizeText(xRes.url),
      billId: xRes.invoiceId != null ? String(xRes.invoiceId) : '',
      pricingplanlogId: prep.logId,
      amount: prep.amount,
      currency: prep.currency,
      provider: 'xendit'
    };
  }

  const { createColivingSaasPlatformCheckoutSession } = require('../stripe/stripe.service');
  try {
    const { url } = await createColivingSaasPlatformCheckoutSession({
      amountCents,
      stripeCurrency: 'sgd',
      email: normalized,
      description: `Pricing plan: ${prep.planTitle}`,
      successUrl,
      cancelUrl,
      metadata: {
        type: 'pricingplan',
        pricingplanlog_id: prep.logId,
        client_id: String(od.id),
        plan_id: String(planId),
        planId: String(planId)
      }
    });
    return {
      ok: true,
      billUrl: normalizeText(url),
      billId: '',
      pricingplanlogId: prep.logId,
      amount: prep.amount,
      currency: prep.currency,
      provider: 'stripe'
    };
  } catch (e) {
    try {
      await pool.query("DELETE FROM pricingplanlogs WHERE id = ? AND status = 'pending'", [prep.logId]);
    } catch (_) {}
    console.error('[enquiry-saas-checkout] Stripe session failed', e?.message || e);
    return { ok: false, reason: 'STRIPE_CHECKOUT_FAILED', message: e?.message || 'STRIPE_CHECKOUT_FAILED' };
  }
}

function isBillplzPaid(data) {
  const state = normalizeText(data?.state).toLowerCase();
  const paid = data?.paid;
  return paid === true || paid === 'true' || paid === 1 || paid === '1' || state === 'paid';
}

async function resolveSaasPricingLogIdFromBillId(billId) {
  const id = normalizeText(billId);
  if (!id) return '';
  let [rows] = await pool.query(
    `SELECT id
       FROM pricingplanlogs
      WHERE scenario = 'SAAS_BILLPLZ'
        AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.billplz_bill_id')) = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [id]
  );
  if (rows?.[0]?.id) return String(rows[0].id);

  const likeNeedle = `%"billplz_bill_id":"${id}"%`;
  [rows] = await pool.query(
    `SELECT id
       FROM pricingplanlogs
      WHERE scenario = 'SAAS_BILLPLZ'
        AND payload_json LIKE ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [likeNeedle]
  );
  return rows?.[0]?.id ? String(rows[0].id) : '';
}

/**
 * Billplz webhook：驗證 x_signature（平台 collection），reference_1 = pricingplanlog id（在途旧单）。
 */
async function handleSaasColivingBillplzWebhook(payload) {
  const op = await tryProcessOperatorBillplzWebhook(payload);
  if (op.handled) {
    return op.result;
  }

  const creds = getSaasBillplzCreds();
  if (!creds.xSignatureKey) {
    return { ok: false, reason: 'SAAS_BILLPLZ_NOT_CONFIGURED' };
  }
  const providedSignature = payload?.x_signature;
  if (!verifyBillplzXSignature(payload, creds.xSignatureKey, providedSignature)) {
    return { ok: false, reason: 'BILLPLZ_X_SIGNATURE_MISMATCH' };
  }

  let logId = normalizeText(payload?.reference_1 || payload?.reference1);
  if (!logId) {
    const callbackBillId = normalizeText(payload?.id || payload?.bill_id || payload?.billplz_id);
    const fallbackLogId = await resolveSaasPricingLogIdFromBillId(callbackBillId);
    if (!fallbackLogId) {
      console.warn('[enquiry-saas-checkout] webhook missing reference_1 and bill-id lookup failed', {
        billId: callbackBillId
      });
      return { ok: false, reason: 'MISSING_REFERENCE' };
    }
    logId = fallbackLogId;
    console.warn('[enquiry-saas-checkout] webhook without reference_1, resolved by bill id', {
      billId: callbackBillId,
      pricingplanlogId: logId
    });
  }

  const [logRows] = await pool.query(
    'SELECT id, client_id, plan_id, amount, status, scenario FROM pricingplanlogs WHERE id = ? LIMIT 1',
    [logId]
  );
  if (!logRows.length) {
    return { ok: false, reason: 'LOG_NOT_FOUND' };
  }
  const log = logRows[0];
  if (normalizeText(log.scenario) !== 'SAAS_BILLPLZ') {
    return { ok: false, reason: 'NOT_SAAS_CHECKOUT_LOG' };
  }

  const amountCents = Math.round(Number(payload?.paid_amount ?? payload?.amount ?? 0));
  const expectedCents = Math.round(Number(log.amount || 0) * 100);
  if (expectedCents > 0 && amountCents > 0 && amountCents !== expectedCents) {
    console.warn('[enquiry-saas-checkout] amount mismatch log=%s expected=%s got=%s', logId, expectedCents, amountCents);
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }

  if (!isBillplzPaid(payload)) {
    return { ok: true, paid: false, state: normalizeText(payload?.state) };
  }

  if (log.status === 'paid') {
    return { ok: true, paid: true, already: true };
  }

  const paidDateStr = getTodayMalaysiaDate();
  const fin = await finalizeSaasPlanAfterBillplzPayment({
    pricingplanlogId: logId,
    paidDateStr,
    paymentMethodLabel: 'Billplz'
  });
  return { ok: fin.ok !== false, paid: true, finalize: fin };
}

module.exports = {
  getSaasBillplzCreds,
  createPlanBillplzCheckout,
  handleSaasColivingBillplzWebhook
};
