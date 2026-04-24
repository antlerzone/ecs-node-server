const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { PLATFORM_MARKUP_PERCENT } = require('../../constants/payment-fees');
const { createBill, getBill } = require('./wrappers/bill.wrapper');
const {
  verifyBillplzXSignature,
  verifyBillplzPaymentOrderCallbackChecksum
} = require('./lib/signature');
const {
  getBillplzDirectCredentials,
  markBillplzWebhookVerified,
  assertClientPaymentGatewayUsable
} = require('../payment-gateway/payment-gateway.service');

function toMysqlNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function isBillplzPaid(data) {
  const state = normalizeText(data?.state).toLowerCase();
  const paid = data?.paid;
  return paid === true || paid === 'true' || paid === 1 || paid === '1' || state === 'paid';
}

function normalizeBillplzPayoutStatus(status) {
  const s = normalizeText(status).toLowerCase();
  if (['paid', 'completed', 'success', 'succeeded'].includes(s)) return 'paid';
  if (['failed', 'cancelled', 'canceled', 'rejected', 'refunded', 'reversed'].includes(s)) return 'failed';
  return 'pending';
}

async function getBillplzCredentials(clientId, opts = {}) {
  return getBillplzDirectCredentials(clientId, { allowPending: opts.allowPending === true });
}

async function verifyCallbackSignature(clientId, payload, providedSignature) {
  const creds = await getBillplzDirectCredentials(clientId, { allowPending: true });
  if (!creds || !creds.xSignatureKey) return { ok: false, reason: 'BILLPLZ_X_SIGNATURE_KEY_REQUIRED' };
  if (!providedSignature) return { ok: false, reason: 'BILLPLZ_X_SIGNATURE_REQUIRED' };
  const verified = verifyBillplzXSignature(payload, creds.xSignatureKey, providedSignature);
  return verified ? { ok: true } : { ok: false, reason: 'BILLPLZ_X_SIGNATURE_MISMATCH' };
}

async function verifyPaymentOrderCallbackChecksum(clientId, payload) {
  const creds = await getBillplzDirectCredentials(clientId, { allowPending: true });
  if (!creds || !creds.xSignatureKey) return { ok: false, reason: 'BILLPLZ_X_SIGNATURE_KEY_REQUIRED' };
  const verified = verifyBillplzPaymentOrderCallbackChecksum(payload, creds.xSignatureKey);
  return verified ? { ok: true } : { ok: false, reason: 'BILLPLZ_PAYMENT_ORDER_CHECKSUM_MISMATCH' };
}

async function createPayment(clientId, opts = {}) {
  const connection = await assertClientPaymentGatewayUsable(clientId);
  if (!connection.ok) throw new Error(connection.reason || 'PAYMENT_GATEWAY_NOT_CONNECTED');
  const creds = await getBillplzDirectCredentials(clientId, { allowPending: true });
  if (!creds || !creds.apiKey || !creds.collectionId) throw new Error('BILLPLZ_NOT_CONFIGURED');
  const amountCents = Math.max(100, Math.round(Number(opts.amountCents) || 0));
  const result = await createBill({
    apiKey: creds.apiKey,
    collectionId: creds.collectionId,
    email: normalizeText(opts.email),
    mobile: normalizeText(opts.mobile),
    name: normalizeText(opts.customerName || 'Tenant Payment').slice(0, 255),
    amount: amountCents,
    callbackUrl: normalizeText(opts.callbackUrl),
    redirectUrl: normalizeText(opts.redirectUrl),
    description: normalizeText(opts.description || 'Tenant payment').slice(0, 200),
    reference1Label: 'Reference',
    reference1: normalizeText(opts.referenceNumber).slice(0, 120),
    reference2Label: 'Type',
    reference2: normalizeText(opts.type).slice(0, 120),
    useSandbox: creds.useSandbox === true
  });
  if (!result?.ok) {
    const providerMessage =
      typeof result?.error === 'string'
        ? result.error
        : normalizeText(result?.error?.error?.message || result?.error?.message || result?.error);
    throw new Error(providerMessage || 'BILLPLZ_CREATE_BILL_FAILED');
  }
  const bill = result?.data || {};
  return {
    id: normalizeText(bill?.id),
    url: normalizeText(bill?.url),
    state: normalizeText(bill?.state)
  };
}

