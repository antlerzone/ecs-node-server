/** Mirrors `src/utils/malaysia-flex-payroll.js` — Asia/Kuala_Lumpur payroll context in JSON. */

export type LateMode = "hourly" | "fixed" | "half_day"

export type ConditionalPolicy = "attendance_style" | "none"

export interface PayrollDefaultsJson {
  workingDaysPerMonth?: number
  hoursPerDay?: number
  lateMode?: LateMode
  fixedLateAmount?: number
  defaultConditionalPolicy?: ConditionalPolicy
  halfDayLateMinutesThreshold?: number
  businessTimeZone?: string
}

export interface PayrollInputsJson {
  lateMinutes?: number
  lateCount?: number
  unpaidLeaveDays?: number
  sourceContactId?: string
  sourceContactEmail?: string
  /** Cumulative MYR released via Mark as paid (Bukku Money Out / Xero bank spend) for this period row. */
  payoutReleasedTotal?: number
}

export type SalaryLineApprovalStatus = "pending" | "approved" | "rejected"

export interface SalaryLineMetaJson {
  allowanceType?: "fixed" | "conditional"
  conditionalPolicy?: ConditionalPolicy
  /** Only approved lines count toward payroll (pending/rejected excluded). Legacy rows without status count as approved. */
  approvalStatus?: SalaryLineApprovalStatus
}

export interface FlexPayrollAllowanceInput {
  name?: string
  amount: number
  allowanceType?: "fixed" | "conditional"
  conditionalPolicy?: ConditionalPolicy
}

export interface FlexPayrollDeductionInput {
  name?: string
  amount: number
}

export interface MalaysiaFlexPayrollResult {
  grossSalary: number
  totalDeductions: number
  netSalary: number
  breakdown: {
    basicSalary: number
    dailyRate: number
    hourlyRate: number
    late: {
      mode: LateMode
      lateMinutes: number
      lateCount: number
      amount: number
    }
    unpaidLeave: { days: number; amount: number }
    allowances: Array<{
      name: string
      allowanceType: "fixed" | "conditional"
      conditionalPolicy?: ConditionalPolicy
      nominalAmount: number
      effectiveAmount: number
    }>
    otherDeductions: Array<{ name: string; amount: number }>
    otherDeductionsTotal: number
  }
  configUsed: PayrollDefaultsJson & Record<string, unknown>
}
