#!/usr/bin/env node
/**
 * Idempotent renames for production (safe to run more than once):
 *   0181  clientdetail              → operatordetail          (Coliving core)
 *   0182  cln_client                → cln_operator          (Cleanlemons company row)
 *   0198  cln_operator              → cln_operatordetail    (parity with operatordetail)
 *   0200  (SQL file) cln_operator_subscription(+addon).operator_id → FK cln_operatordetail(id)
 *   0183  cln_client_account_mapping → cln_operator_account_mapping
 *
 * After deploy: run SQL 0186 / 0188 (drop legacy template + operator_*account* tables) and
 *   npm run migrate:cleanlemons-cln-rename
 * to rename clm_account / clm_account_client / clm_addon → cln_* when upgrading.
 *
 * Coliving-only DB: only 0181 applies; cln_* steps skip if tables missing.
 * Cleanlemons DB: 0182/0183 apply when old names exist.
 *
 * Usage (on ECS or any host with .env pointing at target DB):
 *   node scripts/run-online-renames.js
 *
 * Then: deploy latest Node + portal build, restart pm2/systemd.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, name) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
    [name]
  );
  return rows.length > 0;
}

async function main() {
  const db = process.env.DB_NAME;
  if (!db) {
    console.error('[run-online-renames] DB_NAME missing in .env');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: db,
    multipleStatements: false
  });

  console.log('[run-online-renames] database:', db);

  // --- 0181 Coliving ---
  if (await tableExists(conn, 'operatordetail')) {
    console.log('[0181] skip: operatordetail already exists');
  } else if (await tableExists(conn, 'clientdetail')) {
    await conn.query('RENAME TABLE `clientdetail` TO `operatordetail`');
    console.log('[0181] ok: clientdetail → operatordetail');
  } else {
    console.warn('[0181] warn: neither clientdetail nor operatordetail — check DB');
  }

  // --- 0182 Cleanlemons (skip if not this product’s schema) ---
  if (await tableExists(conn, 'cln_operator')) {
    console.log('[0182] skip: cln_operator already exists');
  } else if (await tableExists(conn, 'cln_client')) {
    await conn.query('RENAME TABLE `cln_client` TO `cln_operator`');
    console.log('[0182] ok: cln_client → cln_operator');
  } else {
    console.log('[0182] skip: no cln_client / cln_operator (expected on Coliving-only DB)');
  }

  // --- 0183 Cleanlemons mapping ---
  if (await tableExists(conn, 'cln_operator_account_mapping')) {
    console.log('[0183] skip: cln_operator_account_mapping already exists');
  } else if (await tableExists(conn, 'cln_client_account_mapping')) {
    await conn.query('RENAME TABLE `cln_client_account_mapping` TO `cln_operator_account_mapping`');
    console.log('[0183] ok: cln_client_account_mapping → cln_operator_account_mapping');
  } else {
    console.log('[0183] skip: mapping table not present');
  }

  // --- 0198 Cleanlemons operator master (after 0182) ---
  if (await tableExists(conn, 'cln_operatordetail')) {
    console.log('[0198] skip: cln_operatordetail already exists');
  } else if (await tableExists(conn, 'cln_operator')) {
    await conn.query('RENAME TABLE `cln_operator` TO `cln_operatordetail`');
    console.log('[0198] ok: cln_operator → cln_operatordetail');
  } else {
    console.log('[0198] skip: no cln_operator (expected on Coliving-only DB)');
  }

  await conn.end();
  console.log('[run-online-renames] done.');
}

main().catch((e) => {
  console.error('[run-online-renames] failed:', e.message || e);
  process.exit(1);
});
