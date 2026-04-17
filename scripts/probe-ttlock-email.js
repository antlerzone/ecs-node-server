/**
 * One-off: find TTLock rows containing an email substring (Cleanlemons + Coliving).
 * Usage: node scripts/probe-ttlock-email.js [substring] [--delete]
 */
require('dotenv').config();
const pool = require('../src/config/db');

const SUB = process.argv[2] || 'colivingmanagement';
const DO_DELETE = process.argv.includes('--delete');

async function main() {
  const like = `%${SUB}%`;

  const [cln] = await pool.query(
    `SELECT id, clientdetail_id, slot, enabled, values_json
     FROM cln_client_integration
     WHERE \`key\` = 'smartDoor' AND provider = 'ttlock' AND values_json LIKE ?`,
    [like]
  );

  const [ci] = await pool.query(
    `SELECT client_id, enabled, values_json
     FROM client_integration
     WHERE \`key\` = 'smartDoor' AND provider = 'ttlock' AND values_json LIKE ?`,
    [like]
  );

  console.log('=== cln_client_integration (Cleanlemons B2B TTLock) ===');
  console.log('count:', cln.length);
  for (const r of cln) {
    console.log({
      id: r.id,
      clientdetail_id: r.clientdetail_id,
      slot: r.slot,
      enabled: r.enabled,
      snippet: String(r.values_json).slice(0, 200)
    });
  }

  console.log('\n=== client_integration (Coliving company TTLock) ===');
  console.log('count:', ci.length);
  for (const r of ci) {
    console.log({
      client_id: r.client_id,
      enabled: r.enabled,
      snippet: String(r.values_json).slice(0, 200)
    });
  }

  if (cln.length && DO_DELETE) {
    console.log('\n--delete: DELETE cln_client_integration row(s) + cln_ttlocktoken ...');
    for (const r of cln) {
      const cid = String(r.clientdetail_id);
      const sl = Number(r.slot) || 0;
      try {
        await pool.query('DELETE FROM cln_ttlocktoken WHERE clientdetail_id = ? AND slot = ?', [cid, sl]);
      } catch (e) {
        if (/Unknown column.*slot/i.test(String(e.message || ''))) {
          await pool.query('DELETE FROM cln_ttlocktoken WHERE clientdetail_id = ?', [cid]);
        } else {
          console.warn('token delete:', e.message);
        }
      }
      await pool.query('DELETE FROM cln_client_integration WHERE id = ?', [r.id]);
      console.log('removed integration id', r.id, 'clientdetail', cid, 'slot', sl);
    }
  } else if (DO_DELETE && !cln.length) {
    console.log('\n--delete: no cln_client_integration rows matched; nothing deleted.');
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
