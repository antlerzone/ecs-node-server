/**
 * Create accounting entries when Generate Report #buttonpay / #buttonbulkpaid: cash invoice (management fees to owner) + cash bill (owner payout).
 * Date from #datepickerpayment; #dropdownpaymentmethod has only Bank / Cash (asset we pay from). Platform Collection = liability we decrease (DR); Bank/Cash = CR.
 */

const pool = require('../../config/db');
const axios = require('axios');
const {
  resolveClientAccounting,
  getAccountMapping,
  getPaymentDestinationAccountId,
  getAccountIdByPaymentType,
  getContactForRentalItem,
  createCashInvoice,
  getInvoiceUrl
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const { createCashPurchaseOne } = require('../expenses/expenses-purchase.service');
const { recordAccountingError } = require('../help/help.service');

function toErrorText(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
const bukkuInvoice = require('../bukku/wrappers/invoice.wrapper');
const bukkuPurchaseBill = require('../bukku/wrappers/purchaseBill.wrapper');
const xeroInvoice = require('../xero/wrappers/invoice.wrapper');
const xeroPayment = require('../xero/wrappers/payment.wrapper');

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

function parseBukkuIdFromUrl(url) {
  const s = (url || '').toString().trim();
  if (!s) return null;
  const byInvoice = s.match(/\/sales\/invoices\/([A-Za-z0-9_-]+)/i);
  if (byInvoice?.[1]) return byInvoice[1];
  const byInvoicePublic = s.match(/\/invoices\/([A-Za-z0-9_-]+)/i);
  if (byInvoicePublic?.[1]) return byInvoicePublic[1];
  const byBill = s.match(/\/purchases\/bills\/([A-Za-z0-9_-]+)/i);
  if (byBill?.[1]) return byBill[1];
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s;
  return null;
}

function extractBukkuShortCode(url) {
  const s = (url || '').toString().trim();
  if (!s) return null;
  const m = s.match(/\/l\/([A-Za-z0-9_-]+)/i);
  return m?.[1] ? m[1] : null;
}

function matchesBukkuShortLink(value, fullRef, shortCode) {
  const v = (value || '').toString().trim();
  if (!v) return false;
  if (fullRef && v === fullRef) return true;
  if (shortCode && /\/l\//i.test(v) && v.endsWith(`/${shortCode}`)) return true;
  return false;
}

function isIgnorableVoidError(err) {
  const msg = toErrorText(err).toLowerCase();
  return (
    msg.includes('invalid status update path') ||
    msg.includes('already void') ||
    msg.includes('already voided') ||
    msg.includes('not found') ||
    msg.includes('does not exist')
  );
}

function parseXeroInvoiceIdFromRef(ref) {
  const s = ref == null ? '' : String(ref).trim();
  if (!s) return null;
  const directGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (directGuid.test(s)) return s;
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(s);
  return m?.[1] ? m[1] : null;
}

function buildXeroArInvoiceOpenUrl(invoiceId) {
  const id = invoiceId != null ? String(invoiceId).trim() : '';
  if (!id) return null;
  return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(id)}`;
}

function buildXeroApBillOpenUrl(invoiceId) {
  const id = invoiceId != null ? String(invoiceId).trim() : '';
  if (!id) return null;
  return `https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${encodeURIComponent(id)}`;
}

function isXeroPaidVoidError(err) {
  const msg = toErrorText(err).toLowerCase();
  return /payment|paid|cannot be voided|validation/.test(msg);
}

async function voidXeroInvoiceWithPaymentReverse(req, invoiceId) {
  let res = await xeroInvoice.update(req, invoiceId, { Status: 'VOIDED' });
  if (res?.ok) return { ok: true };
  if (!isXeroPaidVoidError(res?.error)) return { ok: false, error: res?.error };

  const where = `Invoice.InvoiceID=guid("${invoiceId}")`;
  const listRes = await xeroPayment.listPayments(req, { where });
  if (!listRes?.ok) return { ok: false, error: `LIST_PAYMENT_FAILED: ${toErrorText(listRes?.error)}` };
  const payments = Array.isArray(listRes?.data?.Payments) ? listRes.data.Payments : [];
  for (const p of payments) {
    const pid = p?.PaymentID ?? p?.PaymentId;
    if (!pid) continue;
    const delRes = await xeroPayment.deletePayment(req, String(pid));
    if (!delRes?.ok) return { ok: false, error: `REVERSE_PAYMENT_FAILED ${pid}: ${toErrorText(delRes?.error)}` };
  }
  res = await xeroInvoice.update(req, invoiceId, { Status: 'VOIDED' });
  return res?.ok ? { ok: true } : { ok: false, error: res?.error };
}

async function resolveBukkuRedirectedId(url) {
  const s = (url || '').toString().trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const res = await axios.get(s, {
      maxRedirects: 8,
      timeout: 12000,
      validateStatus: () => true
    });
    const finalUrl =
      res?.request?.res?.responseUrl ||
      res?.request?.responseURL ||
      null;
    if (!finalUrl) return null;
    return parseBukkuIdFromUrl(finalUrl);
  } catch (_) {
    return null;
  }
}

async function resolveBukkuInvoiceId(req, invoiceRef) {
  const ref = (invoiceRef || '').toString().trim();
  if (!ref) return null;
  const parsed = parseBukkuIdFromUrl(ref);
  if (parsed && !/^https?:\/\//i.test(parsed)) return parsed;
  const redirected = await resolveBukkuRedirectedId(ref);
  if (redirected) return redirected;
  const shortCode = extractBukkuShortCode(ref);
  if (shortCode) {
    const listRes = await bukkuInvoice.listinvoices(req, { page_size: 100 });
    if (listRes?.ok) {
      const txs = Array.isArray(listRes?.data?.transactions)
        ? listRes.data.transactions
        : Array.isArray(listRes?.data?.data)
          ? listRes.data.data
          : [];
      for (const tx of txs) {
        if (matchesBukkuShortLink(tx?.short_link, ref, shortCode)) {
          if (tx?.id != null) return String(tx.id);
        }
      }
    }
  }
  return null;
}

async function resolveBukkuBillId(req, billRef) {
  const ref = (billRef || '').toString().trim();
  if (!ref) return null;
  const parsed = parseBukkuIdFromUrl(ref);
  if (parsed && !/^https?:\/\//i.test(parsed)) return parsed;
  const redirected = await resolveBukkuRedirectedId(ref);
  if (redirected) return redirected;
  const shortCode = extractBukkuShortCode(ref);
  if (shortCode) {
    const listRes = await bukkuPurchaseBill.listpurchasebills(req, { page_size: 100 });
    if (listRes?.ok) {
      const txs = Array.isArray(listRes?.data?.transactions)
        ? listRes.data.transactions
        : Array.isArray(listRes?.data?.data)
          ? listRes.data.data
          : [];
      for (const tx of txs) {
        if (matchesBukkuShortLink(tx?.short_link, ref, shortCode)) {
          if (tx?.id != null) return String(tx.id);
        }
      }
    }
  }
  return null;
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
  if (!resolved.ok || !resolved.req) {
    const skipReason = resolved.reason || 'NO_ACCOUNTING';
    try {
      await pool.query(
        'UPDATE ownerpayout SET accounting_status = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
        ['skipped', payoutId, clientId]
      );
    } catch (_) {}
    return {
      ok: false,
      invoiceCreated: false,
      billCreated: false,
      skipped: true,
      skipReason,
      provider: null
    };
  }
  const { provider, req } = resolved;

  const [rows] = await pool.query(
    `SELECT o.id, o.property_id, o.period, o.management_fee, o.netpayout, o.title,
            p.shortname AS property_shortname
     FROM ownerpayout o
     LEFT JOIN propertydetail p ON p.id = o.property_id AND p.client_id = o.client_id
     WHERE o.id = ? AND o.client_id = ? LIMIT 1`,
    [payoutId, clientId]
  );
  if (!rows.length) return { ok: false, errors: ['PAYOUT_NOT_FOUND'], notFound: true, provider };
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
    invoiceToOwner: true,
    propertyId,
    tenantId: null
  });
  if (!contactRes.ok) {
    recordAccountingError(clientId, { context: 'generatereport_owner_contact', reason: contactRes.reason, ids: [payoutId], provider }).catch(() => {});
    try {
      await pool.query(
        'UPDATE ownerpayout SET accounting_status = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
        ['failed', payoutId, clientId]
      );
    } catch (_) {}
    return { ok: false, errors: [contactRes.reason], provider };
  }
  const ownerContactId = contactRes.contactId;

  // Bank/Cash = asset we pay FROM (CR). Platform Collection = liability we decrease (DR).
  const bankOrCashDest = await getPaymentDestinationAccountId(clientId, provider, paymentMethod);
  if (!bankOrCashDest || !bankOrCashDest.accountId) {
    const reason = `No ${paymentMethod} account (account table + account_client)`;
    recordAccountingError(clientId, { context: 'generatereport_payment_account', reason, ids: [payoutId], provider }).catch(() => {});
    try {
      await pool.query(
        'UPDATE ownerpayout SET accounting_status = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
        ['failed', payoutId, clientId]
      );
    } catch (_) {}
    return { ok: false, errors: [reason], provider };
  }
  const bankOrCashAccountId = bankOrCashDest.accountId;

  const platformCollectionDest = await getPaymentDestinationAccountId(clientId, provider, 'platform_collection');
  if (!platformCollectionDest || !platformCollectionDest.accountId) {
    const reason = 'No Platform Collection account (account table + account_client)';
    recordAccountingError(clientId, { context: 'generatereport_platform_collection', reason, ids: [payoutId], provider }).catch(() => {});
    try {
      await pool.query(
        'UPDATE ownerpayout SET accounting_status = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
        ['failed', payoutId, clientId]
      );
    } catch (_) {}
    return { ok: false, errors: [reason], provider };
  }
  const platformCollectionAccountId = platformCollectionDest.accountId;

  const errors = [];
  const warnings = [];
  let invoiceCreated = false;
  let billCreated = false;
  let invoiceUrl = null;
  let billUrl = null;

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
          productId: mgmtMapping.productId != null && String(mgmtMapping.productId).trim() !== ''
            ? mgmtMapping.productId
            : undefined,
          amount: managementFee,
          paymentAccountId: platformCollectionAccountId,
          date: paymentDate,
          title: 'Management Fee',
          description: `Management Fee | ${descBase}`.slice(0, 2000)
        });
        if (invRes.ok) {
          invoiceCreated = true;
          if (invRes.invoiceUrl) {
            invoiceUrl = String(invRes.invoiceUrl);
          } else if (provider === 'xero' && invRes.invoiceId) {
            try {
              invoiceUrl = await getInvoiceUrl(req, provider, invRes.invoiceId);
            } catch (_) {}
            if (!invoiceUrl) {
              invoiceUrl = buildXeroArInvoiceOpenUrl(invRes.invoiceId) || String(invRes.invoiceId);
            }
          } else if (provider === 'bukku' && invRes.invoiceId && req.client?.bukku_subdomain) {
            const sub = String(req.client.bukku_subdomain).trim();
            invoiceUrl = `https://${sub}.bukku.my/invoices/${invRes.invoiceId}`;
          } else {
            try {
              invoiceUrl = await getInvoiceUrl(req, provider, invRes.invoiceId);
            } catch (_) {}
          }
        } else errors.push(`Management fee invoice: ${toErrorText(invRes.reason)}`);
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
    if (purchaseRes.ok) {
      billCreated = true;
      if (purchaseRes.purchaseUrl) {
        billUrl = purchaseRes.purchaseUrl;
      } else if (provider === 'xero' && purchaseRes.purchaseId) {
        billUrl = buildXeroApBillOpenUrl(purchaseRes.purchaseId) || String(purchaseRes.purchaseId);
      } else if (provider === 'bukku' && purchaseRes.purchaseId && req.client?.bukku_subdomain) {
        const sub = String(req.client.bukku_subdomain).trim();
        billUrl = `https://${sub}.bukku.my/purchases/bills/${purchaseRes.purchaseId}`;
      }
    } else errors.push(`Owner payout bill: ${toErrorText(purchaseRes.reason)}`);
  }

  if ((invoiceUrl != null || billUrl != null) && (invoiceCreated || billCreated)) {
    try {
      await pool.query(
        'UPDATE ownerpayout SET bukkuinvoice = COALESCE(?, bukkuinvoice), bukkubills = COALESCE(?, bukkubills), updated_at = NOW() WHERE id = ? AND client_id = ?',
        [invoiceUrl || null, billUrl || null, payoutId, clientId]
      );
    } catch (e) {
      console.warn('[generatereport] write back invoice/bill URLs failed:', e?.message || e);
    }
  }

  if (errors.length > 0) {
    recordAccountingError(clientId, {
      context: 'generatereport_accounting',
      reason: errors.join('; '),
      ids: [payoutId],
      provider
    }).catch(() => {});
  }

  const accountingStatus =
    errors.length > 0
      ? 'failed'
      : invoiceCreated || billCreated || (managementFee <= 0 && netpayout <= 0)
        ? 'synced'
        : 'failed';
  try {
    await pool.query(
      'UPDATE ownerpayout SET accounting_status = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
      [accountingStatus, payoutId, clientId]
    );
  } catch (e) {
    console.warn('[generatereport-accounting] accounting_status update failed', payoutId, e?.message || e);
  }

  return {
    ok: errors.length === 0,
    invoiceCreated,
    billCreated,
    skipped: false,
    provider,
    errors: errors.length ? errors : undefined
  };
}

