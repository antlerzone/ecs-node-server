const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createrefund(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/sales/refunds', token, subdomain, data: payload });
}

async function listrefunds(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/sales/refunds', token, subdomain, params: query });
}

async function readrefund(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/sales/refunds/${transactionId}`, token, subdomain });
}

async function updaterefund(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/sales/refunds/${transactionId}`, token, subdomain, data: payload });
}

async function updaterefundstatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/sales/refunds/${transactionId}`, token, subdomain, data: payload });
}

async function deleterefund(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/sales/refunds/${transactionId}`, token, subdomain });
}

module.exports = {
  createrefund,
  listrefunds,
  readrefund,
  updaterefund,
  updaterefundstatus,
  deleterefund
};
