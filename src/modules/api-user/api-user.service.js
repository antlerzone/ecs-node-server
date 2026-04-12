/**
 * API 用户：token 自动生成，密码单独 hash 储存（每用户独立，不建议用 ECS 登入密码）
 */
const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../../config/db');

const SALT_ROUNDS = 10;
const TOKEN_BYTES = 32;

function generateToken() {
  return require('crypto').randomBytes(TOKEN_BYTES).toString('hex');
}

/** 生成随机 API 用户名，如 apiuser_abc12def */
function generateUsername(clientId) {
  const suffix = (clientId || require('crypto').randomUUID()).replace(/-/g, '').slice(0, 8);
  return `apiuser_${suffix}`;
}

/** 生成随机密码（仅创建时返回一次，供 admin 抄送 operator） */
function generatePassword() {
  return require('crypto').randomBytes(12).toString('base64url').slice(0, 16);
}

async function hashPassword(plain) {
  if (!plain || typeof plain !== 'string') return null;
  return bcrypt.hash(plain.trim(), SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain.trim(), hash);
}

/**
 * 新增 API 用户：username 必填，password 可选；token 自动生成。can_access_docs、client_id 可选。
 */
async function create({ username, password, can_access_docs = 0, client_id = null }) {
  const id = randomUUID();
  const token = generateToken();
  const password_hash = await hashPassword(password);
  const docs = can_access_docs ? 1 : 0;

  await pool.query(
    'INSERT INTO api_user (id, username, password_hash, token, status, can_access_docs, client_id) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [id, username.trim(), password_hash, token, docs, client_id || null]
  );

  const [rows] = await pool.query(
    'SELECT id, username, token, status, can_access_docs, client_id, created_at FROM api_user WHERE id = ?',
    [id]
  );
  return rows[0];
}

/**
 * 为某 client 创建 API Docs 用户：自动生成 username、password，can_access_docs=1。返回 user + plainPassword（仅此一次）。
 */
async function createForClient(clientId) {
  const existing = await getByClientId(clientId);
  if (existing) {
    return { ok: false, reason: 'CLIENT_ALREADY_HAS_API_DOCS_USER' };
  }
  const username = generateUsername(clientId);
  const plainPassword = generatePassword();
  const user = await create({
    username,
    password: plainPassword,
    can_access_docs: 1,
    client_id: clientId
  });
  return { ok: true, user: { id: user.id, username: user.username, token: user.token, client_id: user.client_id }, plainPassword };
}

async function getByClientId(clientId) {
  if (!clientId) return null;
  const [rows] = await pool.query(
    'SELECT id, username, token, status, can_access_docs, client_id FROM api_user WHERE client_id = ? AND can_access_docs = 1 AND status = 1 LIMIT 1',
    [clientId]
  );
  return rows[0] || null;
}

async function list() {
  const [rows] = await pool.query(
    'SELECT id, username, token, status, can_access_docs, client_id, created_at, updated_at FROM api_user ORDER BY created_at DESC'
  );
  return rows;
}

async function getById(id) {
  const [rows] = await pool.query(
    'SELECT id, username, token, status, can_access_docs, client_id, created_at, updated_at FROM api_user WHERE id = ?',
    [id]
  );
  return rows[0] || null;
}

async function getByUsername(username) {
  if (!username || typeof username !== 'string') return null;
  const [rows] = await pool.query(
    'SELECT id, username, password_hash, token, status, can_access_docs FROM api_user WHERE username = ? LIMIT 1',
    [username.trim()]
  );
  return rows[0] || null;
}

/**
 * 校验 API 文档登录：username + password，且 can_access_docs = 1、status = 1。成功返回用户（不含 password_hash），失败返回 null。
 */
async function verifyForDocsLogin(username, password) {
  const user = await getByUsername(username);
  if (!user || !user.can_access_docs || user.status !== 1) return null;
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;
  return {
    id: user.id,
    username: user.username,
    token: user.token,
    status: user.status,
    can_access_docs: user.can_access_docs
  };
}

async function updateCanAccessDocs(id, canAccessDocs) {
  const v = canAccessDocs ? 1 : 0;
  await pool.query('UPDATE api_user SET can_access_docs = ? WHERE id = ?', [v, id]);
  return getById(id);
}

async function getByToken(token) {
  if (!token) return null;
  const [rows] = await pool.query(
    'SELECT id, username, token, status, client_id FROM api_user WHERE token = ? AND status = 1',
    [token]
  );
  return rows[0] || null;
}

async function update(id, { username, status, can_access_docs }) {
  const updates = [];
  const params = [];
  if (username !== undefined) {
    updates.push('username = ?');
    params.push(username.trim());
  }
  if (status !== undefined) {
    updates.push('status = ?');
    params.push(status ? 1 : 0);
  }
  if (can_access_docs !== undefined) {
    updates.push('can_access_docs = ?');
    params.push(can_access_docs ? 1 : 0);
  }
  if (updates.length === 0) return getById(id);
  params.push(id);
  await pool.query(`UPDATE api_user SET ${updates.join(', ')} WHERE id = ?`, params);
  return getById(id);
}

async function updatePassword(id, newPassword) {
  const password_hash = await hashPassword(newPassword);
  await pool.query('UPDATE api_user SET password_hash = ? WHERE id = ?', [password_hash, id]);
  return getById(id);
}

async function remove(id) {
  const [r] = await pool.query('DELETE FROM api_user WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

module.exports = {
  create,
  createForClient,
  list,
  getById,
  getByToken,
  getByUsername,
  getByClientId,
  verifyForDocsLogin,
  updateCanAccessDocs,
  update,
  updatePassword,
  remove,
  verifyPassword,
  generateUsername,
  generatePassword,
  getByTokenWithPasswordHash: async (token) => {
    if (!token) return null;
    const [rows] = await pool.query(
      'SELECT id, username, token, password_hash, status FROM api_user WHERE token = ? AND status = 1',
      [token]
    );
    return rows[0] || null;
  }
};
