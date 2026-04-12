"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  ClipboardList,
  Eye,
  Loader2,
  Plus,
  Trash2,
  ArrowLeft,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { otherFeesRowsFromAdmin } from "@/lib/admin-other-fees"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import {
  getAdmin,
  getAdminRules,
  getBookingStaff,
  getAvailableRooms,
  getBookingRoom,
  getParkingLotsByProperty,
  lookupTenantForBooking,
  createBooking,
} from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import { toast } from "sonner"

/** Canonical account template ids — same as server booking.service / migrations */
const BUKKU = {
  RENTAL: "ae94f899-7f34-4aba-b6ee-39b97496e2a3",
  DEPOSIT: "18ba3daf-7208-46fc-8e97-43f34e898401",
  AGREEMENT: "e1b2c3d4-2003-4000-8000-000000000303",
  PARKING: "e1b2c3d4-2004-4000-8000-000000000304",
  TENANT_COMMISSION: "e1b2c3d4-2002-4000-8000-000000000302",
  OWNER_COMMISSION: "86da59c0-992c-4e40-8efd-9d6d793eaf6a",
  /** Generic / other fees line — matches server booking.service OTHER bucket */
  OTHER: "94b4e060-3999-4c76-8189-f969615c0a7d",
} as const

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function wholeMonthsBetweenInclusive(beginStr: string, endStr: string): number {
  const begin = parseYmd(beginStr)
  const end = parseYmd(endStr)
  if (!begin || !end || end < begin) return 0
  return (end.getFullYear() - begin.getFullYear()) * 12 + (end.getMonth() - begin.getMonth()) + 1
}

function daysInSameMonthRange(beginStr: string, endStr: string): { occupied: number; total: number } | null {
  const begin = parseYmd(beginStr)
  const end = parseYmd(endStr)
  if (!begin || !end || end < begin) return null
  if (begin.getFullYear() !== end.getFullYear() || begin.getMonth() !== end.getMonth()) return null
  const total = new Date(begin.getFullYear(), begin.getMonth() + 1, 0).getDate()
  const occupied = end.getDate() - begin.getDate() + 1
  return { occupied: Math.max(0, occupied), total }
}

function parseCommissionRules(
  adminRules: Record<string, unknown> | null
): Array<{ month: number; chargeon: "tenant" | "owner"; amountType: string; fixedAmount: string }> {
  const raw = (adminRules?.commissionRules ?? null) as unknown
  if (!Array.isArray(raw)) return []
  return raw
    .map((r, i) => {
      const row = (r ?? {}) as { month?: unknown; chargeon?: unknown; amountType?: unknown; fixedAmount?: unknown }
      const month = Number(row.month ?? i + 1)
      const chargeon = row.chargeon === "owner" ? "owner" : "tenant"
      const amountType = String(row.amountType ?? "prorate")
      const fixedAmount = String(row.fixedAmount ?? "")
      return { month, chargeon, amountType, fixedAmount }
    })
    .filter((r) => Number.isFinite(r.month) && r.month >= 1)
}

function getCommissionFromRule(params: {
  beginDate: string
  endDate: string
  monthlyRental: number
  rules: Array<{ month: number; chargeon: "tenant" | "owner"; amountType: string; fixedAmount: string }>
}): { amount: number; chargeon: "tenant" | "owner"; month: number } | null {
  const { beginDate, endDate, monthlyRental, rules } = params
  if (!beginDate || !endDate || monthlyRental <= 0 || rules.length === 0) return null
  const tenancyMonths = wholeMonthsBetweenInclusive(beginDate, endDate)
  if (tenancyMonths <= 0) return null

  const selectedMonth = Math.min(24, Math.max(1, tenancyMonths))
  const sorted = [...rules].sort((a, b) => a.month - b.month)
  const selected = sorted.find((r) => r.month === selectedMonth) ?? sorted[sorted.length - 1]
  if (!selected) return null

  let amount = 0
  const t = selected.amountType
  if (t === "specific") {
    amount = parseFloat(selected.fixedAmount) || 0
  } else if (t === "tenancy_months") {
    amount = (monthlyRental / 12) * tenancyMonths
  } else if (t === "prorate") {
    const sameMonth = daysInSameMonthRange(beginDate, endDate)
    if (sameMonth) {
      amount = (sameMonth.occupied / sameMonth.total) * monthlyRental
    } else {
      amount = monthlyRental
    }
  } else {
    const n = parseFloat(String(t))
    if (Number.isFinite(n) && n > 0) amount = n * monthlyRental
  }

  return { amount: round2(Math.max(0, amount)), chargeon: selected.chargeon, month: selected.month }
}

function parseYmd(s: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + "T12:00:00")
  return Number.isNaN(d.getTime()) ? null : d
}

/** Prorated rent + prorated parking per calendar month (parking = monthly total × same day-ratio as rent). */
function getProratedMonthlySegments(
  beginStr: string,
  endStr: string,
  monthlyRental: number,
  monthlyParkingTotal: number
): Array<{
  periodStart: string
  periodEnd: string
  rentalAmount: number
  parkingAmount: number
}> {
  const begin = parseYmd(beginStr)
  const end = parseYmd(endStr)
  if (!begin || !end || end < begin) return []
  const out: Array<{
    periodStart: string
    periodEnd: string
    rentalAmount: number
    parkingAmount: number
  }> = []
  let cur = new Date(begin.getFullYear(), begin.getMonth(), 1)
  const endDay = end.getTime()
  while (cur.getTime() <= endDay) {
    const y = cur.getFullYear()
    const m = cur.getMonth()
    const monthStart = new Date(y, m, 1)
    const monthEnd = new Date(y, m + 1, 0)
    const segStart = begin > monthStart ? begin : monthStart
    const segEnd = end < monthEnd ? end : monthEnd
    const daysInMonth = (monthEnd.getTime() - monthStart.getTime()) / 86400000 + 1
    const segDays = (segEnd.getTime() - segStart.getTime()) / 86400000 + 1
    const ratio = segDays / daysInMonth
    const rentalAmount = round2(monthlyRental * ratio)
    const parkingAmount = round2(monthlyParkingTotal * ratio)
    if (rentalAmount > 0 || parkingAmount > 0) {
      out.push({
        periodStart: segStart.toISOString(),
        periodEnd: segEnd.toISOString(),
        rentalAmount,
        parkingAmount,
      })
    }
    cur = new Date(y, m + 1, 1)
  }
  return out
}

