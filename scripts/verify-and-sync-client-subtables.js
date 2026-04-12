/**
 * 1) 检查 operatordetail 与 4 张子表的行数（确认是否连对库、是否有数据）
 * 2) 从 operatordetail 的 integration/profile/pricingplandetail/credit 列重新同步到 4 张子表
 *
 * 用法：node scripts/verify-and-sync-client-subtables.js
 * 若子表没有 item，跑此脚本会按 operatordetail 里的 JSON 重新写入子表。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { syncSubtablesFromOperatordetail } = require('../src/services/client-subtables');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  try {
    console.log('[verify] database:', process.env.DB_NAME || '(from connection)');

    const tables = ['operatordetail', 'client_integration', 'client_profile', 'client_pricingplan_detail', 'client_credit'];
    for (const t of tables) {
      try {
        const [rows] = await conn.query(`SELECT COUNT(*) as n FROM \`${t}\``);
        console.log('[verify]', t + ':', rows[0].n, 'rows');
      } catch (e) {
        console.warn('[verify]', t, 'error:', e.message);
      }
    }

    let hasJsonColumns = false;
    try {
      const [cols] = await conn.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'operatordetail' AND column_name IN ('integration','profile','pricingplandetail','credit')",
        [process.env.DB_NAME]
      );
      hasJsonColumns = cols.length >= 4;
    } catch (_) {}
    if (!hasJsonColumns) {
      console.warn('[verify] operatordetail 没有 integration/profile/pricingplandetail/credit 列，请先执行 migration 0002_operatordetail_subtable_json_columns.sql');
      return;
    }

    const [clients] = await conn.query(
      "SELECT id, wix_id FROM operatordetail WHERE (integration IS NOT NULL AND integration != '') OR (profile IS NOT NULL AND profile != '') OR (pricingplandetail IS NOT NULL AND pricingplandetail != '') OR (credit IS NOT NULL AND credit != '')"
    );
    console.log('[verify] clients with JSON columns:', clients.length);
    for (const c of clients) {
      await syncSubtablesFromOperatordetail(conn, c.id);
      console.log('[sync] client id=', c.id, 'wix_id=', c.wix_id);
    }

    console.log('[verify] after sync:');
    for (const t of tables) {
      try {
        const [rows] = await conn.query(`SELECT COUNT(*) as n FROM \`${t}\``);
        console.log('[verify]', t + ':', rows[0].n, 'rows');
      } catch (_) {}
    }
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
