/**
 * Tenancy active/inactive and lock/power: daily check (unpaid → lock + power off + active=0),
 * and restore when all due rental is paid (active=1 + extend TTLock + power on).
 * Uses tenancy.active, tenancy.inactive_reason, tenancy.ttlock_passcode_expired_at (no longer use tenancy.status for this).
 */

const pool = require('../../config/db');
const { getTodayMalaysiaDate, getTodayPlusDaysMalaysia } = require('../../utils/dateMalaysia');
const lockWrapper = require('../ttlock/wrappers/lock.wrapper');
const meterWrapper = require('../cnyiot/wrappers/meter.wrapper');

/** 租约结束日期在多少天内算「即将空出」，房间标为 availablesoon=1 */
const AVAILABLE_SOON_DAYS = 60;

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

/**
 * Get lockId (TTLock), cnyiotMeterId (for setRelay), and tenancy passcode info from tenancy.
 * Also returns primaryLockDetailId (lockdetail.id) so we can resolve parent lock.
 * @returns {Promise<{ clientId, lockId, cnyiotMeterId, password, passwordid, begin, end, primaryLockDetailId }|null>}
 */
async function getLockAndMeterFromTenancy(tenancyId) {
  const [tRows] = await pool.query(
    `SELECT t.id, t.client_id, t.room_id, t.password, t.passwordid, t.begin, t.\`end\`
       FROM tenancy t WHERE t.id = ? LIMIT 1`,
    [tenancyId]
  );
  if (!tRows.length) return null;
  const t = tRows[0];
  const clientId = t.client_id;
  const roomId = t.room_id;
  if (!roomId) return { clientId, lockId: null, cnyiotMeterId: null, password: t.password, passwordid: t.passwordid, begin: t.begin, end: t.end, primaryLockDetailId: null };

  const [rRows] = await pool.query(
    `SELECT r.property_id, r.meter_id FROM roomdetail r WHERE r.id = ? LIMIT 1`,
    [roomId]
  );
  const room = rRows[0];
  if (!room) return { clientId, lockId: null, cnyiotMeterId: null, password: t.password, passwordid: t.passwordid, begin: t.begin, end: t.end, primaryLockDetailId: null };

  let lockId = null;
  let primaryLockDetailId = null;
  const propertyId = room.property_id;
  if (propertyId) {
    const [pRows] = await pool.query(
      `SELECT p.smartdoor_id FROM propertydetail p WHERE p.id = ? LIMIT 1`,
      [propertyId]
    );
    if (pRows[0] && pRows[0].smartdoor_id) {
      primaryLockDetailId = pRows[0].smartdoor_id;
      const [lRows] = await pool.query(
        `SELECT lockid FROM lockdetail WHERE id = ? LIMIT 1`,
        [primaryLockDetailId]
      );
      if (lRows[0] && lRows[0].lockid) lockId = lRows[0].lockid;
    }
  }
  if (!lockId) {
    const [rdRows] = await pool.query(
      `SELECT smartdoor_id FROM roomdetail WHERE id = ? LIMIT 1`,
      [roomId]
    );
    if (rdRows[0] && rdRows[0].smartdoor_id) {
      primaryLockDetailId = rdRows[0].smartdoor_id;
      const [lRows] = await pool.query(
        `SELECT lockid FROM lockdetail WHERE id = ? LIMIT 1`,
        [primaryLockDetailId]
      );
      if (lRows[0] && lRows[0].lockid) lockId = lRows[0].lockid;
    }
  }

  let cnyiotMeterId = null;
  if (room.meter_id) {
    const [mRows] = await pool.query(
      `SELECT meterid FROM meterdetail WHERE id = ? LIMIT 1`,
      [room.meter_id]
    );
    if (mRows[0] && mRows[0].meterid) cnyiotMeterId = mRows[0].meterid;
  }

  return {
    clientId,
    lockId,
    cnyiotMeterId,
    password: t.password,
    passwordid: t.passwordid,
    begin: t.begin,
    end: t.end,
    primaryLockDetailId
  };
}

/**
 * Find parent lock of a lockdetail (lock that has this one in childmeter).
 * @returns {Promise<{ parentLockId: number, parentLockDetailId: string }|null>}
 */
async function getParentLockForLockDetail(clientId, lockDetailId) {
  if (!clientId || !lockDetailId) return null;
  const [rows] = await pool.query(
    `SELECT id, lockid FROM lockdetail WHERE client_id = ? AND JSON_CONTAINS(COALESCE(childmeter, '[]'), JSON_QUOTE(?), '$') LIMIT 1`,
    [clientId, String(lockDetailId)]
  );
  if (!rows.length || !rows[0].lockid) return null;
  return { parentLockId: rows[0].lockid, parentLockDetailId: rows[0].id };
}

