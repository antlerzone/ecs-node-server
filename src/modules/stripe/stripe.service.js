/**
 * Stripe wrapper for SaaS property management.
 *
 * Two flows:
 * 1. Client credit top-up: Payment Intent on platform Stripe → webhook adds to client_credit.
 * 2. Tenant rent: Payment Intent on platform (no destination); on success we check client
 *    credit for markup (4.5%); if OK we deduct credit and Transfer to client's Connect account;
 *    if not we do not release (no transfer).
 *
 * Processing fees: absorbed by SaaS. We deduct from client credit: actual Stripe fee (varies by card, e.g. overseas higher) + 1% platform markup. 1 credit = 1 RM/SGD.
 */

const Stripe = require('stripe');
const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { syncSubtablesFromClientdetail } = require('../../services/client-subtables');

/** Our business rule: we add 1% on top of Stripe fee (deducted from client credit). Not a Stripe API – Stripe has application_fee_amount for Connect destination charges; we charge on platform then Transfer. */
const PLATFORM_MARKUP_PERCENT = 1;
/** Fallback when balance_transaction not yet linked (rare): assume 5% total. */
const FALLBACK_DEDUCT_PERCENT = 5;

const STRIPE_API_VERSION = '2024-11-20.acacia';
let stripeLive = null;
let stripeSandbox = null;
let stripeLiveSG = null;
let stripeSandboxSG = null;

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
 * Resolve stripe_platform for client: from client_profile, or from clientdetail.currency (SGD -> SG, else MY). Updates profile if was null.
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
    'SELECT currency FROM clientdetail WHERE id = ? LIMIT 1',
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
  const [rows] = await pool.query(
    'SELECT stripe_sandbox, stripe_platform FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const useSandbox = rows.length && Number(rows[0].stripe_sandbox) === 1;
  const platform = await resolveClientStripePlatform(clientId);
  return getStripe(useSandbox, platform);
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
  const [rows] = await pool.query(
    'SELECT stripe_sandbox, stripe_platform FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const useSandbox = rows.length && Number(rows[0].stripe_sandbox) === 1;
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
 * Caller must ensure balance >= amount (e.g. after getClientCreditBalance check).
 * @param {string} clientId
 * @param {number} amount
 * @param {import('mysql2/promise').Connection} [conn] - optional; if not provided uses pool
 * @returns {Promise<{ ok: boolean, newBalance?: number }>}
 */
async function deductClientCredit(clientId, amount, conn = null) {
  const run = conn || pool;
  const [rows] = await run.query(
    'SELECT id, amount FROM client_credit WHERE client_id = ? ORDER BY id ASC LIMIT 1',
    [clientId]
  );
  if (!rows.length) return { ok: false };
  const row = rows[0];
  const current = Number(row.amount) || 0;
  const newAmount = Math.max(0, current - amount);
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
 * Create a Payment Intent for client credit top-up. Money goes to platform; webhook will add to client_credit.
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
 * Handle successful Payment Intent for credit top-up: add amount to client_credit.
 * Called from webhook when payment_intent.succeeded and metadata.type === 'credit_topup'.
 * @param {{ paymentIntentId: string, amountReceivedCents: number, currency: string, clientId: string }} payload
 * @param {import('mysql2/promise').Connection} [conn]
 * @returns {Promise<{ ok: boolean }>}
 */
async function handleCreditTopupSuccess(payload, conn = null) {
  const { clientId, amountReceivedCents, currency } = payload;
  const amount = (amountReceivedCents || 0) / 100;
  await addClientCredit(clientId, amount, conn);
  return { ok: true };
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

async function getRentDeduction(stripe, paymentIntentId) {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge.balance_transaction']
  });
  const amountCents = pi.amount_received || pi.amount || 0;
  const platformMarkupCents = Math.round((amountCents * PLATFORM_MARKUP_PERCENT) / 100);
  const bt = pi.latest_charge?.balance_transaction;
  let stripeFeeCents = 0;
  if (bt && typeof bt === 'object' && typeof bt.fee === 'number') {
    stripeFeeCents = bt.fee;
  }
  if (stripeFeeCents === 0 && pi.latest_charge) {
    const btId = typeof pi.latest_charge.balance_transaction === 'string'
      ? pi.latest_charge.balance_transaction
      : bt?.id;
    if (btId) {
      try {
        const btFull = await stripe.balanceTransactions.retrieve(btId);
        stripeFeeCents = btFull.fee || 0;
      } catch (_) {}
    }
  }
  let totalCents = stripeFeeCents + platformMarkupCents;
  let fallback = stripeFeeCents === 0;
  if (fallback && totalCents === platformMarkupCents) {
    totalCents = Math.round((amountCents * FALLBACK_DEDUCT_PERCENT) / 100);
    stripeFeeCents = totalCents - platformMarkupCents;
  }
  const deductCredits = Math.ceil(totalCents / 100);
  const stripeFeePercent = amountCents
    ? (Math.fround((stripeFeeCents / amountCents) * 100)).toFixed(2)
    : '0.00';
  return {
    deductCredits,
    stripeFeeCents,
    platformMarkupCents,
    stripeFeePercent,
    fallback
  };
}

/**
 * Estimated deduction (whole credits) for display when creating rent PaymentIntent. Actual at release = ceil(Stripe fee + 1%) in credits.
 * @param {number} amountCents
 * @returns {{ markupCredits: number, estimatedPercent: number }}
 */
function getEstimatedRentDeduction(amountCents) {
  const totalCents = Math.round((amountCents * FALLBACK_DEDUCT_PERCENT) / 100);
  const markupCredits = Math.ceil(totalCents / 100);
  return { markupCredits, estimatedPercent: FALLBACK_DEDUCT_PERCENT };
}

/**
 * Build transfer description so client sees who paid and amount in Stripe Dashboard (e.g. "Rent from John - RM 800").
 */
async function getRentTransferDescription(clientId, amountCents, currency, tenantId, paymentIntentId, metadata = {}) {
  const amountStr = (amountCents / 100).toFixed(2);
  const curr = (currency || 'myr').toUpperCase();
  const tenantName = metadata.tenant_name ? String(metadata.tenant_name).trim() : '';
  const roomName = metadata.room_name ? String(metadata.room_name).trim() : '';
  let label = tenantName ? ` from ${tenantName}` : '';
  if (roomName) label += ` (${roomName})`;
  return `Rent${label} - ${curr} ${amountStr}`.trim() || `Rent payment ${paymentIntentId}`;
}

/**
 * Insert creditlogs row for rent-release deduction. Remark = "Processing fees X% by local card" (single %, type = local card/foreigner card/FPX/Paylah).
 * Columns: stripe_fee_amount, stripe_fee_percent, platform_markup_amount, tenant_name, charge_type (rental/deposit/meter/other).
 */
async function insertRentReleaseCreditLog(conn, opts) {
  const {
    logId,
    clientId,
    deductCredits,
    stripeFeeCents,
    platformMarkupCents,
    amountCents,
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
  const title = 'Rent release fee';
  const remark = `Processing fees ${effectiveFeePercent}% by ${paymentMethodLabel}. Transaction ${paymentIntentId}${tenancyId ? ` Tenancy ${tenancyId}` : ''}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const refNum = `RR-${paymentIntentId}`;
  const stripeFeeAmount = stripeFeeCents / 100;
  const stripeFeePercentNum = amountCents ? (stripeFeeCents / amountCents) * 100 : 0;
  const platformMarkupAmount = platformMarkupCents / 100;
  const payloadStr = JSON.stringify({
    transaction_id: paymentIntentId,
    transfer_id: transferId || null,
    tenancy_id: tenancyId || null,
    tenant_id: tenantId || null,
    amount_cents: amountCents,
    stripe_fee_cents: stripeFeeCents,
    platform_markup_cents: platformMarkupCents,
    effective_fee_percent: effectiveFeePercent,
    deduct_credits: deductCredits,
    payment_method_label: paymentMethodLabel
  });
  await conn.query(
    `INSERT INTO creditlogs (id, title, type, amount, client_id, staff_id, reference_number, payload, remark, currency, stripe_fee_amount, stripe_fee_percent, platform_markup_amount, tenant_name, charge_type, created_at, updated_at)
     VALUES (?, ?, 'RentRelease', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [logId, title, -Math.abs(deductCredits), clientId, refNum, payloadStr, remark, currency || 'MYR', stripeFeeAmount, stripeFeePercentNum, platformMarkupAmount, tenantName || null, chargeType || 'rental', now, now]
  );
}

/**
 * Upsert stripepayout for this client and today (one row per client per day). Sets estimated_fund_receive_date = payout_date + 2 days for accounting.
 */
async function upsertStripePayout(conn, clientId, transferId, amountCents, currency) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const payoutDate = now.slice(0, 10);
  const id = randomUUID();
  const curr = (currency || 'MYR').toUpperCase();
  const estimatedFundDate = new Date(payoutDate);
  estimatedFundDate.setDate(estimatedFundDate.getDate() + 2);
  const estimatedFundDateStr = estimatedFundDate.toISOString().slice(0, 10);
  await conn.query(
    `INSERT INTO stripepayout (id, client_id, payout_date, total_amount_cents, currency, transfer_ids, estimated_fund_receive_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, JSON_ARRAY(?), ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       total_amount_cents = total_amount_cents + ?,
       transfer_ids = JSON_ARRAY_APPEND(COALESCE(transfer_ids, JSON_ARRAY()), '$', ?),
       updated_at = ?`,
    [id, clientId, payoutDate, amountCents, curr, transferId, estimatedFundDateStr, now, now, amountCents, transferId, now]
  );
}

/**
 * After tenant rent PaymentIntent has succeeded: check client credit for (Stripe fee + 1%) in whole credits;
 * if sufficient, deduct credit, write creditlogs, and create Transfer to client's Connect account.
 * @param {{ paymentIntentId: string, clientId: string }} opts
 * @returns {Promise<{ released: boolean, reason?: string, transferId?: string, deductCredits?: number }>}
 */
async function releaseRentToClient({ paymentIntentId, clientId }) {
  const stripe = await getStripeForClient(clientId);
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.status !== 'succeeded') {
    return { released: false, reason: 'payment_not_succeeded' };
  }
  if (pi.metadata?.type !== 'rent' || String(pi.metadata?.client_id) !== String(clientId)) {
    return { released: false, reason: 'metadata_mismatch' };
  }
  const amountCents = pi.amount_received || pi.amount || 0;
  const deduction = await getRentDeduction(stripe, paymentIntentId);
  const { deductCredits, stripeFeeCents, stripeFeePercent, platformMarkupCents } = deduction;
  const balance = await getClientCreditBalance(clientId);
  if (balance < deductCredits) {
    return { released: false, reason: 'insufficient_credit', required: deductCredits, balance };
  }
  const connectedAccountId = await getClientStripeConnectedAccountId(clientId);
  if (!connectedAccountId) {
    return { released: false, reason: 'no_connected_account' };
  }
  const description = await getRentTransferDescription(
    clientId,
    amountCents,
    pi.currency,
    pi.metadata?.tenant_id || null,
    paymentIntentId,
    pi.metadata || {}
  );
  const clientCurrency = (pi.currency || 'myr').toUpperCase();
  const paymentMethodLabel = await getPaymentMethodLabel(stripe, paymentIntentId, clientCurrency);
  const totalFeeCents = deduction.stripeFeeCents + deduction.platformMarkupCents;
  const effectiveFeePercent = amountCents
    ? (Math.round((totalFeeCents / amountCents) * 1000) / 10).toFixed(1)
    : '0';
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await deductClientCredit(clientId, deductCredits, conn);
    const transferMeta = {
      payment_intent_id: paymentIntentId,
      client_id: clientId,
      ...(pi.metadata?.tenant_id ? { tenant_id: String(pi.metadata.tenant_id) } : {}),
      ...(pi.metadata?.tenant_name ? { tenant_name: String(pi.metadata.tenant_name).slice(0, 500) } : {}),
      ...(pi.metadata?.room_name ? { room_name: String(pi.metadata.room_name).slice(0, 500) } : {})
    };
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: (pi.currency || 'myr').toLowerCase(),
      destination: connectedAccountId,
      description,
      metadata: transferMeta
    });
    const logId = randomUUID();
    await insertRentReleaseCreditLog(conn, {
      logId,
      clientId,
      deductCredits,
      stripeFeeCents: deduction.stripeFeeCents,
      platformMarkupCents: deduction.platformMarkupCents,
      amountCents,
      effectiveFeePercent,
      paymentMethodLabel,
      paymentIntentId,
      transferId: transfer.id,
      tenancyId,
      tenantId: pi.metadata?.tenant_id || null,
      tenantName,
      chargeType: 'rental',
      currency: (pi.currency || 'myr').toUpperCase()
    });
    await upsertStripePayout(conn, clientId, transfer.id, amountCents, pi.currency || 'myr');
    await conn.commit();
    try {
      const { clearBillingCacheByClientId } = require('../billing/billing.service');
      clearBillingCacheByClientId(clientId);
    } catch (_) {}
    return { released: true, transferId: transfer.id, deductCredits };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Handle successful Payment Intent for rent: optionally auto-release (check credit, deduct, transfer).
 * Called from webhook when payment_intent.succeeded and metadata.type === 'rent'.
 * @param {{ paymentIntentId: string, clientId: string }} payload
 * @returns {Promise<{ released: boolean, reason?: string, transferId?: string }>}
 */
