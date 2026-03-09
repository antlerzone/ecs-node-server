/**
 * CNYIoT Price API wrapper (SaaS – per client).
 */

const { callCnyIot } = require('./cnyiotRequest');

/** @param {string} clientId
 *  @param {{ usePlatformAccount?: boolean }} [opts]
 */
async function getPrices(clientId, opts = {}) {
  return callCnyIot({
    clientId,
    method: 'getPrices',
    body: { offset: -1, limit: -1, ptype: 1 },
    usePlatformAccount: !!opts.usePlatformAccount
  });
}

/** @param {string} clientId
 *  @param {object} price
 *  @param {{ usePlatformAccount?: boolean }} [opts]
 */
async function addPrice(clientId, price, opts = {}) {
  return callCnyIot({
    clientId,
    method: 'addPrice',
    body: price,
    usePlatformAccount: !!opts.usePlatformAccount
  });
}

/** 批量删除电价，body.id 为价格序号数组。文档 §7 deletePrice */
async function deletePrice(clientId, idList) {
  return callCnyIot({
    clientId,
    method: 'deletePrice',
    body: { id: idList }
  });
}

/** 修改电价。文档 §9 editPrice */
async function editPrice(clientId, payload) {
  return callCnyIot({
    clientId,
    method: 'editPrice',
    body: payload
  });
}

module.exports = { getPrices, addPrice, deletePrice, editPrice };
