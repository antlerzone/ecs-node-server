const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const invoicepaymentWrapper = require('../wrappers/invoicepayment.wrapper');
const {
  create_payment_schema,
  update_payment_schema,
  list_payment_schema,
  update_payment_status_schema
} = require('../validators/invoicepayment.validator');

router.post('/', validate(create_payment_schema), async (req, res) => {
  const result = await invoicepaymentWrapper.createinvoicepayment(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_payment_schema, 'query'), async (req, res) => {
  const result = await invoicepaymentWrapper.listinvoicepayments(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await invoicepaymentWrapper.readinvoicepayment(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_payment_schema), async (req, res) => {
  const result = await invoicepaymentWrapper.updateinvoicepayment(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_payment_status_schema), async (req, res) => {
  const result = await invoicepaymentWrapper.updateinvoicepaymentstatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await invoicepaymentWrapper.deleteinvoicepayment(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
