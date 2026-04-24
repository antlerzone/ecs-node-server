/**
 * Coliving operator invoice list uses the same pattern:
 * `coliving/next-app/app/operator/invoice/page.tsx` → `resolveBukkuInvoiceHref`
 * Rental collection writes/links use:
 * `rentalcollection-invoice.service.js` → `getInvoiceUrl` (Bukku branch) + `buildRentalInvoiceDisplayUrl`
 */

/**
 * @param {string|null|undefined} subdomain - Company-Subdomain (e.g. cleanlemons)
 * @param {string|number|null|undefined} transactionId - Numeric Bukku sales invoice transaction id (not IV- doc no)
 * @returns {string|null}
 */
function buildBukkuSalesInvoicePublicUrl(subdomain, transactionId) {
  const sub = subdomain != null && String(subdomain).trim() !== '' ? String(subdomain).trim() : '';
  const id = transactionId != null && String(transactionId).trim() !== '' ? String(transactionId).trim() : '';
  if (!sub || !id) return null;
  return `https://${sub}.bukku.my/invoices/${id}`.replace(/\/+/g, '/');
}

module.exports = {
  buildBukkuSalesInvoicePublicUrl
};
