/**
 * Payex API: callback webhook, config for frontend.
 */

const express = require('express');
const router = express.Router();
const {
  handleCallback,
  getPayexCredentials,
  isXenditPayoutCallbackPayload,
  handlePayoutCallback
} = require('./payex.service');
const { getAccessContextByEmail } = require('../access/access.service');
const {
  verifyPayexWebhookToken,
  findPayexClientIdByWebhookToken
} = require('../payment-gateway/payment-gateway.service');
const {
  verifySaaSPlatformCallbackToken,
  tryHandleSaaSPlatformInvoiceCallback
} = require('../billing/xendit-saas-platform.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

function parseXenditInvoiceMetadata(data) {
  const payload = data?.data && typeof data.data === 'object' ? data.data : data;
  let metadataObj = {};
  if (data?.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)) {
    metadataObj = { ...metadataObj, ...data.metadata };
  }
  if (payload?.metadata && typeof payload.metadata === 'object') {
    metadataObj = { ...metadataObj, ...payload.metadata };
  } else if (typeof payload?.metadata === 'string') {
    try {
      const parsed = JSON.parse(payload.metadata);
      if (parsed && typeof parsed === 'object') metadataObj = { ...metadataObj, ...parsed };
    } catch (_) {
      /* ignore */
    }
  }
  const ext = String(
    payload?.external_id ??
      payload?.externalId ??
      data?.external_id ??
      payload?.reference_id ??
      data?.reference_id ??
      ''
  ).trim();
  if (ext && /^saas-tp-/i.test(ext)) {
    if (metadataObj.saas_platform == null || String(metadataObj.saas_platform).trim() === '') {
      metadataObj.saas_platform = '1';
    }
    if (!metadataObj.type) metadataObj.type = 'Topup';
    if (!metadataObj.creditlog_id) metadataObj.creditlog_id = ext.replace(/^saas-tp-/i, '');
  }
  if (ext && /^saas-pp-/i.test(ext)) {
    if (metadataObj.saas_platform == null || String(metadataObj.saas_platform).trim() === '') {
      metadataObj.saas_platform = '1';
    }
    if (!metadataObj.type) metadataObj.type = 'pricingplan';
    if (!metadataObj.pricingplanlog_id) metadataObj.pricingplanlog_id = ext.replace(/^saas-pp-/i, '');
  }
  /** Portal /enquiry MYR：external_id saas-enq-{pricingplanlogs.id}（createEnquiryPricingPlanXendit） */
  if (ext && /^saas-enq-/i.test(ext)) {
    if (metadataObj.saas_platform == null || String(metadataObj.saas_platform).trim() === '') {
      metadataObj.saas_platform = '1';
    }
    if (!metadataObj.type) metadataObj.type = 'enquiry_pricingplan';
    if (!metadataObj.pricingplanlog_id) metadataObj.pricingplanlog_id = ext.replace(/^saas-enq-/i, '');
  }
  return metadataObj;
}

function isSaasPlatformMetadata(metadataObj) {
  const v = metadataObj?.saas_platform;
  if (v === true || v === 1) return true;
  const s = String(v || '').toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * POST /api/payex/callback
 * Server-to-server callback from Xendit (invoice payment status). Configure this URL in Xendit Dashboard (Developers → Callbacks).
 * Body: external_id, status (PENDING|PAID|EXPIRED), metadata, amount, etc.
 */
router.post('/callback', async (req, res) => {
  try {
    const data = req.body || {};
    const callbackToken = req.headers['x-callback-token'] || req.headers['X-CALLBACK-TOKEN'];
    const metadataObj = parseXenditInvoiceMetadata(data);

    if (isSaasPlatformMetadata(metadataObj)) {
      const verify = verifySaaSPlatformCallbackToken(callbackToken);
      if (!verify.ok) {
        return res.status(400).json({ success: false, error: verify.reason });
      }
      if (isXenditPayoutCallbackPayload(data)) {
        const payoutClientId =
          metadataObj.saas_operator_client_id || metadataObj.client_id || data?.client_id || null;
        const result = await handlePayoutCallback(data, payoutClientId);
        return res.status(200).json(result);
      }
      const saas = await tryHandleSaaSPlatformInvoiceCallback(data, metadataObj);
      return res.status(200).json(saas.result != null ? saas.result : { success: false, error: 'SAAS_HANDLER_EMPTY' });
    }

    let clientId = data?.metadata?.client_id || data?.client_id || null;
    if (!clientId && callbackToken) {
      clientId = await findPayexClientIdByWebhookToken(callbackToken);
    }
    if (clientId) {
      const verify = await verifyPayexWebhookToken(clientId, callbackToken);
      if (!verify.ok) {
        return res.status(400).json({ success: false, error: verify.reason });
      }
    }
    if (isXenditPayoutCallbackPayload(data)) {
      const result = await handlePayoutCallback(data, clientId);
      return res.status(200).json(result);
    }
    const result = await handleCallback(data, { routeClientId: clientId });
    res.status(200).json(result);
  } catch (err) {
    console.error('[Payex] callback error:', err?.message);
    res.status(500).json({ success: false, error: err?.message || 'CALLBACK_FAILED' });
  }
});

/**
 * GET /api/payex/config?clientId=
 * Returns { ok, provider: 'payex'|null, configured: boolean } for frontend (e.g. show Payex vs Stripe).
 */
router.get('/config', async (req, res) => {
  try {
    const clientId = req.query?.clientId;
    if (!clientId) {
      return res.status(400).json({ ok: false, reason: 'clientId required' });
    }
    const creds = await getPayexCredentials(clientId);
    res.json({
      ok: true,
      provider: 'payex',
      configured: !!creds
    });
  } catch (err) {
    res.status(500).json({ ok: false, reason: err?.message || 'CONFIG_FAILED' });
  }
});

/**
 * POST /api/payex/credentials
 * Body: { email, clientId? }. Returns { ok, configured } (no secret).
 */
router.post('/credentials', async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const clientId = req.body?.clientId || ctx.client?.id;
    if (!clientId) return res.status(400).json({ ok: false, reason: 'NO_CLIENT_ID' });
    const creds = await getPayexCredentials(clientId);
    res.json({ ok: true, configured: !!creds });
  } catch (err) {
    res.status(500).json({ ok: false, reason: err?.message || 'FAILED' });
  }
});

module.exports = router;
