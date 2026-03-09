/**
 * Reset Demo Account（12am 排程用）：把 demo 公司 (DEMO_CLIENT_ID) 的 clientdetail 及相關資料還原成 seed 狀態。
 * - clientdetail: email=antlerzone@gmail.com, title=DemoAccount, status=1, expired=2099-12-31, best plan
 * - client_credit: 9999
 * - client_pricingplan_detail: 一筆 plan
 * - staffdetail: 只保留 antlerzone@gmail.com（master），刪除其餘掛在 demo 下的訪客 staff
 *
 * 三個 CNYIOT：1) SAAS Mother (env) 2) Demo Account 子帳 (本 client) 3) demoaccount@gmail.com 等訪客開戶後才有
 *
 * Usage: node scripts/reset-demo-account.js
 * Cron: 0 0 * * * (每天 00:00) 或 0 16 * * * (MY 00:00 = UTC 16:00)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID || 'a0000001-0001-4000-8000-000000000001';
const DEMO_CLIENT_EMAIL = 'antlerzone@gmail.com';
const DEMO_COMPANY = 'DemoAccount';
const DEMO_SUBDOMAIN = 'demoaccount';
const EXPIRED_FAR = '2099-12-31 00:00:00';

async function main() {
  const conn = await pool.getConnection();
  try {
    const [planRows] = await conn.query(
      'SELECT id, title FROM pricingplan ORDER BY COALESCE(sellingprice, 0) DESC LIMIT 1'
    );
    if (!planRows.length) {
      throw new Error('No pricingplan found.');
    }
    const bestPlanId = planRows[0].id;
    const bestPlanTitle = planRows[0].title || 'Best Plan';

    await conn.query(
      `UPDATE clientdetail SET title = ?, email = ?, status = 1, subdomain = ?, expired = ?, pricingplan_id = ?, currency = 'MYR', updated_at = NOW() WHERE id = ?`,
      [DEMO_COMPANY, DEMO_CLIENT_EMAIL, DEMO_SUBDOMAIN, EXPIRED_FAR, bestPlanId, DEMO_CLIENT_ID]
    );
    console.log('clientdetail reset:', DEMO_CLIENT_EMAIL);

    await conn.query(
      'UPDATE client_credit SET amount = 9999, updated_at = NOW() WHERE client_id = ?',
      [DEMO_CLIENT_ID]
    );

    const [ppdRows] = await conn.query(
      'SELECT id FROM client_pricingplan_detail WHERE client_id = ? AND type = ? LIMIT 1',
      [DEMO_CLIENT_ID, 'plan']
    );
    if (ppdRows.length) {
      await conn.query(
        'UPDATE client_pricingplan_detail SET plan_id = ?, title = ?, expired = ?, updated_at = NOW() WHERE id = ?',
        [bestPlanId, bestPlanTitle, EXPIRED_FAR, ppdRows[0].id]
      );
    } else {
      const id = require('crypto').randomUUID();
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await conn.query(
        `INSERT INTO client_pricingplan_detail (id, client_id, type, plan_id, title, expired, created_at, updated_at)
         VALUES (?, ?, 'plan', ?, ?, ?, ?, ?)`,
        [id, DEMO_CLIENT_ID, bestPlanId, bestPlanTitle, EXPIRED_FAR, now, now]
      );
    }

    const [delStaff] = await conn.query(
      `DELETE FROM staffdetail WHERE client_id = ? AND LOWER(TRIM(email)) != ?`,
      [DEMO_CLIENT_ID, DEMO_CLIENT_EMAIL.toLowerCase()]
    );
    console.log('staffdetail: removed', delStaff.affectedRows, 'non-master rows');

    await conn.query(
      `UPDATE staffdetail SET email = ?, name = 'DemoAccount Master', permission_json = '["admin"]', status = 1, is_master = 1, updated_at = NOW() WHERE client_id = ?`,
      [DEMO_CLIENT_EMAIL, DEMO_CLIENT_ID]
    );

    console.log('Reset done. Demo client', DEMO_CLIENT_EMAIL);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
