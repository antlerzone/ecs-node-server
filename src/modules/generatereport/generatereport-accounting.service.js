/**
 * Create accounting entries when Generate Report #buttonpay / #buttonbulkpaid: cash invoice (management fees to owner) + cash bill (owner payout).
 * Date from #datepickerpayment; #dropdownpaymentmethod has only Bank / Cash (asset we pay from). Platform Collection = liability we decrease (DR); Bank/Cash = CR.
 */

const pool = require('../../config/db');
const {
  resolveClientAccounting,
  getAccountMapping,
  getPaymentDestinationAccountId,
  getAccountIdByPaymentType,
  getContactForRentalItem,
  createCashInvoice
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const { createCashPurchaseOne } = require('../expenses/expenses-purchase.service');
const { recordAccountingError } = require('../help/help.service');

/**
 * Normalize #dropdownpaymentmethod: only Bank or Cash (no Platform Collection in dropdown).
 * Bank/Cash = asset we pay from (CR). Platform Collection = liability we decrease (DR), resolved in code.
 */
function normalizeReportPaymentMethod(method) {
  const m = (method || '').toString().trim().toLowerCase();
  if (m === 'bank') return 'bank';
  if (m === 'cash') return 'cash';
  return 'cash'; // default
}

/**
 * Create cash invoice (management fee to owner) + cash bill (owner payout) for one ownerpayout.
 * Preconditions: client has pricing plan + accounting integration; owner has contact in accounting.
 * @param {string} clientId
 * @param {string} payoutId - ownerpayout.id
 * @param {{ paymentDate: Date|string, paymentMethod: string }} opts - from #datepickerpayment and #dropdownpaymentmethod
 * @returns {Promise<{ ok: boolean, invoiceCreated?: boolean, billCreated?: boolean, errors?: string[] }>}
 */
async function createAccountingForOwnerPayout(clientId, payoutId, opts) {
  if (!clientId || !payoutId) return { ok: true, invoiceCreated: false, billCreated: false };

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) return { ok: true, invoiceCreated: false, billCreated: false };
  const { provider, req } = resolved;

  const [rows] = await pool.query(
    `SELECT o.id, o.property_id, o.period, o.management_fee, o.netpayout, o.title,
            p.shortname AS property_shortname
     FROM ownerpayout o
     LEFT JOIN propertydetail p ON p.id = o.property_id AND p.client_id = o.client_id
     WHERE o.id = ? AND o.client_id = ? LIMIT 1`,
    [payoutId, clientId]
  );
  if (!rows.length) return { ok: false, errors: ['PAYOUT_NOT_FOUND'] };
  const row = rows[0];
  const propertyId = row.property_id;
  const managementFee = Number(row.management_fee || 0);
  const netpayout = Number(row.netpayout || 0);
  const paymentDate = opts.paymentDate != null ? (opts.paymentDate instanceof Date ? opts.paymentDate : new Date(opts.paymentDate)) : new Date();
  const paymentMethod = normalizeReportPaymentMethod(opts.paymentMethod);
  const periodStr = row.period ? new Date(row.period).toISOString().slice(0, 10) : '';
  const propertyShort = (row.property_shortname || row.title || '').toString().trim();
  const descBase = [propertyShort, periodStr].filter(Boolean).join(' | ');

  const contactRes = await getContactForRentalItem(clientId, provider, req, {
    isOwnerCommission: true,
    propertyId,
    tenantId: null
  });
  if (!contactRes.ok) {
    recordAccountingError(clientId, { context: 'generatereport_owner_contact', reason: contactRes.reason, ids: [payoutId], provider }).catch(() => {});
    return { ok: false, errors: [contactRes.reason] };
  }
  const ownerContactId = contactRes.contactId;

  // Bank/Cash = asset we pay FROM (CR). Platform Collection = liability we decrease (DR).
  const bankOrCashDest = await getPaymentDestinationAccountId(clientId, provider, paymentMethod);
  if (!bankOrCashDest || !bankOrCashDest.accountId) {
    const reason = `No ${paymentMethod} account (account table + account_client)`;
    recordAccountingError(clientId, { context: 'generatereport_payment_account', reason, ids: [payoutId], provider }).catch(() => {});
    return { ok: false, errors: [reason] };
  }
  const bankOrCashAccountId = bankOrCashDest.accountId;

  const platformCollectionDest = await getPaymentDestinationAccountId(clientId, provider, 'platform_collection');
  if (!platformCollectionDest || !platformCollectionDest.accountId) {
    const reason = 'No Platform Collection account (account table + account_client)';
    recordAccountingError(clientId, { context: 'generatereport_platform_collection', reason, ids: [payoutId], provider }).catch(() => {});
    return { ok: false, errors: [reason] };
  }
  const platformCollectionAccountId = platformCollectionDest.accountId;

  const errors = [];
  let invoiceCreated = false;
  let billCreated = false;

  // (1) Management fee: DR Platform Collection (liability ↓), CR Management Fee revenue.
  // Cash invoice: revenue = Management Fee; "payment" = we take from Platform Collection → paymentAccountId = Platform Collection.
  if (managementFee > 0) {
    const mgmtFeeUuid = await getAccountIdByPaymentType('management_fees');
    if (!mgmtFeeUuid) errors.push('No Management Fees account (account table)');
    else {
      const mgmtMapping = await getAccountMapping(clientId, mgmtFeeUuid, provider);
      if (!mgmtMapping || !mgmtMapping.accountId) errors.push('No Management Fees account mapping');
      else {
        const invRes = await createCashInvoice(req, provider, {
          contactId: ownerContactId,
          accountId: mgmtMapping.accountId,
          amount: managementFee,
          paymentAccountId: platformCollectionAccountId,
          date: paymentDate,
          title: 'Management Fee',
          description: `Management Fee | ${descBase}`.slice(0, 2000)
        });
        if (invRes.ok) invoiceCreated = true;
        else errors.push(`Management fee invoice: ${invRes.reason}`);
      }
    }
  }

  // (2) Owner payout: DR Platform Collection (liability ↓), CR Bank/Cash (pay from asset).
  // Cash purchase: debit = Platform Collection, credit = Bank/Cash.
  if (netpayout > 0) {
    const purchaseRes = await createCashPurchaseOne(req, provider, {
      contactId: ownerContactId,
      expenseAccountId: platformCollectionAccountId,
      paymentAccountId: bankOrCashAccountId,
      amount: netpayout,
      date: paymentDate,
      description: `Owner Payout | ${descBase}`.slice(0, 255)
    });
    if (purchaseRes.ok) billCreated = true;
    else errors.push(`Owner payout bill: ${purchaseRes.reason}`);
  }

  if (errors.length > 0) {
    recordAccountingError(clientId, {
      context: 'generatereport_accounting',
      reason: errors.join('; '),
      ids: [payoutId],
      provider
    }).catch(() => {});
  }

  return {
    ok: errors.length === 0,
    invoiceCreated,
    billCreated,
    errors: errors.length ? errors : undefined
  };
}

