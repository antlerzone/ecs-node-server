/**
 * Cleanlemons: push operator permanent / job temporary keyboard PINs to TTLock (keyboardPwd API).
 * Uses lockdetail + cln_property.smartdoor_id; scope matches lock ownership (operator / B2B client / Coliving).
 */

const crypto = require('crypto');
const pool = require('../../config/db');
const lockWrapper = require('../ttlock/wrappers/lock.wrapper');
const { resolveClnOperatordetailTable } = require('../../config/clnOperatordetailTable');
const { getTodayMalaysiaDate, utcDatetimeFromDbToMalaysiaDateOnly } = require('../../utils/dateMalaysia');

const MY_OFFSET_MS = 8 * 60 * 60 * 1000;

function randomDigits(len) {
  const n = Math.max(4, Math.min(12, len || 6));
  const max = 10 ** n;
  const min = 10 ** (n - 1);
  return String(Math.floor(min + crypto.randomInt(0, max - min)));
}

function applyTtlockSlot(scope, slotFromRow) {
  const n = slotFromRow == null ? 0 : Number(slotFromRow);
  const ttlockSlot = Number.isFinite(n) && n >= 0 ? n : 0;
  if (scope.kind === 'cln_client') return { ...scope, ttlockSlot };
  if (scope.kind === 'cln_operator') return { ...scope, ttlockSlot };
  return scope;
}

function scopeToIntegrationKey(scope) {
  if (scope.kind === 'cln_operator') return String(scope.clnOperatorId || '').trim();
  if (scope.kind === 'cln_client') return String(scope.clnClientId || '').trim();
  return String(scope.clientId || '').trim();
}

function ttlockOpts(scope) {
  if (scope.kind === 'cln_client' || scope.kind === 'cln_operator') return { slot: scope.ttlockSlot ?? 0 };
  return {};
}

/**
 * Resolve TTLock scope for a lock row + property (same semantics as employee unlock).
 */
function resolveScopeForPropertyLock(lockRow, propertyRow) {
  const jOid = String(propertyRow.operator_id || '').trim();
  const jCid = String(propertyRow.clientdetail_id || '').trim();
  if (lockRow.cln_operatorid != null && String(lockRow.cln_operatorid).trim() !== '') {
    const lid = String(lockRow.cln_operatorid).trim();
    if (jOid && lid === jOid) {
      return { kind: 'cln_operator', clnOperatorId: lid };
    }
  }
  if (lockRow.cln_clientid != null && String(lockRow.cln_clientid).trim() !== '') {
    const cc = String(lockRow.cln_clientid).trim();
    if (!jCid || cc === jCid) {
      return { kind: 'cln_client', clnClientId: cc };
    }
  }
  if (lockRow.client_id != null && String(lockRow.client_id).trim() !== '') {
    return { kind: 'coliving', clientId: String(lockRow.client_id).trim() };
  }
  return null;
}

function malaysiaYmdBoundsMs(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const startMs = Date.UTC(y, mo - 1, d, 0, 0, 0, 0) - MY_OFFSET_MS;
  const endMs = Date.UTC(y, mo - 1, d, 23, 59, 59, 999) - MY_OFFSET_MS;
  return { startMs, endMs };
}

async function databaseHasColumn(table, column) {
  try {
    const [[row]] = await pool.query(
      `SELECT 1 AS ok FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [table, column]
    );
    return !!row?.ok;
  } catch {
    return false;
  }
}

/**
 * After client/operator saves property with full_access: generate PIN, push to TTLock, store on cln_property.
 */
async function syncOperatorPermanentPasscodeForProperty(propertyId) {
  const pid = String(propertyId || '').trim();
  if (!pid) return { ok: false, reason: 'MISSING_PROPERTY_ID' };
  const hasKid = await databaseHasColumn('cln_property', 'operator_smartdoor_keyboard_pwd_id');
  if (!hasKid) return { ok: false, reason: 'MIGRATION_REQUIRED' };

  const [[prop]] = await pool.query(
    `SELECT p.id, p.operator_id, p.clientdetail_id, p.smartdoor_id,
            COALESCE(NULLIF(TRIM(p.operator_door_access_mode), ''), 'temporary_password_only') AS mode,
            p.operator_smartdoor_keyboard_pwd_id AS oldKid
     FROM cln_property p WHERE p.id = ? LIMIT 1`,
    [pid]
  );
  if (!prop) return { ok: false, reason: 'PROPERTY_NOT_FOUND' };
  const mode = String(prop.mode || '').trim().toLowerCase();
  if (mode !== 'full_access') return { ok: true, skipped: true, reason: 'NOT_FULL_ACCESS' };

  const sdid = prop.smartdoor_id != null ? String(prop.smartdoor_id).trim() : '';
  if (!sdid) return { ok: false, reason: 'NO_SMARTDOOR_BINDING' };

  const [[lockRow]] = await pool.query(
    'SELECT id, lockid, cln_operatorid, cln_clientid, client_id, cln_ttlock_slot FROM lockdetail WHERE id = ? LIMIT 1',
    [sdid]
  );
  if (!lockRow || lockRow.lockid == null) return { ok: false, reason: 'LOCK_NOT_FOUND' };

  const scopeRaw = resolveScopeForPropertyLock(lockRow, prop);
  if (!scopeRaw) return { ok: false, reason: 'LOCK_SCOPE_UNRESOLVED' };
  const scope = applyTtlockSlot(scopeRaw, lockRow.cln_ttlock_slot);
  const apiKey = scopeToIntegrationKey(scope);
  const opts = ttlockOpts(scope);
  const lockId = String(lockRow.lockid).trim();

  const oid = String(prop.operator_id || '').trim();
  let passcodeName = 'Operator';
  if (oid) {
    try {
      const ct = await resolveClnOperatordetailTable();
      const [[op]] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(name), ''), NULLIF(TRIM(email), ''), '') AS nm FROM \`${ct}\` WHERE id = ? LIMIT 1`,
        [oid]
      );
      if (op?.nm) passcodeName = String(op.nm).trim().slice(0, 100);
    } catch (_) {
      /* ignore */
    }
  }

  const pin = randomDigits(6);
  const startMs = Date.now();
  const endMs = Date.UTC(2099, 11, 31, 23, 59, 59, 999);

  const oldKid = prop.oldKid != null ? String(prop.oldKid).trim() : '';
  if (oldKid) {
    try {
      await lockWrapper.deletePasscode(apiKey, lockId, oldKid, opts);
    } catch (e) {
      console.warn('[cln-smartdoor-pin] delete old operator passcode', pid, e?.message || e);
    }
  }

  let keyboardPwdId = null;
  try {
    const data = await lockWrapper.addPasscode(apiKey, lockId, {
      name: passcodeName,
      password: pin,
      startDate: startMs,
      endDate: endMs
    }, opts);
    keyboardPwdId = data?.keyboardPwdId != null ? String(data.keyboardPwdId) : null;
  } catch (e) {
    console.warn('[cln-smartdoor-pin] addPasscode permanent failed', pid, e?.message || e);
    return { ok: false, reason: 'TTLOCK_ADD_FAILED', message: e?.message || String(e) };
  }

  await pool.query(
    `UPDATE cln_property SET smartdoor_password = ?,
         operator_smartdoor_keyboard_pwd_id = ?,
         operator_smartdoor_passcode_name = ?,
         updated_at = NOW(3)
     WHERE id = ?`,
    [pin, keyboardPwdId, passcodeName, pid]
  );

  return { ok: true, pin, keyboardPwdId, passcodeName };
}

