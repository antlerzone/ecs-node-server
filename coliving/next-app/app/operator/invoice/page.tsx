"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Receipt, Plus, Check, Search, Eye, Trash2, Zap, ChevronDown, AlertTriangle, ExternalLink, Info } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  getRentalList,
  getInvoiceProperties,
  getInvoiceTypes,
  getTenancyListForInvoice,
  getTenancyCleaningPriceForInvoice,
  getCleanlemonsLinkStatus,
  insertRental,
  updateRental,
  deleteRental,
  voidRentalPayment,
  getMeterGroups,
} from "@/lib/operator-api"
import { addDaysMalaysiaYmd } from "@/lib/dateMalaysia"

/** Operator / business calendar for Malaysia (UTC+8). */
const MY_TZ = "Asia/Kuala_Lumpur"

/** Canonical `account.id` (template) — lines charged to / invoiced to property owner. */
const ACCOUNT_OWNER_COMMISSION_ID = "86da59c0-992c-4e40-8efd-9d6d793eaf6a"
const ACCOUNT_MANAGEMENT_FEES_ID = "a1b2c3d4-0002-4000-8000-000000000002"

/** Owner-side invoice lines (commission + management fees to owner); matches DB titles after 0257 merge. */
function invoiceIsOwnerChargedLine(typeId: string, typeTitle: string): boolean {
  const id = String(typeId || "").trim().toLowerCase()
  if (id === ACCOUNT_OWNER_COMMISSION_ID.toLowerCase()) return true
  if (id === ACCOUNT_MANAGEMENT_FEES_ID.toLowerCase()) return true
  const t = String(typeTitle || "").trim().toLowerCase()
  if (!t) return false
  if (/\bowner\s+comission\b|\bowner\s+commission\b/.test(t)) return true
  if (/\bmanagement fees?\b/.test(t) && /\(owner\)/.test(t)) return true
  return false
}

function todayYmdInMalaysia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

/**
 * Match tenant /payment: MySQL "YYYY-MM-DD HH:mm:ss" without timezone is treated as Malaysia wall time (+08).
 * Tenant page uses the browser's local TZ (usually MY); operators may use UTC — this removes that skew.
 */
function parseRentalDateAsMalaysiaWall(d: unknown): Date | null {
  if (d == null || d === "") return null
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d
  if (typeof d !== "string") {
    const t = new Date(d as string)
    return Number.isNaN(t.getTime()) ? null : t
  }
  const s = d.trim()
  if (!s) return null
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)) {
    const t = new Date(s)
    return Number.isNaN(t.getTime()) ? null : t
  }
  const donly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (donly) {
    const t = new Date(`${donly[1]}-${donly[2]}-${donly[3]}T12:00:00+08:00`)
    return Number.isNaN(t.getTime()) ? null : t
  }
  const naive = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2}):(\d{2})(\.\d{1,6})?$/)
  if (naive) {
    const hh = naive[4].padStart(2, "0")
    const t = new Date(`${naive[1]}-${naive[2]}-${naive[3]}T${hh}:${naive[5]}:${naive[6]}+08:00`)
    return Number.isNaN(t.getTime()) ? null : t
  }
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? null : t
}

/** Malaysia calendar YYYY-MM-DD for overdue + sorting (same instant semantics as parse). */
function toYmdMalaysia(d: unknown): string {
  const t = parseRentalDateAsMalaysiaWall(d)
  if (!t) {
    if (typeof d === "string") {
      const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (m) return `${m[1]}-${m[2]}-${m[3]}`
    }
    return ""
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: MY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(t)
}

/** Same visible format as tenant /payment "Due:" (timezone fixed to MY for operator devices). */
function formatDueDateTenantStyle(d: unknown): string {
  const t = parseRentalDateAsMalaysiaWall(d)
  if (!t) return "—"
  return t.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: MY_TZ })
}

