/**
 * Coliving SaaS: Operator Portal pricing plan + credit top-up via platform Xendit master key (no split / no operator sub-account).
 * Webhook: POST /api/payex/callback with metadata.saas_platform=1; header X-CALLBACK-TOKEN vs
 * XENDIT_SAAS_PLATFORM_TEST_CALLBACK_TOKEN / XENDIT_SAAS_PLATFORM_LIVE_CALLBACK_TOKEN (or legacy XENDIT_SAAS_PLATFORM_CALLBACK_TOKEN).
 * MYR: Invoice v2 — FPX only (DD_*_FPX). Default: one request with B2C + B2B FPX codes so the hosted page lets the operator pick bank / retail vs business rail. Fallback: B2C-only batch, B2B-only batch, then per-bank tries. Never omit payment_methods (avoids cards/e-wallets). Env: XENDIT_SAAS_MYR_INVOICE_PAYMENT_METHODS (override all), XENDIT_SAAS_MYR_FPX_INCLUDE_B2B=0 for B2C-only pool.
 * SGD: Invoice v2 (POST /v2/invoices) by default — env XENDIT_SAAS_SGD_INVOICE_PAYMENT_METHODS (override). Escape hatches: XENDIT_SAAS_SGD_CHECKOUT_MODE=payment_session | payment_request_v3.
 */

const axios = require('axios');
const pool = require('../../config/db');
const { getAccessContextByEmail, normalizeEmail } = require('../access/access.service');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
const { getExpectedSaaSPlatformCallbackToken } = require('../../utils/xenditSaasPlatformCallbackToken');
const { getPlatformXenditConfig } = require('../payex/payex.service');
const { handlePricingPlanPaymentSuccess } = require('./checkout.service');
const { finalizeSaasPlanAfterBillplzPayment } = require('./indoor-admin.service');
const {
  OPERATOR_PORTAL_XENDIT_SAAS_SOURCE,
  applyOperatorCreditTopupPaid,
  saasBukkuInvoiceForPricingPlan
} = require('./billplz-operator-saas.service');

const XENDIT_API_BASE = 'https://api.xendit.co';
/** Payments API v3 (payment_requests): required on create/get per Xendit docs */
const XENDIT_PAYMENTS_API_VERSION = '2024-11-11';

/** Portal /enquiry MYR plan checkout payload_json.source */
const SAAS_XENDIT_ENQUIRY_SOURCE = 'saas_xendit_enquiry';

/** Last try after per-bank FPX: high-level channel (may still be rejected on some merchants). */
const MYR_INVOICE_FPX_DIRECT_DEBIT = ['DIRECT_DEBIT'];

/** MY FPX B2C (personal / retail online banking) — xendit-node DirectDebitType MY retail codes */
const MYR_FPX_B2C_ALL = [
  'DD_PUBLIC_FPX',
  'DD_AMBANK_FPX',
  'DD_KFH_FPX',
  'DD_AGRO_FPX',
  'DD_AFFIN_FPX',
  'DD_ALLIANCE_FPX',
  'DD_MUAMALAT_FPX',
  'DD_HLB_FPX',
  'DD_ISLAM_FPX',
  'DD_RAKYAT_FPX',
  'DD_CIMB_FPX',
  'DD_UOB_FPX',
  'DD_BOC_FPX',
  'DD_BSN_FPX',
  'DD_OCBC_FPX',
  'DD_HSBC_FPX',
  'DD_SCH_FPX',
  'DD_MAYB2U_FPX',
  'DD_RHB_FPX'
];

/** MY FPX B2B (business / corporate) */
const MYR_FPX_B2B_ALL = [
  'DD_UOB_FPX_BUSINESS',
  'DD_AGRO_FPX_BUSINESS',
  'DD_ALLIANCE_FPX_BUSINESS',
  'DD_AMBANK_FPX_BUSINESS',
  'DD_ISLAM_FPX_BUSINESS',
  'DD_MUAMALAT_FPX_BUSINESS',
  'DD_HLB_FPX_BUSINESS',
  'DD_HSBC_FPX_BUSINESS',
  'DD_RAKYAT_FPX_BUSINESS',
  'DD_KFH_FPX_BUSINESS',
  'DD_OCBC_FPX_BUSINESS',
  'DD_PUBLIC_FPX_BUSINESS',
  'DD_RHB_FPX_BUSINESS',
  'DD_SCH_FPX_BUSINESS',
  'DD_CITIBANK_FPX_BUSINESS',
  'DD_BNP_FPX_BUSINESS',
  'DD_DEUTSCHE_FPX_BUSINESS',
  'DD_MAYB2E_FPX_BUSINESS',
  'DD_CIMB_FPX_BUSINESS',
  'DD_AFFIN_FPX_BUSINESS'
];

/** If merged B2C+B2B batch 400s, try one retail bank at a time (popular first). */
const MYR_FPX_TRY_SINGLE_ORDER = [
  'DD_MAYB2U_FPX',
  'DD_CIMB_FPX',
  'DD_PUBLIC_FPX',
  'DD_UOB_FPX',
  'DD_RHB_FPX',
  'DD_HLB_FPX',
  'DD_HSBC_FPX',
  'DD_OCBC_FPX',
  'DD_BSN_FPX',
  'DD_ISLAM_FPX',
  'DD_AFFIN_FPX',
  'DD_AMBANK_FPX',
  'DD_RAKYAT_FPX',
  'DD_AGRO_FPX',
  'DD_ALLIANCE_FPX',
  'DD_MUAMALAT_FPX',
  'DD_BOC_FPX',
  'DD_KFH_FPX',
  'DD_SCH_FPX'
];

function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * Optional comma-separated or JSON array, e.g. DD_CIMB_FPX,DD_MAYB2U_FPX or ["DD_CIMB_FPX"].
 * If set, replaces the default MYR chain (use when you must pin specific FPX rails).
 */