/**
 * Extend or expire passcode on parent lock by matching name to tenancy title.
 */
async function setParentLockPasscodeEnd(clientId, parentLockId, title, startMs, endMs) {
  const list = await lockWrapper.listLockPasscodes(clientId, parentLockId);
  const name = (title || 'Tenancy').toString().trim().slice(0, 100);
  const match = list.find((p) => (String(p.keyboardPwdName || '').trim() === name));
  if (!match || match.keyboardPwdId == null) return;
  await lockWrapper.changePasscode(clientId, parentLockId, {
    keyboardPwdId: match.keyboardPwdId,
    name,
    startDate: startMs,
    endDate: endMs
  });
}

/**
 * Set tenancy inactive: TTLock passcode expired yesterday, CNYIoT power off, active=0, inactive_reason.
 */
async function setTenancyInactive(tenancyId) {
  const [tRows] = await pool.query(
    'SELECT id, client_id, title FROM tenancy WHERE id = ? LIMIT 1',
    [tenancyId]
  );
  if (!tRows.length) return { ok: false, reason: 'TENANCY_NOT_FOUND' };
  const tenancy = tRows[0];
  const info = await getLockAndMeterFromTenancy(tenancyId);
  if (!info) return { ok: false, reason: 'NO_ROOM' };

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayMs = yesterday.getTime();
  const title = (tenancy.title || 'Tenancy').toString().trim().slice(0, 100) || 'Tenancy';

  if (info.lockId && info.passwordid && info.password) {
    try {
      await lockWrapper.changePasscode(info.clientId, info.lockId, {
        keyboardPwdId: info.passwordid,
        name: title,
        startDate: info.begin ? new Date(info.begin).getTime() : yesterdayMs,
        endDate: yesterdayMs
      });
    } catch (err) {
      console.warn('[tenancy-active] TTLock expire failed', tenancyId, err.message);
    }
  }
  if (info.primaryLockDetailId) {
    try {
      const parent = await getParentLockForLockDetail(info.clientId, info.primaryLockDetailId);
      if (parent) {
        const startMs = info.begin ? new Date(info.begin).getTime() : yesterdayMs;
        await setParentLockPasscodeEnd(info.clientId, parent.parentLockId, title, startMs, yesterdayMs);
      }
    } catch (err) {
      console.warn('[tenancy-active] TTLock parent expire failed', tenancyId, err.message);
    }
  }

  if (info.cnyiotMeterId) {
    try {
      await meterWrapper.setRelay(info.clientId, info.cnyiotMeterId, 2);
    } catch (err) {
      console.warn('[tenancy-active] setRelay off failed', tenancyId, err.message);
    }
  }

  const inactiveReason = JSON.stringify({ reason: 'no paying rental', at: new Date().toISOString() });
  const expiredAt = yesterday.toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(
    `UPDATE tenancy SET active = 0, inactive_reason = ?, ttlock_passcode_expired_at = ?, updated_at = NOW() WHERE id = ?`,
    [inactiveReason, expiredAt, tenancyId]
  );
  return { ok: true };
}

/**
 * Set tenancy active: extend TTLock passcode to tenancy.end, CNYIoT power on, active=1, clear inactive_reason.
 */
