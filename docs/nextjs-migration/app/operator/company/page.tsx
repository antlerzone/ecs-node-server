"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Building2, Users, Plus, Edit2, Trash2, Zap, Lock, BookOpen, Settings, CheckCircle, XCircle, DollarSign, Shield, Upload, HelpCircle, Bot, Landmark, HardDrive, Sparkles, Copy } from "lucide-react"
import { toast } from "sonner"
import { otherFeesRowsFromAdmin, otherFeesToAdminPayload, type AdminOtherFeeRow } from "@/lib/admin-other-fees"
import {
  getProfile,
  updateProfile,
  getAdmin,
  saveAdmin,
  getStaffList,
  createStaff,
  updateStaff,
  deleteStaff,
  getOnboardStatus,
  getPaymentGatewayDirectStatus,
  getCompanyBanks,
  stripeDisconnect,
  getStripeConnectOnboardUrl,
  cnyiotConnect,
  cnyiotDisconnect,
  ttlockConnect,
  ttlockDisconnect,
  getTtlockCredentials,
  bukkuConnect,
  bukkuDisconnect,
  xeroConnect,
  getXeroAuthUrl,
  xeroDisconnect,
  payexConnect,
  payexDisconnect,
  savePayexDirectConnect,
  saveBillplzDirectConnect,
  billplzDisconnect,
  savePaymentGatewayMode,
  xenditCreateSubAccount,
  uploadFile,
  uploadChopFile,
  updateAccountingEinvoice,
  getAiProviderConfig,
  saveAiProviderConfig,
  getFinverseLinkUrl,
  getGoogleDriveOAuthUrl,
  disconnectGoogleDrive,
  getContactList,
  startCleanlemonsLink,
  getCleanlemonsLinkStatus,
  confirmCleanlemonsLink,
  disconnectCleanlemonsLink,
} from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import { hasPermission } from "@/lib/operator-permissions"
import {
  CLEANLEMONS_PORTAL_POSTMESSAGE_ORIGINS,
  COLIVING_CLEANLEMONS_LINK_VERIFY_DONE,
} from "@/lib/cleanlemons-coliving-bridge"

/** Operator's company client id from access context so Company Settings always shows this company's users/profile. */
function useOperatorClientId(): string | null {
  const { accessCtx } = useOperatorContext()
  return (accessCtx?.client as { id?: string } | undefined)?.id ?? null
}
import { wixImageToStatic } from "@/lib/utils"

function getXeroRedirectUri(): string {
  if (typeof window === "undefined") return ""
  // Use a stable redirect URI (no query/hash) so it matches Xero app callback exactly.
  return `${window.location.origin}/operator/company`
}

/** ISO code for labels like "Agreement Fees (SGD)". Falls back to MYR when unset (legacy). */
function feeCurrencyCode(currency: string | undefined): string {
  const u = (currency ?? "").trim().toUpperCase()
  return u || "MYR"
}

/** Prefix for inline amounts: S$ / RM / other ISO codes. */
function moneyDisplayPrefix(currency: string | undefined): string {
  const u = (currency ?? "").trim().toUpperCase()
  if (u === "SGD") return "S$"
  if (u === "MYR" || u === "") return "RM"
  return u
}

const STRIPE_OAUTH_RETURN_DIALOG_KEY = "operator_company_stripe_oauth_return_open"

function openCleanlemonsColivingLinkPopup(oauthUrl: string): Window | null {
  if (typeof window === "undefined") return null
  const w = Math.min(560, window.screen.availWidth - 40)
  const h = Math.min(720, window.screen.availHeight - 80)
  const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2)
  const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2)
  return window.open(
    oauthUrl,
    "cleanlemons_coliving_link",
    `width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes`
  )
}

const INTEGRATION_TEMPLATE = [
  { id: "stripe", name: "Stripe", icon: Zap, description: "Payment processing (cards, etc.)", category: "payment" },
  { id: "xendit", name: "Xendit", icon: DollarSign, description: "Payment processing (SGD / MYR)", category: "payment" },
  { id: "billplz", name: "Billplz", icon: Landmark, description: "Payment processing (MYR only)", category: "payment" },
  { id: "ttlock", name: "TTLock", icon: Lock, description: "Smart door locks", category: "iot" },
  { id: "cnyiot", name: "CNY IoT", icon: Zap, description: "Smart meter", category: "meter" },
  { id: "bukku", name: "Bukku", icon: BookOpen, description: "Accounting software", category: "accounting" },
  { id: "xero", name: "Xero", icon: BookOpen, description: "Cloud accounting", category: "accounting" },
  { id: "cleanlemons", name: "Cleanlemons", icon: Sparkles, description: "Cleaning SaaS — properties & TTLock", category: "partner" },
]

const CATEGORY_LABELS: Record<string, string> = {
  payment: "Payment",
  iot: "IoT / Smart Door",
  meter: "Smart Meter",
  accounting: "Accounting",
  partner: "Partner integrations",
}

const DATE_TYPE_OPTIONS = [
  { value: "first", label: "First day of every month" },
  { value: "last", label: "Last day of every month" },
  { value: "specific", label: "Specific date of every month" },
]

const RENTAL_DATE_OPTIONS = [
  ...DATE_TYPE_OPTIONS,
  { value: "movein", label: "Move in date" },
]

const DEPOSIT_OPTIONS = [
  { value: "0.5", label: "0.5 month of rental" },
  { value: "1", label: "1 month of rental" },
  { value: "1.5", label: "1.5 month of rental" },
  { value: "2", label: "2 month of rental" },
  { value: "2.5", label: "2.5 month of rental" },
  { value: "3", label: "3 month of rental" },
  { value: "specific", label: "Specific amount" },
]

/** Tenant portal: link card/bank policy (saved in operatordetail.admin; enforced on tenant portal). */
const TENANT_PAYMENT_METHOD_POLICY_OPTIONS = [
  {
    value: "strictly",
    label: "Strictly — must link card/bank; portal lock gate until linked",
  },
  {
    value: "no_allow",
    label: "No allow — no link button / no saved-card flow for tenants",
  },
  {
    value: "flexible",
    label: "Flexible — tenant chooses whether to bind",
  },
] as const

const COMMISSION_AMOUNT_OPTIONS = [
  { value: "0.5", label: "0.5 month of rental" },
  { value: "1", label: "1 month of rental" },
  { value: "1.5", label: "1.5 month of rental" },
  { value: "2", label: "2 month of rental" },
  { value: "2.5", label: "2.5 month of rental" },
  { value: "3", label: "3 month of rental" },
  { value: "specific", label: "Specific amount" },
  { value: "prorate", label: "Prorate according tenancy" },
  { value: "tenancy_months", label: "By tenancy length (months)" },
]

type StaffItem = {
  id: string
  _id?: string
  name?: string
  email?: string
  permission?: Record<string, boolean> | string[]
  status?: boolean
  is_admin?: boolean
}
type IntegrationItem = {
  id: string
  name: string
  icon: typeof Zap
  connected: boolean
  description: string
  category: string
  ttlockCreateEverUsed?: boolean
  cleanlemonsOauthVerified?: boolean
  cleanlemonsConfirmed?: boolean
}
type StripeGatewayState = {
  connectionStatus?: string
  oauthConnected?: boolean
  accountId?: string | null
  hasWebhookSecret?: boolean
  webhookSecretLast4?: string | null
  webhookUrl?: string | null
  lastWebhookAt?: string | null
  lastWebhookType?: string | null
  lastTestRequestedAt?: string | null
  lastTestVerifiedAt?: string | null
}
type XenditGatewayState = {
  connectionStatus?: string
  hasSecretKey?: boolean
  hasWebhookToken?: boolean
  secretKeyLast4?: string | null
  webhookTokenLast4?: string | null
  webhookUrl?: string | null
  lastWebhookAt?: string | null
  lastWebhookType?: string | null
}
type BillplzGatewayState = {
  connectionStatus?: string
  hasApiKey?: boolean
  hasCollectionId?: boolean
  hasXSignatureKey?: boolean
  apiKeyLast4?: string | null
  xSignatureKeyLast4?: string | null
  collectionId?: string | null
  paymentGatewayCode?: string | null
  webhookUrl?: string | null
  paymentOrderCallbackUrl?: string | null
  lastWebhookAt?: string | null
  lastWebhookType?: string | null
}

