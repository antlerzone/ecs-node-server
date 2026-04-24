/**
 * Payment gateway – Xendit (xenPlatform). Xendit 支持新加坡 (SGD) 与马来西亚 (MYR)。
 * Operator 可能为新加坡 (SGD) 或马来西亚 (MYR)；Xendit 支持两种币种，按 client 的 currency 开单/Split/Transfer 与扣费。
 *
 * Two modes:
 * 1) Operator mode: each operator uses own Xendit key; payment goes to operator's account; we deduct 1% + Xendit fee from operator credit.
 * 2) Platform mode: split on Xendit. Operator share = env-tuned (default floor(100 − 1% SaaS − max gateway)); gateway varies by method. No operator credit deduction for fees in platform flow.
 * API: https://docs.xendit.co/docs/xenplatform-overview
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { Xendit } = require('xendit-node');
const axios = require('axios');
const { PLATFORM_MARKUP_PERCENT } = require('../../constants/payment-fees');
const {
  getPayexDirectCredentials,
  markPayexWebhookVerified
} = require('../payment-gateway/payment-gateway.service');

// Helps confirm the runtime is using the latest payex.service.js edits.
console.error('[Xendit] payex.service module loaded (sanitize patch)');

const XENDIT_API_BASE = 'https://api.xendit.co';
/** Payment Sessions + Payments API v3 (tokens / MIT). Same base; paths differ from legacy Invoice API. */
const XENDIT_SESSIONS_PATH = '/sessions';
const XENDIT_PAYMENT_REQUESTS_PATH = '/payment_requests';

/**
 * Xendit split rule: % to operator sub-account. Not equal to every txn’s true net (MDR varies).
 * Set `XENDIT_OPERATOR_SPLIT_PERCENT` or derive from `XENDIT_MAX_GATEWAY_PERCENT` (default 5.5) + 1% SaaS.
 */
function getXenditOperatorSplitPercent() {
  const explicit = process.env.XENDIT_OPERATOR_SPLIT_PERCENT;
  if (explicit != null && String(explicit).trim() !== '') {
    const n = Number(explicit);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  }
  const maxGw = parseFloat(process.env.XENDIT_MAX_GATEWAY_PERCENT || '5.5');
  const v = 100 - PLATFORM_MARKUP_PERCENT - maxGw;
  return Math.max(0, Math.min(100, Math.floor(v)));
}

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

/** Client billing currency for Xendit Sessions / Payments API (ISO 4217). */
async function getClientCurrencyForPayex(clientId) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  const [rows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const raw = rows[0]?.currency;
  if (raw == null || String(raw).trim() === '') throw new Error('CLIENT_CURRENCY_MISSING');
  const c = String(raw).trim().toUpperCase();
  const allowed = new Set(['SGD', 'MYR', 'IDR', 'PHP', 'THB', 'VND', 'USD']);
  if (!allowed.has(c)) throw new Error(`UNSUPPORTED_CLIENT_CURRENCY_FOR_PAYEX: ${c}`);
  return c;
}

/** Map client currency to Xendit Payment Sessions `country` + `currency`. */
function getXenditCountryAndCurrency(_clientId, currencyUpper) {
  const c = (currencyUpper || '').toString().toUpperCase();
  if (!c) throw new Error('CLIENT_CURRENCY_MISSING');
  if (c === 'SGD') return { country: 'SG', currency: 'SGD' };
  if (c === 'MYR') return { country: 'MY', currency: 'MYR' };
  if (c === 'IDR') return { country: 'ID', currency: 'IDR' };
  if (c === 'PHP') return { country: 'PH', currency: 'PHP' };
  if (c === 'THB') return { country: 'TH', currency: 'THB' };
  if (c === 'VND') return { country: 'VN', currency: 'VND' };
  if (c === 'USD') return { country: 'SG', currency: 'USD' };
  throw new Error(`UNSUPPORTED_XENDIT_CURRENCY: ${c}`);
}

function isXenditPayoutCallbackPayload(data = {}) {
  if (!data || typeof data !== 'object') return false;
  const hasSettlementId =
    data.id != null ||
    data.disbursement_id != null ||
    data.payout_id != null;
  const hasPayoutShape =
    data.reference_id != null ||
    data.estimated_arrival_time != null ||
    data.channel_code != null ||
    data.channel_properties != null;
  return !!(hasSettlementId && hasPayoutShape);
}

/** E.164 placeholder when tenant phone missing (Sessions customer requirement). */
function placeholderMobileForCountry(country) {
  if (country === 'ID') return '+6280000000000';
  if (country === 'PH') return '+6390000000000';
  if (country === 'SG') return '+6500000000';
  if (country === 'TH') return '+66000000000';
  if (country === 'VN') return '+84000000000';
  return '+6000000000';
}

/**
 * Direct-debit channel codes for Payment Session SAVE (hosted checkout).
 * MY/SG: bank rails (FPX / PayNow) are not tokenized for merchant-initiated recurring in this API — use cards instead.
 * @param {string} country ISO2
 * @returns {string[]|null} null = not supported for bank_dd SAVE in app
 */
function getDirectDebitChannelsForSaveSession(country) {
  if (country === 'ID') {
    return [
      'BRI_DIRECT_DEBIT',
      'BCA_DIRECT_DEBIT',
      'MANDIRI_DIRECT_DEBIT',
      'BNI_DIRECT_DEBIT',
      'PERMATA_DIRECT_DEBIT'
    ];
  }
  if (country === 'PH') {
    return ['BPI_DIRECT_DEBIT'];
  }
  return null;
}

/**
 * Secret key for Xendit REST (operator key, or platform master key + sub-account).
 * @returns {Promise<{ secretKey: string, subAccountId?: string }>}
 */
async function getXenditSecretKeyForPaymentsApi(clientId) {
  const creds = await getPayexCredentials(clientId);
  if (creds && creds.secretKey && !creds.platformFlow) {
    return { secretKey: creds.secretKey };
  }
  const platform = getPlatformXenditConfig();
  if (!platform) throw new Error('XENDIT_CREDENTIALS_NOT_CONFIGURED');
  const cfg = await getPayexPlatformConfig(clientId);
  if (!cfg.usePlatformFlow || !cfg.subAccountId) {
    throw new Error('XENDIT_OPERATOR_OR_SUBACCOUNT_REQUIRED');
  }
  return { secretKey: platform.secretKey, subAccountId: cfg.subAccountId };
}

function xenditBasicAuth(secretKey) {
  return Buffer.from(`${secretKey}:`).toString('base64');
}

/**
 * Merge tenant profile: Xendit bind (card or bank token).
 * @param {string} tenantId
 * @param {{ paymentTokenId: string, bindType: 'card'|'bank_dd' }} p
 */
