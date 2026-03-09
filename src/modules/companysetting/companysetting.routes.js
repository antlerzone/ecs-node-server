/**
 * Company Setting API – for Wix companysetting page.
 * All endpoints accept email (body or query) and resolve access via getAccessContextByEmail.
 */

const express = require('express');
const router = express.Router();
const {
  getStaffList,
  createStaff,
  updateStaff,
  getIntegrationTemplate,
  getProfile,
  updateProfile,
  getBanks,
  getAdmin,
  saveAdmin,
  getOnboardStatus,
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
  getBukkuCredentials,
  bukkuDisconnect,
  autocountConnect,
  getAutoCountCredentials,
  autocountDisconnect,
  sqlAccountConnect,
  getSqlAccountCredentials,
  sqlAccountDisconnect,
  updateAccountingEinvoice,
  xeroConnect,
  getXeroAuthUrl,
  xeroDisconnect,
  ttlockConnect,
  ttlockDisconnect,
  getEmail
} = require('./companysetting.service');

// Reasons that should return 200 + ok:false so Wix JSW does not throw (avoids "Unable to handle the request")
const COMPANYSETTING_CLIENT_ERRORS = [
  'ACCESS_DENIED', 'NO_CLIENT_ID', 'NO_PERMISSION', 'CLIENT_INACTIVE', 'STAFF_INACTIVE', 'NO_STAFF',
  'STAFF_NOT_FOUND', 'CLIENT_NOT_FOUND'
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

router.get('/staff-list', (req, res) => {
  withEmail(req, res, (email) => getStaffList(email));
});
router.post('/staff-list', (req, res) => {
  withEmail(req, res, (email) => getStaffList(email));
});

router.post('/staff-create', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  createStaff(email, req.body || {}).then(r => res.json(r)).catch(err => {
    const reason = err?.message || 'BACKEND_ERROR';
    if (reason === 'STAFF_LIMIT_REACHED') {
      return res.status(403).json({ ok: false, reason: 'STAFF_LIMIT_REACHED', message: 'Staff account limit reached (plan + addon)' });
    }
    console.error('[companysetting] staff-create', err);
    res.status(500).json({ ok: false, reason });
  });
});

router.post('/staff-update', (req, res) => {
  const email = getEmail(req);
  const staffId = req.body?.staffId ?? req.body?.id;
  if (!email || !staffId) return res.status(400).json({ ok: false, reason: 'NO_EMAIL_OR_STAFF_ID' });
  updateStaff(email, staffId, req.body || {}).then(r => res.json(r)).catch(err => {
    console.error('[companysetting] staff-update', err);
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  });
});

router.get('/integration-template', (req, res) => {
  res.json({ ok: true, items: getIntegrationTemplate() });
});
router.post('/integration-template', (req, res) => {
  res.json({ ok: true, items: getIntegrationTemplate() });
});

router.get('/profile', (req, res) => {
  withEmail(req, res, (email) => getProfile(email));
});
router.post('/profile', (req, res) => {
  withEmail(req, res, (email) => getProfile(email));
});

router.post('/profile-update', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  updateProfile(email, req.body || {}).then(r => res.json(r)).catch(err => {
    console.error('[companysetting] profile-update', err);
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  });
});

router.get('/banks', async (req, res) => {
  try {
    const result = await getBanks();
    res.json(result);
  } catch (err) {
    console.error('[companysetting] banks', err);
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  }
});
router.post('/banks', async (req, res) => {
  try {
    const result = await getBanks();
    res.json(result);
  } catch (err) {
    console.error('[companysetting] banks', err);
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  }
});

router.get('/admin', (req, res) => {
  withEmail(req, res, (email) => getAdmin(email));
});
router.post('/admin', (req, res) => {
  withEmail(req, res, (email) => getAdmin(email));
});

