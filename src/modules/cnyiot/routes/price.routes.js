/**
 * CNYIoT Price API routes (SaaS – client from clientresolver).
 */

const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const priceWrapper = require('../wrappers/price.wrapper');
const { add_price_schema, delete_price_schema, edit_price_body_schema } = require('../validators/price.validator');

function clientId(req) {
  const id = req?.client?.id;
  if (!id) throw new Error('missing client');
  return id;
}

function handleErr(res, err) {
  const msg = err?.message || 'unknown';
  if (msg === 'missing client') return res.status(400).json({ ok: false, error: msg });
  if (msg === 'CNYIOT_NOT_CONFIGURED' || msg === 'CNYIOT_ACCOUNT_INVALID') {
    return res.status(403).json({ ok: false, error: msg });
  }
  if (msg.startsWith('CNYIOT_')) return res.status(400).json({ ok: false, error: msg });
  return res.status(500).json({ ok: false, error: msg });
}

/* list prices (ptype=1) */
router.get('/', async (req, res) => {
  try {
    const data = await priceWrapper.getPrices(clientId(req));
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* add price */
router.post('/', validate(add_price_schema), async (req, res) => {
  try {
    const data = await priceWrapper.addPrice(clientId(req), req.body);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* delete prices (batch) */
router.delete('/', validate(delete_price_schema), async (req, res) => {
  try {
    const data = await priceWrapper.deletePrice(clientId(req), req.body.id);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* edit price */
router.put('/:priceId', validate(edit_price_body_schema), async (req, res) => {
  try {
    const data = await priceWrapper.editPrice(clientId(req), {
      PriceID: req.params.priceId,
      ...req.body
    });
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

module.exports = router;
