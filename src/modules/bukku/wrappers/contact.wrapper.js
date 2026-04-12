const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

const LOG_PREFIX = '[bukku/contact]';
const MAX_JSON = 6000;

function safeJson(value, maxLen = MAX_JSON) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…(truncated)` : s;
  } catch {
    return String(value);
  }
}

/** Shrink huge list payloads so pm2 stays readable. */
function compressListData(data) {
  if (data == null) return data;
  const contacts = Array.isArray(data.contacts)
    ? data.contacts
    : Array.isArray(data)
      ? data
      : null;
  if (!contacts) return data;
  const max = 8;
  const slice = contacts.slice(0, max);
  return {
    __listSummary: `showing ${slice.length}/${contacts.length} contacts`,
    contacts: slice,
    ...(contacts.length > max ? { __truncated: contacts.length - max } : {})
  };
}

/** Log outgoing request + Bukku response for pm2 debugging (grep LOG_PREFIX). */
function logContactExchange(op, { method, path, sent, result }) {
  let dataForLog = result.data;
  if (op === 'list' && result.ok && dataForLog != null) {
    dataForLog = compressListData(dataForLog);
  }
  const out = {
    op,
    method,
    path,
    sent: sent ?? null,
    ok: result.ok,
    status: result.status,
    error: result.error,
    data: dataForLog
  };
  console.log(LOG_PREFIX, safeJson(out));
}

async function create(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  const path = '/contacts';
  const result = await bukkurequest({ method: 'post', endpoint: path, token, subdomain, data: payload });
  logContactExchange('create', { method: 'POST', path, sent: payload, result });
  return result;
}

async function list(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  const path = '/contacts';
  const result = await bukkurequest({ method: 'get', endpoint: path, token, subdomain, params: query });
  logContactExchange('list', { method: 'GET', path, sent: query, result });
  return result;
}

async function read(req, contactId) {
  const { token, subdomain } = getBukkuCreds(req);
  const path = `/contacts/${contactId}`;
  const result = await bukkurequest({ method: 'get', endpoint: path, token, subdomain });
  logContactExchange('read', { method: 'GET', path, sent: { contactId }, result });
  return result;
}

async function update(req, contactId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  const path = `/contacts/${contactId}`;
  const result = await bukkurequest({ method: 'put', endpoint: path, token, subdomain, data: payload });
  logContactExchange('update', { method: 'PUT', path, sent: payload, result });
  return result;
}

async function archive(req, contactId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  const path = `/contacts/${contactId}`;
  const result = await bukkurequest({ method: 'patch', endpoint: path, token, subdomain, data: payload });
  logContactExchange('archive', { method: 'PATCH', path, sent: payload, result });
  return result;
}

async function remove(req, contactId) {
  const { token, subdomain } = getBukkuCreds(req);
  const path = `/contacts/${contactId}`;
  const result = await bukkurequest({ method: 'delete', endpoint: path, token, subdomain });
  logContactExchange('remove', { method: 'DELETE', path, sent: { contactId }, result });
  return result;
}

module.exports = {
  create,
  list,
  read,
  update,
  archive,
  remove
};
