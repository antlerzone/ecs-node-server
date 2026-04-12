/**
 * Company Setting API – for Wix companysetting page.
 * All endpoints accept email (body or query) and resolve access via getAccessContextByEmail.
 */

const express = require('express');
const router = express.Router();
const companysettingService = require('./companysetting.service');
const {
  getStaffList,
  createStaff,
  updateStaff,
  deleteStaff,
  updateOperatorProfilePhoto,
  getIntegrationTemplate,
  getProfile,
  updateProfile,
  getPaynowQrLog,
  getBanks,
  getOperatorBankDetails,
  saveOperatorBankDetails,
  getAdmin,
  saveAdmin,
  getDirectPaymentGatewayStatus,
  saveDirectStripePaymentGateway,
  triggerDirectStripeWebhookTest,
  saveDirectPayexPaymentGateway,
  saveDirectBillplzPaymentGateway,
  getOnboardStatus,
  getAiProviderConfig,
  saveAiProviderConfig,
  paymentVerificationListInvoices,
  paymentVerificationGetInvoice,
  paymentVerificationApprove,
  paymentVerificationReject,
  getFinverseLinkUrl,
  stripeDisconnect,
  getStripeConnectOnboardUrl,
  stripeConnectOAuthComplete,
  stripeConnectOAuthCompleteByState,
  cnyiotConnect,
  cnyiotDisconnect,
  getCnyiotCredentials,
  getCnyiotUsers,
  createCnyiotUser,
  getTtlockCredentials,
  bukkuConnect,
  payexConnect,
  payexDisconnect,
  billplzDisconnect,
  setSgTenantPaymentMode,
  xenditCreateSubAccount,
  getBukkuCredentials,
  bukkuDisconnect,
  updateAccountingEinvoice,
  xeroConnect,
  getXeroAuthUrl,
  xeroDisconnect,
  ttlockConnect,
  ttlockDisconnect,
  getEmail
} = companysettingService;
const getPayexCredentials = companysettingService.getPayexCredentials;
const googleDriveOauth = require('./google-drive-oauth.service');
const colivingCleanlemonsLink = require('../coliving-cleanlemons/coliving-cleanlemons-link.service');

// Reasons that should return 200 + ok:false so Wix JSW does not throw (avoids "Unable to handle the request")
const COMPANYSETTING_CLIENT_ERRORS = [
  'ACCESS_DENIED', 'NO_CLIENT_ID', 'NO_PERMISSION', 'CLIENT_INACTIVE', 'STAFF_INACTIVE', 'NO_STAFF',
  'NO_STAFF_FOR_CLIENT',
  'STAFF_NOT_FOUND', 'CLIENT_NOT_FOUND',
  'MAIN_ACCOUNT_CANNOT_EDIT',
  'MAIN_ACCOUNT_CANNOT_DELETE',
  'CANNOT_DELETE_SELF',
  'NO_ACCOUNT',
  'EMAIL_ALREADY_BOUND_TO_ANOTHER_COMPANY', 'EMAIL_ALREADY_ADDED',
  'XENDIT_PLATFORM_NOT_CONFIGURED', 'XENDIT_MALAYSIA_ONLY', 'CLIENT_EMAIL_REQUIRED', 'XENDIT_ONE_SUB_ACCOUNT_ONLY',
  'ONLY_SGD_SUPPORTED', 'INVALID_PAYMENT_MODE', 'BILLPLZ_MYR_ONLY',
  'NO_ACCOUNT', 'SAVE_FAILED',
  'PROFILEPHOTO_MIGRATION_REQUIRED',
  'GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED',
  'GOOGLE_DRIVE_OAUTH_TOKEN_SECRET_NOT_SET',
  'GOOGLE_DRIVE_OAUTH_REDIRECT_NOT_CONFIGURED',
  'GOOGLE_DRIVE_OAUTH_STATE_OR_TOKEN_SECRET_NOT_SET',
  'STATE_SIGN_FAILED',
  'ACCOUNTING_METHOD_REQUIRED',
  'ACCOUNTING_PAYMENT_DATE_REQUIRED'
];

function withEmail(req, res, handler) {
  const email = getEmail(req);
  if (!email || !String(email).trim()) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  handler(email).then(result => res.json(result)).catch(err => {
    const msg = err?.message || 'BACKEND_ERROR';
    if (COMPANYSETTING_CLIENT_ERRORS.includes(msg)) {
      return res.status(200).json({ ok: false, reason: msg });
    }
    console.error('[companysetting]', err);
    res.status(500).json({ ok: false, reason: msg });
  });
}

