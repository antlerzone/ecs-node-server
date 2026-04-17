"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { TrendingDown, Upload, Download, Plus, Trash2, Search, ExternalLink } from "lucide-react"
import {
  getExpensesList,
  getExpensesFilters,
  insertExpense,
  deleteExpense,
  bulkDeleteExpenses,
  updateExpense,
  bulkMarkPaid,
  getBankBulkTransferBanks,
  getBankBulkTransferDownloadUrl,
  getBulkTemplateFile,
  getBulkTemplateDownloadUrl,
} from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import { getTodayMalaysiaYmd } from "@/lib/dateMalaysia"

const PAGE_SIZE_OPTIONS = [10, 50, 100, 500, 1000] as const

function getDefaultDateRange() {
  // Always compute "last month" based on UTC+8, regardless of browser timezone.
  const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000
  const nowUtc8 = new Date(Date.now() + UTC8_OFFSET_MS)
  const y = nowUtc8.getUTCFullYear()
  const m = nowUtc8.getUTCMonth() // 0-11

  const first = new Date(Date.UTC(y, m - 1, 1))
  const last = new Date(Date.UTC(y, m, 0)) // day 0 of current month = last day of previous month
  return {
    from: toDateInputValue(first),
    to: toDateInputValue(last),
  }
}

