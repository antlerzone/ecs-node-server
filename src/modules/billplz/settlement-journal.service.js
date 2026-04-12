const pool = require('../../config/db');
const {
  resolveClientAccounting,
  getPaymentDestinationAccountId
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const bukkuJournalEntry = require('../bukku/wrappers/journalEntry.wrapper');
const xeroManualJournal = require('../xero/wrappers/manualjournal.wrapper');
const autocountJournalEntry = require('../autocount/wrappers/journalEntry.wrapper');
const sqlJournalEntry = require('../sqlaccount/wrappers/journalEntry.wrapper');

async function createBillplzSettlementJournal(clientId, opts, req, provider, currency) {
  const {
    gross: grossMajor,
    operatorNetMajor,
    date: journalDate,
    settlementId,
    description
  } = opts;
  const gross = Number(grossMajor) || 0;
  const net = Number.isFinite(Number(operatorNetMajor)) ? Number(operatorNetMajor) : gross;
  if (gross <= 0 || net <= 0) return { ok: false, reason: 'INVALID_GROSS' };
  const feeProcessingCombined = Math.max(0, Number((gross - net).toFixed(2)));
  const cc = currency != null ? String(currency).trim().toUpperCase() : '';
  if (!cc) return { ok: false, reason: 'CLIENT_CURRENCY_MISSING' };
  if (!['MYR', 'SGD'].includes(cc)) return { ok: false, reason: 'UNSUPPORTED_CLIENT_CURRENCY' };

  const base = (description || 'Billplz payout to bank').trim();
  const withId = settlementId ? `${base} · Settlement ID: ${settlementId}`.trim() : base;
  const desc = withId.slice(0, 255);

  const bankDest = await getPaymentDestinationAccountId(clientId, provider, 'bank');
  const billplzDest = await getPaymentDestinationAccountId(clientId, provider, 'billplz');
  const processingFeeDest = await getPaymentDestinationAccountId(clientId, provider, 'processing_fee');
  if (!bankDest?.accountId) return { ok: false, reason: 'NO_BANK_ACCOUNT_MAPPING' };
  if (!billplzDest?.accountId) return { ok: false, reason: 'NO_BILLPLZ_ACCOUNT_MAPPING' };
  if (feeProcessingCombined > 0 && !processingFeeDest?.accountId) {
    return { ok: false, reason: 'NO_PROCESSING_FEE_ACCOUNT_MAPPING' };
  }

  if (provider === 'bukku') {
    const items = [
      { line: 1, account_id: Number(bankDest.accountId), description: desc, debit_amount: net, credit_amount: null },
      ...(feeProcessingCombined > 0 ? [{ line: 2, account_id: Number(processingFeeDest.accountId), description: desc, debit_amount: feeProcessingCombined, credit_amount: null }] : []),
      { line: feeProcessingCombined > 0 ? 3 : 2, account_id: Number(billplzDest.accountId), description: desc, debit_amount: null, credit_amount: gross }
    ];
    if (items.some((item) => Number.isNaN(Number(item.account_id)))) return { ok: false, reason: 'BUKKU_ACCOUNT_ID_INVALID' };
    const res = await bukkuJournalEntry.create(req, {
      currency_code: cc,
      date: journalDate,
      description: desc,
      exchange_rate: 1,
      journal_items: items,
      status: 'ready'
    });
    if (!res || res.ok === false) return { ok: false, reason: (res && res.error) || 'BUKKU_JOURNAL_FAILED' };
    const data = res.data;
    const journalDocId = data?.id != null ? String(data.id) : (data?.journal_entry?.id != null ? String(data.journal_entry.id) : null);
    return { ok: true, journalDocId: journalDocId || undefined };
  }

  if (provider === 'xero') {
    const lines = [
      { Description: desc, LineAmount: -net, AccountCode: String(bankDest.accountId).trim() },
      ...(feeProcessingCombined > 0 ? [{ Description: desc, LineAmount: -feeProcessingCombined, AccountCode: String(processingFeeDest.accountId).trim() }] : []),
      { Description: desc, LineAmount: gross, AccountCode: String(billplzDest.accountId).trim() }
    ];
    const res = await xeroManualJournal.create(req, { Narration: desc, Date: journalDate, JournalLines: lines });
    if (!res.ok) return { ok: false, reason: res.error || 'XERO_MANUAL_JOURNAL_FAILED' };
    const first = Array.isArray(res.data?.ManualJournals) && res.data.ManualJournals[0] ? res.data.ManualJournals[0] : null;
    return { ok: true, journalDocId: first?.ManualJournalID || first?.id || undefined };
  }

  if (provider === 'autocount') {
    const details = [
      { accNo: String(bankDest.accountId).trim(), dr: net, cr: 0, description: desc },
      ...(feeProcessingCombined > 0 ? [{ accNo: String(processingFeeDest.accountId).trim(), dr: feeProcessingCombined, cr: 0, description: desc }] : []),
      { accNo: String(billplzDest.accountId).trim(), dr: 0, cr: gross, description: desc }
    ];
    const res = await autocountJournalEntry.createJournalEntry(req, {
      master: {
        docDate: journalDate,
        taxDate: journalDate,
        currencyCode: cc,
        currencyRate: 1,
        journalType: 'GENERAL',
        description: desc
      },
      details
    });
    if (!res || res.ok === false) return { ok: false, reason: (res && res.error) || 'AUTOCOUNT_JOURNAL_FAILED' };
    const data = res.data;
    return { ok: true, journalDocId: data?.docNo != null ? String(data.docNo) : (data?.journalEntry?.docNo != null ? String(data.journalEntry.docNo) : data?.id != null ? String(data.id) : undefined) };
  }

  if (provider === 'sql') {
    const lines = [
      { AccountCode: String(bankDest.accountId).trim(), Debit: net, Credit: 0, Description: desc },
      ...(feeProcessingCombined > 0 ? [{ AccountCode: String(processingFeeDest.accountId).trim(), Debit: feeProcessingCombined, Credit: 0, Description: desc }] : []),
      { AccountCode: String(billplzDest.accountId).trim(), Debit: 0, Credit: gross, Description: desc }
    ];
    const res = await sqlJournalEntry.createJournalEntry(req, { Date: journalDate, Description: desc, Lines: lines });
    if (!res || res.ok === false) return { ok: false, reason: (res && res.error) || 'SQL_JOURNAL_FAILED' };
    const data = res.data;
    return { ok: true, journalDocId: data?.DocNo != null ? String(data.DocNo) : (data?.docNo != null ? String(data.docNo) : data?.Id != null ? String(data.Id) : data?.id != null ? String(data.id) : undefined) };
  }

  return { ok: false, reason: 'UNSUPPORTED_PROVIDER', provider };
}

async function createJournalForBillplzPayoutRow(row) {
  if (!row || !row.id || !row.client_id) return { ok: false, reason: 'MISSING_ROW_OR_ID' };
  if (row.journal_created_at) return { ok: true, reason: 'ALREADY_JOURNALED', journalDocId: row.accounting_journal_id || undefined };
  if (String(row.status || '').trim().toLowerCase() !== 'paid') return { ok: false, reason: 'PAYOUT_NOT_PAID' };

  const journalDate = row.payout_date instanceof Date
    ? row.payout_date.toISOString().slice(0, 10)
    : String(row.payout_date || '').slice(0, 10);
  if (!journalDate) return { ok: false, reason: 'MISSING_DATE' };

  const resolved = await resolveClientAccounting(row.client_id);
  if (!resolved.ok || !resolved.provider || !resolved.req) return { ok: false, reason: resolved.reason || 'NO_ACCOUNTING' };
  if (!['bukku', 'xero', 'autocount', 'sql'].includes(resolved.provider)) return { ok: false, reason: 'UNSUPPORTED_PROVIDER', provider: resolved.provider };

  const result = await createBillplzSettlementJournal(
    row.client_id,
    {
      gross: Number(row.amount) || 0,
      operatorNetMajor: Number(row.amount) || 0,
      date: journalDate,
      settlementId: row.payment_order_id,
      description: 'Billplz payout to bank'
    },
    resolved.req,
    resolved.provider,
    String(row.currency || 'MYR').trim().toUpperCase() || 'MYR'
  );
  if (!result.ok) return result;

  await pool.query(
    `UPDATE billplz_payouts
        SET accounting_journal_id = ?, journal_created_at = NOW(), updated_at = NOW()
      WHERE id = ? AND journal_created_at IS NULL`,
    [result.journalDocId || null, row.id]
  );
  return { ok: true, journalDocId: result.journalDocId };
}

module.exports = {
  createBillplzSettlementJournal,
  createJournalForBillplzPayoutRow
};
