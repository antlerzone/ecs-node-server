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
  let pageNo = 1;
  const all = [];
  let hasMore = true;
  while (hasMore) {
    const data = await ttlockGet('/lock/listKeyboardPwd', auth, { lockId, pageNo, pageSize: PAGE_SIZE });
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

async function addPasscode(clientId, lockId, payload) {
  const auth = await getTtlockAuth(clientId);
  const data = await ttlockPost('/lock/addKeyboardPwd', auth, {
    lockId,
    keyboardPwdName: payload.name,
    keyboardPwd: payload.password,
    startDate: payload.startDate,
    endDate: payload.endDate
  });
  if (data?.errcode !== 0 && data?.errcode !== undefined) {
    throw new Error(`TTLOCK_ADD_PASSCODE_FAILED: ${data?.errmsg || 'unknown'}`);
  }
  return data;
}

async function changePasscode(clientId, lockId, payload) {
  const auth = await getTtlockAuth(clientId);
  const data = await ttlockPost('/lock/changeKeyboardPwd', auth, {
    lockId,
    keyboardPwdId: payload.keyboardPwdId,
    keyboardPwdName: payload.name,
    startDate: payload.startDate,
    endDate: payload.endDate
  });
  if (data?.errcode !== 0 && data?.errcode !== undefined) {
    throw new Error(`TTLOCK_CHANGE_PASSCODE_FAILED: ${data?.errmsg || 'unknown'}`);
  }
  return data;
}

async function remoteUnlock(clientId, lockId) {
  const auth = await getTtlockAuth(clientId);
  const data = await ttlockPost('/lock/unlock', auth, { lockId });
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
  addPasscode,
  changePasscode,
  remoteUnlock,
  listActivePasscodes
};
