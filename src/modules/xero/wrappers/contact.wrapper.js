/**
 * Xero Accounting API – Contacts.
 * @see https://developer.xero.com/documentation/api/accounting/contacts
 * GET /Contacts, POST /Contacts (create/update), PUT /Contacts/{ContactID}
 */

const xerorequest = require('./xerorequest');
const { getXeroCreds } = require('../lib/xeroCreds');

/**
 * List contacts. GET /Contacts. Optional query: where, order, ids, includeArchived.
 * @param {object} req - Express request (req.client.id for creds)
 * @param {object} [params] - Query params
 * @returns {Promise<{ ok: boolean, data?: { Contacts: any[] }, error?: any }>}
 */
async function list(req, params = {}) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'get',
    endpoint: '/Contacts',
    accessToken,
    tenantId,
    params
  });
}

/**
 * Get one contact by id. GET /Contacts/{ContactID}
 */
async function read(req, contactId) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'get',
    endpoint: `/Contacts/${encodeURIComponent(contactId)}`,
    accessToken,
    tenantId
  });
}

/**
 * Create contact(s). POST /Contacts. Body: { Contacts: [{ Name, EmailAddress?, Phones?: [...] }] }.
 * @param {object} req
 * @param {{ Name: string, EmailAddress?: string, FirstName?: string, LastName?: string, Phones?: any[] }} payload - Xero Contact shape
 * @returns {Promise<{ ok: boolean, data?: { Contacts: any[] }, error?: any }>}
 */
async function create(req, payload) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  const contacts = Array.isArray(payload.Contacts) ? payload.Contacts : [{ ...payload }];
  return xerorequest({
    method: 'post',
    endpoint: '/Contacts',
    accessToken,
    tenantId,
    data: { Contacts: contacts }
  });
}

/**
 * Update contact. PUT /Contacts/{ContactID}
 * @param {object} req
 * @param {string} contactId - Xero ContactID (UUID)
 * @param {object} payload - Contact fields to update (Name, EmailAddress, Phones, etc.)
 */
async function update(req, contactId, payload) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'put',
    endpoint: `/Contacts/${encodeURIComponent(contactId)}`,
    accessToken,
    tenantId,
    data: payload
  });
}

module.exports = {
  list,
  read,
  create,
  update
};
