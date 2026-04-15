"use client"

import { useState, useEffect, useRef } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { CheckCircle2, CreditCard, ChevronDown, ChevronLeft, ChevronRight, Loader2, Copy, Upload, HelpCircle, ExternalLink, ListChecks } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTenantOptional } from "@/contexts/tenant-context"
import {
  rentalList,
  createPayment,
  confirmPayment,
  createPaymentMethodSetup,
  disconnectPaymentMethod,
  uploadFile,
  submitPaynowReceipt,
  updateProfile,
} from "@/lib/tenant-api"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import {
  formatRentalDueDateMalaysia,
  getTodayMalaysiaYmd,
  rentalDueDateToMalaysiaYmd,
} from "@/lib/dateMalaysia"

interface RentalItem {
  _id?: string
  title?: string
  /** Billing type from account (replaces placeholder title e.g. "Manual entry"). */
  type?: { _id?: string; title?: string }
  dueDate?: string
  amount?: number
  isPaid?: boolean
  invoiceurl?: string
  receipturl?: string
  /** e.g. IV-00019 | OR-00003 from accounting */
  accountingDocLabel?: string
  property?: { shortname?: string }
}

function rentalInvoiceHeadline(inv: RentalItem): string {
  const raw = inv.title != null && String(inv.title).trim() ? String(inv.title).trim() : ""
  const typeT = inv.type?.title != null && String(inv.type.title).trim() ? String(inv.type.title).trim() : ""
  if (raw && raw.toLowerCase() !== "manual entry") return raw
  if (typeT) return typeT
  return raw || "Invoice"
}

function formatAmount(amount: number | undefined, currency = ""): string {
  const v = amount == null ? 0 : Number(amount)
  const num = Number.isFinite(v) ? v.toFixed(2) : "0.00"
  return currency ? `${currency} ${num}` : num
}

function formatDate(d: string | undefined): string {
  if (!d) return "—"
  try {
    return formatRentalDueDateMalaysia(d)
  } catch {
    return "—"
  }
}

