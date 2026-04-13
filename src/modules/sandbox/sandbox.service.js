/**
 * Sandbox / backfill: RentalCollection isPaid=1 but receipturl empty.
 * Reads receipt short_link from Bukku (GET invoice / sales payments only). Does not create payments.
 * If no URL: console + API item carry invoiceNumber (IV-… / doc no. / bukku_id:…).
 */

const pool = require('../../config/db');
const { resolveClientAccounting } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const bukkuInvoice = require('../bukku/wrappers/invoice.wrapper');
const bukkuPayment = require('../bukku/wrappers/payment.wrapper');

/**
 * Find RentalCollection rows: client_id, ispaid=1, (receipturl IS NULL or ''), invoiceid present. Optionally paidat present.
 * @param {string} clientId
 * @returns {Promise<Array<{ id, client_id, invoiceid, bukku_invoice_id, amount, paidat, referenceid, property_id, tenant_id, type_id }>>}
 */
async function findPaidWithoutReceiptUrl(clientId) {
  const [rows] = await pool.query(
    `SELECT id, client_id, invoiceid, bukku_invoice_id, accounting_document_number, amount, paidat, referenceid, property_id, tenant_id, type_id
     FROM rentalcollection
     WHERE client_id = ? AND ispaid = 1
       AND (receipturl IS NULL OR TRIM(COALESCE(receipturl,'')) = '')
       AND (
         (invoiceid IS NOT NULL AND TRIM(COALESCE(invoiceid,'')) != '')
         OR (bukku_invoice_id IS NOT NULL AND TRIM(COALESCE(bukku_invoice_id,'')) != '')
       )`,
    [clientId]
  );
  return rows || [];
}

/** Bukku GET /sales/invoices/:id expects numeric transaction id; Wix invoiceid is often IV-xxxxx — prefer bukku_invoice_id. */
function resolveBukkuSalesTransactionId(row) {
  const b =
    row.bukku_invoice_id != null && String(row.bukku_invoice_id).trim() !== ''
      ? String(row.bukku_invoice_id).trim()
      : '';
  if (b) return b;
  const inv = String(row.invoiceid || '').trim();
  if (!inv) return '';
  if (/^\d+$/.test(inv)) return inv;
  return inv;
}

/** Unwrap Bukku GET /sales/invoices/:id body (may nest under data). */
function unwrapInvoiceReadBody(data) {
  if (!data || typeof data !== 'object') return null;
  const merged =
    data.data != null && typeof data.data === 'object' && !Array.isArray(data.data)
      ? { ...data, ...data.data }
      : data;
  return merged;
}

/** Payment/receipt transaction ids nested in GET invoice body (already-paid invoices). */
function extractSalesPaymentIdsFromInvoiceRead(data) {
  const root = unwrapInvoiceReadBody(data);
  if (!root || typeof root !== 'object') return [];
  const ids = [];
  const add = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) ids.push(n);
  };
  const payments = root.payments ?? root.payment;
  if (Array.isArray(payments)) {
    for (const p of payments) {
      if (!p || typeof p !== 'object') continue;
      add(p.id ?? p.transaction_id);
      if (p.transaction && typeof p.transaction === 'object') add(p.transaction.id);
    }
  } else if (payments && typeof payments === 'object') {
    add(payments.id ?? payments.transaction_id);
    if (payments.transaction && typeof payments.transaction === 'object') add(payments.transaction.id);
  }
  return ids;
}

/** Receipt short_link may be on transaction, payments[], or legacy keys. */
function extractShortLinkFromInvoiceRead(data) {
  const root = unwrapInvoiceReadBody(data);
  if (!root || typeof root !== 'object') return null;
  const tx =
    root.transaction != null && typeof root.transaction === 'object'
      ? root.transaction
      : root.invoice != null && typeof root.invoice === 'object'
        ? root.invoice
        : root;
  const trySl = (o) => {
    if (!o || typeof o !== 'object') return null;
    const s = o.short_link ?? o.short_link_url;
    return s != null && String(s).trim() !== '' ? String(s).trim() : null;
  };
  const fromTx = trySl(tx);
  if (fromTx) return fromTx;
  const fromRoot = trySl(root);
  if (fromRoot) return fromRoot;
  const payments = root.payments ?? root.payment;
  if (Array.isArray(payments)) {
    for (const p of payments) {
      const sl = trySl(p);
      if (sl) return sl;
    }
  } else if (payments && typeof payments === 'object') {
    const sl = trySl(payments);
    if (sl) return sl;
  }
  return null;
}

/** Human-readable invoice doc number for logs when receipt URL is missing. */
function displayInvoiceNumber(row, readData) {
  if (readData) {
    const root = unwrapInvoiceReadBody(readData);
    if (root && typeof root === 'object') {
      const tx =
        root.transaction != null && typeof root.transaction === 'object'
          ? root.transaction
          : root.invoice != null && typeof root.invoice === 'object'
            ? root.invoice
            : root;
      const num = tx?.number ?? tx?.document_number ?? root.number;
      if (num != null && String(num).trim() !== '') return String(num).trim();
    }
  }
  const inv = row.invoiceid != null && String(row.invoiceid).trim() !== '' ? String(row.invoiceid).trim() : '';
  if (inv) return inv;
  const doc =
    row.accounting_document_number != null && String(row.accounting_document_number).trim() !== ''
      ? String(row.accounting_document_number).trim()
      : '';
  if (doc) return doc;
  const bid = row.bukku_invoice_id != null && String(row.bukku_invoice_id).trim() !== '' ? String(row.bukku_invoice_id).trim() : '';
  if (bid) return `bukku_id:${bid}`;
  return '—';
}

