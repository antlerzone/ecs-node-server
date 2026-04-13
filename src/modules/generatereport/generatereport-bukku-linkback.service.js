/**
 * Read-only Bukku: list/read Sales Invoices + Purchase Bills by owner contact, match amounts to ownerpayout,
 * then UPDATE ownerpayout.bukkuinvoice / bukkubills. Does NOT create or modify Bukku documents.
 */

const pool = require('../../config/db');
const bukkuInvoice = require('../bukku/wrappers/invoice.wrapper');
const bukkuPurchaseBill = require('../bukku/wrappers/purchaseBill.wrapper');
const { resolveClientAccounting } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const { utcDatetimeFromDbToMalaysiaDateOnly } = require('../../utils/dateMalaysia');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

const AMOUNT_EPS = 0.015;
const MAX_LIST_PAGES = 25;
const DEFAULT_PAGE_SIZE = 100;

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function amountsClose(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= AMOUNT_EPS;
}

/** Malaysia calendar month bounds as YYYY-MM-DD for Bukku list filters. */
function malaysiaMonthRangeFromPeriod(periodVal) {
  if (periodVal == null) return null;
  const ymd = utcDatetimeFromDbToMalaysiaDateOnly(periodVal);
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [yStr, mStr] = ymd.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  const lastDay = new Date(y, m, 0).getDate();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date_from: `${y}-${pad(m)}-01`,
    date_to: `${y}-${pad(m)}-${pad(lastDay)}`
  };
}