export default function CompanySettingPage() {
  const {
    permission,
    refresh,
    hasAccountingCapability,
    hasCleanlemonsPartnerCapability,
    accessCtx,
  } = useOperatorContext()
  const operatorClientId = useOperatorClientId()
  const canEditProfile = hasPermission(permission, "profilesetting")
  const canEditStaff = hasPermission(permission, "usersetting")
  const canEditIntegration = hasPermission(permission, "integration")

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingStaff, setEditingStaff] = useState<StaffItem | null>(null)
  const [showStaffDialog, setShowStaffDialog] = useState(false)
  const [selectedIntegration, setSelectedIntegration] = useState<IntegrationItem | null>(null)
  const [showIntegrationDialog, setShowIntegrationDialog] = useState(false)
  const [showAccountingConnectDialog, setShowAccountingConnectDialog] = useState(false)
  const [selectedAccountingSystem, setSelectedAccountingSystem] = useState<string>("")
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([])
  const [showFeesDialog, setShowFeesDialog] = useState(false)
  const [showCommissionHintDialog, setShowCommissionHintDialog] = useState(false)
  const [staff, setStaff] = useState<StaffItem[]>([])
  const [mainAdminEmail, setMainAdminEmail] = useState<string>("")
  const [maxStaffAllowed, setMaxStaffAllowed] = useState(1)
  /** Plan-included seats + Extra User addon (from API); explains why max is capped at 10. */
  const [userLimit, setUserLimit] = useState<{ planIncluded: number; extraUserAddon: number; maxTotal: number } | null>(null)
  const [profile, setProfile] = useState<{
    title?: string; ssm?: string; address?: string; contact?: string;
    currency?: string; subdomain?: string; tin?: string; accountholder?: string; accountnumber?: string; bankId?: string | null;
    profilephoto?: string; companyChop?: string; paynowQr?: string; uen?: string;
  } | null>(null)
  const [profileDraft, setProfileDraft] = useState({
    title: "", ssm: "", address: "", contact: "",
    subdomain: "", tin: "", accountholder: "", accountnumber: "", bankId: "" as string | null,
    profilephoto: "" as string | null, companyChop: "" as string | null, paynowQr: "" as string | null, uen: "",
  })
  const [banks, setBanks] = useState<Array<{ label: string; value: string }>>([])
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingChop, setUploadingChop] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingFees, setSavingFees] = useState(false)
  const [savingStaff, setSavingStaff] = useState(false)
  const [deletingStaffId, setDeletingStaffId] = useState<string | null>(null)
  /** Add user: staff rows from Contact (staffdetail), not free-typed name/email. */
  const [staffContactsForAdd, setStaffContactsForAdd] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [loadingStaffContacts, setLoadingStaffContacts] = useState(false)
  const [selectedStaffContactId, setSelectedStaffContactId] = useState("")
  const [integrationAction, setIntegrationAction] = useState<string | null>(null)
  const [staffForm, setStaffForm] = useState({ name: "", email: "", permission: {} as Record<string, boolean> })
  const [integrationCreds, setIntegrationCreds] = useState<Record<string, string>>({})
  const [payexPlatformMode, setPayexPlatformMode] = useState(false)
  const [payexHasSubAccount, setPayexHasSubAccount] = useState(false)
  const [payexSubAccountEverCreated, setPayexSubAccountEverCreated] = useState(false)
  const [accountingEinvoice, setAccountingEinvoice] = useState(false)
  const [showPaymentGatewayDialog, setShowPaymentGatewayDialog] = useState(false)
  const [paymentGatewayChoice, setPaymentGatewayChoice] = useState<"paynow" | "stripe" | "xendit" | "billplz">("stripe")
  const [paymentGatewayProviderState, setPaymentGatewayProviderState] = useState<"stripe" | "payex" | "paynow" | "billplz" | "">("")
  const [paymentStep, setPaymentStep] = useState<"choose" | "stripe" | "xendit-option" | "xendit-form" | "billplz-form">("choose")
  const [sgPaynowEnabledWithGateway, setSgPaynowEnabledWithGateway] = useState(true)
  const [stripeGatewayState, setStripeGatewayState] = useState<StripeGatewayState>({})
  const [xenditGatewayState, setXenditGatewayState] = useState<XenditGatewayState>({})
  const [billplzGatewayState, setBillplzGatewayState] = useState<BillplzGatewayState>({})
  const [ttlockViewCreds, setTtlockViewCreds] = useState<{ username: string; password: string } | null>(null)
  const [ttlockConnectStep, setTtlockConnectStep] = useState<"choose" | "existing">("choose")
  const [cleanlemonsExport, setCleanlemonsExport] = useState(true)
  const [cleanlemonsTtlock, setCleanlemonsTtlock] = useState(true)
  const [cleanlemonsConfirming, setCleanlemonsConfirming] = useState(false)
  const [cleanlemonsTtlockReplaceOpen, setCleanlemonsTtlockReplaceOpen] = useState(false)
  const [cleanlemonsOauthRedirectBusy, setCleanlemonsOauthRedirectBusy] = useState(false)
  const [aiProvider, setAiProvider] = useState<string | null>(null)
  const [aiProviderHasApiKey, setAiProviderHasApiKey] = useState(false)
  const [aiProviderApiKeyLast4, setAiProviderApiKeyLast4] = useState("")
  const [aiProviderApiKeyHash, setAiProviderApiKeyHash] = useState("")
  const [aiProviderEditingKey, setAiProviderEditingKey] = useState(false)
  const [bankReconcileConnected, setBankReconcileConnected] = useState(false)
  const [finverseHasCreds, setFinverseHasCreds] = useState(false)
  const [finverseConnecting, setFinverseConnecting] = useState(false)
  const [googleDriveConnected, setGoogleDriveConnected] = useState(false)
  const [googleDriveEmail, setGoogleDriveEmail] = useState("")
  const [googleDriveConnecting, setGoogleDriveConnecting] = useState(false)
  const [showAiProviderDialog, setShowAiProviderDialog] = useState(false)
  const [aiProviderDraft, setAiProviderDraft] = useState({ provider: "", api_key: "" })
  const [savingAiProvider, setSavingAiProvider] = useState(false)

  // Admin/Fees state - matching old frontend structure
  const [fees, setFees] = useState({
    payoutType: "first",
    payoutValue: "",
    dueDate: "7",
    salaryType: "last",
    salaryValue: "",
    rentalType: "first",
    rentalValue: "",
    depositType: "1",
    depositValue: "",
    agreementFees: "150",
    otherFeesRows: [] as AdminOtherFeeRow[],
    parking: "100",
    smartDoor: "yes",
    meter: "yes",
    commissionDateType: "first",
    commissionDateValue: "",
    workingHourStart: "09:00",
    workingHourEnd: "18:00",
    handoverHourStart: "10:00",
    handoverHourEnd: "19:00",
    tenantPaymentMethodPolicy: "flexible" as "strictly" | "no_allow" | "flexible",
    /** Show "Charge due rent automatically" on tenant portal (cron opt-in). Default true. */
    tenantRentAutoDebitOffered: true,
  })

  // Commission rules for 24 months
  const [commissionRules, setCommissionRules] = useState(
    Array.from({ length: 24 }, (_, i) => ({
      month: i + 1,
      chargeon: i < 6 ? "tenant" : "owner",
      amountType: "tenancy_months",
      fixedAmount: "",
    }))
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const clientOpts = operatorClientId ? { clientId: operatorClientId } : undefined
    const results = await Promise.allSettled([
      getProfile(clientOpts),
      getAdmin(clientOpts),
      getStaffList(clientOpts),
      getOnboardStatus(clientOpts),
      getPaymentGatewayDirectStatus(clientOpts),
      getCompanyBanks(clientOpts),
      getCleanlemonsLinkStatus(operatorClientId ? { clientId: operatorClientId } : {}),
    ])
    const profileRes = results[0].status === "fulfilled" ? results[0].value : null
    const adminRes = results[1].status === "fulfilled" ? results[1].value : null
    const staffRes = results[2].status === "fulfilled" ? results[2].value : null
    const onboardRes = results[3].status === "fulfilled" ? results[3].value : null
    const paymentGatewayStatusRes = results[4].status === "fulfilled" ? results[4].value : null
    const banksRes = results[5].status === "fulfilled" ? results[5].value : null
    const cleanlemonsRes = results[6].status === "fulfilled" ? results[6].value : null
    const rejectedReasons = results.map((r) => (r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : null))
    const firstRejection = rejectedReasons.find(Boolean)
    // Only show page error when profile failed; other endpoints can fail and we still render with partial data
    if (profileRes == null) {
      setError(firstRejection ?? "Failed to load profile")
    } else if ((profileRes as { ok?: boolean; reason?: string })?.ok === false) {
      setError((profileRes as { reason?: string }).reason ?? "Profile load failed")
    } else {
      setError(null)
    }
    try {
      // Always apply onboard status when available so integrations show even if other calls failed
    const os = onboardRes as { stripeConnected?: boolean; stripe_connected_account_id?: string; paymentGatewayProvider?: string; sgPaynowEnabledWithGateway?: boolean; payexPlatformMode?: boolean; payexHasSubAccount?: boolean; payexSubAccountEverCreated?: boolean; cnyiotConnected?: boolean; ttlockConnected?: boolean; accountingConnected?: boolean; accountingProvider?: string; accountingEinvoice?: boolean; aiProvider?: string | null; aiProviderHasApiKey?: boolean; bankReconcileConnected?: boolean; finverseHasCreds?: boolean; googleDriveConnected?: boolean; googleDriveEmail?: string } | null
    const pgs = paymentGatewayStatusRes as { stripe?: StripeGatewayState; payex?: XenditGatewayState; billplz?: BillplzGatewayState } | null
    const clnLinkOk =
      cleanlemonsRes &&
      typeof cleanlemonsRes === "object" &&
      (cleanlemonsRes as { ok?: boolean }).ok !== false
    const clnLink = clnLinkOk
      ? (cleanlemonsRes as { oauthVerified?: boolean; confirmed?: boolean })
      : null
    const profileCurrency = (profileRes as { client?: { currency?: string } } | null)?.client?.currency
    const isMyrOperator = String(profileCurrency || "").trim().toUpperCase() === "MYR"
    /** Cleanlemons partner card: Malaysia operators only (no pricing-plan gate). */
    const includeCleanlemonsIntegration = isMyrOperator
    const integrationTemplateForUi = INTEGRATION_TEMPLATE.filter(
      (t) => t.id !== "cleanlemons" || includeCleanlemonsIntegration
    )
    if (onboardRes && (onboardRes as { ok?: boolean }).ok !== false && os) {
      const pgRaw = String(os.paymentGatewayProvider || "").toLowerCase()
      const pgNorm = pgRaw === "payex" || pgRaw === "paynow" || pgRaw === "stripe" || pgRaw === "billplz" ? (pgRaw as "stripe" | "payex" | "paynow" | "billplz") : ""
      setPaymentGatewayProviderState(pgNorm)
      setPayexPlatformMode(!!os.payexPlatformMode)
      setPayexHasSubAccount(!!os.payexHasSubAccount)
      setPayexSubAccountEverCreated(!!os.payexSubAccountEverCreated)
      setSgPaynowEnabledWithGateway(os.sgPaynowEnabledWithGateway !== false)
      setAccountingEinvoice(!!os.accountingEinvoice)
      setAiProvider(os.aiProvider ?? null)
      setAiProviderHasApiKey(!!os.aiProviderHasApiKey)
      setBankReconcileConnected(!!os.bankReconcileConnected)
      setFinverseHasCreds(!!os.finverseHasCreds)
      setGoogleDriveConnected(!!os.googleDriveConnected)
      setGoogleDriveEmail(String(os.googleDriveEmail || "").trim())
      setStripeGatewayState(pgs?.stripe || {})
      setXenditGatewayState(pgs?.payex || {})
      setBillplzGatewayState(pgs?.billplz || {})
      setIntegrations(integrationTemplateForUi.map(t => ({
        ...t,
        connected: t.id === "stripe" ? (pgs?.stripe?.connectionStatus === "connected")
          : t.id === "xendit" ? (pgs?.payex?.connectionStatus === "connected")
          : t.id === "billplz" ? (pgs?.billplz?.connectionStatus === "connected")
          : t.id === "cnyiot" ? !!os.cnyiotConnected
          : t.id === "ttlock" ? !!os.ttlockConnected
          : t.id === "bukku" ? (os.accountingConnected && os.accountingProvider === "bukku")
          : t.id === "xero" ? (os.accountingConnected && os.accountingProvider === "xero")
          : t.id === "cleanlemons" ? !!clnLink?.confirmed
          : false,
        ...(t.id === "ttlock" && { ttlockCreateEverUsed: !!(os as { ttlockCreateEverUsed?: boolean }).ttlockCreateEverUsed }),
        ...(t.id === "cleanlemons" && {
          cleanlemonsOauthVerified: !!clnLink?.oauthVerified,
          cleanlemonsConfirmed: !!clnLink?.confirmed,
        }),
      })))
    }
    if (profileRes?.ok !== false && profileRes?.client) {
        const c = profileRes.client as { title?: string; currency?: string; profilephoto?: string; subdomain?: string }
        const p = (profileRes as { profile?: Record<string, string | null> }).profile || {}
        const prof = {
          title: c.title,
          ssm: p.ssm,
          address: p.address,
          contact: p.contact,
          currency: c.currency || "",
          subdomain: (p.subdomain ?? c.subdomain) ?? "",
          tin: p.tin ?? "",
          accountholder: p.accountholder ?? "",
          accountnumber: p.accountnumber ?? "",
          bankId: p.bankId ?? null,
          profilephoto: c.profilephoto ?? "",
          companyChop: p.companyChop ?? "",
          paynowQr: (p as { paynowQr?: string }).paynowQr ?? "",
          uen: (p as { uen?: string }).uen ?? "",
        }
        setProfile(prof)
        setProfileDraft({
          title: prof.title || "",
          ssm: prof.ssm || "",
          address: prof.address || "",
          contact: prof.contact || "",
          subdomain: prof.subdomain || "",
          tin: prof.tin || "",
          accountholder: prof.accountholder || "",
          accountnumber: prof.accountnumber || "",
          bankId: prof.bankId ?? "",
          profilephoto: prof.profilephoto || null,
          companyChop: prof.companyChop || null,
          paynowQr: prof.paynowQr || null,
          uen: prof.uen || "",
        })
      }
      if (banksRes?.ok !== false && (banksRes as { items?: Array<{ label: string; value: string }> }).items) {
        setBanks((banksRes as { items: Array<{ label: string; value: string }> }).items)
      }
      if (adminRes?.ok !== false && adminRes?.admin) {
        const a = adminRes.admin as Record<string, unknown>
        const pol = a.tenantPaymentMethodPolicy as string | undefined
        const tenantPaymentMethodPolicy =
          pol === "strictly" || pol === "no_allow" || pol === "flexible" ? pol : "flexible"
        const tenantRentAutoDebitOffered = a.tenantRentAutoDebitOffered !== false
        setFees({
          payoutType: ((a.payout as { type?: string })?.type) || "first",
          payoutValue: String(((a.payout as { value?: string })?.value) || ""),
          dueDate: String((a.rental as { grace_days?: number })?.grace_days ?? a.dueDate ?? "7"),
          salaryType: ((a.salary as { type?: string })?.type) || "last",
          salaryValue: String(((a.salary as { value?: string })?.value) || ""),
          rentalType: ((a.rental as { type?: string })?.type) || "first",
          rentalValue: String(((a.rental as { value?: string })?.value) || ""),
          depositType: ((a.deposit as { type?: string })?.type) || "1",
          depositValue: String(((a.deposit as { value?: string })?.value) || ""),
          agreementFees: String(a.agreementFees ?? "150"),
          otherFeesRows: otherFeesRowsFromAdmin(a.otherFees),
          parking: String(a.parking ?? "100"),
          smartDoor: String(a.smartDoor ?? "yes"),
          meter: String(a.meter ?? "yes"),
          commissionDateType: ((a.commissionDate as { type?: string })?.type) || "first",
          commissionDateValue: String(((a.commissionDate as { value?: string })?.value) || ""),
          workingHourStart: String((a.workingHour as { start?: string })?.start || "09:00"),
          workingHourEnd: String((a.workingHour as { end?: string })?.end || "18:00"),
          handoverHourStart: String((a.handoverWorkingHour as { start?: string })?.start || "10:00"),
          handoverHourEnd: String((a.handoverWorkingHour as { end?: string })?.end || "19:00"),
          tenantPaymentMethodPolicy,
          tenantRentAutoDebitOffered,
        })
        if (Array.isArray(a.commissionRules) && a.commissionRules.length > 0) {
          setCommissionRules((a.commissionRules as Array<{ month?: number; chargeon?: string; amountType?: string; fixedAmount?: string }>).map((r, i) => ({
            month: r.month ?? i + 1,
            chargeon: r.chargeon || (i < 6 ? "tenant" : "owner"),
            amountType: r.amountType || "tenancy_months",
            fixedAmount: String(r.fixedAmount ?? ""),
          })))
        }
      }
      if (staffRes?.ok !== false && staffRes?.items) {
        setStaff((staffRes.items as StaffItem[]) || [])
        setMainAdminEmail(String((staffRes as { mainAdminEmail?: string }).mainAdminEmail ?? "").trim().toLowerCase())
        setMaxStaffAllowed(Number((staffRes as { maxStaffAllowed?: number }).maxStaffAllowed) || 1)
        const ul = (staffRes as { userLimit?: { planIncluded?: number; extraUserAddon?: number; maxTotal?: number } }).userLimit
        if (ul && typeof ul.planIncluded === "number" && typeof ul.extraUserAddon === "number" && typeof ul.maxTotal === "number") {
          setUserLimit({ planIncluded: ul.planIncluded, extraUserAddon: ul.extraUserAddon, maxTotal: ul.maxTotal })
        } else {
          setUserLimit(null)
        }
      }
      if (onboardRes && (onboardRes as { ok?: boolean }).ok !== false && os) {
        setIntegrations(integrationTemplateForUi.map(t => ({
          ...t,
          connected: t.id === "stripe" ? (pgs?.stripe?.connectionStatus === "connected")
            : t.id === "xendit" ? (pgs?.payex?.connectionStatus === "connected")
          : t.id === "billplz" ? (pgs?.billplz?.connectionStatus === "connected")
            : t.id === "cnyiot" ? !!os.cnyiotConnected
            : t.id === "ttlock" ? !!os.ttlockConnected
            : t.id === "bukku" ? (os.accountingConnected && os.accountingProvider === "bukku")
            : t.id === "xero" ? (os.accountingConnected && os.accountingProvider === "xero")
            : t.id === "cleanlemons" ? !!clnLink?.confirmed
            : false,
          ...(t.id === "ttlock" && { ttlockCreateEverUsed: !!(os as { ttlockCreateEverUsed?: boolean }).ttlockCreateEverUsed }),
          ...(t.id === "cleanlemons" && {
            cleanlemonsOauthVerified: !!clnLink?.oauthVerified,
            cleanlemonsConfirmed: !!clnLink?.confirmed,
          }),
        })))
      }
    } catch (e) {
      setError((s) => s ?? (e instanceof Error ? e.message : "Failed to load"))
    } finally {
      setLoading(false)
    }
  }, [operatorClientId])

  const confirmCleanlemonsLinkFlow = useCallback(
    async (replaceTtlockFromColiving: boolean) => {
      setCleanlemonsConfirming(true)
      setError(null)
      if (replaceTtlockFromColiving) setCleanlemonsTtlockReplaceOpen(false)
      try {
        const r = await confirmCleanlemonsLink({
          exportPropertyToCleanlemons: cleanlemonsExport,
          integrateTtlock: cleanlemonsTtlock,
          replaceTtlockFromColiving,
          clientId: operatorClientId ?? undefined,
        })
        if (r?.ok === false) {
          if (r.needsTtlockReplaceConfirm) {
            setCleanlemonsTtlockReplaceOpen(true)
            return
          }
          const reason = r.reason
          setError(
            reason === "CLEANLEMONS_MYR_OPERATORS_ONLY"
              ? "Cleanlemons partner integration is only available for Malaysia (MYR) operators."
              : reason || "Confirm failed"
          )
          return
        }
        setCleanlemonsTtlockReplaceOpen(false)
        if (r?.alreadyConfirmed) {
          toast.success("Already linked.")
        } else {
          toast.success("Cleanlemons link completed.")
          if (cleanlemonsTtlock && r?.integrateTtlockApplied === false) {
            toast.info(
              "TTLock was not copied: this Coliving company has no TTLock integration (or credentials are incomplete). You can connect TTLock on Coliving later and re-link if needed."
            )
          }
        }
        setShowIntegrationDialog(false)
        loadData()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Confirm failed")
      } finally {
        setCleanlemonsConfirming(false)
      }
    },
    [cleanlemonsExport, cleanlemonsTtlock, operatorClientId, loadData]
  )

  const applyCleanlemonsOauthReturn = useCallback(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      if (url.searchParams.get("cleanlemons_oauth") === "1") {
        url.searchParams.delete("cleanlemons_oauth")
        const qs = url.searchParams.toString()
        window.history.replaceState({}, "", `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`)
      }
    }
    if (!hasCleanlemonsPartnerCapability) {
      toast.info("Cleanlemons partner integration is only for Malaysia (MYR) operators.")
      void loadData()
      return
    }
    toast.success("Cleanlemons sign-in complete. Review permissions below, then tap Connect now! to finish linking.")
    setSelectedIntegration({
      id: "cleanlemons",
      name: "Cleanlemons",
      icon: Sparkles,
      description: "Cleaning SaaS — properties & TTLock",
      category: "partner",
      connected: false,
      cleanlemonsOauthVerified: true,
      cleanlemonsConfirmed: false,
    })
    setCleanlemonsExport(true)
    setCleanlemonsTtlock(true)
    setShowIntegrationDialog(true)
    void loadData()
  }, [loadData, hasCleanlemonsPartnerCapability])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (loading) return
    const shouldOpen = window.localStorage.getItem(STRIPE_OAUTH_RETURN_DIALOG_KEY) === "1"
    if (!shouldOpen) return
    if (!stripeGatewayState.oauthConnected) return
    setSelectedIntegration({ id: "stripe", name: "Stripe", icon: Zap, connected: stripeGatewayState.connectionStatus === "connected", description: "Payment processing (cards, etc.)", category: "payment" })
    setShowPaymentGatewayDialog(true)
    setPaymentGatewayChoice("stripe")
    setPaymentGatewayProviderState("stripe")
    setPaymentStep("stripe")
    window.localStorage.removeItem(STRIPE_OAUTH_RETURN_DIALOG_KEY)
  }, [loading, stripeGatewayState.oauthConnected, stripeGatewayState.connectionStatus])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (loading) return
    const params = new URLSearchParams(window.location.search)
    if (params.get("cleanlemons_oauth") !== "1") return
    applyCleanlemonsOauthReturn()
  }, [loading, applyCleanlemonsOauthReturn])

  useEffect(() => {
    if (typeof window === "undefined") return
    const extra = (process.env.NEXT_PUBLIC_CLEANLEMONS_PORTAL_ORIGIN || "").trim()
    const allowed = new Set<string>([...CLEANLEMONS_PORTAL_POSTMESSAGE_ORIGINS, extra].filter(Boolean))
    const onMsg = (ev: MessageEvent) => {
      if (!allowed.has(ev.origin)) return
      if (ev.data?.type !== COLIVING_CLEANLEMONS_LINK_VERIFY_DONE) return
      applyCleanlemonsOauthReturn()
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [applyCleanlemonsOauthReturn])

  // Finverse callback redirects here (sometimes in iframe). Break out so user sees portal in full window.
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const finverse = params.get("finverse")
    const finverseError = params.get("finverse_error")
    if ((finverse === "success" || finverseError) && window.self !== window.top) {
      try {
        window.top!.location.href = window.location.href
      } catch {
        // Cross-origin iframe may throw; ignore
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const gd = params.get("google_drive")
    if (!gd) return
    const path = window.location.pathname || "/operator/company"
    if (gd === "connected") {
      setError(null)
      void loadData()
    } else if (gd === "error") {
      const reason = params.get("reason")
      let decoded = reason || ""
      try {
        if (decoded) decoded = decodeURIComponent(decoded)
      } catch {
        /* keep raw */
      }
      setError(
        decoded
          ? `Google Drive: ${decoded}`
          : "Google Drive could not be connected. Try again or check server configuration."
      )
    }
    window.history.replaceState({}, "", path)
  }, [loadData])

  // Xero OAuth callback: exchange code and persist integration, then clean URL.
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const code = params.get("code")
    if (!code) return

    let cancelled = false
    const redirectUri = getXeroRedirectUri()

    ;(async () => {
      try {
        const r = await xeroConnect({ code, redirectUri })
        if (cancelled) return
        if (r?.ok === false) {
          setError((r as { reason?: string })?.reason || "Xero connect failed")
          return
        }
        setError(null)
        await loadData()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Xero connect failed")
      } finally {
        if (cancelled) return
        const cleanPath = window.location.pathname || "/operator/company"
        window.history.replaceState({}, "", cleanPath)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loadData])

  // When opening AI Provider dialog, load current config so draft is correct
  useEffect(() => {
    if (!showAiProviderDialog) return
    setAiProviderEditingKey(false)
    getAiProviderConfig().then((r) => {
      if (r?.ok && r?.provider) setAiProviderDraft(d => ({ ...d, provider: r.provider ?? "", api_key: "" }))
      else setAiProviderDraft(d => ({ ...d, provider: aiProvider ?? "", api_key: "" }))
      setAiProviderApiKeyLast4(String(r?.apiKeyLast4 || ""))
      setAiProviderApiKeyHash(String(r?.apiKeyHash || ""))
    }).catch(() => setAiProviderDraft(d => ({ ...d, provider: aiProvider ?? "", api_key: "" })))
  }, [showAiProviderDialog]) // eslint-disable-line react-hooks/exhaustive-deps

  // When opening TTLock integration dialog while connected, fetch saved credentials for manage view.
  useEffect(() => {
    const ttlockView = selectedIntegration?.id === "ttlock" && !!selectedIntegration?.connected
    if (!showIntegrationDialog || !ttlockView) {
      setTtlockViewCreds(null)
      return
    }
    getTtlockCredentials()
      .then((r) => {
        const res = r as { ok?: boolean; username?: string; password?: string }
        if (res?.ok !== false && (res?.username != null || res?.password != null))
          setTtlockViewCreds({ username: res.username ?? "", password: res.password ?? "" })
        else
          setTtlockViewCreds({ username: "", password: "" })
      })
      .catch(() => setTtlockViewCreds({ username: "", password: "" }))
  }, [showIntegrationDialog, selectedIntegration])

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const payload: Record<string, unknown> = {
        title: profileDraft.title.trim(),
        ssm: profileDraft.ssm.trim(),
        address: profileDraft.address.trim(),
        contact: profileDraft.contact.replace(/\s+/g, ""),
        subdomain: profileDraft.subdomain.trim().toLowerCase(),
        tin: profileDraft.tin.trim(),
        accountholder: profileDraft.accountholder.trim(),
        accountnumber: profileDraft.accountnumber.trim(),
        bankId: profileDraft.bankId && profileDraft.bankId !== "" ? profileDraft.bankId : null,
      }
      if (profileDraft.profilephoto != null && profileDraft.profilephoto !== "") payload.profilephoto = profileDraft.profilephoto
      if (profileDraft.companyChop != null && profileDraft.companyChop !== "") payload.companyChop = profileDraft.companyChop
      if (profileDraft.paynowQr != null && profileDraft.paynowQr !== "") payload.paynowQr = profileDraft.paynowQr
      if (profileDraft.uen != null) payload.uen = profileDraft.uen
      const r = await updateProfile(payload)
      if (r?.ok !== false) {
        setProfile({
          ...profile,
          title: profileDraft.title,
          ssm: profileDraft.ssm,
          address: profileDraft.address,
          contact: profileDraft.contact,
          subdomain: profileDraft.subdomain,
          tin: profileDraft.tin,
          accountholder: profileDraft.accountholder,
          accountnumber: profileDraft.accountnumber,
          bankId: profileDraft.bankId || null,
          profilephoto: profileDraft.profilephoto || undefined,
          companyChop: profileDraft.companyChop || undefined,
          paynowQr: profileDraft.paynowQr || undefined,
          uen: profileDraft.uen || undefined,
        })
        await refresh()
      } else {
        setError((r as { reason?: string }).reason || "Save failed")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSavingProfile(false)
    }
  }

  const currencyToCountry = (currency: string | undefined) => {
    if (!currency) return "—"
    const u = (currency || "").toUpperCase()
    if (u === "MYR") return "Malaysia"
    if (u === "SGD") return "Singapore"
    return currency
  }
  const isSgdCompany = ((profile?.currency || profileDraft.currency || "").toUpperCase() === "SGD")
  const companyCurrencyCode = feeCurrencyCode(profile?.currency)
  const moneyPrefix = moneyDisplayPrefix(profile?.currency)
  const xenditWebhookUrl = "https://api.colivingjb.com/api/payex/callback"
  const billplzWebhookUrl = "https://api.colivingjb.com/api/billplz/callback"
  const billplzPaymentOrderWebhookUrl = "https://api.colivingjb.com/api/billplz/payment-order-callback"
  const ecsBaseForDocs = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
  /** Platform endpoint (Connect: configured on Coliving's Stripe account, not in the operator's Developers → Webhooks). */
  const stripePlatformWebhookUrl = `${ecsBaseForDocs}/api/stripe/webhook`
  const stripeWebhookEventsHelp =
    "account.updated, checkout.session.completed, payment_intent.succeeded, payout.paid, payout.failed, payout.canceled"
  const stripeStatusLabel =
    stripeGatewayState.connectionStatus === "connected"
      ? "Connected"
      : stripeGatewayState.connectionStatus === "pending_verification"
        ? "Pending verification"
        : "Not connected"
  const xenditStatusLabel =
    xenditGatewayState.connectionStatus === "connected"
      ? "Connected"
      : xenditGatewayState.connectionStatus === "pending_verification"
        ? "Pending verification"
        : "Not connected"
  const billplzStatusLabel =
    billplzGatewayState.connectionStatus === "connected"
      ? "Connected"
      : billplzGatewayState.connectionStatus === "pending_verification"
        ? "Pending verification"
        : "Not connected"

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith("image/")) return
    setUploadingLogo(true)
    try {
      const res = await uploadFile(file)
      if (res.ok && res.url) {
        setProfileDraft(p => ({ ...p, profilephoto: res.url ?? "" }))
      } else {
        setError(res.reason || "Logo upload failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logo upload failed")
    } finally {
      setUploadingLogo(false)
      e.target.value = ""
    }
  }

  const handleChopUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith("image/")) return
    setUploadingChop(true)
    try {
      const res = await uploadChopFile(file)
      if (res.ok && res.url) {
        setProfileDraft(p => ({ ...p, companyChop: res.url ?? "" }))
      } else {
        setError(res.reason || "Chop upload failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chop upload failed")
    } finally {
      setUploadingChop(false)
      e.target.value = ""
    }
  }

  const openFeesDialog = useCallback(async () => {
    try {
      const adminRes = await getAdmin()
      if (adminRes?.ok !== false && adminRes?.admin) {
        const a = adminRes.admin as Record<string, unknown>
        const pol = a.tenantPaymentMethodPolicy as string | undefined
        const tenantPaymentMethodPolicy =
          pol === "strictly" || pol === "no_allow" || pol === "flexible" ? pol : "flexible"
        const tenantRentAutoDebitOffered = a.tenantRentAutoDebitOffered !== false
        setFees({
          payoutType: ((a.payout as { type?: string })?.type) || "first",
          payoutValue: String(((a.payout as { value?: string })?.value) || ""),
          dueDate: String((a.rental as { grace_days?: number })?.grace_days ?? a.dueDate ?? "7"),
          salaryType: ((a.salary as { type?: string })?.type) || "last",
          salaryValue: String(((a.salary as { value?: string })?.value) || ""),
          rentalType: ((a.rental as { type?: string })?.type) || "first",
          rentalValue: String(((a.rental as { value?: string })?.value) || ""),
          depositType: ((a.deposit as { type?: string })?.type) || "1",
          depositValue: String(((a.deposit as { value?: string })?.value) || ""),
          agreementFees: String(a.agreementFees ?? "150"),
          otherFeesRows: otherFeesRowsFromAdmin(a.otherFees),
          parking: String(a.parking ?? "100"),
          smartDoor: String(a.smartDoor ?? "yes"),
          meter: String(a.meter ?? "yes"),
          commissionDateType: ((a.commissionDate as { type?: string })?.type) || "first",
          commissionDateValue: String(((a.commissionDate as { value?: string })?.value) || ""),
          workingHourStart: String((a.workingHour as { start?: string })?.start || "09:00"),
          workingHourEnd: String((a.workingHour as { end?: string })?.end || "18:00"),
          handoverHourStart: String((a.handoverWorkingHour as { start?: string })?.start || "10:00"),
          handoverHourEnd: String((a.handoverWorkingHour as { end?: string })?.end || "19:00"),
          tenantPaymentMethodPolicy,
          tenantRentAutoDebitOffered,
        })
        if (Array.isArray(a.commissionRules) && a.commissionRules.length > 0) {
          setCommissionRules((a.commissionRules as Array<{ month?: number; chargeon?: string; amountType?: string; fixedAmount?: string }>).map((r, i) => ({
            month: r.month ?? i + 1,
            chargeon: r.chargeon || (i < 6 ? "tenant" : "owner"),
            amountType: r.amountType || "tenancy_months",
            fixedAmount: String(r.fixedAmount ?? ""),
          })))
        }
      }
      setShowFeesDialog(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fees")
    }
  }, [])

  const handleSaveFees = async () => {
    setSavingFees(true)
    try {
      const admin = {
        payout: { type: fees.payoutType, value: fees.payoutType === "specific" ? fees.payoutValue : undefined },
        salary: { type: fees.salaryType, value: fees.salaryType === "specific" ? fees.salaryValue : undefined },
        rental: {
          type: fees.rentalType,
          value: fees.rentalType === "specific" ? fees.rentalValue : undefined,
          grace_days: fees.dueDate ? Number(fees.dueDate) : 0,
        },
        deposit: { type: fees.depositType, value: fees.depositType === "specific" ? fees.depositValue : undefined },
        dueDate: fees.dueDate ? Number(fees.dueDate) : undefined,
        agreementFees: fees.agreementFees ? Number(fees.agreementFees) : undefined,
        otherFees: otherFeesToAdminPayload(fees.otherFeesRows),
        parking: fees.parking ? Number(fees.parking) : undefined,
        smartDoor: fees.smartDoor,
        meter: fees.meter,
        commissionDate: { type: fees.commissionDateType, value: fees.commissionDateType === "specific" ? fees.commissionDateValue : undefined },
        commissionRules: commissionRules.map(r => ({ month: r.month, chargeon: r.chargeon, amountType: r.amountType, fixedAmount: r.fixedAmount || undefined })),
        workingHour: { start: fees.workingHourStart || undefined, end: fees.workingHourEnd || undefined },
        handoverWorkingHour: { start: fees.handoverHourStart || undefined, end: fees.handoverHourEnd || undefined },
        tenantPaymentMethodPolicy: fees.tenantPaymentMethodPolicy,
        tenantRentAutoDebitOffered: fees.tenantRentAutoDebitOffered,
      }
      const r = await saveAdmin(admin)
      if (r?.ok !== false) {
        setShowFeesDialog(false)
        loadData()
      } else {
        setError((r as { reason?: string }).reason || "Save failed")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSavingFees(false)
    }
  }

  const openStaffDialog = async (s: StaffItem | null) => {
    setEditingStaff(s)
    setSelectedStaffContactId("")
    setStaffContactsForAdd([])
    if (s) {
      const rawPerms = s.permission
      const isMaster = mainAdminEmail && (s.email || "").trim().toLowerCase() === mainAdminEmail
      const permObj = Array.isArray(rawPerms)
        ? Object.fromEntries((rawPerms as string[]).map((k) => [k, true]))
        : (rawPerms && typeof rawPerms === "object" && !Array.isArray(rawPerms) ? (rawPerms as Record<string, boolean>) : {})
      const permission = isMaster
        ? Object.fromEntries(permKeys.map((k) => [k, true]))
        : permObj
      setStaffForm({
        name: s.name || "",
        email: s.email || "",
        permission,
      })
      setShowStaffDialog(true)
      return
    }
    setStaffForm({ name: "", email: "", permission: {} })
    setLoadingStaffContacts(true)
    setShowStaffDialog(true)
    try {
      const res = await getContactList({
        type: "staff",
        limit: 2000,
        ...(operatorClientId ? { clientId: operatorClientId } : {}),
      })
      const items = (res?.items || []) as Array<{
        type?: string
        raw?: { _id?: string; name?: string; fullname?: string; email?: string }
      }>
      const existingEmails = new Set(
        staff.map((x) => (x.email || "").trim().toLowerCase()).filter(Boolean)
      )
      const opts: Array<{ id: string; name: string; email: string }> = []
      for (const it of items) {
        if (it.type !== "staff") continue
        const raw = it.raw || {}
        const id = String(raw._id || "").trim()
        const email = String(raw.email || "").trim()
        const name = String(raw.name || raw.fullname || "").trim()
        if (!id || !email) continue
        if (existingEmails.has(email.toLowerCase())) continue
        opts.push({ id, name: name || email.split("@")[0] || "User", email })
      }
      opts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      setStaffContactsForAdd(opts)
    } catch {
      setStaffContactsForAdd([])
    } finally {
      setLoadingStaffContacts(false)
    }
  }

  const handleSaveStaff = async () => {
    const permission = Object.keys(staffForm.permission).filter(k => staffForm.permission[k])
    if (!editingStaff?.id) {
      if (!selectedStaffContactId || !staffForm.email.trim()) {
        setError("Select a staff member from Contact (staff).")
        return
      }
    }
    const payload = editingStaff?.id
      ? { name: staffForm.name.trim(), email: staffForm.email.trim().toLowerCase(), permission }
      : { name: staffForm.name.trim(), staffEmail: staffForm.email.trim().toLowerCase(), permission }
    setSavingStaff(true)
    try {
      if (editingStaff?.id) {
        const r = await updateStaff(editingStaff.id, payload)
        if (r?.ok !== false) {
          await loadData()
          setShowStaffDialog(false)
          setEditingStaff(null)
        } else {
          const reason = (r as { reason?: string }).reason
          setError(reason === "EMAIL_ALREADY_BOUND_TO_ANOTHER_COMPANY" ? "该邮箱已被其他公司使用，一个邮箱只能代表一间公司。" : reason === "EMAIL_ALREADY_ADDED" ? "该邮箱已是本公司用户，无需重复添加。" : reason || "Update failed")
        }
      } else {
        const r = await createStaff(payload)
        if (r?.ok !== false) {
          await loadData()
          setShowStaffDialog(false)
          setEditingStaff(null)
        } else {
          const reason = (r as { reason?: string }).reason
          setError(reason === "EMAIL_ALREADY_BOUND_TO_ANOTHER_COMPANY" ? "该邮箱已被其他公司使用，一个邮箱只能代表一间公司。" : reason === "EMAIL_ALREADY_ADDED" ? "该邮箱已是本公司用户，无需重复添加。" : reason || "Create failed")
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSavingStaff(false)
    }
  }

  const handleDeleteStaff = async (s: StaffItem) => {
    const rowId = String(s.id || s._id || "").trim()
    if (!rowId) return
    const isMaster = !!(mainAdminEmail && (s.email || "").trim().toLowerCase() === mainAdminEmail)
    const isAdminRow = !!s.is_admin
    const currentStaffId = accessCtx?.staff?.id
    const isSelf = !!(currentStaffId && rowId === currentStaffId)
    if (!canEditStaff || isMaster || isAdminRow || isSelf) return
    if (!window.confirm(`Remove user "${s.name || s.email || rowId}"? They will no longer be able to sign in as this company.`)) return
    setDeletingStaffId(rowId)
    setError(null)
    try {
      const r = await deleteStaff(rowId, operatorClientId ? { clientId: operatorClientId } : undefined)
      if (r?.ok !== false) {
        await loadData()
        await refresh?.()
      } else {
        const reason = (r as { reason?: string }).reason
        setError(
          reason === "MAIN_ACCOUNT_CANNOT_DELETE"
            ? "The main company account cannot be removed."
            : reason === "CANNOT_DELETE_SELF"
              ? "You cannot remove your own user account."
              : reason === "STAFF_NOT_FOUND"
                ? "User not found or already removed."
                : reason || "Delete failed"
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeletingStaffId(null)
    }
  }

  const handleDisconnect = async (id: string) => {
    setIntegrationAction(id)
    try {
      let r: { ok?: boolean; reason?: string } | undefined
      if (id === "stripe") r = await stripeDisconnect()
      else if (id === "xendit") r = await payexDisconnect()
      else if (id === "billplz") r = await billplzDisconnect()
      else if (id === "cnyiot") r = await cnyiotDisconnect()
      else if (id === "ttlock") r = await ttlockDisconnect()
      else if (id === "bukku") r = await bukkuDisconnect()
      else if (id === "xero") r = await xeroDisconnect()
      else if (id === "cleanlemons") {
        r = await disconnectCleanlemonsLink(operatorClientId ? { clientId: operatorClientId } : {})
      }
      if (r?.ok !== false) {
        setIntegrations(prev =>
          prev.map((i) => {
            if (i.id !== id) return i
            if (id === "cleanlemons") {
              return { ...i, connected: false, cleanlemonsOauthVerified: false, cleanlemonsConfirmed: false }
            }
            return { ...i, connected: false }
          })
        )
        setShowIntegrationDialog(false)
        setShowAccountingConnectDialog(false)
      } else {
        setError(r?.reason || "Disconnect failed")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed")
    } finally {
      setIntegrationAction(null)
    }
  }

  const handleConnect = async (id: string, opts?: Record<string, unknown>) => {
    setIntegrationAction(id)
    try {
      const creds = opts || (integrationCreds.username || integrationCreds.password ? { username: integrationCreds.username, password: integrationCreds.password } : {}) as Record<string, unknown>
      if (id === "bukku" && (integrationCreds.token || integrationCreds.subdomain)) Object.assign(creds, { token: integrationCreds.token, subdomain: integrationCreds.subdomain, einvoice: !!integrationCreds.einvoice })
      let r: { ok?: boolean; url?: string; reason?: string } | undefined
      if (id === "stripe") {
        r = await getStripeConnectOnboardUrl({ returnUrl: typeof window !== "undefined" ? window.location.href : "" })
        if (r?.url) { window.location.href = r.url; return }
      } else if (id === "xendit") {
        r = await payexConnect({
          xendit_sub_account_id: integrationCreds.xendit_sub_account_id?.trim() || undefined,
          xendit_test_secret_key: payexPlatformMode ? undefined : (integrationCreds.xendit_test_secret_key || ""),
          xendit_live_secret_key: payexPlatformMode ? undefined : (integrationCreds.xendit_live_secret_key || ""),
          xendit_use_test: false,
        })
      } else if (id === "cnyiot") r = await cnyiotConnect({ mode: "create" })
      else if (id === "ttlock") {
        r = await ttlockConnect({
          mode: "existing",
          username: integrationCreds.username?.trim() || "",
          password: integrationCreds.password || "",
        })
      }
      else if (id === "bukku") r = await bukkuConnect(creds)
      else if (id === "xero") {
        r = await getXeroAuthUrl({ redirectUri: getXeroRedirectUri() })
        if (r?.url) { window.location.href = r.url; return }
      }
      if (r?.ok !== false) {
        setIntegrations(prev => prev.map(i =>
          i.id === id ? { ...i, connected: true } : (i.category === "accounting" && id !== i.id ? { ...i, connected: false } : i)
        ))
        setShowIntegrationDialog(false)
        setShowAccountingConnectDialog(false)
        if (id === "ttlock") loadData()
      } else {
        const reason = (r as { reason?: string })?.reason
        setError(
          reason === "CNYIOT_PLATFORM_ONLY" ? "Meter uses platform account only. Use Connect to create a sub-account for your company."
          : reason === "TTLOCK_USERNAME_PASSWORD_REQUIRED" ? "Please enter your TTLock username and password."
          : (reason || "Connect failed")
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connect failed"
      setError(
        msg === "CNYIOT_PLATFORM_ONLY" ? "Meter uses platform account only. Use Connect to create a sub-account for your company."
        : msg === "TTLOCK_USERNAME_PASSWORD_REQUIRED" ? "Please enter your TTLock username and password."
        : msg
      )
    } finally {
      setIntegrationAction(null)
    }
  }

  const connectedAccounting = integrations.find(i => i.category === "accounting" && i.connected)
  const accountingOptions = integrations.filter(i => i.category === "accounting")
  const connectedPaymentGateway = integrations.find(i => i.category === "payment" && i.connected)
  const pendingPaymentGatewayId =
    stripeGatewayState.connectionStatus === "pending_verification"
      ? "stripe"
      : xenditGatewayState.connectionStatus === "pending_verification"
        ? "xendit"
        : billplzGatewayState.connectionStatus === "pending_verification"
          ? "billplz"
          : ""
  const pendingPaymentGateway =
    pendingPaymentGatewayId === "stripe"
      ? "Stripe"
      : pendingPaymentGatewayId === "xendit"
        ? "Xendit"
        : pendingPaymentGatewayId === "billplz"
          ? "Billplz"
          : ""
  const paynowOnlyConnected = isSgdCompany && paymentGatewayProviderState === "paynow"
  const showCombinedPaynowAndPending = paynowOnlyConnected && !!pendingPaymentGateway
  const stripePendingVerification = stripeGatewayState.connectionStatus === "pending_verification"
  const stripeCanDisconnect =
    Boolean(
      stripeGatewayState.oauthConnected ||
      stripeGatewayState.hasWebhookSecret ||
      stripeGatewayState.accountId ||
      stripeGatewayState.connectionStatus === "connected" ||
      stripePendingVerification
    )
  const xenditPendingVerification = xenditGatewayState.connectionStatus === "pending_verification"
  const billplzPendingVerification = billplzGatewayState.connectionStatus === "pending_verification"

  const grouped = Object.entries(
    integrations.reduce((acc, i) => {
      if (i.category === "accounting" && !i.connected) {
        if (!acc["accounting"]) acc["accounting"] = []
        return acc
      }
      if (i.category === "payment" && !i.connected) {
        if (!acc["payment"]) acc["payment"] = []
        return acc
      }
      if (!acc[i.category]) acc[i.category] = []
      acc[i.category].push(i)
      return acc
    }, {} as Record<string, IntegrationItem[]>)
  )

  const updateCommissionRule = (index: number, field: string, value: string) => {
    setCommissionRules(prev => prev.map((rule, i) => 
      i === index ? { ...rule, [field]: value } : rule
    ))
  }

  const getDateLabel = (type: string, value: string) => {
    if (type === "first") return "First day of month"
    if (type === "last") return "Last day of month"
    if (type === "movein") return "Move-in date"
    if (type === "specific") return `Day ${value || "?"}`
    return type
  }

  const getDepositLabel = (type: string, value: string) => {
    if (type === "specific") return `${moneyPrefix} ${value || "?"}`
    return `${type} month rental`
  }

  const permKeys = ["finance", "tenantdetail", "accounting", "propertylisting", "marketing", "booking", "profilesetting", "billing", "integration", "usersetting", "admin"]

  if (loading) {
    return (
      <main className="p-3 sm:p-6">
        <div className="flex items-center justify-center py-16 text-muted-foreground">Loading...</div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="p-3 sm:p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Company Settings</h1>
          <p className="text-muted-foreground mt-1">Manage company information, fees, staff, and integrations.</p>
        </div>
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <p className="text-destructive font-medium">{error}</p>
          <Button onClick={() => loadData()} style={{ background: "var(--brand)" }}>
            Retry
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="p-3 sm:p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Company Settings</h1>
        <p className="text-muted-foreground mt-1">Manage company information, fees, staff, and integrations.</p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Company Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 size={18} /> Company Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Country</Label>
                <Input value={currencyToCountry(profile?.currency)} className="mt-1 bg-muted" disabled />
                <p className="text-xs text-muted-foreground mt-0.5">Read-only (from currency).</p>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Company Name</Label>
                <Input value={profileDraft.title} onChange={(e) => setProfileDraft(p => ({ ...p, title: e.target.value }))} className="mt-1" readOnly={!canEditProfile} />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">{(profile?.currency || profileDraft.currency || "").toUpperCase() === "SGD" ? "UEN Number" : "SSM Number"}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{(profile?.currency || profileDraft.currency || "").toUpperCase() === "SGD" ? "For PayNow: tenants copy UEN, pay in app, then upload receipt." : "Company registration number (Malaysia)."}</p>
                <Input
                  value={(profile?.currency || profileDraft.currency || "").toUpperCase() === "SGD" ? profileDraft.uen : profileDraft.ssm}
                  onChange={(e) => setProfileDraft(p => (profile?.currency || p.currency || "").toUpperCase() === "SGD" ? { ...p, uen: e.target.value } : { ...p, ssm: e.target.value })}
                  placeholder={(profile?.currency || profileDraft.currency || "").toUpperCase() === "SGD" ? "e.g. 201234567A" : ""}
                  className="mt-1 max-w-xs font-mono"
                  readOnly={!canEditProfile}
                />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Subdomain</Label>
                <Input value={profileDraft.subdomain} onChange={(e) => setProfileDraft(p => ({ ...p, subdomain: e.target.value }))} className="mt-1" readOnly={!canEditProfile} placeholder="e.g. mycompany" />
              </div>
              {(profile?.currency || profileDraft.currency || "").toUpperCase() === "MYR" && (
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">TIN (Tax Identification Number)</Label>
                  <Input value={profileDraft.tin} onChange={(e) => setProfileDraft(p => ({ ...p, tin: e.target.value }))} className="mt-1" readOnly={!canEditProfile} />
                </div>
              )}
              <div className="sm:col-span-2">
                <Label className="text-xs uppercase text-muted-foreground">Address</Label>
                <textarea rows={2} value={profileDraft.address} onChange={(e) => setProfileDraft(p => ({ ...p, address: e.target.value }))} className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" readOnly={!canEditProfile} />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Contact</Label>
                <Input value={profileDraft.contact} onChange={(e) => setProfileDraft(p => ({ ...p, contact: e.target.value }))} className="mt-1" readOnly={!canEditProfile} />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Bank</Label>
                <Select value={profileDraft.bankId ?? ""} onValueChange={(v) => setProfileDraft(p => ({ ...p, bankId: v || null }))} disabled={!canEditProfile}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select bank" />
                  </SelectTrigger>
                  <SelectContent>
                    {banks.map((b) => (
                      <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Account Number</Label>
                <Input value={profileDraft.accountnumber} onChange={(e) => setProfileDraft(p => ({ ...p, accountnumber: e.target.value }))} className="mt-1" readOnly={!canEditProfile} />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Account Holder</Label>
                <Input value={profileDraft.accountholder} onChange={(e) => setProfileDraft(p => ({ ...p, accountholder: e.target.value }))} className="mt-1" readOnly={!canEditProfile} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Company Logo</Label>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
                  Branding for invoices, emails, and tenant-facing pages. This is not your personal profile photo — use <strong>My Profile</strong> for that.
                </p>
                <div className="mt-1 flex items-center gap-3">
                  {(profileDraft.profilephoto || profile?.profilephoto) && (
                    <img src={wixImageToStatic(profileDraft.profilephoto || profile?.profilephoto || "")} alt="Logo" className="h-16 w-16 object-contain rounded border border-border bg-muted" referrerPolicy="no-referrer" />
                  )}
                  {canEditProfile && (
                    <div className="flex flex-col gap-1">
                      <input type="file" accept="image/*" className="hidden" id="company-logo-upload" onChange={handleLogoUpload} disabled={uploadingLogo} />
                      <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById("company-logo-upload")?.click()} disabled={uploadingLogo}>
                        <Upload size={14} className="mr-1" /> {uploadingLogo ? "Uploading..." : "Upload logo"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Company Chop</Label>
                <div className="mt-1 flex items-center gap-3">
                  {(profileDraft.companyChop || profile?.companyChop) && (
                    <img src={wixImageToStatic(profileDraft.companyChop || profile?.companyChop || "")} alt="Chop" className="h-16 w-16 object-contain rounded border border-border bg-white" referrerPolicy="no-referrer" />
                  )}
                  {canEditProfile && (
                    <div className="flex flex-col gap-1">
                      <input type="file" accept="image/*" className="hidden" id="company-chop-upload" onChange={handleChopUpload} disabled={uploadingChop} />
                      <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById("company-chop-upload")?.click()} disabled={uploadingChop}>
                        <Upload size={14} className="mr-1" /> {uploadingChop ? "Uploading..." : "Upload chop"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <Button style={{ background: "var(--brand)" }} className="w-full sm:w-auto" onClick={handleSaveProfile} disabled={savingProfile || !canEditProfile}>
              {savingProfile ? "Saving..." : "Save Company Info"}
            </Button>
          </CardContent>
        </Card>

        {/* Fees & Charges - Admin Section */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <DollarSign size={18} /> Fees & Charges
            </CardTitle>
            <Button size="sm" onClick={openFeesDialog} style={{ background: "var(--brand)" }} disabled={!canEditProfile}>
              <Edit2 size={16} className="mr-1" /> Set Fees
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/30 md:col-span-2 lg:col-span-3">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Tenant portal — payments</p>
                <p className="text-sm font-semibold text-foreground">
                  Link policy: {TENANT_PAYMENT_METHOD_POLICY_OPTIONS.find((o) => o.value === fees.tenantPaymentMethodPolicy)?.label ?? fees.tenantPaymentMethodPolicy}
                </p>
                <p className="text-sm font-semibold text-foreground mt-1">
                  Auto-debit opt-in switch: {fees.tenantRentAutoDebitOffered ? "Shown on tenant payment page" : "Hidden (tenants cannot opt in to cron charges)"}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Owner Payout Date</p>
                <p className="text-sm font-semibold text-foreground">{getDateLabel(fees.payoutType, fees.payoutValue)}</p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Invoice due grace</p>
                <p className="text-sm font-semibold text-foreground">{fees.dueDate} days</p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Staff Salary Date</p>
                <p className="text-sm font-semibold text-foreground">{getDateLabel(fees.salaryType, fees.salaryValue)}</p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Rental Invoice Date</p>
                <p className="text-sm font-semibold text-foreground">{getDateLabel(fees.rentalType, fees.rentalValue)}</p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Deposit</p>
                <p className="text-sm font-semibold text-foreground">{getDepositLabel(fees.depositType, fees.depositValue)}</p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Agreement Fees</p>
                <p className="text-sm font-semibold text-foreground">{moneyPrefix} {fees.agreementFees}</p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Parking Fee</p>
                <p className="text-sm font-semibold text-foreground">{moneyPrefix} {fees.parking}/month</p>
              </div>
              {fees.otherFeesRows.some((r) => r.name.trim()) && (
                <div className="p-4 rounded-lg bg-secondary/50 border border-border space-y-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Default other fees</p>
                  {fees.otherFeesRows.filter((r) => r.name.trim()).map((r, i) => (
                    <div key={i} className="flex justify-between gap-2 text-sm">
                      <span className="font-semibold text-foreground">{r.name.trim()}</span>
                      <span className="text-foreground shrink-0">{moneyPrefix} {r.amount || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Commission release date</p>
                <p className="text-sm font-semibold text-foreground">{getDateLabel(fees.commissionDateType, fees.commissionDateValue)}</p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Working Hour</p>
                <p className="text-sm font-semibold text-foreground">{fees.workingHourStart} - {fees.workingHourEnd}</p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Handover Working Hour</p>
                <p className="text-sm font-semibold text-foreground">{fees.handoverHourStart} - {fees.handoverHourEnd}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* User Management */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users size={18} /> User Management
            </CardTitle>
            <div className="flex flex-col items-end gap-1">
              <Button size="sm" onClick={() => openStaffDialog(null)} style={{ background: "var(--brand)" }} disabled={!canEditStaff || staff.length >= maxStaffAllowed}>
                <Plus size={16} className="mr-1" /> Add user ({staff.length}/{maxStaffAllowed})
              </Button>
              {userLimit && (
                <p className="text-xs text-muted-foreground text-right max-w-[280px]">
                  {staff.length}/{maxStaffAllowed} users · {userLimit.planIncluded} from plan
                  {userLimit.extraUserAddon > 0 ? ` + ${userLimit.extraUserAddon} from Extra User addon` : ""}
                  {" "}(max 10)
                </p>
              )}
              {staff.length >= maxStaffAllowed && (
                <p className="text-xs text-amber-700 dark:text-amber-500 text-right max-w-[280px]">
                  Seat limit reached. Add Extra User in Billing to increase (up to 10).
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {staff.length === 0 && (
                <p className="text-sm text-muted-foreground py-4">No user yet. Click &quot;Add user&quot; to add team members.</p>
              )}
              {staff.map((s) => {
                const isMaster = mainAdminEmail && (s.email || "").trim().toLowerCase() === mainAdminEmail
                const rowId = String(s.id || s._id || "").trim()
                const isAdminRow = !!s.is_admin
                const currentStaffId = accessCtx?.staff?.id
                const isSelf = !!(currentStaffId && rowId && rowId === currentStaffId)
                const canDeleteUser = canEditStaff && !isMaster && !isAdminRow && !isSelf && !!rowId
                const perms = s.permission || {}
                const permIndices = permKeys.map((k, i) => (perms[k] ? i : -1)).filter(i => i >= 0)
                const permDisplay = isMaster ? "All" : permIndices.length ? permIndices.join("") : "—"
                return (
                  <div key={s.id || s._id || ""} className="flex items-center justify-between p-4 border border-border rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground">
                        {s.name || ""}
                        {isMaster && <span className="ml-2 text-xs font-normal text-muted-foreground">(master user)</span>}
                      </p>
                      <p className="text-sm text-muted-foreground">{s.email || ""}</p>
                      <div className="flex gap-1 mt-2 flex-wrap">
                        <Badge variant="outline" className="text-xs font-mono">{permDisplay}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => openStaffDialog(s)} disabled={!canEditStaff}>
                        <Edit2 size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteStaff(s)}
                        disabled={!canDeleteUser || deletingStaffId === rowId}
                        title={!canEditStaff ? "No permission" : isMaster || isAdminRow ? "Main account cannot be removed" : isSelf ? "You cannot remove yourself" : "Remove user"}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* System Integrations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings size={18} /> System Integrations
            </CardTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              {integrations.map((i) => (
                <span key={i.id} className="inline-flex items-center gap-1 text-xs">
                  {i.connected ? <CheckCircle size={12} className="text-green-600" /> : <XCircle size={12} className="text-muted-foreground" />}
                  <span className={i.connected ? "text-green-600 font-medium" : "text-muted-foreground"}>{i.name}</span>
                </span>
              ))}
              <span className="inline-flex items-center gap-1 text-xs">
                {googleDriveConnected ? <CheckCircle size={12} className="text-green-600" /> : <XCircle size={12} className="text-muted-foreground" />}
                <span className={googleDriveConnected ? "text-green-600 font-medium" : "text-muted-foreground"}>Google Drive</span>
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* AI Agent & Bank tracking */}
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">AI & Bank</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-4 border border-border rounded-xl flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                      <Bot size={18} style={{ color: "var(--brand)" }} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm">AI Agent</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">Receipt OCR and payment matching. Choose DeepSeek, ChatGPT, or Gemini; use your own API key.</p>
                      <div className="flex items-center gap-1 mt-1.5">
                        {aiProvider ? <><CheckCircle size={12} className="text-green-600" /><span className="text-xs text-green-600 font-medium">{aiProvider === "openai" ? "ChatGPT" : aiProvider === "gemini" ? "Gemini" : "DeepSeek"}{aiProviderHasApiKey ? " + API key" : ""}</span></> : <><XCircle size={12} className="text-muted-foreground" /><span className="text-xs text-muted-foreground">Not set</span></>}
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant={aiProvider ? "outline" : "default"} className="flex-shrink-0" style={!aiProvider ? { background: "var(--brand)" } : undefined} onClick={() => { setAiProviderDraft({ provider: aiProvider || "", api_key: "" }); setShowAiProviderDialog(true) }} disabled={!canEditIntegration}>
                    {aiProvider ? "Manage" : "Set up"}
                  </Button>
                </div>
                <div className="p-4 border border-border rounded-xl flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                      <Landmark size={18} style={{ color: "var(--brand)" }} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm">Bank tracking</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">Reconcile payments via bank data (Finverse). Connect your bank to sync transactions.</p>
                      <div className="flex items-center gap-1 mt-1.5">
                        {bankReconcileConnected ? <><CheckCircle size={12} className="text-green-600" /><span className="text-xs text-green-600 font-medium">Connected</span></> : finverseHasCreds ? <><XCircle size={12} className="text-muted-foreground" /><span className="text-xs text-muted-foreground">Not connected</span></> : <><XCircle size={12} className="text-muted-foreground" /><span className="text-xs text-muted-foreground">Configure Finverse in env or addon</span></>}
                      </div>
                    </div>
                  </div>
                  {bankReconcileConnected ? (
                    <Button size="sm" variant="outline" className="flex-shrink-0" disabled>Connected</Button>
                  ) : finverseHasCreds ? (
                    <Button size="sm" variant="outline" className="flex-shrink-0" disabled={finverseConnecting} onClick={async () => {
                      setFinverseConnecting(true)
                      try {
                        const r = await getFinverseLinkUrl()
                        if (r?.ok && r.link_url) window.location.href = r.link_url
                        else {
                          const reason = (r as { reason?: string }).reason ?? "Failed to get Connect link"
                          setError(
                            reason === "FINVERSE_UNREACHABLE" || reason === "fetch failed"
                              ? "Bank connection service is temporarily unreachable. Please try again later."
                              : reason
                          )
                        }
                      } finally {
                        setFinverseConnecting(false)
                      }
                    }}>
                      {finverseConnecting ? "Redirecting…" : "Connect"}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="flex-shrink-0" disabled title="Set FINVERSE_CLIENT_ID / FINVERSE_CLIENT_SECRET or add Bank Reconcile addon.">Addon required</Button>
                  )}
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Storage</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-4 border border-border rounded-xl flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                      <HardDrive size={18} style={{ color: "var(--brand)" }} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm">Google Drive</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Connect your Google account so agreement PDFs use your Docs/Drive storage. Share your template document and output folder with that Google user.
                      </p>
                      <div className="flex items-center gap-1 mt-1.5">
                        {googleDriveConnected ? (
                          <>
                            <CheckCircle size={12} className="text-green-600" />
                            <span className="text-xs text-green-600 font-medium">
                              Connected{googleDriveEmail ? ` (${googleDriveEmail})` : ""}
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle size={12} className="text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Not connected</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    {googleDriveConnected ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canEditIntegration || googleDriveConnecting}
                        onClick={async () => {
                          setGoogleDriveConnecting(true)
                          try {
                            const r = await disconnectGoogleDrive(operatorClientId ? { clientId: operatorClientId } : undefined)
                            if (r?.ok) await loadData()
                            else setError((r as { reason?: string }).reason ?? "Disconnect failed")
                          } finally {
                            setGoogleDriveConnecting(false)
                          }
                        }}
                      >
                        {googleDriveConnecting ? "…" : "Disconnect"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        style={{ background: "var(--brand)" }}
                        disabled={!canEditIntegration || googleDriveConnecting}
                        onClick={async () => {
                          setGoogleDriveConnecting(true)
                          try {
                            const r = await getGoogleDriveOAuthUrl(operatorClientId ? { clientId: operatorClientId } : undefined)
                            if (r?.ok && r.url) window.location.href = r.url
                            else {
                              const reason = (r as { reason?: string }).reason ?? "Could not start Google sign-in"
                              setError(reason)
                            }
                          } finally {
                            setGoogleDriveConnecting(false)
                          }
                        }}
                      >
                        {googleDriveConnecting ? "Redirecting…" : "Google Connect"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {(hasAccountingCapability ? grouped : grouped.filter(([cat]) => cat !== "accounting"))
              .filter(([cat, items]) => cat !== "partner" || items.length > 0)
              .map(([category, items]) => (
              <div key={category}>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">{CATEGORY_LABELS[category] ?? category}</p>
                {category === "payment" && (connectedPaymentGateway || paynowOnlyConnected) && (
                  <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                    <p className="text-xs text-amber-700"><Shield size={14} className="inline mr-1" /><strong>Note:</strong> Only one payment gateway per company. Currently: <strong>{connectedPaymentGateway?.name || "PayNow"}</strong>. Stripe or Xendit (SGD / MYR).</p>
                  </div>
                )}
                {category === "accounting" && connectedAccounting && (
                  <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                    <p className="text-xs text-amber-700"><Shield size={14} className="inline mr-1" /><strong>Note:</strong> Only one accounting system can be connected. Currently: <strong>{connectedAccounting.name}</strong></p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {category === "payment" && (!connectedPaymentGateway || paynowOnlyConnected) && (
                    <div className="p-4 border border-border rounded-xl flex items-start justify-between gap-3 md:col-span-2">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                          <DollarSign size={18} style={{ color: "var(--brand)" }} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground text-sm">Payment gateway</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">Connect Stripe or Xendit (SGD / MYR). One payment gateway per company.</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {showCombinedPaynowAndPending ? (
                              <>
                                <CheckCircle size={12} className="text-green-600" />
                                <span className="text-xs text-green-600 font-medium">PayNow only enabled</span>
                                <span className="text-xs text-muted-foreground">+</span>
                                <Shield size={12} className="text-amber-600" />
                                <span className="text-xs text-amber-600 font-medium">{pendingPaymentGateway} pending verification</span>
                              </>
                            ) : paynowOnlyConnected ? (
                              <><CheckCircle size={12} className="text-green-600" /><span className="text-xs text-green-600 font-medium">PayNow only enabled</span></>
                            ) : pendingPaymentGateway ? (
                              <><Shield size={12} className="text-amber-600" /><span className="text-xs text-amber-600 font-medium">{pendingPaymentGateway} pending verification</span></>
                            ) : (
                              <><XCircle size={12} className="text-muted-foreground" /><span className="text-xs text-muted-foreground">Not connected</span></>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="flex-shrink-0"
                        style={paynowOnlyConnected ? undefined : { background: "var(--brand)" }}
                        variant={paynowOnlyConnected ? "outline" : "default"}
                        onClick={() => {
                          const nextGateway = pendingPaymentGatewayId || (isSgdCompany ? "paynow" : "stripe")
                          setPaymentGatewayChoice(nextGateway as "paynow" | "stripe" | "xendit" | "billplz")
                          setPaymentStep(
                            pendingPaymentGatewayId === "stripe"
                              ? "stripe"
                              : pendingPaymentGatewayId === "xendit"
                                ? "xendit-form"
                                : pendingPaymentGatewayId === "billplz"
                                  ? "billplz-form"
                                : "choose"
                          )
                          setIntegrationCreds(c => ({ ...c, stripe_webhook_secret: "", xendit_api_key: "", xendit_webhook_token: "", billplz_api_key: "", billplz_collection_id: "", billplz_x_signature_key: "" }))
                          setShowPaymentGatewayDialog(true)
                        }}
                        disabled={!canEditIntegration}
                      >
                        {paynowOnlyConnected ? "Manage" : pendingPaymentGateway ? "Continue setup" : "Connect"}
                      </Button>
                    </div>
                  )}
                {category === "accounting" && !connectedAccounting && (
                    <div className="p-4 border border-border rounded-xl flex items-start justify-between gap-3 md:col-span-2">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                          <BookOpen size={18} style={{ color: "var(--brand)" }} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground text-sm">Accounting</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">Connect one accounting system (Bukku or Xero)</p>
                          <div className="flex items-center gap-1 mt-1.5">
                            <XCircle size={12} className="text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Not connected</span>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="flex-shrink-0"
                        style={{ background: "var(--brand)" }}
                        onClick={() => { setSelectedAccountingSystem(""); setShowAccountingConnectDialog(true) }}
                        disabled={!canEditIntegration || !hasAccountingCapability}
                        title={!hasAccountingCapability ? "Upgrade addon to connect accounting" : undefined}
                      >
                        Connect
                      </Button>
                    </div>
                  )}
                  {items.map((integration) => (
                    <div key={integration.id} className="p-4 border border-border rounded-xl flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                          <integration.icon size={18} style={{ color: "var(--brand)" }} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground text-sm">{integration.name}</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">{integration.description}</p>
                          <div className="flex items-center gap-1 mt-1.5">
                            {integration.connected ? (
                              <><CheckCircle size={12} className="text-green-600" /><span className="text-xs text-green-600 font-medium">Connected</span></>
                            ) : (
                              <><XCircle size={12} className="text-muted-foreground" /><span className="text-xs text-muted-foreground">Not connected</span></>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={integration.connected ? "outline" : "default"}
                        className="flex-shrink-0"
                        style={!integration.connected ? { background: "var(--brand)" } : integration.id === "stripe" && integration.connected ? { borderColor: "rgb(34, 197, 94)", color: "rgb(22, 163, 74)" } : undefined}
                        onClick={() => {
                          if ((integration.id === "stripe" || integration.id === "xendit" || integration.id === "billplz") && !integration.connected) {
                            setPaymentGatewayChoice(integration.id as "paynow" | "stripe" | "xendit" | "billplz")
                            setPaymentStep("choose")
                            setIntegrationCreds(c => ({ ...c, stripe_webhook_secret: "", xendit_api_key: "", xendit_webhook_token: "", billplz_api_key: "", billplz_collection_id: "", billplz_x_signature_key: "" }))
                            setShowPaymentGatewayDialog(true)
                          } else if (
                            integration.id === "cleanlemons" &&
                            !integration.connected &&
                            !integration.cleanlemonsOauthVerified
                          ) {
                            void (async () => {
                              setCleanlemonsOauthRedirectBusy(true)
                              setError(null)
                              try {
                                const r = await startCleanlemonsLink(operatorClientId ? { clientId: operatorClientId } : {})
                                if (r?.ok && r.oauthUrl) {
                                  const win = openCleanlemonsColivingLinkPopup(r.oauthUrl)
                                  if (!win) {
                                    setError(
                                      "Popup blocked. Allow popups for this site to sign in on Cleanlemons, or try again."
                                    )
                                    return
                                  }
                                  toast.info("Complete sign-in in the Cleanlemons window. This tab stays on Company Settings.")
                                  return
                                }
                                const reason = (r as { reason?: string })?.reason
                                setError(
                                  reason === "CLEANLEMONS_MYR_OPERATORS_ONLY"
                                    ? "Cleanlemons partner integration is only available for Malaysia (MYR) operators."
                                    : reason || "Could not start Cleanlemons link"
                                )
                              } catch (e) {
                                setError(e instanceof Error ? e.message : "Could not start link")
                              } finally {
                                setCleanlemonsOauthRedirectBusy(false)
                              }
                            })()
                          } else {
                            setSelectedIntegration(integration)
                            setShowIntegrationDialog(true)
                            if (integration.id === "xendit") setIntegrationCreds(c => ({ ...c, xendit_api_key: "", xendit_webhook_token: "" }))
                            if (integration.id === "ttlock") {
                              setTtlockConnectStep("choose")
                              setIntegrationCreds(c => ({ ...c, username: "", password: "" }))
                            }
                            if (integration.id === "cleanlemons") {
                              setCleanlemonsExport(true)
                              setCleanlemonsTtlock(true)
                            }
                            if (integration.category === "accounting") setIntegrationCreds(c => ({ ...c, einvoice: accountingEinvoice ? "1" : "" }))
                          }
                        }}
                        disabled={
                          !canEditIntegration ||
                          (category === "accounting" && !hasAccountingCapability) ||
                          (category === "accounting" && !integration.connected && !!connectedAccounting) ||
                          (category === "payment" && !integration.connected && !!connectedPaymentGateway) ||
                          (integration.id === "cleanlemons" && cleanlemonsOauthRedirectBusy)
                        }
                      >
                        {integration.id === "stripe" && integration.connected
                          ? "Manage"
                          : (integration.id === "stripe" || integration.id === "xendit" || integration.id === "billplz") && integration.connected
                            ? `Disconnect ${integration.name}`
                            : (integration.id === "cnyiot" && integration.connected)
                              ? "View"
                              : integration.connected
                                ? "Manage"
                                : integration.id === "cleanlemons" && !integration.cleanlemonsOauthVerified
                                  ? cleanlemonsOauthRedirectBusy
                                    ? "Opening…"
                                    : "Continue with Cleanlemons"
                                  : integration.id === "cleanlemons" && integration.cleanlemonsOauthVerified
                                    ? "Finish linking"
                                    : "Connect"}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Connect Payment Gateway: choose Stripe / Xendit → then Stripe "Connect now" or Xendit "Create account now" / "Connect sub account" */}
      <Dialog
        open={showPaymentGatewayDialog}
        onOpenChange={(o) => {
          setShowPaymentGatewayDialog(o)
          if (!o) { setPaymentStep("choose") }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Connect payment gateway</DialogTitle>
            <DialogDescription>{isSgdCompany ? "For Singapore: PayNow is always available. Choose PayNow only, or connect Stripe/Xendit as extra option." : "Select Stripe, Xendit, or Billplz. One payment gateway per company."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {paymentStep === "choose" && (
              <>
                <div>
                  <Label className="text-xs font-semibold">Payment gateway</Label>
                  <Select value={paymentGatewayChoice} onValueChange={(v) => setPaymentGatewayChoice(v as "paynow" | "stripe" | "xendit" | "billplz")}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {isSgdCompany && <SelectItem value="paynow">PayNow only</SelectItem>}
                      <SelectItem value="stripe">Stripe</SelectItem>
                      <SelectItem value="xendit">Xendit</SelectItem>
                      {!isSgdCompany && <SelectItem value="billplz">Billplz</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  style={{ background: "var(--brand)" }}
                  className="w-full"
                  onClick={async () => {
                    if (paymentGatewayChoice === "paynow") {
                      setIntegrationAction("paynow")
                      try {
                        const r = await savePaymentGatewayMode("paynow_only")
                        if (r?.ok) {
                          setShowPaymentGatewayDialog(false)
                          setPaymentStep("choose")
                          loadData()
                        } else {
                          setError(r?.reason || "Failed to set PayNow mode")
                        }
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Failed")
                      } finally {
                        setIntegrationAction(null)
                      }
                      return
                    }
                    if (paymentGatewayChoice === "stripe") {
                      if (isSgdCompany) {
                        setIntegrationAction("stripe-mode")
                        try {
                          const r = await savePaymentGatewayMode("paynow_plus_stripe")
                          if (r?.ok !== false) setPaymentStep("stripe")
                          else setError(r?.reason || "Failed to set Stripe mode")
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Failed")
                        } finally {
                          setIntegrationAction(null)
                        }
                        return
                      }
                      setPaymentStep("stripe")
                    } else if (paymentGatewayChoice === "xendit") {
                      if (isSgdCompany) {
                        setIntegrationAction("xendit-mode")
                        try {
                          const r = await savePaymentGatewayMode("paynow_plus_xendit")
                          if (r?.ok === false) {
                            setError(r?.reason || "Failed to set Xendit mode")
                            setIntegrationAction(null)
                            return
                          }
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Failed")
                          setIntegrationAction(null)
                          return
                        } finally {
                          setIntegrationAction(null)
                        }
                      }
                      setPaymentStep("xendit-form")
                    } else {
                      setPaymentStep("billplz-form")
                    }
                  }}
                >
                  {integrationAction === "paynow" || integrationAction === "stripe-mode" || integrationAction === "xendit-mode" ? "Saving..." : "Confirm"}
                </Button>
              </>
            )}
            {paymentStep === "stripe" && (
              <>
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Status</p>
                    <Badge variant={stripeGatewayState.connectionStatus === "connected" ? "default" : "secondary"}>{stripeStatusLabel}</Badge>
                  </div>
                  {stripeGatewayState.accountId && (
                    <p className="text-sm text-muted-foreground break-all">Stripe account ID: <span className="font-mono">{stripeGatewayState.accountId}</span></p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    This page shows <strong>Connected</strong> after OAuth succeeds <strong>and</strong> Coliving&apos;s servers have received at least one valid Stripe webhook that matches your account (e.g. after a tenant payment or an account update).
                  </p>
                </div>
                {!stripeGatewayState.oauthConnected && (
                  <Button
                    style={{ background: "var(--brand)" }}
                    className="w-full"
                    disabled={!!integrationAction}
                    onClick={async () => {
                      setIntegrationAction("stripe")
                      try {
                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(STRIPE_OAUTH_RETURN_DIALOG_KEY, "1")
                        }
                        const r = await getStripeConnectOnboardUrl({ returnUrl: typeof window !== "undefined" ? window.location.href : "" })
                        if (r?.url) { window.location.href = r.url; return }
                        if (typeof window !== "undefined") {
                          window.localStorage.removeItem(STRIPE_OAUTH_RETURN_DIALOG_KEY)
                        }
                        setError(r?.reason || "Failed to get Stripe URL")
                      } catch (e) {
                        if (typeof window !== "undefined") {
                          window.localStorage.removeItem(STRIPE_OAUTH_RETURN_DIALOG_KEY)
                        }
                        setError(e instanceof Error ? e.message : "Failed")
                      }
                      finally { setIntegrationAction(null) }
                    }}
                  >
                    {integrationAction ? "Redirecting..." : "Step 1: Connect with Stripe"}
                  </Button>
                )}
                {stripeGatewayState.oauthConnected && (
                  <>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 space-y-2">
                      <p className="font-medium">Connect Standard — no webhook in your Stripe account</p>
                      <p>
                        You do <strong>not</strong> create an endpoint under <strong>your</strong> Stripe → Developers → Webhooks. Stripe delivers Connect events to <strong>Coliving&apos;s</strong> platform project; that is how we mark this integration verified.
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                      <Label className="text-xs font-semibold text-foreground">Coliving platform webhook URL (reference)</Label>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        SaaS / support use only — this is where Coliving&apos;s Stripe app must send events. Operators do not paste this into their own Stripe dashboard for OAuth Connect.
                      </p>
                      <div className="flex gap-2 flex-col sm:flex-row sm:items-center">
                        <Input readOnly className="font-mono text-xs bg-background" value={stripePlatformWebhookUrl} />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0 gap-1.5"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(stripePlatformWebhookUrl)
                              .then(() => toast.success("Webhook URL copied"))
                              .catch(() => toast.error("Copy failed"))
                          }}
                        >
                          <Copy size={14} /> Copy URL
                        </Button>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-foreground">Events Coliving handles (platform subscription)</p>
                        <p className="text-[11px] font-mono text-muted-foreground break-all">{stripeWebhookEventsHelp}</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs gap-1.5"
                          onClick={() => {
                            const block = `Endpoint: ${stripePlatformWebhookUrl}\nSubscribe to events: ${stripeWebhookEventsHelp}`
                            void navigator.clipboard
                              .writeText(block)
                              .then(() => toast.success("URL and events copied"))
                              .catch(() => toast.error("Copy failed"))
                          }}
                        >
                          <Copy size={12} /> Copy URL + events
                        </Button>
                      </div>
                    </div>
                    {stripeGatewayState.accountId && (
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold">Stripe account ID</Label>
                        <Input readOnly value={stripeGatewayState.accountId} className="mt-1 bg-muted font-mono" />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Tenant Checkout uses your connected account. If this still shows Pending, Stripe may not have delivered a webhook to Coliving yet — try a small test tenant payment or ask support to confirm the platform webhook in Stripe.
                    </p>
                    {stripeGatewayState.lastWebhookAt && (
                      <p className="text-xs text-muted-foreground">
                        Latest webhook: {stripeGatewayState.lastWebhookType || "event"} at {stripeGatewayState.lastWebhookAt}
                      </p>
                    )}
                    {stripeCanDisconnect && (
                      <Button
                        type="button"
                        variant="destructive"
                        className="w-full"
                        disabled={!canEditIntegration || !!integrationAction}
                        onClick={async () => {
                          setIntegrationAction("stripe-disconnect")
                          try {
                            const r = await stripeDisconnect()
                            if (r?.ok === false) {
                              setError(r?.reason || "Disconnect failed")
                              return
                            }
                            setShowPaymentGatewayDialog(false)
                            setPaymentStep("choose")
                            await loadData()
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Disconnect failed")
                          } finally {
                            setIntegrationAction(null)
                          }
                        }}
                      >
                        {integrationAction === "stripe-disconnect" ? "Disconnecting..." : "Disconnect Stripe"}
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
            {paymentStep === "xendit-form" && (
              <>
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Status</p>
                    <Badge variant={xenditGatewayState.connectionStatus === "connected" ? "default" : "secondary"}>{xenditStatusLabel}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Xendit only becomes <strong>Connected</strong> after operator saves secret key + callback token and our backend receives a valid callback.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Webhook URL</Label>
                  <Input readOnly value={xenditWebhookUrl} className="mt-1 bg-muted" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Xendit Secret Key</Label>
                  <Input
                    type="password"
                    placeholder="xnd_development_... or xnd_production_..."
                    value={integrationCreds.xendit_api_key || ""}
                    onChange={(e) => setIntegrationCreds(c => ({ ...c, xendit_api_key: e.target.value }))}
                    className="mt-1"
                  />
                  {xenditGatewayState.hasSecretKey && (
                    <p className="text-xs text-muted-foreground">Saved key ending with {xenditGatewayState.secretKeyLast4 || "****"}.</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs font-semibold">X-CALLBACK-TOKEN</Label>
                  <Input
                    type="password"
                    placeholder="Paste your X-CALLBACK-TOKEN"
                    value={integrationCreds.xendit_webhook_token || ""}
                    onChange={(e) => setIntegrationCreds(c => ({ ...c, xendit_webhook_token: e.target.value }))}
                    className="mt-1"
                  />
                  {xenditGatewayState.hasWebhookToken && (
                    <p className="text-xs text-muted-foreground">Saved token ending with {xenditGatewayState.webhookTokenLast4 || "****"}.</p>
                  )}
                </div>
                <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                  In Xendit webhook/callback settings, enable:
                  <br />- payment / invoice result callbacks
                  <br />- payment session or payment token callbacks
                  <br />- payout / disbursement settlement callbacks
                </div>
                <Button
                  style={{ background: "var(--brand)" }}
                  className="w-full"
                  disabled={!canEditIntegration || !!integrationAction || !integrationCreds.xendit_api_key?.trim() || !integrationCreds.xendit_webhook_token?.trim()}
                  onClick={async () => {
                    setIntegrationAction("xendit-connect")
                    try {
                      const r = await savePayexDirectConnect({
                        xendit_secret_key: integrationCreds.xendit_api_key?.trim() || undefined,
                        xendit_webhook_token: integrationCreds.xendit_webhook_token?.trim() || undefined,
                        xendit_webhook_url: xenditWebhookUrl,
                        xendit_use_test: !!String(integrationCreds.xendit_api_key || "").startsWith("xnd_development_"),
                      })
                      if (r?.ok !== false) {
                        await loadData()
                      } else setError(r?.reason || "Connect failed")
                    } catch (e) { setError(e instanceof Error ? e.message : "Failed") }
                    finally { setIntegrationAction(null) }
                  }}
                >
                  {integrationAction === "xendit-connect" ? "Saving..." : "Save Xendit credentials"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  After saving, send a test callback from Xendit. Status becomes Connected only after our API receives and verifies it.
                </p>
                {xenditPendingVerification && (
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full"
                    disabled={!canEditIntegration || !!integrationAction}
                    onClick={async () => {
                      setIntegrationAction("xendit-disconnect-pending")
                      try {
                        const r = await payexDisconnect()
                        if (r?.ok === false) {
                          setError(r?.reason || "Disconnect failed")
                          return
                        }
                        setShowPaymentGatewayDialog(false)
                        setPaymentStep("choose")
                        await loadData()
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Disconnect failed")
                      } finally {
                        setIntegrationAction(null)
                      }
                    }}
                  >
                    {integrationAction === "xendit-disconnect-pending" ? "Disconnecting..." : "Disconnect Xendit"}
                  </Button>
                )}
              </>
            )}
            {paymentStep === "billplz-form" && (
              <>
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Status</p>
                    <Badge variant={billplzGatewayState.connectionStatus === "connected" ? "default" : "secondary"}>{billplzStatusLabel}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Billplz only becomes <strong>Connected</strong> after operator saves API key + Collection ID + X Signature key and our backend receives a valid callback.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Payment webhook URL</Label>
                  <Input readOnly value={billplzWebhookUrl} className="mt-1 bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Payment Order callback URL (optional / later)</Label>
                  <Input readOnly value={billplzPaymentOrderWebhookUrl} className="mt-1 bg-muted" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Billplz API Key</Label>
                  <Input
                    type="password"
                    placeholder="Paste your Billplz API key"
                    value={integrationCreds.billplz_api_key || ""}
                    onChange={(e) => setIntegrationCreds(c => ({ ...c, billplz_api_key: e.target.value }))}
                    className="mt-1"
                  />
                  {billplzGatewayState.hasApiKey && (
                    <p className="text-xs text-muted-foreground">Saved key ending with {billplzGatewayState.apiKeyLast4 || "****"}.</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs font-semibold">Billplz Collection ID</Label>
                  <Input
                    placeholder="Paste your Collection ID"
                    value={integrationCreds.billplz_collection_id || ""}
                    onChange={(e) => setIntegrationCreds(c => ({ ...c, billplz_collection_id: e.target.value }))}
                    className="mt-1"
                  />
                  {billplzGatewayState.collectionId && (
                    <p className="text-xs text-muted-foreground">Saved collection ID: {billplzGatewayState.collectionId}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs font-semibold">Billplz X Signature key</Label>
                  <Input
                    type="password"
                    placeholder="Paste your X Signature key"
                    value={integrationCreds.billplz_x_signature_key || ""}
                    onChange={(e) => setIntegrationCreds(c => ({ ...c, billplz_x_signature_key: e.target.value }))}
                    className="mt-1"
                  />
                  {billplzGatewayState.hasXSignatureKey && (
                    <p className="text-xs text-muted-foreground">Saved signature key ending with {billplzGatewayState.xSignatureKeyLast4 || "****"}.</p>
                  )}
                </div>
                <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                  In Billplz, set the payment callback to the URL above and enable X Signature verification. Billplz direct is available for Malaysia operators only.
                </div>
                <Button
                  style={{ background: "var(--brand)" }}
                  className="w-full"
                  disabled={!canEditIntegration || !!integrationAction || !integrationCreds.billplz_api_key?.trim() || !integrationCreds.billplz_collection_id?.trim() || !integrationCreds.billplz_x_signature_key?.trim()}
                  onClick={async () => {
                    setIntegrationAction("billplz-connect")
                    try {
                      const r = await saveBillplzDirectConnect({
                        billplz_api_key: integrationCreds.billplz_api_key?.trim() || undefined,
                        billplz_collection_id: integrationCreds.billplz_collection_id?.trim() || undefined,
                        billplz_x_signature_key: integrationCreds.billplz_x_signature_key?.trim() || undefined,
                        billplz_webhook_url: billplzWebhookUrl,
                        billplz_payment_order_callback_url: billplzPaymentOrderWebhookUrl,
                      })
                      if (r?.ok !== false) {
                        await loadData()
                      } else setError(r?.reason || "Connect failed")
                    } catch (e) { setError(e instanceof Error ? e.message : "Failed") }
                    finally { setIntegrationAction(null) }
                  }}
                >
                  {integrationAction === "billplz-connect" ? "Saving..." : "Save Billplz credentials"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  After saving, complete a Billplz payment or callback test. Status becomes Connected only after our API receives and verifies a valid callback.
                </p>
                {(billplzPendingVerification || billplzGatewayState.connectionStatus === "connected") && (
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full"
                    disabled={!canEditIntegration || !!integrationAction}
                    onClick={async () => {
                      setIntegrationAction("billplz-disconnect-pending")
                      try {
                        const r = await billplzDisconnect()
                        if (r?.ok === false) {
                          setError(r?.reason || "Disconnect failed")
                          return
                        }
                        setShowPaymentGatewayDialog(false)
                        setPaymentStep("choose")
                        await loadData()
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Disconnect failed")
                      } finally {
                        setIntegrationAction(null)
                      }
                    }}
                  >
                    {integrationAction === "billplz-disconnect-pending" ? "Disconnecting..." : "Disconnect Billplz"}
                  </Button>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Accounting Connect Dialog - one system only */}
      <Dialog open={showAccountingConnectDialog} onOpenChange={(o) => { setShowAccountingConnectDialog(o); if (!o) setSelectedAccountingSystem("") }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Accounting</DialogTitle>
            <DialogDescription>Select one accounting system. Only one can be connected per client.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-semibold">Accounting System</Label>
              <Select value={selectedAccountingSystem} onValueChange={setSelectedAccountingSystem}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select system" /></SelectTrigger>
                <SelectContent>
                  {accountingOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>{opt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedAccountingSystem && (
              <div className="p-4 bg-card border border-border rounded-lg space-y-3">
                {(selectedAccountingSystem === "bukku") && (
                  <>
                    <div>
                      <Label className="text-xs font-semibold">Token</Label>
                      <Input placeholder="Token" value={integrationCreds.token || ""} onChange={(e) => setIntegrationCreds(c => ({ ...c, token: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Subdomain</Label>
                      <Input placeholder="Subdomain" value={integrationCreds.subdomain || ""} onChange={(e) => setIntegrationCreds(c => ({ ...c, subdomain: e.target.value }))} className="mt-1" />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!integrationCreds.einvoice} onChange={(e) => setIntegrationCreds(c => ({ ...c, einvoice: e.target.checked ? "1" : "" }))} className="accent-primary" />
                      <span className="text-sm">Enable E-Invoice</span>
                    </label>
                  </>
                )}
                {(selectedAccountingSystem === "xero") && (
                  <>
                    <p className="text-sm text-muted-foreground">Click Connect to authorize access to Xero via OAuth.</p>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!integrationCreds.einvoice} onChange={(e) => setIntegrationCreds(c => ({ ...c, einvoice: e.target.checked ? "1" : "" }))} className="accent-primary" />
                      <span className="text-sm">Enable E-Invoice</span>
                    </label>
                  </>
                )}
                <Button style={{ background: "var(--brand)" }} className="w-full" onClick={() => selectedAccountingSystem && handleConnect(selectedAccountingSystem)} disabled={!canEditIntegration || !!integrationAction}>
                  {integrationAction ? "Connecting..." : `Connect ${accountingOptions.find(o => o.id === selectedAccountingSystem)?.name ?? ""}`}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Fees Dialog — tenant policy in a non-scrolling strip so it is never missed when scrolling fees/commission */}
      <Dialog open={showFeesDialog} onOpenChange={setShowFeesDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] flex flex-col gap-0 overflow-hidden p-0">
          <div className="px-6 pt-6 pb-2 shrink-0 pr-14">
            <DialogHeader>
              <DialogTitle>Set Fees & Charges</DialogTitle>
              <DialogDescription>
                Payment rules for tenants are pinned at the top. Scroll for schedules, amounts, and commission rules.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="shrink-0 border-y border-border bg-secondary/40 px-6 py-4 space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Tenant portal (payments)</h4>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start lg:gap-6">
              <div className="min-w-0 space-y-1">
                <Label className="text-xs font-semibold">Link card / bank &amp; auto payment policy</Label>
                <p
                  className="text-xs text-muted-foreground line-clamp-2 lg:line-clamp-none"
                  title="No allow: hide bind. Strictly: must link or payment gate. Flexible: optional. Card save: Stripe/Xendit; MY/SG auto-debit: card only."
                >
                  <strong>No allow</strong> hides bind. <strong>Strictly</strong> requires link or payment gate. <strong>Flexible</strong> is optional. Stripe/Xendit cards; MY/SG auto-debit uses card.
                </p>
              </div>
              <div className="min-w-0 w-full max-w-full">
                <Select
                  value={fees.tenantPaymentMethodPolicy}
                  onValueChange={(v) =>
                    setFees({
                      ...fees,
                      tenantPaymentMethodPolicy: v as "strictly" | "no_allow" | "flexible",
                    })
                  }
                >
                  <SelectTrigger className="w-full min-w-0 max-w-full [&_[data-slot=select-value]]:text-left">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[100] max-w-[min(calc(100vw-2rem),var(--radix-select-trigger-width))]">
                    {TENANT_PAYMENT_METHOD_POLICY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-background/50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1 space-y-0.5">
                <Label className="text-xs font-semibold">Charge due rent automatically (tenant opt-in)</Label>
                <p
                  className="text-xs text-muted-foreground"
                  title="When on, tenants with a saved card see a switch so the daily billing job can charge due invoices. When off, that switch is hidden; manual pay may still follow the policy above."
                >
                  Show tenant switch for cron to charge due invoices when they have a saved card.
                </p>
              </div>
              <Switch
                className="shrink-0"
                checked={fees.tenantRentAutoDebitOffered}
                onCheckedChange={(v) => setFees({ ...fees, tenantRentAutoDebitOffered: v })}
                aria-label="Offer tenants automatic due-rent charging opt-in"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* Schedules: rent / billing, payouts, hours */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Schedules &amp; dates</h4>

              <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-4">
                <p className="text-sm font-semibold text-foreground">Rent invoicing &amp; due rules</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-semibold">Rental Invoice Date</Label>
                    <Select value={fees.rentalType} onValueChange={(v) => setFees({ ...fees, rentalType: v })}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RENTAL_DATE_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {fees.rentalType === "specific" && (
                      <Input type="number" min="1" max="31" placeholder="Day (1-31)" value={fees.rentalValue} onChange={(e) => setFees({ ...fees, rentalValue: e.target.value })} className="mt-2" />
                    )}
                  </div>
                  <div>
                    <Label
                      className="text-xs font-semibold"
                      title="Days after the invoice due date before lock / power-off. Example: due 1st, grace 7 → lock on 8th. 0 = same day as due date when cron runs."
                    >
                      Invoice due grace (days)
                    </Label>
                    <Input type="number" min="0" value={fees.dueDate} onChange={(e) => setFees({ ...fees, dueDate: e.target.value })} className="mt-1" />
                    <p className="text-xs text-muted-foreground mt-1">0 = lock on due date when cron runs. Higher values add days after due before lock.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-4">
                <p className="text-sm font-semibold text-foreground">Owner payout &amp; staff salary</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-semibold">Owner Payout Date</Label>
                    <Select value={fees.payoutType} onValueChange={(v) => setFees({ ...fees, payoutType: v })}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DATE_TYPE_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {fees.payoutType === "specific" && (
                      <Input type="number" min="1" max="31" placeholder="Day (1-31)" value={fees.payoutValue} onChange={(e) => setFees({ ...fees, payoutValue: e.target.value })} className="mt-2" />
                    )}
                  </div>
                  <div>
                    <Label className="text-xs font-semibold">Staff Salary Date</Label>
                    <Select value={fees.salaryType} onValueChange={(v) => setFees({ ...fees, salaryType: v })}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DATE_TYPE_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {fees.salaryType === "specific" && (
                      <Input type="number" min="1" max="31" placeholder="Day (1-31)" value={fees.salaryValue} onChange={(e) => setFees({ ...fees, salaryValue: e.target.value })} className="mt-2" />
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-3">
                <p className="text-sm font-semibold text-foreground">Business hours</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-semibold">Office working hours</Label>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Input type="time" className="min-w-[7rem]" value={fees.workingHourStart} onChange={(e) => setFees({ ...fees, workingHourStart: e.target.value })} />
                      <span className="text-xs text-muted-foreground shrink-0">to</span>
                      <Input type="time" className="min-w-[7rem]" value={fees.workingHourEnd} onChange={(e) => setFees({ ...fees, workingHourEnd: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold">Handover hours</Label>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Input type="time" className="min-w-[7rem]" value={fees.handoverHourStart} onChange={(e) => setFees({ ...fees, handoverHourStart: e.target.value })} />
                      <span className="text-xs text-muted-foreground shrink-0">to</span>
                      <Input type="time" className="min-w-[7rem]" value={fees.handoverHourEnd} onChange={(e) => setFees({ ...fees, handoverHourEnd: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Fee Amounts */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Default fee amounts</h4>
              <div className="rounded-lg border border-border/70 bg-muted/15 p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-semibold">Deposit</Label>
                  <Select value={fees.depositType} onValueChange={(v) => setFees({ ...fees, depositType: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEPOSIT_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {fees.depositType === "specific" && (
                    <Input type="number" min="0" placeholder={`Amount (${companyCurrencyCode})`} value={fees.depositValue} onChange={(e) => setFees({ ...fees, depositValue: e.target.value })} className="mt-2" />
                  )}
                </div>
                <div>
                  <Label className="text-xs font-semibold">Agreement Fees ({companyCurrencyCode})</Label>
                  <Input type="number" min="0" value={fees.agreementFees} onChange={(e) => setFees({ ...fees, agreementFees: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Parking Fee ({companyCurrencyCode}/month)</Label>
                  <Input type="number" min="0" value={fees.parking} onChange={(e) => setFees({ ...fees, parking: e.target.value })} className="mt-1" />
                </div>
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold">Default other fees</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() =>
                        setFees({ ...fees, otherFeesRows: [...fees.otherFeesRows, { name: "", amount: "" }] })
                      }
                    >
                      <Plus size={14} />
                      Row
                    </Button>
                  </div>
                  {fees.otherFeesRows.length > 0 ? (
                    <>
                      <div className="flex gap-2 text-xs text-muted-foreground mb-1 px-0.5">
                        <div className="flex-1 min-w-0">Default other fees name</div>
                        <div className="w-28 shrink-0">Default other fees amount ({companyCurrencyCode})</div>
                        <div className="w-9 shrink-0" aria-hidden />
                      </div>
                      <div className="space-y-2">
                        {fees.otherFeesRows.map((row, i) => (
                          <div key={i} className="flex gap-2 items-end">
                            <div className="flex-1 min-w-0">
                              <Input
                                placeholder="e.g. Cleaning fee"
                                value={row.name}
                                onChange={(e) => {
                                  const next = [...fees.otherFeesRows]
                                  next[i] = { ...next[i], name: e.target.value }
                                  setFees({ ...fees, otherFeesRows: next })
                                }}
                              />
                            </div>
                            <div className="w-28 shrink-0">
                              <Input
                                type="number"
                                min="0"
                                value={row.amount}
                                onChange={(e) => {
                                  const next = [...fees.otherFeesRows]
                                  next[i] = { ...next[i], amount: e.target.value }
                                  setFees({ ...fees, otherFeesRows: next })
                                }}
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0"
                              onClick={() =>
                                setFees({ ...fees, otherFeesRows: fees.otherFeesRows.filter((_, j) => j !== i) })
                              }
                              aria-label="Remove row"
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No rows yet. Click Row to add a default name and amount pair.</p>
                  )}
                </div>
              </div>
            </div>
            </div>

            {/* Commission Settings */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Commission</h4>
              <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-5">
              <div>
                <Label className="text-xs font-semibold">Commission release date</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-1">
                  Which day of the month commission is released in your billing cycle (same options as rental invoice). Not the tenant invoice or collection due date.
                </p>
                <Select value={fees.commissionDateType} onValueChange={(v) => setFees({ ...fees, commissionDateType: v })}>
                  <SelectTrigger className="mt-1 max-w-md"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RENTAL_DATE_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {fees.commissionDateType === "specific" && (
                  <Input type="number" min="1" max="31" placeholder="Day (1-31)" value={fees.commissionDateValue} onChange={(e) => setFees({ ...fees, commissionDateValue: e.target.value })} className="mt-2 max-w-md" />
                )}
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Label className="text-xs font-semibold block">Commission Rules (24 months)</Label>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setShowCommissionHintDialog(true)} title="How commission works">
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-4 gap-2 p-3 bg-secondary/50 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    <span>Month</span>
                    <span>Charge On</span>
                    <span>Amount Type</span>
                    <span>Fixed Amount</span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {commissionRules.map((rule, index) => (
                      <div key={index} className="grid grid-cols-4 gap-2 p-2 border-t border-border items-center">
                        <span className="text-sm font-medium">{rule.month} month</span>
                        <Select value={rule.chargeon} onValueChange={(v) => updateCommissionRule(index, "chargeon", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Owner</SelectItem>
                            <SelectItem value="tenant">Tenant</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={rule.amountType} onValueChange={(v) => updateCommissionRule(index, "amountType", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {COMMISSION_AMOUNT_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input 
                          type="number" 
                          min="0" 
                          placeholder={companyCurrencyCode} 
                          value={rule.fixedAmount} 
                          onChange={(e) => updateCommissionRule(index, "fixedAmount", e.target.value)} 
                          className="h-8 text-xs"
                          disabled={rule.amountType !== "specific"}
                          title={rule.amountType === "tenancy_months" ? "Not used for By tenancy length (months)" : undefined}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t px-6 py-4 gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setShowFeesDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSaveFees} disabled={savingFees}>
              {savingFees ? "Saving..." : "Save Fees"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Commission hint / example dialog */}
      <Dialog open={showCommissionHintDialog} onOpenChange={setShowCommissionHintDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Commission Rules – How it works</DialogTitle>
            <DialogDescription>Explanation and example calculation for Amount Type and commission.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm overflow-y-auto max-h-[calc(90vh-8rem)] pr-1">
            <div>
              <p className="font-semibold text-foreground mb-1">Fields</p>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                <li><strong className="text-foreground">Month</strong> – Tenancy month (1–24). Rule applies in that month.</li>
                <li><strong className="text-foreground">Charge On</strong> – Who pays: Owner or Tenant.</li>
                <li><strong className="text-foreground">Amount Type</strong> – How much: multiple of monthly rental (0.5×, 1×, …), <strong className="text-foreground">Specific amount</strong> (fixed {companyCurrencyCode}), or <strong className="text-foreground">Prorate</strong> (by tenancy length in that month).</li>
                <li><strong className="text-foreground">Fixed Amount</strong> – Only when Amount Type is &quot;Specific amount&quot; ({companyCurrencyCode}).</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1">Example</p>
              <p className="text-muted-foreground mb-2">Assume monthly rental = <strong className="text-foreground">{moneyPrefix} 1,500</strong>.</p>
              <div className="rounded-lg bg-muted/60 p-3 font-mono text-xs space-y-1">
                <p>• Month 1, Charge On Tenant, Amount Type <strong>1 month of rental</strong> → Commission = 1 × 1,500 = <strong>{moneyPrefix} 1,500</strong></p>
                <p>• Month 3, Charge On Owner, Amount Type <strong>0.5 month of rental</strong> → Commission = 0.5 × 1,500 = <strong>{moneyPrefix} 750</strong></p>
                <p>• Month 6, Charge On Tenant, Amount Type <strong>Specific amount</strong>, Fixed Amount 200 → Commission = <strong>{moneyPrefix} 200</strong></p>
              </div>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1">Prorate – formula & sample</p>
              <p className="text-muted-foreground mb-2">Commission is split by how many days the tenant actually occupied in that calendar month.</p>
              <p className="text-foreground mb-1 font-medium">Formula:</p>
              <div className="rounded-lg bg-muted/60 p-3 font-mono text-xs mb-2">
                Commission = (Days occupied in month ÷ Days in that month) × Base amount
              </div>
              <p className="text-muted-foreground mb-1"><strong className="text-foreground">Sample:</strong> March has 31 days. Tenant move-in 16 March → occupied 16 days (16–31). Base = 1 month rental = {moneyPrefix} 1,500.</p>
              <div className="rounded-lg bg-muted/60 p-3 font-mono text-xs">
                Commission = (16 ÷ 31) × 1,500 = <strong className="text-foreground">{moneyPrefix} 774.19</strong>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">If move-in is 1 March (full month), (31 ÷ 31) × 1,500 = {moneyPrefix} 1,500. If move-in 25 March (7 days), (7 ÷ 31) × 1,500 = {moneyPrefix} 338.71.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1">Alternative: by tenancy length (months)</p>
              <p className="text-muted-foreground mb-2">Commission = (Monthly rental ÷ 12) × Number of months rented. Same as one month rental spread over 12 months, then × actual tenancy months.</p>
              <p className="text-foreground mb-1 font-medium">Formula:</p>
              <div className="rounded-lg bg-muted/60 p-3 font-mono text-xs mb-2">
                Commission = (Monthly rental ÷ 12) × Tenancy months
              </div>
              <p className="text-muted-foreground mb-1"><strong className="text-foreground">Sample:</strong> Monthly rental {moneyPrefix} 1,500.</p>
              <div className="rounded-lg bg-muted/60 p-3 font-mono text-xs space-y-0.5">
                <p>• Rent 4 months → 1,500 ÷ 12 × 4 = <strong className="text-foreground">{moneyPrefix} 500</strong></p>
                <p>• Rent 5 months → 1,500 ÷ 12 × 5 = <strong className="text-foreground">{moneyPrefix} 625</strong></p>
                <p>• Rent 12 months → 1,500 ÷ 12 × 12 = {moneyPrefix} 1,500</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Staff Dialog */}
      <Dialog
        open={showStaffDialog}
        onOpenChange={(open) => {
          setShowStaffDialog(open)
          if (!open) {
            setSelectedStaffContactId("")
            setStaffContactsForAdd([])
            setLoadingStaffContacts(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingStaff ? "Edit user" : "Add user"}</DialogTitle>
            <DialogDescription>
              {editingStaff
                ? "Update user information and permissions."
                : "Pick a staff contact from Contact Setting (staff list). Name and email come from that record."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editingStaff ? (
              <>
                <div>
                  <Label className="text-xs font-semibold">Name</Label>
                  <Input value={staffForm.name} onChange={(e) => setStaffForm(f => ({ ...f, name: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Email</Label>
                  <Input type="email" value={staffForm.email} onChange={(e) => setStaffForm(f => ({ ...f, email: e.target.value }))} className="mt-1" disabled />
                </div>
              </>
            ) : (
              <div>
                <Label className="text-xs font-semibold">Staff (from Contact)</Label>
                {loadingStaffContacts ? (
                  <p className="text-sm text-muted-foreground mt-2">Loading staff list…</p>
                ) : staffContactsForAdd.length === 0 ? (
                  <p className="text-sm text-muted-foreground mt-2">
                    No staff available, or all are already portal users. Add staff under{" "}
                    <a href="/operator/contact" className="text-primary underline font-medium">
                      Contact Setting
                    </a>{" "}
                    (staff), then return here.
                  </p>
                ) : (
                  <Select
                    value={selectedStaffContactId || undefined}
                    onValueChange={(v) => {
                      setSelectedStaffContactId(v)
                      const row = staffContactsForAdd.find((x) => x.id === v)
                      if (row) {
                        setStaffForm((f) => ({ ...f, name: row.name, email: row.email }))
                      }
                    }}
                  >
                    <SelectTrigger className="mt-1 w-full">
                      <SelectValue placeholder="Select staff…" />
                    </SelectTrigger>
                    <SelectContent>
                      {staffContactsForAdd.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} — {c.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div>
              <Label className="text-xs font-semibold">Permissions</Label>
              {editingStaff && mainAdminEmail && (editingStaff.email || "").trim().toLowerCase() === mainAdminEmail && (
                <p className="text-xs text-muted-foreground mt-1">Master user (company email) – all permissions enabled.</p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                {permKeys.map((key) => {
                  const isEditingMaster = !!editingStaff && !!mainAdminEmail && (editingStaff.email || "").trim().toLowerCase() === mainAdminEmail
                  return (
                    <label key={key} className={`flex items-center gap-2 ${isEditingMaster ? "cursor-default" : "cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={!!staffForm.permission[key] || !!staffForm.permission.admin}
                        onChange={(e) => setStaffForm(f => ({ ...f, permission: { ...f.permission, [key]: e.target.checked } }))}
                        disabled={isEditingMaster}
                      />
                      <span className="text-sm">{key}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStaffDialog(false)}>Cancel</Button>
            <Button
              style={{ background: "var(--brand)" }}
              onClick={handleSaveStaff}
              disabled={
                savingStaff ||
                (!editingStaff && (loadingStaffContacts || !selectedStaffContactId || staffContactsForAdd.length === 0))
              }
            >
              {savingStaff ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Integration Dialog */}
      <Dialog
        open={showIntegrationDialog}
        onOpenChange={(open) => {
          setShowIntegrationDialog(open)
          if (!open) {
            setTtlockConnectStep("choose")
            setIntegrationCreds(c => ({ ...c, username: "", password: "" }))
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedIntegration?.name}</DialogTitle>
            <DialogDescription>
              {selectedIntegration?.category === "accounting" && !selectedIntegration?.connected && "Only one accounting system can be connected at a time."}
              {selectedIntegration?.id === "cleanlemons"
                ? selectedIntegration?.connected
                  ? "Linked with Cleanlemons. Properties and TTLock were applied per your confirmation."
                  : selectedIntegration?.cleanlemonsOauthVerified
                    ? "Allow Coliving to sync data: choose what to share below, then tap Connect now (same idea as OAuth consent after sign-in)."
                    : "Use Continue with Cleanlemons on the integration card to sign in first (like Google OAuth)."
                : selectedIntegration?.id === "ttlock"
                  ? (selectedIntegration?.connected
                      ? "Connected with your company's own TTLock account."
                      : "Register a new TTLock account on the official site, or log in with your existing account.")
                  : selectedIntegration?.id === "cnyiot" && selectedIntegration?.connected
                    ? "Platform meter account (view only). You cannot edit or disconnect."
                    : selectedIntegration?.connected ? "Manage this integration" : "Connect this service"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedIntegration?.id === "cnyiot" && selectedIntegration?.connected ? (
              <div className="p-4 bg-card border border-border rounded-lg space-y-4">
                <p className="text-sm text-foreground">Platform meter account (view only). You cannot edit or disconnect.</p>
              </div>
            ) : selectedIntegration?.connected ? (
              <div className="p-4 bg-card border border-border rounded-lg space-y-4">
                <p className="text-sm text-foreground">Connected</p>
                {selectedIntegration?.id === "ttlock" && (
                  <div className="rounded-lg border p-3 space-y-3 text-sm">
                    <p className="text-muted-foreground">This company is using its own TTLock account.</p>
                    <div>
                      <Label className="text-xs font-semibold">Username</Label>
                      <Input readOnly className="mt-1 bg-muted" value={ttlockViewCreds?.username ?? ""} />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Password</Label>
                      <Input readOnly type="text" className="mt-1 bg-muted" value={ttlockViewCreds?.password ?? ""} />
                    </div>
                  </div>
                )}
                {selectedIntegration?.id === "stripe" && (
                  <div className="rounded-lg border p-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Status</span>
                      <Badge>{stripeStatusLabel}</Badge>
                    </div>
                    {stripeGatewayState.accountId && (
                      <p className="text-muted-foreground break-all">Stripe account ID: {stripeGatewayState.accountId}</p>
                    )}
                    <p className="text-muted-foreground">OAuth connected: {stripeGatewayState.oauthConnected ? "Yes" : "No"}</p>
                    <p className="text-muted-foreground">Webhook handling: platform-managed for Stripe Connect Standard.</p>
                    <p className="text-muted-foreground">Latest webhook: {stripeGatewayState.lastWebhookType || "-"} {stripeGatewayState.lastWebhookAt ? `at ${stripeGatewayState.lastWebhookAt}` : ""}</p>
                  </div>
                )}
                {selectedIntegration?.id === "xendit" && (
                  <div className="rounded-lg border p-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Status</span>
                      <Badge>{xenditStatusLabel}</Badge>
                    </div>
                    <p className="text-muted-foreground">Secret key: {xenditGatewayState.hasSecretKey ? `saved (...${xenditGatewayState.secretKeyLast4 || "****"})` : "not saved"}</p>
                    <p className="text-muted-foreground">Callback token: {xenditGatewayState.hasWebhookToken ? `saved (...${xenditGatewayState.webhookTokenLast4 || "****"})` : "not saved"}</p>
                    <p className="text-muted-foreground break-all">Webhook URL: {xenditGatewayState.webhookUrl || xenditWebhookUrl}</p>
                    <p className="text-muted-foreground">Latest callback: {xenditGatewayState.lastWebhookType || "-"} {xenditGatewayState.lastWebhookAt ? `at ${xenditGatewayState.lastWebhookAt}` : ""}</p>
                  </div>
                )}
                {selectedIntegration?.id === "billplz" && (
                  <div className="rounded-lg border p-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Status</span>
                      <Badge>{billplzStatusLabel}</Badge>
                    </div>
                    <p className="text-muted-foreground">API key: {billplzGatewayState.hasApiKey ? `saved (...${billplzGatewayState.apiKeyLast4 || "****"})` : "not saved"}</p>
                    <p className="text-muted-foreground">Collection ID: {billplzGatewayState.collectionId || "not saved"}</p>
                    <p className="text-muted-foreground">X Signature key: {billplzGatewayState.hasXSignatureKey ? `saved (...${billplzGatewayState.xSignatureKeyLast4 || "****"})` : "not saved"}</p>
                    <p className="text-muted-foreground break-all">Webhook URL: {billplzGatewayState.webhookUrl || billplzWebhookUrl}</p>
                    <p className="text-muted-foreground">Latest callback: {billplzGatewayState.lastWebhookType || "-"} {billplzGatewayState.lastWebhookAt ? `at ${billplzGatewayState.lastWebhookAt}` : ""}</p>
                  </div>
                )}
                {isSgdCompany && selectedIntegration?.id === "stripe" && (
                  <div className="space-y-3 border rounded-lg p-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sgPaynowEnabledWithGateway}
                        onChange={(e) => setSgPaynowEnabledWithGateway(e.target.checked)}
                        className="accent-primary"
                      />
                      <span className="text-sm">Allow PayNow together with Stripe</span>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Checked = tenant can use <strong>Stripe + PayNow</strong>. Unchecked = <strong>Stripe only</strong>.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={!canEditIntegration || !!integrationAction}
                      onClick={async () => {
                        setIntegrationAction("stripe-paynow-mode")
                        try {
                          const r = await savePaymentGatewayMode(sgPaynowEnabledWithGateway ? "paynow_plus_stripe" : "stripe_only")
                          if (r?.ok === false) {
                            setError(r?.reason || "Save failed")
                            return
                          }
                          loadData()
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Save failed")
                        } finally {
                          setIntegrationAction(null)
                        }
                      }}
                    >
                      {integrationAction === "stripe-paynow-mode" ? "Saving..." : "Save payment mode"}
                    </Button>
                  </div>
                )}
                {selectedIntegration?.category === "accounting" && ["bukku", "xero"].includes(selectedIntegration?.id ?? "") && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!integrationCreds.einvoice}
                      onChange={async (e) => {
                        const checked = e.target.checked
                        setIntegrationCreds(c => ({ ...c, einvoice: checked ? "1" : "" }))
                        setAccountingEinvoice(checked)
                        try {
                          const r = await updateAccountingEinvoice({ provider: selectedIntegration.id!, einvoice: checked })
                          if (r?.ok === false) setError(r?.reason || "Update failed")
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Update failed")
                        }
                      }}
                      className="accent-primary"
                    />
                    <span className="text-sm">Enable E-Invoice</span>
                  </label>
                )}
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => selectedIntegration && handleDisconnect(selectedIntegration.id)}
                  disabled={!canEditIntegration || !!integrationAction}
                >
                  {integrationAction === selectedIntegration?.id ? "Disconnecting..." : "Disconnect"}
                </Button>
              </div>
            ) : (
              <div className="p-4 bg-card border border-border rounded-lg space-y-3">
                {selectedIntegration?.id === "cnyiot" && (
                  <p className="text-sm text-muted-foreground">Use the platform meter account. Click Connect to create a meter sub-account for your company (no credentials needed).</p>
                )}
                {selectedIntegration?.id === "cleanlemons" && (
                  <div className="space-y-4">
                    {!selectedIntegration.cleanlemonsOauthVerified ? (
                      <p className="text-sm text-muted-foreground">
                        Use <strong>Continue with Cleanlemons</strong> on the integration card — a Cleanlemons window opens; you stay on this Company page. Sign in there, then allow access (same order as Google OAuth).
                      </p>
                    ) : (
                      <>
                        <p className="text-sm text-green-700 dark:text-green-400">
                          Cleanlemons account connected. Choose what Coliving may sync, then tap Connect now.
                        </p>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-primary mt-1"
                            checked={cleanlemonsExport}
                            onChange={(e) => setCleanlemonsExport(e.target.checked)}
                          />
                          <span className="text-sm">Export properties to Cleanlemons (entire unit + each room row)</span>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-primary mt-1"
                            checked={cleanlemonsTtlock}
                            onChange={(e) => setCleanlemonsTtlock(e.target.checked)}
                          />
                          <span className="text-sm">
                            Optional: copy TTLock login from this Coliving company to Cleanlemons (only if TTLock is connected here). If TTLock is already connected on Cleanlemons, you can choose to disconnect it there and use this company&apos;s credentials instead.
                          </span>
                        </label>
                        <Button
                          type="button"
                          style={{ background: "var(--brand)" }}
                          className="w-full"
                          disabled={
                            !canEditIntegration ||
                            cleanlemonsConfirming ||
                            !!integrationAction ||
                            !cleanlemonsExport
                          }
                          onClick={() => void confirmCleanlemonsLinkFlow(false)}
                        >
                          {cleanlemonsConfirming ? "Connecting…" : "Connect now!"}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          To abandon linking and clear the pending Cleanlemons sign-in on Coliving, use Disconnect below.
                        </p>
                        <Button
                          type="button"
                          variant="destructive"
                          className="w-full"
                          disabled={!canEditIntegration || cleanlemonsConfirming || !!integrationAction}
                          onClick={() => void handleDisconnect("cleanlemons")}
                        >
                          {integrationAction === "cleanlemons" ? "Disconnecting…" : "Disconnect"}
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {selectedIntegration?.id === "ttlock" && (
                  <>
                    {ttlockConnectStep === "choose" ? (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Use your company&apos;s own TTLock account. If you do not have one yet, register on the official TTLock page first, then come back here to log in.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => window.open("https://lock2.ttlock.com/", "_blank", "noopener,noreferrer")}
                        >
                          Register new account
                        </Button>
                        <Button
                          type="button"
                          style={{ background: "var(--brand)" }}
                          className="w-full"
                          onClick={() => setTtlockConnectStep("existing")}
                        >
                          Log in existing account
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Enter the TTLock username and password for this operator account. We will verify it immediately and save the token for future API calls.
                        </p>
                        <div>
                          <Label className="text-xs font-semibold">TTLock Username</Label>
                          <Input
                            placeholder="Enter TTLock username"
                            value={integrationCreds.username || ""}
                            onChange={(e) => setIntegrationCreds(c => ({ ...c, username: e.target.value }))}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">TTLock Password</Label>
                          <Input
                            type="password"
                            placeholder="Enter TTLock password"
                            value={integrationCreds.password || ""}
                            onChange={(e) => setIntegrationCreds(c => ({ ...c, password: e.target.value }))}
                            className="mt-1"
                          />
                        </div>
                        <Button type="button" variant="outline" className="w-full" onClick={() => setTtlockConnectStep("choose")}>
                          Back
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {(selectedIntegration?.id === "bukku") && (
                  <>
                    <div>
                      <Label className="text-xs font-semibold">Token</Label>
                      <Input placeholder="Token" value={integrationCreds.token || ""} onChange={(e) => setIntegrationCreds(c => ({ ...c, token: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Subdomain</Label>
                      <Input placeholder="Subdomain" value={integrationCreds.subdomain || ""} onChange={(e) => setIntegrationCreds(c => ({ ...c, subdomain: e.target.value }))} className="mt-1" />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!integrationCreds.einvoice}
                        onChange={async (e) => {
                          const checked = e.target.checked
                          setIntegrationCreds(c => ({ ...c, einvoice: checked ? "1" : "" }))
                          setAccountingEinvoice(checked)
                          try {
                            const r = await updateAccountingEinvoice({ provider: "bukku", einvoice: checked })
                            if (r?.ok === false) setError(r?.reason || "Update failed")
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Update failed")
                          }
                        }}
                        className="accent-primary"
                      />
                      <span className="text-sm">Enable E-Invoice</span>
                    </label>
                  </>
                )}
                {(selectedIntegration?.id === "xendit") && (
                  <>
                    <p className="text-sm text-muted-foreground">Operators can be in Singapore or Malaysia. Xendit supports both SGD and MYR. One payment gateway per company. Current model: <strong>Xendit direct</strong>. Operator uses their own Xendit account, secret key, and callback token.</p>
                    {payexPlatformMode ? (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Legacy platform-mode data detected. Current recommended model is <strong>Xendit direct</strong>; only use Sub-account ID here if you are maintaining an older XenPlatform setup.
                        </p>
                        <div>
                          <Label className="text-xs font-semibold">Sub-account ID (optional)</Label>
                          <Input
                            placeholder="Paste your Sub-account ID"
                            value={integrationCreds.xendit_sub_account_id || ""}
                            onChange={(e) => setIntegrationCreds(c => ({ ...c, xendit_sub_account_id: e.target.value }))}
                            className="mt-1"
                          />
                        </div>
                        {!payexHasSubAccount && (
                          <p className="text-sm text-muted-foreground mt-2">
                            No Sub-account ID found for this legacy setup.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Direct mode: paste the operator's own Xendit secret keys below. No platform sub-account is required.
                        </p>
                        <div>
                          <Label className="text-xs font-semibold">Sub-account ID (optional)</Label>
                          <Input
                            placeholder="Sub-account ID"
                            value={integrationCreds.xendit_sub_account_id || ""}
                            onChange={(e) => setIntegrationCreds(c => ({ ...c, xendit_sub_account_id: e.target.value }))}
                            disabled={payexHasSubAccount}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Xendit Secret Key (Test)</Label>
                          <Input type="password" placeholder="xnd_development_..." value={integrationCreds.xendit_test_secret_key || ""} onChange={(e) => setIntegrationCreds(c => ({ ...c, xendit_test_secret_key: e.target.value }))} className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Xendit Secret Key (Live)</Label>
                          <Input type="password" placeholder="xnd_production_..." value={integrationCreds.xendit_live_secret_key || ""} onChange={(e) => setIntegrationCreds(c => ({ ...c, xendit_live_secret_key: e.target.value }))} className="mt-1" />
                        </div>
                      </>
                    )}
                  </>
                )}
                {(selectedIntegration?.id === "stripe" || selectedIntegration?.id === "xero") && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {selectedIntegration.id === "stripe" ? "Click below to connect your Stripe account via OAuth." : "Click below to authorize access to Xero via OAuth."}
                    </p>
                    {selectedIntegration?.id === "xero" && selectedIntegration?.category === "accounting" && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!integrationCreds.einvoice}
                          onChange={async (e) => {
                            const checked = e.target.checked
                            setIntegrationCreds(c => ({ ...c, einvoice: checked ? "1" : "" }))
                            setAccountingEinvoice(checked)
                            try {
                              const r = await updateAccountingEinvoice({ provider: "xero", einvoice: checked })
                              if (r?.ok === false) setError(r?.reason || "Update failed")
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Update failed")
                            }
                          }}
                          className="accent-primary"
                        />
                        <span className="text-sm">Enable E-Invoice</span>
                      </label>
                    )}
                  </>
                )}
                {(selectedIntegration?.id !== "ttlock" || ttlockConnectStep === "existing") &&
                  /* Cleanlemons uses Connect now! in the body, not this generic footer */
                  selectedIntegration?.id !== "cleanlemons" && (
                  <Button
                    style={{ background: "var(--brand)" }}
                    className="w-full"
                    onClick={() => selectedIntegration && handleConnect(selectedIntegration.id)}
                    disabled={
                      !canEditIntegration ||
                      !!integrationAction ||
                      (selectedIntegration?.id === "ttlock" && (!integrationCreds.username?.trim() || !integrationCreds.password)) ||
                      (selectedIntegration?.id === "xendit" && payexPlatformMode
                        ? !integrationCreds.xendit_sub_account_id?.trim() && !payexHasSubAccount
                        : (selectedIntegration?.id === "xendit" && !integrationCreds.xendit_test_secret_key && !integrationCreds.xendit_live_secret_key))
                    }
                  >
                    {integrationAction ? "Connecting..." : `Connect ${selectedIntegration?.name}`}
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cleanlemonsTtlockReplaceOpen} onOpenChange={setCleanlemonsTtlockReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>TTLock already connected on Cleanlemons</AlertDialogTitle>
            <AlertDialogDescription>
              This Cleanlemons account already has TTLock set up. To finish linking from Coliving, we can disconnect TTLock on Cleanlemons and connect using this Coliving company&apos;s TTLock login instead. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleanlemonsConfirming}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={cleanlemonsConfirming}
              onClick={(e) => {
                e.preventDefault()
                void confirmCleanlemonsLinkFlow(true)
              }}
            >
              {cleanlemonsConfirming ? "Connecting…" : "Disconnect on Cleanlemons & use Coliving TTLock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AI Agent Dialog */}
      <Dialog open={showAiProviderDialog} onOpenChange={setShowAiProviderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI Agent</DialogTitle>
            <DialogDescription>Choose provider for receipt OCR and payment matching. Use your own API key; the platform does not pay for AI usage.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-semibold">Provider</Label>
              <Select value={aiProviderDraft.provider || "none"} onValueChange={(v) => setAiProviderDraft(d => ({ ...d, provider: v === "none" ? "" : v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  <SelectItem value="deepseek">DeepSeek</SelectItem>
                  <SelectItem value="openai">ChatGPT (OpenAI)</SelectItem>
                  <SelectItem value="gemini">Google Gemini</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">API Key (optional – leave blank to keep existing)</Label>
              <Input
                type={aiProviderEditingKey ? "password" : "text"}
                name="ai_api_key"
                autoComplete="new-password"
                data-lpignore="true"
                data-form-type="other"
                placeholder="Your API key"
                value={
                  aiProviderEditingKey
                    ? aiProviderDraft.api_key
                    : (aiProviderHasApiKey && !aiProviderDraft.api_key && aiProviderApiKeyLast4
                      ? `************${aiProviderApiKeyLast4}`
                      : aiProviderDraft.api_key)
                }
                onFocus={() => {
                  if (!aiProviderEditingKey) {
                    setAiProviderEditingKey(true)
                    setAiProviderDraft(d => ({ ...d, api_key: "" }))
                  }
                }}
                onBlur={() => {
                  if (!aiProviderDraft.api_key) setAiProviderEditingKey(false)
                }}
                onChange={(e) => setAiProviderDraft(d => ({ ...d, api_key: e.target.value }))}
                className={`mt-1 ${(!aiProviderEditingKey && aiProviderHasApiKey && !aiProviderDraft.api_key) ? "font-mono leading-tight tracking-wide" : ""}`}
              />
            </div>
            <Button
              type="button"
              className="w-full"
              style={{ background: "var(--brand)" }}
              disabled={savingAiProvider}
              onClick={async () => {
                const providerToSave = String(aiProviderDraft.provider || aiProvider || "").trim().toLowerCase()
                if (!providerToSave) {
                  setError("Please select AI provider")
                  return
                }
                setSavingAiProvider(true)
                try {
                  const payload = {
                    provider: providerToSave,
                    ...(aiProviderDraft.api_key ? { api_key: aiProviderDraft.api_key } : {}),
                  }
                  const r = await saveAiProviderConfig(payload)
                  if (r?.ok) {
                    const latest = await getAiProviderConfig().catch(() => null)
                    setAiProvider(providerToSave)
                    setAiProviderHasApiKey(!!latest?.hasApiKey || !!aiProviderDraft.api_key || aiProviderHasApiKey)
                    setAiProviderApiKeyLast4(String(latest?.apiKeyLast4 || ""))
                    setAiProviderApiKeyHash(String(latest?.apiKeyHash || ""))
                    setShowAiProviderDialog(false)
                    loadData()
                  } else setError(r?.reason || "Save failed")
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Save failed")
                } finally {
                  setSavingAiProvider(false)
                }
              }}
            >
              {savingAiProvider ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