function getBillplzFeeDeduction(amountCents) {
  const platformMarkupCents = Math.round((Math.max(0, Number(amountCents) || 0) * PLATFORM_MARKUP_PERCENT) / 100);
  /** ceil(1% in major currency) = integer credits (same rule as Stripe getRentDeduction). */
  const deductCredits = Math.max(0, Math.ceil(Number(platformMarkupCents) / 100)) || 0;
  return { deductCredits, platformMarkupCents };
}

function tenantNameOrDash(tenantName) {
  const s = tenantName != null ? String(tenantName).trim() : '';
  return s || '—';
}

async function deductBillplzFeeAndLog(clientId, externalId, amountCents, deduction, chargeType, tenantName) {
  const { deductClientCredit } = require('../stripe/stripe.service');
  await deductClientCredit(clientId, deduction.deductCredits, null, { allowNegative: true });
  const [currRows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const curr = currRows.length ? String(currRows[0].currency || '').trim().toUpperCase() : 'MYR';
  const logId = randomUUID();
  const now = toMysqlNow();
  const platformMarkupMajor = Math.abs(deduction.platformMarkupCents) / 100;
  const amountCredits = deduction.deductCredits > 0 ? -Math.abs(Number(deduction.deductCredits) || 0) : 0;
  await pool.query(
    `INSERT INTO creditlogs
      (id, title, type, amount, payment, client_id, staff_id, reference_number, payload, currency, platform_markup_amount, tenant_name, charge_type, created_at, updated_at)
     VALUES (?, ?, 'Spending', ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      logId,
      'Billplz Processing Fees',
      amountCredits,
      clientId,
      `BP-${externalId || logId}`,
      JSON.stringify({
        external_id: externalId,
        amount_cents: amountCents,
        platform_markup_cents: deduction.platformMarkupCents,
        deduct_credits: deduction.deductCredits,
        charge_type: chargeType
      }),
      curr,
      platformMarkupMajor.toFixed(2),
      tenantNameOrDash(tenantName),
      chargeType || 'rental',
      now,
      now
    ]
  );
  try {
    const { upsertProcessingFeeLedgerRow } = require('../billing/processing-fee-log.service');
    await upsertProcessingFeeLedgerRow({
      clientId,
      provider: 'billplz',
      chargeType: chargeType || 'rental',
      status: 'pending',
      paymentId: String(externalId || logId).trim(),
      referenceNumber: `BP-${externalId || logId}`,
      currency: curr,
      grossAmountMajor: Number(((amountCents || 0) / 100).toFixed(2)),
      gatewayFeesAmountMajor: null,
      platformMarkupAmountMajor: platformMarkupMajor,
      metadata: {
        deduct_credits: deduction.deductCredits,
        tenant_name: tenantNameOrDash(tenantName),
        external_id: externalId || null,
        creditlog_id: logId
      },
      _logCaller: 'billplz.deductBillplzFeeAndLog'
    });
  } catch (e) {
    console.error(
      '[processing_fees] CALLER billplz.deductBillplzFeeAndLog (creditlog already saved; ledger failed)',
      e?.message || e
    );
  }
  try {
    const { clearBillingCacheByClientId } = require('../billing/billing.service');
    clearBillingCacheByClientId(clientId);
  } catch (_) {}
  return { deducted: true, deductCredits: deduction.deductCredits };
}

async function insertBillplzFeePending(clientId, externalId, amountCents, deduction, chargeType, tenantName) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO billplz_fee_pending
      (id, client_id, external_id, amount_credits, amount_cents, platform_markup_cents, charge_type, tenant_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      clientId,
      externalId || id,
      deduction.deductCredits,
      amountCents,
      deduction.platformMarkupCents,
      chargeType || 'rental',
      tenantName || null,
      toMysqlNow()
    ]
  );
}

async function applyBillplzFeeDeduction(clientId, externalId, amountCents, chargeType, tenantName) {
  if (!clientId) return;
  const deduction = getBillplzFeeDeduction(amountCents);
  if (deduction.deductCredits <= 0) return;
  const feeRef = `BP-${externalId || ''}`;
  if (externalId) {
    const [doneRows] = await pool.query(
      `SELECT id FROM creditlogs WHERE client_id = ? AND reference_number = ?
       AND (type = 'BillplzFee' OR (type = 'Spending' AND title = 'Billplz Processing Fees'))
       LIMIT 1`,
      [clientId, feeRef]
    );
    if (doneRows.length) return;
    const [pendingRows] = await pool.query(
      'SELECT id FROM billplz_fee_pending WHERE client_id = ? AND external_id = ? LIMIT 1',
      [clientId, externalId]
    );
    if (pendingRows.length) return;
  }
  await deductBillplzFeeAndLog(clientId, externalId, amountCents, deduction, chargeType, tenantName);
}

async function processBillplzPendingFees(clientId) {
  const { deductClientCredit } = require('../stripe/stripe.service');
  const [currRows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const currency = currRows.length ? String(currRows[0].currency || '').trim().toUpperCase() : 'MYR';
  const [rows] = await pool.query(
    'SELECT id, external_id, amount_credits, amount_cents, platform_markup_cents, charge_type, tenant_name FROM billplz_fee_pending WHERE client_id = ? ORDER BY created_at ASC',
    [clientId]
  );
  let processed = 0;
  for (const row of rows) {
    await deductClientCredit(clientId, Number(row.amount_credits || 0), null, { allowNegative: true });
    const now = toMysqlNow();
    const pmMajor = Math.abs(Number(row.platform_markup_cents || 0)) / 100;
    const creditsOut = Math.max(0, Math.round(Number(row.amount_credits || 0)));
    const logId = randomUUID();
    await pool.query(
      `INSERT INTO creditlogs
        (id, title, type, amount, payment, client_id, staff_id, reference_number, payload, currency, platform_markup_amount, tenant_name, charge_type, created_at, updated_at)
       VALUES (?, ?, 'Spending', ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        'Billplz Processing Fees',
        creditsOut > 0 ? -creditsOut : 0,
        clientId,
        `BP-${row.external_id}`,
        JSON.stringify({
          external_id: row.external_id,
          amount_cents: row.amount_cents,
          platform_markup_cents: row.platform_markup_cents,
          deduct_credits: row.amount_credits,
          charge_type: row.charge_type
        }),
        currency,
        pmMajor.toFixed(2),
        tenantNameOrDash(row.tenant_name),
        row.charge_type || 'rental',
        now,
        now
      ]
    );
    try {
      const { upsertProcessingFeeLedgerRow } = require('../billing/processing-fee-log.service');
      await upsertProcessingFeeLedgerRow({
        clientId,
        provider: 'billplz',
        chargeType: row.charge_type || 'rental',
        status: 'pending',
        paymentId: String(row.external_id || '').trim(),
        referenceNumber: `BP-${row.external_id}`,
        currency,
        grossAmountMajor: Number(((Number(row.amount_cents || 0)) / 100).toFixed(2)),
        gatewayFeesAmountMajor: null,
        platformMarkupAmountMajor: pmMajor,
        metadata: {
          deduct_credits: row.amount_credits,
          tenant_name: tenantNameOrDash(row.tenant_name),
          external_id: row.external_id || null,
          creditlog_id: logId
        },
        _logCaller: 'billplz.processBillplzPendingFees'
      });
    } catch (e) {
      console.error(
        '[processing_fees] CALLER billplz.processBillplzPendingFees (creditlog already saved; ledger failed)',
        e?.message || e
      );
    }
    await pool.query('DELETE FROM billplz_fee_pending WHERE id = ?', [row.id]);
    processed++;
  }
  return { processed };
}

