/**
 * Backfill roomdetail.meter_id from meter_wixid (match meterdetail.wix_id)
 * and roomdetail.smartdoor_id from smartdoor_wixid (match lockdetail.wix_id).
 * 约定：业务用 _id (meter_id, smartdoor_id)，不再用 _wixid。跑完后 #dropdownmeter / #dropdownsmartdoor 可正确显示当前绑定值。
 *
 * ECS 执行: cd /home/ecs-user/app && node scripts/backfill-roomdetail-meter-smartdoor-fk.js
 *
 * 若表上尚无 FK，可再执行:
 *   ALTER TABLE roomdetail ADD CONSTRAINT fk_roomdetail_meter
 *     FOREIGN KEY (meter_id) REFERENCES meterdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
 *   ALTER TABLE roomdetail ADD CONSTRAINT fk_roomdetail_smartdoor
 *     FOREIGN KEY (smartdoor_id) REFERENCES lockdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
 * (若已存在则跳过或先 DROP 再 ADD)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

function normalizeWixId(v) {
  if (v == null || typeof v !== 'string') return null;
  const s = String(v)
    .replace(/^\[|\]$/g, '')
    .replace(/^!/, '')
    .trim();
  return s || null;
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });

  // ---- meter: meterdetail.wix_id -> id ----
  const [meterRows] = await conn.query('SELECT id, wix_id FROM meterdetail WHERE wix_id IS NOT NULL AND TRIM(wix_id) != ""');
  const meterWixToId = new Map();
  for (const r of meterRows || []) {
    const k = normalizeWixId(r.wix_id);
    if (k) meterWixToId.set(k, r.id);
  }
  console.log('[meter] meterdetail wix_id -> id map size:', meterWixToId.size);

  const [roomMeterRows] = await conn.query(
    'SELECT id, meter_wixid FROM roomdetail WHERE meter_wixid IS NOT NULL AND TRIM(meter_wixid) != ""'
  );
  let meterUpdated = 0;
  for (const r of roomMeterRows || []) {
    const id = meterWixToId.get(normalizeWixId(r.meter_wixid));
    if (!id) continue;
    const [res] = await conn.query('UPDATE roomdetail SET meter_id = ?, updated_at = NOW() WHERE id = ?', [id, r.id]);
    if (res.affectedRows) meterUpdated++;
  }
  console.log('[meter] roomdetail.meter_id backfilled:', meterUpdated);

  // ---- smartdoor: lockdetail.wix_id -> id ----
  const [lockRows] = await conn.query('SELECT id, wix_id FROM lockdetail WHERE wix_id IS NOT NULL AND TRIM(wix_id) != ""');
  const lockWixToId = new Map();
  for (const r of lockRows || []) {
    const k = normalizeWixId(r.wix_id);
    if (k) lockWixToId.set(k, r.id);
  }
  console.log('[smartdoor] lockdetail wix_id -> id map size:', lockWixToId.size);

  const [roomLockRows] = await conn.query(
    'SELECT id, smartdoor_wixid FROM roomdetail WHERE smartdoor_wixid IS NOT NULL AND TRIM(smartdoor_wixid) != ""'
  );
  let smartdoorUpdated = 0;
  for (const r of roomLockRows || []) {
    const id = lockWixToId.get(normalizeWixId(r.smartdoor_wixid));
    if (!id) continue;
    const [res] = await conn.query('UPDATE roomdetail SET smartdoor_id = ?, updated_at = NOW() WHERE id = ?', [id, r.id]);
    if (res.affectedRows) smartdoorUpdated++;
  }
  console.log('[smartdoor] roomdetail.smartdoor_id backfilled:', smartdoorUpdated);

  await conn.end();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
