const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createpurchaserefund(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/purchases/refunds', token, subdomain, data: payload });
}

async function listpurchaserefunds(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/purchases/refunds', token, subdomain, params: query });
}

async function readpurchaserefund(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/purchases/refunds/${transactionId}`, token, subdomain });
}

async function updatepurchaserefund(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/purchases/refunds/${transactionId}`, token, subdomain, data: payload });
}

async function updatepurchaserefundstatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/purchases/refunds/${transactionId}`, token, subdomain, data: payload });
}

async function deletepurchaserefund(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/purchases/refunds/${transactionId}`, token, subdomain });
}

module.exports = {
  createpurchaserefund,
  listpurchaserefunds,
  readpurchaserefund,
  updatepurchaserefund,
  updatepurchaserefundstatus,
  deletepurchaserefund
};
