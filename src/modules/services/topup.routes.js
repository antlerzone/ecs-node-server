/**
 * Services – Topup API (alias for billing topup).
 * POST /api/services/topup/start – same as /api/billing/topup/start.
 * Body: { email, creditPlanId, returnUrl }. Returns { success, provider, url, referenceNumber }.
 */

const express = require('express');
const router = express.Router();
const { startNormalTopup } = require('../billing/topup.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

router.post('/start', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { creditPlanId, returnUrl } = req.body || {};
    const result = await startNormalTopup(email, { creditPlanId, returnUrl });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
