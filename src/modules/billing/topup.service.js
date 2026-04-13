/**
 * Topup – operator credit top-up: Coliving SaaS platform Stripe (Malaysia; sandbox vs live via COLIVING_SAAS_STRIPE_*), MYR or SGD.
 * redirectUrl = success/cancel return URL.
 */

const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { getAccessContextByEmail, getAccessContextByEmailAndClient } = require('../access/access.service');
const { flexTopupCustomPayment } = require('../../utils/flexTopupCustomAmount');

function normalizeReturnUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const s = String(url).trim();
  // Allow portal (Next) and main site; PORTAL_APP_URL overrides default portal domain
  const portalBase = process.env.PORTAL_APP_URL && String(process.env.PORTAL_APP_URL).trim();
  if (portalBase && s.startsWith(portalBase)) return s;
  if (s.startsWith('https://portal.colivingjb.com')) return s;
  const fixed = s.replace(/^https:\/\/colivingjb\.com/i, 'https://www.colivingjb.com');
  if (fixed.startsWith('https://www.colivingjb.com')) return fixed;
  return null;
}

/**
 * Start normal topup: auth, load client & credit plan, insert creditlogs (pending), create Billplz or Xendit checkout.
 * returnUrl = 支付完成/取消后回到的同一页（Stripe success_url/cancel_url），不存 DB。
 */
async function startNormalTopup(email, { creditPlanId, returnUrl, credits, amount: clientAmountOpt }) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  // creditlogs.staff_id FK references staffdetail only; must be null when operator is client_user
  const clientId = ctx.client?.id;
  const staffId = ctx.staffDetailId != null ? ctx.staffDetailId : null;
  if (!clientId) throw new Error('NO_CLIENT_ID');

  const [clientRows] = await pool.query(
    'SELECT id, title, status, currency FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length || clientRows[0].status !== 1 && clientRows[0].status !== true) throw new Error('CLIENT_INVALID');
  const client = clientRows[0];
  const currency = String(client.currency || '').trim().toUpperCase();
  if (!currency) throw new Error('CLIENT_CURRENCY_MISSING');
  if (!['MYR', 'SGD'].includes(currency)) throw new Error('UNSUPPORTED_CLIENT_CURRENCY');

  const samePageUrl = normalizeReturnUrl(returnUrl);
  if (!samePageUrl) throw new Error('INVALID_RETURN_URL');

  let title;
  let amountRM;
  let creditAmount;
  /** FK on creditlogs; null for operator-entered flex credits */
  let creditPlanIdForLog = null;

  if (creditPlanId) {
    const [planRows] = await pool.query(
      'SELECT id, title, sellingprice, credit FROM creditplan WHERE id = ? LIMIT 1',
      [creditPlanId]
    );
    if (!planRows.length) throw new Error('CREDITPLAN_NOT_FOUND');
    const creditPlan = planRows[0];
    amountRM = Number(creditPlan.sellingprice);
    creditAmount = Number(creditPlan.credit);
    if (amountRM <= 0 || creditAmount <= 0) throw new Error('INVALID_CREDITPLAN');
    title = creditPlan.title;
    creditPlanIdForLog = creditPlanId;
  } else if (credits != null) {
    const n = Math.floor(Number(credits));
    amountRM = flexTopupCustomPayment(n);
    if (amountRM == null) throw new Error('INVALID_CREDITS');
    creditAmount = n;
    title = `Flex top-up · ${n} credits (custom)`;
    const clientAmt = clientAmountOpt != null ? Number(clientAmountOpt) : null;
    if (clientAmt != null && Number.isFinite(clientAmt) && Math.abs(clientAmt - amountRM) > 0.02) {
      throw new Error('AMOUNT_MISMATCH');
    }
  } else {
    throw new Error('MISSING_CREDITPLAN');
  }

  const creditLogId = randomUUID();
  const referenceNumber = `TP-${creditLogId}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await pool.query(
    `INSERT INTO creditlogs (id, title, type, client_id, staff_id, currency, creditplan_id, payment, amount, is_paid, reference_number, created_at, updated_at)
     VALUES (?, ?, 'Topup', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      creditLogId,
      title,
      clientId,
      staffId,
      currency,
      creditPlanIdForLog,
      amountRM,
      creditAmount,
      referenceNumber,
      now,
      now
    ]
  );
  console.log('[creditlogs] INSERT Topup', { id: creditLogId, client_id: clientId, amount: creditAmount, payment: amountRM, reference_number: referenceNumber });

  const sep = samePageUrl.includes('?') ? '&' : '?';
  const returnUrlWithFinalize = `${samePageUrl}${sep}topup_finalize=${encodeURIComponent(creditLogId)}`;
  const successSep = returnUrlWithFinalize.includes('?') ? '&' : '?';
  const successUrl = `${returnUrlWithFinalize}${successSep}session_id={CHECKOUT_SESSION_ID}`;
  const amountCents = Math.round(Number(amountRM) * 100);
  if (amountCents < 100) {
    try {
      await pool.query('DELETE FROM creditlogs WHERE id = ? AND is_paid = 0', [creditLogId]);
    } catch (_) {}
    throw new Error('AMOUNT_TOO_SMALL');
  }
  const { getPlatformXenditConfig } = require('../payex/payex.service');

  if (currency === 'MYR') {
    if (!getPlatformXenditConfig()?.secretKey) {
      try {
        await pool.query('DELETE FROM creditlogs WHERE id = ? AND is_paid = 0', [creditLogId]);
      } catch (_) {}
      throw new Error('SAAS_XENDIT_NOT_CONFIGURED');
    }
    const { createOperatorCreditTopupXendit } = require('./xendit-saas-platform.service');
    const xRes = await createOperatorCreditTopupXendit({
      creditLogId,
      returnUrl: returnUrlWithFinalize,
      email: ctx.staff?.email || '',
      amount: amountRM,
      currency: 'MYR'
    });
    if (!xRes.ok) {
      try {
        await pool.query('DELETE FROM creditlogs WHERE id = ? AND (is_paid IS NULL OR is_paid = 0)', [creditLogId]);
      } catch (_) {}
      throw new Error(xRes.reason || xRes.message || 'XENDIT_CHECKOUT_FAILED');
    }
    return {
      success: true,
      provider: 'xendit',
      url: xRes.url,
      referenceNumber,
      creditLogId
    };
  }

  const { createColivingSaasPlatformCheckoutSession } = require('../stripe/stripe.service');
  try {
    const { url } = await createColivingSaasPlatformCheckoutSession({
      amountCents,
      stripeCurrency: 'sgd',
      email: ctx.staff?.email || '',
      description: title || 'Credit top-up',
      successUrl,
      cancelUrl: samePageUrl,
      metadata: {
        type: 'Topup',
        creditlog_id: creditLogId,
        client_id: String(clientId)
      }
    });
    return {
      success: true,
      provider: 'stripe',
      url,
      referenceNumber,
      creditLogId
    };
  } catch (e) {
    try {
      await pool.query('DELETE FROM creditlogs WHERE id = ? AND (is_paid IS NULL OR is_paid = 0)', [creditLogId]);
    } catch (_) {}
    throw e;
  }
}

