/**
 * Simplified Malaysia payroll (TypeScript).
 *
 * - Earnings: basic + allowance − unpaid leave (daily rate = basic ÷ 26).
 * - Statutory: EPF / SOCSO / EIS per brief (simplified; verify for production).
 *
 * @example
 * ```ts
 * import { calculatePayrollBreakdown, buildPayslipData, buildMonthlySummary } from "@/lib/malaysia-simple-payroll"
 *
 * const row = calculatePayrollBreakdown({
 *   name: "Ali",
 *   basic_salary: 4000,
 *   allowance: 200,
 *   unpaid_leave_days: 1,
 * })
 *
 * const payslip = buildPayslipData(
 *   { name: "Ali", basic_salary: 4000, allowance: 200, unpaid_leave_days: 1 },
 *   { periodLabel: "2026-04" }
 * )
 * ```
 */

export {
  DEFAULT_STATUTORY_RATES,
  DISCLAIMER_SIMPLE_PAYROLL,
} from "./constants"
export { calculatePayrollBreakdown, roundMoney } from "./calculate"
export { buildPayslipData, buildMonthlySummary } from "./payslip"
export {
  generatePayslipPdf,
  generateMonthlySummaryPdf,
  downloadPayslipPdf,
  downloadMonthlySummaryPdf,
} from "./pdf"
export type {
  EmployeeInput,
  MonthlySummary,
  MonthlySummaryRow,
  PayslipData,
  PayrollBreakdown,
  StatutoryRates,
} from "./types"
export { SIMPLE_PAYROLL_WORKING_DAYS } from "./types"
