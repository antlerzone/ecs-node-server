import { estimateIllustrativeEmployeeEpfEis } from "./malaysia-payroll-estimate"

/**
 * Non-authoritative placeholders for UI hints only.
 * Real MTD/EPF/SOCSO/EIS depend on LHDN/KWSP/PERKESO tables, age, category, and payroll software.
 */
export const STATUTORY_AMOUNT_DISCLAIMER =
  "Accurate amounts come from your payroll (e.g. Talenox) or official tables. Below is optional illustration only."

export function roughIllustrativeAmounts(baseSalary: number): {
  epfAmount: number
  eisAmount: number
} {
  return estimateIllustrativeEmployeeEpfEis(baseSalary)
}