async function upsertBillplzOperatorPayment(opts = {}) {
  const {
    clientId,
    paymentId,
    billId,
    chargeType,
    currency,
    grossMajor,
    referenceNumber,
    invoiceSource,
    invoiceRecordId,
    invoiceId,
    paymentStatus,
    paidAt,
    settlementStatus,
    receivedAt,
    payoutStatus,
    payoutAt,
    accountingJournalId
  } = opts;
  const cid = normalizeText(clientId);
  const pid = normalizeText(paymentId);
  if (!cid || !pid) return { ok: false, reason: 'MISSING_CLIENT_ID_OR_PAYMENT_ID' };
  const id = randomUUID();
  const cc = normalizeText(currency).toUpperCase() || 'MYR';
  const charge = normalizeText(chargeType || 'rental').toLowerCase() || 'rental';
  await pool.query(
    `INSERT INTO billplz_operator_payments
      (id, client_id, provider, payment_id, bill_id, charge_type, currency, gross_amount, reference_number,
       invoice_source, invoice_record_id, invoice_id,
       payment_status, paid_at,
       settlement_status, received_at,
       payout_status, payout_at, accounting_journal_id,
       created_at, updated_at)
     VALUES
      (?, ?, 'billplz', ?, ?, ?, ?, ?, ?,
       ?, ?, ?,
       ?, ?,
       ?, ?,
       ?, ?, ?,
       NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       bill_id = COALESCE(NULLIF(VALUES(bill_id), ''), bill_id),
       charge_type = VALUES(charge_type),
       currency = VALUES(currency),
       gross_amount = VALUES(gross_amount),
       reference_number = VALUES(reference_number),
       invoice_source = VALUES(invoice_source),
       invoice_record_id = VALUES(invoice_record_id),
       invoice_id = VALUES(invoice_id),
       payment_status = VALUES(payment_status),
       paid_at = COALESCE(paid_at, VALUES(paid_at)),
       settlement_status = CASE
         WHEN settlement_status = 'received' THEN settlement_status
         ELSE VALUES(settlement_status)
       END,
       received_at = COALESCE(received_at, VALUES(received_at)),
       payout_status = CASE
         WHEN payout_status = 'paid' THEN payout_status
         WHEN VALUES(payout_status) = 'failed' THEN 'failed'
         ELSE VALUES(payout_status)
       END,
       payout_at = COALESCE(payout_at, VALUES(payout_at)),
       accounting_journal_id = COALESCE(accounting_journal_id, VALUES(accounting_journal_id)),
       updated_at = NOW()`,
    [
      id,
      cid,
      pid,
      normalizeText(billId) || null,
      charge,
      cc,
      Number(grossMajor) || 0,
      normalizeText(referenceNumber) || null,
      normalizeText(invoiceSource) || null,
      normalizeText(invoiceRecordId) || null,
      normalizeText(invoiceId) || null,
      normalizeText(paymentStatus || 'pending') || 'pending',
      paidAt || null,
      normalizeText(settlementStatus || 'pending') || 'pending',
      receivedAt || null,
      normalizeText(payoutStatus || 'pending') || 'pending',
      payoutAt || null,
      normalizeText(accountingJournalId) || null
    ]
  );
  return { ok: true };
}

