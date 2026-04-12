#!/usr/bin/env node
/**
 * Debug Smart Access options for an owner.
 * Usage: node scripts/debug-smart-access-options.js <owner_email>
 * Shows: properties, property locks, room locks, and what getRoomsWithLocksForOwner would return.
 */
require('dotenv').config();
const pool = require('../src/config/db');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.log('Usage: node scripts/debug-smart-access-options.js owner@example.com');
    console.log('       (Replace owner@example.com with the actual owner email)');
    process.exit(1);
  }

  const [ownerRows] = await pool.query(
    'SELECT id, ownername, email FROM ownerdetail WHERE LOWER(TRIM(email)) = ?',
    [email.trim().toLowerCase()]
  );
  const owner = ownerRows[0];
  if (!owner) {
    console.log('Owner not found:', email);
    process.exit(1);
  }

  let propertyIds = [];
  const [opRows] = await pool.query('SELECT property_id FROM owner_property WHERE owner_id = ?', [owner.id]);
  propertyIds = (opRows || []).map(r => r.property_id);
  if (propertyIds.length === 0) {
    const [pRows] = await pool.query('SELECT id FROM propertydetail WHERE owner_id = ?', [owner.id]);
    propertyIds = (pRows || []).map(r => r.id);
  }
  propertyIds = [...new Set(propertyIds)];

  console.log('Owner:', owner.ownername, owner.email);
  console.log('Property IDs:', propertyIds);
  console.log('');

  for (const pid of propertyIds) {
    const [pRows] = await pool.query(
      `SELECT p.id, p.shortname, pl.lockid AS property_lockid
       FROM propertydetail p
       LEFT JOIN lockdetail pl ON pl.id = p.smartdoor_id
       WHERE p.id = ?`,
      [pid]
    );
    const p = pRows[0];
    console.log('Property:', p?.shortname || pid);
    console.log('  - Property lock (smartdoor_id):', p?.property_lockid ? 'YES' : 'NO');

    const [roomRows] = await pool.query(
      `SELECT rd.id, rd.roomname, rd.smartdoor_id, rl.lockid
       FROM roomdetail rd
       LEFT JOIN lockdetail rl ON rl.id = rd.smartdoor_id
       WHERE rd.property_id = ?
       ORDER BY rd.roomname`,
      [pid]
    );
    console.log('  - Rooms with smartdoor_id:', (roomRows || []).filter(r => r.smartdoor_id).length);
    for (const r of roomRows || []) {
      if (r.smartdoor_id) {
        console.log('    -', r.roomname || r.id, '| lockid:', r.lockid);
      }
    }
    console.log('');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
