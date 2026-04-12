#!/usr/bin/env node
/**
 * Check which Stripe platform (MY or SG) a client uses.
 * Usage: node scripts/check-client-stripe-platform.js <client_id>
 * Example: node scripts/check-client-stripe-platform.js 3b290b90-b767-4368-bb40-d12c51e8b582
 */
require('dotenv').config();
const pool = require('../src/config/db');

const clientId = process.argv[2];
if (!clientId) {
  console.log('Usage: node scripts/check-client-stripe-platform.js <client_id>');
  process.exit(1);
}

async function main() {
  const [profileRows] = await pool.query(
    'SELECT stripe_sandbox, stripe_platform FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const [clientRows] = await pool.query(
    'SELECT currency FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );

  const profile = profileRows[0];
  const client = clientRows[0];
  if (!client) {
    console.log('Client not found:', clientId);
    process.exit(1);
  }

  let platform = (profile && profile.stripe_platform) ? String(profile.stripe_platform).toUpperCase() : null;
  if (platform !== 'MY' && platform !== 'SG') {
    platform = (client.currency && String(client.currency).toUpperCase() === 'SGD') ? 'SG' : 'MY';
  }
  const sandbox = profile && Number(profile.stripe_sandbox) === 1;

  console.log('Client ID:', clientId);
  console.log('client_profile.stripe_platform:', profile?.stripe_platform ?? '(null, fallback from currency)');
  console.log('client_profile.stripe_sandbox:', profile?.stripe_sandbox ?? '(null)');
  console.log('operatordetail.currency:', client?.currency ?? '(null)');
  console.log('---');
  console.log('Resolved: Stripe', platform, sandbox ? '(sandbox)' : '(live)');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
