"use client"

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer"
import Link from "next/link"
import { Users, Plus, Edit, CheckCircle, AlertCircle, Trash2, Search, SlidersHorizontal, X, CalendarPlus, ArrowRightLeft, XCircle, MoreHorizontal, Eye, FileText, RefreshCw, Loader2, Star, Camera, ZoomIn, ExternalLink, Calendar, LayoutList, CircleHelp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TenancyCalendarView, type TenancyCalendarScale } from "@/components/operator/tenancy-calendar-view"
import { cn } from "@/lib/utils"
import {
  addDaysMalaysiaYmd,
  getTodayMalaysiaYmd,
  tenancyDbDateToMalaysiaYmd,
  utcInstantToMalaysiaYmd,
} from "@/lib/dateMalaysia"
import {
  getTenancySettingList,
  getTenancySettingFilters,
  getRoomsForChange,
  extendTenancy,
  previewExtendTenancy,
  previewChangeRoomTenancy,
  changeRoomTenancy,
  terminateTenancy,
  cancelBooking,
  getExtendOptions,
  getTenancyAgreementTemplates,
  insertTenancyAgreement,
  updateTenancy,
  getAdmin,
  submitTenantReview,
  getLatestTenantReview,
  uploadFile,
  saveCheckinHandover,
  saveCheckoutHandover,
  getHandoverScheduleLog,
  getTerminateTenancyContext,
} from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import { toast } from "sonner"

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200] as const

/** Highlight when Extend / Change room rent, deposit, or parking differs from values prefilled when the dialog opened. */
function tenancyMoneyFieldDirty(current: string, baseline: string): boolean {
  const c = String(current ?? "").trim()
  const b = String(baseline ?? "").trim()
  if (c === b) return false
  const nc = parseFloat(c.replace(/,/g, ""))
  const nb = parseFloat(b.replace(/,/g, ""))
  if (Number.isFinite(nc) && Number.isFinite(nb)) return Math.abs(nc - nb) > 1e-9
  return true
}

const TENANCY_DIALOG_MODIFIED_INPUT_CLASS =
  "border-amber-500 ring-2 ring-amber-500/35 dark:border-amber-400 dark:ring-amber-400/30"

/** OSS 直链在 <img> 常因 CORS 无法显示；走 portal 代理。blob: 本地预览直接用。 */
function handoverPreviewImgSrc(url: string): string {
  if (!url) return url
  if (url.startsWith("blob:")) return url
  try {
    const u = new URL(url)
    if (u.hostname.toLowerCase().endsWith(".aliyuncs.com")) {
      return `/api/portal/proxy-image?url=${encodeURIComponent(url)}`
    }
  } catch {
    /* ignore */
  }
  return url
}

type TenantBadge = "blacklist" | "five_star_tenant" | "payment_delay"

interface AgreementItem {
  url?: string
  mode?: string
  status?: string
  _id?: string
  _createdDate?: string
  pdf_generating?: boolean
  extend_begin_date?: string | null
  extend_end_date?: string | null
  /** Present when final PDF hash stored (aligns with completed flow). */
  hash_final?: string | null
}

function sortAgreementsNewestFirst(list: AgreementItem[]): AgreementItem[] {
  return [...list].sort((a, b) => {
    const ta =
      a._createdDate && !Number.isNaN(new Date(a._createdDate).getTime())
        ? new Date(a._createdDate).getTime()
        : 0
    const tb =
      b._createdDate && !Number.isNaN(new Date(b._createdDate).getTime())
        ? new Date(b._createdDate).getTime()
        : 0
    return tb - ta
  })
}

interface HandoverPayload {
  handoverCardPhotos: string[]
  unitPhotos: string[]
  tenantSignatureUrl: string
  capturedAt?: string | null
  scheduledAt?: string | null
  remark?: string | null
}

interface Tenancy {
  id: string
  tenantId: string
  roomId: string
  tenant: string
  room: string
  property: string
  checkIn: string
  checkOut: string
  rent: number
  deposit: number
  status: string
  agreements?: AgreementItem[]
  propertyId?: string
  tenantRejected?: boolean
  reviewed?: boolean
  /** Set after at least one extend; used to flag missing renewal agreement. */
  previousEnd?: string | null
  /** Set when room_id changes (change room); only agreements created after this count as current lease. */
  lastRoomChangeAt?: string | null
  handoverCheckinAt?: string | null
  handoverCheckoutAt?: string | null
  hasCheckinHandover?: boolean
  hasCheckoutHandover?: boolean
  handoverCheckin?: HandoverPayload | null
  handoverCheckout?: HandoverPayload | null
  /** From tenantdetail — shown in Tenancy Details dialog */
  tenantEmail?: string | null
  tenantPhone?: string | null
  tenantBankName?: string | null
  tenantBankAccount?: string | null
  tenantAccountHolder?: string | null
  /** True when tenancy has parking lots and recurring parking in billing_json — Extend dialog shows parking field. */
  extendHasParkingFees?: boolean
  /** Same as New booking "Parking fee per lot / month", from tenancy billing blueprint when present. */
  extendParkingFeePerLotSuggested?: number | null
  /** Assigned lots on tenancy (parkinglot_json); total monthly parking sent to API = per lot × this count. */
  extendParkingLotCount?: number
  /** Implied total monthly parking (per lot × lots); legacy / derived. */
  extendParkingMonthlySuggested?: number | null
}

/** UI field = per lot / month. API `newParkingMonthly` = combined monthly parking for all assigned lots. */
function newParkingMonthlyTotalFromPerLotField(
  perLotStr: string,
  parkingLotCount: number | null | undefined
): number | undefined {
  const perLot = parseFloat(perLotStr)
  if (!Number.isFinite(perLot) || perLot < 0) return undefined
  const lc = parkingLotCount != null && parkingLotCount > 0 ? parkingLotCount : 0
  const total = lc > 0 ? perLot * lc : perLot
  return Math.round(total * 100) / 100
}

function prefillParkingPerLotFromTenancy(t: Tenancy): string {
  if (!t.extendHasParkingFees) return ""
  if (t.extendParkingFeePerLotSuggested != null && t.extendParkingFeePerLotSuggested > 0) {
    return String(t.extendParkingFeePerLotSuggested)
  }
  const total = t.extendParkingMonthlySuggested
  const lc = t.extendParkingLotCount ?? 0
  if (total != null && total > 0 && lc > 0) {
    return String(Math.round((total / lc) * 100) / 100)
  }
  if (total != null && total > 0) return String(total)
  return "0"
}

interface HandoverScheduleLogRow {
  id: number
  fieldName: string
  oldValue: string | null
  newValue: string | null
  actorEmail: string | null
  actorType: string
  createdAt: string
}

/** Monthly rent / parking total (all lots) / deposit — from API; shown under line amounts in Rent + parking table. */
interface InvoicePreviewRateSummary {
  rent: { from: number; to: number }
  parkingMonthlyTotal: { from: number; to: number } | null
  deposit: { from: number; to: number }
}

/** `/tenancysetting/change-room-preview` — same row shape as extend preview for the Summary card. */
interface ChangeRoomInvoicePreview {
  oneTimeRows?: Array<{ key: string; label: string; sub?: string; amount: number }>
  recurringRows?: Array<{ key: string; label: string; sub?: string; amount: number; formula?: string }>
  oneTimeSubtotal?: number
  recurringSubtotal?: number
  total?: number
  moveFirstDayYmd?: string
  newEndYmd?: string
  lastNightOnOldRateYmd?: string
  billingInvoiceDateHint?: string
  skippedPaidInvoiceYmds?: string[]
  rateSummary?: InvoicePreviewRateSummary
  changeRoomRentNetting?: { gross: number; paidCredit: number; net: number; monthLabel: string; applied: boolean }
  changeRoomParkingNetting?: { gross: number; paidCredit: number; net: number; monthLabel: string; applied: boolean }
}

function invoicePreviewAmountsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

/**
 * Subline under the invoice amount in the Rent + parking preview table (matches backend row `key` prefixes).
 */
function recurringRowRateMonthlyHint(
  rowKey: string,
  rateSummary: InvoicePreviewRateSummary | null | undefined,
  currencySymbol: string
): string | null {
  if (!rateSummary) return null
  const fmt = (n: number) => `${currencySymbol}${n.toFixed(2)}`
  const { rent, parkingMonthlyTotal } = rateSummary

  if (rowKey.startsWith("park-")) {
    if (!parkingMonthlyTotal) return null
    const { from, to } = parkingMonthlyTotal
    if (invoicePreviewAmountsEqual(from, to)) return `Monthly parking (all lots): ${fmt(from)} (no change)`
    return `Monthly parking (all lots): ${fmt(from)} → ${fmt(to)}`
  }
  if (rowKey.startsWith("rent-")) {
    if (invoicePreviewAmountsEqual(rent.from, rent.to)) return `Monthly rent: ${fmt(rent.from)} (no change)`
    return `Monthly rent: ${fmt(rent.from)} → ${fmt(rent.to)}`
  }
  if (rowKey.startsWith("prior-")) {
    return `Monthly rent (before change): ${fmt(rent.from)}`
  }
  if (rowKey.startsWith("new-")) {
    if (invoicePreviewAmountsEqual(rent.from, rent.to)) return `Monthly rent: ${fmt(rent.from)} (no change)`
    return `Monthly rent: ${fmt(rent.from)} → ${fmt(rent.to)}`
  }
  return null
}

/** Same rule as backend isHandoverCompleted: card + unit photos + signature. */
function handoverPayloadHasProof(h: HandoverPayload | null | undefined): boolean {
  if (!h) return false
  const cards = Array.isArray(h.handoverCardPhotos) ? h.handoverCardPhotos.filter((x) => String(x || "").trim()) : []
  const units = Array.isArray(h.unitPhotos) ? h.unitPhotos.filter((x) => String(x || "").trim()) : []
  const sign = String(h.tenantSignatureUrl || "").trim()
  return cards.length > 0 && units.length > 0 && !!sign
}

/** Check-in handover submitted — lock schedule in Edit. */
function isCheckinHandoverComplete(t: Tenancy | null | undefined): boolean {
  if (!t) return false
  if (t.hasCheckinHandover === true) return true
  return handoverPayloadHasProof(t.handoverCheckin ?? null)
}

/** Check-out handover submitted — lock checkout schedule in Edit. */
function isCheckoutHandoverComplete(t: Tenancy | null | undefined): boolean {
  if (!t) return false
  if (t.hasCheckoutHandover === true) return true
  return handoverPayloadHasProof(t.handoverCheckout ?? null)
}

/**
 * Contract / lease end date: not editable in Edit dialog once the tenancy is in effect (Active).
 * Operators must use **Extend tenancy** to change the check-out date.
 * Backend `computeStatus` may expose active leases as boolean `true`; list mapping uses "Active" — handle both.
 */
function canEditLeaseEndDate(t: Tenancy | null | undefined): boolean {
  if (!t) return false
  const s = t.status as unknown
  if (s === true || s === "true" || s === "Active") return false
  if (s === "Terminated" || s === "Tenancy Complete") return false
  if (s === "Pending" || s === "pending_approval") return true
  if (s === "Rejected") return true
  // Fallback when status is missing or unexpected: lock if check-in has passed (lease in effect)
  const today = getTodayMalaysiaYmd()
  if (t.checkIn && String(t.checkIn).slice(0, 10) <= today) return false
  return true
}

/**
 * Check-out appointment time may be edited only when tenancy ended, after extend (previous end on record),
 * or within 14 days before / 14 days after lease end date.
 */
function canEditCheckoutSchedule(t: Tenancy | null | undefined): boolean {
  if (!t) return false
  if (t.status === "Terminated" || t.status === "Tenancy Complete") return true
  if (t.previousEnd && String(t.previousEnd).trim() !== "") return true
  const co = t.checkOut?.trim()
  if (!co) return false
  const end = new Date(`${co}T12:00:00+08:00`)
  if (Number.isNaN(end.getTime())) return false
  const now = Date.now()
  const msDay = 86400000
  const endMs = end.getTime()
  const inLastTwoWeeksBeforeEnd = now <= endMs && now >= endMs - 14 * msDay
  const inTwoWeeksAfterEnd = now > endMs && now <= endMs + 14 * msDay
  return inLastTwoWeeksBeforeEnd || inTwoWeeksAfterEnd
}

/**
 * Check-out handover is normally after check-in handover.
 * Exception windows (terminate / changed room / expiry ±14 days) can proceed directly.
 */
function canStartCheckoutHandover(t: Tenancy): boolean {
  if (t.status === "Rejected") return false
  if (isCheckoutHandoverComplete(t)) return false
  return isCheckinHandoverComplete(t) || canEditCheckoutSchedule(t)
}

function hasScheduledCheckinHandoverAt(t: Tenancy | null | undefined): boolean {
  if (!t) return false
  const raw = String(t.handoverCheckinAt ?? "").trim()
  if (!raw) return false
  return !Number.isNaN(new Date(raw).getTime())
}

function hasScheduledCheckoutHandoverAt(t: Tenancy | null | undefined): boolean {
  if (!t) return false
  const raw = String(t.handoverCheckoutAt ?? "").trim()
  if (!raw) return false
  return !Number.isNaN(new Date(raw).getTime())
}

/**
 * List row handover icon — show when handover workflow has started or finished:
 * check-in or check-out datetime is set, or either handover is already complete.
 */
function shouldShowHandoverStatusIcon(t: Tenancy): boolean {
  if (t.status === "Rejected") return false
  if (hasScheduledCheckinHandoverAt(t)) return true
  if (isCheckinHandoverComplete(t)) return true
  if (hasScheduledCheckoutHandoverAt(t)) return true
  if (isCheckoutHandoverComplete(t)) return true
  return false
}

function formatTenancyHandoverScheduleLine(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim()
  if (!s) return ""
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
}

/** Submit/edit tenant review only when tenancy is ended: terminated or natural lease end (inactive). */
function canSubmitTenantReview(tenancy: Tenancy): boolean {
  return tenancy.status === "Terminated" || tenancy.status === "Tenancy Complete"
}

function freshTenancyFromList(list: Tenancy[], t: Tenancy): Tenancy {
  return list.find((x) => x.id === t.id) ?? t
}

/** YYYY-MM-DD + N calendar days (Malaysia calendar; noon +08:00 anchor). */
function addDaysYmd(iso: string, days: number): string {
  return addDaysMalaysiaYmd(iso, days)
}

/**
 * Tooltip only: show “Check-out: …” / checkout schedule when (1) lease end is within 14 days
 * (Malaysia YMD, inclusive of checkout day), (2) checkout handover date/time is set, or
 * (3) checkout handover is complete. After lease end date, still show until checkout is complete.
 */
function shouldShowCheckoutHandoverInTooltip(t: Tenancy): boolean {
  if (isCheckoutHandoverComplete(t)) return true
  if (hasScheduledCheckoutHandoverAt(t)) return true
  const co = String(t.checkOut ?? "").trim().slice(0, 10)
  const today = getTodayMalaysiaYmd()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(co) || !today) return false
  const windowStart = addDaysYmd(co, -14)
  if (today >= windowStart && today <= co) return true
  if (today > co) return true
  return false
}

/** Same label logic as Company Settings → Set fees → Rental invoice date. */
function rentalInvoiceDateLabel(type: string | undefined, value?: string | number): string {
  const t = String(type || "first").toLowerCase()
  const v = value != null ? String(value) : ""
  if (t === "first") return "First day of every month"
  if (t === "last") return "Last day of every month"
  if (t === "movein") return "Move in date"
  if (t === "specific") return `Day ${v || "?"} of every month`
  return t
}

/** Calendar check for YYYY-MM-DD (local month length; matches extend billing months). */
function isLastDayOfCalendarMonthYmd(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd).trim())
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const last = new Date(y, mo, 0).getDate()
  return d === last
}

type AgreementBadgeKind = "green" | "yellow" | "red"

/** Normalize API date strings to YYYY-MM-DD for comparison. */
function normalizeAgreementYmd(v: unknown): string | null {
  if (v == null || v === "") return null
  const s = typeof v === "string" ? v : String(v)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return utcInstantToMalaysiaYmd(d)
  return null
}

/** Agreements created on/after change-room time (older rows are for the previous unit). */
function agreementsAfterRoomChange(
  agreements: AgreementItem[] | undefined,
  lastRoomChangeAt: string | null | undefined
): AgreementItem[] {
  const list = agreements ?? []
  const raw = lastRoomChangeAt != null ? String(lastRoomChangeAt).trim() : ""
  if (!raw) return list
  const t0 = new Date(raw).getTime()
  if (Number.isNaN(t0)) return list
  return list.filter((a) => {
    const c = a._createdDate ? new Date(a._createdDate).getTime() : NaN
    if (Number.isNaN(c)) return false
    return c >= t0
  })
}

/**
 * Extension / current lease is "covered" only when a finalized agreement's dates include the current check-out.
 * (No more: "any extend_* filled" or "completed after previous_end" without extend_end >= checkout.)
 */
function hasSatisfactoryExtendAgreement(
  agreements: AgreementItem[] | undefined,
  checkIn?: string,
  checkOut?: string,
  lastRoomChangeAt?: string | null
): boolean {
  const list = agreements ?? []
  const ci = normalizeAgreementYmd(checkIn)
  const co = normalizeAgreementYmd(checkOut)
  const roomChangeYmd = normalizeAgreementYmd(lastRoomChangeAt)
  for (const a of list) {
    if (!agreementIsOnFileFinal(a)) continue
    const eb = normalizeAgreementYmd(a.extend_begin_date)
    const ee = normalizeAgreementYmd(a.extend_end_date)
    /* Full period on file matches whole tenancy (incl. extended checkout when PDF dates were set that way). */
    if (eb && ee && ci && co && eb === ci && ee === co) return true
    /* Change-room addendum from change date; end must reach checkout. */
    if (roomChangeYmd && eb && ee && co && eb === roomChangeYmd && ee >= co) return true
    /**
     * After room change, `list` is already agreements created on/after change time — allow a **replacement** full
     * lease (same check-in, end at or past checkout). Disallow arbitrary eb/ee with only ee >= co (misleading coverage).
     */
    if (roomChangeYmd && eb && ee && ci && co && eb === ci && ee >= co) return true
    /**
     * No room change: any on-file doc whose contract end reaches current checkout counts (extension / drift).
     */
    if (!roomChangeYmd && eb && ee && co && ee >= co) return true
  }
  return false
}

/** True when operator can open a draft or sign (PDF exists or status past pending-only). */
function agreementIsSignableReady(a: AgreementItem): boolean {
  const st = (a.status != null ? String(a.status) : "").toLowerCase()
  if (st === "ready_for_signature" || st === "locked" || st === "completed") return true
  return a.url != null && String(a.url).trim() !== ""
}

/**
 * Tenancy agreement is "on file" for the list badge: operator manual PDF URL upload (status completed)
 * or template flow after final PDF (completed and/or hash_final). List badge color follows extend/coverage (green vs yellow).
 */
function agreementIsOnFileFinal(a: AgreementItem): boolean {
  const st = (a.status != null ? String(a.status) : "").toLowerCase()
  if (st === "completed") return true
  const h = a.hash_final != null ? String(a.hash_final).trim() : ""
  return h !== ""
}