function getClientId(req) {
  return req?.body?.clientId ?? req?.query?.clientId ?? null;
}

function sanitizeRedirectUriForXero(raw) {
  const input = raw != null ? String(raw).trim() : '';
  if (!input) return '';
  try {
    const u = new URL(input);
    // Xero callback URI must match exactly; drop runtime OAuth params from current page URL.
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return input;
  }
}
router.get('/staff-list', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getStaffList(email, clientId));
});
router.post('/staff-list', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getStaffList(email, clientId));
});

router.post('/staff-create', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  createStaff(email, req.body || {}).then(r => res.json(r)).catch(err => {
    const reason = err?.message || 'BACKEND_ERROR';
    if (reason === 'STAFF_LIMIT_REACHED') {
      return res.status(403).json({ ok: false, reason: 'STAFF_LIMIT_REACHED', message: 'Staff account limit reached (plan + addon)' });
    }
    if (COMPANYSETTING_CLIENT_ERRORS.includes(reason)) {
      return res.status(200).json({ ok: false, reason });
    }
    console.error('[companysetting] staff-create', err);
    res.status(500).json({ ok: false, reason });
  });
});

/** Personal operator avatar (separate from company logo on operatordetail.profilephoto). */
router.post('/operator-profile-photo', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const profilephoto = req.body?.profilephoto;
  const clientId = getClientId(req);
  updateOperatorProfilePhoto(email, profilephoto, clientId)
    .then((r) => res.json(r))
    .catch((err) => {
      const reason = err?.message || 'BACKEND_ERROR';
      if (COMPANYSETTING_CLIENT_ERRORS.includes(reason)) {
        return res.status(200).json({ ok: false, reason });
      }
      console.error('[companysetting] operator-profile-photo', err);
      res.status(500).json({ ok: false, reason });
    });
});

router.post('/staff-update', (req, res) => {
  const email = getEmail(req);
  const staffId = req.body?.staffId ?? req.body?.id;
  if (!email || !staffId) return res.status(400).json({ ok: false, reason: 'NO_EMAIL_OR_STAFF_ID' });
  updateStaff(email, staffId, req.body || {}).then(r => res.json(r)).catch(err => {
    const reason = err?.message || 'BACKEND_ERROR';
    if (COMPANYSETTING_CLIENT_ERRORS.includes(reason)) {
      return res.status(200).json({ ok: false, reason });
    }
    console.error('[companysetting] staff-update', err);
    res.status(500).json({ ok: false, reason });
  });
});

router.post('/staff-delete', (req, res) => {
  const email = getEmail(req);
  const staffId = req.body?.staffId ?? req.body?.id;
  if (!email || !staffId) return res.status(400).json({ ok: false, reason: 'NO_EMAIL_OR_STAFF_ID' });
  const clientId = getClientId(req);
  deleteStaff(email, staffId, clientId).then(r => res.json(r)).catch(err => {
    const reason = err?.message || 'BACKEND_ERROR';
    if (COMPANYSETTING_CLIENT_ERRORS.includes(reason)) {
      return res.status(200).json({ ok: false, reason });
    }
    console.error('[companysetting] staff-delete', err);
    res.status(500).json({ ok: false, reason });
  });
});

router.get('/integration-template', (req, res) => {
  res.json({ ok: true, items: getIntegrationTemplate() });
});
router.post('/integration-template', (req, res) => {
  res.json({ ok: true, items: getIntegrationTemplate() });
});

router.get('/profile', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getProfile(email, clientId));
});
router.post('/profile', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getProfile(email, clientId));
});

router.post('/profile-update', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const clientId = getClientId(req);
  updateProfile(email, req.body || {}, clientId).then(r => res.json(r)).catch(err => {
    console.error('[companysetting] profile-update', err);
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  });
});

router.post('/paynow-qr-log', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getPaynowQrLog(email, clientId));
});

function handleBanks(req, res) {
  getBanks()
    .then((result) => res.json(result))
    .catch((err) => {
      console.warn('[companysetting] banks', err?.message || err);
      res.status(200).json({ ok: true, items: [] });
    });
}
router.get('/banks', handleBanks);
router.post('/banks', handleBanks);

router.post('/operator-bank', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getOperatorBankDetails(email, clientId));
});

