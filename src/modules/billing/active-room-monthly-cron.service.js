/**
 * Monthly active-room credit deduction (cron).
 * Run on the 1st of each month (e.g. from POST /api/cron/daily when date is 1st).
 * Deducts 10 credits per active room per client. "Active room" = roomdetail.active = 1 (招租中), with or without tenancy.
 */

const pool = require('../../config/db');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
const { deductMonthlyActiveRoomCredit, ACTIVE_ROOM_MONTHLY_TITLE_PREFIX } = require('./deduction.service');

const CREDITS_PER_ACTIVE_ROOM = 10;

/**
 * Run monthly active-room deduction for all clients that have active rooms.
 * Idempotent: skips client if creditlogs already has "Active room monthly (YYYY-MM)" for this month.
 * @returns {{ deducted: Array<{ clientId, activeRoomCount, amount }>, skipped: Array<{ clientId, reason }>, errors: Array<{ clientId, message }> }}
 */
async function runMonthlyActiveRoomDeduction() {
  const today = getTodayMalaysiaDate();
  const yearMonth = today.slice(0, 7); // 'YYYY-MM'

  const [clientRows] = await pool.query(
    `SELECT DISTINCT client_id AS clientId FROM roomdetail WHERE active = 1 AND client_id IS NOT NULL`
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
      'SELECT roomname, title_fld FROM roomdetail WHERE client_id = ? AND active = 1 ORDER BY COALESCE(roomname, title_fld) ASC',
      [clientId]
    );
    const activeRoomCount = (roomRows || []).length;
    if (activeRoomCount <= 0) {
      skipped.push({ clientId, reason: 'no_active_rooms' });
      continue;
    }

    const amount = CREDITS_PER_ACTIVE_ROOM * activeRoomCount;
    const roomDisplayNames = (roomRows || []).map((r) => (r.roomname && String(r.roomname).trim()) || (r.title_fld && String(r.title_fld).trim()) || 'Room');
    const description = [
      `room quantity total: ${activeRoomCount}`,
      ...roomDisplayNames.map((name) => `${name} x1`),
      `total credit deduct: ${amount}`
    ].join('\n');

    try {
      await deductMonthlyActiveRoomCredit({ clientId, activeRoomCount, yearMonth, description });
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
