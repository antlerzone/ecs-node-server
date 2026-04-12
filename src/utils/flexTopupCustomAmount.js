/**
 * Operator flex top-up: four published card tiers (creditplan) and the same per-tier
 * unit rate for custom credit counts (by bracket).
 *
 * Brackets: [1,110) tier1, [110,300) tier2, [300,700) tier3, [700,∞) tier4
 * Card rows: 50↔100, 110↔200, 300↔500, 700↔1000 (local currency; MYR/SGD from operatordetail).
 */

const TIERS = [
  { credit: 50, price: 100 },
  { credit: 110, price: 200 },
  { credit: 300, price: 500 },
  { credit: 700, price: 1000 },
];

/**
 * @param {number} creditsInt floored whole credits >= 1
 * @returns {number|null} payment in local currency, 2 dp, or null if invalid
 */
function flexTopupCustomPayment(creditsInt) {
  const n = Math.floor(Number(creditsInt));
  if (!Number.isFinite(n) || n < 1 || n > 500000) return null;
  let unit;
  if (n < 110) unit = TIERS[0].price / TIERS[0].credit;
  else if (n < 300) unit = TIERS[1].price / TIERS[1].credit;
  else if (n < 700) unit = TIERS[2].price / TIERS[2].credit;
  else unit = TIERS[3].price / TIERS[3].credit;
  return Number((n * unit).toFixed(2));
}

function flexTopupUnitPerCredit(creditsInt) {
  const n = Math.floor(Number(creditsInt));
  const clamped = Number.isFinite(n) ? Math.min(Math.max(n, 1), 500000) : 1;
  if (clamped < 110) return TIERS[0].price / TIERS[0].credit;
  if (clamped < 300) return TIERS[1].price / TIERS[1].credit;
  if (clamped < 700) return TIERS[2].price / TIERS[2].credit;
  return TIERS[3].price / TIERS[3].credit;
}

module.exports = { flexTopupCustomPayment, flexTopupUnitPerCredit, FLEX_TOPUP_CARD_TIERS: TIERS };
