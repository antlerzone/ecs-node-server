/**
 * GET /api/download/:token – stream file and remove from store (one-time download).
 * No auth; token is short-lived and single-use.
 */

const express = require('express');
const router = express.Router();
const { get } = require('./download.store');

router.get('/:token', (req, res) => {
  const entry = get(req.params.token);
  if (!entry) {
    return res.status(404).send('Not found or expired');
  }
  const preview = String(req.query?.preview || '').trim();
  const mode = preview === '1' || preview.toLowerCase() === 'true' ? 'inline' : 'attachment';
  const disposition = `${mode}; filename="${encodeURIComponent(entry.filename)}"`;
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Content-Type', entry.mimeType);
  res.send(entry.buffer);
});

module.exports = router;
