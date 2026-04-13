/**
 * One-off: set ownerdetail/tenantdetail/supplierdetail.account[] Bukku id for a client
 * when Bukku has duplicate contacts per email and auto-sync cannot resolve.
 *
 * Usage: node scripts/fix-bukku-account-ids-coliving.js
 */
const pool = require('../src/config/db');
const contactSync = require('../src/modules/contact/contact-sync.service.js');

const CLIENT_ID = '58f809ea-c0af-4233-8b0d-66d0b15d000f';
const PROVIDER = 'bukku';

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

async function writeSupplierAccount(supplierId, clientId, provider, contactId) {
  const [rows] = await pool.query(
    'SELECT id, account FROM supplierdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [supplierId, clientId]
  );
  if (!rows.length) throw new Error(`SUPPLIER_NOT_FOUND ${supplierId}`);
  const merged = contactSync.mergeAccountEntry(parseJson(rows[0].account) || [], clientId, provider, contactId);
  await pool.query('UPDATE supplierdetail SET account = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [
    JSON.stringify(merged),
    supplierId,
    clientId
  ]);
}

/** Verified Bukku contact ids (operator-provided). */
const PATCH = [
  { table: 'owner', id: '0ec85aad-8cd4-41e1-a4ce-c41538eb6568', bukkuId: '98' },
  { table: 'supplier', id: '0841b059-48b6-4e65-988d-1fb24006db97', bukkuId: '86' },
  { table: 'tenant', id: '757a641f-2c89-4d97-8e00-e17c744df098', bukkuId: '75' },
  { table: 'owner', id: '484186b8-5902-46db-8875-97c0b2832152', bukkuId: '75' },
  { table: 'supplier', id: '73282375-a1f0-4087-9b2b-693c9efa3ef8', bukkuId: '75' },
  { table: 'tenant', id: '477f4ca8-bf79-4c59-a7d2-8338596fe65e', bukkuId: '182' },
  { table: 'owner', id: '99a82c82-1216-4971-98c8-d44e2f6092bb', bukkuId: '155' },
  { table: 'supplier', id: '10f2f526-d587-40b6-af5f-c0912ae851f8', bukkuId: '155' }
];

async function main() {
  for (const row of PATCH) {
    if (row.table === 'owner') {
      const r = await contactSync.writeOwnerAccount(row.id, CLIENT_ID, PROVIDER, row.bukkuId);
      if (!r.ok) throw new Error(`owner ${row.id}: ${r.reason}`);
      console.log('OK owner', row.id, '→', row.bukkuId);
    } else if (row.table === 'tenant') {
      const r = await contactSync.writeTenantAccount(row.id, CLIENT_ID, PROVIDER, row.bukkuId);
      if (!r.ok) throw new Error(`tenant ${row.id}: ${r.reason}`);
      console.log('OK tenant', row.id, '→', row.bukkuId);
    } else {
      await writeSupplierAccount(row.id, CLIENT_ID, PROVIDER, row.bukkuId);
      console.log('OK supplier', row.id, '→', row.bukkuId);
    }
  }
  console.log('Done.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
