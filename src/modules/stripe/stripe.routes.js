/**
 * Stripe API routes.
 * - POST /api/stripe/create-checkout-credit-topup: client credit top-up
 * - POST /api/stripe/create-checkout-rent: tenant rent Checkout (tenant pays operator Stripe)
 * - POST /api/stripe/release-rent: apply 1% SaaS credit deduction + RentRelease log (retry / manual; no money movement)
 * - Webhook: POST /api/stripe/webhook (see server.js)
 */

const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
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
  getStripeForClient,
  getStripe,
  findClientIdByConnectedAccountId
} = require('./stripe.service');
const {
  getStripePayoutsPendingJournal,
  processPendingStripePayoutJournals,
  upsertStripeOperatorPayoutFromWebhook,
  createJournalForStripeOperatorPayoutRow
} = require('./settlement-journal.service');
const { getAccessContextByEmail } = require('../access/access.service');
const cleanlemonService = require('../cleanlemon/cleanlemon.service');
const adminGuard = require('../../middleware/adminGuard');
const { markStripeWebhookVerified } = require('../payment-gateway/payment-gateway.service');
const STRIPE_API_VERSION = '2024-11-20.acacia';

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
 * Returns { ok: true, url, markupNote?, estimatedDeductCredits?, estimatedDeductPercent?, estimatedTotalFeeCents?, estimatedOperatorNetCents? }.
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
    const {
      markupCredits,
      estimatedPercent,
      estimatedTotalFeeCents,
      estimatedOperatorNetCents,
      estimatedGatewayPercent
    } = getEstimatedRentDeduction(amountCents);
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
      markupNote:
        'Tenant pays your Stripe account. The platform deducts 1% of the payment amount from operator credit (SaaS fee). Stripe processing fees are between the tenant and Stripe on your account.',
      estimatedDeductPercent: estimatedPercent,
      estimatedDeductCredits: markupCredits,
      estimatedTotalFeeCents,
      estimatedOperatorNetCents,
      estimatedGatewayPercent
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/stripe/release-rent
 * Body: { email?, paymentIntentId, clientId? }
 * After tenant PaymentIntent succeeded: deduct 1% from operator credit and write RentRelease (tenant already paid operator; no transfer).
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
  const isBuffer = Buffer.isBuffer(rawBody);
  // Always log so we can confirm this process (app) received the webhook and is running new code
  console.log('[stripe webhook] request start', {
    isRawBuffer: isBuffer,
    bodyLength: rawBody?.length ?? 0,
    contentType: req.headers['content-type'],
    signaturePreview: String(signature).slice(0, 24)
  });
  if (!isBuffer) {
    console.warn('[stripe webhook] req.body is not Buffer', {
      hasBody: !!req.body,
      contentType: req.headers['content-type'],
      bodyType: typeof req.body
    });
    rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}), 'utf8');
  }
  const sendWebhookResponse = (handled, result) => {
    res.json({ received: true, handled: !!handled, result: result || null, backend: 'ecs: node' });
  };
  try {
    const event = await constructWebhookEvent(rawBody, signature);
    const payloadObj = event.data?.object || {};
    const matchedClientId =
      event.__matchedClientId
      || await findClientIdByConnectedAccountId(event.account || payloadObj.on_behalf_of || payloadObj.account || null)
      || payloadObj.metadata?.client_id
      || null;
    console.log('[stripe webhook] event parsed', {
      eventId: event.id,
      eventType: event.type,
      account: event.account || null,
      livemode: event.livemode,
      metadataClientId: event.data?.object?.metadata?.client_id || null,
      matchedClientId,
      matchedGatewayMode: event.__matchedGatewayMode || (event.account ? 'platform_connect' : 'platform_secret')
    });
    if (matchedClientId) {
      try {
        await markStripeWebhookVerified(matchedClientId, {
          eventType: event.type,
          accountId: event.account || payloadObj.on_behalf_of || payloadObj.account || null
        });
      } catch (e) {
        console.warn('[stripe webhook] direct verification mark failed', e?.message || e);
      }
    }
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data?.object;
      if (sub?.id) {
        const interval = String(sub?.items?.data?.[0]?.price?.recurring?.interval || 'month').toLowerCase();
        const intervalCount = Number(sub?.items?.data?.[0]?.price?.recurring?.interval_count || 1);
        const unitAmount = Number(sub?.items?.data?.[0]?.price?.unit_amount || 0) / 100;
        let billingCycle = 'monthly';
        if (interval === 'year') billingCycle = 'yearly';
        else if (interval === 'month' && intervalCount === 3) billingCycle = 'quarterly';
        else if (interval === 'month') billingCycle = 'monthly';
        const monthlyPrice = interval === 'year'
          ? Number((unitAmount / Math.max(intervalCount, 1) / 12).toFixed(2))
          : interval === 'month' && intervalCount > 1
            ? Number((unitAmount / intervalCount).toFixed(2))
            : Number(unitAmount.toFixed(2));
        const status = event.type === 'customer.subscription.deleted'
          ? 'terminated'
          : (String(sub.status || '').toLowerCase() === 'active' ? 'active' : String(sub.status || 'pending'));
        const result = await cleanlemonService.updateSubscriptionFromStripeEvent({
          stripeSubscriptionId: String(sub.id),
          stripeCustomerId: sub.customer ? String(sub.customer) : '',
          stripePriceId: String(sub?.items?.data?.[0]?.price?.id || ''),
          email: String(sub.metadata?.customer_email || sub.metadata?.operator_email || '').trim().toLowerCase(),
          planCode: String(sub.metadata?.plan_code || 'starter').trim().toLowerCase(),
          billingCycle,
          monthlyPrice,
          status,
        });
        if (result?.updated) {
          return sendWebhookResponse(true, { type: 'cleanlemon_subscription_update', ...result });
        }
      }
    }
    if (event.type === 'payment_intent.succeeded') {
      const { handled, result } = await handlePaymentIntentSucceeded(event);
      if (handled) {
        return sendWebhookResponse(true, result);
      }
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object;
      if (session?.id) {
        if (session.metadata?.type === 'cleanlemon_subscription') {
          const intervalCode = String(session.metadata?.interval_code || 'month').trim().toLowerCase();
          const intervalDivisor = intervalCode === 'year' ? 12 : intervalCode === 'quarter' ? 3 : 1;
          const totalAmount = Number(session.amount_total || 0) / 100;
          const monthlyPrice = Number((totalAmount / intervalDivisor).toFixed(2));
          const paidDateYmd = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kuala_Lumpur',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(Number(session.created || 0) * 1000 || Date.now()));
          const payload = {
            email: String(session.metadata?.customer_email || session.customer_details?.email || '').trim().toLowerCase(),
            companyName: String(session.metadata?.customer_name || session.customer_details?.name || '').trim(),
            planCode: String(session.metadata?.plan_code || 'starter').trim().toLowerCase(),
            intervalCode,
            monthlyPrice,
            amountTotalCents: Number(session.amount_total || 0),
            stripeSessionId: session.id,
            stripeSessionCreated: Number(session.created || 0),
            paidDateYmd,
            stripeCustomerId: session.customer ? String(session.customer) : '',
            stripeSubscriptionId: session.subscription ? String(session.subscription) : '',
            stripePriceId: session.metadata?.price_id ? String(session.metadata.price_id) : '',
            stripeStatus: String(session.payment_status || ''),
            checkoutAction: String(session.metadata?.checkout_action || '').trim().toLowerCase(),
            operatorId: String(session.metadata?.operator_id || '').trim(),
          };
          const saved = await cleanlemonService.upsertSubscriptionFromStripeCheckout(payload);
          return sendWebhookResponse(true, { type: 'cleanlemon_subscription', ...saved });
        }
        if (session.metadata?.type === 'cleanlemon_addon') {
          const addonResult = await cleanlemonService.activateAddonFromStripeCheckoutSession(session);
          return sendWebhookResponse(true, { type: 'cleanlemon_addon', ...addonResult });
        }
        const clientId = session.metadata?.client_id;
        const useColivingSaasPlatform = session.metadata?.coliving_saas_platform === '1';
        const stripe = useColivingSaasPlatform
          ? getStripe(!event.livemode, 'MY')
          : clientId
            ? await getStripeForClient(clientId)
            : getStripeFromEvent(event);
        let full;
        try {
          full = await stripe.checkout.sessions.retrieve(session.id, { expand: [] });
        } catch (err) {
          const msg = String(err?.message || '');
          const cleanKey = String(process.env.CLEANLEMON_STRIPE_SECRET_KEY || '').trim();
          const canFallback = !clientId && cleanKey && msg.includes('No such checkout.session');
          if (!canFallback) throw err;
          const cleanStripe = new Stripe(cleanKey, { apiVersion: STRIPE_API_VERSION });
          full = await cleanStripe.checkout.sessions.retrieve(session.id, { expand: [] });
        }
        if (full?.metadata?.type === 'cleanlemon_subscription') {
          const intervalCode = String(full.metadata?.interval_code || 'month').trim().toLowerCase();
          const intervalDivisor = intervalCode === 'year' ? 12 : intervalCode === 'quarter' ? 3 : 1;
          const totalAmount = Number(full.amount_total || 0) / 100;
          const monthlyPrice = Number((totalAmount / intervalDivisor).toFixed(2));
          const paidDateYmdFb = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kuala_Lumpur',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(Number(full.created || 0) * 1000 || Date.now()));
          const payload = {
            email: String(full.metadata?.customer_email || full.customer_details?.email || '').trim().toLowerCase(),
            companyName: String(full.metadata?.customer_name || full.customer_details?.name || '').trim(),
            planCode: String(full.metadata?.plan_code || 'starter').trim().toLowerCase(),
            intervalCode,
            monthlyPrice,
            amountTotalCents: Number(full.amount_total || 0),
            stripeSessionId: full.id,
            stripeSessionCreated: Number(full.created || 0),
            paidDateYmd: paidDateYmdFb,
            stripeCustomerId: full.customer ? String(full.customer) : '',
            stripeSubscriptionId: full.subscription ? String(full.subscription) : '',
            stripePriceId: full.metadata?.price_id ? String(full.metadata.price_id) : '',
            stripeStatus: String(full.payment_status || ''),
            checkoutAction: String(full.metadata?.checkout_action || '').trim().toLowerCase(),
            operatorId: String(full.metadata?.operator_id || '').trim(),
          };
          const saved = await cleanlemonService.upsertSubscriptionFromStripeCheckout(payload);
          return sendWebhookResponse(true, { type: 'cleanlemon_subscription', ...saved, via: 'fallback_retrieve' });
        }
        if (full?.metadata?.type === 'cleanlemon_addon') {
          const addonResult = await cleanlemonService.activateAddonFromStripeCheckoutSession(full);
          return sendWebhookResponse(true, { type: 'cleanlemon_addon', ...addonResult, via: 'fallback_retrieve' });
        }
        const { handled, result } = await handleCheckoutSessionCompleted(full);
        if (handled) {
          return sendWebhookResponse(true, result);
        }
        if (full.metadata?.type === 'pricingplan' && full.metadata?.pricingplanlog_id && full.metadata?.client_id) {
          const pool = require('../../config/db');
          const { handlePricingPlanPaymentSuccess } = require('../billing/checkout.service');
          const { finalizeSaasPlanAfterBillplzPayment } = require('../billing/indoor-admin.service');
          const [[scenarioRow]] = await pool.query(
            'SELECT scenario FROM pricingplanlogs WHERE id = ? LIMIT 1',
            [full.metadata.pricingplanlog_id]
          );
          const scenario = String(scenarioRow?.scenario || '');
          let planResult;
          if (scenario === 'SAAS_BILLPLZ') {
            planResult = await finalizeSaasPlanAfterBillplzPayment({
              pricingplanlogId: full.metadata.pricingplanlog_id,
              paidDateStr: getTodayMalaysiaDate(),
              paymentMethodLabel: 'Stripe'
            });
          } else {
            planResult = await handlePricingPlanPaymentSuccess({
              pricingplanlogId: full.metadata.pricingplanlog_id,
              clientId: full.metadata.client_id
            });
            if (planResult.ok && !planResult.already) {
              try {
                const { createSaasBukkuCashInvoiceIfConfigured, buildPlanDescription, ensureClientBukkuContact, PRODUCT_PRICINGPLAN, ACCOUNT_REVENUE, PAYMENT_STRIPE } = require('../billing/saas-bukku.service');
                const amount = (typeof full.amount_total === 'number' ? full.amount_total : 0) / 100;
                const paidDate = getTodayMalaysiaDate();
                const whenStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
                const currency = (full.currency || 'myr').toUpperCase();
                const defaultContactId = process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID ? Number(process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID) : null;
                const contactId = (await ensureClientBukkuContact(full.metadata.client_id)) ?? defaultContactId;
                let clientName = '';
                let planTitle = String(full.metadata?.planId || '').trim();
                const [[clientRow]] = await pool.query('SELECT title FROM operatordetail WHERE id = ? LIMIT 1', [full.metadata.client_id]);
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
                  : { ok: false, reason: 'no_contact_id' };
                if (invRes.ok && !invRes.skipped && full.metadata.pricingplanlog_id && (invRes.invoiceId != null || invRes.invoiceUrl)) {
                  await pool.query('UPDATE pricingplanlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?', [invRes.invoiceId != null ? String(invRes.invoiceId) : null, invRes.invoiceUrl || null, full.metadata.pricingplanlog_id]);
                }
                if (!invRes.ok || invRes.skipped) {
                  console.warn('[stripe webhook] pricingplan: SaaS platform did not open invoice —', invRes.reason || invRes.error || 'no contact or Bukku not configured. Set BUKKU_SAAS_API_KEY, BUKKU_SAAS_SUBDOMAIN.');
                }
              } catch (bukkuErr) {
                console.warn('[stripe webhook] pricingplan SaaS Bukku invoice failed', bukkuErr?.message || bukkuErr);
              }
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
          eventId: event.id,
          accountId: account.id,
          charges_enabled: account.charges_enabled,
          metadata_client_id: account.metadata?.client_id || null,
          matchedClientId,
          ecsWebhookTest: account.metadata?.ecs_webhook_test || null
        });
        const { handleAccountUpdated } = require('./stripe.service');
        const { handled, result } = await handleAccountUpdated(account, matchedClientId || null);
        if (handled) {
          console.log('[stripe webhook] account.updated handled', result);
          return sendWebhookResponse(true, result);
        }
      }
    }
    if (event.type === 'payout.paid' || event.type === 'payout.failed' || event.type === 'payout.canceled') {
      const payout = event.data?.object || null;
      if (matchedClientId && payout?.id) {
        const row = await upsertStripeOperatorPayoutFromWebhook(matchedClientId, {
          ...payout,
          status: event.type === 'payout.paid'
            ? 'paid'
            : event.type === 'payout.failed'
              ? 'failed'
              : 'canceled'
        });
        let journal = null;
        if (event.type === 'payout.paid' && row) {
          journal = await createJournalForStripeOperatorPayoutRow(row);
        }
        return sendWebhookResponse(true, {
          type: 'stripe_payout_webhook',
          payoutId: payout.id,
          status: event.type.replace('payout.', ''),
          journal
        });
      }
    }
    return sendWebhookResponse(false);
  } catch (err) {
    console.error('[stripe webhook]', {
      message: err?.message,
      type: err?.type,
      code: err?.code,
      statusCode: err?.statusCode,
      requestId: err?.requestId || err?.raw?.requestId || null
    });
    // Stripe 统计非 2xx 为失败 → 验签失败时我们返回 400，所以 Dashboard 显示 100% Error rate
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
}

module.exports = router;
module.exports.webhookHandler = webhookHandler;