function getMyrInvoicePaymentMethodsFromEnv() {
  const raw = normalizeText(process.env.XENDIT_SAAS_MYR_INVOICE_PAYMENT_METHODS);
  if (!raw) return null;
  if (raw.startsWith('[')) {
    try {
      const j = JSON.parse(raw);
      if (!Array.isArray(j) || !j.length) return null;
      return j.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      return null;
    }
  }
  const parts = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

function getSgdInvoicePaymentMethodsFromEnv() {
  const raw = normalizeText(process.env.XENDIT_SAAS_SGD_INVOICE_PAYMENT_METHODS);
  if (!raw) return null;
  if (raw === '__omit__' || raw === '-') {
    return [];
  }
  if (raw.startsWith('[')) {
    try {
      const j = JSON.parse(raw);
      if (!Array.isArray(j)) return null;
      return j.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      return null;
    }
  }
  const parts = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

/** Default true: Invoice payment_methods include B2B FPX so operators can choose business rails. Set XENDIT_SAAS_MYR_FPX_INCLUDE_B2B=0 to B2C-only. */
function myrFpxIncludeB2bFromEnv() {
  const v = normalizeText(process.env.XENDIT_SAAS_MYR_FPX_INCLUDE_B2B);
  if (v === '0' || /^false$/i.test(v)) return false;
  return true;
}

/** True when another MYR payment_methods strategy may succeed (vs currency/config errors). */
function shouldRetryMyrInvoicePaymentMethodError(message) {
  const s = String(message || '').toLowerCase();
  if (/currency\s+[a-z]{3}\s+is not configured/.test(s)) return false;
  return (
    /unsupported myr payment methods/.test(s) ||
    /unsupported sgd payment methods/.test(s) ||
    /did not match with the available/.test(s) ||
    /payment method choices/.test(s)
  );
}

/**
 * Xendit Invoice metadata: avoid key `client_id` — some API paths treat it like `customer_id` and reject
 * the request when combined with payer_email (implicit customer). Use `saas_operator_client_id` instead.
 */
function remapSaaSMetadataForXenditInvoice(meta) {
  const m = { ...(meta && typeof meta === 'object' ? meta : {}) };
  const opId = m.client_id != null ? String(m.client_id).trim() : '';
  if (opId) {
    m.saas_operator_client_id = opId;
    delete m.client_id;
  }
  return m;
}

/** Webhook / verification: Coliving operator id from invoice metadata (new + legacy). */
function saasOperatorClientIdFromMetadata(metadataObj) {
  return normalizeText(metadataObj.saas_operator_client_id || metadataObj.client_id);
}

const SAAS_INVOICE_PAYER_EMAIL_FALLBACK = 'saas-billing-noreply@colivingjb.com';

/**
 * Paid amount from Xendit callbacks: major units (MYR/SGD) or already smallest unit; align with log.payment major.
 */
function paidAmountToCentsForCompare(rawPaid, expectedMajorUnits) {
  const raw = Number(rawPaid);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  const exp = Number(expectedMajorUnits);
  if (!(exp > 0)) return Math.round(raw * 100);
  const expCents = Math.round(exp * 100);
  if (Math.abs(raw - exp) < 0.021) return Math.round(raw * 100);
  if (Math.abs(Math.round(raw) - expCents) <= 1) return Math.round(raw);
  return Math.round(raw * 100);
}

function getSaaSApiBase() {
  const u = normalizeText(
    process.env.SAAS_COLIVING_PUBLIC_API_BASE || process.env.API_BASE_URL || process.env.PUBLIC_APP_URL || ''
  ).replace(/\/$/, '');
  return u;
}

function isTruthySaasPlatformFlag(v) {
  if (v === true || v === 1) return true;
  const s = String(v || '').toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function verifySaaSPlatformCallbackToken(headerToken) {
  const expected = getExpectedSaaSPlatformCallbackToken();
  if (!expected) return { ok: false, reason: 'XENDIT_SAAS_PLATFORM_CALLBACK_TOKEN_NOT_SET' };
  const got = normalizeText(headerToken);
  if (!got || got !== expected) return { ok: false, reason: 'XENDIT_SAAS_CALLBACK_TOKEN_MISMATCH' };
  return { ok: true };
}

/**
 * Map Xendit POST /v2/invoices errors; detect "currency XXX is not configured" (merchant dashboard).
 */
function resultFromXenditInvoiceError(e, { currency, externalId }) {
  const rawMsg =
    e?.response?.data?.message ||
    (Array.isArray(e?.response?.data?.errors) ? e.response.data.errors[0]?.message : '') ||
    e?.message ||
    'XENDIT_INVOICE_FAILED';
  const s = String(rawMsg);
  console.error('[xendit-saas-platform] create invoice failed', {
    status: e?.response?.status,
    message: s,
    currency,
    externalId
  });
  const m = s.match(/currency\s+([A-Z]{3})\s+is not configured/i);
  if (m) {
    const code = m[1];
    return {
      ok: false,
      reason: 'XENDIT_CURRENCY_NOT_CONFIGURED',
      disabledCurrency: code,
      message:
        code === 'SGD'
          ? 'SGD is not enabled on this Xendit merchant yet. Ask Xendit to activate SGD for Invoice / cards. Malaysia-based accounts can still settle payouts in MYR; enable SGD only for customer charge currency.'
          : `${code} is not enabled on this Xendit merchant. Contact Xendit to activate this currency for Invoices.`
    };
  }
  return { ok: false, reason: 'XENDIT_INVOICE_FAILED', message: s.slice(0, 500) };
}

/** Payment Session POST /sessions errors (SGD hosted checkout — option 2). */
function resultFromXenditSessionError(e, { currency, externalId }) {
  const rawMsg =
    e?.response?.data?.message ||
    (Array.isArray(e?.response?.data?.errors) ? e.response.data.errors[0]?.message : '') ||
    e?.message ||
    'XENDIT_SESSION_FAILED';
  const s = String(rawMsg);
  console.error('[xendit-saas-platform] create payment session failed', {
    status: e?.response?.status,
    message: s,
    currency,
    externalId
  });
  const m = s.match(/currency\s+([A-Z]{3})\s+is not configured/i);
  if (m) {
    const code = m[1];
    return {
      ok: false,
      reason: 'XENDIT_CURRENCY_NOT_CONFIGURED',
      disabledCurrency: code,
      message:
        code === 'SGD'
          ? 'SGD is not enabled for Payment Sessions on this Xendit merchant yet. Ask Xendit to activate SGD for Sessions / cards. Malaysia-based accounts can still settle payouts in MYR; enable SGD only for customer charge currency.'
          : `${code} is not enabled on this Xendit merchant for Sessions. Contact Xendit.`
    };
  }
  const errCode = String(e?.response?.data?.error_code || '');
  if (errCode === 'INVALID_PAYMENT_CHANNEL' || /no available channels|not available\. please ensure that you have activated/i.test(s)) {
    return {
      ok: false,
      reason: 'XENDIT_SESSION_NO_CHANNELS',
      message:
        'Xendit has no usable channels for Payment Sessions in SGD (separate from Invoice channel settings). Ask Xendit to enable cards or other Session channels for this merchant. Do not set XENDIT_SAAS_SGD_SESSION_ALLOWED_CHANNELS until Session checkout works—that env only narrows channels already enabled; after that, optional ["CARDS"] limits the hosted page to cards.'
    };
  }
  return { ok: false, reason: 'XENDIT_SESSION_FAILED', message: s.slice(0, 500) };
}

/** POST /v3/payment_requests errors (SGD CARDS — optional path). */
function resultFromXenditPaymentRequestV3Error(e, { currency, externalId }) {
  const rawMsg =
    e?.response?.data?.message ||
    (Array.isArray(e?.response?.data?.errors) ? e.response.data.errors[0]?.message : '') ||
    e?.message ||
    'XENDIT_PAYMENT_REQUEST_V3_FAILED';
  const s = String(rawMsg);
  console.error('[xendit-saas-platform] create payment_request v3 failed', {
    status: e?.response?.status,
    message: s,
    currency,
    externalId,
    data: e?.response?.data
  });
  const m = s.match(/currency\s+([A-Z]{3})\s+is not configured/i);
  if (m) {
    const code = m[1];
    return {
      ok: false,
      reason: 'XENDIT_CURRENCY_NOT_CONFIGURED',
      disabledCurrency: code,
      message:
        code === 'SGD'
          ? 'SGD is not enabled for Payments API (v3 payment_requests) on this Xendit merchant. Ask Xendit to enable SGD + cards for SG.'
          : `${code} is not enabled for Payments API on this Xendit merchant. Contact Xendit.`
    };
  }
  return { ok: false, reason: 'XENDIT_PAYMENT_REQUEST_V3_FAILED', message: s.slice(0, 500) };
}

function buildSaaSSessionCustomer(email, referenceSuffix) {
  const raw = String(email || '').trim();
  const payerEmail = raw && raw.includes('@') ? raw.slice(0, 255) : SAAS_INVOICE_PAYER_EMAIL_FALLBACK;
  const local = payerEmail.split('@')[0] || 'Coliving';
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  const given = (parts[0] || 'Coliving').slice(0, 100);
  const surname = (parts.slice(1).join(' ') || 'User').slice(0, 100);
  return {
    reference_id: `saas-cust-${String(referenceSuffix).slice(0, 40)}`.slice(0, 64),
    type: 'INDIVIDUAL',
    email: payerEmail,
    mobile_number: '+6500000000',
    individual_detail: {
      given_names: given,
      surname: surname
    }
  };
}

/**
 * SGD SaaS checkout via Payment Session (hosted link), not Invoice v2 — avoids merchants where Invoice SGD is off.
 * @returns {Promise<{ ok: true, url: string, invoiceId: string, externalId: string, checkoutType: 'payment_session' }|object>}
 */
async function createSaaSPlatformPaymentSession(opts) {
  const platform = getPlatformXenditConfig();
  if (!platform?.secretKey) {
    return { ok: false, reason: 'SAAS_XENDIT_NOT_CONFIGURED' };
  }
  const apiBase = getSaaSApiBase();
  if (!apiBase) return { ok: false, reason: 'SAAS_PUBLIC_API_BASE_NOT_SET' };

  const currency = String(opts.currency || '').toUpperCase();
  if (currency !== 'SGD') {
    return { ok: false, reason: 'SESSION_CHECKOUT_EXPECTS_SGD' };
  }
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount < 0.01) {
    return { ok: false, reason: 'AMOUNT_TOO_SMALL' };
  }

  const auth = Buffer.from(`${platform.secretKey}:`).toString('base64');
  const ref = String(opts.externalId || '').trim().slice(0, 64);
  if (!ref) return { ok: false, reason: 'MISSING_EXTERNAL_ID' };

  const portalBase = apiBase.replace(/\/$/, '');
  const itemUrl =
    portalBase.startsWith('http') && portalBase.length <= 2000
      ? `${portalBase}/`
      : 'https://portal.colivingjb.com/';

  const metadata = remapSaaSMetadataForXenditInvoice({
    saas_platform: '1',
    ...(opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {})
  });

  const body = {
    reference_id: ref,
    session_type: 'PAY',
    mode: 'PAYMENT_LINK',
    amount,
    currency: 'SGD',
    country: 'SG',
    capture_method: 'AUTOMATIC',
    description: String(opts.description || 'Coliving SaaS').slice(0, 1000),
    customer: buildSaaSSessionCustomer(opts.email, ref),
    items: [
      {
        reference_id: `${ref}-i1`.slice(0, 255),
        name: String(opts.description || 'Coliving SaaS').slice(0, 255),
        type: 'DIGITAL_SERVICE',
        category: 'SOFTWARE',
        net_unit_amount: amount,
        quantity: 1,
        currency: 'SGD',
        url: itemUrl
      }
    ],
    locale: 'en',
    success_return_url: opts.returnUrl,
    cancel_return_url: opts.rejectUrl || opts.returnUrl,
    metadata
  };

  const chRaw = normalizeText(process.env.XENDIT_SAAS_SGD_SESSION_ALLOWED_CHANNELS);
  if (chRaw) {
    try {
      const parsed = JSON.parse(chRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        body.allowed_payment_channels = parsed;
      }
    } catch (_) {
      /* ignore invalid JSON */
    }
  }

  try {
    const { data } = await axios.post(`${XENDIT_API_BASE}/sessions`, body, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      timeout: 25000
    });
    const url = data?.payment_link_url;
    const psId = data?.payment_session_id != null ? String(data.payment_session_id) : '';
    if (!url || !psId) {
      return {
        ok: false,
        reason: 'XENDIT_SESSION_INCOMPLETE',
        message: 'Xendit did not return payment_link_url or payment_session_id'
      };
    }
    return {
      ok: true,
      url: String(url),
      invoiceId: psId,
      externalId: ref,
      checkoutType: 'payment_session'
    };
  } catch (e) {
    return resultFromXenditSessionError(e, { currency: 'SGD', externalId: ref });
  }
}

/**
 * SGD: Payments API v3 — POST /v3/payment_requests (CARDS, country SG). No card_details: expect REDIRECT_CUSTOMER in actions (hosted / 3DS).
 * Enable with XENDIT_SAAS_SGD_CHECKOUT_MODE=payment_request_v3. Optional sandbox: XENDIT_SAAS_SG_V3_MID_LABEL.
 * @returns {Promise<{ ok: true, url: string, invoiceId: string, externalId: string, checkoutType: 'payment_request_v3' }|object>}
 */
async function createSaaSPlatformPaymentRequestV3Sg(opts) {
  const platform = getPlatformXenditConfig();
  if (!platform?.secretKey) {
    return { ok: false, reason: 'SAAS_XENDIT_NOT_CONFIGURED' };
  }
  const apiBase = getSaaSApiBase();
  if (!apiBase) return { ok: false, reason: 'SAAS_PUBLIC_API_BASE_NOT_SET' };

  const currency = String(opts.currency || '').toUpperCase();
  if (currency !== 'SGD') {
    return { ok: false, reason: 'SESSION_CHECKOUT_EXPECTS_SGD' };
  }
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount < 0.01) {
    return { ok: false, reason: 'AMOUNT_TOO_SMALL' };
  }

  const auth = Buffer.from(`${platform.secretKey}:`).toString('base64');
  const ref = String(opts.externalId || '').trim().slice(0, 255);
  if (!ref) return { ok: false, reason: 'MISSING_EXTERNAL_ID' };

  const metadata = remapSaaSMetadataForXenditInvoice({
    saas_platform: '1',
    ...(opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {})
  });

  const channel_properties = {
    failure_return_url: opts.rejectUrl || opts.returnUrl,
    success_return_url: opts.returnUrl
  };
  const midLabel = normalizeText(process.env.XENDIT_SAAS_SG_V3_MID_LABEL);
  if (midLabel) {
    channel_properties.mid_label = midLabel;
  }

  const body = {
    reference_id: ref,
    type: 'PAY',
    country: 'SG',
    currency: 'SGD',
    request_amount: amount,
    capture_method: 'AUTOMATIC',
    channel_code: 'CARDS',
    channel_properties,
    description: String(opts.description || 'Coliving SaaS').slice(0, 1000),
    metadata
  };

  try {
    const { data } = await axios.post(`${XENDIT_API_BASE}/v3/payment_requests`, body, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        'api-version': XENDIT_PAYMENTS_API_VERSION
      },
      timeout: 25000
    });
    const actions = Array.isArray(data?.actions) ? data.actions : [];
    const redirect = actions.find((a) => String(a?.type || '').toUpperCase() === 'REDIRECT_CUSTOMER');
    const url = redirect?.value != null ? String(redirect.value).trim() : '';
    const prId = data?.payment_request_id != null ? String(data.payment_request_id).trim() : '';
    if (!url) {
      return {
        ok: false,
        reason: 'XENDIT_PR3_NO_REDIRECT',
        message:
          'Xendit v3 payment_request did not return REDIRECT_CUSTOMER (hosted checkout URL). Merchant may require card_details server-side, extra channel fields, or enable SG cards for Payments API. Check response in logs.'
      };
    }
    if (!prId) {
      return { ok: false, reason: 'XENDIT_PR3_INCOMPLETE', message: 'Xendit did not return payment_request_id' };
    }
    return {
      ok: true,
      url,
      invoiceId: prId,
      externalId: ref,
      checkoutType: 'payment_request_v3'
    };
  } catch (e) {
    return resultFromXenditPaymentRequestV3Error(e, { currency: 'SGD', externalId: ref });
  }
}

