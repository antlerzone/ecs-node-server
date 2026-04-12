/**
 * Payment Verification Service.
 * Receipt upload → OCR → payment_invoice (PENDING_VERIFICATION) → sync bank tx → matching → PAID or PENDING_REVIEW.
 */

const pool = require('../../config/db');
const crypto = require('crypto');
const { getTodayMalaysiaDate, getTodayPlusDaysMalaysia, malaysiaDateToUtcDatetimeForDb } = require('../../utils/dateMalaysia');
const { findBestMatch, getDecision, STATUS } = require('./matching.service');
const { extractReceiptWithAi } = require('./ai-router.service');
const finverse = require('../finverse');

function uuid() {
  return crypto.randomUUID();
}

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

/** Bank-tx window anchor: after resubmit, updated_at is newer than created_at. */
function matchingAnchorDate(invoice) {
  const c = invoice.created_at ? new Date(invoice.created_at).getTime() : 0;
  const u = invoice.updated_at ? new Date(invoice.updated_at).getTime() : 0;
  const ms = Math.max(c, u);
  return ms > 0 ? new Date(ms) : new Date();
}

async function emitEvent(paymentInvoiceId, eventType, payload = {}) {
  await pool.query(
    'INSERT INTO payment_verification_event (id, payment_invoice_id, event_type, payload_json) VALUES (?, ?, ?, ?)',
    [uuid(), paymentInvoiceId, eventType, JSON.stringify(payload)]
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseReferenceIdSet(ref) {
  const s = (ref || '').toString().trim();
  if (!s) return new Set();
  return new Set(s.split(',').map((x) => x.trim()).filter((id) => UUID_RE.test(id)));
}

function setsIntersect(a, b) {
  if (!a.size || !b.size) return false;
  for (const x of a) {
    if (b.has(x)) return true;
  }
  return false;
}

/**
 * Tenant PayNow (submit-paynow-receipt): reference_number = comma-separated rentalcollection ids,
 * external_invoice_id = tenancy_id. When verification is PAID, mark those rows paid (same idea as Stripe applyTenantInvoice).
 * Idempotent: only updates rows with ispaid = 0.
 * @param {{ accounting_method?: string, accounting_payment_date?: string, autoMatchDefaults?: boolean }} [opts]
 */
async function ensurePaynowTenantRentalsMarkedPaid(clientId, paymentInvoiceId, opts = {}) {
  const { createReceiptForPaidRentalCollection, resolveClientAccounting } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
  const [invRows] = await pool.query(
    'SELECT id, client_id, status, external_type, external_invoice_id, reference_number FROM payment_invoice WHERE id = ? AND client_id = ? LIMIT 1',
    [paymentInvoiceId, clientId]
  );
  if (!invRows.length) return { applied: 0, reason: 'not_found' };
  const inv = invRows[0];
  if (inv.status !== STATUS.PAID) return { applied: 0, reason: 'not_paid_yet' };
  if ((inv.external_type || '').toString() !== 'paynow_tenant') return { applied: 0, reason: 'not_paynow_tenant' };

  const ref = (inv.reference_number || '').toString().trim();
  const rawIds = ref.split(',').map((s) => s.trim()).filter(Boolean);
  const ids = rawIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return { applied: 0, reason: 'no_rental_ids' };

  const tenancyId = (inv.external_invoice_id || '').toString().trim();
  if (!tenancyId || !UUID_RE.test(tenancyId)) return { applied: 0, reason: 'bad_tenancy' };

  let accResolved = { ok: false };
  try {
    accResolved = await resolveClientAccounting(clientId);
  } catch (_) {
    accResolved = { ok: false };
  }

  let methodForReceipt = 'Bank';
  let paymentDateMalaysia = null;
  if (accResolved.ok) {
    if (opts.autoMatchDefaults) {
      methodForReceipt = 'Bank';
      paymentDateMalaysia = getTodayMalaysiaDate();
    } else {
      const rawM = (opts.accounting_method || opts.accountingMethod || 'Bank').toString();
      methodForReceipt = rawM.toLowerCase() === 'cash' ? 'Cash' : 'Bank';
      paymentDateMalaysia = (opts.accounting_payment_date || opts.accountingPaymentDate || '').toString().trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDateMalaysia)) {
        paymentDateMalaysia = getTodayMalaysiaDate();
      }
    }
  }

  let paidatDb = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (paymentDateMalaysia && /^\d{4}-\d{2}-\d{2}$/.test(paymentDateMalaysia)) {
    const converted = malaysiaDateToUtcDatetimeForDb(paymentDateMalaysia);
    if (converted) paidatDb = converted;
  }

  const referenceid = `PV-${inv.id}`.slice(0, 255);
  const placeholders = ids.map(() => '?').join(',');
  const sql = `UPDATE rentalcollection SET paidat = ?, referenceid = ?, ispaid = 1, updated_at = NOW()
     WHERE id IN (${placeholders}) AND ispaid = 0 AND client_id = ? AND tenancy_id = ?`;
  const params = [paidatDb, referenceid, ...ids, clientId, tenancyId];
  const [upd] = await pool.query(sql, params);
  const marked = upd.affectedRows || 0;

  if (marked > 0) {
    try {
      const receiptOpts = { source: 'manual', method: methodForReceipt };
      if (paymentDateMalaysia && /^\d{4}-\d{2}-\d{2}$/.test(paymentDateMalaysia)) {
        receiptOpts.paymentDateMalaysia = paymentDateMalaysia;
      }
      await createReceiptForPaidRentalCollection(ids, receiptOpts);
    } catch (e) {
      console.warn('[payment-verification] createReceiptForPaidRentalCollection (paynow_tenant)', e?.message || e);
    }
    await emitEvent(paymentInvoiceId, 'RENTALCOLLECTION_MARKED_PAID', {
      rentalcollection_ids: ids,
      marked,
      accounting_method: accResolved.ok ? methodForReceipt : undefined,
      payment_date_malaysia: paymentDateMalaysia || undefined
    });
  }
  return { applied: marked, ids };
}

