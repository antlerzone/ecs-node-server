/**
 * Merge businessTimeZone into settings_json.companyProfile when clock fields exist but no remark.
 *   node scripts/backfill-company-profile-business-timezone.js --dry-run
 *   node scripts/backfill-company-profile-business-timezone.js --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../src/config/db');

const TZ = 'Asia/Kuala_Lumpur';

function needsBackfill(cp) {
  if (!cp || typeof cp !== 'object') return false;
  const hasClock =
    String(cp.workingHourFrom || '').trim() ||
    String(cp.workingHourTo || '').trim() ||
    String(cp.outOfWorkingHourFrom || '').trim() ||
    String(cp.outOfWorkingHourTo || '').trim();
  if (!hasClock) return false;
  if (String(cp.businessTimeZone || '').trim() || String(cp.timeZone || '').trim()) return false;
  return true;
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!apply && !process.argv.includes('--dry-run')) {
    console.error('Usage: node scripts/backfill-company-profile-business-timezone.js --dry-run | --apply');
    process.exit(1);
  }

  const [rows] = await pool.query(
    'SELECT id, operator_id, settings_json FROM cln_operator_settings LIMIT 2000'
  );
  let n = 0;
  for (const r of rows) {
    let s;
    try {
      s = JSON.parse(r.settings_json || '{}');
    } catch {
      continue;
    }
    const cp = s.companyProfile;
    if (!needsBackfill(cp)) continue;
    n += 1;
    if (apply) {
      cp.businessTimeZone = TZ;
      s.companyProfile = cp;
      await pool.query(
        'UPDATE cln_operator_settings SET settings_json = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
        [JSON.stringify(s), r.id]
      );
    }
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', rowsScanned: rows.length, updatedOrWouldUpdate: n }, null, 2));
  await pool.end().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
