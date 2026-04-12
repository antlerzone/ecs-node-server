"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { CreditCard, CheckCircle, AlertCircle, ArrowRight, ChevronDown, ChevronUp, ExternalLink } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  getMyBillingInfo,
  getPlans,
  getAddons,
  getStatementItems,
  getStatementExportUrl,
  previewPricingPlan,
  confirmPricingPlan,
  deductAddonCredit,
  syncPlanFromBillplz,
  syncPlanFromXendit,
  syncPlanFromStripe,
  submitTicket,
  getOperatorClientId,
} from "@/lib/operator-api"
import { SaasStripeFeeConfirmDialog } from "@/components/saas-stripe-fee-confirm-dialog"
import { useOperatorContext } from "@/contexts/operator-context"
import { PlanComparisonTable } from "@/components/operator/plan-comparison-table"
import { ManualPaymentEmailHint } from "@/components/manual-payment-email-hint"

interface PlanItem {
  planId?: string
  title?: string
  expired?: string
  type?: string
}

interface AddonItem {
  planId?: string
  title?: string
  qty?: number
  type?: string
}

interface AddonOption {
  id: string
  title: string
  credit?: string
  qty?: number
  description?: string | string[]
}

function parseAddonCredit(credit?: string): number {
  if (!credit) return 0
  const n = parseFloat(String(credit).replace(/[^\d.]/g, ""))
  return isNaN(n) ? 0 : n
}

