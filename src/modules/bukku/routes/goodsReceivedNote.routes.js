const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const goodsReceivedNoteWrapper = require('../wrappers/goodsReceivedNote.wrapper');
const {
  create_goods_received_note_schema,
  update_goods_received_note_schema,
  list_goods_received_note_schema,
  update_goods_received_note_status_schema
} = require('../validators/goodsReceivedNote.validator');

router.post('/', validate(create_goods_received_note_schema), async (req, res) => {
  const result = await goodsReceivedNoteWrapper.creategoodsreceivednote(req, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/', validate(list_goods_received_note_schema, 'query'), async (req, res) => {
  const result = await goodsReceivedNoteWrapper.listgoodsreceivednotes(req, req.query);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await goodsReceivedNoteWrapper.readgoodsreceivednote(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_goods_received_note_schema), async (req, res) => {
  const result = await goodsReceivedNoteWrapper.updategoodsreceivednote(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch('/:id', validate(update_goods_received_note_status_schema), async (req, res) => {
  const result = await goodsReceivedNoteWrapper.updategoodsreceivednotestatus(req, req.params.id, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await goodsReceivedNoteWrapper.deletegoodsreceivednote(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
