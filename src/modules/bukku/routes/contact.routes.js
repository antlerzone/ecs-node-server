const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const wrapper = require('../wrappers/contact.wrapper');
const contactGroupRoutes = require('./contactGroup.routes');
const {
  create_contact_schema,
  update_contact_schema,
  list_contact_schema,
  archive_contact_schema
} = require('../validators/contact.validator');

router.use('/groups', contactGroupRoutes);

router.post('/', validate(create_contact_schema), async (req, res) => {
  const result = await wrapper.create(req, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.status(201).json(result);
});

router.get('/', validate(list_contact_schema, 'query'), async (req, res) => {
  const result = await wrapper.list(req, req.query);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await wrapper.read(req, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_contact_schema), async (req, res) => {
  const result = await wrapper.update(req, req.params.id, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.patch('/:id', validate(archive_contact_schema), async (req, res) => {
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
