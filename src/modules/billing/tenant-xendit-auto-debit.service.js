/**
 * Daily cron: charge due unpaid rentalcollection via saved Xendit payment token (card or bank_dd MIT).
 * Guarded by ENABLE_TENANT_XENDIT_AUTO_DEBIT and tenantdetail.profile.xendit_auto_debit === true.
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
 * @returns {{ processed: number, charged: number, skipped: Array<{ id: string, reason: string }>, errors: Array<{ id: string, message: string }>, enabled: boolean }}
 */
async function runTenantXenditAutoDebitForDueRentals() {
  const enabled =
    process.env.ENABLE_TENANT_XENDIT_AUTO_DEBIT === '1' || process.env.ENABLE_TENANT_XENDIT_AUTO_DEBIT === 'true';
  if (!enabled) {
    return { enabled: false, processed: 0, charged: 0, skipped: [], errors: [] };
  }

  const today = getTodayMalaysiaDate();
  const maxAttempts = Math.min(
    500,
    Math.max(1, Number(process.env.TENANT_XENDIT_AUTO_DEBIT_MAX_PER_RUN || 30) || 30)
  );

  const [rows] = await pool.query(
    `SELECT r.id, r.tenancy_id, r.client_id, r.tenant_id, r.amount, r.date, r.title
     FROM rentalcollection r
     WHERE r.ispaid = 0 AND DATE(r.date) <= ?
     ORDER BY r.date ASC, r.id ASC
     LIMIT 500`,
    [today]
  );

  const payex = require('../payex/payex.service');
  const skipped = [];
  const errors = [];
  let processed = 0;
  let charged = 0;

  /** @type {Map<string, object>} */
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
      if (gw.provider !== 'payex') {
        skipped.push({ id: rentalId, reason: 'gateway_not_payex' });
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

      if (!profile.payment_method_linked || !profile.xendit_payment_token_id) {
        skipped.push({ id: rentalId, reason: 'no_xendit_token' });
        continue;
      }

      const bindType = profile.xendit_bind_type === 'bank_dd' ? 'bank_dd' : 'card';
      const tokenId = String(profile.xendit_payment_token_id).trim();
      const amountNum = Number(r.amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        skipped.push({ id: rentalId, reason: 'invalid_amount' });
        continue;
      }
      const amountCents = Math.max(100, Math.round(amountNum * 100));

      const referenceId = `auto-${rentalId}-${Date.now()}`;
      processed += 1;

      const chargeRes = await payex.chargeWithXenditPaymentToken(clientId, {
        paymentTokenId: tokenId,
        amountCents,
        referenceId,
        description: (r.title && String(r.title).slice(0, 200)) || 'Rent',
        bindType,
        metadata: {
          type: 'TenantInvoiceAutoDebit',
          rental_id: String(rentalId),
          tenancy_id: String(r.tenancy_id || ''),
          tenant_id: String(tenantId)
        }
      });

      if (!chargeRes.ok || !chargeRes.data) {
        errors.push({
          id: rentalId,
          message: chargeRes.reason || 'CHARGE_FAILED'
        });
        continue;
      }

      if (!payex.isPaymentRequestSucceededSync(chargeRes.data)) {
        skipped.push({
          id: rentalId,
          reason: `payment_not_succeeded_sync:${String(chargeRes.data.status || '')}`
        });
        continue;
      }

      const fin = await payex.finalizeRentalCollectionAfterTokenCharge(clientId, [rentalId], {
        paymentRequestData: chargeRes.data,
        amountCents,
        referenceId
      });
      if (fin.marked > 0) charged += 1;
      else skipped.push({ id: rentalId, reason: 'no_row_updated' });
    } catch (e) {
      errors.push({ id: rentalId, message: e?.message || String(e) });
    }
  }

  return { enabled: true, processed, charged, skipped, errors };
}

module.exports = {
  runTenantXenditAutoDebitForDueRentals
};