/**
 * Create or update payment_invoice from uploaded receipt. Runs AI OCR and sets status PENDING_VERIFICATION.
 * @param {string} clientId
 * @param {{ receipt_url: string, external_invoice_id?: string, external_type?: string, amount?: number, currency?: string, reference_number?: string }} payload
 */
async function createInvoiceFromReceipt(clientId, payload) {
  const receiptUrl = payload.receipt_url;
  if (!receiptUrl) throw new Error('receipt_url required');

  const ocrResult = await extractReceiptWithAi(clientId, receiptUrl);
  const amount = payload.amount != null ? Number(payload.amount) : (ocrResult.amount != null ? Number(ocrResult.amount) : null);
  const currency = (payload.currency || ocrResult.currency || '').toString().trim().toUpperCase();
  if (!currency) throw new Error('CLIENT_CURRENCY_MISSING');
  if (!['MYR', 'SGD'].includes(currency)) throw new Error('UNSUPPORTED_CLIENT_CURRENCY');
  const reference_number = (payload.reference_number || ocrResult.reference_number || '').toString().trim() || null;

  if (amount == null || Number.isNaN(amount)) throw new Error('amount required (from payload or OCR)');

  const receiptId = uuid();
  await pool.query(
    'INSERT INTO payment_receipt (id, client_id, receipt_url, ocr_result_json) VALUES (?, ?, ?, ?)',
    [receiptId, clientId, receiptUrl, JSON.stringify(ocrResult)]
  );

  const invoiceId = uuid();
  await pool.query(
    `INSERT INTO payment_invoice (id, client_id, external_invoice_id, external_type, amount, currency, reference_number, status, receipt_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invoiceId,
      clientId,
      payload.external_invoice_id || null,
      payload.external_type || 'manual',
      amount,
      currency,
      reference_number,
      STATUS.PENDING_VERIFICATION,
      receiptId
    ]
  );
  await pool.query('UPDATE payment_receipt SET payment_invoice_id = ? WHERE id = ?', [invoiceId, receiptId]);
  await emitEvent(invoiceId, 'CREATED', { receipt_url: receiptUrl, ocr_result: ocrResult });

  return { id: invoiceId, receipt_id: receiptId, status: STATUS.PENDING_VERIFICATION, ocr_result: ocrResult, updated: false };
}

/**
 * Tenant PayNow:
 * - New submission disjoint from all open tickets (by rentalcollection id in reference_number) → INSERT (multiple open tickets allowed).
 * - Submission overlaps any open ticket (shared invoice id) → UPDATE only the earliest overlapping ticket; other overlapping opens are SUPERSEDED (REJECTED).
 * - No invoice ids on payload: legacy — update single most-recent open ticket if any, else INSERT.
 * - PAID/REJECTED rows are not "open"; new pay cycle creates a new row.
 */
async function upsertPaynowTenantReceipt(clientId, payload) {
  const receiptUrl = payload.receipt_url;
  if (!receiptUrl) throw new Error('receipt_url required');
  const tenancyId = (payload.external_invoice_id || '').toString().trim();
  if (!tenancyId) throw new Error('TENANCY_ID_REQUIRED');

  const [openRows] = await pool.query(
    `SELECT pi.id, pi.receipt_id, pi.reference_number, pi.created_at, pi.updated_at
     FROM payment_invoice pi
     WHERE pi.client_id = ? AND pi.external_type = 'paynow_tenant' AND pi.external_invoice_id = ?
       AND pi.status IN (?, ?)
     ORDER BY pi.created_at ASC`,
    [clientId, tenancyId, STATUS.PENDING_VERIFICATION, STATUS.PENDING_REVIEW]
  );
  const opens = openRows || [];

  const ocrResult = await extractReceiptWithAi(clientId, receiptUrl);
  const amount = payload.amount != null ? Number(payload.amount) : (ocrResult.amount != null ? Number(ocrResult.amount) : null);
  const currency = (payload.currency || ocrResult.currency || '').toString().trim().toUpperCase();
  if (!currency) throw new Error('CLIENT_CURRENCY_MISSING');
  if (!['MYR', 'SGD'].includes(currency)) throw new Error('UNSUPPORTED_CLIENT_CURRENCY');
  const reference_number = (payload.reference_number || ocrResult.reference_number || '').toString().trim() || null;

  if (amount == null || Number.isNaN(amount)) throw new Error('amount required (from payload or OCR)');

  const newSet = parseReferenceIdSet(reference_number);

  /** Refresh one existing ticket (same receipt row, new OCR + fields). */
  async function refreshTicket(invoiceId, receiptId) {
    if (!receiptId) throw new Error('RECEIPT_ID_MISSING');
    await pool.query(
      'UPDATE payment_receipt SET receipt_url = ?, ocr_result_json = ? WHERE id = ? AND client_id = ?',
      [receiptUrl, JSON.stringify(ocrResult), receiptId, clientId]
    );
    await pool.query(
      `UPDATE payment_invoice SET amount = ?, currency = ?, reference_number = ?, status = ?, matched_bank_transaction_id = NULL, updated_at = NOW() WHERE id = ? AND client_id = ?`,
      [amount, currency, reference_number, STATUS.PENDING_VERIFICATION, invoiceId, clientId]
    );
    await pool.query(
      'UPDATE bank_transactions SET matched_invoice_id = NULL, updated_at = NOW() WHERE client_id = ? AND matched_invoice_id = ?',
      [clientId, invoiceId]
    );
    await emitEvent(invoiceId, 'RECEIPT_RESUBMITTED', {
      receipt_url: receiptUrl,
      reference_number,
      ocr_result: ocrResult
    });
  }

  async function supersedeOtherOverlapping(keepInvoiceId, overlappingTickets) {
    for (const t of overlappingTickets) {
      if (t.id === keepInvoiceId) continue;
      await pool.query(
        'UPDATE bank_transactions SET matched_invoice_id = NULL, updated_at = NOW() WHERE client_id = ? AND matched_invoice_id = ?',
        [clientId, t.id]
      );
      await pool.query(
        'UPDATE payment_invoice SET status = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
        [STATUS.REJECTED, t.id, clientId]
      );
      await emitEvent(t.id, 'SUPERSEDED_BY_OVERLAPPING_RESUBMIT', {
        kept_invoice_id: keepInvoiceId,
        new_reference_number: reference_number
      });
    }
  }

  if (newSet.size === 0) {
    if (opens.length === 0) {
      return createInvoiceFromReceipt(clientId, {
        ...payload,
        external_type: 'paynow_tenant',
        external_invoice_id: tenancyId
      });
    }
    const [one] = await pool.query(
      `SELECT pi.id, pi.receipt_id FROM payment_invoice pi
       WHERE pi.client_id = ? AND pi.external_type = 'paynow_tenant' AND pi.external_invoice_id = ?
         AND pi.status IN (?, ?)
       ORDER BY pi.updated_at DESC
       LIMIT 1`,
      [clientId, tenancyId, STATUS.PENDING_VERIFICATION, STATUS.PENDING_REVIEW]
    );
    if (!one.length) {
      return createInvoiceFromReceipt(clientId, {
        ...payload,
        external_type: 'paynow_tenant',
        external_invoice_id: tenancyId
      });
    }
    const { id: invoiceId, receipt_id: receiptId } = one[0];
    await refreshTicket(invoiceId, receiptId);
    return {
      id: invoiceId,
      receipt_id: receiptId,
      status: STATUS.PENDING_VERIFICATION,
      ocr_result: ocrResult,
      updated: true,
      superseded_other: 0
    };
  }

  const overlapping = opens.filter((t) => setsIntersect(parseReferenceIdSet(t.reference_number), newSet));

  if (overlapping.length === 0) {
    return createInvoiceFromReceipt(clientId, {
      ...payload,
      external_type: 'paynow_tenant',
      external_invoice_id: tenancyId
    });
  }

  const primary = overlapping[0];
  const { id: invoiceId, receipt_id: receiptId } = primary;
  await refreshTicket(invoiceId, receiptId);
  const extraOverlapping = overlapping.slice(1);
  if (extraOverlapping.length > 0) {
    await supersedeOtherOverlapping(invoiceId, extraOverlapping);
  }

  return {
    id: invoiceId,
    receipt_id: receiptId,
    status: STATUS.PENDING_VERIFICATION,
    ocr_result: ocrResult,
    updated: true,
    superseded_other: extraOverlapping.length
  };
}

/**
 * Run matching for one invoice; update status and matched_bank_transaction_id if auto PAID.
 */
async function runMatchingForInvoice(clientId, invoiceId) {
  const [invRows] = await pool.query(
    'SELECT pi.*, pr.ocr_result_json FROM payment_invoice pi LEFT JOIN payment_receipt pr ON pi.receipt_id = pr.id WHERE pi.id = ? AND pi.client_id = ?',
    [invoiceId, clientId]
  );
  if (!invRows.length) throw new Error('INVOICE_NOT_FOUND');
  const invoice = invRows[0];
  if (invoice.status !== STATUS.PENDING_VERIFICATION && invoice.status !== STATUS.PENDING_REVIEW) {
    return { status: invoice.status, matched: false };
  }

  const anchor = matchingAnchorDate(invoice);
  const [txRows] = await pool.query(
    'SELECT * FROM bank_transactions WHERE client_id = ? AND transaction_date >= DATE_SUB(?, INTERVAL 3 DAY) AND transaction_date <= DATE_ADD(?, INTERVAL 3 DAY) ORDER BY transaction_date DESC',
    [clientId, anchor, anchor]
  );
  const invoiceWithOcr = { ...invoice, ocr_result_json: parseJson(invoice.ocr_result_json) };
  const best = findBestMatch(invoiceWithOcr, txRows);
  if (!best) {
    return { status: invoice.status, matched: false, candidates: [] };
  }

  const decision = getDecision(best.confidence);
  if (decision.status === STATUS.PAID && decision.auto) {
    await pool.query(
      'UPDATE payment_invoice SET status = ?, matched_bank_transaction_id = ?, updated_at = NOW() WHERE id = ?',
      [STATUS.PAID, best.tx.id, invoiceId]
    );
    await pool.query('UPDATE bank_transactions SET matched_invoice_id = ?, updated_at = NOW() WHERE id = ?', [invoiceId, best.tx.id]);
    await emitEvent(invoiceId, 'AUTO_MATCHED', { bank_transaction_id: best.tx.id, confidence: best.confidence });
    let rentalsMarked = { applied: 0 };
    try {
      rentalsMarked = await ensurePaynowTenantRentalsMarkedPaid(clientId, invoiceId, { autoMatchDefaults: true });
    } catch (e) {
      console.warn('[payment-verification] ensurePaynowTenantRentalsMarkedPaid (auto)', e?.message || e);
    }
    return {
      status: STATUS.PAID,
      matched: true,
      confidence: best.confidence,
      bank_transaction_id: best.tx.id,
      rentals_marked: rentalsMarked.applied
    };
  }
  if (decision.status === STATUS.PENDING_REVIEW) {
    await pool.query('UPDATE payment_invoice SET status = ? WHERE id = ?', [STATUS.PENDING_REVIEW, invoiceId]);
    await emitEvent(invoiceId, 'PENDING_REVIEW', { bank_transaction_id: best.tx.id, confidence: best.confidence });
  }
  return { status: decision.status, matched: false, confidence: best.confidence, candidate: best.tx };
}

/**
 * Sync bank transactions from Finverse for client. Uses login identity token from client_integration (finverse).
 */
async function syncBankTransactionsFromFinverse(clientId, options = {}) {
  const fromDate = options.from_date || getTodayPlusDaysMalaysia(-30);
  const toDate = options.to_date || getTodayMalaysiaDate();

  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'bankData' AND provider = 'finverse' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  const loginToken = rows[0] && parseJson(rows[0].values_json) && parseJson(rows[0].values_json).finverse_login_identity_token;
  if (!loginToken) throw new Error('FINVERSE_NOT_LINKED');

  const { transactions } = await finverse.bankData.listTransactions(loginToken, { from_date: fromDate, to_date: toDate, limit: 500 });
  let inserted = 0;
  for (const t of transactions || []) {
    const extId = t.id || t.transaction_id || t.reference;
    if (!extId) continue;
    const amount = Number(t.amount ?? t.value ?? 0);
    const currency = t.currency != null ? String(t.currency).trim().toUpperCase() : '';
    const reference = (t.reference || t.description || t.remittance_information || '').toString().slice(0, 500);
    const description = (t.description || t.narrative || '').toString().slice(0, 2000) || null;
    const payer_name = (t.counterparty_name || t.payer_name || t.name || '').toString().slice(0, 255) || null;
    const transaction_date = t.date ? (t.date.slice ? t.date.slice(0, 10) : new Date(t.date).toISOString().slice(0, 10)) : null;
    const bank_account_id = (t.account_id || t.bank_account_id || '').toString() || null;

    try {
      await pool.query(
        `INSERT INTO bank_transactions (id, client_id, finverse_transaction_id, bank_account_id, amount, currency, reference, description, payer_name, transaction_date, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), clientId, extId, bank_account_id, amount, currency, reference, description, payer_name, transaction_date, JSON.stringify(t)]
      );
      inserted++;
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  return { synced: (transactions || []).length, inserted };
}

