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

function isUnknownColumnError(e) {
  return (
    e &&
    (e.code === 'ER_BAD_FIELD_ERROR' ||
      e.errno === 1054 ||
      (e.message && String(e.message).includes('Unknown column')))
  );
}

/** TTLock lockId from DB may be number/string/BigInt; normalize for API + stable deduping. */
function normalizeTtlockLockId(lockId) {
  if (lockId == null || lockId === '') return null;
  const s = String(lockId).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    if (s.length > 15) return s;
    const n = Number(s);
    if (!Number.isSafeInteger(n)) return s;
    return n;
  }
  return s;
}

/**
 * Map legacy single password/passwordid to property vs room (same rules as tenantdashboard).
 * @param {object} info — needs propertyLockId, roomLockId, perLockColumns, password, password_property, password_room
 */
function resolveEffectivePasswords(info) {
  const leg = info.password;
  if (info.perLockColumns) {
    let pp = info.password_property;
    let pr = info.password_room;
    if (pp == null && leg != null && info.propertyLockId) {
      if (!info.roomLockId) pp = leg;
      else pp = leg;
    }
    if (pr == null && leg != null && info.roomLockId && !info.propertyLockId) pr = leg;
    if (pp == null && leg != null && info.propertyLockId && info.roomLockId && pr == null) pp = leg;
    return { passwordProperty: pp != null ? String(pp) : null, passwordRoom: pr != null ? String(pr) : null };
  }
  if (info.propertyLockId && !info.roomLockId) {
    return { passwordProperty: leg != null ? String(leg) : null, passwordRoom: null };
  }
  if (!info.propertyLockId && info.roomLockId) {
    return { passwordProperty: null, passwordRoom: leg != null ? String(leg) : null };
  }
  if (info.propertyLockId && info.roomLockId) {
    return { passwordProperty: leg != null ? String(leg) : null, passwordRoom: null };
  }
  return { passwordProperty: null, passwordRoom: null };
}

function resolveKeyboardPwdIds(info) {
  const legacy = info.passwordid;
  let kidProp = info.passwordid_property;
  let kidRoom = info.passwordid_room;
  if (info.perLockColumns) {
    if (kidProp == null && kidRoom == null && legacy != null) {
      if (info.propertyLockId && info.roomLockId) kidProp = legacy;
      else if (info.propertyLockId) kidProp = legacy;
      else if (info.roomLockId) kidRoom = legacy;
    } else {
      if (kidProp == null && legacy != null && info.propertyLockId && !info.roomLockId) kidProp = legacy;
      if (kidRoom == null && legacy != null && !info.propertyLockId && info.roomLockId) kidRoom = legacy;
    }
  } else if (legacy != null) {
    if (info.propertyLockId && !info.roomLockId) kidProp = legacy;
    else if (!info.propertyLockId && info.roomLockId) kidRoom = legacy;
    else if (info.propertyLockId && info.roomLockId) kidProp = legacy;
  }
  return { kidProp, kidRoom };
}

/**
 * TTLock change targets for cron active/inactive (property + room when both exist and have PIN + keyboardPwdId).
 */
