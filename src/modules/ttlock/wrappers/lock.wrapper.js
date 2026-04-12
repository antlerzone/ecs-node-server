/**
 * TTLock Lock API wrapper (SaaS – per client).
 * All functions take clientId first; use getTtlockAuth(clientId) for auth.
 */

const { getTtlockAuth } = require('../lib/ttlockCreds');
const { ttlockGet, ttlockPost } = require('./ttlockRequest');

const PAGE_SIZE = 100;

async function listAllLocks(clientId) {
  const auth = await getTtlockAuth(clientId);
  let pageNo = 1;
  const all = [];
  let pages = 1;
  do {
    const data = await ttlockGet('/lock/list', auth, { pageNo, pageSize: PAGE_SIZE });
    const list = data?.list || [];
    all.push(...list);
    pages = data?.pages ?? 1;
    if (pageNo >= pages) break;
    pageNo += 1;
  } while (true);
  return { total: all.length, list: all };
}

async function getLockDetail(clientId, lockId) {
  const auth = await getTtlockAuth(clientId);
  return ttlockGet('/lock/detail', auth, { lockId });
}

async function changeLockName(clientId, lockId, lockName) {
  const auth = await getTtlockAuth(clientId);
  const data = await ttlockPost('/lock/rename', auth, { lockId, lockName });
  if (data?.errcode !== 0 && data?.errcode !== undefined) {
    throw new Error(`TTLOCK_RENAME_FAILED: ${data?.errmsg || 'unknown'}`);
  }
  return data;
}

async function queryLockElectricQuantity(clientId, lockId) {
  const auth = await getTtlockAuth(clientId);
  return ttlockGet('/lock/queryElectricQuantity', auth, { lockId });
}

async function listLockPasscodes(clientId, lockId) {
  const auth = await getTtlockAuth(clientId);
  const lid = coerceLockIdForTtlockApi(lockId);
  let pageNo = 1;
  const all = [];
  let hasMore = true;
  while (hasMore) {
    const data = await ttlockGet('/lock/listKeyboardPwd', auth, { lockId: lid, pageNo, pageSize: PAGE_SIZE });
    const list = data?.list || [];
    all.push(...list);
    hasMore = list.length >= PAGE_SIZE;
    pageNo += 1;
  }
  return all;
}

async function getPasscode(clientId, lockId, keyboardPwdId) {
  const list = await listLockPasscodes(clientId, lockId);
  return list.find(p => String(p.keyboardPwdId) === String(keyboardPwdId)) || null;
}

/** TTLock expects numeric lockId when it fits in safe integer. */
function coerceLockIdForTtlockApi(lockId) {
  if (lockId == null || lockId === '') return lockId;
  const s = String(lockId).trim();
  if (/^\d+$/.test(s)) {
    if (s.length > 15) return s;
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : s;
  }
  return lockId;
}

function isDuplicateKeyboardPwdError(data) {
  const m = (data?.errmsg || '').toLowerCase();
  return (
    (m.includes('same') && m.includes('passcode')) ||
    m.includes('already exists') ||
    m.includes('duplicate')
  );
}

function isInvalidParameterKeyboardPwdError(data) {
  if (data?.errcode === -3) return true;
  const m = (data?.errmsg || '').toLowerCase();
  return m.includes('invalid parameter') || m.includes('invalid param');
}

/** TTLock often returns errcode 1 + vague errmsg ("failed or means no" ≈ 失败或否) — try next addType/changeType. */
function isRetryableKeyboardPwdTransportFailure(data) {
  if (isInvalidParameterKeyboardPwdError(data)) return true;
  if (data?.errcode === 1) return true;
  const m = (data?.errmsg || '').toLowerCase();
  return (
    m.includes('failed or means no') ||
    m.includes('means failed or no') ||
    m === 'failed' ||
    m.includes('not supported') ||
    m.includes('function is not supported')
  );
}

function formatTtlockKeyboardPwdAddFailure(lastData) {
  const code = lastData?.errcode;
  const raw = (lastData?.errmsg || '').trim();
  if (
    code === 1 ||
    /failed or means no|means failed or no|^failed$/i.test(raw) ||
    !raw
  ) {
    return `This lock rejected the passcode request (TTLock errcode=${code ?? 'n/a'}). It may not support V4/cloud keypad PINs, be offline, or need a gateway — check the lock model in TTLock admin.`;
  }
  return raw;
}

async function findKeyboardPwdIdByPlainPassword(clientId, lockId, plainPassword) {
  const lid = coerceLockIdForTtlockApi(lockId);
  const list = await listLockPasscodes(clientId, lid);
  const want = String(plainPassword ?? '');
  const row = list.find((p) => String(p.keyboardPwd) === want);
  return row?.keyboardPwdId ?? null;
}

/**
 * Add keyboard passcode. Tries addType 2 (gateway) → 3 (NB-IoT) → 1 (Bluetooth default per TTLock doc).
 * "Same passcode already exists" is not auto-resolved — caller must reject (may be another tenant).
 */
