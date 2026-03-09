const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createpurchasecreditnote(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/purchases/credit_notes', token, subdomain, data: payload });
}

async function listpurchasecreditnotes(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/purchases/credit_notes', token, subdomain, params: query });
}

async function readpurchasecreditnote(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/purchases/credit_notes/${transactionId}`, token, subdomain });
}

async function updatepurchasecreditnote(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/purchases/credit_notes/${transactionId}`, token, subdomain, data: payload });
}

async function updatepurchasecreditnotestatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/purchases/credit_notes/${transactionId}`, token, subdomain, data: payload });
}

async function deletepurchasecreditnote(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/purchases/credit_notes/${transactionId}`, token, subdomain });
}

module.exports = {
  createpurchasecreditnote,
  listpurchasecreditnotes,
  readpurchasecreditnote,
  updatepurchasecreditnote,
  updatepurchasecreditnotestatus,
  deletepurchasecreditnote
};
