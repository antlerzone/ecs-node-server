/**
 * 把 SaaS Admin 邮箱加入指定 client 的 staffdetail，这样登入 Portal 时 getMemberRoles 会返回 staff，
 * 前端就会显示 Operator 卡片（同时保留 SaaS Admin 卡片）。
 * Usage: node scripts/add-saas-admin-as-operator-staff.js
 * Env: KEEP_CLIENT_ID (default 817f6510...), SAAS_ADMIN_EMAIL (default colivingmanagement@gmail.com)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const CLIENT_ID = process.env.KEEP_CLIENT_ID || '817f6510-47ac-4f8f-9828-d2fd91cb406f';
const SAAS_ADMIN_EMAIL = (process.env.SAAS_ADMIN_EMAIL || 'colivingmanagement@gmail.com').trim().toLowerCase();

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    timezone: '+00:00'
  });

  const conn = await pool.getConnection();
  try {
    const [clientRows] = await conn.query(
      'SELECT id, title FROM operatordetail WHERE id = ? LIMIT 1',
      [CLIENT_ID]
    );
    if (!clientRows.length) {
      throw new Error('Client not found: ' + CLIENT_ID);
    }
    const clientTitle = clientRows[0].title || 'Company';

    const [existing] = await conn.query(
      'SELECT id FROM staffdetail WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
      [CLIENT_ID, SAAS_ADMIN_EMAIL]
    );

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    if (existing.length) {
      await conn.query(
        `UPDATE staffdetail SET permission_json = ?, status = 1, updated_at = NOW() WHERE id = ?`,
        ['["admin"]', existing[0].id]
      );
      console.log('staffdetail: updated existing staff for', SAAS_ADMIN_EMAIL, '-> operator (admin)');
    } else {
      const staffId = crypto.randomUUID();
      await conn.query(
        `INSERT INTO staffdetail (id, client_id, email, name, permission_json, status, is_master, created_at, updated_at)
         VALUES (?, ?, ?, ?, '["admin"]', 1, 0, ?, ?)`,
        [staffId, CLIENT_ID, SAAS_ADMIN_EMAIL, 'Platform Admin', now, now]
      );
      console.log('staffdetail: inserted staff for', SAAS_ADMIN_EMAIL, '-> operator (admin), client', clientTitle);
    }

    console.log('Done. Re-login to Portal to see Operator (and Tenant/Owner if applicable) cards.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
