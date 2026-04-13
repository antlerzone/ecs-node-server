/**
 * Payment Matching Engine.
 * Matches payment_invoice (OCR from receipt) with bank_transactions.
 * Priority: transaction_id -> reference contains invoice number -> amount -> date ±24h -> payer name.
 * confidence > 90% => auto PAID; 60–90% => PENDING_REVIEW; < 60% => ignore.
 *
 * PayNow (paynow_tenant / paynow_meter): same UTC+8 calendar day + exact amount on unmatched bank rows
 * → auto when unique; multiple same amount → manual review.
 */

const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');

const STATUS = Object.freeze({
  UNPAID: 'UNPAID',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  PENDING_REVIEW: 'PENDING_REVIEW',
  PAID: 'PAID',
  REJECTED: 'REJECTED'
});

const CONFIDENCE_AUTO_PAID = 90;
const CONFIDENCE_MANUAL_REVIEW = 60;

/**
 * Normalize string for comparison (trim, lower).
 */
function norm(s) {
  if (s == null) return '';
  return String(s).trim().toLowerCase();
}

/**
 * Check if reference contains invoice number (e.g. INV-10234 in "Payment INV-10234").
 */
function referenceContainsInvoice(reference, invoiceRef) {
  if (!reference || !invoiceRef) return false;
  const r = norm(reference);
  const inv = norm(invoiceRef);
  return inv.length > 0 && r.includes(inv);
}

/**
 * Payer name similarity: simple contains or normalized equality. Can be replaced with fuzzy match.
 */
function payerSimilarity(payerBank, payerReceipt) {
  const a = norm(payerBank);
  const b = norm(payerReceipt);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 85;
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
  const overlap = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb))).length;
  if (wordsB.length === 0) return 0;
  return Math.round((overlap / Math.max(wordsA.length, wordsB.length)) * 80);
}

/**
 * Date within ±24 hours.
 */
function dateWithin24h(d1, d2) {
  if (!d1 || !d2) return false;
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  const diff = Math.abs(t1 - t2);
  return diff <= 24 * 60 * 60 * 1000;
}

/**
 * Compute confidence score (0–100) for a single (invoice, bankTx) pair.
 * @param {object} invoice - { amount, currency, reference_number, transaction_id?, payer_name?, transaction_date? } (from OCR)
 * @param {object} tx - bank_transaction row: amount, currency, reference, payer_name, transaction_date, raw_json (may have id/transaction_id)
 */
function computeConfidence(invoice, tx) {
  let score = 0;
  const txId = (tx.raw_json && tx.raw_json.id) || tx.finverse_transaction_id || tx.reference;
  const invTxId = invoice.transaction_id || invoice.reference_number;

  if (invTxId && txId && norm(invTxId) === norm(txId)) {
    score += 50;
  }
  if (referenceContainsInvoice(tx.reference, invoice.reference_number)) {
    score += 30;
  }
  const amountMatch = Number(tx.amount) === Number(invoice.amount);
  if (amountMatch) score += 25; else if (Math.abs(Number(tx.amount) - Number(invoice.amount)) < 0.01) score += 20;

  if (dateWithin24h(tx.transaction_date, invoice.transaction_date)) {
    score += 15;
  }
  const payerScore = payerSimilarity(tx.payer_name, invoice.payer_name);
  if (payerScore >= 80) score += 15;
  else if (payerScore >= 50) score += 8;

  return Math.min(100, score);
}

/**
 * @param {object} invoice - row with amount, currency, external_type
 * @param {Array} unmatched - bank_transactions
 * @returns {{ tx: object, confidence: number } | null}
 */
function pickPaynowSameDayAmountMatch(invoice, unmatched) {
  const ext = norm(invoice.external_type || '');
  if (ext !== 'paynow_tenant' && ext !== 'paynow_meter') return null;
  const today = getTodayMalaysiaDate();
  const invAmt = Number(invoice.amount);
  if (!Number.isFinite(invAmt) || invAmt <= 0) return null;
  const currency = norm(invoice.currency);
  const pool = (unmatched || []).filter((t) => {
    if (t.matched_invoice_id) return false;
    if (t.currency && currency && norm(t.currency) !== currency) return false;
    const td = t.transaction_date ? String(t.transaction_date).slice(0, 10) : '';
    if (td !== today) return false;
    const ta = Number(t.amount);
    if (Math.abs(ta - invAmt) < 0.02) return true;
    if (ta < 0 && Math.abs(Math.abs(ta) - invAmt) < 0.02) return true;
    return false;
  });
  if (pool.length === 0) return null;
  if (pool.length === 1) return { tx: pool[0], confidence: 95 };
  pool.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return { tx: pool[0], confidence: 72 };
}

/**
 * Find best matching bank transaction for an invoice and return { tx, confidence } or null.
 * Only considers transactions not already matched (matched_invoice_id IS NULL).
 * @param {object} invoice - payment_invoice + ocr_result (receipt OCR)
 * @param {Array} transactions - list of bank_transaction rows (unmatched)
 */
function findBestMatch(invoice, transactions) {
  const ocr = invoice.ocr_result_json || {};
  const payload = {
    amount: invoice.amount,
    currency: invoice.currency,
    reference_number: invoice.reference_number || ocr.reference_number,
    transaction_id: ocr.transaction_id,
    payer_name: ocr.payer_name,
    transaction_date: ocr.transaction_date || invoice.created_at
  };
  const unmatched = (transactions || []).filter(t => !t.matched_invoice_id);
  const paynowPick = pickPaynowSameDayAmountMatch(invoice, unmatched);
  let best = paynowPick;
  let bestScore = paynowPick ? paynowPick.confidence : 0;
  for (const tx of unmatched) {
    if (tx.currency && invoice.currency && norm(tx.currency) !== norm(invoice.currency)) continue;
    const confidence = computeConfidence(payload, tx);
    if (confidence >= CONFIDENCE_MANUAL_REVIEW && confidence > bestScore) {
      bestScore = confidence;
      best = { tx, confidence };
    }
  }
  return best;
}

/**
 * Decision: auto PAID, PENDING_REVIEW, or leave PENDING_VERIFICATION.
 */
function getDecision(confidence) {
  if (confidence >= CONFIDENCE_AUTO_PAID) return { status: STATUS.PAID, auto: true };
  if (confidence >= CONFIDENCE_MANUAL_REVIEW) return { status: STATUS.PENDING_REVIEW, auto: false };
  return { status: STATUS.PENDING_VERIFICATION, auto: false };
}

module.exports = {
  STATUS,
  CONFIDENCE_AUTO_PAID,
  CONFIDENCE_MANUAL_REVIEW,
  computeConfidence,
  pickPaynowSameDayAmountMatch,
  findBestMatch,
  getDecision
};
