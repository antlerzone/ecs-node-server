const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createdeliveryorder(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/sales/delivery_orders', token, subdomain, data: payload });
}

async function listdeliveryorders(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/sales/delivery_orders', token, subdomain, params: query });
}

async function readdeliveryorder(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/sales/delivery_orders/${transactionId}`, token, subdomain });
}

async function updatedeliveryorder(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/sales/delivery_orders/${transactionId}`, token, subdomain, data: payload });
}

async function updatedeliveryorderstatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/sales/delivery_orders/${transactionId}`, token, subdomain, data: payload });
}

async function deletedeliveryorder(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/sales/delivery_orders/${transactionId}`, token, subdomain });
}

module.exports = {
  createdeliveryorder,
  listdeliveryorders,
  readdeliveryorder,
  updatedeliveryorder,
  updatedeliveryorderstatus,
  deletedeliveryorder
};