async function createLegacyInvoiceV2({ auth, callbackUrl, opts, amount, currency, metadata, paymentMethods }) {
  const payerRaw = String(opts.email || '').trim().slice(0, 255);
  const payerEmail = payerRaw && payerRaw.includes('@') ? payerRaw : SAAS_INVOICE_PAYER_EMAIL_FALLBACK;
  const body = {
    external_id: String(opts.externalId).slice(0, 255),
    amount,
    description: String(opts.description || 'Coliving SaaS').slice(0, 2000),
    currency,
    payer_email: payerEmail,
    success_redirect_url: opts.returnUrl,
    failure_redirect_url: opts.rejectUrl || opts.returnUrl,
    invoice_duration: 86400,
    callback_url: callbackUrl,
    metadata
  };
  if (Array.isArray(paymentMethods) && paymentMethods.length > 0) {
    body.payment_methods = paymentMethods;
  }
  const { data } = await axios.post(`${XENDIT_API_BASE}/v2/invoices`, body, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    timeout: 20000
  });
  if (!data?.invoice_url) throw new Error('Xendit v2 did not return invoice_url');
  return {
    ok: true,
    url: String(data.invoice_url),
    invoiceId: data.id != null ? String(data.id) : '',
    externalId: data.external_id != null ? String(data.external_id) : String(opts.externalId),
    checkoutType: 'invoice'
  };
}

