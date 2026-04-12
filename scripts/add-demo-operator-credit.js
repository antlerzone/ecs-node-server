#!/usr/bin/env node
/**
 * Add credit to the operator (client) for demo.portal.colivingjb.com.
 * Resolves client by subdomain: "demo" (from demo.portal.colivingjb.com).
 * Usage: node scripts/add-demo-operator-credit.js [subdomain] [amount]
 * Example: node scripts/add-demo-operator-credit.js demo 30000
 * Default: subdomain=demo, amount=30000
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const { addClientCredit, getClientCreditBalance } = require('../src/modules/stripe/stripe.service');

const DEFAULT_SUBDOMAIN = 'demo';
const DEFAULT_AMOUNT = 30000;

async function findClientIdBySubdomain(subdomain) {
  const raw = (subdomain && String(subdomain).trim()) ? String(subdomain).trim().toLowerCase() : '';
  if (!raw) return null;
  const [profileRows] = await pool.query(
    'SELECT client_id FROM client_profile WHERE LOWER(TRIM(subdomain)) = ? LIMIT 1',
    [raw]
  );
  if (profileRows.length) return profileRows[0].client_id;
  const [clientRows] = await pool.query(
    'SELECT id FROM operatordetail WHERE LOWER(TRIM(subdomain)) = ? LIMIT 1',
    [raw]
  );
  if (clientRows.length) return clientRows[0].id;
  return null;
}

/** Resolve demo operator: by subdomain or by client_profile.is_demo = 1 (demo.portal = demo account). */
async function findDemoClientId(subdomain) {
  if (subdomain) {
    const id = await findClientIdBySubdomain(subdomain);
    if (id) return id;
  }
  const [rows] = await pool.query(
    'SELECT client_id FROM client_profile WHERE is_demo = 1 ORDER BY client_id LIMIT 1'
  );
  return rows.length ? rows[0].client_id : null;
}

async function main() {
  const subdomain = process.argv[2] || DEFAULT_SUBDOMAIN;
  const amount = parseInt(process.argv[3], 10) || DEFAULT_AMOUNT;

  const clientId = await findDemoClientId(subdomain);
  if (!clientId) {
    console.error('Demo client not found. Tried subdomain:', subdomain, 'and client_profile.is_demo=1.');
    process.exit(1);
  }

  const before = await getClientCreditBalance(clientId);
  await addClientCredit(clientId, amount);
  const after = await getClientCreditBalance(clientId);

  console.log('Added', amount, 'credit to operator (subdomain=', subdomain, ', client_id=', clientId, ')');
  console.log('Balance:', before, '->', after);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(() => {
  pool.end().catch(() => {});
});
