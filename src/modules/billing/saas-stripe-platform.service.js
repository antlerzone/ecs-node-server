/**
 * Coliving SaaS platform Stripe (Malaysia): sync-after-return when webhook is late. Same keys as createColivingSaasPlatformCheckoutSession (COLIVING_SAAS_STRIPE_*).
 */

const pool = require('../../config/db');
const { getStripeForColivingSaasPlatform, handleCheckoutSessionCompleted } = require('../stripe/stripe.service');
const { getAccessContextByEmail } = require('../access/access.service');
const { handlePricingPlanPaymentSuccess } = require('./checkout.service');
const { finalizeSaasPlanAfterBillplzPayment } = require('./indoor-admin.service');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(e) {
  return String(e || '')
    .trim()
    .toLowerCase();
}

/**
 * Operator billing: after Stripe redirect with session_id (MYR/SGD).
 */
async function syncSaasPricingPlanFromStripeAfterReturn(email, pricingplanlogId, sessionId) {
  const access = await getAccessContextByEmail(email);
  if (!access.ok) return { ok: false, reason: access.reason };
  const clientId = access.client.id;
  const id = normalizeText(pricingplanlogId);
  if (!id) return { ok: false, reason: 'MISSING_PRICINGPLANLOG_ID' };

  const [[log]] = await pool.query(
    'SELECT id, client_id, status, scenario FROM pricingplanlogs WHERE id = ? LIMIT 1',
    [id]
  );
  if (!log) return { ok: false, reason: 'LOG_NOT_FOUND' };
  if (String(log.client_id) !== String(clientId)) return { ok: false, reason: 'CLIENT_MISMATCH' };
  if (String(log.status).toLowerCase() === 'paid') {
    return { ok: true, paid: true, already: true, pricingplanlogId: id };
  }

  const sid = normalizeText(sessionId);
  if (!sid) return { ok: true, paid: false, reason: 'NO_SESSION_ID' };

  const stripe = getStripeForColivingSaasPlatform();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sid);
  } catch (e) {
    console.warn('[saas-stripe] sync plan retrieve failed', e?.message);
    return { ok: false, reason: 'SESSION_RETRIEVE_FAILED' };
  }
  if (session.payment_status !== 'paid') {
    return { ok: true, paid: false, status: session.payment_status };
  }
  if (session.metadata?.coliving_saas_platform !== '1') {
    return { ok: false, reason: 'NOT_COLIVING_SAAS_CHECKOUT' };
  }
  if (normalizeText(session.metadata?.pricingplanlog_id) !== id) {
    return { ok: false, reason: 'SESSION_LOG_MISMATCH' };
  }
  if (normalizeText(session.metadata?.client_id) !== String(clientId)) {
    return { ok: false, reason: 'SESSION_CLIENT_MISMATCH' };
  }

  if (String(log.scenario) === 'SAAS_BILLPLZ') {
    const fin = await finalizeSaasPlanAfterBillplzPayment({
      pricingplanlogId: id,
      paidDateStr: getTodayMalaysiaDate(),
      paymentMethodLabel: 'Stripe'
    });
    return { ok: fin.ok !== false, paid: true, pricingplanlogId: id, finalize: fin };
  }

  const planResult = await handlePricingPlanPaymentSuccess({ pricingplanlogId: id, clientId });
  if (!planResult.ok) {
    return { ok: false, paid: false, reason: planResult.reason || 'APPLY_PLAN_FAILED' };
  }
  return {
    ok: true,
    paid: true,
    already: !!planResult.already,
    pricingplanlogId: id
  };
}

/**
 * Operator credit top-up: after Stripe redirect.
 */
