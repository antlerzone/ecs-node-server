"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { DollarSign, Info, MoreVertical, Search, ExternalLink, Ban, Undo2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  getAdminList,
  updateCommissionRelease,
  getContactList,
  voidCommissionRelease,
  getCommissionReleaseReceiptUrl,
} from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import { getTodayMalaysiaYmd, tenancyDbDateToMalaysiaYmd } from "@/lib/dateMalaysia"

const STAFF_NONE = "_none"

type CommissionReleaseItem = {
  id?: string
  _id?: string
  _type?: string
  tenancy_id?: string
  property_shortname?: string
  room_title?: string
  tenant_name?: string
  checkin_date?: string
  checkout_date?: string
  commission_amount?: number
  chargeon?: string
  due_by_date?: string
  release_amount?: number | null
  release_date?: string | null
  status?: string
  remark?: string | null
  staff_id?: string | null
  bukku_expense_id?: string | null
  _createdDate?: string
}

/** staffdetail rows — same id space as booking submitby / commission_release.staff_id (not client_user). */
type StaffItem = { id?: string; _id?: string; name?: string; email?: string }

function mapContactStaffItems(items: unknown[]): StaffItem[] {
  return items
    .map((item) => {
      const i = item as {
        _id?: string
        raw?: { _id?: string; name?: string; email?: string }
        text?: string
      }
      const id =
        (i.raw?._id && String(i.raw._id).trim()) ||
        (typeof i._id === "string" && i._id.startsWith("staff-") ? i._id.slice(6) : "")
      if (!id) return null
      return {
        id,
        _id: id,
        name: i.raw?.name || i.text || "",
        email: i.raw?.email || "",
      }
    })
    .filter((x): x is StaffItem => x != null && Boolean(x.id))
}

function reasonToMessage(reason: string): string {
  if (reason === "STAFF_NOT_FOUND") {
    return "Recipient staff was not found in Contact Setting. Choose an active staff member, or re-create them under Contacts → Staff."
  }
  if (reason === "NOT_FOUND") return "Commission row was not found or access denied."
  if (reason === "REJECT_NOT_ALLOWED") return "Only a pending commission can be rejected (close case)."
  if (reason === "NOT_PAID") return "Only a paid commission can be reverted to pending."
  if (reason === "BUKKU_VOID_FAILED") return "Could not void the linked Bukku banking expense. Fix the error in accounting or void there first."
  if (reason === "MONEY_OUT_FAILED" || reason?.includes("BUKKU") || reason?.includes("mapping")) {
    return `${reason}. Check accounting integration and Referral / Bank / Cash account mappings.`
  }
  if (reason === "REFERRAL_ACCOUNT_MAPPING_MISSING" || reason?.includes("REFERRAL_ACCOUNT")) {
    return "Map the Referral Fees account in Operator → Accounting for this integration, then try again."
  }
  if (reason?.includes("XERO_SPENDING_FAILED") || reason?.includes("NO_XERO_BANK")) {
    return `${reason}. Check Referral account code and Bank mapping (or XERO_DEFAULT_BANK_ACCOUNT_CODE).`
  }
  return reason
}