router.post('/operator-bank-save', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const clientId = getClientId(req);
  const body = req.body || {};
  saveOperatorBankDetails(
    email,
    { bankId: body.bankId, bankaccount: body.bankaccount, accountholder: body.accountholder },
    clientId
  )
    .then((r) => res.json(r))
    .catch((err) => {
      const reason = err?.message || 'BACKEND_ERROR';
      if (COMPANYSETTING_CLIENT_ERRORS.includes(reason)) {
        return res.status(200).json({ ok: false, reason });
      }
      console.error('[companysetting] operator-bank-save', err);
      res.status(500).json({ ok: false, reason });
    });
});

router.get('/admin', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getAdmin(email, clientId));
});
router.post('/admin', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getAdmin(email, clientId));
});

router.post('/admin-save', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const clientId = getClientId(req);
  saveAdmin(email, req.body?.admin ?? req.body, clientId).then(r => res.json(r)).catch(err => {
    console.error('[companysetting] admin-save', err);
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  });
});

router.post('/onboard-status', (req, res) => {
  const email = getEmail(req);
  if (email) console.log('[onboard] onboard-status email=%s', email);
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getOnboardStatus(email, clientId));
});

router.post('/payment-gateway/direct-status', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getDirectPaymentGatewayStatus(email, clientId));
});

router.get('/ai-provider', (req, res) => {
  withEmail(req, res, (email) => getAiProviderConfig(email));
});
router.post('/ai-provider', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const body = req.body || {};
  const isSaveRequest = ['provider', 'api_key', 'apiKey', 'model', 'ai_model', 'aiModel']
    .some((k) => Object.prototype.hasOwnProperty.call(body, k));
  if (!isSaveRequest) {
    console.log('[companysetting] ai-provider read via POST email=%s bodyKeys=%s', email, Object.keys(body).join(','));
    return getAiProviderConfig(email)
      .then((r) => res.json(r))
      .catch((err) => {
        const reason = err?.message || 'BACKEND_ERROR';
        console.error('[companysetting] ai-provider read-via-post', err);
        res.status(500).json({ ok: false, reason });
      });
  }
  const providerPreview = body?.provider != null ? String(body.provider) : '';
  const apiKeyRaw = body?.api_key ?? body?.apiKey ?? '';
  const apiKeyLen = apiKeyRaw ? String(apiKeyRaw).trim().length : 0;
  console.log('[companysetting] ai-provider save request email=%s provider=%s hasApiKey=%s apiKeyLen=%s bodyKeys=%s', email, providerPreview, apiKeyLen > 0, apiKeyLen, Object.keys(body).join(','));
  saveAiProviderConfig(email, body).then(r => {
    console.log('[companysetting] ai-provider save response email=%s ok=%s provider=%s', email, !!r?.ok, r?.provider || '');
    res.json(r);
  }).catch(err => {
    const reason = err?.message || 'BACKEND_ERROR';
    if (['INVALID_AI_PROVIDER', 'AI_KEY_VERIFY_FAILED', 'AI_VERIFY_TIMEOUT', 'API_KEY_REQUIRED'].includes(reason)) {
      return res.status(200).json({ ok: false, reason });
    }
    console.error('[companysetting] ai-provider', err);
    res.status(500).json({ ok: false, reason });
  });
});

router.post('/payment-verification-invoices', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => paymentVerificationListInvoices(email, clientId, req.body || {}));
});
router.post('/payment-verification-invoice-get', (req, res) => {
  const clientId = getClientId(req);
  const invoiceId = req.body?.id ?? req.body?.invoiceId;
  if (!invoiceId) return res.status(400).json({ ok: false, reason: 'INVOICE_ID_REQUIRED' });
  withEmail(req, res, (email) => paymentVerificationGetInvoice(email, clientId, invoiceId));
});
router.post('/payment-verification-approve', (req, res) => {
  const clientId = getClientId(req);
  const invoiceId = req.body?.id ?? req.body?.invoiceId;
  if (!invoiceId) return res.status(400).json({ ok: false, reason: 'INVOICE_ID_REQUIRED' });
  withEmail(req, res, (email) => paymentVerificationApprove(email, clientId, invoiceId, req.body || {}));
});
router.post('/payment-verification-reject', (req, res) => {
  const clientId = getClientId(req);
  const invoiceId = req.body?.id ?? req.body?.invoiceId;
  if (!invoiceId) return res.status(400).json({ ok: false, reason: 'INVOICE_ID_REQUIRED' });
  withEmail(req, res, (email) => paymentVerificationReject(email, clientId, invoiceId));
});

router.post('/google-drive/oauth-url', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => googleDriveOauth.getGoogleDriveOAuthAuthUrl(email, clientId));
});

