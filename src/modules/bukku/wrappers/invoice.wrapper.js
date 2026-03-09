const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

/**
 * create invoice
 */
async function createinvoice(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'post',
    endpoint: '/sales/invoices',
    token,
    subdomain,
    data: payload
  });
}

/**
 * list invoices
 */
async function listinvoices(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'get',
    endpoint: '/sales/invoices',
    token,
    subdomain,
    params: query
  });
}

/**
 * read single invoice
 */
async function readinvoice(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'get',
    endpoint: `/sales/invoices/${transactionId}`,
    token,
    subdomain
  });
}

/**
 * update invoice
 */
async function updateinvoice(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'put',
    endpoint: `/sales/invoices/${transactionId}`,
    token,
    subdomain,
    data: payload
  });
}

/**
 * update invoice status
 */
async function updateinvoicestatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'patch',
    endpoint: `/sales/invoices/${transactionId}`,
    token,
    subdomain,
    data: payload
  });
}

/**
 * delete invoice
 */
async function deleteinvoice(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'delete',
    endpoint: `/sales/invoices/${transactionId}`,
    token,
    subdomain
  });
}

module.exports = {
  createinvoice,
  listinvoices,
  readinvoice,
  updateinvoice,
  updateinvoicestatus,
  deleteinvoice
};