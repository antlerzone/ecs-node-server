import type { StatutoryRates } from "./types"

/** Default statutory parameters matching the product brief (verify annually). */
export const DEFAULT_STATUTORY_RATES: StatutoryRates = {
  epfEmployeeRate: 0.11,
  epfEmployerRateLowWage: 0.13,
  epfEmployerRateHighWage: 0.12,
  epfEmployerTierThreshold: 5000,
  socsoCap: 6000,
  socsoEmployeeRate: 0.005,
  socsoEmployerRate: 0.0175,
  eisCap: 5000,
  eisEmployeeRate: 0.002,
  eisEmployerRate: 0.002,
}

export const DISCLAIMER_SIMPLE_PAYROLL =
  "Simplified in-house calculation — not legal advice. Confirm rates, ceilings, and bases with KWSP, PERKESO, and LHDN / your payroll software."