async function applyTenantXenditBind(tenantId, { paymentTokenId, bindType }) {
  if (!tenantId || !paymentTokenId) return;
  const [rows] = await pool.query('SELECT profile FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
  if (!rows.length) return;
  let base = parseJson(rows[0].profile);
  if (!base || Array.isArray(base)) base = {};
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  base.payment_method_linked = true;
  base.payment_method_linked_at = now;
  base.xendit_payment_token_id = String(paymentTokenId).trim();
  base.xendit_bind_type = bindType === 'bank_dd' ? 'bank_dd' : 'card';
  /** Opt-in to daily cron rent auto-debit (see tenant-xendit-auto-debit.service.js). */
  base.rent_auto_debit_enabled = true;
  base.xendit_auto_debit = true;
  await pool.query('UPDATE tenantdetail SET profile = ?, updated_at = NOW() WHERE id = ?', [
    JSON.stringify(base),
    tenantId
  ]);
}

/**
 * Create Xendit Payment Session (SAVE) — link card for recurring/MIT.
 * Bank DD: MY/SG not supported (FPX not tokenized). Use card, or Direct Debit in supported countries (see Xendit docs).
 *
 * @param {string} clientId
 * @param {{ tenantId: string, email: string, fullname?: string, phone?: string, returnUrl: string, cancelUrl: string, bindType?: 'card'|'bank_dd' }} p
 * @returns {Promise<{ url: string, paymentSessionId?: string }>}
 */
async function createPaymentSessionSaveForTenant(clientId, p) {
  const bindType = p.bindType === 'bank_dd' ? 'bank_dd' : 'card';
  const currency = await getClientCurrencyForPayex(clientId);
  const { country, currency: curr } = getXenditCountryAndCurrency(clientId, currency);

  const { secretKey, subAccountId } = await getXenditSecretKeyForPaymentsApi(clientId);
  const ref = `tenant-bind-${p.tenantId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const names = String(p.fullname || 'Tenant').trim().split(/\s+/);
  const given = names[0] || 'Tenant';
  const surname = names.slice(1).join(' ') || 'User';

  const mobile =
    p.phone && String(p.phone).trim() ? String(p.phone).trim().slice(0, 32) : placeholderMobileForCountry(country);

  const customer = {
    reference_id: `tenant-${p.tenantId}-${Date.now()}`,
    type: 'INDIVIDUAL',
    email: (p.email || '').slice(0, 255) || 'tenant@example.com',
    mobile_number: mobile,
    individual_detail: {
      given_names: given.slice(0, 100),
      surname: surname.slice(0, 100)
    }
  };

  const recurringExpiry = new Date();
  recurringExpiry.setFullYear(recurringExpiry.getFullYear() + 5);

  /** @type {Record<string, unknown>} */
  let channelProps;
  if (bindType === 'bank_dd') {
    const ddChannels = getDirectDebitChannelsForSaveSession(country);
    if (!ddChannels) {
      throw new Error(
        'XENDIT_BANK_DD_UNSUPPORTED_REGION: Bank direct-debit linking (saved token + merchant charge) is not available for this operator currency/country. Malaysia/Singapore: FPX/PayNow cannot be tokenized for recurring via Payment Sessions. Set client currency to IDR (Indonesia) or PHP (Philippines) if your Xendit account supports Direct Debit, or use card binding for auto-debit.'
      );
    }
    channelProps = { allowed_payment_channels: ddChannels };
  } else {
    channelProps = {
      cards: {
        card_on_file_type: 'RECURRING',
        recurring_configuration: {
          recurring_frequency: 30,
          recurring_expiry: recurringExpiry.toISOString().slice(0, 10)
        }
      }
    };
  }

  const body = {
    reference_id: ref,
    session_type: 'SAVE',
    mode: 'PAYMENT_LINK',
    amount: 0,
    currency: curr,
    country,
    customer,
    channel_properties: channelProps,
    success_return_url: p.returnUrl,
    cancel_return_url: p.cancelUrl,
    metadata: {
      type: 'TenantPaymentMethodBind',
      tenant_id: String(p.tenantId),
      client_id: String(clientId),
      bind_type: bindType
    }
  };

  const headers = {
    Authorization: `Basic ${xenditBasicAuth(secretKey)}`,
    'Content-Type': 'application/json'
  };
  if (subAccountId) {
    headers['for-user-id'] = subAccountId;
  }

  let data;
  try {
    const res = await axios.post(`${XENDIT_API_BASE}${XENDIT_SESSIONS_PATH}`, body, { headers, timeout: 20000 });
    data = res.data;
  } catch (e) {
    const msg = e?.response?.data?.message || e?.response?.data?.error_code || e?.message || String(e);
    console.error('[Xendit] create session SAVE failed', msg, e?.response?.data);
    throw new Error(typeof msg === 'string' ? msg : 'XENDIT_SESSIONS_FAILED');
  }

  const url = data?.payment_link_url;
  if (!url) throw new Error('Xendit did not return payment_link_url');
  return { url, paymentSessionId: data?.payment_session_id || data?.id };
}

/**
 * Handle Xendit webhook for Payment Sessions / payment_token (non-Invoice).
 * @param {object} data
 * @returns {Promise<{ handled: boolean, result?: object }|null>} null if not applicable
 */
async function tryHandlePaymentSessionOrTokenEvent(data) {
  const ev = data?.event || data?.type || '';
  const evStr = String(ev).toLowerCase();
  if (!evStr.includes('payment_session') && !evStr.includes('payment_token')) {
    return null;
  }

  const payload = data.data || data;
  const metaRaw = payload.metadata || data.metadata;
  let meta = metaRaw;
  if (typeof metaRaw === 'string') {
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      meta = {};
    }
  }
  if (!meta || typeof meta !== 'object') meta = {};

  const tenantId = meta.tenant_id;
  const bindType = meta.bind_type === 'bank_dd' ? 'bank_dd' : 'card';
  const paymentTokenId = payload.payment_token_id || data.payment_token_id;

  if (meta.type === 'TenantPaymentMethodBind' && tenantId && paymentTokenId) {
    await applyTenantXenditBind(String(tenantId), { paymentTokenId: String(paymentTokenId), bindType });
    console.log('[Xendit] TenantPaymentMethodBind webhook', { tenantId, bindType });
    return { handled: true, result: { type: 'TenantPaymentMethodBind', tenantId } };
  }

  return { handled: false };
}

/**
 * Merchant-initiated charge using saved Xendit payment token (auto debit).
 * @param {string} clientId
 * @param {{ paymentTokenId: string, amountCents: number, referenceId: string, description?: string, metadata?: object }} opts
 */
async function chargeWithXenditPaymentToken(clientId, opts) {
  const { paymentTokenId, amountCents, referenceId, description, metadata = {}, bindType } = opts;
  if (!paymentTokenId || !referenceId || amountCents < 1) return { ok: false, reason: 'INVALID_PARAMS' };

  const currency = await getClientCurrencyForPayex(clientId);
  const { country, currency: curr } = getXenditCountryAndCurrency(clientId, currency);
  const amountMajor = Math.round(amountCents) / 100;
  const { secretKey, subAccountId } = await getXenditSecretKeyForPaymentsApi(clientId);

  const isBankDd = bindType === 'bank_dd';
  /** Card tokens need MIT card_on_file_type; bank/direct-debit tokens must not use card channel props. */
  const channel_properties = isBankDd
    ? {}
    : {
        card_on_file_type: 'MERCHANT_UNSCHEDULED'
      };

  const body = {
    reference_id: String(referenceId).slice(0, 255),
    payment_token_id: String(paymentTokenId).trim(),
    type: 'PAY',
    country,
    currency: curr,
    request_amount: amountMajor,
    capture_method: 'AUTOMATIC',
    channel_properties,
    description: (description || 'Rent').slice(0, 500),
    metadata: { ...metadata, client_id: String(clientId) }
  };

  const headers = {
    Authorization: `Basic ${xenditBasicAuth(secretKey)}`,
    'Content-Type': 'application/json'
  };
  if (subAccountId) headers['for-user-id'] = subAccountId;

  try {
    const { data } = await axios.post(`${XENDIT_API_BASE}${XENDIT_PAYMENT_REQUESTS_PATH}`, body, { headers, timeout: 20000 });
    return { ok: true, data };
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    console.error('[Xendit] chargeWithXenditPaymentToken', msg, e?.response?.data);
    return { ok: false, reason: typeof msg === 'string' ? msg : 'CHARGE_FAILED', raw: e?.response?.data };
  }
}

/**
 * True when Payments API payment request completed successfully (sync response).
 * If status is REQUIRES_ACTION / PENDING, do not mark rent paid here — wait for webhooks or a later job.
 * @param {object} pr - response body from POST /payment_requests
 */
function isPaymentRequestSucceededSync(pr) {
  if (!pr || typeof pr !== 'object') return false;
  const st = String(pr.status || '').toUpperCase();
  if (st === 'SUCCEEDED' || st === 'COMPLETED') return true;
  if (st === 'FAILED' || st === 'CANCELLED' || st === 'EXPIRED') return false;
  if (Array.isArray(pr.captures) && pr.captures.length > 0) return true;
  return false;
}

/**
 * After a successful token charge for rent: mark rentalcollection paid, receipts, operator credit fee (non–platform-flow).
 * @param {string} clientId
 * @param {string[]} rentalIds
 * @param {{ paymentRequestData: object, amountCents: number, referenceId: string }} p
 */
async function finalizeRentalCollectionAfterTokenCharge(clientId, rentalIds, p) {
  const { paymentRequestData, amountCents, referenceId } = p;
  if (!clientId || !Array.isArray(rentalIds) || rentalIds.length === 0) {
    return { ok: false, reason: 'INVALID_PARAMS' };
  }
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const txnid =
    String(paymentRequestData?.payment_request_id || paymentRequestData?.id || referenceId || '').trim() || referenceId;
  const placeholders = rentalIds.map(() => '?').join(',');
  const [upd] = await pool.query(
    `UPDATE rentalcollection SET ispaid = 1, paidat = ?, referenceid = ?, updated_at = NOW()
     WHERE id IN (${placeholders}) AND ispaid = 0`,
    [now, txnid, ...rentalIds]
  );
  const marked = upd.affectedRows || 0;
  if (marked > 0) {
    try {
      const { createReceiptForPaidRentalCollection } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
      await createReceiptForPaidRentalCollection(rentalIds, { source: 'xendit_token' });
    } catch (e) {
      console.warn('[Xendit] finalizeRentalCollectionAfterTokenCharge createReceipt failed', e?.message);
    }
    const amountMajor = Math.round(amountCents) / 100;
    const syntheticData = { paid_amount: amountMajor, amount: amountMajor, paidAmount: amountMajor };
    try {
      await applyPayexFeeDeduction(clientId, txnid, syntheticData, 'rental', null);
    } catch (e) {
      console.warn('[Xendit] finalizeRentalCollectionAfterTokenCharge fee failed', e?.message);
    }
  }
  return { ok: true, marked, txnid };
}

/**
 * Get Xendit credentials for client from client_integration (key=paymentGateway, provider=payex, enabled=1).
 * Supports: xendit_test_secret_key, xendit_live_secret_key, xendit_use_test (boolean).
 * @param {string} clientId
 * @returns {Promise<{ secretKey: string, useTest: boolean }|null>}
 */
async function getPayexCredentials(clientId) {
  if (!clientId) return null;
  const direct = await getPayexDirectCredentials(clientId, { allowPending: true });
  if (direct?.secretKey) {
    return {
      secretKey: direct.secretKey,
      useTest: !!direct.useTest,
      connectionStatus: direct.connectionStatus,
      directMode: true
    };
  }
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = 'payex' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  const raw = rows[0].values_json;
  const v = typeof raw === 'string' ? parseJson(raw) : raw || {};
  const forceDemo = process.env.FORCE_PAYMENT_SANDBOX === '1' || process.env.FORCE_PAYMENT_SANDBOX === 'true';
  const useTest = forceDemo || v.xendit_use_test === true || v.xendit_use_test === 1;
  const secretKey = useTest
    ? (v.xendit_test_secret_key || v.xendit_secret_key || '').toString().trim()
    : (v.xendit_live_secret_key || v.xendit_secret_key || '').toString().trim();
  if (secretKey) return { secretKey, useTest };
  const platformCfg = await getPayexPlatformConfig(clientId);
  if (platformCfg.usePlatformFlow) return { platformFlow: true };
  return null;
}

/**
 * Platform (Master) Xendit config from env. When set, we can use "platform flow": invoice created with platform key + split rule.
 * @returns {{ secretKey: string, useTest: boolean }|null}
 */
function getPlatformXenditConfig() {
  const forceDemo = process.env.FORCE_PAYMENT_SANDBOX === '1' || process.env.FORCE_PAYMENT_SANDBOX === 'true';
  const useTest = forceDemo || process.env.XENDIT_PLATFORM_USE_TEST === '1' || process.env.XENDIT_PLATFORM_USE_TEST === 'true';
  const secretKey = (useTest
    ? (process.env.XENDIT_PLATFORM_TEST_SECRET_KEY || process.env.XENDIT_PLATFORM_SECRET_KEY || '')
    : (process.env.XENDIT_PLATFORM_SECRET_KEY || '')
  ).toString().trim();
  if (!secretKey) return null;
  const platformAccountId = (process.env.XENDIT_PLATFORM_ACCOUNT_ID || '').toString().trim();
  return { secretKey, useTest, platformAccountId: platformAccountId || null };
}

function isPlatformModeEnabled() {
  return getPlatformXenditConfig() != null;
}

/**
 * Xendit split-rule `description` validation expects alphanumerics + spaces only.
 * (See error: ^[a-zA-Z0-9 ]+$)
 */
function sanitizeAlphanumSpaces(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * For a client with Payex enabled: whether we use platform flow (Master receives, then split to operator).
 * Platform flow requires env platform keys + client has xendit_sub_account_id.
 * @param {string} clientId
 * @returns {Promise<{ usePlatformFlow: boolean, subAccountId?: string, splitRuleId?: string }>}
 */
async function getPayexPlatformConfig(clientId) {
  const platform = getPlatformXenditConfig();
  if (!platform || !clientId) return { usePlatformFlow: false };
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = 'payex' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return { usePlatformFlow: false };
  const v = typeof rows[0].values_json === 'string' ? parseJson(rows[0].values_json) : rows[0].values_json || {};
  const disabled = v?.xendit_platform_flow_disabled === true || v?.xendit_platform_flow_disabled === 1 || v?.xendit_platform_flow_disabled === '1';
  if (disabled) return { usePlatformFlow: false };
  const subAccountId = (v.xendit_sub_account_id || '').toString().trim();
  if (!subAccountId) return { usePlatformFlow: false };
  const subAccountType = (v.xendit_sub_account_type || 'OWNED').toString().trim().toUpperCase();
  const platformPaymentMode = subAccountType === 'MANAGED' ? 'managed_direct' : 'split_rules';
  return {
    usePlatformFlow: true,
    subAccountId,
    subAccountType,
    platformPaymentMode,
    splitRuleId: (v.xendit_split_rule_id || '').toString().trim() || undefined
  };
}

async function disablePayexPlatformFlowForClient(clientId) {
  if (!clientId) return { ok: false };
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = 'payex' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return { ok: false, reason: 'NO_CLIENT_INTEGRATION' };
  const rec = rows[0];
  const v = typeof rec.values_json === 'string' ? parseJson(rec.values_json) : rec.values_json || {};
  const updated = { ...v, xendit_platform_flow_disabled: true };
  // Clear cached split rule id so we don't try to reuse it later.
  if ('xendit_split_rule_id' in updated) delete updated.xendit_split_rule_id;
  await pool.query(
    'UPDATE client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(updated), rec.id]
  );
  return { ok: true };
}

/**
 * Create a Split Rule via Xendit API (platform key). `getXenditOperatorSplitPercent()`% to operator; remainder on Master (platform). MDR varies by payment method.
 * @param {string} platformSecretKey
 * @param {string} subAccountId - Operator's Xendit Business ID
 * @param {string} currency - 'MYR'|'SGD'
 * @returns {Promise<{ id: string }>}
 */
async function createSplitRuleViaApi(platformSecretKey, subAccountId, currency) {
  const c = (currency || '').toString().trim().toUpperCase();
  if (c !== 'SGD' && c !== 'MYR') throw new Error(`CLIENT_CURRENCY_REQUIRED_FOR_XENDIT_SPLIT_RULE: ${currency}`);
  const auth = Buffer.from(`${platformSecretKey}:`).toString('base64');
  const refId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const opPct = getXenditOperatorSplitPercent();
  const descriptionRaw = `${opPct}% to operator; ${100 - opPct}% platform (gateway varies; ${PLATFORM_MARKUP_PERCENT}% SaaS in accounting)`;
  const description = sanitizeAlphanumSpaces(descriptionRaw);
  const body = {
    name: `Operator ${subAccountId.slice(0, 12)}`,
    description,
    routes: [
      { percent_amount: opPct, currency: c, destination_account_id: subAccountId, reference_id: refId }
    ]
  };
  try {
    console.error('[Xendit] createSplitRuleViaApi payload', {
      name: body.name,
      description,
      route_reference_id: body.routes?.[0]?.reference_id,
      route_destination_account_id: body.routes?.[0]?.destination_account_id,
      route_currency: body.routes?.[0]?.currency,
      route_percent_amount: body.routes?.[0]?.percent_amount
    });
    const { data } = await axios.post(`${XENDIT_API_BASE}/split_rules`, body, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    if (!data || !data.id) throw new Error('Xendit split rule creation did not return id');
    return { id: data.id };
  } catch (e) {
    const status = e?.response?.status;
    const respData = e?.response?.data;
    let respJson = '';
    try {
      respJson = respData ? JSON.stringify(respData) : '';
    } catch {
      respJson = '';
    }

    // Avoid leaking secret keys; keep only payload-relevant fields for diagnosis.
    console.error('[Xendit] createSplitRuleViaApi failed', {
      status,
      destination_account_id: subAccountId,
      currency,
      percent_amount: opPct,
      description,
      message: e?.message || e,
      xendit_response: respJson
    });

    const errCode = respData?.error_code;
    const firstErrMsg = Array.isArray(respData?.errors) ? (respData.errors[0]?.message || respData.errors[0]?.code) : undefined;
    const xenditMsg = respData?.message;
    throw new Error(
      `XENDIT_SPLIT_RULE_CREATE_FAILED${errCode ? `:${errCode}` : ''}${firstErrMsg ? `:${firstErrMsg}` : ''}${xenditMsg ? `:${xenditMsg}` : ''}`
    );
  }
}

/**
 * Get or create split rule for client (platform flow). Operator % from `getXenditOperatorSplitPercent()` (no credit deduction in platform flow).
 * Existing cached splitRuleId may be old 100%-to-operator rule; clear xendit_split_rule_id in DB to force a new rule.
 * @param {string} clientId
 * @returns {Promise<string>} split rule id
 */
async function ensureClientSplitRule(clientId) {
  const platform = getPlatformXenditConfig();
  if (!platform) throw new Error('XENDIT_PLATFORM_NOT_CONFIGURED');
  const cfg = await getPayexPlatformConfig(clientId);
  if (!cfg.usePlatformFlow || !cfg.subAccountId) throw new Error('XENDIT_SUB_ACCOUNT_NOT_SET');
  if (cfg.splitRuleId) return cfg.splitRuleId;
  const currency = await getClientCurrencyForPayex(clientId);
  const { id } = await createSplitRuleViaApi(platform.secretKey, cfg.subAccountId, currency);
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = 'payex' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    const v = typeof rows[0].values_json === 'string' ? parseJson(rows[0].values_json) : rows[0].values_json || {};
    const updated = { ...v, xendit_split_rule_id: id };
    await pool.query(
      'UPDATE client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(updated), rows[0].id]
    );
  }
  return id;
}

/**
 * Create Xendit invoice with with-split-rule header (payment goes to Master, then split on settlement).
 * @param {string} platformSecretKey
 * @param {object} body - snake_case: external_id, amount, description, currency, success_redirect_url, failure_redirect_url, payer_email, invoice_duration, metadata
 * @param {string} splitRuleId
 * @returns {Promise<{ invoice_url: string }>}
 */
async function createInvoiceWithSplitRuleViaApi(platformSecretKey, body, splitRuleId) {
  const auth = Buffer.from(`${platformSecretKey}:`).toString('base64');
  const { data } = await axios.post(`${XENDIT_API_BASE}/v2/invoices`, body, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      'with-split-rule': splitRuleId
    },
    timeout: 15000
  });
  if (!data || !data.invoice_url) throw new Error('Xendit did not return an invoice URL');
  return { invoice_url: data.invoice_url };
}

/**
 * Create Xendit invoice under a managed sub-account identity via API.
 * This lets us set `callback_url` per-invoice (no per-subaccount dashboard webhook needed).
 * @param {string} platformSecretKey
 * @param {string} subAccountId
 * @param {object} body - snake_case: external_id, amount, description, currency, success_redirect_url, failure_redirect_url, payer_email, invoice_duration, callback_url?, metadata
 * @returns {Promise<{ invoice_url: string }>}
 */
async function createInvoiceForManagedSubAccountViaApi(platformSecretKey, subAccountId, body) {
  if (!subAccountId) throw new Error('XENDIT_SUB_ACCOUNT_NOT_SET');
  const auth = Buffer.from(`${platformSecretKey}:`).toString('base64');
  const { data } = await axios.post(`${XENDIT_API_BASE}/v2/invoices`, body, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      'for-user-id': String(subAccountId)
    },
    timeout: 15000
  });
  if (!data || !data.invoice_url) throw new Error('Xendit did not return an invoice URL');
  return { invoice_url: data.invoice_url };
}

/**
 * Create a Xendit sub-account (OWNED) via platform key. For use in Company Setting "Create sub account" button.
 * @param {string} platformSecretKey
 * @param {{ email: string, businessName: string }} params
 * @returns {Promise<{ id: string, status?: string }>}
 */
async function createXenditSubAccountViaApi(platformSecretKey, params) {
  const auth = Buffer.from(`${platformSecretKey}:`).toString('base64');
  const body = {
    email: String(params.email || '').trim().slice(0, 255),
    // Managed accounts: platform controls transactions via `for-user-id`,
    // operator gets dashboard access to control payout & bank details.
    type: 'MANAGED',
    public_profile: {
      business_name: String(params.businessName || 'Operator').slice(0, 255)
    }
  };
  if (!body.email) throw new Error('XENDIT_SUB_ACCOUNT_EMAIL_REQUIRED');
  const { data } = await axios.post(`${XENDIT_API_BASE}/v2/accounts`, body, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });
  if (!data || !data.id) throw new Error('Xendit create account did not return id');
  return { id: data.id, status: data.status };
}

/**
 * Transfer from platform (Master) to operator sub-account so operator receives full amount.
 * Used in Platform flow: Xendit deducts fee from platform receipt; we transfer that fee to operator so payout = tenant amount.
 * @param {string} platformSecretKey
 * @param {string} platformAccountId - Master business ID (XENDIT_PLATFORM_ACCOUNT_ID)
 * @param {string} subAccountId - Operator sub-account business ID
 * @param {number} amountMYR - amount in MYR (e.g. 25 for 2.5% of 1000)
 * @param {string} reference - unique reference (e.g. referenceId + '-fee-topup')
 * @returns {Promise<{ transfer_id?: string, status?: string }>}
 */
async function transferPlatformToOperator(platformSecretKey, platformAccountId, subAccountId, amountMYR, reference) {
  if (!platformAccountId || !subAccountId || !reference || amountMYR <= 0) {
    throw new Error('Xendit transfer: missing platformAccountId, subAccountId, reference or invalid amount');
  }
  const auth = Buffer.from(`${platformSecretKey}:`).toString('base64');
  const body = {
    reference: String(reference).slice(0, 255),
    amount: Number(amountMYR),
    source_user_id: platformAccountId,
    destination_user_id: subAccountId
  };
  const { data } = await axios.post(`${XENDIT_API_BASE}/transfers`, body, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });
  return { transfer_id: data?.transfer_id, status: data?.status };
}

/**
 * (No longer used in platform flow.) Previously: transfer Xendit fee from platform to operator so operator received full payout.
 * Now: operator pays Xendit processing fee themselves (they receive net from split; fee visible in Xendit Dashboard). We only deduct 1% from credit.
 */
async function transferFeeToOperatorIfPlatform(_clientId, _referenceId, _data) {
  // Operator pays processing fee: no transfer from platform. They see fee in Xendit Dashboard.
  return;
}

/**
 * Get Xendit client instance for the given clientId.
 * @param {string} clientId
 * @returns {Promise<import('xendit-node').Xendit>}
 */
async function getXenditClient(clientId) {
  const creds = await getPayexCredentials(clientId);
  if (!creds) throw new Error('XENDIT_CREDENTIALS_NOT_CONFIGURED');
  return new Xendit({ secretKey: creds.secretKey });
}

/**
 * Create payment via Xendit Invoice API. Returns redirect URL (invoice_url).
 * Uses platform flow (Master + split rule) when platform keys are set and client has xendit_sub_account_id; else operator key.
 * Amount in cents (MYR); Xendit Invoice amount is in MYR (e.g. 10.50).
 * @param {string} clientId
 * @param {{ amountCents: number, referenceNumber: string, description: string, customerName: string, email: string, returnUrl: string, acceptUrl?: string, rejectUrl?: string, callbackUrl: string, metadata?: object, rentalIds?: string[] }} params
 * @returns {Promise<{ url: string }>}
 */
async function createPayment(clientId, params) {
  const reference_number = String(params.referenceNumber || '').slice(0, 255);
  const amountCents = Math.round(Number(params.amountCents) || 0);
  if (amountCents < 100) throw new Error('Amount must be at least 100 (RM 1.00) in cents.');
  const amountMajor = amountCents / 100;
  const currency = await getClientCurrencyForPayex(clientId);

  const baseUrl = process.env.PUBLIC_APP_URL || 'https://www.colivingjb.com';
  const successRedirectUrl = params.returnUrl || `${baseUrl}/tenant-dashboard?success=1`;
  const failureRedirectUrl = params.rejectUrl || params.returnUrl || `${baseUrl}/tenant-dashboard?cancel=1`;
  const callbackUrl = (params.callbackUrl || '').toString().trim();

  const metadata = typeof params.metadata === 'object' && params.metadata !== null ? { ...params.metadata } : {};
  metadata.client_id = clientId;
  if (params.rentalIds && params.rentalIds.length) {
    metadata.rental_ids = Array.isArray(params.rentalIds) ? params.rentalIds.join(',') : String(params.rentalIds);
  }

  const platformCfg = await getPayexPlatformConfig(clientId);
  if (platformCfg.usePlatformFlow) {
    const platform = getPlatformXenditConfig();
    if (!platform) throw new Error('XENDIT_PLATFORM_NOT_CONFIGURED');
    if (platformCfg.platformPaymentMode === 'managed_direct') {
      // Managed accounts: use platform key but create the invoice under operator's account identity.
      try {
        const body = {
          external_id: reference_number,
          amount: amountMajor,
          description: (params.description || 'Payment').slice(0, 2000),
          currency,
          ...(callbackUrl ? { callback_url: callbackUrl } : {}),
          success_redirect_url: successRedirectUrl,
          failure_redirect_url: failureRedirectUrl,
          payer_email: (params.email || '').slice(0, 255),
          invoice_duration: 86400,
          metadata: Object.keys(metadata).length ? metadata : undefined
        };
        const result = await createInvoiceForManagedSubAccountViaApi(platform.secretKey, platformCfg.subAccountId, body);
        return { url: result.invoice_url };
      } catch (e) {
        console.error('[Xendit] managed_direct createInvoice failed', {
          status: e?.response?.status,
          message: e?.message || String(e),
          xendit_response: e?.response?.data || e?.response?.body || e?.response?.text || undefined,
          raw_error: {
            name: e?.name,
            code: e?.code,
            stack: e?.stack,
          },
          clientId,
          forUserId: platformCfg.subAccountId,
          currency,
          externalId: reference_number
        });
        throw e;
      }
    }

    // Default: platform split rules mode
    try {
      const splitRuleId = await ensureClientSplitRule(clientId);
      const body = {
        external_id: reference_number,
        amount: amountMajor,
        description: (params.description || 'Payment').slice(0, 2000),
        currency,
        success_redirect_url: successRedirectUrl,
        failure_redirect_url: failureRedirectUrl,
        payer_email: (params.email || '').slice(0, 255),
        invoice_duration: 86400,
        metadata: Object.keys(metadata).length ? metadata : undefined
      };
      const result = await createInvoiceWithSplitRuleViaApi(platform.secretKey, body, splitRuleId);
      return { url: result.invoice_url };
    } catch (e) {
      const msg = String(e?.message || '');
      // If XenPlatform Split Rules aren't supported for this currency/region pairing,
      // fallback to operator flow so payment creation still succeeds.
      if (/FEATURE_NOT_SUPPORTED/i.test(msg)) {
        try {
          await disablePayexPlatformFlowForClient(clientId);
        } catch (_) {}
        console.warn('[Xendit] split_rules not supported; fallback to operator flow', {
          clientId,
          currency,
          error: msg.slice(0, 200)
        });
        // Operator flow below: create invoice with operator's own Xendit credentials.
      } else {
        throw e;
      }
    }
  }

  const xendit = await getXenditClient(clientId);
  const createPayload = {
    externalId: reference_number,
    amount: amountMajor,
    description: (params.description || 'Payment').slice(0, 2000),
    currency,
    successRedirectUrl,
    failureRedirectUrl,
    payerEmail: (params.email || '').slice(0, 255),
    invoiceDuration: 86400,
    metadata: Object.keys(metadata).length ? metadata : undefined
  };
  let invoice;
  try {
    invoice = await xendit.Invoice.createInvoice({ data: createPayload });
  } catch (e) {
    console.error('[Xendit] createInvoice failed', {
      status: e?.response?.status,
      message: e?.message || String(e),
      xendit_response: e?.response?.data || e?.response?.body || e?.response?.text || undefined,
      raw_error: {
        name: e?.name,
        code: e?.code,
        stack: e?.stack,
      },
      clientId,
      currency,
      externalId: reference_number
    });
    throw e;
  }
  const url = invoice?.invoiceUrl;
  if (!url) throw new Error('Xendit did not return an invoice URL');
  return { url };
}

/**
 * Handle Xendit invoice callback (webhook). Payload: id, external_id, status (PENDING | PAID | EXPIRED), metadata, amount, etc.
 * @param {object} data - callback body from Xendit
 * @param {{ routeClientId?: string|null }} [opts] - client_id already resolved in payex.routes (metadata or X-CALLBACK-TOKEN)
 * @returns {Promise<{ success: boolean, updated?: string[], error?: string }>}
 */
async function handleCallback(data, opts = {}) {
  try {
    const pt = await tryHandlePaymentSessionOrTokenEvent(data);
    if (pt && pt.handled) {
      return { success: true, ...pt.result };
    }
  } catch (e) {
    console.error('[Xendit] payment session/token webhook error:', e?.message || e);
  }

  const isXendit = data && (data.external_id != null || data.externalId != null);
  const referenceId = data?.external_id ?? data?.externalId ?? data?.reference_number ?? null;
  const status = (data?.status ?? data?.normalizedStatus ?? 'failed').toString().toUpperCase();
  const isSuccess = status === 'PAID' || status === 'SUCCEEDED' || status === 'success' || status === 'completed';
  const isPending = status === 'PENDING' || status === 'REQUIRES_ACTION' || status === 'PENDING_PAYMENT';

  let metadataObj = {};
  if (data?.metadata && typeof data.metadata === 'object') {
    metadataObj = data.metadata;
  } else if (typeof data?.metadata === 'string') {
    try {
      metadataObj = JSON.parse(data.metadata);
    } catch (e) {
      console.error('[Xendit] callback metadata parse failed:', e);
    }
  }

  console.log('[Xendit] callback received:', referenceId, status, Object.keys(metadataObj));

  let rentalIds = [];
  if (metadataObj.rental_ids) {
    rentalIds = typeof metadataObj.rental_ids === 'string'
      ? metadataObj.rental_ids.split(',').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(metadataObj.rental_ids) ? metadataObj.rental_ids : [];
  }

  if (!rentalIds.length && referenceId) {
    const [rows] = await pool.query(
      'SELECT id FROM rentalcollection WHERE referenceid = ? LIMIT 50',
      [referenceId]
    );
    if (rows.length) rentalIds = rows.map((r) => r.id);
  }

  let type = (metadataObj.type || data.type || '').toString();
  const tenantId = metadataObj.tenant_id || null;
  const tenancyId = metadataObj.tenancy_id || null;
  let meterTransactionId = (metadataObj.meter_transaction_id || '').trim();
  const refForExternal = String(referenceId || '').trim();
  /** Meter checkout uses `external_id` = `MT-{metertransaction.id}` so PAID webhooks still match if Xendit omits metadata. */
  if (!meterTransactionId && /^MT-/i.test(refForExternal)) {
    meterTransactionId = refForExternal.replace(/^MT-/i, '').trim();
  }
  if (!type && meterTransactionId && /^MT-/i.test(refForExternal)) {
    type = 'TenantMeter';
  }
  const clientIdFromMeta = (metadataObj.client_id || '').trim();
  const clientId = clientIdFromMeta || String(opts.routeClientId || '').trim();
  const amountPaid = Number(data?.paidAmount ?? data?.amount ?? 0);
  const amountCents = Math.round(amountPaid * 100);

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const paymentStatus = isSuccess ? 'complete' : (isPending ? 'pending' : 'failed');
  const estimatedReceiveAt = isSuccess ? (() => { const d = new Date(now.replace(' ', 'T')); d.setDate(d.getDate() + 2); return d.toISOString().slice(0, 19).replace('T', ' ') })() : null;
  if (clientId) {
    try {
      await markPayexWebhookVerified(clientId, { eventType: data?.event || data?.type || status });
    } catch (e) {
      console.warn('[Xendit] mark direct webhook verified failed', e?.message || e);
    }
  }

  if ((type === 'Topup' || type === 'credit_topup') && metadataObj.creditlog_id && isSuccess) {
    const creditlogId = metadataObj.creditlog_id;
    const [rows] = await pool.query(
      'SELECT id, client_id, amount, payment, currency FROM creditlogs WHERE id = ? AND is_paid = 0 LIMIT 1',
      [creditlogId]
    );
    if (rows.length) {
      const log = rows[0];
      const expectedCents = Math.round(Number(log.payment || 0) * 100);
      if (expectedCents > 0 && amountCents > 0 && amountCents !== expectedCents) {
        console.warn('[Xendit] operator topup amount mismatch', creditlogId, expectedCents, amountCents);
        return { success: false, error: 'AMOUNT_MISMATCH' };
      }
      const creditAmount = Number(log.amount) || 0;
      if (creditAmount > 0) {
        const payloadJson = JSON.stringify({ external_id: referenceId, status, invoice_id: data?.id });
        await pool.query(
          'UPDATE creditlogs SET is_paid = 1, txnid = ?, payload = ?, paiddate = ?, updated_at = ? WHERE id = ?',
          [referenceId, payloadJson, now, now, creditlogId]
        );
        const [clientRows] = await pool.query('SELECT id, credit FROM operatordetail WHERE id = ? LIMIT 1', [log.client_id]);
        if (clientRows.length) {
          const raw = clientRows[0].credit;
          let creditList = [];
          try {
            creditList = typeof raw === 'string' ? parseJson(raw) || [] : (Array.isArray(raw) ? raw : []);
          } catch (_) {}
          let flex = creditList.find((c) => c.type === 'flex');
          if (!flex) {
            flex = { type: 'flex', amount: 0 };
            creditList.push(flex);
          }
          flex.amount = Number(flex.amount) || 0;
          flex.amount += creditAmount;
          await pool.query('UPDATE operatordetail SET credit = ?, updated_at = ? WHERE id = ?', [JSON.stringify(creditList), now, log.client_id]);
          try {
            const { syncSubtablesFromOperatordetail } = require('../../services/client-subtables');
            await syncSubtablesFromOperatordetail(pool, log.client_id);
          } catch (_) {}
        }
        try {
          const { processPayexPendingFees } = require('../payex/payex.service');
          await processPayexPendingFees(log.client_id);
        } catch (e) {
          console.warn('[Xendit] processPayexPendingFees failed:', e?.message);
        }
        try {
          const { processBillplzPendingFees } = require('../billplz/billplz.service');
          await processBillplzPendingFees(log.client_id);
        } catch (e) {
          console.warn('[Xendit] processBillplzPendingFees failed:', e?.message);
        }
        return { success: true, type: 'Topup', creditlogId };
      }
    }
  }

  if (type === 'TenantMeter' && meterTransactionId) {
    const [mtRows] = await pool.query(
      'SELECT id, tenancy_id, invoiceid FROM metertransaction WHERE id = ? LIMIT 1',
      [meterTransactionId]
    );
    if (mtRows.length) {
      await pool.query(
        `UPDATE metertransaction SET ispaid = ?, status = ?, referenceid = ?, updated_at = ? WHERE id = ?`,
        [isSuccess ? 1 : 0, isSuccess ? 'success' : 'failed', referenceId, now, meterTransactionId]
      );
      // Operator payment timeline (complete/failed) + estimate. Settlement/payout are updated later by cron.
      if (clientId) {
        let currency = null;
        try {
          currency = await getClientCurrencyForPayex(clientId);
        } catch (_) {}
        if (currency) {
          const paymentIdForXendit = referenceId || String(data?.id || meterTransactionId || '').trim();
          const invoiceIdRaw = mtRows[0]?.invoiceid;
          const invoiceId = invoiceIdRaw != null && String(invoiceIdRaw).trim() ? String(invoiceIdRaw).trim() : null;
          await upsertXenditOperatorPayment({
            clientId,
            paymentId: paymentIdForXendit,
            chargeType: 'meter',
            currency,
            grossMajor: amountCents / 100,
            referenceNumber: referenceId,
            invoiceSource: 'metertransaction',
            invoiceRecordId: meterTransactionId,
            invoiceId,
            paymentStatus,
            paidAt: isSuccess ? now : null,
            estimatedReceiveAt
          });
        }
      }
      if (isSuccess && clientId && tenancyId) {
        try {
          const { handleTenantMeterPaymentSuccess } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
          await handleTenantMeterPaymentSuccess({
            metadata: { meter_transaction_id: meterTransactionId, tenancy_id: tenancyId, tenant_id: tenantId, amount_cents: String(amountCents), client_id: clientId },
            amount_total: amountCents,
            id: referenceId,
            payment_intent: referenceId
          });
        } catch (e) {
          console.warn('[Xendit] handleTenantMeterPaymentSuccess failed:', e?.message);
        }
        try {
          await applyPayexFeeDeduction(clientId, referenceId, data, 'meter', null);
        } catch (e) {
          console.warn('[Xendit] applyPayexFeeDeduction (meter) failed:', e?.message);
        }
      }
      return { success: true, updated: [meterTransactionId], type: 'TenantMeter' };
    }
  }

  if (rentalIds.length) {
    for (const rid of rentalIds) {
      await pool.query(
        'UPDATE rentalcollection SET referenceid = ?, updated_at = ? WHERE id = ?',
        [referenceId || '', now, rid]
      );
      if (isSuccess) {
        await pool.query(
          'UPDATE rentalcollection SET ispaid = 1, paidat = ?, updated_at = ? WHERE id = ?',
          [now, now, rid]
        );
        try {
          const { createReceiptForPaidRentalCollection } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
          await createReceiptForPaidRentalCollection([rid], { source: 'payex' });
        } catch (e) {
          console.warn('[Xendit] createReceiptForPaidRentalCollection failed:', e?.message);
        }
      }
    }
      // Operator payment timeline (payment/settlement/payout stages).
      const resolvedClientId = await resolveClientIdForFee(rentalIds, clientId);
      const firstRid = rentalIds[0];
      let invoiceId = null;
      try {
        const [invRows] = await pool.query('SELECT invoiceid FROM rentalcollection WHERE id = ? LIMIT 1', [firstRid]);
        invoiceId = invRows?.[0]?.invoiceid != null && String(invRows[0].invoiceid).trim() ? String(invRows[0].invoiceid).trim() : null;
      } catch (_) {}
      if (resolvedClientId) {
        let currency = null;
        try {
          currency = await getClientCurrencyForPayex(resolvedClientId);
        } catch (_) {}
        if (currency) {
          const paymentIdForXendit = (referenceId || String(data?.id || '').trim());
          await upsertXenditOperatorPayment({
            clientId: resolvedClientId,
            paymentId: paymentIdForXendit,
            chargeType: type === 'TenantInvoice' ? 'invoice' : 'rental',
            currency,
            grossMajor: amountCents / 100,
            referenceNumber: referenceId,
            invoiceSource: 'rentalcollection',
            invoiceRecordId: firstRid,
            invoiceId,
            paymentStatus,
            paidAt: isSuccess ? now : null,
            estimatedReceiveAt
          });
        }
      }

      if (isSuccess && resolvedClientId) {
        try {
          await applyPayexFeeDeduction(
            resolvedClientId,
            referenceId,
            data,
            type === 'TenantInvoice' ? 'invoice' : 'rental',
            null
          );
        } catch (e) {
          console.warn('[Xendit] applyPayexFeeDeduction failed:', e?.message);
        }
      }
    return { success: true, updated: rentalIds, type: 'TenantInvoice' };
  }

  // Token-verified operator (routeClientId or metadata client_id) but no bill/rental row: still OK for webhook ack + gateway verification above.
  if (clientId) {
    return { success: true, acknowledged: true, noBusinessMatch: true };
  }
  return { success: false, error: 'No rental_ids or referenceid match' };
}

function extractPaymentIdFromXenditTransactionLike(t) {
  if (!t || typeof t !== 'object') return '';
  const cands = [
    t.external_id,
    t.externalId,
    t.reference_id,
    t.referenceId,
    t.reference_number,
    t.referenceNumber,
    t.payment_id,
    t.paymentId,
    t.transaction_id,
    t.payment_request_id,
    t.invoice_id,
    t.id,
  ];
  for (const v of cands) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

/**
 * Upsert xendit_operator_payments – used to drive operator UI timeline:
 * Payment (complete/failed) -> Settlement received (master -> subaccount) -> Payout to bank + accounting journal id.
 */
async function upsertXenditOperatorPayment(opts) {
  const {
    clientId,
    paymentId,
    chargeType,
    currency,
    grossMajor,
    referenceNumber,
    invoiceSource,
    invoiceRecordId,
    invoiceId,
    paymentStatus,
    paidAt,
    estimatedReceiveAt,
  } = opts || {};

  if (!clientId || !paymentId) return { ok: false, reason: 'MISSING_CLIENT_ID_OR_PAYMENT_ID' };
  const cid = String(clientId).trim();
  const pid = String(paymentId).trim();
  if (!cid || !pid) return { ok: false, reason: 'MISSING_CLIENT_ID_OR_PAYMENT_ID' };

  const id = randomUUID();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const cc = String(currency || '').trim().toUpperCase() || 'MYR';
  const charge = String(chargeType || 'rental').trim().toLowerCase();
  const invSource = invoiceSource ? String(invoiceSource).trim() : null;

  const ps = paymentStatus ? String(paymentStatus).trim().toLowerCase() : 'pending';
  const gross = Number(grossMajor) || 0;

  const ref = referenceNumber ? String(referenceNumber).slice(0, 255) : null;
  const invRecord = invoiceRecordId ? String(invoiceRecordId).slice(0, 100) : null;
  const inv = invoiceId ? String(invoiceId).slice(0, 100) : null;
  const paid = paidAt || null;
  const estimated = estimatedReceiveAt || null;

  // Webhook may arrive multiple times; keep settlement/payout progression if already advanced.
  await pool.query(
    `INSERT INTO xendit_operator_payments
      (id, client_id, provider, payment_id, charge_type, currency, gross_amount, reference_number,
       invoice_source, invoice_record_id, invoice_id,
       payment_status, paid_at, estimated_receive_at,
       settlement_status, received_at,
       payout_status, payout_at, accounting_journal_id,
       created_at, updated_at)
     VALUES
      (?, ?, 'xendit', ?, ?, ?, ?, ?,
       ?, ?, ?,
       ?, ?, ?,
       'pending', NULL,
       'pending', NULL, NULL,
       ?, ?)
     ON DUPLICATE KEY UPDATE
       charge_type = VALUES(charge_type),
       currency = VALUES(currency),
       gross_amount = VALUES(gross_amount),
       reference_number = VALUES(reference_number),
       invoice_source = VALUES(invoice_source),
       invoice_record_id = VALUES(invoice_record_id),
       invoice_id = VALUES(invoice_id),
       payment_status = VALUES(payment_status),
       paid_at = IF(paid_at IS NULL, VALUES(paid_at), paid_at),
       estimated_receive_at = IF(estimated_receive_at IS NULL, VALUES(estimated_receive_at), estimated_receive_at),
       settlement_status = IF(settlement_status = 'pending', VALUES(settlement_status), settlement_status),
       received_at = IF(received_at IS NULL, VALUES(received_at), received_at),
       payout_status = IF(payout_status = 'pending', VALUES(payout_status), payout_status),
       payout_at = IF(payout_at IS NULL, VALUES(payout_at), payout_at),
       accounting_journal_id = IF(accounting_journal_id IS NULL, VALUES(accounting_journal_id), accounting_journal_id),
       updated_at = NOW()`,
    [
      id,
      cid,
      pid,
      charge,
      cc,
      gross,
      ref,
      invSource,
      invRecord,
      inv,
      ps,
      paid,
      estimated,
      now,
      now
    ]
  );

  return { ok: true };
}

/**
 * SaaS credit deduction: ceil(1% of tenant payment) whole credits. Gateway fees are on the operator's PSP; we do not ledger them.
 * @param {object} data - Xendit callback body (paid_amount, amount, …)
 * @returns {{ deductCredits: number, platformMarkupCents: number, xenditFeeCents: number }}
 */
function getPayexFeeDeduction(data) {
  const amountPaid = Number(data?.paid_amount ?? data?.paidAmount ?? data?.amount ?? 0);
  const amountCents = Math.round(amountPaid * 100);
  const platformMarkupCents = Math.round((amountCents * PLATFORM_MARKUP_PERCENT) / 100);
  /** ceil(1% in major currency) = integer credits (align Stripe / Billplz). */
  const deductCredits = Math.max(0, Math.ceil(Number(platformMarkupCents) / 100)) || 0;
  return { deductCredits, platformMarkupCents, xenditFeeCents: 0 };
}

/**
 * Resolve client_id for fee deduction (from metadata or first rental).
 * @param {string[]} rentalIds
 * @param {string} metadataClientId
 * @returns {Promise<string|null>}
 */
async function resolveClientIdForFee(rentalIds, metadataClientId) {
  const cid = (metadataClientId || '').trim();
  if (cid) return cid;
  if (Array.isArray(rentalIds) && rentalIds.length > 0) {
    const [rows] = await pool.query(
      'SELECT client_id FROM rentalcollection WHERE id = ? LIMIT 1',
      [rentalIds[0]]
    );
    if (rows.length && rows[0].client_id) return String(rows[0].client_id).trim();
  }
  return null;
}

/**
 * Deduct Payex processing fee from client credit and insert creditlog (align with Stripe RentRelease).
 * @param {string} currency - 'MYR' | 'SGD' for creditlog.
 */
function tenantNameOrDash(tenantName) {
  const s = tenantName != null ? String(tenantName).trim() : '';
  return s || '—';
}

async function deductPayexFeeAndLog(clientId, referenceId, amountCents, deduction, chargeType, tenantName, currency) {
  const { deductClientCredit } = require('../stripe/stripe.service');
  await deductClientCredit(clientId, deduction.deductCredits, null, { allowNegative: true });
  const logId = randomUUID();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const title = 'Xendit Processing Fees';
  const remark = `SaaS credit: ${PLATFORM_MARKUP_PERCENT}% of successful tenant payment (credits). Transaction ${referenceId || logId}`;
  const payloadStr = JSON.stringify({
    external_id: referenceId,
    amount_cents: amountCents,
    platform_markup_cents: deduction.platformMarkupCents,
    xendit_fee_cents: deduction.xenditFeeCents,
    deduct_credits: deduction.deductCredits,
    charge_type: chargeType
  });
  const currencyUpper = (currency || '').toString().trim().toUpperCase();
  if (currencyUpper !== 'SGD' && currencyUpper !== 'MYR') throw new Error(`CLIENT_CURRENCY_REQUIRED_FOR_PAYEX_FEE_LOG: ${currency}`);
  const curr = currencyUpper;
  const platformMarkupMajor = Math.abs(deduction.platformMarkupCents) / 100;
  const amountCredits = deduction.deductCredits > 0 ? -Math.abs(Number(deduction.deductCredits) || 0) : 0;
  await pool.query(
    `INSERT INTO creditlogs (id, title, type, amount, payment, client_id, staff_id, reference_number, payload, remark, currency, stripe_fee_amount, platform_markup_amount, tenant_name, charge_type, created_at, updated_at)
     VALUES (?, ?, 'Spending', ?, NULL, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [
      logId,
      title,
      amountCredits,
      clientId,
      `PF-${referenceId || logId}`,
      payloadStr,
      remark,
      curr,
      platformMarkupMajor.toFixed(2),
      tenantNameOrDash(tenantName),
      chargeType || 'rental',
      now,
      now
    ]
  );
  try {
    const { upsertProcessingFeeLedgerRow } = require('../billing/processing-fee-log.service');
    const gwMajor =
      deduction.xenditFeeCents != null && Number(deduction.xenditFeeCents) > 0
        ? Number((Math.abs(deduction.xenditFeeCents) / 100).toFixed(4))
        : null;
    await upsertProcessingFeeLedgerRow({
      clientId,
      provider: 'xendit',
      chargeType: chargeType || 'rental',
      status: 'pending',
      paymentId: String(referenceId || logId).trim(),
      referenceNumber: `PF-${referenceId || logId}`,
      currency: curr,
      grossAmountMajor: Number(((amountCents || 0) / 100).toFixed(2)),
      gatewayFeesAmountMajor: gwMajor,
      platformMarkupAmountMajor: platformMarkupMajor,
      metadata: {
        deduct_credits: deduction.deductCredits,
        tenant_name: tenantNameOrDash(tenantName),
        external_id: referenceId || null,
        creditlog_id: logId
      },
      _logCaller: 'payex.deductPayexFeeAndLog'
    });
  } catch (e) {
    console.error(
      '[processing_fees] CALLER payex.deductPayexFeeAndLog (creditlog already saved; ledger failed)',
      e?.message || e
    );
  }
  try {
    const { clearBillingCacheByClientId } = require('../billing/billing.service');
    clearBillingCacheByClientId(clientId);
  } catch (_) {}
  return { deducted: true, deductCredits: deduction.deductCredits };
}

/**
 * Insert pending Payex fee when credit insufficient. Processed on next top-up.
 */
async function insertPayexFeePending(clientId, referenceId, deduction, chargeType, tenantName, amountCents) {
  const id = randomUUID();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(
    `INSERT INTO payex_fee_pending (id, client_id, external_id, amount_credits, amount_cents, platform_markup_cents, xendit_fee_cents, charge_type, tenant_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      clientId,
      referenceId || id,
      deduction.deductCredits,
      amountCents,
      deduction.platformMarkupCents,
      deduction.xenditFeeCents,
      chargeType || 'rental',
      tenantName || null,
      now
    ]
  );
}

/**
 * Process pending Payex fees for client (call after top-up). Deducts and writes creditlog for each pending row, then deletes.
 */
async function processPayexPendingFees(clientId) {
  const { deductClientCredit } = require('../stripe/stripe.service');
  const currency = await getClientCurrencyForPayex(clientId);
  const curr = currency;
  const [rows] = await pool.query(
    'SELECT id, external_id, amount_credits, amount_cents, platform_markup_cents, xendit_fee_cents, charge_type, tenant_name FROM payex_fee_pending WHERE client_id = ? ORDER BY created_at ASC',
    [clientId]
  );
  let processed = 0;
  for (const row of rows) {
    await deductClientCredit(clientId, row.amount_credits, null, { allowNegative: true });
    const logId = randomUUID();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const title = 'Xendit Processing Fees';
    const remark = row.xendit_fee_cents > 0
      ? `Processing fees (1% platform markup + Xendit fee). Transaction ${row.external_id}`
      : `1% platform markup. Xendit fee in your Xendit Dashboard. Transaction ${row.external_id}`;
    const payloadStr = JSON.stringify({
      external_id: row.external_id,
      amount_cents: row.amount_cents,
      platform_markup_cents: row.platform_markup_cents,
      xendit_fee_cents: row.xendit_fee_cents,
      deduct_credits: row.amount_credits,
      charge_type: row.charge_type
    });
    const pmMajor = Math.abs(Number(row.platform_markup_cents || 0)) / 100;
    const creditsOut = Math.max(0, Math.round(Number(row.amount_credits || 0)));
    await pool.query(
      `INSERT INTO creditlogs (id, title, type, amount, payment, client_id, staff_id, reference_number, payload, remark, currency, platform_markup_amount, tenant_name, charge_type, created_at, updated_at)
       VALUES (?, ?, 'Spending', ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        title,
        creditsOut > 0 ? -creditsOut : 0,
        clientId,
        `PF-${row.external_id}`,
        payloadStr,
        remark,
        curr,
        pmMajor.toFixed(2),
        tenantNameOrDash(row.tenant_name),
        row.charge_type || 'rental',
        now,
        now
      ]
    );
    try {
      const { upsertProcessingFeeLedgerRow } = require('../billing/processing-fee-log.service');
      const xf = row.xendit_fee_cents != null && Number(row.xendit_fee_cents) > 0
        ? Number((Math.abs(Number(row.xendit_fee_cents)) / 100).toFixed(4))
        : null;
      await upsertProcessingFeeLedgerRow({
        clientId,
        provider: 'xendit',
        chargeType: row.charge_type || 'rental',
        status: 'pending',
        paymentId: String(row.external_id || '').trim(),
        referenceNumber: `PF-${row.external_id}`,
        currency: curr,
        grossAmountMajor: Number(((Number(row.amount_cents || 0)) / 100).toFixed(2)),
        gatewayFeesAmountMajor: xf,
        platformMarkupAmountMajor: pmMajor,
        metadata: {
          deduct_credits: row.amount_credits,
          tenant_name: tenantNameOrDash(row.tenant_name),
          external_id: row.external_id || null,
          creditlog_id: logId
        },
        _logCaller: 'payex.processPayexPendingFees'
      });
    } catch (e) {
      console.error(
        '[processing_fees] CALLER payex.processPayexPendingFees (creditlog already saved; ledger failed)',
        e?.message || e
      );
    }
    await pool.query('DELETE FROM payex_fee_pending WHERE id = ?', [row.id]);
    processed++;
  }
  if (processed > 0) {
    try {
      const { clearBillingCacheByClientId } = require('../billing/billing.service');
      clearBillingCacheByClientId(clientId);
    } catch (_) {}
  }
  return { processed };
}