function buildPasscodeTargets(info) {
  const { kidProp, kidRoom } = resolveKeyboardPwdIds(info);
  const { passwordProperty, passwordRoom } = resolveEffectivePasswords(info);
  const targets = [];
  if (info.propertyLockId && kidProp != null && passwordProperty) {
    targets.push({
      lockId: info.propertyLockId,
      keyboardPwdId: kidProp,
      password: passwordProperty,
      lockDetailId: info.propertyLockDetailId || null,
      type: 'property'
    });
  }
  if (info.roomLockId && kidRoom != null && passwordRoom) {
    targets.push({
      lockId: info.roomLockId,
      keyboardPwdId: kidRoom,
      password: passwordRoom,
      lockDetailId: info.roomLockDetailId || null,
      type: 'room'
    });
  }
  const seen = new Set();
  return targets.filter((t) => {
    const k = `${String(t.lockId)}:${String(t.keyboardPwdId)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Delete targets: only lockId + keyboardPwdId (no plaintext password required). */
function buildPasscodeDeleteTargets(info) {
  const { kidProp, kidRoom } = resolveKeyboardPwdIds(info);
  const targets = [];
  if (info.propertyLockId && kidProp != null) {
    targets.push({
      lockId: info.propertyLockId,
      keyboardPwdId: kidProp,
      lockDetailId: info.propertyLockDetailId || null,
      type: 'property'
    });
  }
  if (info.roomLockId && kidRoom != null) {
    targets.push({
      lockId: info.roomLockId,
      keyboardPwdId: kidRoom,
      lockDetailId: info.roomLockDetailId || null,
      type: 'room'
    });
  }
  const seen = new Set();
  return targets.filter((t) => {
    const k = `${String(t.lockId)}:${String(t.keyboardPwdId)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function queryTenancyRowForLockOps(tenancyId) {
  const sqlFull = `SELECT t.id, t.client_id, t.room_id, t.password, t.passwordid, t.title, t.\`begin\`, t.\`end\`,
    t.password_property, t.password_room, t.passwordid_property, t.passwordid_room
    FROM tenancy t WHERE t.id = ? LIMIT 1`;
  const sqlLegacy = `SELECT t.id, t.client_id, t.room_id, t.password, t.passwordid, t.title, t.\`begin\`, t.\`end\`
    FROM tenancy t WHERE t.id = ? LIMIT 1`;
  try {
    const [tRows] = await pool.query(sqlFull, [tenancyId]);
    return { row: tRows[0] || null, perLockColumns: true };
  } catch (e) {
    if (!isUnknownColumnError(e)) throw e;
    const [tRows] = await pool.query(sqlLegacy, [tenancyId]);
    return { row: tRows[0] || null, perLockColumns: false };
  }
}

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
 * Get TTLock property/room lock IDs, cnyiotMeterId, passcode fields (0130 per-lock + legacy), display name for TTLock.
 * primaryLockDetailId = property lockdetail first, else room (for backward compat).
 * @param {{ forRoomId?: string|null }} [options] — resolve locks/meter for another room (e.g. change-room preview) while keeping passcode fields from tenancy row.
 * @returns {Promise<object|null>}
 */
async function getLockAndMeterFromTenancy(tenancyId, options = {}) {
  const { row: t, perLockColumns } = await queryTenancyRowForLockOps(tenancyId);
  if (!t) return null;
  const clientId = t.client_id;
  const roomId = t.room_id;
  const roomIdForLocks =
    options.forRoomId !== undefined && options.forRoomId !== null && String(options.forRoomId).trim() !== ''
      ? String(options.forRoomId).trim()
      : roomId;

  let keyboardPwdDisplayName = (t.title || 'Room').toString().trim().slice(0, 100);
  if (roomIdForLocks) {
    const [nmRows] = await pool.query(
      'SELECT roomname, title_fld FROM roomdetail WHERE id = ? LIMIT 1',
      [roomIdForLocks]
    );
    const rm = nmRows?.[0];
    if (rm) {
      keyboardPwdDisplayName = String(rm.roomname || rm.title_fld || t.title || 'Room')
        .trim()
        .slice(0, 100);
    }
  }

  const baseFields = {
    clientId,
    cnyiotMeterId: null,
    password: t.password,
    passwordid: t.passwordid,
    password_property: perLockColumns ? t.password_property : null,
    password_room: perLockColumns ? t.password_room : null,
    passwordid_property: perLockColumns ? t.passwordid_property : null,
    passwordid_room: perLockColumns ? t.passwordid_room : null,
    perLockColumns,
    begin: t.begin,
    end: t.end,
    title: t.title,
    keyboardPwdDisplayName,
    propertyLockId: null,
    roomLockId: null,
    propertyLockDetailId: null,
    roomLockDetailId: null,
    lockId: null,
    primaryLockDetailId: null
  };

  if (!roomIdForLocks) return baseFields;

  const [rRows] = await pool.query(
    `SELECT r.property_id, r.meter_id, r.smartdoor_id FROM roomdetail r WHERE r.id = ? LIMIT 1`,
    [roomIdForLocks]
  );
  const room = rRows[0];
  if (!room) return baseFields;

  let propertyLockDetailId = null;
  let roomLockDetailId = room.smartdoor_id || null;
  let propertyLockId = null;
  let roomLockId = null;

  const propertyId = room.property_id;
  if (propertyId) {
    const [pRows] = await pool.query(
      `SELECT p.smartdoor_id FROM propertydetail p WHERE p.id = ? LIMIT 1`,
      [propertyId]
    );
    if (pRows[0] && pRows[0].smartdoor_id) {
      propertyLockDetailId = pRows[0].smartdoor_id;
      const [lRows] = await pool.query(
        `SELECT lockid FROM lockdetail WHERE id = ? LIMIT 1`,
        [propertyLockDetailId]
      );
      if (lRows[0] && lRows[0].lockid) propertyLockId = normalizeTtlockLockId(lRows[0].lockid);
    }
  }
  if (roomLockDetailId) {
    const [lRows] = await pool.query(
      `SELECT lockid FROM lockdetail WHERE id = ? LIMIT 1`,
      [roomLockDetailId]
    );
    if (lRows[0] && lRows[0].lockid) roomLockId = normalizeTtlockLockId(lRows[0].lockid);
  }

  let cnyiotMeterId = null;
  if (room.meter_id) {
    const [mRows] = await pool.query(
      `SELECT meterid FROM meterdetail WHERE id = ? LIMIT 1`,
      [room.meter_id]
    );
    if (mRows[0] && mRows[0].meterid) cnyiotMeterId = mRows[0].meterid;
  }

  const lockId = propertyLockId || roomLockId || null;
  const primaryLockDetailId = propertyLockDetailId || roomLockDetailId || null;

  return {
    ...baseFields,
    cnyiotMeterId,
    propertyLockId,
    roomLockId,
    propertyLockDetailId,
    roomLockDetailId,
    lockId,
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

async function deleteParentLockPasscodeByName(clientId, parentLockId, displayName) {
  const name = (displayName || 'Tenancy').toString().trim().slice(0, 100);
  const list = await lockWrapper.listLockPasscodes(clientId, parentLockId);
  const match = list.find((p) => String(p.keyboardPwdName || '').trim() === name);
  if (!match || match.keyboardPwdId == null) return;
  await lockWrapper.deletePasscode(clientId, parentLockId, match.keyboardPwdId);
}

async function deletePasscodeTargetsAndParents(clientId, info, targets, displayName) {
  for (const tgt of targets) {
    try {
      await lockWrapper.deletePasscode(clientId, tgt.lockId, tgt.keyboardPwdId);
    } catch (err) {
      console.warn('[tenancy-active] TTLock delete passcode failed', tgt.type, err.message);
    }
  }
  const lockDetailIdsForParent = new Set(targets.map((t) => t.lockDetailId).filter(Boolean));
  if (!lockDetailIdsForParent.size && info.primaryLockDetailId) {
    lockDetailIdsForParent.add(info.primaryLockDetailId);
  }
  const parentSeen = new Set();
  for (const lockDetailId of lockDetailIdsForParent) {
    try {
      const parent = await getParentLockForLockDetail(clientId, lockDetailId);
      if (!parent) continue;
      const pk = `${parent.parentLockId}:${displayName}`;
      if (parentSeen.has(pk)) continue;
      parentSeen.add(pk);
      await deleteParentLockPasscodeByName(clientId, parent.parentLockId, displayName);
    } catch (err) {
      console.warn('[tenancy-active] TTLock parent delete failed', err.message);
    }
  }
}

async function clearTenancyPasscodeColumns(tenancyId) {
  const sqlFull = `UPDATE tenancy SET password = NULL, passwordid = NULL, password_property = NULL, password_room = NULL,
    passwordid_property = NULL, passwordid_room = NULL, updated_at = NOW() WHERE id = ?`;
  try {
    await pool.query(sqlFull, [tenancyId]);
  } catch (e) {
    if (!isUnknownColumnError(e)) throw e;
    await pool.query('UPDATE tenancy SET password = NULL, passwordid = NULL, updated_at = NOW() WHERE id = ?', [
      tenancyId
    ]);
  }
}

/**
 * After TTLock deletes on old room: clear DB fields so reprovision does not reference stale keyboardPwdIds.
 */
async function clearTenancyPasscodesAfterRoomChangeDeletes(tenancyId, { propertyChanged }) {
  try {
    if (propertyChanged) {
      await pool.query(
        `UPDATE tenancy SET password_room = NULL, passwordid_room = NULL, password_property = NULL, passwordid_property = NULL,
         password = NULL, passwordid = NULL, updated_at = NOW() WHERE id = ?`,
        [tenancyId]
      );
    } else {
      await pool.query(
        `UPDATE tenancy SET password_room = NULL, passwordid_room = NULL, updated_at = NOW() WHERE id = ?`,
        [tenancyId]
      );
    }
  } catch (e) {
    if (!isUnknownColumnError(e)) throw e;
    await pool.query('UPDATE tenancy SET password = NULL, passwordid = NULL, updated_at = NOW() WHERE id = ?', [
      tenancyId
    ]);
  }
}

/**
 * Delete all TTLock keyboard passcodes for this tenancy (property + room + parent), then clear password columns in DB.
 * Used for natural end (cron) and terminate.
 */
async function removeTenancySmartDoorPasscodes(tenancyId) {
  const [tRows] = await pool.query('SELECT id, title FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
  if (!tRows.length) return { ok: false, reason: 'TENANCY_NOT_FOUND' };
  const tenancy = tRows[0];
  const info = await getLockAndMeterFromTenancy(tenancyId);
  if (!info || !info.clientId) {
    await clearTenancyPasscodeColumns(tenancyId);
    return { ok: true, skipped: true, reason: 'NO_LOCK_INFO' };
  }
  const displayName =
    (info.keyboardPwdDisplayName || tenancy.title || 'Tenancy').toString().trim().slice(0, 100) || 'Tenancy';
  const targets = buildPasscodeDeleteTargets(info);
  if (targets.length) {
    await deletePasscodeTargetsAndParents(info.clientId, info, targets, displayName);
  }
  await clearTenancyPasscodeColumns(tenancyId);
  return { ok: true };
}

const ENDED_PASSCODE_BATCH = 200;

/**
 * Tenancies with calendar end < today (MY), status still active (not terminated), still have passcode ids → TTLock delete + DB clear.
 */
async function runEndedTenancyPasscodeRemoval() {
  const today = getTodayMalaysiaDate();
  const results = { processed: 0, errors: [], batches: 0 };
  let batch;
  do {
    let rows;
    try {
      const [r] = await pool.query(
        `SELECT id FROM tenancy
         WHERE status = 1 AND room_id IS NOT NULL
           AND \`end\` IS NOT NULL AND DATE(\`end\`) < ?
           AND (
             (password IS NOT NULL AND TRIM(password) != '')
             OR passwordid IS NOT NULL
             OR passwordid_property IS NOT NULL OR passwordid_room IS NOT NULL
             OR (password_property IS NOT NULL AND TRIM(password_property) != '')
             OR (password_room IS NOT NULL AND TRIM(password_room) != '')
           )
         LIMIT ?`,
        [today, ENDED_PASSCODE_BATCH]
      );
      rows = r;
    } catch (e) {
      if (!isUnknownColumnError(e)) throw e;
      const [r] = await pool.query(
        `SELECT id FROM tenancy
         WHERE status = 1 AND room_id IS NOT NULL
           AND \`end\` IS NOT NULL AND DATE(\`end\`) < ?
           AND ((password IS NOT NULL AND TRIM(password) != '') OR passwordid IS NOT NULL)
         LIMIT ?`,
        [today, ENDED_PASSCODE_BATCH]
      );
      rows = r;
    }
    batch = rows || [];
    results.batches += 1;
    for (const row of batch) {
      try {
        const res = await removeTenancySmartDoorPasscodes(row.id);
        if (res.ok) results.processed++;
        else results.errors.push({ tenancyId: row.id, reason: res.reason });
      } catch (err) {
        results.errors.push({ tenancyId: row.id, reason: err.message });
      }
    }
  } while (batch.length === ENDED_PASSCODE_BATCH);
  return results;
}

/**
 * Change room: delete old room lock PIN (and old property PIN if property changed). Call before UPDATE tenancy.room_id.
 * @returns {{ skipped?: boolean, savedPasswords?: { passwordProperty, passwordRoom }, oldPropertyId, newPropertyId }}
 */
async function ttlockOnChangeRoomBeforeUpdate(tenancyId, { originalRoomId, newRoomId }) {
  if (!newRoomId || String(newRoomId) === String(originalRoomId)) {
    return { skipped: true, oldPropertyId: null, newPropertyId: null };
  }
  const [opRes, npRes] = await Promise.all([
    pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [originalRoomId]),
    pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [newRoomId])
  ]);
  const oldPropertyId = opRes?.[0]?.[0]?.property_id ?? null;
  const newPropertyId = npRes?.[0]?.[0]?.property_id ?? null;
  const propertyChanged = String(oldPropertyId || '') !== String(newPropertyId || '');

  const infoOld = await getLockAndMeterFromTenancy(tenancyId);
  const savedPasswords = infoOld
    ? resolveEffectivePasswords(infoOld)
    : { passwordProperty: null, passwordRoom: null };

  if (!infoOld?.clientId) {
    return { skipped: true, savedPasswords, oldPropertyId, newPropertyId, propertyChanged };
  }

  const displayName =
    (infoOld.keyboardPwdDisplayName || 'Room').toString().trim().slice(0, 100) || 'Room';
  const targets = buildPasscodeDeleteTargets(infoOld);
  const toDelete = targets.filter(
    (t) => t.type === 'room' || (t.type === 'property' && propertyChanged)
  );

  if (toDelete.length) {
    await deletePasscodeTargetsAndParents(infoOld.clientId, infoOld, toDelete, displayName);
  }

  await clearTenancyPasscodesAfterRoomChangeDeletes(tenancyId, { propertyChanged });

  return { skipped: false, savedPasswords, oldPropertyId, newPropertyId, propertyChanged };
}

/**
 * Change room: add PIN on new room lock (and new property if changed), then extend all passcodes to newEnd.
 */
async function ttlockOnChangeRoomAfterUpdate(tenancyId, { newEnd, savedPasswords, propertyChanged }) {
  if (!savedPasswords) return { ok: true, skipped: true };
  const pinRoom = savedPasswords.passwordRoom || savedPasswords.passwordProperty;
  const pinProp = savedPasswords.passwordProperty || savedPasswords.passwordRoom;
  if (!pinRoom && !pinProp) return { ok: true, skipped: true, reason: 'NO_SAVED_PINS' };

  const [tRows] = await pool.query('SELECT `begin`, `end` FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
  if (!tRows.length) return { ok: false, reason: 'TENANCY_NOT_FOUND' };
  const t = tRows[0];
  const endMs = newEnd ? new Date(newEnd).getTime() : (t.end ? new Date(t.end).getTime() : Date.now() + 86400000);
  const startMs = t.begin ? new Date(t.begin).getTime() : Date.now();

  const infoNew = await getLockAndMeterFromTenancy(tenancyId);
  if (!infoNew?.clientId) return { ok: true, skipped: true };

  const displayName =
    (infoNew.keyboardPwdDisplayName || 'Room').toString().trim().slice(0, 100) || 'Room';

  let newKidRoom = null;
  let newKidProp = null;

  if (infoNew.roomLockId && pinRoom) {
    try {
      const data = await lockWrapper.addPasscode(infoNew.clientId, infoNew.roomLockId, {
        name: displayName,
        password: pinRoom,
        startDate: startMs,
        endDate: endMs
      });
      newKidRoom = data?.keyboardPwdId ?? null;
    } catch (err) {
      console.warn('[tenancy-active] changeRoom add room passcode failed', tenancyId, err.message);
    }
  }

  if (propertyChanged && infoNew.propertyLockId && pinProp) {
    try {
      const data = await lockWrapper.addPasscode(infoNew.clientId, infoNew.propertyLockId, {
        name: displayName,
        password: pinProp,
        startDate: startMs,
        endDate: endMs
      });
      newKidProp = data?.keyboardPwdId ?? null;
    } catch (err) {
      console.warn('[tenancy-active] changeRoom add property passcode failed', tenancyId, err.message);
    }
  }

  try {
    if (newKidRoom != null) {
      await pool.query(
        `UPDATE tenancy SET password_room = ?, passwordid_room = ?, updated_at = NOW() WHERE id = ?`,
        [pinRoom, newKidRoom, tenancyId]
      );
    }
  } catch (e) {
    if (!isUnknownColumnError(e)) throw e;
  }

  try {
    if (propertyChanged && newKidProp != null) {
      await pool.query(
        `UPDATE tenancy SET password_property = ?, passwordid_property = ?, updated_at = NOW() WHERE id = ?`,
        [pinProp, newKidProp, tenancyId]
      );
    }
  } catch (e) {
    if (!isUnknownColumnError(e)) throw e;
  }

  const legacyPwd = newKidProp != null ? pinProp : newKidRoom != null ? pinRoom : null;
  const legacyKid = newKidProp != null ? newKidProp : newKidRoom != null ? newKidRoom : null;
  if (legacyPwd != null && legacyKid != null) {
    try {
      await pool.query('UPDATE tenancy SET password = ?, passwordid = ?, updated_at = NOW() WHERE id = ?', [
        legacyPwd,
        legacyKid,
        tenancyId
      ]);
    } catch (err) {
      console.warn('[tenancy-active] changeRoom legacy password sync failed', tenancyId, err.message);
    }
  }

  try {
    const [aRows] = await pool.query('SELECT active FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
    const activeVal = aRows[0]?.active;
    const extendLocksOnly = activeVal === 0;
    await setTenancyActive(tenancyId, { extendLocksOnly });
  } catch (err) {
    console.warn('[tenancy-active] changeRoom setTenancyActive failed', tenancyId, err.message);
  }

  return { ok: true };
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
  const displayName =
    (info.keyboardPwdDisplayName || tenancy.title || 'Tenancy').toString().trim().slice(0, 100) || 'Tenancy';
  const startMs = info.begin ? new Date(info.begin).getTime() : yesterdayMs;

  const targets = buildPasscodeTargets(info);
  for (const tgt of targets) {
    try {
      await lockWrapper.changePasscode(info.clientId, tgt.lockId, {
        keyboardPwdId: tgt.keyboardPwdId,
        name: displayName,
        startDate: startMs,
        endDate: yesterdayMs
      });
    } catch (err) {
      console.warn('[tenancy-active] TTLock expire failed', tenancyId, tgt.type, err.message);
    }
  }

  const lockDetailIdsForParent = new Set(
    targets.map((t) => t.lockDetailId).filter(Boolean)
  );
  if (!lockDetailIdsForParent.size && info.primaryLockDetailId) {
    lockDetailIdsForParent.add(info.primaryLockDetailId);
  }
  const parentSeen = new Set();
  for (const lockDetailId of lockDetailIdsForParent) {
    try {
      const parent = await getParentLockForLockDetail(info.clientId, lockDetailId);
      if (!parent) continue;
      const pk = `${parent.parentLockId}:${displayName}`;
      if (parentSeen.has(pk)) continue;
      parentSeen.add(pk);
      await setParentLockPasscodeEnd(info.clientId, parent.parentLockId, displayName, startMs, yesterdayMs);
    } catch (err) {
      console.warn('[tenancy-active] TTLock parent expire failed', tenancyId, err.message);
    }
  }

  if (info.cnyiotMeterId) {
    try {
      await meterWrapper.setRelay(info.clientId, info.cnyiotMeterId, 1);
    } catch (err) {
      console.warn('[tenancy-active] setRelay disconnect failed', tenancyId, err.message);
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
 * @param {{ extendLocksOnly?: boolean }} [options] — if true, only update TTLock/parent passcode validity; do not reconnect meter or set active=1 (e.g. change-room while tenancy frozen for unpaid).
 */
async function setTenancyActive(tenancyId, options = {}) {
  const extendLocksOnly = options.extendLocksOnly === true;
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
  const displayName =
    (info.keyboardPwdDisplayName || tenancy.title || 'Tenancy').toString().trim().slice(0, 100) || 'Tenancy';

  const targets = buildPasscodeTargets(info);
  for (const tgt of targets) {
    try {
      await lockWrapper.changePasscode(info.clientId, tgt.lockId, {
        keyboardPwdId: tgt.keyboardPwdId,
        name: displayName,
        startDate: startMs,
        endDate: endMs
      });
    } catch (err) {
      console.warn('[tenancy-active] TTLock extend failed', tenancyId, tgt.type, err.message);
    }
  }

  const lockDetailIdsForParent = new Set(
    targets.map((t) => t.lockDetailId).filter(Boolean)
  );
  if (!lockDetailIdsForParent.size && info.primaryLockDetailId) {
    lockDetailIdsForParent.add(info.primaryLockDetailId);
  }
  const parentSeen = new Set();
  for (const lockDetailId of lockDetailIdsForParent) {
    try {
      const parent = await getParentLockForLockDetail(info.clientId, lockDetailId);
      if (!parent) continue;
      const pk = `${parent.parentLockId}:${displayName}`;
      if (parentSeen.has(pk)) continue;
      parentSeen.add(pk);
      await setParentLockPasscodeEnd(info.clientId, parent.parentLockId, displayName, startMs, endMs);
    } catch (err) {
      console.warn('[tenancy-active] TTLock parent extend failed', tenancyId, err.message);
    }
  }

  if (!extendLocksOnly) {
    if (info.cnyiotMeterId) {
      try {
        await meterWrapper.setRelay(info.clientId, info.cnyiotMeterId, 2);
      } catch (err) {
        console.warn('[tenancy-active] setRelay connect failed', tenancyId, err.message);
      }
    }

    await pool.query(
      `UPDATE tenancy SET active = 1, inactive_reason = NULL, ttlock_passcode_expired_at = NULL, updated_at = NOW() WHERE id = ?`,
      [tenancyId]
    );
  }
  return { ok: true };
}

/**
 * 取得 client 的 invoice due 寬限期天數（admin.rental.grace_days）。0 = 當天到期當天沒付就鎖（當晚 cron 跑）。
 * 例如 grace_days=7：1 號到期的單最遲 8 號前要還，8 號才鎖門／斷電。
 */
function getGraceDaysFromAdmin(admin) {
  const rental = (admin && typeof admin === 'object' && admin.rental) ? admin.rental : null;
  const days = rental != null && typeof rental.grace_days === 'number' ? rental.grace_days : 0;
  return Math.max(0, Math.min(Number(days) || 0, 365));
}

/**
 * 「没有还钱」定义：考慮 Company Setting 的 invoice due grace_days。
 * - 無 grace（0）：date <= today 未付 = 欠租（當天到期當天沒付，當天晚上 cron 跑就鎖）。
 * - 有 grace（例如 7）：(date + grace_days) <= today 未付 = 欠租；1 號到期 + 7 天 → 8 號才鎖門／斷電。
 */
async function hasUnpaidRentalPastDue(tenancyId) {
  const today = getTodayMalaysiaDate();
  const [tRows] = await pool.query(
    'SELECT client_id FROM tenancy WHERE id = ? LIMIT 1',
    [tenancyId]
  );
  if (!tRows.length) return false;
  const [cRows] = await pool.query(
    'SELECT admin FROM operatordetail WHERE id = ? LIMIT 1',
    [tRows[0].client_id]
  );
  const admin = cRows[0] ? parseJson(cRows[0].admin) : null;
  const graceDays = getGraceDaysFromAdmin(admin);
  let sql; let params;
  if (graceDays === 0) {
    sql = `SELECT id FROM rentalcollection WHERE tenancy_id = ? AND date <= ? AND (ispaid = 0 OR ispaid IS NULL) LIMIT 1`;
    params = [tenancyId, today];
  } else {
    const deadline = new Date(today + 'T12:00:00+08:00');
    deadline.setDate(deadline.getDate() - graceDays);
    const deadlineStr = deadline.toISOString().slice(0, 10);
    sql = `SELECT id FROM rentalcollection WHERE tenancy_id = ? AND date <= ? AND (ispaid = 0 OR ispaid IS NULL) LIMIT 1`;
    params = [tenancyId, deadlineStr];
  }
  const [rows] = await pool.query(sql, params);
  return rows.length > 0;
}

/** 每批欠租檢查最多處理筆數，避免單次 SQL 過大；多批當天跑完 */
const TENANCY_CHECK_BATCH_SIZE = 500;

/**
 * Run daily check: find tenancies that have unpaid rental 過去到期未付（含 grace_days）and set them inactive.
 * 依 Company Setting admin.rental.grace_days：0 = 當天到期當天沒付就鎖（當晚 cron 跑）；N = 到期日 + N 天後才鎖（例：1 號單 + 7 天 → 8 號才鎖門／斷電）。
 * Call at 00:00 UTC+8. "Today" = calendar day in MY/SG (UTC+8).
 */
async function runDailyTenancyCheck() {
  const today = getTodayMalaysiaDate();
  const results = { processed: 0, errors: [], batches: 0 };
  let batch;
  do {
    const [rows] = await pool.query(
      `SELECT DISTINCT t.id FROM tenancy t
       INNER JOIN rentalcollection r ON r.tenancy_id = t.id AND (r.ispaid = 0 OR r.ispaid IS NULL)
       INNER JOIN operatordetail c ON c.id = t.client_id
       WHERE (t.active = 1 OR t.active IS NULL)
         AND (
           (COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(c.admin, '$.rental.grace_days')) AS UNSIGNED), 0) = 0 AND r.date <= ?)
           OR
           (COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(c.admin, '$.rental.grace_days')) AS UNSIGNED), 0) > 0
             AND r.date <= DATE_SUB(?, INTERVAL LEAST(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(c.admin, '$.rental.grace_days')) AS UNSIGNED), 0), 365) DAY))
         )
       LIMIT ?`,
      [today, today, TENANCY_CHECK_BATCH_SIZE]
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
       AND DATE(t.begin) <= ? AND DATE(t.\`end\`) >= ?
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
       AND DATE(t.begin) <= ? AND DATE(t.\`end\`) >= ?
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
  runEndedTenancyPasscodeRemoval,
  removeTenancySmartDoorPasscodes,
  ttlockOnChangeRoomBeforeUpdate,
  ttlockOnChangeRoomAfterUpdate,
  syncRoomAvailableFromTenancy,
  updateRoomAvailableFromTenancy,
  checkAndRestoreTenancyIfFullyPaid
};
