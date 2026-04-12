/**
 * Sandbox routes – backfill receipturl for isPaid RentalCollection without receipturl.
 * POST /api/sandbox/backfill-receipturl  Body: { email } or { clientId }
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const { backfillReceiptUrl } = require('./sandbox.service');

async function requireClient(req, res, next) {
  const clientId = req.body?.clientId ?? req.query?.clientId ?? null;
  const email = req.body?.email ?? req.query?.email ?? null;
  if (clientId) {
    req.clientId = clientId;
    return next();
  }
  if (!email) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL_OR_CLIENT_ID', message: 'Provide body.email or body.clientId' });
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) {
    return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
  }
  const id = ctx.client?.id;
  if (!id) {
    return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
  }
  req.clientId = id;
  next();
}

/** POST /api/sandbox/backfill-receipturl – backfill receipturl for isPaid rental collections missing it */
router.post('/backfill-receipturl', requireClient, async (req, res, next) => {
  try {
    const result = await backfillReceiptUrl(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
