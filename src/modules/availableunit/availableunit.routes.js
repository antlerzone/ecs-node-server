/**
 * Available Unit API – public page (no login).
 * POST /api/availableunit/list – body: { subdomain?, propertyId?, sort?, page?, pageSize? }
 * With subdomain: one client's units + clientContact. Without: all clients' units, each item has clientContact.
 */

const express = require('express');
const router = express.Router();
const { getData } = require('./availableunit.service');

router.post('/list', async (req, res, next) => {
  try {
    const subdomain = req.body?.subdomain != null ? String(req.body.subdomain).trim() : '';
    const opts = {
      propertyId: req.body?.propertyId,
      sort: req.body?.sort,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      keyword: req.body?.keyword,
      country: req.body?.country
    };
    const result = await getData(subdomain || null, opts);
    if (!result.ok) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