/** Agreement extend_end on file (or draft if onlyFinalized=false). */
function computeAgreementDocEndYmd(
  list: AgreementItem[],
  checkIn: string | undefined,
  checkOut: string | undefined,
  onlyFinalized: boolean
): string | null {
  const src = onlyFinalized ? list.filter(agreementIsOnFileFinal) : list
  const ci = normalizeAgreementYmd(checkIn)
  const co = normalizeAgreementYmd(checkOut)
  let bestE: string | null = null
  for (const a of src) {
    const eb = normalizeAgreementYmd(a.extend_begin_date)
    const ee = normalizeAgreementYmd(a.extend_end_date)
    if (!eb || !ee) continue
    if (ci && co && eb === ci && ee === co) return ee
    if (!bestE || ee > bestE) bestE = ee
  }
  return bestE
}

/**
 * Tooltip body: completed segment vs extended checkout (pending until agreement matches lease).
 */
function buildAgreementCheckoutHintLines(opts: {
  list: AgreementItem[]
  checkIn?: string
  checkOut?: string
  wasExtended: boolean
  prevEndYmd: string | null
  extendOk: boolean
  hadRoomChange: boolean
  changeYmd: string | null
  onlyFinalizedDoc: boolean
}): string {
  const co = normalizeAgreementYmd(opts.checkOut)
  const docEnd = computeAgreementDocEndYmd(
    opts.list,
    opts.checkIn,
    opts.checkOut,
    opts.onlyFinalizedDoc
  )
  const lines: string[] = []
  if (opts.wasExtended && opts.prevEndYmd) {
    lines.push(`Check-out date: ${opts.prevEndYmd} (complete)`)
    if (co) lines.push(`Extend check-out date: ${co} (${opts.extendOk ? "complete" : "pending"})`)
  } else if (docEnd && co && docEnd !== co) {
    lines.push(`Check-out date: ${docEnd} (complete)`)
    lines.push(`Extend check-out date: ${co} (${opts.extendOk ? "complete" : "pending"})`)
  } else if (co) {
    lines.push(`Check-out date: ${co} (${opts.extendOk ? "complete" : "pending"})`)
  } else if (docEnd) {
    lines.push(`Check-out date: ${docEnd} (complete)`)
  }
  if (opts.hadRoomChange && opts.changeYmd) {
    lines.push(`Room change: ${opts.changeYmd}`)
  }
  return lines.join("\n")
}

/** Best-effort YYYY-MM-DD for prior-room copy: last on-file doc before room change (extend end, else created). */
function priorRoomChangeAgreementEndYmd(
  agreements: AgreementItem[] | undefined,
  lastRoomChangeAt: string | null | undefined
): string | null {
  const raw = lastRoomChangeAt != null ? String(lastRoomChangeAt).trim() : ""
  if (!raw) return null
  const t0 = new Date(raw).getTime()
  if (Number.isNaN(t0)) return null
  let best: string | null = null
  for (const a of agreements ?? []) {
    const c = a._createdDate ? new Date(a._createdDate).getTime() : NaN
    if (Number.isNaN(c) || c >= t0) continue
    if (!agreementIsOnFileFinal(a)) continue
    const ee = normalizeAgreementYmd(a.extend_end_date)
    const ymd = ee || normalizeAgreementYmd(a._createdDate)
    if (ymd && (!best || ymd > best)) best = ymd
  }
  return best
}

function getAgreementBadge(
  agreements: AgreementItem[] | undefined,
  previousEnd: string | null | undefined,
  checkIn?: string,
  checkOut?: string,
  lastRoomChangeAt?: string | null
): { kind: AgreementBadgeKind; label: string; hint: string } {
  const rawList = agreements ?? []
  const list = agreementsAfterRoomChange(rawList, lastRoomChangeAt)
  const hasAny = list.length > 0
  const extendOk = hasSatisfactoryExtendAgreement(list, checkIn, checkOut, lastRoomChangeAt)
  const pe = previousEnd != null ? String(previousEnd).trim() : ""
  const wasExtended = pe !== "" && !Number.isNaN(new Date(pe).getTime())
  const hadRoomChange =
    lastRoomChangeAt != null &&
    String(lastRoomChangeAt).trim() !== "" &&
    !Number.isNaN(new Date(lastRoomChangeAt).getTime())
  const changeYmd = normalizeAgreementYmd(lastRoomChangeAt)
  const prevEndYmd = normalizeAgreementYmd(previousEnd)
  const coDisp = normalizeAgreementYmd(checkOut)

  if (!hasAny) {
    if (hadRoomChange) {
      const priorEnd = priorRoomChangeAgreementEndYmd(rawList, lastRoomChangeAt)
      const tChangeMs = new Date(String(lastRoomChangeAt).trim()).getTime()
      const hadAnyPriorRow = (rawList ?? []).some((a) => {
        const c = a._createdDate ? new Date(a._createdDate).getTime() : NaN
        return !Number.isNaN(c) && !Number.isNaN(tChangeMs) && c < tChangeMs
      })
      const line1 = priorEnd
        ? `Old unit: agreement to ${priorEnd}.`
        : hadAnyPriorRow
          ? "Old unit: agreement rows exist but no clear end date."
          : "Old unit: no final agreement on file."
      const line2 = changeYmd ? `Room change ${changeYmd}: add agreement for this lease.` : "After room change: add agreement."
      return {
        kind: "red",
        label: "No agreement",
        hint: `${line1}\n${line2}`,
      }
    }
    return {
      kind: "red",
      label: "No agreement",
      hint: "No agreement yet.",
    }
  }
  if (wasExtended && !extendOk) {
    return {
      kind: "yellow",
      label: "Extend pending",
      hint: buildAgreementCheckoutHintLines({
        list,
        checkIn,
        checkOut,
        wasExtended,
        prevEndYmd,
        extendOk: false,
        hadRoomChange,
        changeYmd,
        onlyFinalizedDoc: true,
      }),
    }
  }
  if (!list.some(agreementIsSignableReady)) {
    return {
      kind: "yellow",
      label: "Draft pending",
      hint: "Draft not ready.",
    }
  }
  if (list.some(agreementIsOnFileFinal)) {
    const hint = buildAgreementCheckoutHintLines({
      list,
      checkIn,
      checkOut,
      wasExtended,
      prevEndYmd,
      extendOk,
      hadRoomChange,
      changeYmd,
      onlyFinalizedDoc: true,
    })
    if (!extendOk) {
      return {
        kind: "yellow",
        label: "Agreement on file",
        hint: hint || (coDisp ? `Check-out date: ${coDisp} (pending)` : "—"),
      }
    }
    return {
      kind: "green",
      label: "Agreement on file",
      hint: hint || (coDisp ? `Check-out date: ${coDisp} (complete)` : "—"),
    }
  }
  const signHint = buildAgreementCheckoutHintLines({
    list,
    checkIn,
    checkOut,
    wasExtended,
    prevEndYmd,
    extendOk,
    hadRoomChange,
    changeYmd,
    onlyFinalizedDoc: false,
  })
  return {
    kind: "yellow",
    label: "Signing in progress",
    hint: signHint || (coDisp ? `Check-out date: ${coDisp} (${extendOk ? "complete" : "pending"})` : "Signing / final PDF not done yet."),
  }
}

/** Matches server: operatordetail.admin.agreementCreationCredits, default 10. */
function resolveAgreementTemplateCreditDisplay(admin: Record<string, unknown> | null): number {
  const raw = admin?.agreementCreationCredits
  if (raw === undefined || raw === null) return 10
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 10
  return Math.round(n)
}

function AgreementStatusBadge({
  agreements,
  previousEnd,
  checkIn,
  checkOut,
  lastRoomChangeAt,
}: {
  agreements?: AgreementItem[]
  previousEnd?: string | null
  checkIn?: string
  checkOut?: string
  lastRoomChangeAt?: string | null
}) {
  const { kind, label, hint } = getAgreementBadge(agreements, previousEnd, checkIn, checkOut, lastRoomChangeAt)
  const ariaLabel = `Agreement: ${label}. ${hint.replace(/\n/g, " ")}`
  const cls =
    kind === "green"
      ? "bg-green-100 text-green-900 border-green-400/60 dark:bg-green-950/45 dark:text-green-200 dark:border-green-600"
      : kind === "yellow"
        ? "bg-yellow-100 text-yellow-900 border-yellow-400/70 dark:bg-yellow-950/35 dark:text-yellow-100 dark:border-yellow-600"
        : "bg-red-100 text-red-900 border-red-400/60 dark:bg-red-950/40 dark:text-red-200 dark:border-red-600"
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded-full border ${cls} shrink-0 cursor-default`}
          aria-label={ariaLabel}
        >
          <FileText size={12} className="shrink-0 opacity-90" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[min(320px,calc(100vw-2rem))] text-left font-normal px-3 py-2">
        <div className="font-semibold text-xs mb-1.5">Agreement: {label}</div>
        <p className="whitespace-pre-line text-[11px] leading-relaxed opacity-95">{hint}</p>
      </TooltipContent>
    </TooltipPrimitive.Root>
  )
}

/** Same black tooltip chrome as agreement badge (`TooltipContent`: bg-foreground / text-background). */
function RowIconTooltip({
  heading,
  body,
  className,
  children,
}: {
  heading: string
  body: string
  className: string
  children: ReactNode
}) {
  const ariaLabel = `${heading}. ${body.replace(/\n/g, " ")}`
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded-full border shrink-0 cursor-default ${className}`}
          aria-label={ariaLabel}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[min(320px,calc(100vw-2rem))] text-left font-normal px-3 py-2">
        <div className="font-semibold text-xs mb-1.5">{heading}</div>
        <p className="whitespace-pre-line text-[11px] leading-relaxed opacity-95">{body}</p>
      </TooltipContent>
    </TooltipPrimitive.Root>
  )
}

function TenancyStatusIcon({ status }: { status: string }) {
  const heading = "Status"
  if (status === "Terminated") {
    return (
      <RowIconTooltip heading={heading} body={status} className="bg-red-100 text-red-700 border-red-300">
        <X size={12} aria-hidden />
      </RowIconTooltip>
    )
  }
  if (status === "Rejected") {
    return (
      <RowIconTooltip heading={heading} body={status} className="bg-orange-100 text-orange-800 border-orange-300">
        <XCircle size={12} aria-hidden />
      </RowIconTooltip>
    )
  }
  if (status === "Pending") {
    return (
      <RowIconTooltip heading={heading} body={status} className="bg-yellow-100 text-yellow-700 border-yellow-300">
        <AlertCircle size={12} aria-hidden />
      </RowIconTooltip>
    )
  }
  if (status === "Tenancy Complete") {
    return (
      <RowIconTooltip heading={heading} body={status} className="bg-green-100 text-green-800 border-green-300">
        <CheckCircle size={12} aria-hidden />
      </RowIconTooltip>
    )
  }
  /* Active (and other in-progress states): blue */
  return (
    <RowIconTooltip heading={heading} body={status} className="bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-600">
      <CheckCircle size={12} aria-hidden />
    </RowIconTooltip>
  )
}

function ReviewedStatusIcon() {
  return (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded-full border bg-amber-100 text-amber-800 border-amber-300 shrink-0"
      title="Reviewed"
      aria-label="Reviewed"
    >
      <Star size={12} className="fill-amber-400 text-amber-400" />
    </span>
  )
}

function HandoverStatusIcon({
  tenancy,
}: {
  tenancy: Tenancy
}) {
  const checkinDone = isCheckinHandoverComplete(tenancy)
  const checkoutDone = isCheckoutHandoverComplete(tenancy)
  const lines: string[] = [
    `Check-in: ${checkinDone ? "complete" : "pending"}`,
  ]
  if (hasScheduledCheckinHandoverAt(tenancy)) {
    const sched = formatTenancyHandoverScheduleLine(tenancy.handoverCheckinAt)
    if (sched) lines.push(`Check-in date/time: ${sched}`)
  }
  if (shouldShowCheckoutHandoverInTooltip(tenancy)) {
    lines.push(`Check-out: ${checkoutDone ? "complete" : "pending"}`)
    if (hasScheduledCheckoutHandoverAt(tenancy)) {
      const sched = formatTenancyHandoverScheduleLine(tenancy.handoverCheckoutAt)
      if (sched) lines.push(`Check-out date/time: ${sched}`)
    }
  }
  const body = lines.join("\n")
  const checkoutRelevant = shouldShowCheckoutHandoverInTooltip(tenancy)
  const handoverFullyComplete = checkinDone && (!checkoutRelevant || checkoutDone)
  const cls = handoverFullyComplete
    ? "bg-green-100 text-green-800 border-green-300"
    : "bg-yellow-100 text-yellow-900 border-yellow-300"
  return (
    <RowIconTooltip heading="Handover" body={body} className={cls}>
      <Camera size={12} aria-hidden />
    </RowIconTooltip>
  )
}

/** First pending agreement row without a PDF URL (for operator Redo draft). */
function getFirstPendingDraftAgreement(agreements: AgreementItem[] | undefined): AgreementItem | null {
  if (!agreements?.length) return null
  for (const a of agreements) {
    const st = (a.status != null ? String(a.status) : "").toLowerCase()
    const url = a.url != null ? String(a.url).trim() : ""
    if (st === "pending" && url === "" && a._id) return a
  }
  return null
}

const STATUS_STYLES: Record<string, string> = {
  Active: "bg-sky-100 text-sky-800",
  Pending: "bg-yellow-100 text-yellow-700",
  Rejected: "bg-orange-100 text-orange-800",
  Terminated: "bg-red-100 text-red-700",
  "Tenancy Complete": "bg-green-100 text-green-700",
}

