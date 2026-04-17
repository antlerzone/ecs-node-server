/**
 * TTLock Gateway API wrapper (SaaS – per client).
 */

const { getTtlockAuth } = require('../lib/ttlockCreds');
const { ttlockGet, ttlockPost } = require('./ttlockRequest');

const PAGE_SIZE = 100;

async function listAllGateways(clientId, options = {}) {
  const auth = await getTtlockAuth(clientId, options);
  let pageNo = 1;
  const all = [];
  let pages = 1;
  do {
    const data = await ttlockGet('/gateway/list', auth, { pageNo, pageSize: PAGE_SIZE, orderBy: 1 });
    const list = data?.list || [];
    all.push(...list);
    pages = data?.pages ?? 1;
    if (pageNo >= pages) break;
    pageNo += 1;
  } while (true);
  return { total: all.length, list: all };
}

async function getGatewayById(clientId, gatewayId, options = {}) {
  const data = await listAllGateways(clientId, options);
  return data.list.find(gw => String(gw.gatewayId) === String(gatewayId)) || null;
}

async function renameGateway(clientId, gatewayId, gatewayName, options = {}) {
  const auth = await getTtlockAuth(clientId, options);
  const data = await ttlockPost('/gateway/rename', auth, { gatewayId, gatewayName });
  if (data?.errcode !== 0 && data?.errcode !== undefined) {
    const msg = data?.errmsg || 'unknown';
    if (/identical Name|already exists/i.test(String(msg))) {
      throw new Error(`TTLOCK_DUPLICATE_GATEWAY_NAME: ${msg}`);
    }
    throw new Error(`TTLOCK_GATEWAY_RENAME_FAILED: ${msg}`);
  }
  return data;
}

module.exports = {
  listAllGateways,
  getGatewayById,
  renameGateway
};
