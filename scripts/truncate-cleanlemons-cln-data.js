/**
 * 清空 / 删除 Cleanlemons cln_* 表（按你的清单）。
 * 使用 DB_* 环境变量（与 run-migration.js 相同）。
 *
 *   node scripts/truncate-cleanlemons-cln-data.js
 *
 * 仅当表存在时 TRUNCATE；「已废弃」表 DROP TABLE IF EXISTS。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

/** 清空数据（保留表结构） */
const TRUNCATE_TABLES = [
  'cln_property',
  'cln_schedule',
  'cln_operator_team',
  'cln_pricingplanlog',
  'cln_operator_subscription_addon',
  'cln_operator_subscription',
  'cln_operator_settings',
  'cln_operator_pricing_config',
  'cln_operator_calendar_adjustment',
  'cln_operator_agreement_template',
  'cln_operator_agreement',
  'cln_linens',
  'cln_kpi_deduction',
  'cln_feedback',
  'cln_employeedetail',
  'cln_employee_operator',
  'cln_damage',
  'cln_clientdetail',
  'cln_client_operator',
  'cln_attendance',
  'cln_account_client'
  // 不 truncate cln_account：平台标准科目表，误清后需跑 0189+0194 重灌
];

/** 整表删除（若仍存在） */
const DROP_TABLES = [
  'cln_operator_user',
  'cln_operator_notification',
  'cln_operator_contact',
  'cln_employee_attendance',
  'cln_client_payment',
  'cln_employee_invoice',
  'cln_addon'
];

async function tableExists(conn, db, name) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1',
    [db, name]
  );
  return rows.length > 0;
}

async function run() {
  const db = process.env.DB_NAME;
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: db,
    multipleStatements: false,
    charset: 'utf8mb4'
  });

  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const t of TRUNCATE_TABLES) {
      if (await tableExists(conn, db, t)) {
        await conn.query(`TRUNCATE TABLE \`${t}\``);
        console.log('TRUNCATE', t);
      } else {
        console.log('SKIP (missing)', t);
      }
    }

    for (const t of DROP_TABLES) {
      if (await tableExists(conn, db, t)) {
        await conn.query(`DROP TABLE \`${t}\``);
        console.log('DROP', t);
      } else {
        console.log('DROP skip (missing)', t);
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Done.');
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
