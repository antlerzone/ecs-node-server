const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createorder(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/sales/orders', token, subdomain, data: payload });
}

async function listorders(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/sales/orders', token, subdomain, params: query });
}

async function readorder(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/sales/orders/${transactionId}`, token, subdomain });
}

async function updateorder(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/sales/orders/${transactionId}`, token, subdomain, data: payload });
}

async function updateorderstatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/sales/orders/${transactionId}`, token, subdomain, data: payload });
}

async function deleteorder(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/sales/orders/${transactionId}`, token, subdomain });
}

module.exports = {
  createorder,
  listorders,
  readorder,
  updateorder,
  updateorderstatus,
  deleteorder
};
