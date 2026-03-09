/**
 * Xero: Receipt (payment received against invoice).
 * In Xero, recording a receipt against a sales invoice uses the same Payments API (apply payment to invoice).
 */

const paymentWrapper = require('./payment.wrapper');

module.exports = {
  createReceipt: paymentWrapper.createPayment,
  listReceipts: paymentWrapper.listPayments,
  getReceipt: paymentWrapper.getPayment
};
