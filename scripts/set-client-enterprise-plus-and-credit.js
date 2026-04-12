/**
 * 为指定 client 设置 Malaysia pricing plan: Enterprise Plus、credit 99999，并确保有 master staff。
 * 会更新/插入: operatordetail.pricingplan_id, client_pricingplan_detail, client_credit, staffdetail (master)。
 * Usage: node scripts/set-client-enterprise-plus-and-credit.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const CLIENT_ID = process.env.KEEP_CLIENT_ID || '817f6510-47ac-4f8f-9828-d2fd91cb406f';
const PLAN_TITLE_MATCH = 'Enterprise Plus';
const CREDIT_AMOUNT = 99999;
const EXPIRED_FAR = '2099-12-31 00:00:00';

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
    const [planRows] = await conn.query(
      "SELECT id, title FROM pricingplan WHERE LOWER(TRIM(title)) LIKE ? LIMIT 1",
      ['%' + PLAN_TITLE_MATCH.toLowerCase().replace(/\s+/g, '%') + '%']
    );
    if (!planRows.length) {
      const [all] = await conn.query('SELECT id, title FROM pricingplan ORDER BY title');
      throw new Error(
        'No pricing plan found with title containing "Enterprise Plus". Available: ' +
        (all.map((r) => r.title).join(', ') || 'none')
      );
    }
    const planId = planRows[0].id;
    const planTitle = planRows[0].title || 'Enterprise Plus';
    console.log('Using plan:', planId, planTitle);

    await conn.query(
      'UPDATE operatordetail SET pricingplan_id = ?, updated_at = NOW() WHERE id = ?',
      [planId, CLIENT_ID]
    );
    const [uw] = await conn.query('SELECT ROW_COUNT() AS n');
    console.log('operatordetail.pricingplan_id updated:', uw[0]?.n ?? 0);

    const [ppd] = await conn.query(
      'SELECT id FROM client_pricingplan_detail WHERE client_id = ? AND type = ? LIMIT 1',
      [CLIENT_ID, 'plan']
    );
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (ppd.length) {
      await conn.query(
        'UPDATE client_pricingplan_detail SET plan_id = ?, title = ?, expired = ?, updated_at = NOW() WHERE id = ?',
        [planId, planTitle, EXPIRED_FAR, ppd[0].id]
      );
      console.log('client_pricingplan_detail updated (plan row)');
    } else {
      const id = crypto.randomUUID();
      await conn.query(
        `INSERT INTO client_pricingplan_detail (id, client_id, type, plan_id, title, expired, created_at, updated_at)
         VALUES (?, ?, 'plan', ?, ?, ?, ?, ?)`,
        [id, CLIENT_ID, planId, planTitle, EXPIRED_FAR, now, now]
      );
      console.log('client_pricingplan_detail inserted (plan row)');
    }

    // Set total balance to CREDIT_AMOUNT: first row = 99999, any other rows = 0 (balance = SUM(amount))
    const [ccAll] = await conn.query(
      'SELECT id FROM client_credit WHERE client_id = ? ORDER BY id ASC',
      [CLIENT_ID]
    );
    if (ccAll.length) {
      await conn.query(
        'UPDATE client_credit SET amount = ?, type = ?, updated_at = NOW() WHERE id = ?',
        [CREDIT_AMOUNT, 'flex', ccAll[0].id]
      );
      if (ccAll.length > 1) {
        const otherIds = ccAll.slice(1).map((r) => r.id);
        const placeholders = otherIds.map(() => '?').join(',');
        await conn.query(
          `UPDATE client_credit SET amount = 0, updated_at = NOW() WHERE id IN (${placeholders})`,
          otherIds
        );
      }
      console.log('client_credit updated: total balance =', CREDIT_AMOUNT);
    } else {
      const id = crypto.randomUUID();
      await conn.query(
        `INSERT INTO client_credit (id, client_id, type, amount, created_at, updated_at)
         VALUES (?, ?, 'flex', ?, ?, ?)`,
        [id, CLIENT_ID, CREDIT_AMOUNT, now, now]
      );
      console.log('client_credit inserted:', CREDIT_AMOUNT);
    }

    // Master staff: 用 client 的 email 作为主账号，若无 staff 则新增，若有则确保有一名 is_master=1
    const [[clientRow]] = await conn.query(
      'SELECT email, title FROM operatordetail WHERE id = ? LIMIT 1',
      [CLIENT_ID]
    );
    const clientEmail = (clientRow && clientRow.email) ? String(clientRow.email).trim() : null;
    const clientTitle = (clientRow && clientRow.title) ? String(clientRow.title).trim() : 'Company';
    if (!clientEmail) {
      console.warn('operatordetail.email is empty, skipping master staff.');
    } else {
      const [masterRows] = await conn.query(
        'SELECT id FROM staffdetail WHERE client_id = ? AND is_master = 1 LIMIT 1',
        [CLIENT_ID]
      );
      if (masterRows.length) {
        await conn.query(
          'UPDATE staffdetail SET permission_json = ?, status = 1, updated_at = NOW() WHERE id = ?',
          ['["admin"]', masterRows[0].id]
        );
        console.log('staffdetail: master already exists, permission ensured');
      } else {
        const [anyStaff] = await conn.query(
          'SELECT id FROM staffdetail WHERE client_id = ? ORDER BY id LIMIT 1',
          [CLIENT_ID]
        );
        if (anyStaff.length) {
          await conn.query(
            'UPDATE staffdetail SET is_master = 1, permission_json = ?, status = 1, email = ?, name = ?, updated_at = NOW() WHERE id = ?',
            ['["admin"]', clientEmail, clientTitle + ' Master', anyStaff[0].id]
          );
          console.log('staffdetail: existing staff set as master');
        } else {
          const staffId = crypto.randomUUID();
          await conn.query(
            `INSERT INTO staffdetail (id, client_id, email, name, permission_json, status, is_master, created_at, updated_at)
             VALUES (?, ?, ?, ?, '["admin"]', 1, 1, ?, ?)`,
            [staffId, CLIENT_ID, clientEmail, clientTitle + ' Master', now, now]
          );
          console.log('staffdetail: master staff inserted', clientEmail);
        }
      }
    }

    console.log('Done. Client', CLIENT_ID, '-> plan:', planTitle, ', credit:', CREDIT_AMOUNT);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
