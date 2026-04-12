/**
 * Tenant payment fee model (Stripe Connect + Xendit platform flow):
 * - **SaaS markup:** fixed **1%** of gross (`PLATFORM_MARKUP_PERCENT`).
 * - **Payment gateway fee:** not fixed — e.g. local card vs foreign card (Stripe/Xendit actual MDR differs).
 *   Use **actual** fee from Stripe balance_transaction / settlement `net_amount` when available; otherwise env defaults for **estimates** only.
 *
 * Operator net ≈ gross − gatewayFee − SaaS markup (integer cents; rounding may differ by 1).
 */

const PLATFORM_MARKUP_PERCENT = 1;

/**
 * Stripe: default **estimated** gateway % for checkout UI / fallback when `balance_transaction.fee` is not yet available.
 * Override with env `STRIPE_ESTIMATE_GATEWAY_PERCENT` (e.g. 4.5).
 */
function getStripeEstimateGatewayPercent() {
  const raw = process.env.STRIPE_ESTIMATE_GATEWAY_PERCENT;
  const n = raw != null && String(raw).trim() !== '' ? Number(raw) : 4.5;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 4.5;
}

/**
 * Xendit: default **estimated** gateway % when building journal lines without `net_amount` (rare).
 * Override with `XENDIT_ESTIMATE_GATEWAY_PERCENT`.
 */
function getXenditEstimateGatewayPercent() {
  const raw = process.env.XENDIT_ESTIMATE_GATEWAY_PERCENT;
  const n = raw != null && String(raw).trim() !== '' ? Number(raw) : 4.5;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 4.5;
}

/**
 * @param {number} grossCents
 * @param {number} gatewayFeeCents - actual or estimated processor fee (Stripe/Xendit), not including SaaS markup
 * @returns {{ grossCents: number, transferToOperatorCents: number, gatewayFeeCents: number, saasMarkupCents: number }}
 */
function computeFeeSplitFromGrossGatewayAndMarkupCents(grossCents, gatewayFeeCents) {
  const g = Math.max(0, Math.round(Number(grossCents) || 0));
  const gw = Math.max(0, Math.round(Number(gatewayFeeCents) || 0));
  if (g <= 0) {
    return { grossCents: 0, transferToOperatorCents: 0, gatewayFeeCents: 0, saasMarkupCents: 0 };
  }
  const saasMarkupCents = Math.round((g * PLATFORM_MARKUP_PERCENT) / 100);
  const transferToOperatorCents = Math.max(0, g - gw - saasMarkupCents);
  return {
    grossCents: g,
    gatewayFeeCents: gw,
    saasMarkupCents,
    transferToOperatorCents
  };
}

/**
 * When gross and actual transfer to operator are known (aggregated payout / settlement): derive gateway as residual
 * so processing + SaaS + operator = gross (gateway = gross − transfer − 1% SaaS).
 * @param {number} grossCents
 * @param {number} transferToOperatorCents
 */
function computeResidualFeeSplitFromGrossAndTransferCents(grossCents, transferToOperatorCents) {
  const g = Math.max(0, Math.round(Number(grossCents) || 0));
  const t = Math.max(0, Math.round(Number(transferToOperatorCents) || 0));
  if (g <= 0) {
    return { grossCents: 0, transferToOperatorCents: t, gatewayFeeCents: 0, saasMarkupCents: 0 };
  }
  const saasMarkupCents = Math.round((g * PLATFORM_MARKUP_PERCENT) / 100);
  let gatewayFeeCents = g - t - saasMarkupCents;
  if (gatewayFeeCents < 0) gatewayFeeCents = 0;
  return {
    grossCents: g,
    transferToOperatorCents: t,
    gatewayFeeCents,
    saasMarkupCents
  };
}

/**
 * @deprecated Use `computeFeeSplitFromGrossGatewayAndMarkupCents` with an explicit gateway estimate, or residual split.
 * Kept for narrow compatibility: uses `getStripeEstimateGatewayPercent()` + 1% SaaS.
 */
function computePaymentFeeSplitFromGrossCents(grossCents) {
  const g = Math.max(0, Math.round(Number(grossCents) || 0));
  const gw = Math.round((g * getStripeEstimateGatewayPercent()) / 100);
  return computeFeeSplitFromGrossGatewayAndMarkupCents(g, gw);
}

/** Default transaction-fee % on Coliving SaaS Stripe Checkout for **SGD** only (single extra line on top of pricing). MYR uses **0%**. */
const COLIVING_SAAS_STRIPE_TRANSACTION_FEE_PERCENT_DEFAULT = 10;

