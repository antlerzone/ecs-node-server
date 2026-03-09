const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const wrapper = require('../wrappers/account.wrapper');
const { list_account_schema } = require('../validators/account.validator');

router.get('/', validate(list_account_schema, 'query'), async (req, res) => {
  const result = await wrapper.list(req, req.query);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await wrapper.read(req, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

module.exports = router;
