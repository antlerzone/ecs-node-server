#!/usr/bin/env node
/**
 * Backfill client_id from client_wixid for all tables that have both columns.
 * Uses clientdetail.wix_id = table.client_wixid. Skips tables that don't exist.
 * Usage: node scripts/backfill-client-id-from-wixid.js
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TABLES = [
  'tenantdetail',
  'client_integration',
  'client_profile',
  'client_pricingplan_detail',
  'client_credit',
  'agreementtemplate',
  'gatewaydetail',
  'lockdetail',
  'ownerdetail',
  'meterdetail',
  'propertydetail',
  'roomdetail',
  'ownerpayout',
  'rentalcollection',
  'staffdetail',
  'agreement',
  'cnyiottokens',
  'parkinglot',
  'pricingplanlogs',
  'ttlocktoken',
  'account',
  'creditplan',
  'bills',
  'tenancy',
  'supplierdetail'
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  for (const table of TABLES) {
    try {
      const [rows] = await conn.query(
        `UPDATE \`${table}\` t
         INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
         SET t.client_id = c.id
         WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != ''`
      );
      const affected = rows.affectedRows || 0;
      if (affected > 0) {
        console.log(`[backfill] ${table}: ${affected} rows updated`);
      }
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') {
        console.log(`[backfill] ${table}: table does not exist, skip`);
      } else if (err.code === 'ER_BAD_FIELD_ERROR') {
        console.log(`[backfill] ${table}: missing client_wixid/client_id column, skip`);
      } else {
        console.error(`[backfill] ${table} error:`, err.message);
      }
    }
  }

  await conn.end();
  console.log('[backfill] Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
