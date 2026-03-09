const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const wrapper = require('../wrappers/product.wrapper');
const productBundleRoutes = require('./productBundle.routes');
const productGroupRoutes = require('./productGroup.routes');
const {
  create_product_schema,
  update_product_schema,
  list_product_schema,
  archive_product_schema
} = require('../validators/product.validator');

router.use('/bundles', productBundleRoutes);
router.use('/groups', productGroupRoutes);

router.post('/', validate(create_product_schema), async (req, res) => {
  const result = await wrapper.create(req, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.status(201).json(result);
});

router.get('/', validate(list_product_schema, 'query'), async (req, res) => {
  const result = await wrapper.list(req, req.query);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await wrapper.read(req, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.put('/:id', validate(update_product_schema), async (req, res) => {
  const result = await wrapper.update(req, req.params.id, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.patch('/:id', validate(archive_product_schema), async (req, res) => {
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