function shortId(id: string) {
  if (!id) return ""
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

function formatMoney(amount: number, currencySymbol: string) {
  return `${currencySymbol} ${amount.toFixed(2)}`
}

/** Table cell: payout (release) vs booking commission rule amount */
function releaseSlashCommissionCell(
  c: CommissionReleaseItem,
  currencySymbol: string
) {
  const commission = Number(c.commission_amount ?? 0)
  const rawRelease = c.release_amount
  const hasRelease =
    rawRelease != null && rawRelease !== "" && !Number.isNaN(Number(rawRelease))
  const releaseStr = hasRelease ? formatMoney(Number(rawRelease), currencySymbol) : "—"
  const commissionStr = formatMoney(commission, currencySymbol)
  return (
    <span className="tabular-nums">
      {releaseStr}
      <span className="text-muted-foreground font-normal"> / </span>
      {commissionStr}
    </span>
  )
}

/** Parse due_by_date to calendar year/month in Asia/Kuala_Lumpur (not browser local). */
function getYearMonthDueByMalaysia(d: string | undefined | null): { y: number; m: number } | null {
  const ymd = tenancyDbDateToMalaysiaYmd(d)
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const [ys, ms] = ymd.split("-")
  return { y: Number(ys), m: Number(ms) }
}

const MONTHS = [
  { value: "1", label: "Jan" },
  { value: "2", label: "Feb" },
  { value: "3", label: "Mar" },
  { value: "4", label: "Apr" },
  { value: "5", label: "May" },
  { value: "6", label: "Jun" },
  { value: "7", label: "Jul" },
  { value: "8", label: "Aug" },
  { value: "9", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
] as const

/** Defaults from API row: booking `staff_id`, saved release fields */
function initFormFromRow(row: CommissionReleaseItem | undefined) {
  const releaseAmount =
    row?.release_amount != null && row.release_amount !== ""
      ? String(row.release_amount)
      : ""
  const releaseDate = row?.release_date ? tenancyDbDateToMalaysiaYmd(String(row.release_date)).slice(0, 10) : ""
  const bookingStaff = row?.staff_id ? String(row.staff_id).trim() : ""
  const staffId = bookingStaff || STAFF_NONE
  return {
    payReleaseAmount: releaseAmount,
    payReleaseDate: releaseDate || getTodayMalaysiaYmd(),
    payStaffId: staffId,
  }
}

export default function CommissionPage() {
  const { accessCtx } = useOperatorContext()
  const currencyCode = String(accessCtx?.client?.currency || "").trim().toUpperCase()
  const currencySymbol =
    currencyCode === "SGD" ? "S$" : currencyCode === "MYR" ? "RM" : currencyCode

  const [items, setItems] = useState<CommissionReleaseItem[]>([])
  const [staffList, setStaffList] = useState<StaffItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState<string | null>(null)

  /** Filters (client-side on loaded list) */
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "complete" | "void" | "rejected">("all")
  /** "all" or staffdetail id */
  const [staffFilter, setStaffFilter] = useState<string>("all")
  /** "all" or e.g. "2026" */
  const [periodYear, setPeriodYear] = useState<string>("all")
  /** "all" or "1".."12" — applies with due_by_date in that month when year is set */
  const [periodMonth, setPeriodMonth] = useState<string>("all")

  /** Detail drawer: release fields + mark paid / reject */
  const [dialogMode, setDialogMode] = useState<"detail" | null>(null)
  const [dialogRowId, setDialogRowId] = useState<string | null>(null)
  const [payReleaseAmount, setPayReleaseAmount] = useState("")
  const [payReleaseDate, setPayReleaseDate] = useState("")
  const [payMethod, setPayMethod] = useState<"Bank" | "Cash">("Bank")
  const [payStaffId, setPayStaffId] = useState(STAFF_NONE)
  const [paySaving, setPaySaving] = useState(false)
  /** Mark as paid dialog: reject without payout */
  const [rejectReason, setRejectReason] = useState("")

  const [voidOpen, setVoidOpen] = useState(false)
  const [voidRowId, setVoidRowId] = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState("")
  const [voidSaving, setVoidSaving] = useState(false)
  const [receiptLoadingId, setReceiptLoadingId] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await getAdminList({ filterType: "Commission", limit: 500, sort: "new" })
      const list = Array.isArray(res.items) ? res.items : []
      const commissionOnly = list.filter((i) => (i as CommissionReleaseItem)._type === "COMMISSION_RELEASE") as CommissionReleaseItem[]
      setItems(commissionOnly)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    getContactList({ type: "staff", limit: 2000 })
      .then((r) => setStaffList(mapContactStaffItems(Array.isArray(r?.items) ? r.items : [])))
      .catch(() => setStaffList([]))
  }, [])

  const rowById = useCallback(
    (id: string) => items.find((c) => (c.id ?? c._id) === id),
    [items]
  )

  const staffLabelMap = useMemo(() => {
    const m = new Map<string, string>()
    staffList.forEach((s) => {
      const id = String(s.id ?? s._id ?? "").trim()
      if (!id) return
      m.set(id, s.name || s.email || id)
    })
    return m
  }, [staffList])

  /** Years present in due_by_date + current year */
  const yearOptions = useMemo(() => {
    const ys = new Set<number>()
    const yNow = Number(getTodayMalaysiaYmd().slice(0, 4))
    ys.add(yNow)
    items.forEach((c) => {
      const ym = getYearMonthDueByMalaysia(c.due_by_date)
      if (ym) ys.add(ym.y)
    })
    return Array.from(ys).sort((a, b) => b - a)
  }, [items])

  /** Staff ids appearing in data (for filter dropdown) */
  const staffIdsFromItems = useMemo(() => {
    const s = new Set<string>()
    items.forEach((c) => {
      const id = c.staff_id ? String(c.staff_id).trim() : ""
      if (id) s.add(id)
    })
    return s
  }, [items])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((c) => {
      const st = String(c.status || "").toLowerCase()
      if (statusFilter === "pending" && st !== "pending") return false
      if (statusFilter === "complete" && st !== "paid") return false
      if (statusFilter === "void" && st !== "void") return false
      if (statusFilter === "rejected" && st !== "rejected") return false

      if (staffFilter !== "all") {
        const sid = c.staff_id ? String(c.staff_id).trim() : ""
        if (sid !== staffFilter) return false
      }

      if (periodYear !== "all") {
        const ym = getYearMonthDueByMalaysia(c.due_by_date)
        if (!ym) return false
        const wantY = Number(periodYear)
        if (ym.y !== wantY) return false
        if (periodMonth !== "all") {
          const wantM = Number(periodMonth)
          if (ym.m !== wantM) return false
        }
      }

      if (q) {
        const prop = (c.property_shortname ?? "").toLowerCase()
        const room = (c.room_title ?? "").toLowerCase()
        const tenant = (c.tenant_name ?? "").toLowerCase()
        const sid = c.staff_id ? String(c.staff_id).trim() : ""
        const staffName = sid ? (staffLabelMap.get(sid) ?? "").toLowerCase() : ""
        const hay = `${prop} ${room} ${tenant} ${staffName} ${sid.toLowerCase()}`
        if (!hay.includes(q)) return false
      }

      return true
    })
  }, [items, search, statusFilter, staffFilter, periodYear, periodMonth, staffLabelMap])

  const staffIdsInList = new Set(staffList.map((s) => String(s.id ?? s._id ?? "").trim()).filter(Boolean))

  /** Extra Select option when booking staff_id is not in staff list (still editable) */
  const orphanStaffOption = (() => {
    if (!payStaffId || payStaffId === STAFF_NONE || staffIdsInList.has(payStaffId)) return null
    return payStaffId
  })()

  const openDetailDialog = useCallback(
    (rowId: string) => {
      setActionError(null)
      setDialogRowId(rowId)
      setDialogMode("detail")
      const row = items.find((c) => (c.id ?? c._id) === rowId)
      const init = initFormFromRow(row)
      setPayReleaseAmount(init.payReleaseAmount)
      setPayReleaseDate(init.payReleaseDate)
      setPayStaffId(init.payStaffId)
      setPayMethod("Bank")
      setRejectReason("")
    },
    [items]
  )

  const closeDialog = () => {
    setDialogMode(null)
    setDialogRowId(null)
    setRejectReason("")
  }

  const handleSubmitMarkPaid = async () => {
    const id = dialogRowId
    if (!id) return
    if (payStaffId === STAFF_NONE || !payStaffId) {
      setActionError("Select staff (recipient) for referral payment. Accounting will post money out to this contact.")
      return
    }
    setActionError(null)
    setPaySaving(true)
    try {
      const releaseAmount = payReleaseAmount.trim()
      const releaseDate = payReleaseDate.trim()
      const paymentMethod = payMethod === "Cash" ? "cash" : "bank"
      const res = await updateCommissionRelease(id, {
        status: "paid",
        release_amount: releaseAmount !== "" ? Number(releaseAmount) : undefined,
        release_date: releaseDate !== "" ? releaseDate : undefined,
        staff_id: payStaffId,
        payment_method: paymentMethod,
      })
      if (res && typeof res === "object" && "ok" in res && res.ok === false && "reason" in res && res.reason) {
        setActionError(reasonToMessage(String(res.reason)))
        return
      }
      closeDialog()
      await loadData()
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Failed to mark as paid"
      const reason = raw.includes(":") ? raw.split(":").pop()?.trim() ?? raw : raw
      setActionError(reasonToMessage(reason))
    } finally {
      setPaySaving(false)
    }
  }

  const handleUndoReject = async (rowId: string) => {
    if (!rowId) return
    setActionError(null)
    try {
      const res = await updateCommissionRelease(rowId, { status: "pending" })
      if (res && typeof res === "object" && "ok" in res && res.ok === false && "reason" in res && res.reason) {
        setActionError(reasonToMessage(String(res.reason)))
        return
      }
      await loadData()
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Undo failed"
      setActionError(reasonToMessage(raw.includes(":") ? raw.split(":").pop()?.trim() ?? raw : raw))
    }
  }

  const handleRejectCommission = async () => {
    const id = dialogRowId
    if (!id) return
    if (!window.confirm("Reject this commission and close the case without paying staff?")) return
    setActionError(null)
    setPaySaving(true)
    try {
      const res = await updateCommissionRelease(id, {
        status: "rejected",
        reject_reason: rejectReason.trim() || undefined,
      })
      if (res && typeof res === "object" && "ok" in res && res.ok === false && "reason" in res && res.reason) {
        setActionError(reasonToMessage(String(res.reason)))
        return
      }
      closeDialog()
      await loadData()
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Reject failed"
      const reason = raw.includes(":") ? raw.split(":").pop()?.trim() ?? raw : raw
      setActionError(reasonToMessage(reason))
    } finally {
      setPaySaving(false)
    }
  }

  const openVoidDialog = (id: string) => {
    setActionError(null)
    setVoidRowId(id)
    setVoidReason("")
    setVoidOpen(true)
  }

  const handleVoidConfirm = async () => {
    if (!voidRowId) return
    setVoidSaving(true)
    setActionError(null)
    try {
      const res = await voidCommissionRelease(voidRowId, voidReason.trim() || undefined)
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        const r = res as { reason?: string; detail?: string }
        const base = reasonToMessage(String(r.reason || ""))
        setActionError(r.detail ? `${base} ${r.detail}` : base)
        return
      }
      setVoidOpen(false)
      setVoidRowId(null)
      await loadData()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Void failed")
    } finally {
      setVoidSaving(false)
    }
  }

  const openReceipt = async (id: string) => {
    setActionError(null)
    setReceiptLoadingId(id)
    try {
      const res = await getCommissionReleaseReceiptUrl(id)
      if (!res?.url) {
        setActionError(
          "No receipt link: connect Bukku accounting and ensure this payout created a banking expense (bukku_expense_id)."
        )
        return
      }
      window.open(res.url, "_blank", "noopener,noreferrer")
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not open receipt")
    } finally {
      setReceiptLoadingId(null)
    }
  }

  const formatDate = (d?: string) => {
    if (!d) return "—"
    const ymd = tenancyDbDateToMalaysiaYmd(d)
    if (!ymd) return "—"
    try {
      return new Date(`${ymd}T12:00:00+08:00`).toLocaleDateString("en-MY", {
        dateStyle: "short",
        timeZone: "Asia/Kuala_Lumpur",
      })
    } catch {
      return ymd
    }
  }

  const dialogContext = dialogRowId ? rowById(dialogRowId) : undefined

  const dialogOpen = dialogMode !== null && dialogRowId !== null

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <DollarSign size={24} /> Commission (Referral)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Staff commission due by date (from company rules). Use <strong className="text-foreground font-medium">Actions</strong> →{" "}
          <strong className="text-foreground font-medium">More detail</strong> to set release amount, date, and recipient (defaults to the staff chosen at booking); accounting posts money out when you choose Mark as paid.
        </p>
        {actionError && (
          <p className="text-sm text-amber-600 dark:text-amber-500 mt-2" role="alert">
            {actionError}
          </p>
        )}
      </div>

      <Card className="overflow-hidden mb-4">
        <div className="p-4 border-b flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs text-muted-foreground">Search</Label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Property, room, tenant, staff…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="w-full sm:w-[160px]">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as "all" | "pending" | "complete" | "void" | "rejected")}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="complete">Paid</SelectItem>
                <SelectItem value="void">Voided</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-[200px]">
            <Label className="text-xs text-muted-foreground">Staff</Label>
            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="All staff" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All staff</SelectItem>
                {staffList.map((s) => {
                  const sid = s.id ?? s._id ?? ""
                  if (!sid) return null
                  return (
                    <SelectItem key={sid} value={sid}>
                      {s.name || s.email || sid}
                    </SelectItem>
                  )
                })}
                {Array.from(staffIdsFromItems).map((sid) => {
                  if (staffLabelMap.has(sid)) return null
                  return (
                    <SelectItem key={`orphan-${sid}`} value={sid}>
                      Staff ({shortId(sid)})
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <div className="w-[120px]">
              <Label className="text-xs text-muted-foreground">Due by — year</Label>
              <Select
                value={periodYear}
                onValueChange={(v) => {
                  setPeriodYear(v)
                  if (v === "all") setPeriodMonth("all")
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All years</SelectItem>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[120px]">
              <Label className="text-xs text-muted-foreground">Due by — month</Label>
              <Select value={periodMonth} onValueChange={setPeriodMonth} disabled={periodYear === "all"}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All months</SelectItem>
                  {MONTHS.map((mo) => (
                    <SelectItem key={mo.value} value={mo.value}>
                      {mo.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          Date filter uses <strong className="text-foreground font-medium">Due by</strong> month/year. Showing{" "}
          <strong className="text-foreground">{filteredItems.length}</strong> of {items.length}
        </p>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No commission release items.</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No rows match your filters.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Check-in</TableHead>
                <TableHead>Check-out</TableHead>
                <TableHead className="text-right whitespace-nowrap">Release / Commission</TableHead>
                <TableHead>Due by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[72px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((c) => {
                const id = c.id ?? c._id ?? ""
                const st = String(c.status || "").toLowerCase()
                const isPaidRow = st === "paid"
                const isVoidRow = st === "void"
                const isRejectedRow = st === "rejected"
                const hasBukkuExpense = Boolean(c.bukku_expense_id && String(c.bukku_expense_id).trim())
                return (
                  <TableRow key={id}>
                    <TableCell className="font-medium">{c.property_shortname ?? "—"}</TableCell>
                    <TableCell>{c.room_title ?? "—"}</TableCell>
                    <TableCell>{c.tenant_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(c.checkin_date)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(c.checkout_date)}</TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">
                      {releaseSlashCommissionCell(c, currencySymbol)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-amber-600 font-medium">{formatDate(c.due_by_date)}</span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          isRejectedRow
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                            : isVoidRow
                              ? "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                              : isPaidRow
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                        }`}
                      >
                        {isRejectedRow ? "Rejected" : isVoidRow ? "Voided" : isPaidRow ? "Paid" : "Pending"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {!isVoidRow && !isPaidRow && !isRejectedRow && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Actions">
                              <MoreVertical size={16} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetailDialog(id)}>
                              <Info size={14} className="mr-2" /> More detail
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {isPaidRow && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Actions">
                              <MoreVertical size={16} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openVoidDialog(id)}>
                              <Ban size={14} className="mr-2" /> Revert to pending
                            </DropdownMenuItem>
                            {hasBukkuExpense && (
                              <DropdownMenuItem
                                disabled={receiptLoadingId === id}
                                onClick={() => openReceipt(id)}
                              >
                                <ExternalLink size={14} className="mr-2" />
                                {receiptLoadingId === id ? "Opening…" : "Receipt (Bukku)"}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {isVoidRow && hasBukkuExpense && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Actions">
                              <MoreVertical size={16} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={receiptLoadingId === id}
                              onClick={() => openReceipt(id)}
                            >
                              <ExternalLink size={14} className="mr-2" />
                              {receiptLoadingId === id ? "Opening…" : "Receipt (Bukku)"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {isRejectedRow && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Actions">
                              <MoreVertical size={16} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => void handleUndoReject(id)}>
                              <Undo2 size={14} className="mr-2" /> Undo
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>More detail</DialogTitle>
            <DialogDescription>
              Set recipient, release amount, and date. Use <strong className="text-foreground">Mark as paid</strong> to post
              accounting payout, or <strong className="text-foreground">Reject</strong> to close without paying.
            </DialogDescription>
          </DialogHeader>
          {dialogContext && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {dialogContext.property_shortname ?? "—"} · {dialogContext.room_title ?? "—"}
              </span>
              <br />
              Tenant: {dialogContext.tenant_name ?? "—"}
            </div>
          )}
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold">Recipient (staff)</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1">
                List matches Contacts → Staff (same as booking &quot;belongs to&quot;). Not portal login users. Defaults to this booking&apos;s staff; change if needed.
              </p>
              <Select value={payStaffId} onValueChange={setPayStaffId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STAFF_NONE}>— Select staff —</SelectItem>
                  {orphanStaffOption ? (
                    <SelectItem value={orphanStaffOption}>
                      Booking staff ({shortId(orphanStaffOption)})
                    </SelectItem>
                  ) : null}
                  {staffList.map((s) => {
                    const sid = s.id ?? s._id ?? ""
                    if (!sid) return null
                    return (
                      <SelectItem key={sid} value={sid}>
                        {s.name || s.email || sid}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Release amount (referral, {currencyCode})</Label>
              <Input
                type="number"
                className="mt-1"
                placeholder={currencySymbol}
                value={payReleaseAmount}
                onChange={(e) => setPayReleaseAmount(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Payment method</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as "Cash" | "Bank")}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bank">Bank</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Release / payment date</Label>
              <Input type="date" className="mt-1" value={payReleaseDate} onChange={(e) => setPayReleaseDate(e.target.value)} />
            </div>
            <div className="rounded-md border border-border/80 bg-muted/30 px-3 py-3 space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground">Reject (close case)</Label>
              <p className="text-xs text-muted-foreground">
                No payout and no accounting money-out. Optional note is stored on the record.
              </p>
              <Textarea
                className="min-h-[64px] text-sm"
                placeholder="Reason (optional)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                disabled={paySaving}
              />
            </div>
          </div>
          <DialogFooter className="flex-col gap-3 sm:flex-row sm:justify-between sm:items-end sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => void handleRejectCommission()}
              disabled={paySaving || !dialogRowId}
            >
              Reject (close case)
            </Button>
            <div className="flex w-full sm:w-auto gap-2 justify-end">
              <Button variant="outline" onClick={closeDialog} type="button">
                Cancel
              </Button>
              <Button style={{ background: "var(--brand)" }} onClick={handleSubmitMarkPaid} disabled={paySaving || !dialogRowId} type="button">
                {paySaving ? "Saving..." : "Mark as paid"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={voidOpen}
        onOpenChange={(o) => {
          if (!o) {
            setVoidOpen(false)
            setVoidRowId(null)
            setVoidReason("")
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert payout to pending?</AlertDialogTitle>
            <AlertDialogDescription>
              Sets this row back to <strong className="text-foreground">Pending</strong> and clears the payout in accounting: Bukku banking expense (money out) or Xero spend is voided when linked (requires valid API credentials).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-2">
            <Label className="text-xs font-medium">Reason (optional)</Label>
            <Textarea
              className="min-h-[72px]"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Paid to wrong staff"
              disabled={voidSaving}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voidSaving}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void handleVoidConfirm()} disabled={voidSaving}>
              {voidSaving ? "Reverting…" : "Revert to pending"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