/**
 * @param {{ externalId: string, amount: number, currency: string, email: string, returnUrl: string, rejectUrl?: string, description: string, metadata: object }} opts
 */
async function createSaasPlatformInvoice(opts) {
  const platform = getPlatformXenditConfig();
  if (!platform?.secretKey) {
    return { ok: false, reason: 'SAAS_XENDIT_NOT_CONFIGURED' };
  }
  const apiBase = getSaaSApiBase();
  if (!apiBase) return { ok: false, reason: 'SAAS_PUBLIC_API_BASE_NOT_SET' };

  const currency = String(opts.currency || '').toUpperCase();
  if (!['MYR', 'SGD'].includes(currency)) {
    return { ok: false, reason: 'UNSUPPORTED_CURRENCY' };
  }
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount < 1) {
    return { ok: false, reason: 'AMOUNT_TOO_SMALL' };
  }

  const auth = Buffer.from(`${platform.secretKey}:`).toString('base64');
  const callbackUrl = `${apiBase}/api/payex/callback`;
  const metadata = remapSaaSMetadataForXenditInvoice({
    saas_platform: '1',
    ...(opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {})
  });

  const tryLegacyInvoice = async (paymentMethods) => {
    try {
      return await createLegacyInvoiceV2({
        auth,
        callbackUrl,
        opts,
        amount,
        currency,
        metadata,
        paymentMethods
      });
    } catch (e) {
      return resultFromXenditInvoiceError(e, { currency, externalId: opts.externalId });
    }
  };

  if (currency === 'MYR') {
    const fromEnv = getMyrInvoicePaymentMethodsFromEnv();
    if (fromEnv && fromEnv.length) {
      return tryLegacyInvoice(fromEnv);
    }
    const includeB2b = myrFpxIncludeB2bFromEnv();
    const b2c = MYR_FPX_B2C_ALL;
    const b2b = includeB2b ? MYR_FPX_B2B_ALL : [];
    const merged = [...b2c, ...b2b];

    let res = await tryLegacyInvoice(merged);
    if (res.ok) return res;
    if (!shouldRetryMyrInvoicePaymentMethodError(res.message)) return res;

    res = await tryLegacyInvoice(b2c);
    if (res.ok) return res;
    if (!shouldRetryMyrInvoicePaymentMethodError(res.message)) return res;

    if (includeB2b && b2b.length) {
      res = await tryLegacyInvoice(b2b);
      if (res.ok) return res;
      if (!shouldRetryMyrInvoicePaymentMethodError(res.message)) return res;
    }

    let last = res;
    for (const code of MYR_FPX_TRY_SINGLE_ORDER) {
      const r = await tryLegacyInvoice([code]);
      if (r.ok) return r;
      last = r;
      if (!shouldRetryMyrInvoicePaymentMethodError(r.message)) return r;
    }
    return await tryLegacyInvoice(MYR_INVOICE_FPX_DIRECT_DEBIT);
  }

  /** SGD: Invoice v2 (default) or payment_session / payment_request_v3 via XENDIT_SAAS_SGD_CHECKOUT_MODE. */
  if (currency === 'SGD') {
    const mode = normalizeText(process.env.XENDIT_SAAS_SGD_CHECKOUT_MODE || 'invoice_v2').toLowerCase();
    if (mode === 'payment_session' || mode === 'session') {
      return createSaaSPlatformPaymentSession(opts);
    }
    if (mode === 'payment_request_v3' || mode === 'v3' || mode === 'pr3') {
      return createSaaSPlatformPaymentRequestV3Sg(opts);
    }

    const fromEnv = getSgdInvoicePaymentMethodsFromEnv();
    if (fromEnv && fromEnv.length > 0) {
      return tryLegacyInvoice(fromEnv);
    }
    if (Array.isArray(fromEnv) && fromEnv.length === 0) {
      return tryLegacyInvoice([]);
    }

    let res = await tryLegacyInvoice(['CREDIT_CARD']);
    if (res.ok) return res;
    if (!shouldRetryMyrInvoicePaymentMethodError(res.message)) return res;

    res = await tryLegacyInvoice([]);
    return res;
  }

  return { ok: false, reason: 'UNSUPPORTED_CURRENCY' };
}

async function createOperatorCreditTopupXendit({ creditLogId, returnUrl, email, amount, currency }) {
  const [rows] = await pool.query('SELECT client_id FROM creditlogs WHERE id = ? LIMIT 1', [creditLogId]);
  const clientId = rows?.[0]?.client_id ? String(rows[0].client_id) : '';
  if (!clientId) {
    return { ok: false, reason: 'CREDITLOG_CLIENT_MISSING' };
  }

  const inv = await createSaasPlatformInvoice({
    externalId: `saas-tp-${creditLogId}`,
    amount: Number(amount),
    currency,
    email,
    returnUrl,
    description: normalizeText('Coliving SaaS — Credit top-up').slice(0, 200),
    metadata: {
      type: 'Topup',
      creditlog_id: creditLogId,
      client_id: clientId
    }
  });
  if (!inv.ok) return inv;

  const isSession = inv.checkoutType === 'payment_session';
  const isPrV3 = inv.checkoutType === 'payment_request_v3';
  const co = isSession ? 'payment_session' : isPrV3 ? 'payment_request_v3' : 'invoice';
  const xid = inv.invoiceId || null;
  try {
    await pool.query(
      'UPDATE creditlogs SET payload = ? WHERE id = ?',
      [
        JSON.stringify({
          source: OPERATOR_PORTAL_XENDIT_SAAS_SOURCE,
          xendit_checkout: co,
          xendit_invoice_id: isPrV3 ? null : xid,
          xendit_payment_request_id: xid,
          xendit_payment_session_id: isSession ? xid : null,
          xendit_external_id: inv.externalId || null
        }),
        creditLogId
      ]
    );
  } catch (e) {
    console.warn('[xendit-saas-platform] creditlogs payload update failed', e?.message);
  }

  return { ok: true, url: inv.url, invoiceId: inv.invoiceId };
}

/**
 * Portal /enquiry：MYR（FPX）/ SGD（card）方案款，pricingplanlogs.scenario = SAAS_BILLPLZ（与 insertPendingPlanLogForSaasBillplz 配套）。
 */
async function createEnquiryPricingPlanXendit({
  pricingplanlogId,
  returnUrl,
  email,
  amount,
  currency,
  planTitle,
  clientId
}) {
  const inv = await createSaasPlatformInvoice({
    externalId: `saas-enq-${pricingplanlogId}`,
    amount: Number(amount),
    currency,
    email,
    returnUrl,
    description: normalizeText(`Coliving SaaS — ${planTitle || 'Plan'}`).slice(0, 200),
    metadata: {
      type: 'enquiry_pricingplan',
      pricingplanlog_id: pricingplanlogId,
      client_id: String(clientId || '').trim()
    }
  });
  if (!inv.ok) return inv;

  const isSession = inv.checkoutType === 'payment_session';
  const isPrV3 = inv.checkoutType === 'payment_request_v3';
  const co = isSession ? 'payment_session' : isPrV3 ? 'payment_request_v3' : 'invoice';
  const xid = inv.invoiceId || null;
  try {
    await pool.query(
      'UPDATE pricingplanlogs SET payload_json = ? WHERE id = ?',
      [
        JSON.stringify({
          source: SAAS_XENDIT_ENQUIRY_SOURCE,
          xendit_checkout: co,
          xendit_invoice_id: isPrV3 ? null : xid,
          xendit_payment_request_id: xid,
          xendit_payment_session_id: isSession ? xid : null,
          xendit_external_id: inv.externalId || null
        }),
        pricingplanlogId
      ]
    );
  } catch (e) {
    console.warn('[xendit-saas-platform] enquiry pricingplanlogs payload_json failed', e?.message);
  }

  return { ok: true, url: inv.url, invoiceId: inv.invoiceId };
}