async function syncSaasTopupFromStripeAfterReturn(email, creditLogId, sessionId) {
  const access = await getAccessContextByEmail(email);
  if (!access.ok) return { ok: false, reason: access.reason };
  const clientId = access.client.id;
  const id = normalizeText(creditLogId);
  if (!id) return { ok: false, reason: 'MISSING_CREDITLOG_ID' };

  const [[log]] = await pool.query(
    "SELECT id, client_id, is_paid FROM creditlogs WHERE id = ? AND type = 'Topup' LIMIT 1",
    [id]
  );
  if (!log) return { ok: false, reason: 'LOG_NOT_FOUND' };
  if (String(log.client_id) !== String(clientId)) return { ok: false, reason: 'CLIENT_MISMATCH' };
  if (Number(log.is_paid) === 1) {
    return { ok: true, paid: true, already: true, creditlog_id: id };
  }

  const sid = normalizeText(sessionId);
  if (!sid) return { ok: true, paid: false, reason: 'NO_SESSION_ID' };

  const stripe = getStripeForColivingSaasPlatform();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sid);
  } catch (e) {
    console.warn('[saas-stripe] sync topup retrieve failed', e?.message);
    return { ok: false, reason: 'SESSION_RETRIEVE_FAILED' };
  }
  if (session.payment_status !== 'paid') {
    return { ok: true, paid: false, status: session.payment_status };
  }
  if (session.metadata?.coliving_saas_platform !== '1') {
    return { ok: false, reason: 'NOT_COLIVING_SAAS_CHECKOUT' };
  }
  if (normalizeText(session.metadata?.creditlog_id) !== id) {
    return { ok: false, reason: 'SESSION_LOG_MISMATCH' };
  }

  const { handled, result } = await handleCheckoutSessionCompleted(session);
  if (!handled) return { ok: false, reason: 'TOPUP_HANDLER_NOT_RUN' };
  return { ok: true, paid: true, creditlog_id: id, result };
}

/**
 * Portal /enquiry: JWT email must match operatordetail (same as xendit-plan-sync).
 */
async function syncEnquiryPricingPlanFromStripeAfterReturn(portalEmail, pricingplanlogId, sessionId) {
  const normalizedEmail = normalizeEmail(portalEmail);
  if (!normalizedEmail) return { ok: false, reason: 'NO_EMAIL' };
  const id = normalizeText(pricingplanlogId);
  if (!id) return { ok: false, reason: 'MISSING_PRICINGPLANLOG_ID' };

  const [logs] = await pool.query(
    `SELECT p.id, p.client_id, p.status, p.scenario,
            LOWER(TRIM(o.email)) AS od_email
       FROM pricingplanlogs p
       LEFT JOIN operatordetail o ON o.id = p.client_id
      WHERE p.id = ? LIMIT 1`,
    [id]
  );
  if (!logs.length) return { ok: false, reason: 'LOG_NOT_FOUND' };
  const log = logs[0];
  if (log.client_id && (log.od_email == null || String(log.od_email).trim() === '')) {
    return { ok: false, reason: 'OPERATOR_NOT_FOUND' };
  }
  if (normalizeText(log.scenario) !== 'SAAS_BILLPLZ') {
    return { ok: false, reason: 'NOT_ENQUIRY_CHECKOUT_LOG' };
  }
  if (normalizeText(String(log.od_email || '')) !== normalizedEmail) {
    return { ok: false, reason: 'EMAIL_MISMATCH' };
  }
  if (String(log.status).toLowerCase() === 'paid') {
    return { ok: true, paid: true, already: true, pricingplanlogId: id };
  }

  const sid = normalizeText(sessionId);
  if (!sid) return { ok: true, paid: false, reason: 'NO_SESSION_ID' };

  const stripe = getStripeForColivingSaasPlatform();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sid);
  } catch (e) {
    console.warn('[saas-stripe] enquiry sync retrieve failed', e?.message);
    return { ok: false, reason: 'SESSION_RETRIEVE_FAILED' };
  }
  if (session.payment_status !== 'paid') {
    return { ok: true, paid: false, status: session.payment_status };
  }
  if (session.metadata?.coliving_saas_platform !== '1') {
    return { ok: false, reason: 'NOT_COLIVING_SAAS_CHECKOUT' };
  }
  if (normalizeText(session.metadata?.pricingplanlog_id) !== id) {
    return { ok: false, reason: 'SESSION_LOG_MISMATCH' };
  }

  const fin = await finalizeSaasPlanAfterBillplzPayment({
    pricingplanlogId: id,
    paidDateStr: getTodayMalaysiaDate(),
    paymentMethodLabel: 'Stripe'
  });
  return {
    ok: fin.ok !== false,
    paid: true,
    pricingplanlogId: id,
    finalize: fin
  };
}

module.exports = {
  syncSaasPricingPlanFromStripeAfterReturn,
  syncSaasTopupFromStripeAfterReturn,
  syncEnquiryPricingPlanFromStripeAfterReturn
};
