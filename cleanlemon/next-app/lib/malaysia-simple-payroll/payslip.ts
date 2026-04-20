import { calculatePayrollBreakdown } from "./calculate"
import type { EmployeeInput, MonthlySummary, PayslipData, StatutoryRates } from "./types"
import { SIMPLE_PAYROLL_WORKING_DAYS } from "./types"

export function buildPayslipData(
  input: EmployeeInput,
  options: {
    periodLabel: string
    currency?: string
    rates?: StatutoryRates
    workingDays?: number
    generatedAt?: Date
  }
): PayslipData {
  const b = calculatePayrollBreakdown(input, options.rates, options.workingDays ?? SIMPLE_PAYROLL_WORKING_DAYS)
  return {
    ...b,
    period_label: options.periodLabel,
    currency: options.currency ?? "MYR",
    generated_at_iso: (options.generatedAt ?? new Date()).toISOString(),
  }
}

export function buildMonthlySummary(
  employees: EmployeeInput[],
  options: {
    periodLabel: string
    currency?: string
    rates?: StatutoryRates
    workingDays?: number
  }
): MonthlySummary {
  const wd = options.workingDays ?? SIMPLE_PAYROLL_WORKING_DAYS
  const rates = options.rates
  const rows = employees.map((e) => {
    const b = calculatePayrollBreakdown(e, rates, wd)
    return {
      id: e.id,
      ...b,
    }
  })

  const sum = (fn: (r: (typeof rows)[0]) => number) => rows.reduce((a, r) => a + fn(r), 0)

  return {
    period_label: options.periodLabel,
    currency: options.currency ?? "MYR",
    employees: rows,
    totals: {
      gross_salary: Math.round(sum((r) => r.gross_salary) * 100) / 100,
      net_salary: Math.round(sum((r) => r.net_salary) * 100) / 100,
      epf_employee: Math.round(sum((r) => r.epf_employee) * 100) / 100,
      epf_employer: Math.round(sum((r) => r.epf_employer) * 100) / 100,
      socso_employee: Math.round(sum((r) => r.socso_employee) * 100) / 100,
      socso_employer: Math.round(sum((r) => r.socso_employer) * 100) / 100,
      eis_employee: Math.round(sum((r) => r.eis_employee) * 100) / 100,
      eis_employer: Math.round(sum((r) => r.eis_employer) * 100) / 100,
      total_employer_contributions: Math.round(sum((r) => r.total_employer_contributions) * 100) / 100,
    },
  }
}
