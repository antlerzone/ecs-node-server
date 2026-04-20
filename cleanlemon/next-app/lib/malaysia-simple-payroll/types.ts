/**
 * Simplified Malaysia payroll types (in-house rules — verify against KWSP/PERKESO/LHDN for production).
 */

export const SIMPLE_PAYROLL_WORKING_DAYS = 26

export interface EmployeeInput {
  /** Optional id for monthly summary rows */
  id?: string
  name: string
  basic_salary: number
  allowance: number
  unpaid_leave_days: number
}

export interface StatutoryRates {
  epfEmployeeRate: number
  epfEmployerRateLowWage: number
  epfEmployerRateHighWage: number
  epfEmployerTierThreshold: number
  socsoCap: number
  socsoEmployeeRate: number
  socsoEmployerRate: number
  eisCap: number
  eisEmployeeRate: number
  eisEmployerRate: number
}

export interface PayrollBreakdown {
  name: string
  basic_salary: number
  allowance: number
  working_days_per_month: number
  daily_rate: number
  unpaid_leave_days: number
  unpaid_deduction: number
  gross_salary: number
  /** Subject to statutory caps where applicable */
  epf_base: number
  epf_employee: number
  epf_employer_rate_applied: number
  epf_employer: number
  socso_base: number
  socso_employee: number
  socso_employer: number
  eis_base: number
  eis_employee: number
  eis_employer: number
  total_employee_statutory: number
  net_salary: number
  total_employer_contributions: number
}

export interface PayslipData extends PayrollBreakdown {
  period_label: string
  currency: string
  generated_at_iso: string
}

export type MonthlySummaryRow = PayrollBreakdown & { id?: string }

export interface MonthlySummary {
  period_label: string
  currency: string
  employees: MonthlySummaryRow[]
  totals: {
    gross_salary: number
    net_salary: number
    epf_employee: number
    epf_employer: number
    socso_employee: number
    socso_employer: number
    eis_employee: number
    eis_employer: number
    total_employer_contributions: number
  }
}