async function resolveRentalIds(referenceNumber, invoiceIdsJoined, clientId, tenancyId) {
  const explicitIds = normalizeText(invoiceIdsJoined)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (explicitIds.length) return explicitIds;
  if (!referenceNumber) return [];
  let sql = 'SELECT id FROM rentalcollection WHERE referenceid = ?';
  const params = [referenceNumber];
  if (clientId) {
    sql += ' AND client_id = ?';
    params.push(clientId);
  }
  if (tenancyId) {
    sql += ' AND tenancy_id = ?';
    params.push(tenancyId);
  }
  const [rows] = await pool.query(sql, params);
  return (rows || []).map((row) => normalizeText(row.id)).filter(Boolean);
}

async function applyBillplzPaymentSuccess({ bill, clientId, context = {} }) {
  let type = normalizeText(context.type);
  const referenceNumber = normalizeText(context.reference_number);
  const tenancyId = normalizeText(context.tenancy_id);
  const tenantId = normalizeText(context.tenant_id);
  const tenantName = normalizeText(context.tenant_name || bill?.name);
  let meterTransactionId = normalizeText(context.meter_transaction_id);
  if (!meterTransactionId && /^MT-/i.test(referenceNumber)) {
    meterTransactionId = referenceNumber.replace(/^MT-/i, '').trim();
  }
  if (!type && meterTransactionId && /^MT-/i.test(referenceNumber)) {
    type = 'TenantMeter';
  }
  const invoiceIdsJoined = normalizeText(context.invoice_ids);
  const amountCents = Math.round(Number(bill?.paid_amount ?? bill?.amount ?? 0));
  const now = toMysqlNow();
  const paymentId = referenceNumber || normalizeText(bill?.id);
  const currency = 'MYR';

  if (type === 'TenantMeter' && meterTransactionId) {
    await pool.query(
      `UPDATE metertransaction
          SET ispaid = 1, status = 'success', referenceid = ?, updated_at = NOW()
        WHERE id = ?`,
      [referenceNumber || normalizeText(bill?.id), meterTransactionId]
    );
    try {
      const { handleTenantMeterPaymentSuccess } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
      await handleTenantMeterPaymentSuccess({
        metadata: {
          meter_transaction_id: meterTransactionId,
          tenancy_id: tenancyId,
          tenant_id: tenantId,
          client_id: clientId,
          amount_cents: String(amountCents)
        },
        amount_total: amountCents,
        id: normalizeText(bill?.id),
        payment_intent: referenceNumber || normalizeText(bill?.id)
      });
    } catch (e) {
      console.warn('[billplz] handleTenantMeterPaymentSuccess failed:', e?.message || e);
    }
    try {
      const [mtRows] = await pool.query('SELECT invoiceid FROM metertransaction WHERE id = ? LIMIT 1', [meterTransactionId]);
      const invoiceId = mtRows?.[0]?.invoiceid != null && String(mtRows[0].invoiceid).trim() ? String(mtRows[0].invoiceid).trim() : null;
      await upsertBillplzOperatorPayment({
        clientId,
        paymentId,
        billId: normalizeText(bill?.id),
        chargeType: 'meter',
        currency,
        grossMajor: amountCents / 100,
        referenceNumber: referenceNumber || normalizeText(bill?.id),
        invoiceSource: 'metertransaction',
        invoiceRecordId: meterTransactionId,
        invoiceId,
        paymentStatus: 'complete',
        paidAt: now,
        settlementStatus: 'received',
        receivedAt: now,
        payoutStatus: 'pending'
      });
    } catch (e) {
      console.warn('[billplz] upsert operator payment failed (meter):', e?.message || e);
    }
    await applyBillplzFeeDeduction(clientId, referenceNumber || normalizeText(bill?.id), amountCents, 'meter', tenantName || null);
    return { ok: true, type: 'TenantMeter', meterTransactionId };
  }

  const rentalIds = await resolveRentalIds(referenceNumber, invoiceIdsJoined, clientId, tenancyId);
  if (!rentalIds.length) return { ok: false, reason: 'NO_RENTAL_IDS' };
  for (const rid of rentalIds) {
    await pool.query(
      'UPDATE rentalcollection SET referenceid = ?, ispaid = 1, paidat = ?, updated_at = NOW() WHERE id = ?',
      [referenceNumber || normalizeText(bill?.id), now, rid]
    );
  }
  try {
    const { createReceiptForPaidRentalCollection } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
    await createReceiptForPaidRentalCollection(rentalIds, { source: 'billplz' });
  } catch (e) {
    console.warn('[billplz] createReceiptForPaidRentalCollection failed:', e?.message || e);
  }
  try {
    const firstRid = rentalIds[0] || null;
    let invoiceId = null;
    if (firstRid) {
      const [invRows] = await pool.query('SELECT invoiceid FROM rentalcollection WHERE id = ? LIMIT 1', [firstRid]);
      invoiceId = invRows?.[0]?.invoiceid != null && String(invRows[0].invoiceid).trim() ? String(invRows[0].invoiceid).trim() : null;
    }
    await upsertBillplzOperatorPayment({
      clientId,
      paymentId,
      billId: normalizeText(bill?.id),
      chargeType: type === 'TenantInvoice' ? 'invoice' : 'rental',
      currency,
      grossMajor: amountCents / 100,
      referenceNumber: referenceNumber || normalizeText(bill?.id),
      invoiceSource: 'rentalcollection',
      invoiceRecordId: firstRid,
      invoiceId,
      paymentStatus: 'complete',
      paidAt: now,
      settlementStatus: 'received',
      receivedAt: now,
      payoutStatus: 'pending'
    });
  } catch (e) {
    console.warn('[billplz] upsert operator payment failed (rental):', e?.message || e);
  }
  await applyBillplzFeeDeduction(clientId, referenceNumber || normalizeText(bill?.id), amountCents, type === 'TenantInvoice' ? 'invoice' : 'rental', tenantName || null);
  return { ok: true, type: 'TenantInvoice', rentalIds };
}

