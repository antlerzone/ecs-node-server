"use client"

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react"
import { SaasStripeFeeConfirmDialog } from "@/components/saas-stripe-fee-confirm-dialog"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import Link from "next/link"
import { ArrowLeft, CheckCircle, Send, Phone, ExternalLink, Menu, X } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { EnquirySwapAuthLayout } from "@/components/enquiry-swap-auth-layout"
import { SlidingSignInPanel } from "@/components/sliding-sign-in-panel"
import { SlidingRegisterPanel } from "@/components/sliding-register-panel"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PORTAL_KEYS, getMember } from "@/lib/portal-session"
import { isDemoSite } from "@/lib/portal-api"
import {
  getEnquiryApiBase,
  fetchEnquiryMe,
  ensureEnquiryOperator,
  updateEnquiryContact,
  createPlanBillplz,
  syncEnquiryPlanFromXendit,
  syncEnquiryPlanFromStripe,
  submitSgdPlanEnquiry,
} from "@/lib/enquiry-portal-api"
import { submitTicket, getOperatorClientId } from "@/lib/operator-api"

/** 完整方案说明（与 live portal 定价页一致） */
const PORTAL_PRICING_URL = "https://www.colivingjb.com/pricing"

function FullPricingLink({ className }: { className?: string }) {
  return (
    <a
      href={PORTAL_PRICING_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold uppercase tracking-wider",
        "text-white shadow-md hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",
        className
      )}
      style={{ background: "var(--brand)" }}
    >
      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-95" aria-hidden />
      More details
    </a>
  )
}

const DEMO_LOGIN_URL = "https://demo.colivingjb.com/login"
const DEMO_USERNAME = "demo123"
const DEMO_PASSWORD = "demo"

const PLAN_FINALIZE_MAX_ATTEMPTS = 45
const PLAN_FINALIZE_INTERVAL_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** client_profile.contact is stored as digits; minimum 6 for MY/SG reachability */
function contactDigitsOk(s: string | null | undefined): boolean {
  return String(s || "")
    .replace(/\D/g, "")
    .trim()
    .length >= 6
}

/** User-visible message for POST /api/enquiry/xendit-plan-sync failure reasons */
function enquiryPlanSyncErrorMessage(reason: string | undefined): string {
  switch (reason) {
    case "EMAIL_MISMATCH":
      return "The signed-in email does not match your operator record. Sign in with the same email you used for enquiry, then open this page again."
    case "OPERATOR_NOT_FOUND":
    case "LOG_NOT_FOUND":
      return "We could not match this payment to your account. Contact support with your receipt."
    case "NO_XENDIT_INVOICE_ON_LOG":
      return "Checkout data is incomplete. Contact support."
    case "AMOUNT_MISMATCH":
      return "Payment amount did not match the selected plan. Contact support."
    case "NOT_ENQUIRY_CHECKOUT_LOG":
      return "Invalid checkout session."
    case "FETCH_INVOICE_FAILED":
      return "Could not verify payment with the gateway. Wait a minute and refresh this page."
    default:
      return reason
        ? `Could not confirm payment (${reason}). Try refreshing this page or contact support.`
        : "Could not confirm payment. Try refreshing this page."
  }
}

/** Xendit invoice statuses that mean “still in progress” — keep polling */
function xenditStatusLooksPending(status: string | undefined): boolean {
  const s = String(status || "").toUpperCase()
  if (!s) return true
  return ["PENDING", "AWAITING_PAYMENT", "ACTIVE"].includes(s)
}

function xenditStatusLooksFailed(status: string | undefined): boolean {
  const s = String(status || "").toUpperCase()
  return ["EXPIRED", "CANCELLED", "FAILED", "VOIDED"].includes(s)
}

function getEcsBase(): string {
  return (process.env.NEXT_PUBLIC_ECS_BASE_URL ?? "").replace(/\/$/, "")
}

type PlanRow = {
  id: string
  title: string
  description?: string
  sellingprice?: number
  corecredit?: number
  currency?: string
}