/**
 * Get receipt short_link from Bukku (read-only): GET invoice + GET linked sales payments.
 * @returns {Promise<{ ok: boolean, shortLink?: string, reason?: string, detail?: string, invoiceNumber?: string }>}
 */
async function getReceiptLinkFromBukku(req, row) {
  const invoiceId = resolveBukkuSalesTransactionId(row);
  if (!invoiceId) {
    return { ok: false, reason: 'NO_BUKKU_OR_INVOICE_ID', invoiceNumber: displayInvoiceNumber(row, null) };
  }

  const readRes = await bukkuInvoice.readinvoice(req, invoiceId);
  if (!readRes.ok) {
    const st = readRes.status;
    const detail =
      readRes.error && typeof readRes.error === 'object'
        ? JSON.stringify(readRes.error).slice(0, 400)
        : String(readRes.error || '');
    const invNo = displayInvoiceNumber(row, null);
    if (st === 404) {
      return { ok: false, reason: 'BUKKU_INVOICE_NOT_FOUND', detail, invoiceNumber: invNo };
    }
    return { ok: false, reason: `BUKKU_GET_INVOICE_${st || 'FAIL'}`, detail, invoiceNumber: invNo };
  }
  if (readRes.data) {
    const fromRead = extractShortLinkFromInvoiceRead(readRes.data);
    if (fromRead) {
      return { ok: true, shortLink: fromRead };
    }
    for (const pid of extractSalesPaymentIdsFromInvoiceRead(readRes.data)) {
      const payRes = await bukkuPayment.getPayment(req, String(pid));
      if (payRes.ok && payRes.data) {
        const fromPay = extractShortLinkFromInvoiceRead(payRes.data);
        if (fromPay) return { ok: true, shortLink: fromPay };
      }
    }
  }

  const invNo = displayInvoiceNumber(row, readRes.data);
  return { ok: false, reason: 'NO_RECEIPT_URL', invoiceNumber: invNo };
}

/**
 * Backfill receipturl for all RentalCollection where isPaid=1 and receipturl is empty.
 * @param {string} clientId
 * @returns {Promise<{ ok: boolean, total: number, success: number, failed: number, items: Array<{ id: string, status: 'ok'|'fail', receipturl?: string, reason?: string }> }>}
 */
async function backfillReceiptUrl(clientId) {
  const items = [];
  let success = 0;
  let failed = 0;

  const [noIds] = await pool.query(
    `SELECT id, invoiceid, bukku_invoice_id, amount, referenceid
     FROM rentalcollection
     WHERE client_id = ? AND ispaid = 1
       AND (receipturl IS NULL OR TRIM(COALESCE(receipturl,'')) = '')
       AND (invoiceid IS NULL OR TRIM(COALESCE(invoiceid,'')) = '')
       AND (bukku_invoice_id IS NULL OR TRIM(COALESCE(bukku_invoice_id,'')) = '')`,
    [clientId]
  );
  for (const r of noIds || []) {
    console.warn('[backfillReceiptUrl] skip (no invoice / bukku id):', {
      id: r.id,
      invoiceid: r.invoiceid,
      bukku_invoice_id: r.bukku_invoice_id,
      amount: r.amount,
      referenceid: r.referenceid
    });
  }

  const rows = await findPaidWithoutReceiptUrl(clientId);
  const total = rows.length;
  if (total === 0) {
    return { ok: true, total: 0, success: 0, failed: 0, items: [], skippedNoInvoiceKeys: (noIds || []).length };
  }

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) {
    const reason = resolved.reason || 'NO_ACCOUNTING';
    for (const r of rows) {
      console.warn('[backfillReceiptUrl] fail (accounting):', { id: r.id, reason });
    }
    return {
      ok: false,
      total,
      success: 0,
      failed: total,
      items: rows.map((r) => ({ id: r.id, status: 'fail', reason })),
      skippedNoInvoiceKeys: (noIds || []).length
    };
  }
  const { provider, req } = resolved;
  if (provider !== 'bukku') {
    const reason = `Unsupported provider: ${provider}`;
    for (const r of rows) {
      console.warn('[backfillReceiptUrl] fail (provider):', { id: r.id, reason });
    }
    return {
      ok: false,
      total,
      success: 0,
      failed: total,
      items: rows.map((r) => ({ id: r.id, status: 'fail', reason })),
      skippedNoInvoiceKeys: (noIds || []).length
    };
  }

  for (const row of rows) {
    try {
      const linkRes = await getReceiptLinkFromBukku(req, row);
      if (!linkRes.ok) {
        failed++;
        const entry = {
          id: row.id,
          status: 'fail',
          reason: linkRes.reason,
          invoiceNumber: linkRes.invoiceNumber
        };
        items.push(entry);
        console.warn(
          `[backfillReceiptUrl] no receipt URL — invoice ${linkRes.invoiceNumber || '—'} (${linkRes.reason})`,
          { id: row.id, detail: linkRes.detail, bukku_tx_id: resolveBukkuSalesTransactionId(row) }
        );
        continue;
      }
      await pool.query(
        'UPDATE rentalcollection SET receipturl = ? WHERE id = ?',
        [linkRes.shortLink, row.id]
      );
      success++;
      items.push({ id: row.id, status: 'ok', receipturl: linkRes.shortLink });
    } catch (err) {
      failed++;
      const entry = { id: row.id, status: 'fail', reason: err?.message || 'exception' };
      items.push(entry);
      console.warn('[backfillReceiptUrl] exception:', entry, err);
    }
  }

  return { ok: true, total, success, failed, items, skippedNoInvoiceKeys: (noIds || []).length };
}

module.exports = {
  findPaidWithoutReceiptUrl,
  backfillReceiptUrl
};
