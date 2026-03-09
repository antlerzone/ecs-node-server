const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const wrapper = require('../wrappers/tag.wrapper');
const tagGroupRoutes = require('./tagGroup.routes');
const { create_tag_schema, update_tag_schema } = require('../validators/tag.validator');

router.use('/groups', tagGroupRoutes);

router.post('/', validate(create_tag_schema), async (req, res) => {
  const result = await wrapper.create(req, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.get('/', async (req, res) => {
  const result = await wrapper.list(req);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await wrapper.read(req, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_tag_schema), async (req, res) => {
  const result = await wrapper.update(req, req.params.id, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await wrapper.remove(req, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

module.exports = router;
