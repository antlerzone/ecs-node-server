const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const wrapper = require('../wrappers/productBundle.wrapper');
const {
  create_product_bundle_schema,
  update_product_bundle_schema,
  archive_product_bundle_schema
} = require('../validators/productBundle.validator');

router.post('/', validate(create_product_bundle_schema), async (req, res) => {
  const result = await wrapper.create(req, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.status(201).json(result);
});

router.get('/:id', async (req, res) => {
  const result = await wrapper.read(req, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_product_bundle_schema), async (req, res) => {
  const result = await wrapper.update(req, req.params.id, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.patch('/:id', validate(archive_product_bundle_schema), async (req, res) => {
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
