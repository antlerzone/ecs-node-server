const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function create(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/products/groups', token, subdomain, data: payload });
}

async function list(req) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/products/groups', token, subdomain });
}

async function read(req, groupId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/products/groups/${groupId}`, token, subdomain });
}

async function update(req, groupId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/products/groups/${groupId}`, token, subdomain, data: payload });
}

async function remove(req, groupId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/products/groups/${groupId}`, token, subdomain });
}

module.exports = {
  create,
  list,
  read,
  update,
  remove
};
