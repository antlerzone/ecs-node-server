/**
 * 清空 mydb 内 ownerdetail、propertydetail、meterdetail、tenantdetail、tenancy、bills、ownerpayout、rentalcollection 八张表，然后从 CSV 导入。
 * 用法（在项目根目录执行）：
 *   node scripts/clear-and-import-four-tables.js
 * 或指定 CSV 目录：
 *   node scripts/clear-and-import-four-tables.js /home/ecs-user/app
 *
 * 默认从 process.cwd() 读取：
 *   ownerdetail.csv      -> ownerdetail
 *   propertydetail.csv   -> propertydetail
 *   meterdetail.csv      -> meterdetail
 *   tenantdetail.csv     -> tenantdetail
 *   Tenancy.csv          -> tenancy
 *   utilitybills.csv     -> bills
 *   ownerpayout.csv      -> ownerpayout
 *   rentalcollection.csv -> rentalcollection
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const path = require('path');
const { execSync } = require('child_process');

const baseDir = process.argv[2] || process.cwd();

const TABLES_TRUNCATE_ORDER = ['rentalcollection', 'tenancy', 'bills', 'ownerpayout', 'tenantdetail', 'propertydetail', 'meterdetail', 'ownerdetail'];
const IMPORTS = [
  { csv: 'ownerdetail.csv', table: 'ownerdetail', script: 'import-ownerdetail.js' },
  { csv: 'propertydetail.csv', table: 'propertydetail', script: 'import-propertydetail.js' },
  { csv: 'meterdetail.csv', table: 'meterdetail', script: 'import-meterdetail.js' },
  { csv: 'tenantdetail.csv', table: 'tenantdetail', script: 'import-tenantdetail.js' },
  { csv: 'Tenancy.csv', table: 'tenancy', script: 'import-tenancy.js' },
  { csv: 'utilitybills.csv', table: 'bills', script: 'import-bills.js' },
  { csv: 'ownerpayout.csv', table: 'ownerpayout', script: 'import-ownerpayout.js' },
  { csv: 'rentalcollection.csv', table: 'rentalcollection', script: 'import-rentalcollection.js' },
];

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  try {
    console.log('Truncating tables (FK checks off)...');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES_TRUNCATE_ORDER) {
      await conn.query(`TRUNCATE TABLE \`${table}\``);
      console.log('  truncated', table);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Truncate done.\n');
  } catch (err) {
    console.error('Truncate failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }

  const scriptsDir = path.join(__dirname);
  for (const { csv, table, script } of IMPORTS) {
    const csvPath = path.join(baseDir, csv);
    console.log(`Importing ${csv} -> ${table}...`);
    try {
      execSync(`node "${path.join(scriptsDir, script)}" "${csvPath}"`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
      });
    } catch (e) {
      console.error(`Import failed for ${csv}:`, e.message);
      process.exit(1);
    }
    console.log('');
  }
  console.log('All done.');
}

run();