export default function BillingPage() {
  const { creditBalance, refresh } = useOperatorContext()
  const [loading, setLoading] = useState(true)
  const [billing, setBilling] = useState<{
    title?: string
    currency?: string
    plan?: PlanItem
    pricingplandetail?: Array<PlanItem | AddonItem>
    credit?: Array<{ type?: string; amount?: number; expired?: string }>
    creditusage?: string
    expired?: string
    noPermission?: boolean
    reason?: string
  } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [plans, setPlans] = useState<Array<{ id: string; title: string; sellingprice?: number; corecredit?: number }>>([])
  const [addons, setAddons] = useState<AddonOption[]>([])
  const [statementItems, setStatementItems] = useState<Array<{
    _id?: string
    _createdDate?: string
    title?: string
    type?: "credit" | "plan"
    amount?: number
    sellingprice?: number
    corecredit?: number
    currency?: string
    invoiceUrl?: string | null
  }>>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    scenario?: string
    totalPayment?: number
    expiredDateText?: string
    credit?: { current?: number; addonRequired?: number; availableAfterRenew?: number }
    creditEnough?: boolean
  } | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [planFeeDialogOpen, setPlanFeeDialogOpen] = useState(false)
  const [planFeeManualBusy, setPlanFeeManualBusy] = useState(false)
  const [planFeeStripeBusy, setPlanFeeStripeBusy] = useState(false)
  const [planDetailsExpanded, setPlanDetailsExpanded] = useState(false)
  const [addonPanelOpen, setAddonPanelOpen] = useState(false)
  const [selectedAddons, setSelectedAddons] = useState<Record<string, number>>({})
  const [addonConfirmLoading, setAddonConfirmLoading] = useState(false)
  const planFinalizeSyncDoneRef = useRef(false)

  const reloadBillingAndPlanHistory = useCallback(async () => {
    try {
      const [billingRes, stmtRes] = await Promise.all([
        getMyBillingInfo(),
        getStatementItems({ page: 1, pageSize: 500, sort: "new", filterType: "planOnly" }).catch((e) => {
          console.warn("[billing] getStatementItems (plan finalize) failed", e)
          return { items: [], total: 0, page: 1, pageSize: 500 }
        }),
      ])
      if (!billingRes?.noPermission) setBilling(billingRes as typeof billing)
      setStatementItems((stmtRes?.items ?? []) as typeof statementItems)
    } catch (e) {
      console.warn("[billing] reload after plan payment", e)
    }
    await refresh()
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const billingRes = await getMyBillingInfo()
        if (cancelled) return
        if (billingRes.noPermission) {
          setBilling({ noPermission: true, reason: billingRes.reason || "No permission" })
          return
        }
        setBilling(billingRes as typeof billing)
        const [plansRes, stmtRes, addonsRes] = await Promise.all([
          getPlans(),
          getStatementItems({ page: 1, pageSize: 500, sort: "new", filterType: "planOnly" }).catch((e) => {
            console.warn("[billing] getStatementItems failed", e)
            return { items: [], total: 0, page: 1, pageSize: 500 }
          }),
          getAddons().catch((e) => {
            console.warn("[billing] getAddons failed", e)
            return []
          }),
        ])
        if (cancelled) return
        console.log("[billing] load plansRes=", Array.isArray(plansRes) ? plansRes?.length : (plansRes as object)?.constructor?.name, "stmtRes.items.length=", (stmtRes?.items ?? []).length, "stmtRes keys=", stmtRes ? Object.keys(stmtRes) : "null", "addonsRes=", Array.isArray(addonsRes) ? addonsRes?.length : addonsRes)
        const plansArr = Array.isArray(plansRes) ? plansRes : (plansRes as { items?: Array<{ id: string; title: string; sellingprice?: number; corecredit?: number }> })?.items ?? []
        const rawAddons = addonsRes
        let addonsArr: AddonOption[] = []
        if (Array.isArray(rawAddons)) addonsArr = rawAddons
        else if (rawAddons && typeof rawAddons === "object" && Array.isArray((rawAddons as { items?: unknown }).items)) addonsArr = (rawAddons as { items: AddonOption[] }).items
        setPlans(plansArr)
        setAddons(addonsArr)
        setStatementItems((stmtRes?.items ?? []) as typeof statementItems)
      } catch (e) {
        if (!cancelled) console.error("[billing] load", e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  /** Return URL includes ?plan_finalize=…&session_id=… (Stripe) or legacy Billplz/Xendit. */
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const finalizeId = params.get("plan_finalize")?.trim()
    const sessionId = params.get("session_id")?.trim()
    if (!finalizeId) {
      planFinalizeSyncDoneRef.current = false
      return
    }
    if (planFinalizeSyncDoneRef.current) return
    planFinalizeSyncDoneRef.current = true
    let cancelled = false
    void (async () => {
      try {
        if (sessionId) {
          const rs = await syncPlanFromStripe({ pricingplanlogId: finalizeId, sessionId })
          if (cancelled) return
          if (rs?.paid || rs?.already) console.log("[billing] plan_finalize stripe synced", rs)
          else console.warn("[billing] plan_finalize stripe sync result", rs)
        } else {
          const rb = await syncPlanFromBillplz({ pricingplanlogId: finalizeId })
          if (cancelled) return
          if (rb?.paid || rb?.already) {
            console.log("[billing] plan_finalize billplz synced", rb)
          } else {
            const rx = await syncPlanFromXendit({ pricingplanlogId: finalizeId })
            if (cancelled) return
            if (rx?.paid || rx?.already) console.log("[billing] plan_finalize xendit synced", rx)
            else console.warn("[billing] plan_finalize sync result", rb, rx)
          }
        }
      } catch (e) {
        console.warn("[billing] plan_finalize sync error", e)
      } finally {
        if (cancelled) return
        params.delete("plan_finalize")
        params.delete("session_id")
        const qs = params.toString()
        const next = window.location.pathname + (qs ? `?${qs}` : "") + (window.location.hash || "")
        window.history.replaceState(null, "", next)
        await reloadBillingAndPlanHistory()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadBillingAndPlanHistory])

  const planItem = billing?.pricingplandetail?.find((i) => i.type === "plan") as PlanItem | undefined
  const addonItems = (billing?.pricingplandetail?.filter((i) => i.type === "addon") || []) as AddonItem[]
  const selectedAddonsFromBilling: Record<string, number> = {}
  addonItems.forEach((a) => {
    const id = a.planId ?? ""
    if (id) selectedAddonsFromBilling[id] = Math.max(1, a.qty ?? 1)
  })
  const currency = (billing?.currency || "").toUpperCase()
  /** MYR/SGD: Coliving SaaS platform Stripe (Malaysia test). */
  const canPayPlanOnline = currency === "MYR" || currency === "SGD"
  const operatorStripeCurrency = (currency === "SGD" ? "SGD" : "MYR") as "MYR" | "SGD"
  const expiredDate = planItem?.expired || billing?.expired
  const isExpired = expiredDate ? new Date(expiredDate) < new Date() : false
  const currentPlanId = planItem?.planId ?? null
  const credits = Array.isArray(billing?.credit) ? billing.credit : []
  const currentCredit = credits.reduce((sum, c) => sum + Number(c.amount || 0), 0)
  const expiredDateObj = expiredDate ? new Date(expiredDate) : null
  const hasActivePlan = !!currentPlanId && expiredDateObj && new Date() < expiredDateObj

  function calculateAddonProratedCredit(): number {
    const today = new Date()
    let remainingDays = 365
    if (expiredDateObj && today < expiredDateObj) {
      remainingDays = Math.ceil((expiredDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    }
    const daysInYear = 365
    let total = 0
    addons.forEach((addon) => {
      const aid = addon.id
      const selectedQty = selectedAddons[aid] ?? 0
      const existingQty = selectedAddonsFromBilling[aid] ?? 0
      const deltaQty = selectedQty - existingQty
      if (deltaQty <= 0) return
      const yearlyCredit = parseAddonCredit(addon.credit)
      if (yearlyCredit <= 0) return
      total += Math.ceil((yearlyCredit * remainingDays / daysInYear) * deltaQty)
    })
    return total
  }

  const addonDeduct = calculateAddonProratedCredit()
  const addonBalance = currentCredit - addonDeduct
  const addonCreditEnough = addonDeduct <= 0 || currentCredit >= addonDeduct

  const filteredStatementItems = statementItems

  const handleSelectPlan = useCallback(async (planId: string) => {
    if (planId === selectedPlanId) {
      setSelectedPlanId(null)
      setPreview(null)
      return
    }
    setSelectedPlanId(planId)
    setPreview(null)
    try {
      const p = await previewPricingPlan(planId)
      if (p.scenario === "DOWNGRADE") {
        setPreview({ scenario: "DOWNGRADE" })
        return
      }
      setPreview({
        scenario: p.scenario,
        totalPayment: p.totalPayment,
        expiredDateText: p.expiredDateText,
        credit: p.credit,
        creditEnough: p.creditEnough,
      })
    } catch (e) {
      console.error("[billing] preview", e)
      setPreview(null)
    }
  }, [selectedPlanId])

  const runConfirmPlanCheckout = useCallback(async () => {
    if (!selectedPlanId || !preview || preview.scenario === "DOWNGRADE") return
    setConfirmLoading(true)
    try {
      const returnUrl = typeof window !== "undefined" ? window.location.href : ""
      const res = await confirmPricingPlan(selectedPlanId, returnUrl)
      if (res?.provider === "manual") {
        alert(`Manual processing required. Reference: ${res.referenceNumber || "—"}. Admin will process your request.`)
        refresh()
        setSelectedPlanId(null)
        setPreview(null)
        return
      }
      if (res?.url) {
        window.location.href = res.url
        return
      }
      throw new Error("No checkout URL")
    } catch (e) {
      console.error("[billing] confirm", e)
      const msg = e instanceof Error ? e.message : String(e)
      alert(msg && msg !== "No checkout URL" ? msg : "Unable to proceed. Please try again.")
    } finally {
      setConfirmLoading(false)
    }
  }, [selectedPlanId, preview, refresh])

  const handleAddonToggle = useCallback((addonId: string, checked: boolean, qty: number) => {
    const existing = selectedAddonsFromBilling[addonId] ?? 0
    if (existing > 0) return
    setSelectedAddons((prev) => {
      const next = { ...prev }
      if (checked) next[addonId] = qty
      else delete next[addonId]
      return next
    })
  }, [selectedAddonsFromBilling])

  const handleAddonQtyChange = useCallback((addonId: string, qty: number) => {
    const existing = selectedAddonsFromBilling[addonId] ?? 0
    setSelectedAddons((prev) => {
      const next = { ...prev }
      if (existing > 0 && qty < existing) return prev
      if ((prev[addonId] ?? 0) > 0) next[addonId] = Math.max(existing, qty)
      return next
    })
  }, [selectedAddonsFromBilling])

  const handleConfirmAddon = useCallback(async () => {
    if (!hasActivePlan) {
      alert("Please purchase or renew a plan before buying addons.")
      return
    }
    if (addonDeduct <= 0) {
      alert("Please select addon(s) to add.")
      return
    }
    if (!addonCreditEnough) {
      window.location.href = "/operator/credit"
      return
    }
    setAddonConfirmLoading(true)
    try {
      const addonsPayload: Record<string, number> = {}
      addons.forEach((a) => {
        const qty = selectedAddons[a.id] ?? selectedAddonsFromBilling[a.id] ?? 0
        if (qty > 0) addonsPayload[a.id] = qty
      })
      const title = `Addon Prorate (${new Date().toLocaleDateString("en-GB")} → ${expiredDateObj?.toLocaleDateString("en-GB") ?? ""})`
      await deductAddonCredit({ amount: addonDeduct, title, addons: addonsPayload })
      refresh()
      setAddonPanelOpen(false)
      setSelectedAddons({})
      const fresh = await getMyBillingInfo()
      setBilling(fresh as typeof billing)
    } catch (e) {
      console.error("[billing] deduct addon", e)
      alert("Unable to proceed. Please try again.")
    } finally {
      setAddonConfirmLoading(false)
    }
  }, [hasActivePlan, addonDeduct, addonCreditEnough, selectedAddons, selectedAddonsFromBilling, addons, expiredDateObj, refresh])

  if (loading) {
    return (
      <main className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Billing & Subscription</h1>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </main>
    )
  }

  if (billing?.noPermission) {
    return (
      <main className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Billing & Subscription</h1>
          <p className="text-sm text-red-600">
            {billing.reason === "NO_PERMISSION" ? "You don't have permission to view billing." : (billing.reason || "No permission to view billing.")}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Contact your admin to grant billing permission in User Management.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Billing & Subscription</h1>
        <p className="text-sm text-muted-foreground">Manage your subscription plan and addons</p>
      </div>

      <ManualPaymentEmailHint className="mb-6" />

      <div className="grid gap-6">
        {/* Current Plan + View Plan Details */}
        <Card className={`p-6 border-2 ${isExpired ? "border-amber-400" : ""}`} style={!isExpired ? { borderColor: "var(--brand)" } : undefined}>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-bold text-lg mb-2 flex items-center gap-2">
                {planItem ? (
                  <>
                    <CheckCircle size={20} className="text-green-600" /> {planItem.title || "Plan"}
                  </>
                ) : (
                  <>
                    <AlertCircle size={20} className="text-amber-500" /> No plan
                  </>
                )}
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                {planItem ? `Balance Credit: ${creditBalance}` : "Subscribe to a plan to get started"}
              </p>
              {expiredDate && (
                <div className="space-y-1">
                  <p className="text-sm"><span className="font-semibold">Plan expires:</span> {new Date(expiredDate).toLocaleDateString("en-GB")}</p>
                  {isExpired && <p className="text-sm text-amber-600 font-semibold">Plan expired. Please renew.</p>}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 items-end">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setPlanDetailsExpanded((e) => !e)}
              >
                {planDetailsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                View Plan Details
              </Button>
              <Link href="/operator/credit">
                <Button variant="outline" className="mt-2">View Credit</Button>
              </Link>
            </div>
          </div>
          {planDetailsExpanded && (
            <div className="mt-4 pt-4 border-t border-border space-y-4">
              <div>
                <h4 className="font-semibold text-sm text-muted-foreground mb-1">Current Plan</h4>
                <p className="text-sm">
                  {planItem?.title ?? "—"} · Expires {expiredDate ? new Date(expiredDate).toLocaleDateString("en-GB") : "—"} · Credit: {currentCredit}
                </p>
              </div>
              {(() => {
                const coreEntries = (billing?.credit ?? []).filter((c) => String(c?.type) === "core").map((c) => ({ amount: Number(c?.amount) || 0, expired: c?.expired })).sort((a, b) => (a.expired || "").localeCompare(b.expired || ""))
                if (coreEntries.length === 0) return null
                return (
                  <div>
                    <h4 className="font-semibold text-sm text-muted-foreground mb-1">Core Credit (with expiry)</h4>
                    <ul className="text-sm space-y-0.5">
                      {coreEntries.map((entry, i) => (
                        <li key={i}>CORE Credit: {entry.amount}, Expired: {entry.expired ? new Date(entry.expired).toLocaleDateString() : "—"}</li>
                      ))}
                    </ul>
                  </div>
                )
              })()}
              {billing?.creditusage && (
                <div>
                  <h4 className="font-semibold text-sm text-muted-foreground mb-1">Credit usage</h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{billing.creditusage}</p>
                </div>
              )}
              {selectedPlanId && preview && preview.scenario !== "DOWNGRADE" && (
                <div>
                  <h4 className="font-semibold text-sm text-muted-foreground mb-1">Future Plan (after {preview.scenario})</h4>
                  <p className="text-sm">
                    {plans.find((p) => p.id === selectedPlanId)?.title ?? selectedPlanId} · Expires {preview.expiredDateText ?? "—"} · Total {currency} {preview.totalPayment?.toFixed(2) ?? "—"}
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Change Plan - comparison table + checkout */}
        <div>
          <h3 className="font-bold text-lg mb-2">Change Plan</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {canPayPlanOnline
              ? `Compare features below, then select a column to renew or upgrade. ${
                  currency === "MYR"
                    ? "MYR accounts pay online via Xendit."
                    : "SGD accounts pay online via Stripe."
                }`
              : "Compare features below, then select a column. Online checkout is only available for MYR or SGD — contact your manager if you need help."}
          </p>
          <PlanComparisonTable
            plans={plans}
            currency={currency || "MYR"}
            currentPlanId={currentPlanId}
            selectedPlanId={selectedPlanId}
            onSelectPlan={handleSelectPlan}
          />

          {preview && (
            <Card className="mt-4 p-4">
              {preview.scenario === "DOWNGRADE" ? (
                <p className="text-sm text-amber-600">Downgrade is not allowed. Please contact your manager.</p>
              ) : (
                <>
                  <p className="text-sm font-semibold mb-2">
                    {preview.scenario === "NEW" && "Subscribe"}
                    {preview.scenario === "RENEW" && "Renew"}
                    {preview.scenario === "UPGRADE" && "Upgrade"}
                  </p>
                  <p className="text-sm text-muted-foreground mb-2">
                    Total: {currency} {preview.totalPayment?.toFixed(2) ?? "—"}
                    {preview.expiredDateText && ` · Expires ${preview.expiredDateText}`}
                  </p>
                  {canPayPlanOnline ? (
                    <>
                      <p className="text-sm text-muted-foreground mb-3">
                        You will see a short summary of platform admin and card processing fees before Stripe Checkout.
                      </p>
                      <Button
                        className="gap-2"
                        style={{ background: "var(--brand)" }}
                        disabled={confirmLoading}
                        onClick={() => setPlanFeeDialogOpen(true)}
                      >
                        {confirmLoading ? "Processing..." : "Pay Now"}
                        <ArrowRight size={14} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-amber-600 font-medium mb-3">
                        Plan changes are not available for online payment with your account currency. Please contact your manager to subscribe, renew, or upgrade.
                      </p>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => window.open("https://wa.me/60198579627?text=Hi, I need to change my pricing plan.", "_blank")}
                      >
                        Contact manager
                        <ArrowRight size={14} />
                      </Button>
                    </>
                  )}
                </>
              )}
            </Card>
          )}
        </div>

        {/* Add-ons: current + add new */}
        <div>
          <h3 className="font-bold text-lg mb-4">Add-ons</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              variant="outline"
              onClick={() => {
                setSelectedAddons({ ...selectedAddonsFromBilling })
                setAddonPanelOpen(true)
              }}
              disabled={!hasActivePlan}
              style={hasActivePlan ? { borderColor: "var(--brand)" } : undefined}
            >
              Add Add-ons
            </Button>
            {!hasActivePlan && (
              <span className="text-xs text-muted-foreground self-center">Purchase or renew a plan first</span>
            )}
          </div>
          {addonItems.length > 0 && (
            <div className="mb-3">
              <p className="text-sm font-medium text-muted-foreground mb-1.5">Current Add-ons</p>
              <div className="flex flex-wrap gap-2">
                {addonItems.map((a) => (
                  <span
                    key={a.planId || a.title}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-sm"
                  >
                    <CheckCircle size={14} className="text-green-600 shrink-0" />
                    {a.title || "Add-on"} × {a.qty ?? 1}
                  </span>
                ))}
              </div>
            </div>
          )}
          {addonPanelOpen && (
            <Card className="p-3 border border-primary/30">
              <h4 className="font-semibold text-sm mb-3">Select Add-ons</h4>
              {addons.length === 0 ? (
                <p className="text-xs text-muted-foreground">No add-ons available</p>
              ) : (
              <div className="space-y-2">
                {addons.map((addon) => {
                  const existingQty = selectedAddonsFromBilling[addon.id] ?? 0
                  const qty = selectedAddons[addon.id] ?? existingQty ?? 0
                  const isChecked = qty > 0
                  const maxQty = addon.title?.toLowerCase().includes("extra user") ? 10 : Math.max(1, addon.qty ?? 1)
                  return (
                    <div key={addon.id} className="flex items-center gap-2 py-1.5 px-2 rounded border border-border">
                      <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={existingQty > 0}
                          onChange={(e) => handleAddonToggle(addon.id, e.target.checked, e.target.checked ? Math.max(1, existingQty) : 0)}
                          className="rounded shrink-0"
                        />
                        <span className="text-sm truncate">{addon.title}</span>
                        {addon.credit ? <span className="text-xs text-muted-foreground shrink-0">{addon.credit}/yr</span> : null}
                      </label>
                      <select
                        value={String(qty ?? 0)}
                        onChange={(e) => handleAddonQtyChange(addon.id, Number(e.target.value))}
                        disabled={!isChecked}
                        className="rounded border px-1.5 py-0.5 text-xs w-14"
                      >
                        {Array.from({ length: maxQty + 1 }, (_, i) => i)
                          .filter((n) => n >= existingQty)
                          .map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                      </select>
                    </div>
                  )
                })}
              </div>
              )}
              <div className="mt-3 py-2 px-2 rounded bg-muted/50 text-xs space-y-0.5">
                <p>Credit: {currentCredit} → deduct {addonDeduct} → balance {addonBalance}</p>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  style={{ background: "var(--brand)" }}
                  disabled={addonDeduct <= 0 || addonConfirmLoading}
                  onClick={handleConfirmAddon}
                >
                  {addonConfirmLoading ? "..." : !addonCreditEnough && addonDeduct > 0 ? "Top up first" : "Confirm"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAddonPanelOpen(false)}>Cancel</Button>
              </div>
            </Card>
          )}
        </div>

        {/* Plan history (pricingplanlog only) */}
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h3 className="font-bold text-lg">Plan & Credit History</h3>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={async () => {
                setExporting(true)
                try {
                  const res = await getStatementExportUrl({ sort: "new", filterType: "planOnly" })
                  if (res?.downloadUrl) window.open(res.downloadUrl, "_blank")
                } catch (e) {
                  console.error("[billing] export", e)
                } finally {
                  setExporting(false)
                }
              }}
            >
              {exporting ? "Exporting…" : "Export Excel"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-2">Plan transactions (pricingplanlog). For credit transactions see Credit page.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Date</th>
                  <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Description</th>
                  <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Credit</th>
                  <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Amount</th>
                  <th className="text-center py-2 px-3 font-semibold text-muted-foreground">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {filteredStatementItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground text-sm">No plan history</td>
                  </tr>
                ) : (
                  filteredStatementItems.map((item, i) => {
                    const creditText = `+${item.corecredit ?? 0}`
                    const amountVal = item.sellingprice ?? item.amount ?? 0
                    const amountText = amountVal > 0 ? `${item.currency || currency} ${amountVal}` : ""
                    const hasPayment = amountVal > 0
                    const showInvoice = hasPayment && item.invoiceUrl
                    return (
                      <tr key={item._id ?? i} className="border-b border-border">
                        <td className="py-2 px-3">{item._createdDate ? new Date(item._createdDate).toLocaleDateString("en-GB") : "—"}</td>
                        <td className="py-2 px-3">{item.title || "—"}</td>
                        <td className="py-2 px-3 text-right text-green-700">{creditText}</td>
                        <td className="py-2 px-3 text-right font-medium">{amountText}</td>
                        <td className="py-2 px-3 text-center">
                          {showInvoice ? (
                            <Button variant="outline" size="sm" className="gap-1" asChild>
                              <a href={item.invoiceUrl!} target="_blank" rel="noopener noreferrer">
                                <ExternalLink size={12} /> Invoice
                              </a>
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex gap-3">
          <Link href="/operator/credit">
            <Button style={{ background: "var(--brand)" }} className="gap-2">
              <CreditCard size={16} /> Credit & Top-up
            </Button>
          </Link>
        </div>

        <SaasStripeFeeConfirmDialog
          open={planFeeDialogOpen}
          onOpenChange={setPlanFeeDialogOpen}
          subtotalMajor={Number(preview?.totalPayment) || 0}
          currency={operatorStripeCurrency}
          manualBusy={planFeeManualBusy}
          stripeBusy={planFeeStripeBusy || confirmLoading}
          onManualPayment={async ({ receiptUrl }) => {
            if (!selectedPlanId || preview?.totalPayment == null) return
            setPlanFeeManualBusy(true)
            try {
              const planTitle = plans.find((p) => p.id === selectedPlanId)?.title ?? selectedPlanId
              const cid = getOperatorClientId()
              const r = await submitTicket({
                mode: "billing_manual",
                description: `Manual plan payment (skip transaction fees, ~24h). Scenario: ${preview.scenario ?? "—"}. Plan: ${planTitle}. Subtotal ${operatorStripeCurrency} ${preview.totalPayment.toFixed(2)}. Receipt: ${receiptUrl}`,
                ...(cid ? { clientId: cid } : {}),
                photo: receiptUrl,
              })
              if (r?.ok) {
                alert(`Request submitted. Reference: ${r.ticketId ?? "—"}. SaaS Admin will contact you.`)
                setPlanFeeDialogOpen(false)
                setSelectedPlanId(null)
                setPreview(null)
                await refresh()
              }
            } catch (e) {
              console.error("[billing] manual plan ticket", e)
              alert(e instanceof Error ? e.message : "Could not submit request.")
            } finally {
              setPlanFeeManualBusy(false)
            }
          }}
          onContinueStripe={async () => {
            setPlanFeeStripeBusy(true)
            try {
              setPlanFeeDialogOpen(false)
              await runConfirmPlanCheckout()
            } finally {
              setPlanFeeStripeBusy(false)
            }
          }}
        />
      </div>
    </main>
  )
}
