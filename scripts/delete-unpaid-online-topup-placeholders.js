/**
 * Remove creditlogs rows created by startNormalTopup before redirect (reference TP-{uuid}, is_paid=0).
 * Safe: does not touch paid topups or manual bank rows (TOP-*). Run on ECS where DB is reachable:
 *   node scripts/delete-unpaid-online-topup-placeholders.js
 */
const pool = require('../src/config/db');

(async () => {
  try {
    const [r] = await pool.query(
      `DELETE FROM creditlogs
       WHERE type = 'Topup'
         AND COALESCE(is_paid, 0) != 1
         AND reference_number LIKE 'TP-%'
         AND amount > 0`
    );
    console.log('deleted rows:', r.affectedRows);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
  process.exit(0);
})();
