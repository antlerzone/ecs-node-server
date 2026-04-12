/**
 * Operator invoice actions → Bukku / Xero (aligned with Coliving tenantinvoice + rentalcollection-invoice).
 * Requires: cln_operatordetail.bukku_contact_id for invoice client; cln_account_client mappings for lines + Bank/Cash.
 */

const pool = require('../../config/db');
const { resolveClnOperatordetailTable } = require('../../config/clnOperatordetailTable');
const clnInt = require('./cleanlemon-integration.service');
const bukkuInvoice = require('../bukku/wrappers/invoice.wrapper');
const bukkuPayment = require('../bukku/wrappers/payment.wrapper');
const xeroInvoice = require('../xero/wrappers/invoice.wrapper');
const xeroPayment = require('../xero/wrappers/payment.wrapper');
const { resolveXeroAccountCode } = require('../xero/lib/accountCodeResolver');
const { getXeroInvoiceCurrencyForClnOperatorId } = require('../xero/lib/invoiceCurrency');
const { utcDatetimeFromDbToMalaysiaDateOnly } = require('../../utils/dateMalaysia');

const DEFAULT_CURRENCY = (process.env.CLEANLEMON_DEFAULT_CURRENCY || 'MYR').trim() || 'MYR';
const BANK_ACCOUNT_TITLE = 'Bank';
const CASH_ACCOUNT_TITLE = 'Cash';

async function companyTableName() {
  return resolveClnOperatordetailTable();
}

async function getActiveProvider(operatorId) {
  await clnInt.ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT provider FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = 'addonAccount' AND enabled = 1
     ORDER BY CASE provider WHEN 'bukku' THEN 0 WHEN 'xero' THEN 1 ELSE 2 END
     LIMIT 1`,
    [String(operatorId)]
  );
  const p = rows[0]?.provider;
  return p ? String(p).trim().toLowerCase() : null;
}

function bukkuReq(operatorId, creds) {
  return {
    client: {
      id: String(operatorId),
      bukku_secretKey: String(creds.token || '').trim(),
      bukku_subdomain: String(creds.subdomain || '').trim()
    }
  };
}

function xeroReq(operatorId) {
  return { cleanlemonOperatorId: String(operatorId) };
}

async function getBukkuContactId(clientId) {
  const t = await companyTableName();
  const [[row]] = await pool.query(`SELECT bukku_contact_id FROM \`${t}\` WHERE id = ? LIMIT 1`, [String(clientId)]);
  const cid = row?.bukku_contact_id != null ? String(row.bukku_contact_id).trim() : '';
  return cid || null;
}

async function resolveMappedLine(operatorId, productTitle, system) {
  const title = String(productTitle || '').trim();
  if (!title) return null;
  const [rows] = await pool.query(
    `SELECT ac.external_account, ac.external_product, a.is_product AS isProduct
     FROM cln_account a
     INNER JOIN cln_account_client ac ON ac.account_id = a.id AND ac.operator_id = ? AND ac.\`system\` = ?
     WHERE TRIM(a.title) = ?
     LIMIT 1`,
    [String(operatorId), system, title]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    accountId: r.external_account != null && String(r.external_account).trim() !== '' ? String(r.external_account).trim() : null,
    productId: r.external_product != null && String(r.external_product).trim() !== '' ? String(r.external_product).trim() : null,
    isProduct: Number(r.isProduct) === 1
  };
}

async function resolveDepositAccountId(operatorId, method, system) {
  const want = String(method || 'bank').toLowerCase() === 'cash' ? CASH_ACCOUNT_TITLE : BANK_ACCOUNT_TITLE;
  const [rows] = await pool.query(
    `SELECT ac.external_account
     FROM cln_account a
     INNER JOIN cln_account_client ac ON ac.account_id = a.id AND ac.operator_id = ? AND ac.\`system\` = ?
     WHERE TRIM(a.title) = ?
     LIMIT 1`,
    [String(operatorId), system, want]
  );
  const ext = rows[0]?.external_account != null ? String(rows[0].external_account).trim() : '';
  if (ext && /^\d+$/.test(ext)) return ext;
  const envKey = want === CASH_ACCOUNT_TITLE ? 'CLEANLEMON_BUKKU_CASH_ACCOUNT_ID' : 'CLEANLEMON_BUKKU_BANK_ACCOUNT_ID';
  const fallback = (process.env[envKey] || '').trim();
  return fallback || null;
}

