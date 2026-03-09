/**
 * Reset：刪除 democoliving@gmail.com 的 staff + 對應 client 及該 client 在所有關聯表的資料。
 * 每次要 reset 時執行此檔即可。
 *
 * Usage:
 *   node scripts/reset-democoliving.js
 *   node scripts/reset-democoliving.js "other@email.com"   # 可改為其他 email
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runRemoveByEmail, pool } = require('./remove-staff-and-client-by-email.js');

const email = process.argv[2] && process.argv[2].trim() ? process.argv[2].trim() : 'democoliving@gmail.com';

runRemoveByEmail(email)
  .then(() => pool.end())
  .then(() => console.log('Done.'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
