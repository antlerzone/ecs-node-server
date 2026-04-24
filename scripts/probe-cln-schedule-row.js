/**
 * One-off: inspect a cln_schedule row (status, team, ai_assignment_locked, property).
 * Usage: node scripts/probe-cln-schedule-row.js <schedule_uuid>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const id = String(process.argv[2] || '').trim();
if (!id) {
  console.error('Usage: node scripts/probe-cln-schedule-row.js <cln_schedule.id>');
  process.exit(1);
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [[{ cnt }]] = await c.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_schedule' AND COLUMN_NAME = 'ai_assignment_locked'`
  );
  const hasLock = Number(cnt) > 0;
  const lockSel = hasLock ? 's.ai_assignment_locked AS aiAssignmentLocked' : 'NULL AS aiAssignmentLocked';
  const [rows] = await c.query(
    `SELECT s.id, s.status, s.team, ${lockSel},
            s.working_day AS workingDayUtc,
            s.property_id AS propertyId,
            TRIM(p.property_name) AS propertyName,
            TRIM(p.unit_name) AS unitName,
            p.operator_id AS operatorId
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     WHERE s.id = ?
     LIMIT 1`,
    [id]
  );
  if (!rows || !rows.length) {
    console.log('No row for id', id);
    await c.end();
    process.exit(2);
  }
  const r = rows[0];
  console.log(JSON.stringify(r, null, 2));
  console.log(
    '\nai_assignment_locked is informational for Schedule saves; Jarvis schedule writes ignore it. Status bulk skips TERMINAL / NOT_READY_TO_CLEAN only.'
  );
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
