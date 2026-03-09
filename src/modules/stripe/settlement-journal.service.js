/**
 * Settlement journal: 每個 client 每個 payout 日一筆分錄（DR Bank, CR Stripe）。
 * 已寫過的不重複：只處理 journal_created_at IS NULL 的列；有 stripepayout 記錄才入賬，沒有就不用。
 * 不另建表，做完分錄後更新 stripepayout.accounting_journal_id 與 journal_created_at。
 */

const pool = require('../../config/db');
const {
  resolveClientAccounting,
  getPaymentDestinationAccountId
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const bukkuJournalEntry = require('../bukku/wrappers/journalEntry.wrapper');
const xeroManualJournal = require('../xero/wrappers/manualjournal.wrapper');
const autocountJournalEntry = require('../autocount/wrappers/journalEntry.wrapper');
const sqlJournalEntry = require('../sqlaccount/wrappers/journalEntry.wrapper');

/**
 * Create one settlement journal in client's accounting: DR Bank, CR Stripe (same amount).
 * Description includes settlement id (stripepayout.id) for traceability.
 * @param {string} clientId
 * @param {{ amountCents: number, currency: string, payoutDate: string (YYYY-MM-DD), description?: string, settlementId?: string }} opts
 * @param {object} req - req.client from resolveClientAccounting
 * @param {string} provider - 'bukku' | 'xero' | 'autocount' | 'sql'
 * @returns {Promise<{ ok: boolean, journalDocId?: string, reason?: string }>}
 */
async function createSettlementJournal(clientId, opts, req, provider) {
  const { amountCents, currency, payoutDate, description, settlementId } = opts;
  if (!amountCents || amountCents <= 0) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  const amount = amountCents / 100;
  const base = (description || 'Stripe payout to bank').trim();
  const withId = settlementId ? `${base} · Settlement ID: ${settlementId}`.trim() : base;
  const desc = withId.slice(0, 255);
  const bankDest = await getPaymentDestinationAccountId(clientId, provider, 'bank');
  const stripeDest = await getPaymentDestinationAccountId(clientId, provider, 'stripe');
  if (!bankDest || !bankDest.accountId) {
    return { ok: false, reason: 'NO_BANK_ACCOUNT_MAPPING' };
  }
  if (!stripeDest || !stripeDest.accountId) {
    return { ok: false, reason: 'NO_STRIPE_ACCOUNT_MAPPING' };
  }

  if (provider === 'bukku') {
    const bankId = Number(bankDest.accountId);
    const stripeId = Number(stripeDest.accountId);
    if (Number.isNaN(bankId) || Number.isNaN(stripeId)) {
      return { ok: false, reason: 'BUKKU_ACCOUNT_ID_INVALID' };
    }
    const payload = {
      currency_code: (currency || 'MYR').toUpperCase(),
      date: payoutDate,
      description: desc,
      exchange_rate: 1,
      journal_items: [
        { line: 1, account_id: bankId, description: desc, debit_amount: amount, credit_amount: null },
        { line: 2, account_id: stripeId, description: desc, debit_amount: null, credit_amount: amount }
      ],
      status: 'ready'
    };
    try {
      const res = await bukkuJournalEntry.create(req, payload);
      if (!res || res.ok === false) {
        return { ok: false, reason: (res && res.error) || 'BUKKU_JOURNAL_FAILED' };
      }
      const data = res.data;
      const journalDocId = data?.id != null ? String(data.id) : (data?.journal_entry?.id != null ? String(data.journal_entry.id) : null);
      return { ok: true, journalDocId: journalDocId || undefined };
    } catch (err) {
      return { ok: false, reason: err.message || 'BUKKU_JOURNAL_FAILED' };
    }
  }

  if (provider === 'xero') {
    const bankCode = String(bankDest.accountId).trim();
    const stripeCode = String(stripeDest.accountId).trim();
    const payload = {
      Narration: desc,
      Date: payoutDate,
      JournalLines: [
        { Description: desc, LineAmount: -amount, AccountCode: bankCode },
        { Description: desc, LineAmount: amount, AccountCode: stripeCode }
      ]
    };
    try {
      const res = await xeroManualJournal.create(req, payload);
      if (!res.ok) {
        return { ok: false, reason: res.error || 'XERO_MANUAL_JOURNAL_FAILED' };
      }
      const journals = res.data?.ManualJournals;
      const first = Array.isArray(journals) && journals[0] ? journals[0] : null;
      const journalDocId = first?.ManualJournalID || first?.id || null;
      return { ok: true, journalDocId: journalDocId ? String(journalDocId) : undefined };
    } catch (err) {
      return { ok: false, reason: err.message || 'XERO_MANUAL_JOURNAL_FAILED' };
    }
  }

  if (provider === 'autocount') {
    const bankAccNo = String(bankDest.accountId).trim();
    const stripeAccNo = String(stripeDest.accountId).trim();
    const payload = {
      master: {
        docDate: payoutDate,
        taxDate: payoutDate,
        currencyCode: (currency || 'MYR').toUpperCase(),
        currencyRate: 1,
        journalType: 'GENERAL',
        description: desc
      },
      details: [
        { accNo: bankAccNo, dr: amount, cr: 0, description: desc },
        { accNo: stripeAccNo, dr: 0, cr: amount, description: desc }
      ]
    };
    try {
      const res = await autocountJournalEntry.createJournalEntry(req, payload);
      if (!res || res.ok === false) {
        return { ok: false, reason: (res && res.error) || 'AUTOCOUNT_JOURNAL_FAILED' };
      }
      const data = res.data;
      const journalDocId = data?.docNo != null ? String(data.docNo) : (data?.journalEntry?.docNo != null ? String(data.journalEntry.docNo) : data?.id != null ? String(data.id) : null);
      return { ok: true, journalDocId: journalDocId || undefined };
    } catch (err) {
      return { ok: false, reason: err.message || 'AUTOCOUNT_JOURNAL_FAILED' };
    }
  }

  if (provider === 'sql') {
    const bankCode = String(bankDest.accountId).trim();
    const stripeCode = String(stripeDest.accountId).trim();
    const payload = {
      Date: payoutDate,
      Description: desc,
      Lines: [
        { AccountCode: bankCode, Debit: amount, Credit: 0, Description: desc },
        { AccountCode: stripeCode, Debit: 0, Credit: amount, Description: desc }
      ]
    };
    try {
      const res = await sqlJournalEntry.createJournalEntry(req, payload);
      if (!res || res.ok === false) {
        return { ok: false, reason: (res && res.error) || 'SQL_JOURNAL_FAILED' };
      }
      const data = res.data;
      const journalDocId = data?.DocNo != null ? String(data.DocNo) : (data?.docNo != null ? String(data.docNo) : data?.Id != null ? String(data.Id) : data?.id != null ? String(data.id) : null);
      return { ok: true, journalDocId: journalDocId || undefined };
    } catch (err) {
      return { ok: false, reason: err.message || 'SQL_JOURNAL_FAILED' };
    }
  }

  return { ok: false, reason: 'UNSUPPORTED_PROVIDER', provider };
}

/**
 * 依一筆 stripepayout 建立分錄並更新該筆的 accounting_journal_id、journal_created_at。
 * 若該筆已有 journal_created_at 則直接回傳 ALREADY_JOURNALED。
 * @param {object} row - stripepayout row: id, client_id, payout_date, total_amount_cents, currency, journal_created_at
 * @returns {Promise<{ ok: boolean, journalDocId?: string, reason?: string }>}
 */
async function createJournalForStripePayoutRow(row) {
  if (!row || !row.id || !row.client_id) {
    return { ok: false, reason: 'MISSING_ROW_OR_ID' };
  }
  if (row.journal_created_at) {
    return { ok: true, reason: 'ALREADY_JOURNALED', journalDocId: row.accounting_journal_id || undefined };
  }

  const clientId = row.client_id;
  const payoutDate = row.payout_date instanceof Date
    ? row.payout_date.toISOString().slice(0, 10)
    : String(row.payout_date || '').slice(0, 10);
  const amountCents = Number(row.total_amount_cents) || 0;
  const currency = (row.currency || 'MYR').toString().trim() || 'MYR';

  if (amountCents <= 0) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  if (!payoutDate) {
    return { ok: false, reason: 'MISSING_PAYOUT_DATE' };
  }

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.provider || !resolved.req) {
    return { ok: false, reason: resolved.reason || 'NO_ACCOUNTING' };
  }
  const provider = resolved.provider;
  if (!['bukku', 'xero', 'autocount', 'sql'].includes(provider)) {
    return { ok: false, reason: 'UNSUPPORTED_PROVIDER', provider };
  }

  const result = await createSettlementJournal(
    clientId,
    {
      amountCents,
      currency,
      payoutDate,
      description: 'Stripe payout to bank',
      settlementId: row.id
    },
    resolved.req,
    provider
  );
  if (!result.ok) {
    return result;
  }

  const conn = await pool.getConnection();
  try {
    await conn.query(
      'UPDATE stripepayout SET accounting_journal_id = ?, journal_created_at = NOW() WHERE id = ? AND (journal_created_at IS NULL)',
      [result.journalDocId || null, row.id]
    );
  } finally {
    conn.release();
  }
  return { ok: true, journalDocId: result.journalDocId };
}

