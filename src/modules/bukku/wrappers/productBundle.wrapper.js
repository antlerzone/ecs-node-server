const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function create(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/products/bundles', token, subdomain, data: payload });
}

async function read(req, bundleId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/products/bundles/${bundleId}`, token, subdomain });
}

async function update(req, bundleId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/products/bundles/${bundleId}`, token, subdomain, data: payload });
}

async function archive(req, bundleId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/products/bundles/${bundleId}`, token, subdomain, data: payload });
}

async function remove(req, bundleId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/products/bundles/${bundleId}`, token, subdomain });
}

module.exports = {
  create,
  read,
  update,
  archive,
  remove
};
