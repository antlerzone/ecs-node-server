const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function create(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/banking/transfers', token, subdomain, data: payload });
}

async function list(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/banking/transfers', token, subdomain, params: query });
}

async function read(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/banking/transfers/${transactionId}`, token, subdomain });
}

async function update(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/banking/transfers/${transactionId}`, token, subdomain, data: payload });
}

async function updateStatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/banking/transfers/${transactionId}`, token, subdomain, data: payload });
}

async function remove(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/banking/transfers/${transactionId}`, token, subdomain });
}

module.exports = {
  create,
  list,
  read,
  update,
  updateStatus,
  remove
};
