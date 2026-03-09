const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createpurchasepayment(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/purchases/payments', token, subdomain, data: payload });
}

async function listpurchasepayments(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/purchases/payments', token, subdomain, params: query });
}

async function readpurchasepayment(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/purchases/payments/${transactionId}`, token, subdomain });
}

async function updatepurchasepayment(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/purchases/payments/${transactionId}`, token, subdomain, data: payload });
}

async function updatepurchasepaymentstatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/purchases/payments/${transactionId}`, token, subdomain, data: payload });
}

async function deletepurchasepayment(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/purchases/payments/${transactionId}`, token, subdomain });
}

module.exports = {
  createpurchasepayment,
  listpurchasepayments,
  readpurchasepayment,
  updatepurchasepayment,
  updatepurchasepaymentstatus,
  deletepurchasepayment
};