/**
 * Apply SaaS credit deduction after successful Xendit tenant payment (same rule for all platform / sub-account modes).
 * Idempotent: webhook + tenant confirm-payment both call handleCallback → skip if PF-{referenceId} creditlog already exists.
 */
async function applyPayexFeeDeduction(clientId, referenceId, data, chargeType, tenantName) {
  if (!clientId) return;
  const ref = String(referenceId || '').trim();
  if (!ref) return;
  const feeRef = `PF-${ref}`;
  const [doneRows] = await pool.query(
    `SELECT id FROM creditlogs WHERE client_id = ? AND reference_number = ?
     AND (type = 'PayexFee' OR (type = 'Spending' AND title = 'Xendit Processing Fees'))
     LIMIT 1`,
    [clientId, feeRef]
  );
  if (doneRows.length) return;
  const amountCents = Math.round(Number(data?.paid_amount ?? data?.paidAmount ?? data?.amount ?? 0) * 100);
  const deduction = getPayexFeeDeduction(data);
  if (deduction.deductCredits <= 0) return;
  const currency = await getClientCurrencyForPayex(clientId);
  await deductPayexFeeAndLog(clientId, referenceId, amountCents, deduction, chargeType, tenantName, currency);
}

/**
 * Fetch settlements – Xendit: use Transaction API if available. For now returns empty (xenPlatform settlements may be per sub-account).
 * @param {string} clientId
 * @param {{ startDate?: Date, endDate?: Date }} opts
 * @returns {Promise<object[]>}
 */
