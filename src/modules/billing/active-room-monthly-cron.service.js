/**
 * Monthly active-room credit deduction (cron).
 * Run on the 1st of each month (e.g. from POST /api/cron/daily when date is 1st).
 * Deducts 10 credits per billable room per client. Billable = roomdetail.active = 1,
 * OR room has at least one tenancy whose calendar range covers today (MY date), regardless of room.active.
 * Tenancy row: do NOT filter by tenancy.active or tenancy.status — inactive/frozen lease (active=0)
 * still counts if DATE(begin)–DATE(end) covers the cron day.
 */

const pool = require('../../config/db');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
const { deductMonthlyActiveRoomCredit, ACTIVE_ROOM_MONTHLY_TITLE_PREFIX } = require('./deduction.service');

const CREDITS_PER_ACTIVE_ROOM = 10;

/**
 * Run monthly room deduction for all clients that have rooms in room setting.
 * Counts roomdetail rows per client that are billable (active=1 OR current-date tenancy on that room).
 * Idempotent: skips client if creditlogs already has "Active room monthly (YYYY-MM)" for this month.
 * @returns {{ deducted: Array<{ clientId, activeRoomCount, amount }>, skipped: Array<{ clientId, reason }>, errors: Array<{ clientId, message }> }}
 */
async function runMonthlyActiveRoomDeduction() {
  const today = getTodayMalaysiaDate();
  const yearMonth = today.slice(0, 7); // 'YYYY-MM'

  const [clientRows] = await pool.query(
    `SELECT DISTINCT client_id AS clientId FROM roomdetail WHERE client_id IS NOT NULL`
  );
  const clientIds = (clientRows || []).map((r) => r.clientId).filter(Boolean);
  if (clientIds.length === 0) {
    return { deducted: [], skipped: [], errors: [] };
  }

  const [existingLogs] = await pool.query(
    `SELECT client_id, title FROM creditlogs
     WHERE type = 'Spending' AND title = ? AND client_id IN (?)`,
    [`${ACTIVE_ROOM_MONTHLY_TITLE_PREFIX} (${yearMonth})`, clientIds]
  );
  const alreadyDeducted = new Set((existingLogs || []).map((r) => r.client_id));

  const deducted = [];
  const skipped = [];
  const errors = [];

  for (const clientId of clientIds) {
    if (alreadyDeducted.has(clientId)) {
      skipped.push({ clientId, reason: 'already_deducted_this_month' });
      continue;
    }

    const [roomRows] = await pool.query(
      `SELECT
         COALESCE(NULLIF(TRIM(p.shortname), ''), NULLIF(TRIM(p.apartmentname), ''), '—') AS property_label,
         COALESCE(NULLIF(TRIM(p.unitnumber), ''), '—') AS unit_number,
         COALESCE(NULLIF(TRIM(r.roomname), ''), NULLIF(TRIM(r.title_fld), ''), 'Room') AS room_name
       FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       WHERE r.client_id = ?
         AND (
           r.active = 1
           OR EXISTS (
             SELECT 1 FROM tenancy t
             WHERE t.room_id = r.id
               AND (t.client_id = r.client_id OR t.client_id IS NULL)
               AND t.begin IS NOT NULL AND t.\`end\` IS NOT NULL
               AND DATE(t.begin) <= ? AND DATE(t.\`end\`) >= ?
               /* intentional: no t.active / t.status — bill even when tenancy.active=0 */
           )
         )
       ORDER BY property_label, unit_number, room_name`,
      [clientId, today, today]
    );
    const activeRoomCount = (roomRows || []).length;
    if (activeRoomCount <= 0) {
      skipped.push({ clientId, reason: 'no_billable_rooms' });
      continue;
    }

    const amount = CREDITS_PER_ACTIVE_ROOM * activeRoomCount;
    const roomLines = (roomRows || []).map((r) => ({
      property: r.property_label || '—',
      unitNumber: r.unit_number || '—',
      roomName: r.room_name || 'Room'
    }));
    const description = [
      `room quantity total: ${activeRoomCount}`,
      ...roomLines.map((l) => `${l.roomName} @ ${l.property} (${l.unitNumber}) x1`),
      `total credit deduct: ${amount}`
    ].join('\n');

    try {
      await deductMonthlyActiveRoomCredit({ clientId, activeRoomCount, yearMonth, description, roomLines });
      deducted.push({ clientId, activeRoomCount, amount });
    } catch (err) {
      errors.push({ clientId, message: err?.message || String(err) });
    }
  }

  return { deducted, skipped, errors };
}

module.exports = {
  runMonthlyActiveRoomDeduction,
  CREDITS_PER_ACTIVE_ROOM
};
