/**
 * List account.id (UUID) for payment types + business types (forfeit, rental income, topup).
 * Payment types use same lookup as getAccountIdByPaymentType in rentalcollection-invoice.service.js.
 * Usage: node scripts/list-account-payment-type-ids.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const PAYMENT_TYPE_TITLES = {
  bank: ['Bank', 'bank'],
  cash: ['Cash', 'cash'],
  stripe: ['Stripe Current Assets', 'Stripe', 'stripe'],
  deposit: ['Deposit', 'deposit'],
  rental: ['Rent Income', 'Rental', 'rental', 'Platform Collection']
};

// Other business types (generatereport / tenancysetting / meter topup) – lookup by title
const OTHER_TYPE_TITLES = {
  forfeit_deposit: ['Forfeit Deposit', 'forfeit deposit'],
  rental_income: ['Rental Income', 'Rent Income', 'rental income'],
  topup_aircond: ['Topup Aircond', 'Top-up Aircond', 'Meter Topup', 'topup aircond', 'Aircond']
};

async function findAccountByTitles(conn, titles) {
  const placeholders = titles.map(() => '?').join(',');
  const [rows] = await conn.query(
    `SELECT id, title, type FROM account WHERE TRIM(title) IN (${placeholders}) LIMIT 1`,
    titles
  );
  return rows[0] || null;
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });
  try {
    console.log('# Payment-type account UUIDs (from table account, by title)\n');
    console.log('| type    | account.id (UUID)                            | title  |');
    console.log('|---------|----------------------------------------------|--------|');

    for (const [key, titles] of Object.entries(PAYMENT_TYPE_TITLES)) {
      const r = await findAccountByTitles(conn, titles);
      if (r) {
        console.log(`| ${key.padEnd(7)} | ${r.id} | ${(r.title || '').slice(0, 20).padEnd(20)} |`);
      } else {
        console.log(`| ${key.padEnd(7)} | (not found)                         | -      |`);
      }
    }

    console.log('\n# Other types (forfeit deposit / rental income / topup aircond)\n');
    console.log('| type            | account.id (UUID)                            | title  |');
    console.log('|-----------------|----------------------------------------------|--------|');

    for (const [key, titles] of Object.entries(OTHER_TYPE_TITLES)) {
      const r = await findAccountByTitles(conn, titles);
      if (r) {
        console.log(`| ${key.padEnd(15)} | ${r.id} | ${(r.title || '').slice(0, 20).padEnd(20)} |`);
      } else {
        console.log(`| ${key.padEnd(15)} | (not found)                         | -      |`);
      }
    }

    console.log('\n# Full UUIDs (copy to verify):\n');
    const all = { ...PAYMENT_TYPE_TITLES, ...OTHER_TYPE_TITLES };
    for (const key of Object.keys(all)) {
      const titles = all[key];
      const r = await findAccountByTitles(conn, titles);
      console.log(`${key}=${r ? r.id : '(not found)'}  # ${r ? r.title : '-'}`);
    }
  } finally {
    await conn.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
