#!/usr/bin/env node
/**
 * 检查 agreement 表是否已有 0053/0054/0055 新增的列。
 * 用法：node scripts/check-agreement-columns.js（需在项目根目录，.env 已配置 DB_*）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

const EXPECTED = [
  'hash_draft',      // 0053
  'hash_final',      // 0053
  'version',         // 0053
  'operator_signed_ip',  // 0054
  'tenant_signed_ip',    // 0054
  'owner_signed_ip',     // 0054
  'columns_locked'   // 0055
];

async function main() {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'agreement' 
     ORDER BY ORDINAL_POSITION`,
    [process.env.DB_NAME]
  );
  const columns = new Set((rows || []).map(r => r.COLUMN_NAME));
  const missing = EXPECTED.filter(c => !columns.has(c));
  const found = EXPECTED.filter(c => columns.has(c));

  console.log('Agreement 表检查（0053 / 0054 / 0055）：');
  found.forEach(c => console.log('  ✓', c));
  if (missing.length) {
    console.log('  缺失:', missing.join(', '));
    console.log('→ 请执行对应 migration。');
    process.exit(1);
  } else {
    console.log('→ 所有列已存在，migration 已跑完。');
  }
  await pool.end();
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
