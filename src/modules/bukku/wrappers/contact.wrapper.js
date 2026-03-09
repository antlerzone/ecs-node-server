const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function create(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/contacts', token, subdomain, data: payload });
}

async function list(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/contacts', token, subdomain, params: query });
}

async function read(req, contactId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/contacts/${contactId}`, token, subdomain });
}

async function update(req, contactId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/contacts/${contactId}`, token, subdomain, data: payload });
}

async function archive(req, contactId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/contacts/${contactId}`, token, subdomain, data: payload });
}

async function remove(req, contactId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/contacts/${contactId}`, token, subdomain });
}

module.exports = {
  create,
  list,
  read,
  update,
  archive,
  remove
};
