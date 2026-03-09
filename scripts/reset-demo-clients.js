/**
 * Reset：刪除 democoliving@gmail.com 與 demoaccount@gmail.com 的 staff、client 及所有關聯表資料。
 * 每次要清空這兩個 demo client 時執行即可。
 *
 * Usage: node scripts/reset-demo-clients.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runRemoveByEmail, pool } = require('./remove-staff-and-client-by-email.js');

const DEMO_EMAILS = ['democoliving@gmail.com', 'demoaccount@gmail.com'];

async function main() {
  for (const email of DEMO_EMAILS) {
    console.log('---', email, '---');
    await runRemoveByEmail(email);
  }
  await pool.end();
  console.log('Reset done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
