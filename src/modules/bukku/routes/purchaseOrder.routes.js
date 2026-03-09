const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const purchaseOrderWrapper = require('../wrappers/purchaseOrder.wrapper');
const {
  create_purchase_order_schema,
  update_purchase_order_schema,
  list_purchase_order_schema,
  update_purchase_order_status_schema
} = require('../validators/purchaseOrder.validator');

router.post('/', validate(create_purchase_order_schema), async (req, res) => {
  const result = await purchaseOrderWrapper.createpurchaseorder(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_purchase_order_schema, 'query'), async (req, res) => {
  const result = await purchaseOrderWrapper.listpurchaseorders(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await purchaseOrderWrapper.readpurchaseorder(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_purchase_order_schema), async (req, res) => {
  const result = await purchaseOrderWrapper.updatepurchaseorder(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_purchase_order_status_schema), async (req, res) => {
  const result = await purchaseOrderWrapper.updatepurchaseorderstatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await purchaseOrderWrapper.deletepurchaseorder(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