/**
 * After job insert (temporary_password_only): add time-bound PIN on lock, store on cln_schedule.
 */
async function syncJobTemporaryPasscodeForSchedule(scheduleId) {
  const sid = String(scheduleId || '').trim();
  if (!sid) return { ok: false, reason: 'MISSING_SCHEDULE_ID' };
  const hasPinCol = await databaseHasColumn('cln_schedule', 'job_smartdoor_pin');
  if (!hasPinCol) return { ok: false, reason: 'MIGRATION_REQUIRED' };

  const [[sch]] = await pool.query(
    `SELECT s.id, s.property_id AS propertyId, s.working_day AS workingDay,
            COALESCE(NULLIF(TRIM(p.operator_door_access_mode), ''), 'temporary_password_only') AS mode,
            p.smartdoor_id AS smartdoorId, p.operator_id, p.clientdetail_id
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     WHERE s.id = ? LIMIT 1`,
    [sid]
  );
  if (!sch) return { ok: false, reason: 'SCHEDULE_NOT_FOUND' };
  const mode = String(sch.mode || '').trim().toLowerCase();
  if (mode !== 'temporary_password_only') return { ok: true, skipped: true, reason: 'NOT_TEMPORARY_MODE' };

  const sdid = sch.smartdoorId != null ? String(sch.smartdoorId).trim() : '';
  if (!sdid) return { ok: false, reason: 'NO_SMARTDOOR_BINDING' };

  const [[lockRow]] = await pool.query(
    'SELECT id, lockid, cln_operatorid, cln_clientid, client_id, cln_ttlock_slot FROM lockdetail WHERE id = ? LIMIT 1',
    [sdid]
  );
  if (!lockRow || lockRow.lockid == null) return { ok: false, reason: 'LOCK_NOT_FOUND' };

  const scopeRaw = resolveScopeForPropertyLock(lockRow, sch);
  if (!scopeRaw) return { ok: false, reason: 'LOCK_SCOPE_UNRESOLVED' };
  const scope = applyTtlockSlot(scopeRaw, lockRow.cln_ttlock_slot);
  const apiKey = scopeToIntegrationKey(scope);
  const opts = ttlockOpts(scope);
  const lockId = String(lockRow.lockid).trim();

  const jobDay =
    utcDatetimeFromDbToMalaysiaDateOnly(sch.workingDay) || getTodayMalaysiaDate();
  const bounds = malaysiaYmdBoundsMs(jobDay);
  if (!bounds) return { ok: false, reason: 'BAD_WORKING_DAY' };

  const pin = randomDigits(6);
  const name = `Job ${sid.slice(0, 8)}`;

  let keyboardPwdId = null;
  try {
    const data = await lockWrapper.addPasscode(apiKey, lockId, {
      name,
      password: pin,
      startDate: bounds.startMs,
      endDate: bounds.endMs
    }, opts);
    keyboardPwdId = data?.keyboardPwdId != null ? String(data.keyboardPwdId) : null;
  } catch (e) {
    console.warn('[cln-smartdoor-pin] addPasscode job failed', sid, e?.message || e);
    return { ok: false, reason: 'TTLOCK_ADD_FAILED', message: e?.message || String(e) };
  }

  await pool.query(
    'UPDATE cln_schedule SET job_smartdoor_pin = ?, job_smartdoor_keyboard_pwd_id = ?, updated_at = NOW(3) WHERE id = ?',
    [pin, keyboardPwdId, sid]
  );

  return { ok: true, pin, keyboardPwdId };
}

module.exports = {
  syncOperatorPermanentPasscodeForProperty,
  syncJobTemporaryPasscodeForSchedule,
  resolveScopeForPropertyLock,
  databaseHasColumn,
};
