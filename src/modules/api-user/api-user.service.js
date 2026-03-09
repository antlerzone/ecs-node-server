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

async function hashPassword(plain) {
  if (!plain || typeof plain !== 'string') return null;
  return bcrypt.hash(plain.trim(), SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain.trim(), hash);
}

/**
 * 新增 API 用户：username 必填，password 可选；token 自动生成
 */
async function create({ username, password }) {
  const id = randomUUID();
  const token = generateToken();
  const password_hash = await hashPassword(password);

  await pool.query(
    'INSERT INTO api_user (id, username, password_hash, token, status) VALUES (?, ?, ?, ?, 1)',
    [id, username.trim(), password_hash, token]
  );

  const [rows] = await pool.query('SELECT id, username, token, status, created_at FROM api_user WHERE id = ?', [id]);
  return rows[0];
}

async function list() {
  const [rows] = await pool.query(
    'SELECT id, username, token, status, created_at, updated_at FROM api_user ORDER BY created_at DESC'
  );
  return rows;
}

async function getById(id) {
  const [rows] = await pool.query(
    'SELECT id, username, token, status, created_at, updated_at FROM api_user WHERE id = ?',
    [id]
  );
  return rows[0] || null;
}

async function getByToken(token) {
  if (!token) return null;
  const [rows] = await pool.query(
    'SELECT id, username, token, status FROM api_user WHERE token = ? AND status = 1',
    [token]
  );
  return rows[0] || null;
}

async function update(id, { username, status }) {
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
  list,
  getById,
  getByToken,
  update,
  updatePassword,
  remove,
  verifyPassword,
  getByTokenWithPasswordHash: async (token) => {
    if (!token) return null;
    const [rows] = await pool.query(
      'SELECT id, username, token, password_hash, status FROM api_user WHERE token = ? AND status = 1',
      [token]
    );
    return rows[0] || null;
  }
};