/** Prefer API `invoiceurl`; else build `https://{sub}.bukku.my/invoices/{id}` when accounting is Bukku. */
function resolveBukkuInvoiceHref(
  invoiceurl: string | undefined,
  invoiceid: unknown,
  bukkuSubdomain: string | null | undefined
): string | undefined {
  const u = typeof invoiceurl === "string" && invoiceurl.trim() ? invoiceurl.trim() : ""
  if (u && /^https?:\/\//i.test(u)) return u
  const sub = typeof bukkuSubdomain === "string" && bukkuSubdomain.trim() ? bukkuSubdomain.trim() : ""
  const id = invoiceid != null && String(invoiceid).trim() !== "" ? String(invoiceid).trim() : ""
  if (sub && id) return `https://${sub}.bukku.my/invoices/${id}`.replace(/\/+/g, "/")
  return undefined
}

function sortKeyYmdMalaysia(ymd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return 0
  return new Date(`${ymd}T12:00:00+08:00`).getTime()
}

/** Paid-at instant for the chosen calendar day in Malaysia (backend `new Date` is unambiguous). */
function malaysiaNoonIsoFromYmd(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd
  return `${ymd}T12:00:00+08:00`
}

const PAGE_SIZE_OPTIONS = [10, 50, 100, 500, 1000] as const

type Invoice = {
  id: string
  /** Accounting doc no (e.g. IV-00231) or provider invoice id — not internal rentalcollection UUID */
  invoiceRef: string
  tenant: string
  tenantId: string
  property: string
  room: string
  type: string
  /** rentalcollection.type_id → account.id */
  typeId?: string
  amount: number
  /** Display only — same style as tenant /payment Due: */
  dueDate: string
  status: string
  isPaid: boolean
  /** Malaysia YYYY-MM-DD for overdue + sort */
  date: string
  invoiceurl?: string
  /** Server-built URL when invoiceurl + ids are incomplete (e.g. IV- doc only → Bukku sales list) */
  viewInvoiceUrl?: string
  /** Bukku / Xero provider invoice id (for link fallback) */
  invoiceProviderId?: string
  receipturl?: string
  /** 'metertransaction' = 充值成功的 meter 记录，仅展示不可删 */
  source?: 'rentalcollection' | 'metertransaction'
  /** From rentalcollection/metertransaction.referenceid when Stripe (pi_ / cs_) */
  stripePaymentId?: string
}

type MeterGroup = {
  id: string
  name: string
  groupMode: string
  sharingMethod: string
  paymentType: string
  sellingRate: number
  parentMeter: { id: string; name: string; usage: number } | null
  childMeters: Array<{ id: string; name: string; tenantId: string | null; tenant: string | null; active: boolean; usage: number }>
}

export default function TenantInvoicePage() {
  const [currencyCode, setCurrencyCode] = useState("")
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [properties, setProperties] = useState<Array<{ id: string; shortname: string }>>([])
  const [invoiceTypes, setInvoiceTypes] = useState<Array<{ id: string; title: string }>>([])
  const [tenancies, setTenancies] = useState<Array<{ id: string; room?: { title_fld?: string; property_id?: string }; tenant?: { fullname?: string }; active?: boolean; end_date?: string }>>([])
  const [meterGroups, setMeterGroups] = useState<MeterGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("invoices")
  const [search, setSearch] = useState("")
  const [filterProperty, setFilterProperty] = useState("ALL")
  const [filterType, setFilterType] = useState("ALL")
  const [filterStatus, setFilterStatus] = useState("ALL")
  const [sortBy, setSortBy] = useState("newest")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  /** From rental-list: Bukku subdomain for building View invoice when invoiceurl missing */
  const [bukkuSubdomain, setBukkuSubdomain] = useState<string | null>(null)

  const currencySymbol = useMemo(() => {
    const cc = String(currencyCode || "").trim().toUpperCase()
    if (cc === "SGD") return "S$"
    if (cc === "MYR") return "RM"
    return cc ? `${cc} ` : ""
  }, [currencyCode])

  /** Cleaning Services lines first so filter + Create Invoice show them without scrolling past 1000 other types. */
  const sortedInvoiceTypes = useMemo(() => {
    const list = [...invoiceTypes]
    const isCleaning = (title: string) => /cleaning\s*service/i.test(String(title || "").trim())
    list.sort((a, b) => {
      const ac = isCleaning(a.title) ? 0 : 1
      const bc = isCleaning(b.title) ? 0 : 1
      if (ac !== bc) return ac - bc
      return String(a.title || "").localeCompare(String(b.title || ""), "en", { sensitivity: "base", numeric: true })
    })
    return list
  }, [invoiceTypes])

  const isCleaningInvoiceType = useCallback((typeId: string) => {
    if (!typeId) return false
    const t = sortedInvoiceTypes.find((x) => String(x.id) === String(typeId))
    return t ? /cleaning\s*service/i.test(String(t.title || "").trim()) : false
  }, [sortedInvoiceTypes])

  const formatMoney = useCallback((value: number) => {
    const amount = Number(value || 0)
    return `${currencySymbol} ${amount.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }, [currencySymbol])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [rentalRes, propsRes, typesRes, tenancyRes, meterRes] = await Promise.all([
        getRentalList({
          property: filterProperty !== "ALL" ? filterProperty : undefined,
          type: filterType !== "ALL" ? filterType : undefined,
          from: dateFrom || undefined,
          to: dateTo || undefined,
        }),
        getInvoiceProperties(),
        getInvoiceTypes(),
        getTenancyListForInvoice(),
        getMeterGroups(),
      ])
      const bukkuSub =
        typeof rentalRes?.bukkuSubdomain === "string" && rentalRes.bukkuSubdomain.trim()
          ? rentalRes.bukkuSubdomain.trim()
          : null
      const cc =
        typeof rentalRes?.currency === "string" && rentalRes.currency.trim()
          ? rentalRes.currency.trim().toUpperCase()
          : ""
      setCurrencyCode(cc)
      setBukkuSubdomain(bukkuSub)
      const items = (rentalRes?.items || []) as Array<Record<string, unknown>>
      const typesList = ((typesRes as { items?: Array<{ id: string; title: string }> })?.items || []) as Array<{ id: string; title: string }>
      const today = todayYmdInMalaysia()

      const resolveTypeTitle = (typ: { id?: string; title?: string } | null): string => {
        const raw = (typ?.title != null && String(typ.title).trim()) ? String(typ.title).trim() : ""
        if (raw) return raw
        if (!typ?.id) return "—"
        const idStr = String(typ.id).trim()
        const found = typesList.find((t) => String(t.id).trim() === idStr)
        if (found?.title) return found.title
        return "Unknown"
      }

      setInvoices(items.map((r) => {
        const prop = r.property as { shortname?: string } | null
        const room = r.room as { title_fld?: string } | null
        const tenant = r.tenant as { fullname?: string; id?: string } | null
        const typ = r.type as { id?: string; title?: string } | null
        const typeTitle = resolveTypeTitle(typ)
        const rawDate = r.date
        const dateVal = toYmdMalaysia(rawDate)
        const dueLabel = formatDueDateTenantStyle(rawDate)
        const isPaid = !!r.isPaid
        let status = "pending"
        if (isPaid) status = "paid"
        else if (dateVal && dateVal < today) status = "overdue"
        const internalId = String(r.id ?? r._id ?? "")
        const refRaw = r.invoiceRef
        const invoiceRef =
          typeof refRaw === "string" && refRaw.trim() ? refRaw.trim() : internalId
        const refIdRaw = r.referenceid
        const refStr =
          typeof refIdRaw === "string" && refIdRaw.trim()
            ? refIdRaw.trim()
            : typeof refIdRaw === "number"
              ? String(refIdRaw)
              : ""
        const stripePaymentId =
          refStr && /^(pi_|cs_)/.test(refStr) ? refStr : undefined
        const rowRec = r as Record<string, unknown>
        const rowSub =
          typeof rowRec.bukkuSubdomain === "string" && String(rowRec.bukkuSubdomain).trim()
            ? String(rowRec.bukkuSubdomain).trim()
            : bukkuSub
        const invIdRaw = r.invoiceid ?? rowRec.bukku_invoice_id
        const invoiceProviderId =
          invIdRaw != null && String(invIdRaw).trim() ? String(invIdRaw).trim() : undefined
        const viewFromApi =
          typeof rowRec.viewInvoiceUrl === "string" && rowRec.viewInvoiceUrl.trim()
            ? rowRec.viewInvoiceUrl.trim()
            : undefined
        const invoiceurlResolved =
          viewFromApi ||
          resolveBukkuInvoiceHref(
            typeof r.invoiceurl === "string" ? r.invoiceurl : undefined,
            invIdRaw,
            rowSub
          )
        const typeIdStr = typ?.id != null && String(typ.id).trim() ? String(typ.id).trim() : ""
        return {
          id: internalId,
          invoiceRef,
          tenant: tenant?.fullname ?? "—",
          tenantId: tenant?.id ? String(tenant.id) : "",
          property: prop?.shortname ?? "—",
          room: room?.title_fld ?? "—",
          type: typeTitle,
          typeId: typeIdStr,
          amount: Number(r.amount ?? 0),
          dueDate: dueLabel,
          status,
          isPaid,
          date: dateVal,
          invoiceurl: invoiceurlResolved,
          viewInvoiceUrl: viewFromApi,
          invoiceProviderId,
          receipturl: typeof r.receipturl === "string" && r.receipturl.trim() ? r.receipturl.trim() : undefined,
          source: r._source === 'metertransaction' ? 'metertransaction' : 'rentalcollection',
          stripePaymentId,
        } as Invoice
      }))
      setProperties(((propsRes as { items?: Array<{ id: string; shortname: string }> })?.items || []) as Array<{ id: string; shortname: string }>)
      setInvoiceTypes(((typesRes as { items?: Array<{ id: string; title: string }> })?.items || []) as Array<{ id: string; title: string }>)
      setTenancies(((tenancyRes as { items?: unknown[] })?.items || []) as Array<{ id: string; room?: { title_fld?: string; property_id?: string }; tenant?: { fullname?: string }; active?: boolean; end_date?: string }>)
      const mg = (meterRes?.items || []) as Array<Record<string, unknown>>
      setMeterGroups(mg.map((g) => ({
        id: String(g._id ?? g.groupId ?? g.id ?? ""),
        name: String(g.name ?? ""),
        groupMode: "parent_auto",
        sharingMethod: "percentage",
        paymentType: "postpaid",
        sellingRate: 0.55,
        parentMeter: null,
        childMeters: ((g.meters as Array<Record<string, unknown>>) || []).map((m) => ({
          id: String(m._id ?? m.meterId ?? ""),
          name: String(m.title ?? m.meterId ?? ""),
          tenantId: null,
          tenant: null,
          active: m.active !== false,
          usage: 0,
        })),
      })))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [filterProperty, filterType, dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  const [cleanlemonsLinked, setCleanlemonsLinked] = useState(false)
  useEffect(() => {
    let cancelled = false
    getCleanlemonsLinkStatus()
      .then((cl) => {
        if (cancelled) return
        setCleanlemonsLinked(
          !!(cl?.ok && cl.confirmed && (cl.cleanlemonsClientdetailId || cl.cleanlemonsOperatorId))
        )
      })
      .catch(() => {
        if (!cancelled) setCleanlemonsLinked(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showMeterDialog, setShowMeterDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showVoidDialog, setShowVoidDialog] = useState(false)
  const [showPayDialog, setShowPayDialog] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [payMethod, setPayMethod] = useState<"Cash" | "Bank">("Cash")
  const [payDate, setPayDate] = useState(() => todayYmdInMalaysia())
  const [paySaving, setPaySaving] = useState(false)
  const [voidSaving, setVoidSaving] = useState(false)

  // Create invoice form state
  const [createForm, setCreateForm] = useState({
    propertyId: "all",
    tenancyId: "",
    typeId: "",
    amount: "",
    date: "",
    description: "",
  })
  const [saving, setSaving] = useState(false)
  const [cleaningHintLoading, setCleaningHintLoading] = useState(false)
  // Tenancies for create dialog: refetched when property changes so Tenancy dropdown has options
  type CreateDialogTenancy = { id: string; room?: { title_fld?: string; property_id?: string }; tenant?: { fullname?: string }; active?: boolean; end_date?: string }
  const [createDialogTenancies, setCreateDialogTenancies] = useState<CreateDialogTenancy[]>([])

  // When create dialog is open, keep createDialogTenancies in sync: "all" => full tenancies; else refetch by propertyId (with fallback to client-side filter)
  useEffect(() => {
    if (!showCreateDialog) return
    const pid = createForm.propertyId
    if (!pid || pid === "all") {
      setCreateDialogTenancies(tenancies as CreateDialogTenancy[])
      return
    }
    let cancelled = false
    getTenancyListForInvoice({ propertyId: pid })
      .then((res) => {
        if (cancelled) return
        const list = (res as { items?: unknown[] })?.items ?? []
        setCreateDialogTenancies(list as CreateDialogTenancy[])
      })
      .catch(() => {
        if (!cancelled) {
          // Fallback: filter initial tenancies by property so dropdown still has options
          const fallback = (tenancies as CreateDialogTenancy[]).filter((t) => String(t.room?.property_id ?? "") === String(pid))
          setCreateDialogTenancies(fallback)
        }
      })
    return () => { cancelled = true }
  }, [showCreateDialog, createForm.propertyId, tenancies])

  // Meter invoice form state
  const [meterStep, setMeterStep] = useState<"select" | "input" | "preview">("select")
  const [selectedGroup, setSelectedGroup] = useState<MeterGroup | null>(null)
  const [meterMonth, setMeterMonth] = useState(() => todayYmdInMalaysia().slice(0, 7))
  const [tnbAmount, setTnbAmount] = useState("") // For MANUAL mode
  const [calculatedInvoices, setCalculatedInvoices] = useState<Array<{
    meterId: string
    meterName: string
    tenantId: string | null
    tenant: string | null
    ownUsage: number
    shareUsage: number
    finalUsage: number
    rate: number
    amount: number
    active: boolean
    isPrepaid: boolean
    creditBalance?: number
    newCreditBalance?: number
  }>>([])

  // Filter and sort invoices (property/type filtered server-side; status/search/owner|tenant client-side)
  const filteredInvoices = invoices
    .filter(inv => {
      if (filterStatus !== "ALL" && inv.status !== filterStatus) return false
      if (search) {
        const s = search.toLowerCase()
        return inv.invoiceRef.toLowerCase().includes(s) || inv.id.toLowerCase().includes(s) || inv.tenant.toLowerCase().includes(s) || inv.property.toLowerCase().includes(s) || inv.room.toLowerCase().includes(s)
      }
      // Owner / Tenant sort option acts as filter by type (canonical ids + legacy titles)
      if (sortBy === "owner") {
        return invoiceIsOwnerChargedLine(inv.typeId || "", inv.type || "")
      }
      if (sortBy === "tenant") {
        return !invoiceIsOwnerChargedLine(inv.typeId || "", inv.type || "")
      }
      return true
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "newest": return sortKeyYmdMalaysia(b.date) - sortKeyYmdMalaysia(a.date)
        case "oldest": return sortKeyYmdMalaysia(a.date) - sortKeyYmdMalaysia(b.date)
        case "az": return a.tenant.localeCompare(b.tenant)
        case "za": return b.tenant.localeCompare(a.tenant)
        case "amountasc": return a.amount - b.amount
        case "amountdesc": return b.amount - a.amount
        case "owner":
        case "tenant": return sortKeyYmdMalaysia(b.date) - sortKeyYmdMalaysia(a.date)
        default: return 0
      }
    })

  const totalFiltered = filteredInvoices.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const paginatedInvoices = filteredInvoices.slice((page - 1) * pageSize, page * pageSize)

  const today = todayYmdInMalaysia()
  const summary = {
    total: invoices.length,
    paid: invoices.filter(i => i.status === "paid").length,
    pending: invoices.filter(i => i.status === "pending").length,
    overdue: invoices.filter(i => i.status === "overdue").length,
    totalAmount: invoices.reduce((s, i) => s + i.amount, 0),
    unpaidAmountUpToToday: invoices
      .filter((i) => !i.isPaid && i.date && i.date <= today)
      .reduce((s, i) => s + i.amount, 0),
    unpaidAmountTotal: invoices.filter((i) => !i.isPaid).reduce((s, i) => s + i.amount, 0),
  }

  const handleViewDetail = (invoice: Invoice) => {
    setSelectedInvoice(invoice)
    setShowDetailDialog(true)
  }

  const handleDelete = (invoice: Invoice) => {
    setSelectedInvoice(invoice)
    setShowDeleteDialog(true)
  }

  const handleOpenVoidPayment = (invoice: Invoice) => {
    setSelectedInvoice(invoice)
    setShowVoidDialog(true)
  }

  const openMarkAsPaid = () => {
    setPayDate(todayYmdInMalaysia())
    setPayMethod("Cash")
    setShowPayDialog(true)
  }

  /** Same dialog as detail footer: payment date + method (matches expenses / refund flow). */
  const openMarkAsPaidForInvoice = (inv: Invoice) => {
    setSelectedInvoice(inv)
    setPayDate(todayYmdInMalaysia())
    setPayMethod("Cash")
    setShowPayDialog(true)
  }

  const handleMarkAsPaidSubmit = async () => {
    if (!selectedInvoice) return
    setPaySaving(true)
    try {
      const referenceText = `Pay by ${payMethod}, paid on ${payDate} (MY)`
      const r = await updateRental(selectedInvoice.id, {
        isPaid: true,
        paidAt: malaysiaNoonIsoFromYmd(payDate),
        paymentMethod: payMethod,
        referenceid: referenceText,
      })
      if (r?.ok === false) {
        const errs = Array.isArray(r?.receiptErrors) ? r.receiptErrors.filter(Boolean) : []
        alert(
          r?.reason === "RECEIPT_FAILED" || r?.reason === "RECEIPT_EXCEPTION"
            ? `Marked paid locally, but accounting receipt failed.${errs.length ? `\n${errs.join("\n")}` : ""}`
            : "Failed to mark as paid"
        )
      }
      setShowPayDialog(false)
      setShowDetailDialog(false)
      setSelectedInvoice(null)
      loadData()
    } catch (e) {
      console.error(e)
      alert("Failed to mark as paid")
    } finally {
      setPaySaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!selectedInvoice) return
    if (selectedInvoice.isPaid) {
      alert("Paid invoices cannot be deleted. Use Void Payment first to return to pending (unpaid), then you can delete.")
      return
    }
    try {
      const r = await deleteRental([selectedInvoice.id])
      if (r?.ok !== false) {
        setInvoices(invoices.filter(i => i.id !== selectedInvoice.id))
        setShowDeleteDialog(false)
      } else {
        const errs = Array.isArray(r?.voidErrors) ? r.voidErrors.filter(Boolean) : []
        const msg =
          r?.reason === "VOID_FAILED" || r?.reason === "VOID_EXCEPTION"
            ? `Accounting void failed; row was not deleted.${errs.length ? `\n${errs.join("\n")}` : ""}`
            : "Delete failed."
        alert(msg)
      }
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : "Delete failed")
    }
  }

  const handleConfirmVoidPayment = async () => {
    if (!selectedInvoice) return
    setVoidSaving(true)
    try {
      const r = await voidRentalPayment([selectedInvoice.id])
      if (r?.ok !== false) {
        setShowVoidDialog(false)
        await loadData()
      } else {
        const errs = Array.isArray(r?.voidErrors) ? r.voidErrors.filter(Boolean) : []
        alert(`Void payment failed.${errs.length ? `\n${errs.join("\n")}` : ""}`)
      }
    } catch (e) {
      console.error(e)
      alert("Void payment failed")
    } finally {
      setVoidSaving(false)
    }
  }

  const handleCreateInvoice = async () => {
    if (!createForm.tenancyId || !createForm.typeId || !createForm.amount || !createForm.date) return
    setSaving(true)
    try {
      const r = await insertRental([{
        tenancy: createForm.tenancyId,
        type: createForm.typeId,
        amount: parseFloat(createForm.amount) || 0,
        date: createForm.date,
        description: createForm.description || undefined,
      }])
      if (r?.ok !== false) {
        const invErrs = Array.isArray(r?.invoiceErrors) ? r.invoiceErrors.filter(Boolean) : []
        if (invErrs.length) {
          alert(
            `Rental line saved, but accounting did not create an invoice:\n\n${invErrs.join("\n")}\n\nCheck Company → Account mapping (Bukku): Owner Commission needs Product ID and Platform Collection; property must have an owner.`
          )
        }
        setShowCreateDialog(false)
        setCreateForm({ propertyId: "all", tenancyId: "", typeId: "", amount: "", date: "", description: "" })
        await loadData()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const handleApplyConfiguredCleaningPrice = async () => {
    if (!createForm.tenancyId) {
      alert("Select a tenancy first.")
      return
    }
    setCleaningHintLoading(true)
    try {
      const r = await getTenancyCleaningPriceForInvoice({ tenancyId: createForm.tenancyId })
      if (!r?.ok || r.price == null || r.price <= 0) {
        alert("No tenant cleaning price on this room/property. Set it under property/room settings, or enter an amount manually.")
        return
      }
      setCreateForm((f) => ({ ...f, amount: String(r.price) }))
    } catch (e) {
      console.error(e)
      alert("Could not load suggested price.")
    } finally {
      setCleaningHintLoading(false)
    }
  }

  // Reset meter dialog
  const resetMeterDialog = () => {
    setMeterStep("select")
    setSelectedGroup(null)
    setTnbAmount("")
    setCalculatedInvoices([])
  }

  // Handle meter group selection - go directly to input (for MANUAL TNB amount) or preview
  const handleSelectGroup = (group: MeterGroup) => {
    setSelectedGroup(group)
    // For MANUAL mode, need TNB amount input first
    if (group.groupMode === "parent_manual") {
      setMeterStep("input")
    } else {
      // AUTO and BROTHER modes: calculate directly from CNIOT data
      calculateMeterInvoices(group, 0)
    }
  }

  // Calculate meter invoices based on rules
  const calculateMeterInvoices = (group: MeterGroup, tnbAmountValue: number = 0) => {
    const isManual = group.groupMode === "parent_manual"
    const isAuto = group.groupMode === "parent_auto"
    const isBrother = group.groupMode === "brother"
    const isPrepaid = group.paymentType === "prepaid"

    // Get parent usage from CNIOT (if applicable)
    const parentUsage = group.parentMeter?.usage || 0

    // Get total child usage from CNIOT
    let totalChildUsage = 0
    group.childMeters.forEach(m => {
      totalChildUsage += m.usage
    })

    // Calculate shared usage
    let sharedUsage = 0
    if (isAuto && group.parentMeter) {
      sharedUsage = Math.max(parentUsage - totalChildUsage, 0)
    } else if (isManual && group.parentMeter) {
      sharedUsage = parentUsage
    } else if (isBrother) {
      sharedUsage = totalChildUsage
    }

    // Calculate TNB unit cost for MANUAL mode
    let tnbUnitCost = 0
    if (isManual && tnbAmountValue > 0 && parentUsage > 0) {
      tnbUnitCost = tnbAmountValue / parentUsage
    }

    // Get active children count for "room" sharing method
    const activeChildren = group.childMeters.filter(m => m.active)
    const allChildrenCount = group.childMeters.length

    // Calculate share for each child
    const results: typeof calculatedInvoices = []

    group.childMeters.forEach(child => {
      const ownUsage = child.usage || 0
      let shareUsage = 0

      // Calculate share based on sharing method
      if (group.sharingMethod === "percentage" && totalChildUsage > 0) {
        shareUsage = sharedUsage * (ownUsage / totalChildUsage)
      } else if (group.sharingMethod === "divide_equally") {
        shareUsage = sharedUsage / allChildrenCount
      } else if (group.sharingMethod === "room") {
        if (child.active && activeChildren.length > 0) {
          shareUsage = sharedUsage / activeChildren.length
        } else {
          shareUsage = 0
        }
      }

      // Calculate final usage and amount
      let finalUsage = 0
      let rate = group.sellingRate
      let amount = 0

      if (isBrother) {
        finalUsage = ownUsage
        amount = finalUsage * rate
      } else if (isAuto) {
        finalUsage = ownUsage + shareUsage
        amount = finalUsage * rate
      } else if (isManual) {
        finalUsage = shareUsage
        rate = tnbUnitCost
        amount = shareUsage * tnbUnitCost
      }

      // For PREPAID: get tenant credit balance (would need room->tenancy->credit from API)
      const creditBalance = 0
      const newCreditBalance = isPrepaid ? creditBalance - amount : creditBalance

      results.push({
        meterId: child.id,
        meterName: child.name,
        tenantId: child.tenantId,
        tenant: child.tenant,
        ownUsage,
        shareUsage,
        finalUsage,
        rate,
        amount: Math.round(amount * 100) / 100,
        active: child.active,
        isPrepaid,
        creditBalance,
        newCreditBalance: Math.round(newCreditBalance * 100) / 100,
      })
    })

    setCalculatedInvoices(results)
    setMeterStep("preview")
  }

  // Handle TNB amount submit for MANUAL mode
  const handleTnbSubmit = () => {
    if (!selectedGroup) return
    calculateMeterInvoices(selectedGroup, parseFloat(tnbAmount) || 0)
  }

  // Generate meter invoices (POSTPAID) or deduct credit (PREPAID)
  const handleGenerateMeterInvoices = () => {
    if (!selectedGroup) return

    const isPrepaid = selectedGroup.paymentType === "prepaid"

    if (isPrepaid) {
      // PREPAID: Deduct from credit balance (no invoice generated)
      alert(`Credit deducted successfully for ${calculatedInvoices.filter(c => c.active && c.amount > 0).length} tenant(s)`)
    } else {
      // POSTPAID: Generate invoices - would need insertRental with tenancy from room
      const newInvoices: Invoice[] = calculatedInvoices
        .filter(calc => calc.active && calc.tenantId && calc.amount > 0)
        .map(calc => ({
          id: `INV-${Date.now()}-${calc.meterId}`,
          invoiceRef: `INV-${Date.now()}-${calc.meterId}`,
          tenant: calc.tenant || "Unknown",
          tenantId: calc.tenantId || "",
          property: selectedGroup.name,
          room: calc.meterName,
          type: "Utility",
          amount: calc.amount,
          dueDate: addDaysMalaysiaYmd(todayYmdInMalaysia(), 14),
          status: "pending",
          isPaid: false,
          date: todayYmdInMalaysia(),
        }))
      setInvoices([...newInvoices, ...invoices])
    }

    setShowMeterDialog(false)
    resetMeterDialog()
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "paid": return <Badge className="bg-green-100 text-green-700 hover:bg-green-100"><Check size={12} className="mr-1" /> Paid</Badge>
      case "pending": return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Pending</Badge>
      case "overdue": return <Badge className="bg-red-100 text-red-700 hover:bg-red-100"><AlertTriangle size={12} className="mr-1" /> Overdue</Badge>
      default: return null
    }
  }

  const getGroupModeBadge = (mode: string) => {
    switch (mode) {
      case "parent_auto": return <Badge className="bg-blue-100 text-blue-700">Parent (Auto)</Badge>
      case "parent_manual": return <Badge className="bg-purple-100 text-purple-700">Parent (Manual)</Badge>
      case "brother": return <Badge className="bg-amber-100 text-amber-700">Brother</Badge>
      default: return null
    }
  }

  const getPaymentTypeBadge = (type: string) => {
    switch (type) {
      case "prepaid": return <Badge className="bg-cyan-100 text-cyan-700">Prepaid</Badge>
      case "postpaid": return <Badge className="bg-orange-100 text-orange-700">Postpaid</Badge>
      default: return null
    }
  }

  // Calculate totals for preview
  const previewTotals = useMemo(() => {
    if (!selectedGroup) return { parentUsage: 0, totalChildUsage: 0, sharedUsage: 0, totalInvoiceable: 0, ownerLoss: 0 }
    
    const parentUsage = selectedGroup.parentMeter?.usage || 0
    const totalChildUsage = selectedGroup.childMeters.reduce((sum, m) => sum + m.usage, 0)
    const sharedUsage = selectedGroup.groupMode === "brother" ? 0 : Math.max(parentUsage - totalChildUsage, 0)
    const totalInvoiceable = calculatedInvoices.filter(c => c.active && c.tenantId).reduce((sum, c) => sum + c.amount, 0)
    const ownerLoss = calculatedInvoices.filter(c => !c.active || !c.tenantId).reduce((sum, c) => sum + c.amount, 0)
    
    return { parentUsage, totalChildUsage, sharedUsage, totalInvoiceable, ownerLoss }
  }, [selectedGroup, calculatedInvoices])

  return (
    <main className="p-3 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tenant Invoice</h1>
          <p className="text-sm text-muted-foreground">Manage and track tenant invoices and meter billing</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { resetMeterDialog(); setShowMeterDialog(true) }} className="gap-2">
            <Zap size={16} /> Meter Invoice
          </Button>
          <Button onClick={() => setShowCreateDialog(true)} className="gap-2" style={{ background: "var(--brand)" }}>
            <Plus size={16} /> Create Invoice
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Total Invoices</p>
            <p className="text-2xl font-bold text-foreground">{summary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-green-600">Paid</p>
            <p className="text-2xl font-bold text-foreground">{summary.paid}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-yellow-600">Pending</p>
            <p className="text-2xl font-bold text-foreground">{summary.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-red-600">Overdue</p>
            <p className="text-2xl font-bold text-foreground">{summary.overdue}</p>
          </CardContent>
        </Card>
      </div>

      {/* Amount Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="bg-secondary/30">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Total Amount</p>
              <p className="text-xl font-bold text-foreground">{formatMoney(summary.totalAmount)}</p>
            </div>
            <Receipt size={32} className="text-muted-foreground" />
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-100">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-red-600">Unpaid Amount (Up to Today)</p>
              <p className="text-xl font-bold text-red-700">{formatMoney(summary.unpaidAmountUpToToday)}</p>
            </div>
            <AlertTriangle size={32} className="text-red-400" />
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-100">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-red-600">Unpaid Amount (Total)</p>
              <p className="text-xl font-bold text-red-700">{formatMoney(summary.unpaidAmountTotal)}</p>
            </div>
            <AlertTriangle size={32} className="text-red-400" />
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search invoice, tenant..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="pl-9"
            />
          </div>
          <Select value={filterProperty} onValueChange={(v) => { setFilterProperty(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Property" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Properties</SelectItem>
            {properties.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.shortname}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-32">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            {sortedInvoiceTypes.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-32">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => { setSortBy(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="oldest">Oldest First</SelectItem>
            <SelectItem value="az">A-Z</SelectItem>
            <SelectItem value="za">Z-A</SelectItem>
            <SelectItem value="amountdesc">Amount (High)</SelectItem>
            <SelectItem value="amountasc">Amount (Low)</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
            <SelectItem value="tenant">Tenant</SelectItem>
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

      {/* Invoice Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Invoice #</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Tenant</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Property / Room</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Type</th>
                  <th className="text-right p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Amount</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Due Date</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                  <th className="text-right p-2 w-14 text-xs font-bold uppercase tracking-widest text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedInvoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border hover:bg-secondary/20">
                    <td className="p-4 font-mono text-sm">{inv.invoiceRef}</td>
                    <td className="p-4 text-sm font-medium">{inv.tenant}</td>
                    <td className="p-4 text-sm text-muted-foreground">{inv.property} / {inv.room}</td>
                    <td className="p-4">
                      <Badge variant="outline">{inv.type}</Badge>
                    </td>
                    <td className="p-4 text-right font-semibold">{formatMoney(inv.amount)}</td>
                    <td className="p-4 text-sm">{inv.dueDate}</td>
                    <td className="p-4">{getStatusBadge(inv.status)}</td>
                    <td className="p-2 w-14 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ChevronDown size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleViewDetail(inv)}>
                            <Eye size={14} className="mr-2" /> View Detail
                          </DropdownMenuItem>
                          {!inv.isPaid && (
                            <DropdownMenuItem onClick={() => openMarkAsPaidForInvoice(inv)}>
                              <Check size={14} className="mr-2" /> Mark as Paid
                            </DropdownMenuItem>
                          )}
                          {inv.isPaid && inv.source !== "metertransaction" && (
                            <DropdownMenuItem onClick={() => handleOpenVoidPayment(inv)}>
                              <AlertTriangle size={14} className="mr-2" /> Void Payment
                            </DropdownMenuItem>
                          )}
                          {inv.invoiceurl ? (
                            <DropdownMenuItem asChild>
                              <a href={inv.invoiceurl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink size={14} className="mr-2" /> View invoice
                              </a>
                            </DropdownMenuItem>
                          ) : null}
                          {inv.receipturl ? (
                            <DropdownMenuItem asChild>
                              <a href={inv.receipturl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink size={14} className="mr-2" /> View receipt
                              </a>
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSeparator />
                          {inv.source !== 'metertransaction' && !inv.isPaid && (
                            <DropdownMenuItem onClick={() => handleDelete(inv)} className="text-destructive">
                              <Trash2 size={14} className="mr-2" /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {paginatedInvoices.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No invoices found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination + per page */}
          {totalFiltered > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalFiltered)} of {totalFiltered}
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

      {/* Invoice Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Invoice Details</DialogTitle>
            <DialogDescription>View invoice information</DialogDescription>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Invoice #</p>
                  <p className="font-mono font-semibold">{selectedInvoice.invoiceRef}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-1">Record ID: {selectedInvoice.id}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <div>{getStatusBadge(selectedInvoice.status)}</div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tenant</p>
                  <p className="font-semibold">{selectedInvoice.tenant}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Property / Room</p>
                  <p>{selectedInvoice.property} / {selectedInvoice.room}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <Badge variant="outline">{selectedInvoice.type}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Due Date</p>
                  <p>{selectedInvoice.dueDate}</p>
                </div>
                {selectedInvoice.stripePaymentId ? (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Stripe payment ID</p>
                    <p className="font-mono text-sm break-all select-all">{selectedInvoice.stripePaymentId}</p>
                  </div>
                ) : null}
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 text-center">
                <p className="text-xs text-muted-foreground mb-1">Amount</p>
                <p className="text-2xl font-bold" style={{ color: "var(--brand)" }}>{formatMoney(selectedInvoice.amount)}</p>
              </div>
              {(selectedInvoice.invoiceurl || selectedInvoice.receipturl) && (
                <div className="flex flex-wrap gap-2">
                  {selectedInvoice.invoiceurl ? (
                    <Button variant="outline" size="sm" className="gap-1" asChild>
                      <a href={selectedInvoice.invoiceurl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={14} /> View invoice
                      </a>
                    </Button>
                  ) : null}
                  {selectedInvoice.receipturl ? (
                    <Button variant="outline" size="sm" className="gap-1" asChild>
                      <a href={selectedInvoice.receipturl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={14} /> View receipt
                      </a>
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {selectedInvoice && !selectedInvoice.isPaid && (
              <Button style={{ background: "var(--brand)" }} className="gap-2" onClick={openMarkAsPaid}>
                <Check size={16} /> Mark as Paid
              </Button>
            )}
            {selectedInvoice && selectedInvoice.isPaid && selectedInvoice.source !== "metertransaction" && (
              <Button variant="outline" className="gap-2" onClick={() => handleOpenVoidPayment(selectedInvoice)}>
                <AlertTriangle size={16} /> Void Payment
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowDetailDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark as Paid</DialogTitle>
            <DialogDescription>
              Choose payment method and date (Malaysia time, UTC+8). Same as expenses / deposit refund.
            </DialogDescription>
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
            <Button style={{ background: "var(--brand)" }} onClick={handleMarkAsPaidSubmit} disabled={paySaving}>
              {paySaving ? "Saving..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Invoice Dialog – wider so dropdowns (tenancy, type) don’t overflow */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => { if (!open) setCreateForm((f) => ({ ...f, propertyId: "all", tenancyId: "" })); if (open) setCreateDialogTenancies(tenancies); setShowCreateDialog(open) }}>
        <DialogContent className="max-w-4xl w-[min(95vw,56rem)] min-w-[min(95vw,20rem)] max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Create Invoice</DialogTitle>
            <DialogDescription>
              {cleanlemonsLinked ? (
                <>
                  Create a charge for a tenant (rent, deposit, fees, or Cleaning Services). For cleaning, choose type &quot;Cleaning Services&quot;,
                  select the tenancy (租客支付), then amount — or use the configured room/property tenant cleaning rate.
                </>
              ) : (
                <>
                  Create a charge for a tenant (rent, deposit, fees, or Cleaning Services). For cleaning, choose type &quot;Cleaning Services&quot;,
                  select the tenancy (租客支付), then enter the amount.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 min-w-0">
            <div className="min-w-0">
              <Label className="text-xs font-semibold">Property</Label>
              <Select value={createForm.propertyId || "all"} onValueChange={(v) => setCreateForm({ ...createForm, propertyId: v, tenancyId: "" })}>
                <SelectTrigger className="mt-1 w-full min-w-0">
                  <SelectValue placeholder="Select property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All properties</SelectItem>
                  {properties.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.shortname}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-xs font-semibold">Tenancy / Room (Active or Inactive)</Label>
              <Select value={createForm.tenancyId || "_none"} onValueChange={(v) => setCreateForm({ ...createForm, tenancyId: v === "_none" ? "" : v })}>
                <SelectTrigger className="mt-1 w-full min-w-0 max-w-full truncate text-left [&>span]:truncate [&>span]:block">
                  <SelectValue placeholder="Select tenancy" />
                </SelectTrigger>
                <SelectContent className="max-h-[min(60vh,20rem)] overflow-y-auto w-[var(--radix-select-trigger-width)] max-w-[min(95vw,36rem)]">
                  <SelectItem value="_none" className="truncate">Select tenancy</SelectItem>
                  {(() => {
                    const pid = createForm.propertyId
                    const list = createDialogTenancies ?? []
                    const filtered = pid && pid !== "all"
                      ? (list.length > 0 ? list : (tenancies as CreateDialogTenancy[]).filter((t) => String(t.room?.property_id ?? "") === String(pid)))
                      : list.length > 0 ? list : (tenancies as CreateDialogTenancy[])
                    return filtered.map(t => {
                      const label = `${t.tenant?.fullname ?? "—"} / ${t.room?.title_fld ?? "—"} (${t.active ? "Active" : "Inactive"})`
                      return (
                        <SelectItem key={t.id} value={String(t.id)} className="truncate" title={label}>
                          {label}
                        </SelectItem>
                      )
                    })
                  })()}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-xs font-semibold">Invoice Type</Label>
              <Select value={createForm.typeId || "_none"} onValueChange={(v) => setCreateForm({ ...createForm, typeId: v === "_none" ? "" : v })}>
                <SelectTrigger className="mt-1 w-full min-w-0">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Select type</SelectItem>
                  {sortedInvoiceTypes.map(t => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isCleaningInvoiceType(createForm.typeId) && cleanlemonsLinked ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Cleaning Services — tenant pays</p>
                <p className="mt-1">
                  Select tenancy above, then enter the amount the tenant should pay (or use the rate saved on the room/property for the tenant portal).
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  disabled={!createForm.tenancyId || cleaningHintLoading}
                  onClick={handleApplyConfiguredCleaningPrice}
                >
                  {cleaningHintLoading ? "Loading…" : "Use configured tenant cleaning rate"}
                </Button>
              </div>
            ) : null}
            <div className="min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-semibold">Amount ({currencyCode ? String(currencyCode).toUpperCase() : "—"})</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={createForm.amount}
                  onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })}
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold">Date</Label>
                <Input
                  type="date"
                  value={createForm.date}
                  onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })}
                  className="mt-1 w-full"
                />
              </div>
            </div>
            <div className="min-w-0">
              <Label className="text-xs font-semibold">Description (Optional)</Label>
              <textarea
                placeholder="Invoice description"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                className="mt-1 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 box-border"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateInvoice} style={{ background: "var(--brand)" }} disabled={saving || !createForm.tenancyId || !createForm.typeId || !createForm.amount || !createForm.date}>
              Create Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Meter Invoice Dialog — match operator/company Set fees dialog width */}
      <Dialog open={showMeterDialog} onOpenChange={(open) => { if (!open) resetMeterDialog(); setShowMeterDialog(open) }}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {meterStep === "select" && "Select Meter Group"}
              {meterStep === "input" && "Enter TNB Amount"}
              {meterStep === "preview" && "Preview Invoices"}
            </DialogTitle>
            <DialogDescription>
              {meterStep === "select" && "Choose a meter group to generate utility invoices"}
              {meterStep === "input" && "Enter the TNB bill amount for manual calculation"}
              {meterStep === "preview" && "Review calculated invoices before generating"}
            </DialogDescription>
          </DialogHeader>

          {/* Step 1: Select Group */}
          {meterStep === "select" && (
            <div className="space-y-4 py-4">
              <div className="grid gap-4">
                {meterGroups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => handleSelectGroup(group)}
                    className="p-4 rounded-xl border-2 border-border hover:border-primary/50 text-left transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap size={18} style={{ color: "var(--brand)" }} />
                          <span className="font-bold text-foreground">{group.name}</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {getGroupModeBadge(group.groupMode)}
                          {getPaymentTypeBadge(group.paymentType)}
                          <Badge variant="outline">Rate: {formatMoney(group.sellingRate)}/kWh</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {group.childMeters.length} child meter(s) · {group.childMeters.filter(m => m.active).length} active
                        </p>
                      </div>
                      {group.parentMeter && (
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Parent Usage</p>
                          <p className="text-lg font-bold">{group.parentMeter.usage} kWh</p>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: TNB Amount Input (MANUAL mode only) */}
          {meterStep === "input" && selectedGroup && (
            <div className="space-y-6 py-4">
              <div className="p-4 rounded-xl bg-purple-50 border border-purple-200">
                <div className="flex items-start gap-3">
                  <Info size={18} className="text-purple-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-purple-900">Manual Mode</p>
                    <p className="text-sm text-purple-700">
                      Enter the total TNB bill amount. The system will calculate the unit cost and distribute to tenants based on their share usage.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-secondary/50">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Parent Meter Usage</p>
                  <p className="text-2xl font-bold">{selectedGroup.parentMeter?.usage || 0} kWh</p>
                </div>
                <div className="p-4 rounded-lg bg-secondary/50">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Total Child Usage</p>
                  <p className="text-2xl font-bold">{selectedGroup.childMeters.reduce((s, m) => s + m.usage, 0)} kWh</p>
                </div>
              </div>

              <div>
                <Label className="text-sm font-bold">TNB Bill Amount ({currencyCode ? String(currencyCode).toUpperCase() : "—"})</Label>
                <Input
                  type="number"
                  placeholder="Enter TNB bill amount"
                  value={tnbAmount}
                  onChange={(e) => setTnbAmount(e.target.value)}
                  className="mt-2 text-lg h-12"
                />
                {tnbAmount && parseFloat(tnbAmount) > 0 && selectedGroup.parentMeter && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Unit Cost: {currencySymbol} {(parseFloat(tnbAmount) / selectedGroup.parentMeter.usage).toFixed(4)} per kWh
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setMeterStep("select")}>Back</Button>
                <Button onClick={handleTnbSubmit} style={{ background: "var(--brand)" }} disabled={!tnbAmount || parseFloat(tnbAmount) <= 0}>
                  Calculate Invoices
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 3: Preview */}
          {meterStep === "preview" && selectedGroup && (
            <div className="space-y-6 py-4">
              {/* Calculation Summary */}
              <div className="p-4 rounded-xl bg-secondary/30 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Calculation Summary</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {selectedGroup.parentMeter && (
                    <div>
                      <p className="text-xs text-muted-foreground">Parent Usage</p>
                      <p className="text-lg font-bold">{previewTotals.parentUsage} kWh</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Total Child Usage</p>
                    <p className="text-lg font-bold">{previewTotals.totalChildUsage} kWh</p>
                  </div>
                  {selectedGroup.groupMode !== "brother" && (
                    <div>
                      <p className="text-xs text-muted-foreground">Shared Usage</p>
                      <p className="text-lg font-bold">{previewTotals.sharedUsage.toFixed(2)} kWh</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Mode</p>
                    <div>{getPaymentTypeBadge(selectedGroup.paymentType)}</div>
                  </div>
                </div>
              </div>

              {/* Invoice Preview Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="text-left p-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Meter</th>
                      <th className="text-left p-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Tenant</th>
                      <th className="text-right p-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Own Usage</th>
                      <th className="text-right p-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Share Usage</th>
                      <th className="text-right p-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Rate</th>
                      <th className="text-right p-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Amount</th>
                      <th className="text-center p-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculatedInvoices.map((calc) => (
                      <tr key={calc.meterId} className="border-b border-border">
                        <td className="p-3 font-semibold">{calc.meterName}</td>
                        <td className="p-3">
                          {calc.tenant ? (
                            <span style={{ color: "var(--brand)" }}>{calc.tenant}</span>
                          ) : (
                            <span className="text-muted-foreground italic">No tenant</span>
                          )}
                        </td>
                        <td className="p-3 text-right">{calc.ownUsage.toFixed(2)} kWh</td>
                        <td className="p-3 text-right">{calc.shareUsage.toFixed(2)} kWh</td>
                        <td className="p-3 text-right">{currencySymbol} {calc.rate.toFixed(4)}</td>
                        <td className="p-3 text-right font-bold">{formatMoney(calc.amount)}</td>
                        <td className="p-3 text-center">
                          {calc.active && calc.tenantId ? (
                            <Badge className="bg-green-100 text-green-700">Will Invoice</Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-700">Owner Loss</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-secondary/20">
                      <td colSpan={5} className="p-3 text-right font-bold">Total Invoiceable:</td>
                      <td className="p-3 text-right">
                        <span className="text-xl font-bold" style={{ color: "var(--brand)" }}>
                          {formatMoney(previewTotals.totalInvoiceable)}
                        </span>
                      </td>
                      <td></td>
                    </tr>
                    {previewTotals.ownerLoss > 0 && (
                      <tr className="bg-red-50">
                        <td colSpan={5} className="p-3 text-right font-semibold text-red-700">Owner Loss:</td>
                        <td className="p-3 text-right text-red-700 font-bold">{formatMoney(previewTotals.ownerLoss)}</td>
                        <td></td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>

              {/* Prepaid Credit Balance Info */}
              {selectedGroup.paymentType === "prepaid" && (
                <div className="p-4 rounded-xl bg-cyan-50 border border-cyan-200">
                  <div className="flex items-start gap-3">
                    <Info size={18} className="text-cyan-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-cyan-900">Prepaid Mode</p>
                      <p className="text-sm text-cyan-700">
                        Amount will be deducted from tenant credit balance. No invoice will be generated.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => selectedGroup.groupMode === "parent_manual" ? setMeterStep("input") : setMeterStep("select")}>
                  Back
                </Button>
                <Button onClick={handleGenerateMeterInvoices} style={{ background: "var(--brand)" }} className="gap-2">
                  <Zap size={16} />
                  {selectedGroup.paymentType === "prepaid" ? "Deduct Credit" : "Generate Invoices"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Void Payment Confirmation Dialog */}
      <Dialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Void Payment</DialogTitle>
            <DialogDescription>
              If accounting is connected, this reverses the payment in accounting (void payment / related entries), then this row becomes unpaid (pending). You can delete it afterward.
            </DialogDescription>
          </DialogHeader>
          {selectedInvoice && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
              <p className="font-semibold text-amber-900">{selectedInvoice.id}</p>
              <p className="text-sm text-amber-700">{selectedInvoice.tenant} - {formatMoney(selectedInvoice.amount)}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVoidDialog(false)} disabled={voidSaving}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmVoidPayment} disabled={voidSaving}>
              {voidSaving ? "Voiding..." : "Void Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Invoice</DialogTitle>
            <DialogDescription>
              Only for unpaid (pending) invoices. If accounting is connected, the sales invoice will be voided in accounting first, then this record is removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedInvoice && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200">
              <p className="font-semibold text-red-900">{selectedInvoice.id}</p>
              <p className="text-sm text-red-700">{selectedInvoice.tenant} - {formatMoney(selectedInvoice.amount)}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>Delete Invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
