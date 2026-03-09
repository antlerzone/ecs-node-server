const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const purchasePaymentWrapper = require('../wrappers/purchasePayment.wrapper');
const {
  create_purchase_payment_schema,
  update_purchase_payment_schema,
  list_purchase_payment_schema,
  update_purchase_payment_status_schema
} = require('../validators/purchasePayment.validator');

router.post('/', validate(create_purchase_payment_schema), async (req, res) => {
  const result = await purchasePaymentWrapper.createpurchasepayment(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_purchase_payment_schema, 'query'), async (req, res) => {
  const result = await purchasePaymentWrapper.listpurchasepayments(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await purchasePaymentWrapper.readpurchasepayment(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_purchase_payment_schema), async (req, res) => {
  const result = await purchasePaymentWrapper.updatepurchasepayment(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_purchase_payment_status_schema), async (req, res) => {
  const result = await purchasePaymentWrapper.updatepurchasepaymentstatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await purchasePaymentWrapper.deletepurchasepayment(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