async function setTenancyActive(tenancyId) {
  const [tRows] = await pool.query(
    'SELECT id, client_id, title, `end` FROM tenancy WHERE id = ? LIMIT 1',
    [tenancyId]
  );
  if (!tRows.length) return { ok: false, reason: 'TENANCY_NOT_FOUND' };
  const tenancy = tRows[0];
  const info = await getLockAndMeterFromTenancy(tenancyId);
  if (!info) return { ok: false, reason: 'NO_ROOM' };

  const endMs = tenancy.end ? new Date(tenancy.end).getTime() : Date.now() + 365 * 24 * 60 * 60 * 1000;
  const startMs = info.begin ? new Date(info.begin).getTime() : Date.now();
  const title = (tenancy.title || 'Tenancy').toString().trim().slice(0, 100) || 'Tenancy';

  if (info.lockId && info.passwordid && info.password) {
    try {
      await lockWrapper.changePasscode(info.clientId, info.lockId, {
        keyboardPwdId: info.passwordid,
        name: title,
        startDate: startMs,
        endDate: endMs
      });
    } catch (err) {
      console.warn('[tenancy-active] TTLock extend failed', tenancyId, err.message);
    }
  }
  if (info.primaryLockDetailId) {
    try {
      const parent = await getParentLockForLockDetail(info.clientId, info.primaryLockDetailId);
      if (parent) {
        await setParentLockPasscodeEnd(info.clientId, parent.parentLockId, title, startMs, endMs);
      }
    } catch (err) {
      console.warn('[tenancy-active] TTLock parent extend failed', tenancyId, err.message);
    }
  }

  if (info.cnyiotMeterId) {
    try {
      await meterWrapper.setRelay(info.clientId, info.cnyiotMeterId, 1);
    } catch (err) {
      console.warn('[tenancy-active] setRelay on failed', tenancyId, err.message);
    }
  }

  await pool.query(
    `UPDATE tenancy SET active = 1, inactive_reason = NULL, ttlock_passcode_expired_at = NULL, updated_at = NOW() WHERE id = ?`,
    [tenancyId]
  );
  return { ok: true };
}

/**
 * 「没有还钱」定义：只有「过去到期」未付才算。
 * - 今天之前到期的（date < today）必须付，未付 = 欠租。
 * - 今天到期、今天还没付 = 不算欠租（给一整天时间，次日 00:00 再检查）。
 */
async function hasUnpaidRentalPastDue(tenancyId) {
  const today = getTodayMalaysiaDate();
  const [rows] = await pool.query(
    `SELECT id FROM rentalcollection WHERE tenancy_id = ? AND date < ? AND (ispaid = 0 OR ispaid IS NULL) LIMIT 1`,
    [tenancyId, today]
  );
  return rows.length > 0;
}

/** 每批欠租檢查最多處理筆數，避免單次 SQL 過大；多批當天跑完 */
const TENANCY_CHECK_BATCH_SIZE = 500;

/**
 * Run daily check: find tenancies that have unpaid rental (date < today, 過去到期未付) and set them inactive.
 * 用 queue 方式分批處理，當天全部跑完（無上限）；每批 TENANCY_CHECK_BATCH_SIZE 筆。
 * Call at 00:00 UTC+8. "Today" = calendar day in MY/SG (UTC+8).
 */
async function runDailyTenancyCheck() {
  const today = getTodayMalaysiaDate();
  const results = { processed: 0, errors: [], batches: 0 };
  let batch;
  do {
    const [rows] = await pool.query(
      `SELECT DISTINCT t.id FROM tenancy t
       INNER JOIN rentalcollection r ON r.tenancy_id = t.id AND r.date < ? AND (r.ispaid = 0 OR r.ispaid IS NULL)
       WHERE (t.active = 1 OR t.active IS NULL)
       LIMIT ?`,
      [today, TENANCY_CHECK_BATCH_SIZE]
    );
    batch = rows || [];
    results.batches += 1;
    for (const row of batch) {
      try {
        const res = await setTenancyInactive(row.id);
        if (res.ok) results.processed++;
        else results.errors.push({ tenancyId: row.id, reason: res.reason });
      } catch (err) {
        results.errors.push({ tenancyId: row.id, reason: err.message });
      }
    }
  } while (batch.length === TENANCY_CHECK_BATCH_SIZE);
  return results;
}

/**
 * Update a single room's available / availablesoon / availablefrom from the tenancy that covers today.
 * 同一房间可有多个 tenancy（如 room A 2025、room A 2026）；只按「今天落在 [begin,end] 内」的那条来更新。
 */
async function updateRoomAvailableFromTenancy(roomId) {
  if (!roomId) return;
  const today = getTodayMalaysiaDate();
  const todayPlus60 = getTodayPlusDaysMalaysia(AVAILABLE_SOON_DAYS);
  const [rows] = await pool.query(
    `SELECT t.\`end\` FROM tenancy t
     WHERE t.room_id = ? AND (t.active = 1 OR t.active IS NULL)
       AND t.begin <= ? AND t.\`end\` >= ?
     ORDER BY t.\`end\` DESC LIMIT 1`,
    [roomId, today, today]
  );
  if (rows.length) {
    const endRaw = rows[0].end;
    const endDateOnly = endRaw ? String(endRaw).trim().substring(0, 10) : null;
    const within60 = endDateOnly && endDateOnly <= todayPlus60;
    await pool.query(
      `UPDATE roomdetail SET available = 0, availablesoon = ?, availablefrom = ?, updated_at = NOW() WHERE id = ?`,
      [within60 ? 1 : 0, within60 && endDateOnly ? endDateOnly : null, roomId]
    );
  } else {
    await pool.query(
      `UPDATE roomdetail SET available = 1, availablesoon = 0, availablefrom = NULL, updated_at = NOW() WHERE id = ?`,
      [roomId]
    );
  }
}

