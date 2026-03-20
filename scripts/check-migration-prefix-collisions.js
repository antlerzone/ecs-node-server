#!/usr/bin/env node
/**
 * Guardrail: fail when migration prefix number is duplicated.
 * Example duplicate: 0044_xxx.sql and 0044_yyy.sql
 */
const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');
const legacyAllowedCollisions = new Set([
  '0033',
  '0040',
  '0044',
  '0051',
  '0058',
  '0086',
  '0087'
]);

function main() {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const byPrefix = new Map();
  for (const name of files) {
    const match = name.match(/^(\d{4})_/);
    if (!match) continue;
    const prefix = match[1];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(name);
  }

  const collisions = [...byPrefix.entries()]
    .filter(([, names]) => names.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const newCollisions = collisions.filter(([prefix]) => !legacyAllowedCollisions.has(prefix));

  if (newCollisions.length === 0) {
    if (collisions.length === 0) {
      console.log('[migrations] OK: no duplicated 4-digit prefixes.');
    } else {
      console.log('[migrations] OK: no NEW duplicated prefixes (legacy collisions ignored).');
    }
    process.exit(0);
  }

  console.error('[migrations] ERROR: NEW duplicated 4-digit prefixes detected.');
  for (const [prefix, names] of newCollisions) {
    console.error(`  ${prefix}:`);
    for (const name of names) {
      console.error(`    - ${name}`);
    }
  }
  console.error(
    '\nUse docs/db/migration-numbering-governance.md to assign a new unique prefix for future migrations.'
  );
  process.exit(1);
}

main();
