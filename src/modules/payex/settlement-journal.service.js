/**
 * Xendit (Payex) settlement journal（operator 可見賬）: CR Xendit gross, DR Bank = operator net,
 * DR Processing = 網關費 + 內部平台 markup 合併（不單獨列 SaaS 明細）。
 */

const pool = require('../../config/db');
const {
  PLATFORM_MARKUP_PERCENT,
  getXenditEstimateGatewayPercent,
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

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function extractPaymentIdFromXenditTransactionLike(t) {
  if (!t || typeof t !== 'object') return '';
  const cands = [
    t.external_id,
    t.externalId,
    t.reference_id,
    t.referenceId,
    t.reference_number,
    t.referenceNumber,
    t.payment_id,
    t.paymentId,
    t.transaction_id,
    t.payment_request_id,
    t.invoice_id,
    t.id,
  ];
  for (const v of cands) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

/**
 * @param {number} grossMajor
 * @param {number|undefined|null} operatorNetMajor - operator share from API (major units); if missing, estimate gateway via env
 */
function splitForXenditSettlementJournal(grossMajor, operatorNetMajor) {
  const grossCents = Math.round(Number(grossMajor) * 100);
  const saasMarkupCents = Math.round((grossCents * PLATFORM_MARKUP_PERCENT) / 100);
  let transferCents;
  if (operatorNetMajor != null && Number.isFinite(Number(operatorNetMajor)) && Number(operatorNetMajor) >= 0) {
    transferCents = Math.round(Number(operatorNetMajor) * 100);
  } else {
    const gwCents = Math.round((grossCents * getXenditEstimateGatewayPercent()) / 100);
    transferCents = Math.max(0, grossCents - gwCents - saasMarkupCents);
  }
  return computeResidualFeeSplitFromGrossAndTransferCents(grossCents, transferCents);
}

/**
 * Compute net and fee from payex_settlement row. gross_amount is required.
 * If net_amount < gross_amount use fee = gross - net; else if mdr > 0 use fee = gross * mdr/100; else fee = 0, net = gross.
 */
function computeNetAndFee(row) {
  const gross = Number(row.gross_amount) || 0;
  const net = Number(row.net_amount);
  const mdr = Number(row.mdr);
  if (gross <= 0) return { gross: 0, net: 0, fee: 0 };
  if (net < gross && net > 0) {
    return { gross, net, fee: Math.round((gross - net) * 100) / 100 };
  }
  if (mdr > 0) {
    const fee = Math.round(gross * mdr * 100) / 10000;
    return { gross, net: Math.round((gross - fee) * 100) / 100, fee };
  }
  return { gross, net: gross, fee: 0 };
}

/**
 * Create one Xendit settlement journal (CR clearing, DR bank, DR processing combined).
 * @param {string} clientId
 * @param {{ gross: number, operatorNetMajor?: number, date: string (YYYY-MM-DD), settlementId: string, description?: string }} opts - amounts in major currency units (e.g. MYR)
 * @param {object} req
 * @param {string} provider
 * @param {string} [currency]
 */
async function createXenditSettlementJournal(clientId, opts, req, provider, currency) {
  const { gross: grossMajor, operatorNetMajor, date: journalDate, settlementId, description } = opts;
  const gross = Number(grossMajor) || 0;
  if (gross <= 0) {
    return { ok: false, reason: 'INVALID_GROSS' };
  }
  const cc = currency != null ? String(currency).trim().toUpperCase() : '';
  if (!cc) return { ok: false, reason: 'CLIENT_CURRENCY_MISSING' };
  if (!['MYR', 'SGD'].includes(cc)) return { ok: false, reason: 'UNSUPPORTED_CLIENT_CURRENCY' };
  const split = splitForXenditSettlementJournal(gross, operatorNetMajor);
  const net = split.transferToOperatorCents / 100;
  const feeProcessingCombined = (split.gatewayFeeCents + split.saasMarkupCents) / 100;
  const base = (description || 'Xendit payout to bank').trim();
  const withId = settlementId ? `${base} · Settlement ID: ${settlementId}`.trim() : base;
  const desc = withId.slice(0, 255);

  const bankDest = await getPaymentDestinationAccountId(clientId, provider, 'bank');
  const xenditDest = await getPaymentDestinationAccountId(clientId, provider, 'xendit');
  const processingFeeDest = await getPaymentDestinationAccountId(clientId, provider, 'processing_fee');
  if (!bankDest?.accountId) {
    return { ok: false, reason: 'NO_BANK_ACCOUNT_MAPPING' };
  }
  if (!xenditDest?.accountId) {
    return { ok: false, reason: 'NO_XENDIT_ACCOUNT_MAPPING' };
  }
  if (!processingFeeDest?.accountId) {
    return { ok: false, reason: 'NO_PROCESSING_FEE_ACCOUNT_MAPPING' };
  }

  if (provider === 'bukku') {
    const bankId = Number(bankDest.accountId);
    const xenditId = Number(xenditDest.accountId);
    const feeId = Number(processingFeeDest.accountId);
    if (Number.isNaN(bankId) || Number.isNaN(xenditId) || Number.isNaN(feeId)) {
      return { ok: false, reason: 'BUKKU_ACCOUNT_ID_INVALID' };
    }
    const items = [
      { line: 1, account_id: bankId, description: desc, debit_amount: net, credit_amount: null },
      { line: 2, account_id: feeId, description: desc, debit_amount: feeProcessingCombined, credit_amount: null },
      { line: 3, account_id: xenditId, description: desc, debit_amount: null, credit_amount: gross }
    ];
    const payload = {
      currency_code: cc,
      date: journalDate,
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
    const xenditCode = String(xenditDest.accountId).trim();
    const feeCode = String(processingFeeDest.accountId).trim();
    const lines = [
      { Description: desc, LineAmount: -net, AccountCode: bankCode },
      { Description: desc, LineAmount: -feeProcessingCombined, AccountCode: feeCode },
      { Description: desc, LineAmount: gross, AccountCode: xenditCode }
    ];
    const payload = { Narration: desc, Date: journalDate, JournalLines: lines };
    try {
      const res = await xeroManualJournal.create(req, payload);
      if (!res.ok) return { ok: false, reason: res.error || 'XERO_MANUAL_JOURNAL_FAILED' };
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
    const xenditAccNo = String(xenditDest.accountId).trim();
    const feeAccNo = String(processingFeeDest.accountId).trim();
    const details = [
      { accNo: bankAccNo, dr: net, cr: 0, description: desc },
      { accNo: feeAccNo, dr: feeProcessingCombined, cr: 0, description: desc },
      { accNo: xenditAccNo, dr: 0, cr: gross, description: desc }
    ];
    const payload = {
      master: {
        docDate: journalDate,
        taxDate: journalDate,
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
    const xenditCode = String(xenditDest.accountId).trim();
    const feeCode = String(processingFeeDest.accountId).trim();
    const lines = [
      { AccountCode: bankCode, Debit: net, Credit: 0, Description: desc },
      { AccountCode: feeCode, Debit: feeProcessingCombined, Credit: 0, Description: desc },
      { AccountCode: xenditCode, Debit: 0, Credit: gross, Description: desc }
    ];
    const payload = { Date: journalDate, Description: desc, Lines: lines };
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

async function getClientCurrencyForSettlement(clientId) {
  if (!clientId) return null;
  const [rows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const raw = rows && rows[0] ? rows[0].currency : null;
  const cc = raw != null && String(raw).trim() ? String(raw).trim().toUpperCase() : '';
  if (!cc) return null;
  if (!['MYR', 'SGD'].includes(cc)) return null;
  return cc;
}

/**
 * Create journal for one payex_settlement row and set bukku_journal_id.
 * @param {object} row - payex_settlement row: id, client_id, date, gross_amount, net_amount, mdr, settlement_id
 * @returns {Promise<{ ok: boolean, journalDocId?: string, reason?: string }>}
 */
async function createJournalForPayexSettlementRow(row) {
  if (!row || !row.id || !row.client_id) {
    return { ok: false, reason: 'MISSING_ROW_OR_ID' };
  }
  if (row.bukku_journal_id) {
    return { ok: true, reason: 'ALREADY_JOURNALED', journalDocId: row.bukku_journal_id };
  }

  const gross = Number(row.gross_amount) || 0;
  if (gross <= 0) {
    return { ok: false, reason: 'INVALID_GROSS' };
  }
  const netOpRaw = row.net_amount;
  const operatorNetMajor =
    netOpRaw != null && netOpRaw !== '' && Number.isFinite(Number(netOpRaw)) && Number(netOpRaw) >= 0
      ? Number(netOpRaw)
      : undefined;

  const journalDate = row.date instanceof Date
    ? row.date.toISOString().slice(0, 10)
    : String(row.date || '').slice(0, 10);
  if (!journalDate) {
    return { ok: false, reason: 'MISSING_DATE' };
  }

  const resolved = await resolveClientAccounting(row.client_id);
  if (!resolved.ok || !resolved.provider || !resolved.req) {
    return { ok: false, reason: resolved.reason || 'NO_ACCOUNTING' };
  }
  const provider = resolved.provider;
  if (!['bukku', 'xero', 'autocount', 'sql'].includes(provider)) {
    return { ok: false, reason: 'UNSUPPORTED_PROVIDER', provider };
  }

  const clientCurrency = await getClientCurrencyForSettlement(row.client_id);
  if (!clientCurrency) {
    return { ok: false, reason: 'CLIENT_CURRENCY_MISSING' };
  }

  const result = await createXenditSettlementJournal(
    row.client_id,
    {
      gross,
      ...(operatorNetMajor !== undefined ? { operatorNetMajor } : {}),
      date: journalDate,
      settlementId: row.settlement_id,
      description: 'Xendit payout to bank'
    },
    resolved.req,
    provider,
    clientCurrency
  );
  if (!result.ok) {
    return result;
  }

  const conn = await pool.getConnection();
  try {
    await conn.query(
      'UPDATE payex_settlement SET bukku_journal_id = ?, updated_at = NOW() WHERE id = ? AND (bukku_journal_id IS NULL OR bukku_journal_id = \'\')',
      [result.journalDocId || null, row.id]
    );
  } finally {
    conn.release();
  }

  // Mark "Payout to bank" done once the payout journal is created.
  try {
    const payoutAt = journalDate ? `${journalDate} 00:00:00` : null;
    const raw = parseJson(row.raw_data) || row.raw_data || null;
    const paymentIdCandidate = extractPaymentIdFromXenditTransactionLike(raw) || String(row.settlement_id || '').trim();
    if (paymentIdCandidate) {
      await pool.query(
        `UPDATE xendit_operator_payments
         SET payout_status = 'paid',
             payout_at = IF(payout_at IS NULL, ?, payout_at),
             accounting_journal_id = IF(accounting_journal_id IS NULL, ?, accounting_journal_id),
             updated_at = NOW()
         WHERE client_id = ?
           AND payment_id = ?
           AND payout_status = 'pending'`,
        [payoutAt, result.journalDocId || null, row.client_id, paymentIdCandidate]
      );
      try {
        const { markProcessingFeeSettlementByOperatorPayment } = require('../billing/processing-fee-log.service');
        await markProcessingFeeSettlementByOperatorPayment({
          clientId: row.client_id,
          provider: 'xendit',
          paymentId: paymentIdCandidate,
          _logCaller: 'payex.settlement-journal.createJournalForXenditPayout'
        });
      } catch (e) {
        console.error(
          '[processing_fees] CALLER payex.settlement-journal.createJournalForXenditPayout settlement',
          e?.message || e
        );
      }
    }
  } catch (_) {}

  return { ok: true, journalDocId: result.journalDocId };
}

/**
 * Get payex_settlement rows that have not been journaled yet.
 * @param {string} [clientId] - if provided, filter by client_id
 * @returns {Promise<Array<object>>}
 */
async function getPayexSettlementsPendingJournal(clientId = null) {
  let sql = `SELECT id, client_id, settlement_id, date, gross_amount, net_amount, mdr, bukku_journal_id, raw_data
    FROM payex_settlement
    WHERE (bukku_journal_id IS NULL OR bukku_journal_id = '') AND gross_amount > 0
    ORDER BY date ASC, client_id`;
  const args = [];
  if (clientId) {
    sql = `SELECT id, client_id, settlement_id, date, gross_amount, net_amount, mdr, bukku_journal_id, raw_data
      FROM payex_settlement
      WHERE client_id = ? AND (bukku_journal_id IS NULL OR bukku_journal_id = '') AND gross_amount > 0
      ORDER BY date ASC`;
    args.push(clientId);
  }
  const [rows] = await pool.query(sql, args);
  return rows;
}

/**
 * Process multiple payex_settlement rows: create journal for each and update bukku_journal_id.
 * @param {Array<object>} rows - from getPayexSettlementsPendingJournal
 * @returns {Promise<{ created: number, errors: Array<{ id: string, reason: string }> }>}
 */
async function processPendingPayexSettlementJournals(rows) {
  let created = 0;
  const errors = [];
  for (const row of rows) {
    const result = await createJournalForPayexSettlementRow(row);
    if (result.ok && result.reason !== 'ALREADY_JOURNALED') {
      created += 1;
    } else if (!result.ok) {
      errors.push({ id: row.id, reason: result.reason || 'UNKNOWN' });
    }
  }
  return { created, errors };
}

module.exports = {
  computeNetAndFee,
  createXenditSettlementJournal,
  createJournalForPayexSettlementRow,
  getPayexSettlementsPendingJournal,
  processPendingPayexSettlementJournals
};