function PlanSelect({
  plans,
  value,
  onValueChange,
  placeholder,
  disabled,
}: {
  plans: PlanRow[]
  value: string
  onValueChange: (id: string) => void
  placeholder: string
  disabled?: boolean
}) {
  if (plans.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading plans…</p>
  }
  return (
    <Select value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-[280px]">
        {plans.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function EnquiryPageInner() {
  const searchParams = useSearchParams()
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [paidBanner, setPaidBanner] = useState(false)
  /** After manual plan enquiry: show success dialog to collect mobile (Google has no phone). */
  const [enquirySuccessContactDialogOpen, setEnquirySuccessContactDialogOpen] = useState(false)
  /** After save: show thanks copy only. */
  const [enquiryDialogPhase, setEnquiryDialogPhase] = useState<"phone" | "thanks">("phone")
  const [enquiryDialogPhone, setEnquiryDialogPhone] = useState("")
  const [enquiryDialogSaving, setEnquiryDialogSaving] = useState(false)
  const [enquiryDialogError, setEnquiryDialogError] = useState<string | null>(null)
  const [planFeeDialogOpen, setPlanFeeDialogOpen] = useState(false)
  const [planFeeManualBusy, setPlanFeeManualBusy] = useState(false)
  const [planFeeStripeBusy, setPlanFeeStripeBusy] = useState(false)
  const [jwtReady, setJwtReady] = useState(
    () => typeof window !== "undefined" && !!localStorage.getItem(PORTAL_KEYS.PORTAL_JWT)
  )
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [hasOperator, setHasOperator] = useState<boolean | null>(null)
  const [operatorMeta, setOperatorMeta] = useState<{
    hasActivePlan?: boolean
    currency?: string
    status?: number
    contact?: string | null
  } | null>(null)

  const [plans, setPlans] = useState<PlanRow[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | undefined>(undefined)
  const [selectedInterestId, setSelectedInterestId] = useState("")

  const [showDemoPopup, setShowDemoPopup] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [country, setCountry] = useState<"MY" | "SG">("MY")
  /** Mobile — Google OAuth does not provide a phone number */
  const [contactPhone, setContactPhone] = useState("")
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    units: "",
  })

  const [enquiryNavOpen, setEnquiryNavOpen] = useState(false)
  const [legacySubmitted, setLegacySubmitted] = useState(false)
  /** Step 3：demo 或付費；MYR / SGD → 平台 Xendit（FPX 或 Session / v3 卡） */
  const [pathChoice, setPathChoice] = useState<null | "demo" | "paid">(null)
  const planFinalizeSyncDoneRef = useRef(false)

  useEffect(() => {
    const err = searchParams.get("error")
    if (err) {
      const msg =
        err === "OAUTH_NOT_CONFIGURED"
          ? "Google sign-in is not configured."
          : err === "OAUTH_ERROR"
            ? "Sign-in failed. Please try again."
            : err === "EMAIL_NOT_REGISTERED"
              ? "Account not registered."
              : err.replace(/\+/g, " ")
      setOauthError(msg)
    }
    if (searchParams.get("paid") === "1") {
      setPaidBanner(true)
    }
  }, [searchParams])

  useEffect(() => {
    if (typeof window === "undefined") return
    setJwtReady(!!localStorage.getItem(PORTAL_KEYS.PORTAL_JWT))
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const onStorage = (e: StorageEvent) => {
      if (e.key === PORTAL_KEYS.PORTAL_JWT || e.key === null) {
        setJwtReady(!!localStorage.getItem(PORTAL_KEYS.PORTAL_JWT))
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const loadPublicPlans = useCallback(async () => {
    const base = getEcsBase()
    if (!base) return
    try {
      const res = await fetch(`${base}/api/enquiry/plans`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      const items = (data as { items?: PlanRow[] }).items
      if (Array.isArray(items)) setPlans(items)
    } catch {
      /* ignore */
    }
  }, [])

  const refreshSession = useCallback(async () => {
    if (isDemoSite() || !getEnquiryApiBase()) return
    setLoadingProfile(true)
    setSubmitError(null)
    try {
      const me = await fetchEnquiryMe()
      if (me?.hasOperator && me.operator) {
        setHasOperator(true)
        const oc = me.operator.contact
        setOperatorMeta({
          hasActivePlan: me.operator.hasActivePlan,
          currency: me.operator.currency,
          status: me.operator.status,
          contact: oc ?? null,
        })
        if (contactDigitsOk(oc)) {
          setContactPhone(String(oc).replace(/\D/g, ""))
        }
      } else {
        setHasOperator(false)
        setOperatorMeta(null)
        setContactPhone("")
      }
    } catch (e) {
      console.error(e)
      if (typeof window !== "undefined" && !localStorage.getItem(PORTAL_KEYS.PORTAL_JWT)) {
        setJwtReady(false)
      }
      setSubmitError("Could not load your profile. Try signing in again.")
      setHasOperator(null)
    } finally {
      setLoadingProfile(false)
    }
  }, [])

  /** 支付回跳：?plan_finalize=…；Stripe 带 session_id，否则 legacy Xendit 轮询 */
  useEffect(() => {
    if (typeof window === "undefined") return
    if (isDemoSite() || !getEnquiryApiBase()) return
    const finalizeId = searchParams.get("plan_finalize")?.trim()
    const stripeSessionId = searchParams.get("session_id")?.trim()
    if (!finalizeId) {
      planFinalizeSyncDoneRef.current = false
      return
    }
    if (!jwtReady) return
    if (planFinalizeSyncDoneRef.current) return
    planFinalizeSyncDoneRef.current = true
    let cancelled = false
    void (async () => {
      try {
        let finalized = false
        for (let attempt = 0; attempt < PLAN_FINALIZE_MAX_ATTEMPTS; attempt++) {
          if (cancelled) return
          let r: Awaited<ReturnType<typeof syncEnquiryPlanFromXendit>>
          try {
            if (stripeSessionId) {
              r = await syncEnquiryPlanFromStripe(finalizeId, stripeSessionId)
            } else {
              r = await syncEnquiryPlanFromXendit(finalizeId)
            }
          } catch (e) {
            console.warn("[enquiry] plan_finalize sync attempt error", attempt, e)
            if (attempt >= PLAN_FINALIZE_MAX_ATTEMPTS - 1) {
              setSubmitError(enquiryPlanSyncErrorMessage("FETCH_INVOICE_FAILED"))
              finalized = true
            } else {
              await sleep(PLAN_FINALIZE_INTERVAL_MS)
            }
            continue
          }
          if (cancelled) return
          if (r?.paid || r?.already) {
            setPaidBanner(true)
            await refreshSession()
            finalized = true
            break
          }
          if (r?.ok === false) {
            setSubmitError(enquiryPlanSyncErrorMessage(r.reason))
            finalized = true
            break
          }
          const st = r?.status
          if (xenditStatusLooksFailed(st)) {
            setSubmitError(
              "Payment was not completed in the gateway. If you were charged, contact support with your receipt."
            )
            finalized = true
            break
          }
          if (
            r?.ok === true &&
            (r as { paid?: boolean }).paid === false &&
            (xenditStatusLooksPending(st) || (Boolean(stripeSessionId) && String(st || "").toLowerCase() === "unpaid"))
          ) {
            await sleep(PLAN_FINALIZE_INTERVAL_MS)
            continue
          }
          console.warn("[enquiry] plan_finalize unexpected sync result", r)
          await sleep(PLAN_FINALIZE_INTERVAL_MS)
        }
        if (!cancelled && !finalized) {
          setSubmitError(
            "Payment is still being confirmed. Wait a minute and refresh this page, or check your email for confirmation."
          )
        }
      } finally {
        if (cancelled) return
        const params = new URLSearchParams(window.location.search)
        params.delete("plan_finalize")
        params.delete("session_id")
        const qs = params.toString()
        const next = window.location.pathname + (qs ? `?${qs}` : "") + (window.location.hash || "")
        window.history.replaceState(null, "", next)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [searchParams, jwtReady, refreshSession])

  useEffect(() => {
    loadPublicPlans()
  }, [loadPublicPlans])

  useEffect(() => {
    if (isDemoSite() || !getEnquiryApiBase()) return
    if (!jwtReady) return
    void refreshSession()
  }, [jwtReady, refreshSession])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (isDemoSite() || !getEnquiryApiBase()) return
    if (!jwtReady) return
    if (hasOperator !== true || !operatorMeta?.hasActivePlan) return
    window.location.replace("/portal")
  }, [jwtReady, hasOperator, operatorMeta?.hasActivePlan])

  /** 已有 operator 但無有效 plan：直接進入選方案（略過 demo/購買雙按鈕） */
  useEffect(() => {
    if (!jwtReady) return
    if (isDemoSite() || !getEnquiryApiBase()) return
    if (loadingProfile) return
    if (hasOperator !== true) return
    if (!operatorMeta || operatorMeta.hasActivePlan) return
    if (pathChoice !== null) return
    setPathChoice("paid")
  }, [jwtReady, loadingProfile, hasOperator, operatorMeta, pathChoice])

  /** 1 帳號 → 2 區域/載入（或試用 demo） → 3 選方案與付款 */
  const wizardStep = useMemo<1 | 2 | 3>(() => {
    if (!jwtReady) return 1
    if (loadingProfile || hasOperator === null) return 2
    if (hasOperator === false) return 2
    if (pathChoice === "demo") return 2
    if (pathChoice === "paid") return 3
    return 2
  }, [jwtReady, loadingProfile, hasOperator, pathChoice])

  /** Step 2 region → operatordetail.currency; MYR/SGD 線上付：Stripe Checkout（Malaysia test） */
  const operatorCurrency = String(operatorMeta?.currency || "").trim().toUpperCase()
  const canOnlinePlanCheckout = operatorCurrency === "MYR" || operatorCurrency === "SGD"
  const operatorStripeCurrency = (operatorCurrency === "SGD" ? "SGD" : "MYR") as "MYR" | "SGD"
  const selectedPlanSubtotal = useMemo(() => {
    const p = plans.find((x) => x.id === selectedPlanId)
    return Number(p?.sellingprice) || 0
  }, [plans, selectedPlanId])

  useEffect(() => {
    if (!jwtReady) setPathChoice(null)
  }, [jwtReady])

  useEffect(() => {
    const m = getMember()
    if (m?.email && !form.email) {
      setForm((f) => ({ ...f, email: m.email }))
    }
  }, [form.email])

  useEffect(() => {
    if (!enquirySuccessContactDialogOpen) return
    setEnquiryDialogPhase("phone")
    const fromMeta = operatorMeta?.contact ? String(operatorMeta.contact).replace(/\D/g, "") : ""
    const fromField = contactPhone.replace(/\D/g, "")
    setEnquiryDialogPhone(fromMeta || fromField)
    setEnquiryDialogError(null)
  }, [enquirySuccessContactDialogOpen, operatorMeta?.contact, contactPhone])

  const handleSaveContactOnly = async () => {
    if (!contactDigitsOk(contactPhone)) {
      setSubmitError("Enter a valid mobile number (at least 6 digits).")
      return
    }
    setSubmitError(null)
    setIsLoading(true)
    try {
      const res = await updateEnquiryContact(contactPhone)
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        const reason = (res as { reason?: string }).reason
        if (reason === "INVALID_CONTACT") {
          setSubmitError("Enter a valid mobile number (at least 6 digits).")
        } else if (reason === "NO_OPERATOR_PROFILE") {
          setSubmitError("Account not found. Try continuing from billing region first.")
        } else {
          setSubmitError("Could not save your number. Try again.")
        }
        return
      }
      await refreshSession()
    } catch (err) {
      console.error(err)
      setSubmitError(err instanceof Error ? err.message : "Request failed.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleEnquirySuccessSavePhone = async () => {
    if (!contactDigitsOk(enquiryDialogPhone)) {
      setEnquiryDialogError("Enter a valid mobile number (at least 6 digits).")
      return
    }
    setEnquiryDialogError(null)
    setEnquiryDialogSaving(true)
    try {
      const res = await updateEnquiryContact(enquiryDialogPhone)
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        const reason = (res as { reason?: string }).reason
        if (reason === "INVALID_CONTACT") {
          setEnquiryDialogError("Enter a valid mobile number (at least 6 digits).")
        } else if (reason === "NO_OPERATOR_PROFILE") {
          setEnquiryDialogError("Account not found. Please refresh and try again.")
        } else {
          setEnquiryDialogError("Could not save your number. Try again.")
        }
        return
      }
      setContactPhone(enquiryDialogPhone)
      setEnquiryDialogPhase("thanks")
      await refreshSession()
    } catch (err) {
      console.error(err)
      setEnquiryDialogError(err instanceof Error ? err.message : "Request failed.")
    } finally {
      setEnquiryDialogSaving(false)
    }
  }

  const handleEnsureOperator = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    setIsLoading(true)
    try {
      const res = await ensureEnquiryOperator({ country, contact: contactPhone })
      if (res?.ok === false) {
        const reason = res.reason || "SUBMIT_FAILED"
        if (reason === "EMAIL_ALREADY_REGISTERED") {
          setSubmitError("This email already has an account. Continue to the next step.")
          await refreshSession()
        } else if (reason === "INVALID_CONTACT") {
          setSubmitError("Enter a valid mobile number (at least 6 digits).")
        } else {
          setSubmitError("Something went wrong. Please try again.")
        }
        return
      }
      await refreshSession()
    } catch (err) {
      console.error(err)
      setSubmitError(err instanceof Error ? err.message : "Request failed.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleLegacySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    setIsLoading(true)
    try {
      const title = (form.company || form.name || "").trim()
      const email = (form.email || "").trim().toLowerCase()
      if (!title || !email) {
        setSubmitError("Please fill in Company name and Email.")
        return
      }
      const planLabel = selectedInterestId
        ? (plans.find((p) => p.id === selectedInterestId)?.title ?? selectedInterestId)
        : undefined
      const res = await fetch("/api/enquiry/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          email,
          currency: country === "SG" ? "SGD" : "MYR",
          country,
          contact: (form.phone || "").trim() || undefined,
          number_of_units: (form.units || "").trim() || undefined,
          plan_of_interest: planLabel,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        const reason = data.reason || "SUBMIT_FAILED"
        if (reason === "EMAIL_ALREADY_REGISTERED") {
          setSubmitError("This email is already registered. Please use another email or log in.")
        } else {
          setSubmitError("Something went wrong. Please try again.")
        }
        return
      }
      setLegacySubmitted(true)
      setShowDemoPopup(true)
    } catch (err) {
      console.error(err)
      setSubmitError("Request failed.")
    } finally {
      setIsLoading(false)
    }
  }

  const startBillplz = async () => {
    if (!contactDigitsOk(operatorMeta?.contact)) {
      setSubmitError("Add your mobile number above so we can reach you.")
      return
    }
    if (!selectedPlanId) {
      setSubmitError("Please select a pricing plan.")
      return
    }
    setSubmitError(null)
    setIsLoading(true)
    try {
      const remark =
        operatorMeta?.status === 0
          ? "new_customer"
          : operatorMeta?.hasActivePlan
            ? "renew"
            : "new_customer"
      const res = await createPlanBillplz(selectedPlanId, remark)
      if (res?.ok === false || !res?.billUrl) {
        const reason = (res as { reason?: string })?.reason
        if (reason === "SGD_LARGE_AMOUNT_USE_ENQUIRY") {
          try {
            const sub = await submitSgdPlanEnquiry(selectedPlanId)
            if (sub?.ok === false) {
              setSubmitError(
                (sub as { reason?: string })?.reason === "PLAN_NOT_FOUND"
                  ? "Invalid plan. Please pick a plan again."
                  : "Could not submit your enquiry. Please try again or contact us."
              )
              return
            }
            setEnquirySuccessContactDialogOpen(true)
            await refreshSession()
            setSubmitError(null)
          } catch (err) {
            console.error(err)
            setSubmitError("Could not submit your plan enquiry. Please try again.")
          }
          return
        }
        if (reason === "UNSUPPORTED_CHECKOUT_CURRENCY") {
          setSubmitError("Online checkout is only available for Malaysia (MYR) or Singapore (SGD) billing. Please contact us.")
        } else if (reason === "BILLPLZ_MYR_ONLY") {
          setSubmitError("Online checkout is only available for MYR or SGD accounts. Please contact us.")
        } else if (reason === "SGD_ONLINE_CHECKOUT_DISABLED") {
          setSubmitError(
            (res as { message?: string })?.message ||
              "SGD online checkout is disabled on this server. Contact support or choose Malaysia (MYR) billing."
          )
        } else if (reason === "XENDIT_PR3_NO_REDIRECT" || reason === "XENDIT_PAYMENT_REQUEST_V3_FAILED") {
          setSubmitError(
            (res as { message?: string })?.message ||
              "Could not start SGD card checkout. Check Xendit SG card channel or try Payment Session mode."
          )
        } else if (reason === "XENDIT_CURRENCY_NOT_CONFIGURED") {
          setSubmitError(
            (res as { message?: string })?.message ||
              "SGD is not enabled on the Xendit merchant yet. Ask Xendit to activate SGD for Invoice/cards (MYR settlement can still apply)."
          )
        } else if (reason === "SAAS_XENDIT_NOT_CONFIGURED" || reason === "SAAS_BILLPLZ_NOT_CONFIGURED") {
          setSubmitError("Payment is not configured yet. Please contact support.")
        } else {
          setSubmitError("Could not start payment. Try again or contact us.")
        }
        return
      }
      window.location.href = res.billUrl
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : "Payment failed to start."
      if (msg === "UNAUTHORIZED") {
        setSubmitError("Your session expired. Please sign in again from the enquiry page, then continue to payment.")
      } else if (msg === "UNSUPPORTED_CHECKOUT_CURRENCY" || msg === "BILLPLZ_MYR_ONLY") {
        setSubmitError("Online checkout is only available for MYR or SGD accounts. Please contact us.")
      } else if (msg === "SAAS_XENDIT_NOT_CONFIGURED" || msg === "SAAS_BILLPLZ_NOT_CONFIGURED") {
        setSubmitError("Payment is not configured yet. Please contact support.")
      } else if (msg === "SAAS_PUBLIC_API_BASE_NOT_SET") {
        setSubmitError("Server configuration incomplete (public API base). Please contact support.")
      } else {
        setSubmitError(msg)
      }
    } finally {
      setIsLoading(false)
    }
  }

  if (legacySubmitted && (isDemoSite() || !getEnquiryApiBase())) {
    return (
      <>
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
              <CheckCircle size={40} className="text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-3">Enquiry Received!</h2>
            <p className="text-muted-foreground mb-6 leading-relaxed">
              Thank you for your interest. Our team will get back to you.
            </p>
            <button
              type="button"
              onClick={() => setShowDemoPopup(true)}
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto font-semibold text-sm tracking-widest uppercase px-6 py-3 rounded-full text-white hover:opacity-90 transition-opacity mb-6"
              style={{ background: "var(--brand)" }}
            >
              Want to try the platform first? <ArrowLeft size={14} className="rotate-180" />
            </button>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a href="https://www.colivingjb.com">
                <Button variant="outline" className="w-full sm:w-auto">Back to Home</Button>
              </a>
              <Link href="/enquiry?mode=signup">
                <Button variant="outline" className="w-full sm:w-auto">Register</Button>
              </Link>
            </div>
          </div>
        </div>
        <Dialog open={showDemoPopup} onOpenChange={setShowDemoPopup}>
          <DialogContent className="sm:max-w-md" showCloseButton>
            <DialogHeader>
              <DialogTitle className="text-base font-bold uppercase tracking-wide">Want to try the platform first?</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <p className="text-sm text-foreground">
                Go to{" "}
                <a href={DEMO_LOGIN_URL} target="_blank" rel="noopener noreferrer" className="font-semibold underline" style={{ color: "var(--brand)" }}>
                  demo.colivingjb.com/login
                </a>
              </p>
              <p className="text-sm text-foreground font-mono">Username: {DEMO_USERNAME}</p>
              <p className="text-sm text-foreground font-mono">Password: {DEMO_PASSWORD}</p>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  const showLiveFlow = !isDemoSite() && !!getEnquiryApiBase()

  const enquiryAuthInitialPage =
    searchParams.get("mode") === "signup" ? ("signup" as const) : ("signin" as const)

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="shrink-0 border-b border-border bg-card z-20">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-8 py-3 sm:py-4">
          <Link href="/" className="flex flex-col leading-tight min-w-0 text-left">
            <span className="text-lg font-bold tracking-widest text-primary uppercase truncate">Coliving</span>
            <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
          </Link>
          <nav className="hidden md:flex items-center gap-5 flex-wrap justify-end">
            <Link
              href="/pricing"
              className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/privacy-policy"
              className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
            >
              Privacy Policy
            </Link>
            <Link
              href="/enquiry?mode=signup"
              className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
            >
              Sign up
            </Link>
            <Link
              href="/enquiry"
              className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
            >
              Sign in
            </Link>
            <a
              href="https://www.colivingjb.com"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft size={14} aria-hidden /> Back to Home
            </a>
          </nav>
          <button
            type="button"
            className="md:hidden p-2 -mr-2 rounded-lg hover:bg-muted/80"
            aria-expanded={enquiryNavOpen}
            aria-controls="enquiry-mobile-nav"
            aria-label={enquiryNavOpen ? "Close menu" : "Open menu"}
            onClick={() => setEnquiryNavOpen((o) => !o)}
          >
            {enquiryNavOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        <AnimatePresence>
          {enquiryNavOpen ? (
            <motion.nav
              id="enquiry-mobile-nav"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden border-t border-border bg-card overflow-hidden"
            >
              <div className="px-4 pb-4 pt-1 flex flex-col gap-0.5">
                <Link
                  href="/pricing"
                  onClick={() => setEnquiryNavOpen(false)}
                  className="text-sm font-semibold tracking-widest uppercase text-foreground hover:bg-muted/70 rounded-xl px-3 py-3"
                >
                  Pricing
                </Link>
                <Link
                  href="/privacy-policy"
                  onClick={() => setEnquiryNavOpen(false)}
                  className="text-sm font-semibold tracking-widest uppercase text-foreground hover:bg-muted/70 rounded-xl px-3 py-3"
                >
                  Privacy Policy
                </Link>
                <Link
                  href="/enquiry?mode=signup"
                  onClick={() => setEnquiryNavOpen(false)}
                  className="text-sm font-semibold tracking-widest uppercase text-foreground hover:bg-muted/70 rounded-xl px-3 py-3"
                >
                  Sign up
                </Link>
                <Link
                  href="/enquiry"
                  onClick={() => setEnquiryNavOpen(false)}
                  className="text-sm font-semibold tracking-widest uppercase text-foreground hover:bg-muted/70 rounded-xl px-3 py-3"
                >
                  Sign in
                </Link>
                <a
                  href="https://www.colivingjb.com"
                  onClick={() => setEnquiryNavOpen(false)}
                  className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-xl px-3 py-3"
                >
                  <ArrowLeft size={14} aria-hidden /> Back to Home
                </a>
              </div>
            </motion.nav>
          ) : null}
        </AnimatePresence>
      </header>

      {showLiveFlow && !jwtReady ? (
        <div className="flex flex-1 flex-col w-full min-h-0">
          {oauthError && (
            <div className="w-full shrink-0 px-4 sm:px-8 pt-4">
              <div className="max-w-6xl mx-auto rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
                {oauthError}
              </div>
            </div>
          )}
          <div className="flex flex-1 flex-col min-h-0 w-full">
            <EnquirySwapAuthLayout
              initialPage={enquiryAuthInitialPage}
              signIn={
                <SlidingSignInPanel afterLogin="/enquiry" oauthEnquiry />
              }
              signUp={<SlidingRegisterPanel nextPath="/enquiry" />}
            />
          </div>
        </div>
      ) : (
      <div
        className={`mx-auto w-full px-4 sm:px-8 py-10 flex-1 ${
          showLiveFlow && jwtReady && wizardStep > 1 ? "max-w-2xl" : "max-w-lg"
        }`}
      >
        {oauthError && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">{oauthError}</div>
        )}
        {paidBanner && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 text-green-900 px-4 py-3 text-sm">
            Payment received. If your plan is not active within a few minutes, please refresh or contact support.
          </div>
        )}

        {showLiveFlow ? (
          <>
            {wizardStep > 1 ? (
              <p className="text-center text-sm font-semibold text-muted-foreground tracking-wide mb-6">
                Step {wizardStep} of 3
              </p>
            ) : null}
            <div className="min-w-0 bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
              {loadingProfile ? (
                <div className="flex items-center justify-center gap-2 text-muted-foreground py-8">
                  <Spinner size="sm" /> Loading your account…
                </div>
              ) : (
                <>
                  {hasOperator === false && (
                    <form onSubmit={(e) => void handleEnsureOperator(e)} className="space-y-4">
                      <h2 className="text-lg font-bold text-foreground text-center">Billing region</h2>
                      <p className="text-sm text-muted-foreground text-center">
                        Choose where your subscription will be billed. You can add company details later in the portal after payment.
                      </p>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground block mb-2 uppercase tracking-wide">Region</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setCountry("MY")}
                            className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${country === "MY" ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40"}`}
                          >
                            Malaysia (MYR)
                          </button>
                          <button
                            type="button"
                            onClick={() => setCountry("SG")}
                            className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${country === "SG" ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40"}`}
                          >
                            Singapore (SGD)
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Pricing: see{" "}
                        <a
                          href={PORTAL_PRICING_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold underline"
                          style={{ color: "var(--brand)" }}
                        >
                          full plans
                        </a>
                        . Next you will choose a plan and pay online (MYR: Xendit; SGD: Stripe).
                      </p>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground block mb-2 uppercase tracking-wide">
                          Mobile number <span className="text-destructive">*</span>
                        </label>
                        <Input
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel"
                          placeholder="e.g. 0123456789"
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value.replace(/\D/g, ""))}
                          className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground mt-1.5">
                          Google sign-in does not provide a phone number — please enter one so our team can reach you.
                        </p>
                      </div>
                      {submitError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{submitError}</p>}
                      <Button
                        type="submit"
                        disabled={isLoading || !contactDigitsOk(contactPhone)}
                        className="w-full gap-2"
                        style={{ background: "var(--brand)" }}
                      >
                        {isLoading ? (
                          <>
                            <Spinner size="sm" /> Continuing…
                          </>
                        ) : (
                          "Continue to plan"
                        )}
                      </Button>
                    </form>
                  )}

                    {hasOperator && pathChoice === "demo" && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="text-lg font-bold text-foreground">Demo account</h2>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setPathChoice("paid")}>
                            Back to plan
                          </Button>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Use the shared demo login (read-only). This is separate from your live operator account.
                        </p>
                        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm space-y-2">
                          <p>
                            Open{" "}
                            <a
                              href={DEMO_LOGIN_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold underline"
                              style={{ color: "var(--brand)" }}
                            >
                              demo.colivingjb.com/login
                            </a>
                          </p>
                          <p className="font-mono text-xs">Username: {DEMO_USERNAME}</p>
                          <p className="font-mono text-xs">Password: {DEMO_PASSWORD}</p>
                        </div>
                        <Button type="button" variant="outline" className="w-full" onClick={() => setShowDemoPopup(true)}>
                          Open instructions in a dialog
                        </Button>
                      </div>
                    )}

                    {hasOperator && pathChoice === "paid" && (
                      <div className="space-y-6">
                        {!contactDigitsOk(operatorMeta?.contact) ? (
                          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                            <div className="flex items-start gap-3">
                              <Phone className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
                              <div className="min-w-0 space-y-1">
                                <p className="text-sm font-semibold text-foreground">Mobile number</p>
                                <p className="text-xs text-muted-foreground">
                                  Google sign-in does not include your phone. Save a number so we can reach you about your plan or payment.
                                </p>
                              </div>
                            </div>
                            <Input
                              type="tel"
                              inputMode="numeric"
                              autoComplete="tel"
                              placeholder="e.g. 0123456789"
                              value={contactPhone}
                              onChange={(e) => setContactPhone(e.target.value.replace(/\D/g, ""))}
                              className="font-mono max-w-md"
                            />
                            {submitError && (
                              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{submitError}</p>
                            )}
                            <Button
                              type="button"
                              disabled={isLoading || !contactDigitsOk(contactPhone)}
                              className="gap-2"
                              style={{ background: "var(--brand)" }}
                              onClick={() => void handleSaveContactOnly()}
                            >
                              {isLoading ? <Spinner size="sm" /> : null}
                              Save mobile number
                            </Button>
                          </div>
                        ) : null}
                        <div className="min-w-0 space-y-2">
                          <h2 className="text-lg font-bold text-foreground">Choose your plan</h2>
                          {canOnlinePlanCheckout ? (
                            <p className="text-sm text-muted-foreground">
                              Select a{" "}
                              <a
                                href={PORTAL_PRICING_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold underline"
                                style={{ color: "var(--brand)" }}
                              >
                                plan
                              </a>
                              , then continue — your browser will open secure checkout
                              {operatorCurrency === "MYR" ? " (MYR: Xendit)." : " (SGD: Stripe)."}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Online checkout is only for Malaysia (MYR) or Singapore (SGD) billing. Please contact us to arrange payment.
                            </p>
                          )}
                        </div>
                        <div className="space-y-4">
                          <>
                            <PlanSelect
                              plans={plans}
                              value={selectedPlanId}
                              onValueChange={setSelectedPlanId}
                              placeholder={canOnlinePlanCheckout ? "Select a plan to pay" : "Select a plan"}
                            />
                            {submitError && (
                              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                {submitError}
                              </p>
                            )}
                            {canOnlinePlanCheckout ? (
                              <div className="flex flex-col gap-2">
                                <Button
                                  type="button"
                                  className="w-full gap-2"
                                  style={{ background: "var(--brand)" }}
                                  disabled={
                                    isLoading || !selectedPlanId || !contactDigitsOk(operatorMeta?.contact)
                                  }
                                  onClick={() => {
                                    if (operatorCurrency === "MYR") void startBillplz()
                                    else setPlanFeeDialogOpen(true)
                                  }}
                                >
                                  {isLoading ? <Spinner size="sm" /> : null}
                                  {operatorCurrency === "MYR"
                                    ? "Continue to payment (MYR — Xendit)"
                                    : "Continue to payment (SGD — Stripe)"}
                                </Button>
                                <Button
                                  type="button"
                                  className="w-full gap-2 text-white hover:text-white hover:brightness-95"
                                  style={{ background: "var(--brand)", color: "#fff" }}
                                  onClick={() => setPathChoice("demo")}
                                >
                                  Try demo instead
                                </Button>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">
                                  For billing questions email{" "}
                                  <a
                                    href="mailto:colivingmanagement@gmail.com"
                                    className="font-semibold underline"
                                    style={{ color: "var(--brand)" }}
                                  >
                                    colivingmanagement@gmail.com
                                  </a>
                                  .
                                </p>
                                <Button
                                  type="button"
                                  className="w-full gap-2 text-white hover:text-white hover:brightness-95"
                                  style={{ background: "var(--brand)", color: "#fff" }}
                                  onClick={() => setPathChoice("demo")}
                                >
                                  Try demo instead
                                </Button>
                              </div>
                            )}
                          </>
                        </div>
                      </div>
                    )}
                  {jwtReady && hasOperator === null && !loadingProfile && (
                    <p className="text-sm text-destructive text-center">
                      Could not determine your account state. Try refreshing or sign in again.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="min-w-0 bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm">
            <form onSubmit={handleLegacySubmit} className="space-y-4">
              <h2 className="text-lg font-bold text-foreground mb-2">Send an Enquiry (demo / offline)</h2>
              <p className="text-sm text-muted-foreground mb-4">
                On the live portal, use Google sign-in for the full onboarding flow. Here you can still submit a lead without signing in.
              </p>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-2 uppercase tracking-wide">Region</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCountry("MY")}
                      className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${country === "MY" ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40"}`}
                    >
                      Malaysia (MYR)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCountry("SG")}
                      className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${country === "SG" ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40"}`}
                    >
                      Singapore (SGD)
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Full Name *</label>
                    <Input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Company *</label>
                    <Input required value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
                  </div>
                </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Email *</label>
                  <Input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Phone</label>
                  <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Plan of interest</span>
                  <FullPricingLink />
                </div>
                <PlanSelect
                  plans={plans}
                  value={selectedInterestId}
                  onValueChange={setSelectedInterestId}
                  placeholder="Optional — select a plan"
                />
              </div>
              {submitError && <p className="text-sm text-red-600">{submitError}</p>}
              <Button type="submit" disabled={isLoading} className="w-full" style={{ background: "var(--brand)" }}>
                {isLoading ? <Spinner size="sm" /> : <Send size={15} />} Send Enquiry
              </Button>
            </form>
          </div>
        )}
      </div>
      )}

      <Dialog open={showDemoPopup} onOpenChange={setShowDemoPopup}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle className="text-base font-bold uppercase tracking-wide">Demo account</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2 text-sm">
            <p>
              Open{" "}
              <a href={DEMO_LOGIN_URL} target="_blank" rel="noopener noreferrer" className="font-semibold underline" style={{ color: "var(--brand)" }}>
                demo.colivingjb.com/login
              </a>
            </p>
            <p className="font-mono">Username: {DEMO_USERNAME}</p>
            <p className="font-mono">Password: {DEMO_PASSWORD}</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={enquirySuccessContactDialogOpen}
        onOpenChange={(open) => {
          setEnquirySuccessContactDialogOpen(open)
          if (!open) setEnquiryDialogPhase("phone")
        }}
      >
        <DialogContent className="w-[min(100vw-1rem,24rem)] max-w-lg overflow-x-hidden sm:max-w-md">
          {enquiryDialogPhase === "phone" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">Mobile number</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Input
                  id="enquiry-success-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="e.g. 0123456789"
                  aria-label="Mobile number"
                  className="font-mono max-w-full"
                  value={enquiryDialogPhone}
                  onChange={(e) => setEnquiryDialogPhone(e.target.value.replace(/\D/g, ""))}
                />
                {enquiryDialogError ? <p className="text-sm text-destructive">{enquiryDialogError}</p> : null}
              </div>
              <DialogFooter className="!flex w-full min-w-0 max-w-full flex-col gap-2 overflow-x-hidden sm:!flex-col">
                <Button
                  type="button"
                  className="w-full text-white hover:text-white hover:brightness-95"
                  style={{ background: "var(--brand)" }}
                  disabled={enquiryDialogSaving || !contactDigitsOk(enquiryDialogPhone)}
                  onClick={() => void handleEnquirySuccessSavePhone()}
                >
                  {enquiryDialogSaving ? <Spinner size="sm" className="mr-2" /> : null}
                  Save number and close
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={enquiryDialogSaving}
                  onClick={() => setEnquirySuccessContactDialogOpen(false)}
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="sr-only">Enquiry confirmation</DialogTitle>
                <DialogDescription className="pt-1 text-left text-base leading-relaxed text-foreground">
                  Your plan enquiry was sent. Our team will contact you within 24 hours.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="!flex w-full sm:!flex-col">
                <Button
                  type="button"
                  className="w-full text-white hover:text-white hover:brightness-95"
                  style={{ background: "var(--brand)" }}
                  onClick={() => setEnquirySuccessContactDialogOpen(false)}
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <SaasStripeFeeConfirmDialog
        open={planFeeDialogOpen}
        onOpenChange={setPlanFeeDialogOpen}
        subtotalMajor={selectedPlanSubtotal}
        currency={operatorStripeCurrency}
        manualBusy={planFeeManualBusy}
        stripeBusy={planFeeStripeBusy}
        onManualPayment={async ({ receiptUrl }) => {
          if (!selectedPlanId) return
          setPlanFeeManualBusy(true)
          setSubmitError(null)
          try {
            const sub = await submitSgdPlanEnquiry(selectedPlanId, receiptUrl)
            if (sub?.ok === false) {
              setSubmitError(
                (sub as { reason?: string })?.reason === "PLAN_NOT_FOUND"
                  ? "Invalid plan. Please pick a plan again."
                  : "Could not submit your enquiry. Please try again or contact us."
              )
              return
            }
            const planTitle = plans.find((x) => x.id === selectedPlanId)?.title ?? selectedPlanId
            const cid = getOperatorClientId()
            const r = await submitTicket({
              mode: "billing_manual",
              description: `Portal enquiry — manual plan payment. Plan: ${planTitle}. Subtotal ${operatorStripeCurrency} ${selectedPlanSubtotal.toFixed(2)}. Receipt: ${receiptUrl}`,
              ...(cid ? { clientId: cid } : {}),
              photo: receiptUrl,
            })
            if (!r?.ok) {
              setSubmitError("Enquiry saved but ticket could not be created. Please contact support with your receipt.")
              return
            }
            setEnquirySuccessContactDialogOpen(true)
            setPlanFeeDialogOpen(false)
            await refreshSession()
          } catch (err) {
            console.error(err)
            setSubmitError("Could not submit your plan enquiry. Please try again.")
          } finally {
            setPlanFeeManualBusy(false)
          }
        }}
        onContinueStripe={async () => {
          setPlanFeeStripeBusy(true)
          try {
            setPlanFeeDialogOpen(false)
            await startBillplz()
          } finally {
            setPlanFeeStripeBusy(false)
          }
        }}
      />
    </div>
  )
}

export default function EnquiryPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Spinner size="md" />
        </div>
      }
    >
      <EnquiryPageInner />
    </Suspense>
  )
}
