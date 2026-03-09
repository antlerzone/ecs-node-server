/**
 * Bukku: Payment (allocate payment to sales invoice).
 * Re-exports invoicepayment wrapper for consistent naming with other platforms.
 */

const invoicepayment = require('./invoicepayment.wrapper');

module.exports = {
  createPayment: invoicepayment.createinvoicepayment,
  listPayments: invoicepayment.listinvoicepayments,
  getPayment: invoicepayment.readinvoicepayment,
  updatePayment: invoicepayment.updateinvoicepayment,
  deletePayment: invoicepayment.deleteinvoicepayment
};
