const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const purchaseCreditNoteWrapper = require('../wrappers/purchaseCreditNote.wrapper');
const {
  create_purchase_credit_note_schema,
  update_purchase_credit_note_schema,
  list_purchase_credit_note_schema,
  update_purchase_credit_note_status_schema
} = require('../validators/purchaseCreditNote.validator');

router.post('/', validate(create_purchase_credit_note_schema), async (req, res) => {
  const result = await purchaseCreditNoteWrapper.createpurchasecreditnote(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_purchase_credit_note_schema, 'query'), async (req, res) => {
  const result = await purchaseCreditNoteWrapper.listpurchasecreditnotes(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await purchaseCreditNoteWrapper.readpurchasecreditnote(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_purchase_credit_note_schema), async (req, res) => {
  const result = await purchaseCreditNoteWrapper.updatepurchasecreditnote(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_purchase_credit_note_status_schema), async (req, res) => {
  const result = await purchaseCreditNoteWrapper.updatepurchasecreditnotestatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await purchaseCreditNoteWrapper.deletepurchasecreditnote(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