/**
 * List payment invoices for client (filter by status optional).
 */
async function listInvoices(clientId, filters = {}) {
  let sql = 'SELECT pi.*, pr.receipt_url, pr.ocr_result_json FROM payment_invoice pi LEFT JOIN payment_receipt pr ON pi.receipt_id = pr.id WHERE pi.client_id = ?';
  const params = [clientId];
  if (filters.status) {
    sql += ' AND pi.status = ?';
    params.push(filters.status);
  }
  sql += ' ORDER BY pi.created_at DESC LIMIT 100';
  const [rows] = await pool.query(sql, params);
  return rows.map(r => ({
    ...r,
    ocr_result_json: parseJson(r.ocr_result_json)
  }));
}

/**
 * Get one invoice with receipt and candidate bank transactions for manual review.
 */
async function getInvoiceWithCandidates(clientId, invoiceId) {
  const [invRows] = await pool.query(
    'SELECT pi.*, pr.receipt_url, pr.ocr_result_json FROM payment_invoice pi LEFT JOIN payment_receipt pr ON pi.receipt_id = pr.id WHERE pi.id = ? AND pi.client_id = ?',
    [invoiceId, clientId]
  );
  if (!invRows.length) return null;
  const invoice = invRows[0];
  const anchor = matchingAnchorDate(invoice);
  const [txRows] = await pool.query(
    'SELECT * FROM bank_transactions WHERE client_id = ? AND (transaction_date >= DATE_SUB(?, INTERVAL 7 DAY) AND transaction_date <= DATE_ADD(?, INTERVAL 1 DAY)) ORDER BY transaction_date DESC',
    [clientId, anchor, anchor]
  );
  const [eventRows] = await pool.query('SELECT * FROM payment_verification_event WHERE payment_invoice_id = ? ORDER BY created_at DESC LIMIT 20', [invoiceId]);
  return {
    ...invoice,
    ocr_result_json: parseJson(invoice.ocr_result_json),
    candidate_transactions: txRows,
    events: eventRows
  };
}