function normalizeTransactionArray(data) {
  if (!data) return [];
  if (Array.isArray(data.transactions)) return data.transactions;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function collectTxText(tx) {
  if (!tx || typeof tx !== 'object') return '';
  const parts = [
    tx.description,
    tx.memo,
    tx.notes,
    tx.title,
    tx.reference,
    tx.number,
    tx.remarks
  ];
  if (Array.isArray(tx.form_items)) {
    for (const fi of tx.form_items) {
      if (fi && fi.description) parts.push(fi.description);
    }
  }
  const inner = tx.transaction && typeof tx.transaction === 'object' ? tx.transaction : null;
  if (inner) {
    parts.push(inner.description, inner.memo, inner.notes, inner.title);
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Best-effort total from list row (Bukku list payload shape varies).
 */
function extractListTxTotal(tx) {
  if (!tx || typeof tx !== 'object') return null;
  const inner = tx.transaction && typeof tx.transaction === 'object' ? tx.transaction : null;
  const candidates = [
    num(tx.total),
    num(tx.grand_total),
    num(tx.net_total),
    num(tx.amount),
    num(tx.balance),
    inner && num(inner.total),
    inner && num(inner.grand_total),
    inner && num(inner.amount)
  ].filter((n) => n != null);
  if (candidates.length) return candidates[0];
  if (Array.isArray(tx.form_items) && tx.form_items.length) {
    let sum = 0;
    for (const fi of tx.form_items) {
      const up = num(fi.unit_price);
      const q = num(fi.quantity);
      if (up != null && q != null) sum += up * q;
      else if (up != null) sum += up;
    }
    if (sum > 0) return sum;
  }
  return null;
}

async function fetchAllPages(listFn, req, baseParams) {
  const out = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const params = { ...baseParams, page, page_size: baseParams.page_size || DEFAULT_PAGE_SIZE };
    const res = await listFn(req, params);
    if (!res?.ok) {
      return { ok: false, error: res?.error || 'BUKKU_LIST_FAILED', transactions: out, lastPage: page };
    }
    const chunk = normalizeTransactionArray(res.data);
    if (!chunk.length) break;
    out.push(...chunk);
    if (chunk.length < (params.page_size || DEFAULT_PAGE_SIZE)) break;
  }
  return { ok: true, transactions: out };
}

function scoreCandidate(tx, hints) {
  const text = collectTxText(tx);
  let score = 0;
  const short = (hints.propertyShortname || '').toString().trim().toLowerCase();
  const title = (hints.title || '').toString().trim().toLowerCase();
  if (short && text.includes(short)) score += 3;
  if (title) {
    const words = title.split(/\s+/).filter((w) => w.length > 3);
    for (const w of words) {
      if (text.includes(w)) score += 1;
    }
  }
  return score;
}

function txDateForSort(tx) {
  const d = tx.date || tx.invoice_date || tx.bill_date || (tx.transaction && tx.transaction.date);
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Pick one transaction matching target amount; tie-break by hint text then closest date to period.
 */
function pickMatchingTransaction(transactions, targetAmount, periodVal, hints) {
  if (targetAmount == null || !Number.isFinite(Number(targetAmount))) {
    return { ok: false, reason: 'INVALID_TARGET_AMOUNT' };
  }
  const matches = [];
  for (const tx of transactions) {
    const amt = extractListTxTotal(tx);
    if (amt == null) continue;
    if (!amountsClose(amt, targetAmount)) continue;
    const id = tx.id != null ? String(tx.id).trim() : tx.transaction?.id != null ? String(tx.transaction.id).trim() : '';
    if (!id) continue;
    matches.push({ tx, amt, id });
  }
  if (matches.length === 0) {
    return { ok: false, reason: 'NO_AMOUNT_MATCH' };
  }
  if (matches.length === 1) {
    return { ok: true, pick: matches[0] };
  }
  const periodMs =
    periodVal != null ? new Date(periodVal).getTime() : NaN;
  matches.sort((a, b) => {
    const ds = scoreCandidate(b.tx, hints) - scoreCandidate(a.tx, hints);
    if (ds !== 0) return ds;
    if (Number.isFinite(periodMs)) {
      const da = Math.abs(txDateForSort(a.tx) - periodMs);
      const db = Math.abs(txDateForSort(b.tx) - periodMs);
      if (da !== db) return da - db;
    }
    return String(a.id).localeCompare(String(b.id));
  });
  const top = matches[0];
  const topScore = scoreCandidate(top.tx, hints);
  const tied = matches.filter((m) => scoreCandidate(m.tx, hints) === topScore);
  if (tied.length > 1 && topScore === 0) {
    return {
      ok: false,
      reason: 'AMBIGUOUS_MATCH',
      candidates: tied.slice(0, 5).map((m) => ({
        id: m.id,
        amount: m.amt,
        snippet: collectTxText(m.tx).slice(0, 200)
      }))
    };
  }
  return { ok: true, pick: top };
}

function buildInvoiceUrl(subdomain, id) {
  const sub = String(subdomain || '').trim();
  if (!sub || !id) return null;
  return `https://${sub}.bukku.my/invoices/${encodeURIComponent(String(id))}`;
}

function buildBillUrl(subdomain, id) {
  const sub = String(subdomain || '').trim();
  if (!sub || !id) return null;
  return `https://${sub}.bukku.my/purchases/bills/${encodeURIComponent(String(id))}`;
}

/**
 * @param {string} clientId
 * @param {string} payoutId
 * @param {{ dryRun?: boolean, force?: boolean }} opts
 */
async function linkExistingBukkuUrlsForOwnerPayout(clientId, payoutId, opts = {}) {
  const dryRun = opts.dryRun === true;
  const force = opts.force === true;

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) {
    return { ok: false, reason: resolved.reason || 'NO_ACCOUNTING', provider: resolved.provider };
  }
  if (resolved.provider !== 'bukku') {
    return { ok: false, reason: 'BUKKU_ONLY', provider: resolved.provider };
  }
  const req = resolved.req;
  const subdomain = req.client?.bukku_subdomain;

  const [rows] = await pool.query(
    `SELECT o.id, o.property_id, o.period, o.title, o.management_fee, o.netpayout,
            o.bukkuinvoice, o.bukkubills,
            p.shortname AS property_shortname
       FROM ownerpayout o
       LEFT JOIN propertydetail p ON p.id = o.property_id AND p.client_id = o.client_id
       WHERE o.id = ? AND o.client_id = ?
       LIMIT 1`,
    [payoutId, clientId]
  );
  if (!rows.length) {
    return { ok: false, reason: 'PAYOUT_NOT_FOUND' };
  }
  const row = rows[0];
  const managementFee = Number(row.management_fee || 0);
  const netpayout = Number(row.netpayout || 0);

  const hasInv = row.bukkuinvoice && String(row.bukkuinvoice).trim();
  const hasBill = row.bukkubills && String(row.bukkubills).trim();
  if (!force && hasInv && hasBill) {
    return { ok: false, reason: 'ALREADY_LINKED', hint: 'Both bukkuinvoice and bukkubills are set; use force=true to re-link' };
  }

  const propertyId = row.property_id;
  if (!propertyId) {
    return { ok: false, reason: 'PROPERTY_ID_MISSING' };
  }
  const [propRows] = await pool.query(
    'SELECT owner_id FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1',
    [propertyId, clientId]
  );
  const ownerId = propRows[0]?.owner_id;
  if (!ownerId) {
    return { ok: false, reason: 'PROPERTY_OWNER_NOT_FOUND' };
  }
  const [ownerAccRows] = await pool.query('SELECT account FROM ownerdetail WHERE id = ? LIMIT 1', [ownerId]);
  const existingAccount = parseJson(ownerAccRows[0]?.account);
  const existingId = Array.isArray(existingAccount)
    ? existingAccount.find(
        (a) => String(a.clientId) === String(clientId) && String(a.provider || '').toLowerCase() === 'bukku'
      )?.id
    : null;
  if (existingId == null || String(existingId).trim() === '') {
    return {
      ok: false,
      reason: 'OWNER_BUKKU_CONTACT_ID_MISSING',
      hint: 'Owner has no Bukku contact id in ownerdetail.account; sync owner to accounting first.'
    };
  }
  const contactIdNum = Number(existingId);
  if (!Number.isFinite(contactIdNum)) {
    return { ok: false, reason: 'INVALID_BUKKU_CONTACT_ID' };
  }

  const range = malaysiaMonthRangeFromPeriod(row.period);
  if (!range) {
    return { ok: false, reason: 'PERIOD_INVALID_OR_MISSING' };
  }

  const listParams = {
    contact_id: contactIdNum,
    date_from: range.date_from,
    date_to: range.date_to,
    page_size: DEFAULT_PAGE_SIZE
  };

  const hints = {
    propertyShortname: row.property_shortname || '',
    title: row.title || ''
  };

  let invoiceUrl = null;
  let billUrl = null;
  let invoicePickMeta = null;
  let billPickMeta = null;
  const notes = [];

  if (managementFee > 0 && (force || !hasInv)) {
    const invList = await fetchAllPages(bukkuInvoice.listinvoices, req, listParams);
    if (!invList.ok) {
      return { ok: false, reason: 'BUKKU_INVOICE_LIST_FAILED', detail: invList.error };
    }
    const invMatch = pickMatchingTransaction(invList.transactions, managementFee, row.period, hints);
    if (!invMatch.ok) {
      if (invMatch.reason === 'AMBIGUOUS_MATCH') {
        return { ok: false, reason: 'AMBIGUOUS_INVOICE', candidates: invMatch.candidates };
      }
      notes.push(`invoice: ${invMatch.reason || 'NO_MATCH'}`);
    } else {
      invoiceUrl = buildInvoiceUrl(subdomain, invMatch.pick.id);
      invoicePickMeta = { id: invMatch.pick.id, amount: invMatch.pick.amt };
    }
  } else if (managementFee > 0 && hasInv && !force) {
    notes.push('invoice: skipped (bukkuinvoice already set)');
  } else {
    notes.push('invoice: skipped (management_fee <= 0)');
  }

  if (netpayout > 0 && (force || !hasBill)) {
    const billList = await fetchAllPages(bukkuPurchaseBill.listpurchasebills, req, listParams);
    if (!billList.ok) {
      return { ok: false, reason: 'BUKKU_BILL_LIST_FAILED', detail: billList.error };
    }
    const billMatch = pickMatchingTransaction(billList.transactions, netpayout, row.period, hints);
    if (!billMatch.ok) {
      if (billMatch.reason === 'AMBIGUOUS_MATCH') {
        return { ok: false, reason: 'AMBIGUOUS_BILL', candidates: billMatch.candidates };
      }
      notes.push(`bill: ${billMatch.reason || 'NO_MATCH'}`);
    } else {
      billUrl = buildBillUrl(subdomain, billMatch.pick.id);
      billPickMeta = { id: billMatch.pick.id, amount: billMatch.pick.amt };
    }
  } else if (netpayout > 0 && hasBill && !force) {
    notes.push('bill: skipped (bukkubills already set)');
  } else {
    notes.push('bill: skipped (netpayout <= 0)');
  }

  const wouldUpdate = Boolean(invoiceUrl || billUrl);
  if (!wouldUpdate && notes.length) {
    return {
      ok: false,
      reason: 'NO_URLS_RESOLVED',
      notes,
      dryRun: true,
      range,
      contactId: contactIdNum
    };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      wouldMarkPaid: Boolean(invoiceUrl || billUrl),
      bukkuinvoice: invoiceUrl,
      bukkubills: billUrl,
      invoice: invoicePickMeta,
      bill: billPickMeta,
      notes,
      range,
      contactId: contactIdNum
    };
  }

  const sets = [];
  const vals = [];
  if (invoiceUrl && (force || !hasInv)) {
    sets.push('bukkuinvoice = ?');
    vals.push(invoiceUrl);
  }
  if (billUrl && (force || !hasBill)) {
    sets.push('bukkubills = ?');
    vals.push(billUrl);
  }
  if (!sets.length) {
    return { ok: false, reason: 'NOTHING_TO_WRITE', notes };
  }
  sets.push('paid = 1');
  sets.push('updated_at = NOW()');
  vals.push(payoutId, clientId);
  await pool.query(`UPDATE ownerpayout SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`, vals);

  const [again] = await pool.query(
    `SELECT bukkuinvoice, bukkubills, paid FROM ownerpayout WHERE id = ? AND client_id = ?`,
    [payoutId, clientId]
  );

  return {
    ok: true,
    dryRun: false,
    paid: true,
    bukkuinvoice: again[0]?.bukkuinvoice || invoiceUrl,
    bukkubills: again[0]?.bukkubills || billUrl,
    invoice: invoicePickMeta,
    bill: billPickMeta,
    notes,
    range,
    contactId: contactIdNum
  };
}

module.exports = {
  linkExistingBukkuUrlsForOwnerPayout,
  /** @internal tests */
  _test: {
    malaysiaMonthRangeFromPeriod,
    extractListTxTotal,
    pickMatchingTransaction
  }
};
