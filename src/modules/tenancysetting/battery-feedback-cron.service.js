/**
 * Daily cron: check TTLock battery for all clients; insert feedback when battery < 20%.
 * No tenancy, no tenant – description: "smart door battery down (room name & property name & date)".
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
const ttlock = require('../ttlock');

const BATTERY_THRESHOLD = 20;

/**
 * Get client_ids that have TTLock enabled (smartDoor, ttlock).
 * @returns {Promise<string[]>}
 */
async function getClientIdsWithTTLock() {
  const [rows] = await pool.query(
    `SELECT DISTINCT client_id FROM client_integration
     WHERE \`key\` = 'smartDoor' AND provider = 'ttlock' AND enabled = 1 AND client_id IS NOT NULL`,
    []
  );
  return (rows || []).map((r) => r.client_id).filter(Boolean);
}

/**
 * For a lock (lockdetail.id), get room name and property name.
 * roomdetail.smartdoor_id = lockDetailId → title_fld or roomname; property via room.property_id.
 * If no room, try propertydetail.smartdoor_id.
 * @returns {{ roomId: string|null, propertyId: string|null, roomName: string, propertyName: string }}
 */
async function getRoomAndPropertyNames(clientId, lockDetailId) {
  const [roomRows] = await pool.query(
    `SELECT r.id AS room_id, r.title_fld, r.roomname, r.property_id, p.shortname AS property_shortname
     FROM roomdetail r
     LEFT JOIN propertydetail p ON p.id = r.property_id
     WHERE r.smartdoor_id = ? AND r.client_id = ? LIMIT 1`,
    [lockDetailId, clientId]
  );
  if (roomRows && roomRows[0]) {
    const r = roomRows[0];
    const roomName = (r.title_fld || r.roomname || '').toString().trim() || 'room';
    const propertyName = (r.property_shortname || '').toString().trim() || 'property';
    return {
      roomId: r.room_id || null,
      propertyId: r.property_id || null,
      roomName,
      propertyName
    };
  }
  const [propRows] = await pool.query(
    `SELECT id AS property_id, shortname FROM propertydetail WHERE smartdoor_id = ? AND client_id = ? LIMIT 1`,
    [lockDetailId, clientId]
  );
  if (propRows && propRows[0]) {
    const p = propRows[0];
    return {
      roomId: null,
      propertyId: p.property_id || null,
      roomName: 'no room',
      propertyName: (p.shortname || '').toString().trim() || 'property'
    };
  }
  return { roomId: null, propertyId: null, roomName: 'no connect', propertyName: 'no connect' };
}

/**
 * Run daily battery check: list all clients with TTLock, for each list locks, insert feedback for battery < 20%.
 * @returns {{ inserted: number, errors: Array<{ clientId: string, message: string }> }}
 */
async function runDailyBatteryCheckAndInsertFeedback() {
  const today = getTodayMalaysiaDate();
  const clientIds = await getClientIdsWithTTLock();
  let inserted = 0;
  const errors = [];

  for (const clientId of clientIds) {
    try {
      const { list } = await ttlock.lock.listAllLocks(clientId);
      if (!Array.isArray(list) || list.length === 0) continue;

      for (const lock of list) {
        const battery = Number(lock.electricQuantity);
        if (isNaN(battery) || battery >= BATTERY_THRESHOLD) continue;

        const lockId = lock.lockId != null ? String(lock.lockId) : null;
        if (!lockId) continue;

        const [lockRows] = await pool.query(
          'SELECT id FROM lockdetail WHERE client_id = ? AND lockid = ? LIMIT 1',
          [clientId, lockId]
        );
        const lockDetailRow = lockRows && lockRows[0];
        const lockDetailId = lockDetailRow ? lockDetailRow.id : null;

        const { roomId, propertyId, roomName, propertyName } = lockDetailId
          ? await getRoomAndPropertyNames(clientId, lockDetailId)
          : { roomId: null, propertyId: null, roomName: 'unknown', propertyName: 'unknown' };

        const description = `smart door battery down (${roomName} & ${propertyName} & ${today})`;
        const id = randomUUID();

        await pool.query(
          `INSERT INTO feedback (id, tenancy_id, room_id, property_id, client_id, tenant_id, description, photo, video, created_at, updated_at)
           VALUES (?, NULL, ?, ?, ?, NULL, ?, NULL, NULL, NOW(), NOW())`,
          [id, roomId, propertyId, clientId, description]
        );
        inserted += 1;
      }
    } catch (err) {
      errors.push({ clientId, message: err?.message || String(err) });
      console.warn('[battery-feedback-cron] clientId=%s error:', clientId, err?.message || err);
    }
  }

  return { inserted, errors };
}

module.exports = {
  getClientIdsWithTTLock,
  runDailyBatteryCheckAndInsertFeedback
};
