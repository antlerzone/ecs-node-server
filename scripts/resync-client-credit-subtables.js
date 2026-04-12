#!/usr/bin/env node
/**
 * One-off: rebuild client_credit from operatordetail.credit JSON (fixes stale SUM after
 * creditlogs/operatordetail were updated but syncCredit skipped empty arrays).
 * Usage: node scripts/resync-client-credit-subtables.js
 */
const pool = require('../src/config/db');
const { syncSubtablesFromOperatordetail } = require('../src/services/client-subtables');

async function main() {
  const [rows] = await pool.query(
    'SELECT id FROM operatordetail WHERE credit IS NOT NULL AND TRIM(COALESCE(credit, "")) != ""'
  );
  let ok = 0;
  for (const r of rows) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await syncSubtablesFromOperatordetail(conn, r.id);
      await conn.commit();
      ok += 1;
    } catch (e) {
      await conn.rollback();
      console.error('[resync-client-credit] failed client_id=', r.id, e?.message || e);
    } finally {
      conn.release();
    }
  }
  console.log('[resync-client-credit] done', ok, '/', rows.length);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
