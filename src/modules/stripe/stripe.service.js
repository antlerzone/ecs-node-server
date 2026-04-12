/**
 * Stripe wrapper for SaaS property management.
 *
 * Two flows:
 * 1. Client credit top-up: Stripe webhooks write **creditlogs (Topup)** + **operatordetail.credit** + **syncSubtablesFromOperatordetail**
 *    (same as billing Topup). Idempotent by reference_number `CT-{payment_intent}`.
 * 2. Tenant rent / invoice / meter: Tenant pays operator’s Stripe directly. On success we deduct **1% of gross** from
 *    operator client_credit (may go negative if balance is low) and write creditlogs **type = `Spending`**, title **Stripe Processing Fees**
 *    (ledger only; not Stripe Connect “release”). No tenant payment is held waiting for credit.
 */

const Stripe = require('stripe');
const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { syncSubtablesFromOperatordetail } = require('../../services/client-subtables');
const {
  PLATFORM_MARKUP_PERCENT,
  getStripeEstimateGatewayPercent,
  computeFeeSplitFromGrossGatewayAndMarkupCents,
  computeColivingSaasStripeCheckoutBreakdown
} = require('../../constants/payment-fees');
const { utcDatetimeFromDbToMalaysiaDateOnly } = require('../../utils/dateMalaysia');
const {
  getStripeDirectCredentials,
  getStripeWebhookCandidateSecrets,
  markStripeWebhookVerified,
  markStripeWebhookTestRequested,
  saveStripeOAuthConnection,
  assertClientPaymentGatewayConnected,
  assertClientPaymentGatewayUsable
} = require('../payment-gateway/payment-gateway.service');

const STRIPE_API_VERSION = '2024-11-20.acacia';
let stripeLive = null;
let stripeSandbox = null;
let stripeLiveSG = null;
let stripeSandboxSG = null;
const directStripeClients = new Map();

function getDirectStripe(secretKey) {
  const key = String(secretKey || '').trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY_REQUIRED');
  if (!directStripeClients.has(key)) {
    directStripeClients.set(key, new Stripe(key, { apiVersion: STRIPE_API_VERSION }));
  }
  return directStripeClients.get(key);
}

async function getStripeWebhookTestClient(clientId) {
  const direct = await getStripeDirectCredentials(clientId, { allowPending: true });
  const accountId = String(direct?.accountId || await getClientStripeConnectedAccountId(clientId) || '').trim();
  if (!accountId) throw new Error('STRIPE_ACCOUNT_ID_REQUIRED');
  const accessToken = String(direct?.oauthAccessToken || '').trim();
  if (accessToken) {
    return { stripe: getDirectStripe(accessToken), accountId, mode: 'oauth_access_token' };
  }
  const secretKey = String(direct?.secretKey || '').trim();
  if (secretKey) {
    return { stripe: getDirectStripe(secretKey), accountId, mode: 'direct_secret_key' };
  }
  throw new Error('STRIPE_DIRECT_PAYMENT_CREDENTIALS_MISSING');
}

/**
 * Get Stripe instance: live or sandbox, MY (Malaysia) or SG (Singapore) platform.
 * @param {boolean} [useSandbox=false]
 * @param {string} [platform='MY'] - 'MY' = Malaysia (MYR), 'SG' = Singapore (SGD)
 * @returns {import('stripe').Stripe}
 */
function getStripe(useSandbox = false, platform = 'MY') {
  const isSG = String(platform || 'MY').toUpperCase() === 'SG';
  if (isSG) {
    if (useSandbox) {
      if (!stripeSandboxSG) {
        const key = process.env.STRIPE_SG_SANDBOX_SECRET_KEY;
        if (!key) throw new Error('STRIPE_SG_SANDBOX_SECRET_KEY is not set (required for SG sandbox)');
        stripeSandboxSG = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
      }
      return stripeSandboxSG;
    }
    if (!stripeLiveSG) {
      const key = process.env.STRIPE_SG_SECRET_KEY || process.env.STRIPE_SG_SANDBOX_SECRET_KEY;
      if (!key) throw new Error('STRIPE_SG_SECRET_KEY or STRIPE_SG_SANDBOX_SECRET_KEY is not set');
      stripeLiveSG = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
    }
    return stripeLiveSG;
  }
  if (useSandbox) {
    if (!stripeSandbox) {
      const key = process.env.STRIPE_SANDBOX_SECRET_KEY;
      if (!key) throw new Error('STRIPE_SANDBOX_SECRET_KEY is not set (required for demo/sandbox clients)');
      stripeSandbox = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
    }
    return stripeSandbox;
  }
  if (!stripeLive) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    stripeLive = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  }
  return stripeLive;
}

/**
 * Resolve stripe_platform for client: from client_profile, or from operatordetail.currency (SGD -> SG, else MY). Updates profile if was null.
 * @param {string} clientId
 * @returns {Promise<'MY'|'SG'>}
 */
