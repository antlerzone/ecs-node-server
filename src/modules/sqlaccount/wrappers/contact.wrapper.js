/**
 * SQL Account API: Contact (customer/supplier).
 * Paths per https://wiki.sql.com.my/wiki/SQL_Accounting_Linking and Postman Collection.
 */

const sqlaccountrequest = require('./sqlaccountrequest');

/**
 * List contacts. GET /Contact or path from Postman.
 * @param {object} req - Express request (req.client.id for creds)
 * @param {object} [params] - Query params
 */
async function listContacts(req, params = {}) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: '/Contact',
    params
  });
}

/**
 * Create contact. POST /Contact
 * @param {object} req
 * @param {object} payload - Contact payload per SQL Account API
 */
async function createContact(req, payload) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: '/Contact',
    data: payload || {}
  });
}

/**
 * Update contact. PUT /Contact/{id} (path may vary)
 */
async function updateContact(req, contactId, payload) {
  return sqlaccountrequest({
    req,
    method: 'put',
    path: `/Contact/${encodeURIComponent(contactId)}`,
    data: payload || {}
  });
}

module.exports = {
  listContacts,
  createContact,
  updateContact
};
