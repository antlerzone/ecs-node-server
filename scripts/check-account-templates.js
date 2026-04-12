/**
 * 確認 account 表裡是否有 Processing Fees 與 Xendit（Settlement journal 用）。
 * 程式用 getPaymentDestinationAccountId(..., 'processing_fee') 對 title: Processing Fee / Processing Fees；
 * 用 getPaymentDestinationAccountId(..., 'xendit') 對 title: Payex Current Assets / Xendit。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const [rows] = await pool.query(
    `SELECT id, title, type FROM account
     WHERE TRIM(title) IN ('Processing Fee', 'Processing Fees', 'Xendit', 'Payex Current Assets')
     ORDER BY title`
  );
  const hasProcessingFee = rows.some((r) => /processing fee(s)?/i.test(r.title));
  const hasXendit = rows.some((r) => /xendit|payex current assets/i.test(r.title));
  console.log('Account templates for settlement journal:');
  rows.forEach((r) => console.log('  ', r.id, r.title, r.type || ''));
  if (hasProcessingFee) console.log('OK Processing Fees');
  else console.log('MISSING Processing Fees (run: node scripts/seed-account-processing-fees.js)');
  if (hasXendit) console.log('OK Xendit');
  else console.log('MISSING Xendit (add a row with title "Xendit" or "Payex Current Assets" in account table)');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
