/**
 * TTLock Gateway API routes (SaaS – client from clientresolver).
 */

const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const gatewayWrapper = require('../wrappers/gateway.wrapper');
const { params_gateway_id_schema, rename_gateway_schema } = require('../validators/gateway.validator');

function clientId(req) {
  const id = req?.client?.id;
  if (!id) throw new Error('missing client');
  return id;
}

function handleErr(res, err) {
  const msg = err?.message || 'unknown';
  if (msg === 'missing client') return res.status(400).json({ ok: false, error: msg });
  if (msg === 'TTLOCK_NOT_CONFIGURED' || msg === 'TTLOCK_NO_TOKEN' || msg === 'TTLOCK_APP_CREDENTIALS_MISSING') {
    return res.status(403).json({ ok: false, error: msg });
  }
  if (msg.startsWith('TTLOCK_') || msg.startsWith('GATEWAY_ID_REQUIRED') || msg.startsWith('GATEWAY_NAME_REQUIRED')) {
    return res.status(400).json({ ok: false, error: msg });
  }
  return res.status(500).json({ ok: false, error: msg });
}

/* list all gateways */
router.get('/', async (req, res) => {
  try {
    const data = await gatewayWrapper.listAllGateways(clientId(req));
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* gateway by id */
router.get('/:gatewayId', validate(params_gateway_id_schema, 'params'), async (req, res) => {
  try {
    const data = await gatewayWrapper.getGatewayById(clientId(req), req.params.gatewayId);
    res.json({ ok: true, data: data ?? null });
  } catch (err) {
    handleErr(res, err);
  }
});

/* rename gateway */
router.post('/:gatewayId/rename', validate(params_gateway_id_schema, 'params'), validate(rename_gateway_schema), async (req, res) => {
  try {
    await gatewayWrapper.renameGateway(clientId(req), req.params.gatewayId, req.body.gatewayName);
    res.json({ ok: true });
  } catch (err) {
    handleErr(res, err);
  }
});

module.exports = router;
