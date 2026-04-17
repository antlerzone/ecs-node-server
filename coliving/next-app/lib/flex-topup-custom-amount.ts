/** Keep bracket math in sync with `src/utils/flexTopupCustomAmount.js`. */

const TIERS = [
  { credit: 50, price: 100 },
  { credit: 110, price: 200 },
  { credit: 300, price: 500 },
  { credit: 700, price: 1000 },
] as const

/**
 * Custom flex credits: tier by count — &lt;110 → tier1, &lt;300 → tier2, &lt;700 → tier3, else tier4.
 */
export function flexTopupCustomPayment(creditsInt: number): number | null {
  const n = Math.floor(Number(creditsInt))
  if (!Number.isFinite(n) || n < 1 || n > 500000) return null
  let unit: number
  if (n < 110) unit = TIERS[0].price / TIERS[0].credit
  else if (n < 300) unit = TIERS[1].price / TIERS[1].credit
  else if (n < 700) unit = TIERS[2].price / TIERS[2].credit
  else unit = TIERS[3].price / TIERS[3].credit
  return Number((n * unit).toFixed(2))
}

/** Per-credit unit for the tier bracket that `creditsInt` falls into (for UI hints). */
export function flexTopupUnitPerCredit(creditsInt: number): number {
  const n = Math.floor(Number(creditsInt))
  const clamped = Number.isFinite(n) ? Math.min(Math.max(n, 1), 500000) : 1
  if (clamped < 110) return TIERS[0].price / TIERS[0].credit
  if (clamped < 300) return TIERS[1].price / TIERS[1].credit
  if (clamped < 700) return TIERS[2].price / TIERS[2].credit
  return TIERS[3].price / TIERS[3].credit
}

export const FLEX_TOPUP_CARD_TIERS = TIERS
