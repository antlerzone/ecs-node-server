/**
 * Help API – FAQ list + ticket submit for Wix Help page.
 */

const express = require('express');
const router = express.Router();
const { getFaqPage, submitTicket } = require('./help.service');

function getEmail(req) {
  return req?.body?.email ?? req?.query?.email ?? null;
}

/**
 * POST /api/help/faq
 * Body: { email?, page?, pageSize? }
 * Returns: { ok, items, totalCount }
 */
router.post('/faq', async (req, res) => {
  try {
    const page = req.body?.page != null ? req.body.page : 1;
    const pageSize = req.body?.pageSize != null ? req.body.pageSize : 10;
    const result = await getFaqPage(page, pageSize);
    res.json(result);
  } catch (err) {
    console.error('[help] faq', err);
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  }
});

/**
 * POST /api/help/ticket
 * Body: { email, mode?, description, video?, photo?, clientId?, ticketId? }
 * Returns: { ok, ticketId }
 */
router.post('/ticket', async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email || !String(email).trim()) {
      return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    }
    const payload = req.body || {};
    const result = await submitTicket(String(email).trim(), payload);
    res.json(result);
  } catch (err) {
    console.error('[help] ticket', err);
    if (err?.message === 'DESCRIPTION_REQUIRED') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
  }
});

module.exports = router;
