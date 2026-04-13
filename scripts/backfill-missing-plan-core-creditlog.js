/**
 * 某次误删 pricingplanlog / creditlog 后，钱包 client_credit 已正确但 creditlogs 少记一笔套餐 core。
 * 仅补 INSERT creditlogs（+amount），不调用 handlePricingPlanPaymentSuccess，避免重复加 client_credit。
 *
 * Usage:
 *   CLIENT_ID=... PRICINGPLANLOG_ID=... node scripts/backfill-missing-plan-core-creditlog.js
 *   DRY_RUN=1 — 只打印不写入
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');

const CLIENT_ID = process.env.CLIENT_ID || '58f809ea-c0af-4233-8b0d-66d0b15d000f';
const PRICINGPLANLOG_ID = process.env.PRICINGPLANLOG_ID || '9989ffa3-d044-44c3-b664-3807df333a6d';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

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
    const [[log]] = await conn.query(
      `SELECT id, client_id, plan_id, title, newexpireddate, status FROM pricingplanlogs WHERE id = ? LIMIT 1`,
      [PRICINGPLANLOG_ID]
    );
    if (!log) throw new Error('pricingplanlogs row not found: ' + PRICINGPLANLOG_ID);
    if (String(log.client_id) !== CLIENT_ID) throw new Error('client_id mismatch on pricingplanlog');

    const [[plan]] = await conn.query('SELECT id, title, corecredit FROM pricingplan WHERE id = ? LIMIT 1', [log.plan_id]);
    if (!plan) throw new Error('pricingplan not found');

    const [dup] = await conn.query(
      'SELECT id FROM creditlogs WHERE client_id = ? AND pricingplanlog_id = ? LIMIT 1',
      [CLIENT_ID, PRICINGPLANLOG_ID]
    );
    if (dup.length) {
      console.log('Already has creditlog for this pricingplanlog:', dup[0].id);
      return;
    }

    const [[client]] = await conn.query('SELECT id, currency FROM operatordetail WHERE id = ? LIMIT 1', [CLIENT_ID]);
    if (!client) throw new Error('operatordetail not found');
    const currency = String(client.currency || '').trim().toUpperCase();
    if (!['MYR', 'SGD'].includes(currency)) throw new Error('unsupported currency: ' + currency);

    const coreGrant = Number(plan.corecredit) || 0;
    if (coreGrant <= 0) throw new Error('plan.corecredit is 0');

    const creditLogId = randomUUID();
    const ref = `PLAN-CREDIT-${creditLogId}`;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const title = `Pricing plan: ${plan.title} (core credit) — ledger backfill`;

    console.log({
      CLIENT_ID,
      PRICINGPLANLOG_ID,
      planTitle: plan.title,
      coreGrant,
      currency,
      creditLogId,
      ref,
      DRY_RUN
    });

    if (DRY_RUN) return;

    await conn.query(
      `INSERT INTO creditlogs (id, title, type, client_id, staff_id, currency, amount, is_paid, reference_number, pricingplanlog_id, sourplan_id, paiddate, created_at, updated_at)
       VALUES (?, ?, 'Topup', ?, NULL, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [
        creditLogId,
        title,
        CLIENT_ID,
        currency,
        coreGrant,
        ref,
        PRICINGPLANLOG_ID,
        plan.id,
        now,
        now,
        now
      ]
    );
    console.log('Inserted creditlog', creditLogId);

    const [[w]] = await conn.query('SELECT COALESCE(SUM(amount),0) AS t FROM client_credit WHERE client_id = ?', [CLIENT_ID]);
    const [[c]] = await conn.query(
      `SELECT COALESCE(SUM(amount),0) AS s FROM creditlogs WHERE client_id = ? AND NOT (type = 'Topup' AND COALESCE(is_paid,0) != 1 AND reference_number LIKE 'TP-%' AND amount > 0)`,
      [CLIENT_ID]
    );
    console.log('After: wallet (client_credit)=', Number(w.t), 'creditlogs net=', Number(c.s), 'delta=', Number(w.t) - Number(c.s));
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
