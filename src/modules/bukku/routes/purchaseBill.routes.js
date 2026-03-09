const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const purchaseBillWrapper = require('../wrappers/purchaseBill.wrapper');
const {
  create_purchase_bill_schema,
  update_purchase_bill_schema,
  list_purchase_bill_schema,
  update_purchase_bill_status_schema
} = require('../validators/purchaseBill.validator');

router.post('/', validate(create_purchase_bill_schema), async (req, res) => {
  const result = await purchaseBillWrapper.createpurchasebill(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_purchase_bill_schema, 'query'), async (req, res) => {
  const result = await purchaseBillWrapper.listpurchasebills(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await purchaseBillWrapper.readpurchasebill(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_purchase_bill_schema), async (req, res) => {
  const result = await purchaseBillWrapper.updatepurchasebill(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_purchase_bill_status_schema), async (req, res) => {
  const result = await purchaseBillWrapper.updatepurchasebillstatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await purchaseBillWrapper.deletepurchasebill(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
