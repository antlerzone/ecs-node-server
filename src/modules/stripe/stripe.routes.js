/**
 * Stripe API routes. All payments use Checkout (redirect to Stripe); no Payment Intent.
 * - POST /api/stripe/create-checkout-credit-topup: redirect URL for client credit top-up
 * - POST /api/stripe/create-checkout-rent: redirect URL for tenant rent
 * - POST /api/stripe/release-rent: after rent succeeded, release to client (deduct fee + 1%, transfer to Connect)
 * - Webhook: mount separately with express.raw() at POST /api/stripe/webhook (see server.js)
 */

const express = require('express');
const router = express.Router();
const {
  releaseRentToClient,
  getClientCreditBalance,
  getClientStripeConnectedAccountId,
  getEstimatedRentDeduction,
  getTenantAndRoomNames,
  getPublishableKey,
  getPublishableKeyForClient,
  getClientStripeSandbox,
  constructWebhookEvent,
  handlePaymentIntentSucceeded,
  createCheckoutSession,
  handleCheckoutSessionCompleted,
  getStripeFromEvent,
  getStripeForClient
} = require('./stripe.service');
const { getStripePayoutsPendingJournal, processPendingStripePayoutJournals } = require('./settlement-journal.service');
const { getAccessContextByEmail } = require('../access/access.service');
const adminGuard = require('../middleware/adminGuard');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

/**
 * POST /api/stripe/create-checkout-credit-topup
 * Body: { email, amountCents, currency?, clientId?, returnUrl, cancelUrl }
 * Redirect to Stripe Checkout; description & amount are fixed server-side. returnUrl and cancelUrl should be the same page.
 * Returns { ok: true, url }.
 */
