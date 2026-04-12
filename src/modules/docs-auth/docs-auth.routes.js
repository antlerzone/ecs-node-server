/**
 * API 文档站 /docs 登录与登出。Portal 前端 /docs 页用 username + password 调用 login，成功后写 cookie，后续请求带 cookie 即视为已登录。
 * 仅 SaaS Admin 批准（can_access_docs=1）的 api_user 可登录；登录后可在 /docs 查看自己的 API key（token）用于调用 API。
 * POST /api/docs-auth/login   { username, password } -> Set-Cookie + { ok, user }
 * GET  /api/docs-auth/me      Cookie: docs_session   -> { ok, user: { id, username, token } } or 401（含 token 供 operator 复制）
 * POST /api/docs-auth/logout  -> Clear cookie + { ok: true }
 */
const express = require('express');
const router = express.Router();
const { login, sign, unsign, buildSetCookieHeader, clearCookieHeader, COOKIE_NAME } = require('./docs-auth.service');
const apiUserService = require('../api-user/api-user.service');

/**
 * POST /api/docs-auth/login
 * Body: { username, password }
 * Success: Set-Cookie docs_session=signed({ id, username }), 24h. Response: { ok: true, user: { id, username, token } }.
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = await login(username, password);
    if (!result.ok) {
      return res.status(401).json({ ok: false, reason: result.reason || 'INVALID_CREDENTIALS' });
    }
    const fullUser = await apiUserService.getById(result.user.id);
    const token = fullUser && fullUser.can_access_docs ? fullUser.token : null;
    const cookieValue = sign({ id: result.user.id, username: result.user.username });
    res.setHeader('Set-Cookie', buildSetCookieHeader(cookieValue));
    return res.json({ ok: true, user: { id: result.user.id, username: result.user.username, token } });
  } catch (err) {
    if (err.message && err.message.includes('DOCS_SESSION_SECRET')) {
      return res.status(503).json({ ok: false, reason: 'DOCS_AUTH_NOT_CONFIGURED' });
    }
    console.error('[docs-auth] login error:', err?.message || err);
    return res.status(500).json({ ok: false, reason: 'SERVER_ERROR' });
  }
});

function getDocsSessionFromRequest(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').find(c => c.trim().startsWith(COOKIE_NAME + '='));
  return match ? (match.split('=')[1]?.trim() || '') : null;
}

/**
 * GET /api/docs-auth/me
 * Reads docs_session cookie. Returns { ok: true, user: { id, username, token } } or 401. token 供 operator 在 /docs 页复制用于 API 调用。
 */
router.get('/me', async (req, res) => {
  const raw = getDocsSessionFromRequest(req);
  const payload = raw ? unsign(raw) : null;
  if (!payload || !payload.id || !payload.username) {
    return res.status(401).json({ ok: false, reason: 'NOT_LOGGED_IN' });
  }
  const fullUser = await apiUserService.getById(payload.id);
  const token = fullUser && fullUser.can_access_docs ? fullUser.token : null;
  return res.json({ ok: true, user: { id: payload.id, username: payload.username, token } });
});

/**
 * POST /api/docs-auth/logout
 * Clears docs_session cookie.
 */
router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearCookieHeader());
  return res.json({ ok: true });
});

module.exports = router;
