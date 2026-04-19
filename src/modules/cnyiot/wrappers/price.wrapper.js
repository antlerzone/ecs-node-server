/**
 * CNYIoT Price API wrapper (SaaS – per client).
 */

const { callCnyIot } = require('./cnyiotRequest');

/** @param {string} clientId */
async function getPrices(clientId) {
  return callCnyIot({
    clientId,
    method: 'getPrices',
    body: { offset: -1, limit: -1, ptype: 1 }
  });
}

/** @param {string} clientId @param {object} price */
async function addPrice(clientId, price) {
  return callCnyIot({
    clientId,
    method: 'addPrice',
    body: price
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