/**
 * Coliving SaaS Stripe Checkout (SGD): **transaction fees** line as % of pricing subtotal.
 * Override with `COLIVING_SAAS_STRIPE_TRANSACTION_FEE_PERCENT`, or legacy `COLIVING_SAAS_STRIPE_ADMIN_FEE_PERCENT` (0–100). Empty = **10%**.
 * Not used for MYR (see {@link getColivingSaasStripeTransactionFeePercentForCurrency}).
 */
function getColivingSaasStripeTransactionFeePercent() {
  const raw =
    process.env.COLIVING_SAAS_STRIPE_TRANSACTION_FEE_PERCENT ?? process.env.COLIVING_SAAS_STRIPE_ADMIN_FEE_PERCENT;
  if (raw == null || String(raw).trim() === '') return COLIVING_SAAS_STRIPE_TRANSACTION_FEE_PERCENT_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : COLIVING_SAAS_STRIPE_TRANSACTION_FEE_PERCENT_DEFAULT;
}

/**
 * MYR: **0%** (no platform transaction-fee line). SGD: {@link getColivingSaasStripeTransactionFeePercent}.
 * If `stripeCurrency` is omitted/empty, returns the global configured percent (legacy / deprecated callers).
 * @param {string} [stripeCurrency] - `myr` or `sgd` (case-insensitive)
 */
function getColivingSaasStripeTransactionFeePercentForCurrency(stripeCurrency) {
  if (stripeCurrency == null || String(stripeCurrency).trim() === '') {
    return getColivingSaasStripeTransactionFeePercent();
  }
  const c = String(stripeCurrency).trim().toLowerCase();
  if (c === 'myr') return 0;
  if (c === 'sgd') return getColivingSaasStripeTransactionFeePercent();
  return getColivingSaasStripeTransactionFeePercent();
}

/** @deprecated Use {@link getColivingSaasStripeTransactionFeePercent} (same value). */
function getColivingSaasStripeAdminFeePercent() {
  return getColivingSaasStripeTransactionFeePercent();
}

/**
 * @deprecated No longer used; Coliving SaaS Checkout uses a single transaction-fee line. Returns 0.
 */
function getColivingSaasStripeProcessingPassThroughPercent() {
  return 0;
}

/**
 * Stripe line items: pricing (base), and for SGD only an extra transaction-fee line (% of base). MYR: single line (no fee).
 * @param {number} baseAmountCents - product amount only (plan / top-up subtotal)
 * @param {string} [stripeCurrency] - `myr` or `sgd`
 * @returns {{ baseCents: number, transactionFeeCents: number, totalCents: number, transactionFeePercent: number }}
 */
function computeColivingSaasStripeCheckoutBreakdown(baseAmountCents, stripeCurrency) {
  const base = Math.max(0, Math.round(Number(baseAmountCents) || 0));
  const pct = getColivingSaasStripeTransactionFeePercentForCurrency(stripeCurrency);
  let transactionFeeCents = 0;
  if (pct > 0 && base > 0) {
    transactionFeeCents = Math.round((base * pct) / 100);
  }
  const totalCents = base + transactionFeeCents;
  return {
    baseCents: base,
    transactionFeeCents,
    totalCents,
    transactionFeePercent: pct
  };
}

/**
 * @returns {{ adminFeeCents: number, totalCents: number, percent: number }} — adminFeeCents = combined transaction fee (name kept for compatibility).
 * @deprecated Prefer {@link computeColivingSaasStripeCheckoutBreakdown}.
 */
function computeColivingSaasStripeAdminFeeCents(baseAmountCents) {
  const br = computeColivingSaasStripeCheckoutBreakdown(baseAmountCents, undefined);
  return {
    adminFeeCents: br.transactionFeeCents,
    totalCents: br.totalCents,
    percent: br.transactionFeePercent
  };
}

module.exports = {
  PLATFORM_MARKUP_PERCENT,
  getStripeEstimateGatewayPercent,
  getXenditEstimateGatewayPercent,
  computeFeeSplitFromGrossGatewayAndMarkupCents,
  computeResidualFeeSplitFromGrossAndTransferCents,
  /** @deprecated */
  computePaymentFeeSplitFromGrossCents,
  getColivingSaasStripeTransactionFeePercent,
  getColivingSaasStripeTransactionFeePercentForCurrency,
  getColivingSaasStripeAdminFeePercent,
  getColivingSaasStripeProcessingPassThroughPercent,
  computeColivingSaasStripeCheckoutBreakdown,
  computeColivingSaasStripeAdminFeeCents
};
