"use client"
// Operator Report: Tab 1 = Generate Report (select properties + date → generate). Tab 2 = View old reports (list, detail, mark as paid, delete, download).

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { BarChart3, Download, Search, FileText, DollarSign, Settings2, MoreHorizontal, Receipt, ScrollText } from "lucide-react"
import { portalHttpsAssetUrl, toDrivePreviewUrl } from "@/lib/utils"
import {
  getReportProperties,
  getOwnerReports,
  getOwnerReportsTotal,
  getBankBulkTransferBanks,
  getBankBulkTransferDownloadUrl,
  getOwnerReportsPdfDownloadUrl,
  getOwnerReportPdfDownloadUrlInline,
  getOnboardStatus,
  getOwnerReportSettings,
  saveOwnerReportSettings,
  updateOwnerReport,
  bulkUpdateOwnerReport,
  deleteOwnerReport,
  voidOwnerReportPayment,
  linkOwnerReportBukkuUrls,
  generateOwnerPayout,
  insertOwnerReport,
  generateAndUploadOwnerReportPdf,
} from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import {
  getTodayMalaysiaYmd,
  getPreviousMonthRangeMalaysiaYmd,
  utcInstantToMalaysiaYmd,
} from "@/lib/dateMalaysia"
import { toast } from "@/hooks/use-toast"

const REPORTS_LIMIT = 500

/** Owner report invoice-type keys (aligned with backend REPORT_CLASSIFICATION_KEYS). */
const REPORT_CLASSIFICATION_OPTIONS: { key: string; label: string }[] = [
  { key: "rental_income", label: "Rental Income" },
  { key: "forfeit_deposit", label: "Forfeit Deposit" },
  { key: "parking_fees", label: "Parking Fees" },
  { key: "deposit", label: "Deposit" },
  { key: "agreement_fees", label: "Agreement Fees" },
  { key: "tenant_commission", label: "Tenant Commission" },
  { key: "management_fees", label: "Management Fees (tenant invoice line)" },
  { key: "owner_commission", label: "Owner Commission" },
  { key: "meter_topup", label: "Meter / Aircond Topup" },
]

const STANDARD_REPORT_INCOME_KEYS = ["rental_income", "forfeit_deposit", "parking_fees", "meter_topup"]
const STANDARD_REPORT_EXPENSE_KEYS = ["owner_commission"]

function getDefaultReportDateRange() {
  return getPreviousMonthRangeMalaysiaYmd()
}

function formatDateDisplay(isoOrStr: string | undefined): string {
  if (!isoOrStr) return ""
  const ymd = utcInstantToMalaysiaYmd(isoOrStr)
  if (!ymd) return String(isoOrStr)
  try {
    return new Date(`${ymd}T12:00:00+08:00`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kuala_Lumpur",
    })
  } catch {
    return ymd
  }
}

type ReportItem = {
  id: string
  month?: string
  title?: string
  property?: string
  propertyId?: string
  owners?: number
  totalPayout?: number
  totalrental?: number
  totalutility?: number
  totalcollection?: number
  expenses?: number
  /** Deduction to owner: % of rental (management) or fixed rent to owner (rental unit) — same column in DB */
  managementfee?: number
  paid?: boolean
  paymentDate?: string | null
  paymentMethod?: string | null
  bukkuinvoice?: string | null
  bukkubills?: string | null
  monthlyreport?: string | null
}

type TabId = "generate" | "history"
type GenerateViewMode = "month" | "property"
type GenerateActionMode = "each_month" | "all_month"

type GenerateRow = {
  key: string
  propertyId: string
  propertyName: string
  startDate: string
  endDate: string
  monthLabel: string
}

