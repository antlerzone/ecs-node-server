const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const wrapper = require('../wrappers/bankingTransfer.wrapper');
const {
  create_banking_transfer_schema,
  update_banking_transfer_schema,
  list_banking_transfer_schema,
  update_banking_transfer_status_schema
} = require('../validators/bankingTransfer.validator');

router.post('/', validate(create_banking_transfer_schema), async (req, res) => {
  const result = await wrapper.create(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_banking_transfer_schema, 'query'), async (req, res) => {
  const result = await wrapper.list(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await wrapper.read(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_banking_transfer_schema), async (req, res) => {
  const result = await wrapper.update(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_banking_transfer_status_schema), async (req, res) => {
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
