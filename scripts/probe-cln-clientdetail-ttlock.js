/**
 * Inspect Cleanlemons B2B client TTLock + coliving bridge for one cln_clientdetail.id
 * Usage: node scripts/probe-cln-clientdetail-ttlock.js <clientdetail_id>
 */
require('dotenv').config();
const pool = require('../src/config/db');

const cid = process.argv[2] || '';

async function main() {
  if (!cid) {
    console.error('Usage: node scripts/probe-cln-clientdetail-ttlock.js <clientdetail_id>');
    process.exit(1);
  }

  const [bridge] = await pool.query(
    `SELECT id, enabled, \`key\`, provider, values_json
     FROM cln_client_integration
     WHERE clientdetail_id = ? AND \`key\` = 'colivingBridge' AND provider = 'coliving'
     LIMIT 1`,
    [cid]
  );

  const [ttlock] = await pool.query(
    `SELECT id, slot, enabled, \`key\`, provider, values_json
     FROM cln_client_integration
     WHERE clientdetail_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock'
     ORDER BY slot`,
    [cid]
  );

  const [tok] = await pool.query(
    'SELECT id, clientdetail_id FROM cln_ttlocktoken WHERE clientdetail_id = ?',
    [cid]
  );

  console.log('=== cln_clientdetail_id:', cid, '===');
  console.log('\n[colivingBridge row]', bridge.length ? bridge[0] : '(none)');
  console.log('\n[TTLock rows]', ttlock.length, ttlock);
  console.log('\n[cln_ttlocktoken rows]', tok.length, tok);

  if (bridge.length) {
    let v = bridge[0].values_json;
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v || '{}');
      } catch {
        v = {};
      }
    }
    const oid = v.coliving_operatordetail_id;
    if (oid) {
      const [co] = await pool.query(
        `SELECT values_json, enabled FROM client_integration
         WHERE client_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' LIMIT 1`,
        [String(oid)]
      );
      console.log('\n[Coliving company TTLock client_integration]', co[0] || '(none)');
      const [[od]] = await pool.query(
        'SELECT id, ttlock_username FROM operatordetail WHERE id = ? LIMIT 1',
        [String(oid)]
      );
      console.log('[operatordetail.ttlock_username]', od || '(none)');
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