async function fetchSettlements(clientId, opts = {}) {
  try {
    const platformCfg = await getPayexPlatformConfig(clientId);
    if (platformCfg.usePlatformFlow && platformCfg.platformPaymentMode === 'managed_direct') {
      const platform = getPlatformXenditConfig();
      if (!platform) throw new Error('XENDIT_PLATFORM_NOT_CONFIGURED');
      const xendit = new Xendit({ secretKey: platform.secretKey });
      if (xendit.Transaction && typeof xendit.Transaction.getAllTransactions === 'function') {
        const res = await xendit.Transaction.getAllTransactions({ limit: 200, forUserId: platformCfg.subAccountId });
        const list = res?.data ?? (Array.isArray(res) ? res : []);
        return Array.isArray(list) ? list : [];
      }
    }
    const xendit = await getXenditClient(clientId);
    if (xendit.Transaction && typeof xendit.Transaction.getAllTransactions === 'function') {
      const res = await xendit.Transaction.getAllTransactions({ limit: 200 });
      const list = res?.data ?? (Array.isArray(res) ? res : []);
      return Array.isArray(list) ? list : [];
    }
  } catch (e) {
    console.warn('[Xendit] fetchSettlements not available:', e?.message);
  }
  return [];
}

/**
 * Save settlements to payex_settlement table (grouped by settlement id). For Xendit we may store transaction batches.
 * @param {string} clientId
 * @param {object[]} rawList
 * @returns {Promise<{ saved: number, skipped: number }>}
 */
