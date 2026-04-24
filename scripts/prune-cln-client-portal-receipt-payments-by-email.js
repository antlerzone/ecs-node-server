/**
 * Delete client-portal manual receipt payment rows for given cln_clientdetail email(s).
 * Only rows tagged as portal upload:
 *   receipt_number = 'portal_upload' OR transaction_id LIKE 'portal_bank_receipt:%'
 * Only when the invoice is still unpaid (payment_received <> 1).
 *
 * Usage:
 *   DRY_RUN=1 node scripts/prune-cln-client-portal-receipt-payments-by-email.js starcity.shs@gmail.com
 *   node scripts/prune-cln-client-portal-receipt-payments-by-email.js starcity.shs@gmail.com starcky.shj@gmail.com
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const emails = process.argv.slice(2).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
if (!emails.length) {
  console.error('Usage: node scripts/prune-cln-client-portal-receipt-payments-by-email.js <email> [...]');
  console.error('  DRY_RUN=1  — print matches only, no DELETE.');
  process.exit(1);
}

const dry = process.env.DRY_RUN === '1' || String(process.env.DRY_RUN || '').toLowerCase() === 'true';

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const ph = emails.map(() => '?').join(',');
  const wherePortal =
    `LOWER(TRIM(COALESCE(p.receipt_number, ''))) = 'portal_upload'
     OR TRIM(COALESCE(p.transaction_id, '')) LIKE 'portal_bank_receipt:%'`;
  const [rows] = await c.query(
    `SELECT p.id AS paymentId, p.invoice_id AS invoiceId, p.amount, p.transaction_id AS transactionId,
            p.receipt_number AS receiptNumber, cd.email AS clientEmail
     FROM cln_client_payment p
     INNER JOIN cln_client_invoice i ON i.id = p.invoice_id
     INNER JOIN cln_clientdetail cd ON cd.id = i.client_id
     WHERE LOWER(TRIM(COALESCE(cd.email, ''))) IN (${ph})
       AND COALESCE(i.payment_received, 0) <> 1
       AND (${wherePortal})`,
    emails
  );
  const list = Array.isArray(rows) ? rows : [];
  console.log('emails:', emails.join(', '));
  console.log('matches:', list.length);
  for (const r of list.slice(0, 50)) {
    console.log(
      r.paymentId,
      '| inv',
      r.invoiceId,
      '|',
      String(r.clientEmail || ''),
      '| amt',
      r.amount,
      '|',
      String(r.transactionId || '').slice(0, 48)
    );
  }
  if (list.length > 50) console.log('…', list.length - 50, 'more');
  if (dry) {
    console.log('DRY_RUN: no DELETE executed.');
    await c.end();
    return;
  }
  if (!list.length) {
    await c.end();
    return;
  }
  const [res] = await c.query(
    `DELETE p FROM cln_client_payment p
     INNER JOIN cln_client_invoice i ON i.id = p.invoice_id
     INNER JOIN cln_clientdetail cd ON cd.id = i.client_id
     WHERE LOWER(TRIM(COALESCE(cd.email, ''))) IN (${ph})
       AND COALESCE(i.payment_received, 0) <> 1
       AND (${wherePortal})`,
    emails
  );
  console.log('deleted rows:', res.affectedRows ?? res);
  await c.end();
})().catch((e) => {
  console.error(e?.sqlMessage || e?.message || e);
  process.exit(1);
});
