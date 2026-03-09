/**
 * Enquiry API – public page (no auth).
 * GET/POST /api/enquiry/plans, /addons, /banks, POST /api/enquiry/submit
 */

const express = require('express');
const router = express.Router();
const {
  getPlansPublic,
  getAddonsPublic,
  getBanksPublic,
  submitEnquiry
} = require('./enquiry.service');

router.get('/plans', async (req, res, next) => {
  try {
    const items = await getPlansPublic();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.post('/plans', async (req, res, next) => {
  try {
    const items = await getPlansPublic();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.get('/addons', async (req, res, next) => {
  try {
    const items = await getAddonsPublic();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.post('/addons', async (req, res, next) => {
  try {
    const items = await getAddonsPublic();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.get('/banks', async (req, res, next) => {
  try {
    const result = await getBanksPublic();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/banks', async (req, res, next) => {
  try {
    const result = await getBanksPublic();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/enquiry/submit
 * Body: { title, email, currency?, country?, profilePhotoUrl?, contact?, accountNumber?, bankId? }
 * Returns: { ok, clientId?, staffId?, email? } or { ok: false, reason }
 */
router.post('/submit', async (req, res, next) => {
  try {
    const result = await submitEnquiry(req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
