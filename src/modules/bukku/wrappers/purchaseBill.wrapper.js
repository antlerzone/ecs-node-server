const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createpurchasebill(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/purchases/bills', token, subdomain, data: payload });
}

async function listpurchasebills(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/purchases/bills', token, subdomain, params: query });
}

async function readpurchasebill(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/purchases/bills/${transactionId}`, token, subdomain });
}

async function updatepurchasebill(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/purchases/bills/${transactionId}`, token, subdomain, data: payload });
}

async function updatepurchasebillstatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/purchases/bills/${transactionId}`, token, subdomain, data: payload });
}

async function deletepurchasebill(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/purchases/bills/${transactionId}`, token, subdomain });
}

module.exports = {
  createpurchasebill,
  listpurchasebills,
  readpurchasebill,
  updatepurchasebill,
  updatepurchasebillstatus,
  deletepurchasebill
};
