const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createpurchaseorder(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/purchases/orders', token, subdomain, data: payload });
}

async function listpurchaseorders(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/purchases/orders', token, subdomain, params: query });
}

async function readpurchaseorder(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/purchases/orders/${transactionId}`, token, subdomain });
}

async function updatepurchaseorder(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/purchases/orders/${transactionId}`, token, subdomain, data: payload });
}

async function updatepurchaseorderstatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/purchases/orders/${transactionId}`, token, subdomain, data: payload });
}

async function deletepurchaseorder(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/purchases/orders/${transactionId}`, token, subdomain });
}

module.exports = {
  createpurchaseorder,
  listpurchaseorders,
  readpurchaseorder,
  updatepurchaseorder,
  updatepurchaseorderstatus,
  deletepurchaseorder
};
