const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const deliveryOrderWrapper = require('../wrappers/deliveryOrder.wrapper');
const {
  create_delivery_order_schema,
  update_delivery_order_schema,
  list_delivery_order_schema,
  update_delivery_order_status_schema
} = require('../validators/deliveryOrder.validator');

router.post('/', validate(create_delivery_order_schema), async (req, res) => {
  const result = await deliveryOrderWrapper.createdeliveryorder(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_delivery_order_schema, 'query'), async (req, res) => {
  const result = await deliveryOrderWrapper.listdeliveryorders(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await deliveryOrderWrapper.readdeliveryorder(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_delivery_order_schema), async (req, res) => {
  const result = await deliveryOrderWrapper.updatedeliveryorder(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_delivery_order_status_schema), async (req, res) => {
  const result = await deliveryOrderWrapper.updatedeliveryorderstatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await deliveryOrderWrapper.deletedeliveryorder(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
