#!/usr/bin/env node
/**
 * One-time: rename clm_* → cln_* for Cleanlemons (accounting + addon catalog).
 * Also drops legacy 0177 tables if still present.
 *
 *   node scripts/rename-clm-to-cln-tables.js
 *
 * Requires: .env with DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, name) {
  const [[row]] = await conn.query(
    'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [name]
  );
  return Number(row?.c || 0) > 0;
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('DROP TABLE IF EXISTS `cln_operator_account_mapping`');
    await conn.query('DROP TABLE IF EXISTS `cln_operator_accounting_mapping`');
    await conn.query('DROP TABLE IF EXISTS `cln_account_template`');
    console.log('[ok] dropped legacy cln_operator_account_* / cln_account_template (if existed)');

    const hasClmAcc = await tableExists(conn, 'clm_account');
    const hasClnAcc = await tableExists(conn, 'cln_account');
    if (hasClmAcc && !hasClnAcc) {
      const hasClmClient = await tableExists(conn, 'clm_account_client');
      const hasClnClient = await tableExists(conn, 'cln_account_client');
      if (hasClmClient && !hasClnClient) {
        await conn.query(
          'RENAME TABLE `clm_account` TO `cln_account`, `clm_account_client` TO `cln_account_client`'
        );
        console.log('[ok] renamed clm_account → cln_account, clm_account_client → cln_account_client');
      } else {
        console.log('[skip] clm_account rename: clm_account_client / cln_account_client state unexpected');
      }
    } else if (hasClnAcc) {
      console.log('[skip] cln_account already exists');
    } else {
      console.log('[skip] clm_account missing (run 0185_cln_account_cln_account_client.sql if needed)');
    }

    const hasClmAddon = await tableExists(conn, 'clm_addon');
    const hasClnAddon = await tableExists(conn, 'cln_addon');
    if (hasClmAddon && !hasClnAddon) {
      await conn.query('RENAME TABLE `clm_addon` TO `cln_addon`');
      console.log('[ok] renamed clm_addon → cln_addon');
      await conn.query(
        "UPDATE `cln_addon` SET id = 'cln-addon-bulk-transfer' WHERE id = 'clm-addon-bulk-transfer'"
      );
      await conn.query(
        "UPDATE `cln_addon` SET id = 'cln-addon-api-integration' WHERE id = 'clm-addon-api-integration'"
      );
      console.log('[ok] normalized cln_addon row ids (clm-addon-* → cln-addon-*)');
    } else if (hasClnAddon) {
      console.log('[skip] cln_addon already exists');
    } else {
      console.log('[skip] clm_addon missing (Node will CREATE TABLE cln_addon on first use)');
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[done] rename-clm-to-cln-tables');
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error('[fail]', e.message);
  process.exit(1);
});
