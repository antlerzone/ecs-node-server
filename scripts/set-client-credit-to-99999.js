/**
 * 将指定 client 的 Balance Credit 直接设为 99999（不改 plan / staff）。
 * client_credit 可能有多行，总余额 = SUM(amount)；本脚本将总余额设为 99999（第一行=99999，其余行=0）。
 * 同时写入 creditlogs 一笔 Topup，并同步 operatordetail.credit。
 *
 * Usage:
 *   CLIENT_ID=<client_id> node scripts/set-client-credit-to-99999.js
 *   EMAIL=<operator@email.com> node scripts/set-client-credit-to-99999.js   # 将该邮箱作为 staff 的【所有】client 都设为 99999（解决多 client 时界面仍显示 26 的问题）
 * Env: CLIENT_ID 或 EMAIL 二选一；KEEP_CLIENT_ID 可作为 CLIENT_ID 的 fallback。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const CLIENT_ID = process.env.CLIENT_ID || process.env.KEEP_CLIENT_ID;
const EMAIL = (process.env.EMAIL || '').trim().toLowerCase();
const TARGET_CREDIT = 99999;

async function setOneClient(conn, cid) {
  const [[client]] = await conn.query(
    'SELECT id, title, currency FROM operatordetail WHERE id = ? LIMIT 1',
    [cid]
  );
  if (!client) {
    console.warn('Client not found:', cid);
    return;
  }
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const paidDate = now.slice(0, 10);
  const currency = String(client.currency || '').toUpperCase() === 'SGD' ? 'SGD' : 'MYR';

  const [rows] = await conn.query(
    'SELECT id, amount FROM client_credit WHERE client_id = ? ORDER BY id ASC',
    [cid]
  );
  const currentTotal = (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);

  if (rows.length) {
    await conn.query(
      'UPDATE client_credit SET amount = ?, type = ?, updated_at = ? WHERE id = ?',
      [TARGET_CREDIT, 'flex', now, rows[0].id]
    );
    if (rows.length > 1) {
      const otherIds = rows.slice(1).map((r) => r.id);
      const placeholders = otherIds.map(() => '?').join(',');
      await conn.query(
        `UPDATE client_credit SET amount = 0, updated_at = ? WHERE id IN (${placeholders})`,
        [now, ...otherIds]
      );
    }
  } else {
    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO client_credit (id, client_id, type, amount, created_at, updated_at)
       VALUES (?, ?, 'flex', ?, ?, ?)`,
      [id, cid, TARGET_CREDIT, now, now]
    );
  }

  const creditJson = JSON.stringify([{ type: 'flex', amount: TARGET_CREDIT }]);
  await conn.query(
    'UPDATE operatordetail SET credit = ?, updated_at = ? WHERE id = ?',
    [creditJson, now, cid]
  );

  const delta = TARGET_CREDIT - currentTotal;
  if (delta !== 0) {
    const logId = crypto.randomUUID();
    const ref = `SCRIPT-${logId.slice(0, 8)}`;
    const title = `Manual balance set to ${TARGET_CREDIT} (script)`;
    await conn.query(
      `INSERT INTO creditlogs (id, title, type, client_id, staff_id, currency, payment, amount, is_paid, reference_number, paiddate, created_at, updated_at)
       VALUES (?, ?, 'Topup', ?, NULL, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [logId, title, cid, currency, delta, delta, ref, paidDate, now, now]
    );
  }
  console.log('  ', client.title || cid, '->', TARGET_CREDIT);
}

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
    let clientIds = [];
    if (EMAIL) {
      const [staffRows] = await conn.query(
        'SELECT DISTINCT client_id FROM staffdetail WHERE LOWER(TRIM(email)) = ? AND client_id IS NOT NULL',
        [EMAIL]
      );
      clientIds = (staffRows || []).map((r) => r.client_id);
      if (clientIds.length === 0) {
        console.error('No staff records found for email:', EMAIL);
        process.exit(1);
      }
      console.log('Found', clientIds.length, 'client(s) for', EMAIL);
    } else if (CLIENT_ID) {
      clientIds = [CLIENT_ID];
    } else {
      console.error('Usage: CLIENT_ID=<id> or EMAIL=<operator@email.com> node scripts/set-client-credit-to-99999.js');
      process.exit(1);
    }

    for (const cid of clientIds) {
      await setOneClient(conn, cid);
    }
    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
