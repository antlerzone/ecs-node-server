/**
 * Topup – migrated from Wix backend/billing/topup.jsw.
 * Stripe only. redirectUrl 仅用于 Stripe success_url/cancel_url（支付后回到同一页），不写入 DB。
 */

const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { getAccessContextByEmail } = require('../access/access.service');
const { createCheckoutSession } = require('../stripe/stripe.service');

function normalizeReturnUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const fixed = url.replace(/^https:\/\/colivingjb\.com/i, 'https://www.colivingjb.com');
  if (!fixed.startsWith('https://www.colivingjb.com')) return null;
  return fixed;
}

/**
 * Start normal topup: auth, load client & credit plan, insert creditlogs (pending), create Stripe Checkout.
 * returnUrl = 支付完成/取消后回到的同一页（Stripe success_url/cancel_url），不存 DB。
 */
async function startNormalTopup(email, { creditPlanId, returnUrl }) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) throw new Error('NO_PERMISSION');
  const clientId = ctx.client?.id;
  const staffId = ctx.staff?.id;
  if (!clientId) throw new Error('NO_CLIENT_ID');

  const [clientRows] = await pool.query(
    'SELECT id, title, status, currency FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length || clientRows[0].status !== 1 && clientRows[0].status !== true) throw new Error('CLIENT_INVALID');
  const client = clientRows[0];
  const currency = String(client.currency || '').toUpperCase() === 'SGD' ? 'SGD' : 'MYR';

  if (!creditPlanId) throw new Error('MISSING_CREDITPLAN');
  const samePageUrl = normalizeReturnUrl(returnUrl);
  if (!samePageUrl) throw new Error('INVALID_RETURN_URL');

  const [planRows] = await pool.query(
    'SELECT id, title, sellingprice, credit FROM creditplan WHERE id = ? LIMIT 1',
    [creditPlanId]
  );
  if (!planRows.length) throw new Error('CREDITPLAN_NOT_FOUND');
  const creditPlan = planRows[0];
  const amountRM = Number(creditPlan.sellingprice);
  const creditAmount = Number(creditPlan.credit);
  if (amountRM <= 0 || creditAmount <= 0) throw new Error('INVALID_CREDITPLAN');

  const creditLogId = randomUUID();
  const referenceNumber = `TP-${creditLogId}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await pool.query(
    `INSERT INTO creditlogs (id, title, type, client_id, staff_id, currency, creditplan_id, payment, amount, is_paid, reference_number, created_at, updated_at)
     VALUES (?, ?, 'Topup', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      creditLogId,
      creditPlan.title,
      clientId,
      staffId,
      currency,
      creditPlanId,
      amountRM,
      creditAmount,
      referenceNumber,
      now,
      now
    ]
  );
  console.log('[creditlogs] INSERT Topup', { id: creditLogId, client_id: clientId, amount: creditAmount, payment: amountRM, reference_number: referenceNumber });

  const stripeRes = await createCheckoutSession({
    amountCents: Math.round(amountRM * 100),
    currency: currency.toLowerCase(),
    email: ctx.staff.email,
    description: creditPlan.title,
    returnUrl: samePageUrl,
    cancelUrl: samePageUrl,
    clientId,
    metadata: {
      type: 'Topup',
      creditlog_id: creditLogId,
      client_id: clientId
    }
  });

  return {
    success: true,
    provider: 'stripe',
    url: stripeRes.url,
    referenceNumber
  };
}

module.exports = {
  startNormalTopup
};
