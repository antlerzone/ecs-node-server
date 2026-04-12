/**
 * 对外同步（无 Portal apiAuth）：Antlerzone 物业、Google Sheet 排程等。
 * Bearer / x-api-key 优先匹配 `cln_client_integration` 里 B2B 集成 API Key；可选回退 env（见 service）。
 */

const express = require('express');
const router = express.Router();
const { handleAntlerzonePropertySync } = require('./cleanlemon-antlerzone-sync.service');
const { handleGoogleSheetSchedule } = require('./cleanlemon-google-sheet-schedule.service');

router.post('/antlerzone-property', async (req, res) => {
  try {
    const out = await handleAntlerzonePropertySync(req);
    res.json(out);
  } catch (e) {
    const code = e && e.code;
    if (code === 'UNAUTHORIZED') {
      return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    }
    if (code === 'BAD_REQUEST') {
      return res.status(400).json({ ok: false, reason: 'BAD_REQUEST', message: e.message });
    }
    if (code === 'NO_OPERATOR_ID' || code === 'SERVER_MISCONFIGURED') {
      return res.status(503).json({ ok: false, reason: code, message: e.message });
    }
    if (code === 'MIGRATION_REQUIRED') {
      return res.status(503).json({ ok: false, reason: code, message: e.message });
    }
    console.error('[cleanlemon-antlerzone-sync]', e);
    return res.status(500).json({ ok: false, reason: 'INTERNAL_ERROR' });
  }
});

/** Google Apps Script → `cln_schedule`；鉴权仅 Bearer / x-api-key（见 handleGoogleSheetSchedule） */
router.post('/google-sheet-schedule', async (req, res) => {
  try {
    const out = await handleGoogleSheetSchedule(req);
    res.json(out);
  } catch (e) {
    const code = e && e.code;
    if (code === 'UNAUTHORIZED') {
      return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    }
    if (code === 'BAD_REQUEST') {
      return res.status(400).json({ ok: false, reason: 'BAD_REQUEST', message: e.message });
    }
    if (code === 'SERVER_MISCONFIGURED') {
      return res.status(503).json({ ok: false, reason: code, message: e.message });
    }
    console.error('[cleanlemon-google-sheet-schedule]', e);
    return res.status(500).json({ ok: false, reason: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
