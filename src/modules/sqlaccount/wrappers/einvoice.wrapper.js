/**
 * SQL Account API: E-Invoice hooks on sales invoice document (path prefix /salesinvoice).
 * Exact subpaths may vary by SQL version; override with env if needed.
 */

const sqlaccountrequest = require('./sqlaccountrequest');
const { salesInvoice: INV } = require('../lib/postmanPaths');

const SUBMIT_SUFFIX = process.env.SQLACCOUNT_EINVOICE_SUBMIT_SUFFIX || '/SubmitEInvoice';
const STATUS_SUFFIX = process.env.SQLACCOUNT_EINVOICE_STATUS_SUFFIX || '/EInvoiceStatus';
const CANCEL_SUFFIX = process.env.SQLACCOUNT_EINVOICE_CANCEL_SUFFIX || '/CancelEInvoice';

function docBase(dockey) {
  return `${INV}/${encodeURIComponent(String(dockey ?? '').trim())}`;
}

async function submitEInvoice(req, documentIdOrDocNo) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: `${docBase(documentIdOrDocNo)}${SUBMIT_SUFFIX}`,
    data: {}
  });
}

async function getEInvoiceStatus(req, documentIdOrDocNo) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: `${docBase(documentIdOrDocNo)}${STATUS_SUFFIX}`
  });
}

async function cancelEInvoice(req, documentIdOrDocNo, body = {}) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: `${docBase(documentIdOrDocNo)}${CANCEL_SUFFIX}`,
    data: body
  });
}

module.exports = {
  submitEInvoice,
  getEInvoiceStatus,
  cancelEInvoice
};
