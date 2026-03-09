const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const creditNoteWrapper = require('../wrappers/creditNote.wrapper');
const {
  create_credit_note_schema,
  update_credit_note_schema,
  list_credit_note_schema,
  update_credit_note_status_schema
} = require('../validators/creditNote.validator');

router.post('/', validate(create_credit_note_schema), async (req, res) => {
  const result = await creditNoteWrapper.createcreditnote(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_credit_note_schema, 'query'), async (req, res) => {
  const result = await creditNoteWrapper.listcreditnotes(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await creditNoteWrapper.readcreditnote(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_credit_note_schema), async (req, res) => {
  const result = await creditNoteWrapper.updatecreditnote(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_credit_note_status_schema), async (req, res) => {
  const result = await creditNoteWrapper.updatecreditnotestatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await creditNoteWrapper.deletecreditnote(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
