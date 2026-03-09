const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createinvoicepayment(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/sales/payments', token, subdomain, data: payload });
}

async function listinvoicepayments(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/sales/payments', token, subdomain, params: query });
}

async function readinvoicepayment(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/sales/payments/${transactionId}`, token, subdomain });
}

async function updateinvoicepayment(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/sales/payments/${transactionId}`, token, subdomain, data: payload });
}

async function updateinvoicepaymentstatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/sales/payments/${transactionId}`, token, subdomain, data: payload });
}

async function deleteinvoicepayment(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/sales/payments/${transactionId}`, token, subdomain });
}

module.exports = {
  createinvoicepayment,
  listinvoicepayments,
  readinvoicepayment,
  updateinvoicepayment,
  updateinvoicepaymentstatus,
  deleteinvoicepayment
};
