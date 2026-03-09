/**
 * Check if a meter exists in meterdetail by meterid (e.g. 11-digit CMS meter ID).
 * Usage: node scripts/check-meter.js <meterid>
 * Example: node scripts/check-meter.js 19104669999
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

const meterId = process.argv[2] ? String(process.argv[2]).trim() : null;
if (!meterId) {
  console.log('Usage: node scripts/check-meter.js <meterid>');
  process.exit(1);
}

async function main() {
  try {
    const [rows] = await pool.query(
      `SELECT id, client_id, meterid, title, mode, productname, balance, isonline, status, room_id, property_id, created_at, updated_at
       FROM meterdetail WHERE meterid = ?`,
      [meterId]
    );
    if (!rows || rows.length === 0) {
      console.log(`Meter meterid="${meterId}": NOT FOUND (no row in meterdetail).`);
      process.exit(0);
    }
    console.log(`Meter meterid="${meterId}": FOUND ${rows.length} row(s).`);
    rows.forEach((r, i) => {
      console.log(JSON.stringify({
        index: i + 1,
        id: r.id,
        client_id: r.client_id,
        meterid: r.meterid,
        title: r.title,
        mode: r.mode,
        productname: r.productname,
        balance: r.balance,
        isonline: !!r.isonline,
        status: !!r.status,
        room_id: r.room_id,
        property_id: r.property_id,
        created_at: r.created_at,
        updated_at: r.updated_at
      }, null, 2));
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    pool.end();
  }
}

main();
