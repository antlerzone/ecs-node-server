const xerorequest = require('./xerorequest');
const { getXeroCreds } = require('../lib/xeroCreds');

async function list(req, query = {}) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'get',
    endpoint: '/Items',
    accessToken,
    tenantId,
    params: query
  });
}

/**
 * Create one item in Xero.
 * We keep payload minimal (Code + Name) so it works across account setups.
 */
async function create(req, payload) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  const code = String(payload?.code || '').trim();
  const name = String(payload?.name || '').trim();
  if (!code || !name) return { ok: false, error: 'XERO_ITEM_CODE_AND_NAME_REQUIRED' };
  return xerorequest({
    // Xero create items uses PUT /Items.
    method: 'put',
    endpoint: '/Items',
    accessToken,
    tenantId,
    data: {
      Items: [{
        Code: code.slice(0, 30),
        Name: name.slice(0, 4000)
      }]
    }
  });
}

module.exports = { list, create };