async function saveSettlements(clientId, rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) return { saved: 0, skipped: 0 };
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let saved = 0;
  let skipped = 0;
  for (const t of rawList) {
    const settlementId = t.id || t.transaction_id || t.payment_request_id || t.invoice_id || `txn-${Date.now()}-${saved}`;
    const paymentIdCandidate = extractPaymentIdFromXenditTransactionLike(t) || String(settlementId || '').trim();
    if (paymentIdCandidate) {
      // Mark "Received in operator sub-account" once we can see the transaction in Xendit settlements.
      await pool.query(
        `UPDATE xendit_operator_payments
         SET settlement_status = 'received',
             received_at = ?,
             updated_at = NOW()
         WHERE client_id = ?
           AND payment_id = ?
           AND payment_status = 'complete'
           AND settlement_status = 'pending'`,
        [now, clientId, paymentIdCandidate]
      );
    }
    const [exists] = await pool.query(
      'SELECT 1 FROM payex_settlement WHERE client_id = ? AND settlement_id = ? LIMIT 1',
      [clientId, settlementId]
    );
    if (exists.length) {
      skipped++;
      continue;
    }
    const grossAmount = Number(t.amount ?? t.request_amount ?? t.paid_amount ?? 0);
    await pool.query(
      `INSERT INTO payex_settlement (id, client_id, settlement_id, date, gross_amount, net_amount, mdr, raw_data, fetched_at, bukku_journal_id, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)`,
      [
        clientId,
        settlementId,
        now.slice(0, 10),
        grossAmount,
        grossAmount,
        JSON.stringify(t),
        now,
        now,
        now
      ]
    );
    saved++;
  }
  return { saved, skipped };
}

