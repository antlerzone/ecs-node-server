const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function create(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/tags', token, subdomain, data: payload });
}

async function list(req) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/tags', token, subdomain });
}

async function read(req, id) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/tags/${id}`, token, subdomain });
}

async function update(req, id, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/tags/${id}`, token, subdomain, data: payload });
}

async function remove(req, id) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/tags/${id}`, token, subdomain });
}

module.exports = { create, list, read, update, remove };