/**
 * 取得尚未做分錄的 stripepayout 列（已入賬的 skip；stripepayout 表本身只有「有 settlement 那天」才有列）。
 * @param {string} [clientId] - 若傳入則只撈該 client
 * @returns {Promise<Array<{ id, client_id, payout_date, total_amount_cents, currency, journal_created_at, ... }>>}
 */
async function getStripePayoutsPendingJournal(clientId = null) {
  let sql = 'SELECT id, client_id, payout_date, total_amount_cents, currency, accounting_journal_id, journal_created_at FROM stripepayout WHERE journal_created_at IS NULL AND total_amount_cents > 0 ORDER BY payout_date ASC, client_id';
  const args = [];
  if (clientId) {
    sql = 'SELECT id, client_id, payout_date, total_amount_cents, currency, accounting_journal_id, journal_created_at FROM stripepayout WHERE client_id = ? AND journal_created_at IS NULL AND total_amount_cents > 0 ORDER BY payout_date ASC';
    args.push(clientId);
  }
  const [rows] = await pool.query(sql, args);
  return rows;
}

/**
 * 對多筆 stripepayout 依序做分錄並更新表。Schedule 可先 getStripePayoutsPendingJournal() 再呼叫此函式。
 * @param {Array<object>} rows - stripepayout rows (e.g. from getStripePayoutsPendingJournal)
 * @returns {Promise<{ created: number, errors: Array<{ id: string, reason: string }> }>}
 */
async function processPendingStripePayoutJournals(rows) {
  let created = 0;
  const errors = [];
  for (const row of rows) {
    const result = await createJournalForStripePayoutRow(row);
    if (result.ok && result.reason !== 'ALREADY_JOURNALED') {
      created += 1;
    } else if (!result.ok) {
      errors.push({ id: row.id, reason: result.reason || 'UNKNOWN' });
    }
  }
  return { created, errors };
}

module.exports = {
  createSettlementJournal,
  createJournalForStripePayoutRow,
  getStripePayoutsPendingJournal,
  processPendingStripePayoutJournals
};
