"use client"

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Users, CreditCard, Package, Search, CheckCircle, Clock, AlertCircle, Plus, RefreshCw, Home, LogOut, BookOpen, Mail, Trash2, CircleDollarSign, Landmark, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"
import {
  getClients,
  getPlans,
  getPendingTickets,
  acknowledgeManualTicket,
  getCreditUsedStats,
  manualTopup,
  manualRenew,
  getApiDocsUsers,
  createApiDocsUserForClient,
  setApiDocsUserCanAccess,
  getSaasEnquiries,
  getOwnerEnquiries,
  acknowledgeSaasEnquiry,
  acknowledgeOwnerEnquiry,
  deleteOwnerEnquiry,
  getProcessingFeeTransactions,
  getSaasAdminMeters,
  moveMeterToOperator,
  getSaasAdminProperties,
  movePropertyToOperator,
  type ManualBillingClient,
  type PricingPlan,
  type PendingTicket,
  type ApiDocsUser,
  type SaasEnquiry,
  type OwnerEnquiry,
  type ProcessingFeeTransaction,
  type SaasAdminMeter,
  type SaasAdminProperty,
} from "@/lib/saas-admin-api"
import { clearPortalSession } from "@/lib/portal-session"
import {
  formatManualPendingTicketSummary,
  extractReceiptUrlFromTicketDescription,
  receiptUrlForBrowserOpen,
  extractCreditsFromTopupTicketDescription,
} from "@/lib/saas-admin-manual-ticket"

type TabId =
  | "dashboard"
  | "clients"
  | "topup"
  | "pricing"
  | "processing-fees"
  | "meters"
  | "properties"
  | "enquiry"
  | "apidocs"
type PlanRemark = "new_customer" | "renew" | "upgrade"

function formatPaidDate(val: string): string {
  if (!val) return ""
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val).slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function todayStr(): string {
  return formatLocalDate(new Date())
}

function formatLocalDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function labelForTopupMode(mode: "free_credit" | "manual_credit"): string {
  return mode === "manual_credit" ? "Manual credit (Bukku invoice)" : "Free Credit (no Bukku invoice)"
}

