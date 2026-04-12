"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  Coins, TrendingUp, TrendingDown, FileText, Home, Search,
  Upload, CreditCard, Zap, AlertTriangle,
  CheckCircle, ArrowUpRight, ArrowDownRight, ExternalLink,
  CircleDollarSign,
} from "lucide-react"
import { useOperatorContext } from "@/contexts/operator-context"
import { getCurrentRole } from "@/lib/portal-session"
import {
  getStatementItems,
  getMyBillingInfo,
  getPlans,
  getCreditPlans,
  submitManualTopupRequest,
  getActiveRoomCount,
  getStatementExportUrl,
  startTopup,
  submitTicket,
  syncTopupFromBillplz,
  syncTopupFromXendit,
  syncTopupFromStripe,
} from "@/lib/operator-api"
import { SaasStripeFeeConfirmDialog } from "@/components/saas-stripe-fee-confirm-dialog"
import { flexTopupCustomPayment, flexTopupUnitPerCredit, FLEX_TOPUP_CARD_TIERS } from "@/lib/flex-topup-custom-amount"
import { ManualPaymentEmailHint } from "@/components/manual-payment-email-hint"

type TransactionType =
  | "subscription"
  | "agreement_created"
  | "agreement_uploaded"
  | "room_monthly"
  | "topup"
  | "adjustment"
  | "tenant_payment"

interface CreditTransaction {
  id: string
  date: string
  type: TransactionType
  description: string
  reference?: string
  amount: number
  balance?: number
  invoiceUrl?: string | null
  status?: "Paid" | "Pending"
}

function inferTransactionType(item: { type: string; title?: string; amount: number }): TransactionType {
  if (item.type === "plan") return "subscription"
  const t = (item.title || "").toLowerCase()
  if (t.includes("tenant payment")) return "tenant_payment"
  if (item.type === "credit" && item.amount >= 0) return "topup"
  if (t.includes("agreement") && t.includes("upload")) return "agreement_uploaded"
  if (t.includes("agreement")) return "agreement_created"
  if (t.includes("active room") || (t.includes("room") && t.includes("monthly"))) return "room_monthly"
  return "adjustment"
}

const TYPE_CONFIG: Record<TransactionType, { label: string; icon: typeof Coins; color: string; bg: string }> = {
  subscription:       { label: "Subscription",       icon: CreditCard,  color: "#22c55e", bg: "#f0fdf4" },
  agreement_created:  { label: "Agreement Created",   icon: FileText,    color: "#f97316", bg: "#fff7ed" },
  agreement_uploaded: { label: "Agreement Uploaded",  icon: Upload,      color: "#3b82f6", bg: "#eff6ff" },
  room_monthly:       { label: "Room Charge",         icon: Home,        color: "#ef4444", bg: "#fef2f2" },
  topup:              { label: "Top-up",              icon: TrendingUp,  color: "#22c55e", bg: "#f0fdf4" },
  adjustment:         { label: "Adjustment",          icon: Zap,         color: "#8b5cf6", bg: "#f5f3ff" },
  tenant_payment:     { label: "Tenant payment",      icon: CircleDollarSign, color: "#0ea5e9", bg: "#f0f9ff" },
}

type TopupPackage = { id?: string; credits: number; price: number; tag: string }

/** Fallback when creditplan API empty. DB `creditplan` is source of truth. */
const DEFAULT_TOPUP_PACKAGES: TopupPackage[] = FLEX_TOPUP_CARD_TIERS.map((t) => ({
  credits: t.credit,
  price: t.price,
  tag: "",
}))