function parseYmdParts(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Inclusive month buckets between two Malaysia calendar YYYY-MM-DD bounds (from operator date inputs). */
function monthRangesBetween(from: string, to: string): Array<{ start: string; end: string; label: string }> {
  const fa = parseYmdParts(from)
  const ta = parseYmdParts(to)
  if (!fa || !ta) return []
  let y = fa[0]
  let mo = fa[1]
  const endY = ta[0]
  const endM = ta[1]
  if (y > endY || (y === endY && mo > endM)) return []
  const out: Array<{ start: string; end: string; label: string }> = []
  while (y < endY || (y === endY && mo <= endM)) {
    const start = `${y}-${String(mo).padStart(2, "0")}-01`
    const lastDay = new Date(y, mo, 0).getDate()
    const end = `${y}-${String(mo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    const label = new Date(`${start}T12:00:00+08:00`).toLocaleString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kuala_Lumpur",
    })
    out.push({ start, end, label })
    mo += 1
    if (mo > 12) {
      mo = 1
      y += 1
    }
  }
  return out
}

function monthYearLabel(dateStr: string): string {
  const t = String(dateStr || "").trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return dateStr
  return new Date(`${t}T12:00:00+08:00`).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  })
}

/** Backend reason codes from generate-payout → readable text for operators */
function formatOwnerReportError(message: string): string {
  const m = String(message || "").trim()
  if (m === "PROPERTY_PERCENTAGE_REQUIRED") {
    return "Set the management fee % on this property (Property → Edit utility)."
  }
  if (m === "PROPERTY_FIXED_RENT_TO_OWNER_REQUIRED") {
    return "Set the fixed monthly rent to owner on this property (Property → Edit utility)."
  }
  if (m === "PROPERTY_NOT_FOUND") {
    return "Property not found."
  }
  return m
}

export default function ReportPage() {
  const { accessCtx } = useOperatorContext()
  const currencyCode = String(accessCtx?.client?.currency || "").trim().toUpperCase()
  const currencySymbol = currencyCode === "SGD" ? "S$" : currencyCode === "MYR" ? "RM" : currencyCode
  const hasBankBulkTransferAddon = useMemo(() => {
    const cap = accessCtx?.capability as { bankBulkTransfer?: boolean } | undefined
    if (typeof cap?.bankBulkTransfer === "boolean") return cap.bankBulkTransfer
    const addons = (accessCtx?.plan as { addons?: Array<{ title?: string | null }> } | undefined)?.addons ?? []
    return addons.some((a) => {
      const title = String(a?.title ?? "").toLowerCase()
      return title.includes("bank bulk transfer")
    })
  }, [accessCtx?.plan])
  const ecsBase = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
  const toPreviewUrl = (url: string | null | undefined) => toDrivePreviewUrl(portalHttpsAssetUrl(url, ecsBase))
  /** Same as owner/agreement “Open final agreement”: Drive-friendly /view, OSS https, new tab. */
  const openReportPreviewUrl = (url: string | null | undefined) => {
    const normalized = toPreviewUrl(url)
    if (!normalized.startsWith("http")) return
    window.open(normalized, "_blank", "noopener,noreferrer")
  }
  const isPersistedReportDocumentUrl = (u: string) => {
    const s = u.trim()
    if (!s || !/^https?:\/\//i.test(s)) return false
    if (/\/api\/download\//i.test(s)) return false
    return true
  }

  const [tab, setTab] = useState<TabId>("generate")

  // ─── Generate Report tab: repeater of properties, checkbox + Preview; Generate = insert + upload PDF, Download = insert + download PDF ───
  const [properties, setProperties] = useState<Array<{ id: string; shortname?: string }>>([])
  const [grDateFrom, setGrDateFrom] = useState(() => getDefaultReportDateRange().from)
  const [grDateTo, setGrDateTo] = useState(() => getDefaultReportDateRange().to)
  const [generateViewMode, setGenerateViewMode] = useState<GenerateViewMode>("month")
  const [generateActionMode, setGenerateActionMode] = useState<GenerateActionMode>("each_month")
  const [selectedGRKeys, setSelectedGRKeys] = useState<string[]>([])
  const [grRunning, setGrRunning] = useState(false)
  const [grMessage, setGrMessage] = useState("")
  // Preview dialog: payout rows (no, description, amount) + totals
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewProperty, setPreviewProperty] = useState<{ id: string; shortname?: string; monthLabel?: string } | null>(null)
  const [previewRows, setPreviewRows] = useState<Array<{ no: string; description: string; amount: string }>>([])
  const [previewTotals, setPreviewTotals] = useState<{
    totalrental?: number
    totalutility?: number
    totalcollection?: number
    expenses?: number
    managementfee?: number
    netpayout?: number
  } | null>(null)
  /** Operator net profit / management fee per generate row (from generate-payout). */
  const [grNetProfitByKey, setGrNetProfitByKey] = useState<Record<string, number | "loading" | "error">>({})

  useEffect(() => {
    getReportProperties().then((res) => {
      const items = ((res as { items?: Array<{ id: string; shortname?: string }> })?.items || []) as Array<{ id: string; shortname?: string }>
      setProperties(items)
    }).catch(() => {})
  }, [])

  const allGenerateRows: GenerateRow[] = useMemo(() => {
    if (generateViewMode === "property") {
      return properties.map((p) => ({
        key: `${p.id}|${grDateFrom}|${grDateTo}|all`,
        propertyId: p.id,
        propertyName: p.shortname ?? p.id,
        startDate: grDateFrom,
        endDate: grDateTo,
        monthLabel: `${grDateFrom} - ${grDateTo}`,
      }))
    }
    const months = monthRangesBetween(grDateFrom, grDateTo)
    return properties.flatMap((p) =>
      months.map((m) => ({
        key: `${p.id}|${m.start}|${m.end}`,
        propertyId: p.id,
        propertyName: p.shortname ?? p.id,
        startDate: m.start,
        endDate: m.end,
        monthLabel: m.label,
      }))
    )
  }, [generateViewMode, grDateFrom, grDateTo, properties])

  useEffect(() => {
    if (tab !== "generate") return
    const rows = allGenerateRows
    if (rows.length === 0) {
      setGrNetProfitByKey({})
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      const initial: Record<string, "loading"> = {}
      for (const r of rows) initial[r.key] = "loading"
      setGrNetProfitByKey(initial)
      const concurrency = 4
      let nextIndex = 0
      const worker = async () => {
        while (!cancelled) {
          const idx = nextIndex++
          if (idx >= rows.length) break
          const row = rows[idx]
          try {
            const payout = await generateOwnerPayout(row.propertyId, row.propertyName, row.startDate, row.endDate)
            if (cancelled) return
            const v = Number(payout?.managementfee ?? 0)
            setGrNetProfitByKey((prev) => ({ ...prev, [row.key]: v }))
          } catch {
            if (cancelled) return
            setGrNetProfitByKey((prev) => ({ ...prev, [row.key]: "error" }))
          }
        }
      }
      void Promise.all(Array.from({ length: concurrency }, () => worker()))
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [tab, allGenerateRows])

  const openPreview = async (row: GenerateRow) => {
    setPreviewProperty({ id: row.propertyId, shortname: row.propertyName, monthLabel: row.monthLabel })
    setPreviewOpen(true)
    setPreviewLoading(true)
    setPreviewRows([])
    setPreviewTotals(null)
    try {
      const payout = await generateOwnerPayout(row.propertyId, row.propertyName, row.startDate, row.endDate)
      const rows = (payout?.rows ?? []) as Array<{ no?: unknown; description?: unknown; amount?: unknown }>
      setPreviewRows(rows.map((r) => ({
        no: r.no != null ? String(r.no) : "",
        description: r.description != null ? String(r.description) : "",
        amount: r.amount != null ? String(r.amount) : "",
      })))
      setPreviewTotals({
        totalrental: payout?.totalrental,
        totalutility: payout?.totalutility,
        totalcollection: payout?.totalcollection,
        expenses: payout?.expenses,
        managementfee: payout?.managementfee,
        netpayout: payout?.netpayout,
      })
      setGrNetProfitByKey((prev) => ({
        ...prev,
        [row.key]: Number(payout?.managementfee ?? 0),
      }))
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Failed to load preview"
      setPreviewRows([{ no: "", description: formatOwnerReportError(raw), amount: "" }])
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleGRGenerate = async () => {
    if (selectedGRKeys.length === 0) {
      setGrMessage("Select at least one property (checkbox).")
      return
    }
    setGrRunning(true)
    setGrMessage("")
    const noFolderNames: string[] = []
    const failedRows: string[] = []
    let successCount = 0
    try {
      const selectedRows = allGenerateRows.filter((r) => selectedGRKeys.includes(r.key))
      const rowsToGenerate = (generateViewMode === "property" && generateActionMode === "each_month")
        ? selectedRows.flatMap((r) => {
            const months = monthRangesBetween(r.startDate, r.endDate)
            return months.map((m) => ({
              ...r,
              key: `${r.propertyId}|${m.start}|${m.end}`,
              startDate: m.start,
              endDate: m.end,
              monthLabel: m.label,
            }))
          })
        : selectedRows

      for (const row of rowsToGenerate) {
        try {
          const payout = await generateOwnerPayout(row.propertyId, row.propertyName, row.startDate, row.endDate)
          const spanMonths = monthRangesBetween(row.startDate, row.endDate).length
          const isMultiMonth = spanMonths > 1
          const monthName = new Date(`${row.startDate}T12:00:00+08:00`).toLocaleString("en-US", {
            month: "long",
            timeZone: "Asia/Kuala_Lumpur",
          })
          const year = Number(row.startDate.slice(0, 4))
          // Use period end-date for range reports so default History month filter can find latest generated range.
          const periodDate = isMultiMonth ? row.endDate : row.startDate
          const period = new Date(`${periodDate}T12:00:00+08:00`).toISOString()
          const title = isMultiMonth
            ? `${monthYearLabel(row.startDate)} - ${monthYearLabel(row.endDate)} ${row.propertyName}`
            : `${monthName} ${year} ${row.propertyName}`
          setGrNetProfitByKey((prev) => ({
            ...prev,
            [row.key]: Number(payout?.managementfee ?? 0),
          }))
          const inserted = await insertOwnerReport({
            property: row.propertyId,
            period,
            title,
            totalrental: payout?.totalrental ?? 0,
            totalutility: payout?.totalutility ?? 0,
            totalcollection: payout?.totalcollection ?? 0,
            expenses: payout?.expenses ?? 0,
            managementfee: payout?.managementfee ?? 0,
            netpayout: payout?.netpayout ?? 0,
          })
          const recordId = (inserted as { record?: { _id?: string } })?.record?._id
          if (recordId) {
            try {
              await generateAndUploadOwnerReportPdf(recordId, {
                startDate: row.startDate,
                endDate: row.endDate
              })
            } catch (e) {
              const msg = String((e as Error)?.message ?? "")
              if (msg.includes("PROPERTY_FOLDER_NOT_SET") || msg.includes("FOLDER")) {
                noFolderNames.push(row.propertyName || row.propertyId)
              }
            }
          }
          successCount += 1
        } catch (e) {
          const msg = formatOwnerReportError(e instanceof Error ? e.message : "Generate failed")
          failedRows.push(`${row.monthLabel} ${row.propertyName}: ${msg}`)
        }
      }
      const base = `Attempted ${rowsToGenerate.length}, success ${successCount}, failed ${failedRows.length}.`
      const folderMsg = noFolderNames.length > 0 ? ` No folder set for: ${[...new Set(noFolderNames)].join(", ")}.` : ""
      const failMsg = failedRows.length > 0 ? ` Failed: ${failedRows.slice(0, 4).join(" | ")}${failedRows.length > 4 ? " ..." : ""}` : ""
      setGrMessage(`${base}${folderMsg}${failMsg}`.trim())
      setSelectedGRKeys([])
    } catch (e) {
      setGrMessage(e instanceof Error ? e.message : "Generate failed")
    } finally {
      setGrRunning(false)
    }
  }

  const handleGRDownload = async () => {
    if (selectedGRKeys.length === 0) {
      setGrMessage("Select at least one property (checkbox).")
      return
    }
    setGrRunning(true)
    setGrMessage("")
    try {
      const selectedRows = allGenerateRows.filter((r) => selectedGRKeys.includes(r.key))
      const rowsToDownload = (generateViewMode === "property" && generateActionMode === "each_month")
        ? selectedRows.flatMap((r) => {
            const months = monthRangesBetween(r.startDate, r.endDate)
            return months.map((m) => ({ ...r, startDate: m.start, endDate: m.end, monthLabel: m.label }))
          })
        : selectedRows
      for (const row of rowsToDownload) {
        const res = await getOwnerReportPdfDownloadUrlInline(row.propertyId, row.propertyName, row.startDate, row.endDate)
        if (res?.downloadUrl) window.open(res.downloadUrl, "_blank")
      }
      setGrMessage("PDF download(s) opened. No data written to table.")
      setSelectedGRKeys([])
    } catch (e) {
      setGrMessage(formatOwnerReportError(e instanceof Error ? e.message : "Download failed"))
    } finally {
      setGrRunning(false)
    }
  }

  const toggleGRRow = (key: string) => {
    setSelectedGRKeys((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    )
  }

  const selectAllGR = () => {
    if (selectedGRKeys.length === allGenerateRows.length) setSelectedGRKeys([])
    else setSelectedGRKeys(allGenerateRows.map((r) => r.key))
  }

  // ─── Reports History tab ───────────────────────────────────────────────
  const [selectedReports, setSelectedReports] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [filterProperty, setFilterProperty] = useState("all")
  const [filterType, setFilterType] = useState<string>("all")
  const [sort, setSort] = useState("new")
  const [dateFrom, setDateFrom] = useState(() => getDefaultReportDateRange().from)
  const [dateTo, setDateTo] = useState(() => getDefaultReportDateRange().to)
  const [reports, setReports] = useState<ReportItem[]>([])
  const [loading, setLoading] = useState(false)
  const [banks, setBanks] = useState<Array<{ label: string; value: string }>>([])
  const [selectedBank, setSelectedBank] = useState("")
  const [bankDownloadLoading, setBankDownloadLoading] = useState(false)
  const [showBankFileDialog, setShowBankFileDialog] = useState(false)
  const [selectedTotal, setSelectedTotal] = useState<{ count: number; total: number } | null>(null)
  const [detailReport, setDetailReport] = useState<ReportItem | null>(null)
  const [showPayDialog, setShowPayDialog] = useState(false)
  const [payMode, setPayMode] = useState<"single" | "bulk">("single")
  const [payDate, setPayDate] = useState(() => getTodayMalaysiaYmd())
  const [payMethod, setPayMethod] = useState<"Bank" | "Cash">("Bank")
  const [paySaving, setPaySaving] = useState(false)
  const [bukkuLinkLoading, setBukkuLinkLoading] = useState(false)
  const [reportSettingsOpen, setReportSettingsOpen] = useState(false)
  const [reportSettingsSaving, setReportSettingsSaving] = useState(false)
  const [defaultCarryNegativeForward, setDefaultCarryNegativeForward] = useState(true)
  const [automationEnabled, setAutomationEnabled] = useState(false)
  const [automationDay, setAutomationDay] = useState("5")
  const [reportClassificationMode, setReportClassificationMode] = useState<"standard" | "customize">("standard")
  const [customIncomeKeys, setCustomIncomeKeys] = useState<string[]>(() => [...STANDARD_REPORT_INCOME_KEYS])
  const [customExpenseKeys, setCustomExpenseKeys] = useState<string[]>(() => [...STANDARD_REPORT_EXPENSE_KEYS])
  const [customizeClassificationOpen, setCustomizeClassificationOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [accountingConnected, setAccountingConnected] = useState(false)

  useEffect(() => {
    getOnboardStatus().then((os) => {
      const o = os as { accountingConnected?: boolean }
      setAccountingConnected(!!o?.accountingConnected)
    }).catch(() => setAccountingConnected(false))
  }, [])

  useEffect(() => {
    getOwnerReportSettings()
      .then((res) => {
        const settings = ((res as {
          settings?: {
            defaultCarryNegativeForward?: boolean
            automationEnabled?: boolean
            automationDay?: number
            reportClassificationMode?: "standard" | "customize"
            reportIncomeKeys?: string[]
            reportExpenseKeys?: string[]
          }
        })?.settings ?? {})
        setDefaultCarryNegativeForward(settings.defaultCarryNegativeForward !== false)
        setAutomationEnabled(settings.automationEnabled === true)
        const d = Number(settings.automationDay ?? 5)
        if (Number.isFinite(d)) {
          setAutomationDay(String(Math.max(1, Math.min(31, Math.floor(d)))))
        }
        setReportClassificationMode(settings.reportClassificationMode === "customize" ? "customize" : "standard")
        const inc = settings.reportIncomeKeys
        const exp = settings.reportExpenseKeys
        if (Array.isArray(inc) && inc.length > 0) setCustomIncomeKeys([...new Set(inc)])
        else setCustomIncomeKeys([...STANDARD_REPORT_INCOME_KEYS])
        if (Array.isArray(exp) && exp.length > 0) setCustomExpenseKeys([...new Set(exp)])
        else setCustomExpenseKeys([...STANDARD_REPORT_EXPENSE_KEYS])
      })
      .catch(() => {})
  }, [])

  const loadReports = useCallback(async () => {
    setLoading(true)
    try {
      const defaultRange = getDefaultReportDateRange()
      const from = (dateFrom && dateFrom.trim()) ? dateFrom : defaultRange.from
      const to = (dateTo && dateTo.trim()) ? dateTo : defaultRange.to
      const [propsRes, reportsRes] = await Promise.all([
        getReportProperties(),
        getOwnerReports({
          property: filterProperty !== "all" ? filterProperty : undefined,
          from,
          to,
          type: filterType !== "all" ? filterType : undefined,
          sort,
          limit: REPORTS_LIMIT,
        }),
      ])
      const props = ((propsRes as { items?: Array<{ id: string; shortname?: string }> })?.items || []) as Array<{ id: string; shortname?: string }>
      setProperties(props)
      const items = (reportsRes?.items || []) as Array<Record<string, unknown>>
      setReports(items.map((r) => ({
        id: String(r.id ?? r._id ?? ""),
        month: r.period ? String(r.period) : undefined,
        title: r.title != null ? String(r.title) : undefined,
        property: (r.property as { shortname?: string })?.shortname ?? undefined,
        propertyId: (r.property as { id?: string; _id?: string })?.id ?? (r.property as { _id?: string })?._id ?? undefined,
        owners: r.ownerCount != null ? Number(r.ownerCount) : undefined,
        totalPayout: r.netpayout != null ? Number(r.netpayout) : undefined,
        totalrental: r.totalrental != null ? Number(r.totalrental) : undefined,
        totalutility: r.totalutility != null ? Number(r.totalutility) : undefined,
        totalcollection: r.totalcollection != null ? Number(r.totalcollection) : undefined,
        expenses: r.expenses != null ? Number(r.expenses) : undefined,
        managementfee: r.managementfee != null ? Number(r.managementfee) : undefined,
        paid: !!r.paid,
        paymentDate: r.paymentDate != null ? utcInstantToMalaysiaYmd(String(r.paymentDate)) || null : null,
        paymentMethod: r.paymentMethod != null ? String(r.paymentMethod) : null,
        bukkuinvoice: (r.bukkuinvoice as string) || null,
        bukkubills: (r.bukkubills as string) || null,
        monthlyreport: (r.monthlyreport as string) || null,
      })))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [filterProperty, filterType, dateFrom, dateTo, sort])

  useEffect(() => {
    if (tab === "history") loadReports()
  }, [tab, loadReports])

  useEffect(() => {
    if (selectedReports.length === 0) {
      setSelectedTotal(null)
      return
    }
    getOwnerReportsTotal(selectedReports).then((res) => {
      setSelectedTotal({ count: res?.count ?? selectedReports.length, total: res?.total ?? 0 })
    }).catch(() => setSelectedTotal(null))
  }, [selectedReports])

  useEffect(() => {
    if (tab === "history" && selectedReports.length > 0 && banks.length === 0) {
      getBankBulkTransferBanks().then((res) => {
        const list = (res as { banks?: Array<{ label: string; value: string }> })?.banks ?? []
        setBanks(list.length ? list : [{ label: "Public Bank MY", value: "publicbank" }])
        if (list.length > 0 && !selectedBank) setSelectedBank(list[0].value)
        else if (!selectedBank) setSelectedBank("publicbank")
      }).catch(() => {})
    }
  }, [tab, selectedReports.length])

  const openBankFileDialog = () => {
    if (!hasBankBulkTransferAddon) {
      alert("Bank Bulk Transfer addon is required. Please upgrade your plan.")
      return
    }
    if (!selectedBank) setSelectedBank("publicbank")
    setShowBankFileDialog(true)
    if (banks.length === 0) {
      getBankBulkTransferBanks().then((res) => {
        const list = (res as { banks?: Array<{ label: string; value: string }> })?.banks ?? []
        setBanks(list.length ? list : [{ label: "Public Bank MY", value: "publicbank" }])
      }).catch(() => {})
    }
  }

  const filteredReports = reports.filter((r) => {
    const matchSearch = !search.trim() ||
      (r.title ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (r.month ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (r.property ?? "").toLowerCase().includes(search.toLowerCase())
    const matchProp = filterProperty === "all" || r.propertyId === filterProperty || r.property === filterProperty
    return matchSearch && matchProp
  })

  const handleSelectReport = (id: string) => {
    setSelectedReports((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const handleSelectAll = () => {
    if (selectedReports.length === filteredReports.length) setSelectedReports([])
    else setSelectedReports(filteredReports.map((r) => r.id))
  }

  const handleDownloadBankFile = async () => {
    if (!hasBankBulkTransferAddon) {
      alert("Bank Bulk Transfer addon is required. Please upgrade your plan.")
      return
    }
    const bank = selectedBank || "publicbank"
    if (selectedReports.length === 0) return
    setBankDownloadLoading(true)
    try {
      const res = await getBankBulkTransferDownloadUrl({ bank, type: "owner", ids: selectedReports })
      const urls = (res as { urls?: Array<{ filename?: string; url: string }> })?.urls ?? []
      if (urls.length >= 1) {
        const first = urls[0]
        // Trigger direct download (server sets Content-Disposition: attachment).
        const a = document.createElement("a")
        a.href = first.url
        if (first.filename) a.download = first.filename
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      else alert("No download URL returned.")
      setShowBankFileDialog(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Download failed"
      if (msg.includes("ADDON_REQUIRED")) alert("Bank Bulk Transfer addon is required.")
      else alert(msg)
    } finally {
      setBankDownloadLoading(false)
    }
  }

  const openMarkAsPaidSingle = (report: ReportItem) => {
    setDetailReport(null)
    setSelectedReports([report.id])
    setPayMode("single")
    setPayDate(getTodayMalaysiaYmd())
    setShowPayDialog(true)
  }
  const openMarkAsPaidBulk = () => {
    setPayMode("bulk")
    setPayDate(getTodayMalaysiaYmd())
    setShowPayDialog(true)
  }

  const toggleClassificationKey = (key: string, bucket: "income" | "expense") => {
    if (bucket === "income") {
      setCustomExpenseKeys((prev) => prev.filter((k) => k !== key))
      setCustomIncomeKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
    } else {
      setCustomIncomeKeys((prev) => prev.filter((k) => k !== key))
      setCustomExpenseKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
    }
  }

  const handleSaveReportSettings = async () => {
    setReportSettingsSaving(true)
    try {
      const dayNumRaw = Number(automationDay)
      const dayNum = Number.isFinite(dayNumRaw) ? Math.max(1, Math.min(31, Math.floor(dayNumRaw))) : 5
      await saveOwnerReportSettings({
        defaultCarryNegativeForward,
        automationEnabled,
        automationDay: dayNum,
        reportClassificationMode,
        reportIncomeKeys: reportClassificationMode === "customize" ? customIncomeKeys : undefined,
        reportExpenseKeys: reportClassificationMode === "customize" ? customExpenseKeys : undefined,
      })
      setAutomationDay(String(dayNum))
      setReportSettingsOpen(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save report settings")
    } finally {
      setReportSettingsSaving(false)
    }
  }

  /** After mark paid: surface accounting outcome (toast). Highlights missing property owner for Xero/Bukku. */
  const showMarkPaidAccountingToast = (
    acc:
      | {
          skipped?: boolean
          ok?: boolean
          skipReason?: string
          provider?: string | null
          errors?: string[]
          invoiceCreated?: boolean | number
          billCreated?: boolean | number
        }
      | undefined
  ) => {
    if (!acc || Object.keys(acc).length === 0) return
    const errLines = acc.errors ?? []
    const errBlob = errLines.join(" ")
    const missingPropertyOwner =
      errBlob.includes("PROPERTY_OWNER_NOT_FOUND") || errBlob.includes("OWNER_NOT_FOUND")

    if (acc.skipped) {
      toast({
        variant: "destructive",
        title: "Accounting not connected",
        description: acc.skipReason
          ? `${acc.skipReason}. Use a plan that includes accounting and connect Xero or Bukku under integrations.`
          : "No accounting integration or plan for this operator.",
      })
      return
    }

    if (acc.ok === false && errLines.length) {
      if (missingPropertyOwner) {
        toast({
          variant: "destructive",
          title: "Property has no linked owner",
          description:
            "Link an owner to this property under Property settings. Owner payouts need an owner before invoices and bills can be created in Xero or Bukku.",
        })
        return
      }
      const prov = acc.provider ? ` (${String(acc.provider)})` : ""
      toast({
        variant: "destructive",
        title: "Accounting did not complete",
        description: `${errLines.join("; ")}${prov}`,
      })
      return
    }

    const invN = Number(acc.invoiceCreated ?? 0)
    const billN = Number(acc.billCreated ?? 0)
    if (acc.ok && invN === 0 && billN === 0) {
      toast({
        title: "Marked as paid",
        description:
          "No invoice or bill was created because management fee and net payout are both zero.",
      })
    }
  }

  const handleSubmitPay = async () => {
    setPaySaving(true)
    try {
      let accounting:
        | {
            skipped?: boolean
            ok?: boolean
            skipReason?: string
            provider?: string | null
            errors?: string[]
            invoiceCreated?: boolean | number
            billCreated?: boolean | number
          }
        | undefined
      if (payMode === "single" && selectedReports.length === 1) {
        const res = await updateOwnerReport(selectedReports[0], {
          paid: true,
          accountingStatus: "pending",
          paymentDate: payDate,
          paymentMethod: payMethod,
        })
        accounting = res.accounting
      } else if (selectedReports.length > 0) {
        const res = await bulkUpdateOwnerReport(selectedReports, {
          paid: true,
          accountingStatus: "pending",
          paymentDate: payDate,
          paymentMethod: payMethod,
        })
        accounting = res.accounting
        setSelectedReports([])
      }
      setShowPayDialog(false)
      setDetailReport(null)
      await loadReports()
      showMarkPaidAccountingToast(accounting)
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Mark as paid failed",
        description: e instanceof Error ? e.message : "Something went wrong.",
      })
    } finally {
      setPaySaving(false)
    }
  }

  const handleDeleteSingle = async () => {
    if (!detailReport) return
    if (detailReport.paid) {
      alert("Paid report cannot be deleted.")
      return
    }
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }
    setDeleteLoading(true)
    try {
      await deleteOwnerReport(detailReport.id)
      setDetailReport(null)
      setDeleteConfirm(false)
      await loadReports()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeleteLoading(false)
    }
  }

  /** Read-only Bukku list/read: match amounts, save invoice & bill URLs (does not create Bukku docs). */
  const handleLinkBukkuUrls = async (report: ReportItem) => {
    setBukkuLinkLoading(true)
    try {
      const dry = await linkOwnerReportBukkuUrls(report.id, { dryRun: true })
      const d = dry.data
      if (!dry.ok || d?.ok === false) {
        toast({
          variant: "destructive",
          title: "Bukku link preview failed",
          description: d?.reason ? String(d.reason) : `HTTP ${dry.status}`,
        })
        return
      }
      const inv = d.bukkuinvoice?.trim() || "—"
      const bill = d.bukkubills?.trim() || "—"
      const okSave = window.confirm(
        `Save these URLs on this report?\n\nInvoice (mgmt fee): ${inv}\nBill (payout): ${bill}\n\n(This only updates Coliving; nothing is created in Bukku.)`
      )
      if (!okSave) return
      const commit = await linkOwnerReportBukkuUrls(report.id, { dryRun: false })
      const cd = commit.data
      if (!commit.ok || cd?.ok === false) {
        const amb = cd?.candidates?.length
          ? `Candidates: ${cd.candidates.map((c) => c.id).join(", ")}`
          : ""
        toast({
          variant: "destructive",
          title: "Save failed",
          description: [cd?.reason, amb].filter(Boolean).join(" "),
        })
        return
      }
      toast({
        title: "Bukku URLs saved",
        description: "Invoice/bill links updated; report marked as paid (paid = true).",
      })
      await loadReports()
      setDetailReport((prev) =>
        prev && prev.id === report.id
          ? {
              ...prev,
              bukkuinvoice: cd.bukkuinvoice ?? prev.bukkuinvoice,
              bukkubills: cd.bukkubills ?? prev.bukkubills,
            }
          : prev
      )
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Bukku link failed",
        description: e instanceof Error ? e.message : "Request failed",
      })
    } finally {
      setBukkuLinkLoading(false)
    }
  }

  const handleVoidPaymentSingle = async (report: ReportItem) => {
    if (!report?.paid) {
      alert("This report is not marked as paid.")
      return
    }
    const ok = window.confirm("Void payment in accounting (invoice & bills), and reset this report to unpaid?")
    if (!ok) return
    setDeleteLoading(true)
    try {
      await voidOwnerReportPayment(report.id)
      if (detailReport?.id === report.id) setDetailReport(null)
      setSelectedReports((prev) => prev.filter((id) => id !== report.id))
      await loadReports()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Void payment failed")
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleBulkDelete = async () => {
    if (!bulkDeleteConfirm) {
      const hasPaid = selectedReports.some((id) => reports.find((r) => r.id === id)?.paid)
      if (hasPaid) {
        alert("Paid report(s) cannot be deleted. Please unselect paid items.")
        return
      }
      setBulkDeleteConfirm(true)
      return
    }
    setDeleteLoading(true)
    try {
      for (const id of selectedReports) {
        await deleteOwnerReport(id)
      }
      setSelectedReports([])
      setBulkDeleteConfirm(false)
      await loadReports()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeleteLoading(false)
    }
  }

  const currency = currencySymbol

  return (
    <main className="p-3 sm:p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-foreground">Generate Report</h1>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setReportSettingsOpen(true)}>
            <Settings2 size={15} /> Report Settings
          </Button>
        </div>
        <p className="text-muted-foreground mt-1">Create owner reports or view past reports.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border mb-6">
        <button
          type="button"
          onClick={() => setTab("generate")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === "generate" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Generate Report
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === "history" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Reports History
        </button>
      </div>

      {/* Tab: Generate Report – repeater of properties: checkbox + Preview; Generate = insert + upload PDF; Download = insert + download PDF */}
      {tab === "generate" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText size={18} /> Generate Report
            </CardTitle>
            <p className="text-sm text-muted-foreground">Choose date range, then select properties (checkbox). Preview to see breakdown, then Generate (writes to table + uploads PDF) or Download (writes to table + download PDF).</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Date From</Label>
                <Input type="date" value={grDateFrom} onChange={(e) => setGrDateFrom(e.target.value)} className="mt-1 w-40" />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Date To</Label>
                <Input type="date" value={grDateTo} onChange={(e) => setGrDateTo(e.target.value)} className="mt-1 w-40" />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Show Rows By</Label>
                <Select value={generateViewMode} onValueChange={(v) => { setGenerateViewMode(v as GenerateViewMode); setSelectedGRKeys([]) }}>
                  <SelectTrigger className="mt-1 w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Show according month</SelectItem>
                    <SelectItem value="property">Show according property</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Generate Mode</Label>
                <Select value={generateActionMode} onValueChange={(v) => setGenerateActionMode(v as GenerateActionMode)}>
                  <SelectTrigger className="mt-1 w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="each_month">Generate each month report</SelectItem>
                    <SelectItem value="all_month">Generate all month report</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allGenerateRows.length > 0 && selectedGRKeys.length === allGenerateRows.length}
                        onChange={selectAllGR}
                        className="accent-primary"
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Property</th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Month / Period</th>
                    <th
                      className="px-4 py-3 text-right font-semibold text-muted-foreground"
                      title="Operator retention after expenses (management fee or operator profit, same as preview summary)."
                    >
                      Net profit
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {allGenerateRows.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No rows for selected date range.</td></tr>
                  )}
                  {allGenerateRows.map((row) => (
                    <tr key={row.key} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedGRKeys.includes(row.key)}
                          onChange={() => toggleGRRow(row.key)}
                          className="accent-primary"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium">{row.propertyName}</td>
                      <td className="px-4 py-3">{row.monthLabel}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {(() => {
                          const v = grNetProfitByKey[row.key]
                          if (v === "loading" || v === undefined) return "…"
                          if (v === "error") return "—"
                          return `${currencySymbol} ${v.toFixed(2)}`
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="outline" size="sm" onClick={() => openPreview(row)} disabled={previewLoading}>
                          {previewLoading && previewProperty?.id === row.propertyId ? "Loading..." : "Preview"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                style={{ background: "var(--brand)" }}
                className="gap-2"
                onClick={handleGRGenerate}
                disabled={grRunning || selectedGRKeys.length === 0}
              >
                {grRunning ? "Generating..." : "Generate (write to table + upload PDF)"}
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleGRDownload}
                disabled={grRunning || selectedGRKeys.length === 0}
              >
                <Download size={16} /> Download (PDF only, no table write)
              </Button>
            </div>
            {grMessage && <p className="text-sm text-muted-foreground">{grMessage}</p>}
          </CardContent>
        </Card>
      )}

      {/* Preview dialog: payout rows + totals */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Preview Report {previewProperty?.shortname ?? previewProperty?.id ?? ""}</DialogTitle>
            <DialogDescription>
              Date range: {previewProperty?.monthLabel ?? `${grDateFrom} – ${grDateTo}`}. This is a preview; no data is saved until you click Generate or Download.
              {" "}
              Managed properties show <span className="font-medium text-foreground">Management Fee (% of rental)</span>; rental units show{" "}
              <span className="font-medium text-foreground">Fixed rent to owner</span> — both appear in the table below.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto flex-1 min-h-0">
            {previewLoading ? (
              <p className="text-sm text-muted-foreground py-4">Loading...</p>
            ) : (
              <>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-12">No</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Description</th>
                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground w-28">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-3 py-2">{row.no}</td>
                        <td className="px-3 py-2">{row.description}</td>
                        <td className="px-3 py-2 text-right">{row.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewTotals && (
                  <div className="mt-4 font-mono text-sm space-y-1 border-t pt-3">
                    <p>Total Rental: {currency} {(previewTotals.totalrental ?? 0).toFixed(2)}</p>
                    <p>Total Utility: {currency} {(previewTotals.totalutility ?? 0).toFixed(2)}</p>
                    <p>Total Collection: {currency} {(previewTotals.totalcollection ?? 0).toFixed(2)}</p>
                    <p>(-) Total Expenses: {currency} {(previewTotals.expenses ?? 0).toFixed(2)}</p>
                    <p>
                      (-) Mgmt fee / fixed rent to owner: {currency} {(previewTotals.managementfee ?? 0).toFixed(2)}
                    </p>
                    <p className="font-semibold">Net Payout: {currency} {(previewTotals.netpayout ?? 0).toFixed(2)}</p>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tab: Reports History */}
      {tab === "history" && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
              <Input placeholder="Search by title, month or property..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-40" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-40" />
            <Select value={filterProperty} onValueChange={setFilterProperty}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="Property" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Properties</SelectItem>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.shortname ?? p.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="UNPAID">Unpaid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New to Old</SelectItem>
                <SelectItem value="old">Old to New</SelectItem>
                <SelectItem value="amountdesc">Amount Big to Small</SelectItem>
                <SelectItem value="amountasc">Amount Small to Big</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b py-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 size={16} /> Reports History
              </CardTitle>
              {selectedReports.length > 0 && (
                <Button
                  size="sm"
                  style={{ background: "var(--brand)" }}
                  className="gap-2"
                  onClick={async () => {
                    try {
                      const res = await getOwnerReportsPdfDownloadUrl(selectedReports)
                      if (res?.downloadUrl) window.open(res.downloadUrl, "_blank")
                    } catch (_) {}
                  }}
                >
                  <Download size={14} /> Bulk Download ({selectedReports.length})
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={selectedReports.length === filteredReports.length && filteredReports.length > 0}
                          onChange={handleSelectAll}
                          className="accent-primary"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground hidden sm:table-cell">Property</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground hidden md:table-cell">Description</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">Loading...</td></tr>
                    ) : filteredReports.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">No reports found.</td></tr>
                    ) : (
                      filteredReports.map((report) => (
                        <tr key={report.id} className="border-b hover:bg-muted/50">
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={selectedReports.includes(report.id)} onChange={() => handleSelectReport(report.id)} className="accent-primary" />
                          </td>
                          <td className="px-4 py-3 text-sm font-medium">{formatDateDisplay(report.month)}</td>
                          <td className="px-4 py-3 text-sm hidden sm:table-cell text-muted-foreground">{report.property}</td>
                          <td className="px-4 py-3 text-sm hidden md:table-cell text-muted-foreground truncate max-w-[200px]" title={report.title}>{report.title}</td>
                          <td className="px-4 py-3 text-sm font-semibold">{currency} {(report.totalPayout ?? 0).toFixed(2)}</td>
                          <td className="px-4 py-3">
                            <Badge className={`text-xs ${report.paid ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{report.paid ? "Paid" : "Unpaid"}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <MoreHorizontal size={14} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setDetailReport(report)}>Detail</DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!!report.paid}
                                  onClick={() => {
                                    if (!report.paid) openMarkAsPaidSingle(report)
                                  }}
                                >
                                  Mark as Paid
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={async () => {
                                    try {
                                      const existing = String(report.monthlyreport || "").trim()
                                      if (isPersistedReportDocumentUrl(existing)) {
                                        openReportPreviewUrl(existing)
                                        return
                                      }
                                      const uploaded = await generateAndUploadOwnerReportPdf(report.id)
                                      const driveUrl = (uploaded as { url?: string })?.url
                                      if (driveUrl) {
                                        openReportPreviewUrl(driveUrl)
                                        await loadReports()
                                        return
                                      }
                                      alert(
                                        "Could not open report in Google Drive. Generate the report with a property folder set, or connect Google in Company Settings."
                                      )
                                    } catch (e) {
                                      alert(e instanceof Error ? e.message : "Could not open report")
                                    }
                                  }}
                                >
                                  <Download size={13} className="mr-2" /> View report
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!report.bukkuinvoice}
                                  title={!report.bukkuinvoice ? "No accounting invoice URL yet (mark as paid with accounting)" : undefined}
                                  onClick={() => {
                                    const u = report.bukkuinvoice?.trim()
                                    if (u && /^https?:\/\//i.test(u)) window.open(u, "_blank", "noopener,noreferrer")
                                  }}
                                >
                                  <Receipt size={13} className="mr-2" /> Download invoice
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!report.bukkubills}
                                  title={!report.bukkubills ? "No accounting bills URL yet (mark as paid with accounting)" : undefined}
                                  onClick={() => {
                                    const u = report.bukkubills?.trim()
                                    if (u && /^https?:\/\//i.test(u)) window.open(u, "_blank", "noopener,noreferrer")
                                  }}
                                >
                                  <ScrollText size={13} className="mr-2" /> Download bills
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  disabled={!accountingConnected || bukkuLinkLoading}
                                  title={
                                    !accountingConnected
                                      ? "Requires accounting integration (Bukku)."
                                      : "Match existing Bukku invoice & bill by owner contact and amounts; updates URLs only."
                                  }
                                  onClick={async () => {
                                    await handleLinkBukkuUrls(report)
                                  }}
                                >
                                  Link from Bukku (read-only)
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  disabled={!report.paid || deleteLoading}
                                  onClick={async () => {
                                    await handleVoidPaymentSingle(report)
                                  }}
                                >
                                  Void payment
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!!report.paid}
                                  className="text-destructive"
                                  onClick={async () => {
                                    if (report.paid) return
                                    setDeleteLoading(true)
                                    try {
                                      await deleteOwnerReport(report.id)
                                      if (detailReport?.id === report.id) setDetailReport(null)
                                      setSelectedReports((prev) => prev.filter((id) => id !== report.id))
                                      await loadReports()
                                    } catch (e) {
                                      alert(e instanceof Error ? e.message : "Delete failed")
                                    } finally {
                                      setDeleteLoading(false)
                                    }
                                  }}
                                >
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {selectedReports.length > 0 && (
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-foreground">Selected: {selectedReports.length} | Total: {currency} {selectedTotal != null ? selectedTotal.total.toFixed(2) : "—"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={openBankFileDialog}
                      disabled={selectedReports.length === 0 || !hasBankBulkTransferAddon}
                      title={!hasBankBulkTransferAddon ? "Requires Bank Bulk Transfer System addon." : undefined}
                    >
                      <Download size={18} /> Download Bank File
                    </Button>
                    <Button style={{ background: "var(--brand)" }} className="gap-2" onClick={openMarkAsPaidBulk}><DollarSign size={18} /> Mark as Paid</Button>
                    <Button variant="outline" className="gap-2" onClick={async () => { try { const res = await getOwnerReportsPdfDownloadUrl(selectedReports); if (res?.downloadUrl) window.open(res.downloadUrl, "_blank"); } catch (_) {} }}><Download size={18} /> Bulk Download (ZIP)</Button>
                    <Button variant="outline" className="gap-2 text-destructive border-destructive" onClick={handleBulkDelete} disabled={deleteLoading}>{bulkDeleteConfirm ? "Confirm Delete" : "Bulk Delete"}</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!detailReport} onOpenChange={(open) => !open && (setDetailReport(null), setDeleteConfirm(false))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Report Detail</DialogTitle>
            <DialogDescription>{detailReport?.title}</DialogDescription>
          </DialogHeader>
          {detailReport && (
            <div className="space-y-3 py-2 font-mono text-sm">
              <p>Total Rental: {currency} {(detailReport.totalrental ?? 0).toFixed(2)}</p>
              <p>Total Utility: {currency} {(detailReport.totalutility ?? 0).toFixed(2)}</p>
              <p>Total Collection: {currency} {(detailReport.totalcollection ?? 0).toFixed(2)}</p>
              <p>(-) Total Expenses: {currency} {(detailReport.expenses ?? 0).toFixed(2)}</p>
              <p>(-) Mgmt fee / fixed rent to owner: {currency} {(detailReport.managementfee ?? 0).toFixed(2)}</p>
              <p className="font-semibold">Net Payout: {currency} {(detailReport.totalPayout ?? 0).toFixed(2)}</p>
              {detailReport.paid && (detailReport.paymentMethod || detailReport.paymentDate) && (
                <p className="text-muted-foreground text-xs">Paid via {detailReport.paymentMethod ?? "—"} on {detailReport.paymentDate ? formatDateDisplay(detailReport.paymentDate) : "—"}</p>
              )}
              {accountingConnected && !(detailReport.bukkuinvoice || detailReport.bukkubills) && (
                <p className="text-xs text-muted-foreground pt-1">
                  No Bukku invoice/bill links on file. If they already exist in Bukku, use &quot;Link from Bukku&quot; (read-only match by owner contact and amounts).
                </p>
              )}
              {accountingConnected && (detailReport.bukkuinvoice || detailReport.bukkubills) && (
                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  {detailReport.bukkuinvoice && (
                    <Button variant="outline" size="sm" onClick={() => window.open(detailReport!.bukkuinvoice!, "_blank")}>
                      Invoice (fee / fixed rent)
                    </Button>
                  )}
                  {detailReport.bukkubills && (
                    <Button variant="outline" size="sm" onClick={() => window.open(detailReport!.bukkubills!, "_blank")}>Bills (payout to owner)</Button>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex flex-wrap gap-2">
            {detailReport && accountingConnected && (
              <Button
                type="button"
                variant="secondary"
                disabled={bukkuLinkLoading}
                title="Match existing Bukku sales invoice & purchase bill by owner contact and amounts; saves URLs only (no new Bukku documents)."
                onClick={() => detailReport && handleLinkBukkuUrls(detailReport)}
              >
                Link from Bukku
              </Button>
            )}
            {detailReport && detailReport.paid && (
              <Button
                variant="outline"
                onClick={async () => {
                  await handleVoidPaymentSingle(detailReport)
                }}
                disabled={deleteLoading}
              >
                Void payment
              </Button>
            )}
            {detailReport && !detailReport.paid && (
              <Button style={{ background: "var(--brand)" }} onClick={() => { setShowPayDialog(true); setPayMode("single"); setSelectedReports([detailReport.id]); setPayDate(getTodayMalaysiaYmd()); setDetailReport(null); }}>Mark as Paid</Button>
            )}
            <Button variant="outline" onClick={handleDeleteSingle} disabled={deleteLoading || !!detailReport?.paid} className="text-destructive">{deleteConfirm ? "Confirm Delete" : "Delete"}</Button>
            <Button variant="outline" onClick={() => { setDetailReport(null); setDeleteConfirm(false); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Settings dialog */}
      <Dialog open={reportSettingsOpen} onOpenChange={setReportSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Report Settings</DialogTitle>
            <DialogDescription>Set default negative policy, monthly automation, and how invoice types count in owner reports.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold">Owner report — invoice classification</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                Standard matches the default rules (e.g. Deposit is not treated as income to the owner). Customize to include Deposit, tenant-invoice Management Fees, or other types in income or expenses. Note: this is not the same as the settlement line at the bottom of the report (e.g. &quot;Management Fees (10% Net Income)&quot; from property settings).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={reportClassificationMode}
                  onValueChange={(v) => setReportClassificationMode(v as "standard" | "customize")}
                >
                  <SelectTrigger className="w-[200px] mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard report</SelectItem>
                    <SelectItem value="customize">Customize</SelectItem>
                  </SelectContent>
                </Select>
                {reportClassificationMode === "customize" && (
                  <Button type="button" variant="secondary" size="sm" className="mt-1" onClick={() => setCustomizeClassificationOpen(true)}>
                    Customize
                  </Button>
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold">Default bring negative to next month</Label>
              <Select value={defaultCarryNegativeForward ? "yes" : "no"} onValueChange={(v) => setDefaultCarryNegativeForward(v === "yes")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes (default bring forward)</SelectItem>
                  <SelectItem value="no">No (default do not bring)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Owner report automation</Label>
              <Select value={automationEnabled ? "yes" : "no"} onValueChange={(v) => setAutomationEnabled(v === "yes")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes (enable monthly automation)</SelectItem>
                  <SelectItem value="no">No (manual generate only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Automation generate day (1-31)</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={automationDay}
                onChange={(e) => setAutomationDay(e.target.value)}
                className="mt-1"
                disabled={!automationEnabled}
              />
              <p className="text-xs text-muted-foreground mt-1">
                On this day each month, system can auto-generate previous month owner reports (cron hookup next step).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportSettingsOpen(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSaveReportSettings} disabled={reportSettingsSaving}>
              {reportSettingsSaving ? "Saving..." : "Save Settings"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={customizeClassificationOpen} onOpenChange={setCustomizeClassificationOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Customize invoice classification</DialogTitle>
            <DialogDescription>
              For each invoice type, choose whether it counts as income or expenses in the owner report. A type cannot be both; checking one side removes it from the other. &quot;Management Fees (tenant invoice line)&quot; is the billable type from tenant invoices — separate from the calculated management fee row (percentage of income) shown after Net Income.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-2">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Income</p>
              {REPORT_CLASSIFICATION_OPTIONS.map((opt) => (
                <label key={`inc-${opt.key}`} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={customIncomeKeys.includes(opt.key)}
                    onCheckedChange={() => toggleClassificationKey(opt.key, "income")}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Expenses</p>
              {REPORT_CLASSIFICATION_OPTIONS.map((opt) => (
                <label key={`exp-${opt.key}`} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={customExpenseKeys.includes(opt.key)}
                    onCheckedChange={() => toggleClassificationKey(opt.key, "expense")}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-between items-center pt-2 border-t">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setCustomIncomeKeys([...STANDARD_REPORT_INCOME_KEYS])
                setCustomExpenseKeys([...STANDARD_REPORT_EXPENSE_KEYS])
              }}
            >
              Reset to standard defaults
            </Button>
            <Button type="button" style={{ background: "var(--brand)" }} onClick={() => setCustomizeClassificationOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mark as Paid dialog – Payment method & date */}
      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark as Paid</DialogTitle>
            <DialogDescription>Set payment method and payment date for the selected report(s).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-xs font-semibold">Payment method</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as "Bank" | "Cash")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Bank">Bank</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Payment date</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSubmitPay} disabled={paySaving || selectedReports.length === 0}>{paySaving ? "Saving..." : "Mark as Paid"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Download Bank File – select bank then download (for future multi-bank) */}
      <Dialog open={showBankFileDialog} onOpenChange={setShowBankFileDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Download Bank File</DialogTitle>
            <DialogDescription>Select bank and download file for {selectedReports.length} selected report(s).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Bank</Label>
              <Select value={selectedBank || (banks[0]?.value ?? "publicbank")} onValueChange={setSelectedBank}>
                <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                <SelectContent>
                  {(banks.length ? banks : [{ label: "Public Bank MY", value: "publicbank" }]).map((b) => (
                    <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBankFileDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleDownloadBankFile} disabled={bankDownloadLoading || selectedReports.length === 0}>
              {bankDownloadLoading ? "Preparing..." : "Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