router.get('/google-drive/oauth-callback', (req, res) => {
  const code = req.query?.code;
  const state = req.query?.state;
  const oauthErr = req.query?.error;
  const base = googleDriveOauth.getPortalCompanySettingsUrl();
  const sep = base.includes('?') ? '&' : '?';
  if (oauthErr) {
    return res.redirect(
      302,
      `${base}${sep}google_drive=error&reason=${encodeURIComponent(String(oauthErr))}`
    );
  }
  googleDriveOauth
    .completeGoogleDriveOAuthFromCallback(code, state)
    .then((out) => res.redirect(302, out.redirectUrl))
    .catch((err) => {
      console.error('[companysetting] google-drive/oauth-callback', err);
      res.redirect(302, `${base}${sep}google_drive=error&reason=callback_failed`);
    });
});

router.post('/google-drive/disconnect', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => googleDriveOauth.disconnectGoogleDrive(email, clientId));
});

router.post('/finverse-link-url', (req, res) => {
  const clientId = getClientId(req);
  const email = getEmail(req);
  if (!email || !String(email).trim()) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  getFinverseLinkUrl(email, clientId)
    .then(result => res.json(result))
    .catch(err => {
      const msg = err?.message || 'BACKEND_ERROR';
      const cause = err?.cause;
      const code = cause?.code;
      const unreachable = msg === 'fetch failed' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED';
      console.warn(
        '[companysetting] finverse-link-url failed',
        'message=', msg,
        cause ? `cause=${code ?? cause.message ?? 'unknown'} host=${cause.hostname ?? cause.address ?? ''}` : ''
      );
      return res.status(200).json({ ok: false, reason: unreachable ? 'FINVERSE_UNREACHABLE' : msg });
    });
});

router.get('/stripe-connect-oauth-return', (req, res) => {
  // Stripe OAuth 回调：Stripe 用 GET 带 ?code= & ?state= 重定向到此（redirect_uri 需为 ECS 并在 Dashboard 配置）
  const code = req.query?.code;
  const state = req.query?.state;
  // 统一回到 portal：PORTAL_APP_URL/operator/company，或 WIX_COMPANY_SETTING_URL 覆盖，默认 portal.colivingjb.com
  const portalBase = process.env.PORTAL_APP_URL && String(process.env.PORTAL_APP_URL).trim();
  const successRedirect = process.env.WIX_COMPANY_SETTING_URL
    || (portalBase ? `${portalBase.replace(/\/+$/, '')}/operator/company` : null)
    || 'https://portal.colivingjb.com/operator/company';
  console.log('[onboard] stripe-connect-oauth-return GET code=%s state=%s', !!code, state ? String(state).substring(0, 8) + '...' : '');
  if (!code || !state) {
    console.log('[onboard] stripe-connect-oauth-return missing code or state, redirect to portal');
    return res.redirect(302, successRedirect + (successRedirect.indexOf('?') >= 0 ? '&' : '?') + 'stripe_connect=error');
  }
  stripeConnectOAuthCompleteByState(state, code)
    .then((r) => {
      console.log('[onboard] stripe-connect-oauth-return OK accountId=%s redirect to portal', r?.accountId);
      res.redirect(302, successRedirect);
    })
    .catch((err) => {
      console.log('[onboard] stripe-connect-oauth-return FAIL reason=%s', err?.message || 'BACKEND_ERROR');
      res.redirect(302, successRedirect + (successRedirect.indexOf('?') >= 0 ? '&' : '?') + 'stripe_connect=error');
    });
});

