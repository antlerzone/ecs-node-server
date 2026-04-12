/**
 * Empty `cln_employeedetail` + `cln_clientdetail` (Cleanlemons directory: staff/driver/dobi/supervisor + B2B clients).
 *
 * - Truncates junction tables first (`cln_employee_operator`, `cln_client_operator`, `cln_client_integration`).
 * - Removes B2B TTLock rows in `cln_ttlocktoken`; nulls `ttlocktoken.clientdetail_id` if column exists.
 * - Sets `cln_property.clientdetail_id` and `lockdetail` / `gatewaydetail` `cln_clientid` to NULL (does not drop properties).
 * - Truncates `cln_property_link_request` if present (ties to clientdetail).
 *
 *   node scripts/truncate-cln-clientdetail-employeedetail.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, db, name) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1',
    [db, name]
  );
  return rows.length > 0;
}

async function columnExists(conn, db, table, col) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1',
    [db, table, col]
  );
  return rows.length > 0;
}

async function run() {
  const db = process.env.DB_NAME;
  if (!db) {
    console.error('DB_NAME missing in .env');
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: db,
    charset: 'utf8mb4',
  });

  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    if (await tableExists(conn, db, 'cln_employee_operator')) {
      await conn.query('TRUNCATE TABLE `cln_employee_operator`');
      console.log('TRUNCATE cln_employee_operator');
    }
    if (await tableExists(conn, db, 'cln_employeedetail')) {
      await conn.query('TRUNCATE TABLE `cln_employeedetail`');
      console.log('TRUNCATE cln_employeedetail');
    }

    if (await tableExists(conn, db, 'cln_client_operator')) {
      await conn.query('TRUNCATE TABLE `cln_client_operator`');
      console.log('TRUNCATE cln_client_operator');
    }
    if (await tableExists(conn, db, 'cln_client_integration')) {
      await conn.query('TRUNCATE TABLE `cln_client_integration`');
      console.log('TRUNCATE cln_client_integration');
    }

    if (await tableExists(conn, db, 'cln_ttlocktoken')) {
      const [delTt] = await conn.query('DELETE FROM `cln_ttlocktoken` WHERE `clientdetail_id` IS NOT NULL');
      console.log('DELETE cln_ttlocktoken WHERE clientdetail_id IS NOT NULL (rows:', delTt.affectedRows, ')');
    }

    if ((await tableExists(conn, db, 'ttlocktoken')) && (await columnExists(conn, db, 'ttlocktoken', 'clientdetail_id'))) {
      await conn.query('UPDATE `ttlocktoken` SET `clientdetail_id` = NULL WHERE `clientdetail_id` IS NOT NULL');
      console.log('UPDATE ttlocktoken SET clientdetail_id = NULL');
    }

    if ((await tableExists(conn, db, 'cln_property')) && (await columnExists(conn, db, 'cln_property', 'clientdetail_id'))) {
      const [upP] = await conn.query('UPDATE `cln_property` SET `clientdetail_id` = NULL WHERE `clientdetail_id` IS NOT NULL');
      console.log('UPDATE cln_property SET clientdetail_id = NULL (rows:', upP.affectedRows, ')');
    }

    if ((await tableExists(conn, db, 'lockdetail')) && (await columnExists(conn, db, 'lockdetail', 'cln_clientid'))) {
      const [upL] = await conn.query('UPDATE `lockdetail` SET `cln_clientid` = NULL WHERE `cln_clientid` IS NOT NULL');
      console.log('UPDATE lockdetail SET cln_clientid = NULL (rows:', upL.affectedRows, ')');
    }
    if ((await tableExists(conn, db, 'gatewaydetail')) && (await columnExists(conn, db, 'gatewaydetail', 'cln_clientid'))) {
      const [upG] = await conn.query('UPDATE `gatewaydetail` SET `cln_clientid` = NULL WHERE `cln_clientid` IS NOT NULL');
      console.log('UPDATE gatewaydetail SET cln_clientid = NULL (rows:', upG.affectedRows, ')');
    }

    if (await tableExists(conn, db, 'cln_property_link_request')) {
      await conn.query('TRUNCATE TABLE `cln_property_link_request`');
      console.log('TRUNCATE cln_property_link_request');
    }

    if (await tableExists(conn, db, 'cln_clientdetail')) {
      await conn.query('TRUNCATE TABLE `cln_clientdetail`');
      console.log('TRUNCATE cln_clientdetail');
    } else {
      console.log('SKIP cln_clientdetail (missing)');
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Done.');
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
