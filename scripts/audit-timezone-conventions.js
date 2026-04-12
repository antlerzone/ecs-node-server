/**
 * Read-only audit: JSON time fields without businessTimeZone / timeZone (Cleanlemons companyProfile);
 * sample tenancy.begin/end as UTC↔MY sanity; operatordetail.admin rows whose JSON mentions clock-like keys.
 * Usage: node scripts/audit-timezone-conventions.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../src/config/db');

function hasCompanyClockFields(cp) {
  if (!cp || typeof cp !== 'object') return false;
  return !!(
    String(cp.workingHourFrom || '').trim() ||
    String(cp.workingHourTo || '').trim() ||
    String(cp.outOfWorkingHourFrom || '').trim() ||
    String(cp.outOfWorkingHourTo || '').trim()
  );
}

function hasTzRemark(cp) {
  if (!cp || typeof cp !== 'object') return false;
  return !!(String(cp.businessTimeZone || '').trim() || String(cp.timeZone || '').trim());
}

async function auditClnOperatorSettings() {
  const missing = [];
  let total = 0;
  try {
    const [rows] = await pool.query(
      'SELECT operator_id, settings_json FROM cln_operator_settings LIMIT 2000'
    );
    total = rows.length;
    for (const r of rows) {
      let s;
      try {
        s = JSON.parse(r.settings_json || '{}');
      } catch {
        continue;
      }
      const cp = s.companyProfile;
      if (hasCompanyClockFields(cp) && !hasTzRemark(cp)) {
        missing.push(String(r.operator_id));
      }
    }
  } catch (e) {
    if (String(e.message || '').includes("doesn't exist") || e.code === 'ER_NO_SUCH_TABLE') {
      return { skipped: true, reason: 'cln_operator_settings missing' };
    }
    throw e;
  }
  return { total, missingCount: missing.length, missingOperatorIds: missing };
}

/** Sample tenancy rows: begin/end stored vs calendar interpretation (read-only). */
async function auditTenancySample() {
  try {
    const [rows] = await pool.query(
      'SELECT id, client_id, `begin`, `end`, status FROM tenancy ORDER BY updated_at DESC LIMIT 15'
    );
    return (rows || []).map((r) => ({
      id: r.id,
      client_id: r.client_id,
      begin: r.begin,
      end: r.end,
      status: r.status
    }));
  } catch (e) {
    if (String(e.message || '').includes("doesn't exist") || e.code === 'ER_NO_SUCH_TABLE') {
      return { skipped: true, reason: 'tenancy missing' };
    }
    throw e;
  }
}

const ADMIN_TIME_KEY_HINT = /hour|time|schedule|open|close|working|window/i;

async function auditOperatordetailAdminHints() {
  try {
    const [rows] = await pool.query(
      'SELECT id, admin FROM operatordetail WHERE admin IS NOT NULL AND TRIM(admin) <> "" AND admin LIKE ? LIMIT 200',
      ['%hour%']
    );
    const samples = [];
    for (const r of rows || []) {
      let j;
      try {
        j = JSON.parse(r.admin);
      } catch {
        samples.push({ id: r.id, note: 'admin not JSON' });
        continue;
      }
      const s = JSON.stringify(j);
      if (ADMIN_TIME_KEY_HINT.test(s)) samples.push({ id: r.id, keys: Object.keys(j || {}).slice(0, 20) });
    }
    return { scanned: (rows || []).length, sampleRows: samples.slice(0, 15) };
  } catch (e) {
    if (String(e.message || '').includes("doesn't exist") || e.code === 'ER_NO_SUCH_TABLE') {
      return { skipped: true, reason: 'operatordetail missing' };
    }
    throw e;
  }
}

async function main() {
  const report = {
    ok: true,
    cln_operator_settings: await auditClnOperatorSettings(),
    tenancy_sample: await auditTenancySample(),
    operatordetail_admin_time_hints: await auditOperatordetailAdminHints()
  };
  console.log(JSON.stringify(report, null, 2));
  await pool.end().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message || String(e) }, null, 2));
  process.exit(1);
});
