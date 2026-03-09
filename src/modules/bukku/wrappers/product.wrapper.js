const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function create(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/products', token, subdomain, data: payload });
}

async function list(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/products', token, subdomain, params: query });
}

async function read(req, productId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/products/${productId}`, token, subdomain });
}

async function update(req, productId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/products/${productId}`, token, subdomain, data: payload });
}

async function archive(req, productId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/products/${productId}`, token, subdomain, data: payload });
}

async function remove(req, productId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/products/${productId}`, token, subdomain });
}

module.exports = {
  create,
  list,
  read,
  update,
  archive,
  remove
};