function formatPaymentWithCredits(row: ProcessingFeeTransaction): string {
  const paymentText = Number(row.paymentAmount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  const raw = Number(row.deductedCredits)
  const pm = Number(row.processingFee) || 0
  const credits =
    Number.isFinite(raw) && raw > 0 ? raw : pm > 0 ? Math.ceil(pm) : 0
  if (Number.isFinite(credits) && credits > 0) {
    return `${paymentText} (${Math.round(credits)})`
  }
  return paymentText
}

export default function SaasAdminPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab") || "dashboard"
  const activeTab: TabId = [
    "dashboard",
    "clients",
    "topup",
    "pricing",
    "enquiry",
    "apidocs",
    "processing-fees",
    "meters",
    "properties",
  ].includes(tabParam)
    ? (tabParam as TabId)
    : "dashboard"
  const [search, setSearch] = useState("")
  const [clients, setClients] = useState<ManualBillingClient[]>([])
  const [plans, setPlans] = useState<PricingPlan[]>([])
  const [pendingTickets, setPendingTickets] = useState<PendingTicket[]>([])
  const [creditStats, setCreditStats] = useState<{ thisMonth: number; byMonth: Array<{ month: string; total: number }> }>({ thisMonth: 0, byMonth: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedClient, setSelectedClient] = useState("")
  const [selectedPlan, setSelectedPlan] = useState("")
  const [planRemark, setPlanRemark] = useState<PlanRemark>("new_customer")
  const [paidDate, setPaidDate] = useState("")
  const [topupClient, setTopupClient] = useState("")
  const [topupAmount, setTopupAmount] = useState("")
  const [topupDate, setTopupDate] = useState("")
  const [topupMode, setTopupMode] = useState<"free_credit" | "manual_credit">("manual_credit")
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmAction, setConfirmAction] = useState<"renew" | "topup" | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [apiDocsUsers, setApiDocsUsers] = useState<ApiDocsUser[]>([])
  const [apiDocsClientId, setApiDocsClientId] = useState("")
  const [apiDocsSubmitting, setApiDocsSubmitting] = useState(false)
  const [apiDocsError, setApiDocsError] = useState<string | null>(null)
  const [showGeneratedCreds, setShowGeneratedCreds] = useState<{ username: string; plainPassword: string; clientTitle: string } | null>(null)
  const [saasEnquiries, setSaasEnquiries] = useState<SaasEnquiry[]>([])
  const [ownerEnquiries, setOwnerEnquiries] = useState<OwnerEnquiry[]>([])
  const [enquiryDetailSaas, setEnquiryDetailSaas] = useState<SaasEnquiry | null>(null)
  const [enquiryDetailOwner, setEnquiryDetailOwner] = useState<OwnerEnquiry | null>(null)
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null)
  const [acknowledgingManualTicketId, setAcknowledgingManualTicketId] = useState<string | null>(null)
  const [manualTicketDetail, setManualTicketDetail] = useState<PendingTicket | null>(null)
  const [manualTopupDialogOpen, setManualTopupDialogOpen] = useState(false)
  const [manualTopupSourceTicket, setManualTopupSourceTicket] = useState<PendingTicket | null>(null)
  const [topupDoneLabel, setTopupDoneLabel] = useState<{ topupMode: "free_credit" | "manual_credit" } | null>(null)
  const acknowledgedSaasIdsRef = useRef<Set<string>>(new Set())
  const acknowledgedOwnerIdsRef = useRef<Set<string>>(new Set())
  const [clientStatusFilter, setClientStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [clientPlanFilter, setClientPlanFilter] = useState<string>("")
  const [processingFees, setProcessingFees] = useState<ProcessingFeeTransaction[]>([])
  const [processingFeeDetail, setProcessingFeeDetail] = useState<ProcessingFeeTransaction | null>(null)
  const [processingFeeSearch, setProcessingFeeSearch] = useState("")
  const [processingFeeCurrency, setProcessingFeeCurrency] = useState<"all" | "MYR" | "SGD">("all")
  const [processingFeeSort, setProcessingFeeSort] = useState<"date_desc" | "date_asc" | "fee_desc" | "fee_asc" | "client_asc" | "client_desc">("date_desc")
  const [processingFeeDateFrom, setProcessingFeeDateFrom] = useState("")
  const [processingFeeDateTo, setProcessingFeeDateTo] = useState("")
  const [processingFeePage, setProcessingFeePage] = useState(1)
  const [processingFeePageSize, setProcessingFeePageSize] = useState<10 | 20 | 50 | 100 | 200>(20)
  const [processingFeeTotal, setProcessingFeeTotal] = useState(0)
  const [processingFeeAggregates, setProcessingFeeAggregates] = useState({ settlement: 0, pending: 0, total: 0 })
  const [allMeters, setAllMeters] = useState<SaasAdminMeter[]>([])
  const [meterSearch, setMeterSearch] = useState("")
  const [meterOperatorFilter, setMeterOperatorFilter] = useState<string>("")
  const [meterPage, setMeterPage] = useState(1)
  const [meterPageSize, setMeterPageSize] = useState<20 | 50 | 100>(50)
  const [meterTotal, setMeterTotal] = useState(0)
  const [movingMeterId, setMovingMeterId] = useState<string | null>(null)
  const [meterTargetById, setMeterTargetById] = useState<Record<string, string>>({})
  const [allProperties, setAllProperties] = useState<SaasAdminProperty[]>([])
  const [propertySearch, setPropertySearch] = useState("")
  const [propertyOperatorFilter, setPropertyOperatorFilter] = useState<string>("")
  const [propertyPage, setPropertyPage] = useState(1)
  const [propertyPageSize, setPropertyPageSize] = useState<20 | 50 | 100>(50)
  const [propertyTotal, setPropertyTotal] = useState(0)
  const [movingPropertyId, setMovingPropertyId] = useState<string | null>(null)
  const [propertyTargetById, setPropertyTargetById] = useState<Record<string, string>>({})

  const loadData = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [clientsRes, pendingRes] = await Promise.all([
        getClients(),
        getPendingTickets(),
      ])
      if (clientsRes.items) setClients(clientsRes.items)
      if (pendingRes.items) setPendingTickets(pendingRes.items)
      if (activeTab === "pricing" || activeTab === "topup") {
        const plansData = await getPlans()
        setPlans(plansData)
      }
      const [saasRes, ownerRes] = await Promise.all([getSaasEnquiries(), getOwnerEnquiries()])
      const saasList = Array.isArray(saasRes?.items) ? saasRes.items : []
      const ownerList = Array.isArray(ownerRes?.items) ? ownerRes.items : []
      const nowIso = new Date().toISOString()
      setSaasEnquiries(
        saasList.map((e) => ({
          ...e,
          acknowledgedAt: acknowledgedSaasIdsRef.current.has(e.id) ? (e.acknowledgedAt || nowIso) : e.acknowledgedAt,
        }))
      )
      setOwnerEnquiries(
        ownerList.map((e) => ({
          ...e,
          acknowledgedAt: acknowledgedOwnerIdsRef.current.has(e.id) ? (e.acknowledgedAt || nowIso) : e.acknowledgedAt,
        }))
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Default payment date to today when opening Credit Top-up tab
  useEffect(() => {
    if (activeTab === "topup") setTopupDate((d) => (d ? d : todayStr()))
  }, [activeTab])

  // Load credit-used stats when on dashboard
  useEffect(() => {
    if (activeTab !== "dashboard") return
    getCreditUsedStats()
      .then(setCreditStats)
      .catch(() => setCreditStats({ thisMonth: 0, byMonth: [] }))
  }, [activeTab])

  // Load API docs users when on apidocs tab
  const loadApiDocsUsers = useCallback(async () => {
    if (activeTab !== "apidocs") return
    setError(null)
    try {
      const res = await getApiDocsUsers()
      if (res.items) setApiDocsUsers(res.items)
    } catch (e) {
      setApiDocsError(e instanceof Error ? e.message : "Failed to load")
    }
  }, [activeTab])
  useEffect(() => {
    loadApiDocsUsers()
  }, [loadApiDocsUsers])

  // Load plans when switching to pricing or topup (for dropdowns)
  useEffect(() => {
    if ((activeTab === "pricing" || activeTab === "topup") && plans.length === 0 && !loading) {
      getPlans().then(setPlans).catch(() => {})
    }
  }, [activeTab, plans.length, loading])

  useEffect(() => {
    const now = new Date()
    const from = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1))
    const to = formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    setProcessingFeeDateFrom((v) => v || from)
    setProcessingFeeDateTo((v) => v || to)
  }, [])

  useLayoutEffect(() => {
    setProcessingFeePage(1)
  }, [processingFeeDateFrom, processingFeeDateTo, processingFeeSearch, processingFeeCurrency, processingFeeSort, processingFeePageSize])

  useLayoutEffect(() => {
    setMeterPage(1)
  }, [meterSearch, meterOperatorFilter, meterPageSize])

  useLayoutEffect(() => {
    setPropertyPage(1)
  }, [propertySearch, propertyOperatorFilter, propertyPageSize])

  useEffect(() => {
    if (activeTab !== "processing-fees" || !processingFeeDateFrom || !processingFeeDateTo) return
    getProcessingFeeTransactions({
      dateFrom: processingFeeDateFrom,
      dateTo: processingFeeDateTo,
      search: processingFeeSearch,
      currency: processingFeeCurrency,
      sort: processingFeeSort,
      page: processingFeePage,
      pageSize: processingFeePageSize,
    })
      .then((res) => {
        setProcessingFees(Array.isArray(res?.items) ? res.items : [])
        setProcessingFeeTotal(typeof res?.total === "number" ? res.total : 0)
        const s = res?.summary
        setProcessingFeeAggregates({
          settlement: s?.settlementTotal ?? 0,
          pending: s?.pendingTotal ?? 0,
          total: s?.allTotal ?? 0,
        })
      })
      .catch(() => {
        setProcessingFees([])
        setProcessingFeeTotal(0)
        setProcessingFeeAggregates({ settlement: 0, pending: 0, total: 0 })
      })
  }, [
    activeTab,
    processingFeeDateFrom,
    processingFeeDateTo,
    processingFeeSearch,
    processingFeeCurrency,
    processingFeeSort,
    processingFeePage,
    processingFeePageSize,
  ])

  useEffect(() => {
    if (activeTab !== "meters") return
    getSaasAdminMeters({
      search: meterSearch,
      operatorId: meterOperatorFilter,
      page: meterPage,
      pageSize: meterPageSize,
    })
      .then((res) => {
        setAllMeters(Array.isArray(res?.items) ? res.items : [])
        setMeterTotal(typeof res?.total === "number" ? res.total : 0)
      })
      .catch(() => {
        setAllMeters([])
        setMeterTotal(0)
      })
  }, [activeTab, meterSearch, meterOperatorFilter, meterPage, meterPageSize])

  useEffect(() => {
    if (activeTab !== "properties") return
    getSaasAdminProperties({
      search: propertySearch,
      operatorId: propertyOperatorFilter,
      page: propertyPage,
      pageSize: propertyPageSize,
    })
      .then((res) => {
        setAllProperties(Array.isArray(res?.items) ? res.items : [])
        setPropertyTotal(typeof res?.total === "number" ? res.total : 0)
      })
      .catch(() => {
        setAllProperties([])
        setPropertyTotal(0)
      })
  }, [activeTab, propertySearch, propertyOperatorFilter, propertyPage, propertyPageSize])

  const processingFeeTotalPages = Math.max(1, Math.ceil(processingFeeTotal / processingFeePageSize) || 1)
  const processingFeeRangeStart = processingFeeTotal === 0 ? 0 : (processingFeePage - 1) * processingFeePageSize + 1
  const processingFeeRangeEnd = Math.min(processingFeePage * processingFeePageSize, processingFeeTotal)
  const meterTotalPages = Math.max(1, Math.ceil(meterTotal / meterPageSize) || 1)
  const meterRangeStart = meterTotal === 0 ? 0 : (meterPage - 1) * meterPageSize + 1
  const meterRangeEnd = Math.min(meterPage * meterPageSize, meterTotal)
  const propertyTotalPages = Math.max(1, Math.ceil(propertyTotal / propertyPageSize) || 1)
  const propertyRangeStart = propertyTotal === 0 ? 0 : (propertyPage - 1) * propertyPageSize + 1
  const propertyRangeEnd = Math.min(propertyPage * propertyPageSize, propertyTotal)

  /** Open in-page top-up dialog (from manual ticket); prefills client, date, credits from ticket. */
  const openManualTopupFromTicket = (ticket: PendingTicket) => {
    setTopupClient(ticket.client_id || "")
    setTopupDate(todayStr())
    setTopupMode("manual_credit")
    setTopupAmount(extractCreditsFromTopupTicketDescription(ticket.description || ""))
    setManualTopupSourceTicket(ticket)
    setManualTopupDialogOpen(true)
  }

  const handleAcknowledgeManualTicket = async (rowId: string) => {
    const id = String(rowId || "").trim()
    if (!id) return
    setAcknowledgingManualTicketId(id)
    setError(null)
    try {
      const res = await acknowledgeManualTicket(id)
      if (res.affected === 0) {
        setError("Ticket was already acknowledged or not found.")
      }
      await loadData()
      setManualTicketDetail((prev) =>
        prev && String(prev._id || prev.id) === id ? { ...prev, acknowledgedAt: new Date().toISOString() } : prev
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Acknowledge failed")
    } finally {
      setAcknowledgingManualTicketId(null)
    }
  }

  const renderManualTicketActions = (ticket: PendingTicket) => {
    const rowId = String(ticket._id || ticket.id || "")
    const busy = acknowledgingManualTicketId === rowId
    const acked = Boolean(ticket.acknowledgedAt)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Ticket actions">
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setManualTicketDetail(ticket)}>View detail</DropdownMenuItem>
          {acked ? (
            <DropdownMenuItem disabled>Acknowledged</DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={busy || !rowId} onClick={() => void handleAcknowledgeManualTicket(rowId)}>
              {busy ? "Acknowledging…" : "Acknowledge"}
            </DropdownMenuItem>
          )}
          {ticket.mode === "topup_manual" ? (
            ticket.completedAt ? (
              <DropdownMenuItem disabled>Completed</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => openManualTopupFromTicket(ticket)}>Fill top-up form</DropdownMenuItem>
            )
          ) : (
            <DropdownMenuItem
              onClick={() => {
                setSelectedClient(ticket.client_id || "")
                router.push("/saas-admin?tab=pricing")
              }}
            >
              Go to pricing
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const sortedClients = [...clients].sort((a, b) =>
    String(a.title || "").localeCompare(String(b.title || ""))
  )
  const isClientActive = (c: ManualBillingClient) => {
    if (!c.hasPlan) return false
    const expStr = c.expiredStr || "-"
    if (expStr === "-") return true
    return new Date(expStr) >= new Date()
  }
  const planOptionsForFilter = ["", ...Array.from(new Set(clients.map((c) => (c.planTitle || "").trim()).filter(Boolean)))].sort()
  const filteredClients = sortedClients.filter((c) => {
    const matchSearch =
      String(c.title || "").toLowerCase().includes(search.toLowerCase()) ||
      String(c.planTitle || "").toLowerCase().includes(search.toLowerCase())
    if (!matchSearch) return false
    if (clientStatusFilter === "active" && !isClientActive(c)) return false
    if (clientStatusFilter === "inactive" && isClientActive(c)) return false
    if (clientPlanFilter && (c.planTitle || "").trim() !== clientPlanFilter) return false
    return true
  })

  const selectedClientData = sortedClients.find((c) => c.id === selectedClient)
  const selectedPlanData = plans.find((p) => p.id === selectedPlan || p._id === selectedPlan)
  const isRenew = selectedClientData?.hasPlan ?? false

  const planDisplayText = (plan: PricingPlan): string => {
    const currency = String(plan.currency || "").toUpperCase() === "SGD" ? "SGD" : "MYR"
    let text = ""
    if (plan.description) text += `${plan.description}\n\n`
    text += `Credit: ${plan.corecredit != null ? plan.corecredit : "-"}\n`
    text += `Price: ${currency} ${plan.sellingprice != null ? plan.sellingprice : "-"}\n\n`
    if (Array.isArray(plan.addon) && plan.addon.length > 0) {
      plan.addon.forEach((a) => {
        if (typeof a === "string") text += `• ${a}\n`
        else if (a && typeof a === "object") text += `• ${(a as { title?: string; name?: string }).title || (a as { title?: string; name?: string }).name || ""}\n`
      })
    }
    return text.trim()
  }

  const handlePricingSubmit = () => {
    if (!selectedClient || !selectedPlan || !paidDate) return
    setConfirmAction("renew")
    setShowConfirm(true)
  }

  const handleTopupSubmit = () => {
    if (!topupClient || !topupAmount || !topupDate) return
    const amount = Number(topupAmount)
    if (!amount || amount <= 0) return
    setConfirmAction("topup")
    setShowConfirm(true)
  }

  const handleConfirm = async () => {
    if (!confirmAction) return
    setIsSubmitting(true)
    setError(null)
    try {
      const paidDateStr = confirmAction === "renew" ? formatPaidDate(paidDate) : formatPaidDate(topupDate)
      if (confirmAction === "renew") {
        await manualRenew({
          clientId: selectedClient,
          planId: selectedPlan,
          paidDate: paidDateStr,
          remark: planRemark,
        })
        setSelectedClient("")
        setSelectedPlan("")
        setPaidDate("")
      } else {
        const completedTopupMode = topupMode
        const ticketRowIdFromDialog =
          manualTopupSourceTicket && (manualTopupSourceTicket._id || manualTopupSourceTicket.id)
            ? String(manualTopupSourceTicket._id || manualTopupSourceTicket.id)
            : undefined
        await manualTopup({
          clientId: topupClient,
          amount: Number(topupAmount),
          paidDate: paidDateStr,
          topupMode,
          ...(ticketRowIdFromDialog ? { ticketRowId: ticketRowIdFromDialog } : {}),
        })
        setTopupDoneLabel({ topupMode: completedTopupMode })
        setManualTopupDialogOpen(false)
        setManualTopupSourceTicket(null)
        setTopupClient("")
        setTopupAmount("")
        setTopupDate("")
        if (ticketRowIdFromDialog) {
          setManualTicketDetail((prev) =>
            prev && String(prev._id || prev.id) === ticketRowIdFromDialog
              ? { ...prev, completedAt: new Date().toISOString() }
              : prev
          )
        }
      }
      await loadData()
      setShowConfirm(false)
      setConfirmAction(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">SaaS Admin</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">Manual billing and client management</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a href="https://www.colivingjb.com">
              <Button variant="outline" size="sm" className="gap-2">
                <Home size={15} /> <span className="hidden sm:inline">Home</span>
              </Button>
            </a>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => {
                clearPortalSession()
                router.push("/portal")
              }}
            >
              <LogOut size={15} /> <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}
        {topupDoneLabel && (
          <div className="mb-4 p-3 rounded-lg border border-green-200 bg-green-50 text-green-950 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100 text-sm flex flex-wrap items-center gap-2">
            <CheckCircle size={16} className="shrink-0 text-green-600 dark:text-green-400" />
            <span>Top-up completed.</span>
            <Badge variant="secondary" className="font-normal border-green-300 bg-white/80 dark:bg-green-900/50">
              {labelForTopupMode(topupDoneLabel.topupMode)}
            </Badge>
            <Button type="button" variant="ghost" size="sm" className="ml-auto h-8 text-green-900 dark:text-green-100" onClick={() => setTopupDoneLabel(null)}>
              Dismiss
            </Button>
          </div>
        )}

        {activeTab === "clients" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <Input placeholder="Search clients..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Status</Label>
                    <Select value={clientStatusFilter} onValueChange={(v) => setClientStatusFilter(v as "all" | "active" | "inactive")}>
                      <SelectTrigger className="w-[120px] h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Pricing plan</Label>
                    <Select value={clientPlanFilter || "all-plans"} onValueChange={(v) => setClientPlanFilter(v === "all-plans" ? "" : v)}>
                      <SelectTrigger className="w-[160px] h-9">
                        <SelectValue placeholder="All plans" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-plans">All plans</SelectItem>
                        {planOptionsForFilter.filter(Boolean).map((planTitle) => (
                          <SelectItem key={planTitle} value={planTitle}>{planTitle}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-2 self-end sm:self-center">
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
                </Button>
              </div>
            </div>
            <Card>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-8 text-center text-muted-foreground">Loading clients...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Client</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase hidden sm:table-cell">Plan</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Balance Credit</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Expires</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredClients.map((client) => {
                          const expStr = client.expiredStr || "-"
                          const isExpiringSoon = expStr !== "-" && new Date(expStr) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                          const isExpired = expStr !== "-" && new Date(expStr) < new Date()
                          const balance = typeof client.balanceCredit === "number" ? client.balanceCredit : 0
                          return (
                            <tr key={client.id} className="border-b hover:bg-muted/50">
                              <td className="px-4 py-3"><p className="font-medium text-foreground">{client.title || client.id}</p></td>
                              <td className="px-4 py-3 hidden sm:table-cell"><Badge variant={client.hasPlan ? "default" : "outline"} className="text-xs">{client.planTitle || "-"}</Badge></td>
                              <td className="px-4 py-3 text-sm text-right tabular-nums">{balance.toLocaleString()}</td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">{expStr}</td>
                              <td className="px-4 py-3">
                                {!client.hasPlan ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><AlertCircle size={12} /> No Plan</span>
                                ) : isExpired ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertCircle size={12} /> Expired</span>
                                ) : isExpiringSoon ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-yellow-600"><Clock size={12} /> Expiring Soon</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle size={12} /> Active</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "dashboard" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-4">
                <p className="text-xs text-muted-foreground uppercase font-semibold">Credit used (this month)</p>
                <p className="text-2xl font-bold mt-1">{creditStats.thisMonth.toLocaleString()}</p>
              </Card>
              <Card className="p-4"><p className="text-xs text-muted-foreground uppercase font-semibold">Total Clients</p><p className="text-2xl font-bold mt-1">{clients.length}</p></Card>
              <Card className="p-4"><p className="text-xs text-muted-foreground uppercase font-semibold">Active Plans</p><p className="text-2xl font-bold mt-1">{clients.filter((c) => c.hasPlan).length}</p></Card>
              <Card className="p-4">
                <p className="text-xs text-muted-foreground uppercase font-semibold">To acknowledge</p>
                <p className="text-2xl font-bold mt-1">{pendingTickets.filter((t) => !t.acknowledgedAt).length}</p>
              </Card>
            </div>
            {creditStats.byMonth.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">Credit used by month</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2 h-48">
                    {[...creditStats.byMonth].reverse().map(({ month, total }) => {
                      const max = Math.max(1, ...creditStats.byMonth.map((m) => m.total))
                      const pct = max ? (total / max) * 100 : 0
                      return (
                        <div key={month} className="flex-1 flex flex-col items-center gap-1 h-full" title={`${month}: ${total.toLocaleString()}`}>
                          <div className="w-full flex-1 flex flex-col justify-end min-h-0">
                            <div
                              className="w-full bg-[var(--brand)]/80 rounded-t min-h-[2px] flex items-end justify-center"
                              style={{ height: `${Math.max(2, pct)}%` }}
                            >
                              {total > 0 && (
                                <span className="text-[10px] font-medium text-white drop-shadow-sm py-0.5">{total.toLocaleString()}</span>
                              )}
                            </div>
                          </div>
                          <span className="text-[10px] text-muted-foreground truncate w-full text-center">{month}</span>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg"><Clock size={18} /> Manual tickets</CardTitle>
                <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-2">
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-8 text-center text-muted-foreground">Loading...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Ticket ID</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Type</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase hidden sm:table-cell">Client</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase hidden md:table-cell">Summary</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingTickets.map((ticket) => (
                          <tr key={ticket._id || ticket.ticketid} className="border-b hover:bg-muted/50">
                            <td className="px-4 py-3 text-sm font-mono">{ticket.ticketid}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1 items-center">
                                <Badge variant="outline" className="text-xs">{ticket.mode === "billing_manual" ? "Billing" : "Top-up"}</Badge>
                                {ticket.completedAt ? (
                                  <Badge variant="outline" className="text-xs border-green-600/40 bg-green-50 text-green-900 dark:bg-green-950/50 dark:text-green-100">
                                    Complete
                                  </Badge>
                                ) : null}
                                {ticket.acknowledgedAt ? (
                                  <Badge variant="secondary" className="text-xs">Acknowledged</Badge>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm hidden sm:table-cell">{ticket.clientTitle}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">{formatManualPendingTicketSummary(ticket)}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">{ticket._createdDate ? new Date(ticket._createdDate).toLocaleDateString() : ""}</td>
                            <td className="px-4 py-3">{renderManualTicketActions(ticket)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "topup" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CreditCard size={18} /> Manual Credit Top-up</CardTitle>
              <p className="text-sm text-muted-foreground mt-1 flex flex-wrap items-center gap-2">
                <span>Type</span>
                <Badge variant="outline" className="font-normal text-xs">
                  {labelForTopupMode(topupMode)}
                </Badge>
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Top-up type</Label>
                  <Select value={topupMode} onValueChange={(v: "free_credit" | "manual_credit") => setTopupMode(v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free_credit">Free Credit (no Bukku invoice)</SelectItem>
                      <SelectItem value="manual_credit">Manual credit (create Bukku invoice)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Client</Label>
                  <Select value={topupClient} onValueChange={setTopupClient}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      {sortedClients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.title || c.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Credit Amount</Label>
                  <Input type="number" placeholder="e.g. 500" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} className="mt-1" min={1} />
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Payment Date</Label>
                  <input type="date" value={topupDate} onChange={(e) => setTopupDate(e.target.value)} className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
                </div>
              </div>
              {topupClient && (
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Selected Client</p>
                  <p className="font-semibold">{sortedClients.find((c) => c.id === topupClient)?.title || topupClient}</p>
                </div>
              )}
              <Button
                onClick={handleTopupSubmit}
                disabled={!topupClient || !topupAmount || !topupDate || Number(topupAmount) <= 0}
                style={{ background: "var(--brand)" }}
                className="w-full sm:w-auto"
              >
                Submit Top-up
              </Button>
            </CardContent>
          </Card>
        )}

        {activeTab === "pricing" && (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Package size={18} /> {isRenew ? "Renew Plan" : "Create Plan"}</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">Client</Label>
                    <Select
                      value={selectedClient}
                      onValueChange={(v) => {
                        setSelectedClient(v)
                        const c = sortedClients.find((x) => x.id === v)
                        if (c?.hasPlan) setPlanRemark("renew")
                        else setPlanRemark("new_customer")
                      }}
                    >
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select client" /></SelectTrigger>
                      <SelectContent>
                        {sortedClients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.title || c.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">Pricing Plan</Label>
                    <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select plan" /></SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={p.id || p._id}>{p.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">Remark</Label>
                    <Select
                      value={isRenew ? (planRemark === "renew" || planRemark === "upgrade" ? planRemark : "renew") : "new_customer"}
                      onValueChange={(v) => setPlanRemark(v as PlanRemark)}
                    >
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {isRenew ? (
                          <>
                            <SelectItem value="renew">Renew</SelectItem>
                            <SelectItem value="upgrade">Upgrade</SelectItem>
                          </>
                        ) : (
                          <SelectItem value="new_customer">Create</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">Payment Date</Label>
                    <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
                  </div>
                </div>
                {selectedPlanData && (
                  <div className="p-4 bg-muted/50 rounded-lg space-y-2 whitespace-pre-wrap text-sm">
                    <p className="font-semibold text-foreground">{selectedPlanData.title}</p>
                    <p className="text-muted-foreground">{planDisplayText(selectedPlanData)}</p>
                  </div>
                )}
                <Button
                  onClick={handlePricingSubmit}
                  disabled={!selectedClient || !selectedPlan || !paidDate}
                  style={{ background: "var(--brand)" }}
                  className="w-full sm:w-auto gap-2"
                >
                  {isRenew ? <RefreshCw size={16} /> : <Plus size={16} />}
                  {isRenew ? "Renew" : "Create"}
                </Button>
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {plans.map((plan) => (
                <Card key={plan.id || plan._id} className="p-5">
                  <h3 className="font-bold text-lg">{plan.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{plan.description || ""}</p>
                  <p className="text-2xl font-bold mt-3">
                    {String(plan.currency || "").toUpperCase()} {plan.sellingprice ?? "-"}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </p>
                  <p className="text-sm mt-1">{(plan.corecredit ?? 0).toLocaleString()} credits</p>
                  {Array.isArray(plan.addon) && plan.addon.length > 0 && (
                    <ul className="mt-4 space-y-1">
                      {plan.addon.map((a, i) => (
                        <li key={i} className="text-sm flex items-center gap-2">
                          <CheckCircle size={14} className="text-green-600" />
                          {typeof a === "string" ? a : (a as { title?: string; name?: string }).title || (a as { title?: string; name?: string }).name || ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === "processing-fees" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Payment Transactions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                  <div className="relative lg:col-span-6">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                    <Input
                      placeholder="Search client / reference..."
                      value={processingFeeSearch}
                      onChange={(e) => setProcessingFeeSearch(e.target.value)}
                      className="h-10 pl-10"
                    />
                  </div>
                  <div className="lg:col-span-3">
                    <Label className="text-xs uppercase text-muted-foreground">Date from</Label>
                    <input
                      type="date"
                      value={processingFeeDateFrom}
                      onChange={(e) => setProcessingFeeDateFrom(e.target.value)}
                      className="mt-1 h-10 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                    />
                  </div>
                  <div className="lg:col-span-3">
                    <Label className="text-xs uppercase text-muted-foreground">Date to</Label>
                    <input
                      type="date"
                      value={processingFeeDateTo}
                      onChange={(e) => setProcessingFeeDateTo(e.target.value)}
                      className="mt-1 h-10 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                  <div className="lg:col-span-4 flex items-center gap-2 min-w-0">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Sort</Label>
                    <Select value={processingFeeSort} onValueChange={(v) => setProcessingFeeSort(v as typeof processingFeeSort)}>
                      <SelectTrigger className="h-10 w-full max-w-[260px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="date_desc">Date (Newest)</SelectItem>
                        <SelectItem value="date_asc">Date (Oldest)</SelectItem>
                        <SelectItem value="fee_desc">Processing Fee (High to Low)</SelectItem>
                        <SelectItem value="fee_asc">Processing Fee (Low to High)</SelectItem>
                        <SelectItem value="client_asc">Client (A-Z)</SelectItem>
                        <SelectItem value="client_desc">Client (Z-A)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="lg:col-span-3">
                    <Label className="text-xs uppercase text-muted-foreground">Currency</Label>
                    <Select value={processingFeeCurrency} onValueChange={(v) => setProcessingFeeCurrency(v as typeof processingFeeCurrency)}>
                      <SelectTrigger className="mt-1 h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="MYR">MYR</SelectItem>
                        <SelectItem value="SGD">SGD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="lg:col-span-5 flex justify-start lg:justify-end">
                  <Button
                    variant="outline"
                    size="default"
                    onClick={async () => {
                      const res = await getProcessingFeeTransactions({
                        dateFrom: processingFeeDateFrom,
                        dateTo: processingFeeDateTo,
                        search: processingFeeSearch,
                        currency: processingFeeCurrency,
                        sort: processingFeeSort,
                        page: processingFeePage,
                        pageSize: processingFeePageSize,
                      })
                      setProcessingFees(Array.isArray(res?.items) ? res.items : [])
                      setProcessingFeeTotal(typeof res?.total === "number" ? res.total : 0)
                      const s = res?.summary
                      setProcessingFeeAggregates({
                        settlement: s?.settlementTotal ?? 0,
                        pending: s?.pendingTotal ?? 0,
                        total: s?.allTotal ?? 0,
                      })
                    }}
                    className="h-10 gap-2"
                  >
                    <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                    Refresh
                  </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <p className="text-xs uppercase text-muted-foreground">Total Payment (Settlement)</p>
                    <p className="text-xl font-semibold mt-1 tabular-nums">
                      {processingFeeAggregates.settlement.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <p className="text-xs uppercase text-muted-foreground">Total Payment (Pending)</p>
                    <p className="text-xl font-semibold mt-1 tabular-nums">
                      {processingFeeAggregates.pending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <p className="text-xs uppercase text-muted-foreground">Total Payment (All)</p>
                    <p className="text-xl font-semibold mt-1 tabular-nums">
                      {processingFeeAggregates.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Currency: {processingFeeCurrency === "all" ? "Mixed" : processingFeeCurrency}
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Client</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Provider</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Currency</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Total Payment (Deduction Credit)</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processingFees.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">
                            No payment transaction found.
                          </td>
                        </tr>
                      ) : (
                        processingFees.map((row) => (
                          <tr key={row.id} className="border-b hover:bg-muted/50">
                            <td className="px-4 py-3 text-sm font-medium">{row.clientTitle || "-"}</td>
                            <td className="px-4 py-3 text-sm capitalize">{row.type}</td>
                            <td className="px-4 py-3 text-sm">
                              <Badge variant="outline" className="inline-flex items-center gap-1.5">
                                {row.serviceProvider === "xendit" ? <Landmark size={12} /> : <CircleDollarSign size={12} />}
                                {row.serviceProvider === "xendit" ? "Xendit" : row.serviceProvider === "billplz" ? "Billplz" : "Stripe"}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <Badge
                                variant={
                                  row.status === "pending"
                                    ? "outline"
                                    : row.status === "failed"
                                      ? "destructive"
                                      : "default"
                                }
                                className="capitalize"
                              >
                                {row.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-sm">{row.currency || "-"}</td>
                            <td className="px-4 py-3 text-sm text-right tabular-nums">{formatPaymentWithCredits(row)}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "-"}</td>
                            <td className="px-4 py-3 text-sm">
                              <Button size="sm" variant="outline" onClick={() => setProcessingFeeDetail(row)}>
                                Detail
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between pt-2 border-t border-border">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</Label>
                    <Select
                      value={String(processingFeePageSize)}
                      onValueChange={(v) => setProcessingFeePageSize(Number(v) as 10 | 20 | 50 | 100 | 200)}
                    >
                      <SelectTrigger className="h-9 w-[88px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {processingFeeTotal === 0
                        ? "0 results"
                        : `Showing ${processingFeeRangeStart}–${processingFeeRangeEnd} of ${processingFeeTotal}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground tabular-nums">
                      Page {processingFeePage} of {processingFeeTotalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={processingFeePage <= 1}
                      onClick={() => setProcessingFeePage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft size={16} className="mr-0.5" />
                      Prev
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={processingFeePage >= processingFeeTotalPages}
                      onClick={() => setProcessingFeePage((p) => p + 1)}
                    >
                      Next
                      <ChevronRight size={16} className="ml-0.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Dialog open={!!processingFeeDetail} onOpenChange={(open) => !open && setProcessingFeeDetail(null)}>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Payment Detail</DialogTitle>
                  <DialogDescription>Tenant, property/room, tenancy, total payment, and deducted credit.</DialogDescription>
                </DialogHeader>
                {processingFeeDetail && (
                  <div className="grid gap-4 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><span className="text-muted-foreground">Client:</span> <span className="font-medium">{processingFeeDetail.clientTitle || "—"}</span></div>
                      <div><span className="text-muted-foreground">Provider:</span> <span className="font-medium capitalize">{processingFeeDetail.serviceProvider}</span></div>
                      <div><span className="text-muted-foreground">Type:</span> <span className="font-medium capitalize">{processingFeeDetail.type}</span></div>
                      <div><span className="text-muted-foreground">Status:</span> <span className="font-medium capitalize">{processingFeeDetail.status}</span></div>
                      {(processingFeeDetail.serviceProvider === "billplz" || processingFeeDetail.serviceProvider === "xendit") &&
                        processingFeeDetail.payoutAt && (
                          <div>
                            <span className="text-muted-foreground">Payout to bank:</span>{" "}
                            <span className="font-medium">
                              {new Date(processingFeeDetail.payoutAt).toLocaleString()}
                            </span>
                          </div>
                        )}
                      <div><span className="text-muted-foreground">Total payment (deduction credit):</span> <span className="font-medium">{formatPaymentWithCredits(processingFeeDetail)}</span></div>
                      <div><span className="text-muted-foreground">Currency:</span> <span className="font-medium">{processingFeeDetail.currency || "—"}</span></div>
                      <div><span className="text-muted-foreground">Deduction credit:</span> <span className="font-medium">{Number(processingFeeDetail.deductedCredits || 0).toLocaleString()}</span></div>
                      <div><span className="text-muted-foreground">Date:</span> <span className="font-medium">{processingFeeDetail.createdAt ? new Date(processingFeeDetail.createdAt).toLocaleString() : "—"}</span></div>
                    </div>
                    <div className="border rounded-md p-3 bg-muted/20">
                      <p className="text-xs uppercase text-muted-foreground mb-2">Tenant / Property / Room</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div><span className="text-muted-foreground">Tenant:</span> <span className="font-medium">{processingFeeDetail.details?.tenantName || "—"}</span></div>
                        <div><span className="text-muted-foreground">Property:</span> <span className="font-medium">{processingFeeDetail.details?.propertyName || "—"}</span></div>
                        <div><span className="text-muted-foreground">Room:</span> <span className="font-medium">{processingFeeDetail.details?.roomName || "—"}</span></div>
                      </div>
                    </div>
                    <div className="border rounded-md p-3 bg-muted/20">
                      <p className="text-xs uppercase text-muted-foreground mb-2">General Detail</p>
                      <div className="grid grid-cols-1 gap-2">
                        <div><span className="text-muted-foreground">Tenancy ID:</span> <span className="font-mono text-xs sm:text-sm">{processingFeeDetail.details?.tenancyId || "—"}</span></div>
                        <div><span className="text-muted-foreground">Payment ID:</span> <span className="font-mono text-xs sm:text-sm">{processingFeeDetail.details?.paymentId || processingFeeDetail.referenceNumber || "—"}</span></div>
                        <div><span className="text-muted-foreground">Reference:</span> <span className="font-mono text-xs sm:text-sm">{processingFeeDetail.referenceNumber || "—"}</span></div>
                      </div>
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setProcessingFeeDetail(null)}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {activeTab === "meters" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>All Meter List (Cross Operator)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                  <div className="relative lg:col-span-6">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                    <Input
                      placeholder="Search meter / operator / property / room..."
                      value={meterSearch}
                      onChange={(e) => setMeterSearch(e.target.value)}
                      className="h-10 pl-10"
                    />
                  </div>
                  <div className="lg:col-span-4">
                    <Label className="text-xs uppercase text-muted-foreground">Filter by operator</Label>
                    <Select value={meterOperatorFilter || "all-operators"} onValueChange={(v) => setMeterOperatorFilter(v === "all-operators" ? "" : v)}>
                      <SelectTrigger className="mt-1 h-10">
                        <SelectValue placeholder="All operators" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-operators">All operators</SelectItem>
                        {sortedClients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.title || c.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="lg:col-span-2 flex justify-start lg:justify-end">
                    <Button
                      variant="outline"
                      className="h-10 gap-2"
                      onClick={async () => {
                        const res = await getSaasAdminMeters({
                          search: meterSearch,
                          operatorId: meterOperatorFilter,
                          page: meterPage,
                          pageSize: meterPageSize,
                        })
                        setAllMeters(Array.isArray(res?.items) ? res.items : [])
                        setMeterTotal(typeof res?.total === "number" ? res.total : 0)
                      }}
                    >
                      <RefreshCw size={16} />
                      Refresh
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Meter</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Current Operator</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Property / Room</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Mode</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Change Operator</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allMeters.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                            No meter found.
                          </td>
                        </tr>
                      ) : (
                        allMeters.map((m) => (
                          <tr key={m.id} className="border-b hover:bg-muted/50">
                            <td className="px-4 py-3 text-sm">
                              <p className="font-medium">{m.title || "-"}</p>
                              <p className="text-xs text-muted-foreground font-mono">{m.meterId || m.id}</p>
                            </td>
                            <td className="px-4 py-3 text-sm">{m.operatorTitle || m.operatorId || "-"}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">{(m.propertyTitle || "-")}{m.roomTitle ? ` / ${m.roomTitle}` : ""}</td>
                            <td className="px-4 py-3 text-sm capitalize">{m.mode || "-"}</td>
                            <td className="px-4 py-3 text-sm">
                              <Badge variant={m.status ? "default" : "outline"}>{m.status ? "Active" : "Inactive"}</Badge>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2 min-w-[280px]">
                                <Select
                                  value={meterTargetById[m.id] || "none"}
                                  onValueChange={(v) => setMeterTargetById((prev) => ({ ...prev, [m.id]: v === "none" ? "" : v }))}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select new operator" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Select new operator</SelectItem>
                                    {sortedClients.filter((c) => c.id !== m.operatorId).map((c) => (
                                      <SelectItem key={c.id} value={c.id}>{c.title || c.id}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="sm"
                                  disabled={!meterTargetById[m.id] || movingMeterId === m.id}
                                  onClick={async () => {
                                    const toOperatorId = meterTargetById[m.id]
                                    if (!toOperatorId) return
                                    if (!window.confirm(`Move meter ${m.meterId || m.title} from ${m.operatorTitle || m.operatorId} to selected operator?`)) return
                                    setMovingMeterId(m.id)
                                    setError(null)
                                    try {
                                      await moveMeterToOperator({ meterId: m.id, toOperatorId })
                                      const res = await getSaasAdminMeters({
                                        search: meterSearch,
                                        operatorId: meterOperatorFilter,
                                        page: meterPage,
                                        pageSize: meterPageSize,
                                      })
                                      setAllMeters(Array.isArray(res?.items) ? res.items : [])
                                      setMeterTotal(typeof res?.total === "number" ? res.total : 0)
                                      setMeterTargetById((prev) => ({ ...prev, [m.id]: "" }))
                                    } catch (e) {
                                      setError(e instanceof Error ? e.message : "Move meter failed")
                                    } finally {
                                      setMovingMeterId(null)
                                    }
                                  }}
                                >
                                  {movingMeterId === m.id ? "Moving..." : "Change"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between pt-2 border-t border-border">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</Label>
                    <Select value={String(meterPageSize)} onValueChange={(v) => setMeterPageSize(Number(v) as 20 | 50 | 100)}>
                      <SelectTrigger className="h-9 w-[88px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {meterTotal === 0 ? "0 results" : `Showing ${meterRangeStart}-${meterRangeEnd} of ${meterTotal}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground tabular-nums">Page {meterPage} of {meterTotalPages}</span>
                    <Button type="button" variant="outline" size="sm" className="h-9" disabled={meterPage <= 1} onClick={() => setMeterPage((p) => Math.max(1, p - 1))}>
                      <ChevronLeft size={16} className="mr-0.5" />
                      Prev
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-9" disabled={meterPage >= meterTotalPages} onClick={() => setMeterPage((p) => p + 1)}>
                      Next
                      <ChevronRight size={16} className="ml-0.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "properties" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>All Property (Cross Operator)</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Changing operator moves the property, all its rooms, linked meters, active tenancies (by room), and rentalcollection rows for this property.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                  <div className="relative lg:col-span-6">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                    <Input
                      placeholder="Search property name / address / operator / id..."
                      value={propertySearch}
                      onChange={(e) => setPropertySearch(e.target.value)}
                      className="h-10 pl-10"
                    />
                  </div>
                  <div className="lg:col-span-4">
                    <Label className="text-xs uppercase text-muted-foreground">Filter by operator</Label>
                    <Select
                      value={propertyOperatorFilter || "all-operators"}
                      onValueChange={(v) => setPropertyOperatorFilter(v === "all-operators" ? "" : v)}
                    >
                      <SelectTrigger className="mt-1 h-10">
                        <SelectValue placeholder="All operators" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-operators">All operators</SelectItem>
                        {sortedClients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.title || c.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="lg:col-span-2 flex justify-start lg:justify-end">
                    <Button
                      variant="outline"
                      className="h-10 gap-2"
                      onClick={async () => {
                        const res = await getSaasAdminProperties({
                          search: propertySearch,
                          operatorId: propertyOperatorFilter,
                          page: propertyPage,
                          pageSize: propertyPageSize,
                        })
                        setAllProperties(Array.isArray(res?.items) ? res.items : [])
                        setPropertyTotal(typeof res?.total === "number" ? res.total : 0)
                      }}
                    >
                      <RefreshCw size={16} />
                      Refresh
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Property</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Rooms</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Current Operator</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Change Operator</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allProperties.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">
                            No property found.
                          </td>
                        </tr>
                      ) : (
                        allProperties.map((p) => (
                          <tr key={p.id} className="border-b hover:bg-muted/50">
                            <td className="px-4 py-3 text-sm">
                              <p className="font-medium">{p.shortname || p.apartmentname || "—"}</p>
                              <p className="text-xs text-muted-foreground line-clamp-2">{p.address || "—"}</p>
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">{p.id}</p>
                            </td>
                            <td className="px-4 py-3 text-sm tabular-nums">{p.roomCount}</td>
                            <td className="px-4 py-3 text-sm">{p.operatorTitle || p.operatorId || "—"}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2 min-w-[280px]">
                                <Select
                                  value={propertyTargetById[p.id] || "none"}
                                  onValueChange={(v) =>
                                    setPropertyTargetById((prev) => ({ ...prev, [p.id]: v === "none" ? "" : v }))
                                  }
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select new operator" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Select new operator</SelectItem>
                                    {sortedClients
                                      .filter((c) => c.id !== p.operatorId)
                                      .map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                          {c.title || c.id}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="sm"
                                  disabled={!propertyTargetById[p.id] || movingPropertyId === p.id}
                                  onClick={async () => {
                                    const toOperatorId = propertyTargetById[p.id]
                                    if (!toOperatorId) return
                                    const label = p.shortname || p.apartmentname || p.id
                                    if (
                                      !window.confirm(
                                        `Move property "${label}" and ${p.roomCount} room(s) from ${p.operatorTitle || p.operatorId} to the selected operator?`
                                      )
                                    )
                                      return
                                    setMovingPropertyId(p.id)
                                    setError(null)
                                    try {
                                      await movePropertyToOperator({ propertyId: p.id, toOperatorId })
                                      const res = await getSaasAdminProperties({
                                        search: propertySearch,
                                        operatorId: propertyOperatorFilter,
                                        page: propertyPage,
                                        pageSize: propertyPageSize,
                                      })
                                      setAllProperties(Array.isArray(res?.items) ? res.items : [])
                                      setPropertyTotal(typeof res?.total === "number" ? res.total : 0)
                                      setPropertyTargetById((prev) => ({ ...prev, [p.id]: "" }))
                                    } catch (e) {
                                      setError(e instanceof Error ? e.message : "Move property failed")
                                    } finally {
                                      setMovingPropertyId(null)
                                    }
                                  }}
                                >
                                  {movingPropertyId === p.id ? "Moving..." : "Change"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between pt-2 border-t border-border">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</Label>
                    <Select
                      value={String(propertyPageSize)}
                      onValueChange={(v) => setPropertyPageSize(Number(v) as 20 | 50 | 100)}
                    >
                      <SelectTrigger className="h-9 w-[88px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {propertyTotal === 0
                        ? "0 results"
                        : `Showing ${propertyRangeStart}-${propertyRangeEnd} of ${propertyTotal}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground tabular-nums">
                      Page {propertyPage} of {propertyTotalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={propertyPage <= 1}
                      onClick={() => setPropertyPage((pg) => Math.max(1, pg - 1))}
                    >
                      <ChevronLeft size={16} className="mr-0.5" />
                      Prev
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={propertyPage >= propertyTotalPages}
                      onClick={() => setPropertyPage((pg) => pg + 1)}
                    >
                      Next
                      <ChevronRight size={16} className="ml-0.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "enquiry" && (
          <div className="space-y-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Clock size={18} /> Manual top-up & billing
                </CardTitle>
                <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-2">
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <p className="text-sm text-muted-foreground px-4 pb-2">
                  Operators who chose <strong className="text-foreground">manual payment</strong> (skip card fees) — process in{" "}
                  <a href="/saas-admin?tab=topup" className="text-[var(--brand)] font-semibold underline">
                    Top-up
                  </a>{" "}
                  or{" "}
                  <a href="/saas-admin?tab=pricing" className="text-[var(--brand)] font-semibold underline">
                    Pricing
                  </a>
                  . Same list as Dashboard → Manual tickets.
                </p>
                {loading ? (
                  <div className="p-8 text-center text-muted-foreground">Loading...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Ticket ID</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Type</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase hidden sm:table-cell">Client</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase hidden md:table-cell">Summary</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingTickets.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                              No manual top-up or billing tickets.
                            </td>
                          </tr>
                        ) : (
                          pendingTickets.map((ticket) => (
                            <tr key={ticket._id || ticket.ticketid} className="border-b hover:bg-muted/50">
                              <td className="px-4 py-3 text-sm font-mono">{ticket.ticketid}</td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1 items-center">
                                  <Badge variant="outline" className="text-xs">
                                    {ticket.mode === "billing_manual" ? "Plan / bill" : ticket.mode === "topup_manual" ? "Top-up" : ticket.mode}
                                  </Badge>
                                  {ticket.completedAt ? (
                                    <Badge variant="outline" className="text-xs border-green-600/40 bg-green-50 text-green-900 dark:bg-green-950/50 dark:text-green-100">
                                      Complete
                                    </Badge>
                                  ) : null}
                                  {ticket.acknowledgedAt ? (
                                    <Badge variant="secondary" className="text-xs">Acknowledged</Badge>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm hidden sm:table-cell">{ticket.clientTitle}</td>
                              <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">{formatManualPendingTicketSummary(ticket)}</td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                {ticket._createdDate ? new Date(ticket._createdDate).toLocaleDateString() : "—"}
                              </td>
                              <td className="px-4 py-3">{renderManualTicketActions(ticket)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2"><Mail size={18} /> SAAS Enquiry</CardTitle>
                <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-2">
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <p className="text-sm text-muted-foreground px-4 pb-2">Operator enquiries from enquiry / pricing page (client lead, status=0).</p>
                {loading && saasEnquiries.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">Loading...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Company / Title</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Email</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase hidden sm:table-cell">Contact</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {saasEnquiries.length === 0 ? (
                          <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No SAAS enquiries yet.</td></tr>
                        ) : (
                          saasEnquiries.map((row) => (
                            <tr key={row.id} className="border-b hover:bg-muted/50">
                              <td className="px-4 py-3 font-medium">{row.title || "—"}</td>
                              <td className="px-4 py-3 text-sm">{row.email || "—"}</td>
                              <td className="px-4 py-3 text-sm hidden sm:table-cell">{row.contact || "—"}</td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"}</td>
                              <td className="px-4 py-3 flex flex-wrap gap-2 items-center">
                                <Button size="sm" variant="outline" onClick={() => setEnquiryDetailSaas(row)}>Detail</Button>
                                {row.acknowledgedAt ? (
                                  <span className="text-xs text-muted-foreground select-none">Acknowledged</span>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={acknowledgingId === `saas:${row.id}`}
                                    onClick={async () => {
                                      setAcknowledgingId(`saas:${row.id}`)
                                      try {
                                        await acknowledgeSaasEnquiry(row.id)
                                        acknowledgedSaasIdsRef.current.add(row.id)
                                        const ts = new Date().toISOString()
                                        setSaasEnquiries((prev) =>
                                          prev.map((e) => (e.id === row.id ? { ...e, acknowledgedAt: ts } : e))
                                        )
                                        await loadData()
                                      } finally {
                                        setAcknowledgingId(null)
                                      }
                                    }}
                                  >
                                    {acknowledgingId === `saas:${row.id}` ? "…" : "Acknowledge"}
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">Management Enquiry</CardTitle>
                <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-2">
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <p className="text-sm text-muted-foreground px-4 pb-2">Owner enquiries from ownerenquiry page (owners looking for operator).</p>
                {loading && ownerEnquiries.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">Loading...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Name / Company</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Email</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase hidden sm:table-cell">Units</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ownerEnquiries.length === 0 ? (
                          <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No management enquiries yet.</td></tr>
                        ) : (
                          ownerEnquiries.map((row) => (
                            <tr key={row.id} className="border-b hover:bg-muted/50">
                              <td className="px-4 py-3 font-medium">{row.name || row.company || "—"}</td>
                              <td className="px-4 py-3 text-sm">{row.email || "—"}</td>
                              <td className="px-4 py-3 text-sm hidden sm:table-cell">{row.units || "—"}</td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"}</td>
                              <td className="px-4 py-3 flex flex-wrap gap-2 items-center">
                                <Button size="sm" variant="outline" onClick={() => setEnquiryDetailOwner(row)}>Detail</Button>
                                {row.acknowledgedAt ? (
                                  <span className="text-xs text-muted-foreground select-none">Acknowledged</span>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={acknowledgingId === `owner:${row.id}`}
                                    onClick={async () => {
                                      setAcknowledgingId(`owner:${row.id}`)
                                      try {
                                        await acknowledgeOwnerEnquiry(row.id)
                                        acknowledgedOwnerIdsRef.current.add(row.id)
                                        const ts = new Date().toISOString()
                                        setOwnerEnquiries((prev) =>
                                          prev.map((e) => (e.id === row.id ? { ...e, acknowledgedAt: ts } : e))
                                        )
                                        await loadData()
                                      } finally {
                                        setAcknowledgingId(null)
                                      }
                                    }}
                                  >
                                    {acknowledgingId === `owner:${row.id}` ? "…" : "Acknowledge"}
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="gap-1"
                                  disabled={acknowledgingId === `owner-del:${row.id}`}
                                  onClick={async () => {
                                    const label = row.email || row.name || row.company || "this enquiry"
                                    if (!window.confirm(`Delete this management enquiry (${label})? This cannot be undone.`)) return
                                    setAcknowledgingId(`owner-del:${row.id}`)
                                    try {
                                      await deleteOwnerEnquiry(row.id)
                                      setOwnerEnquiries((prev) => prev.filter((e) => e.id !== row.id))
                                      if (enquiryDetailOwner?.id === row.id) setEnquiryDetailOwner(null)
                                      await loadData()
                                    } catch (e) {
                                      setError(e instanceof Error ? e.message : "Delete failed")
                                    } finally {
                                      setAcknowledgingId(null)
                                    }
                                  }}
                                  title="Permanently delete this row"
                                >
                                  <Trash2 size={14} />
                                  {acknowledgingId === `owner-del:${row.id}` ? "…" : "Delete"}
                                </Button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            <Dialog open={!!enquiryDetailSaas} onOpenChange={(open) => !open && setEnquiryDetailSaas(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>SAAS Enquiry – Detail</DialogTitle>
                  <DialogDescription>Submitted from enquiry / pricing page.</DialogDescription>
                </DialogHeader>
                {enquiryDetailSaas && (
                  <div className="grid gap-3 text-sm">
                    <div><span className="text-muted-foreground">Company / Title:</span> <span className="font-medium">{enquiryDetailSaas.title || "—"}</span></div>
                    <div><span className="text-muted-foreground">Email:</span> <span className="font-medium">{enquiryDetailSaas.email || "—"}</span></div>
                    <div><span className="text-muted-foreground">Contact:</span> <span className="font-medium">{enquiryDetailSaas.contact || "—"}</span></div>
                    <div><span className="text-muted-foreground">Currency:</span> <span className="font-medium">{enquiryDetailSaas.currency || "—"}</span></div>
                    <div><span className="text-muted-foreground">Account number:</span> <span className="font-medium">{enquiryDetailSaas.accountNumber || "—"}</span></div>
                    <div><span className="text-muted-foreground">Bank ID:</span> <span className="font-medium">{enquiryDetailSaas.bankId || "—"}</span></div>
                    <div><span className="text-muted-foreground">Remark:</span> <span className="font-medium">{enquiryDetailSaas.remark || "—"}</span></div>
                    <div><span className="text-muted-foreground">Number of units:</span> <span className="font-medium">{enquiryDetailSaas.numberOfUnits || "—"}</span></div>
                    <div><span className="text-muted-foreground">Plan of interest:</span> <span className="font-medium">{enquiryDetailSaas.planOfInterest || "—"}</span></div>
                    <div><span className="text-muted-foreground">Submitted:</span> <span className="font-medium">{enquiryDetailSaas.createdAt ? new Date(enquiryDetailSaas.createdAt).toLocaleString() : "—"}</span></div>
                    {enquiryDetailSaas.profilePhoto && (
                      <div><span className="text-muted-foreground">Profile photo:</span> <a href={enquiryDetailSaas.profilePhoto} target="_blank" rel="noopener noreferrer" className="text-[var(--brand)] underline">View</a></div>
                    )}
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEnquiryDetailSaas(null)}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={!!enquiryDetailOwner} onOpenChange={(open) => !open && setEnquiryDetailOwner(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Management Enquiry – Detail</DialogTitle>
                  <DialogDescription>Submitted from owner enquiry page (owner looking for operator).</DialogDescription>
                </DialogHeader>
                {enquiryDetailOwner && (
                  <div className="grid gap-3 text-sm">
                    <div><span className="text-muted-foreground">Full name:</span> <span className="font-medium">{enquiryDetailOwner.name || "—"}</span></div>
                    <div><span className="text-muted-foreground">Company / Property:</span> <span className="font-medium">{enquiryDetailOwner.company || "—"}</span></div>
                    <div><span className="text-muted-foreground">Email:</span> <span className="font-medium">{enquiryDetailOwner.email || "—"}</span></div>
                    <div><span className="text-muted-foreground">Phone:</span> <span className="font-medium">{enquiryDetailOwner.phone || "—"}</span></div>
                    <div><span className="text-muted-foreground">Number of units:</span> <span className="font-medium">{enquiryDetailOwner.units || "—"}</span></div>
                    <div><span className="text-muted-foreground">Message:</span> <p className="font-medium mt-1 whitespace-pre-wrap">{enquiryDetailOwner.message || "—"}</p></div>
                    <div><span className="text-muted-foreground">Country:</span> <span className="font-medium">{enquiryDetailOwner.country || "—"}</span></div>
                    <div><span className="text-muted-foreground">Currency:</span> <span className="font-medium">{enquiryDetailOwner.currency || "—"}</span></div>
                    <div><span className="text-muted-foreground">Submitted:</span> <span className="font-medium">{enquiryDetailOwner.createdAt ? new Date(enquiryDetailOwner.createdAt).toLocaleString() : "—"}</span></div>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEnquiryDetailOwner(null)}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {activeTab === "apidocs" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BookOpen size={18} /> API Docs Access</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">Select a client and click Add user to generate API docs credentials. Operators of that client will see the API Docs card on the portal and can open /docs without another login.</p>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-col sm:flex-row gap-4 items-end">
                  <div className="flex-1 min-w-0">
                    <Label className="text-xs uppercase text-muted-foreground">Client</Label>
                    <Select value={apiDocsClientId} onValueChange={setApiDocsClientId}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select client" /></SelectTrigger>
                      <SelectContent>
                        {sortedClients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.title || c.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={async () => {
                      if (!apiDocsClientId) return
                      setApiDocsError(null)
                      setApiDocsSubmitting(true)
                      try {
                        const res = await createApiDocsUserForClient(apiDocsClientId)
                        const clientTitle = sortedClients.find((c) => c.id === apiDocsClientId)?.title || apiDocsClientId
                        setShowGeneratedCreds({
                          username: res.user?.username || "",
                          plainPassword: res.plainPassword || "",
                          clientTitle,
                        })
                        setApiDocsClientId("")
                        await loadApiDocsUsers()
                      } catch (e) {
                        setApiDocsError(e instanceof Error ? e.message : "Create failed")
                      } finally {
                        setApiDocsSubmitting(false)
                      }
                    }}
                    disabled={!apiDocsClientId || apiDocsSubmitting}
                    style={{ background: "var(--brand)" }}
                  >
                    {apiDocsSubmitting ? "Adding…" : "Add user"}
                  </Button>
                </div>
                {apiDocsError && (
                  <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle size={14} /> {apiDocsError}</p>
                )}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Client</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Username</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Access docs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiDocsUsers.map((u) => {
                        const canAccess = !!u.can_access_docs
                        const clientTitle = u.client_id ? (sortedClients.find((c) => c.id === u.client_id)?.title || u.client_id) : "-"
                        return (
                          <tr key={u.id} className="border-b hover:bg-muted/50">
                            <td className="px-4 py-3 text-sm text-foreground">{clientTitle}</td>
                            <td className="px-4 py-3 font-medium text-foreground">{u.username}</td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await setApiDocsUserCanAccess(u.id, !canAccess)
                                    await loadApiDocsUsers()
                                  } catch (e) {
                                    setApiDocsError(e instanceof Error ? e.message : "Update failed")
                                  }
                                }}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium ${canAccess ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"}`}
                              >
                                {canAccess ? <CheckCircle size={12} /> : null}
                                {canAccess ? "Yes" : "No"}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {apiDocsUsers.length === 0 && (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">No API docs users yet. Select a client and click Add user.</p>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={loadApiDocsUsers} disabled={loading} className="gap-2">
                  <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
                </Button>
              </CardContent>
            </Card>
            <Dialog open={!!showGeneratedCreds} onOpenChange={(open) => !open && setShowGeneratedCreds(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>API docs credentials created</DialogTitle>
                  <DialogDescription>
                    For <strong>{showGeneratedCreds?.clientTitle}</strong>. Share these with the operator once; the password cannot be viewed again.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 font-mono text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Username</p>
                    <p className="break-all bg-muted px-2 py-1 rounded mt-0.5">{showGeneratedCreds?.username}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Password (show once)</p>
                    <p className="break-all bg-muted px-2 py-1 rounded mt-0.5">{showGeneratedCreds?.plainPassword}</p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowGeneratedCreds(null)}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm {confirmAction === "renew" ? "Plan Update" : "Credit Top-up"}</DialogTitle>
            {confirmAction === "renew" ? (
              <DialogDescription>
                {isRenew ? "Renew" : "Create"} <strong>{selectedPlanData?.title}</strong> plan for <strong>{selectedClientData?.title}</strong>?
              </DialogDescription>
            ) : (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Add <strong>{topupAmount}</strong> credits to <strong>{sortedClients.find((c) => c.id === topupClient)?.title || topupClient}</strong>?
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span>Type</span>
                  <Badge variant="secondary" className="font-normal text-foreground">{labelForTopupMode(topupMode)}</Badge>
                </div>
              </div>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={isSubmitting}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleConfirm} disabled={isSubmitting}>{isSubmitting ? "Processing..." : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={manualTopupDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setManualTopupDialogOpen(false)
            setManualTopupSourceTicket(null)
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Manual top-up</DialogTitle>
            <DialogDescription className="text-left space-y-1">
              {manualTopupSourceTicket ? (
                <>
                  <span>
                    Ticket <span className="font-mono">{manualTopupSourceTicket.ticketid}</span>
                  </span>
                  <span className="block text-muted-foreground">{formatManualPendingTicketSummary(manualTopupSourceTicket)}</span>
                </>
              ) : (
                "Enter top-up details."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs uppercase text-muted-foreground">Type</span>
              <Badge variant="outline" className="font-normal max-w-full truncate">{labelForTopupMode(topupMode)}</Badge>
            </div>
            {/* Full-width rows for long Select labels; SelectTrigger uses w-fit by default and overflows narrow grids */}
            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Top-up type</Label>
              <Select value={topupMode} onValueChange={(v: "free_credit" | "manual_credit") => setTopupMode(v)}>
                <SelectTrigger className="mt-0 w-full min-w-0 max-w-full [&_[data-slot=select-value]]:truncate">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free_credit">Free Credit (no Bukku invoice)</SelectItem>
                  <SelectItem value="manual_credit">Manual credit (create Bukku invoice)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Client</Label>
              <Select value={topupClient} onValueChange={setTopupClient}>
                <SelectTrigger className="mt-0 w-full min-w-0 max-w-full [&_[data-slot=select-value]]:truncate">
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {sortedClients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.title || c.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-4 min-w-0">
              <div className="min-w-0">
                <Label className="text-xs uppercase text-muted-foreground">Credit amount</Label>
                <Input type="number" placeholder="e.g. 500" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} className="mt-1 w-full min-w-0" min={1} />
              </div>
              <div className="min-w-0">
                <Label className="text-xs uppercase text-muted-foreground">Payment date</Label>
                <input type="date" value={topupDate} onChange={(e) => setTopupDate(e.target.value)} className="mt-1 w-full min-w-0 border border-border rounded-lg px-3 py-2 text-sm bg-background" />
              </div>
            </div>
            {topupClient ? (
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Selected client</p>
                <p className="font-semibold">{sortedClients.find((c) => c.id === topupClient)?.title || topupClient}</p>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setManualTopupDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              style={{ background: "var(--brand)" }}
              onClick={handleTopupSubmit}
              disabled={!topupClient || !topupAmount || !topupDate || Number(topupAmount) <= 0}
            >
              Submit top-up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!manualTicketDetail} onOpenChange={(open) => !open && setManualTicketDetail(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manual ticket</DialogTitle>
            <DialogDescription className="font-mono text-xs">{manualTicketDetail?.ticketid}</DialogDescription>
          </DialogHeader>
          {manualTicketDetail && (() => {
            const receiptUrl = extractReceiptUrlFromTicketDescription(manualTicketDetail.description || "")
            return (
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground uppercase">Client</span>
                  <p className="mt-0.5">{manualTicketDetail.clientTitle || "—"}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground uppercase">Type</span>
                  <p className="mt-0.5 flex flex-wrap gap-1.5 items-center">
                    <Badge variant="outline" className="text-xs font-normal">
                      {manualTicketDetail.mode === "billing_manual" ? "Plan / billing" : manualTicketDetail.mode === "topup_manual" ? "Top-up" : manualTicketDetail.mode}
                    </Badge>
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground uppercase">Status</span>
                  <p className="mt-0.5 flex flex-wrap gap-1.5 items-center">
                    {manualTicketDetail.completedAt ? (
                      <Badge variant="outline" className="text-xs border-green-600/40 bg-green-50 text-green-900">Complete</Badge>
                    ) : null}
                    {manualTicketDetail.acknowledgedAt ? (
                      <Badge variant="secondary" className="text-xs">Acknowledged</Badge>
                    ) : null}
                    {!manualTicketDetail.completedAt && !manualTicketDetail.acknowledgedAt ? (
                      <span className="text-foreground">Pending</span>
                    ) : null}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground uppercase">Summary</span>
                  <p className="mt-0.5">{formatManualPendingTicketSummary(manualTicketDetail)}</p>
                </div>
                {receiptUrl ? (
                  <a
                    href={receiptUrlForBrowserOpen(receiptUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-[var(--brand)] underline text-sm"
                  >
                    Open receipt
                  </a>
                ) : null}
              </div>
            )
          })()}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setManualTicketDetail(null)}>
              Close
            </Button>
            {manualTicketDetail ? (
              <>
                {manualTicketDetail.mode === "topup_manual" ? (
                  manualTicketDetail.completedAt ? (
                    <Button type="button" variant="secondary" disabled>
                      Completed
                    </Button>
                  ) : (
                    <Button
                      style={{ background: "var(--brand)" }}
                      onClick={() => {
                        const t = manualTicketDetail
                        setManualTicketDetail(null)
                        openManualTopupFromTicket(t)
                      }}
                    >
                      Fill top-up form
                    </Button>
                  )
                ) : (
                  <Button
                    style={{ background: "var(--brand)" }}
                    onClick={() => {
                      setSelectedClient(manualTicketDetail.client_id || "")
                      setManualTicketDetail(null)
                      router.push("/saas-admin?tab=pricing")
                    }}
                  >
                    Go to pricing
                  </Button>
                )}
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
