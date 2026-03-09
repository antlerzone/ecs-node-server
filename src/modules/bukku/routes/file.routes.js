const express = require('express');
const multer = require('multer');
const router = express.Router();
const validate = require('../../../middleware/validate');
const wrapper = require('../wrappers/file.wrapper');
const { list_file_schema } = require('../validators/file.validator');

const uploadMiddleware = multer({ storage: multer.memoryStorage() }).single('file');

router.post('/', uploadMiddleware, async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'file is required' });
  const result = await wrapper.upload(req, req.file.buffer, req.file.originalname);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.get('/', validate(list_file_schema, 'query'), async (req, res) => {
  const result = await wrapper.list(req, req.query);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const result = await wrapper.read(req, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

module.exports = router;