async function handleCallback({ clientId, payload, query = {} }) {
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const billId = normalizeText(payload?.id);
  try {
    await markBillplzWebhookVerified(clientId, {
      eventType: normalizeText(payload?.state || (isBillplzPaid(payload) ? 'bill.paid' : 'bill.updated')),
      billId
    });
  } catch (e) {
    console.warn('[billplz] mark webhook verified failed:', e?.message || e);
  }
  if (!isBillplzPaid(payload)) {
    return { ok: true, verified: true, paid: false, state: normalizeText(payload?.state) };
  }
  const applied = await applyBillplzPaymentSuccess({ bill: payload, clientId, context: query });
  return { ok: applied.ok !== false, verified: true, paid: true, result: applied };
}

async function confirmBillPayment({ clientId, tenantId, billId, referenceNumber, paymentType, meterTransactionId }) {
  if (!clientId || !tenantId || !billId) {
    return { ok: false, reason: 'MISSING_BILLPLZ_CONFIRMATION_REFERENCE' };
  }
  const creds = await getBillplzDirectCredentials(clientId, { allowPending: true });
  if (!creds || !creds.apiKey) return { ok: false, reason: 'BILLPLZ_NOT_CONFIGURED' };
  let bill;
  try {
    const result = await getBill({ apiKey: creds.apiKey, billId, useSandbox: creds.useSandbox === true });
    if (!result?.ok) {
      throw new Error(
        typeof result?.error === 'string'
          ? result.error
          : normalizeText(result?.error?.error?.message || result?.error?.message || result?.error)
      );
    }
    bill = result?.data || null;
  } catch (e) {
    console.warn('[billplz] confirmBillPayment fetch failed', e?.message || e);
    return { ok: false, reason: 'BILL_NOT_FOUND' };
  }
  if (!isBillplzPaid(bill)) return { ok: false, reason: 'PAYMENT_NOT_PAID' };
  const applied = await applyBillplzPaymentSuccess({
    bill,
    clientId,
    context: {
      client_id: clientId,
      tenant_id: tenantId,
      reference_number: referenceNumber,
      type: paymentType === 'meter' ? 'TenantMeter' : 'TenantInvoice',
      meter_transaction_id: meterTransactionId
    }
  });
  return applied.ok === false ? { ok: false, reason: applied.reason || 'CONFIRM_FAILED' } : { ok: true, result: applied };
}