async function handlePayoutCallback(data = {}, clientId) {
  const cid = clientId != null && String(clientId).trim() ? String(clientId).trim() : '';
  if (!cid) return { ok: false, reason: 'NO_CLIENT_ID' };
  const settlementId = String(data.id || data.disbursement_id || data.payout_id || '').trim();
  if (!settlementId) return { ok: false, reason: 'NO_SETTLEMENT_ID' };

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const rawStatus = String(data.status || data.payment_status || '').trim().toLowerCase();
  // Xendit payout docs: terminal webhook statuses are SUCCEEDED / FAILED / REVERSED.
  // ACCEPTED only means the payout was created/accepted, not yet completed, so it must not journal yet.
  const success = ['paid', 'completed', 'success', 'succeeded'].includes(rawStatus);
  const failed = ['failed', 'canceled', 'cancelled', 'rejected', 'reversed'].includes(rawStatus);
  const grossAmount = Number(data.amount ?? data.net_amount ?? data.paid_amount ?? 0) || 0;
  const netAmount = Number(data.net_amount ?? data.amount ?? 0) || grossAmount;
  const dateSource = data.updated || data.created || data.estimated_arrival_time || now;
  const date = String(dateSource).slice(0, 10) || now.slice(0, 10);
  const rawJson = JSON.stringify(data);

  await pool.query(
    `INSERT INTO payex_settlement
      (id, client_id, settlement_id, date, gross_amount, net_amount, mdr, raw_data, fetched_at, bukku_journal_id, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE
       date = COALESCE(payex_settlement.date, VALUES(date)),
       gross_amount = CASE WHEN VALUES(gross_amount) > 0 THEN VALUES(gross_amount) ELSE payex_settlement.gross_amount END,
       net_amount = CASE WHEN VALUES(net_amount) > 0 THEN VALUES(net_amount) ELSE payex_settlement.net_amount END,
       raw_data = VALUES(raw_data),
       fetched_at = VALUES(fetched_at),
       updated_at = VALUES(updated_at)`,
    [cid, settlementId, date, grossAmount, netAmount, rawJson, now, now, now]
  );

  const [rows] = await pool.query(
    `SELECT id, client_id, settlement_id, date, gross_amount, net_amount, mdr, bukku_journal_id, raw_data
       FROM payex_settlement
      WHERE client_id = ? AND settlement_id = ?
      LIMIT 1`,
    [cid, settlementId]
  );
  const row = rows?.[0] || null;

  let journal = null;
  if (success && row) {
    const { createJournalForPayexSettlementRow } = require('./settlement-journal.service');
    journal = await createJournalForPayexSettlementRow(row);
  }

  return {
    ok: true,
    type: 'xendit_payout',
    settlementId,
    status: failed ? (rawStatus || 'failed') : success ? 'paid' : (rawStatus || 'pending'),
    journal
  };
}

