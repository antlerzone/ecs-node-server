/**
 * Xero Accounting API – Payments (apply payment to invoice).
 * @see https://developer.xero.com/documentation/api/accounting/payments
 */

const xerorequest = require('./xerorequest');
const { getXeroCreds } = require('../lib/xeroCreds');

/**
 * Create payment(s). POST /Payments. Body: { Payments: [{ Invoice: { InvoiceID }, Account: { Code } | { AccountID }, Date, Amount, Reference? }] }
 */
async function createPayment(req, payload) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  const body = Array.isArray(payload.Payments) ? payload : { Payments: [payload] };
  if (!body.Payments || !body.Payments.length) body.Payments = [payload];
  return xerorequest({
    method: 'post',
    endpoint: '/Payments',
    accessToken,
    tenantId,
    data: body
  });
}

/**
 * List payments. GET /Payments. Params: where, order, invoiceID, etc.
 */
async function listPayments(req, params = {}) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'get',
    endpoint: '/Payments',
    accessToken,
    tenantId,
    params
  });
}

/**
 * Get single payment. GET /Payments/{PaymentID}
 */
async function getPayment(req, paymentId) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'get',
    endpoint: `/Payments/${encodeURIComponent(paymentId)}`,
    accessToken,
    tenantId
  });
}

/**
 * Reverse/delete payment. POST /Payments/{PaymentID} with { Status: 'DELETED' }.
 */
async function deletePayment(req, paymentId) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'post',
    endpoint: `/Payments/${encodeURIComponent(paymentId)}`,
    accessToken,
    tenantId,
    data: { Status: 'DELETED' }
  });
}

module.exports = {
  createPayment,
  listPayments,
  getPayment,
  deletePayment
};
