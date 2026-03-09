const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const orderWrapper = require('../wrappers/order.wrapper');
const {
  create_order_schema,
  update_order_schema,
  list_order_schema,
  update_order_status_schema
} = require('../validators/order.validator');

router.post('/', validate(create_order_schema), async (req, res) => {
  const result = await orderWrapper.createorder(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_order_schema, 'query'), async (req, res) => {
  const result = await orderWrapper.listorders(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await orderWrapper.readorder(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_order_schema), async (req, res) => {
  const result = await orderWrapper.updateorder(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_order_status_schema), async (req, res) => {
  const result = await orderWrapper.updateorderstatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await orderWrapper.deleteorder(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
