/**
 * Available Unit API – public page (no login).
 * POST /api/availableunit/list – body: { subdomain?, propertyId?, sort?, page?, pageSize? }
 * With subdomain: one client's units + clientContact. Without: all clients' units, each item has clientContact.
 */

const express = require('express');
const router = express.Router();
const { getData } = require('./availableunit.service');

router.post('/list', async (req, res, next) => {
  console.log('[availableunit] POST /list hit', {
    path: req.path,
    url: req.originalUrl,
    method: req.method,
    body: req.body,
    contentType: req.get('content-type'),
  });
  try {
    const subdomain = req.body?.subdomain != null ? String(req.body.subdomain).trim() : '';
    const opts = {
      propertyId: req.body?.propertyId,
      sort: req.body?.sort,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      keyword: req.body?.keyword,
      country: req.body?.country,
      priceMin: req.body?.priceMin,
      priceMax: req.body?.priceMax,
      listingScope: req.body?.listingScope,
      priceCompareCurrency: req.body?.priceCompareCurrency
    };
    const result = await getData(subdomain || null, opts);
    console.log('[availableunit] getData result', { ok: result.ok, itemsCount: result.items?.length, total: result.total });
    if (!result.ok) {
      console.log('[availableunit] returning 404', result);
      return res.status(404).json(result);
    }
    res.json(result);
    console.log('[availableunit] 200 sent');
  } catch (err) {
    console.error('[availableunit] list error', err);
    next(err);
  }
});

module.exports = router;