function ymd(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  const s = String(d).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try {
    return utcDatetimeFromDbToMalaysiaDateOnly(new Date(d));
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatProviderError(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  return err.message || JSON.stringify(err);
}

async function reverseBukkuPayment(req, paymentId) {
  const readRes = await bukkuPayment.getPayment(req, paymentId);
  const st = readRes?.data?.transaction?.status ?? readRes?.data?.status;
  if (readRes?.ok && st === 'void') return { ok: true };
  if (readRes?.ok && st === 'draft') {
    const delRes = await bukkuPayment.deletePayment(req, paymentId);
    if (!delRes?.ok) throw new Error(formatProviderError(delRes?.error) || 'BUKKU_DELETE_PAYMENT_FAILED');
    return { ok: true };
  }
  const patchRes = await bukkuPayment.updatePaymentStatus(req, paymentId, {
    status: 'void',
    void_reason: 'Void payment from Cleanlemons operator invoice'
  });
  if (patchRes?.ok) return { ok: true };
  throw new Error(formatProviderError(patchRes?.error) || 'BUKKU_VOID_PAYMENT_FAILED');
}

/**
 * After DB row exists: create sales invoice in accounting; update cln_client_invoice.invoice_number, transaction_id, pdf_url.
 */
async function createAccountingInvoiceForOperator(operatorId, invoiceDbId, input) {
  const provider = await getActiveProvider(operatorId);
  if (!provider || !['bukku', 'xero'].includes(provider)) {
    return { ok: true, skipped: true, reason: 'no_accounting' };
  }

  const clientId = String(input.clientId || '').trim();
  if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };

  const lines = Array.isArray(input.lines) ? input.lines : [];
  const issue = ymd(input.issueDate);
  const due = ymd(input.dueDate || input.issueDate);
  const system = provider;

  if (provider === 'bukku') {
    const creds = await clnInt.getBukkuCredentials(operatorId);
    if (!creds?.token || !creds?.subdomain) return { ok: false, reason: 'BUKKU_NOT_CONNECTED' };
    const req = bukkuReq(operatorId, creds);
    const bukkuCid = await getBukkuContactId(clientId);
    if (!bukkuCid) {
      return { ok: false, reason: 'BUKKU_CONTACT_MISSING', detail: 'Sync client to accounting or set bukku_contact_id on company' };
    }
    const formItems = [];
    if (lines.length) {
      for (const ln of lines) {
        const amt = Number(ln.qty || 0) * Number(ln.rate || 0);
        if (amt <= 0) continue;
        const map = await resolveMappedLine(operatorId, ln.product, 'bukku');
        if (!map?.accountId) {
          return { ok: false, reason: 'ACCOUNT_MAPPING_MISSING', detail: `Product: ${ln.product}` };
        }
        const desc = String(ln.description || ln.product || 'Line').slice(0, 2000);
        const item = {
          account_id: Number(map.accountId),
          description: desc,
          unit_price: Number(amt.toFixed(2)),
          quantity: 1
        };
        if (map.isProduct && map.productId) item.product_id = Number(map.productId);
        formItems.push(item);
      }
    } else {
      const amt = Number(input.amount || 0);
      if (amt <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
      const map = await resolveMappedLine(operatorId, 'Sales Income', 'bukku');
      if (!map?.accountId) {
        return { ok: false, reason: 'ACCOUNT_MAPPING_MISSING', detail: 'Map Sales Income in Accounting' };
      }
      formItems.push({
        account_id: Number(map.accountId),
        description: String(input.description || 'Invoice').slice(0, 2000),
        unit_price: amt,
        quantity: 1
      });
    }
    if (!formItems.length) return { ok: false, reason: 'NO_LINE_ITEMS' };

    const payload = {
      payment_mode: 'credit',
      contact_id: Number(bukkuCid),
      date: issue,
      currency_code: DEFAULT_CURRENCY,
      exchange_rate: 1,
      tax_mode: 'exclusive',
      form_items: formItems,
      term_items: [{ date: due, payment_due: '100%', description: 'Due' }],
      status: 'ready'
    };
    const res = await bukkuInvoice.createinvoice(req, payload);
    const parsed = bukkuInvoice.parseBukkuSalesInvoiceCreateResponse(res);
    if (!parsed.invoiceId) {
      return { ok: false, reason: formatProviderError(res?.error) || 'BUKKU_CREATE_FAILED' };
    }
    const sub = String(creds.subdomain || '').trim();
    const pdfUrl = parsed.shortLink || (sub ? `https://${sub}.bukku.my/invoices/${parsed.invoiceId}` : null);
    await pool.query(
      `UPDATE cln_client_invoice
       SET invoice_number = COALESCE(?, invoice_number),
           transaction_id = ?,
           pdf_url = COALESCE(?, pdf_url),
           updated_at = NOW(3)
       WHERE id = ?`,
      [parsed.documentNumber || null, String(parsed.invoiceId), pdfUrl, String(invoiceDbId)]
    );
    return { ok: true, accountingDocumentNumber: parsed.documentNumber, provider: 'bukku' };
  }

  if (provider === 'xero') {
    const req = xeroReq(operatorId);
    const ct = await companyTableName();
    const [[co]] = await pool.query(`SELECT name FROM \`${ct}\` WHERE id = ? LIMIT 1`, [clientId]);
    const Contact = { Name: String(input.clientName || co?.name || 'Customer').slice(0, 255) };

    const lineItems = [];
    if (lines.length) {
      for (const ln of lines) {
        const amt = Number(ln.qty || 0) * Number(ln.rate || 0);
        if (amt <= 0) continue;
        const map = await resolveMappedLine(operatorId, ln.product, 'xero');
        if (!map?.accountId) {
          return { ok: false, reason: 'ACCOUNT_MAPPING_MISSING', detail: `Product: ${ln.product}` };
        }
        const code = await resolveXeroAccountCode(req, map.accountId);
        if (!code) return { ok: false, reason: 'XERO_ACCOUNT_CODE_REQUIRED', detail: map.accountId };
        lineItems.push({
          Description: String(ln.description || ln.product || '').slice(0, 4000),
          Quantity: 1,
          UnitAmount: Number(amt.toFixed(2)),
          AccountCode: code
        });
      }
    } else {
      const amt = Number(input.amount || 0);
      const map = await resolveMappedLine(operatorId, 'Sales Income', 'xero');
      if (!map?.accountId) return { ok: false, reason: 'ACCOUNT_MAPPING_MISSING' };
      const code = await resolveXeroAccountCode(req, map.accountId);
      if (!code) return { ok: false, reason: 'XERO_ACCOUNT_CODE_REQUIRED' };
      lineItems.push({
        Description: String(input.description || 'Invoice').slice(0, 4000),
        Quantity: 1,
        UnitAmount: amt,
        AccountCode: code
      });
    }
    const invoiceCurrency = await getXeroInvoiceCurrencyForClnOperatorId(operatorId);
    const payload = {
      Type: 'ACCREC',
      Contact,
      CurrencyCode: invoiceCurrency,
      Date: issue,
      DueDate: due,
      LineItems: lineItems,
      Status: 'AUTHORISED'
    };
    const res = await xeroInvoice.create(req, payload);
    const inv = res?.data?.Invoices?.[0] ?? res?.Invoices?.[0];
    const invId = inv?.InvoiceID ?? inv?.InvoiceId;
    if (!invId) return { ok: false, reason: formatProviderError(res?.error) || 'XERO_CREATE_FAILED' };
    let docNo =
      inv?.InvoiceNumber != null && String(inv.InvoiceNumber).trim() !== '' ? String(inv.InvoiceNumber).trim() : null;
    if (!docNo) {
      const readRes = await xeroInvoice.read(req, invId);
      const inv2 = readRes?.data?.Invoices?.[0] ?? readRes?.Invoices?.[0];
      docNo =
        inv2?.InvoiceNumber != null && String(inv2.InvoiceNumber).trim() !== ''
          ? String(inv2.InvoiceNumber).trim()
          : null;
    }
    await pool.query(
      `UPDATE cln_client_invoice
       SET invoice_number = COALESCE(?, invoice_number),
           transaction_id = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [docNo, String(invId), String(invoiceDbId)]
    );
    return { ok: true, accountingDocumentNumber: docNo, provider: 'xero' };
  }

  return { ok: true, skipped: true };
}

/**
 * Record payment in accounting + cln_client_payment row.
 */
async function markPaidAccountingForOperator(operatorId, invoiceDbId, payload) {
  const provider = await getActiveProvider(operatorId);
  if (!provider || !['bukku', 'xero'].includes(provider)) {
    return { ok: true, skipped: true };
  }

  const [[inv]] = await pool.query(
    'SELECT id, client_id, amount, transaction_id, payment_received FROM cln_client_invoice WHERE id = ? LIMIT 1',
    [String(invoiceDbId)]
  );
  if (!inv) return { ok: false, reason: 'INVOICE_NOT_FOUND' };
  const acctInvoiceId = inv.transaction_id != null ? String(inv.transaction_id).trim() : '';
  if (!acctInvoiceId) return { ok: false, reason: 'NO_ACCOUNTING_INVOICE_ID' };

  const amount = Number(inv.amount || 0);
  const payDate = ymd(payload.paymentDate);
  const method = String(payload.paymentMethod || 'bank').toLowerCase() === 'cash' ? 'cash' : 'bank';

  if (provider === 'bukku') {
    const creds = await clnInt.getBukkuCredentials(operatorId);
    if (!creds?.token || !creds?.subdomain) return { ok: false, reason: 'BUKKU_NOT_CONNECTED' };
    const req = bukkuReq(operatorId, creds);
    const bukkuCid = await getBukkuContactId(inv.client_id);
    if (!bukkuCid) return { ok: false, reason: 'BUKKU_CONTACT_MISSING' };
    const bankAid = await resolveDepositAccountId(operatorId, method, 'bukku');
    if (!bankAid) {
      return { ok: false, reason: 'BUKKU_BANK_ACCOUNT_MAPPING_MISSING', detail: 'Map Bank/Cash in Accounting or set env' };
    }
    const payBody = {
      contact_id: Number(bukkuCid),
      date: payDate,
      currency_code: DEFAULT_CURRENCY,
      exchange_rate: 1,
      amount,
      link_items: [{ target_transaction_id: Number(acctInvoiceId), apply_amount: amount }],
      deposit_items: [{ account_id: Number(bankAid), amount }],
      status: 'ready'
    };
    const payRes = await bukkuPayment.createPayment(req, payBody);
    if (!payRes?.ok) return { ok: false, reason: formatProviderError(payRes?.error) || 'BUKKU_PAYMENT_FAILED' };
    const tx = payRes?.data?.transaction || payRes?.data;
    const paymentId = tx?.id != null ? String(tx.id) : null;
    const receiptUrl = tx?.short_link != null ? String(tx.short_link).trim() : null;
    await pool.query('DELETE FROM cln_client_payment WHERE invoice_id = ?', [String(invoiceDbId)]);
    const { randomUUID } = require('crypto');
    await pool.query(
      `INSERT INTO cln_client_payment (id, client_id, receipt_number, amount, payment_date, receipt_url, transaction_id, invoice_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [randomUUID(), inv.client_id, receiptUrl || null, amount, payDate, receiptUrl, paymentId, invoiceDbId]
    );
    return { ok: true, paymentId };
  }

  if (provider === 'xero') {
    const req = xeroReq(operatorId);
    const dest = await resolveDepositAccountId(operatorId, method, 'xero');
    let paymentAccountCode = dest ? await resolveXeroAccountCode(req, dest) : '';
    if (!paymentAccountCode) {
      paymentAccountCode = (process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '').trim();
    }
    if (!paymentAccountCode) return { ok: false, reason: 'XERO_PAYMENT_ACCOUNT_MISSING' };
    const payRes = await xeroPayment.createPayment(req, {
      Invoice: { InvoiceID: String(acctInvoiceId) },
      Account: { Code: paymentAccountCode },
      Date: payDate,
      Amount: amount,
      Reference: 'Operator invoice'
    });
    if (!payRes?.ok) return { ok: false, reason: formatProviderError(payRes?.error) || 'XERO_PAYMENT_FAILED' };
    const payment = payRes?.data?.Payments?.[0] ?? payRes?.Payments?.[0];
    const paymentId = payment?.PaymentID ?? payment?.PaymentId;
    await pool.query('DELETE FROM cln_client_payment WHERE invoice_id = ?', [String(invoiceDbId)]);
    const { randomUUID: ru } = require('crypto');
    await pool.query(
      `INSERT INTO cln_client_payment (id, client_id, amount, payment_date, transaction_id, invoice_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [ru(), inv.client_id, amount, payDate, paymentId ? String(paymentId) : null, invoiceDbId]
    );
    return { ok: true, paymentId };
  }

  return { ok: true, skipped: true };
}

async function voidPaymentAccountingForOperator(operatorId, invoiceDbId) {
  const provider = await getActiveProvider(operatorId);
  if (!provider || !['bukku', 'xero'].includes(provider)) return { ok: true, skipped: true };

  const [[pay]] = await pool.query(
    'SELECT transaction_id FROM cln_client_payment WHERE invoice_id = ? ORDER BY updated_at DESC LIMIT 1',
    [String(invoiceDbId)]
  );
  const paymentProvId = pay?.transaction_id != null ? String(pay.transaction_id).trim() : '';
  if (!paymentProvId) return { ok: true, skipped: true };

  if (provider === 'bukku') {
    const creds = await clnInt.getBukkuCredentials(operatorId);
    if (!creds?.token) return { ok: false, reason: 'BUKKU_NOT_CONNECTED' };
    const req = bukkuReq(operatorId, creds);
    await reverseBukkuPayment(req, paymentProvId);
    await pool.query('DELETE FROM cln_client_payment WHERE invoice_id = ?', [String(invoiceDbId)]);
    return { ok: true };
  }

  if (provider === 'xero') {
    const req = xeroReq(operatorId);
    const delRes = await xeroPayment.deletePayment(req, paymentProvId);
    if (!delRes?.ok) return { ok: false, reason: formatProviderError(delRes?.error) || 'XERO_VOID_PAYMENT_FAILED' };
    await pool.query('DELETE FROM cln_client_payment WHERE invoice_id = ?', [String(invoiceDbId)]);
    return { ok: true };
  }

  return { ok: true, skipped: true };
}

async function deleteInvoiceAccountingForOperator(operatorId, invoiceDbId) {
  const provider = await getActiveProvider(operatorId);
  if (!provider || !['bukku', 'xero'].includes(provider)) return { ok: true, skipped: true };

  const [[inv]] = await pool.query(
    'SELECT transaction_id, payment_received FROM cln_client_invoice WHERE id = ? LIMIT 1',
    [String(invoiceDbId)]
  );
  if (!inv) return { ok: false, reason: 'INVOICE_NOT_FOUND' };
  if (Number(inv.payment_received) === 1) return { ok: false, reason: 'PAID_INVOICE_USE_VOID_PAYMENT_FIRST' };

  const acctId = inv.transaction_id != null ? String(inv.transaction_id).trim() : '';
  if (!acctId) return { ok: true, skipped: true };

  if (provider === 'bukku') {
    const creds = await clnInt.getBukkuCredentials(operatorId);
    if (!creds?.token) return { ok: false, reason: 'BUKKU_NOT_CONNECTED' };
    const req = bukkuReq(operatorId, creds);
    await bukkuInvoice.updateinvoicestatus(req, acctId, { status: 'void', void_reason: 'Deleted from Cleanlemons' });
    return { ok: true };
  }

  if (provider === 'xero') {
    const req = xeroReq(operatorId);
    let voidRes = await xeroInvoice.update(req, acctId, { Status: 'VOIDED' });
    if (!voidRes?.ok) {
      const where = `Invoice.InvoiceID=guid("${acctId}")`;
      const listRes = await xeroPayment.listPayments(req, { where });
      const payments = Array.isArray(listRes?.data?.Payments) ? listRes.data.Payments : [];
      for (const p of payments) {
        const pid = p?.PaymentID ?? p?.PaymentId;
        if (pid) await xeroPayment.deletePayment(req, String(pid));
      }
      voidRes = await xeroInvoice.update(req, acctId, { Status: 'VOIDED' });
    }
    if (!voidRes?.ok) return { ok: false, reason: formatProviderError(voidRes?.error) || 'XERO_VOID_FAILED' };
    return { ok: true };
  }

  return { ok: true, skipped: true };
}

module.exports = {
  getActiveProvider,
  createAccountingInvoiceForOperator,
  markPaidAccountingForOperator,
  voidPaymentAccountingForOperator,
  deleteInvoiceAccountingForOperator
};