router.post('/stripe-disconnect', (req, res) => {
  withEmail(req, res, (email) => stripeDisconnect(email));
});
router.post('/stripe-direct-connect', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const clientId = getClientId(req);
  saveDirectStripePaymentGateway(email, req.body || {}, clientId).then((r) => {
    res.json(r);
  }).catch((err) => {
    const reason = err?.message || 'BACKEND_ERROR';
    if (COMPANYSETTING_CLIENT_ERRORS.includes(reason) || reason.startsWith('STRIPE_')) {
      return res.status(200).json({ ok: false, reason });
    }
    console.error('[companysetting] stripe-direct-connect', err);
    res.status(500).json({ ok: false, reason });
  });
});
router.post('/stripe-test-webhook', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const clientId = getClientId(req);
  console.log('[companysetting] stripe-test-webhook request', {
    email: String(email).trim().toLowerCase(),
    clientId: clientId || null
  });
  triggerDirectStripeWebhookTest(email, clientId).then((r) => {
    console.log('[companysetting] stripe-test-webhook success', {
      email: String(email).trim().toLowerCase(),
      clientId: clientId || null,
      accountId: r?.accountId || null,
      marker: r?.marker || null,
      mode: r?.mode || null
    });
    res.json(r);
  }).catch((err) => {
    const reason = err?.message || 'BACKEND_ERROR';
    console.error('[companysetting] stripe-test-webhook failed', {
      email: String(email).trim().toLowerCase(),
      clientId: clientId || null,
      reason,
      type: err?.type,
      code: err?.code,
      statusCode: err?.statusCode,
      requestId: err?.requestId || err?.raw?.requestId || null,
      requestLogUrl: err?.raw?.request_log_url || null
    });
    if (COMPANYSETTING_CLIENT_ERRORS.includes(reason) || reason.startsWith('STRIPE_')) {
      return res.status(200).json({ ok: false, reason });
    }
    console.error('[companysetting] stripe-test-webhook', err);
    res.status(500).json({ ok: false, reason });
  });
});
router.post('/stripe-connect-oauth-complete', (req, res) => {
  // 返回页请求完整 log（ECS）
  const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
  const queryKeys = req.query && typeof req.query === 'object' ? Object.keys(req.query) : [];
  console.log('[onboard] stripe-connect-oauth-complete REQUEST_RECEIVED method=%s path=%s bodyKeys=%s queryKeys=%s', req.method, req.path, bodyKeys.join(','), queryKeys.join(','));
  const email = getEmail(req);
  const code = req.body?.code || req.query?.code;
  const state = req.body?.state || req.query?.state;
  const hasEmail = email && String(email).trim();
  if (hasEmail) {
    console.log('[onboard] stripe-connect-oauth-complete email=%s hasCode=%s codeLen=%s state=%s', email, !!code, code ? String(code).length : 0, state ? String(state).substring(0, 8) + '...' : state);
    if (!code) return res.status(200).json({ ok: false, reason: 'STRIPE_OAUTH_CODE_REQUIRED' });
    stripeConnectOAuthComplete(email, code, state).then(r => {
      console.log('[onboard] stripe-connect-oauth-complete OK email=%s accountId=%s', email, r?.accountId);
      res.json(r);
    }).catch(err => {
      const reason = err?.message || 'BACKEND_ERROR';
      console.log('[onboard] stripe-connect-oauth-complete FAIL email=%s reason=%s', email, reason);
      res.status(200).json({ ok: false, reason });
    });
    return;
  }
  // 无 email 时用 state 当 clientId（return 页 session 可能丢失）
  if (!code || !state) {
    console.log('[onboard] stripe-connect-oauth-complete NO_EMAIL_AND_MISSING_CODE_OR_STATE code=%s state=%s', !!code, !!state);
    return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  }
  console.log('[onboard] stripe-connect-oauth-complete by state (no email) statePreview=%s codeLen=%s', String(state).substring(0, 8) + '...', String(code).length);
  stripeConnectOAuthCompleteByState(state, code).then(r => {
    console.log('[onboard] stripe-connect-oauth-complete OK by state accountId=%s', r?.accountId);
    res.json(r);
  }).catch(err => {
    const reason = err?.message || 'BACKEND_ERROR';
    console.log('[onboard] stripe-connect-oauth-complete FAIL by state reason=%s', reason);
    res.status(200).json({ ok: false, reason });
  });
});
router.post('/stripe-connect-onboard', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) {
    console.log('[onboard] stripe-connect email=missing');
    return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  }
  const returnUrl = req.body?.returnUrl || req.body?.return_url;
  const refreshUrl = req.body?.refreshUrl || req.body?.refresh_url || returnUrl;
  console.log('[onboard] stripe-connect email=%s returnUrl=%s', email, returnUrl ? 'set' : 'empty');
  getStripeConnectOnboardUrl(email, returnUrl, refreshUrl).then(r => {
    if (r.clientId != null) console.log('[onboard] stripe-connect email=%s clientId=%s platform=%s sandbox=%s', email, r.clientId, r.platform || '-', r.sandbox);
    if (r.url) console.log('[onboard] stripe-connect OK url=%s', r.url.substring(0, 50) + '...');
    else if (r.alreadyConnected) console.log('[onboard] stripe-connect OK alreadyConnected');
    res.json(r);
  }).catch(err => {
    const raw = err?.message || '';
    const isStripe = err?.type && String(err.type).includes('Stripe');
    // MY 风控：platform loss-liable 不允许在 MY 创建 Connect 账户，不要误判为「完成平台设置」
    const isMyLossLiableRestriction = /loss-liable|cannot create accounts.*MY|MY.*cannot create/i.test(raw);
    const needsPlatformSetup = !isMyLossLiableRestriction && /platform|dashboard\.stripe\.com|responsibilities|connect.*profile/i.test(raw);
    const reason = (isStripe && needsPlatformSetup) ? 'STRIPE_CONNECT_PLATFORM_SETUP_REQUIRED' : (isMyLossLiableRestriction ? 'STRIPE_CONNECT_MY_LOSS_LIABLE_RESTRICTION' : (raw || 'BACKEND_ERROR'));
    console.log('[onboard] stripe-connect FAIL email=%s reason=%s raw=%s', email, reason, raw.substring(0, 200));
    console.error('[companysetting] stripe-connect-onboard', err);
    res.status(200).json({ ok: false, reason });
  });
});