/**
 * Submit manual bank transfer top-up request. Creates pending creditlog (is_paid=0).
 * Admin processes later via indoor-admin manual topup.
 * @param {string} email – staff email
 * @param {{ clientId?: string, creditPlanId?: string, credits?: number, amount?: number }} opts
 *   – creditPlanId: from creditplan table; OR credits+amount for custom
 */
async function submitManualTopupRequest(email, opts = {}) {
  const ctx = opts.clientId
    ? await getAccessContextByEmailAndClient(email, opts.clientId)
    : await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  const clientId = ctx.client?.id;
  const staffId = ctx.staffDetailId != null ? ctx.staffDetailId : null;
  if (!clientId) throw new Error('NO_CLIENT_ID');

  const [clientRows] = await pool.query(
    'SELECT id, title, status, currency FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length || (clientRows[0].status !== 1 && clientRows[0].status !== true)) throw new Error('CLIENT_INVALID');
  const client = clientRows[0];
  const currency = String(client.currency || '').trim().toUpperCase();
  if (!currency) throw new Error('CLIENT_CURRENCY_MISSING');
  if (!['MYR', 'SGD'].includes(currency)) throw new Error('UNSUPPORTED_CLIENT_CURRENCY');

  let title, creditAmount, amountRM, creditPlanId = null;

  if (opts.creditPlanId) {
    const [planRows] = await pool.query(
      'SELECT id, title, sellingprice, credit FROM creditplan WHERE id = ? LIMIT 1',
      [opts.creditPlanId]
    );
    if (!planRows.length) throw new Error('CREDITPLAN_NOT_FOUND');
    const p = planRows[0];
    title = p.title || `Topup ${p.credit} credits`;
    creditAmount = Number(p.credit) || 0;
    amountRM = Number(p.sellingprice) || 0;
    creditPlanId = p.id;
  } else if (opts.credits != null && opts.amount != null && opts.credits > 0 && opts.amount > 0) {
    title = `Topup ${opts.credits} credits (manual)`;
    creditAmount = Number(opts.credits);
    amountRM = Number(opts.amount);
  } else {
    throw new Error('MISSING_CREDITPLAN_OR_AMOUNT');
  }

  const creditLogId = randomUUID();
  const referenceNumber = `TOP-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await pool.query(
    `INSERT INTO creditlogs (id, title, type, client_id, staff_id, currency, creditplan_id, payment, amount, is_paid, reference_number, created_at, updated_at)
     VALUES (?, ?, 'Topup', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [creditLogId, title, clientId, staffId, currency, creditPlanId, amountRM, creditAmount, referenceNumber, now, now]
  );
  console.log('[creditlogs] INSERT Topup (manual pending)', { id: creditLogId, client_id: clientId, amount: creditAmount, payment: amountRM, reference_number: referenceNumber });

  return {
    ok: true,
    creditlogId: creditLogId,
    referenceNumber,
    credits: creditAmount,
    amount: amountRM,
    currency
  };
}

module.exports = {
  startNormalTopup,
  submitManualTopupRequest
};
