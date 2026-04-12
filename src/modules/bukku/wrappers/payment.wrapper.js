/**
 * Bukku: Payment (allocate payment to sales invoice).
 * Re-exports invoicepayment wrapper for consistent naming with other platforms.
 *
 * Official API (OpenAPI):
 * - DELETE /sales/payments/{transactionId} — only **draft** and **void** transactions can be deleted.
 * - Posted / “ready” receipts must be reversed with PATCH (e.g. status void + void_reason), not DELETE.
 */

const invoicepayment = require('./invoicepayment.wrapper');

module.exports = {
  createPayment: invoicepayment.createinvoicepayment,
  listPayments: invoicepayment.listinvoicepayments,
  getPayment: invoicepayment.readinvoicepayment,
  updatePayment: invoicepayment.updateinvoicepayment,
  /** PATCH /sales/payments/{id} — e.g. { status: 'void', void_reason } for posted payments */
  updatePaymentStatus: invoicepayment.updateinvoicepaymentstatus,
  /** DELETE /sales/payments/{id} — Bukku allows only draft | void */
  deletePayment: invoicepayment.deleteinvoicepayment
};
