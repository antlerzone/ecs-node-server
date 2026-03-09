/**
 * Access context API – migrated from Wix backend/access/manage.jsw.
 * Frontend (Wix JSW) calls with email to get access context.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('./access.service');

/**
 * POST /api/access/context
 * Body: { email: string }
 * Returns: { ok, reason, staff?, client?, plan?, capability?, credit?, expired? }
 */
router.post('/context', async (req, res, next) => {
  try {
    const email = req.body?.email;
    const result = await getAccessContextByEmail(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/access/context?email=xxx
 * Same response as POST (for convenience).
 */
router.get('/context', async (req, res, next) => {
  try {
    const email = req.query?.email;
    const result = await getAccessContextByEmail(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
