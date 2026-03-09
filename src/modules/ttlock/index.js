/**
 * TTLock API wrapper (SaaS – per client).
 * Use for HTTP routes (via routes) or programmatic calls (clientId = clientdetail.id).
 *
 * Programmatic usage:
 *   const ttlock = require('./src/modules/ttlock');
 *   const locks = await ttlock.lock.listAllLocks(clientId);
 *   const token = await ttlock.getValidTTLockToken(clientId);
 */

const { getValidTTLockToken } = require('./lib/ttlockToken.service');
const { getTtlockAuth } = require('./lib/ttlockCreds');
const { registerUser } = require('./lib/ttlockRegister');
const { ensureTTLockSubuser } = require('./lib/ttlockSubuser');
const lock = require('./wrappers/lock.wrapper');
const gateway = require('./wrappers/gateway.wrapper');

module.exports = {
  getValidTTLockToken,
  getTtlockAuth,
  registerUser,
  ensureTTLockSubuser,
  lock,
  gateway
};
