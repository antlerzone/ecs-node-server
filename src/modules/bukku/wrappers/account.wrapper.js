const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function create(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/accounts', token, subdomain, data: payload });
}

async function list(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/accounts', token, subdomain, params: query });
}

async function read(req, accountId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/accounts/${accountId}`, token, subdomain });
}

async function update(req, accountId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/accounts/${accountId}`, token, subdomain, data: payload });
}

async function archive(req, accountId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/accounts/${accountId}`, token, subdomain, data: payload });
}

async function remove(req, accountId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/accounts/${accountId}`, token, subdomain });
}

module.exports = { create, list, read, update, archive, remove };