function toDateInputValue(d: Date) {
  // `input[type="date"]` expects `YYYY-MM-DD`. We compute it for UTC+8
  // so that the displayed dates match what a UTC+8 user should see.
  const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000
  const t = new Date(d.getTime() + UTC8_OFFSET_MS)
  const y = t.getUTCFullYear()
  const m = String(t.getUTCMonth() + 1).padStart(2, "0")
  const day = String(t.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function formatPeriodYmdUtc8(value: unknown) {
  if (value == null) return ""
  if (value instanceof Date) {
    const t = new Date(value.getTime() + 8 * 60 * 60 * 1000)
    const y = t.getUTCFullYear()
    const m = String(t.getUTCMonth() + 1).padStart(2, "0")
    const day = String(t.getUTCDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  }
  // If backend already returns `YYYY-MM-DD...` / ISO string, parse then shift to UTC+8 for display.
  const d = new Date(String(value))
  if (!Number.isFinite(d.getTime())) return String(value).slice(0, 10)
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const y = t.getUTCFullYear()
  const m = String(t.getUTCMonth() + 1).padStart(2, "0")
  const day = String(t.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

interface ExpenseItem {
  id?: string
  _id?: string
  period?: string
  description?: string
  amount?: number
  paid?: boolean
  property?: { shortname?: string }
  billType?: { title?: string }
  bukkuurl?: string
}

type FilterOption = { value: string; label: string }
type FiltersState = {
  properties?: FilterOption[]
  types?: FilterOption[]
  suppliers?: { id: string; title: string }[]
}

type BulkPreviewRecord = {
  property: string
  billType: string
  description: string
  amount: number
  period: string
}

type BulkPreviewEntry = {
  record: BulkPreviewRecord
  display: {
    property: string
    supplier: string
    description: string
    amount: number
    period: string
  }
}

export default function ExpensesPage() {
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
  const defaultRange = getDefaultDateRange()
  const [expenses, setExpenses] = useState<ExpenseItem[]>([])
  const [filters, setFilters] = useState<FiltersState>({})
  const [selectedExpenses, setSelectedExpenses] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [propertyFilter, setPropertyFilter] = useState<string>("all")
  const [paidFilter, setPaidFilter] = useState<string>("all")
  const [dateFrom, setDateFrom] = useState(defaultRange.from)
  const [dateTo, setDateTo] = useState(defaultRange.to)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectAllLoading, setSelectAllLoading] = useState(false)
  const [banks, setBanks] = useState<Array<{ label: string; value: string }>>([])
  const [selectedBank, setSelectedBank] = useState<string>("")
  const [bankDownloadLoading, setBankDownloadLoading] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [addForm, setAddForm] = useState({
    propertyId: "",
    typeId: "",
    description: "",
    amount: "",
    period: toDateInputValue(new Date()),
  })
  const [templateLoading, setTemplateLoading] = useState(false)
  const [bulkUploadLoading, setBulkUploadLoading] = useState(false)
  const [showPayDialog, setShowPayDialog] = useState(false)
  const [payMethod, setPayMethod] = useState<"Cash" | "Bank">("Bank")
  const [payDate, setPayDate] = useState(() => getTodayMalaysiaYmd())
  const [paySaving, setPaySaving] = useState(false)
  const [showBankFileDialog, setShowBankFileDialog] = useState(false)
  const [detailExpense, setDetailExpense] = useState<ExpenseItem | null>(null)
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [showBulkPreviewDialog, setShowBulkPreviewDialog] = useState(false)
  const [bulkPreviewEntries, setBulkPreviewEntries] = useState<BulkPreviewEntry[]>([])
  const [bulkPreviewSelectedIndices, setBulkPreviewSelectedIndices] = useState<number[]>([])
  const [bulkPreviewImportLoading, setBulkPreviewImportLoading] = useState(false)

  const loadData = useCallback(async (opts?: { pageNum?: number }) => {
    setLoading(true)
    const pageNum = opts?.pageNum ?? page
    try {
      const [listRes, filtersRes] = await Promise.all([
        getExpensesList({
          from: dateFrom || undefined,
          to: dateTo || undefined,
          search: search.trim() || undefined,
          property: propertyFilter === "all" ? undefined : propertyFilter,
          paid: paidFilter === "all" ? undefined : paidFilter === "paid",
          sort: "new",
          page: pageNum,
          pageSize,
        }),
        filters.properties ? Promise.resolve(filters) : getExpensesFilters(),
      ])
      const list = listRes as { items?: (ExpenseItem & { billurl?: string })[]; totalPages?: number; currentPage?: number; total?: number }
      const raw = Array.isArray(list.items) ? list.items : []
      const items = raw.map((i) => ({ ...i, bukkuurl: i.bukkuurl ?? i.billurl }))
      setExpenses(items)
      setTotalPages(Math.max(1, list.totalPages ?? 1))
      setPage(list.currentPage ?? pageNum)
      setTotal(list.total ?? 0)
      if (!filters.properties && filtersRes) {
        const f = filtersRes as FiltersState
        if (f?.properties?.length) setFilters(f)
      }
    } catch {
      setExpenses([])
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, search, propertyFilter, paidFilter, page, pageSize])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (selectedExpenses.length > 0 && banks.length === 0) {
      getBankBulkTransferBanks().then((res) => {
        const list = (res as { banks?: Array<{ label: string; value: string }> })?.banks ?? []
        setBanks(list)
        if (list.length > 0 && !selectedBank) setSelectedBank(list[0].value)
      }).catch(() => {})
    }
  }, [selectedExpenses.length])

  const handleSelectExpense = (id: string) => {
    setSelectedExpenses((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const selectionHasPaidItems = () => {
    if (!selectedExpenses.length) return false
    return selectedExpenses.some((id) => {
      const exp = expenses.find((e) => (e.id ?? e._id) === id)
      return !!exp?.paid
    })
  }

  const ensurePaidSelectionConfirmed = () => {
    if (!selectionHasPaidItems()) return true
    return confirm("You have selected paid item(s). Do you sure?")
  }

  const handleToggleExpenseSelection = (expense: ExpenseItem) => {
    const id = expense.id ?? expense._id ?? ""
    if (!id) return

    handleSelectExpense(id)
  }

  /** Fetch all IDs matching current filters (all pages), then set or clear selection. */
  const handleSelectAll = async () => {
    const allFilteredSelected = total > 0 && selectedExpenses.length === total
    if (allFilteredSelected) {
      setSelectedExpenses([])
      return
    }
    if (total === 0) return
    setSelectAllLoading(true)
    try {
      const ids: string[] = []
      const chunkSize = 500
      let p = 1
      let hasMore = true
      while (hasMore) {
        const res = await getExpensesList({
          from: dateFrom || undefined,
          to: dateTo || undefined,
          search: search.trim() || undefined,
          property: propertyFilter === "all" ? undefined : propertyFilter,
          paid: paidFilter === "all" ? undefined : paidFilter === "paid",
          sort: "new",
          page: p,
          pageSize: chunkSize,
        })
        const list = res as { items?: ExpenseItem[] }
        const items = Array.isArray(list.items) ? list.items : []
        for (const e of items) {
          const id = e.id ?? e._id ?? ""
          if (id) ids.push(id)
        }
        hasMore = items.length >= chunkSize
        p += 1
      }
      setSelectedExpenses(ids)
    } catch {
      alert("Failed to select all")
    } finally {
      setSelectAllLoading(false)
    }
  }

  const handleAddExpense = async () => {
    // Refetch filters so dropdown always reflects the latest supplier list.
    // (Some users had stale cached filters from before backend changes.)
    try {
      const f = await getExpensesFilters()
      setFilters((prev) => ({ ...prev, ...(f as FiltersState) }))
    } catch (e) {
      // Ignore and still allow opening the dialog.
      console.warn("[expenses] failed to refetch filters:", e)
    }

    setAddForm({ propertyId: "", typeId: "", description: "", amount: "", period: toDateInputValue(new Date()) })
    setShowAddDialog(true)
  }

  const handleSaveAddExpense = async () => {
    if (!addForm.propertyId || !addForm.typeId || !addForm.amount) {
      alert("Please fill Property, Type, and Amount.")
      return
    }
    setAddSaving(true)
    try {
      await insertExpense({
        records: [{
          property: addForm.propertyId,
          billType: addForm.typeId,
          description: addForm.description || "",
          amount: Number(addForm.amount) || 0,
          period: addForm.period,
        }],
      })
      setShowAddDialog(false)
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add expense")
    } finally {
      setAddSaving(false)
    }
  }

  const handleDownloadTemplate = async () => {
    setTemplateLoading(true)
    try {
      const urlRes = await getBulkTemplateDownloadUrl()
      if ((urlRes as { downloadUrl?: string })?.downloadUrl) {
        window.open((urlRes as { downloadUrl: string }).downloadUrl, "_blank")
        return
      }
      const fileRes = await getBulkTemplateFile()
      const r = fileRes as { filename?: string; data?: string }
      if (r?.filename && r?.data) {
        const bin = atob(r.data)
        const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = r.filename
        a.click()
        URL.revokeObjectURL(url)
      } else {
        alert("Template not available")
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed")
    } finally {
      setTemplateLoading(false)
    }
  }

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    const lower = file.name.toLowerCase()
    const isCsv = lower.endsWith(".csv")
    const isXlsx = lower.endsWith(".xlsx")
    if (!isCsv && !isXlsx) {
      alert("Please upload a .csv or .xlsx file.")
      return
    }
    setBulkUploadLoading(true)
    try {
      const propertyMap: Record<string, string> = {}
      const supplierMap: Record<string, string> = {}
      ;(filters.properties || []).forEach((p) => { propertyMap[(p.label || "").trim()] = p.value; propertyMap[(p.value || "").trim()] = p.value })
      ;(filters.types || []).forEach((t) => { supplierMap[(t.label || "").trim()] = t.value; supplierMap[(t.value || "").trim()] = t.value })
      ;(filters.suppliers || []).forEach((s) => { supplierMap[(s.title || "").trim()] = s.id })

      const rows: { property: string; supplier: string; description: string; amount: number; period: string }[] = []
      const periodFallback = toDateInputValue(new Date())

      if (isCsv) {
        const text = await file.text()
        const lines = text.split(/\r?\n/).filter((l) => l.trim())
        const headerCells = (lines[0] || "")
          .split(",")
          .map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase())
        const propIdx = headerCells.findIndex((h) => h.includes("property"))
        const suppIdx = headerCells.findIndex((h) => h.includes("supplier"))
        const descIdx = headerCells.findIndex((h) => h.includes("description"))
        const amountIdx = headerCells.findIndex((h) => h.includes("amount"))
        const periodIdx = headerCells.findIndex((h) => h.includes("period"))
        for (let i = 1; i < lines.length; i++) {
          const cells = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim())
          const amount = Number(cells[amountIdx >= 0 ? amountIdx : 3] ?? 0)
          const desc = (cells[descIdx >= 0 ? descIdx : 2] ?? "").trim()
          if (!amount && !desc) continue
          rows.push({
            property: (cells[propIdx >= 0 ? propIdx : 0] ?? "").trim(),
            supplier: (cells[suppIdx >= 0 ? suppIdx : 1] ?? "").trim(),
            description: desc,
            amount,
            period: (cells[periodIdx >= 0 ? periodIdx : 4] ?? "").trim() || periodFallback,
          })
        }
      } else {
        const XLSX = require("xlsx")
        const buffer = await file.arrayBuffer()
        const workbook = XLSX.read(buffer, { type: "array" })
        const sheetNames: string[] = workbook.SheetNames ?? []
        if (!sheetNames.length) throw new Error("XLSX has no sheets")

        // Prefer the template's "Expenses" sheet, but fall back to whichever sheet contains required headers.
        let sheet =
          workbook.Sheets?.["Expenses"] ||
          (function pickSheet() {
            for (const name of sheetNames) {
              const candidate = workbook.Sheets[name]
              if (!candidate) continue
              const aoa = XLSX.utils.sheet_to_json(candidate, { header: 1, defval: "" }) as any[][]
              const header = aoa?.[0] || []
              const headerStr = header.map((v: any) => String(v ?? "").toLowerCase())
              const hasProperty = headerStr.some((h: string) => h.includes("property"))
              const hasSupplier = headerStr.some((h: string) => h.includes("supplier"))
              const hasAmount = headerStr.some((h: string) => h.includes("amount"))
              const hasPeriod = headerStr.some((h: string) => h.includes("period"))
              const hasDescription = headerStr.some((h: string) => h.includes("description"))
              if (hasProperty && hasSupplier && hasAmount && hasPeriod && hasDescription) return candidate
            }
            return undefined
          })()

        if (!sheet) throw new Error("XLSX sheet not found")

        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][]
        if (!aoa.length) {
          alert("No rows found in the Excel file.")
          return
        }

        const header = aoa[0] || []
        const headerStr = header.map((v: any) => String(v ?? "").toLowerCase())
        const findIdx = (substr: string) => headerStr.findIndex((h: string) => h.includes(substr))

        const propIdx = findIdx("property")
        const suppIdx = findIdx("supplier")
        const descIdx = findIdx("description")
        const amountIdx = findIdx("amount")
        const periodIdx = findIdx("period")

        const parsePeriod = (v: unknown) => {
          if (v == null) return periodFallback
          if (v instanceof Date) return toDateInputValue(v)
          if (typeof v === "number" && Number.isFinite(v)) {
            // Excel serial date (e.g. 46101.3777)
            try {
              const days = Math.floor(v)
              const dc = XLSX.SSF.parse_date_code(days)
              if (dc && typeof dc.y === "number" && typeof dc.m === "number" && typeof dc.d === "number") {
                const dt = new Date(Date.UTC(dc.y, dc.m - 1, dc.d))
                return toDateInputValue(dt)
              }
            } catch {}
          }

          const s = String(v ?? "").trim()
          if (!s) return periodFallback
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
          const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
          if (m1) {
            const dd = String(m1[1]).padStart(2, "0")
            const mm = String(m1[2]).padStart(2, "0")
            const yyyy = m1[3]
            return `${yyyy}-${mm}-${dd}`
          }
          const d = new Date(s)
          if (Number.isFinite(d.getTime())) return toDateInputValue(d)
          return periodFallback
        }

        for (let i = 1; i < aoa.length; i++) {
          const r = aoa[i] || []
          const property = propIdx >= 0 ? String(r[propIdx] ?? "").trim() : ""
          const supplier = suppIdx >= 0 ? String(r[suppIdx] ?? "").trim() : ""
          const description = descIdx >= 0 ? String(r[descIdx] ?? "").trim() : ""

          let amount = 0
          if (amountIdx >= 0) {
            const raw = r[amountIdx]
            if (typeof raw === "number" && Number.isFinite(raw)) amount = raw
            else amount = Number(String(raw ?? "").replace(/,/g, "")) || 0
          }

          // Skip totally empty rows
          if (!property && !supplier && !description && !amount) continue

          rows.push({
            property,
            supplier,
            description,
            amount,
            period: parsePeriod(periodIdx >= 0 ? r[periodIdx] : ""),
          })
        }
      }
      const previewEntries = rows
        .map((r) => {
          const propertyId = propertyMap[r.property] || propertyMap[r.property.toLowerCase()]
          const billTypeId = supplierMap[r.supplier] || supplierMap[r.supplier.toLowerCase()]
          const record: BulkPreviewRecord = {
            property: propertyId || r.property,
            billType: billTypeId || r.supplier,
            description: r.description,
            amount: r.amount,
            period: r.period,
          }
          return {
            record,
            display: {
              property: r.property,
              supplier: r.supplier,
              description: r.description,
              amount: r.amount,
              period: r.period,
            },
          } satisfies BulkPreviewEntry
        })
        .filter((e) => e.record.property && e.record.billType && (e.record.amount > 0 || e.record.description))

      const records = previewEntries.map((e) => e.record)
      if (records.length === 0) {
        const missingProp = rows.filter((r) => !r.property).length
        const missingSupp = rows.filter((r) => !r.supplier).length
        const missingAmtDesc = rows.filter((r) => !(r.amount > 0 || (r.description || "").trim())).length
        const s0 = rows[0]
        const sample =
          s0
            ? `First row: property='${String(s0.property).slice(0, 40)}', supplier='${String(s0.supplier).slice(0, 40)}', amount=${s0.amount}, description='${String(
                s0.description
              ).slice(0, 40)}'`
            : "First row: <none>"
        alert(
          `No valid rows. Parsed ${rows.length} row(s). Empty Property: ${missingProp}, Empty Supplier: ${missingSupp}, Empty Amount+Description: ${missingAmtDesc}. ${sample}\n` +
            "Need: fill Property & Supplier (exact dropdown values), and either Amount > 0 or Description."
        )
        return
      }
      if (records.length > 500) {
        alert("Max 500 items per upload.")
        return
      }
      // Preview first; only import when operator confirms.
      setBulkPreviewEntries(previewEntries)
      setBulkPreviewSelectedIndices([])
      setShowBulkPreviewDialog(true)
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : "Bulk upload failed")
    } finally {
      setBulkUploadLoading(false)
    }
  }

  const bulkPreviewSelectedEntries = bulkPreviewSelectedIndices
    .map((i) => bulkPreviewEntries[i])
    .filter(Boolean)

  const bulkPreviewTotalSelectedAmount = bulkPreviewSelectedEntries.reduce(
    (sum, e) => sum + Number(e?.record?.amount ?? 0),
    0
  )

  const bulkPreviewAllSelected =
    bulkPreviewEntries.length > 0 && bulkPreviewSelectedIndices.length === bulkPreviewEntries.length

  const bulkPreviewToggleIndex = (idx: number) => {
    setBulkPreviewSelectedIndices((prev) => (prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]))
  }

  const bulkPreviewHandleSelectAll = () => {
    if (bulkPreviewAllSelected) setBulkPreviewSelectedIndices([])
    else setBulkPreviewSelectedIndices(bulkPreviewEntries.map((_, i) => i))
  }

  const bulkPreviewImportNow = async () => {
    const selected = bulkPreviewSelectedEntries
    if (!selected.length) return
    setBulkPreviewImportLoading(true)
    try {
      const recordsToImport = selected.map((e) => e.record)
      await insertExpense({ records: recordsToImport })
      await loadData()
      setShowBulkPreviewDialog(false)
      setBulkPreviewEntries([])
      setBulkPreviewSelectedIndices([])
      alert(`Imported ${recordsToImport.length} expense(s).`)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import failed")
    } finally {
      setBulkPreviewImportLoading(false)
    }
  }

  /** Export current page to Excel */
  const handleExportTable = () => {
    const XLSX = require("xlsx")
    const rows = [
      ["Date", "Supplier", "Description", "Amount", "Property", "Paid"],
      ...expenses.map((e) => [
        e.period ?? "",
        e.billType?.title ?? "",
        e.description ?? "",
        Number(e.amount ?? 0),
        typeof e.property === "object" ? e.property?.shortname ?? "" : "",
        e.paid ? "Yes" : "No",
      ]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Expenses")
    XLSX.writeFile(wb, "expenses.xlsx")
  }

  const openMarkAsPaid = () => {
    if (!ensurePaidSelectionConfirmed()) return
    setPayDate(getTodayMalaysiaYmd())
    setShowPayDialog(true)
  }

  const handleSubmitMarkAsPaid = async () => {
    setPaySaving(true)
    try {
      if (selectedExpenses.length === 0) return
      await bulkMarkPaid(selectedExpenses, { paidAt: payDate, paymentMethod: payMethod })
      setSelectedExpenses([])
      setShowPayDialog(false)
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to mark as paid")
    } finally {
      setPaySaving(false)
    }
  }

  const openBankFileDialog = () => {
    if (!hasBankBulkTransferAddon) {
      alert("Bank Bulk Transfer addon is required. Please upgrade your plan.")
      return
    }
    if (!ensurePaidSelectionConfirmed()) return
    if (!selectedBank) setSelectedBank("publicbank")
    setShowBankFileDialog(true)
    if (banks.length === 0) {
      getBankBulkTransferBanks().then((res) => {
        const list = (res as { banks?: Array<{ label: string; value: string }> })?.banks ?? []
        setBanks(list.length ? list : [{ label: "Public Bank MY", value: "publicbank" }])
      }).catch(() => {})
    }
  }

  const handleDownloadBankFile = async () => {
    if (!hasBankBulkTransferAddon) {
      alert("Bank Bulk Transfer addon is required. Please upgrade your plan.")
      return
    }
    const bank = selectedBank || "publicbank"
    if (selectedExpenses.length === 0) return
    setBankDownloadLoading(true)
    try {
      const res = await getBankBulkTransferDownloadUrl({
        bank,
        type: "supplier",
        ids: selectedExpenses,
      })
      const urls = (res as { urls?: Array<{ filename: string; url: string }> })?.urls ?? []
      if (urls.length >= 1) {
        window.open(urls[0].url, "_blank")
        setShowBankFileDialog(false)
      } else {
        alert("No download URL returned. Some items may be skipped (e.g. missing bank/biller code). Check errors.txt in zip if applicable.")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Download failed"
      if (msg.includes("ADDON_REQUIRED")) {
        alert("Bank Bulk Transfer addon is required. Please upgrade your plan.")
      } else {
        alert(msg)
      }
    } finally {
      setBankDownloadLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this expense?")) return
    try {
      await deleteExpense(id)
      await loadData()
    } catch {
      alert("Failed to delete")
    }
  }

  const handleBulkDelete = async () => {
    if (selectedExpenses.length === 0) return
    if (!ensurePaidSelectionConfirmed()) return
    if (!confirm(`Delete ${selectedExpenses.length} selected expense(s)? This cannot be undone.`)) return
    setBulkDeleteLoading(true)
    try {
      await bulkDeleteExpenses(selectedExpenses)
      setSelectedExpenses([])
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : "Bulk delete failed")
    } finally {
      setBulkDeleteLoading(false)
    }
  }

  const totalSelected = selectedExpenses.reduce((sum, id) => {
    const exp = expenses.find((e) => (e.id ?? e._id) === id)
    return sum + Number(exp?.amount ?? 0)
  }, 0)

  return (
    <main className="p-3 sm:p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Expenses Management</h1>
        <p className="text-muted-foreground mt-1">Track, upload, and manage operational expenses.</p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button style={{ background: "var(--brand)" }} className="gap-2 flex-1 sm:flex-none" onClick={handleAddExpense}>
            <Plus size={16} /> Add Expense
          </Button>
            <Button
              variant="outline"
              className="gap-2 flex-1 sm:flex-none"
              type="button"
              disabled={bulkUploadLoading}
            onClick={() => {
              if (!fileInputRef.current) {
                console.error("[expenses] fileInputRef is null");
                alert("Bulk Upload not ready (file input missing). Refresh the page.");
                return;
              }
              // Clear value so selecting the same file twice will still trigger `onChange`.
              fileInputRef.current.value = "";
              fileInputRef.current.click();
            }}
            >
              {bulkUploadLoading ? "Uploading..." : <><Upload size={16} /> Bulk Upload</>}
            </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={handleBulkUpload}
            // Keep the input in the DOM so programmatic .click() can open the picker.
            style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, opacity: 0 }}
          />
          <Button variant="outline" className="gap-2" onClick={handleDownloadTemplate} disabled={templateLoading}>
            <Download size={16} /> {templateLoading ? "Loading..." : "Download Template"}
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleExportTable} disabled={loading || expenses.length === 0}>
            <Download size={16} /> Export Table (Excel)
          </Button>
        </div>

        {/* Add Expense Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Expense</DialogTitle>
              <DialogDescription>Add a single expense record.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label className="text-xs font-semibold">Property</Label>
                <Select value={addForm.propertyId} onValueChange={(v) => setAddForm((f) => ({ ...f, propertyId: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select property" />
                  </SelectTrigger>
                  <SelectContent>
                    {(filters.properties || []).map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-semibold">Type / Supplier</Label>
                <Select value={addForm.typeId} onValueChange={(v) => setAddForm((f) => ({ ...f, typeId: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(filters.types || []).map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-semibold">Description</Label>
                <Input value={addForm.description} onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))} className="mt-1" placeholder="Description" />
              </div>
              <div>
                <Label className="text-xs font-semibold">Amount ({currencyCode})</Label>
                <Input type="number" value={addForm.amount} onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1" placeholder="0.00" />
              </div>
              <div>
                <Label className="text-xs font-semibold">Date</Label>
                <Input type="date" value={addForm.period} onChange={(e) => setAddForm((f) => ({ ...f, period: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button style={{ background: "var(--brand)" }} onClick={handleSaveAddExpense} disabled={addSaving}>
                {addSaving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk Upload Preview Dialog */}
        <Dialog
          open={showBulkPreviewDialog}
          onOpenChange={(open) => {
            if (!open) {
              setShowBulkPreviewDialog(false)
              setBulkPreviewEntries([])
              setBulkPreviewSelectedIndices([])
            }
          }}
        >
          <DialogContent className="max-w-[95vw] sm:!max-w-[90vw] md:!max-w-[85vw] w-full max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Bulk Upload Preview</DialogTitle>
              <DialogDescription>Review rows and select which ones to import.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  Parsed {bulkPreviewEntries.length} row(s)
                </div>
                <div className="text-sm text-muted-foreground">
                  Selected total: {currencySymbol} {bulkPreviewTotalSelectedAmount.toFixed(2)}
                </div>
              </div>

              <div className="max-h-[52vh] overflow-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left w-10">
                        <input
                          type="checkbox"
                          ref={(el) => {
                            if (!el) return
                            el.indeterminate =
                              bulkPreviewEntries.length > 0 &&
                              bulkPreviewSelectedIndices.length > 0 &&
                              bulkPreviewSelectedIndices.length < bulkPreviewEntries.length
                          }}
                          checked={
                            bulkPreviewEntries.length > 0 &&
                            bulkPreviewSelectedIndices.length === bulkPreviewEntries.length
                          }
                          onChange={bulkPreviewHandleSelectAll}
                          disabled={bulkPreviewEntries.length === 0}
                          className="accent-primary"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground hidden sm:table-cell">Property</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground hidden sm:table-cell">Supplier</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground hidden md:table-cell">Description</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkPreviewEntries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                          No preview available
                        </td>
                      </tr>
                    ) : (
                      bulkPreviewEntries.map((entry, idx) => {
                        const checked = bulkPreviewSelectedIndices.includes(idx)
                        return (
                          <tr key={idx} className="border-b hover:bg-muted/50">
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => bulkPreviewToggleIndex(idx)}
                                className="accent-primary"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">{formatPeriodYmdUtc8(entry.record.period)}</td>
                            <td className="px-4 py-3 text-sm hidden sm:table-cell">{entry.display.property || ""}</td>
                            <td className="px-4 py-3 text-sm hidden sm:table-cell">{entry.display.supplier || ""}</td>
                            <td className="px-4 py-3 text-sm hidden md:table-cell text-muted-foreground">{entry.display.description || ""}</td>
                            <td className="px-4 py-3 text-sm font-semibold">{currencySymbol} {Number(entry.record.amount ?? 0).toLocaleString()}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowBulkPreviewDialog(false)
                  setBulkPreviewEntries([])
                  setBulkPreviewSelectedIndices([])
                }}
              >
                Cancel
              </Button>
              <Button
                style={{ background: "var(--brand)" }}
                onClick={bulkPreviewImportNow}
                disabled={bulkPreviewImportLoading || bulkPreviewSelectedIndices.length === 0}
              >
                {bulkPreviewImportLoading ? "Importing..." : "Import Now"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                    <Input
                      placeholder="Search by supplier or description..."
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                      className="pl-10"
                    />
                  </div>
                </div>
                <Select value={paidFilter} onValueChange={(v) => { setPaidFilter(v); setPage(1) }}>
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={propertyFilter} onValueChange={(v) => { setPropertyFilter(v); setPage(1) }}>
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue placeholder="Property" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Properties</SelectItem>
                    {filters.properties?.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label ?? p.value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                    className="w-36"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                    className="w-36"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Expenses Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b">
            <CardTitle className="flex items-center gap-2">
              <TrendingDown size={18} /> Expenses
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              {selectedExpenses.length > 0 ? (
                <>Selected: {selectedExpenses.length} | Total: <span className="font-semibold text-foreground">{currencySymbol} {Number(totalSelected).toFixed(2)}</span></>
              ) : (
                <>{total} record(s) | Page total: <span className="font-semibold text-foreground">{currencySymbol} {expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0).toFixed(2)}</span></>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        ref={(el) => {
                          if (el) el.indeterminate = total > 0 && selectedExpenses.length > 0 && selectedExpenses.length < total
                        }}
                        checked={total > 0 && selectedExpenses.length === total}
                        onChange={() => handleSelectAll()}
                        disabled={selectAllLoading || total === 0}
                        className="accent-primary"
                      />
                      {selectAllLoading && <span className="ml-1 text-xs text-muted-foreground">...</span>}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Supplier</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground hidden sm:table-cell">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground hidden lg:table-cell">Bill</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                  ) : (
                    expenses.map((expense) => {
                      const id = expense.id ?? expense._id ?? ""
                      return (
                        <tr
                          key={id}
                          className="border-b hover:bg-muted/50 cursor-pointer"
                          onClick={() => setDetailExpense(expense)}
                        >
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedExpenses.includes(id)}
                              onChange={() => handleToggleExpenseSelection(expense)}
                              className="accent-primary"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{formatPeriodYmdUtc8(expense.period)}</td>
                          <td className="px-4 py-3 text-sm font-medium">{expense.billType?.title ?? ""}</td>
                          <td className="px-4 py-3 text-sm hidden sm:table-cell text-muted-foreground">{expense.description ?? ""}</td>
                          <td className="px-4 py-3 text-sm font-semibold">{currencySymbol} {Number(expense.amount ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <Badge className="text-xs" variant={expense.paid ? "default" : "outline"}>
                              {expense.paid ? "Paid" : "Unpaid"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell" onClick={(e) => e.stopPropagation()}>
                            {expense.bukkuurl ? (
                              <a
                                href={expense.bukkuurl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                title="Open purchase bill in accounting"
                              >
                                <ExternalLink size={14} />
                                Open
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 flex gap-1" onClick={(e) => e.stopPropagation()}>
                            {!expense.paid && (
                              <Button variant="ghost" size="sm" className="gap-1" onClick={() => { setSelectedExpenses([id]); openMarkAsPaid() }}>
                                Mark as Paid
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(id)}>
                              <Trash2 size={14} />
                            </Button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            {/* Pagination + page size */}
            {!loading && total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Per page</Label>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => { setPageSize(Number(v)); setPage(1) }}
                    >
                      <SelectTrigger className="w-20 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                    Previous
                  </Button>
                  <span className="px-2 text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail dialog */}
        <Dialog open={!!detailExpense} onOpenChange={(open) => !open && setDetailExpense(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Expense details</DialogTitle>
              <DialogDescription>View and manage this expense.</DialogDescription>
            </DialogHeader>
            {detailExpense && (
              <div className="space-y-3 py-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <p className="text-sm font-medium">{detailExpense.description || "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Type / Supplier</Label>
                  <p className="text-sm font-medium">{detailExpense.billType?.title ?? "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Date</Label>
                  <p className="text-sm font-medium">{detailExpense.period ? formatPeriodYmdUtc8(detailExpense.period) : "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Amount</Label>
                  <p className="text-sm font-semibold">{currencySymbol} {Number(detailExpense.amount ?? 0).toLocaleString()}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Property</Label>
                  <p className="text-sm font-medium">{typeof detailExpense.property === "object" ? detailExpense.property?.shortname ?? "—" : "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Badge variant={detailExpense.paid ? "default" : "outline"}>{detailExpense.paid ? "Paid" : "Unpaid"}</Badge>
                </div>
                {detailExpense.bukkuurl && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Purchase bill (accounting)</Label>
                    <div className="mt-1">
                      <a href={detailExpense.bukkuurl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        <ExternalLink size={14} />
                        Open bill
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailExpense(null)}>Close</Button>
              {detailExpense && !detailExpense.paid && (
                <Button style={{ background: "var(--brand)" }} onClick={() => { const id = detailExpense.id ?? detailExpense._id; if (id) { setSelectedExpenses([id]); setDetailExpense(null); openMarkAsPaid() } }}>
                  Mark as Paid
                </Button>
              )}
              {detailExpense && (
                <Button variant="destructive" onClick={() => { const id = detailExpense.id ?? detailExpense._id; if (id) { handleDelete(id); setDetailExpense(null) } }}>
                  Delete
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Mark as Paid dialog */}
        <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Mark as Paid</DialogTitle>
              <DialogDescription>Choose payment method and date.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label className="text-xs font-semibold">Payment method</Label>
                <Select value={payMethod} onValueChange={(v) => setPayMethod(v as "Cash" | "Bank")}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
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
              <Button style={{ background: "var(--brand)" }} onClick={handleSubmitMarkAsPaid} disabled={paySaving || selectedExpenses.length === 0}>
                {paySaving ? "Saving..." : "Mark as Paid"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Download Bank File – select bank then download (JomPay + Bulk Transfer, or zip when multiple) */}
        <Dialog open={showBankFileDialog} onOpenChange={setShowBankFileDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Download Bank File</DialogTitle>
              <DialogDescription>
                Select bank and download. You may get a ZIP containing JomPay (PayBill) and Bulk Transfer (PBB/IBG) files when both types apply.
              </DialogDescription>
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
              <Button style={{ background: "var(--brand)" }} onClick={handleDownloadBankFile} disabled={bankDownloadLoading || selectedExpenses.length === 0}>
                {bankDownloadLoading ? "Preparing..." : "Download"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk Download */}
        {selectedExpenses.length > 0 && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-foreground">{selectedExpenses.length} expense(s) selected</p>
                  <p className="text-sm text-muted-foreground">Total: {currencySymbol} {Number(totalSelected).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="lg"
                    variant="outline"
                    className="gap-2"
                    onClick={openBankFileDialog}
                    disabled={selectedExpenses.length === 0 || !hasBankBulkTransferAddon}
                    title={!hasBankBulkTransferAddon ? "Requires Bank Bulk Transfer System addon." : undefined}
                  >
                    <Download size={18} /> Download Bank File
                  </Button>
                  <Button size="lg" style={{ background: "var(--brand)" }} className="gap-2" onClick={openMarkAsPaid}>
                    Mark as Paid
                  </Button>
                  <Button
                    size="lg"
                    variant="destructive"
                    className="gap-2"
                    onClick={handleBulkDelete}
                    disabled={bulkDeleteLoading || selectedExpenses.length === 0}
                  >
                    {bulkDeleteLoading ? "Deleting..." : <><Trash2 size={18} /> Bulk Delete</>}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </main>
  )
}
