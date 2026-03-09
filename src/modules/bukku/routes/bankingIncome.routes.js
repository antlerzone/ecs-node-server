const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const wrapper = require('../wrappers/bankingIncome.wrapper');
const {
  create_banking_income_schema,
  update_banking_income_schema,
  list_banking_income_schema,
  update_banking_income_status_schema
} = require('../validators/bankingIncome.validator');

router.post('/', validate(create_banking_income_schema), async (req, res) => {
  const result = await wrapper.create(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_banking_income_schema, 'query'), async (req, res) => {
  const result = await wrapper.list(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await wrapper.read(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_banking_income_schema), async (req, res) => {
  const result = await wrapper.update(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_banking_income_status_schema), async (req, res) => {
  const result = await wrapper.updateStatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await wrapper.remove(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