/**
 * 按 tenancy 同步 roomdetail 的 available / availablesoon / availablefrom。
 * 同一房间可有多个 tenancy（如 2025、2026）；只认「今天落在 [begin,end] 内」的那条（按日期判断）。
 * - 有「当前占用」tenancy 的房间：available=0；若 end 在 60 天内则 availablesoon=1、availablefrom=end。
 * - 无当前占用 tenancy 的房间：available=1，availablesoon=0，availablefrom=NULL。
 */
async function syncRoomAvailableFromTenancy() {
  const today = getTodayMalaysiaDate();
  const todayPlus60 = getTodayPlusDaysMalaysia(AVAILABLE_SOON_DAYS);

  const [activeRows] = await pool.query(
    `SELECT t.room_id, t.\`end\` FROM tenancy t
     WHERE t.active = 1 AND t.room_id IS NOT NULL
       AND t.begin <= ? AND t.\`end\` >= ?
     ORDER BY t.room_id, t.\`end\` DESC`,
    [today, today]
  );
  const roomToEnd = new Map();
  for (const row of activeRows || []) {
    if (!roomToEnd.has(row.room_id)) roomToEnd.set(row.room_id, row.end);
  }

  const roomUpdates = new Map();
  for (const [roomId, endRaw] of roomToEnd) {
    const endDateOnly = endRaw ? String(endRaw).trim().substring(0, 10) : null;
    const within60 = endDateOnly && endDateOnly <= todayPlus60;
    roomUpdates.set(roomId, {
      available: 0,
      availablesoon: within60 ? 1 : 0,
      availablefrom: within60 && endDateOnly ? endDateOnly : null
    });
  }

  for (const [roomId, u] of roomUpdates) {
    await pool.query(
      `UPDATE roomdetail SET available = ?, availablesoon = ?, availablefrom = ?, updated_at = NOW() WHERE id = ?`,
      [u.available, u.availablesoon, u.availablefrom, roomId]
    );
  }

  const occupiedRoomIds = Array.from(roomUpdates.keys());
  let setAvailableCount = 0;
  if (occupiedRoomIds.length > 0) {
    const placeholders = occupiedRoomIds.map(() => '?').join(',');
    const [updateResult] = await pool.query(
      `UPDATE roomdetail SET available = 1, availablesoon = 0, availablefrom = NULL, updated_at = NOW()
       WHERE id NOT IN (${placeholders})`,
      occupiedRoomIds
    );
    setAvailableCount = updateResult?.affectedRows ?? 0;
  } else {
    const [updateResult] = await pool.query(
      'UPDATE roomdetail SET available = 1, availablesoon = 0, availablefrom = NULL, updated_at = NOW()'
    );
    setAvailableCount = updateResult?.affectedRows ?? 0;
  }

  return { updatedOccupied: roomUpdates.size, setAvailableCount };
}

/**
 * After marking rental(s) paid: if tenancy is currently inactive, check if all rental due today are paid;
 * if yes, restore (active=1, extend TTLock, power on).
 * Only restores when fully paid (e.g. if owed 500 and paid 200, do not restore).
 */
async function checkAndRestoreTenancyIfFullyPaid(tenancyId) {
  const [tRows] = await pool.query(
    'SELECT id, active FROM tenancy WHERE id = ? LIMIT 1',
    [tenancyId]
  );
  if (!tRows.length) return { ok: false, reason: 'TENANCY_NOT_FOUND' };
  if (tRows[0].active === 1) return { ok: true, alreadyActive: true };

  const hasUnpaid = await hasUnpaidRentalPastDue(tenancyId);
  if (hasUnpaid) return { ok: true, restored: false, reason: 'STILL_UNPAID' };

  return setTenancyActive(tenancyId).then((r) => ({ ...r, restored: true }));
}

module.exports = {
  getLockAndMeterFromTenancy,
  setTenancyInactive,
  setTenancyActive,
  hasUnpaidRentalPastDue,
  runDailyTenancyCheck,
  syncRoomAvailableFromTenancy,
  updateRoomAvailableFromTenancy,
  checkAndRestoreTenancyIfFullyPaid
};
