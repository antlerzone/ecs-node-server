const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const quoteWrapper = require('../wrappers/quote.wrapper');
const {
  create_quote_schema,
  update_quote_schema,
  list_quote_schema,
  update_quote_status_schema
} = require('../validators/quote.validator');

router.post('/', validate(create_quote_schema), async (req, res) => {
  const result = await quoteWrapper.createquote(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_quote_schema, 'query'), async (req, res) => {
  const result = await quoteWrapper.listquotes(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await quoteWrapper.readquote(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_quote_schema), async (req, res) => {
  const result = await quoteWrapper.updatequote(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_quote_status_schema), async (req, res) => {
  const result = await quoteWrapper.updatequotestatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await quoteWrapper.deletequote(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