/** Blueprint rows: separate rental + parking line per segment (matches rentalcollection generation). */
function blueprintRecurringLinesFromSegments(
  segments: ReturnType<typeof getProratedMonthlySegments>,
  /** Nominal monthly parking (all lots) — prorate uses this; total for rental lines. */
  monthlyParkingTotal: number,
  /** Same as booking field "Parking fee per lot / month" — Extend/Change Room prefill reads this. */
  parkingFeePerLot: number
): Array<Record<string, unknown>> {
  const lines: Array<Record<string, unknown>> = []
  const parkingNominal = round2(monthlyParkingTotal)
  const perLot = round2(parkingFeePerLot)
  for (const seg of segments) {
    if (seg.rentalAmount > 0) {
      lines.push({
        type: "rental",
        bukkuid: BUKKU.RENTAL,
        amount: seg.rentalAmount,
        dueDate: seg.periodStart,
        periodStart: seg.periodStart,
        periodEnd: seg.periodEnd,
      })
    }
    if (seg.parkingAmount > 0) {
      lines.push({
        type: "parking",
        bukkuid: BUKKU.PARKING,
        amount: seg.parkingAmount,
        ...(perLot > 0 ? { parkingFeePerLot: perLot } : {}),
        ...(parkingNominal > 0 ? { monthlyParkingTotal: parkingNominal } : {}),
        dueDate: seg.periodStart,
        periodStart: seg.periodStart,
        periodEnd: seg.periodEnd,
      })
    }
  }
  return lines
}

function computeDeposit(monthly: number, depositType: string, depositValue: string): number {
  if (depositType === "specific") return round2(parseFloat(depositValue) || 0)
  const months = parseFloat(depositType) || 1
  return round2(monthly * months)
}

function formatYmdLocal(d: Date): string {
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}

function daysInMonth(y: number, monthIndex: number): number {
  return new Date(y, monthIndex + 1, 0).getDate()
}

/** Same calendar day N months ahead (clamp to month length). */
function addMonthsSameDayFromParts(y: number, m: number, d: number, n: number): Date {
  const dim = daysInMonth(y, m + n)
  const dd = Math.min(d, dim)
  return new Date(y, m + n, dd)
}

/**
 * Lease end from start + quick duration (3/6/12/24 mo), aligned to Company Settings → Rental invoice date.
 * - first / last (incl. "1st of every month"): end is always **last day of a calendar month**.
 * - specific (e.g. 15th): end is always **day D−1** in the end month (e.g. 15 → ends 14th).
 * - movein: flexible — same day + N months, then minus 1 day (any calendar end).
 */
function computeLeaseEndFromStart(
  startStr: string,
  periodMonths: number,
  rentalType: string,
  rentalValue: string
): string {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startStr)
  if (!p || periodMonths <= 0) return ""
  const y = Number(p[1])
  const m = Number(p[2]) - 1
  const d = Number(p[3])
  const t = rentalType || "first"
  const D = Math.min(31, Math.max(1, parseInt(String(rentalValue || "1"), 10) || 1))

  if (t === "movein") {
    const end = addMonthsSameDayFromParts(y, m, d, periodMonths)
    end.setDate(end.getDate() - 1)
    return formatYmdLocal(end)
  }

  if (t === "specific") {
    const targetMonth = m + periodMonths
    const dim = daysInMonth(y, targetMonth)
    /** Invoice on day D → lease ends previous calendar day (D−1). */
    const endDay = D > 1 ? D - 1 : dim
    const day = Math.min(Math.max(1, endDay), dim)
    return formatYmdLocal(new Date(y, targetMonth, day))
  }

  // first & last: rent cycle aligns to month boundaries → end date is always month-end.
  const end = new Date(y, m + periodMonths, 0)
  return formatYmdLocal(end)
}

/**
 * Snap a chosen calendar month to the allowed lease end day for this rental rule.
 * movein: no change (flexible). first/last: last day of that month. specific: day D−1 in that month.
 */
function snapEndDateToRentalRule(endStr: string, rentalType: string, rentalValue: string): string {
  const end = parseYmd(endStr)
  if (!end) return endStr
  const t = rentalType || "first"
  if (t === "movein") return endStr

  const y = end.getFullYear()
  const m = end.getMonth()
  const dim = daysInMonth(y, m)

  if (t === "specific") {
    const D = Math.min(31, Math.max(1, parseInt(String(rentalValue || "1"), 10) || 1))
    const endDay = D > 1 ? D - 1 : dim
    const day = Math.min(Math.max(1, endDay), dim)
    return formatYmdLocal(new Date(y, m, day))
  }

  return formatYmdLocal(new Date(y, m, dim))
}

/** Lots × fee when lots exist; if property has no parking rows, fee alone = 1 implicit lot for preview/submit. */
function effectiveParkingLotUnits(
  parkingFeeNum: number,
  parkingLotsLength: number,
  selectedCount: number
): number {
  if (parkingFeeNum <= 0) return 0
  if (parkingLotsLength === 0) return 1
  return selectedCount
}

function rentalInvoiceLabel(type: string, value: string): string {
  if (type === "first") return "First day of month"
  if (type === "last") return "Last day of month"
  if (type === "movein") return "Move-in date"
  if (type === "specific") return `Day ${value || "?"}`
  return type || "First day of month"
}

function parseDateRuleFromAdmin(admin: Record<string, unknown> | null, key: "rental" | "commissionDate"): {
  type: string
  value: string
} {
  const root = (admin ?? {}) as Record<string, unknown>
  const v = (root[key] ?? {}) as { type?: unknown; value?: unknown }
  const type = String(v.type ?? "first")
  const value = String(v.value ?? "")
  return { type, value }
}

/**
 * Store due as local calendar date at noon — avoids `toISOString()` shifting the calendar day in UTC+8 (e.g. 10th → 9th in DB/UI).
 */