router.post('/admin-save', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  saveAdmin(email, req.body?.admin ?? req.body).then(r => res.json(r)).catch(err => {
    console.error('[companysetting] admin-save', err);
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  });
});

router.post('/onboard-status', (req, res) => {
  const email = getEmail(req);
  if (email) console.log('[onboard] onboard-status email=%s', email);
  withEmail(req, res, (email) => getOnboardStatus(email));
});
router.get('/stripe-connect-oauth-return', (req, res) => {
  // Stripe OAuth 回调：Stripe 用 GET 带 ?code= & ?state= 重定向到此（redirect_uri 需为 ECS 并在 Dashboard 配置）
  const code = req.query?.code;
  const state = req.query?.state;
  const successRedirect = process.env.WIX_COMPANY_SETTING_URL || 'https://www.colivingjb.com/company-setting';
  console.log('[onboard] stripe-connect-oauth-return GET code=%s state=%s', !!code, state ? String(state).substring(0, 8) + '...' : '');
  if (!code || !state) {
    console.log('[onboard] stripe-connect-oauth-return missing code or state, redirect to Wix');
    return res.redirect(302, successRedirect + (successRedirect.indexOf('?') >= 0 ? '&' : '?') + 'stripe_connect=error');
  }
  stripeConnectOAuthCompleteByState(state, code)
    .then((r) => {
      console.log('[onboard] stripe-connect-oauth-return OK accountId=%s redirect to Wix', r?.accountId);
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
  withEmail(req, res, (email) => getTtlockCredentials(email));
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

router.post('/autocount-connect', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  autocountConnect(email, req.body || {}).then(r => res.json(r)).catch(err => {
    console.error('[companysetting] autocount-connect', err);
    res.status(200).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  });
});

router.post('/autocount-credentials', (req, res) => {
  withEmail(req, res, (email) => getAutoCountCredentials(email));
});

router.post('/autocount-disconnect', (req, res) => {
  withEmail(req, res, (email) => autocountDisconnect(email));
});

router.post('/sql-connect', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  sqlAccountConnect(email, req.body || {}).then(r => res.json(r)).catch(err => {
    console.error('[companysetting] sql-connect', err);
    res.status(200).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  });
});

router.post('/sql-credentials', (req, res) => {
  withEmail(req, res, (email) => getSqlAccountCredentials(email));
});

router.post('/sql-disconnect', (req, res) => {
  withEmail(req, res, (email) => sqlAccountDisconnect(email));
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
  const redirectUri = req.query?.redirectUri || req.query?.redirect_uri;
  if (!redirectUri) return res.status(400).json({ ok: false, reason: 'REDIRECT_URI_REQUIRED' });
  try {
    const result = getXeroAuthUrl(redirectUri, req.query?.state);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  }
});
router.post('/xero-auth-url', (req, res) => {
  const redirectUri = req.body?.redirectUri || req.body?.redirect_uri || req.query?.redirectUri;
  if (!redirectUri) return res.status(400).json({ ok: false, reason: 'REDIRECT_URI_REQUIRED' });
  try {
    const result = getXeroAuthUrl(redirectUri, req.body?.state || req.query?.state);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  }
});

router.post('/ttlock-connect', (req, res) => {
  const email = getEmail(req);
  const body = req.body || {};
  if (!email || !String(email).trim()) {
    console.log('[onboard] ttlock-connect email=missing');
    return res.status(200).json({ ok: false, reason: 'NO_EMAIL' });
  }
  const payloadLog = { ...body };
  if (payloadLog.password) payloadLog.password = '***';
  console.log('[onboard] ttlock-connect email=%s mode=%s payload=%j', email, body.mode || '', payloadLog);
  ttlockConnect(email, body).then(r => {
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
  withEmail(req, res, (email) => ttlockDisconnect(email));
});

router.post('/cnyiot-disconnect', (req, res) => {
  withEmail(req, res, (email) => cnyiotDisconnect(email));
});

module.exports = router;
