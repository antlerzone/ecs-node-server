#!/usr/bin/env node
/**
 * Batch: read-only Bukku match → UPDATE ownerpayout.bukkuinvoice / bukkubills.
 * Usage:
 *   node scripts/backfill-ownerpayout-bukku-urls.js --client-id=<uuid> [--commit] [--force]
 * Without --commit: dry-run only (same as link service dryRun: true).
 * Requires .env DB_* and client must have Bukku integration + accounting plan.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const {
  linkExistingBukkuUrlsForOwnerPayout
} = require('../src/modules/generatereport/generatereport-bukku-linkback.service');

function argv(name) {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : null;
}

async function main() {
  const clientId = argv('client-id');
  if (!clientId) {
    console.error('Usage: node scripts/backfill-ownerpayout-bukku-urls.js --client-id=<uuid> [--commit] [--force]');
    process.exit(1);
  }
  const commit = process.argv.includes('--commit');
  const force = process.argv.includes('--force');

  const [rows] = await pool.query(
    `SELECT id FROM ownerpayout WHERE client_id = ?
       AND (${force ? '1=1' : '(bukkuinvoice IS NULL OR TRIM(bukkuinvoice) = \'\' OR bukkubills IS NULL OR TRIM(bukkubills) = \'\')'})
     ORDER BY period DESC`,
    [clientId]
  );

  console.log(`[backfill-ownerpayout-bukku] client=${clientId} rows=${rows.length} commit=${commit} force=${force}`);

  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    const out = await linkExistingBukkuUrlsForOwnerPayout(clientId, r.id, {
      dryRun: !commit,
      force
    });
    const line = `${r.id} ${out.ok ? 'OK' : 'FAIL'} ${out.reason || ''} inv=${out.bukkuinvoice || ''} bill=${out.bukkubills || ''}`;
    console.log(line);
    if (out.ok) ok += 1;
    else fail += 1;
  }
  console.log(`[backfill-ownerpayout-bukku] done ok=${ok} fail=${fail}`);
  await pool.end().catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  pool.end().catch(() => {});
  process.exit(1);
});