async function createOperatorPricingPlanXendit({
  pricingplanlogId,
  returnUrl,
  email,
  amount,
  currency,
  planTitle
}) {
  const [rows] = await pool.query('SELECT client_id FROM pricingplanlogs WHERE id = ? LIMIT 1', [pricingplanlogId]);
  const clientId = rows?.[0]?.client_id ? String(rows[0].client_id) : '';
  if (!clientId) {
    return { ok: false, reason: 'PRICINGPLANLOG_CLIENT_MISSING' };
  }

  const inv = await createSaasPlatformInvoice({
    externalId: `saas-pp-${pricingplanlogId}`,
    amount: Number(amount),
    currency,
    email,
    returnUrl,
    description: normalizeText(`Coliving SaaS — ${planTitle || 'Plan'}`).slice(0, 200),
    metadata: {
      type: 'pricingplan',
      pricingplanlog_id: pricingplanlogId,
      client_id: clientId
    }
  });
  if (!inv.ok) return inv;

  const isSession = inv.checkoutType === 'payment_session';
  const isPrV3 = inv.checkoutType === 'payment_request_v3';
  const co = isSession ? 'payment_session' : isPrV3 ? 'payment_request_v3' : 'invoice';
  const xid = inv.invoiceId || null;
  try {
    await pool.query(
      'UPDATE pricingplanlogs SET payload_json = ? WHERE id = ?',
      [
        JSON.stringify({
          source: OPERATOR_PORTAL_XENDIT_SAAS_SOURCE,
          xendit_checkout: co,
          xendit_invoice_id: isPrV3 ? null : xid,
          xendit_payment_request_id: xid,
          xendit_payment_session_id: isSession ? xid : null,
          xendit_external_id: inv.externalId || null
        }),
        pricingplanlogId
      ]
    );
  } catch (e) {
    console.warn('[xendit-saas-platform] pricingplanlogs payload_json update failed', e?.message);
  }

  return { ok: true, url: inv.url, invoiceId: inv.invoiceId };
}

async function resolvePricingPlanLogIdFromXenditInvoiceId(invoiceId) {
  const id = normalizeText(invoiceId);
  if (!id) return '';
  const src = OPERATOR_PORTAL_XENDIT_SAAS_SOURCE;
  let [rows] = await pool.query(
    `SELECT id FROM pricingplanlogs
      WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.source')) = ?
        AND (
          JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.xendit_invoice_id')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.xendit_payment_request_id')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.xendit_payment_session_id')) = ?
        )
      ORDER BY created_at DESC LIMIT 1`,
    [src, id, id, id]
  );
  if (rows?.[0]?.id) return String(rows[0].id);
  const like = `%"xendit_invoice_id":"${id}"%`;
  [rows] = await pool.query(
    `SELECT id FROM pricingplanlogs WHERE payload_json LIKE ? AND payload_json LIKE ? ORDER BY created_at DESC LIMIT 1`,
    [like, '%operator_portal_xendit_saas%']
  );
  return rows?.[0]?.id ? String(rows[0].id) : '';
}

async function resolveCreditLogIdFromXenditInvoiceId(invoiceId) {
  const id = normalizeText(invoiceId);
  if (!id) return '';
  const src = OPERATOR_PORTAL_XENDIT_SAAS_SOURCE;
  let [rows] = await pool.query(
    `SELECT id FROM creditlogs
      WHERE type = 'Topup' AND (is_paid IS NULL OR is_paid = 0)
        AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.source')) = ?
        AND (
          JSON_UNQUOTE(JSON_EXTRACT(payload, '$.xendit_invoice_id')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.xendit_payment_request_id')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.xendit_payment_session_id')) = ?
        )
      ORDER BY created_at DESC LIMIT 1`,
    [src, id, id, id]
  );
  if (rows?.[0]?.id) return String(rows[0].id);
  const like = `%"xendit_invoice_id":"${id}"%`;
  [rows] = await pool.query(
    `SELECT id FROM creditlogs
      WHERE type = 'Topup' AND (is_paid IS NULL OR is_paid = 0)
        AND payload LIKE ? AND payload LIKE ?
      ORDER BY created_at DESC LIMIT 1`,
    [like, '%operator_portal_xendit_saas%']
  );
  return rows?.[0]?.id ? String(rows[0].id) : '';
}

async function resolveEnquiryPricingPlanLogIdFromXenditInvoiceId(invoiceId) {
  const id = normalizeText(invoiceId);
  if (!id) return '';
  const src = SAAS_XENDIT_ENQUIRY_SOURCE;
  let [rows] = await pool.query(
    `SELECT id FROM pricingplanlogs
      WHERE scenario = 'SAAS_BILLPLZ'
        AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.source')) = ?
        AND (
          JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.xendit_invoice_id')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.xendit_payment_request_id')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.xendit_payment_session_id')) = ?
        )
      ORDER BY created_at DESC LIMIT 1`,
    [src, id, id, id]
  );
  if (rows?.[0]?.id) return String(rows[0].id);
  const like = `%"xendit_invoice_id":"${id}"%`;
  [rows] = await pool.query(
    `SELECT id FROM pricingplanlogs
      WHERE scenario = 'SAAS_BILLPLZ' AND payload_json LIKE ? AND payload_json LIKE ?
      ORDER BY created_at DESC LIMIT 1`,
    [like, '%saas_xendit_enquiry%']
  );
  return rows?.[0]?.id ? String(rows[0].id) : '';
}

async function fetchXenditInvoiceV2ById(invoiceId) {
  const id = normalizeText(invoiceId);
  if (!id) return { ok: false, reason: 'MISSING_INVOICE_ID' };
  const platform = getPlatformXenditConfig();
  if (!platform?.secretKey) return { ok: false, reason: 'SAAS_XENDIT_NOT_CONFIGURED' };
  const auth = Buffer.from(`${platform.secretKey}:`).toString('base64');
  try {
    const { data } = await axios.get(`${XENDIT_API_BASE}/v2/invoices/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 15000
    });
    return { ok: true, data };
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'XENDIT_GET_INVOICE_FAILED';
    return { ok: false, reason: String(msg).slice(0, 200) };
  }
}

async function fetchXenditPaymentSessionById(sessionId) {
  const id = normalizeText(sessionId);
  if (!id) return { ok: false, reason: 'MISSING_SESSION_ID' };
  const platform = getPlatformXenditConfig();
  if (!platform?.secretKey) return { ok: false, reason: 'SAAS_XENDIT_NOT_CONFIGURED' };
  const auth = Buffer.from(`${platform.secretKey}:`).toString('base64');
  try {
    const { data } = await axios.get(`${XENDIT_API_BASE}/sessions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 15000
    });
    return { ok: true, data };
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'XENDIT_GET_SESSION_FAILED';
    return { ok: false, reason: String(msg).slice(0, 200) };
  }
}

async function fetchXenditPaymentRequestV3ById(paymentRequestId) {
  const id = normalizeText(paymentRequestId);
  if (!id) return { ok: false, reason: 'MISSING_PAYMENT_REQUEST_ID' };
  const platform = getPlatformXenditConfig();
  if (!platform?.secretKey) return { ok: false, reason: 'SAAS_XENDIT_NOT_CONFIGURED' };
  const auth = Buffer.from(`${platform.secretKey}:`).toString('base64');
  try {
    const { data } = await axios.get(`${XENDIT_API_BASE}/v3/payment_requests/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Basic ${auth}`,
        'api-version': XENDIT_PAYMENTS_API_VERSION
      },
      timeout: 15000
    });
    return { ok: true, data };
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'XENDIT_GET_PAYMENT_REQUEST_FAILED';
    return { ok: false, reason: String(msg).slice(0, 200) };
  }
}

function xenditCheckoutIdFromPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const explicitPs = normalizeText(p.xendit_payment_session_id);
  const co = normalizeText(p.xendit_checkout);
  const prOnly = normalizeText(p.xendit_payment_request_id);
  const invOrPr = normalizeText(p.xendit_invoice_id || p.xendit_payment_request_id);
  if (explicitPs) return { id: explicitPs, kind: 'payment_session' };
  if (co === 'payment_request_v3' && prOnly) return { id: prOnly, kind: 'payment_request_v3' };
  if (co === 'payment_request_v3' && invOrPr && /^pr-/i.test(invOrPr)) {
    return { id: invOrPr, kind: 'payment_request_v3' };
  }
  if (invOrPr && /^ps-/i.test(invOrPr)) return { id: invOrPr, kind: 'payment_session' };
  if (invOrPr) return { id: invOrPr, kind: 'invoice' };
  return { id: '', kind: '' };
}

/**
 * After user returns from Xendit success URL: poll invoice status and finalize top-up if PAID (webhook delayed/missed).
 */
async function syncSaasTopupFromXenditAfterReturn(email, creditLogId) {
  const id = normalizeText(creditLogId);
  if (!id) return { ok: false, reason: 'MISSING_CREDITLOG_ID' };
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };
  const clientId = ctx.client?.id != null ? String(ctx.client.id) : '';
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };

  const [logs] = await pool.query(
    `SELECT id, client_id, amount, payment, currency, is_paid, payload FROM creditlogs WHERE id = ? AND type = 'Topup' LIMIT 1`,
    [id]
  );
  if (!logs.length) return { ok: false, reason: 'CREDITLOG_NOT_FOUND' };
  const log = logs[0];
  if (String(log.client_id) !== clientId) return { ok: false, reason: 'CLIENT_MISMATCH' };
  if (log.is_paid === 1 || log.is_paid === true) {
    return { ok: true, paid: true, already: true, creditlog_id: id };
  }

  let payload = {};
  try {
    payload = typeof log.payload === 'string' ? JSON.parse(log.payload || '{}') : log.payload || {};
  } catch (_) {
    payload = {};
  }
  const checkout = xenditCheckoutIdFromPayload(payload);
  if (!checkout.id) return { ok: false, reason: 'NO_XENDIT_INVOICE_ON_LOG' };

  let d;
  let paidStatus;
  let rawPaid;
  let txnid;

  if (checkout.kind === 'payment_session') {
    const sess = await fetchXenditPaymentSessionById(checkout.id);
    if (!sess.ok) return { ok: false, reason: sess.reason || 'FETCH_SESSION_FAILED' };
    d = sess.data || {};
    paidStatus = String(d.status || '').toUpperCase();
    if (paidStatus !== 'COMPLETED') return { ok: true, paid: false, status: paidStatus };
    rawPaid = d.amount;
    txnid = normalizeText(d.payment_id || d.payment_session_id || checkout.id);
  } else if (checkout.kind === 'payment_request_v3') {
    const pr = await fetchXenditPaymentRequestV3ById(checkout.id);
    if (!pr.ok) return { ok: false, reason: pr.reason || 'FETCH_PAYMENT_REQUEST_FAILED' };
    d = pr.data || {};
    paidStatus = String(d.status || '').toUpperCase();
    if (paidStatus !== 'SUCCEEDED' && paidStatus !== 'COMPLETED') {
      return { ok: true, paid: false, status: paidStatus };
    }
    rawPaid = d.request_amount != null ? d.request_amount : d.amount;
    txnid = normalizeText(d.payment_id || d.payment_request_id || checkout.id);
  } else {
    const inv = await fetchXenditInvoiceV2ById(checkout.id);
    if (!inv.ok) return { ok: false, reason: inv.reason || 'FETCH_INVOICE_FAILED' };
    d = inv.data || {};
    paidStatus = String(d.status || '').toUpperCase();
    if (paidStatus !== 'PAID') return { ok: true, paid: false, status: paidStatus };
    rawPaid = d.paid_amount ?? d.paidAmount ?? d.amount;
    txnid = normalizeText(d.id || checkout.id);
  }

  const expectedCents = Math.round(Number(log.payment || 0) * 100);
  const amountPaidCents = paidAmountToCentsForCompare(rawPaid, log.payment);
  if (expectedCents > 0 && amountPaidCents > 0 && Math.abs(amountPaidCents - expectedCents) > 1) {
    console.warn('[xendit-saas-platform] sync topup amount mismatch', id, expectedCents, amountPaidCents);
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }

  const r = await applyOperatorCreditTopupPaid({
    creditlogId: id,
    txnid,
    payloadStorable: { xendit: d, synced_from_return_url: true, xendit_checkout: checkout.kind },
    paymentMethodLabel: 'Xendit',
    amountCentsForBukku: amountPaidCents || expectedCents
  });
  return { ok: !!r.ok, paid: true, creditlog_id: id, ...r };
}

/**
 * After Xendit redirect: poll invoice PAID and finalize plan + creditlog + Bukku if webhook was late/missed.
 */