export default function CreditLogPage() {
  const { creditBalance, refresh } = useOperatorContext()
  const [search, setSearch] = useState("")
  const [filterType, setFilterType] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [showTopupDialog, setShowTopupDialog] = useState(false)
  /** Credit count as string; used for preset cards or custom input when `topupIsCustom`. */
  const [topupAmount, setTopupAmount] = useState("")
  const [topupIsCustom, setTopupIsCustom] = useState(false)
  const [topupStep, setTopupStep] = useState<"select" | "payment" | "problem" | "done">("select")
  const [topupReference, setTopupReference] = useState("")
  const [topupSubmitting, setTopupSubmitting] = useState(false)
  const [transactions, setTransactions] = useState<CreditTransaction[]>([])
  const [planName, setPlanName] = useState<string>("")
  const [planCreditsOneTime, setPlanCreditsOneTime] = useState<number>(0)
  const [activeRoomCount, setActiveRoomCount] = useState<number | null>(null)
  const [coreCredit, setCoreCredit] = useState<number>(0)
  const [flexCredit, setFlexCredit] = useState<number>(0)
  const [coreCreditsWithExpiry, setCoreCreditsWithExpiry] = useState<Array<{ amount: number; expired?: string }>>([])
  const [creditusage, setCreditusage] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [topupPackages, setTopupPackages] = useState(DEFAULT_TOPUP_PACKAGES)
  const [exporting, setExporting] = useState(false)
  /** When wallet (client_credit) ≠ sum(creditlogs), header vs last row Balance can differ. */
  const [ledgerMismatch, setLedgerMismatch] = useState<{ wallet: number; net: number; delta: number } | null>(null)
  /** operatordetail.currency — drives RM vs S$ labels and SGD manual threshold vs MYR Billplz (no cap). */
  const [operatorCurrency, setOperatorCurrency] = useState<"MYR" | "SGD">("MYR")
  /** Legacy: SGD flow used admin ticket only; kept for ticket step copy. */
  const [sgdAdminTopupTicket, setSgdAdminTopupTicket] = useState(false)
  const [topupFeeDialogOpen, setTopupFeeDialogOpen] = useState(false)
  const [topupFeeManualBusy, setTopupFeeManualBusy] = useState(false)
  const [topupFeeStripeBusy, setTopupFeeStripeBusy] = useState(false)
  const topupSyncDoneRef = useRef(false)

  const MANUAL_TOPUP_THRESHOLD = 1000
  const MAX_CUSTOM_TOPUP_CREDITS = 500000
  const currencyPrefix = operatorCurrency === "SGD" ? "S$" : "RM"
  const formatMoney = (n: number) => `${currencyPrefix}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const billingRes = await getMyBillingInfo()
      const cur = String((billingRes as { currency?: string }).currency || "")
        .trim()
        .toUpperCase()
      setOperatorCurrency(cur === "SGD" ? "SGD" : "MYR")
      // Always try to load statement items (creditlogs table) - skip permission check for now
      const [stmtRes, plansRes, creditPlansRes, activeRoomRes] = await Promise.all([
        getStatementItems({ page: 1, pageSize: 2000, sort: "new", filterType: "creditOnly", search: search || undefined }).catch((e) => {
          console.warn("[credit] getStatementItems failed", e)
          return { items: [], total: 0 }
        }),
        getPlans().catch(() => ({ items: [] })),
        getCreditPlans().catch(() => ({ items: [] })),
        getActiveRoomCount().catch((e) => {
          console.warn("[credit] getActiveRoomCount failed", e)
          return { activeRoomCount: 0 }
        }),
      ])
      const rawItems = (stmtRes?.items ?? []) as Array<{
        _id?: string
        type?: string
        title?: string
        amount?: number
        corecredit?: number
        _createdDate?: string
        reference_number?: string
        invoiceUrl?: string | null
        is_paid?: boolean
        balance?: number
      }>
      console.log("[credit] load stmtRes.items.length=", rawItems.length, "stmtRes keys=", stmtRes ? Object.keys(stmtRes) : "null", "activeRoomCount=", activeRoomRes?.activeRoomCount)
      console.log("[credit] balance debug: first 5 raw items balance=", rawItems.slice(0, 5).map((it) => ({ _id: it._id, type: it.type, amount: it.amount, balance: it.balance })))
      const wTot = (stmtRes as { walletTotalCredits?: number | null })?.walletTotalCredits
      const cNet = (stmtRes as { creditLogNetTotal?: number | null })?.creditLogNetTotal
      const delta = (stmtRes as { creditsLedgerDelta?: number | null })?.creditsLedgerDelta
      if (
        typeof wTot === "number" &&
        typeof cNet === "number" &&
        typeof delta === "number" &&
        Math.abs(delta) > 0.0001
      ) {
        setLedgerMismatch({ wallet: wTot, net: cNet, delta })
      } else {
        setLedgerMismatch(null)
      }
      setActiveRoomCount(activeRoomRes?.activeRoomCount ?? 0)
      const items = rawItems
      const mapped: CreditTransaction[] = items.map((it) => {
        const amt = it.type === "plan" ? Number(it.corecredit) || 0 : Number(it.amount) || 0
        const dateStr = it._createdDate ? new Date(it._createdDate).toISOString().slice(0, 10) : ""
        const status =
          it.type === "credit" && it.amount != null && Number(it.amount) >= 0
            ? (it.is_paid ? "Paid" : "Pending")
            : undefined
        return {
          id: (it._id || "").replace(/^(credit_|plan_)/, ""),
          date: dateStr,
          type: inferTransactionType({ type: it.type || "credit", title: it.title, amount: amt }),
          description: it.title || "-",
          reference: it.reference_number,
          amount: it.type === "plan" ? Number(it.corecredit) || 0 : Number(it.amount) || 0,
          balance: it.type === "credit" && it.balance !== undefined ? it.balance : undefined,
          invoiceUrl: it.invoiceUrl,
          status,
        }
      })
      console.log("[credit] balance debug: first 5 mapped tx balance=", mapped.slice(0, 5).map((t) => ({ id: t.id, type: t.type, amount: t.amount, balance: t.balance })))
      setTransactions(mapped)

      const credits = Array.isArray(billingRes.credit) ? billingRes.credit : []
      const core = credits.reduce((s: number, c: { type?: string; amount?: number }) => s + (String(c?.type) === "core" ? Number(c?.amount) || 0 : 0), 0)
      const flex = credits.reduce((s: number, c: { type?: string; amount?: number }) => s + (String(c?.type) === "flex" ? Number(c?.amount) || 0 : 0), 0)
      setCoreCredit(core)
      setFlexCredit(flex)
      const coreEntries = credits
        .filter((c: { type?: string }) => String(c?.type) === "core")
        .map((c: { amount?: number; expired?: string }) => ({ amount: Number(c?.amount) || 0, expired: c?.expired }))
        .sort((a: { expired?: string }, b: { expired?: string }) => (a.expired || "").localeCompare(b.expired || ""))
      setCoreCreditsWithExpiry(coreEntries)
      setCreditusage(typeof (billingRes as { creditusage?: string }).creditusage === "string" ? (billingRes as { creditusage: string }).creditusage : "")
      const planItem = (billingRes.pricingplandetail as Array<{ type?: string; title?: string; planId?: string }>)?.find?.((i) => i.type === "plan")
      setPlanName(planItem?.title || "")
      const pricingPlans = Array.isArray(plansRes) ? plansRes : (plansRes as { items?: Array<{ id?: string; title?: string; corecredit?: number }> })?.items || []
      const currentPlan = planItem?.planId ? pricingPlans.find((p) => (p.id || (p as { _id?: string })._id) === planItem.planId) : null
      setPlanCreditsOneTime(currentPlan?.corecredit ?? 0)

      const plans = Array.isArray(creditPlansRes) ? creditPlansRes : (creditPlansRes as { items?: Array<{ id?: string; credit?: number; sellingprice?: number }> })?.items || []
      if (Array.isArray(plans) && plans.length > 0) {
        const pkgs = plans.map((p) => ({
          id: p.id,
          credits: Number(p.credit) || 0,
          price: Number(p.sellingprice) || 0,
          tag: "",
        })).filter((p) => p.credits > 0)
        if (pkgs.length > 0) setTopupPackages(pkgs)
      }
    } catch (e) {
      console.error("[credit] loadData", e)
      setTransactions([])
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    loadData()
  }, [loadData])

  /** ?topup_finalize=…&session_id=… (Stripe) or legacy Billplz/Xendit. */
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const finalizeId = params.get("topup_finalize")?.trim()
    const sessionId = params.get("session_id")?.trim()
    if (!finalizeId) {
      topupSyncDoneRef.current = false
      return
    }
    if (topupSyncDoneRef.current) return
    topupSyncDoneRef.current = true
    let cancelled = false
    void (async () => {
      try {
        if (sessionId) {
          const rs = await syncTopupFromStripe({ creditLogId: finalizeId, sessionId })
          if (cancelled) return
          if (rs?.paid || rs?.already) console.log("[credit] topup_finalize stripe synced", rs)
          else console.warn("[credit] topup_finalize stripe sync result", rs)
        } else {
          const rb = await syncTopupFromBillplz({ creditLogId: finalizeId })
          if (cancelled) return
          if (rb?.paid || rb?.already) {
            console.log("[credit] topup_finalize billplz synced", rb)
          } else {
            const rx = await syncTopupFromXendit({ creditLogId: finalizeId })
            if (cancelled) return
            if (rx?.paid || rx?.already) console.log("[credit] topup_finalize xendit synced", rx)
            else console.warn("[credit] topup_finalize sync result", rb, rx)
          }
        }
      } catch (e) {
        console.warn("[credit] topup_finalize sync error", e)
      } finally {
        if (cancelled) return
        params.delete("topup_finalize")
        params.delete("session_id")
        const qs = params.toString()
        const next = window.location.pathname + (qs ? `?${qs}` : "") + (window.location.hash || "")
        window.history.replaceState(null, "", next)
        await loadData()
        refresh()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadData, refresh])

  const selectedPackage = !topupIsCustom ? topupPackages.find((p) => String(p.credits) === topupAmount) : undefined
  const customCreditsParsed = topupIsCustom ? Math.floor(Number(topupAmount)) : NaN
  const validCustomCredits =
    topupIsCustom &&
    Number.isFinite(customCreditsParsed) &&
    customCreditsParsed >= 1 &&
    customCreditsParsed <= MAX_CUSTOM_TOPUP_CREDITS
  const customPaymentTotal = validCustomCredits ? (flexTopupCustomPayment(customCreditsParsed) ?? 0) : 0
  const totalPrice = selectedPackage ? selectedPackage.price : customPaymentTotal
  const resolvedTopupCredits = selectedPackage ? selectedPackage.credits : validCustomCredits ? customCreditsParsed : 0
  /** Preset card requires `id` from API/DB for checkout; otherwise use custom credits field. */
  const canProceedTopup = Boolean(
    totalPrice > 0 &&
      (validCustomCredits || Boolean(!topupIsCustom && selectedPackage?.id))
  )

  const creditsForOneCreditHint = (() => {
    if (topupIsCustom) {
      const n = Math.floor(Number(topupAmount))
      if (Number.isFinite(n) && n >= 1) return Math.min(n, MAX_CUSTOM_TOPUP_CREDITS)
      return 1
    }
    if (selectedPackage) return selectedPackage.credits
    const n = Math.floor(Number(topupAmount))
    if (topupAmount !== "" && Number.isFinite(n) && n >= 1) return Math.min(n, MAX_CUSTOM_TOPUP_CREDITS)
    return 1
  })()
  const unitForOneCreditHint = flexTopupUnitPerCredit(creditsForOneCreditHint)
  const unitHintStr = unitForOneCreditHint.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  const oneCreditHint =
    operatorCurrency === "SGD" ? `1 credit : SGD ${unitHintStr}` : `1 credit : RM${unitHintStr}`

  const handleCloseTopup = () => {
    setShowTopupDialog(false)
    setTimeout(() => {
      setTopupStep("select")
      setTopupAmount("")
      setTopupIsCustom(false)
      setTopupReference("")
      setSgdAdminTopupTicket(false)
    }, 300)
    refresh()
  }

  const handleContinueToPayment = async () => {
    if (!canProceedTopup) return
    const price = totalPrice
    const credits = resolvedTopupCredits
    if (price > MANUAL_TOPUP_THRESHOLD) {
      setTopupSubmitting(true)
      try {
        const clientId = getCurrentRole()?.clientId ?? undefined
        const res = await submitTicket({
          mode: "topup_manual",
          description: `Top-up request: ${credits} credits, ${formatMoney(price)} (${operatorCurrency}). Please process via bank transfer.`,
          clientId,
        })
        if (res.ok) {
          setTopupReference(res.ticketId ?? "")
          setSgdAdminTopupTicket(false)
          setTopupStep("problem")
        } else {
          console.error("[credit] submitTicket", res)
        }
      } catch (e) {
        console.error("[credit] handleContinueToPayment threshold ticket", e)
      } finally {
        setTopupSubmitting(false)
      }
      return
    }
    setTopupFeeDialogOpen(true)
  }

  const executeTopupStripeCheckout = async () => {
    if (!canProceedTopup) return
    const price = totalPrice
    setTopupSubmitting(true)
    try {
      const returnUrl = typeof window !== "undefined" ? window.location.href : ""
      const pkg = !topupIsCustom ? topupPackages.find((p) => String(p.credits) === topupAmount) : undefined
      if (pkg?.id) {
        const res = await startTopup({ returnUrl, creditPlanId: pkg.id })
        if (res?.url) {
          window.location.href = res.url
          return
        }
        const manualRes = await submitManualTopupRequest({ creditPlanId: pkg.id })
        if (manualRes.ok && manualRes.referenceNumber) {
          setTopupReference(manualRes.referenceNumber)
          setTopupStep("payment")
        } else {
          console.error("[credit] submitManualTopupRequest", manualRes)
        }
        return
      }
      if (validCustomCredits) {
        const res = await startTopup({ returnUrl, credits: customCreditsParsed, amount: price })
        if (res?.url) {
          window.location.href = res.url
          return
        }
        const manualRes = await submitManualTopupRequest({ credits: customCreditsParsed, amount: price })
        if (manualRes.ok && manualRes.referenceNumber) {
          setTopupReference(manualRes.referenceNumber)
          setTopupStep("payment")
        } else {
          console.error("[credit] submitManualTopupRequest custom", manualRes)
        }
      }
    } catch (e) {
      console.error("[credit] executeTopupStripeCheckout", e)
    } finally {
      setTopupSubmitting(false)
    }
  }

  const handleExportExcel = async () => {
    setExporting(true)
    try {
      const res = await getStatementExportUrl({ sort: "new", filterType: "creditOnly", search: search || undefined })
      if (res?.downloadUrl) window.open(res.downloadUrl, "_blank")
    } catch (e) {
      console.error("[credit] export", e)
    } finally {
      setExporting(false)
    }
  }

  const filtered = transactions.filter((t) => {
    const matchSearch =
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.id.toLowerCase().includes(search.toLowerCase()) ||
      (t.reference?.toLowerCase().includes(search.toLowerCase()) ?? false)
    const matchType = filterType === "all" || t.type === filterType
    const matchFrom = !dateFrom || t.date >= dateFrom
    const matchTo = !dateTo || t.date <= dateTo
    return matchSearch && matchType && matchFrom && matchTo
  })

  const totalUsed = transactions.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0)

  return (
    <main className="p-3 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Credit Management</h1>
        <p className="text-muted-foreground mt-1">Track your credit usage and transaction history.</p>
      </div>

      <ManualPaymentEmailHint className="mb-6" />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Coins size={18} style={{ color: "var(--brand)" }} />
              {creditBalance < 100 && <AlertTriangle size={14} className="text-amber-500" />}
            </div>
            <div className="text-2xl font-bold text-foreground">{loading ? "…" : creditBalance}</div>
            <div className="text-xs text-muted-foreground">Total Balance</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Core: {loading ? "…" : coreCredit} · Flex: {loading ? "…" : flexCredit}
            </div>
            {coreCreditsWithExpiry.length > 0 && (
              <div className="text-[10px] text-muted-foreground mt-2 space-y-0.5">
                {coreCreditsWithExpiry.map((entry, i) => (
                  <div key={i}>
                    CORE Credit: {entry.amount}, Expired: {entry.expired ? new Date(entry.expired).toLocaleDateString() : "—"}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <CreditCard size={18} className="text-emerald-500" />
              {planName && <Badge variant="outline" className="text-[10px]">{planName}</Badge>}
            </div>
            <div className="text-2xl font-bold text-foreground">{planCreditsOneTime > 0 ? `+${planCreditsOneTime}` : "—"}</div>
            <div className="text-xs text-muted-foreground">Plan Credits (one-time)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Home size={18} className="text-blue-500 mb-2" />
            <div className="text-2xl font-bold text-foreground">{loading ? "…" : (activeRoomCount ?? "—")}</div>
            <div className="text-xs text-muted-foreground">Active Rooms</div>
            <div className="text-[10px] text-muted-foreground mt-1">See Billing for room charges</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <TrendingDown size={18} className="text-rose-500 mb-2" />
            <div className="text-2xl font-bold text-foreground">{loading ? "…" : totalUsed}</div>
            <div className="text-xs text-muted-foreground">Total Used (All Time)</div>
          </CardContent>
        </Card>
      </div>

      {creditusage && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{creditusage}</p>
          </CardContent>
        </Card>
      )}

      {ledgerMismatch && (
        <Card className="mb-4 border-amber-200 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-800">
          <CardContent className="p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
            <div className="text-sm text-foreground">
              <p className="font-medium">Why “Total Balance” can differ from the last row Balance</p>
              <p className="text-muted-foreground mt-1">
                The number in the summary card is your wallet total (<span className="font-mono">client_credit</span>:{" "}
                <strong>{ledgerMismatch.wallet}</strong>). The Balance column is a running total built only from{" "}
                <span className="font-mono">creditlogs</span> amounts (net <strong>{ledgerMismatch.net}</strong>
                {typeof ledgerMismatch.delta === "number" ? (
                  <>
                    , difference <strong>{ledgerMismatch.delta > 0 ? "+" : ""}{ledgerMismatch.delta}</strong>
                  </>
                ) : null}
                ). If those differ—often after manual wallet fixes, imports, or legacy data—the newest line’s Balance
                will not match the header. The header is authoritative for spendable credits.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Credit Rules + Actions */}
      <Card className="mb-6">
        <CardContent className="p-4 sm:p-6">
          <h3 className="font-semibold text-foreground mb-4">Credit Usage Rules</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            {[
              { type: "subscription" as TransactionType, title: "Subscription", desc: planName ? `+${planCreditsOneTime || "?"} credits (one-time) with ${planName} plan` : "Subscribe to a plan for one-time credits" },
              { type: "agreement_created" as TransactionType, title: "Create Agreement", desc: "-10 credits per system-generated agreement" },
              { type: "agreement_uploaded" as TransactionType, title: "Upload Agreement", desc: "Free - no credit deduction for uploads" },
              { type: "room_monthly" as TransactionType, title: "Active Rooms", desc: "-10 credits per active room per month" },
            ].map(({ type, title, desc }) => {
              const cfg = TYPE_CONFIG[type]
              const Icon = cfg.icon
              return (
                <div key={type} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: cfg.bg }}>
                    <Icon size={14} style={{ color: cfg.color }} />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-foreground">{title}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <Button onClick={() => setShowTopupDialog(true)} style={{ background: "var(--brand)" }} className="gap-2">
              <TrendingUp size={16} /> Top-up Credits
            </Button>
            <Link href="/operator/billing">
              <Button variant="outline" className="gap-2 w-full sm:w-auto">
                <CreditCard size={16} /> Upgrade Plan
              </Button>
            </Link>
            <Button variant="outline" className="gap-2" disabled={exporting} onClick={handleExportExcel}>
              {exporting ? "Exporting…" : "Export Excel"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
              <Input placeholder="Search by description, ID, or reference..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="Transaction Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="subscription">Subscription</SelectItem>
                <SelectItem value="agreement_created">Agreement Created</SelectItem>
                <SelectItem value="agreement_uploaded">Agreement Uploaded</SelectItem>
                <SelectItem value="room_monthly">Room Charge</SelectItem>
                <SelectItem value="topup">Top-up</SelectItem>
                <SelectItem value="adjustment">Adjustment</SelectItem>
                <SelectItem value="tenant_payment">Tenant payment</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="flex-1 min-w-0 border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground" />
              <span className="text-muted-foreground text-xs">to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="flex-1 min-w-0 border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mb-3 px-1">
        Showing {filtered.length} of {transactions.length} transactions
      </p>

      {/* Transaction Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground">Type</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden sm:table-cell">Description</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden md:table-cell">Reference</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden md:table-cell">Status</th>
                  <th className="text-right py-3 px-4 font-semibold text-xs text-muted-foreground">Amount</th>
                  <th className="text-right py-3 px-4 font-semibold text-xs text-muted-foreground hidden lg:table-cell">Balance</th>
                  <th className="text-center py-3 px-4 font-semibold text-xs text-muted-foreground">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">No transactions found.</td>
                  </tr>
                ) : filtered.map((tx) => {
                  const cfg = TYPE_CONFIG[tx.type]
                  const Icon = cfg.icon
                  return (
                    <tr key={tx.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                      <td className="py-3 px-4 text-xs text-muted-foreground">{tx.date}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: cfg.bg }}>
                            <Icon size={12} style={{ color: cfg.color }} />
                          </div>
                          <span className="text-xs font-medium hidden sm:inline">{cfg.label}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell text-foreground">{tx.description}</td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        {tx.reference && <Badge variant="outline" className="text-[10px]">{tx.reference}</Badge>}
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        {tx.status && (
                          <Badge variant={tx.status === "Paid" ? "default" : "secondary"} className="text-[10px]">
                            {tx.status}
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`flex items-center justify-end gap-1 font-semibold ${tx.amount > 0 ? "text-emerald-600" : tx.amount < 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                          {tx.amount > 0 ? <ArrowUpRight size={12} /> : tx.amount < 0 ? <ArrowDownRight size={12} /> : null}
                          {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right hidden lg:table-cell">
                        <span className="text-sm font-medium text-foreground">{tx.balance ?? "—"}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {tx.type === "topup" && tx.invoiceUrl ? (
                          <Button variant="outline" size="sm" className="gap-1" asChild>
                            <a href={tx.invoiceUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink size={12} /> Invoice
                            </a>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top-up Dialog */}
      <Dialog open={showTopupDialog} onOpenChange={handleCloseTopup}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {topupStep === "select" && "Top-up Credits"}
              {topupStep === "payment" && "Payment Details"}
              {topupStep === "problem" &&
                (sgdAdminTopupTicket
                  ? "SGD top-up — SaaS admin"
                  : `Top-up over ${formatMoney(MANUAL_TOPUP_THRESHOLD)} – Bank transfer`)}
              {topupStep === "done" && "Top-up Submitted"}
            </DialogTitle>
            <DialogDescription>
              {topupStep === "select" && "Choose a package or enter how many credits you want."}
              {topupStep === "payment" && "Complete your payment to receive credits."}
              {topupStep === "problem" &&
                (sgdAdminTopupTicket
                  ? "We submitted a ticket. SaaS admin will process your SGD top-up after payment is arranged."
                  : `Amount exceeds ${formatMoney(MANUAL_TOPUP_THRESHOLD)} (${operatorCurrency}). Pay by bank transfer; a ticket was submitted for processing.`)}
              {topupStep === "done" && "Your top-up request has been submitted for processing."}
            </DialogDescription>
          </DialogHeader>

          {topupStep === "select" && (
            <>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  {topupPackages.map((pkg) => (
                    <button
                      key={pkg.id ?? `pkg-${pkg.credits}`}
                      type="button"
                      onClick={() => {
                        setTopupIsCustom(false)
                        setTopupAmount(String(pkg.credits))
                      }}
                      className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                        !topupIsCustom && topupAmount === String(pkg.credits) ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                    >
                      {pkg.tag && (
                        <span className="absolute -top-2 left-3 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--brand)", color: "white" }}>
                          {pkg.tag}
                        </span>
                      )}
                      <div className="font-bold text-xl text-foreground">{pkg.credits}</div>
                      <div className="text-xs text-muted-foreground">credits</div>
                      <div className="mt-2 font-semibold text-sm" style={{ color: "var(--brand)" }}>{formatMoney(pkg.price)}</div>
                    </button>
                  ))}
                </div>

                <div className="space-y-2 pt-1 border-t border-border">
                  <label htmlFor="topup-custom-credits" className="text-sm font-medium text-foreground">
                    Or enter credits
                  </label>
                  <Input
                    id="topup-custom-credits"
                    inputMode="numeric"
                    type="text"
                    autoComplete="off"
                    placeholder="e.g. 175"
                    value={topupIsCustom ? topupAmount : ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "")
                      setTopupIsCustom(true)
                      setTopupAmount(raw)
                    }}
                    className="max-w-full"
                  />
                  <p className="text-[11px] text-muted-foreground leading-snug">{oneCreditHint}</p>
                  {topupIsCustom && topupAmount !== "" && !validCustomCredits && (
                    <p className="text-[11px] text-destructive">
                      Enter a whole number from 1 to {MAX_CUSTOM_TOPUP_CREDITS.toLocaleString()}.
                    </p>
                  )}
                  {(selectedPackage || validCustomCredits) && (
                    <div className="flex justify-between items-center rounded-lg border border-border bg-muted/40 px-3 py-2.5 mt-2">
                      <span className="text-sm font-medium text-foreground">Total payment</span>
                      <span className="text-base font-bold" style={{ color: "var(--brand)" }}>{formatMoney(totalPrice)}</span>
                    </div>
                  )}
                </div>

                {(selectedPackage || validCustomCredits) && (
                  <div className="p-4 rounded-xl bg-secondary/50 border border-border">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Credits</span>
                      <span className="font-semibold">+{resolvedTopupCredits}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">New balance after top-up</span>
                      <span className="font-semibold">{creditBalance + resolvedTopupCredits}</span>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseTopup}>Cancel</Button>
                <Button
                  style={{ background: "var(--brand)" }}
                  disabled={!canProceedTopup || topupSubmitting}
                  onClick={handleContinueToPayment}
                  className="gap-2"
                >
                  {topupSubmitting ? "Creating..." : "Continue"} <ArrowUpRight size={14} />
                </Button>
              </DialogFooter>
            </>
          )}

          {topupStep === "problem" && (
            <>
              <div className="space-y-4 py-2">
                {sgdAdminTopupTicket ? (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                    <p className="text-sm font-semibold text-amber-900 mb-2">Request sent to SaaS admin</p>
                    <p className="text-xs text-amber-800 mb-3">
                      Ticket reference: <span className="font-mono font-semibold">{topupReference || "—"}</span>. Admin will contact you
                      about {formatMoney(totalPrice)} for {resolvedTopupCredits} credits.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                    <p className="text-sm font-semibold text-amber-900 mb-2">Amount over {formatMoney(MANUAL_TOPUP_THRESHOLD)} – bank transfer only</p>
                    <p className="text-xs text-amber-800 mb-3">
                      Please transfer {formatMoney(totalPrice)} to the account below. We have created a ticket and will process your top-up once payment is received.
                    </p>
                    <div className="text-xs text-amber-800 space-y-1">
                      <div className="flex justify-between"><span>Bank</span><span className="font-semibold">Maybank</span></div>
                      <div className="flex justify-between"><span>Account Name</span><span className="font-semibold">Coliving Sdn Bhd</span></div>
                      <div className="flex justify-between"><span>Account No.</span><span className="font-semibold">5641 2345 6789</span></div>
                      <div className="flex justify-between"><span>Reference / Ticket</span><span className="font-semibold">{topupReference || "—"}</span></div>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button style={{ background: "var(--brand)" }} onClick={handleCloseTopup} className="w-full">Done</Button>
              </DialogFooter>
            </>
          )}

          {topupStep === "payment" && (
            <>
              <div className="space-y-4 py-2">
                <div className="p-4 rounded-xl bg-secondary/50 border border-border">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Credits to add</span>
                    <span className="font-semibold">+{resolvedTopupCredits}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-border pt-2 mt-2">
                    <span>Total Payable</span>
                    <span style={{ color: "var(--brand)" }}>{formatMoney(totalPrice)}</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
                  <p className="text-sm font-semibold text-blue-900 mb-2">Bank Transfer Details</p>
                  <p className="text-xs text-blue-800 mb-3">Please transfer the amount to the account below. Include the Reference so we can match your payment.</p>
                  <div className="text-xs text-blue-800 space-y-1">
                    <div className="flex justify-between"><span>Bank</span><span className="font-semibold">Maybank</span></div>
                    <div className="flex justify-between"><span>Account Name</span><span className="font-semibold">Coliving Sdn Bhd</span></div>
                    <div className="flex justify-between"><span>Account No.</span><span className="font-semibold">5641 2345 6789</span></div>
                    <div className="flex justify-between"><span>Reference</span><span className="font-semibold">{topupReference || "—"}</span></div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTopupStep("select")}>Back</Button>
                <Button style={{ background: "var(--brand)" }} onClick={() => setTopupStep("done")} className="gap-2">
                  I have transferred / Submit
                </Button>
              </DialogFooter>
            </>
          )}

          {topupStep === "done" && (
            <>
              <div className="py-6 text-center">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle size={32} className="text-green-600" />
                </div>
                <h3 className="font-bold text-lg text-foreground mb-2">Request Submitted!</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Your top-up of <strong>{resolvedTopupCredits} credits</strong> ({formatMoney(totalPrice)}) has been submitted. Credits will be added once payment is verified.
                </p>
                <p className="text-xs text-muted-foreground">
                  Please complete the bank transfer. We will record your request and admin will process the top-up once payment is received.
                </p>
              </div>
              <DialogFooter>
                <Button style={{ background: "var(--brand)" }} onClick={handleCloseTopup} className="w-full">Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <SaasStripeFeeConfirmDialog
        open={topupFeeDialogOpen}
        onOpenChange={setTopupFeeDialogOpen}
        subtotalMajor={totalPrice}
        currency={operatorCurrency}
        manualBusy={topupFeeManualBusy}
        stripeBusy={topupFeeStripeBusy || topupSubmitting}
        onManualPayment={async ({ receiptUrl }) => {
          const price = totalPrice
          const credits = resolvedTopupCredits
          setTopupFeeManualBusy(true)
          try {
            const clientId = getCurrentRole()?.clientId ?? undefined
            const res = await submitTicket({
              mode: "topup_manual",
              description: `Top-up (skip transaction fees, ~24h): ${credits} credits, subtotal ${formatMoney(price)} (${operatorCurrency}). Receipt: ${receiptUrl}`,
              clientId,
              photo: receiptUrl,
            })
            if (res.ok) {
              setTopupReference(res.ticketId ?? "")
              setSgdAdminTopupTicket(true)
              setTopupFeeDialogOpen(false)
              setTopupStep("problem")
            } else {
              console.error("[credit] submitTicket manual from fee dialog", res)
            }
          } catch (e) {
            console.error("[credit] topup manual fee dialog", e)
          } finally {
            setTopupFeeManualBusy(false)
          }
        }}
        onContinueStripe={async () => {
          setTopupFeeStripeBusy(true)
          try {
            setTopupFeeDialogOpen(false)
            await executeTopupStripeCheckout()
          } finally {
            setTopupFeeStripeBusy(false)
          }
        }}
      />
    </main>
  )
}