async function handlePaymentOrderCallback({ clientId, payload }) {
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const payoutStatus = normalizeBillplzPayoutStatus(payload?.status);
  const referenceId = normalizeText(payload?.reference_id);
  const paymentOrderId = normalizeText(payload?.id);
  const now = toMysqlNow();
  if (!paymentOrderId) {
    return { ok: false, reason: 'BILLPLZ_PAYMENT_ORDER_ID_REQUIRED' };
  }
  await markBillplzWebhookVerified(clientId, {
    eventType: `payment_order.${normalizeText(payload?.status || 'updated')}`,
    billId: paymentOrderId
  }).catch(() => {});
  await pool.query(
    `INSERT INTO billplz_payouts
      (id, client_id, payment_order_id, reference_id, status, currency, amount, payout_date, raw_data, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, ?, 'MYR', ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       reference_id = COALESCE(NULLIF(VALUES(reference_id), ''), reference_id),
       status = CASE
         WHEN billplz_payouts.status = 'paid' THEN billplz_payouts.status
         ELSE VALUES(status)
       END,
       amount = CASE WHEN VALUES(amount) > 0 THEN VALUES(amount) ELSE billplz_payouts.amount END,
       payout_date = COALESCE(billplz_payouts.payout_date, VALUES(payout_date)),
       raw_data = VALUES(raw_data),
       updated_at = NOW()`,
    [
      clientId,
      paymentOrderId,
      referenceId || null,
      payoutStatus,
      Number(payload?.total ?? payload?.amount ?? 0) || 0,
      String(payload?.updated_at || payload?.date || now).slice(0, 10),
      JSON.stringify(payload || {})
    ]
  );
  await pool.query(
    `UPDATE billplz_operator_payments
        SET payout_status = ?,
            payout_at = CASE WHEN ? = 'paid' AND payout_at IS NULL THEN ? ELSE payout_at END,
            updated_at = NOW()
      WHERE client_id = ?
        AND payment_id = ?`,
    [payoutStatus, payoutStatus, now, clientId, referenceId]
  );
  const [rows] = await pool.query(
    `SELECT id, client_id, payment_order_id, status, currency, amount, payout_date, raw_data, accounting_journal_id, journal_created_at
       FROM billplz_payouts
      WHERE client_id = ? AND payment_order_id = ?
      LIMIT 1`,
    [clientId, paymentOrderId]
  );
  let journal = null;
  if (payoutStatus === 'paid' && rows?.[0]) {
    const { createJournalForBillplzPayoutRow } = require('./settlement-journal.service');
    journal = await createJournalForBillplzPayoutRow(rows[0]);
    if (journal?.ok && journal.journalDocId) {
      await pool.query(
        `UPDATE billplz_operator_payments
            SET accounting_journal_id = IF(accounting_journal_id IS NULL, ?, accounting_journal_id),
                updated_at = NOW()
          WHERE client_id = ? AND payment_id = ?`,
        [journal.journalDocId, clientId, referenceId]
      );
    }
  }
  if (payoutStatus === 'paid' && referenceId) {
    try {
      const { markProcessingFeeSettlementByOperatorPayment } = require('../billing/processing-fee-log.service');
      await markProcessingFeeSettlementByOperatorPayment({
        clientId,
        provider: 'billplz',
        paymentId: referenceId,
        _logCaller: 'billplz.handlePaymentOrderCallback'
      });
    } catch (e) {
      console.error('[processing_fees] CALLER billplz.handlePaymentOrderCallback settlement', e?.message || e);
    }
  }
  return {
    ok: true,
    updated: true,
    paymentId: referenceId,
    payoutStatus,
    paymentOrderId: paymentOrderId || null,
    journal
  };
}

module.exports = {
  getBillplzCredentials,
  verifyCallbackSignature,
  verifyPaymentOrderCallbackChecksum,
  createPayment,
  handleCallback,
  handlePaymentOrderCallback,
  confirmBillPayment,
  processBillplzPendingFees
};
