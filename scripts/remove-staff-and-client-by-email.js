/**
 * 移除某 email 的 staff 以及該 email 對應的 client，並刪除該 client 在所有關聯表（含 client_*、tenant、property、agreement 等）的資料。
 *
 * Usage: node scripts/remove-staff-and-client-by-email.js "email"
 * Example: node scripts/remove-staff-and-client-by-email.js "democoliving@gmail.com"
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

/** 所有帶 client_id 的表的刪除順序：先刪有依賴關係的子表，最後刪 clientdetail。 */
const TABLES_WITH_CLIENT_ID = [
  'refunddeposit',
  'tenancy',
  'roomdetail',
  'ownerpayout',
  'rentalcollection',
  'staffdetail',
  'agreement',
  'creditlogs',
  'pricingplanlogs',
  'cnyiottokens',
  'ttlocktoken',
  'stripepayout',
  'account_client',
  'owner_client',
  'tenant_client',
  'client_integration',
  'client_profile',
  'client_pricingplan_detail',
  'client_credit',
  'ticket',
  'feedback',
  'bills',
  'agreementtemplate',
  'gatewaydetail',
  'lockdetail',
  'meterdetail',
  'propertydetail',
  'ownerdetail',
  'tenantdetail',
  'supplierdetail',
  'parkinglot',
  'account',
  'creditplan'
];

async function deleteAllClientData(clientId) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES_WITH_CLIENT_ID) {
      try {
        const [r] = await conn.query(`DELETE FROM \`${table}\` WHERE client_id = ?`, [clientId]);
        if (r.affectedRows > 0) {
          console.log('  Deleted', r.affectedRows, 'rows from', table);
        }
      } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') continue;
        throw e;
      }
    }
    const [r] = await conn.query('DELETE FROM clientdetail WHERE id = ?', [clientId]);
    if (r.affectedRows > 0) {
      console.log('  Deleted clientdetail', clientId);
    }
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    conn.release();
  }
}

/**
 * @param {string} email - 要清除的 client/staff 的 email（小寫 trim）
 * @returns {Promise<void>}
 */
async function runRemoveByEmail(email) {
  const normalized = String(email).trim().toLowerCase();
  if (!normalized) return;

  // 1) 先查出該 email 的 staff 及其 client_id，再刪 staff（避免後面刪 client 時 FK 阻擋）
  const [staffRows] = await pool.query(
    'SELECT id, client_id, email FROM staffdetail WHERE LOWER(TRIM(email)) = ?',
    [normalized]
  );
  const clientIdsFromStaff = [];
  if (staffRows.length) {
    for (const s of staffRows) {
      if (s.client_id) clientIdsFromStaff.push(s.client_id);
      await pool.query('DELETE FROM staffdetail WHERE id = ?', [s.id]);
      console.log('Deleted staff', s.id, '(', s.email, ')');
    }
  } else {
    console.log('No staff found for', normalized);
  }

  // 2) 要刪的 client：email 相符 或 剛刪的 staff 曾指向的 client_id
  const [clientByEmail] = await pool.query(
    'SELECT id, title, email FROM clientdetail WHERE LOWER(TRIM(email)) = ?',
    [normalized]
  );
  const clientIdsToDelete = new Set(clientIdsFromStaff);
  for (const c of clientByEmail) clientIdsToDelete.add(c.id);

  if (clientIdsToDelete.size) {
    for (const clientId of clientIdsToDelete) {
      const [info] = await pool.query('SELECT id, title, email FROM clientdetail WHERE id = ?', [clientId]);
      if (!info.length) continue;
      const c = info[0];
      console.log('Deleting all data for client', clientId, '(', c.title, ',', c.email, ')');
      await deleteAllClientData(clientId);
      console.log('Done.');
    }
  } else {
    console.log('No client to delete for', normalized);
  }
}

async function main() {
  const email = process.argv[2] && process.argv[2].trim().toLowerCase();
  if (!email) {
    console.error('Usage: node scripts/remove-staff-and-client-by-email.js "email"');
    process.exit(1);
  }
  await runRemoveByEmail(email);
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runRemoveByEmail, pool };