router.post('/cnyiot-connect', (req, res) => {
  const email = getEmail(req);
  const body = req.body || {};
  if (!email || !String(email).trim()) {
    console.log('[onboard] cnyiot-connect email=missing');
    return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  }
  const payloadLog = { ...body };
  if (payloadLog.password) payloadLog.password = '***';
  const startMs = Date.now();
  console.log('[onboard] cnyiot-connect START email=%s mode=%s payload=%j', email, body.mode || '', payloadLog);
  cnyiotConnect(email, body).then(r => {
    console.log('[onboard] cnyiot-connect OK email=%s mode=%s DURATION_MS=%s', email, r.mode || '', Date.now() - startMs);
    res.json(r);
  }).catch(err => {
    let msg = err?.message || 'BACKEND_ERROR';
    if (err?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') msg = 'CNYIOT_NETWORK_TIMEOUT';
    console.log('[onboard] cnyiot-connect FAIL email=%s reason=%s DURATION_MS=%s cause=%s', email, msg, Date.now() - startMs, err?.cause ? (err.cause.code || err.cause) : '');
    console.error('[companysetting] cnyiot-connect', err);
    res.status(200).json({ ok: false, reason: msg });
  });
});

router.post('/cnyiot-credentials', (req, res) => {
  withEmail(req, res, (email) => getCnyiotCredentials(email));
});

router.post('/cnyiot-users', (req, res) => {
  withEmail(req, res, (email) => getCnyiotUsers(email, { debug: !!req.body?.debug }));
});

router.post('/cnyiot-create-user', (req, res) => {
  withEmail(req, res, (email) => createCnyiotUser(email, {
    loginName: req.body?.loginName,
    password: req.body?.password,
    tel: req.body?.tel
  }));
});

router.post('/ttlock-credentials', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getTtlockCredentials(email, clientId));
});

router.post('/bukku-connect', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  console.log('[onboard] bukku-connect email=%s', email);
  bukkuConnect(email, req.body || {}).then(r => {
    console.log('[onboard] bukku-connect OK email=%s', email);
    res.json(r);
  }).catch(err => {
    const msg = err?.message || 'BACKEND_ERROR';
    console.log('[onboard] bukku-connect FAIL email=%s reason=%s', email, msg);
    console.error('[companysetting] bukku-connect', err);
    res.status(200).json({ ok: false, reason: msg });
  });
});

router.post('/bukku-credentials', (req, res) => {
  withEmail(req, res, (email) => getBukkuCredentials(email));
});

router.post('/bukku-disconnect', (req, res) => {
  withEmail(req, res, (email) => bukkuDisconnect(email));
});

router.post('/payex-credentials', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => getPayexCredentials(email, clientId));
});
router.post('/payex-connect', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  const body = req.body || {};
  payexConnect(email, {
    xendit_sub_account_id: body.xendit_sub_account_id,
    xendit_test_secret_key: body.xendit_test_secret_key,
    xendit_live_secret_key: body.xendit_live_secret_key,
    xendit_use_test: body.xendit_use_test
  }).then((r) => {
    res.json(r);
  }).catch((err) => {
    const msg = err?.message || 'BACKEND_ERROR';
    if (msg === 'XENDIT_MALAYSIA_ONLY' || msg === 'XENDIT_KEYS_REQUIRED' || msg === 'XENDIT_KEYS_OR_SUB_ACCOUNT_REQUIRED') return res.status(200).json({ ok: false, reason: msg });
    console.error('[companysetting] payex-connect', err);
    res.status(200).json({ ok: false, reason: msg });
  });
});
router.post('/payex-direct-connect', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const clientId = getClientId(req);
  saveDirectPayexPaymentGateway(email, req.body || {}, clientId).then((r) => {
    res.json(r);
  }).catch((err) => {
    const reason = err?.message || 'BACKEND_ERROR';
    if (COMPANYSETTING_CLIENT_ERRORS.includes(reason) || reason.startsWith('XENDIT_')) {
      return res.status(200).json({ ok: false, reason });
    }
    console.error('[companysetting] payex-direct-connect', err);
    res.status(500).json({ ok: false, reason });
  });
});
router.post('/payex-disconnect', (req, res) => {
  withEmail(req, res, (email) => payexDisconnect(email));
});

