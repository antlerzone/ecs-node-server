const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const wrapper = require('../wrappers/location.wrapper');
const {
  create_location_schema,
  update_location_schema,
  list_location_schema,
  archive_location_schema
} = require('../validators/location.validator');

router.post('/', validate(create_location_schema), async (req, res) => {
  const result = await wrapper.create(req, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.get('/', validate(list_location_schema, 'query'), async (req, res) => {
  const result = await wrapper.list(req, req.query);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await wrapper.read(req, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_location_schema), async (req, res) => {
  const result = await wrapper.update(req, req.params.id, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.patch('/:id', validate(archive_location_schema), async (req, res) => {
  const result = await wrapper.archive(req, req.params.id, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await wrapper.remove(req, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

module.exports = router;