export default function TenancySettingPage() {
  const { accessCtx, refresh: refreshOperatorCtx, creditBalance } = useOperatorContext()
  const currencyCode = String(accessCtx?.client?.currency || "").trim().toUpperCase()
  const currencySymbol = currencyCode === "SGD" ? "S$" : currencyCode === "MYR" ? "RM" : currencyCode
  const toDateTimeLocalValue = (val: unknown): string => {
    const raw = String(val ?? "").trim()
    if (!raw) return ""
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.replace(" ", "T").slice(0, 16)
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return ""
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const normalizeUrlArray = (v: unknown): string[] => {
    if (!Array.isArray(v)) return []
    return v.map((x) => String(x || "").trim()).filter(Boolean)
  }

  const normalizeHandoverPayload = (v: unknown): HandoverPayload | null => {
    if (!v) return null
    let raw: unknown = v
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw)
      } catch {
        return null
      }
    }
    if (!raw || typeof raw !== "object") return null
    const o = raw as Record<string, unknown>
    return {
      handoverCardPhotos: normalizeUrlArray(o.handoverCardPhotos),
      unitPhotos: normalizeUrlArray(o.unitPhotos),
      tenantSignatureUrl: String(o.tenantSignatureUrl || "").trim(),
      capturedAt: o.capturedAt ? String(o.capturedAt) : null,
      scheduledAt: o.scheduledAt ? String(o.scheduledAt) : null,
      remark: o.remark ? String(o.remark) : null,
    }
  }

  const [search, setSearch] = useState("")
  const [property, setProperty] = useState("ALL")
  const [status, setStatus] = useState("ALL")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [showFilters, setShowFilters] = useState(false)
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10)
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list")
  const [calendarScale, setCalendarScale] = useState<TenancyCalendarScale>("day")
  const [calYear, setCalYear] = useState(() => new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth())
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [properties, setProperties] = useState<Array<{ value: string; label: string }>>([{ value: "ALL", label: "All" }])
  const [statusOptions, setStatusOptions] = useState<Array<{ value: string; label: string }>>([])
  const [availableRooms, setAvailableRooms] = useState<Array<{ id: string; title_fld?: string; shortname?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [admin, setAdmin] = useState<Record<string, unknown> | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [listRes, filtersRes, adminRes] = await Promise.all([
        getTenancySettingList({
          propertyId: property !== "ALL" ? property : undefined,
          status: status !== "ALL" ? status : undefined,
          search: search || undefined,
          limit: 2000,
        }),
        getTenancySettingFilters(),
        getAdmin().catch(() => ({ admin: null })),
      ])
      const items = (listRes?.items || []) as Array<Record<string, unknown>>
      const adminObj = (adminRes as { admin?: unknown })?.admin
      setAdmin(adminObj != null && typeof adminObj === "object" ? (adminObj as Record<string, unknown>) : null)
      setTenancies(items.map((t) => {
        const st = t.status
        const rejected = t.tenantRejected === true || st === "tenant_rejected"
        let statusLabel = "Active"
        if (rejected) statusLabel = "Rejected"
        else if (st === "pending_approval") statusLabel = "Pending"
        else if (st === "terminated") statusLabel = "Terminated"
        else if (st === "completed" || st === false) statusLabel = "Tenancy Complete"
        const roomObj = t.room as { id?: string; title_fld?: string } | null
        const propObj = t.property as { id?: string; shortname?: string } | null
        const agreements = (t.agreements as AgreementItem[] | undefined) || []
        const handoverCheckin =
          normalizeHandoverPayload(t.handoverCheckin) ??
          normalizeHandoverPayload(t.handover_checkin_json) ??
          normalizeHandoverPayload(t.handover_checkin) ??
          null
        const handoverCheckout =
          normalizeHandoverPayload(t.handoverCheckout) ??
          normalizeHandoverPayload(t.handover_checkout_json) ??
          normalizeHandoverPayload(t.handover_checkout) ??
          null
        const prevEndRaw = t.previous_end as string | null | undefined
        let previousEnd: string | null = null
        if (prevEndRaw != null && String(prevEndRaw).trim() !== "") {
          previousEnd = tenancyDbDateToMalaysiaYmd(prevEndRaw as string) || String(prevEndRaw).slice(0, 10)
        }
        const tenantObj = t.tenant as {
          id?: string
          fullname?: string
          phone?: string | null
          email?: string | null
          bankName?: string | null
          bankAccount?: string | null
          accountHolder?: string | null
        } | null | undefined
        return {
          id: String(t.id ?? t._id ?? ""),
          tenantId: String((t.tenant as { id?: string })?.id ?? ""),
          roomId: roomObj?.id ?? "",
          tenant: tenantObj?.fullname ?? "—",
          tenantEmail: tenantObj?.email != null && String(tenantObj.email).trim() !== "" ? String(tenantObj.email) : null,
          tenantPhone: tenantObj?.phone != null && String(tenantObj.phone).trim() !== "" ? String(tenantObj.phone) : null,
          tenantBankName: tenantObj?.bankName != null && String(tenantObj.bankName).trim() !== "" ? String(tenantObj.bankName) : null,
          tenantBankAccount: tenantObj?.bankAccount != null && String(tenantObj.bankAccount).trim() !== "" ? String(tenantObj.bankAccount) : null,
          tenantAccountHolder: tenantObj?.accountHolder != null && String(tenantObj.accountHolder).trim() !== "" ? String(tenantObj.accountHolder) : null,
          room: roomObj?.title_fld ?? "—",
          property: propObj?.shortname ?? "—",
          propertyId: propObj?.id ?? undefined,
          checkIn: tenancyDbDateToMalaysiaYmd(t.begin),
          checkOut: tenancyDbDateToMalaysiaYmd(t.end),
          rent: Number(t.rental ?? 0),
          deposit: Number(t.deposit ?? 0),
          status: statusLabel,
          tenantRejected: rejected,
          reviewed: Boolean(t.reviewed),
          agreements,
          previousEnd,
          lastRoomChangeAt:
            t.last_room_change_at != null && String(t.last_room_change_at).trim() !== ""
              ? String(t.last_room_change_at)
              : null,
          handoverCheckinAt:
            (t.handoverCheckinAt as string | null) ??
            (handoverCheckin?.scheduledAt ? String(handoverCheckin.scheduledAt) : null) ??
            null,
          handoverCheckoutAt:
            (t.handoverCheckoutAt as string | null) ??
            (handoverCheckout?.scheduledAt ? String(handoverCheckout.scheduledAt) : null) ??
            null,
          hasCheckinHandover: Boolean(t.hasCheckinHandover),
          hasCheckoutHandover: Boolean(t.hasCheckoutHandover),
          handoverCheckin,
          handoverCheckout,
          extendHasParkingFees: Boolean(t.extendHasParkingFees),
          extendParkingFeePerLotSuggested:
            t.extendParkingFeePerLotSuggested != null && t.extendParkingFeePerLotSuggested !== ""
              ? Number(t.extendParkingFeePerLotSuggested)
              : null,
          extendParkingLotCount:
            t.extendParkingLotCount != null && t.extendParkingLotCount !== ""
              ? Number(t.extendParkingLotCount)
              : 0,
          extendParkingMonthlySuggested:
            t.extendParkingMonthlySuggested != null && t.extendParkingMonthlySuggested !== ""
              ? Number(t.extendParkingMonthlySuggested)
              : null,
        } as Tenancy
      }))
      const f = filtersRes as { properties?: Array<{ value: string; label: string }>; statusOptions?: Array<{ value: string; label: string }> }
      setProperties(f?.properties || [{ value: "ALL", label: "All" }])
      setStatusOptions(f?.statusOptions || [{ value: "ALL", label: "All" }, { value: "true", label: "Active" }, { value: "false", label: "Inactive" }])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [search, property, status])

  useEffect(() => { loadData() }, [loadData])

  const loadRoomsForChange = useCallback(async (currentRoomId?: string) => {
    console.log("[tenancy] loadRoomsForChange currentRoomId=", currentRoomId)
    try {
      const r = await getRoomsForChange(currentRoomId)
      // Backend returns array directly, not { items: [] }
      const list = Array.isArray(r) ? r : (r?.items || [])
      console.log("[tenancy] loadRoomsForChange response length=", list.length, "raw keys=", Array.isArray(r) ? "array" : (r ? Object.keys(r) : "null"))
      setAvailableRooms(list as Array<{ id: string; title_fld?: string; shortname?: string }>)
    } catch (e) {
      console.error("[tenancy] loadRoomsForChange error", e)
    }
  }, [])

  // Dialog states
  const [selectedTenancy, setSelectedTenancy] = useState<Tenancy | null>(null)
  const [showExtendDialog, setShowExtendDialog] = useState(false)
  const [showChangeRoomDialog, setShowChangeRoomDialog] = useState(false)
  const [showTerminateDialog, setShowTerminateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const [showHandoverDialog, setShowHandoverDialog] = useState(false)
  const [showHandoverFlowDialog, setShowHandoverFlowDialog] = useState(false)
  const [handoverFlowKind, setHandoverFlowKind] = useState<"checkin" | "checkout">("checkin")
  /** Click thumbnail → full-screen preview (portal + DismissableLayerBranch so Radix body pointer-events don’t block it). */
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [handoverScheduleLog, setHandoverScheduleLog] = useState<HandoverScheduleLogRow[]>([])
  const [handoverScheduleLogLoading, setHandoverScheduleLogLoading] = useState(false)
  const [showReviewDialog, setShowReviewDialog] = useState(false)
  /** All tenancy agreements in one modal (from row action “View Agreement”). */
  const [agreementsListTenancy, setAgreementsListTenancy] = useState<Tenancy | null>(null)
  const [showCreateAgreementBox, setShowCreateAgreementBox] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [extendMaxEnd, setExtendMaxEnd] = useState<string | null>(null)
  /** Rental invoice rule from extend-options API (same as Company Settings → admin.rental). */
  const [extendPaymentCycle, setExtendPaymentCycle] = useState<{ type: string; value: number } | null>(null)
  const [showExtendEndDateWarning, setShowExtendEndDateWarning] = useState(false)
  const [showChangeRoomCheckoutWarning, setShowChangeRoomCheckoutWarning] = useState(false)
  const [changeRoomPreviewLoading, setChangeRoomPreviewLoading] = useState(false)
  const [changeRoomPreviewError, setChangeRoomPreviewError] = useState<string | null>(null)
  const [changeRoomPreview, setChangeRoomPreview] = useState<ChangeRoomInvoicePreview | null>(null)
  const [createAgreementStep, setCreateAgreementStep] = useState<"choice" | "manual" | "template">("choice")
  const [agreementMode, setAgreementMode] = useState("")
  const [agreementTemplates, setAgreementTemplates] = useState<Array<{ id: string; title?: string }>>([])
  const [agreementTemplateId, setAgreementTemplateId] = useState("")
  const [agreementUrl, setAgreementUrl] = useState("")
  const [agreementExtendBegin, setAgreementExtendBegin] = useState("")
  const [agreementExtendEnd, setAgreementExtendEnd] = useState("")
  const [agreementConfirmCredit, setAgreementConfirmCredit] = useState(false)
  const [agreementSubmitting, setAgreementSubmitting] = useState(false)

  // Form states
  const [extendDate, setExtendDate] = useState("")
  const [extendRent, setExtendRent] = useState("")
  const [extendDeposit, setExtendDeposit] = useState("")
  const [extendAgreementFee, setExtendAgreementFee] = useState("")
  /** Parking fee per lot / month (New booking field); API receives total = this × assigned lots. */
  const [extendParking, setExtendParking] = useState("")
  const [extendSubmitting, setExtendSubmitting] = useState(false)
  const extendSubmitLockRef = useRef(false)
  const extendFieldBaselineRef = useRef({ rent: "", deposit: "", parking: "" })
  const [extendPreviewLoading, setExtendPreviewLoading] = useState(false)
  const [extendPreviewError, setExtendPreviewError] = useState<string | null>(null)
  const [extendPreview, setExtendPreview] = useState<{
    oneTimeRows?: Array<{ key: string; label: string; sub?: string; amount: number }>
    recurringRows?: Array<{ key: string; label: string; sub?: string; amount: number; formula?: string }>
    oneTimeSubtotal?: number
    recurringSubtotal?: number
    total?: number
    previousEndYmd?: string | null
    newEndYmd?: string
    rateSummary?: InvoicePreviewRateSummary
  } | null>(null)

  const [changeRoomId, setChangeRoomId] = useState("")
  /** First calendar day the tenant occupies the new room (Malaysia YYYY-MM-DD). */
  const [changeDate, setChangeDate] = useState("")
  /** Lease check-out / end date after this change; defaults to current checkout when opening the dialog. */
  const [changeCheckOut, setChangeCheckOut] = useState("")
  const [changeRent, setChangeRent] = useState("")
  const [changeDeposit, setChangeDeposit] = useState("")
  const [changeAgreementFee, setChangeAgreementFee] = useState("")
  /** Per lot / month like Extend; prefilled when lease has parking. */
  const [changeParking, setChangeParking] = useState("")
  const [changeHandoverInAt, setChangeHandoverInAt] = useState("")
  const [changeHandoverOutAt, setChangeHandoverOutAt] = useState("")
  const [changeOutCardUrls, setChangeOutCardUrls] = useState<string[]>([])
  const [changeOutUnitUrls, setChangeOutUnitUrls] = useState<string[]>([])
  const [changeOutSignUrl, setChangeOutSignUrl] = useState("")
  const [changeInCardUrls, setChangeInCardUrls] = useState<string[]>([])
  const [changeInUnitUrls, setChangeInUnitUrls] = useState<string[]>([])
  const [changeInSignUrl, setChangeInSignUrl] = useState("")
  const [changeSubmitting, setChangeSubmitting] = useState(false)
  const changeSubmitLockRef = useRef(false)
  const changeFieldBaselineRef = useRef({ rent: "", deposit: "", parking: "" })

  const [terminateForfeit, setTerminateForfeit] = useState("")
  const [terminateReason, setTerminateReason] = useState("")
  const [terminateDepositHeld, setTerminateDepositHeld] = useState<number | null>(null)
  const [terminatePaidDeposit, setTerminatePaidDeposit] = useState<number | null>(null)
  const [terminateRefundableDeposit, setTerminateRefundableDeposit] = useState<number | null>(null)
  const [terminateSkipRefund, setTerminateSkipRefund] = useState(false)
  const [terminateContextLoading, setTerminateContextLoading] = useState(false)
  const [terminateSubmitting, setTerminateSubmitting] = useState(false)
  const [uploadingHandover, setUploadingHandover] = useState(false)

  const [checkinCardUrls, setCheckinCardUrls] = useState<string[]>([])
  const [checkinUnitUrls, setCheckinUnitUrls] = useState<string[]>([])
  const [hasCheckinSignatureInk, setHasCheckinSignatureInk] = useState(false)
  const [uploadingCheckinHandover, setUploadingCheckinHandover] = useState(false)
  const [savingCheckinHandover, setSavingCheckinHandover] = useState(false)
  const checkinSignatureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const checkinSigDrawingRef = useRef(false)
  const checkinSigLastRef = useRef({ x: 0, y: 0 })
  const checkinSigDimsRef = useRef({ w: 400, h: 160, dpr: 1 })

  const [editRent, setEditRent] = useState("")
  const [editDeposit, setEditDeposit] = useState("")
  const [editCheckOut, setEditCheckOut] = useState("")
  const [editHandoverCheckinAt, setEditHandoverCheckinAt] = useState("")
  const [editHandoverCheckoutAt, setEditHandoverCheckoutAt] = useState("")
  const [paymentScoreSuggested, setPaymentScoreSuggested] = useState("8")
  const [unitCareScore, setUnitCareScore] = useState("8")
  const [communicationScore, setCommunicationScore] = useState("8")
  const [latePaymentsCount, setLatePaymentsCount] = useState("0")
  const [outstandingCount, setOutstandingCount] = useState("0")
  const [reviewComment, setReviewComment] = useState("")
  const [reviewEvidenceUrls, setReviewEvidenceUrls] = useState<string[]>([])
  const [uploadingEvidence, setUploadingEvidence] = useState(false)
  const [submittingReview, setSubmittingReview] = useState(false)
  const evidenceInputRef = useRef<HTMLInputElement | null>(null)
  const [reviewBadges, setReviewBadges] = useState<Record<TenantBadge, boolean>>({
    blacklist: false,
    five_star_tenant: false,
    payment_delay: false,
  })
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null)

  const editLeaseEndEditable = selectedTenancy ? canEditLeaseEndDate(selectedTenancy) : false
  const terminateDepositValue = terminateDepositHeld ?? Number(selectedTenancy?.deposit || 0)
  const terminatePaidDepositValue = terminatePaidDeposit ?? terminateDepositValue
  const terminateRefundBase = terminateRefundableDeposit ?? terminateDepositValue
  const terminateRefundAmount = Math.max(0, terminateRefundBase - Number(terminateForfeit || 0))

  const uploadHandoverFiles = async (files: FileList | null, append: (urls: string[]) => void) => {
    if (!files || files.length === 0) return
    setUploadingHandover(true)
    try {
      const urls: string[] = []
      for (const file of Array.from(files)) {
        const res = await uploadFile(file)
        if (res?.ok && res.url) urls.push(res.url)
      }
      if (urls.length) append(urls)
    } finally {
      setUploadingHandover(false)
    }
  }

  /** 先本地 blob 立刻出 preview，再上传替换为 OSS URL（避免只看到文件名、看不到图）。 */
  const uploadCheckinHandoverFiles = async (files: FileList | null, kind: "card" | "unit") => {
    if (!files?.length) return
    setUploadingCheckinHandover(true)
    try {
      const setUrls = kind === "card" ? setCheckinCardUrls : setCheckinUnitUrls
      for (const file of Array.from(files)) {
        const blobUrl = URL.createObjectURL(file)
        setUrls((p) => [...p, blobUrl])
        try {
          const res = await uploadFile(file)
          if (res?.ok && res.url) {
            setUrls((p) => p.map((u) => (u === blobUrl ? res.url! : u)))
            queueMicrotask(() => {
              try {
                URL.revokeObjectURL(blobUrl)
              } catch {
                /* ignore */
              }
            })
          } else {
            setUrls((p) => p.filter((u) => u !== blobUrl))
            queueMicrotask(() => {
              try {
                URL.revokeObjectURL(blobUrl)
              } catch {
                /* ignore */
              }
            })
          }
        } catch {
          setUrls((p) => p.filter((u) => u !== blobUrl))
          queueMicrotask(() => {
            try {
              URL.revokeObjectURL(blobUrl)
            } catch {
              /* ignore */
            }
          })
        }
      }
    } finally {
      setUploadingCheckinHandover(false)
    }
  }

  const initCheckinSignatureCanvas = useCallback(() => {
    const canvas = checkinSignatureCanvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    const w = Math.max(280, Math.floor(parent?.getBoundingClientRect().width || 400))
    const h = 160
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
    checkinSigDimsRef.current = { w, h, dpr }
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = "#111827"
    ctx.lineWidth = 2.5
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    setHasCheckinSignatureInk(false)
  }, [])

  useEffect(() => {
    if (!showHandoverFlowDialog) return
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => initCheckinSignatureCanvas())
    })
    return () => cancelAnimationFrame(id)
  }, [showHandoverFlowDialog, initCheckinSignatureCanvas])

  useEffect(() => {
    if (previewImageUrl == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      setPreviewImageUrl(null)
    }
    window.addEventListener("keydown", onKey, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey, true)
      document.body.style.overflow = prevOverflow
    }
  }, [previewImageUrl])

  useEffect(() => {
    if (!showHandoverDialog || !selectedTenancy?.id) {
      setHandoverScheduleLog([])
      return
    }
    let cancelled = false
    setHandoverScheduleLogLoading(true)
    void getHandoverScheduleLog({ tenancyId: selectedTenancy.id, limit: 80 })
      .then((r) => {
        if (cancelled) return
        const items = (r as { items?: HandoverScheduleLogRow[] })?.items
        setHandoverScheduleLog(Array.isArray(items) ? items : [])
      })
      .catch(() => {
        if (!cancelled) setHandoverScheduleLog([])
      })
      .finally(() => {
        if (!cancelled) setHandoverScheduleLogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showHandoverDialog, selectedTenancy?.id])

  const clearCheckinSignature = () => {
    initCheckinSignatureCanvas()
  }

  const onCheckinSignaturePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const canvas = e.currentTarget
    canvas.setPointerCapture(e.pointerId)
    checkinSigDrawingRef.current = true
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const ctx = canvas.getContext("2d")
    if (ctx) {
      const { dpr } = checkinSigDimsRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = "#111827"
      ctx.beginPath()
      ctx.arc(x, y, 1.25, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = "#111827"
    }
    checkinSigLastRef.current = { x, y }
    setHasCheckinSignatureInk(true)
  }

  const onCheckinSignaturePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!checkinSigDrawingRef.current) return
    e.preventDefault()
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const { dpr } = checkinSigDimsRef.current
    const last = checkinSigLastRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(x, y)
    ctx.stroke()
    checkinSigLastRef.current = { x, y }
  }

  const onCheckinSignaturePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    checkinSigDrawingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const StarRating = ({
    label,
    value,
    onChange,
  }: {
    label: string
    value: number
    onChange: (v: number) => void
  }) => (
    <div>
      <label className="text-xs font-semibold text-muted-foreground block mb-1.5">{label}</label>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: 10 }, (_, i) => {
          const n = i + 1
          const active = n <= value
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className="p-0.5"
              aria-label={`rate ${n}`}
            >
              <Star size={16} className={active ? "fill-amber-400 text-amber-400" : "text-muted-foreground"} />
            </button>
          )
        })}
        <span className="ml-2 text-sm font-semibold">{value}</span>
      </div>
    </div>
  )

  const filtered = tenancies.filter((t) => {
    const matchFrom = !dateFrom || t.checkIn >= dateFrom
    const matchTo = !dateTo || t.checkOut <= dateTo
    return matchFrom && matchTo
  })

  const totalFiltered = filtered.length
  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalFiltered / pageSize)), [totalFiltered, pageSize])
  const pagedRows = useMemo(
    () => filtered.slice((listPage - 1) * pageSize, listPage * pageSize),
    [filtered, listPage, pageSize]
  )

  useEffect(() => {
    setListPage(1)
  }, [search, property, status, dateFrom, dateTo])

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(totalFiltered / pageSize))
    if (listPage > tp) setListPage(tp)
  }, [totalFiltered, pageSize, listPage])

  const calendarTenancies = useMemo(
    () =>
      filtered.map((t) => ({
        id: t.id,
        tenant: t.tenant,
        roomId: t.roomId,
        room: t.room,
        property: t.property,
        propertyId: t.propertyId,
        checkIn: t.checkIn,
        checkOut: t.checkOut,
        status: t.status,
        rental: t.rent,
      })),
    [filtered]
  )

  /** Highlight "today" in calendar grids — Malaysia business day. */
  const todayYmdCalendar = useMemo(() => getTodayMalaysiaYmd(), [])

  const hasActiveFilters = property !== "ALL" || status !== "ALL" || dateFrom || dateTo
  const agreementTemplateCreditCost = resolveAgreementTemplateCreditDisplay(admin)
  /** Template flow deducts agreementCreationCredits (default 10); block when total balance is below cost. */
  const insufficientCreditForTenancyAgreement =
    agreementTemplateCreditCost > 0 && creditBalance < agreementTemplateCreditCost

  const extendRentalInvoiceLabel = useMemo(() => {
    const pc = extendPaymentCycle
    const adminRental = admin?.rental as { type?: string; value?: unknown } | undefined
    const type = pc?.type ?? adminRental?.type ?? "first"
    const tLower = String(type).toLowerCase()
    let value: string | number | undefined
    if (tLower === "specific") {
      const v =
        pc?.type?.toLowerCase() === "specific" && pc.value != null
          ? pc.value
          : adminRental?.value
      value = v != null && String(v).trim() !== "" ? String(v) : "?"
    }
    return rentalInvoiceDateLabel(type, value)
  }, [extendPaymentCycle, admin])

  /** True when chosen new end is still on/before current lease end — submit disabled until user picks a later date. */
  const extendNewEndNotAfterCurrent = useMemo(() => {
    const curCo = selectedTenancy?.checkOut?.trim().slice(0, 10) ?? ""
    return (
      !!curCo &&
      /^\d{4}-\d{2}-\d{2}$/.test(curCo) &&
      /^\d{4}-\d{2}-\d{2}$/.test(extendDate) &&
      extendDate <= curCo
    )
  }, [selectedTenancy?.checkOut, extendDate])

  const clearFilters = () => {
    setProperty("ALL")
    setStatus("ALL")
    setDateFrom("")
    setDateTo("")
  }

  const openExtend = async (tenancy: Tenancy) => {
    extendSubmitLockRef.current = false
    setExtendSubmitting(false)
    setExtendPreview(null)
    setExtendPreviewError(null)
    setExtendPreviewLoading(false)
    setSelectedTenancy(tenancy)
    const co = tenancy.checkOut?.trim() || ""
    const coYmd = co.slice(0, 10)
    /** Default new check-out = current lease end; user picks a later date to bill extension. */
    setExtendDate(/^\d{4}-\d{2}-\d{2}$/.test(coYmd) ? coYmd : "")
    const rentBaseline = String(tenancy.rent)
    let depositBaseline = String(Number(tenancy.deposit ?? 0))
    const parkingBaseline = prefillParkingPerLotFromTenancy(tenancy)
    extendFieldBaselineRef.current = { rent: rentBaseline, deposit: depositBaseline, parking: parkingBaseline }
    setExtendRent(rentBaseline)
    setExtendDeposit(depositBaseline)
    const defaultFee = (admin?.agreementFees != null ? Number(admin.agreementFees) : 0) || 250
    setExtendAgreementFee(String(defaultFee))
    setExtendParking(parkingBaseline)
    setExtendMaxEnd(null)
    setShowExtendEndDateWarning(false)
    const adminRentalOpen = admin?.rental as { type?: string; value?: unknown } | undefined
    setExtendPaymentCycle(
      adminRentalOpen?.type
        ? {
            type: String(adminRentalOpen.type),
            value: adminRentalOpen.value != null ? Number(adminRentalOpen.value) || 1 : 1,
          }
        : { type: "first", value: 1 }
    )
    setShowExtendDialog(true)
    try {
      const opts = await getExtendOptions(tenancy.id)
      const depRaw = opts?.deposit
      if (depRaw !== undefined && depRaw !== null) {
        const n = Number(depRaw)
        if (Number.isFinite(n)) {
          depositBaseline = String(n)
          setExtendDeposit(depositBaseline)
          extendFieldBaselineRef.current = { ...extendFieldBaselineRef.current, deposit: depositBaseline }
        }
      }
      const pc = (opts as { paymentCycle?: { type?: string; value?: unknown } })?.paymentCycle
      if (pc?.type != null) {
        setExtendPaymentCycle({
          type: String(pc.type),
          value: pc.value != null ? Number(pc.value) || 1 : 1,
        })
      }
      const maxEnd = (opts as { maxExtensionEnd?: string | null })?.maxExtensionEnd ?? null
      if (maxEnd) {
        setExtendMaxEnd(maxEnd)
        setExtendDate((prev) => {
          const minD = coYmd && /^\d{4}-\d{2}-\d{2}$/.test(coYmd) ? coYmd : ""
          if (!minD) return ""
          if (minD > maxEnd) return ""
          const base = (prev && /^\d{4}-\d{2}-\d{2}$/.test(prev) ? prev : minD).slice(0, 10)
          let v = base
          if (v < minD) v = minD
          if (v > maxEnd) v = maxEnd
          return v
        })
      }
    } catch (_) {}
  }

  useEffect(() => {
    if (!showExtendDialog || !selectedTenancy?.id) return
    if (!extendDate || !/^\d{4}-\d{2}-\d{2}$/.test(extendDate)) {
      setExtendPreview(null)
      setExtendPreviewError(null)
      return
    }
    const rent = parseFloat(extendRent)
    if (!Number.isFinite(rent) || rent <= 0) {
      setExtendPreview(null)
      setExtendPreviewError(null)
      return
    }
    if (
      selectedTenancy.extendHasParkingFees &&
      (extendParking.trim() === "" || Number.isNaN(parseFloat(extendParking)) || parseFloat(extendParking) < 0)
    ) {
      setExtendPreview(null)
      setExtendPreviewError(null)
      return
    }
    let cancelled = false
    const tid = window.setTimeout(() => {
      void (async () => {
        setExtendPreviewLoading(true)
        setExtendPreviewError(null)
        try {
          const baseDeposit = Number(selectedTenancy.deposit || 0)
          const rawDep = extendDeposit.trim()
          const parsedDep = rawDep === "" ? baseDeposit : parseFloat(extendDeposit)
          const computedNewDeposit = Number.isFinite(parsedDep) ? parsedDep : baseDeposit
          let newParkingMonthly: number | undefined
          if (selectedTenancy.extendHasParkingFees) {
            newParkingMonthly = newParkingMonthlyTotalFromPerLotField(extendParking, selectedTenancy.extendParkingLotCount)
          }
          const res = await previewExtendTenancy({
            tenancyId: selectedTenancy.id,
            newEnd: extendDate,
            newRental: rent,
            newDeposit: computedNewDeposit,
            agreementFees: parseFloat(extendAgreementFee) || 0,
            ...(newParkingMonthly !== undefined ? { newParkingMonthly } : {}),
          })
          if (cancelled) return
          if (res.message && res.ok !== true) {
            setExtendPreview(null)
            setExtendPreviewError(res.message)
          } else {
            setExtendPreview(res)
            setExtendPreviewError(null)
          }
        } catch (e) {
          if (!cancelled) {
            setExtendPreview(null)
            setExtendPreviewError(e instanceof Error ? e.message : "Preview failed.")
          }
        } finally {
          if (!cancelled) setExtendPreviewLoading(false)
        }
      })()
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(tid)
    }
  }, [
    showExtendDialog,
    selectedTenancy?.id,
    selectedTenancy?.deposit,
    selectedTenancy?.extendHasParkingFees,
    extendDate,
    extendRent,
    extendDeposit,
    extendAgreementFee,
    extendParking,
    selectedTenancy?.extendParkingLotCount,
  ])

  const openChangeRoom = async (tenancy: Tenancy) => {
    changeSubmitLockRef.current = false
    setChangeSubmitting(false)
    setSelectedTenancy(tenancy)
    setChangeRoomId("")
    setChangeCheckOut(tenancy.checkOut)
    {
      const today = getTodayMalaysiaYmd()
      const ci = tenancy.checkIn?.trim() || ""
      const co = tenancy.checkOut?.trim() || ""
      let move = today
      if (/^\d{4}-\d{2}-\d{2}$/.test(ci) && move < ci) move = ci
      if (/^\d{4}-\d{2}-\d{2}$/.test(co) && move > co) move = co
      setChangeDate(move)
    }
    const rentBaselineCr = String(tenancy.rent)
    let depositBaselineCr = String(tenancy.deposit ?? "")
    const parkingBaselineCr = prefillParkingPerLotFromTenancy(tenancy)
    changeFieldBaselineRef.current = { rent: rentBaselineCr, deposit: depositBaselineCr, parking: parkingBaselineCr }
    setChangeRent(rentBaselineCr)
    setChangeDeposit(depositBaselineCr)
    setShowChangeRoomCheckoutWarning(false)
    const defaultFee = (admin?.agreementFees != null ? Number(admin.agreementFees) : 0) || 250
    setChangeAgreementFee(String(defaultFee))
    setChangeParking(parkingBaselineCr)
    setChangeRoomPreview(null)
    setChangeRoomPreviewError(null)
    setChangeRoomPreviewLoading(false)
    setChangeHandoverInAt(toDateTimeLocalValue(tenancy.handoverCheckinAt))
    setChangeHandoverOutAt(toDateTimeLocalValue(tenancy.handoverCheckoutAt))
    setChangeOutCardUrls([])
    setChangeOutUnitUrls([])
    setChangeOutSignUrl("")
    setChangeInCardUrls([])
    setChangeInUnitUrls([])
    setChangeInSignUrl("")
    const list = await getRoomsForChange(tenancy.roomId).then((r) => (Array.isArray(r) ? r : (r as { items?: unknown[] })?.items || []))
    setAvailableRooms((list as { id: string; title_fld?: string; shortname?: string }[]).filter((room) => room.id !== tenancy.roomId))
    setShowChangeRoomDialog(true)
    try {
      const opts = await getExtendOptions(tenancy.id)
      const depRaw = opts?.deposit
      if (depRaw !== undefined && depRaw !== null) {
        const n = Number(depRaw)
        if (Number.isFinite(n)) {
          depositBaselineCr = String(n)
          setChangeDeposit(depositBaselineCr)
          changeFieldBaselineRef.current = { ...changeFieldBaselineRef.current, deposit: depositBaselineCr }
        }
      }
    } catch (_) {}
  }

  const openTerminate = async (tenancy: Tenancy) => {
    setSelectedTenancy(tenancy)
    setTerminateForfeit("")
    setTerminateReason("")
    setTerminateDepositHeld(Number(tenancy.deposit || 0))
    setTerminatePaidDeposit(null)
    setTerminateRefundableDeposit(null)
    setTerminateSkipRefund(false)
    setShowTerminateDialog(true)
    setTerminateContextLoading(true)
    try {
      const ctx = await getTerminateTenancyContext({ tenancyId: tenancy.id })
      if (typeof ctx?.deposit === "number" && Number.isFinite(ctx.deposit)) {
        setTerminateDepositHeld(Number(ctx.deposit))
      }
      if (typeof ctx?.paidDeposit === "number" && Number.isFinite(ctx.paidDeposit)) {
        setTerminatePaidDeposit(Number(ctx.paidDeposit))
      }
      if (typeof ctx?.refundableDeposit === "number" && Number.isFinite(ctx.refundableDeposit)) {
        setTerminateRefundableDeposit(Number(ctx.refundableDeposit))
      }
      if (ctx?.skipDepositRefund === true) {
        setTerminateSkipRefund(true)
      }
    } catch {
      // Keep list value as fallback if context API fails.
    } finally {
      setTerminateContextLoading(false)
    }
  }

  const openEdit = (tenancy: Tenancy) => {
    const fresh = freshTenancyFromList(tenancies, tenancy)
    setSelectedTenancy(fresh)
    setEditRent(String(fresh.rent))
    setEditDeposit(String(fresh.deposit))
    setEditCheckOut(fresh.checkOut)
    setEditHandoverCheckinAt(toDateTimeLocalValue(fresh.handoverCheckinAt))
    setEditHandoverCheckoutAt(toDateTimeLocalValue(fresh.handoverCheckoutAt))
    setShowEditDialog(true)
  }

  const openDetail = (tenancy: Tenancy) => {
    setSelectedTenancy(tenancy)
    setShowDetailDialog(true)
  }

  const openDetailFromCalendar = (t: { id: string }) => {
    const full = filtered.find((x) => x.id === t.id)
    if (full) openDetail(full)
  }

  const openHandoverDetail = (tenancy: Tenancy) => {
    setSelectedTenancy(freshTenancyFromList(tenancies, tenancy))
    setShowHandoverDialog(true)
  }

  const openAgreementsList = (tenancy: Tenancy) => {
    setAgreementsListTenancy(freshTenancyFromList(tenancies, tenancy))
  }

  const openCheckinHandover = (tenancy: Tenancy) => {
    if (!hasScheduledCheckinHandoverAt(tenancy)) {
      window.alert("Please set Handover Check-in Date & Time in Edit Tenancy first.")
      return
    }
    setHandoverFlowKind("checkin")
    setSelectedTenancy(freshTenancyFromList(tenancies, tenancy))
    setCheckinCardUrls([])
    setCheckinUnitUrls([])
    setHasCheckinSignatureInk(false)
    setShowHandoverFlowDialog(true)
  }

  const openCheckoutHandover = (tenancy: Tenancy) => {
    if (!hasScheduledCheckoutHandoverAt(tenancy)) {
      window.alert("Please set Handover Check-out Date & Time in Edit Tenancy first.")
      return
    }
    setHandoverFlowKind("checkout")
    setSelectedTenancy(freshTenancyFromList(tenancies, tenancy))
    setCheckinCardUrls([])
    setCheckinUnitUrls([])
    setHasCheckinSignatureInk(false)
    setShowHandoverFlowDialog(true)
  }

  const handleHandoverFlowSubmit = async () => {
    if (!selectedTenancy) return
    if (checkinCardUrls.some((u) => u.startsWith("blob:")) || checkinUnitUrls.some((u) => u.startsWith("blob:"))) {
      window.alert("Please wait until all photos have finished uploading.")
      return
    }
    if (!hasCheckinSignatureInk) {
      window.alert("Please sign in the signature area (finger or mouse).")
      return
    }
    const canvas = checkinSignatureCanvasRef.current
    if (!canvas) return
    try {
      setSavingCheckinHandover(true)
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/png")
      })
      if (!blob) {
        window.alert("Could not export signature image.")
        return
      }
      const sigFile = new File([blob], "tenant-signature.png", { type: "image/png" })
      const sigRes = await uploadFile(sigFile)
      if (!sigRes?.ok || !sigRes.url) {
        window.alert(sigRes?.reason || "Signature upload failed.")
        return
      }
      const payload = {
        handoverCardPhotos: checkinCardUrls,
        unitPhotos: checkinUnitUrls,
        tenantSignatureUrl: sigRes.url,
        capturedAt: new Date().toISOString(),
      }
      let r: unknown
      if (handoverFlowKind === "checkout") {
        r = await saveCheckoutHandover({
          tenancyId: selectedTenancy.id,
          handoverCheckout: payload,
        })
      } else {
        r = await saveCheckinHandover({
          tenancyId: selectedTenancy.id,
          handoverCheckin: payload,
        })
      }
      if ((r as { success?: boolean })?.success === false) {
        window.alert((r as { message?: string }).message || "Failed to save.")
        return
      }
      setShowHandoverFlowDialog(false)
      await loadData()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : handoverFlowKind === "checkout" ? "Failed to save check-out handover." : "Failed to save check-in handover.")
    } finally {
      setSavingCheckinHandover(false)
    }
  }

  const openReview = async (tenancy: Tenancy) => {
    if (!canSubmitTenantReview(tenancy)) return
    setSelectedTenancy(tenancy)
    setEditingReviewId(null)
    setPaymentScoreSuggested("8")
    setUnitCareScore("8")
    setCommunicationScore("8")
    setLatePaymentsCount("0")
    setOutstandingCount("0")
    setReviewComment("")
    setReviewEvidenceUrls([])
    setReviewBadges({ blacklist: false, five_star_tenant: false, payment_delay: false })
    try {
      const latest = await getLatestTenantReview({ tenantId: tenancy.tenantId, tenancyId: tenancy.id })
      const item = latest?.item
      if (item) {
        setEditingReviewId(item.id)
        setPaymentScoreSuggested(String(item.paymentScoreSuggested ?? 8))
        setUnitCareScore(String(item.unitCareScore ?? 8))
        setCommunicationScore(String(item.communicationScore ?? 8))
        setLatePaymentsCount(String(item.latePaymentsCount ?? 0))
        setOutstandingCount(String(item.outstandingCount ?? 0))
        setReviewComment(item.comment || "")
        setReviewEvidenceUrls((item.evidenceUrls || []).slice(0, 30))
        const itemBadges = Array.isArray(item.badges) ? item.badges : []
        setReviewBadges({
          blacklist: itemBadges.includes("blacklist") || itemBadges.includes("property_damage"),
          five_star_tenant: itemBadges.includes("five_star_tenant") || itemBadges.includes("5-star Tenant"),
          payment_delay:
            itemBadges.includes("payment_delay") ||
            itemBadges.includes("late_payment") ||
            itemBadges.includes("outstanding_rent"),
        })
      }
    } catch (_) {}
    setShowReviewDialog(true)
  }

  const runExtendSubmit = async () => {
    if (!selectedTenancy || extendSubmitting || extendSubmitLockRef.current) return
    extendSubmitLockRef.current = true
    setExtendSubmitting(true)
    try {
      const baseDeposit = Number(selectedTenancy.deposit || 0)
      const rawDep = extendDeposit.trim()
      const parsedDep = rawDep === "" ? baseDeposit : parseFloat(extendDeposit)
      const computedNewDeposit = Number.isFinite(parsedDep) ? parsedDep : baseDeposit
      let newParkingMonthly: number | undefined
      if (selectedTenancy.extendHasParkingFees) {
        newParkingMonthly = newParkingMonthlyTotalFromPerLotField(extendParking, selectedTenancy.extendParkingLotCount)
        if (newParkingMonthly === undefined) {
          window.alert(
            `Enter a valid parking fee per lot / month (${currencyCode}), same as New booking — or 0 to skip.`
          )
          return
        }
      }
      const r = await extendTenancy({
        tenancyId: selectedTenancy.id,
        newEnd: extendDate,
        newRental: parseFloat(extendRent) || undefined,
        newDeposit: computedNewDeposit,
        agreementFees: parseFloat(extendAgreementFee) || undefined,
        ...(newParkingMonthly !== undefined ? { newParkingMonthly } : {}),
      })
      if (r?.ok !== false) {
        setShowExtendDialog(false)
        setShowExtendEndDateWarning(false)
        await loadData()
        return
      }
      window.alert((r as { message?: string; reason?: string })?.message || (r as { reason?: string })?.reason || "Failed to extend tenancy.")
    } catch (e) {
      console.error(e)
      window.alert(e instanceof Error ? e.message : "Failed to extend tenancy.")
    } finally {
      extendSubmitLockRef.current = false
      setExtendSubmitting(false)
    }
  }

  const handleExtendSubmit = () => {
    if (!selectedTenancy || extendSubmitting || extendSubmitLockRef.current) return
    const curCoYmd = selectedTenancy.checkOut?.trim().slice(0, 10) ?? ""
    if (
      curCoYmd &&
      extendDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(extendDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(curCoYmd) &&
      extendDate <= curCoYmd
    ) {
      window.alert("New check-out must be after the current check-out date.")
      return
    }
    if (selectedTenancy.extendHasParkingFees) {
      const np = newParkingMonthlyTotalFromPerLotField(extendParking, selectedTenancy.extendParkingLotCount)
      if (np === undefined) {
        window.alert(
          `Enter a valid parking fee per lot / month (${currencyCode}), same as New booking — or 0 to skip.`
        )
        return
      }
    }
    const cycleType =
      extendPaymentCycle?.type?.toLowerCase() ??
      ((admin?.rental as { type?: string } | undefined)?.type || "first").toLowerCase()
    if (
      cycleType === "first" &&
      extendDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(extendDate) &&
      !isLastDayOfCalendarMonthYmd(extendDate)
    ) {
      setShowExtendEndDateWarning(true)
      return
    }
    void runExtendSubmit()
  }

  const runChangeRoomSubmit = async () => {
    if (!selectedTenancy || !changeRoomId || changeSubmitting || changeSubmitLockRef.current) return
    const endYmd = (changeCheckOut || selectedTenancy.checkOut || "").trim().slice(0, 10)
    const moveYmd = (changeDate || "").trim().slice(0, 10)
    const baseDeposit = Number(selectedTenancy.deposit || 0)
    const rawD = changeDeposit.trim()
    const parsedDep = rawD === "" ? baseDeposit : parseFloat(changeDeposit)
    const computedNewDeposit = Number.isFinite(parsedDep) ? parsedDep : baseDeposit
    changeSubmitLockRef.current = true
    setChangeSubmitting(true)
    setShowChangeRoomCheckoutWarning(false)
    try {
      let newParkingMonthly: number | undefined
      if (selectedTenancy.extendHasParkingFees) {
        newParkingMonthly = newParkingMonthlyTotalFromPerLotField(changeParking, selectedTenancy.extendParkingLotCount)
      }
      const r = await changeRoomTenancy({
        tenancyId: selectedTenancy.id,
        newRoomId: changeRoomId,
        newEnd: endYmd,
        changeDate: moveYmd,
        newRental: parseFloat(changeRent) || undefined,
        newDeposit: computedNewDeposit,
        agreementFees: parseFloat(changeAgreementFee) || undefined,
        ...(newParkingMonthly !== undefined ? { newParkingMonthly } : {}),
        handoverOut: {
          handoverCardPhotos: changeOutCardUrls,
          unitPhotos: changeOutUnitUrls,
          tenantSignatureUrl: changeOutSignUrl.trim(),
          scheduledAt: changeHandoverOutAt || undefined,
        },
        handoverIn: {
          handoverCardPhotos: changeInCardUrls,
          unitPhotos: changeInUnitUrls,
          tenantSignatureUrl: changeInSignUrl.trim(),
          scheduledAt: changeHandoverInAt || undefined,
        },
      })
      const ok = (r as { ok?: boolean; success?: boolean })?.ok ?? (r as { success?: boolean })?.success
      if (ok) {
        setShowChangeRoomDialog(false)
        setShowChangeRoomCheckoutWarning(false)
        await loadData()
        return
      }
      window.alert((r as { reason?: string; message?: string })?.reason || (r as { reason?: string; message?: string })?.message || "Failed to change room.")
    } catch (e) {
      console.error(e)
      window.alert(e instanceof Error ? e.message : "Failed to change room.")
    } finally {
      changeSubmitLockRef.current = false
      setChangeSubmitting(false)
    }
  }

  const handleChangeRoomSubmit = () => {
    if (!selectedTenancy || !changeRoomId || changeSubmitting || changeSubmitLockRef.current) return
    if (changeRoomId === selectedTenancy.roomId) {
      window.alert("Please select a different room.")
      return
    }
    const endYmd = (changeCheckOut || selectedTenancy.checkOut || "").trim().slice(0, 10)
    const moveYmd = (changeDate || "").trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) {
      window.alert("Please enter a valid check-out date.")
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(moveYmd)) {
      window.alert("Please enter a valid move / room-change date.")
      return
    }
    if (moveYmd > endYmd) {
      window.alert("Move-in to the new room cannot be after the check-out date.")
      return
    }
    const baseDeposit = Number(selectedTenancy.deposit || 0)
    const rawD = changeDeposit.trim()
    const parsedDep = rawD === "" ? baseDeposit : parseFloat(changeDeposit)
    if (!Number.isFinite(parsedDep) || parsedDep < 0) {
      window.alert("Enter a valid deposit amount.")
      return
    }
    if (parsedDep < baseDeposit) {
      window.alert("Deposit cannot be less than the current deposit. Leave unchanged or increase only; increases generate a deposit top-up invoice.")
      return
    }
    if (
      selectedTenancy.extendHasParkingFees &&
      (changeParking.trim() === "" || Number.isNaN(parseFloat(changeParking)) || parseFloat(changeParking) < 0)
    ) {
      window.alert(
        `Enter a valid parking fee per lot / month (${currencyCode}) for this change, same as New booking — or 0 if none applies.`
      )
      return
    }
    const changeRoomCycleType =
      (admin?.rental as { type?: string } | undefined)?.type?.toLowerCase() || "first"
    if (
      changeRoomCycleType === "first" &&
      changeCheckOut &&
      /^\d{4}-\d{2}-\d{2}$/.test(endYmd) &&
      !isLastDayOfCalendarMonthYmd(endYmd)
    ) {
      setShowChangeRoomCheckoutWarning(true)
      return
    }
    void runChangeRoomSubmit()
  }

  const handleTerminateSubmit = async () => {
    if (!selectedTenancy || terminateSubmitting) return
    setTerminateSubmitting(true)
    try {
      const r = await terminateTenancy({
        tenancyId: selectedTenancy.id,
        forfeitAmount: parseFloat(terminateForfeit) || undefined,
      })
      if (r?.ok !== false) {
        setShowTerminateDialog(false)
        await loadData()
        return
      }
      window.alert((r as { reason?: string; message?: string })?.reason || (r as { reason?: string; message?: string })?.message || "Failed to terminate tenancy.")
    } catch (e) {
      console.error(e)
      window.alert(e instanceof Error ? e.message : "Failed to terminate tenancy.")
    } finally {
      setTerminateSubmitting(false)
    }
  }

  const handleEditSubmit = async () => {
    if (!selectedTenancy) return
    const checkinScheduleLocked = isCheckinHandoverComplete(selectedTenancy)
    const checkoutScheduleLocked = isCheckoutHandoverComplete(selectedTenancy)
    const checkoutPolicyLocked = !canEditCheckoutSchedule(selectedTenancy)
    const checkoutFieldLocked = checkoutScheduleLocked || checkoutPolicyLocked
    const leaseEndEditable = canEditLeaseEndDate(selectedTenancy)
    try {
      const r = await updateTenancy({
        tenancyId: selectedTenancy.id,
        end: leaseEndEditable ? editCheckOut || undefined : undefined,
        handoverCheckinAt: checkinScheduleLocked ? undefined : (toDateTimeLocalValue(editHandoverCheckinAt) || undefined),
        handoverCheckoutAt: checkoutFieldLocked ? undefined : (toDateTimeLocalValue(editHandoverCheckoutAt) || undefined),
      })
      if ((r as { success?: boolean; ok?: boolean })?.success === false || (r as { success?: boolean; ok?: boolean })?.ok === false) {
        window.alert("Failed to save tenancy changes.")
        return
      }
      if (r?.success !== false) {
        setShowEditDialog(false)
        await loadData()
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed to save tenancy changes.")
    }
  }

  const handleReviewSubmit = async () => {
    if (submittingReview) return
    if (!selectedTenancy || !selectedTenancy.tenantId) {
      toast.error("Missing tenant id.")
      return
    }
    if (!canSubmitTenantReview(selectedTenancy)) {
      toast.error("You can submit a tenant review only after the tenancy is terminated or inactive (lease ended).")
      return
    }
    const evidenceUrls = reviewEvidenceUrls
    try {
      setSubmittingReview(true)
      const suggested = Math.max(0, Math.min(10, Number(paymentScoreSuggested || 0)))
      const care = Math.max(0, Math.min(10, Number(unitCareScore || 0)))
      const communication = Math.max(0, Math.min(10, Number(communicationScore || 0)))
      const badges = (Object.keys(reviewBadges) as TenantBadge[]).filter((k) => reviewBadges[k])
      const resp = await submitTenantReview({
        reviewId: editingReviewId || undefined,
        tenantId: selectedTenancy.tenantId,
        tenancyId: selectedTenancy.id,
        paymentScoreSuggested: suggested,
        paymentScoreFinal: suggested,
        unitCareScore: care,
        communicationScore: communication,
        latePaymentsCount: Number(latePaymentsCount || 0),
        outstandingCount: Number(outstandingCount || 0),
        badges,
        comment: reviewComment.trim(),
        evidenceUrls,
      })
      if (resp?.ok === false) {
        const r = resp?.reason
        toast.error(
          r === "TENANCY_NOT_ENDED"
            ? "Reviews are only allowed after the tenancy is terminated or the lease has ended."
            : r === "REVIEW_ALREADY_SUBMITTED"
              ? "This tenancy already has a tenant review. Only one review per tenancy is allowed."
              : r === "REVIEW_NOT_FOUND"
                ? "Review could not be updated. Refresh the page and try again."
                : r || "Failed to submit review."
        )
        return
      }
      setShowReviewDialog(false)
      toast.success(`Review ${editingReviewId ? "updated" : "submitted"}.`, {
        description: `Profile URL: /profile/${selectedTenancy.tenantId}`,
        duration: 8000,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit review.")
    } finally {
      setSubmittingReview(false)
    }
  }

  const handleEvidenceUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadingEvidence(true)
    try {
      const urls: string[] = []
      for (const file of Array.from(files)) {
        const res = await uploadFile(file)
        if (res?.ok && res.url) urls.push(res.url)
      }
      if (urls.length) {
        setReviewEvidenceUrls((prev) => [...prev, ...urls].slice(0, 30))
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Upload failed.")
    } finally {
      setUploadingEvidence(false)
    }
  }

  const isLikelyVideoUrl = (url: string) => {
    const s = url.toLowerCase()
    return s.includes(".mp4") || s.includes(".mov") || s.includes(".webm") || s.includes(".m4v")
  }

  const handleCancelBookingConfirm = async () => {
    if (!selectedTenancy) return
    try {
      await cancelBooking(selectedTenancy.id)
      setShowCancelConfirm(false)
      setSelectedTenancy(null)
      await loadData()
    } catch (e) {
      console.error(e)
    }
  }

  function formatChangeRoomPreviewErrorMessage(raw: string): string {
    switch (raw) {
      case "CHANGE_ROOM_RENT_REDUCTION":
        return "Rental cannot be reduced."
      case "INVALID_NEW_END_BEFORE_MOVE":
        return "Check-out must be on or after the first day at new rent."
      case "INVALID_CHANGE_DATE":
        return "Invalid first day at new rent."
      case "INVALID_NEW_END":
        return "Invalid check-out date."
      case "ROOM_NOT_AVAILABLE":
        return "Selected room is not available."
      case "EXTEND_PARKING_NOT_APPLICABLE":
        return "Parking fees do not apply to this tenancy."
      case "INVALID_PARKING_MONTHLY":
        return "Enter a valid parking fee per lot / month (0 or greater), same as New booking."
      default:
        return raw
    }
  }

  useEffect(() => {
    if (!showChangeRoomDialog || !selectedTenancy?.id) return
    if (!changeRoomId || changeRoomId === selectedTenancy.roomId) {
      setChangeRoomPreview(null)
      setChangeRoomPreviewError(null)
      return
    }
    if (!changeDate || !/^\d{4}-\d{2}-\d{2}$/.test(changeDate)) {
      setChangeRoomPreview(null)
      setChangeRoomPreviewError(null)
      return
    }
    if (!changeCheckOut || !/^\d{4}-\d{2}-\d{2}$/.test(changeCheckOut)) {
      setChangeRoomPreview(null)
      setChangeRoomPreviewError(null)
      return
    }
    const rent = parseFloat(changeRent)
    if (!Number.isFinite(rent) || rent <= 0) {
      setChangeRoomPreview(null)
      setChangeRoomPreviewError(null)
      return
    }
    if (rent < Number(selectedTenancy.rent || 0)) {
      setChangeRoomPreview(null)
      setChangeRoomPreviewError("Rental cannot be reduced.")
      return
    }
    if (
      selectedTenancy.extendHasParkingFees &&
      (changeParking.trim() === "" || Number.isNaN(parseFloat(changeParking)) || parseFloat(changeParking) < 0)
    ) {
      setChangeRoomPreview(null)
      setChangeRoomPreviewError(null)
      return
    }
    let cancelled = false
    const tid = window.setTimeout(() => {
      void (async () => {
        setChangeRoomPreviewLoading(true)
        setChangeRoomPreviewError(null)
        try {
          const baseDeposit = Number(selectedTenancy.deposit || 0)
          const rawDep = changeDeposit.trim()
          const parsedDep = rawDep === "" ? baseDeposit : parseFloat(changeDeposit)
          const computedNewDeposit = Number.isFinite(parsedDep) ? parsedDep : baseDeposit
          let newParkingMonthly: number | undefined
          if (selectedTenancy.extendHasParkingFees) {
            newParkingMonthly = newParkingMonthlyTotalFromPerLotField(changeParking, selectedTenancy.extendParkingLotCount)
          }
          const res = (await previewChangeRoomTenancy({
            tenancyId: selectedTenancy.id,
            newRoomId: changeRoomId,
            newEnd: changeCheckOut,
            changeDate,
            newRental: rent,
            newDeposit: computedNewDeposit,
            agreementFees: parseFloat(changeAgreementFee) || 0,
            ...(newParkingMonthly !== undefined ? { newParkingMonthly } : {}),
          })) as ChangeRoomInvoicePreview & { ok?: boolean; message?: string }
          if (cancelled) return
          if (res?.message && res.ok === false) {
            setChangeRoomPreview(null)
            setChangeRoomPreviewError(formatChangeRoomPreviewErrorMessage(String(res.message)))
          } else {
            setChangeRoomPreview(res)
            setChangeRoomPreviewError(null)
          }
        } catch (e) {
          if (!cancelled) {
            setChangeRoomPreview(null)
            const msg = e instanceof Error ? e.message : "Preview failed."
            setChangeRoomPreviewError(formatChangeRoomPreviewErrorMessage(msg))
          }
        } finally {
          if (!cancelled) setChangeRoomPreviewLoading(false)
        }
      })()
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(tid)
    }
  }, [
    showChangeRoomDialog,
    selectedTenancy?.id,
    selectedTenancy?.roomId,
    selectedTenancy?.rent,
    selectedTenancy?.deposit,
    changeRoomId,
    changeDate,
    changeCheckOut,
    changeRent,
    changeDeposit,
    changeAgreementFee,
    selectedTenancy?.extendHasParkingFees,
    selectedTenancy?.extendParkingLotCount,
    changeParking,
  ])

  useEffect(() => {
    if (createAgreementStep !== "template" || !agreementMode) {
      setAgreementTemplates([])
      setAgreementTemplateId("")
      return
    }
    getTenancyAgreementTemplates(agreementMode).then((list) => {
      setAgreementTemplates(Array.isArray(list) ? list : [])
      setAgreementTemplateId("")
    }).catch(() => setAgreementTemplates([]))
  }, [createAgreementStep, agreementMode])

  const openCreateAgreement = (tenancy?: Tenancy | null) => {
    const t = tenancy ?? selectedTenancy
    setSelectedTenancy(t ?? null)
    setCreateAgreementStep("choice")
    setAgreementMode("")
    setAgreementTemplates([])
    setAgreementTemplateId("")
    setAgreementUrl("")
    setAgreementExtendBegin(t?.checkIn ?? "")
    setAgreementExtendEnd(t?.checkOut ?? "")
    setAgreementConfirmCredit(false)
    setShowCreateAgreementBox(true)
  }

  const handleCreateAgreementSubmit = async () => {
    if (!selectedTenancy) return
    setAgreementSubmitting(true)
    try {
      if (createAgreementStep === "manual") {
        if (!agreementUrl?.trim() || !agreementMode) return
        await insertTenancyAgreement({
          tenancyId: selectedTenancy.id,
          propertyId: selectedTenancy.propertyId,
          mode: agreementMode,
          type: "manual",
          url: agreementUrl.trim(),
          status: "complete",
        })
      } else {
        if (!agreementTemplateId || !agreementMode || !agreementConfirmCredit) return
        await insertTenancyAgreement({
          tenancyId: selectedTenancy.id,
          propertyId: selectedTenancy.propertyId,
          mode: agreementMode,
          type: "system",
          templateId: agreementTemplateId,
          status: "pending",
          extendBegin: agreementExtendBegin || undefined,
          extendEnd: agreementExtendEnd || undefined,
          confirmCreditDeduction: true,
        })
      }
      setShowCreateAgreementBox(false)
      await Promise.all([loadData(), refreshOperatorCtx()])
    } catch (e) {
      console.error(e)
      window.alert(e instanceof Error ? e.message : "Request failed.")
    } finally {
      setAgreementSubmitting(false)
    }
  }

  const canSubmitAgreement =
    (createAgreementStep === "manual" && agreementMode && agreementUrl?.trim()) ||
    (createAgreementStep === "template" &&
      agreementMode &&
      agreementTemplateId &&
      agreementConfirmCredit &&
      !insufficientCreditForTenancyAgreement)

  return (
    <main className="p-3 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tenancy Settings</h1>
          <p className="text-sm text-muted-foreground">Manage tenant contracts and rental agreements</p>
        </div>
        <Link href="/operator/booking">
          <Button className="gap-2 self-start sm:self-auto flex-shrink-0" style={{ background: "var(--brand)" }}>
            <Plus size={16} /> New Tenancy
          </Button>
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between mb-4">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "list" | "calendar")}>
          <TabsList className="h-9">
            <TabsTrigger value="list" className="gap-1.5 px-3">
              <LayoutList className="h-4 w-4 shrink-0" />
              List view
            </TabsTrigger>
            <TabsTrigger value="calendar" className="gap-1.5 px-3">
              <Calendar className="h-4 w-4 shrink-0" />
              Calendar view
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {viewMode === "calendar" && (
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            <Button
              type="button"
              variant={calendarScale === "month" ? "default" : "ghost"}
              size="sm"
              className="h-8 rounded-md px-3"
              style={calendarScale === "month" ? { background: "var(--brand)" } : undefined}
              onClick={() => setCalendarScale("month")}
            >
              By month
            </Button>
            <Button
              type="button"
              variant={calendarScale === "day" ? "default" : "ghost"}
              size="sm"
              className="h-8 rounded-md px-3"
              style={calendarScale === "day" ? { background: "var(--brand)" } : undefined}
              onClick={() => setCalendarScale("day")}
            >
              By day
            </Button>
          </div>
        )}
      </div>

      {/* Search + Filter toggle */}
      <Card className="mb-4">
        <CardContent className="p-3 sm:p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
              <Input
                placeholder="Search tenant or room..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant={showFilters ? "default" : "outline"}
              size="sm"
              className="gap-2 flex-shrink-0"
              style={showFilters ? { background: "var(--brand)" } : undefined}
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal size={15} />
              <span className="hidden sm:inline">Filters</span>
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-white" />
              )}
            </Button>
          </div>

          {/* Expanded filters */}
          {showFilters && (
            <div className="mt-3 pt-3 border-t border-border flex flex-col sm:flex-row gap-3 flex-wrap">
              <Select value={property} onValueChange={setProperty}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Property" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full sm:w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 flex-1">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="flex-1 min-w-0 border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                  placeholder="From"
                />
                <span className="text-muted-foreground text-xs flex-shrink-0">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="flex-1 min-w-0 border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                  placeholder="To"
                />
              </div>

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground flex-shrink-0" onClick={clearFilters}>
                  <X size={14} /> Clear
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {loading && viewMode === "list" && (
        <p className="text-xs text-muted-foreground mb-3 px-1">Loading...</p>
      )}

      {viewMode === "calendar" && (
        <div className="mb-4">
          <TenancyCalendarView
            tenancies={calendarTenancies}
            scale={calendarScale}
            year={calYear}
            monthIndex={calMonth}
            onYearChange={setCalYear}
            onMonthChange={setCalMonth}
            todayYmd={todayYmdCalendar}
            onTenancyClick={openDetailFromCalendar}
            loading={loading}
          />
        </div>
      )}

      {/* Table */}
      {viewMode === "list" && (
      <Card>
        <CardContent className="p-0">
          <TooltipProvider delayDuration={200}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground">Tenant</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden sm:table-cell">Property / Room</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden md:table-cell">Check-in</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden md:table-cell">Check-out</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden lg:table-cell">Rent</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground">Status / Agreement</th>
                  <th className="text-center py-3 px-4 font-semibold text-xs text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                      No tenancies match your filters.
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((tenancy) => {
                    const leaseAgreements = agreementsAfterRoomChange(tenancy.agreements, tenancy.lastRoomChangeAt)
                    const pendingDraft = getFirstPendingDraftAgreement(leaseAgreements)
                    const pendingDraftId = pendingDraft?._id ?? null
                    const pdfBusy = !!pendingDraft?.pdf_generating
                    return (
                    <tr
                      key={tenancy.id}
                      className={`border-b border-border hover:bg-secondary/30 transition-colors ${tenancy.status === "Pending" ? "bg-yellow-50" : ""} ${tenancy.status === "Rejected" ? "bg-orange-50/60" : ""}`}
                    >
                      <td className="py-3 px-4 font-semibold">{tenancy.tenant}</td>
                      <td className="py-3 px-4 hidden sm:table-cell text-muted-foreground">{tenancy.property} / {tenancy.room}</td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs">{tenancy.checkIn}</td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs">{tenancy.checkOut}</td>
                      <td className="py-3 px-4 hidden lg:table-cell text-sm font-medium">{currencySymbol} {tenancy.rent.toLocaleString()}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <TenancyStatusIcon status={tenancy.status} />
                          {tenancy.reviewed ? <ReviewedStatusIcon /> : null}
                          <AgreementStatusBadge
                            agreements={tenancy.agreements}
                            previousEnd={tenancy.previousEnd}
                            checkIn={tenancy.checkIn}
                            checkOut={tenancy.checkOut}
                            lastRoomChangeAt={tenancy.lastRoomChangeAt}
                          />
                          {shouldShowHandoverStatusIcon(tenancy) ? (
                            <HandoverStatusIcon tenancy={tenancy} />
                          ) : null}
                          {pendingDraftId ? (
                            <span
                              className="inline-flex h-7 items-center rounded-md border border-amber-300/80 px-2 text-xs font-semibold text-amber-950 bg-amber-50/80 dark:bg-amber-950/30 dark:text-amber-100 dark:border-amber-700"
                              title={pdfBusy ? "Agreement draft is generating" : "Tenant profile is incomplete; waiting for tenant to complete profile"}
                            >
                              {pdfBusy ? "Generating…" : "Pending tenant profile"}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="gap-1">
                                <MoreHorizontal size={14} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              {tenancy.status === "Pending" ? (
                                <>
                                  <DropdownMenuItem onClick={() => openDetail(tenancy)}>
                                    <Eye size={14} className="mr-2" /> View Details
                                  </DropdownMenuItem>
                                  {pendingDraftId ? (
                                    <DropdownMenuItem disabled>
                                      <RefreshCw size={14} className="mr-2" />
                                      {pdfBusy ? "Generating…" : "Pending tenant profile"}
                                    </DropdownMenuItem>
                                  ) : null}
                                  <DropdownMenuItem onClick={() => openEdit(tenancy)}>
                                    <Edit size={14} className="mr-2" /> Edit Tenancy
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openCreateAgreement(tenancy)}>
                                    <Edit size={14} className="mr-2" /> Create Tenancy Agreement
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => openCheckinHandover(tenancy)}
                                    disabled={
                                      isCheckinHandoverComplete(tenancy) ||
                                      tenancy.status === "Rejected" ||
                                      !hasScheduledCheckinHandoverAt(tenancy)
                                    }
                                  >
                                    <Camera size={14} className="mr-2" /> Check-in handover
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => openCheckoutHandover(tenancy)}
                                    disabled={
                                      !canStartCheckoutHandover(tenancy) ||
                                      !hasScheduledCheckoutHandoverAt(tenancy)
                                    }
                                  >
                                    <Camera size={14} className="mr-2" /> Check-out handover
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => { setSelectedTenancy(tenancy); setShowCancelConfirm(true) }}
                                    className="text-destructive"
                                  >
                                    <Trash2 size={14} className="mr-2" /> Cancel Booking
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <>
                                  {/* 1. View */}
                                  <DropdownMenuItem onClick={() => openDetail(tenancy)}>
                                    <Eye size={14} className="mr-2" /> View Details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openHandoverDetail(tenancy)}>
                                    <Eye size={14} className="mr-2" /> View Handover
                                  </DropdownMenuItem>
                                  {tenancy.agreements?.length ? (
                                    <DropdownMenuItem onClick={() => openAgreementsList(tenancy)}>
                                      <Eye size={14} className="mr-2" /> View Agreement
                                    </DropdownMenuItem>
                                  ) : null}
                                  <DropdownMenuSeparator />
                                  {/* 2. Edit & agreement */}
                                  <DropdownMenuItem onClick={() => openEdit(tenancy)}>
                                    <Edit size={14} className="mr-2" /> Edit Tenancy
                                  </DropdownMenuItem>
                                  {tenancy.status === "Active" ? (
                                    <DropdownMenuItem onClick={() => openCreateAgreement(tenancy)}>
                                      <Edit size={14} className="mr-2" /> Create Tenancy Agreement
                                    </DropdownMenuItem>
                                  ) : null}
                                  {pendingDraftId ? (
                                    <DropdownMenuItem disabled>
                                      <RefreshCw size={14} className="mr-2" />
                                      {pdfBusy ? "Generating…" : "Pending tenant profile"}
                                    </DropdownMenuItem>
                                  ) : null}
                                  <DropdownMenuSeparator />
                                  {/* 3. Handover */}
                                  <DropdownMenuItem
                                    onClick={() => openCheckinHandover(tenancy)}
                                    disabled={
                                      isCheckinHandoverComplete(tenancy) ||
                                      tenancy.status === "Rejected" ||
                                      !hasScheduledCheckinHandoverAt(tenancy)
                                    }
                                  >
                                    <Camera size={14} className="mr-2" /> Check-in handover
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => openCheckoutHandover(tenancy)}
                                    disabled={
                                      !canStartCheckoutHandover(tenancy) ||
                                      !hasScheduledCheckoutHandoverAt(tenancy)
                                    }
                                  >
                                    <Camera size={14} className="mr-2" /> Check-out handover
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {/* 4. Extend / change room */}
                                  <DropdownMenuItem onClick={() => openExtend(tenancy)} disabled={tenancy.status === "Terminated" || tenancy.status === "Tenancy Complete" || tenancy.status === "Rejected"}>
                                    <CalendarPlus size={14} className="mr-2" /> Extend Tenancy
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openChangeRoom(tenancy)} disabled={tenancy.status === "Terminated" || tenancy.status === "Tenancy Complete" || tenancy.status === "Rejected"}>
                                    <ArrowRightLeft size={14} className="mr-2" /> Change Room
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {/* 5. Review (ended tenancies) */}
                                  <DropdownMenuItem
                                    onClick={() => openReview(tenancy)}
                                    disabled={!canSubmitTenantReview(tenancy)}
                                    title={
                                      canSubmitTenantReview(tenancy)
                                        ? undefined
                                        : "Available only when tenancy is terminated or inactive (lease ended)."
                                    }
                                  >
                                    <Users size={14} className="mr-2" /> {tenancy.reviewed ? "Edit Tenant Review" : "Submit Tenant Review"}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {/* 6. Destructive */}
                                  {tenancy.status === "Rejected" ? (
                                    <DropdownMenuItem
                                      onClick={() => { setSelectedTenancy(tenancy); setShowCancelConfirm(true) }}
                                      className="text-destructive"
                                    >
                                      <Trash2 size={14} className="mr-2" /> Delete booking
                                    </DropdownMenuItem>
                                  ) : null}
                                  <DropdownMenuItem onClick={() => openTerminate(tenancy)} className="text-destructive" disabled={tenancy.status === "Terminated" || tenancy.status === "Tenancy Complete"}>
                                    <XCircle size={14} className="mr-2" /> Terminate
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {!loading && totalFiltered > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-border">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Showing {(listPage - 1) * pageSize + 1}–{Math.min(listPage * pageSize, totalFiltered)} of {totalFiltered}
                </p>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Per page</Label>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v) as (typeof PAGE_SIZE_OPTIONS)[number])
                      setListPage(1)
                    }}
                  >
                    <SelectTrigger className="w-[4.5rem] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setListPage((p) => Math.max(1, p - 1))} disabled={listPage <= 1}>
                  Previous
                </Button>
                <span className="px-2 text-sm text-muted-foreground">
                  Page {listPage} of {totalPages}
                </span>
                <Button variant="outline" size="sm" onClick={() => setListPage((p) => Math.min(totalPages, p + 1))} disabled={listPage >= totalPages}>
                  Next
                </Button>
              </div>
            </div>
          )}
          </TooltipProvider>
        </CardContent>
      </Card>
      )}

      {/* Extend Tenancy Dialog */}
      <Dialog
        open={showExtendDialog}
        onOpenChange={(open) => {
          if (!open && extendSubmitting) return
          setShowExtendDialog(open)
          if (!open) {
            extendSubmitLockRef.current = false
            setExtendSubmitting(false)
            setShowExtendEndDateWarning(false)
            setExtendPreview(null)
            setExtendPreviewError(null)
            setExtendPreviewLoading(false)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw]">
          <DialogHeader>
            <DialogTitle>Extend Tenancy</DialogTitle>
            <DialogDescription>
              Extend the rental period for {selectedTenancy?.tenant} in {selectedTenancy?.room}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Current Check-out</label>
              <Input value={selectedTenancy?.checkOut || ""} disabled />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">New Check-out Date *</label>
              <input
                type="date"
                value={extendDate}
                onChange={(e) => setExtendDate(e.target.value)}
                min={selectedTenancy?.checkOut ? selectedTenancy.checkOut.trim().slice(0, 10) : undefined}
                max={extendMaxEnd ?? undefined}
                disabled={extendSubmitting}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Rental invoice date (same as{" "}
                <Link href="/operator/company" className="underline underline-offset-2 text-foreground/90">
                  Company Settings → Set fees
                </Link>
                ):{" "}
                <span className="font-medium text-foreground">{extendRentalInvoiceLabel}</span>
              </p>
              {selectedTenancy && extendMaxEnd && addDaysYmd(selectedTenancy.checkOut, 1) > extendMaxEnd ? (
                <p className="text-xs text-destructive mt-1.5">
                  Cannot extend: a later booking on this room limits the new check-out to {extendMaxEnd} or earlier.
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <div className="min-w-0">
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">New Rent ({currencyCode}) *</label>
                <Input
                  type="number"
                  value={extendRent}
                  onChange={(e) => setExtendRent(e.target.value)}
                  disabled={extendSubmitting}
                  className={cn(tenancyMoneyFieldDirty(extendRent, extendFieldBaselineRef.current.rent) && TENANCY_DIALOG_MODIFIED_INPUT_CLASS)}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Deposit ({currencyCode})</label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="rounded-full text-muted-foreground hover:text-foreground p-0.5 -m-0.5 shrink-0"
                        aria-label="Deposit help"
                        disabled={extendSubmitting}
                      >
                        <CircleHelp className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[280px] text-left font-normal">
                      Total deposit after extend; prefilled with current. Increase generates a top-up invoice.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  type="number"
                  value={extendDeposit}
                  onChange={(e) => setExtendDeposit(e.target.value)}
                  disabled={extendSubmitting}
                  className={cn(tenancyMoneyFieldDirty(extendDeposit, extendFieldBaselineRef.current.deposit) && TENANCY_DIALOG_MODIFIED_INPUT_CLASS)}
                />
              </div>
            </div>
            <div
              className={
                selectedTenancy?.extendHasParkingFees ? "grid grid-cols-1 sm:grid-cols-2 gap-3 items-start" : ""
              }
            >
              <div className="min-w-0">
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Agreement Fee ({currencyCode})</label>
                <Input type="number" value={extendAgreementFee} onChange={(e) => setExtendAgreementFee(e.target.value)} placeholder="0" disabled={extendSubmitting} />
              </div>
              {selectedTenancy?.extendHasParkingFees ? (
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Parking fee per lot / month ({currencyCode}) *
                    </label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="rounded-full text-muted-foreground hover:text-foreground p-0.5 -m-0.5 shrink-0"
                          aria-label="Parking fee per lot help"
                          disabled={extendSubmitting}
                        >
                          <CircleHelp className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[300px] text-left font-normal">
                        Same field as New booking. Default is the full-month rate per lot from the tenancy (not prorated line amounts). Invoices use per lot × assigned lots
                        {(selectedTenancy?.extendParkingLotCount ?? 0) > 0
                          ? ` (${selectedTenancy?.extendParkingLotCount} on this lease)`
                          : ""}
                        ; mid-cycle dates still prorate like rent. Use 0 if none.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input
                    type="number"
                    value={extendParking}
                    onChange={(e) => setExtendParking(e.target.value)}
                    disabled={extendSubmitting}
                    className={cn(
                      tenancyMoneyFieldDirty(extendParking, extendFieldBaselineRef.current.parking) && TENANCY_DIALOG_MODIFIED_INPUT_CLASS
                    )}
                  />
                  {(selectedTenancy?.extendParkingLotCount ?? 0) > 1 ? (
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      {selectedTenancy?.extendParkingLotCount} lots — combined monthly parking before proration ≈ {currencySymbol}{" "}
                      {Number.isFinite(parseFloat(extendParking))
                        ? (parseFloat(extendParking) * (selectedTenancy?.extendParkingLotCount ?? 0)).toFixed(2)
                        : "—"}
                      .
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <Card className="border-border shadow-none">
            <CardHeader className="py-3 pb-2">
              <CardTitle className="text-base">Summary</CardTitle>
              <p className="text-xs text-muted-foreground font-normal">
                One-time charges + prorated rent and parking for the extension period (same billing rules as{" "}
                <Link href="/operator/booking" className="underline underline-offset-2">
                  New booking
                </Link>
                ).
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm pt-0">
              {extendPreviewLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
                  <Loader2 className="animate-spin size-4 shrink-0" />
                  Calculating invoices…
                </div>
              ) : extendPreviewError ? (
                <p className="text-xs text-destructive">{extendPreviewError}</p>
              ) : !extendPreview ? (
                <p className="text-xs text-muted-foreground">Enter new check-out, rent{selectedTenancy?.extendHasParkingFees ? ", parking" : ""} to preview lines.</p>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">One-time (extend)</p>
                    <div className="space-y-2 border border-border rounded-md divide-y divide-border">
                      {(extendPreview.oneTimeRows?.length ?? 0) === 0 ? (
                        <div className="px-3 py-2 text-muted-foreground text-xs">No deposit top-up or agreement fee.</div>
                      ) : (
                        extendPreview.oneTimeRows!.map((row) => (
                            <div key={row.key} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                              <div>
                                <span className="text-foreground">{row.label}</span>
                                {row.sub ? <span className="block text-xs text-muted-foreground">{row.sub}</span> : null}
                              </div>
                              <span className="font-medium tabular-nums sm:text-right">
                                {currencySymbol} {row.amount.toFixed(2)}
                              </span>
                            </div>
                          ))
                      )}
                      <div className="px-3 py-2 flex justify-between bg-muted/50 font-medium text-xs">
                        <span>Subtotal</span>
                        <span className="tabular-nums">
                          {currencySymbol} {(extendPreview.oneTimeSubtotal ?? 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Rent + parking (extension)</p>
                    {(extendPreview.recurringRows?.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2">
                        No rental or parking segments for this extension (check dates and amounts).
                      </p>
                    ) : (
                      <div className="space-y-2 border border-border rounded-md divide-y divide-border">
                        {extendPreview.recurringRows!.map((row) => {
                          const monthlyHint = recurringRowRateMonthlyHint(row.key, extendPreview.rateSummary, currencySymbol)
                          return (
                            <div key={row.key} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                              <div className="min-w-0">
                                <span className="text-foreground">{row.label}</span>
                                {row.sub ? <span className="block text-xs text-muted-foreground">{row.sub}</span> : null}
                                {row.formula ? (
                                  <span className="block text-[11px] text-muted-foreground font-mono tabular-nums mt-1 break-all">
                                    {row.formula}
                                  </span>
                                ) : null}
                              </div>
                              <div className="font-medium tabular-nums sm:text-right shrink-0 flex flex-col items-end gap-0.5">
                                <span>
                                  {currencySymbol} {row.amount.toFixed(2)}
                                </span>
                                {monthlyHint ? (
                                  <span className="text-[11px] text-muted-foreground font-normal font-sans leading-snug max-w-[16rem]">
                                    {monthlyHint}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                        <div className="px-3 py-2 flex justify-between bg-muted/50 font-medium text-xs">
                          <span>Subtotal</span>
                          <span className="tabular-nums">
                            {currencySymbol} {(extendPreview.recurringSubtotal ?? 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t-2 border-border">
                    <span className="text-sm font-semibold text-foreground">Total (extension billing)</span>
                    <span className="text-base font-bold tabular-nums" style={{ color: "var(--brand)" }}>
                      {currencySymbol} {(extendPreview.total ?? 0).toFixed(2)}
                    </span>
                  </div>
                  {extendPreview.previousEndYmd && extendPreview.newEndYmd ? (
                    <p className="text-[11px] text-muted-foreground">
                      Extension window: {extendPreview.previousEndYmd} → {extendPreview.newEndYmd} (invoice dates follow Company Settings).
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExtendDialog(false)} disabled={extendSubmitting}>
              Cancel
            </Button>
            <Button
              style={{ background: "var(--brand)" }}
              className={extendSubmitting ? "inline-flex items-center gap-2" : undefined}
              onClick={handleExtendSubmit}
              disabled={
                !extendDate ||
                !extendRent ||
                extendSubmitting ||
                extendNewEndNotAfterCurrent ||
                (selectedTenancy?.extendHasParkingFees === true &&
                  (extendParking.trim() === "" ||
                    Number.isNaN(parseFloat(extendParking)) ||
                    parseFloat(extendParking) < 0))
              }
            >
              {extendSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin shrink-0" />
                  Extending…
                </>
              ) : (
                "Confirm Extend"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showExtendEndDateWarning} onOpenChange={setShowExtendEndDateWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm new check-out date</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Your rental invoices use <strong className="text-foreground">first day of every month</strong> (Company
                  Settings). The new check-out <strong className="text-foreground">{extendDate}</strong> is not the{" "}
                  <strong className="text-foreground">last day of a calendar month</strong>, so the final month will be{" "}
                  <strong className="text-foreground">prorated</strong> in billing.
                </p>
                <p>Do you want to continue with this check-out date?</p>
                {extendPreview && (extendPreview.total != null || (extendPreview.recurringRows?.length ?? 0) > 0) ? (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-foreground space-y-1">
                    <p className="text-xs font-semibold">Invoice preview (same as Summary above)</p>
                    <p className="text-xs tabular-nums">
                      Total <span className="font-bold">{currencySymbol} {(extendPreview.total ?? 0).toFixed(2)}</span>
                      {" · "}
                      {(extendPreview.recurringRows?.length ?? 0) + (extendPreview.oneTimeRows?.length ?? 0)} line(s)
                    </p>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <Button
              style={{ background: "var(--brand)" }}
              type="button"
              onClick={() => {
                setShowExtendEndDateWarning(false)
                void runExtendSubmit()
              }}
            >
              Confirm extend
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change Room Dialog */}
      <Dialog
        open={showChangeRoomDialog}
        onOpenChange={(open) => {
          if (!open && changeSubmitting) return
          setShowChangeRoomDialog(open)
          if (!open) {
            changeSubmitLockRef.current = false
            setChangeSubmitting(false)
            setShowChangeRoomCheckoutWarning(false)
            setChangeRoomPreview(null)
            setChangeRoomPreviewError(null)
            setChangeRoomPreviewLoading(false)
            setChangeParking("")
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw]">
          <DialogHeader>
            <DialogTitle>Change Room</DialogTitle>
            <DialogDescription>
              Move {selectedTenancy?.tenant} from {selectedTenancy?.room} to a new room
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <div className="min-w-0 sm:col-span-2">
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Current Room</label>
                <Input value={selectedTenancy?.room || ""} disabled />
              </div>
              <div className="min-w-0 sm:col-span-2">
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">New Room *</label>
                <Select value={changeRoomId} onValueChange={(v) => {
                  setChangeRoomId(v)
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select new room" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRooms.map((room) => (
                      <SelectItem key={room.id} value={room.id}>
                        {room.title_fld ?? room.id}{room.shortname && room.shortname !== "Keep Current" ? ` (${room.shortname})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <label className="text-xs font-semibold text-muted-foreground">First day at new rent / new unit *</label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="rounded-full text-muted-foreground hover:text-foreground p-0.5 -m-0.5 shrink-0"
                        aria-label="Move date and proration help"
                        disabled={changeSubmitting}
                      >
                        <CircleHelp className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[300px] text-left font-normal">
                      <span className="block text-balance">
                        Old rent is pro-rated from lease start through the <span className="font-medium">day before</span> this date;
                        new rent from this date on. Example: last full day on old room rate is 12 May → enter{" "}
                        <span className="font-medium">13 May</span> (1–12 May old, 13–31 May new).
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <input
                  type="date"
                  value={changeDate}
                  onChange={(e) => setChangeDate(e.target.value)}
                  disabled={changeSubmitting}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground disabled:opacity-50"
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <label className="text-xs font-semibold text-muted-foreground">Check-out date *</label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="rounded-full text-muted-foreground hover:text-foreground p-0.5 -m-0.5 shrink-0"
                        aria-label="Check-out and billing invoice dates help"
                        disabled={changeSubmitting}
                      >
                        <CircleHelp className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[300px] text-left font-normal space-y-2">
                      <p className="text-balance m-0">Lease end after this change (defaults to current checkout).</p>
                      <p className="text-balance m-0">
                        Rental invoice dates follow{" "}
                        <Link
                          href="/operator/company"
                          className="underline underline-offset-2 font-medium text-background hover:opacity-90"
                        >
                          Company Settings → Set fees
                        </Link>
                        . If billing is on the <span className="font-medium">1st of the month</span> and this check-out is{" "}
                        <span className="font-medium">not</span> the last day of a month, you will be asked to confirm proration.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <input
                  type="date"
                  value={changeCheckOut}
                  min={changeDate || undefined}
                  onChange={(e) => setChangeCheckOut(e.target.value)}
                  disabled={changeSubmitting}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground disabled:opacity-50"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <div className="min-w-0">
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">New Rent ({currencyCode}) *</label>
                <Input
                  type="number"
                  value={changeRent}
                  onChange={(e) => setChangeRent(e.target.value)}
                  className={cn(tenancyMoneyFieldDirty(changeRent, changeFieldBaselineRef.current.rent) && TENANCY_DIALOG_MODIFIED_INPUT_CLASS)}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Deposit ({currencyCode})</label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="rounded-full text-muted-foreground hover:text-foreground p-0.5 -m-0.5 shrink-0"
                        aria-label="Deposit help"
                      >
                        <CircleHelp className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[280px] text-left font-normal">
                      Total deposit after the room change. Prefilled with the current amount. Only increases generate a deposit top-up invoice; keep the same value to skip.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  type="number"
                  min={selectedTenancy ? Number(selectedTenancy.deposit || 0) : undefined}
                  step="0.01"
                  value={changeDeposit}
                  onChange={(e) => setChangeDeposit(e.target.value)}
                  className={cn(tenancyMoneyFieldDirty(changeDeposit, changeFieldBaselineRef.current.deposit) && TENANCY_DIALOG_MODIFIED_INPUT_CLASS)}
                />
              </div>
            </div>
            <div
              className={
                selectedTenancy?.extendHasParkingFees ? "grid grid-cols-1 sm:grid-cols-2 gap-3 items-start" : ""
              }
            >
              <div className="min-w-0">
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Agreement Fee ({currencyCode})</label>
                <Input type="number" value={changeAgreementFee} onChange={(e) => setChangeAgreementFee(e.target.value)} placeholder="0" />
              </div>
              {selectedTenancy?.extendHasParkingFees ? (
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Parking fee per lot / month ({currencyCode}) *
                    </label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="rounded-full text-muted-foreground hover:text-foreground p-0.5 -m-0.5 shrink-0" aria-label="Parking fee per lot help">
                          <CircleHelp className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[300px] text-left font-normal">
                        Same as New booking and Extend. Default is full-month rate per lot from the tenancy; billing uses per lot × assigned lots
                        {(selectedTenancy?.extendParkingLotCount ?? 0) > 0
                          ? ` (${selectedTenancy?.extendParkingLotCount} on this lease)`
                          : ""}
                        ; proration still applies when dates fall mid-cycle. Use 0 if none.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input
                    type="number"
                    value={changeParking}
                    onChange={(e) => setChangeParking(e.target.value)}
                    className={cn(
                      tenancyMoneyFieldDirty(changeParking, changeFieldBaselineRef.current.parking) && TENANCY_DIALOG_MODIFIED_INPUT_CLASS
                    )}
                  />
                  {(selectedTenancy?.extendParkingLotCount ?? 0) > 1 ? (
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      {selectedTenancy?.extendParkingLotCount} lots — combined monthly parking before proration ≈ {currencySymbol}{" "}
                      {Number.isFinite(parseFloat(changeParking))
                        ? (parseFloat(changeParking) * (selectedTenancy?.extendParkingLotCount ?? 0)).toFixed(2)
                        : "—"}
                      .
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <Card className="border-border shadow-none">
            <CardHeader className="py-3 pb-2">
              <CardTitle className="text-base">Summary</CardTitle>
              <p className="text-xs text-muted-foreground font-normal">
                One-time charges on the move date plus <span className="font-medium text-foreground">rent and parking</span>:{" "}
                <span className="font-medium text-foreground">old monthly amounts</span> for nights before the first day at new rent / new rate (prior room where applicable), then{" "}
                <span className="font-medium text-foreground">your entered rent and parking</span> through check-out (same billing rules as{" "}
                <Link href="/operator/booking" className="underline underline-offset-2">
                  New booking
                </Link>
                ).
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm pt-0">
              {!changeRoomId || changeRoomId === selectedTenancy?.roomId ? (
                <p className="text-xs text-muted-foreground py-2">Select a new room to preview invoice lines.</p>
              ) : changeRoomPreviewLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
                  <Loader2 className="animate-spin size-4 shrink-0" />
                  Calculating invoices…
                </div>
              ) : changeRoomPreviewError ? (
                <p className="text-xs text-destructive">{changeRoomPreviewError}</p>
              ) : !changeRoomPreview ? (
                <p className="text-xs text-muted-foreground">
                  Enter move date, check-out, and new rent
                  {selectedTenancy?.extendHasParkingFees ? ", parking" : ""} to preview lines.
                </p>
              ) : (
                <>
                  {changeRoomPreview.billingInvoiceDateHint ? (
                    <p className="text-[11px] text-muted-foreground border border-dashed border-border rounded-md px-3 py-2 bg-muted/20">
                      {changeRoomPreview.billingInvoiceDateHint}
                    </p>
                  ) : null}
                  {changeRoomPreview.changeRoomRentNetting?.applied ? (
                    <p className="text-[11px] text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/15">
                      Move month ({changeRoomPreview.changeRoomRentNetting.monthLabel}) rent was already partially or fully paid (
                      {currencySymbol}
                      {changeRoomPreview.changeRoomRentNetting.paidCredit.toFixed(2)}). Recurring rent lines for that month are
                      netted: gross {currencySymbol}
                      {changeRoomPreview.changeRoomRentNetting.gross.toFixed(2)} → top-up{" "}
                      {currencySymbol}
                      {changeRoomPreview.changeRoomRentNetting.net.toFixed(2)}.
                    </p>
                  ) : null}
                  {changeRoomPreview.changeRoomParkingNetting?.applied ? (
                    <p className="text-[11px] text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/15">
                      Move month parking: paid {currencySymbol}
                      {changeRoomPreview.changeRoomParkingNetting.paidCredit.toFixed(2)} this month — gross{" "}
                      {currencySymbol}
                      {changeRoomPreview.changeRoomParkingNetting.gross.toFixed(2)}, top-up{" "}
                      {currencySymbol}
                      {changeRoomPreview.changeRoomParkingNetting.net.toFixed(2)}.
                    </p>
                  ) : null}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">One-time (change room)</p>
                    <div className="space-y-2 border border-border rounded-md divide-y divide-border">
                      {(changeRoomPreview.oneTimeRows?.length ?? 0) === 0 ? (
                        <div className="px-3 py-2 text-muted-foreground text-xs">No deposit top-up or agreement fee.</div>
                      ) : (
                        changeRoomPreview.oneTimeRows!.map((row) => (
                          <div key={row.key} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                            <div>
                              <span className="text-foreground">{row.label}</span>
                              {row.sub ? <span className="block text-xs text-muted-foreground">{row.sub}</span> : null}
                            </div>
                            <span className="font-medium tabular-nums sm:text-right">
                              {currencySymbol} {row.amount.toFixed(2)}
                            </span>
                          </div>
                        ))
                      )}
                      <div className="px-3 py-2 flex justify-between bg-muted/50 font-medium text-xs">
                        <span>Subtotal</span>
                        <span className="tabular-nums">
                          {currencySymbol} {(changeRoomPreview.oneTimeSubtotal ?? 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Rent + parking (change room)</p>
                    {(changeRoomPreview.recurringRows?.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2">
                        No rent or parking segments for this change (check dates, amounts, or Company Settings billing type).
                      </p>
                    ) : (
                      <div className="space-y-2 border border-border rounded-md divide-y divide-border">
                        {changeRoomPreview.recurringRows!.map((row) => {
                          const monthlyHint = recurringRowRateMonthlyHint(row.key, changeRoomPreview.rateSummary, currencySymbol)
                          return (
                            <div key={row.key} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                              <div className="min-w-0">
                                <span className="text-foreground">{row.label}</span>
                                {row.sub ? <span className="block text-xs text-muted-foreground">{row.sub}</span> : null}
                                {row.formula ? (
                                  <span className="block text-[11px] text-muted-foreground font-mono tabular-nums mt-1 break-all">
                                    {row.formula}
                                  </span>
                                ) : null}
                              </div>
                              <div className="font-medium tabular-nums sm:text-right shrink-0 flex flex-col items-end gap-0.5">
                                <span>
                                  {currencySymbol} {row.amount.toFixed(2)}
                                </span>
                                {monthlyHint ? (
                                  <span className="text-[11px] text-muted-foreground font-normal font-sans leading-snug max-w-[16rem]">
                                    {monthlyHint}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                        <div className="px-3 py-2 flex justify-between bg-muted/50 font-medium text-xs">
                          <span>Subtotal</span>
                          <span className="tabular-nums">
                            {currencySymbol} {(changeRoomPreview.recurringSubtotal ?? 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t-2 border-border">
                    <span className="text-sm font-semibold text-foreground">Total (new / adjusted billing)</span>
                    <span className="text-base font-bold tabular-nums" style={{ color: "var(--brand)" }}>
                      {currencySymbol} {(changeRoomPreview.total ?? 0).toFixed(2)}
                    </span>
                  </div>
                  {changeRoomPreview.moveFirstDayYmd && changeRoomPreview.newEndYmd ? (
                    <p className="text-[11px] text-muted-foreground">
                      First day at new rent: {changeRoomPreview.moveFirstDayYmd}
                      {changeRoomPreview.lastNightOnOldRateYmd
                        ? `. Last night on old rate: ${changeRoomPreview.lastNightOnOldRateYmd}.`
                        : ""}{" "}
                      Check-out: {changeRoomPreview.newEndYmd}. Invoice dates follow Company Settings.
                    </p>
                  ) : null}
                  {(changeRoomPreview.skippedPaidInvoiceYmds?.length ?? 0) > 0 ? (
                    <p className="text-[11px] text-amber-700 dark:text-amber-500">
                      Some invoice dates after the move already have paid rows — those lines are not recreated (matches confirm behavior).
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChangeRoomDialog(false)} disabled={changeSubmitting}>
              Cancel
            </Button>
            <Button
              style={{ background: "var(--brand)" }}
              className={changeSubmitting ? "inline-flex items-center gap-2" : undefined}
              onClick={handleChangeRoomSubmit}
              disabled={
                !changeRoomId ||
                !changeDate ||
                !changeCheckOut ||
                !changeRent ||
                changeRoomId === selectedTenancy?.roomId ||
                changeSubmitting ||
                (selectedTenancy?.extendHasParkingFees === true &&
                  (changeParking.trim() === "" ||
                    Number.isNaN(parseFloat(changeParking)) ||
                    parseFloat(changeParking) < 0))
              }
            >
              {changeSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin shrink-0" />
                  Processing…
                </>
              ) : (
                "Confirm Change"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showChangeRoomCheckoutWarning} onOpenChange={setShowChangeRoomCheckoutWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm check-out date</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Your rental invoices use <strong className="text-foreground">first day of every month</strong> (Company
                  Settings). The check-out date <strong className="text-foreground">{changeCheckOut}</strong> is not the{" "}
                  <strong className="text-foreground">last day of a calendar month</strong>, so the final month will be{" "}
                  <strong className="text-foreground">prorated</strong> in billing.
                </p>
                <p>Continue with this room change and check-out date?</p>
                {changeRoomPreview &&
                (changeRoomPreview.total != null || (changeRoomPreview.recurringRows?.length ?? 0) > 0) ? (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-foreground space-y-1">
                    <p className="text-xs font-semibold">Invoice preview (same as Summary above)</p>
                    <p className="text-xs tabular-nums">
                      Total <span className="font-bold">{currencySymbol} {(changeRoomPreview.total ?? 0).toFixed(2)}</span>
                      {" · "}
                      {(changeRoomPreview.recurringRows?.length ?? 0) + (changeRoomPreview.oneTimeRows?.length ?? 0)} line(s)
                    </p>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <Button
              style={{ background: "var(--brand)" }}
              type="button"
              onClick={() => {
                setShowChangeRoomCheckoutWarning(false)
                void runChangeRoomSubmit()
              }}
            >
              Confirm change room
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Terminate Tenancy Dialog */}
      <Dialog open={showTerminateDialog} onOpenChange={setShowTerminateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Terminate Tenancy</DialogTitle>
            <DialogDescription>
              End tenancy for {selectedTenancy?.tenant} in {selectedTenancy?.room}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive font-medium">Warning: This action cannot be undone</p>
              <p className="text-xs text-muted-foreground mt-1">
                {terminateSkipRefund
                  ? "Tenant will be notified. No deposit refund will be created because no paid deposit is recorded (grace period / unpaid deposit)."
                  : "The tenant will be notified and deposit refund will be processed."}
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Deposit Held: {currencySymbol} {terminateDepositValue.toLocaleString()}</label>
              <p className="text-xs text-muted-foreground mt-1">Paid Deposit: {currencySymbol} {terminatePaidDepositValue.toLocaleString()}</p>
              {terminateContextLoading && <p className="text-xs text-muted-foreground mt-1">Refreshing deposit from tenancy record...</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Forfeit Amount ({currencyCode})</label>
              <Input
                type="number"
                value={terminateForfeit}
                onChange={(e) => setTerminateForfeit(e.target.value)}
                placeholder="Amount to deduct from deposit"
                max={terminateRefundBase}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Refund amount: {currencySymbol} {terminateRefundAmount.toLocaleString()}
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Termination Reason</label>
              <textarea
                value={terminateReason}
                onChange={(e) => setTerminateReason(e.target.value)}
                placeholder="Optional: reason for termination"
                rows={2}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground resize-none"
              />
            </div>
            {uploadingHandover && <p className="text-xs text-muted-foreground">Uploading handover files...</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTerminateDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleTerminateSubmit} disabled={terminateSubmitting}>
              {terminateSubmitting ? "Terminating..." : "Confirm Terminate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Tenancy — wide panel (inline maxWidth overrides DialogContent default sm:max-w-lg) */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          style={{
            width: "min(95vw, calc(100% - 2rem))",
            maxWidth: "min(95vw, 1400px)",
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit Tenancy</DialogTitle>
            <DialogDescription>
              Update details for {selectedTenancy?.tenant} in {selectedTenancy?.room}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Tenant</label>
              <Input value={selectedTenancy?.tenant || ""} disabled />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Room</label>
              <Input value={selectedTenancy?.room || ""} disabled />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Rent ({currencyCode}) (read-only)</label>
                <Input type="number" value={editRent} disabled className="disabled:cursor-not-allowed disabled:opacity-80 disabled:bg-muted" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Deposit ({currencyCode}) (read-only)</label>
                <Input type="number" value={editDeposit} disabled className="disabled:cursor-not-allowed disabled:opacity-80 disabled:bg-muted" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                Check-out Date
                {selectedTenancy && !editLeaseEndEditable ? (
                  <span className="font-normal text-muted-foreground"> (read-only — use Extend)</span>
                ) : null}
              </label>
              <input
                type="date"
                value={editCheckOut}
                onChange={(e) => setEditCheckOut(e.target.value)}
                disabled={!editLeaseEndEditable}
                tabIndex={editLeaseEndEditable ? undefined : -1}
                className={cn(
                  "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground",
                  "disabled:cursor-not-allowed disabled:opacity-80 disabled:bg-muted",
                  !editLeaseEndEditable && "pointer-events-none",
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                  Handover Check-in Date & Time
                  {selectedTenancy && isCheckinHandoverComplete(selectedTenancy) ? (
                    <span className="font-normal text-muted-foreground"> (locked)</span>
                  ) : null}
                </label>
                <input
                  type="datetime-local"
                  value={editHandoverCheckinAt}
                  onChange={(e) => setEditHandoverCheckinAt(e.target.value)}
                  disabled={selectedTenancy ? isCheckinHandoverComplete(selectedTenancy) : false}
                  className={cn(
                    "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm",
                    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                    "disabled:cursor-not-allowed disabled:opacity-80 disabled:bg-muted",
                  )}
                />
                {selectedTenancy && isCheckinHandoverComplete(selectedTenancy) ? (
                  <p className="text-[11px] text-muted-foreground mt-1">Check-in handover is done — this time cannot be changed.</p>
                ) : null}
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                  Handover Check-out Date & Time
                  {selectedTenancy && isCheckoutHandoverComplete(selectedTenancy) ? (
                    <span className="font-normal text-muted-foreground"> (locked)</span>
                  ) : selectedTenancy && !canEditCheckoutSchedule(selectedTenancy) ? (
                    <span className="font-normal text-muted-foreground"> (not editable yet)</span>
                  ) : null}
                </label>
                <input
                  type="datetime-local"
                  value={editHandoverCheckoutAt}
                  onChange={(e) => setEditHandoverCheckoutAt(e.target.value)}
                  disabled={
                    selectedTenancy
                      ? isCheckoutHandoverComplete(selectedTenancy) || !canEditCheckoutSchedule(selectedTenancy)
                      : false
                  }
                  className={cn(
                    "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm",
                    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                    "disabled:cursor-not-allowed disabled:opacity-80 disabled:bg-muted",
                  )}
                />
                {selectedTenancy && isCheckoutHandoverComplete(selectedTenancy) ? (
                  <p className="text-[11px] text-muted-foreground mt-1">Check-out handover is done — this time cannot be changed.</p>
                ) : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleEditSubmit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Booking confirm */}
      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel Booking</DialogTitle>
            <DialogDescription>Confirm delete this pending booking? This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>Back</Button>
            <Button variant="destructive" onClick={handleCancelBookingConfirm}>Confirm Delete Booking</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Tenancy Agreement dialog */}
      <Dialog open={showCreateAgreementBox} onOpenChange={setShowCreateAgreementBox}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Tenancy Agreement</DialogTitle>
            <DialogDescription>
              {selectedTenancy ? `${selectedTenancy.tenant} – ${selectedTenancy.room}` : ""}
            </DialogDescription>
          </DialogHeader>
          {createAgreementStep === "choice" && (
            <div className="flex flex-col gap-2 py-2">
              <Button variant="outline" className="justify-start" onClick={() => setCreateAgreementStep("template")}>
                Create by template
              </Button>
              <Button variant="outline" className="justify-start" onClick={() => setCreateAgreementStep("manual")}>
                Manual upload agreement
              </Button>
            </div>
          )}
          {createAgreementStep === "manual" && (
            <div className="space-y-4 py-2">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Mode</label>
                <Select value={agreementMode} onValueChange={setAgreementMode}>
                  <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner_tenant">Owner & Tenant (Tenancy)</SelectItem>
                    <SelectItem value="tenant_operator">Tenant & Operator (Tenancy)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Agreement URL *</label>
                <Input value={agreementUrl} onChange={(e) => setAgreementUrl(e.target.value)} placeholder="https://..." />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateAgreementStep("choice")}>Back</Button>
                <Button style={{ background: "var(--brand)" }} onClick={handleCreateAgreementSubmit} disabled={!canSubmitAgreement || agreementSubmitting}>
                  {agreementSubmitting ? "Loading…" : "Submit"}
                </Button>
              </DialogFooter>
            </div>
          )}
          {createAgreementStep === "template" && (
            <div className="space-y-4 py-2">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Mode</label>
                <Select value={agreementMode} onValueChange={setAgreementMode}>
                  <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner_tenant">Owner & Tenant (Tenancy)</SelectItem>
                    <SelectItem value="tenant_operator">Tenant & Operator (Tenancy)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Template</label>
                <Select value={agreementTemplateId} onValueChange={setAgreementTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                  <SelectContent>
                    {agreementTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.title ?? t.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Start From</label>
                  <input type="date" value={agreementExtendBegin} onChange={(e) => setAgreementExtendBegin(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">End on</label>
                  <input type="date" value={agreementExtendEnd} onChange={(e) => setAgreementExtendEnd(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              {selectedTenancy && (agreementExtendBegin !== selectedTenancy.checkIn || agreementExtendEnd !== selectedTenancy.checkOut) && (
                <div className="rounded-lg bg-muted/60 border border-border p-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Hint:</span> The agreement dates you entered do not match this tenancy’s period. You can still create the agreement.
                </div>
              )}
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={agreementConfirmCredit} onChange={(e) => setAgreementConfirmCredit(e.target.checked)} />
                  {agreementTemplateCreditCost <= 0
                    ? "I confirm creating this agreement from the template (no platform credits will be deducted for this client)."
                    : `I confirm that ${agreementTemplateCreditCost} platform credit(s) will be deducted for this agreement.`}
                </label>
                {agreementTemplateCreditCost > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Your balance: <strong className="text-foreground">{creditBalance}</strong> credits
                  </p>
                ) : null}
              </div>
              {insufficientCreditForTenancyAgreement ? (
                <div className="rounded-lg bg-destructive/10 border border-destructive/25 px-3 py-2 text-sm text-destructive">
                  Not enough credits — need at least {agreementTemplateCreditCost} (you have {creditBalance}). Top up on the Credit page or use manual upload
                  (no deduction).
                </div>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateAgreementStep("choice")}>Back</Button>
                <Button style={{ background: "var(--brand)" }} onClick={handleCreateAgreementSubmit} disabled={!canSubmitAgreement || agreementSubmitting}>
                  {agreementSubmitting ? "Loading…" : "Confirm"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Submit Tenant Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit Tenant Review</DialogTitle>
            <DialogDescription>
              {selectedTenancy ? `${selectedTenancy.tenant} – ${selectedTenancy.property} / ${selectedTenancy.room}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-3">
              <StarRating
                label="Rental payment punctuality"
                value={Math.max(1, Math.min(10, Number(paymentScoreSuggested || 1)))}
                onChange={(v) => setPaymentScoreSuggested(String(v))}
              />
              <StarRating
                label="Unit is well cared for"
                value={Math.max(1, Math.min(10, Number(unitCareScore || 1)))}
                onChange={(v) => setUnitCareScore(String(v))}
              />
              <StarRating
                label="Easy to communicate with"
                value={Math.max(1, Math.min(10, Number(communicationScore || 1)))}
                onChange={(v) => setCommunicationScore(String(v))}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-2">Badge</label>
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={reviewBadges.blacklist}
                    onChange={(e) => setReviewBadges((prev) => ({ ...prev, blacklist: e.target.checked }))}
                  />
                  Blacklist
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={reviewBadges.five_star_tenant}
                    onChange={(e) => setReviewBadges((prev) => ({ ...prev, five_star_tenant: e.target.checked }))}
                  />
                  5-star Tenant
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={reviewBadges.payment_delay}
                    onChange={(e) => setReviewBadges((prev) => ({ ...prev, payment_delay: e.target.checked }))}
                  />
                  Payment Delay
                </label>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Review input</label>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                rows={3}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground resize-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Evidence upload (photo & video)</label>
              <div className="space-y-2">
                <input
                  ref={evidenceInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  disabled={uploadingEvidence || reviewEvidenceUrls.length >= 30}
                  onChange={(e) => handleEvidenceUpload(e.target.files)}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploadingEvidence || reviewEvidenceUrls.length >= 30}
                  onClick={() => evidenceInputRef.current?.click()}
                >
                  {uploadingEvidence ? "Uploading..." : "Upload Photo / Video"}
                </Button>
                {reviewEvidenceUrls.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {reviewEvidenceUrls.map((u, idx) => (
                      <div key={`${u}-${idx}`} className="relative rounded-md border overflow-hidden bg-muted/40">
                        {isLikelyVideoUrl(u) ? (
                          <video src={u} className="w-full h-24 object-cover" controls />
                        ) : (
                          <img src={u} alt={`evidence-${idx + 1}`} className="w-full h-24 object-cover" />
                        )}
                        <button
                          type="button"
                          className="absolute top-1 right-1 text-xs bg-black/70 text-white rounded px-1"
                          onClick={() => setReviewEvidenceUrls((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          X
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewDialog(false)}>Cancel</Button>
            <Button
              style={{ background: "var(--brand)" }}
              onClick={handleReviewSubmit}
              disabled={
                submittingReview ||
                (selectedTenancy != null && !canSubmitTenantReview(selectedTenancy))
              }
            >
              {submittingReview ? "Submitting..." : (editingReviewId ? "Update Review" : "Submit Review")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Details Dialog — includes tenant contact & bank from tenantdetail */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="space-y-1">
            {selectedTenancy?.id ? (
              <p className="text-[10px] leading-tight text-muted-foreground font-mono select-all">
                id: {selectedTenancy.id}
              </p>
            ) : null}
            <DialogTitle>Tenancy Details</DialogTitle>
            <DialogDescription>Lease summary and tenant contact on file.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[75vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Tenant</p>
                <p className="font-semibold">{selectedTenancy?.tenant}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge className={STATUS_STYLES[selectedTenancy?.status || "Active"]}>{selectedTenancy?.status}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Property</p>
                <p className="font-medium">{selectedTenancy?.property}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Room</p>
                <p className="font-medium">{selectedTenancy?.room}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Check-in</p>
                <p className="font-medium">{selectedTenancy?.checkIn}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Check-out</p>
                <p className="font-medium">{selectedTenancy?.checkOut}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Monthly Rent</p>
                <p className="font-semibold">{currencySymbol} {selectedTenancy?.rent?.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Deposit Held</p>
                <p className="font-semibold">{currencySymbol} {selectedTenancy?.deposit?.toLocaleString()}</p>
              </div>
            </div>
            <div className="border-t border-border pt-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant contact &amp; bank</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="font-medium break-all">{selectedTenancy?.tenantEmail?.trim() ? selectedTenancy.tenantEmail : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p className="font-medium">{selectedTenancy?.tenantPhone?.trim() ? selectedTenancy.tenantPhone : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Bank name</p>
                  <p className="font-medium">{selectedTenancy?.tenantBankName?.trim() ? selectedTenancy.tenantBankName : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Account holder</p>
                  <p className="font-medium break-words">{selectedTenancy?.tenantAccountHolder?.trim() ? selectedTenancy.tenantAccountHolder : "—"}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground">Bank account no.</p>
                  <p className="font-medium break-all">{selectedTenancy?.tenantBankAccount?.trim() ? selectedTenancy.tenantBankAccount : "—"}</p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="flex flex-wrap gap-2 justify-end">
            <Button
              type="button"
              className="gap-2"
              style={{ background: "var(--brand)" }}
              disabled={!selectedTenancy?.tenantId}
              title={!selectedTenancy?.tenantId ? "No tenant linked" : undefined}
              onClick={() => {
                const id = selectedTenancy?.tenantId
                if (!id) return
                window.open(`/profile/${id}`, "_blank", "noopener,noreferrer")
              }}
            >
              <ExternalLink size={14} />
              View Tenant Profile
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowDetailDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!agreementsListTenancy}
        onOpenChange={(open) => {
          if (!open) setAgreementsListTenancy(null)
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Tenancy agreements</DialogTitle>
            <DialogDescription>
              {agreementsListTenancy?.tenant} — {agreementsListTenancy?.property} / {agreementsListTenancy?.room}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1 overflow-y-auto min-h-0 flex-1 pr-1">
            {sortAgreementsNewestFirst(agreementsListTenancy?.agreements ?? []).map((a, idx) => {
              const url = (a.url != null ? String(a.url).trim() : "") || ""
              const st = (a.status != null ? String(a.status) : "").trim() || "—"
              const mode = (a.mode != null ? String(a.mode).trim() : "") || "—"
              const idShort = a._id ? `${a._id.slice(0, 8)}…` : `#${idx + 1}`
              const created = a._createdDate
                ? !Number.isNaN(new Date(a._createdDate).getTime())
                  ? new Date(a._createdDate).toLocaleString()
                  : String(a._createdDate)
                : "—"
              const extBegin = a.extend_begin_date?.trim() || "—"
              const extEnd = a.extend_end_date?.trim() || "—"
              return (
                <div
                  key={a._id || `agreement-${idx}`}
                  className="rounded-lg border border-border p-3 space-y-2 text-sm bg-muted/30"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground">{idShort}</p>
                      <p className="text-xs text-muted-foreground font-mono break-all">{a._id || "—"}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {a.pdf_generating ? (
                        <Badge variant="secondary" className="text-xs">
                          Generating PDF
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="text-xs capitalize">
                        {st}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {mode}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground/80">Created</span> {created}
                    </p>
                    <p>
                      <span className="font-medium text-foreground/80">Finalized</span>{" "}
                      {a.hash_final ? "Yes" : "—"}
                    </p>
                    <p className="sm:col-span-2">
                      <span className="font-medium text-foreground/80">Extend period</span> {extBegin} → {extEnd}
                    </p>
                  </div>
                  <div className="pt-1">
                    {url ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                      >
                        <ExternalLink size={14} />
                        Open PDF
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">No PDF URL on file yet.</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAgreementsListTenancy(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHandoverDialog} onOpenChange={setShowHandoverDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Handover Details</DialogTitle>
            <DialogDescription>
              {selectedTenancy?.tenant} - {selectedTenancy?.property} / {selectedTenancy?.room}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2 max-h-[70vh] overflow-y-auto">
            {([
              { key: "checkin", label: "Check-in Handover", data: selectedTenancy?.handoverCheckin, schedule: selectedTenancy?.handoverCheckinAt },
              { key: "checkout", label: "Check-out Handover", data: selectedTenancy?.handoverCheckout, schedule: selectedTenancy?.handoverCheckoutAt },
            ] as const).map((section) => {
              const photos = [...(section.data?.handoverCardPhotos || []), ...(section.data?.unitPhotos || [])]
              const sign = section.data?.tenantSignatureUrl || ""
              const hasAny = photos.length > 0 || !!sign
              return (
                <div key={section.key} className="border border-border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">{section.label}</p>
                    <Badge variant="outline">{hasAny ? "Submitted" : "Pending"}</Badge>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <p>Scheduled: {section.schedule || section.data?.scheduledAt || "—"}</p>
                    <p>Captured: {section.data?.capturedAt || "—"}</p>
                  </div>
                  {hasAny ? (
                    <div className="space-y-3">
                      {photos.length ? (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1.5">Photos — click to enlarge</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {photos.map((url, idx) => (
                              <button
                                key={`${section.key}-p-${idx}`}
                                type="button"
                                className="relative block w-full overflow-hidden rounded-md border border-border text-left cursor-zoom-in group"
                                onClick={() => setPreviewImageUrl(url)}
                              >
                                <img src={handoverPreviewImgSrc(url)} alt={`${section.label} photo ${idx + 1}`} className="w-full h-24 object-cover pointer-events-none" />
                                <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                  Enlarge
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {sign ? (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1.5">Tenant Signature — click to enlarge</p>
                          <button
                            type="button"
                            className="inline-block cursor-zoom-in rounded-md border border-border bg-muted/20 px-2"
                            onClick={() => setPreviewImageUrl(sign)}
                          >
                            <img src={handoverPreviewImgSrc(sign)} alt={`${section.label} signature`} className="h-24 max-w-full object-contain pointer-events-none" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No handover files uploaded yet.</p>
                  )}
                </div>
              )
            })}
            <div className="border border-border rounded-lg p-3 space-y-2">
              <p className="font-semibold text-sm">Handover appointment time — change history</p>
              <p className="text-xs text-muted-foreground">
                Each time the <strong>tenant</strong> (portal) or <strong>staff</strong> (Edit Tenancy) changes the scheduled check-in / check-out time, a row is recorded below.
              </p>
              {handoverScheduleLogLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : handoverScheduleLog.length === 0 ? (
                <p className="text-xs text-muted-foreground">No schedule changes recorded yet.</p>
              ) : (
                <div className="overflow-x-auto max-h-52 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                        <th className="py-1.5 px-2">When</th>
                        <th className="py-1.5 px-2">Field</th>
                        <th className="py-1.5 px-2">From → To</th>
                        <th className="py-1.5 px-2">Who</th>
                      </tr>
                    </thead>
                    <tbody>
                      {handoverScheduleLog.map((row) => (
                        <tr key={row.id} className="border-b border-border/60">
                          <td className="py-1.5 px-2 whitespace-nowrap align-top">{new Date(row.createdAt).toLocaleString()}</td>
                          <td className="py-1.5 px-2 align-top">{row.fieldName === "checkin" ? "Check-in" : "Check-out"}</td>
                          <td className="py-1.5 px-2 align-top break-all">
                            {row.oldValue || "—"} → {row.newValue || "—"}
                          </td>
                          <td className="py-1.5 px-2 align-top">
                            <span className="font-medium">{row.actorType === "tenant" ? "Tenant" : "Staff"}</span>
                            {row.actorEmail ? (
                              <span className="block text-muted-foreground break-all">{row.actorEmail}</span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHandoverDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHandoverFlowDialog} onOpenChange={setShowHandoverFlowDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{handoverFlowKind === "checkout" ? "Check-out handover" : "Check-in handover"}</DialogTitle>
            <DialogDescription>
              {handoverFlowKind === "checkout"
                ? "On-site at move-out: upload photos (preview below), then tenant signs. Submit when check-out handover is complete."
                : "On-site: upload photos (preview below), then tenant signs in the box. Submit when check-in is complete."}
              {selectedTenancy ? ` — ${selectedTenancy.tenant} / ${selectedTenancy.room}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[min(70vh,560px)] overflow-y-auto">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Handover card photos *</label>
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => void uploadCheckinHandoverFiles(e.target.files, "card")}
              />
              {checkinCardUrls.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-2">
                  {checkinCardUrls.map((url, i) => (
                    <div
                      key={`card-${i}-${url.slice(0, 24)}`}
                      className="relative w-[112px] h-[112px] shrink-0 cursor-zoom-in rounded-md border border-border overflow-hidden bg-muted/30 group"
                      onClick={() => setPreviewImageUrl(url)}
                      title="Click to enlarge"
                    >
                      <img src={handoverPreviewImgSrc(url)} alt="" className="h-full w-full object-cover pointer-events-none" />
                      <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-[1] inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white shadow-sm">
                        <ZoomIn className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <button
                        type="button"
                        className="absolute top-0.5 right-0.5 z-[2] h-6 w-6 rounded-full bg-background/90 border border-border text-xs font-bold leading-none shadow-sm opacity-90 hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          setCheckinCardUrls((p) => {
                            const removed = p[i]
                            const next = p.filter((_, j) => j !== i)
                            if (removed?.startsWith("blob:")) URL.revokeObjectURL(removed)
                            return next
                          })
                        }}
                        aria-label="Remove photo"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">No photos yet</p>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Unit onsite photos *</label>
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => void uploadCheckinHandoverFiles(e.target.files, "unit")}
              />
              {checkinUnitUrls.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-2">
                  {checkinUnitUrls.map((url, i) => (
                    <div
                      key={`unit-${i}-${url.slice(0, 24)}`}
                      className="relative w-[112px] h-[112px] shrink-0 cursor-zoom-in rounded-md border border-border overflow-hidden bg-muted/30 group"
                      onClick={() => setPreviewImageUrl(url)}
                      title="Click to enlarge"
                    >
                      <img src={handoverPreviewImgSrc(url)} alt="" className="h-full w-full object-cover pointer-events-none" />
                      <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-[1] inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white shadow-sm">
                        <ZoomIn className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <button
                        type="button"
                        className="absolute top-0.5 right-0.5 z-[2] h-6 w-6 rounded-full bg-background/90 border border-border text-xs font-bold leading-none shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setCheckinUnitUrls((p) => {
                            const removed = p[i]
                            const next = p.filter((_, j) => j !== i)
                            if (removed?.startsWith("blob:")) URL.revokeObjectURL(removed)
                            return next
                          })
                        }}
                        aria-label="Remove photo"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">No photos yet</p>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Tenant signature *</label>
              <p className="text-xs text-muted-foreground mb-2">Sign with finger (mobile) or mouse — not typing.</p>
              <div className="rounded-lg border-2 border-dashed border-border bg-white overflow-hidden touch-none">
                <canvas
                  ref={checkinSignatureCanvasRef}
                  className="w-full h-[160px] block cursor-crosshair touch-none select-none"
                  style={{ maxWidth: "100%" }}
                  onPointerDown={onCheckinSignaturePointerDown}
                  onPointerMove={onCheckinSignaturePointerMove}
                  onPointerUp={onCheckinSignaturePointerUp}
                  onPointerCancel={onCheckinSignaturePointerUp}
                />
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={clearCheckinSignature}>
                Clear signature
              </Button>
            </div>
            {uploadingCheckinHandover && <p className="text-xs text-muted-foreground">Uploading photos…</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHandoverFlowDialog(false)}>Cancel</Button>
            <Button
              style={{ background: "var(--brand)" }}
              onClick={() => void handleHandoverFlowSubmit()}
              disabled={
                savingCheckinHandover ||
                uploadingCheckinHandover ||
                checkinCardUrls.length === 0 ||
                checkinUnitUrls.length === 0 ||
                !hasCheckinSignatureInk
              }
            >
              {savingCheckinHandover ? "Saving…" : handoverFlowKind === "checkout" ? "Submit — check-out complete" : "Submit — handover complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {previewImageUrl != null && typeof document !== "undefined"
        ? createPortal(
            <DismissableLayerBranch
              className="pointer-events-auto fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 p-3 sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-label="Image preview"
              onClick={() => setPreviewImageUrl(null)}
            >
              <button
                type="button"
                className="absolute right-3 top-3 z-[10000] flex h-10 w-10 items-center justify-center rounded-full bg-white text-foreground shadow-lg ring-1 ring-black/10 hover:bg-zinc-100"
                onClick={(e) => {
                  e.stopPropagation()
                  setPreviewImageUrl(null)
                }}
                aria-label="Close preview"
              >
                <X className="h-5 w-5" />
              </button>
              <div
                className="flex max-h-[min(90vh,960px)] w-full max-w-[min(96vw,1280px)] flex-col items-center justify-center overflow-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={handoverPreviewImgSrc(previewImageUrl)}
                  alt=""
                  className="h-auto max-h-[min(88vh,920px)] w-auto max-w-full rounded-md object-contain shadow-lg"
                />
                {!previewImageUrl.startsWith("blob:") ? (
                  <p className="mt-4 text-center">
                    <a
                      href={previewImageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-white/90 underline underline-offset-2 hover:text-white"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open original in new tab
                    </a>
                  </p>
                ) : null}
                <p className="mt-3 text-center text-xs text-white/70">Click backdrop or × to close · Esc</p>
              </div>
            </DismissableLayerBranch>,
            document.body,
          )
        : null}
    </main>
  )
}