/**
 * Create accounting for multiple ownerpayouts (bulk #buttonbulkpaid).
 */
async function createAccountingForOwnerPayoutBulk(clientId, payoutIds, opts) {
  if (!clientId || !Array.isArray(payoutIds) || payoutIds.length === 0) {
    return { ok: true, invoiceCreated: 0, billCreated: 0 };
  }
  let invoiceCreated = 0;
  let billCreated = 0;
  const allErrors = [];
  for (const id of payoutIds) {
    const result = await createAccountingForOwnerPayout(clientId, id, opts);
    if (result.invoiceCreated) invoiceCreated++;
    if (result.billCreated) billCreated++;
    if (result.errors) allErrors.push(...result.errors.map((e) => `${id}: ${e}`));
  }
  if (allErrors.length > 0) {
    recordAccountingError(clientId, {
      context: 'generatereport_accounting_bulk',
      reason: allErrors.slice(0, 10).join('; '),
      ids: payoutIds.slice(0, 20),
      provider: undefined
    }).catch(() => {});
  }
  return { ok: allErrors.length === 0, invoiceCreated, billCreated, errors: allErrors.length ? allErrors : undefined };
}

module.exports = {
  createAccountingForOwnerPayout,
  createAccountingForOwnerPayoutBulk,
  normalizeReportPaymentMethod
};