/**
 * Run fetch + save settlements for all clients with Payex (Xendit) enabled.
 */
async function fetchAndSaveSettlementsForAllClients() {
  const [rows] = await pool.query(
    `SELECT DISTINCT client_id FROM client_integration
     WHERE \`key\` = 'paymentGateway' AND provider = 'payex' AND enabled = 1`
  );
  const result = { byClient: {}, totalSaved: 0, totalSkipped: 0 };
  for (const r of rows) {
    const clientId = r.client_id;
    try {
      const rawList = await fetchSettlements(clientId);
      const { saved, skipped } = await saveSettlements(clientId, rawList);
      result.byClient[clientId] = { saved, skipped };
      result.totalSaved += saved;
      result.totalSkipped += skipped;
    } catch (e) {
      console.error('[Xendit] fetchAndSaveSettlements for client', clientId, e?.message);
      result.byClient[clientId] = { error: e?.message };
    }
  }
  return result;
}

async function confirmInvoicePaymentByReference({ clientId, tenantId, referenceNumber }) {
  if (!clientId || !tenantId || !referenceNumber) {
    return { ok: false, reason: 'MISSING_CLIENT_TENANT_OR_REFERENCE' };
  }
  const creds = await getPayexCredentials(clientId);
  const headers = { 'Content-Type': 'application/json' };
  let secretKey = creds?.secretKey || '';
  if (!secretKey && creds?.platformFlow) {
    const platform = getPlatformXenditConfig();
    const platformCfg = await getPayexPlatformConfig(clientId);
    if (!platform?.secretKey) return { ok: false, reason: 'XENDIT_CREDENTIALS_NOT_CONFIGURED' };
    secretKey = platform.secretKey;
    if (platformCfg?.subAccountId) headers['for-user-id'] = platformCfg.subAccountId;
  }
  if (!secretKey) return { ok: false, reason: 'XENDIT_CREDENTIALS_NOT_CONFIGURED' };
  headers.Authorization = `Basic ${xenditBasicAuth(secretKey)}`;

  let invoice;
  try {
    const { data } = await axios.get(`${XENDIT_API_BASE}/v2/invoices`, {
      headers,
      params: { external_id: referenceNumber },
      timeout: 15000
    });
    const list = Array.isArray(data)
      ? data
      : (Array.isArray(data?.data) ? data.data : (data ? [data] : []));
    invoice = list.find((item) => {
      const externalId = item?.external_id ?? item?.externalId ?? item?.reference_number;
      return String(externalId || '').trim() === String(referenceNumber).trim();
    }) || null;
  } catch (e) {
    console.error('[Xendit] confirmInvoicePaymentByReference fetch failed', {
      clientId,
      referenceNumber,
      status: e?.response?.status,
      message: e?.message || String(e)
    });
    return { ok: false, reason: 'XENDIT_CONFIRM_FETCH_FAILED' };
  }

  if (!invoice) return { ok: false, reason: 'INVOICE_NOT_FOUND' };
  const metadata = typeof invoice.metadata === 'object' && invoice.metadata !== null
    ? invoice.metadata
    : parseJson(invoice.metadata) || {};
  if (String(metadata.tenant_id || '').trim() !== String(tenantId).trim()) {
    return { ok: false, reason: 'FORBIDDEN' };
  }

  const status = String(invoice.status || invoice.normalizedStatus || '').toUpperCase();
  if (!['PAID', 'SUCCEEDED', 'COMPLETED'].includes(status)) {
    return { ok: false, reason: 'PAYMENT_NOT_COMPLETED', status };
  }

  const callbackResult = await handleCallback(invoice, { routeClientId: clientId });
  return {
    ok: true,
    result: {
      provider: 'payex',
      referenceNumber: String(referenceNumber),
      status,
      callbackResult
    }
  };
}

/** @deprecated Use getPayexCredentials; kept for compatibility. */
async function getBearerToken(clientId) {
  const creds = await getPayexCredentials(clientId);
  if (!creds) throw new Error('XENDIT_CREDENTIALS_NOT_CONFIGURED');
  return creds.secretKey;
}

module.exports = {
  isXenditPayoutCallbackPayload,
  handlePayoutCallback,
  getPayexCredentials,
  getPlatformXenditConfig,
  isPlatformModeEnabled,
  getPayexPlatformConfig,
  createXenditSubAccountViaApi,
  getXenditClient,
  getBearerToken,
  createPayment,
  createPaymentSessionSaveForTenant,
  chargeWithXenditPaymentToken,
  isPaymentRequestSucceededSync,
  finalizeRentalCollectionAfterTokenCharge,
  handleCallback,
  confirmInvoicePaymentByReference,
  processPayexPendingFees,
  fetchSettlements,
  saveSettlements,
  fetchAndSaveSettlementsForAllClients
};
