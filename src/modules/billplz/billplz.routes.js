const express = require('express');
const router = express.Router();
const {
  handleCallback,
  verifyCallbackSignature,
  getBillplzCredentials,
  verifyPaymentOrderCallbackChecksum,
  handlePaymentOrderCallback
} = require('./billplz.service');
const { handleSaasColivingBillplzWebhook } = require('../enquiry/enquiry-saas-checkout.service');

/**
 * SaaS Coliving 平台 Billplz collection（無 client_id）；reference_1 = pricingplanlogs.id
 */
router.post('/saas-coliving-callback', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const result = await handleSaasColivingBillplzWebhook(req.body || {});
    if (!result.ok) {
      const body = req.body || {};
      console.warn('[billplz] saas-coliving-callback rejected', {
        reason: result.reason,
        bodyKeys: Object.keys(body).sort(),
        hasRef1: !!(body.reference_1 || body.reference1),
        hasRef2: !!(body.reference_2 || body.reference2)
      });
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('[billplz] saas-coliving-callback', err?.message || err);
    return res.status(500).json({ ok: false, reason: err?.message || 'CALLBACK_FAILED' });
  }
});

router.post('/callback', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const clientId = req.query?.client_id ? String(req.query.client_id).trim() : '';
    if (!clientId) return res.status(400).json({ ok: false, reason: 'NO_CLIENT_ID' });
    const payload = req.body || {};
    const providedSignature = payload.x_signature;
    const verify = await verifyCallbackSignature(clientId, payload, providedSignature);
    if (!verify.ok) {
      return res.status(400).json({ ok: false, reason: verify.reason });
    }
    const result = await handleCallback({ clientId, payload, query: req.query || {} });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[billplz] callback error:', err?.message || err);
    return res.status(500).json({ ok: false, reason: err?.message || 'CALLBACK_FAILED' });
  }
});

router.post('/payment-order-callback', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const clientId = req.query?.client_id ? String(req.query.client_id).trim() : '';
    if (!clientId) return res.status(400).json({ ok: false, reason: 'NO_CLIENT_ID' });
    const payload = req.body || {};
    const verify = await verifyPaymentOrderCallbackChecksum(clientId, payload);
    if (!verify.ok) {
      return res.status(400).json({ ok: false, reason: verify.reason });
    }
    const result = await handlePaymentOrderCallback({ clientId, payload });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[billplz] payment-order-callback error:', err?.message || err);
    return res.status(500).json({ ok: false, reason: err?.message || 'CALLBACK_FAILED' });
  }
});

router.get('/config', async (req, res) => {
  try {
    const clientId = req.query?.clientId;
    if (!clientId) return res.status(400).json({ ok: false, reason: 'clientId required' });
    const creds = await getBillplzCredentials(String(clientId).trim(), { allowPending: true });
    res.json({ ok: true, provider: 'billplz', configured: !!creds });
  } catch (err) {
    res.status(500).json({ ok: false, reason: err?.message || 'CONFIG_FAILED' });
  }
});

module.exports = router;
