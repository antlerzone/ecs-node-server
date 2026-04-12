/**
 * API 文档站 /docs 登录：使用 api_user 表中 can_access_docs=1 的用户，username + password 校验。
 * Session 通过 signed cookie 存储，不依赖 JWT。
 */
const crypto = require('crypto');
const apiUserService = require('../api-user/api-user.service');

const COOKIE_NAME = 'docs_session';
const MAX_AGE_SEC = 24 * 60 * 60; // 24h

function getSecret() {
  const secret = process.env.DOCS_SESSION_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error('DOCS_SESSION_SECRET or SESSION_SECRET required for docs auth');
  return secret;
}

function sign(payload) {
  const secret = getSecret();
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
}

function unsign(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  try {
    const decoded = JSON.parse(Buffer.from(cookieValue, 'base64url').toString('utf8'));
    const { data, sig } = decoded;
    const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('hex');
    if (sig !== expected) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * 校验 username + password，且 can_access_docs=1。成功返回 { ok: true, user }，失败返回 { ok: false, reason }。
 */
async function login(username, password) {
  if (!username || typeof username !== 'string' || !username.trim()) {
    return { ok: false, reason: 'USERNAME_REQUIRED' };
  }
  if (!password || typeof password !== 'string') {
    return { ok: false, reason: 'PASSWORD_REQUIRED' };
  }
  const user = await apiUserService.verifyForDocsLogin(username.trim(), password);
  if (!user) return { ok: false, reason: 'INVALID_CREDENTIALS' };
  return { ok: true, user: { id: user.id, username: user.username } };
}

/**
 * 生成 docs session cookie 的 Set-Cookie 值（含 path、httpOnly、maxAge、sameSite）。
 */
function buildSetCookieHeader(value, maxAgeSec = MAX_AGE_SEC) {
  const opts = [
    `Path=/`,
    `HttpOnly`,
    `Max-Age=${maxAgeSec}`,
    `SameSite=Lax`,
  ];
  const secure = process.env.NODE_ENV === 'production';
  if (secure) opts.push('Secure');
  return `${COOKIE_NAME}=${value}; ${opts.join('; ')}`;
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`;
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_SEC,
  getSecret,
  sign,
  unsign,
  login,
  buildSetCookieHeader,
  clearCookieHeader,
};