async function syncSaasPricingPlanFromXenditAfterReturn(email, pricingplanlogId) {
  const id = normalizeText(pricingplanlogId);
  if (!id) return { ok: false, reason: 'MISSING_PRICINGPLANLOG_ID' };
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };
  const clientId = ctx.client?.id != null ? String(ctx.client.id) : '';
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };

  const [logs] = await pool.query(
    `SELECT id, client_id, status, amount, payload_json FROM pricingplanlogs WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!logs.length) return { ok: false, reason: 'LOG_NOT_FOUND' };
  const log = logs[0];
  if (String(log.client_id) !== clientId) return { ok: false, reason: 'CLIENT_MISMATCH' };
  if (String(log.status || '').toLowerCase() === 'paid') {
    return { ok: true, paid: true, already: true, pricingplanlogId: id };
  }

  let payload = {};
  try {
    const raw = log.payload_json;
    payload = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
  } catch (_) {
    payload = {};
  }
  const checkout = xenditCheckoutIdFromPayload(payload);
  if (!checkout.id) return { ok: false, reason: 'NO_XENDIT_INVOICE_ON_LOG' };

  let d;
  let st;
  let rawPaid;
  if (checkout.kind === 'payment_session') {
    const sess = await fetchXenditPaymentSessionById(checkout.id);
    if (!sess.ok) return { ok: false, reason: sess.reason || 'FETCH_SESSION_FAILED' };
    d = sess.data || {};
    st = String(d.status || '').toUpperCase();
    if (st !== 'COMPLETED') return { ok: true, paid: false, status: st };
    rawPaid = d.amount;
  } else if (checkout.kind === 'payment_request_v3') {
    const pr = await fetchXenditPaymentRequestV3ById(checkout.id);
    if (!pr.ok) return { ok: false, reason: pr.reason || 'FETCH_PAYMENT_REQUEST_FAILED' };
    d = pr.data || {};
    st = String(d.status || '').toUpperCase();
    if (st !== 'SUCCEEDED' && st !== 'COMPLETED') return { ok: true, paid: false, status: st };
    rawPaid = d.request_amount != null ? d.request_amount : d.amount;
  } else {
    const inv = await fetchXenditInvoiceV2ById(checkout.id);
    if (!inv.ok) return { ok: false, reason: inv.reason || 'FETCH_INVOICE_FAILED' };
    d = inv.data || {};
    st = String(d.status || '').toUpperCase();
    if (st !== 'PAID') return { ok: true, paid: false, status: st };
    rawPaid = d.paid_amount ?? d.paidAmount ?? d.amount;
  }

  const expectedCents = Math.round(Number(log.amount || 0) * 100);
  const amountPaidCents = paidAmountToCentsForCompare(rawPaid, log.amount);
  if (expectedCents > 0 && amountPaidCents > 0 && Math.abs(amountPaidCents - expectedCents) > 1) {
    console.warn('[xendit-saas-platform] sync plan amount mismatch', id, expectedCents, amountPaidCents);
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }

  const planResult = await handlePricingPlanPaymentSuccess({ pricingplanlogId: id, clientId });
  if (!planResult.ok) return { ok: false, reason: planResult.reason || 'APPLY_PLAN_FAILED' };
  try {
    await saasBukkuInvoiceForPricingPlan(id, clientId, 'Xendit');
  } catch (bukkuErr) {
    console.warn('[xendit-saas-platform] plan Bukku after sync failed', bukkuErr?.message || bukkuErr);
  }
  return { ok: true, paid: true, pricingplanlogId: id };
}

/**
 * Portal /enquiry：JWT 邮箱与 operatordetail 对齐即可（尚无 client_user / staffdetail 时 getAccessContextByEmail 会失败）。
 * 支付回跳后轮询 Xendit PAID，再与 webhook 相同路径 finalizeSaasPlanAfterBillplzPayment。
 */
async function syncEnquiryPricingPlanFromXenditAfterReturn(portalEmail, pricingplanlogId) {
  const normalizedEmail = normalizeEmail(portalEmail);
  if (!normalizedEmail) return { ok: false, reason: 'NO_EMAIL' };
  const id = normalizeText(pricingplanlogId);
  if (!id) return { ok: false, reason: 'MISSING_PRICINGPLANLOG_ID' };

  const [logs] = await pool.query(
    `SELECT p.id, p.client_id, p.status, p.amount, p.payload_json, p.scenario,
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
  if (String(log.status || '').toLowerCase() === 'paid') {
    return { ok: true, paid: true, already: true, pricingplanlogId: id };
  }

  let payload = {};
  try {
    const raw = log.payload_json;
    payload = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
  } catch (_) {
    payload = {};
  }
  const checkout = xenditCheckoutIdFromPayload(payload);
  if (!checkout.id) return { ok: false, reason: 'NO_XENDIT_INVOICE_ON_LOG' };

  let d;
  let st;
  let rawPaid;
  if (checkout.kind === 'payment_session') {
    const sess = await fetchXenditPaymentSessionById(checkout.id);
    if (!sess.ok) return { ok: false, reason: sess.reason || 'FETCH_SESSION_FAILED' };
    d = sess.data || {};
    st = String(d.status || '').toUpperCase();
    if (st !== 'COMPLETED') return { ok: true, paid: false, status: st };
    rawPaid = d.amount;
  } else if (checkout.kind === 'payment_request_v3') {
    const pr = await fetchXenditPaymentRequestV3ById(checkout.id);
    if (!pr.ok) return { ok: false, reason: pr.reason || 'FETCH_PAYMENT_REQUEST_FAILED' };
    d = pr.data || {};
    st = String(d.status || '').toUpperCase();
    if (st !== 'SUCCEEDED' && st !== 'COMPLETED') return { ok: true, paid: false, status: st };
    rawPaid = d.request_amount != null ? d.request_amount : d.amount;
  } else {
    const inv = await fetchXenditInvoiceV2ById(checkout.id);
    if (!inv.ok) return { ok: false, reason: inv.reason || 'FETCH_INVOICE_FAILED' };
    d = inv.data || {};
    st = String(d.status || '').toUpperCase();
    if (st !== 'PAID') return { ok: true, paid: false, status: st };
    rawPaid = d.paid_amount ?? d.paidAmount ?? d.amount;
  }

  const expectedCents = Math.round(Number(log.amount || 0) * 100);
  const amountPaidCents = paidAmountToCentsForCompare(rawPaid, log.amount);
  if (expectedCents > 0 && amountPaidCents > 0 && Math.abs(amountPaidCents - expectedCents) > 1) {
    console.warn('[xendit-saas-platform] enquiry sync amount mismatch', id, expectedCents, amountPaidCents);
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }

  const paidDateStr = getTodayMalaysiaDate();
  const fin = await finalizeSaasPlanAfterBillplzPayment({
    pricingplanlogId: id,
    paidDateStr,
    paymentMethodLabel: 'Xendit'
  });
  return {
    ok: fin.ok !== false,
    paid: true,
    pricingplanlogId: id,
    finalize: fin
  };
}

/**
 * Xendit invoice webhook: SaaS platform flows only. Caller must verify callback token.
 * @returns {Promise<{ handled: boolean, result?: object }>}
 */