async function addPasscode(clientId, lockId, payload) {
  const auth = await getTtlockAuth(clientId);
  const lid = coerceLockIdForTtlockApi(lockId);
  const pwdStr = String(payload.password ?? '');
  const bodyBase = {
    lockId: lid,
    keyboardPwdName: payload.name,
    keyboardPwd: pwdStr,
    startDate: payload.startDate,
    endDate: payload.endDate
  };

  const tryTypes = [2, 3, 1];
  let lastData;

  for (const addType of tryTypes) {
    const data = await ttlockPost('/keyboardPwd/add', auth, {
      ...bodyBase,
      addType
    });
    lastData = data;

    if (data?.errcode === 0 || (data?.errcode === undefined && data?.keyboardPwdId != null)) {
      return data;
    }

    if (isDuplicateKeyboardPwdError(data)) {
      const err = new Error('TTLOCK_PASSCODE_ALREADY_IN_USE_ON_LOCK');
      err.code = 'TTLOCK_PASSCODE_ALREADY_IN_USE_ON_LOCK';
      err.lockId = lid;
      err.ttlockErrmsg = data?.errmsg;
      throw err;
    }

    if (isRetryableKeyboardPwdTransportFailure(data)) {
      continue;
    }

    throw new Error(`TTLOCK_ADD_PASSCODE_FAILED: ${formatTtlockKeyboardPwdAddFailure(data)}`);
  }

  throw new Error(`TTLOCK_ADD_PASSCODE_FAILED: ${formatTtlockKeyboardPwdAddFailure(lastData)}`);
}

async function changePasscode(clientId, lockId, payload) {
  const auth = await getTtlockAuth(clientId);
  const lid = coerceLockIdForTtlockApi(lockId);
  const newPwd =
    payload.newKeyboardPwd != null && String(payload.newKeyboardPwd).trim() !== ''
      ? String(payload.newKeyboardPwd).trim()
      : payload.newPassword != null && String(payload.newPassword).trim() !== ''
        ? String(payload.newPassword).trim()
        : null;
  const bodyBase = {
    lockId: lid,
    keyboardPwdId: payload.keyboardPwdId,
    keyboardPwdName: payload.name,
    startDate: payload.startDate,
    endDate: payload.endDate,
    ...(newPwd ? { newKeyboardPwd: newPwd } : {})
  };
  const tryChangeTypes = [2, 3, 1];
  let lastData;
  for (const changeType of tryChangeTypes) {
    const data = await ttlockPost('/keyboardPwd/change', auth, {
      ...bodyBase,
      changeType
    });
    lastData = data;
    const code = data?.errcode;
    const msg = (data?.errmsg || '').toLowerCase();
    const success =
      code === 0 ||
      code === '0' ||
      (code === undefined &&
        (!data?.errmsg || msg.includes('none error') || msg.includes('no error')));
    if (success) {
      return data;
    }
    if (isRetryableKeyboardPwdTransportFailure(data)) {
      continue;
    }
    throw new Error(`TTLOCK_CHANGE_PASSCODE_FAILED: ${data?.errmsg || 'unknown'}`);
  }
  throw new Error(
    `TTLOCK_CHANGE_PASSCODE_FAILED: ${formatTtlockKeyboardPwdAddFailure(lastData)}`
  );
}

/**
 * Delete a keyboard passcode on the lock (cloud). Tries deleteType gateway → NB-IoT → default.
 * @see https://euopen.ttlock.com/doc/api/v3/keyboardPwd/delete
 */
async function deletePasscode(clientId, lockId, keyboardPwdId) {
  const auth = await getTtlockAuth(clientId);
  const lid = coerceLockIdForTtlockApi(lockId);
  const kid = keyboardPwdId != null ? String(keyboardPwdId).trim() : '';
  if (!kid) throw new Error('TTLOCK_DELETE_PASSCODE_FAILED: missing keyboardPwdId');
  const tryDeleteTypes = [2, 3, 1];
  let lastData;
  for (const deleteType of tryDeleteTypes) {
    const data = await ttlockPost('/keyboardPwd/delete', auth, {
      lockId: lid,
      keyboardPwdId: kid,
      deleteType
    });
    lastData = data;
    const code = data?.errcode;
    const msg = (data?.errmsg || '').toLowerCase();
    const success =
      code === 0 ||
      code === '0' ||
      (code === undefined &&
        (!data?.errmsg || msg.includes('none error') || msg.includes('no error')));
    if (success) {
      return data;
    }
    if (isRetryableKeyboardPwdTransportFailure(data)) {
      continue;
    }
    throw new Error(`TTLOCK_DELETE_PASSCODE_FAILED: ${data?.errmsg || 'unknown'}`);
  }
  throw new Error(
    `TTLOCK_DELETE_PASSCODE_FAILED: ${formatTtlockKeyboardPwdAddFailure(lastData)}`
  );
}

async function remoteUnlock(clientId, lockId) {
  const auth = await getTtlockAuth(clientId);
  const lid = coerceLockIdForTtlockApi(lockId);
  const data = await ttlockPost('/lock/unlock', auth, { lockId: lid });
  if (data?.errcode !== 0 && data?.errcode !== undefined) {
    throw new Error(`TTLOCK_UNLOCK_FAILED: ${data?.errmsg || 'unknown'}`);
  }
  return data;
}

function isPasscodeActive(passcode) {
  const now = Date.now();
  const start = passcode.startDate ?? passcode.startTime ?? null;
  const end = passcode.endDate ?? passcode.endTime ?? null;
  const status = passcode.keyboardPwdStatus;
  if (status === 2) return false;
  if (!start && !end) return true;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

async function listActivePasscodes(clientId, lockId) {
  const list = await listLockPasscodes(clientId, lockId);
  return list.filter(isPasscodeActive);
}

module.exports = {
  listAllLocks,
  getLockDetail,
  changeLockName,
  queryLockElectricQuantity,
  listLockPasscodes,
  getPasscode,
  findKeyboardPwdIdByPlainPassword,
  addPasscode,
  changePasscode,
  deletePasscode,
  remoteUnlock,
  listActivePasscodes
};
