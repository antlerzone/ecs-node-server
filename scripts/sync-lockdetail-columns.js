/**
 * 用项目 DB 连接直接更新 lockdetail 表结构，无需去 DMS 粘贴执行。
 * 用法：node scripts/sync-lockdetail-columns.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const TABLE = 'lockdetail';

const DESIRED_COLUMNS = [
  { name: 'electricquantity', def: 'int DEFAULT NULL' },
  { name: 'type', def: 'varchar(50) DEFAULT NULL' },
  { name: 'brand', def: 'varchar(50) DEFAULT NULL' },
  { name: 'isonline', def: 'tinyint(1) NOT NULL DEFAULT 0' },
  { name: 'childmeter', def: 'json DEFAULT NULL' },
  { name: 'lockalias', def: 'varchar(255) DEFAULT NULL' },
  { name: 'gateway_id', def: 'varchar(36) DEFAULT NULL' },
  { name: 'hasgateway', def: 'tinyint(1) NOT NULL DEFAULT 0' },
  { name: 'client_id', def: 'varchar(36) DEFAULT NULL' },
  { name: 'client_wixid', def: 'varchar(36) DEFAULT NULL' },
  { name: 'active', def: 'tinyint(1) NOT NULL DEFAULT 1' },
];

async function getExistingColumns(conn) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [process.env.DB_NAME, TABLE]
  );
  return new Set(rows.map(r => (r.COLUMN_NAME || '').toLowerCase()));
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  try {
    const existing = await getExistingColumns(conn);

    // 1) 删除旧列 electrictype（若存在）
    if (existing.has('electrictype')) {
      await conn.query(`ALTER TABLE \`${TABLE}\` DROP COLUMN electrictype`);
      console.log('[sync-lockdetail] Dropped column electrictype');
    }

    // 2) 补新列（若不存在，不写 AFTER 避免依赖已有列）
    for (const col of DESIRED_COLUMNS) {
      if (existing.has(col.name.toLowerCase())) continue;
      await conn.query(
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`${col.name}\` ${col.def}`
      );
      console.log('[sync-lockdetail] Added column', col.name);
    }

    // 3) 把 childmeter 改成 JSON（若当前不是）
    const [colInfo] = await conn.query(
      `SELECT DATA_TYPE FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'childmeter'`,
      [process.env.DB_NAME, TABLE]
    );
    if (colInfo.length && (colInfo[0].DATA_TYPE || '').toLowerCase() !== 'json') {
      await conn.query(
        `ALTER TABLE \`${TABLE}\` MODIFY COLUMN childmeter json DEFAULT NULL`
      );
      console.log('[sync-lockdetail] Modified childmeter to JSON');
    }

    // 4) 确保 client_id 索引存在（无则建）
    const [indexes] = await conn.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'idx_lockdetail_client_id'`,
      [process.env.DB_NAME, TABLE]
    );
    if (indexes.length === 0) {
      await conn.query(
        `ALTER TABLE \`${TABLE}\` ADD KEY idx_lockdetail_client_id (client_id)`
      );
      console.log('[sync-lockdetail] Added index idx_lockdetail_client_id');
    }

    console.log('[sync-lockdetail] Done.');
  } catch (e) {
    console.error('[sync-lockdetail] Error:', e.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
