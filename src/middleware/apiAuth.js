/**
 * 双重认证：token + username
 * 请求头需同时提供：Authorization: Bearer <token>、X-API-Username: <username>
 * 校验 token 有效且对应用户的 username 与请求头一致，通过后 req.apiUser = 该用户
 */
const apiUserService = require('../modules/api-user/api-user.service');

const USERNAME_HEADER = 'x-api-username';

module.exports = async function (req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const username = (req.headers[USERNAME_HEADER] || '').trim();

  if (!token) {
    console.log('[apiAuth] 401', req.method, req.originalUrl || req.path, 'missing or invalid Authorization (Bearer token)');
    return res.status(401).json({ ok: false, message: 'missing or invalid Authorization (Bearer token)' });
  }
  if (!username) {
    console.log('[apiAuth] 401', req.method, req.originalUrl || req.path, 'missing X-API-Username header');
    return res.status(401).json({ ok: false, message: 'missing X-API-Username header' });
  }

  const user = await apiUserService.getByToken(token);
  if (!user) {
    console.log('[apiAuth] 401', req.method, req.originalUrl || req.path, 'invalid or inactive token');
    return res.status(401).json({ ok: false, message: 'invalid or inactive token' });
  }
  if (user.username !== username) {
    console.log('[apiAuth] 401', req.method, req.originalUrl || req.path, 'token and username mismatch');
    return res.status(401).json({ ok: false, message: 'token and username mismatch' });
  }

  req.apiUser = user;
  const path = (req.originalUrl || req.url || req.path || '').split('?')[0];
  console.log('[apiAuth] OK', req.method, path, 'apiUser.id=', user.id, 'apiUser.client_id=', user.client_id ?? '(null)');
  next();
};