router.post('/create-checkout-credit-topup', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const clientId = req.body?.clientId ?? ctx.client?.id;
    if (!clientId) return res.status(400).json({ ok: false, reason: 'NO_CLIENT_ID' });
    const amountCents = Math.max(100, Math.round(Number(req.body?.amountCents) || 0));
    const currency = (req.body?.currency || 'myr').toLowerCase();
    const returnUrl = req.body?.returnUrl || req.body?.return_url;
    const cancelUrl = req.body?.cancelUrl || req.body?.cancel_url || returnUrl;
    if (!returnUrl || !String(returnUrl).trim()) return res.status(400).json({ ok: false, reason: 'returnUrl required' });
    const amountDisplay = (amountCents / 100).toFixed(2);
    const currUpper = currency.toUpperCase();
    const description = `Credit topup - ${currUpper} ${amountDisplay}`;
    const { url } = await createCheckoutSession({
      amountCents,
      currency,
      email,
      description,
      returnUrl: returnUrl.trim(),
      cancelUrl: (cancelUrl || returnUrl).trim(),
      clientId,
      metadata: {
        type: 'credit_topup',
        client_id: clientId,
        amount_cents: String(amountCents)
      }
    });
    res.json({ ok: true, url });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/stripe/create-checkout-rent
 * Body: { amountCents, currency?, clientId, tenantId?, returnUrl, cancelUrl }
 * Redirect to Stripe Checkout; description (tenant/room) & amount are fixed server-side. returnUrl and cancelUrl should be the same page.
 * Returns { ok: true, url, markupNote?, estimatedDeductCredits? }.
 */
router.post('/create-checkout-rent', async (req, res, next) => {
  try {
    const clientId = req.body?.clientId;
    if (!clientId) return res.status(400).json({ ok: false, reason: 'clientId required' });
    const amountCents = Math.max(100, Math.round(Number(req.body?.amountCents) || 0));
    const currency = (req.body?.currency || 'myr').toLowerCase();
    const tenantId = req.body?.tenantId || null;
    const returnUrl = req.body?.returnUrl || req.body?.return_url;
    const cancelUrl = req.body?.cancelUrl || req.body?.cancel_url || returnUrl;
    if (!returnUrl || !String(returnUrl).trim()) return res.status(400).json({ ok: false, reason: 'returnUrl required' });
    const { tenantName, roomName } = await getTenantAndRoomNames(clientId, tenantId);
    const description = `Rent - ${tenantName || 'Tenant'} - ${roomName || 'Room'}`.trim();
    const { markupCredits, estimatedPercent } = getEstimatedRentDeduction(amountCents);
    const { url } = await createCheckoutSession({
      amountCents,
      currency,
      email: req.body?.email || '',
      description,
      returnUrl: returnUrl.trim(),
      cancelUrl: (cancelUrl || returnUrl).trim(),
      clientId,
      metadata: {
        type: 'rent',
        client_id: clientId,
        ...(tenantId ? { tenant_id: String(tenantId) } : {}),
        ...(tenantName ? { tenant_name: String(tenantName).slice(0, 500) } : {}),
        ...(roomName ? { room_name: String(roomName).slice(0, 500) } : {})
      }
    });
    res.json({
      ok: true,
      url,
      markupNote: 'Actual deduction at release = ceil(Stripe fee + 1%) in whole credits (no decimals)',
      estimatedDeductPercent: estimatedPercent,
      estimatedDeductCredits: markupCredits
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/stripe/release-rent
 * Body: { email?, paymentIntentId, clientId? }
 * After tenant rent PaymentIntent succeeded: check client credit for (Stripe fee + 1%); if OK deduct and transfer to Connect.
 */
router.post('/release-rent', async (req, res, next) => {
  try {
    const paymentIntentId = req.body?.paymentIntentId;
    if (!paymentIntentId) {
      return res.status(400).json({ ok: false, reason: 'paymentIntentId required' });
    }
    let clientId = req.body?.clientId;
    if (!clientId) {
      const email = getEmail(req);
      const ctx = await getAccessContextByEmail(email);
      if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
      clientId = ctx.client?.id;
    }
    if (!clientId) {
      return res.status(400).json({ ok: false, reason: 'NO_CLIENT_ID' });
    }
    const result = await releaseRentToClient({ paymentIntentId, clientId });
    res.json({ ok: result.released, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/stripe/credit-balance?email= & clientId= (optional, else from email)
 */
router.get('/credit-balance', async (req, res, next) => {
  try {
    const email = req.query?.email;
    let clientId = req.query?.clientId;
    if (!clientId && email) {
      const ctx = await getAccessContextByEmail(email);
      if (ctx.ok && ctx.client?.id) clientId = ctx.client.id;
    }
    if (!clientId) {
      return res.status(400).json({ ok: false, reason: 'NO_CLIENT_ID' });
    }
    const balance = await getClientCreditBalance(clientId);
    res.json({ ok: true, balance });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/stripe/connect-account?clientId=
 * Returns { ok, connectedAccountId?: string } (null if not set).
 */
router.get('/connect-account', async (req, res, next) => {
  try {
    const clientId = req.query?.clientId;
    if (!clientId) {
      return res.status(400).json({ ok: false, reason: 'clientId required' });
    }
    const connectedAccountId = await getClientStripeConnectedAccountId(clientId);
    res.json({ ok: true, connectedAccountId: connectedAccountId || null });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/stripe/config?clientId=
 * Returns { ok, stripePublishableKey?, useSandbox } for frontend to init Stripe.js (demo vs live).
 */
router.get('/config', async (req, res, next) => {
  try {
    const clientId = req.query?.clientId;
    if (!clientId) {
      return res.status(400).json({ ok: false, reason: 'clientId required' });
    }
    const useSandbox = await getClientStripeSandbox(clientId);
    const stripePublishableKey = await getPublishableKeyForClient(clientId);
    res.json({ ok: true, stripePublishableKey: stripePublishableKey || null, useSandbox });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/stripe/process-settlement-journals
 * 依 stripepayout 表撈 journal_created_at IS NULL 的列，逐筆做分錄 (DR Bank, CR Stripe) 並寫回 stripepayout。
 * Body: { clientId? }. 不傳 clientId 時處理全部（僅 admin x-admin-key）；傳 clientId 時需 access (email) 或 admin。
 */
router.post('/process-settlement-journals', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const ctx = await getAccessContextByEmail(email);
    const adminKey = req.headers['x-admin-key'];
    const isAdmin = adminKey && process.env.ADMIN_API_KEY && adminKey === process.env.ADMIN_API_KEY;
    const bodyClientId = req.body?.clientId || null;
    const clientId = bodyClientId || (ctx.ok ? ctx.client?.id : null);
    if (!clientId && !isAdmin) {
      return res.status(403).json({ ok: false, reason: 'Process all requires admin' });
    }
    if (clientId && !isAdmin && (!ctx.ok || String(ctx.client?.id) !== String(clientId))) {
      return res.status(403).json({ ok: false, reason: 'ACCESS_DENIED' });
    }
    const rows = await getStripePayoutsPendingJournal(clientId || null);
    const result = await processPendingStripePayoutJournals(rows);
    res.json({ ok: true, created: result.created, errors: result.errors });
  } catch (err) {
    next(err);
  }
});

/**
 * Webhook handler. Must be mounted with express.raw({ type: 'application/json' }) so req.body is Buffer.
 * Usage in server.js: app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
 */
async function webhookHandler(req, res) {
  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return res.status(400).send('Missing Stripe-Signature');
  }
  let rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}), 'utf8');
  }
  const sendWebhookResponse = (handled, result) => {
    res.json({ received: true, handled: !!handled, result: result || null, backend: 'ecs: node' });
  };
  try {
    const event = constructWebhookEvent(rawBody, signature);
    if (event.type === 'payment_intent.succeeded') {
      const { handled, result } = await handlePaymentIntentSucceeded(event);
      if (handled) {
        return sendWebhookResponse(true, result);
      }
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object;
      if (session?.id) {
        const clientId = session.metadata?.client_id;
        const stripe = clientId
          ? await getStripeForClient(clientId)
          : getStripeFromEvent(event);
        const full = await stripe.checkout.sessions.retrieve(session.id, { expand: [] });
        const { handled, result } = await handleCheckoutSessionCompleted(full);
        if (handled) {
          return sendWebhookResponse(true, result);
        }
        if (full.metadata?.type === 'pricingplan' && full.metadata?.pricingplanlog_id && full.metadata?.client_id) {
          const pool = require('../config/db');
          const { handlePricingPlanPaymentSuccess } = require('../billing/checkout.service');
          const planResult = await handlePricingPlanPaymentSuccess({
            pricingplanlogId: full.metadata.pricingplanlog_id,
            clientId: full.metadata.client_id
          });
          if (planResult.ok && !planResult.already) {
            try {
              const { createSaasBukkuCashInvoiceIfConfigured, buildPlanDescription, ensureClientBukkuContact, PRODUCT_PRICINGPLAN, ACCOUNT_REVENUE, PAYMENT_STRIPE } = require('../billing/saas-bukku.service');
              const amount = (typeof full.amount_total === 'number' ? full.amount_total : 0) / 100;
              const paidDate = new Date().toISOString().slice(0, 10);
              const whenStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
              const currency = (full.currency || 'myr').toUpperCase();
              const defaultContactId = process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID ? Number(process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID) : null;
              const contactId = (await ensureClientBukkuContact(full.metadata.client_id)) ?? defaultContactId;
              let clientName = '';
              let planTitle = String(full.metadata?.planId || '').trim();
              const [[clientRow]] = await pool.query('SELECT title FROM clientdetail WHERE id = ? LIMIT 1', [full.metadata.client_id]);
              if (clientRow) clientName = clientRow.title || '';
              const planId = full.metadata?.plan_id || full.metadata?.planId;
              if (planId) {
                const [[planRow]] = await pool.query('SELECT title FROM pricingplan WHERE id = ? LIMIT 1', [planId]);
                if (planRow?.title) planTitle = planRow.title;
              }
              const invRes = contactId
                ? await createSaasBukkuCashInvoiceIfConfigured({
                contactId,
                productId: PRODUCT_PRICINGPLAN,
                accountId: ACCOUNT_REVENUE,
                amount,
                paidDate,
                paymentAccountId: PAYMENT_STRIPE,
                description: buildPlanDescription({
                  clientName,
                  when: whenStr,
                  paymentMethod: 'Stripe',
                  amount,
                  currency,
                  planTitle
                }),
                currencyCode: currency
              })
                : { ok: false };
              if (invRes.ok && full.metadata.pricingplanlog_id && (invRes.invoiceId != null || invRes.invoiceUrl)) {
                await pool.query('UPDATE pricingplanlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?', [invRes.invoiceId != null ? String(invRes.invoiceId) : null, invRes.invoiceUrl || null, full.metadata.pricingplanlog_id]);
              }
            } catch (bukkuErr) {
              console.warn('[stripe webhook] pricingplan SaaS Bukku invoice failed', bukkuErr?.message || bukkuErr);
            }
          }
          return sendWebhookResponse(true, { type: 'pricingplan', ...planResult });
        }
      }
    }
    if (event.type === 'account.updated') {
      const account = event.data?.object;
      if (account?.id) {
        console.log('[stripe webhook] account.updated received', {
          accountId: account.id,
          charges_enabled: account.charges_enabled,
          metadata_client_id: account.metadata?.client_id || null
        });
        const { handleAccountUpdated } = require('./stripe.service');
        const { handled, result } = await handleAccountUpdated(account);
        if (handled) {
          console.log('[stripe webhook] account.updated handled', result);
          return sendWebhookResponse(true, result);
        }
      }
    }
    return sendWebhookResponse(false);
  } catch (err) {
    console.error('[stripe webhook]', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
}

module.exports = router;
module.exports.webhookHandler = webhookHandler;
