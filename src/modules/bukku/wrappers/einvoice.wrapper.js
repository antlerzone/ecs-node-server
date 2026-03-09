/**
 * Bukku: E-Invoice (MyInvois). Create invoice with myinvois_action or submit existing.
 * @see https://intercom.help/bukku/en/articles/9656124-submitting-e-invoices-to-lhdn-myinvois-portal-using-bukku
 * Create invoice payload can include myinvois_action: 'NORMAL' | 'VALIDATE' | 'EXTERNAL'.
 * If API provides submit-for-existing-invoice endpoint, use it here.
 */

const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

/**
 * Submit existing invoice to MyInvois. PATCH /sales/invoices/{id} with e-invoice submit (path/body per Bukku API).
 * If Bukku only supports e-invoice at create time, this may trigger submit via status/action update.
 */
async function submitEInvoice(req, invoiceId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'patch',
    endpoint: `/sales/invoices/${invoiceId}`,
    token,
    subdomain,
    data: { myinvois_submit: true }
  });
}

/**
 * Get e-invoice status for an invoice (if API provides).
 */
async function getEInvoiceStatus(req, invoiceId) {
  const { token, subdomain } = getBukkuCreds(req);
  const res = await bukkurequest({
    method: 'get',
    endpoint: `/sales/invoices/${invoiceId}`,
    token,
    subdomain
  });
  if (!res.ok) return res;
  return { ok: true, data: res.data };
}

/**
 * Cancel e-invoice (within allowed period; if API provides).
 */
async function cancelEInvoice(req, invoiceId, body = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'patch',
    endpoint: `/sales/invoices/${invoiceId}`,
    token,
    subdomain,
    data: { myinvois_cancel: true, ...body }
  });
}

module.exports = {
  submitEInvoice,
  getEInvoiceStatus,
  cancelEInvoice
};