async function resolveClientStripePlatform(clientId) {
  const [profileRows] = await pool.query(
    'SELECT stripe_platform FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  let platform = (profileRows[0] && profileRows[0].stripe_platform) ? String(profileRows[0].stripe_platform).toUpperCase() : null;
  if (platform === 'MY' || platform === 'SG') return platform;
  const [clientRows] = await pool.query(
    'SELECT currency FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  platform = (clientRows[0] && String(clientRows[0].currency || '').toUpperCase() === 'SGD') ? 'SG' : 'MY';
  if (profileRows.length) {
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    await pool.query(
      'UPDATE client_profile SET stripe_platform = ?, updated_at = ? WHERE client_id = ?',
      [platform, now, clientId]
    ).catch(() => {});
  }
  return platform;
}

/**
 * Get Stripe instance for a client (stripe_sandbox + stripe_platform). Platform defaults from currency (SGD -> SG) if not set.
 * @param {string} clientId
 * @returns {Promise<import('stripe').Stripe>}
 */
async function getStripeForClient(clientId) {
  const direct = await getStripeDirectCredentials(clientId, { allowPending: false });
  if (direct?.secretKey) {
    return getDirectStripe(direct.secretKey);
  }
  const forceDemo = process.env.FORCE_PAYMENT_SANDBOX === '1' || process.env.FORCE_PAYMENT_SANDBOX === 'true';
  const [rows] = await pool.query(
    'SELECT stripe_sandbox, stripe_platform FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const useSandbox = forceDemo || (rows.length && Number(rows[0].stripe_sandbox) === 1);
  const platform = await resolveClientStripePlatform(clientId);
  return getStripe(useSandbox, platform);
}

async function getStripeForDirectClient(clientId, { allowPending = false } = {}) {
  const direct = await getStripeDirectCredentials(clientId, { allowPending });
  if (!direct) throw new Error('STRIPE_DIRECT_NOT_CONFIGURED');
  const accessToken = String(direct.oauthAccessToken || '').trim();
  if (accessToken) return getDirectStripe(accessToken);
  const secretKey = String(direct.secretKey || '').trim();
  if (secretKey) return getDirectStripe(secretKey);
  throw new Error('STRIPE_DIRECT_PAYMENT_CREDENTIALS_MISSING');
}

async function getStripeForTenantPaymentClient(clientId, { allowPending = true } = {}) {
  try {
    return await getStripeForDirectClient(clientId, { allowPending });
  } catch (_) {
    return getStripeForClient(clientId);
  }
}

/**
 * Get Stripe instance from webhook event (event.livemode: false = test = sandbox).
 * @param {import('stripe').Stripe.Event} event
 * @returns {import('stripe').Stripe}
 */
function getStripeFromEvent(event) {
  return getStripe(!event.livemode);
}

/**
 * Publishable key for frontend Stripe.js (pk_test_... or pk_live_...). Optional env vars.
 * @param {boolean} [useSandbox=false]
 * @param {string} [platform='MY']
 * @returns {string|null}
 */
function getPublishableKey(useSandbox = false, platform = 'MY') {
  const isSG = String(platform || 'MY').toUpperCase() === 'SG';
  if (isSG) {
    const key = useSandbox
      ? process.env.STRIPE_SG_SANDBOX_PUBLISHABLE_KEY
      : (process.env.STRIPE_SG_PUBLISHABLE_KEY || process.env.STRIPE_SG_SANDBOX_PUBLISHABLE_KEY);
    return key && String(key).trim() ? String(key).trim() : null;
  }
  const key = useSandbox
    ? process.env.STRIPE_SANDBOX_PUBLISHABLE_KEY
    : process.env.STRIPE_PUBLISHABLE_KEY;
  return key && String(key).trim() ? String(key).trim() : null;
}

/**
 * Publishable key for a client (by stripe_sandbox + stripe_platform). For Stripe.js on companysetting / payment pages.
 * @param {string} clientId
 * @returns {Promise<string|null>}
 */
async function getPublishableKeyForClient(clientId) {
  const forceDemo = process.env.FORCE_PAYMENT_SANDBOX === '1' || process.env.FORCE_PAYMENT_SANDBOX === 'true';
  const [rows] = await pool.query(
    'SELECT stripe_sandbox, stripe_platform FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const useSandbox = forceDemo || (rows.length && Number(rows[0].stripe_sandbox) === 1);
  const platform = await resolveClientStripePlatform(clientId);
  return getPublishableKey(useSandbox, platform);
}

/**
 * Whether client uses Stripe sandbox (demo). From client_profile.stripe_sandbox.
 * @param {string} clientId
 * @returns {Promise<boolean>}
 */
async function getClientStripeSandbox(clientId) {
  const [rows] = await pool.query(
    'SELECT stripe_sandbox FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const forceDemo = process.env.FORCE_PAYMENT_SANDBOX === '1' || process.env.FORCE_PAYMENT_SANDBOX === 'true';
  if (forceDemo) return true;
  return rows.length && Number(rows[0].stripe_sandbox) === 1;
}

/**
 * Get client's total credit balance (first row amount, same as access.service).
 * @param {string} clientId
 * @returns {Promise<number>}
 */
async function getClientCreditBalance(clientId) {
  const [rows] = await pool.query(
    'SELECT amount FROM client_credit WHERE client_id = ? ORDER BY id ASC LIMIT 1',
    [clientId]
  );
  if (!rows.length) return 0;
  return Number(rows[0].amount) || 0;
}

/**
 * Deduct amount from client's credit (updates first credit row by client_id).
 * @param {string} clientId
 * @param {number} amount
 * @param {import('mysql2/promise').Connection} [conn]
 * @param {{ allowNegative?: boolean }} [opts] - tenant SaaS fee: allow balance to go below zero
 * @returns {Promise<{ ok: boolean, newBalance?: number }>}
 */
async function deductClientCredit(clientId, amount, conn = null, opts = {}) {
  const allowNegative = opts && opts.allowNegative === true;
  const run = conn || pool;
  const amt = Math.max(0, Number(amount) || 0);
  if (amt <= 0) return { ok: true, newBalance: undefined };
  const [rows] = await run.query(
    'SELECT id, amount FROM client_credit WHERE client_id = ? ORDER BY id ASC LIMIT 1',
    [clientId]
  );
  if (!rows.length) {
    if (!allowNegative) return { ok: false };
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    await run.query(
      `INSERT INTO client_credit (id, client_id, type, amount, created_at, updated_at)
       VALUES (?, ?, 'flex', ?, ?, ?)`,
      [id, clientId, -amt, now, now]
    );
    return { ok: true, newBalance: -amt };
  }
  const row = rows[0];
  const current = Number(row.amount) || 0;
  const newAmount = allowNegative ? current - amt : Math.max(0, current - amt);
  await run.query('UPDATE client_credit SET amount = ?, updated_at = NOW() WHERE id = ?', [
    newAmount,
    row.id
  ]);
  return { ok: true, newBalance: newAmount };
}

/**
 * Add amount to client's credit. Uses first row or inserts one if none.
 * @param {string} clientId
 * @param {number} amount
 * @param {import('mysql2/promise').Connection} [conn]
 * @returns {Promise<{ ok: boolean }>}
 */
async function addClientCredit(clientId, amount, conn = null) {
  const run = conn || pool;
  const [rows] = await run.query(
    'SELECT id, amount FROM client_credit WHERE client_id = ? ORDER BY id ASC LIMIT 1',
    [clientId]
  );
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  if (rows.length) {
    const current = Number(rows[0].amount) || 0;
    await run.query('UPDATE client_credit SET amount = ?, updated_at = ? WHERE id = ?', [
      current + amount,
      now,
      rows[0].id
    ]);
  } else {
    const id = randomUUID();
    await run.query(
      `INSERT INTO client_credit (id, client_id, type, amount, created_at, updated_at)
       VALUES (?, ?, 'flex', ?, ?, ?)`,
      [id, clientId, amount, now, now]
    );
  }
  return { ok: true };
}

/**
 * Get client's Stripe Connect account id (from client_profile.stripe_connected_account_id).
 * Only set after onboarding completes (account.updated with charges_enabled).
 * @param {string} clientId
 * @returns {Promise<string|null>}
 */
async function getClientStripeConnectedAccountId(clientId) {
  const [rows] = await pool.query(
    'SELECT stripe_connected_account_id FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  if (!rows.length) return null;
  const id = rows[0].stripe_connected_account_id;
  return id && String(id).trim() ? String(id).trim() : null;
}

/**
 * Tenant payment succeeded on operator Stripe: deduct 1% SaaS credits + insert RentRelease creditlog (no Connect transfer).
 */
async function applyStripeTenantSaaSFeeDeduction({
  clientId,
  paymentIntentId,
  deductCredits,
  stripeFeeCents,
  platformMarkupCents,
  gatewayModelCents,
  amountCents,
  effectiveFeePercent,
  paymentMethodLabel,
  tenancyId,
  tenantId,
  tenantName,
  creditLogChargeType,
  clientCurrency
}) {
  const conn = await pool.getConnection();
  const refNum = `RR-${paymentIntentId}`;
  try {
    await conn.beginTransaction();
    const [dupRows] = await conn.query(
      'SELECT id FROM creditlogs WHERE client_id = ? AND reference_number = ? LIMIT 1',
      [clientId, refNum]
    );
    if (dupRows.length) {
      await conn.rollback();
      console.log('[stripe] SaaS fee already applied (idempotent skip)', {
        clientId,
        paymentIntentId,
        refNum
      });
      try {
        await pool.query('DELETE FROM stripe_rent_pending_release WHERE payment_intent_id = ?', [paymentIntentId]);
      } catch (_) {}
      try {
        const { clearBillingCacheByClientId } = require('../billing/billing.service');
        clearBillingCacheByClientId(clientId);
      } catch (_) {}
      return { released: true, transferId: null, deductCredits: 0, duplicate: true };
    }
    if (deductCredits > 0) {
      await deductClientCredit(clientId, deductCredits, conn, { allowNegative: true });
    }
    const logId = randomUUID();
    await insertRentReleaseCreditLog(conn, {
      logId,
      clientId,
      deductCredits,
      stripeFeeCents,
      platformMarkupCents,
      gatewayModelCents,
      amountCents,
      transferToOperatorCents: amountCents,
      effectiveFeePercent,
      paymentMethodLabel,
      paymentIntentId,
      transferId: null,
      tenancyId,
      tenantId: tenantId || null,
      tenantName,
      chargeType: creditLogChargeType,
      currency: clientCurrency
    });
    await conn.commit();
    await pool.query('DELETE FROM stripe_rent_pending_release WHERE payment_intent_id = ?', [paymentIntentId]);
    try {
      const { clearBillingCacheByClientId } = require('../billing/billing.service');
      clearBillingCacheByClientId(clientId);
    } catch (_) {}
    return { released: true, transferId: null, deductCredits };
  } catch (pfErr) {
    await conn.rollback();
    console.warn('[stripe] direct settlement credit/process failed', pfErr?.message || pfErr);
    throw pfErr;
  } finally {
    conn.release();
  }
}

async function findClientIdByConnectedAccountId(accountId) {
  const id = String(accountId || '').trim();
  if (!id) return null;
  const [rows] = await pool.query(
    'SELECT client_id FROM client_profile WHERE stripe_connected_account_id = ? LIMIT 1',
    [id]
  );
  return rows.length && rows[0].client_id ? String(rows[0].client_id).trim() : null;
}

/**
 * Get client's pending Stripe Connect account id (before onboarding completes).
 * @param {string} clientId
 * @returns {Promise<string|null>}
 */
async function getClientStripeConnectPendingId(clientId) {
  const [rows] = await pool.query(
    'SELECT stripe_connect_pending_id FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  if (!rows.length) return null;
  const id = rows[0].stripe_connect_pending_id;
  return id && String(id).trim() ? String(id).trim() : null;
}

// --- Payment Intent: Client credit top-up (platform) ---

/**
 * Create a Payment Intent for client credit top-up. Money goes to platform; webhook applies ledger-aligned top-up (creditlogs + operatordetail).
 * @param {{ amountCents: number, currency: string, clientId: string, metadata?: object }} opts
 * @returns {Promise<{ clientSecret: string, paymentIntentId: string }>}
 */
async function createPaymentIntentForCredit({ amountCents, currency, clientId, metadata = {} }) {
  const stripe = await getStripeForClient(clientId);
  const pi = await stripe.paymentIntents.create({
    amount: Math.max(1, Math.round(amountCents)),
    currency: (currency || 'myr').toLowerCase(),
    automatic_payment_methods: { enabled: true },
    metadata: {
      type: 'credit_topup',
      client_id: String(clientId),
      ...metadata
    }
  });
  console.log('[stripe] PaymentIntent created (credit)', { id: pi.id, amount: pi.amount, currency: pi.currency, metadata: pi.metadata });
  return {
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id
  };
}

/**
 * Handle successful Payment Intent for credit top-up: same ledger path as billing Topup (creditlogs + operatordetail + sync).
 * Called from webhook when payment_intent.succeeded and metadata.type === 'credit_topup'.
 * @param {{ paymentIntentId: string, amountReceivedCents: number, currency: string, clientId: string }} payload
 * @returns {Promise<{ ok: boolean, duplicate?: boolean, creditlogId?: string, reason?: string }>}
 */
async function handleCreditTopupSuccess(payload) {
  const { clientId, amountReceivedCents, currency, paymentIntentId } = payload;
  const amount = (amountReceivedCents || 0) / 100;
  if (amount <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
  const piId = paymentIntentId && String(paymentIntentId).trim() ? String(paymentIntentId).trim() : null;
  const payloadJson = JSON.stringify({
    source: 'payment_intent.succeeded',
    payment_intent: piId
  });
  return applyStripeCreditTopupAligned({
    clientId,
    creditAmount: amount,
    paymentAmountMajor: amount,
    currency,
    paymentIntentId: piId,
    checkoutSessionId: null,
    payloadJson
  });
}

/**
 * credit_topup (Checkout or PaymentIntent): align wallet with ledger — same as `Topup` + creditlog_id webhook path.
 * Idempotent: one row per Stripe PaymentIntent via reference_number `CT-{paymentIntentId}` (fallback `CT-CS-{checkoutSessionId}` if no PI).
 * @param {{ clientId: string, creditAmount: number, paymentAmountMajor: number, currency?: string|null, paymentIntentId?: string|null, checkoutSessionId?: string|null, payloadJson?: string|null }} opts
 * @returns {Promise<{ ok: boolean, duplicate?: boolean, creditlogId?: string, reason?: string }>}
 */
async function applyStripeCreditTopupAligned(opts) {
  const {
    clientId,
    creditAmount,
    paymentAmountMajor,
    currency,
    paymentIntentId,
    checkoutSessionId,
    payloadJson
  } = opts || {};
  const credits = Number(creditAmount);
  if (!clientId || !Number.isFinite(credits) || credits <= 0) {
    return { ok: false, reason: 'INVALID_PARAMS' };
  }
  const pi = paymentIntentId && String(paymentIntentId).trim()
    ? String(paymentIntentId).trim()
    : null;
  const cs = checkoutSessionId && String(checkoutSessionId).trim()
    ? String(checkoutSessionId).trim()
    : null;
  const refNum = pi ? `CT-${pi}` : cs ? `CT-CS-${cs}` : null;
  if (!refNum) return { ok: false, reason: 'NO_STRIPE_REF' };

  const [dup] = await pool.query(
    'SELECT id FROM creditlogs WHERE client_id = ? AND reference_number = ? LIMIT 1',
    [clientId, refNum]
  );
  if (dup.length) {
    console.log('[stripe] credit_topup idempotent skip', { clientId, refNum, creditlogId: dup[0].id });
    return { ok: true, duplicate: true, creditlogId: dup[0].id };
  }

  const [clientRows] = await pool.query(
    'SELECT id, currency, credit FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length) throw new Error('client not found');
  const currFromClient = String(clientRows[0].currency || '').trim().toUpperCase();
  const currFromOpt = currency && String(currency).trim() ? String(currency).trim().toUpperCase() : '';
  const currUpper = currFromOpt || currFromClient;
  if (!currUpper || (currUpper !== 'MYR' && currUpper !== 'SGD')) {
    throw new Error('CLIENT_CURRENCY_MISSING');
  }

  const logId = randomUUID();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const title = 'Credit top-up (Stripe)';
  const payMajor = paymentAmountMajor != null && Number.isFinite(Number(paymentAmountMajor))
    ? Number(paymentAmountMajor)
    : credits;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [dup2] = await conn.query(
      'SELECT id FROM creditlogs WHERE client_id = ? AND reference_number = ? LIMIT 1',
      [clientId, refNum]
    );
    if (dup2.length) {
      await conn.rollback();
      return { ok: true, duplicate: true, creditlogId: dup2[0].id };
    }

    await conn.query(
      `INSERT INTO creditlogs (id, title, type, client_id, staff_id, currency, payment, amount, is_paid, reference_number, paiddate, payload, txnid, created_at, updated_at)
       VALUES (?, ?, 'Topup', ?, NULL, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [logId, title, clientId, currUpper, payMajor, credits, refNum, now, payloadJson || null, pi || null, now, now]
    );

    const raw = clientRows[0].credit;
    let creditList = [];
    try {
      creditList = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
    } catch (_) {}
    let flex = creditList.find((c) => c.type === 'flex');
    if (!flex) {
      flex = { type: 'flex', amount: 0 };
      creditList.push(flex);
    }
    flex.amount = Number(flex.amount) || 0;
    flex.amount += credits;
    const newCreditJson = JSON.stringify(creditList);
    await conn.query('UPDATE operatordetail SET credit = ?, updated_at = NOW() WHERE id = ?', [newCreditJson, clientId]);
    await syncSubtablesFromOperatordetail(conn, clientId);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  try {
    const { processPayexPendingFees } = require('../payex/payex.service');
    await processPayexPendingFees(clientId);
  } catch (e) {
    console.warn('[stripe] processPayexPendingFees after credit_topup failed:', e?.message);
  }
  try {
    const { processBillplzPendingFees } = require('../billplz/billplz.service');
    await processBillplzPendingFees(clientId);
  } catch (e) {
    console.warn('[stripe] processBillplzPendingFees after credit_topup failed:', e?.message);
  }
  try {
    const { clearBillingCacheByClientId } = require('../billing/billing.service');
    clearBillingCacheByClientId(clientId);
  } catch (_) {}

  console.log('[creditlogs] INSERT Topup (credit_topup aligned)', { id: logId, client_id: clientId, amount: credits, reference_number: refNum });
  return { ok: true, duplicate: false, creditlogId: logId };
}

// --- Payment Intent: Tenant rent (platform capture, then optional Transfer to Connect) ---

/**
 * Resolve tenant name and room name for a tenant in this client (for PaymentIntent metadata).
 * @param {string} clientId
 * @param {string} [tenantId]
 * @returns {Promise<{ tenantName: string, roomName: string }>}
 */
async function getTenantAndRoomNames(clientId, tenantId) {
  const out = { tenantName: '', roomName: '' };
  if (!tenantId) return out;
  const [tenantRows] = await pool.query(
    'SELECT fullname FROM tenantdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [tenantId, clientId]
  );
  if (tenantRows.length && tenantRows[0].fullname) {
    out.tenantName = String(tenantRows[0].fullname).trim().slice(0, 500);
  }
  const [tenancyRows] = await pool.query(
    'SELECT room_id FROM tenancy WHERE tenant_id = ? AND client_id = ? ORDER BY begin DESC LIMIT 1',
    [tenantId, clientId]
  );
  if (!tenancyRows.length || !tenancyRows[0].room_id) return out;
  const [roomRows] = await pool.query(
    'SELECT roomname FROM roomdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyRows[0].room_id, clientId]
  );
  if (roomRows.length && roomRows[0].roomname) {
    out.roomName = String(roomRows[0].roomname).trim().slice(0, 500);
  }
  return out;
}

/**
 * Create a Payment Intent for tenant rent. No transfer_data; we receive funds on platform.
 * Metadata should include type, tenant_name, room_name (and client_id, tenant_id) for Stripe Dashboard / transfer description.
 * @param {{ amountCents: number, currency: string, clientId: string, tenantId?: string, tenantName?: string, roomName?: string, metadata?: object }} opts
 * @returns {Promise<{ clientSecret: string, paymentIntentId: string }>}
 */
async function createPaymentIntentForRent({ amountCents, currency, clientId, tenantId, tenantName, roomName, metadata = {} }) {
  const stripe = await getStripeForClient(clientId);
  const meta = {
    type: 'rent',
    client_id: String(clientId),
    ...(tenantId ? { tenant_id: String(tenantId) } : {}),
    ...(tenantName ? { tenant_name: String(tenantName).slice(0, 500) } : {}),
    ...(roomName ? { room_name: String(roomName).slice(0, 500) } : {}),
    ...metadata
  };
  const pi = await stripe.paymentIntents.create({
    amount: Math.max(1, Math.round(amountCents)),
    currency: (currency || 'myr').toLowerCase(),
    automatic_payment_methods: { enabled: true },
    metadata: meta
  });
  console.log('[stripe] PaymentIntent created (rent)', { id: pi.id, amount: pi.amount, currency: pi.currency, metadata: pi.metadata });
  return {
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id
  };
}

/**
 * Get deduction for rent release: Stripe actual fee (from balance_transaction) + 1% platform markup.
 * Deduction is in whole credits (no decimals): e.g. 350 cents → 4 credit. Math.ceil(totalCents/100).
 * @param {import('stripe').Stripe} stripe
 * @param {string} paymentIntentId
 * @returns {Promise<{ deductCredits: number, stripeFeeCents: number, platformMarkupCents: number, stripeFeePercent: string, fallback: boolean }>}
 */
/**
 * Get payment method label for creditlogs: "local card" | "foreigner card" | "FPX" | "Paylah".
 * Client may be MY Stripe or SG Stripe: MY client + SG card = foreigner card; SG client + MY card = foreigner card.
 * @param {import('stripe').Stripe} stripe
 * @param {string} paymentIntentId
 * @param {string} [clientCurrency] - MYR or SGD; local = same country as currency (MYR→MY, SGD→SG).
 * @returns {Promise<string>}
 */
async function getPaymentMethodLabel(stripe, paymentIntentId, clientCurrency) {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.payment_method_details']
    });
    const details = pi.latest_charge?.payment_method_details;
    if (!details || typeof details !== 'object') return 'local card';
    const type = (details.type || '').toLowerCase();
    if (type === 'fpx') return 'FPX';
    if (type === 'grabpay' || type === 'paylah') return 'Paylah';
    if (type === 'card') {
      const country = (details.card?.country || '').toUpperCase();
      const curr = (clientCurrency || pi.currency || '').toUpperCase();
      const localCountry = curr === 'SGD' ? 'SG' : 'MY';
      return country === localCountry ? 'local card' : 'foreigner card';
    }
    return 'local card';
  } catch (_) {
    return 'local card';
  }
}

/**
 * Model split + optional Stripe actual processing fee from balance_transaction.
 * Stripe tenant payments deduct 1% SaaS markup from client_credit (whole credits via ceil).
 */
async function getRentDeduction(stripe, paymentIntentId) {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge.balance_transaction']
  });
  const amountCents = pi.amount_received || pi.amount || 0;
  const bt = pi.latest_charge?.balance_transaction;
  let stripeActualFeeCents = 0;
  let stripeActualFeeCurrency = '';
  let exchangeRate = null;
  if (bt && typeof bt === 'object' && typeof bt.fee === 'number') {
    stripeActualFeeCents = bt.fee;
    stripeActualFeeCurrency = String(bt.currency || '').trim().toLowerCase();
    exchangeRate = Number.isFinite(Number(bt.exchange_rate)) ? Number(bt.exchange_rate) : null;
  }
  if (stripeActualFeeCents === 0 && pi.latest_charge) {
    const btId = typeof pi.latest_charge.balance_transaction === 'string'
      ? pi.latest_charge.balance_transaction
      : bt?.id;
    if (btId) {
      try {
        const btFull = await stripe.balanceTransactions.retrieve(btId);
        stripeActualFeeCents = btFull.fee || 0;
        stripeActualFeeCurrency = String(btFull.currency || '').trim().toLowerCase();
        exchangeRate = Number.isFinite(Number(btFull.exchange_rate)) ? Number(btFull.exchange_rate) : null;
      } catch (_) {}
    }
  }
  const paymentCurrency = String(pi.currency || '').trim().toLowerCase();
  if (
    stripeActualFeeCents > 0 &&
    stripeActualFeeCurrency &&
    paymentCurrency &&
    stripeActualFeeCurrency !== paymentCurrency &&
    exchangeRate &&
    exchangeRate > 0
  ) {
    stripeActualFeeCents = Math.round(stripeActualFeeCents / exchangeRate);
  }
  const estGw = Math.round((amountCents * getStripeEstimateGatewayPercent()) / 100);
  const gatewayFeeForTransfer = stripeActualFeeCents > 0 ? stripeActualFeeCents : estGw;
  const split = computeFeeSplitFromGrossGatewayAndMarkupCents(amountCents, gatewayFeeForTransfer);
  const stripeFeePercent = amountCents
    ? (Math.fround((stripeActualFeeCents / amountCents) * 100)).toFixed(2)
    : '0.00';
  return {
    deductCredits: Math.max(0, Math.ceil(Number(split.saasMarkupCents) / 100)) || 0,
    stripeFeeCents: stripeActualFeeCents,
    platformMarkupCents: split.saasMarkupCents,
    gatewayModelCents: split.gatewayFeeCents,
    transferToOperatorCents: split.transferToOperatorCents,
    grossCents: split.grossCents,
    stripeFeePercent,
    fallback: stripeActualFeeCents === 0
  };
}

/**
 * Estimated fees for rent Checkout UI: **1% SaaS** + **estimated** gateway % from `STRIPE_ESTIMATE_GATEWAY_PERCENT` (default 4.5).
 * Actual Stripe fee at capture may differ (e.g. local vs foreign card).
 * @param {number} amountCents
 * @returns {{ markupCredits: number, estimatedPercent: number, estimatedTotalFeeCents: number, estimatedOperatorNetCents: number, estimatedGatewayPercent: number }}
 */
function getEstimatedRentDeduction(amountCents) {
  const gwPct = getStripeEstimateGatewayPercent();
  const gatewayCents = Math.round((amountCents * gwPct) / 100);
  const saasCents = Math.round((amountCents * PLATFORM_MARKUP_PERCENT) / 100);
  const totalFeeCents = gatewayCents + saasCents;
  const estimatedPercent = Math.round((gwPct + PLATFORM_MARKUP_PERCENT) * 100) / 100;
  const split = computeFeeSplitFromGrossGatewayAndMarkupCents(amountCents, gatewayCents);
  return {
    markupCredits: 0,
    estimatedPercent,
    estimatedTotalFeeCents: totalFeeCents,
    estimatedOperatorNetCents: split.transferToOperatorCents,
    estimatedGatewayPercent: gwPct
  };
}

function tenantNameOrDash(tenantName) {
  const s = tenantName != null ? String(tenantName).trim() : '';
  return s || '—';
}

/**
 * Insert creditlogs row for tenant Stripe payment: 1% gross as amount (negative); credits deducted via deductClientCredit (payload.deduct_credits).
 * type Spending, title Stripe Processing Fees; payment NULL; currency = operator (passed as client currency / PI).
 */
async function insertRentReleaseCreditLog(conn, opts) {
  const {
    logId,
    clientId,
    deductCredits,
    stripeFeeCents,
    platformMarkupCents,
    gatewayModelCents,
    amountCents,
    transferToOperatorCents,
    effectiveFeePercent,
    paymentMethodLabel,
    paymentIntentId,
    transferId,
    tenancyId,
    tenantId,
    tenantName,
    chargeType,
    currency
  } = opts;
  const title = 'Stripe Processing Fees';
  const remark = `Tenant pays your Stripe. ${PLATFORM_MARKUP_PERCENT}% of gross deducted from credit. Method: ${paymentMethodLabel}. Transaction ${paymentIntentId}${tenancyId ? ` Tenancy ${tenancyId}` : ''}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const refNum = `RR-${paymentIntentId}`;
  const stripeFeeAmount = stripeFeeCents / 100;
  const stripeFeePercentNum = amountCents ? (stripeFeeCents / amountCents) * 100 : 0;
  const platformMarkupAmount = platformMarkupCents / 100;
  /** Statement + running balance: integer credits only (matches deductClientCredit). Money 1% stays in platform_markup_amount + payload. */
  const dc = Math.max(0, Math.round(Number(deductCredits) || 0));
  const amountCredits = dc > 0 ? -dc : 0;
  const payloadStr = JSON.stringify({
    transaction_id: paymentIntentId,
    transfer_id: transferId || null,
    tenancy_id: tenancyId || null,
    tenant_id: tenantId || null,
    gross_amount_cents: amountCents,
    transfer_to_operator_cents: transferToOperatorCents,
    model_gateway_fee_cents: gatewayModelCents ?? 0,
    model_saas_markup_cents: platformMarkupCents,
    stripe_actual_fee_cents: stripeFeeCents,
    effective_fee_percent: effectiveFeePercent,
    deduct_credits: deductCredits,
    payment_method_label: paymentMethodLabel
  });
  await conn.query(
    `INSERT INTO creditlogs (id, title, type, amount, payment, client_id, staff_id, reference_number, payload, remark, currency, stripe_fee_amount, stripe_fee_percent, platform_markup_amount, tenant_name, charge_type, created_at, updated_at)
     VALUES (?, ?, 'Spending', ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      logId,
      title,
      amountCredits,
      clientId,
      refNum,
      payloadStr,
      remark,
      currency,
      stripeFeeAmount,
      stripeFeePercentNum,
      platformMarkupAmount,
      tenantNameOrDash(tenantName),
      chargeType || 'rental',
      now,
      now
    ]
  );
  try {
    const { upsertProcessingFeeLedgerRow } = require('../billing/processing-fee-log.service');
    await upsertProcessingFeeLedgerRow(
      {
        clientId,
        provider: 'stripe',
        chargeType: chargeType || 'rental',
        status: 'settlement',
        paymentId: paymentIntentId,
        referenceNumber: refNum,
        currency,
        grossAmountMajor: Number(((amountCents || 0) / 100).toFixed(2)),
        gatewayFeesAmountMajor: stripeFeeCents ? Number((stripeFeeAmount).toFixed(4)) : null,
        platformMarkupAmountMajor: Number((platformMarkupAmount).toFixed(4)),
        metadata: {
          deduct_credits: deductCredits,
          tenant_name: tenantNameOrDash(tenantName),
          payment_intent_id: paymentIntentId,
          tenancy_id: tenancyId || null,
          tenant_id: tenantId || null,
          creditlog_id: logId
        },
        _logCaller: 'stripe.insertRentReleaseCreditLog'
      },
      conn
    );
  } catch (e) {
    console.error(
      '[processing_fees] CALLER stripe.insertRentReleaseCreditLog (creditlog already saved; ledger failed)',
      e?.message || e
    );
  }
}

/**
 * Legacy: Connect payout journal (unused when tenant pays operator Stripe directly). Kept for old data / migrations.
 */
async function upsertStripePayout(conn, clientId, transferId, transferAmountCents, grossAmountCents, currency) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const payoutDate = now.slice(0, 10);
  const id = randomUUID();
  const curr = (currency || '').toString().toUpperCase();
  const estimatedFundDate = new Date(payoutDate);
  estimatedFundDate.setDate(estimatedFundDate.getDate() + 2);
  const estimatedFundDateStr = estimatedFundDate.toISOString().slice(0, 10);
  const g = Math.max(0, Math.round(Number(grossAmountCents) || 0));
  await conn.query(
    `INSERT INTO stripepayout (id, client_id, payout_date, total_amount_cents, gross_amount_cents, currency, transfer_ids, estimated_fund_receive_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, JSON_ARRAY(?), ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       total_amount_cents = total_amount_cents + ?,
       gross_amount_cents = IFNULL(gross_amount_cents, 0) + ?,
       transfer_ids = JSON_ARRAY_APPEND(COALESCE(transfer_ids, JSON_ARRAY()), '$', ?),
       updated_at = ?`,
    [id, clientId, payoutDate, transferAmountCents, g > 0 ? g : null, curr, transferId, estimatedFundDateStr, now, now, transferAmountCents, g, transferId, now]
  );
}

/**
 * Tenant payment succeeded on operator Stripe: deduct 1% SaaS from operator credit + RentRelease log only.
 * No Connect transfer (tenant pays operator directly).
 * @param {{ paymentIntentId: string, clientId: string, chargeType?: 'rental'|'invoice'|'meter' }} opts
 * @returns {Promise<{ released: boolean, reason?: string, transferId?: null, deductCredits?: number }>}
 */
async function releaseRentToClient({ paymentIntentId, clientId, chargeType }) {
  const stripe = await getStripeForTenantPaymentClient(clientId, { allowPending: true });
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.status !== 'succeeded') {
    return { released: false, reason: 'payment_not_succeeded' };
  }
  const piType = pi.metadata?.type;
  if (chargeType) {
    if (pi.metadata?.client_id && String(pi.metadata.client_id) !== String(clientId)) {
      return { released: false, reason: 'metadata_mismatch' };
    }
  } else {
    if (piType !== 'rent' || String(pi.metadata?.client_id) !== String(clientId)) {
      return { released: false, reason: 'metadata_mismatch' };
    }
  }
  const amountCents = pi.amount_received || pi.amount || 0;
  const deduction = await getRentDeduction(stripe, paymentIntentId);
  const {
    deductCredits,
    stripeFeeCents,
    platformMarkupCents,
    gatewayModelCents
  } = deduction;
  const creditLogChargeType =
    chargeType === 'meter' ? 'meter' : chargeType === 'invoice' ? 'invoice' : 'rental';
  let tenancyId = null;
  let tenantName = (pi.metadata?.tenant_name || '').trim().slice(0, 255) || null;
  if (pi.metadata?.tenant_id) {
    const [tnRows] = await pool.query(
      'SELECT id FROM tenancy WHERE tenant_id = ? AND client_id = ? ORDER BY begin DESC LIMIT 1',
      [pi.metadata.tenant_id, clientId]
    );
    if (tnRows.length) tenancyId = tnRows[0].id;
    if (!tenantName) {
      const [tdRows] = await pool.query('SELECT fullname FROM tenantdetail WHERE id = ? AND client_id = ? LIMIT 1', [pi.metadata.tenant_id, clientId]);
      if (tdRows.length && tdRows[0].fullname) tenantName = String(tdRows[0].fullname).trim().slice(0, 255);
    }
  }
  const paymentMethodLabel = await getPaymentMethodLabel(stripe, paymentIntentId, (pi.currency || 'myr').toUpperCase());
  const clientCurrency = (pi.currency || 'myr').toUpperCase();
  const modelTotalCents = (gatewayModelCents ?? 0) + (platformMarkupCents ?? 0);
  const effectiveFeePercent = amountCents
    ? (Math.round((modelTotalCents / amountCents) * 1000) / 10).toFixed(1)
    : '0';
  return applyStripeTenantSaaSFeeDeduction({
    clientId,
    paymentIntentId,
    deductCredits,
    stripeFeeCents,
    platformMarkupCents,
    gatewayModelCents,
    amountCents,
    effectiveFeePercent,
    paymentMethodLabel,
    tenancyId,
    tenantId: pi.metadata?.tenant_id || null,
    tenantName,
    creditLogChargeType,
    clientCurrency
  });
}

/**
 * @deprecated No longer used — SaaS fee always posts immediately (credit may go negative). Kept for one-off scripts.
 */
async function insertRentPendingRelease(clientId, paymentIntentId, chargeType = 'rental', conn = null) {
  const run = conn || pool;
  const id = randomUUID();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await run.query(
    'INSERT INTO stripe_rent_pending_release (id, client_id, payment_intent_id, charge_type, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, clientId, paymentIntentId, chargeType || 'rental', now]
  );
  return { ok: true };
}

/**
 * Get pending (held) releases for a client, oldest first.
 * @param {string} clientId
 * @returns {Promise<Array<{ id: string, client_id: string, payment_intent_id: string, charge_type: string, created_at: string }>>}
 */
async function getPendingRentReleases(clientId) {
  const [rows] = await pool.query(
    'SELECT id, client_id, payment_intent_id, charge_type, created_at FROM stripe_rent_pending_release WHERE client_id = ? ORDER BY created_at ASC',
    [clientId]
  );
  return rows;
}

/**
 * After operator top-up: apply 1% SaaS fee + RentRelease for any queued tenant payments (stripe_rent_pending_release).
 * @param {string} clientId
 * @returns {Promise<{ released: number, errors: string[] }>}
 */
async function tryReleasePendingRentReleases(clientId) {
  const pending = await getPendingRentReleases(clientId);
  const result = { released: 0, errors: [] };
  for (const row of pending) {
    const r = await releaseRentToClient({
      paymentIntentId: row.payment_intent_id,
      clientId: row.client_id,
      chargeType: row.charge_type || 'rental'
    });
    if (r.released) {
      result.released += 1;
    } else {
      result.errors.push(r.reason || 'release_failed');
      break;
    }
  }
  return result;
}

/**
 * After successful rent PaymentIntent: apply 1% SaaS credit fee + RentRelease log (no queue).
 * @param {{ paymentIntentId: string, clientId: string }} payload
 */
async function handleRentPaymentSuccess(payload) {
  const { paymentIntentId, clientId } = payload;
  try {
    return await releaseRentToClient({ paymentIntentId, clientId });
  } catch (err) {
    console.warn('[stripe] handleRentPaymentSuccess', err?.message || err);
    return { released: false, reason: err?.message || 'saas_fee_failed' };
  }
}

// --- Webhook: raw body + signature verification ---

/**
 * Build event from raw body and Stripe-Signature. Tries STRIPE_WEBHOOK_SECRET (live) then STRIPE_SANDBOX_WEBHOOK_SECRET (test).
 * @param {string|Buffer} rawBody
 * @param {string} signature
 * @returns {import('stripe').Stripe.Event}
 */
async function constructWebhookEvent(rawBody, signature) {
  const secrets = [
    [process.env.STRIPE_WEBHOOK_SECRET, false, 'MY'],
    [process.env.STRIPE_WEBHOOK_SECRET_CLEANLEMON, false, 'MY'],
    [process.env.CLEANLEMON_STRIPE_LIVE_WEBHOOK_SIGNING_SECRET, false, 'MY'],
    [process.env.STRIPE_SANDBOX_WEBHOOK_SECRET, true, 'MY'],
    [process.env.STRIPE_SG_WEBHOOK_SECRET, false, 'SG'],
    [process.env.STRIPE_SG_SANDBOX_WEBHOOK_SECRET, true, 'SG']
  ].filter(([s]) => s && String(s).trim());
  if (!secrets.length) {
    throw new Error('At least one Stripe webhook secret must be set (STRIPE_WEBHOOK_SECRET or STRIPE_SANDBOX_WEBHOOK_SECRET, or SG_ variants)');
  }
  let lastErr;
  const secretLabels = secrets.map(([, useSandbox, platform]) => `${platform}${useSandbox ? '_sandbox' : ''}`);
  for (const [secret, useSandbox, platform] of secrets) {
    try {
      const event = getStripe(useSandbox, platform).webhooks.constructEvent(rawBody, signature, secret);
      console.log('[stripe webhook] signature matched platform secret', {
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        platform,
        useSandbox
      });
      return event;
    } catch (e) {
      lastErr = e;
    }
  }
  const directCandidates = await getStripeWebhookCandidateSecrets();
  for (const candidate of directCandidates) {
    try {
      const event = getDirectStripe('sk_test_direct_webhook_placeholder').webhooks.constructEvent(rawBody, signature, candidate.webhookSecret);
      Object.defineProperty(event, '__matchedClientId', { value: candidate.clientId, enumerable: false, configurable: true });
      Object.defineProperty(event, '__matchedGatewayMode', { value: 'direct_secret', enumerable: false, configurable: true });
      console.log('[stripe webhook] signature matched direct secret', {
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        clientId: candidate.clientId,
        connectionStatus: candidate.connectionStatus,
        accountId: candidate.accountId || null
      });
      return event;
    } catch (e) {
      lastErr = e;
    }
  }
  // Help debug: event is test (livemode false) → use STRIPE_SANDBOX_WEBHOOK_SECRET from Dashboard
  const hasSandbox = secretLabels.some((l) => l.includes('_sandbox'));
  console.warn('[stripe webhook] signature verification failed for all secrets', {
    rawBodyLength: Buffer.isBuffer(rawBody) ? rawBody.length : 0,
    hasSignature: !!(signature && String(signature).trim()),
    signaturePreview: signature ? String(signature).slice(0, 24) : null,
    secretsTried: [...secretLabels, ...directCandidates.map((c) => `direct_${c.clientId}_${c.connectionStatus}`)],
    lastError: lastErr?.message,
    ...(!hasSandbox ? { hint: 'Test mode events need STRIPE_SANDBOX_WEBHOOK_SECRET (Dashboard → Test mode ON → Webhooks → Reveal signing secret)' } : {})
  });
  throw lastErr || new Error('Webhook signature verification failed');
}

/**
 * Handle payment_intent.succeeded: credit_topup -> applyStripeCreditTopupAligned; rent -> releaseRentToClient.
 * @param {import('stripe').Stripe.Event} event
 * @returns {Promise<{ handled: boolean, result?: object }>}
 */
async function handlePaymentIntentSucceeded(event) {
  const pi = event.data?.object;
  if (!pi || !pi.id) return { handled: false };
  console.log('[stripe] payment_intent.succeeded payload', { id: pi.id, amount_received: pi.amount_received, amount: pi.amount, currency: pi.currency, status: pi.status, metadata: pi.metadata });
  const type = pi.metadata?.type;
  const clientId = pi.metadata?.client_id || event.__matchedClientId;
  if (!clientId) return { handled: false };
  if (event.__matchedClientId) {
    try {
      await markStripeWebhookVerified(clientId, {
        eventType: event.type,
        accountId: event.account || pi.on_behalf_of || null
      });
    } catch (e) {
      console.warn('[stripe] mark direct webhook verified failed', e?.message || e);
    }
  }

  if (type === 'credit_topup') {
    await handleCreditTopupSuccess({
      paymentIntentId: pi.id,
      amountReceivedCents: pi.amount_received || pi.amount,
      currency: pi.currency,
      clientId
    });
    return { handled: true, result: { type: 'credit_topup', ok: true } };
  }

  if (type === 'rent') {
    const result = await handleRentPaymentSuccess({
      paymentIntentId: pi.id,
      clientId
    });
    return { handled: true, result: { type: 'rent', ...result } };
  }

  if (type === 'TenantInvoice') {
    const applied = await applyTenantInvoiceFromPaymentIntent(pi);
    return { handled: true, result: { type: 'TenantInvoice', ...applied } };
  }

  return { handled: false };
}

// --- Checkout Session: Topup & Pricing Plan (redirect flow) ---

/**
 * Create Stripe Checkout Session for topup or pricing plan. Returns redirect url.
 * Uses sandbox when clientId is provided and client has stripe_sandbox=1.
 * @param {{ amountCents: number, currency: string, email: string, description: string, returnUrl: string, cancelUrl: string, clientId?: string, metadata?: object }} opts
 * @returns {Promise<{ url: string }>}
 */
/**
 * Mark rental invoices paid + receipts + Connect release (same as checkout.session.completed TenantInvoice).
 * @param {import('stripe').Stripe.PaymentIntent} pi - must have metadata.type TenantInvoice and amount_cents, invoice_ids, etc.
 * @returns {Promise<{ ok: boolean, result?: object, reason?: string }>}
 */
async function applyTenantInvoiceFromPaymentIntent(pi) {
  const meta = pi.metadata || {};
  if (meta.type !== 'TenantInvoice') {
    return { ok: false, reason: 'INVALID_TYPE' };
  }
  const amountCentsStr = meta.amount_cents;
  const expectedCents = amountCentsStr != null ? parseInt(String(amountCentsStr), 10) : NaN;
  const receivedCents =
    typeof pi.amount_received === 'number'
      ? Math.round(pi.amount_received)
      : typeof pi.amount === 'number'
        ? Math.round(pi.amount)
        : NaN;
  if (Number.isNaN(expectedCents) || expectedCents !== receivedCents) {
    console.warn('[stripe] TenantInvoice PI amount mismatch', { expectedCents, receivedCents, id: pi.id });
    return { ok: false, reason: 'amount_mismatch', expectedCents, receivedCents };
  }
  const invoiceIdsStr = meta.invoice_ids || '';
  let ids = invoiceIdsStr.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (ids.length === 0) {
    const referenceNumber = String(meta.reference_number || '').trim();
    if (!referenceNumber) {
      return { ok: false, reason: 'no_invoice_ids' };
    }
    const tenancyId = meta.tenancy_id || null;
    const clientId = meta.client_id || null;
    let resolveSql = 'SELECT id FROM rentalcollection WHERE referenceid = ? AND ispaid = 0';
    const resolveParams = [referenceNumber];
    if (tenancyId) {
      resolveSql += ' AND tenancy_id = ?';
      resolveParams.push(tenancyId);
    }
    if (clientId) {
      resolveSql += ' AND client_id = ?';
      resolveParams.push(clientId);
    }
    const [resolvedRows] = await pool.query(resolveSql, resolveParams);
    ids = resolvedRows.map((r) => String(r.id || '').trim()).filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, reason: 'no_invoice_ids' };
    }
    console.log('[stripe] TenantInvoice resolved invoice ids by reference_number', { referenceNumber, count: ids.length });
  }
  const [unpaidRows] = await pool.query(
    `SELECT COUNT(*) AS c FROM rentalcollection WHERE id IN (${ids.map(() => '?').join(',')}) AND ispaid = 0`,
    ids
  );
  if (unpaidRows[0]?.c === 0) {
    // Webhook may have marked paid but createReceipt failed (or confirm-payment runs second). Still sync accounting payment/receipt.
    try {
      const { createReceiptForPaidRentalCollection } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
      const receiptResult = await createReceiptForPaidRentalCollection(ids, { source: 'stripe' });
      console.log('[stripe] TenantInvoice already_paid — ensure receipts (PI)', {
        created: receiptResult.created,
        errors: receiptResult.errors
      });
    } catch (receiptErr) {
      console.warn('[stripe] TenantInvoice createReceipt failed (already_paid path)', receiptErr?.message || receiptErr);
    }
    return { ok: true, result: { type: 'TenantInvoice', skipped: 'already_paid' } };
  }
  const tenancyId = meta.tenancy_id || null;
  const txnid = pi.id || null;
  const paiddate = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const placeholders = ids.map(() => '?').join(',');
  const params = [paiddate, txnid, ...ids];
  let sql = `UPDATE rentalcollection SET paidat = ?, referenceid = ?, ispaid = 1, updated_at = NOW() WHERE id IN (${placeholders}) AND ispaid = 0`;
  if (tenancyId) {
    sql += ' AND tenancy_id = ?';
    params.push(tenancyId);
  }
  const [upd] = await pool.query(sql, params);
  const marked = upd.affectedRows || 0;
  console.log('[stripe] TenantInvoice rentalcollection updated (PI)', { paidat: paiddate, referenceid: txnid, marked, ids: ids.length });
  if (marked > 0 && ids.length > 0) {
    try {
      const { createReceiptForPaidRentalCollection } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
      const receiptResult = await createReceiptForPaidRentalCollection(ids, { source: 'stripe' });
      console.log('[stripe] TenantInvoice receipts created (PI)', { created: receiptResult.created, errors: receiptResult.errors });
    } catch (receiptErr) {
      console.warn('[stripe] TenantInvoice createReceipt failed (PI)', receiptErr?.message || receiptErr);
    }
  }
  const invClientId = (meta.client_id || '').toString().trim();
  const invPaymentIntentId = pi.id;
  if (invClientId && invPaymentIntentId) {
    try {
      const r = await releaseRentToClient({ paymentIntentId: invPaymentIntentId, clientId: invClientId, chargeType: 'invoice' });
      console.log('[stripe] TenantInvoice SaaS fee (PI)', { released: r.released, reason: r.reason });
    } catch (e) {
      console.error('[stripe] TenantInvoice SaaS fee (PI)', e?.message || e);
    }
  }
  return { ok: true, result: { type: 'TenantInvoice', marked, expectedCents, receivedCents } };
}

/**
 * After Checkout setup session completes: store Stripe Customer + PaymentMethod on tenant profile for off-session MIT.
 * @param {string} sessionId
 * @param {string} clientId
 * @param {string} tenantId
 */
async function persistStripeSetupFromSession(sessionId, clientId, tenantId) {
  if (!sessionId || !clientId || !tenantId) return { ok: false, reason: 'MISSING_PARAMS' };
  try {
    const stripe = await getStripeForClient(clientId);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['setup_intent'] });
    if (session.mode !== 'setup') return { ok: false, reason: 'NOT_SETUP' };
    const si = session.setup_intent;
    const siObj = typeof si === 'string' ? await stripe.setupIntents.retrieve(si) : si;
    if (!siObj || siObj.status !== 'succeeded') {
      console.warn('[stripe] persistStripeSetupFromSession setup intent not succeeded', { status: siObj?.status });
      return { ok: false, reason: 'SETUP_NOT_SUCCEEDED' };
    }
    let customerId = siObj.customer ? String(siObj.customer) : '';
    let pmId = siObj.payment_method ? String(siObj.payment_method) : '';
    if (!customerId && session.customer) customerId = String(session.customer);
    if (!customerId || !pmId) {
      console.warn('[stripe] persistStripeSetupFromSession missing customer or payment_method', { tenantId, customerId, pmId: !!pmId });
      return { ok: false, reason: 'MISSING_CUSTOMER_OR_PM' };
    }
    const [rows] = await pool.query('SELECT profile FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
    if (!rows.length) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const base = parseTenantProfileJson(rows[0].profile);
    base.stripe_customer_id = customerId;
    base.stripe_payment_method_id = pmId;
    await pool.query('UPDATE tenantdetail SET profile = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(base), tenantId]);
    console.log('[stripe] persistStripeSetupFromSession ok', { tenantId, customerId });
    return { ok: true, customerId, pmId };
  } catch (e) {
    console.error('[stripe] persistStripeSetupFromSession', e?.message || e);
    return { ok: false, reason: e?.message || 'PERSIST_FAILED' };
  }
}

/**
 * Off-session charge for due invoices (cron). Requires profile.stripe_customer_id + stripe_payment_method_id from setup Checkout.
 * @param {{ clientId: string, tenantId: string, tenancyId: string, invoiceIds: string[], amountCents: number, description?: string }} opts
 */
async function chargeTenantInvoiceWithSavedPaymentMethod(opts) {
  const { clientId, tenantId, tenancyId, invoiceIds, amountCents, description } = opts;
  if (!clientId || !tenantId || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return { ok: false, reason: 'INVALID_PARAMS' };
  }
  const expectedCents = Math.max(100, Math.round(amountCents));
  const [rows] = await pool.query('SELECT profile FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
  if (!rows.length) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const profile = parseTenantProfileJson(rows[0].profile);
  const customerId = profile.stripe_customer_id ? String(profile.stripe_customer_id).trim() : '';
  const pmId = profile.stripe_payment_method_id ? String(profile.stripe_payment_method_id).trim() : '';
  if (!customerId || !pmId) return { ok: false, reason: 'NO_STRIPE_CUSTOMER_OR_PM' };
  const [crows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const currencyUpper = (crows[0]?.currency || '').toString().trim().toUpperCase();
  if (currencyUpper !== 'SGD' && currencyUpper !== 'MYR') return { ok: false, reason: 'CLIENT_CURRENCY_MISSING' };
  const curr = currencyUpper === 'SGD' ? 'sgd' : 'myr';
  const stripe = await getStripeForClient(clientId);
  let pi;
  try {
    pi = await stripe.paymentIntents.create({
      amount: expectedCents,
      currency: curr,
      customer: customerId,
      payment_method: pmId,
      off_session: true,
      confirm: true,
      description: (description || 'Rent').slice(0, 500),
      metadata: {
        type: 'TenantInvoice',
        client_id: String(clientId),
        tenant_id: String(tenantId),
        tenancy_id: String(tenancyId || ''),
        amount_cents: String(expectedCents),
        invoice_ids: invoiceIds.join(','),
        auto_debit: 'cron'
      }
    });
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('[stripe] chargeTenantInvoiceWithSavedPaymentMethod', msg);
    return { ok: false, reason: msg, code: e?.code };
  }
  if (pi.status !== 'succeeded') {
    return { ok: false, reason: pi.status || 'NOT_SUCCEEDED', paymentIntentId: pi.id, requiresAction: pi.status === 'requires_action' };
  }
  const applied = await applyTenantInvoiceFromPaymentIntent(pi);
  return { ok: applied.ok !== false, paymentIntentId: pi.id, applied };
}

/**
 * Parse tenantdetail.profile JSON safely.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function parseTenantProfileJson(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return /** @type {Record<string, unknown>} */ (raw);
  try {
    const o = JSON.parse(String(raw));
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/**
 * Mark tenant as having linked a payment method (Stripe Checkout setup). Idempotent.
 * @param {string} tenantId
 */
async function markTenantPaymentMethodLinked(tenantId) {
  if (!tenantId) return;
  const [rows] = await pool.query('SELECT profile FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
  if (!rows.length) return;
  const base = parseTenantProfileJson(rows[0].profile);
  base.payment_method_linked = true;
  base.payment_method_linked_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  /** Opt-in when tenant completes Auto payment (saved card) setup; Stripe rent MIT cron can use later. */
  base.rent_auto_debit_enabled = true;
  await pool.query('UPDATE tenantdetail SET profile = ?, updated_at = NOW() WHERE id = ?', [
    JSON.stringify(base),
    tenantId
  ]);
}

/**
 * Detach saved Stripe PaymentMethod from the connected account (tenant unbind). Best-effort; logs on failure.
 * @param {string} clientId
 * @param {string} paymentMethodId - pm_...
 */
async function disconnectTenantStripePaymentMethod(clientId, paymentMethodId) {
  if (!clientId || !paymentMethodId) return;
  const pm = String(paymentMethodId).trim();
  if (!pm.startsWith('pm_')) return;
  try {
    const stripe = await getStripeForClient(clientId);
    await stripe.paymentMethods.detach(pm);
    console.log('[stripe] tenant payment method detached', { clientId, pm });
  } catch (e) {
    console.warn('[stripe] disconnectTenantStripePaymentMethod', e?.message || e);
  }
}

/**
 * Stripe Checkout Session mode=setup — save card for tenant (no charge). Webhook + confirm redirect call markTenantPaymentMethodLinked.
 * @param {{ clientId: string, tenantId: string, email: string, returnUrl: string, cancelUrl: string }} opts
 * @returns {Promise<{ url: string }>}
 */
async function createTenantPaymentMethodSetupSession({ clientId, tenantId, email, returnUrl, cancelUrl, allowPendingVerification = false }) {
  const connection = allowPendingVerification
    ? await assertClientPaymentGatewayUsable(clientId)
    : await assertClientPaymentGatewayConnected(clientId);
  if (!connection.ok) throw new Error(connection.reason || 'PAYMENT_GATEWAY_NOT_CONNECTED');
  const stripe = await getStripeForDirectClient(clientId, { allowPending: allowPendingVerification });
  const [crows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const currencyUpper = (crows[0]?.currency || '').toString().trim().toUpperCase();
  if (currencyUpper !== 'SGD' && currencyUpper !== 'MYR') throw new Error('CLIENT_CURRENCY_MISSING');
  const curr = currencyUpper === 'SGD' ? 'sgd' : 'myr';
  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    currency: curr,
    payment_method_types: ['card'],
    customer_creation: 'always',
    customer_email: email || undefined,
    success_url: returnUrl,
    cancel_url: cancelUrl,
    metadata: {
      type: 'TenantPaymentMethodSetup',
      client_id: String(clientId),
      tenant_id: String(tenantId)
    }
  });
  console.log('[stripe] Checkout Session created (setup)', { id: session.id, tenantId, clientId });
  return { url: session.url };
}

async function createCheckoutSession({ amountCents, currency, email, description, returnUrl, cancelUrl, clientId, metadata = {}, allowPendingVerification = false }) {
  const forceDemo = process.env.FORCE_PAYMENT_SANDBOX === '1' || process.env.FORCE_PAYMENT_SANDBOX === 'true';
  if (clientId && metadata?.type && metadata.type !== 'credit_topup') {
    const connection = allowPendingVerification
      ? await assertClientPaymentGatewayUsable(clientId)
      : await assertClientPaymentGatewayConnected(clientId);
    if (!connection.ok) throw new Error(connection.reason || 'PAYMENT_GATEWAY_NOT_CONNECTED');
  }
  const stripe = clientId && metadata?.type && metadata.type !== 'credit_topup'
    ? await getStripeForDirectClient(clientId, { allowPending: allowPendingVerification })
    : clientId
      ? await getStripeForClient(clientId)
      : getStripe(forceDemo);
  const amount = Math.max(100, Math.round(amountCents));
  const curr = (currency || '').toString().trim().toLowerCase();
  if (!curr) throw new Error('CLIENT_CURRENCY_MISSING');
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: curr,
        unit_amount: amount,
        product_data: { name: description || 'Payment' }
      },
      quantity: 1
    }],
    customer_email: email,
    success_url: returnUrl,
    cancel_url: cancelUrl,
    metadata: { ...metadata }
  });
  console.log('[stripe] Checkout Session created', { id: session.id, amount_total: amount, currency: curr, metadata: session.metadata });
  return { url: session.url };
}

/**
 * Coliving SaaS (operator plan, credit top-up, /enquiry): Malaysia platform Stripe only (`getStripe(_, 'MY')`).
 * Default **sandbox** (`STRIPE_SANDBOX_SECRET_KEY`). For **live** on ECS: set `COLIVING_SAAS_STRIPE_LIVE=1` or `COLIVING_SAAS_STRIPE_USE_SANDBOX=0` and configure `STRIPE_SECRET_KEY` + live webhook.
 * @returns {boolean}
 */
function colivingSaasPlatformUsesSandbox() {
  const live =
    process.env.COLIVING_SAAS_STRIPE_LIVE === '1' || /^true$/i.test(String(process.env.COLIVING_SAAS_STRIPE_LIVE || ''));
  if (live) return false;
  const raw = process.env.COLIVING_SAAS_STRIPE_USE_SANDBOX;
  if (raw === '0' || raw === 'false' || /^false$/i.test(String(raw || ''))) return false;
  return true;
}

/**
 * @returns {import('stripe').Stripe}
 */
function getStripeForColivingSaasPlatform() {
  return getStripe(colivingSaasPlatformUsesSandbox(), 'MY');
}

/**
 * Coliving operator SaaS (billing plan, credit top-up, enquiry plan): Malaysia platform Stripe; sandbox vs live from {@link colivingSaasPlatformUsesSandbox}.
 * Charge currency is `myr` or `sgd` from operatordetail — not the SG env Stripe account.
 * **Subtotal** = `amountCents` (plan/top-up amount in DB). Two line items: **pricing** (description) + **transaction fees** % (see `payment-fees.js`).
 * Metadata: `coliving_saas_platform`, `base_amount_cents`, `transaction_fee_cents`, `transaction_fee_pct`, `total_charge_cents`.
 *
 * @param {{ amountCents: number, stripeCurrency: 'myr'|'sgd', email?: string, description: string, successUrl: string, cancelUrl: string, metadata: Record<string, string> }} opts
 * @returns {Promise<{ url: string, sessionId: string }>}
 */
async function createColivingSaasPlatformCheckoutSession({
  amountCents,
  stripeCurrency,
  email,
  description,
  successUrl,
  cancelUrl,
  metadata
}) {
  const stripe = getStripeForColivingSaasPlatform();
  const baseCents = Math.max(100, Math.round(Number(amountCents) || 0));
  const br = computeColivingSaasStripeCheckoutBreakdown(baseCents, stripeCurrency);
  const { transactionFeeCents, totalCents, transactionFeePercent } = br;
  const curr = String(stripeCurrency || '')
    .trim()
    .toLowerCase();
  if (!['myr', 'sgd'].includes(curr)) throw new Error('UNSUPPORTED_STRIPE_CURRENCY');
  const meta = {
    coliving_saas_platform: '1',
    base_amount_cents: String(baseCents),
    transaction_fee_cents: String(transactionFeeCents),
    transaction_fee_pct: String(transactionFeePercent),
    total_charge_cents: String(totalCents),
    admin_fee_cents: String(transactionFeeCents),
    admin_fee_pct: String(transactionFeePercent),
    processing_fee_cents: '0',
    ...metadata
  };
  const flatMeta = Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [String(k).slice(0, 40), v == null ? '' : String(v).slice(0, 500)])
  );
  const pricingLabel = description && String(description).trim() ? String(description).trim() : 'Pricing';
  const lineItems = [
    {
      price_data: {
        currency: curr,
        unit_amount: baseCents,
        product_data: { name: pricingLabel }
      },
      quantity: 1
    }
  ];
  if (transactionFeeCents > 0) {
    lineItems.push({
      price_data: {
        currency: curr,
        unit_amount: transactionFeeCents,
        product_data: { name: `Transaction fees (${transactionFeePercent}%)` }
      },
      quantity: 1
    });
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer_email: email && String(email).trim() ? String(email).trim() : undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: flatMeta
  });
  console.log('[stripe] Coliving SaaS Checkout Session', {
    id: session.id,
    currency: curr,
    baseCents,
    transactionFeeCents,
    totalCents,
    transactionFeePercent
  });
  return { url: session.url, sessionId: session.id };
}

/**
 * Confirm a checkout session after redirect (success page). Used when webhook may have failed.
 * Retrieves session from Stripe, verifies tenant, then runs the same mark-as-paid logic as webhook.
 * @param {string} sessionId - Stripe Checkout Session id (e.g. cs_xxx)
 * @param {string} [clientId] - Optional; if not provided we try platform Stripe and read from session.metadata
 * @param {string} tenantId - Current tenant id; must match session.metadata.tenant_id
 * @returns {Promise<{ ok: boolean, result?: object, reason?: string }>}
 */
async function confirmTenantCheckoutSession(sessionId, clientId, tenantId) {
  if (!sessionId || !tenantId) return { ok: false, reason: 'MISSING_SESSION_OR_TENANT' };
  let stripe;
  if (clientId) {
    stripe = await getStripeForDirectClient(clientId, { allowPending: true });
  } else {
    stripe = getStripe(false, 'MY');
  }
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: [] });
  } catch (e) {
    console.warn('[stripe] confirmTenantCheckoutSession retrieve failed', e?.message || e);
    return { ok: false, reason: 'SESSION_NOT_FOUND' };
  }
  const meta = session.metadata || {};
  if (String(meta.tenant_id || '').trim() !== String(tenantId).trim()) {
    return { ok: false, reason: 'FORBIDDEN' };
  }
  const type = meta.type;
  if (session.mode === 'setup' && type === 'TenantPaymentMethodSetup') {
    if (session.status !== 'complete') {
      return { ok: false, reason: 'SETUP_NOT_COMPLETE' };
    }
    await markTenantPaymentMethodLinked(tenantId);
    const cidSetup = clientId || meta.client_id;
    if (cidSetup) {
      await persistStripeSetupFromSession(sessionId, String(cidSetup).trim(), tenantId);
    }
    return { ok: true, result: { type: 'TenantPaymentMethodSetup', linked: true } };
  }
  if (type !== 'TenantInvoice' && type !== 'TenantMeter') {
    return { ok: false, reason: 'INVALID_SESSION_TYPE' };
  }
  if (session.payment_status !== 'paid') {
    return { ok: false, reason: 'PAYMENT_NOT_PAID' };
  }
  const { handled, result } = await handleCheckoutSessionCompleted(session);
  return { ok: true, result: result || { handled } };
}

/**
 * On checkout.session.completed: Topup -> update creditlog, add credit to client. Pricing plan -> handled by billing.
 * @param {import('stripe').Stripe.Checkout.Session} session
 * @returns {Promise<{ handled: boolean, result?: object }>}
 */
async function handleCheckoutSessionCompleted(session) {
  const type = session.metadata?.type;
  const clientId = session.metadata?.client_id;

  if (session.mode === 'setup' && type === 'TenantPaymentMethodSetup' && session.metadata?.tenant_id) {
    const tenantId = String(session.metadata.tenant_id).trim();
    if (session.status !== 'complete' || !tenantId) {
      console.warn('[stripe] TenantPaymentMethodSetup session not complete', { id: session.id, status: session.status });
      return { handled: true, result: { type: 'TenantPaymentMethodSetup', reason: 'session_not_complete' } };
    }
    await markTenantPaymentMethodLinked(tenantId);
    if (clientId) {
      await persistStripeSetupFromSession(session.id, String(clientId).trim(), tenantId);
    }
    console.log('[stripe] TenantPaymentMethodSetup linked', { tenantId, sessionId: session.id });
    return { handled: true, result: { type: 'TenantPaymentMethodSetup', tenantId, linked: true } };
  }

  if (type === 'credit_topup' && clientId) {
    console.log('[stripe] checkout.session.completed credit_topup payload', { id: session.id, payment_status: session.payment_status, amount_total: session.amount_total, metadata: session.metadata });
    if (session.payment_status !== 'paid') {
      return { handled: true, result: { type: 'credit_topup', reason: 'payment_not_paid', payment_status: session.payment_status } };
    }
    const amountCents = parseInt(String(session.metadata?.amount_cents || session.amount_total || 0), 10);
    const amount = (typeof session.amount_total === 'number' ? session.amount_total : amountCents) / 100;
    if (amount <= 0) return { handled: false };
    const piRaw = session.payment_intent;
    const paymentIntentId =
      typeof piRaw === 'string'
        ? piRaw
        : piRaw && typeof piRaw === 'object' && piRaw.id
          ? piRaw.id
          : null;
    const curr = session.currency ? String(session.currency).trim().toUpperCase() : null;
    if (!paymentIntentId) {
      console.warn('[stripe] credit_topup checkout.session.completed without payment_intent; credit will be applied on payment_intent.succeeded only', {
        sessionId: session.id,
        clientId
      });
      return { handled: true, result: { type: 'credit_topup', reason: 'defer_to_payment_intent_webhook', sessionId: session.id } };
    }
    const payloadJson = JSON.stringify({
      source: 'checkout.session.completed',
      session_id: session.id,
      payment_intent: paymentIntentId,
      payment_status: session.payment_status
    });
    const result = await applyStripeCreditTopupAligned({
      clientId,
      creditAmount: amount,
      paymentAmountMajor: amount,
      currency: curr,
      paymentIntentId,
      checkoutSessionId: session.id,
      payloadJson
    });
    console.log('[stripe] credit_topup aligned from checkout.session.completed', { clientId, amount, result });
    return { handled: true, result: { type: 'credit_topup', clientId, amount, ...result } };
  }

  if (type === 'Topup' && session.metadata?.creditlog_id) {
    const creditlogId = session.metadata.creditlog_id;
    const [rows] = await pool.query(
      'SELECT id, client_id, amount, payment, currency, title FROM creditlogs WHERE id = ? AND is_paid = 0 LIMIT 1',
      [creditlogId]
    );
    if (!rows.length) return { handled: false, result: { reason: 'creditlog_not_found_or_paid' } };
    const log = rows[0];
    const creditAmount = Number(log.amount) || 0;
    if (creditAmount <= 0) return { handled: false };

    // Total credit before top-up: SUM(client_credit) = core + flex (same as transaction Balance / billing UI).
    const [[totalRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM client_credit WHERE client_id = ?`,
      [log.client_id]
    );
    const creditBefore = totalRow ? Number(totalRow.total) || 0 : 0;
    const creditAfter = creditBefore + creditAmount;

    const txnid = session.payment_intent || session.id || null;
    const paiddate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const payloadJson = typeof session === 'object' ? JSON.stringify({ id: session.id, payment_intent: session.payment_intent, payment_status: session.payment_status }) : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        'UPDATE creditlogs SET is_paid = 1, txnid = ?, payload = ?, paiddate = ?, updated_at = NOW() WHERE id = ?',
        [txnid, payloadJson, paiddate, creditlogId]
      );
      console.log('[creditlogs] UPDATE Topup paid', { id: creditlogId, txnid, paiddate });
      const [clientRows] = await conn.query('SELECT id, credit FROM operatordetail WHERE id = ? LIMIT 1', [log.client_id]);
      if (!clientRows.length) throw new Error('client not found');
      const raw = clientRows[0].credit;
      let creditList = [];
      try {
        creditList = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
      } catch (_) {}
      let flex = creditList.find((c) => c.type === 'flex');
      if (!flex) {
        flex = { type: 'flex', amount: 0 };
        creditList.push(flex);
      }
      flex.amount = Number(flex.amount) || 0;
      flex.amount += creditAmount;
      const newCreditJson = JSON.stringify(creditList);
      await conn.query('UPDATE operatordetail SET credit = ?, updated_at = NOW() WHERE id = ?', [newCreditJson, log.client_id]);
      await syncSubtablesFromOperatordetail(conn, log.client_id);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    try {
      const { processPayexPendingFees } = require('../payex/payex.service');
      await processPayexPendingFees(log.client_id);
    } catch (e) {
      console.warn('[stripe] processPayexPendingFees after top-up failed:', e?.message);
    }
    try {
      const { processBillplzPendingFees } = require('../billplz/billplz.service');
      await processBillplzPendingFees(log.client_id);
    } catch (e) {
      console.warn('[stripe] processBillplzPendingFees after top-up failed:', e?.message);
    }
    const paymentAmount = (typeof session.amount_total === 'number' ? session.amount_total : 0) / 100 || Number(log.payment) || 0;
    const currency = (log.currency || session.currency || '').toString().trim().toUpperCase();
    if (!currency) throw new Error('MISSING_CURRENCY');
    try {
      const {
        createSaasBukkuCashInvoiceIfConfigured,
        buildTopupInvoiceTitle,
        buildTopupLineItemDescription,
        ensureClientBukkuContact,
        PRODUCT_TOPUPCREDIT,
        ACCOUNT_REVENUE,
        PAYMENT_STRIPE
      } = require('../billing/saas-bukku.service');
      const defaultContactId = process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID ? Number(process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID) : null;
      const contactId = (await ensureClientBukkuContact(log.client_id)) ?? defaultContactId;
      const invRes = await createSaasBukkuCashInvoiceIfConfigured({
        contactId,
        productId: PRODUCT_TOPUPCREDIT,
        accountId: ACCOUNT_REVENUE,
        amount: paymentAmount,
        paidDate: utcDatetimeFromDbToMalaysiaDateOnly(paiddate),
        paymentAccountId: PAYMENT_STRIPE,
        invoiceTitle: buildTopupInvoiceTitle({ creditAmount }),
        lineItemDescription: buildTopupLineItemDescription({
          creditAmount,
          when: paiddate,
          paymentMethod: 'Stripe',
          amount: paymentAmount,
          currency,
          creditBefore,
          creditAfter
        }),
        currencyCode: currency
      });
      if (invRes.ok && (invRes.invoiceId != null || invRes.invoiceUrl)) {
        await pool.query('UPDATE creditlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?', [invRes.invoiceId != null ? String(invRes.invoiceId) : null, invRes.invoiceUrl || null, creditlogId]);
      }
    } catch (bukkuErr) {
      console.warn('[stripe] Topup SaaS Bukku invoice failed', bukkuErr?.message || bukkuErr);
    }
    return { handled: true, result: { type: 'Topup', creditlog_id: creditlogId, added: creditAmount } };
  }

  if (type === 'TenantInvoice') {
    console.log('[stripe] checkout.session.completed TenantInvoice payload', { id: session.id, payment_status: session.payment_status, amount_total: session.amount_total, currency: session.currency, metadata: session.metadata });
    if (session.payment_status !== 'paid') {
      console.warn('[stripe] TenantInvoice payment_status not paid', { payment_status: session.payment_status });
      return { handled: true, result: { type: 'TenantInvoice', reason: 'payment_not_paid', payment_status: session.payment_status } };
    }
    const amountCentsStr = session.metadata?.amount_cents;
    const expectedCents = amountCentsStr != null ? parseInt(String(amountCentsStr), 10) : NaN;
    const receivedCents = typeof session.amount_total === 'number' ? Math.round(session.amount_total) : NaN;
    if (expectedCents !== receivedCents || Number.isNaN(expectedCents)) {
      console.warn('[stripe] TenantInvoice amount mismatch', { expectedCents, receivedCents });
      return { handled: true, result: { type: 'TenantInvoice', reason: 'amount_mismatch', expectedCents, receivedCents } };
    }
    const invPaymentIntentId =
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!invPaymentIntentId) {
      return { handled: true, result: { type: 'TenantInvoice', reason: 'no_payment_intent' } };
    }
    const syntheticPi = {
      id: invPaymentIntentId,
      amount_received: receivedCents,
      amount: receivedCents,
      metadata: session.metadata || {}
    };
    const applied = await applyTenantInvoiceFromPaymentIntent(syntheticPi);
    const invClientIdForVerify = String(session.metadata?.client_id || '').trim();
    if (invClientIdForVerify && applied.ok !== false) {
      try {
        await markStripeWebhookVerified(invClientIdForVerify, { eventType: 'checkout.session.completed' });
      } catch (e) {
        console.warn('[stripe] TenantInvoice markStripeWebhookVerified', e?.message || e);
      }
    }
    return { handled: true, result: applied.result || applied };
  }

  if (type === 'TenantMeter') {
    console.log('[stripe] checkout.session.completed TenantMeter payload', { id: session.id, payment_status: session.payment_status, amount_total: session.amount_total, currency: session.currency, metadata: session.metadata });
    if (session.payment_status !== 'paid') {
      console.warn('[stripe] TenantMeter payment_status not paid', { payment_status: session.payment_status });
      return { handled: true, result: { type: 'TenantMeter', reason: 'payment_not_paid', payment_status: session.payment_status } };
    }
    const amountCentsStr = session.metadata?.amount_cents;
    const expectedCents = amountCentsStr != null ? parseInt(String(amountCentsStr), 10) : NaN;
    const receivedCents = typeof session.amount_total === 'number' ? Math.round(session.amount_total) : NaN;
    if (expectedCents !== receivedCents || Number.isNaN(expectedCents)) {
      console.warn('[stripe] TenantMeter amount mismatch', { expectedCents, receivedCents });
      return { handled: true, result: { type: 'TenantMeter', reason: 'amount_mismatch', expectedCents, receivedCents } };
    }
    const meterTransactionId = (session.metadata?.meter_transaction_id || '').trim();
    const tenancyId = session.metadata?.tenancy_id || null;
    const piRaw = session.payment_intent;
    const txnid =
      typeof piRaw === 'string'
        ? piRaw
        : piRaw && typeof piRaw === 'object' && piRaw.id
          ? String(piRaw.id)
          : session.id || null;
    let metertransactionMarked = 0;
    if (meterTransactionId) {
      const [upd] = await pool.query(
        `UPDATE metertransaction SET ispaid = 1, referenceid = ?, status = 'success', updated_at = NOW() WHERE id = ? AND ispaid = 0 ${tenancyId ? ' AND tenancy_id = ?' : ''}`,
        tenancyId ? [txnid, meterTransactionId, tenancyId] : [txnid, meterTransactionId]
      );
      metertransactionMarked = upd.affectedRows || 0;
      console.log('[stripe] TenantMeter metertransaction updated', { id: meterTransactionId, referenceid: txnid, ispaid: 1, status: 'success', expectedCents, receivedCents, marked: metertransactionMarked });
    }
    try {
      const { handleTenantMeterPaymentSuccess } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
      const result = await handleTenantMeterPaymentSuccess(session, { priorMarkedRows: metertransactionMarked });
      const meterClientId = session.metadata?.client_id?.trim();
      const meterPaymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      if (meterClientId && meterPaymentIntentId) {
        try {
          const r = await releaseRentToClient({ paymentIntentId: meterPaymentIntentId, clientId: meterClientId, chargeType: 'meter' });
          console.log('[stripe] TenantMeter SaaS fee', { released: r.released, reason: r.reason });
        } catch (e) {
          console.error('[stripe] TenantMeter SaaS fee', e?.message || e);
        }
      }
      if (meterClientId) {
        try {
          await markStripeWebhookVerified(meterClientId, { eventType: 'checkout.session.completed' });
        } catch (e) {
          console.warn('[stripe] TenantMeter markStripeWebhookVerified', e?.message || e);
        }
      }
      return { handled: true, result: { type: 'TenantMeter', metertransactionMarked, expectedCents, receivedCents, ...result } };
    } catch (e) {
      console.error('[stripe] TenantMeter handleTenantMeterPaymentSuccess', e);
      return { handled: true, result: { type: 'TenantMeter', metertransactionMarked, ok: false, reason: e?.message || 'HANDLE_FAILED' } };
    }
  }

  if (type === 'rent' && clientId) {
    console.log('[stripe] checkout.session.completed rent payload', { id: session.id, payment_status: session.payment_status, amount_total: session.amount_total, metadata: session.metadata });
    if (session.payment_status !== 'paid') {
      return { handled: true, result: { type: 'rent', reason: 'payment_not_paid', payment_status: session.payment_status } };
    }
    const paymentIntentId = session.payment_intent && typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id || null);
    if (!paymentIntentId) {
      console.warn('[stripe] rent session has no payment_intent');
      return { handled: true, result: { type: 'rent', reason: 'no_payment_intent' } };
    }
    const result = await handleRentPaymentSuccess({ paymentIntentId, clientId });
    return { handled: true, result: { type: 'rent', ...result } };
  }

  return { handled: false };
}

// --- Stripe Connect: onboarding for client (companysetting) ---
// Intent: client connects Stripe to become a MERCHANT (accept card payments from their tenants; receive transfers from platform).
// We do NOT use "customer" configuration (charging the connected account). See https://docs.stripe.com/connect/accounts-v2#configurations
// v1: Standard (OAuth) and Express both yield accounts that accept payments; v2 would set configuration.merchant explicitly.

/**
 * Connect OAuth (Standard) client_id from env. MY 用 OAuth；SG 仍用 Express，SG 的 client_id 可选 (pending).
 * @param {string} platform - 'MY' | 'SG'
 * @param {boolean} sandbox
 * @returns {string | undefined}
 */
function getConnectOAuthClientId(platform, sandbox) {
  const isMY = String(platform || '').toUpperCase() === 'MY';
  if (isMY) return sandbox ? process.env.STRIPE_MY_SANDBOX_CONNECT_CLIENT_ID : process.env.STRIPE_MY_CONNECT_CLIENT_ID;
  return sandbox ? process.env.STRIPE_SG_SANDBOX_CONNECT_CLIENT_ID : process.env.STRIPE_SG_CONNECT_CLIENT_ID;
}

/**
 * Create Stripe Connect: MY 用 Standard (OAuth)，SG 用 Express (AccountLink).
 * We only persist stripe_connected_account_id when onboarding completes (OAuth callback or account.updated webhook).
 * @param {string} clientId
 * @param {string} returnUrl - e.g. Wix companysetting page (OAuth redirect_uri)
 * @param {string} refreshUrl - e.g. same or login (Express only)
 * @returns {Promise<{ alreadyConnected?: boolean, url?: string }>}
 */
async function createConnectAccountAndLink(clientId, returnUrl, refreshUrl) {
  const platform = await resolveClientStripePlatform(clientId);
  const sandbox = await getClientStripeSandbox(clientId);
  console.log('[onboard] stripe-connect clientId=%s platform=%s sandbox=%s', clientId, platform, sandbox);

  const connectedId = await getClientStripeConnectedAccountId(clientId);
  if (connectedId) {
    return { alreadyConnected: true, url: null, clientId, platform, sandbox };
  }

  // MY: Standard (OAuth). Linked account = full Stripe account (merchant: accept payments). Stripe 未开放 MY Express，用 OAuth 连接 client 已有 Stripe 账户。
  // redirect_uri 必须与 Stripe Dashboard → Connect → Settings → Redirect URIs 里配置的完全一致（不含 query），否则 Stripe 报 Invalid redirect URI。
  if (platform === 'MY') {
    const clientIdOAuth = getConnectOAuthClientId('MY', sandbox);
    if (!clientIdOAuth) throw new Error('STRIPE_MY_CONNECT_CLIENT_ID or STRIPE_MY_SANDBOX_CONNECT_CLIENT_ID is not set');
    let redirectUri;
    const explicitRedirect = process.env.STRIPE_CONNECT_OAUTH_REDIRECT_URI && String(process.env.STRIPE_CONNECT_OAUTH_REDIRECT_URI).trim();
    if (explicitRedirect) {
      redirectUri = explicitRedirect.replace(/\?.*$/, '').replace(/\/+$/, '');
    } else {
      const baseUrl = process.env.PUBLIC_APP_URL && String(process.env.PUBLIC_APP_URL).trim();
      redirectUri = baseUrl
        ? `${baseUrl.replace(/\/+$/, '')}/api/companysetting/stripe-connect-oauth-return`
        : ((returnUrl && typeof returnUrl === 'string')
            ? returnUrl.replace(/\?.*$/, '').replace(/\/+$/, '') || returnUrl
            : returnUrl);
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientIdOAuth,
      scope: 'read_write',
      redirect_uri: redirectUri,
      state: String(clientId)
    });
    const url = `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
    console.log('[onboard] stripe-connect MY OAuth payload', {
      client_id: clientIdOAuth ? clientIdOAuth.substring(0, 12) + '...' : '',
      redirect_uri: redirectUri || '',
      scope: 'read_write',
      state: String(clientId),
      full_url: url
    });
    return { url, clientId, platform, sandbox };
  }

  // SG: Express (AccountLink). v1 Express account = merchant (accept payments); we do not use customer config.
  const stripe = await getStripeForClient(clientId);
  const country = 'sg';
  let accountId = await getClientStripeConnectPendingId(clientId);
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country,
      metadata: { client_id: String(clientId) }
    });
    accountId = account.id;
    const [upd] = await pool.query(
      'UPDATE client_profile SET stripe_connect_pending_id = ?, stripe_platform = ?, updated_at = NOW() WHERE client_id = ?',
      [accountId, platform, clientId]
    );
    if (upd.affectedRows === 0) {
      const id = require('crypto').randomUUID();
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      await pool.query(
        `INSERT INTO client_profile (id, client_id, stripe_connect_pending_id, stripe_platform, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, clientId, accountId, platform, now, now]
      );
    }
  }
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl || returnUrl,
    return_url: returnUrl,
    type: 'account_onboarding'
  });
  return { url: accountLink.url, clientId, platform, sandbox };
}

/**
 * Complete Stripe Connect OAuth (Standard) for MY: exchange code for stripe_user_id and save.
 * @param {string} clientId
 * @param {string} code - from Stripe redirect ?code=
 * @returns {Promise<{ ok: boolean, accountId?: string, reason?: string }>}
 */
async function completeStripeConnectOAuth(clientId, code) {
  console.log('[stripe connect] completeStripeConnectOAuth start clientId=%s codeLen=%s', clientId, code ? String(code).length : 0);
  if (!code || !String(code).trim()) throw new Error('STRIPE_OAUTH_CODE_REQUIRED');
  const sandbox = await getClientStripeSandbox(clientId);
  const clientSecret = sandbox ? process.env.STRIPE_SANDBOX_SECRET_KEY : process.env.STRIPE_SECRET_KEY;
  if (!clientSecret) throw new Error('STRIPE_SECRET_KEY or STRIPE_SANDBOX_SECRET_KEY is not set');
  console.log('[stripe connect] exchanging code for token sandbox=%s', sandbox);
  const axios = require('axios');
  const body = new URLSearchParams({
    client_secret: clientSecret,
    code: String(code).trim(),
    grant_type: 'authorization_code'
  }).toString();
  const res = await axios.post('https://connect.stripe.com/oauth/token', body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }).catch(err => {
    if (err.response?.data) console.log('[stripe connect] OAuth token exchange error', err.response.status, err.response.data);
    throw new Error(err.response?.data?.error_description || err.response?.data?.error || err.message || 'STRIPE_OAUTH_TOKEN_FAILED');
  });
  const data = res.data;
  const accountId = data.stripe_user_id || data.stripe_account_id;
  if (!accountId) throw new Error('STRIPE_OAUTH_NO_ACCOUNT_ID');
  console.log('[stripe connect] Stripe OAuth token exchange success – account linked to platform', { clientId, accountId, livemode: data.livemode });
  await saveStripeOAuthConnection(clientId, {
    accountId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    livemode: data.livemode,
    scope: data.scope
  });
  const [upd] = await pool.query(
    'UPDATE client_profile SET stripe_connected_account_id = ?, stripe_connect_pending_id = NULL, updated_at = NOW() WHERE client_id = ?',
    [String(accountId), clientId]
  );
  if (upd.affectedRows === 0) {
    // MY OAuth does not create client_profile when generating URL; ensure row exists so we can persist connected account.
    const [currRows] = await pool.query(
      'SELECT currency FROM operatordetail WHERE id = ? LIMIT 1',
      [clientId]
    );
    const platform = (currRows[0] && String(currRows[0].currency || '').toUpperCase() === 'SGD') ? 'SG' : 'MY';
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    await pool.query(
      `INSERT INTO client_profile (id, client_id, stripe_connected_account_id, stripe_connect_pending_id, stripe_platform, stripe_sandbox, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
      [id, clientId, String(accountId), platform, sandbox ? 1 : 0, now, now]
    );
    console.log('[stripe connect] OAuth complete (MY) inserted client_profile', { clientId, accountId, platform });
  } else {
    console.log('[stripe connect] OAuth complete (MY)', { clientId, accountId });
  }
  return { ok: true, accountId };
}

async function triggerStripeWebhookTest(clientId) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  const direct = await getStripeDirectCredentials(clientId, { allowPending: true });
  if (!direct?.webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET_REQUIRED');
  const { stripe, accountId, mode } = await getStripeWebhookTestClient(clientId);
  await markStripeWebhookTestRequested(clientId);
  const marker = `ecs-webhook-test-${Date.now()}`;
  console.log('[stripe test webhook] trigger start', {
    clientId,
    accountId,
    mode,
    hasWebhookSecret: !!direct.webhookSecret,
    hasOauthAccessToken: !!direct.oauthAccessToken,
    marker
  });
  try {
    const updatedAccount = await stripe.accounts.update(accountId, {
      metadata: {
        client_id: String(clientId),
        ecs_webhook_test: marker
      }
    });
    console.log('[stripe test webhook] trigger success', {
      clientId,
      accountId,
      mode,
      marker,
      requestId: updatedAccount?.lastResponse?.requestId || null,
      livemode: updatedAccount?.livemode,
      metadata_client_id: updatedAccount?.metadata?.client_id || null,
      metadata_ecs_webhook_test: updatedAccount?.metadata?.ecs_webhook_test || null
    });
  } catch (err) {
    console.error('[stripe test webhook] trigger failed', {
      clientId,
      accountId,
      mode,
      marker,
      message: err?.message,
      type: err?.type,
      code: err?.code,
      statusCode: err?.statusCode,
      requestId: err?.requestId || err?.raw?.requestId || null,
      requestLogUrl: err?.raw?.request_log_url || null
    });
    throw err;
  }
  return { ok: true, accountId, mode, marker, eventType: 'account.updated' };
}

/**
 * Handle Stripe Connect account.updated webhook: when onboarding completes (charges_enabled),
 * persist stripe_connected_account_id and clear stripe_connect_pending_id.
 * @param {{ id: string, charges_enabled?: boolean, metadata?: { client_id?: string } }} account - event.data.object
 * @returns {Promise<{ handled: boolean, result?: object }>}
 */
async function handleAccountUpdated(account, matchedClientId = null) {
  if (!account || !account.id) return { handled: false };
  const clientId = matchedClientId || account.metadata?.client_id;
  if (!clientId) {
    if (account.id) console.log('[stripe connect] account.updated skip (no client id)', {
      accountId: account.id,
      charges_enabled: account.charges_enabled,
      metadata_client_id: account.metadata?.client_id || null,
      matchedClientId: matchedClientId || null,
      ecsWebhookTest: account.metadata?.ecs_webhook_test || null
    });
    return { handled: false };
  }
  const [upd] = await pool.query(
    `UPDATE client_profile SET stripe_connected_account_id = ?, stripe_connect_pending_id = NULL, updated_at = NOW() WHERE client_id = ?`,
    [String(account.id).trim(), String(clientId).trim()]
  );
  if (upd.affectedRows === 0) return { handled: true, result: { reason: 'client_profile_not_found' } };
  console.log('[stripe connect] account.updated persisted', {
    clientId,
    accountId: account.id,
    matchedClientId: matchedClientId || null,
    metadata_client_id: account.metadata?.client_id || null,
    ecsWebhookTest: account.metadata?.ecs_webhook_test || null,
    charges_enabled: account.charges_enabled
  });
  return {
    handled: true,
    result: {
      clientId,
      accountId: account.id,
      ecsWebhookTest: account.metadata?.ecs_webhook_test || null
    }
  };
}

module.exports = {
  getStripe,
  getStripeForClient,
  getStripeFromEvent,
  getPublishableKey,
  getPublishableKeyForClient,
  getClientStripeSandbox,
  resolveClientStripePlatform,
  MARKUP_PERCENT: PLATFORM_MARKUP_PERCENT,
  getClientCreditBalance,
  deductClientCredit,
  addClientCredit,
  getClientStripeConnectedAccountId,
  findClientIdByConnectedAccountId,
  createPaymentIntentForCredit,
  createPaymentIntentForRent,
  handleCreditTopupSuccess,
  handleRentPaymentSuccess,
  releaseRentToClient,
  getRentDeduction,
  getEstimatedRentDeduction,
  getTenantAndRoomNames,
  insertRentPendingRelease,
  getPendingRentReleases,
  tryReleasePendingRentReleases,
  constructWebhookEvent,
  handlePaymentIntentSucceeded,
  createCheckoutSession,
  colivingSaasPlatformUsesSandbox,
  getStripeForColivingSaasPlatform,
  createColivingSaasPlatformCheckoutSession,
  createTenantPaymentMethodSetupSession,
  handleCheckoutSessionCompleted,
  confirmTenantCheckoutSession,
  applyTenantInvoiceFromPaymentIntent,
  persistStripeSetupFromSession,
  chargeTenantInvoiceWithSavedPaymentMethod,
  disconnectTenantStripePaymentMethod,
  createConnectAccountAndLink,
  completeStripeConnectOAuth,
  triggerStripeWebhookTest
};
