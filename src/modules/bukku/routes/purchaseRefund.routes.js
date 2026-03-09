const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const purchaseRefundWrapper = require('../wrappers/purchaseRefund.wrapper');
const {
  create_purchase_refund_schema,
  update_purchase_refund_schema,
  list_purchase_refund_schema,
  update_purchase_refund_status_schema
} = require('../validators/purchaseRefund.validator');

router.post('/', validate(create_purchase_refund_schema), async (req, res) => {
  const result = await purchaseRefundWrapper.createpurchaserefund(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_purchase_refund_schema, 'query'), async (req, res) => {
  const result = await purchaseRefundWrapper.listpurchaserefunds(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await purchaseRefundWrapper.readpurchaserefund(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_purchase_refund_schema), async (req, res) => {
  const result = await purchaseRefundWrapper.updatepurchaserefund(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_purchase_refund_status_schema), async (req, res) => {
  const result = await purchaseRefundWrapper.updatepurchaserefundstatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await purchaseRefundWrapper.deletepurchaserefund(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
