/**
 * In-house **illustration only** — not legal/tax advice and not a substitute for
 * Talenox / payroll bureaus / official KWSP · PERKESO · LHDN schedules.
 * Rates and ceilings change; verify annually.
 */

export const IN_HOUSE_PAYROLL_ESTIMATE_NOTE =
  "Rough fill-in for EPF/EIS shape only. SOCSO uses wage tiers; MTD (PCB) needs LHDN rules and reliefs — use payslip or payroll software."

/** EIS: employee share is 0.2% of insured monthly remuneration (capped in law; use common cap for illustration). */
const EIS_INSURED_CAP_ILLUSTRATIVE = 5000
const EIS_EMPLOYEE_RATE = 0.002

/** EPF employee ordinary contribution — illustrative ceiling on wages (real rules are tiered by age and table year). */
const EPF_ORDINARY_WAGE_CAP_ILLUSTRATIVE = 6000
const EPF_EMPLOYEE_RATE_ILLUSTRATIVE = 0.11

export function estimateIllustrativeEmployeeEpfEis(grossMonthly: number): {
  epfAmount: number
  eisAmount: number
} {
  const g = Math.max(0, Number(grossMonthly) || 0)
  const epfBase = Math.min(g, EPF_ORDINARY_WAGE_CAP_ILLUSTRATIVE)
  const eisBase = Math.min(g, EIS_INSURED_CAP_ILLUSTRATIVE)
  return {
    epfAmount: Math.round(epfBase * EPF_EMPLOYEE_RATE_ILLUSTRATIVE * 100) / 100,
    eisAmount: Math.round(eisBase * EIS_EMPLOYEE_RATE * 100) / 100,
  }
}

/** Illustrative employer EPF (ordinary wage ceiling); not legal advice. */
const EPF_EMPLOYER_RATE_ILLUSTRATIVE = 0.12

/** Rough SOCSO split for UI display only (verify with PERKESO tables). */
const SOCSO_CAP_ILLUSTRATIVE = 5000
const SOCSO_EMPLOYEE_RATE_ILLUSTRATIVE = 0.005
const SOCSO_EMPLOYER_RATE_ILLUSTRATIVE = 0.0175

export function illustrativeEmployerEpf(grossMonthly: number): number {
  const g = Math.max(0, Number(grossMonthly) || 0)
  const epfBase = Math.min(g, EPF_ORDINARY_WAGE_CAP_ILLUSTRATIVE)
  return Math.round(epfBase * EPF_EMPLOYER_RATE_ILLUSTRATIVE * 100) / 100
}

export function illustrativeSocsoPair(grossMonthly: number): { employee: number; employer: number } {
  const g = Math.max(0, Number(grossMonthly) || 0)
  const base = Math.min(g, SOCSO_CAP_ILLUSTRATIVE)
  return {
    employee: Math.round(base * SOCSO_EMPLOYEE_RATE_ILLUSTRATIVE * 100) / 100,
    employer: Math.round(base * SOCSO_EMPLOYER_RATE_ILLUSTRATIVE * 100) / 100,
  }
}

/** EIS: employee and employer each 0.2% on insured remuneration (illustrative cap). */
export function illustrativeEisPair(grossMonthly: number): { employee: number; employer: number } {
  const g = Math.max(0, Number(grossMonthly) || 0)
  const eisBase = Math.min(g, EIS_INSURED_CAP_ILLUSTRATIVE)
  const x = Math.round(eisBase * EIS_EMPLOYEE_RATE * 100) / 100
  return { employee: x, employer: x }
}
