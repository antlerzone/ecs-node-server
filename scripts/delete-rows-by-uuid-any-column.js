/**
 * Delete every row where any string/JSON column equals the given UUID (exact match).
 * Loops until no more rows match (handles cross-table references).
 *
 *   node scripts/delete-rows-by-uuid-any-column.js <uuid>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const uuid = (process.argv[2] || '').trim();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
  console.error('Usage: node scripts/delete-rows-by-uuid-any-column.js <uuid>');
  process.exit(1);
}

const STRING_TYPES = new Set([
  'char',
  'varchar',
  'text',
  'tinytext',
  'mediumtext',
  'longtext',
  'json',
  'enum',
  'set'
]);

async function run() {
  const db = process.env.DB_NAME;
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: db,
    multipleStatements: false,
    charset: 'utf8mb4'
  });

  const [tables] = await conn.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [db]
  );

  const tableCols = [];
  for (const { t } of tables) {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME AS c, DATA_TYPE AS dt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [db, t]
    );
    const strCols = cols.filter((row) => STRING_TYPES.has(String(row.dt || '').toLowerCase()));
    if (strCols.length) tableCols.push({ table: t, columns: strCols.map((r) => r.c) });
  }

  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  let grand = 0;
  const byTable = [];

  try {
    for (let round = 0; round < 100; round++) {
      let roundSum = 0;
      for (const { table, columns } of tableCols) {
        const cond = columns.map((c) => `\`${c}\` = ?`).join(' OR ');
        const binds = columns.map(() => uuid);
        const [res] = await conn.query(`DELETE FROM \`${table}\` WHERE ${cond}`, binds);
        const n = res.affectedRows || 0;
        if (n > 0) {
          roundSum += n;
          const prev = byTable.find((x) => x.table === table);
          if (prev) prev.rows += n;
          else byTable.push({ table, rows: n });
        }
      }
      grand += roundSum;
      if (roundSum === 0) break;
    }
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.end();
  }

  console.log('UUID:', uuid);
  console.log('Total rows deleted:', grand);
  if (byTable.length) {
    byTable.sort((a, b) => b.rows - a.rows);
    console.log('By table:');
    for (const { table, rows } of byTable) console.log(`  ${table}: ${rows}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