router.post('/billplz-direct-connect', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const clientId = getClientId(req);
  saveDirectBillplzPaymentGateway(email, req.body || {}, clientId).then((r) => {
    res.json(r);
  }).catch((err) => {
    const reason = err?.message || 'BACKEND_ERROR';
    if (COMPANYSETTING_CLIENT_ERRORS.includes(reason) || reason.startsWith('BILLPLZ_')) {
      return res.status(200).json({ ok: false, reason });
    }
    console.error('[companysetting] billplz-direct-connect', err);
    res.status(500).json({ ok: false, reason });
  });
});

router.post('/billplz-disconnect', (req, res) => {
  withEmail(req, res, (email) => billplzDisconnect(email));
});

router.post('/payment-gateway-mode-save', (req, res) => {
  const body = req.body || {};
  withEmail(req, res, (email) => setSgTenantPaymentMode(email, body.mode));
});

router.post('/xendit-create-sub-account', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => xenditCreateSubAccount(email, clientId));
});

router.post('/einvoice-update', (req, res) => {
  const body = req.body || {};
  const provider = body.provider;
  const einvoice = body.einvoice;
  if (provider == null || einvoice === undefined) {
    return res.status(400).json({ ok: false, reason: 'PROVIDER_AND_EINVOICE_REQUIRED' });
  }
  withEmail(req, res, (email) => updateAccountingEinvoice(email, { provider, einvoice }));
});

router.post('/xero-connect', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  console.log('[onboard] xero-connect email=%s', email);
  if (req.body?.code || req.body?.redirectUri || req.body?.redirect_uri) {
    console.log(
      '[onboard] xero-connect payload hasCode=%s redirectUri=%s',
      !!req.body?.code,
      req.body?.redirectUri || req.body?.redirect_uri || ''
    );
  }
  xeroConnect(email, req.body || {}).then(r => {
    console.log('[onboard] xero-connect OK email=%s', email);
    res.json(r);
  }).catch(err => {
    const msg = err?.message || 'BACKEND_ERROR';
    console.log('[onboard] xero-connect FAIL email=%s reason=%s', email, msg);
    if (err?.response?.data) console.log('[onboard] xero-connect 400 body', err.response.data);
    console.error('[companysetting] xero-connect', err);
    res.status(200).json({ ok: false, reason: msg });
  });
});

router.post('/xero-disconnect', (req, res) => {
  withEmail(req, res, (email) => xeroDisconnect(email));
});

router.get('/xero-auth-url', (req, res) => {
  const redirectUriRaw = req.query?.redirectUri || req.query?.redirect_uri || req.query?.returnUrl || req.query?.return_url;
  const redirectUri = sanitizeRedirectUriForXero(redirectUriRaw);
  console.log('[onboard] xero-auth-url GET redirectUriRaw=%s redirectUri=%s hasState=%s', redirectUriRaw || '', redirectUri || '', !!req.query?.state);
  if (!redirectUri) return res.status(400).json({ ok: false, reason: 'REDIRECT_URI_REQUIRED' });
  try {
    const result = getXeroAuthUrl(redirectUri, req.query?.state);
    console.log('[onboard] xero-auth-url GET OK redirectUri=%s', redirectUri);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.log('[onboard] xero-auth-url GET FAIL reason=%s', err?.message || 'BACKEND_ERROR');
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  }
});
router.post('/xero-auth-url', (req, res) => {
  const redirectUriRaw =
    req.body?.redirectUri ||
    req.body?.redirect_uri ||
    req.body?.returnUrl ||
    req.body?.return_url ||
    req.query?.redirectUri ||
    req.query?.redirect_uri ||
    req.query?.returnUrl ||
    req.query?.return_url;
  const redirectUri = sanitizeRedirectUriForXero(redirectUriRaw);
  console.log('[onboard] xero-auth-url POST redirectUriRaw=%s redirectUri=%s hasState=%s', redirectUriRaw || '', redirectUri || '', !!(req.body?.state || req.query?.state));
  if (!redirectUri) return res.status(400).json({ ok: false, reason: 'REDIRECT_URI_REQUIRED' });
  try {
    const result = getXeroAuthUrl(redirectUri, req.body?.state || req.query?.state);
    console.log('[onboard] xero-auth-url POST OK redirectUri=%s', redirectUri);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.log('[onboard] xero-auth-url POST FAIL reason=%s', err?.message || 'BACKEND_ERROR');
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  }
});

