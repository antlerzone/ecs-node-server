/**
 * TTLock 开放平台：为 client 创建子账号（User register）。
 * 使用 app 的 clientId + clientSecret，不需 accessToken。
 * 文档：https://euopen.ttlock.com/doc/api/v3/user/register
 */

const crypto = require('crypto');

const REGISTER_URL = 'https://euapi.ttlock.com/v3/user/register';

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

/**
 * 注册一个 TTLock 用户（子账号）。成功后该 username+password 可用来拿 token，存 client_integration 即可。
 * @param {{ username: string, password: string }} opts - username 建议用 client 唯一标识（如 subdomain）；password 明文，内部会 MD5。
 * @returns {Promise<{ username?: string, errcode?: number, errmsg?: string }>}
 */
async function registerUser({ username, password }) {
  const clientId = process.env.TTLOCK_CLIENT_ID;
  const clientSecret = process.env.TTLOCK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('TTLOCK_APP_CREDENTIALS_MISSING');
  if (!username || !password) throw new Error('TTLOCK_REGISTER_USERNAME_PASSWORD_REQUIRED');

  const body = new URLSearchParams({
    clientId,
    clientSecret,
    username: String(username).trim(),
    password: md5(String(password)),
    date: String(Date.now())
  }).toString();

  const res = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json();
  if (json.errcode === undefined || json.errcode === 0) {
    const actualUsername = json.username ?? json.Username ?? String(username).trim();
    return { ...json, username: actualUsername };
  }
  return json;
}

module.exports = { registerUser };
