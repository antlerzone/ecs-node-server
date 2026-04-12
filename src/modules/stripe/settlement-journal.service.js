/**
 * Settlement journal（operator 可見賬）：每 client 每日一筆 — CR Stripe clearing（gross）、DR Bank（轉 operator）、DR Processing（支付通道費 + 內部平台 markup 合併，不單獨暴露 SaaS 明細）。
 * gross_amount_cents 若為 NULL，則用 STRIPE_ESTIMATE_GATEWAY_PERCENT + 1% 反推 gross（近似）。
 */

const pool = require('../../config/db');
const {
  PLATFORM_MARKUP_PERCENT,
  getStripeEstimateGatewayPercent,
  computeResidualFeeSplitFromGrossAndTransferCents
} = require('../../constants/payment-fees');
const {
  resolveClientAccounting,
  getPaymentDestinationAccountId
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const bukkuJournalEntry = require('../bukku/wrappers/journalEntry.wrapper');
const xeroManualJournal = require('../xero/wrappers/manualjournal.wrapper');
const autocountJournalEntry = require('../autocount/wrappers/journalEntry.wrapper');
const sqlJournalEntry = require('../sqlaccount/wrappers/journalEntry.wrapper');

/**
 * @param {{ transferTotalCents: number, grossCents: number, currency: string, payoutDate: string, description?: string, settlementId?: string }} opts
 */
async function createSettlementJournal(clientId, opts, req, provider) {
  const { transferTotalCents, grossCents, currency, payoutDate, description, settlementId } = opts;
  const cc = currency != null ? String(currency).trim().toUpperCase() : '';
  if (!cc) return { ok: false, reason: 'CLIENT_CURRENCY_MISSING' };
  if (!['MYR', 'SGD'].includes(cc)) return { ok: false, reason: 'UNSUPPORTED_CLIENT_CURRENCY' };
  const transferCents = Math.max(0, Math.round(Number(transferTotalCents) || 0));
  let gross = Math.max(0, Math.round(Number(grossCents) || 0));
  if (gross <= 0 && transferCents > 0) {
    const estGw = getStripeEstimateGatewayPercent();
    const denom = 100 - PLATFORM_MARKUP_PERCENT - estGw;
    gross = denom > 0 ? Math.round((transferCents * 100) / denom) : transferCents;
  }
  if (transferCents <= 0 || gross <= 0) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  const split = computeResidualFeeSplitFromGrossAndTransferCents(gross, transferCents);
  /** Gateway + platform markup combined on one processing line (markup not broken out for operator-facing books). */
  const feeProcessingCombined = (split.gatewayFeeCents + split.saasMarkupCents) / 100;
  const grossMajor = gross / 100;
  const netMajor = transferCents / 100;
  const base = (description || 'Stripe Connect transfers / settlement').trim();
  const withId = settlementId ? `${base} · Settlement ID: ${settlementId}`.trim() : base;
  const desc = withId.slice(0, 255);

  const bankDest = await getPaymentDestinationAccountId(clientId, provider, 'bank');
  const stripeDest = await getPaymentDestinationAccountId(clientId, provider, 'stripe');
  const processingFeeDest = await getPaymentDestinationAccountId(clientId, provider, 'processing_fee');
  if (!bankDest || !bankDest.accountId) {
    return { ok: false, reason: 'NO_BANK_ACCOUNT_MAPPING' };
  }
  if (!stripeDest || !stripeDest.accountId) {
    return { ok: false, reason: 'NO_STRIPE_ACCOUNT_MAPPING' };
  }
  if (!processingFeeDest?.accountId) {
    return { ok: false, reason: 'NO_PROCESSING_FEE_ACCOUNT_MAPPING' };
  }

  if (provider === 'bukku') {
    const bankId = Number(bankDest.accountId);
    const stripeId = Number(stripeDest.accountId);
    const feeId = Number(processingFeeDest.accountId);
    if (Number.isNaN(bankId) || Number.isNaN(stripeId) || Number.isNaN(feeId)) {
      return { ok: false, reason: 'BUKKU_ACCOUNT_ID_INVALID' };
    }
    const items = [
      { line: 1, account_id: bankId, description: desc, debit_amount: netMajor, credit_amount: null },
      { line: 2, account_id: feeId, description: desc, debit_amount: feeProcessingCombined, credit_amount: null },
      { line: 3, account_id: stripeId, description: desc, debit_amount: null, credit_amount: grossMajor }
    ];
    const payload = {
      currency_code: cc,
      date: payoutDate,
      description: desc,
      exchange_rate: 1,
      journal_items: items,
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
    const feeCode = String(processingFeeDest.accountId).trim();
    const lines = [
      { Description: desc, LineAmount: -netMajor, AccountCode: bankCode },
      { Description: desc, LineAmount: -feeProcessingCombined, AccountCode: feeCode },
      { Description: desc, LineAmount: grossMajor, AccountCode: stripeCode }
    ];
    const payload = { Narration: desc, Date: payoutDate, JournalLines: lines };
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
    const feeAccNo = String(processingFeeDest.accountId).trim();
    const details = [
      { accNo: bankAccNo, dr: netMajor, cr: 0, description: desc },
      { accNo: feeAccNo, dr: feeProcessingCombined, cr: 0, description: desc },
      { accNo: stripeAccNo, dr: 0, cr: grossMajor, description: desc }
    ];
    const payload = {
      master: {
        docDate: payoutDate,
        taxDate: payoutDate,
        currencyCode: cc,
        currencyRate: 1,
        journalType: 'GENERAL',
        description: desc
      },
      details
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
    const feeCode = String(processingFeeDest.accountId).trim();
    const lines = [
      { AccountCode: bankCode, Debit: netMajor, Credit: 0, Description: desc },
      { AccountCode: feeCode, Debit: feeProcessingCombined, Credit: 0, Description: desc },
      { AccountCode: stripeCode, Debit: 0, Credit: grossMajor, Description: desc }
    ];
    const payload = { Date: payoutDate, Description: desc, Lines: lines };
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
 * @param {object} row - stripepayout row: id, client_id, payout_date, total_amount_cents, gross_amount_cents, currency, journal_created_at
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
  const transferTotalCents = Number(row.total_amount_cents) || 0;
  const grossAmountCents = row.gross_amount_cents != null ? Number(row.gross_amount_cents) : null;
  const currency = row.currency != null && String(row.currency).trim() ? String(row.currency).trim().toUpperCase() : '';
  if (!currency) {
    return { ok: false, reason: 'CLIENT_CURRENCY_MISSING' };
  }
  if (!['MYR', 'SGD'].includes(currency)) {
    return { ok: false, reason: 'UNSUPPORTED_CLIENT_CURRENCY' };
  }

  if (transferTotalCents <= 0) {
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
      transferTotalCents,
      grossCents: grossAmountCents != null && grossAmountCents > 0 ? grossAmountCents : Math.round((transferTotalCents * 100) / 97),
      currency,
      payoutDate,
      description: 'Stripe Connect transfers / settlement',
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
  let sql = 'SELECT id, client_id, payout_date, total_amount_cents, gross_amount_cents, currency, accounting_journal_id, journal_created_at FROM stripepayout WHERE journal_created_at IS NULL AND total_amount_cents > 0 ORDER BY payout_date ASC, client_id';
  const args = [];
  if (clientId) {
    sql = 'SELECT id, client_id, payout_date, total_amount_cents, gross_amount_cents, currency, accounting_journal_id, journal_created_at FROM stripepayout WHERE client_id = ? AND journal_created_at IS NULL AND total_amount_cents > 0 ORDER BY payout_date ASC';
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

async function upsertStripeOperatorPayoutFromWebhook(clientId, payout) {
  if (!clientId || !payout?.id) return null;
  const id = require('crypto').randomUUID();
  const payoutId = String(payout.id).trim();
  const amountCents = Math.max(0, Math.round(Number(payout.amount) || 0));
  const currency = String(payout.currency || '').trim().toUpperCase() || 'MYR';
  const statusRaw = String(payout.status || '').trim().toLowerCase();
  const status = ['paid', 'failed', 'canceled'].includes(statusRaw) ? statusRaw : 'pending';
  const arrivalDate = payout.arrival_date
    ? new Date(Number(payout.arrival_date) * 1000).toISOString().slice(0, 10)
    : null;
  const rawJson = JSON.stringify(payout);
  await pool.query(
    `INSERT INTO stripe_operator_payouts
      (id, client_id, payout_id, status, currency, amount_cents, arrival_date, raw_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       status = CASE
         WHEN stripe_operator_payouts.status = 'paid' THEN stripe_operator_payouts.status
         ELSE VALUES(status)
       END,
       currency = VALUES(currency),
       amount_cents = VALUES(amount_cents),
       arrival_date = COALESCE(stripe_operator_payouts.arrival_date, VALUES(arrival_date)),
       raw_data = VALUES(raw_data),
       updated_at = NOW()`,
    [id, clientId, payoutId, status, currency, amountCents, arrivalDate, rawJson]
  );
  const [rows] = await pool.query(
    `SELECT id, client_id, payout_id, status, currency, amount_cents, arrival_date, raw_data,
            accounting_journal_id, journal_created_at
       FROM stripe_operator_payouts
      WHERE client_id = ? AND payout_id = ?
      LIMIT 1`,
    [clientId, payoutId]
  );
  return rows?.[0] || null;
}

async function createJournalForStripeOperatorPayoutRow(row) {
  if (!row || !row.id || !row.client_id) {
    return { ok: false, reason: 'MISSING_ROW_OR_ID' };
  }
  if (row.journal_created_at) {
    return { ok: true, reason: 'ALREADY_JOURNALED', journalDocId: row.accounting_journal_id || undefined };
  }
  if (String(row.status || '').trim().toLowerCase() !== 'paid') {
    return { ok: false, reason: 'PAYOUT_NOT_PAID' };
  }

  const payoutDate = row.arrival_date instanceof Date
    ? row.arrival_date.toISOString().slice(0, 10)
    : String(row.arrival_date || '').slice(0, 10);
  const transferTotalCents = Number(row.amount_cents) || 0;
  const currency = row.currency != null && String(row.currency).trim() ? String(row.currency).trim().toUpperCase() : '';
  if (!currency) return { ok: false, reason: 'CLIENT_CURRENCY_MISSING' };
  if (!['MYR', 'SGD'].includes(currency)) return { ok: false, reason: 'UNSUPPORTED_CLIENT_CURRENCY' };
  if (transferTotalCents <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
  if (!payoutDate) return { ok: false, reason: 'MISSING_PAYOUT_DATE' };

  const resolved = await resolveClientAccounting(row.client_id);
  if (!resolved.ok || !resolved.provider || !resolved.req) {
    return { ok: false, reason: resolved.reason || 'NO_ACCOUNTING' };
  }
  const provider = resolved.provider;
  if (!['bukku', 'xero', 'autocount', 'sql'].includes(provider)) {
    return { ok: false, reason: 'UNSUPPORTED_PROVIDER', provider };
  }

  const result = await createSettlementJournal(
    row.client_id,
    {
      transferTotalCents,
      grossCents: null,
      currency,
      payoutDate,
      description: 'Stripe payout to bank',
      settlementId: row.payout_id
    },
    resolved.req,
    provider
  );
  if (!result.ok) return result;

  await pool.query(
    `UPDATE stripe_operator_payouts
        SET accounting_journal_id = ?, journal_created_at = NOW(), updated_at = NOW()
      WHERE id = ? AND journal_created_at IS NULL`,
    [result.journalDocId || null, row.id]
  );
  return { ok: true, journalDocId: result.journalDocId };
}

module.exports = {
  createSettlementJournal,
  createJournalForStripePayoutRow,
  upsertStripeOperatorPayoutFromWebhook,
  createJournalForStripeOperatorPayoutRow,
  getStripePayoutsPendingJournal,
  processPendingStripePayoutJournals
};
