const xerorequest = require('./xerorequest');
const { getXeroCreds } = require('../lib/xeroCreds');

async function list(req, query = {}) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'get',
    endpoint: '/Accounts',
    accessToken,
    tenantId,
    params: query
  });
}

async function read(req, accountId) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'get',
    endpoint: `/Accounts/${encodeURIComponent(accountId)}`,
    accessToken,
    tenantId
  });
}

/**
 * Create one account. Xero requires Name, Type, Code (unique).
 * @param {object} req - { client: { id } } for getXeroCreds
 * @param {{ name: string, type: string, code?: string }} payload - type = Xero Type (e.g. REVENUE, EXPENSE, BANK)
 */
async function create(req, payload) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  const code = payload.code || String(Math.abs((payload.name || '').split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0))).slice(0, 6).padStart(6, '0');
  return xerorequest({
    method: 'post',
    endpoint: '/Accounts',
    accessToken,
    tenantId,
    data: {
      Accounts: [{
        Name: String(payload.name || '').trim() || 'Account',
        Type: String(payload.type || 'EXPENSE').trim().toUpperCase(),
        Code: code.replace(/\D/g, '').slice(0, 10) || '1'
      }]
    }
  });
}

module.exports = { list, read, create };
