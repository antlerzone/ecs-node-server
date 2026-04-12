/**
 * Ledger table `processing_fees`: one row per (client_id, provider, payment_id).
 * Written when SaaS processing fee is applied; status pending until operator bank payout (Billplz/Xendit), settlement for Stripe.
 *
 * All logs use prefix `[processing_fees]` — grep pm2 log: `grep processing_fees`
 */
const { randomUUID } = require('crypto');
const pool = require('../../config/db');

const COLLATE_UC = 'utf8mb4_unicode_ci';
const LOG_PREFIX = '[processing_fees]';

/** @param {unknown} v */
function safeJsonLen(v, max = 600) {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…(len=${s.length})`;
  } catch {
    return String(v);
  }
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 */
function logPf(event, fields = {}) {
  const line = { t: new Date().toISOString(), event, ...fields };
  console.log(LOG_PREFIX, safeJsonLen(line, 4000));
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 * @param {Error|unknown} [err]
 */
function logPfErr(event, fields = {}, err = null) {
  const e = err && typeof err === 'object' ? err : new Error(String(err));
  const msg = /** @type {Error} */ (e).message;
  const stack = /** @type {Error} */ (e).stack;
  const line = { t: new Date().toISOString(), event, ...fields, error: msg, stack: stack || '' };
  console.error(LOG_PREFIX, safeJsonLen(line, 4000));
}

function toMajor2(cents) {
  const n = Number(cents) || 0;
  return Number((n / 100).toFixed(2));
}

function num2(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} entry
 * @param {string} entry.clientId
 * @param {'stripe'|'xendit'|'billplz'} entry.provider
 * @param {string} [entry.chargeType] rental | invoice | meter
 * @param {'pending'|'settlement'} entry.status
 * @param {string} entry.paymentId PSP payment id (Stripe PI id, Xendit/Billplz payment id)
 * @param {string} [entry.referenceNumber] BP-/PF-/RR- or same as payment id
 * @param {string} entry.currency
 * @param {number} entry.grossAmountMajor
 * @param {number|null|undefined} entry.gatewayFeesAmountMajor — null when PSP does not return a fee
 * @param {number} entry.platformMarkupAmountMajor — 1% of gross (major units)
 * @param {object} [entry.metadata] stored in metadata_json (deduct_credits, tenant_name, etc.)
 * @param {string} [entry._logCaller] debug: who invoked (shown in pm2 log)
 * @param {string|Date} [entry.createdAt] optional backfill: ledger row timestamp (default: now)
 * @param {import('mysql2/promise').PoolConnection} [conn]
 */
function toMysqlDateTime(v) {
  if (v == null) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function upsertProcessingFeeLedgerRow(entry, conn = null) {
  const run = conn || pool;
  const now = entry.createdAt != null ? toMysqlDateTime(entry.createdAt) : toMysqlDateTime(null);
  const id = randomUUID();
  const clientId = String(entry.clientId || '').trim();
  const provider = String(entry.provider || '').trim().toLowerCase();
  const paymentId = String(entry.paymentId || '').trim();
  const callerHint = entry._logCaller != null ? String(entry._logCaller) : null;
  if (!clientId || !provider || !paymentId) {
    logPf('UPSERT_SKIP', { reason: 'MISSING_REQUIRED_FIELDS', clientId, provider, paymentId, caller: callerHint });
    return { ok: false, reason: 'MISSING_REQUIRED_FIELDS' };
  }
  if (!['stripe', 'xendit', 'billplz'].includes(provider)) {
    logPf('UPSERT_SKIP', { reason: 'INVALID_PROVIDER', clientId, provider, paymentId, caller: callerHint });
    return { ok: false, reason: 'INVALID_PROVIDER' };
  }

  const chargeType = String(entry.chargeType || 'invoice').trim().toLowerCase() || 'invoice';
  const status = String(entry.status || 'pending').trim().toLowerCase() === 'settlement' ? 'settlement' : 'pending';
  const currency = String(entry.currency || 'MYR').trim().toUpperCase();
  const grossAmount = num2(entry.grossAmountMajor);
  const gwRaw = entry.gatewayFeesAmountMajor;
  const gatewayFees =
    gwRaw != null && gwRaw !== '' && Number.isFinite(Number(gwRaw)) ? Number(Number(gwRaw).toFixed(2)) : null;
  const platformMarkup = num2(entry.platformMarkupAmountMajor);
  const totalFees = Number(((gatewayFees ?? 0) + platformMarkup).toFixed(2));
  const referenceNumber =
    entry.referenceNumber != null ? String(entry.referenceNumber).slice(0, 255) : null;
  const metadataJson = entry.metadata != null ? JSON.stringify(entry.metadata) : null;

  logPf('UPSERT_BEGIN', {
    caller: callerHint,
    newRowId: id,
    client_id: clientId,
    provider,
    charge_type: chargeType,
    status,
    payment_id: paymentId,
    reference_number: referenceNumber,
    currency,
    gross_amount: grossAmount,
    gateway_fees_amount: gatewayFees,
    platform_markup_amount: platformMarkup,
    total_fees_amount: totalFees,
    metadata_json_len: metadataJson ? metadataJson.length : 0,
    metadata_preview: entry.metadata != null ? safeJsonLen(entry.metadata, 400) : null
  });

  try {
  await run.query(
    `INSERT INTO processing_fees
       (id, client_id, provider, charge_type, status, payment_id, reference_number, currency,
        gross_amount, gateway_fees_amount, platform_markup_amount, total_fees_amount, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       charge_type = VALUES(charge_type),
       status = VALUES(status),
       reference_number = VALUES(reference_number),
       currency = VALUES(currency),
       gross_amount = VALUES(gross_amount),
       gateway_fees_amount = VALUES(gateway_fees_amount),
       platform_markup_amount = VALUES(platform_markup_amount),
       total_fees_amount = VALUES(total_fees_amount),
       metadata_json = VALUES(metadata_json),
       updated_at = VALUES(updated_at)`,
    [
      id,
      clientId,
      provider,
      chargeType,
      status,
      paymentId,
      referenceNumber,
      currency,
      grossAmount,
      gatewayFees,
      platformMarkup,
      totalFees,
      metadataJson,
      now,
      now
    ]
  );
  logPf('UPSERT_OK', {
    caller: callerHint,
    row_id: id,
    client_id: clientId,
    provider,
    payment_id: paymentId,
    status,
    total_fees_amount: totalFees
  });
  return { ok: true };
  } catch (err) {
    logPfErr(
      'UPSERT_FAIL',
      {
        caller: callerHint,
        newRowId: id,
        client_id: clientId,
        provider,
        payment_id: paymentId
      },
      err
    );
    throw err;
  }
}

async function markProcessingFeeSettlementByOperatorPayment({ clientId, provider, paymentId, _logCaller }, conn = null) {
  const run = conn || pool;
  const cid = String(clientId || '').trim();
  const prov = String(provider || '').trim().toLowerCase();
  const pid = String(paymentId || '').trim();
  const callerHint = _logCaller != null ? String(_logCaller) : null;
  if (!cid || !prov || !pid) {
    logPf('SETTLEMENT_SKIP', { reason: 'MISSING_FIELDS', client_id: cid, provider: prov, payment_id: pid, caller: callerHint });
    return { ok: false, reason: 'MISSING_FIELDS' };
  }
  logPf('SETTLEMENT_BEGIN', { caller: callerHint, client_id: cid, provider: prov, payment_id: pid });
  try {
  const [result] = await run.query(
    `UPDATE processing_fees SET status = 'settlement', updated_at = NOW()
     WHERE client_id COLLATE ${COLLATE_UC} = ? COLLATE ${COLLATE_UC}
       AND provider = ?
       AND payment_id COLLATE ${COLLATE_UC} = ? COLLATE ${COLLATE_UC}`,
    [cid, prov, pid]
  );
  const affectedRows = result?.affectedRows ?? 0;
  if (affectedRows === 0) {
    logPf('SETTLEMENT_NO_ROW', {
      caller: callerHint,
      client_id: cid,
      provider: prov,
      payment_id: pid,
      note: 'no matching processing_fees row (maybe not inserted yet or key mismatch)'
    });
  } else {
    logPf('SETTLEMENT_OK', { caller: callerHint, client_id: cid, provider: prov, payment_id: pid, affectedRows });
  }
  return { ok: true, affectedRows };
  } catch (err) {
    logPfErr('SETTLEMENT_FAIL', { caller: callerHint, client_id: cid, provider: prov, payment_id: pid }, err);
    throw err;
  }
}

/** @deprecated use upsertProcessingFeeLedgerRow */
async function upsertStripeProcessingFeeLog(opts, conn = null) {
  return upsertProcessingFeeLedgerRow(
    {
      clientId: opts.clientId,
      provider: 'stripe',
      chargeType: opts.chargeType || 'invoice',
      status: opts.status || 'settlement',
      paymentId: opts.paymentIntentId,
      referenceNumber: opts.referenceNumber || opts.paymentIntentId,
      currency: opts.currency,
      grossAmountMajor: toMajor2(opts.amountCents),
      gatewayFeesAmountMajor: opts.stripeFeeCents ? toMajor2(opts.stripeFeeCents) : null,
      platformMarkupAmountMajor: toMajor2(opts.platformMarkupCents),
      metadata: opts.metadata
    },
    conn
  );
}

/** @deprecated use upsertProcessingFeeLedgerRow */
async function upsertXenditProcessingFeeLog(opts, conn = null) {
  return upsertProcessingFeeLedgerRow(
    {
      clientId: opts.clientId,
      provider: 'xendit',
      chargeType: opts.chargeType || 'invoice',
      status: 'pending',
      paymentId: opts.externalId,
      referenceNumber: opts.referenceNumber || opts.externalId,
      currency: opts.currency,
      grossAmountMajor: toMajor2(opts.amountCents),
      gatewayFeesAmountMajor: opts.gatewayFeeCents != null ? toMajor2(opts.gatewayFeeCents) : null,
      platformMarkupAmountMajor: toMajor2(opts.platformMarkupCents),
      metadata: opts.metadata
    },
    conn
  );
}

module.exports = {
  upsertProcessingFeeLedgerRow,
  markProcessingFeeSettlementByOperatorPayment,
  upsertProcessingFeeLog: upsertProcessingFeeLedgerRow,
  upsertStripeProcessingFeeLog,
  upsertXenditProcessingFeeLog,
  LOG_PREFIX,
  logProcessingFee: logPf,
  logProcessingFeeErr: logPfErr
};
