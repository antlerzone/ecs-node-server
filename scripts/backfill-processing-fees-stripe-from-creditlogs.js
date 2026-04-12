/**
 * One-off: fill processing_fees from Stripe "Stripe Processing Fees" creditlogs rows that missed ledger (e.g. failed migration).
 * Safe to re-run (UPSERT on client_id/provider/payment_id).
 *
 *   node scripts/backfill-processing-fees-stripe-from-creditlogs.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { upsertProcessingFeeLedgerRow } = require('../src/modules/billing/processing-fee-log.service');

function parseJson(s) {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 2
  });
  const [rows] = await pool.query(
    `SELECT c.id, c.client_id, c.reference_number, c.currency, c.payload, c.platform_markup_amount,
            c.stripe_fee_amount, c.charge_type, c.created_at
       FROM creditlogs c
       LEFT JOIN processing_fees pf
         ON pf.client_id = c.client_id
        AND pf.provider = 'stripe'
        AND pf.payment_id = SUBSTRING(c.reference_number FROM 4)
      WHERE c.title = 'Stripe Processing Fees'
        AND c.type = 'Spending'
        AND c.reference_number LIKE 'RR-%'
        AND pf.id IS NULL`
  );
  let ok = 0;
  let fail = 0;
  for (const r of rows || []) {
    const paymentId = String(r.reference_number || '').replace(/^RR-/i, '').trim();
    const clientId = String(r.client_id || '').trim();
    if (!paymentId || !clientId) {
      fail++;
      continue;
    }
    const p = parseJson(r.payload);
    const grossCents = Number(p.gross_amount_cents) || 0;
    const grossMajor = Number((grossCents / 100).toFixed(2));
    const pmMajor = Number(r.platform_markup_amount) || 0;
    const stripeFeeMajor = r.stripe_fee_amount != null ? Number(r.stripe_fee_amount) : null;
    const deductCredits =
      Number(p.deduct_credits) > 0
        ? Number(p.deduct_credits)
        : pmMajor > 0
          ? Math.ceil(pmMajor)
          : 0;
    const refNum = String(r.reference_number).slice(0, 255);
    const currency = String(r.currency || 'MYR').trim().toUpperCase() || 'MYR';
    const chargeType = String(r.charge_type || 'invoice').trim().toLowerCase() || 'invoice';
    try {
      await upsertProcessingFeeLedgerRow(
        {
          clientId,
          provider: 'stripe',
          chargeType,
          status: 'settlement',
          paymentId,
          referenceNumber: refNum,
          currency,
          grossAmountMajor: grossMajor,
          gatewayFeesAmountMajor: stripeFeeMajor != null && stripeFeeMajor > 0 ? Number(stripeFeeMajor.toFixed(4)) : null,
          platformMarkupAmountMajor: Number(pmMajor.toFixed(4)),
          metadata: {
            deduct_credits: deductCredits,
            creditlog_id: r.id,
            backfill: true
          },
          createdAt: r.created_at,
          _logCaller: 'script.backfill-processing-fees-stripe-from-creditlogs'
        },
        null
      );
      ok++;
    } catch (e) {
      console.error('[backfill] fail', paymentId, e?.message || e);
      fail++;
    }
  }
  console.log('[backfill] done. inserted/updated:', ok, 'failed:', fail, 'candidates:', (rows || []).length);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
