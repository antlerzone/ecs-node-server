/**
 * Daily cron: charge due unpaid rentalcollection via saved Stripe PaymentMethod (off_session PaymentIntent).
 * Requires ENABLE_TENANT_STRIPE_AUTO_DEBIT, tenantdetail.profile.rent_auto_debit_enabled, stripe_customer_id + stripe_payment_method_id.
 */

const pool = require('../../config/db');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
const { getClientPaymentGateway } = require('../payment-gateway/payment-gateway.service');
const { isTenantRentAutoDebitOfferedForClient } = require('./tenant-rent-auto-debit-operator-guard');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

/**
 * @returns {{ enabled: boolean, processed: number, charged: number, skipped: Array<{ id: string, reason: string }>, errors: Array<{ id: string, message: string }> }}
 */
async function runTenantStripeAutoDebitForDueRentals() {
  const enabled =
    process.env.ENABLE_TENANT_STRIPE_AUTO_DEBIT === '1' || process.env.ENABLE_TENANT_STRIPE_AUTO_DEBIT === 'true';
  if (!enabled) {
    return { enabled: false, processed: 0, charged: 0, skipped: [], errors: [] };
  }

  const today = getTodayMalaysiaDate();
  const maxAttempts = Math.min(
    500,
    Math.max(1, Number(process.env.TENANT_STRIPE_AUTO_DEBIT_MAX_PER_RUN || 30) || 30)
  );

  const [rows] = await pool.query(
    `SELECT r.id, r.tenancy_id, r.client_id, r.tenant_id, r.amount, r.date, r.title
     FROM rentalcollection r
     WHERE r.ispaid = 0 AND DATE(r.date) <= ?
     ORDER BY r.date ASC, r.id ASC
     LIMIT 500`,
    [today]
  );

  const stripe = require('../stripe/stripe.service');
  const skipped = [];
  const errors = [];
  let processed = 0;
  let charged = 0;

  const profileCache = new Map();
  const clientOfferedCache = new Map();

  for (const r of rows || []) {
    if (charged >= maxAttempts) break;

    const rentalId = r.id;
    const clientId = r.client_id;
    const tenantId = r.tenant_id;
    if (!rentalId || !clientId || !tenantId) {
      skipped.push({ id: rentalId || '', reason: 'missing_ids' });
      continue;
    }

    try {
      const gw = await getClientPaymentGateway(clientId);
      if (gw.provider !== 'stripe') {
        skipped.push({ id: rentalId, reason: 'gateway_not_stripe' });
        continue;
      }

      if (!(await isTenantRentAutoDebitOfferedForClient(clientId, clientOfferedCache))) {
        skipped.push({ id: rentalId, reason: 'operator_disabled_auto_debit_offer' });
        continue;
      }

      let profile = profileCache.get(tenantId);
      if (profile === undefined) {
        const [tRows] = await pool.query('SELECT profile FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
        profile = tRows.length ? parseJson(tRows[0].profile) : null;
        if (!profile || Array.isArray(profile)) profile = {};
        profileCache.set(tenantId, profile);
      }

      const rentAutoOk =
        profile.rent_auto_debit_enabled === true || profile.xendit_auto_debit === true;
      if (!rentAutoOk) {
        skipped.push({ id: rentalId, reason: 'auto_debit_not_opt_in' });
        continue;
      }

      if (!profile.stripe_customer_id || !profile.stripe_payment_method_id) {
        skipped.push({ id: rentalId, reason: 'no_stripe_customer_or_pm' });
        continue;
      }

      const amountNum = Number(r.amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        skipped.push({ id: rentalId, reason: 'invalid_amount' });
        continue;
      }
      const amountCents = Math.max(100, Math.round(amountNum * 100));

      processed += 1;

      const chargeRes = await stripe.chargeTenantInvoiceWithSavedPaymentMethod({
        clientId,
        tenantId,
        tenancyId: String(r.tenancy_id || ''),
        invoiceIds: [rentalId],
        amountCents,
        description: (r.title && String(r.title).slice(0, 200)) || 'Rent (auto)'
      });

      if (!chargeRes.ok) {
        errors.push({ id: rentalId, message: chargeRes.reason || 'CHARGE_FAILED' });
        continue;
      }
      charged += 1;
    } catch (e) {
      errors.push({ id: rentalId, message: e?.message || String(e) });
    }
  }

  return { enabled: true, processed, charged, skipped, errors };
}

module.exports = {
  runTenantStripeAutoDebitForDueRentals
};