/**
 * Manual approve: set invoice PAID and link bank_transaction_id if provided.
 * For paynow_tenant receipts, also marks rentalcollection rows listed in reference_number as paid.
 * If client has accounting (Bukku/Xero) and rental ids are present, payload must include accounting_method (bank|cash) and accounting_payment_date (YYYY-MM-DD).
 */
async function approve(clientId, invoiceId, payload = {}) {
  const [invRows] = await pool.query(
    'SELECT id, status, external_type, reference_number FROM payment_invoice WHERE id = ? AND client_id = ?',
    [invoiceId, clientId]
  );
  if (!invRows.length) throw new Error('INVOICE_NOT_FOUND');
  const inv = invRows[0];

  const ref = (inv.reference_number || '').toString().trim();
  const rentalIds = ref.split(',').map((s) => s.trim()).filter((id) => UUID_RE.test(id));
  if ((inv.external_type || '').toString() === 'paynow_tenant' && rentalIds.length > 0) {
    const { resolveClientAccounting } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
    let acc = { ok: false };
    try {
      acc = await resolveClientAccounting(clientId);
    } catch (_) {
      acc = { ok: false };
    }
    if (acc.ok) {
      const m = (payload.accounting_method || payload.accountingMethod || '').toString().trim().toLowerCase();
      const d = (payload.accounting_payment_date || payload.accountingPaymentDate || '').toString().trim();
      if (m !== 'bank' && m !== 'cash') {
        throw new Error('ACCOUNTING_METHOD_REQUIRED');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        throw new Error('ACCOUNTING_PAYMENT_DATE_REQUIRED');
      }
    }
  }

  const bankTransactionId = payload.bank_transaction_id || null;
  if (inv.status !== STATUS.PAID) {
    await pool.query(
      'UPDATE payment_invoice SET status = ?, matched_bank_transaction_id = COALESCE(?, matched_bank_transaction_id), updated_at = NOW() WHERE id = ?',
      [STATUS.PAID, bankTransactionId, invoiceId]
    );
    if (bankTransactionId) {
      await pool.query('UPDATE bank_transactions SET matched_invoice_id = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [invoiceId, bankTransactionId, clientId]);
    }
    await emitEvent(invoiceId, 'MANUAL_APPROVED', {
      bank_transaction_id: bankTransactionId,
      accounting_method: payload.accounting_method || payload.accountingMethod,
      accounting_payment_date: payload.accounting_payment_date || payload.accountingPaymentDate
    });
  }

  let rentalsMarked = { applied: 0 };
  try {
    rentalsMarked = await ensurePaynowTenantRentalsMarkedPaid(clientId, invoiceId, {
      accounting_method: payload.accounting_method || payload.accountingMethod,
      accounting_payment_date: payload.accounting_payment_date || payload.accountingPaymentDate
    });
  } catch (e) {
    console.warn('[payment-verification] ensurePaynowTenantRentalsMarkedPaid (manual)', e?.message || e);
  }
  return { status: STATUS.PAID, rentals_marked: rentalsMarked.applied };
}

/**
 * Manual reject: set invoice REJECTED.
 */
async function reject(clientId, invoiceId) {
  const [rows] = await pool.query('SELECT id, status FROM payment_invoice WHERE id = ? AND client_id = ?', [invoiceId, clientId]);
  if (!rows.length) throw new Error('INVOICE_NOT_FOUND');
  await pool.query('UPDATE payment_invoice SET status = ?, updated_at = NOW() WHERE id = ?', [STATUS.REJECTED, invoiceId]);
  await emitEvent(invoiceId, 'REJECTED', {});
  return { status: STATUS.REJECTED };
}

module.exports = {
  createInvoiceFromReceipt,
  upsertPaynowTenantReceipt,
  runMatchingForInvoice,
  syncBankTransactionsFromFinverse,
  listInvoices,
  getInvoiceWithCandidates,
  approve,
  reject,
  STATUS
};
