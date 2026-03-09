const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function create(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/contacts/groups', token, subdomain, data: payload });
}

async function list(req) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/contacts/groups', token, subdomain });
}

async function read(req, groupId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/contacts/groups/${groupId}`, token, subdomain });
}

async function update(req, groupId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/contacts/groups/${groupId}`, token, subdomain, data: payload });
}

async function remove(req, groupId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/contacts/groups/${groupId}`, token, subdomain });
}

module.exports = {
  create,
  list,
  read,
  update,
  remove
};
