const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function createquote(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/sales/quotes', token, subdomain, data: payload });
}

async function listquotes(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/sales/quotes', token, subdomain, params: query });
}

async function readquote(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/sales/quotes/${transactionId}`, token, subdomain });
}

async function updatequote(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/sales/quotes/${transactionId}`, token, subdomain, data: payload });
}

async function updatequotestatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/sales/quotes/${transactionId}`, token, subdomain, data: payload });
}

async function deletequote(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/sales/quotes/${transactionId}`, token, subdomain });
}

module.exports = {
  createquote,
  listquotes,
  readquote,
  updatequote,
  updatequotestatus,
  deletequote
};
