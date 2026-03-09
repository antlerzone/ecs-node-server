/**
 * Xero: E-Invoice (MyInvois for Malaysia). Paths per Xero API if supported for MY tenant.
 * @see https://developer.xero.com/documentation/api/accounting/invoices
 * Xero may support e-invoice via invoice status or separate endpoint; confirm with Xero MY docs.
 */

const xerorequest = require('./xerorequest');
const { getXeroCreds } = require('../lib/xeroCreds');

/**
 * Submit e-invoice for an existing invoice (if Xero API provides).
 */
async function submitEInvoice(req, invoiceId) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'post',
    endpoint: `/Invoices/${encodeURIComponent(invoiceId)}/Einvoice`,
    accessToken,
    tenantId,
    data: {}
  });
}

/**
 * Get e-invoice status (if Xero API provides).
 */
async function getEInvoiceStatus(req, invoiceId) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'get',
    endpoint: `/Invoices/${encodeURIComponent(invoiceId)}`,
    accessToken,
    tenantId
  });
}

/**
 * Cancel e-invoice (if Xero API provides).
 */
async function cancelEInvoice(req, invoiceId, body = {}) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'post',
    endpoint: `/Invoices/${encodeURIComponent(invoiceId)}/Einvoice/Cancel`,
    accessToken,
    tenantId,
    data: body
  });
}

module.exports = {
  submitEInvoice,
  getEInvoiceStatus,
  cancelEInvoice
};
