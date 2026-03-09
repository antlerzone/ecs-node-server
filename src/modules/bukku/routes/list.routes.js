const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const wrapper = require('../wrappers/list.wrapper');
const { get_lists_schema } = require('../validators/list.validator');

router.post('/', validate(get_lists_schema), async (req, res) => {
  const result = await wrapper.getLists(req, req.body);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

module.exports = router;