router.post('/cleanlemons-link/start', (req, res) => {
  const email = getEmail(req);
  const clientId = getClientId(req);
  if (!email || !String(email).trim()) {
    return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  }
  colivingCleanlemonsLink
    .startCleanlemonsLink(email, clientId)
    .then((r) => res.json(r))
    .catch((err) => {
      const msg = err?.message || 'BACKEND_ERROR';
      res.status(200).json({ ok: false, reason: msg });
    });
});

router.post('/cleanlemons-link/status', (req, res) => {
  const email = getEmail(req);
  const clientId = getClientId(req);
  if (!email || !String(email).trim()) {
    return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  }
  colivingCleanlemonsLink
    .getCleanlemonsLinkStatus(email, clientId)
    .then((r) => res.json(r))
    .catch((err) => {
      const msg = err?.message || 'BACKEND_ERROR';
      res.status(200).json({ ok: false, reason: msg });
    });
});

router.post('/cleanlemons-link/confirm', (req, res) => {
  const email = getEmail(req);
  const clientId = getClientId(req);
  const body = req.body || {};
  if (!email || !String(email).trim()) {
    return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  }
  colivingCleanlemonsLink
    .confirmCleanlemonsLink(
      email,
      {
        exportPropertyToCleanlemons: !!body.exportPropertyToCleanlemons,
        integrateTtlock: !!body.integrateTtlock,
        replaceTtlockFromColiving: !!body.replaceTtlockFromColiving
      },
      clientId
    )
    .then((r) => res.json(r))
    .catch((err) => {
      const code = err?.code || err?.message || 'BACKEND_ERROR';
      res.status(200).json({ ok: false, reason: code });
    });
});

router.post('/cleanlemons-link/disconnect', (req, res) => {
  const email = getEmail(req);
  const clientId = getClientId(req);
  if (!email || !String(email).trim()) {
    return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  }
  colivingCleanlemonsLink
    .disconnectCleanlemonsLink(email, clientId)
    .then((r) => res.json(r))
    .catch((err) => {
      const msg = err?.message || 'BACKEND_ERROR';
      res.status(200).json({ ok: false, reason: msg });
    });
});

/** Cleanlemons client portal (no Coliving session): completes OAuth handoff. */
router.post('/cleanlemons-oauth/complete', (req, res) => {
  const body = req.body || {};
  colivingCleanlemonsLink
    .completeCleanlemonsOAuth({
      state: body.state,
      cleanlemonsClientdetailId: body.cleanlemonsClientdetailId || body.clientdetailId,
      cleanlemonsOperatorId: body.cleanlemonsOperatorId || body.operatorId
    })
    .then((r) => res.json(r))
    .catch((err) => {
      const code = err?.code || err?.message || 'BACKEND_ERROR';
      res.status(400).json({ ok: false, reason: code });
    });
});

router.post('/ttlock-connect', (req, res) => {
  const email = getEmail(req);
  const clientId = getClientId(req);
  const body = req.body || {};
  if (!email || !String(email).trim()) {
    console.log('[onboard] ttlock-connect email=missing');
    return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  }
  const payloadLog = { ...body };
  if (payloadLog.password) payloadLog.password = '***';
  console.log('[onboard] ttlock-connect email=%s mode=%s payload=%j', email, body.mode || '', payloadLog);
  ttlockConnect(email, body, clientId).then(r => {
    console.log('[onboard] ttlock-connect OK email=%s', email);
    res.json(r);
  }).catch(err => {
    const msg = err?.message || 'BACKEND_ERROR';
    console.log('[onboard] ttlock-connect FAIL email=%s reason=%s', email, msg);
    console.error('[companysetting] ttlock-connect', err);
    res.status(200).json({ ok: false, reason: msg });
  });
});

router.post('/ttlock-disconnect', (req, res) => {
  const clientId = getClientId(req);
  withEmail(req, res, (email) => ttlockDisconnect(email, clientId));
});

router.post('/cnyiot-disconnect', (req, res) => {
  withEmail(req, res, (email) => cnyiotDisconnect(email));
});

module.exports = router;
