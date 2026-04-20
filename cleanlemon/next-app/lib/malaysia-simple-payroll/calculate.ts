import { DEFAULT_STATUTORY_RATES } from "./constants"
import type { EmployeeInput, PayrollBreakdown, StatutoryRates } from "./types"
import { SIMPLE_PAYROLL_WORKING_DAYS } from "./types"

export function roundMoney(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100
}

/**
 * gross_salary = basic_salary + allowance - unpaid_deduction
 * unpaid_deduction = (basic_salary / 26) * unpaid_leave_days
 */
export function calculatePayrollBreakdown(
  input: EmployeeInput,
  rates: StatutoryRates = DEFAULT_STATUTORY_RATES,
  workingDays: number = SIMPLE_PAYROLL_WORKING_DAYS
): PayrollBreakdown {
  const name = String(input.name ?? "").trim() || "Employee"
  const basic = roundMoney(Number(input.basic_salary) || 0)
  const allowance = roundMoney(Number(input.allowance) || 0)
  const unpaidDays = Math.max(0, Number(input.unpaid_leave_days) || 0)
  const wd = Math.max(1, workingDays)

  const dailyRate = roundMoney(basic / wd)
  const unpaidDeduction = roundMoney(dailyRate * unpaidDays)
  const grossSalary = roundMoney(basic + allowance - unpaidDeduction)

  const gross = Math.max(0, grossSalary)

  const epfBase = gross
  const epfEmployee = roundMoney(epfBase * rates.epfEmployeeRate)
  const employerRate =
    gross <= rates.epfEmployerTierThreshold
      ? rates.epfEmployerRateLowWage
      : rates.epfEmployerRateHighWage
  const epfEmployer = roundMoney(epfBase * employerRate)

  const socsoBase = Math.min(gross, rates.socsoCap)
  const socsoEmployee = roundMoney(socsoBase * rates.socsoEmployeeRate)
  const socsoEmployer = roundMoney(socsoBase * rates.socsoEmployerRate)

  const eisBase = Math.min(gross, rates.eisCap)
  const eisEmployee = roundMoney(eisBase * rates.eisEmployeeRate)
  const eisEmployer = roundMoney(eisBase * rates.eisEmployerRate)

  const totalEmployeeStatutory = roundMoney(epfEmployee + socsoEmployee + eisEmployee)
  const netSalary = roundMoney(grossSalary - totalEmployeeStatutory)
  const totalEmployerContributions = roundMoney(epfEmployer + socsoEmployer + eisEmployer)

  return {
    name,
    basic_salary: basic,
    allowance,
    working_days_per_month: wd,
    daily_rate: dailyRate,
    unpaid_leave_days: unpaidDays,
    unpaid_deduction: unpaidDeduction,
    gross_salary: grossSalary,
    epf_base: roundMoney(epfBase),
    epf_employee: epfEmployee,
    epf_employer_rate_applied: employerRate,
    epf_employer: epfEmployer,
    socso_base: roundMoney(socsoBase),
    socso_employee: socsoEmployee,
    socso_employer: socsoEmployer,
    eis_base: roundMoney(eisBase),
    eis_employee: eisEmployee,
    eis_employer: eisEmployer,
    total_employee_statutory: totalEmployeeStatutory,
    net_salary: netSalary,
    total_employer_contributions: totalEmployerContributions,
  }
}