function formatLocalDateAtNoon(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}T12:00:00`
}

/**
 * Commission due date (single line on booking).
 * Rule: first commission is due in the **calendar month immediately after check-in month**, with Company "Commission Date" (first/last/specific day).
 * e.g. check-in 2026-03-24 + specific 10 → **2026-04-10** (not tied to commission-rules row `month` for *amount*, which may be 2 for short leases and would wrongly shift to May).
 * Company Setting calls this commission release date (not tenant collection due); booking maps it to blueprint line due dates.
 */
function computeCommissionDueDateIso(
  beginDate: string,
  _commissionMonth: number,
  dateRuleType: string,
  dateRuleValue: string
): string {
  const begin = parseYmd(beginDate)
  if (!begin) return formatLocalDateAtNoon(new Date())
  // Next calendar month after check-in month (March check-in → April due month).
  const calendarMonthStart = new Date(begin.getFullYear(), begin.getMonth() + 1, 1)
  const type = dateRuleType || "first"
  if (type === "first") {
    return formatLocalDateAtNoon(new Date(calendarMonthStart.getFullYear(), calendarMonthStart.getMonth(), 1))
  }
  if (type === "last") {
    return formatLocalDateAtNoon(new Date(calendarMonthStart.getFullYear(), calendarMonthStart.getMonth() + 1, 0))
  }
  if (type === "specific") {
    const reqDay = Math.min(31, Math.max(1, parseInt(String(dateRuleValue || "1"), 10) || 1))
    const day = Math.min(reqDay, daysInMonth(calendarMonthStart.getFullYear(), calendarMonthStart.getMonth()))
    return formatLocalDateAtNoon(new Date(calendarMonthStart.getFullYear(), calendarMonthStart.getMonth(), day))
  }
  const d = Math.min(begin.getDate(), daysInMonth(calendarMonthStart.getFullYear(), calendarMonthStart.getMonth()))
  return formatLocalDateAtNoon(new Date(calendarMonthStart.getFullYear(), calendarMonthStart.getMonth(), d))
}

function dayOrdinal(n: number): string {
  const j = n % 10
  const k = n % 100
  if (j === 1 && k !== 11) return `${n}st`
  if (j === 2 && k !== 12) return `${n}nd`
  if (j === 3 && k !== 13) return `${n}rd`
  return `${n}th`
}

/** Explains how 3 mo / 6 mo / 1 yr / 2 yr snaps the End date. */
function leaseEndSnapHint(rentalType: string, rentalValue: string): string {
  const t = rentalType || "first"
  if (t === "movein") {
    return "Move-in based: quick length adds N months from Start (same calendar day), then End is the day before — checkout date is flexible."
  }
  if (t === "specific") {
    const D = Math.min(31, Math.max(1, parseInt(String(rentalValue || "1"), 10) || 1))
    const endDay = D > 1 ? D - 1 : "last day"
    return `Invoice on day ${D}: lease End snaps to the ${typeof endDay === "number" ? dayOrdinal(endDay) : endDay} of the end month (day before billing).`
  }
  if (t === "last") {
    return "Last-day-of-month billing: End is always the last day of a calendar month."
  }
  return "First of month: End is always the last day of a calendar month (contract runs to month-end)."
}

type TenantBookingKind = "new" | "returning_scored" | "former"

type TenantLookupResult = {
  ok?: boolean
  hasValidEmail?: boolean
  hasRecord?: boolean
  tenantId?: string | null
  fullname?: string | null
  approvedForClient?: boolean
  hasActiveTenancy?: boolean
  hasPastTenancy?: boolean
  reviewCount?: number
  averageOverallScore?: number | null
  latestReview?: {
    overallScore?: number
    paymentScoreFinal?: number
    unitCareScore?: number
    communicationScore?: number
    createdAt?: string
  } | null
}

function defaultTenantKind(l: TenantLookupResult): TenantBookingKind {
  if (!l.hasRecord) return "new"
  if (l.hasPastTenancy && !l.hasActiveTenancy) return "former"
  return "returning_scored"
}

/** Single line for UI — derived from lookup only (not user-editable). */
function getTenantKindDisplayLine(l: TenantLookupResult | null): string | null {
  if (!l || l.hasValidEmail === false) return null
  if (!l.hasRecord) return "New tenant — no profile with this email yet."
  const kind = defaultTenantKind(l)
  if (kind === "former") return "Former tenant — had a completed stay before (not ongoing)."
  if ((l.reviewCount ?? 0) > 0 && l.averageOverallScore != null) {
    const n = l.reviewCount ?? 0
    return `Returning tenant — average overall score ${l.averageOverallScore.toFixed(2)} / 10 (${n} review${n === 1 ? "" : "s"}).`
  }
  return "Returning / known tenant — profile exists (no reviews yet)."
}

function buildBlueprint(params: {
  beginDate: string
  endDate: string
  monthlyRental: number
  deposit: number
  agreementFees: number
  parkingFees: number
  parkingCount: number
  addOns: Array<{ name: string; amount: number }>
  commissionAmount: number
  commissionChargeOn: "tenant" | "owner"
  commissionMonth: number
  commissionDateType: string
  commissionDateValue: string
}) {
  const beginIso = params.beginDate ? `${params.beginDate}T00:00:00.000Z` : new Date().toISOString()
  const lines: Array<Record<string, unknown>> = []

  if (params.deposit > 0) {
    lines.push({
      type: "deposit",
      bukkuid: BUKKU.DEPOSIT,
      amount: params.deposit,
      dueDate: beginIso,
    })
  }
  if (params.agreementFees > 0) {
    lines.push({
      type: "agreement",
      bukkuid: BUKKU.AGREEMENT,
      amount: params.agreementFees,
      dueDate: beginIso,
    })
  }
  /** Parking is recurring (per lot / month), prorated in each calendar month — not a one-time move-in lump. */
  for (const a of params.addOns) {
    if (a.amount > 0) {
      lines.push({
        type: "addon",
        name: a.name,
        bukkuid: BUKKU.OTHER,
        amount: a.amount,
        dueDate: beginIso,
      })
    }
  }
  if (params.commissionAmount > 0) {
    const bukkuid = params.commissionChargeOn === "owner" ? BUKKU.OWNER_COMMISSION : BUKKU.TENANT_COMMISSION
    lines.push({
      type: "commission",
      bukkuid,
      amount: params.commissionAmount,
      dueDate: computeCommissionDueDateIso(
        params.beginDate,
        params.commissionMonth,
        params.commissionDateType,
        params.commissionDateValue
      ),
      chargeon: params.commissionChargeOn,
    })
  }
  const parkingFeePerLot = params.parkingCount > 0 ? round2(params.parkingFees) : 0
  const monthlyParkingTotal =
    params.parkingCount > 0 ? round2(params.parkingFees * params.parkingCount) : 0
  for (const row of blueprintRecurringLinesFromSegments(
    getProratedMonthlySegments(
      params.beginDate,
      params.endDate,
      params.monthlyRental,
      monthlyParkingTotal
    ),
    monthlyParkingTotal,
    parkingFeePerLot
  )) {
    lines.push(row)
  }

  return lines
}

function formatPeriodLabel(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString("en-MY", { year: "numeric", month: "short", day: "numeric" })
  } catch {
    return iso
  }
}

/** YYYY-MM-DD → "15 Mar 2026" (matches Available Unit) */
function formatAvailableOnDate(ymd: string | null | undefined): string {
  if (!ymd || typeof ymd !== "string") return ""
  const d = new Date(ymd + "T12:00:00")
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

type AvailableRoomRow = {
  _id: string
  title_fld?: string
  label?: string
  available?: boolean
  availablesoon?: boolean
  availableFrom?: string | null
}

/** Malaysia calendar YYYY-MM-DD (aligns with server getTodayMalaysiaDate) */
function getTodayMalaysiaYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date())
}

function roomOptionDisplayLine(r: AvailableRoomRow): string {
  const base = r.title_fld || r.label || r._id
  const today = getTodayMalaysiaYmd()
  const from = (r.availableFrom ?? "").trim().substring(0, 10)
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(from)
  const fromOnOrBeforeToday = dateOk && from <= today

  // Same as API: vacancy date already passed → "available now" (handles stale DB flags).
  if (r.available || (r.availablesoon && fromOnOrBeforeToday)) {
    return `${base} (available now)`
  }
  if (r.availablesoon && dateOk && from > today) {
    const on = formatAvailableOnDate(from)
    return on ? `${base} (available on ${on})` : `${base} (available soon)`
  }
  if (r.availablesoon) return `${base} (available soon)`
  return base
}

export default function OperatorBookingPage() {
  const router = useRouter()
  const { accessCtx } = useOperatorContext()
  const currencyCode = String(accessCtx?.client?.currency || "").toUpperCase()
  const currencySymbol = currencyCode === "SGD" ? "S$" : (currencyCode === "MYR" ? "RM" : currencyCode)
  const [bootLoading, setBootLoading] = useState(true)
  const [adminRules, setAdminRules] = useState<Record<string, unknown> | null>(null)
  const [bookingStaff, setBookingStaff] = useState<Array<{ id: string; name?: string; email?: string; active?: boolean }>>([])
  const [submitbyStaffId, setSubmitbyStaffId] = useState("")
  const [fees, setFees] = useState({
    agreementFees: "150",
    parking: "100",
    depositType: "1",
    depositValue: "",
    /** From company admin.otherFees — one or more default add-on rows */
    otherFeesList: [] as Array<{ name: string; amount: string }>,
    /** Company Settings → Rental invoice date (admin.rental) */
    rentalType: "first",
    rentalValue: "",
  })

  const [roomPopoverOpen, setRoomPopoverOpen] = useState(false)
  const [roomSearchQuery, setRoomSearchQuery] = useState("")
  const [rooms, setRooms] = useState<AvailableRoomRow[]>([])
  const roomLabelCacheRef = useRef<Map<string, string>>(new Map())
  const [roomsLoading, setRoomsLoading] = useState(false)
  const [roomId, setRoomId] = useState<string>("")
  const [roomPrice, setRoomPrice] = useState<number>(0)
  const [propertyId, setPropertyId] = useState<string>("")

  /** Tenant is identified by email only; backend resolves existing tenant or creates pending record. */
  const [tenantEmail, setTenantEmail] = useState("")
  const [tenantLookup, setTenantLookup] = useState<TenantLookupResult | null>(null)
  const [tenantLookupLoading, setTenantLookupLoading] = useState(false)

  const [beginDate, setBeginDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [selectedLeaseMonths, setSelectedLeaseMonths] = useState<number | null>(null)

  const [rental, setRental] = useState("")
  const [deposit, setDeposit] = useState("")
  const [agreementFees, setAgreementFees] = useState("")
  const [parkingFees, setParkingFees] = useState("")
  const [parkingLots, setParkingLots] = useState<Array<{ _id: string; label?: string; parkinglot?: string }>>([])
  const [selectedParking, setSelectedParking] = useState<string[]>([])

  const [addOns, setAddOns] = useState<Array<{ name: string; amount: string }>>([])

  const [commissionAmount, setCommissionAmount] = useState("")
  const [commissionChargeOn, setCommissionChargeOn] = useState<"tenant" | "owner">("tenant")
  const [commissionTouched, setCommissionTouched] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const roomSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tenancyRedirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tenantEmailLookupRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setBootLoading(true)
      try {
        const [rulesResRaw, adminResRaw, staffResRaw] = await Promise.allSettled([
          getAdminRules(),
          getAdmin(),
          getBookingStaff(),
        ])
        if (cancelled) return
        const rulesRes = rulesResRaw.status === "fulfilled" ? rulesResRaw.value : null
        const adminRes = adminResRaw.status === "fulfilled" ? adminResRaw.value : null
        const staffRes = staffResRaw.status === "fulfilled" ? staffResRaw.value : null
        if (rulesRes?.admin && typeof rulesRes.admin === "object") {
          setAdminRules(rulesRes.admin as Record<string, unknown>)
        }
        if (adminRes?.admin && typeof adminRes.admin === "object") {
          const a = adminRes.admin as Record<string, unknown>
          setFees({
            agreementFees: String(a.agreementFees ?? "150"),
            parking: String(a.parking ?? "100"),
            depositType: ((a.deposit as { type?: string })?.type) || "1",
            depositValue: String(((a.deposit as { value?: string })?.value) || ""),
            otherFeesList: otherFeesRowsFromAdmin(a.otherFees),
            rentalType: ((a.rental as { type?: string })?.type) || "first",
            rentalValue: String(((a.rental as { value?: string })?.value) || ""),
          })
        }
        if (Array.isArray(staffRes?.items)) {
          setBookingStaff(staffRes.items)
        }
        const preferred = String(staffRes?.currentStaffId ?? "").trim()
        const hasPreferred = Array.isArray(staffRes?.items) && staffRes.items.some((s) => String(s.id) === preferred)
        if (preferred && hasPreferred) {
          setSubmitbyStaffId(preferred)
        } else if (Array.isArray(staffRes?.items) && staffRes.items.length > 0) {
          setSubmitbyStaffId(String(staffRes.items[0]?.id ?? ""))
        } else {
          setSubmitbyStaffId("")
        }
      } catch (e) {
        console.error("[booking] boot", e)
      } finally {
        if (!cancelled) setBootLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadRooms = useCallback(async (keyword: string) => {
    setRoomsLoading(true)
    try {
      const res = await getAvailableRooms(keyword)
      setRooms(res.items ?? [])
    } catch (e) {
      console.error("[booking] rooms", e)
      setRooms([])
    } finally {
      setRoomsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!roomPopoverOpen) return
    if (roomSearchRef.current) clearTimeout(roomSearchRef.current)
    roomSearchRef.current = setTimeout(() => {
      loadRooms(roomSearchQuery)
    }, 300)
    return () => {
      if (roomSearchRef.current) clearTimeout(roomSearchRef.current)
    }
  }, [roomSearchQuery, roomPopoverOpen, loadRooms])

  const selectedRoomButtonLabel = useMemo(() => {
    if (!roomId) return null
    const inList = rooms.find((r) => r._id === roomId)
    if (inList) {
      const line = roomOptionDisplayLine(inList)
      roomLabelCacheRef.current.set(roomId, line)
      return line
    }
    return roomLabelCacheRef.current.get(roomId) ?? null
  }, [roomId, rooms])

  useEffect(() => {
    const raw = tenantEmail.trim()
    if (!raw.includes("@")) {
      setTenantLookup(null)
      setTenantLookupLoading(false)
      return
    }
    if (tenantEmailLookupRef.current) clearTimeout(tenantEmailLookupRef.current)
    setTenantLookupLoading(true)
    tenantEmailLookupRef.current = setTimeout(async () => {
      try {
        const res = await lookupTenantForBooking(raw)
        setTenantLookup(res as TenantLookupResult)
      } catch (e) {
        console.error("[booking] lookup tenant", e)
        setTenantLookup(null)
      } finally {
        setTenantLookupLoading(false)
      }
    }, 450)
    return () => {
      if (tenantEmailLookupRef.current) clearTimeout(tenantEmailLookupRef.current)
    }
  }, [tenantEmail])

  useEffect(() => {
    if (!roomId) {
      setRoomPrice(0)
      setPropertyId("")
      setParkingLots([])
      setSelectedParking([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await getBookingRoom(roomId)
        if (cancelled) return
        const price = Number(res.room?.price ?? res.room?.rental ?? 0) || 0
        const pid = String(res.room?.property_id ?? res.room?.property?._id ?? "")
        setRoomPrice(price)
        setPropertyId(pid)
        setRental(price ? String(price) : "")
        const dep = computeDeposit(price, fees.depositType, fees.depositValue)
        setDeposit(dep ? String(dep) : "")
        setAgreementFees(fees.agreementFees)
        setParkingFees(fees.parking)
        if (pid) {
          const pr = await getParkingLotsByProperty(pid)
          if (!cancelled) {
            setParkingLots(pr.items ?? [])
            setSelectedParking([])
          }
        } else {
          setParkingLots([])
        }
        const fromCompany = fees.otherFeesList.filter(
          (r) => r.name.trim() && parseFloat(r.amount) > 0
        )
        if (fromCompany.length > 0) {
          setAddOns(fromCompany.map((r) => ({ name: r.name.trim(), amount: r.amount })))
        }
      } catch (e) {
        console.error("[booking] room", e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [roomId, fees.depositType, fees.depositValue, fees.agreementFees, fees.parking, fees.otherFeesList])

  const monthlyNum = parseFloat(rental) || 0
  const depositNum = parseFloat(deposit) || 0
  const agreementNum = parseFloat(agreementFees) || 0
  const parkingFeeNum = parseFloat(parkingFees) || 0
  const commissionNum = parseFloat(commissionAmount) || 0

  const autoCommission = useMemo(
    () =>
      getCommissionFromRule({
        beginDate,
        endDate,
        monthlyRental: monthlyNum,
        rules: parseCommissionRules(adminRules),
      }),
    [beginDate, endDate, monthlyNum, adminRules]
  )

  useEffect(() => {
    if (commissionTouched) return
    if (!autoCommission) {
      setCommissionAmount("")
      setCommissionChargeOn("tenant")
      return
    }
    setCommissionAmount(autoCommission.amount > 0 ? String(autoCommission.amount) : "")
    setCommissionChargeOn(autoCommission.chargeon)
  }, [autoCommission, commissionTouched])

  useEffect(() => {
    // If user cleared manual override value, allow auto-fill to take over again.
    if (commissionTouched && !commissionAmount.trim()) {
      setCommissionTouched(false)
    }
  }, [commissionTouched, commissionAmount])

  useEffect(() => {
    return () => {
      if (tenancyRedirectTimerRef.current) {
        clearTimeout(tenancyRedirectTimerRef.current)
        tenancyRedirectTimerRef.current = null
      }
    }
  }, [])

  const addOnParsed = useMemo(
    () =>
      addOns
        .map((a) => ({ name: a.name.trim(), amount: round2(parseFloat(a.amount) || 0) }))
        .filter((a) => a.name && a.amount > 0),
    [addOns]
  )

  /** 0 lots selected with inventory = no parking; no inventory rows = 1 implicit lot when fee > 0. */
  const parkingLotUnits = useMemo(
    () => effectiveParkingLotUnits(parkingFeeNum, parkingLots.length, selectedParking.length),
    [parkingFeeNum, parkingLots.length, selectedParking.length]
  )

  /** Keep End aligned when rules load or date was set before snap logic (non–move-in only). */
  useEffect(() => {
    if (!endDate) return
    const t = fees.rentalType || "first"
    if (t === "movein") return
    const snapped = snapEndDateToRentalRule(endDate, fees.rentalType, fees.rentalValue)
    if (snapped !== endDate) setEndDate(snapped)
  }, [endDate, fees.rentalType, fees.rentalValue])

  /** Mirrors billing blueprint: one-time move-in lines + prorated rental by calendar month (see booking-old-vs-new-comparison.md). */
  const bookingSummary = useMemo(() => {
    if (!beginDate || !endDate) return null
    const begin = parseYmd(beginDate)
    const end = parseYmd(endDate)
    if (!begin || !end || end < begin) return null

    const monthlyParkingTotal = parkingLotUnits > 0 ? round2(parkingFeeNum * parkingLotUnits) : 0
    const proratedSegments = getProratedMonthlySegments(
      beginDate,
      endDate,
      monthlyNum,
      monthlyParkingTotal
    )
    const rentalSubtotal = round2(
      proratedSegments.reduce((s, seg) => s + seg.rentalAmount + seg.parkingAmount, 0)
    )

    const oneTimeRows: Array<{ key: string; label: string; sub?: string; amount: number }> = []
    if (depositNum > 0) oneTimeRows.push({ key: "deposit", label: "Deposit", amount: depositNum })
    if (agreementNum > 0) oneTimeRows.push({ key: "agreement", label: "Agreement fees", amount: agreementNum })
    for (const a of addOnParsed) {
      oneTimeRows.push({ key: `addon-${a.name}`, label: `Add-on: ${a.name}`, amount: a.amount })
    }
    if (commissionNum > 0) {
      oneTimeRows.push({
        key: "commission",
        label: "Commission",
        sub: `Charge on ${commissionChargeOn === "owner" ? "Owner" : "Tenant"}`,
        amount: commissionNum,
      })
    }

    const oneTimeSubtotal = round2(oneTimeRows.reduce((s, r) => s + r.amount, 0))
    const totalMoveIn = round2(oneTimeSubtotal + rentalSubtotal)

    const rentalRows = proratedSegments.map((seg, i) => {
      const totalSeg = round2(seg.rentalAmount + seg.parkingAmount)
      const parts: string[] = []
      if (seg.rentalAmount > 0) parts.push(`Rent ${currencySymbol} ${seg.rentalAmount.toFixed(2)}`)
      if (seg.parkingAmount > 0) parts.push(`Parking ${currencySymbol} ${seg.parkingAmount.toFixed(2)}`)
      return {
        key: `seg-${i}`,
        label: `${formatPeriodLabel(seg.periodStart)} → ${formatPeriodLabel(seg.periodEnd)}`,
        sub:
          parts.length > 0
            ? `${parts.join(" + ")} · same month fraction for rent and parking`
            : undefined,
        amount: totalSeg,
        rentalAmount: seg.rentalAmount,
        parkingAmount: seg.parkingAmount,
      }
    })

    return {
      oneTimeRows,
      oneTimeSubtotal,
      rentalRows,
      rentalSubtotal,
      monthlyRental: monthlyNum,
      monthlyParkingTotal,
      totalMoveIn,
    }
  }, [
    beginDate,
    endDate,
    monthlyNum,
    depositNum,
    agreementNum,
    parkingFeeNum,
    parkingLotUnits,
    addOnParsed,
    commissionNum,
    commissionChargeOn,
    currencySymbol,
  ])

  const toggleParking = (id: string) => {
    setSelectedParking((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const tenantKindDisplayLine = useMemo(() => getTenantKindDisplayLine(tenantLookup), [tenantLookup])

  const onSubmit = async () => {
    setFormError(null)
    if (!roomId) {
      setFormError("Select a room.")
      return
    }
    if (!beginDate || !endDate) {
      setFormError("Start and end dates are required.")
      return
    }
    const emailNorm = tenantEmail.trim().toLowerCase()
    if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      setFormError("Enter a valid tenant email.")
      return
    }
    if (tenantLookupLoading || !tenantLookup || tenantLookup.hasValidEmail === false) {
      setFormError("Wait until the tenant profile finishes loading for this email.")
      return
    }
    const commissionDateRule = parseDateRuleFromAdmin(adminRules, "commissionDate")
    const blueprint = buildBlueprint({
      beginDate,
      endDate,
      monthlyRental: monthlyNum,
      deposit: depositNum,
      agreementFees: agreementNum,
      parkingFees: parkingFeeNum,
      parkingCount: parkingLotUnits,
      addOns: addOnParsed,
      commissionAmount: commissionNum,
      commissionChargeOn,
      commissionMonth: autoCommission?.month ?? 1,
      commissionDateType: commissionDateRule.type,
      commissionDateValue: commissionDateRule.value,
    })
    const commissionSnapshot =
      commissionNum > 0
        ? [{ amount: commissionNum, chargeon: commissionChargeOn, month: autoCommission?.month ?? 1 }]
        : []

    setSubmitting(true)
    try {
      const res = await createBooking({
        tenantIdSelected: null,
        emailInput: emailNorm,
        tenantBookingKind: defaultTenantKind(tenantLookup),
        roomId,
        beginDate,
        endDate,
        rental: monthlyNum,
        deposit: depositNum,
        agreementFees: agreementNum,
        parkingFees: round2(parkingFeeNum * parkingLotUnits),
        selectedParkingLots: selectedParking,
        addOns: addOnParsed,
        billingBlueprint: blueprint,
        commissionSnapshot,
        adminRules: adminRules,
        submitbyStaffId,
      })
      if (!res.ok) {
        setFormError(res.reason || "Booking failed.")
        return
      }
      if (tenancyRedirectTimerRef.current) {
        clearTimeout(tenancyRedirectTimerRef.current)
        tenancyRedirectTimerRef.current = null
      }
      const desc = res.tenancyId
        ? `Tenancy ID: ${res.tenancyId}. You can continue in Tenancy Settings. Redirecting in 5 seconds…`
        : "You can continue in Tenancy Settings. Redirecting in 5 seconds…"
      toast.success("Booking saved", { description: desc, duration: 6000 })
      tenancyRedirectTimerRef.current = setTimeout(() => {
        tenancyRedirectTimerRef.current = null
        router.push("/operator/tenancy")
      }, 5000)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Request failed.")
    } finally {
      setSubmitting(false)
    }
  }

  if (bootLoading) {
    return (
      <main className="p-3 sm:p-6">
        <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
          <Loader2 className="animate-spin" size={20} />
          Loading…
        </div>
      </main>
    )
  }

  return (
    <main className="p-3 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList size={22} />
            New booking
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Create a tenancy from an available room</p>
        </div>
        <div className="flex gap-2">
          <Link href="/operator/tenancy">
            <Button variant="outline" className="gap-2">
              <ArrowLeft size={16} />
              Tenancy Settings
            </Button>
          </Link>
        </div>
      </div>

      {formError && (
        <Card className="mb-4 border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{formError}</CardContent>
        </Card>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Room</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Room</Label>
              <Popover
                open={roomPopoverOpen}
                onOpenChange={(open) => {
                  setRoomPopoverOpen(open)
                  if (!open) setRoomSearchQuery("")
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    aria-expanded={roomPopoverOpen}
                    className={cn("mt-1 w-full justify-between font-normal", !roomId && "text-muted-foreground")}
                  >
                    <span className="truncate text-left">
                      {roomsLoading && roomPopoverOpen && !roomId
                        ? "Loading…"
                        : selectedRoomButtonLabel ?? "Search or choose a room"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
                  align="start"
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Keyword (building, unit…)"
                      value={roomSearchQuery}
                      onValueChange={setRoomSearchQuery}
                    />
                    <CommandList>
                      <CommandEmpty>{roomsLoading ? "Loading…" : "No room found."}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__clear__"
                          onSelect={() => {
                            setRoomId("")
                            setRoomPopoverOpen(false)
                          }}
                        >
                          —
                        </CommandItem>
                        {rooms.map((r) => {
                          const line = roomOptionDisplayLine(r)
                          return (
                            <CommandItem
                              key={r._id}
                              value={r._id}
                              onSelect={() => {
                                roomLabelCacheRef.current.set(r._id, line)
                                setRoomId(r._id)
                                setRoomPopoverOpen(false)
                              }}
                            >
                              <Check
                                className={cn("h-4 w-4 shrink-0", roomId === r._id ? "opacity-100" : "opacity-0")}
                              />
                              <span className="min-w-0 flex-1 whitespace-normal break-words text-left">{line}</span>
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            {roomId && (
              <p className="text-xs text-muted-foreground">
                Listed price: {roomPrice ? `${currencySymbol} ${roomPrice.toFixed(2)}` : "—"}
                {propertyId ? ` · property ${propertyId.slice(0, 8)}…` : ""}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Tenant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Tenant email</Label>
              <Input
                className="mt-1"
                type="email"
                autoComplete="email"
                value={tenantEmail}
                onChange={(e) => setTenantEmail(e.target.value)}
                placeholder="name@example.com"
              />
              <div className="flex items-center gap-2 mt-1.5">
                {tenantLookupLoading && (
                  <>
                    <Loader2 className="animate-spin text-muted-foreground" size={14} />
                    <span className="text-xs text-muted-foreground">Loading profile & reviews…</span>
                  </>
                )}
              </div>
            </div>

            {tenantLookup?.hasValidEmail && tenantLookup.hasRecord && tenantLookup.hasActiveTenancy && (
              <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                <span>This email already has an <strong>active</strong> tenancy with your company. Confirm before creating another booking.</span>
              </div>
            )}

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="mb-0">Tenant type</Label>
                {!tenantLookupLoading &&
                  tenantLookup?.hasValidEmail &&
                  tenantLookup.hasRecord &&
                  tenantLookup.tenantId ? (
                  <Button variant="outline" size="sm" className="h-7 gap-1 shrink-0 text-xs" asChild>
                    <Link
                      href={`/profile/${tenantLookup.tenantId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View tenant public profile"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Profile
                    </Link>
                  </Button>
                ) : null}
              </div>
              <p className="mt-1.5 text-sm text-foreground leading-relaxed">
                {tenantLookupLoading ? (
                  <span className="text-muted-foreground">Loading…</span>
                ) : tenantKindDisplayLine ? (
                  tenantKindDisplayLine
                ) : (
                  <span className="text-muted-foreground">Enter a valid email to classify this tenant.</span>
                )}
              </p>
            </div>

            <div>
              <Label>Booking belongs to staff (optional)</Label>
              <Select
                value={submitbyStaffId || "__none__"}
                onValueChange={(v) => setSubmitbyStaffId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {bookingStaff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name || s.email || s.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {bookingStaff.length > 0
                  ? "Used as tenancy owner staff for booking/commission tracking."
                  : "No staff found. Add Staff in Contact Settings first."}
              </p>
            </div>

            {tenantLookup?.hasValidEmail && tenantLookup.hasRecord && tenantLookup.latestReview && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs space-y-1">
                <p className="font-medium text-foreground">Latest review scores</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-muted-foreground">
                  <span>Overall: <strong className="text-foreground">{tenantLookup.latestReview.overallScore?.toFixed(2) ?? "—"}</strong></span>
                  <span>Payment: <strong className="text-foreground">{tenantLookup.latestReview.paymentScoreFinal?.toFixed(2) ?? "—"}</strong></span>
                  <span>Unit care: <strong className="text-foreground">{tenantLookup.latestReview.unitCareScore?.toFixed(2) ?? "—"}</strong></span>
                </div>
                {tenantLookup.fullname ? (
                  <p className="text-muted-foreground pt-1">Name on file: {tenantLookup.fullname}</p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Lease & fees</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Start</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={beginDate}
                  onChange={(e) => {
                    setBeginDate(e.target.value)
                    setSelectedLeaseMonths(null)
                  }}
                />
              </div>
              <div>
                <Label>End</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={endDate}
                  onChange={(e) => {
                    const raw = e.target.value
                    if (!raw) {
                      setEndDate("")
                      setSelectedLeaseMonths(null)
                      return
                    }
                    const t = fees.rentalType || "first"
                    if (t === "movein") {
                      setEndDate(raw)
                      setSelectedLeaseMonths(null)
                      return
                    }
                    setEndDate(snapEndDateToRentalRule(raw, fees.rentalType, fees.rentalValue))
                    setSelectedLeaseMonths(null)
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Lease length (uses Rental invoice date from Company Settings)</span>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { label: "3 mo", months: 3 },
                    { label: "6 mo", months: 6 },
                    { label: "1 yr", months: 12 },
                    { label: "2 yr", months: 24 },
                  ] as const
                ).map(({ label, months }) => (
                  <Button
                    key={label}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={`h-8 transition-colors ${
                      selectedLeaseMonths === months
                        ? "bg-amber-200 text-amber-950 hover:bg-amber-300"
                        : "hover:bg-muted-foreground/20"
                    }`}
                    disabled={!beginDate}
                    onClick={() => {
                      setSelectedLeaseMonths(months)
                      setCommissionTouched(false)
                      setEndDate(computeLeaseEndFromStart(beginDate, months, fees.rentalType, fees.rentalValue))
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-foreground font-medium">Rental invoice date: {rentalInvoiceLabel(fees.rentalType, fees.rentalValue)}</span>
                {" — "}
                {leaseEndSnapHint(fees.rentalType, fees.rentalValue)}
                {(fees.rentalType || "first") !== "movein"
                  ? " Pick any day in the end month — it will snap to the billing-aligned last day (or day before invoice) for that month."
                  : " You can set End freely for checkout."}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>{`Monthly rental (${currencyCode})`}</Label>
                <Input className="mt-1" inputMode="decimal" value={rental} onChange={(e) => setRental(e.target.value)} />
              </div>
              <div>
                <Label>{`Deposit (${currencyCode})`}</Label>
                <Input className="mt-1" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              </div>
              <div>
                <Label>{`Agreement fees (${currencyCode})`}</Label>
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={agreementFees}
                  onChange={(e) => setAgreementFees(e.target.value)}
                />
              </div>
              <div>
                <Label>{`Parking fee per lot / month (${currencyCode})`}</Label>
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={parkingFees}
                  onChange={(e) => setParkingFees(e.target.value)}
                />
              </div>
            </div>

            {parkingLots.length > 0 && (
              <div>
                <Label>Parking lots</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Select one or more lots — monthly parking in the summary is fee × lots selected.
                </p>
                <div className="mt-2 space-y-2">
                  {parkingLots.map((p) => (
                    <label key={p._id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedParking.includes(p._id)}
                        onChange={() => toggleParking(p._id)}
                      />
                      <span>{p.parkinglot || p.label || p._id}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Add-ons</Label>
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setAddOns([...addOns, { name: "", amount: "" }])}>
                  <Plus size={14} />
                  Row
                </Button>
              </div>
              <div className="space-y-2">
                {addOns.map((row, i) => (
                  <div key={i} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Input placeholder="Name" value={row.name} onChange={(e) => {
                        const next = [...addOns]
                        next[i] = { ...next[i], name: e.target.value }
                        setAddOns(next)
                      }} />
                    </div>
                    <div className="w-28">
                      <Input
                        placeholder={currencySymbol}
                        inputMode="decimal"
                        value={row.amount}
                        onChange={(e) => {
                          const next = [...addOns]
                          next[i] = { ...next[i], amount: e.target.value }
                          setAddOns(next)
                        }}
                      />
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setAddOns(addOns.filter((_, j) => j !== i))}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>{`Commission (${currencyCode})`}</Label>
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={commissionAmount}
                  onChange={(e) => {
                    setCommissionTouched(true)
                    setCommissionAmount(e.target.value)
                  }}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Charge commission on</Label>
                <Select
                  value={commissionChargeOn}
                  onValueChange={(v) => {
                    setCommissionTouched(true)
                    setCommissionChargeOn(v as "tenant" | "owner")
                  }}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tenant">Tenant</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {autoCommission ? (
              <p className="text-xs text-muted-foreground">
                Auto-filled from Company Setting set fee (commission rule month {autoCommission.month}): {currencySymbol}{" "}
                {autoCommission.amount.toFixed(2)} on {autoCommission.chargeon === "owner" ? "Owner" : "Tenant"}.
                {commissionTouched ? " Manual override enabled." : ""}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Set Start/End and monthly rental to auto-calculate commission from Company Setting set fee rules.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Summary</CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              One-time move-in charges + prorated rent and parking each calendar month (same structure as billing blueprint).
            </p>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!bookingSummary ? (
              <p className="text-muted-foreground">Enter valid start and end dates to see the breakdown.</p>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">One-time (move-in)</p>
                  <div className="space-y-2 border border-border rounded-md divide-y divide-border">
                    {bookingSummary.oneTimeRows.length === 0 ? (
                      <div className="px-3 py-2 text-muted-foreground">No one-time charges (deposit, agreement, add-ons, commission). Parking is monthly, prorated below.</div>
                    ) : (
                      bookingSummary.oneTimeRows.map((row) => (
                        <div key={row.key} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                          <div>
                            <span className="text-foreground">{row.label}</span>
                            {row.sub ? <span className="block text-xs text-muted-foreground">{row.sub}</span> : null}
                          </div>
                          <span className="font-medium tabular-nums sm:text-right">{currencySymbol} {row.amount.toFixed(2)}</span>
                        </div>
                      ))
                    )}
                    <div className="px-3 py-2 flex justify-between bg-muted/50 font-medium">
                      <span>Subtotal (one-time)</span>
                      <span className="tabular-nums">{currencySymbol} {bookingSummary.oneTimeSubtotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Rent + parking (recurring — prorated by month)
                  </p>
                  {bookingSummary.monthlyRental <= 0 && (bookingSummary.monthlyParkingTotal ?? 0) <= 0 ? (
                    <p className="text-muted-foreground text-xs">
                      Set monthly rental and/or select parking (fee per lot/month) to see prorated lines.
                    </p>
                  ) : bookingSummary.rentalRows.length === 0 ? (
                    <p className="text-muted-foreground text-xs">No rental segments for this date range.</p>
                  ) : (
                    <div className="space-y-2 border border-border rounded-md divide-y divide-border">
                      {bookingSummary.rentalRows.map((row) => (
                        <div key={row.key} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                          <div>
                            <span className="text-foreground">{row.label}</span>
                            {row.sub ? <span className="block text-xs text-muted-foreground">{row.sub}</span> : null}
                          </div>
                          <span className="font-medium tabular-nums sm:text-right">{currencySymbol} {row.amount.toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="px-3 py-2 flex justify-between bg-muted/50 font-medium">
                        <span>Subtotal (rent + parking, all segments)</span>
                        <span className="tabular-nums">{currencySymbol} {bookingSummary.rentalSubtotal.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t-2 border-border">
                  <span className="text-base font-semibold text-foreground">TOTAL MOVE IN</span>
                  <span className="text-lg font-bold tabular-nums" style={{ color: "var(--brand)" }}>
                    {currencySymbol} {bookingSummary.totalMoveIn.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Formula:</span> TOTAL MOVE IN = one-time subtotal + for each calendar month: prorated rent + prorated parking (monthly parking = lots × fee/mo). Matches the billing blueprint sent on submit.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Button
          className="w-full sm:w-auto"
          size="lg"
          style={{ background: "var(--brand)" }}
          disabled={submitting}
          onClick={onSubmit}
        >
          {submitting ? (
            <>
              <Loader2 className="animate-spin mr-2" size={18} />
              Submitting…
            </>
          ) : (
            "Create booking"
          )}
        </Button>
      </div>
    </main>
  )
}
