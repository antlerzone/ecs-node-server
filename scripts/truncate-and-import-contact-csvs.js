/**
 * Truncate ownerdetail, tenantdetail, supplierdetail (+ junctions) then import three Wix CSVs.
 * Default CSV paths (Coliving repo):
 *   cleanlemon/next-app/Wix cms/Tenant+Detail (3).csv
 *   cleanlemon/next-app/Wix cms/Supplier+Detail.csv
 *   cleanlemon/next-app/Wix cms/Owner+Detail.csv
 *
 * Usage (from repo root):
 *   node scripts/truncate-and-import-contact-csvs.js
 *   node scripts/truncate-and-import-contact-csvs.js /path/to/tenant.csv /path/to/supplier.csv /path/to/owner.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { execSync } = require('child_process');
const mysql = require('mysql2/promise');

const root = path.join(__dirname, '..');
const defaults = {
  tenant: path.join(root, 'cleanlemon/next-app/Wix cms/Tenant+Detail (3).csv'),
  supplier: path.join(root, 'cleanlemon/next-app/Wix cms/Supplier+Detail.csv'),
  owner: path.join(root, 'cleanlemon/next-app/Wix cms/Owner+Detail.csv'),
};

const tenantCsv = process.argv[2] || defaults.tenant;
const supplierCsv = process.argv[3] || defaults.supplier;
const ownerCsv = process.argv[4] || defaults.owner;

const scriptsDir = __dirname;

async function truncateAll() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  const tables = [
    'tenant_client',
    'owner_client',
    'tenantdetail',
    'supplierdetail',
    'ownerdetail',
  ];
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of tables) {
      try {
        await conn.query(`TRUNCATE TABLE \`${t}\``);
        console.log('[truncate-and-import-contact-csvs] truncated', t);
      } catch (e) {
        console.warn('[truncate-and-import-contact-csvs] skip', t, e?.message || e);
      }
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await conn.end();
  }
}

function runNode(scriptName, csvPath) {
  const script = path.join(scriptsDir, scriptName);
  console.log('[truncate-and-import-contact-csvs] node', scriptName, csvPath);
  execSync(`node "${script}" "${csvPath}"`, { stdio: 'inherit', cwd: root });
}

async function main() {
  const fs = require('fs');
  for (const [label, p] of [
    ['tenant', tenantCsv],
    ['supplier', supplierCsv],
    ['owner', ownerCsv],
  ]) {
    if (!fs.existsSync(p)) {
      console.error(`Missing ${label} CSV:`, p);
      process.exit(1);
    }
  }

  console.log('[truncate-and-import-contact-csvs] Truncating junctions + tenantdetail + supplierdetail + ownerdetail...');
  await truncateAll();

  console.log('\n[truncate-and-import-contact-csvs] Import ownerdetail → tenantdetail → supplierdetail\n');
  runNode('import-ownerdetail.js', ownerCsv);
  runNode('import-tenantdetail.js', tenantCsv);
  runNode('import-supplierdetail.js', supplierCsv);

  console.log('\n[truncate-and-import-contact-csvs] Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
