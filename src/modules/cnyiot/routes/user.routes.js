/**
 * CNYIoT 租客（User）与 client 子账号（ensure subuser、改密）路由。
 */

const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const userWrapper = require('../wrappers/user.wrapper');
const { ensureClientCnyiotSubuser, saveSubuserPassword } = require('../lib/cnyiotSubuser');
const { subuser_password_schema } = require('../validators/user.validator');

function clientId(req) {
  const id = req?.client?.id;
  if (!id) throw new Error('missing client');
  return id;
}

function handleErr(res, err) {
  const msg = err?.message || 'unknown';
  if (msg === 'missing client') return res.status(400).json({ ok: false, error: msg });
  if (msg === 'CNYIOT_NOT_CONFIGURED' || msg === 'CLIENT_SUBDOMAIN_REQUIRED' || msg === 'SUBDOMAIN_ALREADY_USED') {
    return res.status(403).json({ ok: false, error: msg });
  }
  if (msg.startsWith('CNYIOT_')) return res.status(400).json({ ok: false, error: msg });
  return res.status(500).json({ ok: false, error: msg });
}

/** 租客列表 */
router.get('/', async (req, res) => {
  try {
    const data = await userWrapper.getUsers(clientId(req));
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/** 确保当前 client 有一个 CNYIoT 子账号（uI=subdomain），自动建并写入 client_integration */
router.post('/ensure-subuser', async (req, res) => {
  try {
    const result = await ensureClientCnyiotSubuser(clientId(req));
    res.json({ ok: true, data: result });
  } catch (err) {
    handleErr(res, err);
  }
});

/** 修改子账号密码（仅更新 client_integration；若需同步 CNYIoT 可再调 rstPsw） */
router.put('/subuser-password', validate(subuser_password_schema), async (req, res) => {
  try {
    await saveSubuserPassword(clientId(req), req.body.password);
    res.json({ ok: true });
  } catch (err) {
    handleErr(res, err);
  }
});

module.exports = router;
