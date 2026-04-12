/**
 * 先清空 operatordetail 及 4 张子表，再执行 CSV 导入。
 * 用法：node scripts/clear-and-import-operatordetail.js [csv路径]
 * 默认 csv 路径：./operatordetail.csv
 *
 * 步骤：1) 删除表中数据  2) 从 CSV 重新 import（需先把 operatordetail.csv 放到当前目录或指定路径）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { spawnSync } = require('child_process');
const path = require('path');

const TABLES = [
  'client_credit',
  'client_pricingplan_detail',
  'client_profile',
  'client_integration',
  'operatordetail',
];

const csvPath = process.argv[2] || path.join(process.cwd(), 'operatordetail.csv');

async function clear() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES) {
      await conn.query(`TRUNCATE TABLE \`${table}\``);
      console.log('[clear]', table);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[clear] Done.');
  } finally {
    await conn.end();
  }
}

async function run() {
  await clear();
  console.log('[import] running import-operatordetail.js', csvPath);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'import-operatordetail.js'), csvPath], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
  process.exit(r.status || 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