function InvoiceRow({
  inv,
  selectedIds,
  toggleSelect,
  isOverdue,
  formatDate,
  currencySymbol,
  selectionDisabled,
}: {
  inv: RentalItem
  selectedIds: Set<string>
  toggleSelect: (id: string | undefined, unpaid: boolean) => void
  isOverdue: (dueDate: string | undefined, paid: boolean) => boolean
  formatDate: (d: string | undefined) => string
  currencySymbol: string
  selectionDisabled?: boolean
}) {
  const overdue = isOverdue(inv.dueDate, !!inv.isPaid)
  const statusLabel = inv.isPaid ? "Paid" : overdue ? "Overdue" : "Pending"
  const unpaid = !inv.isPaid
  const checked = inv._id ? selectedIds.has(inv._id) : false
  const selDisabled = !!selectionDisabled
  return (
    <div
      className={cn(
        "flex items-center gap-4 p-4 rounded-xl border transition-colors",
        unpaid ? "border-border hover:bg-secondary/30" : "border-border bg-secondary/20"
      )}
    >
      <div className="flex-shrink-0">
        {unpaid ? (
          <label className={cn("flex items-center", selDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
            <input
              type="checkbox"
              checked={checked}
              disabled={selDisabled}
              onChange={() => toggleSelect(inv._id, unpaid)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
          </label>
        ) : (
          <CheckCircle2 size={22} className="text-emerald-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-foreground">{rentalInvoiceHeadline(inv)}</div>
        {inv.accountingDocLabel ? (
          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{inv.accountingDocLabel}</div>
        ) : null}
        <div className="text-xs text-muted-foreground mt-0.5">Due: {formatDate(inv.dueDate)}</div>
        {(inv.invoiceurl || inv.receipturl) && (
          <div className="flex flex-wrap gap-2 mt-2">
            {inv.invoiceurl ? (
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" asChild>
                <a href={inv.invoiceurl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open invoice
                </a>
              </Button>
            ) : null}
            {inv.receipturl ? (
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" asChild>
                <a href={inv.receipturl} target="_blank" rel="noopener noreferrer" download>
                  <ExternalLink className="h-3.5 w-3.5" />
                  View receipt
                </a>
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <div className="font-black text-foreground">{formatAmount(inv.amount, currencySymbol)}</div>
        <div
          className={cn(
            "text-xs font-bold uppercase tracking-wider",
            inv.isPaid ? "text-emerald-600" : overdue ? "text-rose-500" : "text-amber-600"
          )}
        >
          {statusLabel}
        </div>
      </div>
    </div>
  )
}

/** Overdue = unpaid and due date (Malaysia calendar) is today or before. */
function isOverdue(dueDate: string | undefined, paid: boolean): boolean {
  if (paid) return false
  if (!dueDate) return false
  const dueYmd = rentalDueDateToMalaysiaYmd(dueDate)
  if (!dueYmd) return false
  const todayYmd = getTodayMalaysiaYmd()
  return dueYmd <= todayYmd
}

const RENTAL_HISTORY_PAGE_SIZE = 10

export default function PaymentPage() {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const state = useTenantOptional()
  const tenancies = (state?.tenancies ?? []) as { id?: string; _id?: string }[]
  const firstTenancyId = tenancies[0]?.id ?? tenancies[0]?._id
  const selectedTenancyId = state?.selectedTenancyId ?? null
  const [items, setItems] = useState<RentalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [payLoading, setPayLoading] = useState(false)
  const [sort, setSort] = useState<"latest" | "oldest">("oldest")
  const [rentalHistoryPage, setRentalHistoryPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const confirmDoneRef = useRef(false)
  const refetchTenant = state?.refetch
  const mergeTenantProfile = state?.mergeTenantProfile
  const [paynowModalOpen, setPaynowModalOpen] = useState(false)
  const [paynowReceiptUrl, setPaynowReceiptUrl] = useState<string | null>(null)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)
  const [paynowSubmitLoading, setPaynowSubmitLoading] = useState(false)
  const [paynowHintOpen, setPaynowHintOpen] = useState(false)
  const [tenantPaymentMethodPolicy, setTenantPaymentMethodPolicy] = useState<"strictly" | "no_allow" | "flexible">("flexible")
  const [tenantRentAutoDebitOffered, setTenantRentAutoDebitOffered] = useState(true)
  const [paymentGatewayProvider, setPaymentGatewayProvider] = useState<"stripe" | "payex" | "paynow" | "billplz">("stripe")
  const [paymentGatewayAllowPaynow, setPaymentGatewayAllowPaynow] = useState(true)
  const [paymentMethodSgd, setPaymentMethodSgd] = useState<"paynow" | "gateway">("paynow")
  const [bindSetupLoading, setBindSetupLoading] = useState(false)
  const [disconnectLoading, setDisconnectLoading] = useState(false)
  const [rentAutoDebitSaving, setRentAutoDebitSaving] = useState(false)
  const setupConfirmDoneRef = useRef(false)
  const tenantProfile = state?.tenant as {
    profile?: { payment_method_linked?: boolean; rent_auto_debit_enabled?: boolean; xendit_auto_debit?: boolean }
  } | null
  const paymentMethodLinked = !!tenantProfile?.profile?.payment_method_linked
  const rentAutoDebitEnabled =
    tenantProfile?.profile?.rent_auto_debit_enabled === true ||
    tenantProfile?.profile?.xendit_auto_debit === true

  useEffect(() => {
    if (!selectedTenancyId) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    rentalList(selectedTenancyId)
      .then((res) => {
        const pol = res?.tenantPaymentMethodPolicy
        if (pol === "strictly" || pol === "no_allow" || pol === "flexible") {
          setTenantPaymentMethodPolicy(pol)
        } else {
          setTenantPaymentMethodPolicy("flexible")
        }
        const pg = (res as { paymentGatewayProvider?: "stripe" | "payex" | "paynow" | "billplz" })?.paymentGatewayProvider
        setPaymentGatewayProvider(pg === "payex" || pg === "paynow" || pg === "stripe" || pg === "billplz" ? pg : "stripe")
        const allowPaynow = (res as { paymentGatewayAllowPaynow?: boolean })?.paymentGatewayAllowPaynow
        setPaymentGatewayAllowPaynow(allowPaynow !== false)
        setTenantRentAutoDebitOffered((res as { tenantRentAutoDebitOffered?: boolean })?.tenantRentAutoDebitOffered !== false)
        const list = (res?.items ?? []) as RentalItem[]
        setItems(list)
        const overdueIds = new Set(
          list
            .filter((i) => !i.isPaid && isOverdue(i.dueDate, !!i.isPaid) && i._id)
            .map((i) => i._id as string)
        )
        setSelectedIds(overdueIds)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [selectedTenancyId])

  // After provider redirect: confirm payment so invoices are marked as paid even if webhook is delayed.
  useEffect(() => {
    const success = searchParams.get("success")
    const sessionId = searchParams.get("session_id")
    const billId = searchParams.get("bill_id") ?? searchParams.get("billplz[id]") ?? undefined
    const paymentType = (searchParams.get("payment_type") ?? "invoice") as "invoice" | "meter"
    const meterTransactionId = searchParams.get("meter_transaction_id") ?? undefined
    const provider = (searchParams.get("provider") ?? (sessionId ? "stripe" : billId ? "billplz" : searchParams.get("reference_number") ? "payex" : "")).toLowerCase()
    const referenceNumber = searchParams.get("reference_number") ?? undefined
    const clientId = searchParams.get("client_id") ?? undefined
    if (success !== "1" || (!sessionId && !referenceNumber && !billId) || confirmDoneRef.current) return
    confirmDoneRef.current = true
    const tenancyId = selectedTenancyId || firstTenancyId
    confirmPayment({
      sessionId: sessionId ?? undefined,
      clientId,
      provider: provider === "payex" ? "payex" : provider === "billplz" ? "billplz" : "stripe",
      referenceNumber,
      billId,
      paymentType,
      meterTransactionId,
    })
      .then((res) => {
        if (res?.ok && tenancyId) {
          rentalList(tenancyId).then((r) => {
            const list = (r?.items ?? []) as RentalItem[]
            setItems(list)
          })
        }
      })
      .catch(() => {})
  }, [searchParams, selectedTenancyId, firstTenancyId])

  // After Stripe Checkout setup: mark profile.payment_method_linked (backup when webhook lags)
  useEffect(() => {
    if (searchParams.get("setup_success") !== "1") return
    const sessionId = searchParams.get("session_id")
    const clientId = searchParams.get("client_id") ?? undefined
    if (!sessionId || setupConfirmDoneRef.current) return
    setupConfirmDoneRef.current = true
    confirmPayment({
      sessionId,
      clientId,
      provider: "stripe",
    })
      .then((res) => {
        if (res?.ok) {
          void refetchTenant?.()
          router.replace(pathname || "/tenant/payment")
        }
      })
      .catch(() => {})
  }, [searchParams, pathname, router, refetchTenant])

  // Xendit: return from Payment Session SAVE — webhook updates profile; refetch to clear strict gate
  useEffect(() => {
    if (searchParams.get("xendit_setup") !== "1") return
    void refetchTenant?.().then(() => {
      router.replace(pathname || "/tenant/payment")
    })
  }, [searchParams, pathname, router, refetchTenant])

  const paymentSuccess = searchParams.get("success") === "1"
  const paymentCancel = searchParams.get("cancel") === "1"
  const setupCancel = searchParams.get("setup_cancel") === "1"
  const gateReason = searchParams.get("reason")
  /** Lock gate (layer 5): operator policy Strictly until profile.payment_method_linked */
  const paymentMethodLockGate = gateReason === "payment_method" || state?.gateLayer === 5
  const clearPaymentResult = () => {
    router.replace(pathname || "/tenant/payment")
  }

  const sortedItems = [...items].sort((a, b) => {
    const paidA = a.isPaid ? 1 : 0
    const paidB = b.isPaid ? 1 : 0
    if (paidA !== paidB) return paidA - paidB
    const da = a.dueDate ? new Date(a.dueDate).getTime() : 0
    const db = b.dueDate ? new Date(b.dueDate).getTime() : 0
    return sort === "latest" ? db - da : da - db
  })

  const rentalHistoryTotalPages = Math.max(1, Math.ceil(sortedItems.length / RENTAL_HISTORY_PAGE_SIZE))
  const rentalHistoryPageSafe = Math.min(rentalHistoryPage, rentalHistoryTotalPages)
  const pagedRentalItems = sortedItems.slice(
    (rentalHistoryPageSafe - 1) * RENTAL_HISTORY_PAGE_SIZE,
    rentalHistoryPageSafe * RENTAL_HISTORY_PAGE_SIZE
  )

  useEffect(() => {
    setRentalHistoryPage(1)
  }, [selectedTenancyId, sort])

  useEffect(() => {
    setRentalHistoryPage((p) => (p > rentalHistoryTotalPages ? rentalHistoryTotalPages : p))
  }, [rentalHistoryTotalPages])

  const unpaidItems = items.filter((i) => !i.isPaid)
  const selectedItems = unpaidItems.filter((i) => i._id && selectedIds.has(i._id))
  const outstandingTotal = selectedItems.reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
  const selectedInvoiceIds = selectedItems.map((i) => i._id).filter(Boolean) as string[]
  const currentTenancy = (state?.tenancies ?? []).find((t: { id?: string; _id?: string }) => (t.id || t._id) === selectedTenancyId)
  const client = currentTenancy && (currentTenancy as { client?: { title?: string; currency?: string; uen?: string } }).client
  const clientCurrency = (client?.currency ?? "").toString().toUpperCase()
  const isSgd = clientCurrency === "SGD"
  const currencySymbol = isSgd ? "S$" : "RM"
  const clientUen = client?.uen ?? ""
  const tenancyReadOnly = !!(currentTenancy as { isPortalReadOnly?: boolean } | undefined)?.isPortalReadOnly

  const toggleSelect = (id: string | undefined, unpaid: boolean) => {
    if (tenancyReadOnly) return
    if (!id || !unpaid) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllUnpaid = () => {
    if (tenancyReadOnly) return
    const ids = new Set(unpaidItems.filter((i) => i._id).map((i) => i._id as string))
    setSelectedIds(ids)
  }

  const selectAllOverdue = () => {
    if (tenancyReadOnly) return
    const ids = new Set(unpaidItems.filter((i) => isOverdue(i.dueDate, !!i.isPaid) && i._id).map((i) => i._id as string))
    setSelectedIds(ids)
  }

  const handlePayNow = async () => {
    if (tenancyReadOnly) return
    if (!selectedTenancyId || outstandingTotal <= 0 || payLoading) return
    setPayLoading(true)
    try {
      const res = await createPayment({
        tenancyId: selectedTenancyId,
        type: "invoice",
        amount: outstandingTotal,
        metadata: selectedInvoiceIds.length > 0 ? { invoiceIds: selectedInvoiceIds } : undefined,
        returnUrl: typeof window !== "undefined" ? `${window.location.origin}/tenant/payment?success=1` : undefined,
        cancelUrl: typeof window !== "undefined" ? `${window.location.origin}/tenant/payment?cancel=1` : undefined,
      })
      if (res?.ok && res?.type === "redirect" && res?.url) {
        window.location.href = res.url
      } else {
        alert((res as { reason?: string })?.reason || "Payment failed. Please try again.")
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Payment failed. Please try again.")
    } finally {
      setPayLoading(false)
    }
  }

  const openPaynowModal = () => {
    setPaynowReceiptUrl(null)
    setPaynowHintOpen(false)
    setPaynowModalOpen(true)
  }

  const handlePaynowReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingReceipt(true)
    try {
      const res = await uploadFile(file)
      if (res.ok && res.url) {
        setPaynowReceiptUrl(res.url)
      } else {
        alert(res.reason || "Upload failed.")
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed.")
    } finally {
      setUploadingReceipt(false)
      e.target.value = ""
    }
  }

  const handlePaynowSubmit = async () => {
    if (tenancyReadOnly) return
    if (!selectedTenancyId || !paynowReceiptUrl || outstandingTotal <= 0 || paynowSubmitLoading) return
    setPaynowSubmitLoading(true)
    try {
      const res = await submitPaynowReceipt({
        tenancyId: selectedTenancyId,
        receipt_url: paynowReceiptUrl,
        amount: outstandingTotal,
        invoiceIds: selectedInvoiceIds.length > 0 ? selectedInvoiceIds : undefined,
      })
      if (res?.ok) {
        setPaynowModalOpen(false)
        if (selectedTenancyId) {
          rentalList(selectedTenancyId).then((r) => {
            const list = (r?.items ?? []) as RentalItem[]
            setItems(list)
          })
        }
        toast({
          title: "Receipt submitted",
          description: "We will verify your payment shortly. This transaction may be delayed due to payment verification.",
        })
      } else {
        alert((res as { reason?: string })?.reason || "Submit failed. Please try again.")
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Submit failed. Please try again.")
    } finally {
      setPaynowSubmitLoading(false)
    }
  }

  const handleProceed = () => {
    if (tenancyReadOnly) return
    if (outstandingTotal <= 0 || loading || selectedItems.length === 0) return
    if (isSgd && (paymentGatewayProvider === "paynow" || (paymentGatewayAllowPaynow && paymentMethodSgd === "paynow"))) {
      toast({
        title: "Payment verification",
        description: "This transaction may be delayed due to payment verification.",
      })
      openPaynowModal()
    } else {
      handlePayNow()
    }
  }

  const copyUen = () => {
    if (!clientUen) return
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(clientUen).then(() => alert("UEN copied to clipboard.")).catch(() => alert("Copy failed."))
    } else {
      alert("UEN: " + clientUen)
    }
  }

  const handleStartBindSetup = async () => {
    if (tenancyReadOnly) return
    if (!selectedTenancyId || bindSetupLoading) return
    setBindSetupLoading(true)
    try {
      const cancel =
        typeof window !== "undefined"
          ? `${window.location.origin}/tenant/payment?setup_cancel=1`
          : undefined
      const res = await createPaymentMethodSetup(selectedTenancyId, cancel, "card")
      if (res?.ok && res?.type === "redirect" && res?.url) {
        window.location.href = res.url
        return
      }
      const reason = (res as { reason?: string })?.reason || ""
      if (reason.includes("PAYMENT_METHOD_SETUP_REQUIRES_STRIPE")) {
        alert("Saved card linking requires Stripe. Your operator is using another gateway—ask them to switch or add Stripe for this flow.")
      } else if (reason.includes("PAYMENT_METHOD_BIND_DISABLED")) {
        alert("Your operator has disabled linking a payment method on the portal.")
      } else if (reason.includes("PAYNOW_ONLY_FOR_SGD_OPERATOR")) {
        alert("This operator accepts PayNow only.")
      } else if (reason.includes("PAYNOW_DISABLED_FOR_OPERATOR")) {
        alert("This operator has disabled PayNow for card checkout mode.")
      } else if (reason.includes("XENDIT_BANK_DD_UNSUPPORTED_REGION")) {
        alert(
          "Bank direct-debit linking is not available for this operator’s country/currency (e.g. Malaysia/Singapore: FPX/PayNow cannot be saved for auto-debit here). Use card linking, or ask your operator to use a Xendit region that supports Direct Debit (e.g. IDR/PHP) if applicable."
        )
      } else if (reason.includes("XENDIT_BANK_DD") || reason.includes("BANK")) {
        alert(
          "Bank auto-debit setup failed. If you are in Malaysia/Singapore, use card linking instead. For Indonesia/Philippines, ensure the operator’s client currency is IDR or PHP and Direct Debit is enabled on Xendit."
        )
      } else {
        alert(reason || "Could not start card setup. Please try again.")
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not start card setup.")
    } finally {
      setBindSetupLoading(false)
    }
  }

  const handleDisconnectPaymentMethod = async () => {
    if (tenancyReadOnly) return
    if (!selectedTenancyId || disconnectLoading) return
    if (
      !confirm(
        "Remove your saved card and turn off automatic rent charging? You can link a card again later. If your operator requires a card, other portal pages may stay locked until you link again."
      )
    ) {
      return
    }
    setDisconnectLoading(true)
    try {
      const res = await disconnectPaymentMethod(selectedTenancyId)
      if (res?.ok) {
        await refetchTenant?.()
      } else {
        alert((res as { reason?: string })?.reason || "Could not remove saved payment method.")
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not remove saved payment method.")
    } finally {
      setDisconnectLoading(false)
    }
  }

  const handleRentAutoDebitToggle = async (checked: boolean) => {
    if (tenancyReadOnly) return
    if (rentAutoDebitSaving) return
    setRentAutoDebitSaving(true)
    try {
      const payload: Record<string, unknown> = { rent_auto_debit_enabled: checked }
      if (!checked) payload.xendit_auto_debit = false
      const res = await updateProfile({ profile: payload })
      if (res?.ok) {
        mergeTenantProfile?.(payload as { rent_auto_debit_enabled: boolean; xendit_auto_debit?: boolean })
      } else {
        alert((res as { reason?: string })?.reason || "Could not update preference.")
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not update preference.")
    } finally {
      setRentAutoDebitSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Payments &amp; Invoices</h1>
        <p className="text-muted-foreground mt-1">View your rental history and settle outstanding balances.</p>
      </div>

      {/* Payment result banners: success (redirect from Stripe) or cancelled */}
      {paymentSuccess && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            Payment successful. Your invoice has been marked as paid.
          </span>
          <button type="button" onClick={clearPaymentResult} className="shrink-0 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200">
            Dismiss
          </button>
        </div>
      )}
      {paymentCancel && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-medium">Payment was cancelled. You can try again when ready.</span>
          <button type="button" onClick={clearPaymentResult} className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200">
            Dismiss
          </button>
        </div>
      )}
      {setupCancel && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-medium">Card setup was cancelled.</span>
          <button type="button" onClick={clearPaymentResult} className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200">
            Dismiss
          </button>
        </div>
      )}
      {paymentMethodLockGate && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          <p className="font-bold">Auto payment setup required</p>
          <p className="text-sm mt-1 opacity-95">
            Your operator requires you to save a credit or debit card for auto payment before using the rest of the portal. Complete linking below; other pages stay locked until this is done.
          </p>
        </div>
      )}

      {/* Auto payment: saved card (Stripe / Xendit) — hidden when operator chose No allow, SG PayNow-only, or Billplz */}
      {(!isSgd || paymentGatewayProvider !== "paynow") && paymentGatewayProvider !== "billplz" && tenantPaymentMethodPolicy !== "no_allow" && (
        <div className="mb-6 rounded-xl border border-border bg-card px-4 py-3 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-foreground">Auto payment (saved card)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {paymentMethodLinked ? (
                  <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                    Card saved for auto payment. No charge was made for this step.
                  </span>
                ) : tenantPaymentMethodPolicy === "strictly" ? (
                  <>
                    Required: link a credit or debit card for auto payment (saved card only; no bank mandate). Portal stays locked until this is done.
                  </>
                ) : (
                  <>
                    Optional: save a credit or debit card for checkout and scheduled auto payment (no charge for saving). Auto payment uses card only.
                  </>
                )}
              </p>
            </div>
            {!paymentMethodLinked ? (
              <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={bindSetupLoading || !selectedTenancyId || tenancyReadOnly}
                  onClick={() => void handleStartBindSetup()}
                >
                  {bindSetupLoading ? <Loader2 size={16} className="animate-spin mr-2" /> : <CreditCard size={16} className="mr-2" />}
                  {bindSetupLoading
                    ? "Opening…"
                    : tenantPaymentMethodPolicy === "strictly"
                      ? "Link credit/debit card (required)"
                      : "Link credit/debit card"}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
                  <CheckCircle2 size={20} /> Linked for auto payment
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 text-destructive border-destructive/40 hover:bg-destructive/10"
                  disabled={disconnectLoading || !selectedTenancyId || tenancyReadOnly}
                  onClick={() => void handleDisconnectPaymentMethod()}
                >
                  {disconnectLoading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                  {disconnectLoading ? "Removing…" : "Remove saved card"}
                </Button>
              </div>
            )}
          </div>
          {paymentMethodLinked && tenantRentAutoDebitOffered && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Charge due rent automatically</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When enabled, your operator&apos;s daily billing job may charge saved card (Stripe) or saved token (Xendit) for unpaid invoices that are due. You can still pay manually anytime.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {rentAutoDebitSaving ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : null}
                <Switch
                  checked={rentAutoDebitEnabled}
                  disabled={rentAutoDebitSaving || !mergeTenantProfile || tenancyReadOnly}
                  onCheckedChange={(v) => void handleRentAutoDebitToggle(v)}
                  aria-label="Automatically charge due rent"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* PayNow modal: UEN + Copy, Upload receipt, Submit, Hint */}
      <Dialog open={paynowModalOpen} onOpenChange={setPaynowModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pay with PayNow</DialogTitle>
            <DialogDescription>
              Pay to UEN, then upload your receipt below. Verify the company name before paying. This transaction may be delayed due to payment verification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {client?.title && (
              <p className="text-sm font-medium text-foreground">Pay to: <span className="font-bold">{client.title}</span></p>
            )}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">UEN Number</p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm bg-muted px-3 py-2 rounded-lg flex-1">{clientUen || "—"}</span>
                <Button type="button" variant="outline" size="sm" onClick={copyUen} disabled={!clientUen}>
                  <Copy size={14} className="mr-1" /> Copy
                </Button>
              </div>
            </div>
            <p className="text-sm text-foreground font-semibold">Amount: {formatAmount(outstandingTotal, currencySymbol)}</p>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Upload receipt</p>
              <input type="file" accept="image/*,.pdf" className="hidden" id="paynow-receipt-upload" onChange={handlePaynowReceiptUpload} disabled={uploadingReceipt || tenancyReadOnly} />
              <Button type="button" variant="outline" className="w-full" onClick={() => document.getElementById("paynow-receipt-upload")?.click()} disabled={uploadingReceipt || tenancyReadOnly}>
                <Upload size={14} className="mr-2" /> {uploadingReceipt ? "Uploading…" : paynowReceiptUrl ? "Receipt uploaded" : "Upload receipt"}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPaynowHintOpen((v) => !v)}>
                <HelpCircle size={14} className="mr-1" /> Hint
              </Button>
              {paynowHintOpen && (
                <p className="text-xs text-muted-foreground flex-1">
                  Click Copy to copy the UEN, open your PayNow app, paste the UEN and enter the amount above. After paying, save a screenshot of the receipt and upload it here, then click Submit.
                </p>
              )}
            </div>
            <Button
              className="w-full"
              style={{ background: "var(--brand)" }}
              onClick={handlePaynowSubmit}
              disabled={!paynowReceiptUrl || paynowSubmitLoading || tenancyReadOnly}
            >
              {paynowSubmitLoading ? <><Loader2 size={16} className="animate-spin mr-2" /> Submitting…</> : "Submit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Outstanding Balance */}
        <div className="lg:col-span-2">
          <div className="bg-foreground rounded-2xl p-6 text-white">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                <CreditCard size={18} className="text-white" />
              </div>
              <h2 className="font-black text-lg">Outstanding Balance</h2>
            </div>
            <p className="text-[10px] font-semibold tracking-[0.25em] uppercase text-white/50 mb-1">Total to Pay</p>
            {loading ? (
              <p className="text-4xl font-black text-white mb-1 flex items-center gap-2">
                <Loader2 size={28} className="animate-spin" /> Loading…
              </p>
            ) : (
              <p className="text-5xl font-black text-white mb-1">{formatAmount(outstandingTotal, currencySymbol)}</p>
            )}
            <div className="flex items-center justify-between py-4 border-t border-white/10 mt-4 mb-5">
              <span className="text-sm text-white/60">Selected</span>
              <span className="text-sm font-bold text-white">{selectedItems.length} Items</span>
            </div>
            {isSgd ? (
              <div className="flex flex-col gap-3">
                {paymentGatewayProvider === "paynow" ? (
                  <div className="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
                    <p className="text-xs font-medium text-white/70">Payment method</p>
                    <p className="text-sm font-semibold text-white">PayNow only</p>
                  </div>
                ) : !paymentGatewayAllowPaynow ? (
                  <div className="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
                    <p className="text-xs font-medium text-white/70">Payment method</p>
                    <p className="text-sm font-semibold text-white">{paymentGatewayProvider === "payex" ? "Xendit only" : "Stripe only"}</p>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-medium text-white/70 block mb-1.5">Payment method</label>
                    <Select value={paymentMethodSgd} onValueChange={(v) => setPaymentMethodSgd(v as "paynow" | "gateway")} disabled={tenancyReadOnly}>
                      <SelectTrigger className="w-full bg-white/10 border-white/20 text-white [&>span]:text-white">
                        <SelectValue placeholder="Choose…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paynow">PayNow</SelectItem>
                        <SelectItem value="gateway">{paymentGatewayProvider === "payex" ? "Xendit" : "Stripe"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <button
                  onClick={handleProceed}
                  disabled={payLoading || outstandingTotal <= 0 || loading || selectedItems.length === 0 || tenancyReadOnly}
                  className="w-full py-3.5 rounded-xl font-bold text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ background: "var(--brand)" }}
                >
                  {payLoading ? <><Loader2 size={16} className="animate-spin" /> Redirecting…</> : "Proceed"}
                </button>
              </div>
            ) : (
              <button
                onClick={handlePayNow}
                disabled={payLoading || outstandingTotal <= 0 || loading || selectedItems.length === 0 || tenancyReadOnly}
                className="w-full py-3.5 rounded-xl font-bold text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: "var(--brand)" }}
              >
                {payLoading ? <><Loader2 size={16} className="animate-spin" /> Redirecting…</> : "Pay Now"}
              </button>
            )}
          </div>
        </div>

        {/* Rental History */}
        <div className="lg:col-span-3 bg-card border border-border rounded-2xl p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
            <h2 className="font-black text-lg text-foreground">Rental History</h2>
            <div className="flex flex-wrap items-center gap-2 sm:gap-2">
              <Button
                type="button"
                size="sm"
                onClick={selectAllUnpaid}
                disabled={loading || unpaidItems.length === 0 || tenancyReadOnly}
                className="h-9 px-4 font-bold text-white shadow-md hover:opacity-95 border-0"
                style={{ background: "var(--brand)" }}
              >
                <ListChecks className="h-4 w-4" />
                Select all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 font-semibold"
                onClick={selectAllOverdue}
                disabled={loading || unpaidItems.length === 0 || tenancyReadOnly}
              >
                Select all overdue
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSort(sort === "latest" ? "oldest" : "latest")}
                className="h-9 text-xs font-semibold tracking-wider uppercase text-muted-foreground hover:text-foreground"
              >
                Sort: {sort === "latest" ? "Latest" : "Oldest"}
                <ChevronDown size={13} />
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-muted-foreground" />
            </div>
          ) : sortedItems.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">No rental records found.</p>
          ) : (
            <>
              <div className="flex flex-col gap-4">
                {pagedRentalItems.map((inv) => (
                  <InvoiceRow
                    key={inv._id ?? inv.title ?? ""}
                    inv={inv}
                    selectedIds={selectedIds}
                    toggleSelect={toggleSelect}
                    isOverdue={isOverdue}
                    formatDate={formatDate}
                    currencySymbol={currencySymbol}
                    selectionDisabled={tenancyReadOnly}
                  />
                ))}
              </div>
              {rentalHistoryTotalPages > 1 && (
                <div className="flex items-center justify-between gap-4 mt-6 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    Page {rentalHistoryPageSafe} of {rentalHistoryTotalPages}
                    <span className="text-muted-foreground/70">
                      {" "}
                      ({sortedItems.length} {sortedItems.length === 1 ? "invoice" : "invoices"})
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setRentalHistoryPage((p) => Math.max(1, p - 1))}
                      disabled={rentalHistoryPageSafe <= 1}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={16} />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setRentalHistoryPage((p) => Math.min(rentalHistoryTotalPages, p + 1))}
                      disabled={rentalHistoryPageSafe >= rentalHistoryTotalPages}
                      aria-label="Next page"
                    >
                      <ChevronRight size={16} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
