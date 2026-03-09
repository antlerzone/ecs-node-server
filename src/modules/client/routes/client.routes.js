/**
 * Client 相关 API：同步子表（integration / profile / pricingplandetail / credit）
 */
const express = require('express');
const router = express.Router();
const pool = require('../../../config/db');
const { syncAll } = require('../../../services/client-subtables');

/**
 * POST /api/client/sync-subtables
 * Body: { clientWixId? or clientId?, integration?, profile?, pricingplandetail?, credit? }
 * 四个 array 可选，传了哪个就同步哪张子表（先删该 client 下旧数据再插入）。
 */
router.post('/sync-subtables', async (req, res, next) => {
  try {
    const body = req.body || {};
    const clientId = body.clientId || null;
    const clientWixId = body.clientWixId || null;
    if (!clientId && !clientWixId) {
      return res.status(400).json({ ok: false, message: 'clientId or clientWixId required' });
    }
    const integration = Array.isArray(body.integration) ? body.integration : null;
    const profile = Array.isArray(body.profile) ? body.profile : null;
    const pricingplandetail = Array.isArray(body.pricingplandetail) ? body.pricingplandetail : null;
    const credit = Array.isArray(body.credit) ? body.credit : null;
    if (!integration && !profile && !pricingplandetail && !credit) {
      return res.status(400).json({ ok: false, message: 'at least one of integration, profile, pricingplandetail, credit required' });
    }

    const conn = await pool.getConnection();
    try {
      const result = await syncAll(conn, {
        clientId,
        clientWixId,
        integration: integration || undefined,
        profile: profile || undefined,
        pricingplandetail: pricingplandetail || undefined,
        credit: credit || undefined,
      });
      res.json({ ok: true, ...result });
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
