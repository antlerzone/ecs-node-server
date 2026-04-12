/**
 * 確保 account 表有 Processing Fees 與 Xendit（Settlement journal 用）。
 * 新插入時 id 用 randomUUID() 自己生成；已存在則跳過。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { randomUUID } = require('crypto');
const pool = require('../src/config/db');

async function ensureRow(titles, title, accountType) {
  const [existing] = await pool.query(
    `SELECT id FROM account WHERE TRIM(title) IN (${titles.map(() => '?').join(',')}) LIMIT 1`,
    titles
  );
  if (existing.length > 0) {
    console.log('Already exists, skip insert. id:', existing[0].id, 'title:', title);
    return;
  }
  const id = randomUUID();
  await pool.query(
    `INSERT INTO account (id, title, type, account_json, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NOW(), NOW())`,
    [id, title, accountType]
  );
  console.log('Inserted (id self-generated):', id, 'title:', title, 'type:', accountType);
}

async function run() {
  await ensureRow(['Processing Fee', 'Processing Fees'], 'Processing Fees', 'cost_of_sales');
  await ensureRow(['Xendit', 'Payex Current Assets'], 'Xendit', 'current_assets');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
