const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const refundWrapper = require('../wrappers/refund.wrapper');
const {
  create_refund_schema,
  update_refund_schema,
  list_refund_schema,
  update_refund_status_schema
} = require('../validators/refund.validator');

router.post('/', validate(create_refund_schema), async (req, res) => {
  const result = await refundWrapper.createrefund(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_refund_schema, 'query'), async (req, res) => {
  const result = await refundWrapper.listrefunds(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await refundWrapper.readrefund(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_refund_schema), async (req, res) => {
  const result = await refundWrapper.updaterefund(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_refund_status_schema), async (req, res) => {
  const result = await refundWrapper.updaterefundstatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await refundWrapper.deleterefund(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
