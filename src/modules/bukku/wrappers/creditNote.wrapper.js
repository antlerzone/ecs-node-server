const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createcreditnote(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/sales/credit_notes', token, subdomain, data: payload });
}

async function listcreditnotes(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/sales/credit_notes', token, subdomain, params: query });
}

async function readcreditnote(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/sales/credit_notes/${transactionId}`, token, subdomain });
}

async function updatecreditnote(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/sales/credit_notes/${transactionId}`, token, subdomain, data: payload });
}

async function updatecreditnotestatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/sales/credit_notes/${transactionId}`, token, subdomain, data: payload });
}

async function deletecreditnote(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/sales/credit_notes/${transactionId}`, token, subdomain });
}

module.exports = {
  createcreditnote,
  listcreditnotes,
  readcreditnote,
  updatecreditnote,
  updatecreditnotestatus,
  deletecreditnote
};
