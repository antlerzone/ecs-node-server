/**
 * 查 Google Sheet Reservation L 列（Listing UUID）在 cln_property 里落在哪一列。
 *
 * 用法（项目根目录）:
 *   node scripts/probe-cln-property-sheet-uuid.js 0006068b-98b1-4dd5-a1e2-1a4f4ed2c389
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const UUID = (process.argv[2] || '').trim();
if (!UUID) {
  console.error('用法: node scripts/probe-cln-property-sheet-uuid.js <uuid>');
  process.exit(1);
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [[hasHs]] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'homestay_source_id'`
  );
  const useHomestayCol = Number(hasHs?.n || 0) > 0;

  const selectCols = useHomestayCol
    ? 'id, operator_id, property_name, homestay_source_id, source_id'
    : 'id, operator_id, property_name, source_id';

  const whereClause = useHomestayCol
    ? 'id = ? OR homestay_source_id = ? OR source_id = ?'
    : 'id = ? OR source_id = ?';

  const params = useHomestayCol ? [UUID, UUID, UUID] : [UUID, UUID];

  const [rows] = await c.query(
    `SELECT ${selectCols}
     FROM cln_property
     WHERE ${whereClause}
     LIMIT 20`,
    params
  );

  if (!rows.length) {
    console.log(
      useHomestayCol
        ? '没有命中行（id / homestay_source_id / source_id 都不等于这个 UUID）。'
        : '没有命中行（id / source_id 都不等于这个 UUID）。本库无 homestay_source_id 列，请跑迁移 0239 等后再查。'
    );
  } else {
    console.log('命中', rows.length, '行：');
    for (const r of rows) {
      console.log(JSON.stringify(r, null, 2));
    }
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
