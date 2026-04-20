/**
 * Client-safe PDF helpers (jspdf runs in browser or Node with same API).
 */

import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { DISCLAIMER_SIMPLE_PAYROLL } from "./constants"
import type { MonthlySummary, PayslipData } from "./types"

type JsPdfWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } }

function finalY(doc: JsPdfWithAutoTable, fallback: number): number {
  return doc.lastAutoTable?.finalY ?? fallback
}

function fmt(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Returns PDF as Uint8Array (browser: use blob URL or download). */
export function generatePayslipPdf(data: PayslipData): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" }) as JsPdfWithAutoTable
  const margin = 14
  let y = margin

  doc.setFontSize(16)
  doc.text("Payslip", margin, y)
  y += 8
  doc.setFontSize(10)
  doc.text(`Period: ${data.period_label}`, margin, y)
  y += 5
  doc.text(`Generated: ${data.generated_at_iso.slice(0, 19)}Z`, margin, y)
  y += 8

  doc.setFontSize(12)
  doc.text(data.name, margin, y)
  y += 10

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Item", "Amount"]],
    body: [
      ["Basic salary", fmt(data.basic_salary, data.currency)],
      ["Allowance", fmt(data.allowance, data.currency)],
      ["Daily rate (÷ " + String(data.working_days_per_month) + ")", fmt(data.daily_rate, data.currency)],
      ["Unpaid leave (days)", String(data.unpaid_leave_days)],
      ["Unpaid deduction", "-" + fmt(data.unpaid_deduction, data.currency)],
      ["Gross salary", fmt(data.gross_salary, data.currency)],
      ["EPF (employee, 11%)", "-" + fmt(data.epf_employee, data.currency)],
      ["SOCSO (employee, 0.5% capped)", "-" + fmt(data.socso_employee, data.currency)],
      ["EIS (employee, 0.2% capped)", "-" + fmt(data.eis_employee, data.currency)],
      ["Total statutory (employee)", "-" + fmt(data.total_employee_statutory, data.currency)],
      ["Net salary", fmt(data.net_salary, data.currency)],
    ],
    theme: "striped",
    styles: { fontSize: 9 },
    headStyles: { fillColor: [41, 128, 185] },
  })

  const footY = finalY(doc, y + 60) + 10

  doc.setFontSize(9)
  doc.text("Employer contributions (informational)", margin, footY)
  footY += 6
  autoTable(doc, {
    startY: footY,
    margin: { left: margin, right: margin },
    head: [["Item", "Amount"]],
    body: [
      [
        `EPF employer (${(data.epf_employer_rate_applied * 100).toFixed(0)}%)`,
        fmt(data.epf_employer, data.currency),
      ],
      ["SOCSO employer (1.75% capped)", fmt(data.socso_employer, data.currency)],
      ["EIS employer (0.2% capped)", fmt(data.eis_employer, data.currency)],
      ["Total employer", fmt(data.total_employer_contributions, data.currency)],
    ],
    theme: "plain",
    styles: { fontSize: 8 },
  })

  const fy2 = finalY(doc, footY + 40)
  doc.setFontSize(7)
  doc.setTextColor(100, 100, 100)
  doc.text(DISCLAIMER_SIMPLE_PAYROLL, margin, fy2 + 8, { maxWidth: 180 })

  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer)
}

export function generateMonthlySummaryPdf(summary: MonthlySummary): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" }) as JsPdfWithAutoTable
  const margin = 10
  let y = margin

  doc.setFontSize(14)
  doc.text("Monthly payroll summary", margin, y)
  y += 7
  doc.setFontSize(10)
  doc.text(`Period: ${summary.period_label}`, margin, y)
  y += 10

  const body = summary.employees.map((r) => [
    r.name,
    fmt(r.gross_salary, summary.currency),
    fmt(r.epf_employee, summary.currency),
    fmt(r.socso_employee, summary.currency),
    fmt(r.eis_employee, summary.currency),
    fmt(r.net_salary, summary.currency),
    fmt(r.total_employer_contributions, summary.currency),
  ])

  body.push([
    "TOTAL",
    fmt(summary.totals.gross_salary, summary.currency),
    fmt(summary.totals.epf_employee, summary.currency),
    fmt(summary.totals.socso_employee, summary.currency),
    fmt(summary.totals.eis_employee, summary.currency),
    fmt(summary.totals.net_salary, summary.currency),
    fmt(summary.totals.total_employer_contributions, summary.currency),
  ])

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Name", "Gross", "EPF ee", "SOCSO ee", "EIS ee", "Net", "Employer total"]],
    body,
    theme: "striped",
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 128, 185] },
  })

  const fy = finalY(doc, y + 50)
  doc.setFontSize(7)
  doc.setTextColor(100, 100, 100)
  doc.text(DISCLAIMER_SIMPLE_PAYROLL, margin, fy + 8, { maxWidth: 270 })

  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer)
}

/** Browser helper: trigger download of a payslip PDF (not for SSR). */
export function downloadPayslipPdf(data: PayslipData, filename = "payslip.pdf"): void {
  if (typeof document === "undefined") return
  const bytes = generatePayslipPdf(data)
  const blob = new Blob([bytes], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadMonthlySummaryPdf(summary: MonthlySummary, filename = "payroll-summary.pdf"): void {
  if (typeof document === "undefined") return
  const bytes = generateMonthlySummaryPdf(summary)
  const blob = new Blob([bytes], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