/**
 * Create accounting for multiple ownerpayouts (bulk #buttonbulkpaid).
 */
async function createAccountingForOwnerPayoutBulk(clientId, payoutIds, opts) {
  if (!clientId || !Array.isArray(payoutIds) || payoutIds.length === 0) {
    return { ok: true, invoiceCreated: 0, billCreated: 0, skippedCount: 0 };
  }
  let invoiceCreated = 0;
  let billCreated = 0;
  let skippedCount = 0;
  let skipReason = null;
  let providerHint = null;
  const allErrors = [];
  for (const id of payoutIds) {
    const result = await createAccountingForOwnerPayout(clientId, id, opts);
    if (providerHint == null && result.provider) providerHint = result.provider;
    if (result.skipped) {
      skippedCount++;
      if (!skipReason && result.skipReason) skipReason = result.skipReason;
    }
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
  return {
    ok: allErrors.length === 0,
    invoiceCreated,
    billCreated,
    skippedCount,
    skipped: skippedCount > 0,
    skipReason: skipReason || undefined,
    provider: providerHint,
    errors: allErrors.length ? allErrors : undefined
  };
}

/**
 * Void accounting invoice + bill for one ownerpayout payment, then clear local refs.
 * Current implementation supports Bukku (same fields are bukkuinvoice / bukkubills).
 */
async function voidOwnerReportPayment(clientId, payoutId, opts = {}) {
  if (!clientId || !payoutId) return { ok: false, errors: ['MISSING_CLIENT_OR_PAYOUT_ID'] };

  const [rows] = await pool.query(
    `SELECT id, paid, bukkuinvoice, bukkubills
       FROM ownerpayout
      WHERE id = ? AND client_id = ?
      LIMIT 1`,
    [payoutId, clientId]
  );
  if (!rows.length) return { ok: false, errors: ['PAYOUT_NOT_FOUND'], notFound: true };

  const row = rows[0];
  const invoiceRef = String(row.bukkuinvoice || '').trim();
  const billRef = String(row.bukkubills || '').trim();
  const shouldSkipAccountingVoid = opts.skipAccountingVoid === true;
  const hasAnyAccountingRef = !!(invoiceRef || billRef);

  const errors = [];
  const warnings = [];
  let invoiceVoided = false;
  let billVoided = false;

  if (!shouldSkipAccountingVoid && hasAnyAccountingRef) {
    const resolved = await resolveClientAccounting(clientId);
    if (!resolved.ok || !resolved.req) {
      errors.push(`NO_ACCOUNTING: ${resolved.reason || 'missing integration'}`);
    } else {
      const { provider, req } = resolved;
      if (provider === 'bukku') {
        const invoiceId = await resolveBukkuInvoiceId(req, invoiceRef);
        const billId = await resolveBukkuBillId(req, billRef);
        if (invoiceRef && !invoiceId) {
          errors.push(`UNPARSEABLE_INVOICE_REF: ${invoiceRef}`);
        }
        if (billRef && !billId) {
          errors.push(`UNPARSEABLE_BILL_REF: ${billRef}`);
        }
        if (invoiceId) {
          const invRes = await bukkuInvoice.updateinvoicestatus(req, invoiceId, {
            status: 'void',
            void_reason: 'Void owner payout payment'
          });
          if (invRes?.ok) invoiceVoided = true;
          else if (isIgnorableVoidError(invRes?.error)) warnings.push(`VOID_INVOICE_IGNORED: ${toErrorText(invRes?.error)}`);
          else errors.push(`VOID_INVOICE_FAILED: ${JSON.stringify(invRes?.error || 'UNKNOWN_ERROR')}`);
        }

        if (billId) {
          const billRes = await bukkuPurchaseBill.updatepurchasebillstatus(req, billId, {
            status: 'void',
            void_reason: 'Void owner payout payment'
          });
          if (billRes?.ok) billVoided = true;
          else if (isIgnorableVoidError(billRes?.error)) warnings.push(`VOID_BILL_IGNORED: ${toErrorText(billRes?.error)}`);
          else errors.push(`VOID_BILL_FAILED: ${JSON.stringify(billRes?.error || 'UNKNOWN_ERROR')}`);
        }
      } else if (provider === 'xero') {
        const invoiceId = parseXeroInvoiceIdFromRef(invoiceRef);
        const billId = parseXeroInvoiceIdFromRef(billRef);
        if (invoiceRef && !invoiceId) {
          errors.push(`UNPARSEABLE_INVOICE_REF: ${invoiceRef}`);
        }
        if (billRef && !billId) {
          errors.push(`UNPARSEABLE_BILL_REF: ${billRef}`);
        }
        if (invoiceId) {
          const invRes = await voidXeroInvoiceWithPaymentReverse(req, invoiceId);
          if (invRes?.ok) invoiceVoided = true;
          else if (isIgnorableVoidError(invRes?.error)) warnings.push(`VOID_INVOICE_IGNORED: ${toErrorText(invRes?.error)}`);
          else errors.push(`VOID_INVOICE_FAILED: ${JSON.stringify(invRes?.error || 'UNKNOWN_ERROR')}`);
        }
        if (billId) {
          const billRes = await voidXeroInvoiceWithPaymentReverse(req, billId);
          if (billRes?.ok) billVoided = true;
          else if (isIgnorableVoidError(billRes?.error)) warnings.push(`VOID_BILL_IGNORED: ${toErrorText(billRes?.error)}`);
          else errors.push(`VOID_BILL_FAILED: ${JSON.stringify(billRes?.error || 'UNKNOWN_ERROR')}`);
        }
      } else {
        errors.push(`UNSUPPORTED_PROVIDER_FOR_VOID: ${provider}`);
      }
    }
  }

  if (errors.length > 0) {
    recordAccountingError(clientId, {
      context: 'generatereport_void_payment',
      reason: errors.slice(0, 10).join('; '),
      ids: [payoutId]
    }).catch(() => {});
    return { ok: false, invoiceVoided, billVoided, errors };
  }

  await pool.query(
    `UPDATE ownerpayout
        SET paid = 0,
            payment_date = NULL,
            payment_method = NULL,
            accounting_status = ?,
            bukkuinvoice = NULL,
            bukkubills = NULL,
            updated_at = NOW()
      WHERE id = ? AND client_id = ?`,
    ['voided', payoutId, clientId]
  );

  return {
    ok: true,
    invoiceVoided,
    billVoided,
    skippedAccountingVoid: shouldSkipAccountingVoid || !hasAnyAccountingRef,
    warnings: warnings.length ? warnings : undefined
  };
}

module.exports = {
  createAccountingForOwnerPayout,
  createAccountingForOwnerPayoutBulk,
  normalizeReportPaymentMethod,
  voidOwnerReportPayment
};
