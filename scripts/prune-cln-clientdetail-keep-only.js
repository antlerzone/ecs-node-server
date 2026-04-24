/**
 * 仅保留指定 cln_clientdetail.id，删除其余行及其关联数据（物业、集成、锁表 cln_clientid 等）。
 *
 *   node scripts/prune-cln-clientdetail-keep-only.js
 *
 * 使用根目录 .env 的 DB_*（与仓库其他脚本一致）。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

/** 保留的 B2B 客户 id（cln_clientdetail.id） */
const KEEP_IDS = [
  'f6f8e758-387f-4680-a589-4fd0dd2c38b2',
  'ecbd52eb-54ec-44a7-8ef2-32142ce783d6',
  '8c3a6903-0b75-4b07-b443-1080783e2da1',
  '6dbda0e9-6922-4229-bab7-ad3dc3e12e3e',
];

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
    console.error('Missing DB_NAME in .env');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: db,
    charset: 'utf8mb4',
    multipleStatements: false,
  });

  const placeholders = KEEP_IDS.map(() => '?').join(',');

  try {
    await conn.beginTransaction();

    const [[{ cnt: before }]] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM `cln_clientdetail`'
    );
    console.log('cln_clientdetail rows before:', before);

    const [propRows] = await conn.query(
      `SELECT id FROM cln_property
       WHERE clientdetail_id IS NOT NULL AND clientdetail_id NOT IN (${placeholders})`,
      KEEP_IDS
    );
    const propIds = propRows.map((r) => r.id);
    console.log('Properties to remove (by clientdetail_id):', propIds.length);

    if (propIds.length > 0) {
      const ph = propIds.map(() => '?').join(',');
      if (await tableExists(conn, db, 'cln_damage_report')) {
        const [dr] = await conn.query(
          `DELETE FROM cln_damage_report WHERE property_id IN (${ph})`,
          propIds
        );
        console.log('DELETE cln_damage_report affected:', dr.affectedRows);
      }
      const [dp] = await conn.query(`DELETE FROM cln_property WHERE id IN (${ph})`, propIds);
      console.log('DELETE cln_property affected:', dp.affectedRows);
    }

    if (await tableExists(conn, db, 'cln_property_link_request')) {
      const [plr] = await conn.query(
        `DELETE FROM cln_property_link_request WHERE clientdetail_id NOT IN (${placeholders})`,
        KEEP_IDS
      );
      console.log('DELETE cln_property_link_request affected:', plr.affectedRows);
    }

    if (await tableExists(conn, db, 'cln_property_group')) {
      const [pg] = await conn.query(
        `DELETE FROM cln_property_group WHERE owner_clientdetail_id NOT IN (${placeholders})`,
        KEEP_IDS
      );
      console.log('DELETE cln_property_group (non-keep owners) affected:', pg.affectedRows);
    }

    if (
      (await tableExists(conn, db, 'cln_property_group_member')) &&
      (await columnExists(conn, db, 'cln_property_group_member', 'grantee_clientdetail_id'))
    ) {
      const [pgm] = await conn.query(
        `UPDATE cln_property_group_member SET grantee_clientdetail_id = NULL
         WHERE grantee_clientdetail_id IS NOT NULL AND grantee_clientdetail_id NOT IN (${placeholders})`,
        KEEP_IDS
      );
      console.log('UPDATE cln_property_group_member clear grantee affected:', pgm.affectedRows);
    }

    if ((await tableExists(conn, db, 'lockdetail')) && (await columnExists(conn, db, 'lockdetail', 'cln_clientid'))) {
      const [ld] = await conn.query(
        `UPDATE lockdetail SET cln_clientid = NULL
         WHERE cln_clientid IS NOT NULL AND cln_clientid NOT IN (${placeholders})`,
        KEEP_IDS
      );
      console.log('UPDATE lockdetail cln_clientid cleared:', ld.affectedRows);
    }
    if (
      (await tableExists(conn, db, 'gatewaydetail')) &&
      (await columnExists(conn, db, 'gatewaydetail', 'cln_clientid'))
    ) {
      const [gd] = await conn.query(
        `UPDATE gatewaydetail SET cln_clientid = NULL
         WHERE cln_clientid IS NOT NULL AND cln_clientid NOT IN (${placeholders})`,
        KEEP_IDS
      );
      console.log('UPDATE gatewaydetail cln_clientid cleared:', gd.affectedRows);
    }

    if ((await tableExists(conn, db, 'ttlocktoken')) && (await columnExists(conn, db, 'ttlocktoken', 'clientdetail_id'))) {
      const [tt] = await conn.query(
        `UPDATE ttlocktoken SET clientdetail_id = NULL
         WHERE clientdetail_id IS NOT NULL AND clientdetail_id NOT IN (${placeholders})`,
        KEEP_IDS
      );
      console.log('UPDATE ttlocktoken clientdetail_id cleared:', tt.affectedRows);
    }

    const [fkRows] = await conn.query(
      `SELECT DISTINCT TABLE_NAME, COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ?
         AND REFERENCED_TABLE_NAME = 'cln_clientdetail'
         AND REFERENCED_COLUMN_NAME = 'id'
         AND TABLE_NAME != 'cln_clientdetail'`,
      [db]
    );

    for (const { TABLE_NAME, COLUMN_NAME } of fkRows) {
      const [r] = await conn.query(
        `DELETE FROM \`${TABLE_NAME}\`
         WHERE \`${COLUMN_NAME}\` IS NOT NULL AND \`${COLUMN_NAME}\` NOT IN (${placeholders})`,
        KEEP_IDS
      );
      console.log(`DELETE ${TABLE_NAME}.${COLUMN_NAME}:`, r.affectedRows);
    }

    const [del] = await conn.query(
      `DELETE FROM cln_clientdetail WHERE id NOT IN (${placeholders})`,
      KEEP_IDS
    );
    console.log('DELETE cln_clientdetail (non-keep):', del.affectedRows);

    const [[{ cnt: after }]] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM `cln_clientdetail`'
    );
    console.log('cln_clientdetail rows after:', after);

    await conn.commit();
    console.log('Done (committed).');
  } catch (e) {
    await conn.rollback();
    console.error('Rolled back:', e.message);
    throw e;
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
