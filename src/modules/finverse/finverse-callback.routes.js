/**
 * Finverse OAuth callback – no auth; called by Finverse redirect after user links bank.
 * GET or POST: code, state (state = clientId). Exchange code for token, save to client_integration, redirect to portal.
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
const finverse = require('./index');
const { saveLoginIdentityToken } = require('./lib/finverseCreds');

const PORTAL_COMPANY_URL = process.env.PORTAL_APP_URL && String(process.env.PORTAL_APP_URL).trim()
  ? `${process.env.PORTAL_APP_URL.replace(/\/+$/, '')}/operator/company`
  : (process.env.PORTAL_FRONTEND_URL || 'https://portal.colivingjb.com') + '/operator/company';

function getRedirectUrl(success, error) {
  const u = new URL(PORTAL_COMPANY_URL);
  if (success) u.searchParams.set('finverse', 'success');
  if (error) u.searchParams.set('finverse_error', error);
  return u.toString();
}

/** True if response should be JSON (XHR from Finverse Link). Only CORS/fetch get JSON so "Continue" document redirect gets 302. */
function wantsJson(req) {
  const secMode = req.get('Sec-Fetch-Mode');
  if (secMode !== 'cors') return false;
  const accept = (req.get('Accept') || '').toLowerCase();
  return accept.includes('application/json') || !!req.get('x-request-id');
}

async function handleCallback(req, res) {
  const code = req.query?.code || req.body?.code;
  const state = req.query?.state || req.body?.state;
  const json = wantsJson(req);
  console.log('[finverse] callback received', {
    method: req.method,
    code_length: (code || '').length,
    state: state ? String(state).slice(0, 8) + '...' : undefined,
    wantsJson: json,
    'Sec-Fetch-Mode': req.get('Sec-Fetch-Mode'),
    has_query_code: !!req.query?.code,
    has_body_code: !!req.body?.code
  });

  const bad = (error) => {
    if (json) return res.status(400).json({ success: false, error });
    return res.redirect(302, getRedirectUrl(false, error));
  };
  const ok = () => {
    // Finverse Link XHR expects same shape as demo-api: {"success":true}
    if (json) return res.status(200).json({ success: true });
    return res.redirect(302, getRedirectUrl(true));
  };
  const fail = (error) => {
    if (json) return res.status(200).json({ success: false, error: error || 'exchange_failed' });
    return res.redirect(302, getRedirectUrl(false, error || 'exchange_failed'));
  };

  if (!code || !state) return bad('missing_code_or_state');
  const clientId = String(state).trim();
  if (!clientId) return bad('invalid_state');
  const [rows] = await pool.query('SELECT id FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) return bad('client_not_found');
  try {
    const { access_token } = await finverse.auth.exchangeCodeForLoginIdentity(clientId, { code });
    await saveLoginIdentityToken(clientId, access_token);
    return ok();
  } catch (err) {
    console.error('[finverse] callback exchange failed', err?.message, 'clientId=', clientId, 'stack=', err?.stack?.split('\n').slice(0, 3).join(' '));
    return fail(err?.message || 'exchange_failed');
  }
}

router.get('/callback', (req, res, next) => {
  handleCallback(req, res).catch(next);
});
router.post('/callback', express.urlencoded({ extended: true }), express.json(), (req, res, next) => {
  handleCallback(req, res).catch(next);
});

// Webhook (v1 Data Webhook URIs). Dashboard 填: https://api.colivingjb.com/api/finverse/webhook
// Payment Webhook 需联系 Finverse sales；v2 走 Svix。
router.post('/webhook', express.json(), (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[finverse] webhook received', Object.keys(payload), payload.event_type || payload.type || '');
    // TODO: 根据 event 类型处理（如 login_identity 更新、data 同步）
  } catch (e) {
    console.warn('[finverse] webhook parse', e?.message);
  }
  res.status(200).send();
});

module.exports = router;
