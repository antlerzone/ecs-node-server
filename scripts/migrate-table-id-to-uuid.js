/**
 * 把指定表的 id 从 int/其它 改成 UUID，并更新所有引用该表 id 的外键。
 * UUID 用 crypto.randomUUID()，保证不重复。
 * Usage: node scripts/migrate-table-id-to-uuid.js <table_name>
 * Example: node scripts/migrate-table-id-to-uuid.js propertydetail
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');

const tableName = process.argv[2];
if (!tableName) {
  console.error('Usage: node scripts/migrate-table-id-to-uuid.js <table_name>');
  process.exit(1);
}

const dbName = process.env.DB_NAME;

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: dbName,
    charset: 'utf8mb4',
    multipleStatements: true
  });

  const tbl = tableName.toLowerCase();

  try {
    const [cols] = await conn.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
      [dbName, tbl, 'id']
    );
    if (cols.length === 0) {
      console.error('Table', tbl, 'has no column id.');
      process.exit(1);
    }

    const [rows] = await conn.query(`SELECT id FROM \`${tbl}\``);
    if (rows.length === 0) {
      console.log('Table', tbl, 'is empty, nothing to migrate.');
      return;
    }

    const used = new Set();
    const map = new Map();
    for (const r of rows) {
      const oldId = r.id;
      let uuid;
      do {
        uuid = randomUUID();
      } while (used.has(uuid));
      used.add(uuid);
      map.set(String(oldId), uuid);
    }
    console.log('Generated', map.size, 'UUIDs (no duplicate).');

    const tmpCol = 'id_uuid_new_' + Date.now();
    await conn.query(`ALTER TABLE \`${tbl}\` ADD COLUMN \`${tmpCol}\` varchar(36) DEFAULT NULL`);
    for (const [oldId, uuid] of map) {
      await conn.query(`UPDATE \`${tbl}\` SET \`${tmpCol}\` = ? WHERE id = ?`, [uuid, oldId]);
    }
    console.log('Filled', tmpCol);

    const [refs] = await conn.query(
      `SELECT table_name AS tn, column_name AS cn
       FROM information_schema.key_column_usage
       WHERE referenced_table_schema = ? AND referenced_table_name = ? AND referenced_column_name = 'id'`,
      [dbName, tbl]
    );

    for (const ref of refs) {
      const tn = ref.tn;
      const cn = ref.cn;
      for (const [oldId, newUuid] of map) {
        const [r] = await conn.query(`UPDATE \`${tn}\` SET \`${cn}\` = ? WHERE \`${cn}\` = ?`, [newUuid, oldId]);
        if (r.affectedRows > 0) console.log('Updated', tn + '.' + cn, 'old', oldId, '->', newUuid);
      }
      console.log('Done FK', tn + '.' + cn);
    }

    const [pk] = await conn.query(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_schema = ? AND table_name = ? AND constraint_type = 'PRIMARY KEY'`,
      [dbName, tbl]
    );
    if (pk.length > 0) await conn.query(`ALTER TABLE \`${tbl}\` DROP PRIMARY KEY`);
    await conn.query(`ALTER TABLE \`${tbl}\` DROP COLUMN id`);
    await conn.query(`ALTER TABLE \`${tbl}\` CHANGE COLUMN \`${tmpCol}\` id varchar(36) NOT NULL`);
    await conn.query(`ALTER TABLE \`${tbl}\` ADD PRIMARY KEY (id)`);
    console.log('Table', tbl, 'id migrated to UUID.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