async function handleRentPaymentSuccess(payload) {
  return releaseRentToClient({
    paymentIntentId: payload.paymentIntentId,
    clientId: payload.clientId
  });
}

// --- Webhook: raw body + signature verification ---

/**
 * Build event from raw body and Stripe-Signature. Tries STRIPE_WEBHOOK_SECRET (live) then STRIPE_SANDBOX_WEBHOOK_SECRET (test).
 * @param {string|Buffer} rawBody
 * @param {string} signature
 * @returns {import('stripe').Stripe.Event}
 */
function constructWebhookEvent(rawBody, signature) {
  const secrets = [
    [process.env.STRIPE_WEBHOOK_SECRET, false, 'MY'],
    [process.env.STRIPE_SANDBOX_WEBHOOK_SECRET, true, 'MY'],
    [process.env.STRIPE_SG_WEBHOOK_SECRET, false, 'SG'],
    [process.env.STRIPE_SG_SANDBOX_WEBHOOK_SECRET, true, 'SG']
  ].filter(([s]) => s && String(s).trim());
  if (!secrets.length) {
    throw new Error('At least one Stripe webhook secret must be set (STRIPE_WEBHOOK_SECRET or STRIPE_SANDBOX_WEBHOOK_SECRET, or SG_ variants)');
  }
  let lastErr;
  for (const [secret, useSandbox, platform] of secrets) {
    try {
      return getStripe(useSandbox, platform).webhooks.constructEvent(rawBody, signature, secret);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Webhook signature verification failed');
}

/**
 * Handle payment_intent.succeeded: credit_topup -> addClientCredit; rent -> releaseRentToClient.
 * @param {import('stripe').Stripe.Event} event
 * @returns {Promise<{ handled: boolean, result?: object }>}
 */
async function handlePaymentIntentSucceeded(event) {
  const pi = event.data?.object;
  if (!pi || !pi.id) return { handled: false };
  console.log('[stripe] payment_intent.succeeded payload', { id: pi.id, amount_received: pi.amount_received, amount: pi.amount, currency: pi.currency, status: pi.status, metadata: pi.metadata });
  const type = pi.metadata?.type;
  const clientId = pi.metadata?.client_id;
  if (!clientId) return { handled: false };

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

  return { handled: false };
}

// --- Checkout Session: Topup & Pricing Plan (redirect flow) ---

/**
 * Create Stripe Checkout Session for topup or pricing plan. Returns redirect url.
 * Uses sandbox when clientId is provided and client has stripe_sandbox=1.
 * @param {{ amountCents: number, currency: string, email: string, description: string, returnUrl: string, cancelUrl: string, clientId?: string, metadata?: object }} opts
 * @returns {Promise<{ url: string }>}
 */
async function createCheckoutSession({ amountCents, currency, email, description, returnUrl, cancelUrl, clientId, metadata = {} }) {
  const stripe = clientId ? await getStripeForClient(clientId) : getStripe(false);
  const amount = Math.max(100, Math.round(amountCents));
  const curr = (currency || 'sgd').toLowerCase();
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
 * On checkout.session.completed: Topup -> update creditlog, add credit to client. Pricing plan -> handled by billing.
 * @param {import('stripe').Stripe.Checkout.Session} session
 * @returns {Promise<{ handled: boolean, result?: object }>}
 */
async function handleCheckoutSessionCompleted(session) {
  const type = session.metadata?.type;
  const clientId = session.metadata?.client_id;

  if (type === 'credit_topup' && clientId) {
    console.log('[stripe] checkout.session.completed credit_topup payload', { id: session.id, payment_status: session.payment_status, amount_total: session.amount_total, metadata: session.metadata });
    if (session.payment_status !== 'paid') {
      return { handled: true, result: { type: 'credit_topup', reason: 'payment_not_paid', payment_status: session.payment_status } };
    }
    const amountCents = parseInt(String(session.metadata?.amount_cents || session.amount_total || 0), 10);
    const amount = (typeof session.amount_total === 'number' ? session.amount_total : amountCents) / 100;
    if (amount <= 0) return { handled: false };
    await addClientCredit(clientId, amount);
    console.log('[stripe] credit_topup client_credit updated', { clientId, amount });
    return { handled: true, result: { type: 'credit_topup', clientId, amount } };
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

    const [clientInfoRows] = await pool.query(
      'SELECT title, credit FROM clientdetail WHERE id = ? LIMIT 1',
      [log.client_id]
    );
    const clientName = clientInfoRows[0]?.title || '';
    let creditBefore = 0;
    if (clientInfoRows[0]?.credit) {
      try {
        const creditList = typeof clientInfoRows[0].credit === 'string' ? JSON.parse(clientInfoRows[0].credit || '[]') : (Array.isArray(clientInfoRows[0].credit) ? clientInfoRows[0].credit : []);
        const flex = creditList.find((c) => c.type === 'flex');
        if (flex) creditBefore = Number(flex.amount) || 0;
      } catch (_) {}
    }
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
      const [clientRows] = await conn.query('SELECT id, credit FROM clientdetail WHERE id = ? LIMIT 1', [log.client_id]);
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
      await conn.query('UPDATE clientdetail SET credit = ?, updated_at = NOW() WHERE id = ?', [newCreditJson, log.client_id]);
      await syncSubtablesFromClientdetail(conn, log.client_id);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    const paymentAmount = (typeof session.amount_total === 'number' ? session.amount_total : 0) / 100 || Number(log.payment) || 0;
    const currency = (log.currency || session.currency || 'MYR').toUpperCase();
    try {
      const { createSaasBukkuCashInvoiceIfConfigured, buildTopupDescription, ensureClientBukkuContact, PRODUCT_TOPUPCREDIT, ACCOUNT_REVENUE, PAYMENT_STRIPE } = require('../billing/saas-bukku.service');
      const defaultContactId = process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID ? Number(process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID) : null;
      const contactId = (await ensureClientBukkuContact(log.client_id)) ?? defaultContactId;
      const invRes = await createSaasBukkuCashInvoiceIfConfigured({
        contactId,
        productId: PRODUCT_TOPUPCREDIT,
        accountId: ACCOUNT_REVENUE,
        amount: paymentAmount,
        paidDate: paiddate.slice(0, 10),
        paymentAccountId: PAYMENT_STRIPE,
        description: buildTopupDescription({
          clientName,
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
    const invoiceIdsStr = session.metadata?.invoice_ids || '';
    const ids = invoiceIdsStr.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (ids.length === 0) {
      return { handled: true, result: { type: 'TenantInvoice', reason: 'no_invoice_ids' } };
    }
    const tenancyId = session.metadata?.tenancy_id || null;
    const txnid = session.payment_intent || session.id || null;
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
    console.log('[stripe] TenantInvoice rentalcollection updated', { paidat: paiddate, referenceid: txnid, ispaid: 1, expectedCents, receivedCents, marked, ids: ids.length });
    if (marked > 0 && ids.length > 0) {
      try {
        const { createReceiptForPaidRentalCollection } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
        const receiptResult = await createReceiptForPaidRentalCollection(ids, { source: 'stripe' });
        console.log('[stripe] TenantInvoice receipts created', { created: receiptResult.created, errors: receiptResult.errors });
      } catch (receiptErr) {
        console.warn('[stripe] TenantInvoice createReceipt failed', receiptErr?.message || receiptErr);
      }
    }
    return { handled: true, result: { type: 'TenantInvoice', marked, expectedCents, receivedCents } };
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
    const txnid = session.payment_intent || session.id || null;
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
      const result = await handleTenantMeterPaymentSuccess(session);
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
  const [sbRows] = await pool.query(
    'SELECT stripe_sandbox FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const sandbox = sbRows.length && Number(sbRows[0].stripe_sandbox) === 1;
  console.log('[onboard] stripe-connect clientId=%s platform=%s sandbox=%s', clientId, platform, sandbox);

  const connectedId = await getClientStripeConnectedAccountId(clientId);
  if (connectedId) {
    return { alreadyConnected: true, url: null, clientId, platform, sandbox };
  }

  // MY: Standard (OAuth). Linked account = full Stripe account (merchant: accept payments). Stripe 未开放 MY Express，用 OAuth 连接 client 已有 Stripe 账户。
  // redirect_uri 必须与 Dashboard → Connect → OAuth 里配置的完全一致（不含 query），否则 Stripe 报 Invalid redirect URI。
  if (platform === 'MY') {
    const clientIdOAuth = getConnectOAuthClientId('MY', sandbox);
    if (!clientIdOAuth) throw new Error('STRIPE_MY_CONNECT_CLIENT_ID or STRIPE_MY_SANDBOX_CONNECT_CLIENT_ID is not set');
    // 若配置了 PUBLIC_APP_URL，让 Stripe 直接回调 ECS，由 ECS 换 code 落库再 302 到 Wix，避免 Wix 端 URL 被刷掉导致 code 丢失
    const baseUrl = process.env.PUBLIC_APP_URL && String(process.env.PUBLIC_APP_URL).trim();
    const redirectUri = baseUrl
      ? `${baseUrl.replace(/\/+$/, '')}/api/companysetting/stripe-connect-oauth-return`
      : ((returnUrl && typeof returnUrl === 'string')
          ? returnUrl.replace(/\?.*$/, '').replace(/\/+$/, '') || returnUrl
          : returnUrl);
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
  const [rows] = await pool.query(
    'SELECT stripe_sandbox FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const sandbox = rows.length && Number(rows[0].stripe_sandbox) === 1;
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
  const [upd] = await pool.query(
    'UPDATE client_profile SET stripe_connected_account_id = ?, stripe_connect_pending_id = NULL, updated_at = NOW() WHERE client_id = ?',
    [String(accountId), clientId]
  );
  if (upd.affectedRows === 0) {
    // MY OAuth does not create client_profile when generating URL; ensure row exists so we can persist connected account.
    const [currRows] = await pool.query(
      'SELECT currency FROM clientdetail WHERE id = ? LIMIT 1',
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

/**
 * Handle Stripe Connect account.updated webhook: when onboarding completes (charges_enabled),
 * persist stripe_connected_account_id and clear stripe_connect_pending_id.
 * @param {{ id: string, charges_enabled?: boolean, metadata?: { client_id?: string } }} account - event.data.object
 * @returns {Promise<{ handled: boolean, result?: object }>}
 */
async function handleAccountUpdated(account) {
  if (!account || !account.id) return { handled: false };
  const clientId = account.metadata?.client_id;
  if (!clientId || !account.charges_enabled) {
    if (account.id) console.log('[stripe connect] account.updated skip (no metadata.client_id or charges_enabled)', { accountId: account.id, charges_enabled: account.charges_enabled });
    return { handled: false };
  }
  const [upd] = await pool.query(
    `UPDATE client_profile SET stripe_connected_account_id = ?, stripe_connect_pending_id = NULL, updated_at = NOW() WHERE client_id = ?`,
    [String(account.id).trim(), String(clientId).trim()]
  );
  if (upd.affectedRows === 0) return { handled: true, result: { reason: 'client_profile_not_found' } };
  console.log('[stripe connect] onboarding complete', { clientId, accountId: account.id });
  return { handled: true, result: { clientId, accountId: account.id } };
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
  createPaymentIntentForCredit,
  createPaymentIntentForRent,
  handleCreditTopupSuccess,
  handleRentPaymentSuccess,
  releaseRentToClient,
  getRentDeduction,
  getEstimatedRentDeduction,
  getTenantAndRoomNames,
  constructWebhookEvent,
  handlePaymentIntentSucceeded,
  createCheckoutSession,
  handleCheckoutSessionCompleted,
  createConnectAccountAndLink,
  completeStripeConnectOAuth
};
