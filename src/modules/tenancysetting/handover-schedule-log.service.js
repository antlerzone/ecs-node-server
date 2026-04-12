/**
 * Audit log for tenancy handover schedule (scheduledAt in handover_*_json).
 * Written when tenant portal or operator updates check-in / check-out appointment time.
 */

const pool = require('../../config/db');

/**
 * Normalize for stable compare + storage (align with tenancysetting.normalizeScheduleAt).
 * @param {unknown} val
 * @returns {string|null}
 */
function normalizeScheduleForLog(val) {
  if (val == null) return null;
  const raw = String(val).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    return raw.replace(' ', 'T').slice(0, 16);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.tenancyId
 * @param {'checkin'|'checkout'} opts.field
 * @param {string|null} opts.oldValue
 * @param {string|null} opts.newValue
 * @param {string|null} [opts.actorEmail]
 * @param {'tenant'|'operator'} [opts.actorType]
 */
async function appendHandoverScheduleLog(opts) {
  const {
    clientId,
    tenancyId,
    field,
    oldValue,
    newValue,
    actorEmail = null,
    actorType = 'operator'
  } = opts;
  if (!clientId || !tenancyId || (field !== 'checkin' && field !== 'checkout')) return;
  const o = oldValue != null ? String(oldValue) : null;
  const n = newValue != null ? String(newValue) : null;
  if (o === n) return;
  try {
    await pool.query(
      `INSERT INTO tenancy_handover_schedule_log
        (tenancy_id, client_id, field_name, old_value, new_value, actor_email, actor_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tenancyId, clientId, field, o, n, actorEmail, actorType]
    );
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || String(e.message || '').includes('doesn\'t exist'))) {
      console.warn('[handover-schedule-log] table missing; run migration 0143_tenancy_handover_schedule_log.sql');
      return;
    }
    throw e;
  }
}

/**
 * @param {string} clientId
 * @param {string} tenancyId
 * @param {number} [limit]
 */
async function listHandoverScheduleLog(clientId, tenancyId, limit = 50) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  try {
    const [rows] = await pool.query(
      `SELECT id, field_name AS fieldName, old_value AS oldValue, new_value AS newValue,
              actor_email AS actorEmail, actor_type AS actorType, created_at AS createdAt
       FROM tenancy_handover_schedule_log
       WHERE client_id = ? AND tenancy_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [clientId, tenancyId, lim]
    );
    return rows || [];
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || String(e.message || '').includes('doesn\'t exist'))) {
      return [];
    }
    throw e;
  }
}

module.exports = {
  normalizeScheduleForLog,
  appendHandoverScheduleLog,
  listHandoverScheduleLog
};
