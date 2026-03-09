const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function create(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/locations', token, subdomain, data: payload });
}

async function list(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/locations', token, subdomain, params: query });
}

async function read(req, id) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/location/${id}`, token, subdomain });
}

async function update(req, id, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/location/${id}`, token, subdomain, data: payload });
}

async function archive(req, id, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/location/${id}`, token, subdomain, data: payload });
}

async function remove(req, id) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/location/${id}`, token, subdomain });
}

module.exports = { create, list, read, update, archive, remove };
