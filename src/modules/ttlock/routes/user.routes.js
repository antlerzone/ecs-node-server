/**
 * TTLock 子账号相关路由（SaaS – client 来自 clientresolver）。
 * POST /ensure-subuser：为当前 client 确保 TTLock 子账号（无则用 subdomain 注册并写入 client_integration）。
 */

const express = require('express');
const router = express.Router();
const { ensureTTLockSubuser } = require('../lib/ttlockSubuser');

function clientId(req) {
  const id = req?.client?.id;
  if (!id) throw new Error('missing client');
  return id;
}

function handleErr(res, err) {
  const msg = err?.message || 'unknown';
  if (msg === 'missing client') return res.status(400).json({ ok: false, error: msg });
  if (msg === 'TTLOCK_NOT_CONFIGURED' || msg === 'TTLOCK_APP_CREDENTIALS_MISSING' || msg === 'TTLOCK_INTEGRATION_ROW_MISSING') {
    return res.status(403).json({ ok: false, error: msg });
  }
  if (msg === 'CLIENT_SUBDOMAIN_REQUIRED') return res.status(400).json({ ok: false, error: msg });
  if (msg.startsWith('TTLOCK_REGISTER_FAILED_')) return res.status(400).json({ ok: false, error: msg });
  return res.status(500).json({ ok: false, error: msg });
}

/* 为当前 client 确保 TTLock 子账号（无则注册并写入 client_integration） */
router.post('/ensure-subuser', async (req, res) => {
  try {
    const result = await ensureTTLockSubuser(clientId(req));
    res.json({ ok: true, data: result });
  } catch (err) {
    handleErr(res, err);
  }
});

module.exports = router;
