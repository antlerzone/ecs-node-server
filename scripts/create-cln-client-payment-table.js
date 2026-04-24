/**
 * One-off: create `cln_client_payment` if missing (Cleanlemons operator/client invoices).
 * Uses root `.env` DB_* — same as API / other scripts.
 *
 *   node scripts/create-cln-client-payment-table.js
 *
 * Columns match `src/db/migrations/0176_cleanlemons_core.sql`. No FKs here so it runs on DBs
 * that already use `cln_clientdetail` for invoice client_id without legacy `cln_client` rows.
 * If you need FKs, apply `src/db/migrations/0299_cln_client_invoice_clientdetail_fk.sql` after.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const SQL = `
CREATE TABLE IF NOT EXISTS \`cln_client_payment\` (
  \`id\` CHAR(36) NOT NULL,
  \`client_id\` CHAR(36) NULL,
  \`receipt_number\` VARCHAR(64) NULL,
  \`amount\` DECIMAL(14,2) NULL,
  \`payment_date\` DATE NULL,
  \`receipt_url\` TEXT NULL,
  \`transaction_id\` VARCHAR(64) NULL,
  \`invoice_id\` CHAR(36) NULL,
  \`wix_owner_id\` CHAR(36) NULL,
  \`created_at\` DATETIME(3) NULL,
  \`updated_at\` DATETIME(3) NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_cln_pay_client\` (\`client_id\`),
  KEY \`idx_cln_pay_invoice\` (\`invoice_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  try {
    await conn.query(SQL);
    const [[row]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'cln_client_payment'`
    );
    console.log(JSON.stringify({ ok: true, cln_client_payment_exists: Number(row?.n || 0) > 0 }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
