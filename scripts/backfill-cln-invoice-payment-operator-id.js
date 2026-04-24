/**
 * Set cln_client_invoice.operator_id and/or cln_client_payment.operator_id (Cleanlemons B2B).
 *
 * Usage (project root, .env with DB_*):
 *   node scripts/backfill-cln-invoice-payment-operator-id.js e48b2c25-399a-11f1-a4e2-00163e006722
 *
 * Default: only rows where operator_id IS NULL or blank get the UUID.
 * Force every row to this operator:
 *   node scripts/backfill-cln-invoice-payment-operator-id.js e48b2c25-399a-11f1-a4e2-00163e006722 --all
 *
 * Run migration 0315 first if columns are missing:
 *   mysql ... < src/db/migrations/0315_cln_client_invoice_payment_operator_id.sql
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const OID = String(process.argv[2] || '').trim();
const forceAll = process.argv.includes('--all');

if (!/^[0-9a-f-]{36}$/i.test(OID)) {
  console.error('Usage: node scripts/backfill-cln-invoice-payment-operator-id.js <operator_uuid> [--all]');
  process.exit(1);
}

async function databaseHasColumn(c, table, column) {
  const [[row]] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return Number(row?.n) > 0;
}

async function tableExists(c, table) {
  const [[row]] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  return Number(row?.n) > 0;
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const hasInvOp = await databaseHasColumn(c, 'cln_client_invoice', 'operator_id');
  const hasPayTbl = await tableExists(c, 'cln_client_payment');
  const hasPayOp = hasPayTbl && (await databaseHasColumn(c, 'cln_client_payment', 'operator_id'));

  if (!hasInvOp) {
    console.error('Missing cln_client_invoice.operator_id — run migration 0315 (or 0275) first.');
    await c.end();
    process.exit(1);
  }

  const whereInv = forceAll ? '1=1' : '(operator_id IS NULL OR TRIM(COALESCE(operator_id, \'\')) = \'\')';
  const [rInv] = await c.query(`UPDATE cln_client_invoice SET operator_id = ? WHERE ${whereInv}`, [OID]);
  console.log('cln_client_invoice updated:', Number(rInv.affectedRows));

  if (hasPayOp) {
    const wherePay = forceAll ? '1=1' : '(operator_id IS NULL OR TRIM(COALESCE(operator_id, \'\')) = \'\')';
    const [rPay] = await c.query(`UPDATE cln_client_payment SET operator_id = ? WHERE ${wherePay}`, [OID]);
    console.log('cln_client_payment updated:', Number(rPay.affectedRows));
    const [rPay2] = await c.query(
      `UPDATE cln_client_payment p
       INNER JOIN cln_client_invoice i ON i.id = p.invoice_id
       SET p.operator_id = i.operator_id
       WHERE p.invoice_id IS NOT NULL
         AND i.operator_id IS NOT NULL AND TRIM(i.operator_id) <> ''
         AND (p.operator_id IS NULL OR TRIM(COALESCE(p.operator_id, '')) = '')`
    );
    console.log('cln_client_payment filled from invoice (still empty):', Number(rPay2.affectedRows));
  } else if (hasPayTbl) {
    console.log('cln_client_payment has no operator_id column — run migration 0315 first.');
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