async function tryHandleSaaSPlatformInvoiceCallback(data, metadataObj) {
  const payload = data?.data && typeof data.data === 'object' ? data.data : data;
  const extFromPayload = normalizeText(
    payload?.external_id ??
      payload?.externalId ??
      payload?.reference_id ??
      data?.reference_id ??
      data?.external_id ??
      ''
  );
  let meta = { ...(metadataObj && typeof metadataObj === 'object' ? metadataObj : {}) };
  if (extFromPayload && /^saas-tp-/i.test(extFromPayload)) {
    if (!isTruthySaasPlatformFlag(meta.saas_platform)) meta.saas_platform = '1';
    if (!meta.type) meta.type = 'Topup';
    if (!meta.creditlog_id) meta.creditlog_id = extFromPayload.replace(/^saas-tp-/i, '');
  }
  if (extFromPayload && /^saas-pp-/i.test(extFromPayload)) {
    if (!isTruthySaasPlatformFlag(meta.saas_platform)) meta.saas_platform = '1';
    if (!meta.type) meta.type = 'pricingplan';
    if (!meta.pricingplanlog_id) meta.pricingplanlog_id = extFromPayload.replace(/^saas-pp-/i, '');
  }
  if (extFromPayload && /^saas-enq-/i.test(extFromPayload)) {
    if (!isTruthySaasPlatformFlag(meta.saas_platform)) meta.saas_platform = '1';
    if (!meta.type) meta.type = 'enquiry_pricingplan';
    if (!meta.pricingplanlog_id) meta.pricingplanlog_id = extFromPayload.replace(/^saas-enq-/i, '');
  }
  if (!isTruthySaasPlatformFlag(meta.saas_platform)) {
    return { handled: false };
  }

  const status = (payload?.status ?? data?.status ?? data?.normalizedStatus ?? '').toString().toUpperCase();
  const isSuccess = status === 'PAID' || status === 'SUCCEEDED' || status === 'SUCCESS' || status === 'COMPLETED';
  const referenceId = payload?.reference_id ?? payload?.external_id ?? payload?.externalId ?? '';
  const rawPaid = payload?.paid_amount ?? payload?.paidAmount ?? payload?.request_amount ?? payload?.amount;
  const paymentSessionId = normalizeText(payload?.payment_session_id ?? payload?.paymentSessionId ?? '');
  const paymentRequestId = normalizeText(payload?.payment_request_id || payload?.invoice_id || '');
  const fallbackId = normalizeText(payload?.id || '');
  const lookupInvoiceOrSessionId =
    paymentSessionId ||
    (fallbackId && /^ps-/i.test(fallbackId) ? fallbackId : '') ||
    paymentRequestId ||
    fallbackId;
  const txnid = normalizeText(payload?.payment_id || lookupInvoiceOrSessionId || referenceId) || 'xendit';

  const type = String(meta.type || '').toLowerCase();
  if (type === 'topup' || type === 'credit_topup') {
    let creditlogId = normalizeText(meta.creditlog_id);
    if (!creditlogId) {
      const ref = String(referenceId || extFromPayload || '').trim();
      const m = ref.match(/^saas-tp-(.+)$/i);
      if (m) creditlogId = m[1].trim();
    }
    const clientIdMeta = saasOperatorClientIdFromMetadata(meta);
    if (!creditlogId && lookupInvoiceOrSessionId) {
      creditlogId = await resolveCreditLogIdFromXenditInvoiceId(lookupInvoiceOrSessionId);
    }
    if (!creditlogId) {
      return { handled: true, result: { success: false, error: 'MISSING_CREDITLOG_ID' } };
    }

    if (!isSuccess) {
      return { handled: true, result: { success: true, paid: false, type: 'saas_topup' } };
    }

    const [rows] = await pool.query(
      `SELECT id, client_id, amount, payment, currency FROM creditlogs WHERE id = ? AND type = 'Topup' AND (is_paid IS NULL OR is_paid = 0) LIMIT 1`,
      [creditlogId]
    );
    if (!rows.length) {
      const [paid] = await pool.query(
        `SELECT id FROM creditlogs WHERE id = ? AND type = 'Topup' AND is_paid = 1 LIMIT 1`,
        [creditlogId]
      );
      if (paid.length) {
        return { handled: true, result: { success: true, type: 'saas_topup', creditlogId, already: true } };
      }
      return { handled: true, result: { success: false, error: 'CREDITLOG_NOT_FOUND' } };
    }
    const log = rows[0];
    if (clientIdMeta && normalizeText(log.client_id) !== clientIdMeta) {
      return { handled: true, result: { success: false, error: 'CLIENT_MISMATCH' } };
    }
    const expectedCents = Math.round(Number(log.payment || 0) * 100);
    const amountPaidCents = paidAmountToCentsForCompare(rawPaid, log.payment);
    if (expectedCents > 0 && amountPaidCents > 0 && Math.abs(amountPaidCents - expectedCents) > 1) {
      console.warn('[xendit-saas-platform] topup amount mismatch', creditlogId, expectedCents, amountPaidCents);
      return { handled: true, result: { success: false, error: 'AMOUNT_MISMATCH' } };
    }

    const r = await applyOperatorCreditTopupPaid({
      creditlogId,
      txnid,
      payloadStorable: { xendit: payload },
      paymentMethodLabel: 'Xendit',
      amountCentsForBukku: amountPaidCents || expectedCents
    });
    return { handled: true, result: { success: !!r.ok, ...r } };
  }

  if (type === 'enquiry_pricingplan') {
    let logId = normalizeText(meta.pricingplanlog_id);
    const clientIdMeta = saasOperatorClientIdFromMetadata(meta);
    if (!logId && lookupInvoiceOrSessionId) {
      logId = await resolveEnquiryPricingPlanLogIdFromXenditInvoiceId(lookupInvoiceOrSessionId);
    }
    if (!logId) {
      return { handled: true, result: { success: false, error: 'MISSING_PRICINGPLANLOG_ID' } };
    }

    if (!isSuccess) {
      return { handled: true, result: { success: true, paid: false, type: 'saas_enquiry_pricingplan' } };
    }

    const [logRows] = await pool.query(
      `SELECT id, client_id, plan_id, amount, status, scenario FROM pricingplanlogs WHERE id = ? LIMIT 1`,
      [logId]
    );
    if (!logRows.length) {
      return { handled: true, result: { success: false, error: 'LOG_NOT_FOUND' } };
    }
    const log = logRows[0];
    if (normalizeText(log.scenario) !== 'SAAS_BILLPLZ') {
      return { handled: true, result: { success: false, error: 'NOT_SAAS_ENQUIRY_LOG' } };
    }
    if (clientIdMeta && normalizeText(log.client_id) !== clientIdMeta) {
      return { handled: true, result: { success: false, error: 'CLIENT_MISMATCH' } };
    }
    const expectedCents = Math.round(Number(log.amount || 0) * 100);
    const paidCents = paidAmountToCentsForCompare(rawPaid, log.amount);
    if (expectedCents > 0 && paidCents > 0 && Math.abs(paidCents - expectedCents) > 1) {
      console.warn('[xendit-saas-platform] enquiry plan amount mismatch', logId, expectedCents, paidCents);
      return { handled: true, result: { success: false, error: 'AMOUNT_MISMATCH' } };
    }
    if (log.status === 'paid') {
      return { handled: true, result: { success: true, paid: true, already: true, pricingplanlogId: logId } };
    }

    const paidDateStr = getTodayMalaysiaDate();
    const fin = await finalizeSaasPlanAfterBillplzPayment({
      pricingplanlogId: logId,
      paidDateStr,
      paymentMethodLabel: 'Xendit'
    });
    return {
      handled: true,
      result: { success: fin.ok !== false, paid: true, type: 'saas_enquiry_pricingplan', pricingplanlogId: logId, finalize: fin }
    };
  }

  if (type === 'pricingplan') {
    let logId = normalizeText(meta.pricingplanlog_id);
    const clientIdMeta = saasOperatorClientIdFromMetadata(meta);
    if (!logId) {
      const ref = String(referenceId || extFromPayload || '').trim();
      const m = ref.match(/^saas-pp-(.+)$/i);
      if (m) logId = m[1].trim();
    }
    if (!logId && lookupInvoiceOrSessionId) {
      logId = await resolvePricingPlanLogIdFromXenditInvoiceId(lookupInvoiceOrSessionId);
    }
    if (!logId) {
      return { handled: true, result: { success: false, error: 'MISSING_PRICINGPLANLOG_ID' } };
    }

    if (!isSuccess) {
      return { handled: true, result: { success: true, paid: false, type: 'saas_pricingplan' } };
    }

    const [logRows] = await pool.query(
      `SELECT id, client_id, plan_id, amount, status, scenario FROM pricingplanlogs WHERE id = ? LIMIT 1`,
      [logId]
    );
    if (!logRows.length) {
      return { handled: true, result: { success: false, error: 'LOG_NOT_FOUND' } };
    }
    const log = logRows[0];
    if (normalizeText(log.scenario) === 'SAAS_BILLPLZ') {
      return { handled: true, result: { success: false, error: 'USE_ENQUIRY_WEBHOOK_PATH' } };
    }
    if (clientIdMeta && normalizeText(log.client_id) !== clientIdMeta) {
      return { handled: true, result: { success: false, error: 'CLIENT_MISMATCH' } };
    }
    const expectedCents = Math.round(Number(log.amount || 0) * 100);
    const paidCentsPlan = paidAmountToCentsForCompare(rawPaid, log.amount);
    if (expectedCents > 0 && paidCentsPlan > 0 && Math.abs(paidCentsPlan - expectedCents) > 1) {
      console.warn('[xendit-saas-platform] plan amount mismatch', logId, expectedCents, paidCentsPlan);
      return { handled: true, result: { success: false, error: 'AMOUNT_MISMATCH' } };
    }
    if (log.status === 'paid') {
      return { handled: true, result: { success: true, paid: true, already: true, pricingplanlogId: logId } };
    }

    const clientId = log.client_id;
    const planResult = await handlePricingPlanPaymentSuccess({ pricingplanlogId: logId, clientId });
    if (!planResult.ok) {
      return { handled: true, result: { success: false, ...planResult } };
    }
    if (planResult.already) {
      return { handled: true, result: { success: true, paid: true, already: true, pricingplanlogId: logId } };
    }

    try {
      await saasBukkuInvoiceForPricingPlan(logId, clientId, 'Xendit');
    } catch (bukkuErr) {
      console.warn('[xendit-saas-platform] pricing plan Bukku failed', bukkuErr?.message || bukkuErr);
    }

    return {
      handled: true,
      result: { success: true, type: 'saas_pricingplan', pricingplanlogId: logId }
    };
  }

  return { handled: true, result: { success: false, error: 'UNKNOWN_SAAS_TYPE' } };
}

module.exports = {
  createSaasPlatformInvoice,
  createOperatorCreditTopupXendit,
  createOperatorPricingPlanXendit,
  createEnquiryPricingPlanXendit,
  verifySaaSPlatformCallbackToken,
  tryHandleSaaSPlatformInvoiceCallback,
  getExpectedSaaSPlatformCallbackToken,
  syncSaasTopupFromXenditAfterReturn,
  syncSaasPricingPlanFromXenditAfterReturn,
  syncEnquiryPricingPlanFromXenditAfterReturn,
  fetchXenditInvoiceV2ById,
  fetchXenditPaymentSessionById,
  fetchXenditPaymentRequestV3ById
};
