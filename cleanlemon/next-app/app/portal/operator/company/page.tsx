"use client"

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Building2,
  BookOpen,
  Bot,
  CheckCircle,
  CheckCircle2,
  DollarSign,
  HardDrive,
  Shield,
  Sparkles,
  Check,
  Crown,
  Settings,
  XCircle,
  Zap,
  Upload,
  AlertTriangle,
  X,
  ExternalLink,
  Lock,
  ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { OPERATOR_SCHEDULE_AI_DISPLAY_NAME } from '@/lib/cleanlemon-operator-ai-brand'
import {
  PRICING_PLANS,
  CLN_ADDON_CATALOG_FALLBACK,
  getSubscriptionPlanFeatureSegments,
  type PricingPlan,
} from '@/lib/types'
import { useAuth } from '@/lib/auth-context'
import {
  fetchOperatorSettings,
  saveOperatorSettings,
  fetchOperatorSubscription,
  fetchOperatorSaasBillingHistory,
  type OperatorSaasBillingRow,
  fetchClnPricingPlans,
  fetchClmAddonCatalog,
  fetchAddonProrationQuote,
  postAddonCheckoutSession,
  postSubscriptionCheckoutSession,
  postCleanlemonBukkuConnect,
  fetchCleanlemonBukkuCredentials,
  postCleanlemonBukkuDisconnect,
  fetchCleanlemonXeroAuthUrl,
  postCleanlemonXeroConnect,
  postCleanlemonXeroDisconnect,
  postCleanlemonGoogleDriveOAuthUrl,
  postCleanlemonGoogleDriveDisconnect,
  postCleanlemonStripeConnectOAuthUrl,
  postCleanlemonStripeConnectDisconnect,
  postClnOperatorClientInvoiceXenditCredentials,
  postClnOperatorClientInvoiceXenditDisconnect,
  postCleanlemonAiAgentConnect,
  postCleanlemonAiAgentDisconnect,
  fetchEmployeeBanks,
  uploadEmployeeFileToOss,
  fetchOperatorTtlockCredentials,
  fetchOperatorTtlockOnboardStatus,
  postOperatorTtlockConnect,
  postOperatorTtlockDisconnect,
  type OperatorTtlockAccountRow,
  fetchOperatorPortalSetupStatus,
  type ClmAddonCatalogItem,
  type OperatorPortalSetupStatus,
  getClnOperatorCompanyEmailChangeStatus,
  requestClnOperatorCompanyEmailChange,
  confirmClnOperatorCompanyEmailChange,
  cancelClnOperatorCompanyEmailChange,
  getPublicCleanlemonOperatorProfile,
} from '@/lib/cleanlemon-api'
import { useRouter } from 'next/navigation'
import { canonicalOperatorPlanCode, planAllowsAccounting } from '@/lib/cleanlemon-subscription-plan'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

function uiPlanToApiPlan(p: PricingPlan): string {
  if (p === 'basic') return 'starter'
  if (p === 'grow') return 'growth'
  return 'enterprise'
}

function apiPlanToUiPlan(code: string | undefined): PricingPlan {
  const c = canonicalOperatorPlanCode(code)
  if (c === 'starter') return 'basic'
  if (c === 'growth') return 'grow'
  if (c === 'enterprise') return 'enterprise'
  /** Unknown / legacy codes: default to Starter — do not assume Enterprise (breaks subscription gates). */
  return 'basic'
}

function planRankUi(p: PricingPlan): number {
  if (p === 'basic') return 0
  if (p === 'grow') return 1
  return 2
}

/** Labels aligned with `/pricing` (Starter / Growth / Enterprise). */
function pricingTierDisplayName(plan: PricingPlan): string {
  if (plan === 'basic') return 'Starter'
  if (plan === 'grow') return 'Growth'
  return 'Enterprise'
}

function apiPlanCodeToDisplayName(code: string | undefined): string {
  return pricingTierDisplayName(apiPlanToUiPlan(code))
}

/**
 * Public URL for this page (Next rewrites serve `/operator/...`; some links use `/portal/operator/...`).
 * OAuth redirect_uri must match the browser path exactly and what is registered in Xero / Stripe.
 */
function getOperatorCompanyPathname(): string {
  if (typeof window === 'undefined') return '/operator/company'
  let p = window.location.pathname || '/operator/company'
  if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1)
  return p
}

function getOperatorCompanyBaseUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${getOperatorCompanyPathname()}`
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function looksLikeBankdetailId(s: string): boolean {
  return UUID_RE.test(String(s || '').trim())
}

/** Every 15 minutes, 00:00–23:45 — for company time dropdowns */
const QUARTER_HOUR_TIME_SLOTS: string[] = (() => {
  const out: string[] = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return out
})()

/** End-of-day option for “through midnight” (e.g. out-of-hours to 24:00) */
const TIME_END_OF_DAY = '24:00'

const TIME_SELECT_NONE = '__none__'


/** Normalize to HH:mm for dropdown matching (strips seconds if present). `24:00` = end of day. */
function normalizeTimeHHMM(raw: string): string {
  const t = String(raw || '').trim()
  if (!t) return ''
  if (t === '24:00' || t === '24' || /^24:00(?::00)?$/i.test(t)) return '24:00'
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t)
  if (!m) return ''
  let h = parseInt(m[1], 10)
  let min = parseInt(m[2], 10)
  if (!Number.isFinite(h) || !Number.isFinite(min)) return ''
  h = Math.max(0, Math.min(23, h))
  min = Math.max(0, Math.min(59, min))
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function numToDisplayStr(v: unknown): string {
  if (v === undefined || v === null || v === '') return ''
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? String(n) : ''
}

/** Read surcharge mode + single value line from `companyProfile` (legacy: percent-only). */
function parseOutOfWorkingHourMarkupFromProfile(raw: Record<string, unknown>): {
  mode: 'percentage' | 'fixed_amount'
  valueStr: string
} {
  const modeRaw =
    raw.outOfWorkingHourMarkupMode ??
    raw.out_of_working_hour_markup_mode ??
    raw.outOfWorkingHourMarkupKind
  const fixedRaw =
    raw.outOfWorkingHourMarkupFixedMyr ??
    raw.out_of_working_hour_markup_fixed_myr ??
    raw.outOfWorkingHourMarkupFixedAmount
  const pctRaw = raw.outOfWorkingHourMarkupPercent ?? raw.out_of_working_hour_markup_percent

  const m = String(modeRaw || '')
    .trim()
    .toLowerCase()
  let mode: 'percentage' | 'fixed_amount' = 'percentage'
  if (m === 'fixed_amount' || m === 'fixed') mode = 'fixed_amount'
  else if (m === 'percentage' || m === 'percent') mode = 'percentage'
  else if (!m) {
    const fs = numToDisplayStr(fixedRaw)
    const ps = numToDisplayStr(pctRaw)
    if (fs && !ps) mode = 'fixed_amount'
    else mode = 'percentage'
  }

  if (mode === 'fixed_amount') {
    return { mode, valueStr: numToDisplayStr(fixedRaw) }
  }
  return { mode: 'percentage', valueStr: numToDisplayStr(pctRaw) }
}

function parseHMToMinutes(s: string): number | null {
  const n = normalizeTimeHHMM(s)
  if (!n) return null
  if (n === '24:00') return 1440
  const [h, mm] = n.split(':').map((x) => parseInt(x, 10))
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null
  return h * 60 + mm
}

/** Half-open [start, end) in minutes on one civil day, end ≤ 1440 */
function intersectHalfOpen(a: [number, number], b: [number, number]): [number, number] | null {
  const s = Math.max(a[0], b[0])
  const e = Math.min(a[1], b[1])
  if (s >= e) return null
  return [s, e]
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((x, y) => x[0] - y[0])
  const out: [number, number][] = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (!last || iv[0] > last[1]) {
      out.push([iv[0], iv[1]])
    } else {
      last[1] = Math.max(last[1], iv[1])
    }
  }
  return out
}

function formatMinuteClock(m: number): string {
  if (m >= 1440) return '24:00'
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function formatIntervalRangeMm([s, e]: [number, number]): string {
  return `${formatMinuteClock(s)}–${formatMinuteClock(e)}`
}

/**
 * Where surcharge applies: (times not in working hours) ∩ out-of-hours window.
 * Same-day and overnight windows supported.
 */
function computeSurchargeApplySegments(
  workingFrom: string,
  workingTo: string,
  oohFrom: string,
  oohTo: string
): [number, number][] {
  const wS = parseHMToMinutes(workingFrom)
  const wE = parseHMToMinutes(workingTo)
  const oS = parseHMToMinutes(oohFrom)
  const oE = parseHMToMinutes(oohTo)
  if (wS === null || wE === null || oS === null || oE === null) return []

  let outside: [number, number][]
  if (wS < wE) {
    outside = [
      [0, wS],
      [wE, 1440],
    ]
  } else if (wS > wE) {
    outside = [[wE, wS]]
  } else {
    outside = [[0, 1440]]
  }

  let ooh: [number, number][]
  if (oS < oE) {
    ooh = [[oS, oE]]
  } else if (oS > oE) {
    ooh = [
      [oS, 1440],
      [0, oE],
    ]
  } else {
    return []
  }

  const raw: [number, number][] = []
  for (const o of outside) {
    for (const h of ooh) {
      const x = intersectHalfOpen(o, h)
      if (x) raw.push(x)
    }
  }
  return mergeIntervals(raw)
}

/** Mirrors `clnCompanyProfileCompleteForAutomation` + public subdomain rules in `cleanlemon.service.js` (setup gate). */
const COMPANY_GATE_FIELD_KEYS = ['companyName', 'ssmNumber', 'address', 'contact', 'subdomain'] as const
/** Radix Select must stay controlled; empty bank uses sentinel (not `undefined`). */
const BANK_SELECT_NONE = '__no_bank__'

/** Placeholder shown in inputs when a value exists on server (full secrets are never returned). */
function clnXenditSavedValueDisplay(last4: string): string {
  const s = String(last4 || '').trim()
  return `${'•'.repeat(16)}${s}`
}

type CompanyGateFieldKey = (typeof COMPANY_GATE_FIELD_KEYS)[number]

function companySetupMissingFieldKeys(ci: {
  companyName: string
  ssmNumber: string
  address: string
  contact: string
  subdomain: string
}): CompanyGateFieldKey[] {
  const keys: CompanyGateFieldKey[] = []
  if (!String(ci.companyName || '').trim()) keys.push('companyName')
  if (!String(ci.ssmNumber || '').trim()) keys.push('ssmNumber')
  if (!String(ci.address || '').trim()) keys.push('address')
  if (!String(ci.contact || '').trim()) keys.push('contact')
  const sub = String(ci.subdomain || '').trim().toLowerCase()
  if (!sub) keys.push('subdomain')
  else if (sub.length > 64) keys.push('subdomain')
  else if (!/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(sub)) keys.push('subdomain')
  return keys
}

function companyGateFieldClass(missing: CompanyGateFieldKey[], key: CompanyGateFieldKey): string {
  return missing.includes(key) ? 'rounded-md p-1 ring-2 ring-destructive ring-offset-2 ring-offset-background' : ''
}

function QuarterHourTimeSelect({
  id,
  label,
  description,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  description?: ReactNode
  value: string
  onChange: (next: string) => void
  options: readonly string[]
}) {
  const norm = normalizeTimeHHMM(value)
  const radixValue = norm === '' ? TIME_SELECT_NONE : norm
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      <Select
        value={radixValue}
        onValueChange={(next) =>
          onChange(next === TIME_SELECT_NONE ? '' : next === TIME_END_OF_DAY ? TIME_END_OF_DAY : next)
        }
      >
        <SelectTrigger id={id} className="h-10 w-full">
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent className="max-h-[min(60vh,20rem)]">
          <SelectItem value={TIME_SELECT_NONE}>Not set</SelectItem>
          {options.map((t) => (
            <SelectItem key={t} value={t}>
              {t === TIME_END_OF_DAY ? '24:00 (end of day)' : t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export default function CompanyPage() {
  const router = useRouter()
  const { user } = useAuth()
  const operatorId = String(user?.operatorId || '').trim()
  /** Public API base (same as portal → Node). Xendit Dashboard must reach this host. */
  const clnXenditWebhookUrl = useMemo(() => {
    const base = (process.env.NEXT_PUBLIC_CLEANLEMON_API_URL || '').trim().replace(/\/$/, '')
    if (!base || !operatorId) return ''
    return `${base}/api/cleanlemon/client/invoices/xendit-webhook?operator_id=${encodeURIComponent(operatorId)}`
  }, [operatorId])
  const [activeTab, setActiveTab] = useState('profile')
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'quarterly' | 'yearly'>('yearly')
  const [companyInfo, setCompanyInfo] = useState({
    country: 'Malaysia',
    companyName: '',
    ssmNumber: '',
    subdomain: '',
    tin: '',
    address: '',
    contact: '',
    /** Local working hours (HH:mm, 24h); stored in `companyProfile` JSON */
    workingHourFrom: '',
    workingHourTo: '',
    /** Bookings/visits outside normal hours (stored in `companyProfile` JSON) */
    outOfWorkingHourFrom: '',
    outOfWorkingHourTo: '',
    /** `percentage` = `outOfWorkingHourMarkupPercent`; `fixed_amount` = `outOfWorkingHourMarkupFixedMyr` */
    outOfWorkingHourMarkupMode: 'percentage' as 'percentage' | 'fixed_amount',
    outOfWorkingHourMarkupValue: '',
    /** FK → MySQL `bankdetail.id` */
    bankdetailId: '',
    /** Legacy free-text bank label; used once to match dropdown after banks load */
    bank: '',
    accountNumber: '',
    accountHolder: '',
    logoUrl: '',
    chopUrl: '',
  })
  const [bankOptions, setBankOptions] = useState<Array<{ id: string; name: string }>>([])
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingChop, setUploadingChop] = useState(false)
  const [clnCompanyEmailDisplay, setClnCompanyEmailDisplay] = useState('')
  const [clnCanChangeCompanyEmail, setClnCanChangeCompanyEmail] = useState(false)
  const [clnCompanyEmailPending, setClnCompanyEmailPending] = useState<{
    newEmail: string
    status: string
    tacExpiresAt: string | null
    effectiveAt: string | null
  } | null>(null)
  const [clnCompanyEmailDialogOpen, setClnCompanyEmailDialogOpen] = useState(false)
  const [clnCompanyEmailNew, setClnCompanyEmailNew] = useState('')
  const [clnCompanyEmailCode, setClnCompanyEmailCode] = useState('')
  const [clnCompanyEmailStep, setClnCompanyEmailStep] = useState<'enter' | 'code' | 'done'>('enter')
  const [clnCompanyEmailBusy, setClnCompanyEmailBusy] = useState(false)
  const [clnCompanyEmailDoneEffectiveAt, setClnCompanyEmailDoneEffectiveAt] = useState<string | null>(null)
  const [clnCompanyEmailCancelOpen, setClnCompanyEmailCancelOpen] = useState(false)
  const [clnCompanyEmailCancelBusy, setClnCompanyEmailCancelBusy] = useState(false)
  const [integrationState, setIntegrationState] = useState({
    stripe: false,
    xendit: false,
    bukku: false,
    xero: false,
    ai: false,
    googleDrive: false,
    ttlock: false,
  })
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [showAccountingDialog, setShowAccountingDialog] = useState(false)
  const [showBukkuDialog, setShowBukkuDialog] = useState(false)
  const [bukkuToken, setBukkuToken] = useState('')
  const [bukkuSubdomain, setBukkuSubdomain] = useState('')
  const [bukkuSaving, setBukkuSaving] = useState(false)
  const [showAiProviderDialog, setShowAiProviderDialog] = useState(false)
  const [showAiApiKeyDialog, setShowAiApiKeyDialog] = useState(false)
  const [showTtlockDialog, setShowTtlockDialog] = useState(false)
  /** `manage` = connected (readonly creds); `choose` / `existing` = connect flow (same as Coliving company + client portal). */
  const [ttlockStep, setTtlockStep] = useState<'manage' | 'choose' | 'existing'>('choose')
  const [ttlockFormUser, setTtlockFormUser] = useState('')
  const [ttlockFormPass, setTtlockFormPass] = useState('')
  const [ttlockViewCreds, setTtlockViewCreds] = useState<{ username: string; password: string } | null>(null)
  const [ttlockBusy, setTtlockBusy] = useState(false)
  const [ttlockAccounts, setTtlockAccounts] = useState<OperatorTtlockAccountRow[]>([])
  const [manageSlot, setManageSlot] = useState<number | null>(null)
  const [ttlockAccountName, setTtlockAccountName] = useState('')
  const [selectedPaymentProvider, setSelectedPaymentProvider] = useState<'stripe' | 'xendit'>('stripe')
  /** Coliving-style: choose → Xendit form; Stripe manage = disconnect inside dialog only. */
  const [paymentGatewayStep, setPaymentGatewayStep] = useState<'choose' | 'xendit-form' | 'stripe-manage'>('choose')
  const [xenditGatewayState, setXenditGatewayState] = useState({
    connectionStatus: 'no_connect',
    hasSecretKey: false,
    hasWebhookToken: false,
    secretKeyLast4: '',
    webhookTokenLast4: '',
    lastWebhookAt: null as string | null,
    lastWebhookType: null as string | null,
  })
  const [xenditSecretInput, setXenditSecretInput] = useState('')
  const [xenditCallbackTokenInput, setXenditCallbackTokenInput] = useState('')
  const [xenditCredentialBusy, setXenditCredentialBusy] = useState(false)
  const primeXenditCredentialInputs = useCallback(() => {
    setXenditSecretInput(
      xenditGatewayState.hasSecretKey ? clnXenditSavedValueDisplay(xenditGatewayState.secretKeyLast4) : ''
    )
    setXenditCallbackTokenInput(
      xenditGatewayState.hasWebhookToken ? clnXenditSavedValueDisplay(xenditGatewayState.webhookTokenLast4) : ''
    )
  }, [
    xenditGatewayState.hasSecretKey,
    xenditGatewayState.hasWebhookToken,
    xenditGatewayState.secretKeyLast4,
    xenditGatewayState.webhookTokenLast4,
  ])
  const xenditCredentialsSaveEnabled = useMemo(() => {
    if (!clnXenditWebhookUrl) return false
    const maskSk = clnXenditSavedValueDisplay(xenditGatewayState.secretKeyLast4)
    const maskTok = clnXenditSavedValueDisplay(xenditGatewayState.webhookTokenLast4)
    const skTrim = xenditSecretInput.trim()
    const tokTrim = xenditCallbackTokenInput.trim()
    const keepSk = xenditGatewayState.hasSecretKey && (!skTrim || skTrim === maskSk)
    const keepTok = xenditGatewayState.hasWebhookToken && (!tokTrim || tokTrim === maskTok)
    const skOk =
      xenditGatewayState.hasSecretKey
        ? keepSk || (!!skTrim && skTrim !== maskSk)
        : !!skTrim
    const tokOk =
      xenditGatewayState.hasWebhookToken
        ? keepTok || (!!tokTrim && tokTrim !== maskTok)
        : !!tokTrim
    return skOk && tokOk
  }, [
    clnXenditWebhookUrl,
    xenditSecretInput,
    xenditCallbackTokenInput,
    xenditGatewayState.hasSecretKey,
    xenditGatewayState.hasWebhookToken,
    xenditGatewayState.secretKeyLast4,
    xenditGatewayState.webhookTokenLast4,
  ])
  /** When true, Xendit "Back" closes dialog (opened from Manage); when false, returns to provider chooser. */
  const [paymentGatewayFromManage, setPaymentGatewayFromManage] = useState(false)
  const [selectedAccountingProvider, setSelectedAccountingProvider] = useState<'bukku' | 'xero'>('bukku')
  const [selectedAiProvider, setSelectedAiProvider] = useState<'openai' | 'deepseek' | 'gemini'>('openai')
  const [aiProviderConnected, setAiProviderConnected] = useState<'openai' | 'deepseek' | 'gemini' | null>(null)
  const [aiApiKeyInput, setAiApiKeyInput] = useState('')
  const [aiApiKeySet, setAiApiKeySet] = useState(false)
  const [saasBillingHistory, setSaasBillingHistory] = useState<OperatorSaasBillingRow[]>([])
  const [saasBillingLoading, setSaasBillingLoading] = useState(false)
  const [subscriptionItem, setSubscriptionItem] = useState<any>(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [portalSetupGate, setPortalSetupGate] = useState<OperatorPortalSetupStatus | null>(null)
  const [publicReviewSummary, setPublicReviewSummary] = useState<{ avg: number | null; count: number } | null>(null)
  const [checkoutBusyKey, setCheckoutBusyKey] = useState<string | null>(null)
  const [clnPlanAmounts, setClnPlanAmounts] = useState<Record<
    string,
    { month: number; quarter: number; year: number }
  > | null>(null)
  const [addonCatalog, setAddonCatalog] = useState<ClmAddonCatalogItem[]>(
    () => CLN_ADDON_CATALOG_FALLBACK as unknown as ClmAddonCatalogItem[]
  )
  const [addonQuotes, setAddonQuotes] = useState<
    Record<string, { amountDueMyr?: number; yearlyAmountMyr?: number; daysRemaining?: number; reason?: string }>
  >({})
  const [addonQuotesLoading, setAddonQuotesLoading] = useState(false)
  /** Skip first run: default integration flags must not overwrite server before GET /settings completes. */
  const skipInitialIntegrationSave = useRef(true)
  const oauthReturnHandledRef = useRef(false)

  const quarterHourTimeOptions = useMemo(() => {
    const set = new Set<string>([...QUARTER_HOUR_TIME_SLOTS, TIME_END_OF_DAY])
    for (const x of [
      companyInfo.workingHourFrom,
      companyInfo.workingHourTo,
      companyInfo.outOfWorkingHourFrom,
      companyInfo.outOfWorkingHourTo,
    ]) {
      const n = normalizeTimeHHMM(String(x || ''))
      if (n) set.add(n)
    }
    return Array.from(set).sort((a, b) => {
      if (a === TIME_END_OF_DAY) return 1
      if (b === TIME_END_OF_DAY) return -1
      return a.localeCompare(b)
    })
  }, [
    companyInfo.workingHourFrom,
    companyInfo.workingHourTo,
    companyInfo.outOfWorkingHourFrom,
    companyInfo.outOfWorkingHourTo,
  ])

  const surchargeApplySummary = useMemo(() => {
    const wf = companyInfo.workingHourFrom
    const wt = companyInfo.workingHourTo
    const of = companyInfo.outOfWorkingHourFrom
    const ot = companyInfo.outOfWorkingHourTo
    const mode = companyInfo.outOfWorkingHourMarkupMode
    const valRaw = String(companyInfo.outOfWorkingHourMarkupValue || '').trim()
    const amt = valRaw === '' ? null : Number(valRaw.replace(',', '.'))

    if (!normalizeTimeHHMM(wf) || !normalizeTimeHHMM(wt)) {
      return {
        tone: 'muted' as const,
        lines: ['Set working hours (from / to) above to preview when surcharges apply.'],
      }
    }
    if (!normalizeTimeHHMM(of) || !normalizeTimeHHMM(ot)) {
      return {
        tone: 'muted' as const,
        lines: ['Set out-of-hours from / to to preview surcharge windows.'],
      }
    }

    const segs = computeSurchargeApplySegments(wf, wt, of, ot)
    if (!segs.length) {
      return {
        tone: 'warning' as const,
        lines: [
          'No surcharge window: these ranges do not overlap. Widen out-of-hours or adjust working hours.',
        ],
      }
    }

    const rangeStr = segs.map(formatIntervalRangeMm).join(' & ')
    const lines: string[] = [`Surcharge applies: ${rangeStr}.`]
    if (amt !== null && Number.isFinite(amt) && amt >= 0) {
      if (mode === 'fixed_amount') {
        lines.push(
          `Extra charge: RM ${amt.toLocaleString('en-MY', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })} (fixed per job).`
        )
      } else {
        lines.push(`Extra charge: ${amt}% on base price.`)
      }
    } else {
      lines.push('Enter an amount on the right to see the charge line.')
    }

    return { tone: 'ok' as const, lines }
  }, [
    companyInfo.workingHourFrom,
    companyInfo.workingHourTo,
    companyInfo.outOfWorkingHourFrom,
    companyInfo.outOfWorkingHourTo,
    companyInfo.outOfWorkingHourMarkupMode,
    companyInfo.outOfWorkingHourMarkupValue,
  ])

  const companyGateHighlight =
    portalSetupGate?.ok === true && portalSetupGate.firstIncomplete === 'company'
  const companyGateMissing = useMemo(
    () => (companyGateHighlight ? companySetupMissingFieldKeys(companyInfo) : []),
    [companyGateHighlight, companyInfo]
  )

  useEffect(() => {
    if (!operatorId || !user?.email) {
      setPortalSetupGate(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorPortalSetupStatus({
        operatorId,
        email: String(user.email).trim().toLowerCase(),
      })
      if (!cancelled && r?.ok) setPortalSetupGate(r)
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId, user?.email])

  useEffect(() => {
    if (!operatorId) {
      setPublicReviewSummary(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const r = await getPublicCleanlemonOperatorProfile(operatorId)
      if (cancelled) return
      if (r?.ok && r.summary) {
        setPublicReviewSummary({
          avg: r.summary.averageStars ?? null,
          count: Number(r.summary.reviewCount) || 0,
        })
      } else {
        setPublicReviewSummary({ avg: null, count: 0 })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  const reloadClnCompanyEmailStatus = useCallback(async () => {
    const oid = String(operatorId || '').trim()
    const em = String(user?.email || '').trim().toLowerCase()
    if (!oid || !em) {
      setClnCompanyEmailDisplay('')
      setClnCanChangeCompanyEmail(false)
      setClnCompanyEmailPending(null)
      return
    }
    try {
      const st = await getClnOperatorCompanyEmailChangeStatus({ operatorId: oid, email: em })
      if (st?.ok) {
        setClnCompanyEmailDisplay(String(st.companyEmail ?? '').trim())
        setClnCanChangeCompanyEmail(!!st.canChangeCompanyEmail)
        setClnCompanyEmailPending(st.pending ?? null)
      }
    } catch {
      /* ignore */
    }
  }, [operatorId, user?.email])

  useEffect(() => {
    void reloadClnCompanyEmailStatus()
  }, [reloadClnCompanyEmailStatus])

  const openClnCompanyEmailDialog = useCallback(() => {
    setClnCompanyEmailNew('')
    setClnCompanyEmailCode('')
    setClnCompanyEmailStep('enter')
    setClnCompanyEmailDoneEffectiveAt(null)
    setClnCompanyEmailDialogOpen(true)
  }, [])

  const sendClnCompanyEmailTac = useCallback(async () => {
    const trimmed = clnCompanyEmailNew.trim()
    const oid = String(operatorId || '').trim()
    const em = String(user?.email || '').trim().toLowerCase()
    if (!oid || !em) {
      toast.error('Missing account context')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error('Enter a valid email address.')
      return
    }
    setClnCompanyEmailBusy(true)
    try {
      const r = await requestClnOperatorCompanyEmailChange(trimmed, { operatorId: oid, email: em })
      if (!r?.ok) {
        const reason = r?.reason
        toast.error(
          reason === 'EMAIL_TAKEN'
            ? 'That email is already in use.'
            : reason === 'SAME_EMAIL'
              ? 'New email must differ from the current company email.'
              : reason === 'NOT_MASTER'
                ? 'Only the company master account can change this.'
                : reason === 'ALREADY_SCHEDULED'
                  ? 'A change is already scheduled. Wait for it to apply or cancel it first.'
                  : reason === 'MIGRATION_REQUIRED'
                    ? 'Database migration required — contact support.'
                    : reason || 'Request failed'
        )
        return
      }
      toast.success('Verification code sent to the new email.')
      setClnCompanyEmailStep('code')
    } finally {
      setClnCompanyEmailBusy(false)
    }
  }, [clnCompanyEmailNew, operatorId, user?.email])

  const confirmClnCompanyEmailTac = useCallback(async () => {
    const code = clnCompanyEmailCode.trim()
    const oid = String(operatorId || '').trim()
    const em = String(user?.email || '').trim().toLowerCase()
    if (!oid || !em) {
      toast.error('Missing account context')
      return
    }
    if (!/^\d{4,8}$/.test(code)) {
      toast.error('Enter the verification code from the email.')
      return
    }
    setClnCompanyEmailBusy(true)
    try {
      const r = await confirmClnOperatorCompanyEmailChange(clnCompanyEmailNew.trim(), code, {
        operatorId: oid,
        email: em,
      })
      if (!r?.ok) {
        toast.error(
          r?.reason === 'INVALID_OR_EXPIRED_CODE'
            ? 'Invalid or expired code.'
            : r?.reason === 'EMAIL_TAKEN'
              ? 'That email is already in use.'
              : r?.reason || 'Confirm failed'
        )
        return
      }
      setClnCompanyEmailStep('done')
      setClnCompanyEmailDoneEffectiveAt(r.effectiveAt ?? null)
      toast.success('Company email change scheduled.')
      void reloadClnCompanyEmailStatus()
    } finally {
      setClnCompanyEmailBusy(false)
    }
  }, [clnCompanyEmailNew, clnCompanyEmailCode, operatorId, user?.email, reloadClnCompanyEmailStatus])

  const submitCancelClnCompanyEmailChange = useCallback(async () => {
    const oid = String(operatorId || '').trim()
    const em = String(user?.email || '').trim().toLowerCase()
    if (!oid || !em) {
      toast.error('Missing account context')
      return
    }
    setClnCompanyEmailCancelBusy(true)
    try {
      const r = await cancelClnOperatorCompanyEmailChange({ operatorId: oid, email: em })
      if (!r?.ok) {
        toast.error(
          r?.reason === 'NOTHING_TO_CANCEL'
            ? 'No pending change to cancel.'
            : r?.reason === 'NOT_MASTER'
              ? 'Only the company master can cancel.'
              : r?.reason || 'Cancel failed'
        )
        return
      }
      toast.success('Scheduled email change cancelled.')
      setClnCompanyEmailCancelOpen(false)
      void reloadClnCompanyEmailStatus()
    } finally {
      setClnCompanyEmailCancelBusy(false)
    }
  }, [operatorId, user?.email, reloadClnCompanyEmailStatus])

  useEffect(() => {
    skipInitialIntegrationSave.current = true
    oauthReturnHandledRef.current = false
  }, [operatorId])

  /** Xero OAuth return + Google Drive redirect params (same flows as Coliving company settings). */
  useEffect(() => {
    if (typeof window === 'undefined' || oauthReturnHandledRef.current) return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state') || ''
    if (code && state.startsWith('clnxero_')) {
      const oid = state.slice('clnxero_'.length)
      if (oid !== operatorId) return
      oauthReturnHandledRef.current = true
      const redirectUri = getOperatorCompanyBaseUrl()
      ;(async () => {
        try {
          const data = await postCleanlemonXeroConnect(oid, { code, redirectUri })
          if (data?.ok) {
            toast.success('Xero connected')
            window.history.replaceState({}, '', getOperatorCompanyPathname())
            const r = await fetchOperatorSettings(operatorId)
            if (r?.ok && r.settings) {
              setIntegrationState((prev) => ({
                ...prev,
                bukku: !!r.settings.bukku,
                xero: !!r.settings.xero,
                googleDrive: !!r.settings.googleDrive,
                ttlock: !!r.settings.ttlock,
              }))
            }
          } else {
            oauthReturnHandledRef.current = false
            toast.error(data?.reason || 'Xero connection failed')
          }
        } catch {
          oauthReturnHandledRef.current = false
          toast.error('Xero connection failed')
        }
      })()
      return
    }
    const gd = params.get('google_drive')
    if (gd === 'connected') {
      oauthReturnHandledRef.current = true
      toast.success('Google Drive connected')
      window.history.replaceState({}, '', getOperatorCompanyPathname())
      void fetchOperatorSettings(operatorId).then((r) => {
        if (r?.ok && r.settings) {
          setIntegrationState((prev) => ({
            ...prev,
            googleDrive: !!r.settings.googleDrive,
          }))
        }
      })
      return
    }
    if (gd === 'error') {
      toast.error(`Google Drive: ${params.get('reason') || 'error'}`)
      window.history.replaceState({}, '', getOperatorCompanyPathname())
    }
    const sc = params.get('stripe_connect')
    if (sc === 'connected') {
      oauthReturnHandledRef.current = true
      toast.success('Stripe connected')
      window.history.replaceState({}, '', getOperatorCompanyPathname())
      void fetchOperatorSettings(operatorId).then((r) => {
        if (r?.ok && r.settings) {
          const gw = r.settings.xenditGateway
          if (gw && typeof gw === 'object') {
            setXenditGatewayState({
              connectionStatus: String((gw as { connectionStatus?: string }).connectionStatus || 'no_connect'),
              hasSecretKey: !!(gw as { hasSecretKey?: boolean }).hasSecretKey,
              hasWebhookToken: !!(gw as { hasWebhookToken?: boolean }).hasWebhookToken,
              secretKeyLast4: String((gw as { secretKeyLast4?: string }).secretKeyLast4 || ''),
              webhookTokenLast4: String((gw as { webhookTokenLast4?: string }).webhookTokenLast4 || ''),
              lastWebhookAt: (gw as { lastWebhookAt?: string | null }).lastWebhookAt ?? null,
              lastWebhookType: (gw as { lastWebhookType?: string | null }).lastWebhookType ?? null,
            })
          }
          setIntegrationState((prev) => ({
            ...prev,
            stripe: !!r.settings.stripe,
            xendit: !!r.settings.xendit,
          }))
        }
      })
      return
    }
    if (sc === 'error') {
      toast.error(`Stripe: ${params.get('reason') || 'error'}`)
      window.history.replaceState({}, '', getOperatorCompanyPathname())
    }
  }, [operatorId])

  useEffect(() => {
    if (!operatorId) return
    let cancelled = false
    ;(async () => {
      const [r, ttSt] = await Promise.all([
        fetchOperatorSettings(operatorId),
        fetchOperatorTtlockOnboardStatus(operatorId),
      ])
      if (cancelled || !r?.ok) return
      if (!cancelled && ttSt?.ok && Array.isArray(ttSt.accounts)) {
        setTtlockAccounts(ttSt.accounts)
      }
      const parsed = r.settings || {}
      const gw = parsed.xenditGateway
      if (gw && typeof gw === 'object') {
        setXenditGatewayState({
          connectionStatus: String((gw as { connectionStatus?: string }).connectionStatus || 'no_connect'),
          hasSecretKey: !!(gw as { hasSecretKey?: boolean }).hasSecretKey,
          hasWebhookToken: !!(gw as { hasWebhookToken?: boolean }).hasWebhookToken,
          secretKeyLast4: String((gw as { secretKeyLast4?: string }).secretKeyLast4 || ''),
          webhookTokenLast4: String((gw as { webhookTokenLast4?: string }).webhookTokenLast4 || ''),
          lastWebhookAt: (gw as { lastWebhookAt?: string | null }).lastWebhookAt ?? null,
          lastWebhookType: (gw as { lastWebhookType?: string | null }).lastWebhookType ?? null,
        })
      } else {
        setXenditGatewayState({
          connectionStatus: 'no_connect',
          hasSecretKey: false,
          hasWebhookToken: false,
          secretKeyLast4: '',
          webhookTokenLast4: '',
          lastWebhookAt: null,
          lastWebhookType: null,
        })
      }
      setIntegrationState((prev) => ({
        ...prev,
        stripe: !!parsed.stripe,
        xendit: !!parsed.xendit,
        bukku: !!parsed.bukku,
        xero: !!parsed.xero,
        ai: !!parsed.ai,
        googleDrive: !!parsed.googleDrive,
        ttlock: !!parsed.ttlock,
      }))
      const ap = String(parsed.aiProvider || '').trim().toLowerCase()
      if (parsed.ai && (ap === 'openai' || ap === 'deepseek' || ap === 'gemini')) {
        setAiProviderConnected(ap as 'openai' | 'deepseek' | 'gemini')
      } else {
        setAiProviderConnected(null)
      }
      setAiApiKeySet(!!parsed.aiKeyConfigured)
      const pubSub = String(parsed.publicSubdomain || '').trim().toLowerCase()
      const cp = parsed.companyProfile
      if (cp && typeof cp === 'object') {
        const raw = cp as Record<string, unknown>
        const rawBank = String(raw.bank || '').trim()
        const idFromCp = String(raw.bankdetailId || '').trim()
        const subFromProfile = String(raw.subdomain || '').trim().toLowerCase()
        const whFrom = String(raw.workingHourFrom || raw.working_hour_from || '').trim()
        const whTo = String(raw.workingHourTo || raw.working_hour_to || '').trim()
        const oohFrom = String(
          raw.outOfWorkingHourFrom || raw.out_of_working_hour_from || ''
        ).trim()
        const oohTo = String(raw.outOfWorkingHourTo || raw.out_of_working_hour_to || '').trim()
        const oohMk = parseOutOfWorkingHourMarkupFromProfile(raw)
        const {
          outOfWorkingHourMarkupPercent: _dropPct,
          outOfWorkingHourMarkupFixedMyr: _dropFix,
          outOfWorkingHourMarkupMode: _dropMode,
          ...cpRest
        } = raw
        setCompanyInfo((prev) => ({
          ...prev,
          ...cpRest,
          subdomain: pubSub || subFromProfile || String(prev.subdomain || '').trim().toLowerCase(),
          bankdetailId: idFromCp || (looksLikeBankdetailId(rawBank) ? rawBank : prev.bankdetailId),
          bank: rawBank || prev.bank,
          logoUrl: String(raw.logoUrl || prev.logoUrl || '').trim(),
          chopUrl: String(raw.chopUrl || raw.companyChop || raw.chop || prev.chopUrl || '').trim(),
          workingHourFrom: whFrom || String(prev.workingHourFrom || '').trim(),
          workingHourTo: whTo || String(prev.workingHourTo || '').trim(),
          outOfWorkingHourFrom: oohFrom || String(prev.outOfWorkingHourFrom || '').trim(),
          outOfWorkingHourTo: oohTo || String(prev.outOfWorkingHourTo || '').trim(),
          outOfWorkingHourMarkupMode: oohMk.mode,
          outOfWorkingHourMarkupValue: oohMk.valueStr,
        }))
      } else if (pubSub) {
        setCompanyInfo((prev) => ({ ...prev, subdomain: pubSub }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchEmployeeBanks()
      if (cancelled || !r?.ok || !Array.isArray(r.items)) return
      const items = r.items.map((b: { id?: string; label?: string; bankname?: string; value?: string }) => ({
        id: String(b.id),
        name: String(b.label || b.bankname || b.value || b.id),
      }))
      setBankOptions(items)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Map legacy free-text `bank` to `bankdetail.id` once options load */
  useEffect(() => {
    if (!bankOptions.length || companyInfo.bankdetailId) return
    const legacy = String(companyInfo.bank || '').trim()
    if (!legacy || looksLikeBankdetailId(legacy)) return
    const hit = bankOptions.find((b) => b.name.toLowerCase() === legacy.toLowerCase())
    if (hit) setCompanyInfo((p) => ({ ...p, bankdetailId: hit.id }))
  }, [bankOptions, companyInfo.bank, companyInfo.bankdetailId])

  useEffect(() => {
    if (!operatorId) return
    let cancelled = false
    ;(async () => {
      const email = String(user?.email || '').trim().toLowerCase()
      if (!String(operatorId || '').trim() && !email) {
        setSaasBillingHistory([])
        return
      }
      setSaasBillingLoading(true)
      const r = await fetchOperatorSaasBillingHistory({
        operatorId: String(operatorId || ''),
        email,
      })
      if (!cancelled && r?.ok && Array.isArray(r.items)) {
        setSaasBillingHistory(r.items)
      }
      if (!cancelled) setSaasBillingLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId, user?.email])

  useEffect(() => {
    if (!operatorId) return
    let cancelled = false
    ;(async () => {
      setSubscriptionLoading(true)
      const r = await fetchOperatorSubscription({
        operatorId,
        email: String(user?.email || '').trim().toLowerCase(),
      })
      if (!cancelled && r?.ok) {
        setSubscriptionItem(r.item || null)
      }
      if (!cancelled) setSubscriptionLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId, user?.email])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchClnPricingPlans()
      if (cancelled || !r?.ok || !r.items?.length) return
      const m: Record<string, { month: number; quarter: number; year: number }> = {}
      for (const it of r.items) {
        const pc = String(it.planCode || '').toLowerCase()
        if (!['starter', 'growth', 'enterprise'].includes(pc)) continue
        if (!m[pc]) m[pc] = { month: 0, quarter: 0, year: 0 }
        const iv = String(it.intervalCode || '').toLowerCase()
        const amt = Number(it.amountMyr || 0)
        if (iv === 'month') m[pc].month = amt
        else if (iv === 'quarter') m[pc].quarter = amt
        else if (iv === 'year') m[pc].year = amt
      }
      setClnPlanAmounts(m)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchClmAddonCatalog()
      if (cancelled) return
      if (r?.ok && r.items?.length) setAddonCatalog(r.items)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const email = String(subscriptionItem?.operatorEmail || user?.email || '')
      .trim()
      .toLowerCase()
    if (!addonCatalog.length || !email || !subscriptionItem?.activeFrom) {
      setAddonQuotes({})
      return
    }
    let cancelled = false
    setAddonQuotesLoading(true)
    ;(async () => {
      const next: Record<
        string,
        { amountDueMyr?: number; yearlyAmountMyr?: number; daysRemaining?: number; reason?: string }
      > = {}
      for (const a of addonCatalog) {
        const r = await fetchAddonProrationQuote({
          operatorId,
          email,
          addonCode: a.addonCode,
        })
        if (cancelled) return
        if (r?.ok) {
          next[a.addonCode] = {
            amountDueMyr: r.amountDueMyr,
            yearlyAmountMyr: r.yearlyAmountMyr,
            daysRemaining: r.daysRemaining,
          }
        } else {
          next[a.addonCode] = { reason: r?.reason || 'QUOTE_FAILED' }
        }
      }
      if (!cancelled) {
        setAddonQuotes(next)
        setAddonQuotesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    addonCatalog,
    subscriptionItem?.activeFrom,
    subscriptionItem?.operatorEmail,
    subscriptionItem?.billingCycle,
    operatorId,
    user?.email,
  ])

  useEffect(() => {
    const manage = showTtlockDialog && ttlockStep === 'manage' && manageSlot != null && !!operatorId
    if (!manage) {
      setTtlockViewCreds(null)
      return
    }
    let cancelled = false
    void fetchOperatorTtlockCredentials(operatorId, manageSlot!).then((res) => {
      if (cancelled) return
      if (res?.ok) {
        setTtlockViewCreds({ username: res.username ?? '', password: res.password ?? '' })
      } else {
        setTtlockViewCreds({ username: '', password: '' })
      }
    })
    return () => {
      cancelled = true
    }
  }, [showTtlockDialog, ttlockStep, manageSlot, operatorId])

  useEffect(() => {
    if (!subscriptionItem?.billingCycle) return
    const bc = String(subscriptionItem.billingCycle).toLowerCase()
    if (bc === 'yearly') setBillingPeriod('yearly')
    else if (bc === 'quarterly') setBillingPeriod('quarterly')
    else setBillingPeriod('monthly')
  }, [subscriptionItem?.billingCycle])

  useEffect(() => {
    if (!operatorId) return
    if (skipInitialIntegrationSave.current) {
      skipInitialIntegrationSave.current = false
      return
    }
    void saveOperatorSettings(operatorId, integrationState).catch(() => {})
  }, [integrationState, operatorId])

  const currentUiPlan = apiPlanToUiPlan(subscriptionItem?.planCode)
  const hasActiveSubscriptionPeriod = !!subscriptionItem?.activeFrom
  const currentAddonCodes = useMemo(() => {
    const list = subscriptionItem?.addons
    if (!Array.isArray(list)) return [] as string[]
    return list
      .filter((x) => String(x.status).toLowerCase() === 'active')
      .map((x) => String(x.addonCode).toLowerCase())
  }, [subscriptionItem?.addons])

  const handleLogoFile = async (file: File | null) => {
    if (!file) return
    setUploadingLogo(true)
    try {
      const up = await uploadEmployeeFileToOss(file, operatorId)
      if (up?.ok && up.url) {
        setCompanyInfo((c) => ({ ...c, logoUrl: up.url! }))
        toast.success('Logo uploaded')
      } else {
        toast.error(up?.reason || 'Logo upload failed')
      }
    } catch {
      toast.error('Logo upload failed')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleChopFile = async (file: File | null) => {
    if (!file) return
    setUploadingChop(true)
    try {
      const up = await uploadEmployeeFileToOss(file, operatorId)
      if (up?.ok && up.url) {
        setCompanyInfo((c) => ({ ...c, chopUrl: up.url! }))
        toast.success('Company chop uploaded')
      } else {
        toast.error(up?.reason || 'Chop upload failed')
      }
    } catch {
      toast.error('Chop upload failed')
    } finally {
      setUploadingChop(false)
    }
  }

  const handleSave = async () => {
    if (!operatorId) {
      toast.error('Missing operator profile')
      return
    }
    const subNorm = String(companyInfo.subdomain || '')
      .trim()
      .toLowerCase()
    if (!subNorm) {
      toast.error('Subdomain is required (unique across all operators)')
      return
    }
    try {
      const {
        bank: _legacyBankLabel,
        outOfWorkingHourMarkupMode: oohMkMode,
        outOfWorkingHourMarkupValue: oohMkVal,
        outOfWorkingHourMarkupPercent: _legacyPctField,
        outOfWorkingHourMarkupFixedMyr: _legacyFixField,
        ...profile
      } = companyInfo as typeof companyInfo & Record<string, unknown>
      const mkTrim = String(oohMkVal ?? '').trim()
      let mkNum: number | null = null
      if (mkTrim !== '') {
        const n = Number(mkTrim.replace(',', '.'))
        if (!Number.isFinite(n) || n < 0) {
          toast.error('Out-of-hours surcharge must be a non-negative number')
          return
        }
        mkNum = n
      }
      const r = await saveOperatorSettings(operatorId, {
        companyProfile: {
          ...profile,
          companyChop: profile.chopUrl || '',
          outOfWorkingHourMarkupMode: oohMkMode,
          outOfWorkingHourMarkupPercent:
            oohMkMode === 'percentage' && mkNum !== null ? mkNum : null,
          outOfWorkingHourMarkupFixedMyr:
            oohMkMode === 'fixed_amount' && mkNum !== null ? mkNum : null,
        },
        publicSubdomain: subNorm,
      })
      if (r?.ok === false) {
        const reason = (r as { reason?: string }).reason || ''
        if (reason === 'SUBDOMAIN_REQUIRED')
          toast.error('Subdomain is required (unique across all operators)')
        else if (reason === 'SUBDOMAIN_TAKEN') toast.error('This subdomain is already taken')
        else if (reason === 'SUBDOMAIN_RESERVED') toast.error('This subdomain is reserved — choose another')
        else if (reason === 'SUBDOMAIN_INVALID_FORMAT')
          toast.error('Subdomain: lowercase letters, numbers and hyphens only; no spaces (2–64 characters)')
        else if (reason === 'SUBDOMAIN_TOO_LONG') toast.error('Subdomain is too long')
        else if (reason === 'PUBLIC_SUBDOMAIN_COLUMN_MISSING')
          toast.error('Database not migrated — contact support')
        else toast.error(reason || 'Save failed')
        return
      }
      toast.success('Company information updated successfully')
      try {
        const rs = await fetchOperatorPortalSetupStatus({
          operatorId,
          email: String(user?.email || '').trim().toLowerCase(),
        })
        if (rs?.ok) setPortalSetupGate(rs)
      } catch {
        /* ignore */
      }
    } catch {
      toast.error('Save failed')
    }
  }

  const startSubscriptionCheckout = async (uiPlan: PricingPlan, action: 'subscribe' | 'renew' | 'upgrade') => {
    const email = String(subscriptionItem?.operatorEmail || user?.email || '').trim().toLowerCase()
    if (!email) {
      toast.error('Missing email for checkout')
      return
    }
    const busy = `${uiPlan}-${action}`
    setCheckoutBusyKey(busy)
    try {
      const plan = uiPlanToApiPlan(uiPlan)
      const interval =
        billingPeriod === 'yearly' ? 'year' : billingPeriod === 'quarterly' ? 'quarter' : 'month'
      const successUrl = `${getOperatorCompanyBaseUrl()}?checkout=success`
      const cancelUrl = `${getOperatorCompanyBaseUrl()}?checkout=cancelled`
      const data = await postSubscriptionCheckoutSession({
        plan,
        interval,
        checkoutAction: action,
        operatorId,
        email,
        name: String(subscriptionItem?.operatorName || user?.name || '').trim(),
        successUrl,
        cancelUrl,
      })
      if (data?.ok === false || !data?.url) {
        throw new Error(data?.reason || 'CHECKOUT_FAILED')
      }
      window.location.href = String(data.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start checkout')
      setCheckoutBusyKey(null)
    }
  }

  const startAddonCheckout = async (addon: ClmAddonCatalogItem) => {
    const email = String(subscriptionItem?.operatorEmail || user?.email || '').trim().toLowerCase()
    if (!email) {
      toast.error('Missing email for checkout')
      return
    }
    setCheckoutBusyKey(`addon-${addon.addonCode}`)
    try {
      const successUrl = `${getOperatorCompanyBaseUrl()}?addonCheckout=success`
      const cancelUrl = `${getOperatorCompanyBaseUrl()}?addonCheckout=cancelled`
      const data = await postAddonCheckoutSession({
        operatorId,
        email,
        name: String(subscriptionItem?.operatorName || user?.name || '').trim(),
        addonCode: addon.addonCode,
        successUrl,
        cancelUrl,
      })
      if (!data?.ok || !data?.url) {
        throw new Error(data?.reason || 'CHECKOUT_FAILED')
      }
      window.location.href = String(data.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start checkout')
      setCheckoutBusyKey(null)
    }
  }

  const toggleIntegration = (key: keyof typeof integrationState) => {
    setIntegrationState((prev) => {
      const nextConnected = !prev[key]
      const next = { ...prev }

      // payment gateway: only one provider can be connected
      if (key === 'stripe' || key === 'xendit') {
        const otherKey = key === 'stripe' ? 'xendit' : 'stripe'
        if (nextConnected && prev[otherKey]) {
          toast.error(`Please disconnect ${otherKey} first`)
          return prev
        }
        if (nextConnected) {
          next.stripe = false
          next.xendit = false
          next[key] = true
        } else {
          next[key] = false
        }
      // accounting: only one provider can be connected
      } else if (key === 'bukku' || key === 'xero') {
        const otherKey = key === 'bukku' ? 'xero' : 'bukku'
        if (nextConnected && prev[otherKey]) {
          toast.error(`Please disconnect ${otherKey} first`)
          return prev
        }
        if (nextConnected) {
          next.bukku = false
          next.xero = false
          next[key] = true
        } else {
          next[key] = false
        }
      } else {
        next[key] = nextConnected
      }

      toast.success(`${nextConnected ? 'Connected' : 'Disconnected'} ${key}`)
      return next
    })
  }

  const connectedPaymentProvider = integrationState.stripe ? 'stripe' : integrationState.xendit ? 'xendit' : null
  const connectedAccountingProvider = integrationState.bukku ? 'bukku' : integrationState.xero ? 'xero' : null
  const xenditPendingVerification =
    !!integrationState.xendit && xenditGatewayState.connectionStatus === 'pending_verification'
  const xenditGatewayStatusLabel =
    xenditGatewayState.connectionStatus === 'connected'
      ? 'Connected'
      : xenditGatewayState.connectionStatus === 'pending_verification'
        ? 'Pending verification'
        : 'Not connected'

  /** First-time connect only (no gateway on file). */
  const openPaymentConnectDialog = () => {
    if (connectedPaymentProvider) {
      toast.error('Use Manage on the payment card')
      return
    }
    setSelectedPaymentProvider('stripe')
    setPaymentGatewayStep('choose')
    setPaymentGatewayFromManage(false)
    setXenditSecretInput('')
    setXenditCallbackTokenInput('')
    setShowPaymentDialog(true)
  }

  /** Coliving-style: disconnect only from dialog, not from the integration list row. */
  const openPaymentGatewayManageDialog = () => {
    if (!connectedPaymentProvider) return
    setPaymentGatewayFromManage(true)
    if (connectedPaymentProvider === 'stripe') {
      setXenditSecretInput('')
      setXenditCallbackTokenInput('')
      setSelectedPaymentProvider('stripe')
      setPaymentGatewayStep('stripe-manage')
    } else {
      setSelectedPaymentProvider('xendit')
      setPaymentGatewayStep('xendit-form')
      primeXenditCredentialInputs()
    }
    setShowPaymentDialog(true)
  }

  const openAccountingConnectDialog = () => {
    if (connectedAccountingProvider) {
      toast.error(`Please disconnect ${connectedAccountingProvider} first`)
      return
    }
    setSelectedAccountingProvider('bukku')
    setShowAccountingDialog(true)
  }

  const startStripeConnectOAuth = async () => {
    setShowPaymentDialog(false)
    try {
      const r = await postCleanlemonStripeConnectOAuthUrl(operatorId)
      if (!r?.ok || !r.url) {
        toast.error(r?.reason || 'Stripe Connect not configured')
        return
      }
      window.location.href = r.url
    } catch {
      toast.error('Could not start Stripe Connect')
    }
  }

  const saveClnXenditCredentialsFromDialog = async () => {
    if (!xenditCredentialsSaveEnabled) {
      toast.error('Add both Xendit secret key and X-CALLBACK-TOKEN (or keep the saved placeholders).')
      return
    }
    const maskSk = clnXenditSavedValueDisplay(xenditGatewayState.secretKeyLast4)
    const maskTok = clnXenditSavedValueDisplay(xenditGatewayState.webhookTokenLast4)
    const skTrim = xenditSecretInput.trim()
    const tokTrim = xenditCallbackTokenInput.trim()
    const keepSk = xenditGatewayState.hasSecretKey && (!skTrim || skTrim === maskSk)
    const keepTok = xenditGatewayState.hasWebhookToken && (!tokTrim || tokTrim === maskTok)
    const payload: { operatorId: string; secretKey?: string; callbackToken?: string } = { operatorId }
    if (!keepSk) payload.secretKey = skTrim
    if (!keepTok) payload.callbackToken = tokTrim

    setXenditCredentialBusy(true)
    try {
      const r = await postClnOperatorClientInvoiceXenditCredentials(payload)
      if (!r?.ok) {
        toast.error(r?.reason || 'Save failed')
        return
      }
      toast.success('Saved. Placeholders refresh below; status stays Pending until Xendit hits your webhook URL.')
      const s = await fetchOperatorSettings(operatorId)
      if (s?.ok && s.settings) {
        const gw = s.settings.xenditGateway
        if (gw && typeof gw === 'object') {
          const nextGw = {
            connectionStatus: String((gw as { connectionStatus?: string }).connectionStatus || 'no_connect'),
            hasSecretKey: !!(gw as { hasSecretKey?: boolean }).hasSecretKey,
            hasWebhookToken: !!(gw as { hasWebhookToken?: boolean }).hasWebhookToken,
            secretKeyLast4: String((gw as { secretKeyLast4?: string }).secretKeyLast4 || ''),
            webhookTokenLast4: String((gw as { webhookTokenLast4?: string }).webhookTokenLast4 || ''),
            lastWebhookAt: (gw as { lastWebhookAt?: string | null }).lastWebhookAt ?? null,
            lastWebhookType: (gw as { lastWebhookType?: string | null }).lastWebhookType ?? null,
          }
          setXenditGatewayState(nextGw)
          setXenditSecretInput(nextGw.hasSecretKey ? clnXenditSavedValueDisplay(nextGw.secretKeyLast4) : '')
          setXenditCallbackTokenInput(nextGw.hasWebhookToken ? clnXenditSavedValueDisplay(nextGw.webhookTokenLast4) : '')
        }
        setIntegrationState((prev) => ({
          ...prev,
          stripe: !!s.settings.stripe,
          xendit: !!s.settings.xendit,
          bukku: !!s.settings.bukku,
          xero: !!s.settings.xero,
          googleDrive: !!s.settings.googleDrive,
          ai: !!s.settings.ai,
          ttlock: !!s.settings.ttlock,
        }))
      }
    } catch {
      toast.error('Save failed')
    } finally {
      setXenditCredentialBusy(false)
    }
  }

  const disconnectPayment = async () => {
    const prov = connectedPaymentProvider
    if (!prov) return
    try {
      if (prov === 'stripe') {
        await postCleanlemonStripeConnectDisconnect(operatorId)
        toast.success('Stripe disconnected')
      } else {
        const r = await postClnOperatorClientInvoiceXenditDisconnect(operatorId)
        if (!r?.ok) {
          toast.error(r?.reason || 'Disconnect failed')
          return
        }
        toast.success('Xendit disconnected')
      }
      const s = await fetchOperatorSettings(operatorId)
      if (s?.ok && s.settings) {
        const gw = s.settings.xenditGateway
        if (gw && typeof gw === 'object') {
          setXenditGatewayState({
            connectionStatus: String((gw as { connectionStatus?: string }).connectionStatus || 'no_connect'),
            hasSecretKey: !!(gw as { hasSecretKey?: boolean }).hasSecretKey,
            hasWebhookToken: !!(gw as { hasWebhookToken?: boolean }).hasWebhookToken,
            secretKeyLast4: String((gw as { secretKeyLast4?: string }).secretKeyLast4 || ''),
            webhookTokenLast4: String((gw as { webhookTokenLast4?: string }).webhookTokenLast4 || ''),
            lastWebhookAt: (gw as { lastWebhookAt?: string | null }).lastWebhookAt ?? null,
            lastWebhookType: (gw as { lastWebhookType?: string | null }).lastWebhookType ?? null,
          })
        } else {
          setXenditGatewayState({
            connectionStatus: 'no_connect',
            hasSecretKey: false,
            hasWebhookToken: false,
            secretKeyLast4: '',
            webhookTokenLast4: '',
            lastWebhookAt: null,
            lastWebhookType: null,
          })
        }
        setIntegrationState((prev) => ({
          ...prev,
          stripe: !!s.settings.stripe,
          xendit: !!s.settings.xendit,
          bukku: !!s.settings.bukku,
          xero: !!s.settings.xero,
          googleDrive: !!s.settings.googleDrive,
          ai: !!s.settings.ai,
          ttlock: !!s.settings.ttlock,
        }))
      }
    } catch {
      toast.error('Disconnect failed')
    }
  }

  const connectSelectedAccountingProvider = async () => {
    if (selectedAccountingProvider === 'bukku') {
      setShowAccountingDialog(false)
      try {
        const cr = await fetchCleanlemonBukkuCredentials(operatorId)
        if (cr?.ok) {
          setBukkuToken(cr.token || '')
          setBukkuSubdomain(cr.subdomain || '')
        }
      } catch {
        /* pre-fill optional */
      }
      setShowBukkuDialog(true)
      return
    }
    if (typeof window === 'undefined') return
    setShowAccountingDialog(false)
    const redirectUri = getOperatorCompanyBaseUrl()
    const state = `clnxero_${operatorId}`
    const auth = await fetchCleanlemonXeroAuthUrl({ redirectUri, state })
    if (!auth?.ok || !auth.url) {
      toast.error(auth?.reason || 'Could not start Xero login')
      return
    }
    window.location.href = auth.url
  }

  const submitBukkuConnect = async () => {
    if (!bukkuToken.trim() || !bukkuSubdomain.trim()) {
      toast.error('Enter Bukku secret key and subdomain')
      return
    }
    setBukkuSaving(true)
    try {
      const r = await postCleanlemonBukkuConnect({
        operatorId,
        token: bukkuToken.trim(),
        subdomain: bukkuSubdomain.trim(),
      })
      if (!r?.ok) {
        toast.error(r?.reason || 'Bukku connect failed')
        return
      }
      toast.success('Bukku connected')
      setShowBukkuDialog(false)
      const s = await fetchOperatorSettings(operatorId)
      if (s?.ok && s.settings) {
        setIntegrationState((prev) => ({
          ...prev,
          bukku: !!s.settings.bukku,
          xero: !!s.settings.xero,
          ttlock: !!s.settings.ttlock,
        }))
      }
    } finally {
      setBukkuSaving(false)
    }
  }

  const disconnectAccounting = async () => {
    try {
      if (connectedAccountingProvider === 'bukku') {
        await postCleanlemonBukkuDisconnect(operatorId)
      } else if (connectedAccountingProvider === 'xero') {
        await postCleanlemonXeroDisconnect(operatorId)
      }
      toast.success('Accounting disconnected')
      const s = await fetchOperatorSettings(operatorId)
      if (s?.ok && s.settings) {
        setIntegrationState((prev) => ({
          ...prev,
          bukku: !!s.settings.bukku,
          xero: !!s.settings.xero,
          ttlock: !!s.settings.ttlock,
        }))
      }
    } catch {
      toast.error('Disconnect failed')
    }
  }

  const connectGoogleDriveFlow = async () => {
    const r = await postCleanlemonGoogleDriveOAuthUrl(operatorId)
    if (!r?.ok || !r.url) {
      toast.error(r?.reason || 'Google Drive OAuth not configured')
      return
    }
    window.location.href = r.url
  }

  const disconnectGoogleDriveFlow = async () => {
    try {
      await postCleanlemonGoogleDriveDisconnect(operatorId)
      toast.success('Google Drive disconnected')
      const s = await fetchOperatorSettings(operatorId)
      if (s?.ok && s.settings) {
        setIntegrationState((prev) => ({ ...prev, googleDrive: !!s.settings.googleDrive }))
      }
    } catch {
      toast.error('Disconnect failed')
    }
  }

  const openAiSetupDialog = () => {
    setSelectedAiProvider(aiProviderConnected ?? 'openai')
    setShowAiProviderDialog(true)
  }

  const continueAiProviderSelection = () => {
    setShowAiProviderDialog(false)
    setShowAiApiKeyDialog(true)
  }

  const connectAiProvider = async () => {
    if (!aiApiKeyInput.trim()) {
      toast.error('Please enter API key')
      return
    }
    try {
      const r = await postCleanlemonAiAgentConnect({
        operatorId,
        provider: selectedAiProvider,
        apiKey: aiApiKeyInput.trim(),
      })
      if (!r?.ok) {
        toast.error(r?.reason || `${OPERATOR_SCHEDULE_AI_DISPLAY_NAME} connect failed`)
        return
      }
      const s = await fetchOperatorSettings(operatorId)
      if (s?.ok && s.settings) {
        const parsed = s.settings
        setIntegrationState((prev) => ({ ...prev, ai: !!parsed.ai }))
        const ap = String(parsed.aiProvider || '').trim().toLowerCase()
        if (parsed.ai && (ap === 'openai' || ap === 'deepseek' || ap === 'gemini')) {
          setAiProviderConnected(ap as 'openai' | 'deepseek' | 'gemini')
        }
        setAiApiKeySet(!!parsed.aiKeyConfigured)
      } else {
        setIntegrationState((prev) => ({ ...prev, ai: true }))
        setAiProviderConnected(selectedAiProvider)
        setAiApiKeySet(true)
      }
      setAiApiKeyInput('')
      setShowAiApiKeyDialog(false)
      toast.success(`Connected ${OPERATOR_SCHEDULE_AI_DISPLAY_NAME} (${selectedAiProvider})`)
    } catch {
      toast.error(`${OPERATOR_SCHEDULE_AI_DISPLAY_NAME} connect failed`)
    }
  }

  const disconnectAiProvider = async () => {
    try {
      await postCleanlemonAiAgentDisconnect(operatorId)
      const s = await fetchOperatorSettings(operatorId)
      if (s?.ok && s.settings) {
        const parsed = s.settings
        setIntegrationState((prev) => ({ ...prev, ai: !!parsed.ai }))
        setAiApiKeySet(!!parsed.aiKeyConfigured)
        const ap = String(parsed.aiProvider || '').trim().toLowerCase()
        setAiProviderConnected(
          parsed.ai && (ap === 'openai' || ap === 'deepseek' || ap === 'gemini')
            ? (ap as 'openai' | 'deepseek' | 'gemini')
            : null
        )
      } else {
        setIntegrationState((prev) => ({ ...prev, ai: false }))
        setAiProviderConnected(null)
        setAiApiKeySet(false)
      }
      setAiApiKeyInput('')
      toast.success(`Disconnected ${OPERATOR_SCHEDULE_AI_DISPLAY_NAME}`)
    } catch {
      toast.error('Disconnect failed')
    }
  }

  const openTtlockConnectDialog = () => {
    setManageSlot(null)
    setTtlockStep('choose')
    setTtlockFormUser('')
    setTtlockFormPass('')
    setTtlockAccountName('')
    setShowTtlockDialog(true)
  }

  const openTtlockManageForSlot = (slot: number) => {
    setManageSlot(slot)
    setTtlockStep('manage')
    setShowTtlockDialog(true)
  }

  const submitTtlockConnect = async () => {
    if (!operatorId) {
      toast.error('Missing operator profile')
      return
    }
    const name = ttlockAccountName.trim()
    if (!name) {
      toast.error('Enter a name for this TTLock account')
      return
    }
    setTtlockBusy(true)
    try {
      const r = await postOperatorTtlockConnect(operatorId, ttlockFormUser, ttlockFormPass, { accountName: name })
      if (!r?.ok) {
        const reason = r?.reason || 'TTLOCK_CONNECT_FAILED'
        toast.error(
          reason === 'TTLOCK_USERNAME_PASSWORD_REQUIRED'
            ? 'Please enter your TTLock username and password.'
            : reason === 'TTLOCK_APP_CREDENTIALS_MISSING'
              ? 'TTLock app credentials are not configured on the server.'
              : reason
        )
        return
      }
      toast.success('TTLock connected')
      setShowTtlockDialog(false)
      setTtlockFormPass('')
      setTtlockAccountName('')
      const [s, ttSt] = await Promise.all([
        fetchOperatorSettings(operatorId),
        fetchOperatorTtlockOnboardStatus(operatorId),
      ])
      if (s?.ok && s.settings) {
        setIntegrationState((prev) => ({ ...prev, ttlock: !!s.settings.ttlock }))
      }
      if (ttSt?.ok && Array.isArray(ttSt.accounts)) {
        setTtlockAccounts(ttSt.accounts)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'TTLock connect failed')
    } finally {
      setTtlockBusy(false)
    }
  }

  const disconnectTtlockAtSlot = async (slot: number) => {
    if (!operatorId) return
    setTtlockBusy(true)
    try {
      const r = await postOperatorTtlockDisconnect(operatorId, slot)
      if (!r?.ok) {
        toast.error(r?.reason || 'Disconnect failed')
        return
      }
      toast.success('TTLock disconnected')
      setShowTtlockDialog(false)
      setManageSlot(null)
      const [s, ttSt] = await Promise.all([
        fetchOperatorSettings(operatorId),
        fetchOperatorTtlockOnboardStatus(operatorId),
      ])
      if (s?.ok && s.settings) {
        setIntegrationState((prev) => ({ ...prev, ttlock: !!s.settings.ttlock }))
      }
      if (ttSt?.ok && Array.isArray(ttSt.accounts)) {
        setTtlockAccounts(ttSt.accounts)
      }
    } catch {
      toast.error('Disconnect failed')
    } finally {
      setTtlockBusy(false)
    }
  }

  const connectedTtlockRows = useMemo(
    () => ttlockAccounts.filter((a) => a.connected),
    [ttlockAccounts]
  )

  const getPlanIcon = (plan: string) => {
    switch (plan) {
      case 'basic': return Shield
      case 'grow': return Zap
      case 'enterprise': return Crown
      default: return Shield
    }
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Company Settings</h2>
          <p className="text-muted-foreground">Manage your company profile and subscription</p>
        </div>
        {operatorId ? (
          <div className="flex flex-col items-stretch gap-1 sm:items-end shrink-0">
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-2 justify-center sm:justify-end"
              onClick={() => router.push(`/profile/${encodeURIComponent(operatorId)}`)}
            >
              Review
              <span className="font-medium tabular-nums">
                (
                {publicReviewSummary === null
                  ? '…'
                  : publicReviewSummary.avg != null
                    ? `${publicReviewSummary.avg}`
                    : '—'}
                )
              </span>
            </Button>
            <span className="text-center text-xs text-muted-foreground sm:text-right">
              Total reviews:{' '}
              {publicReviewSummary === null ? '…' : publicReviewSummary.count}
            </span>
          </div>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">
        <TabsList className="flex h-auto min-h-9 w-full min-w-0 flex-wrap items-stretch justify-start gap-1 p-1 sm:gap-0">
          <TabsTrigger value="profile" className="shrink-0 px-3 sm:flex-1">
            Profile
          </TabsTrigger>
          <TabsTrigger value="integration" className="shrink-0 px-3 sm:flex-1">
            Integration
          </TabsTrigger>
          <TabsTrigger value="subscription" className="shrink-0 px-3 sm:flex-1">
            Subscription
          </TabsTrigger>
          <TabsTrigger value="billing" className="shrink-0 px-3 sm:flex-1">
            Billing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6 space-y-6">
          {companyGateHighlight ? (
            <Alert variant="destructive" className="border-destructive/60">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Complete required company details</AlertTitle>
              <AlertDescription>
                Items outlined in red are still required before you can use the rest of the operator portal.
              </AlertDescription>
            </Alert>
          ) : null}
          {/* Company Profile */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Company Profile
              </CardTitle>
              <CardDescription>Update your company information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={companyInfo.country}
                    disabled
                  />
                </div>
                <div
                  className={cn(
                    'space-y-2',
                    companyGateFieldClass(companyGateMissing, 'companyName')
                  )}
                >
                  <Label htmlFor="company-name">Company Name</Label>
                  <Input
                    id="company-name"
                    value={companyInfo.companyName}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, companyName: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">Company email</Label>
                <p className="text-xs text-muted-foreground">
                  Master company account (cln_operatordetail). Login uses this until a scheduled change completes (7 days
                  after you verify the code).
                </p>
                <Input
                  value={clnCompanyEmailDisplay || String(user?.email || '').trim()}
                  className="bg-muted"
                  disabled
                  readOnly
                />
                {clnCanChangeCompanyEmail ? (
                  <button
                    type="button"
                    className="text-sm text-primary underline underline-offset-2 mt-1.5 block hover:opacity-90"
                    onClick={openClnCompanyEmailDialog}
                  >
                    Change email address
                  </button>
                ) : null}
                {clnCompanyEmailPending?.status === 'scheduled' && clnCompanyEmailPending.effectiveAt ? (
                  <div className="mt-2 space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                    <p className="text-xs text-amber-800 dark:text-amber-400">
                      Change to <strong>{clnCompanyEmailPending.newEmail}</strong> is scheduled for{' '}
                      {new Date(clnCompanyEmailPending.effectiveAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                      . Until then, sign in with your current email.
                    </p>
                    {clnCanChangeCompanyEmail ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-destructive underline underline-offset-2 hover:opacity-90"
                        onClick={() => setClnCompanyEmailCancelOpen(true)}
                      >
                        Cancel change
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {clnCompanyEmailPending?.status === 'pending_tac' ? (
                  <p className="text-xs text-muted-foreground mt-2">
                    A verification code was sent to the new address. Open &quot;Change email address&quot; to enter it,
                    or request a new code.
                  </p>
                ) : null}
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div
                  className={cn(
                    'space-y-2',
                    companyGateFieldClass(companyGateMissing, 'ssmNumber')
                  )}
                >
                  <Label htmlFor="registration">SSM Number</Label>
                  <Input
                    id="registration"
                    value={companyInfo.ssmNumber}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, ssmNumber: e.target.value })}
                  />
                </div>
                <div
                  className={cn(
                    'space-y-2 sm:col-span-2',
                    companyGateFieldClass(companyGateMissing, 'subdomain')
                  )}
                >
                  <Label htmlFor="subdomain">
                    Subdomain <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground break-words">
                    <span className="font-medium text-foreground">Required.</span> Must be unique — no other operator
                    can use the same value. Your public page:{' '}
                    <span className="font-medium text-foreground break-all sm:break-words">
                      {typeof window !== 'undefined' ? window.location.origin : 'https://portal.cleanlemons.com'}/
                      {String(companyInfo.subdomain || 'your-name').trim() || 'your-name'}
                    </span>
                    . Lowercase letters, numbers and hyphens only — no spaces.
                  </p>
                  <Input
                    id="subdomain"
                    placeholder="e.g. my-cleaning-co"
                    autoComplete="off"
                    required
                    aria-required="true"
                    value={companyInfo.subdomain}
                    onChange={(e) => {
                      const v = e.target.value
                        .toLowerCase()
                        .replace(/\s/g, '')
                        .replace(/[^a-z0-9-]/g, '')
                      setCompanyInfo({ ...companyInfo, subdomain: v })
                    }}
                  />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tin">TIN (Tax ID)</Label>
                  <Input
                    id="tin"
                    value={companyInfo.tin}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, tin: e.target.value })}
                  />
                </div>
                <div
                  className={cn(
                    'space-y-2',
                    companyGateFieldClass(companyGateMissing, 'contact')
                  )}
                >
                  <Label htmlFor="contact">Contact</Label>
                  <Input
                    id="contact"
                    value={companyInfo.contact}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, contact: e.target.value })}
                  />
                </div>
              </div>
              <div
                className={cn(
                  'space-y-2',
                  companyGateFieldClass(companyGateMissing, 'address')
                )}
              >
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={companyInfo.address}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, address: e.target.value })}
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <QuarterHourTimeSelect
                  id="working-hour-from"
                  label="Working hours from"
                  description="Company default window (local time). 15-minute steps."
                  value={companyInfo.workingHourFrom}
                  onChange={(next) =>
                    setCompanyInfo((c) => ({ ...c, workingHourFrom: normalizeTimeHHMM(next) }))
                  }
                  options={quarterHourTimeOptions}
                />
                <QuarterHourTimeSelect
                  id="working-hour-to"
                  label="Working hours to"
                  description="End of the same window (optional if open-ended)."
                  value={companyInfo.workingHourTo}
                  onChange={(next) =>
                    setCompanyInfo((c) => ({ ...c, workingHourTo: normalizeTimeHHMM(next) }))
                  }
                  options={quarterHourTimeOptions}
                />
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-4 sm:p-5">
                <div className="mb-4 space-y-1">
                  <p className="text-sm font-medium text-foreground">Out of working hours</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Visits outside this window use the surcharge below (percentage on base price, or a fixed MYR add-on
                    per job).
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-x-0 gap-y-4 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-4">
                  <div className="min-w-0">
                    <QuarterHourTimeSelect
                      id="ooh-from"
                      label="Out-of-hours from"
                      value={companyInfo.outOfWorkingHourFrom}
                      onChange={(next) =>
                        setCompanyInfo((c) => ({ ...c, outOfWorkingHourFrom: normalizeTimeHHMM(next) }))
                      }
                      options={quarterHourTimeOptions}
                    />
                  </div>
                  <div className="min-w-0">
                    <QuarterHourTimeSelect
                      id="ooh-to"
                      label="Out-of-hours to"
                      value={companyInfo.outOfWorkingHourTo}
                      onChange={(next) =>
                        setCompanyInfo((c) => ({ ...c, outOfWorkingHourTo: normalizeTimeHHMM(next) }))
                      }
                      options={quarterHourTimeOptions}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed sm:col-span-2">
                    If the range crosses midnight (e.g. 22:00–06:00), set from/to accordingly; pricing logic may treat
                    it as one continuous window.
                  </p>
                  <div className="flex min-w-0 flex-col gap-2 sm:max-w-none">
                    <Label htmlFor="ooh-markup-type" className="text-sm">
                      Surcharge type
                    </Label>
                    <p className="text-xs text-muted-foreground sm:min-h-[2.5rem]">
                      Percentage on base price, or a fixed MYR amount per job.
                    </p>
                    <Select
                      value={companyInfo.outOfWorkingHourMarkupMode}
                      onValueChange={(v) =>
                        setCompanyInfo((c) => ({
                          ...c,
                          outOfWorkingHourMarkupMode: v as 'percentage' | 'fixed_amount',
                        }))
                      }
                    >
                      <SelectTrigger id="ooh-markup-type" className="h-10 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed_amount">Fixed amount (MYR)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor="ooh-markup-val" className="text-sm">
                      {companyInfo.outOfWorkingHourMarkupMode === 'fixed_amount'
                        ? 'Amount (MYR)'
                        : 'Markup (%)'}
                    </Label>
                    <p className="text-xs text-muted-foreground sm:min-h-[2.5rem]">
                      {companyInfo.outOfWorkingHourMarkupMode === 'fixed_amount'
                        ? 'Fixed add-on for out-of-hours jobs (e.g. 50).'
                        : 'On top of base price (e.g. 25 = 25%).'}
                    </p>
                    <Input
                      id="ooh-markup-val"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      className="h-10"
                      placeholder={companyInfo.outOfWorkingHourMarkupMode === 'fixed_amount' ? 'e.g. 50' : 'e.g. 25'}
                      value={companyInfo.outOfWorkingHourMarkupValue}
                      onChange={(e) =>
                        setCompanyInfo((c) => ({ ...c, outOfWorkingHourMarkupValue: e.target.value }))
                      }
                    />
                  </div>
                  <div
                    className={cn(
                      'sm:col-span-2 rounded-md border p-3 text-xs leading-relaxed',
                      surchargeApplySummary.tone === 'warning' &&
                        'border-amber-500/40 bg-amber-500/[0.06] text-foreground',
                      surchargeApplySummary.tone === 'muted' && 'border-border bg-muted/40 text-muted-foreground',
                      surchargeApplySummary.tone === 'ok' && 'border-primary/20 bg-muted/30 text-foreground'
                    )}
                  >
                    <p className="font-medium text-[11px] uppercase tracking-wide text-muted-foreground">
                      Surcharge summary
                    </p>
                    {surchargeApplySummary.lines.map((line, i) => (
                      <p key={i} className={i > 0 ? 'mt-1.5' : 'mt-1'}>
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
              <Separator />
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Company logo</Label>
                  <p className="text-xs text-muted-foreground">Uploaded to OSS; URL stored in company profile.</p>
                  <label className="relative flex flex-col items-center justify-center w-full min-h-[9rem] border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary transition-colors bg-muted/30 overflow-hidden">
                    {companyInfo.logoUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={companyInfo.logoUrl}
                          alt="Company logo"
                          className="w-full max-h-40 object-contain p-2"
                        />
                        <button
                          type="button"
                          className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1.5 shadow"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setCompanyInfo((c) => ({ ...c, logoUrl: '' }))
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                        <span className="text-xs text-muted-foreground">
                          {uploadingLogo ? 'Uploading…' : 'Click to upload logo'}
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingLogo}
                      onChange={(e) => void handleLogoFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                <div className="space-y-2">
                  <Label>Company chop (stamp)</Label>
                  <p className="text-xs text-muted-foreground">
                    Used in agreements as <code className="text-[10px]">{'{{operator_chop}}'}</code> when saved.
                  </p>
                  <label className="relative flex flex-col items-center justify-center w-full min-h-[9rem] border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary transition-colors bg-muted/30 overflow-hidden">
                    {companyInfo.chopUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={companyInfo.chopUrl}
                          alt="Company chop"
                          className="w-full max-h-40 object-contain p-2"
                        />
                        <button
                          type="button"
                          className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1.5 shadow"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setCompanyInfo((c) => ({ ...c, chopUrl: '' }))
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                        <span className="text-xs text-muted-foreground">
                          {uploadingChop ? 'Uploading…' : 'Click to upload chop'}
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingChop}
                      onChange={(e) => void handleChopFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
              </div>
              <Separator />
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bank">Bank name</Label>
                  <p className="text-xs text-muted-foreground">Options loaded from MySQL bankdetail.</p>
                  <Select
                    value={companyInfo.bankdetailId?.trim() ? companyInfo.bankdetailId : BANK_SELECT_NONE}
                    onValueChange={(v) =>
                      setCompanyInfo({ ...companyInfo, bankdetailId: v === BANK_SELECT_NONE ? '' : v })
                    }
                  >
                    <SelectTrigger id="bank">
                      <SelectValue placeholder="Select bank" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BANK_SELECT_NONE}>Select bank</SelectItem>
                      {bankOptions.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="account-number">Account Number</Label>
                  <Input
                    id="account-number"
                    value={companyInfo.accountNumber}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, accountNumber: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="account-holder">Account Holder</Label>
                  <Input
                    id="account-holder"
                    value={companyInfo.accountHolder}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, accountHolder: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSave}>Save Changes</Button>
              </div>

              <Dialog
                open={clnCompanyEmailDialogOpen}
                onOpenChange={(o) => {
                  setClnCompanyEmailDialogOpen(o)
                  if (!o) {
                    setClnCompanyEmailStep('enter')
                    setClnCompanyEmailCode('')
                    setClnCompanyEmailDoneEffectiveAt(null)
                  }
                }}
              >
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Change company email</DialogTitle>
                    <DialogDescription>
                      We send a code to the new inbox. After you verify, the switch is scheduled for 7 days later. Your
                      master login and portal account email will match the new address when it applies.
                    </DialogDescription>
                  </DialogHeader>
                  {clnCompanyEmailStep === 'enter' && (
                    <div className="space-y-3 py-1">
                      <div>
                        <Label htmlFor="cln-company-email-new">New email</Label>
                        <Input
                          id="cln-company-email-new"
                          type="email"
                          autoComplete="email"
                          value={clnCompanyEmailNew}
                          onChange={(e) => setClnCompanyEmailNew(e.target.value)}
                          className="mt-1"
                          placeholder="new@company.com"
                        />
                      </div>
                      <DialogFooter className="gap-2 sm:gap-0">
                        <Button type="button" variant="outline" onClick={() => setClnCompanyEmailDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button type="button" onClick={() => void sendClnCompanyEmailTac()} disabled={clnCompanyEmailBusy}>
                          {clnCompanyEmailBusy ? 'Sending…' : 'Send verification code'}
                        </Button>
                      </DialogFooter>
                    </div>
                  )}
                  {clnCompanyEmailStep === 'code' && (
                    <div className="space-y-3 py-1">
                      <p className="text-sm text-muted-foreground">
                        Enter the code sent to <strong>{clnCompanyEmailNew.trim()}</strong>.
                      </p>
                      <div>
                        <Label htmlFor="cln-company-email-code">Verification code</Label>
                        <Input
                          id="cln-company-email-code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={clnCompanyEmailCode}
                          onChange={(e) => setClnCompanyEmailCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                          className="mt-1 font-mono tracking-widest"
                          placeholder="6-digit code"
                        />
                      </div>
                      <DialogFooter className="gap-2 sm:gap-0">
                        <Button type="button" variant="outline" onClick={() => setClnCompanyEmailStep('enter')}>
                          Back
                        </Button>
                        <Button type="button" onClick={() => void confirmClnCompanyEmailTac()} disabled={clnCompanyEmailBusy}>
                          {clnCompanyEmailBusy ? 'Verifying…' : 'Verify and schedule'}
                        </Button>
                      </DialogFooter>
                    </div>
                  )}
                  {clnCompanyEmailStep === 'done' && (
                    <div className="space-y-3 py-1">
                      <p className="text-sm text-foreground">
                        Your company email change is scheduled.
                        {clnCompanyEmailDoneEffectiveAt ? (
                          <>
                            {' '}
                            It will apply on{' '}
                            <strong>
                              {new Date(clnCompanyEmailDoneEffectiveAt).toLocaleString(undefined, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </strong>
                            . Until then, keep signing in with your current email.
                          </>
                        ) : null}
                      </p>
                      <DialogFooter>
                        <Button type="button" onClick={() => setClnCompanyEmailDialogOpen(false)}>
                          Done
                        </Button>
                      </DialogFooter>
                    </div>
                  )}
                </DialogContent>
              </Dialog>

              <AlertDialog open={clnCompanyEmailCancelOpen} onOpenChange={setClnCompanyEmailCancelOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel scheduled email change?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the scheduled switch to{' '}
                      <strong>{clnCompanyEmailPending?.newEmail ?? 'the new address'}</strong>. You will keep using your
                      current company email to sign in.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={clnCompanyEmailCancelBusy}>Keep scheduled change</AlertDialogCancel>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={clnCompanyEmailCancelBusy}
                      onClick={() => void submitCancelClnCompanyEmailChange()}
                    >
                      {clnCompanyEmailCancelBusy ? 'Cancelling…' : 'Yes, cancel change'}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integration" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Integration
              </CardTitle>
              <CardDescription>
                CleanLemons will use its own platform env keys (not colivingplatform) when enabled.
              </CardDescription>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  { key: 'stripe', label: 'Stripe' },
                  { key: 'xendit', label: 'Xendit' },
                  { key: 'bukku', label: 'Bukku' },
                  { key: 'xero', label: 'Xero' },
                  { key: 'ai', label: OPERATOR_SCHEDULE_AI_DISPLAY_NAME },
                  { key: 'googleDrive', label: 'Google Drive' },
                  { key: 'ttlock', label: 'TTLock' },
                ].map((item) => {
                  const connected = integrationState[item.key as keyof typeof integrationState]
                  return (
                    <span key={item.key} className="inline-flex items-center gap-1 text-xs">
                      {connected ? <CheckCircle size={12} className="text-green-600" /> : <XCircle size={12} className="text-muted-foreground" />}
                      <span className={connected ? "text-green-600 font-medium" : "text-muted-foreground"}>{item.label}</span>
                    </span>
                  )
                })}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Payment Gateway</p>
                </div>
                <p className="text-xs text-muted-foreground">Only one provider can be connected at a time.</p>
                <div className="p-4 border border-border rounded-xl flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                      <DollarSign size={18} style={{ color: "var(--brand)" }} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm">Payment gateway</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Stripe: connect your own account (OAuth). Xendit: your own keys + webhook URL (same idea as Coliving
                        company settings).
                      </p>
                      <div className="flex items-center gap-1 mt-1.5">
                        {connectedPaymentProvider ? (
                          <>
                            <CheckCircle
                              size={12}
                              className={xenditPendingVerification ? 'text-amber-600' : 'text-green-600'}
                            />
                            <span
                              className={`text-xs font-medium ${xenditPendingVerification ? 'text-amber-700' : 'text-green-600'}`}
                            >
                              {connectedPaymentProvider === 'stripe'
                                ? 'Connected (Stripe)'
                                : xenditPendingVerification
                                  ? 'Xendit: credentials saved — verify webhook'
                                  : 'Connected (Xendit)'}
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
                  {connectedPaymentProvider ? (
                    <Button
                      size="sm"
                      variant={xenditPendingVerification ? 'default' : 'outline'}
                      className="shrink-0"
                      style={xenditPendingVerification ? { background: 'var(--brand)' } : undefined}
                      onClick={openPaymentGatewayManageDialog}
                    >
                      {xenditPendingVerification ? 'Continue setup' : 'Manage'}
                    </Button>
                  ) : (
                    <Button size="sm" style={{ background: 'var(--brand)' }} onClick={openPaymentConnectDialog}>
                      Connect
                    </Button>
                  )}
                </div>
              </div>

              {!subscriptionLoading && planAllowsAccounting(subscriptionItem?.planCode) ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Accounting</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Only one provider can be connected at a time.</p>
                  <div className="p-4 border border-border rounded-xl flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                        <BookOpen size={18} style={{ color: "var(--brand)" }} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm">Accounting</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">Connect one accounting system (Bukku or Xero).</p>
                        <div className="flex items-center gap-1 mt-1.5">
                          {connectedAccountingProvider ? (
                            <>
                              <CheckCircle size={12} className="text-green-600" />
                              <span className="text-xs text-green-600 font-medium">Connected ({connectedAccountingProvider === 'bukku' ? 'Bukku' : 'Xero'})</span>
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
                    {connectedAccountingProvider ? (
                      <Button size="sm" variant="outline" onClick={() => void disconnectAccounting()}>
                        Disconnect
                      </Button>
                    ) : (
                      <Button size="sm" onClick={openAccountingConnectDialog}>
                        Connect
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                <p className="text-sm font-medium">{OPERATOR_SCHEDULE_AI_DISPLAY_NAME}</p>
                <div className="p-4 border border-border rounded-xl flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                      <Bot size={18} style={{ color: "var(--brand)" }} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm">{OPERATOR_SCHEDULE_AI_DISPLAY_NAME}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Connect AI model provider and API key for schedule assistant &amp; automation
                      </p>
                      <div className="flex items-center gap-1 mt-1.5">
                        {integrationState.ai ? (
                          <>
                            <CheckCircle size={12} className="text-green-600" />
                            <span className="text-xs text-green-600 font-medium">
                              Connected ({aiProviderConnected === 'openai' ? 'OpenAI' : aiProviderConnected === 'gemini' ? 'Gemini' : 'DeepSeek'}{aiApiKeySet ? ' + API key' : ''})
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
                  {integrationState.ai ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={openAiSetupDialog}>Manage</Button>
                      <Button size="sm" variant="outline" onClick={disconnectAiProvider}>Disconnect</Button>
                    </div>
                  ) : (
                    <Button size="sm" onClick={openAiSetupDialog}>Connect</Button>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium">Storage</p>
                <div className="p-4 border border-border rounded-xl flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                      <HardDrive size={18} style={{ color: "var(--brand)" }} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm">Google Drive</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">Store templates and generated files</p>
                      <div className="flex items-center gap-1 mt-1.5">
                        {integrationState.googleDrive ? <><CheckCircle size={12} className="text-green-600" /><span className="text-xs text-green-600 font-medium">Connected</span></> : <><XCircle size={12} className="text-muted-foreground" /><span className="text-xs text-muted-foreground">Not connected</span></>}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={integrationState.googleDrive ? 'outline' : 'default'}
                    onClick={() => void (integrationState.googleDrive ? disconnectGoogleDriveFlow() : connectGoogleDriveFlow())}
                  >
                    {integrationState.googleDrive ? 'Disconnect' : 'Connect'}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium">Smart door</p>
                <div className="p-4 border border-border rounded-xl space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--brand-light)' }}>
                        <Lock size={18} style={{ color: 'var(--brand)' }} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm">TTLock</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Connect one or more TTLock Open Platform accounts (same idea as client Integration). Each login gets a label; token stored per account.
                        </p>
                        <div className="flex items-center gap-1 mt-1.5">
                          {integrationState.ttlock ? (
                            <>
                              <CheckCircle size={12} className="text-green-600" />
                              <span className="text-xs text-green-600 font-medium">At least one account connected</span>
                            </>
                          ) : (
                            <>
                              <XCircle size={12} className="text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">No accounts connected</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button size="sm" className="shrink-0 self-end sm:self-auto" onClick={openTtlockConnectDialog}>
                      Connect TTLock
                    </Button>
                  </div>
                  {connectedTtlockRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No TTLock accounts yet. Use Connect TTLock to add one.</p>
                  ) : (
                    <ul className="space-y-2">
                      {connectedTtlockRows.map((a) => (
                        <li
                          key={`op-ttlock-${a.slot}`}
                          className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground text-sm">
                                {a.accountName?.trim() || 'TTLock account'}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                Manual
                              </Badge>
                              <span className="inline-flex items-center gap-1 text-xs text-green-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Connected
                              </span>
                            </div>
                            {a.username?.trim() ? (
                              <p className="truncate font-mono text-xs text-muted-foreground">{a.username}</p>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0 self-end sm:self-auto"
                            onClick={() => openTtlockManageForSlot(a.slot)}
                          >
                            Manage
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscription" className="mt-6 space-y-6">
          {/* Current Plan */}
          <Card className="border-primary">
            <CardHeader className="space-y-3 pb-2 sm:pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-lg">Current Plan</CardTitle>
                  <CardDescription className="mt-1">
                    {subscriptionLoading
                      ? 'Loading subscription from backend...'
                      : `You are on the ${apiPlanCodeToDisplayName(subscriptionItem?.planCode ?? uiPlanToApiPlan(currentUiPlan))} plan`}
                  </CardDescription>
                </div>
                <Badge className="w-fit shrink-0 bg-accent px-3 py-1 text-base font-semibold tracking-wide text-accent-foreground sm:text-lg">
                  {apiPlanCodeToDisplayName(subscriptionItem?.planCode ?? uiPlanToApiPlan(currentUiPlan))}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-4 border-t border-border/60 pt-4 sm:flex-row sm:items-start sm:justify-between sm:border-t-0 sm:pt-0">
                <div className="min-w-0">
                  {String(subscriptionItem?.billingCycle || 'monthly').toLowerCase() === 'yearly' ? (
                    <>
                      <p className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                        RM {Number(subscriptionItem?.monthlyPrice || 0).toLocaleString()}
                        <span className="text-base font-semibold text-muted-foreground sm:text-lg">/mo</span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        RM {Math.round(Number(subscriptionItem?.monthlyPrice || 0) * 12).toLocaleString()}
                        /year · yearly billing
                      </p>
                    </>
                  ) : String(subscriptionItem?.billingCycle || '').toLowerCase() === 'quarterly' ? (
                    <>
                      <p className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                        RM {Number(subscriptionItem?.monthlyPrice || 0).toLocaleString()}
                        <span className="text-base font-semibold text-muted-foreground sm:text-lg">/mo</span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        RM {Math.round(Number(subscriptionItem?.monthlyPrice || 0) * 3).toLocaleString()}
                        /quarter · quarterly billing
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                        RM {Number(subscriptionItem?.monthlyPrice || 0).toLocaleString()}
                        <span className="text-base font-semibold text-muted-foreground sm:text-lg">/mo</span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">Billed monthly</p>
                    </>
                  )}
                </div>
                <div className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5 sm:border-0 sm:bg-transparent sm:p-0 sm:text-right">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">{subscriptionItem?.status || 'pending'}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Renews / expires</p>
                  <p className="font-medium tabular-nums">{subscriptionItem?.expiryDate || '—'}</p>
                </div>
              </div>
              <p className="hidden text-xs text-muted-foreground sm:block">
                <span className="font-medium text-foreground">Renew</span> extends from expiry by the billing period you choose (monthly / quarterly / yearly).{' '}
                <span className="font-medium text-foreground">Upgrade</span> applies a higher plan from today.
              </p>
              <Collapsible className="group sm:hidden">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-xs font-medium text-foreground">
                  Renew &amp; upgrade — how it works
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Renew</span> extends from expiry by the period you pick.{' '}
                  <span className="font-medium text-foreground">Upgrade</span> starts the higher plan from today.
                </CollapsibleContent>
              </Collapsible>
              <div>
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => startSubscriptionCheckout(currentUiPlan, hasActiveSubscriptionPeriod ? 'renew' : 'subscribe')}
                  disabled={
                    subscriptionLoading ||
                    checkoutBusyKey === `${currentUiPlan}-renew` ||
                    checkoutBusyKey === `${currentUiPlan}-subscribe`
                  }
                >
                  {checkoutBusyKey === `${currentUiPlan}-renew` || checkoutBusyKey === `${currentUiPlan}-subscribe`
                    ? 'Redirecting to Stripe...'
                    : hasActiveSubscriptionPeriod
                      ? 'Renew on Stripe'
                      : 'Subscribe on Stripe'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col items-center gap-3 py-4">
            <p className="hidden px-1 text-center text-sm text-muted-foreground sm:block">
              Pay monthly, quarterly, or yearly. Tab defaults to yearly; we sync to your current cycle when your subscription loads.
            </p>
            <p className="px-2 text-center text-xs text-muted-foreground sm:hidden">
              Pick a billing cycle for the prices below. We match your current cycle when data loads.
            </p>
            <Tabs
              value={billingPeriod}
              onValueChange={(v) => {
                if (v === 'monthly' || v === 'quarterly' || v === 'yearly') setBillingPeriod(v)
              }}
              className="w-full max-w-md"
            >
              <TabsList className="grid w-full grid-cols-3 h-auto p-1">
                <TabsTrigger value="monthly" className="text-xs sm:text-sm">
                  Monthly
                </TabsTrigger>
                <TabsTrigger value="quarterly" className="text-xs sm:text-sm">
                  Quarterly
                </TabsTrigger>
                <TabsTrigger value="yearly" className="text-xs sm:text-sm gap-1">
                  Yearly
                  <span className="hidden sm:inline text-[10px] font-bold uppercase text-primary">Save</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <Card className="border-dashed bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">What each tier includes</CardTitle>
              <CardDescription className="text-xs leading-snug sm:text-sm sm:leading-relaxed">
                <span className="sm:hidden">Same app on every tier; Starter → Growth → Enterprise adds accounting, then KPI / Dobi / branding &amp; more.</span>
                <span className="hidden sm:inline">
                  Same core product on every plan: one operator account with one login email, staff punch card, and the full operational feature set below — except where noted.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-0 pt-0 text-muted-foreground">
              <div className="hidden space-y-3 text-sm sm:block">
                <p>
                  <span className="font-semibold text-foreground">Starter</span> — Everything listed on the Starter card.
                  No accounting integration (no Bukku / Xero link).
                </p>
                <p>
                  <span className="font-semibold text-foreground">Growth</span> — Everything in Starter, plus{' '}
                  <span className="font-medium text-foreground">accounting integration (Bukku &amp; Xero)</span>.
                </p>
                <p>
                  <span className="font-semibold text-foreground">Enterprise</span> — Everything in Growth, plus{' '}
                  <span className="font-medium text-foreground">
                    KPI Settings, Dobi &amp; Driver management, customization (branding, fields &amp; workflows)
                  </span>
                  , priority support, and custom reports.
                </p>
              </div>
              <Collapsible className="group sm:hidden">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-background/80 px-3 py-2.5 text-left text-xs font-medium text-foreground">
                  View Starter vs Growth vs Enterprise
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 space-y-2.5 text-xs leading-snug">
                  <p>
                    <span className="font-semibold text-foreground">Starter</span> — Full ops; no Bukku / Xero.
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">Growth</span> — + accounting (Bukku &amp; Xero).
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">Enterprise</span> — + KPI, Dobi/Driver, branding &amp; workflows, priority support, custom reports.
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* Plans — amounts from `cln_pricingplan` when available */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 md:items-stretch">
            {PRICING_PLANS.map((plan) => {
              const apiCode = uiPlanToApiPlan(plan.plan)
              const am = clnPlanAmounts?.[apiCode]
              const price = am?.month && am.month > 0 ? am.month : plan.price
              const quarterlyPrice = am?.quarter && am.quarter > 0 ? am.quarter : plan.quarterlyPrice
              const yearlyPrice = am?.year && am.year > 0 ? am.year : plan.yearlyPrice
              const Icon = getPlanIcon(plan.plan)
              const isCurrentPlan = plan.plan === currentUiPlan
              const rank = planRankUi(plan.plan)
              const curRank = planRankUi(currentUiPlan)
              const isDowngrade = hasActiveSubscriptionPeriod && rank < curRank
              const displayMo =
                billingPeriod === 'yearly'
                  ? Math.round(yearlyPrice / 12)
                  : billingPeriod === 'quarterly'
                    ? Math.round(quarterlyPrice / 3)
                    : price
              let ctaLabel = 'Subscribe'
              let ctaAction: 'subscribe' | 'renew' | 'upgrade' = 'subscribe'
              let ctaDisabled = subscriptionLoading
              if (hasActiveSubscriptionPeriod) {
                if (isDowngrade) {
                  ctaLabel = 'Not available'
                  ctaDisabled = true
                } else if (isCurrentPlan) {
                  ctaLabel = 'Renew plan'
                  ctaAction = 'renew'
                } else {
                  ctaLabel = 'Upgrade'
                  ctaAction = 'upgrade'
                }
              }
              const busy = checkoutBusyKey === `${plan.plan}-${ctaAction}`

              return (
                <Card 
                  key={plan.plan} 
                  className={`relative flex h-full flex-col ${isCurrentPlan ? 'border-primary shadow-lg' : ''} ${isDowngrade ? 'opacity-60' : ''}`}
                >
                  {isCurrentPlan && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary">Current Plan</Badge>
                    </div>
                  )}
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-lg ${
                        plan.plan === 'basic' ? 'bg-gray-100' :
                        plan.plan === 'grow' ? 'bg-accent/30' :
                        'bg-primary/10'
                      }`}>
                        <Icon className={`h-5 w-5 ${
                          plan.plan === 'basic' ? 'text-gray-600' :
                          plan.plan === 'grow' ? 'text-accent-foreground' :
                          'text-primary'
                        }`} />
                      </div>
                      <CardTitle>{pricingTierDisplayName(plan.plan)}</CardTitle>
                    </div>
                    <div className="mt-4">
                      <p className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
                        RM {displayMo.toLocaleString()}
                        <span className="text-base sm:text-lg font-semibold text-muted-foreground">/mo</span>
                      </p>
                      {billingPeriod === 'monthly' && (
                        <p className="text-sm text-muted-foreground mt-1">RM {price.toLocaleString()}/month</p>
                      )}
                      {billingPeriod === 'quarterly' && (
                        <p className="text-sm text-muted-foreground mt-1">RM {quarterlyPrice.toLocaleString()}/quarter</p>
                      )}
                      {billingPeriod === 'yearly' && (
                        <p className="text-sm text-muted-foreground mt-1">RM {yearlyPrice.toLocaleString()}/year</p>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-4 pt-0">
                    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-muted/30 p-3 sm:p-4 shadow-inner">
                      <p className="text-xs font-semibold text-foreground mb-2">Feature checklist</p>
                      <div className="max-h-[min(52vh,28rem)] space-y-4 overflow-y-auto pr-1">
                        {getSubscriptionPlanFeatureSegments(plan.plan).map((segment) => (
                          <div key={segment.title}>
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary mb-2">
                              {segment.title}
                            </p>
                            <ul className="space-y-1.5">
                              {segment.items.map((feature, idx) => (
                                <li
                                  key={`${segment.title}-${idx}`}
                                  className="flex items-start gap-2 text-[13px] leading-snug text-foreground"
                                >
                                  <Check className="h-3.5 w-3.5 shrink-0 text-green-600 mt-0.5" strokeWidth={2.5} />
                                  <span>{feature}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Button
                      className="mt-auto w-full"
                      variant={isCurrentPlan ? 'outline' : 'default'}
                      disabled={ctaDisabled || busy || (hasActiveSubscriptionPeriod && isDowngrade)}
                      title={isDowngrade ? 'Downgrade is not available. Renew your current plan or upgrade.' : undefined}
                      onClick={() => !isDowngrade && startSubscriptionCheckout(plan.plan, ctaAction)}
                    >
                      {busy ? 'Redirecting…' : ctaLabel}
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Addons */}
          <Card>
            <CardHeader className="space-y-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 shrink-0" />
                Add-ons
              </CardTitle>
              <CardDescription className="text-sm leading-snug">
                <span className="font-medium text-foreground">Yearly main plan only.</span>{' '}
                <span className="text-muted-foreground">Prices prorate to your renewal date.</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Collapsible className="group rounded-lg border border-border/60 bg-muted/20">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-foreground sm:py-2">
                  <span>Technical details (proration &amp; Stripe)</span>
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-border/60 px-3 pb-3 pt-2">
                  <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
                    List prices are yearly; the charge is prorated by days left until your main subscription expiry.
                    Monthly or quarterly main plans must switch to yearly before add-ons. Checkout is on Stripe (dynamic
                    line items).
                  </p>
                </CollapsibleContent>
              </Collapsible>
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                {addonCatalog.map((addon) => {
                  const isActive = currentAddonCodes.includes(addon.addonCode.toLowerCase())
                  const q = addonQuotes[addon.addonCode]
                  const busy = checkoutBusyKey === `addon-${addon.addonCode}`
                  const canPay =
                    hasActiveSubscriptionPeriod &&
                    !isActive &&
                    q?.amountDueMyr != null &&
                    !q?.reason
                  return (
                    <div
                      key={addon.id}
                      className={`rounded-lg border-2 p-3 sm:p-4 ${
                        isActive ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <h4 className="font-medium leading-tight">{addon.title}</h4>
                        {isActive ? <Badge className="shrink-0 bg-primary">Active</Badge> : null}
                      </div>
                      {addon.description ? (
                        <p className="mb-2 line-clamp-2 text-xs text-muted-foreground sm:line-clamp-none">{addon.description}</p>
                      ) : null}
                      <dl className="mb-3 space-y-1.5 text-xs sm:text-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                          <dt className="text-muted-foreground">List / year</dt>
                          <dd className="font-medium tabular-nums text-foreground">
                            RM{' '}
                            {addon.amountMyr.toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 2,
                            })}
                          </dd>
                        </div>
                        <div className="text-muted-foreground">
                          {addonQuotesLoading && !q ? (
                            <span>Calculating…</span>
                          ) : q?.reason ? (
                            <span className="text-amber-700 dark:text-amber-400">
                              {q.reason === 'ADDON_ALREADY_ACTIVE'
                                ? 'Already active.'
                                : q.reason === 'ADDON_REQUIRES_YEARLY_SUBSCRIPTION'
                                  ? 'Switch main plan to yearly first.'
                                  : q.reason === 'PRORATION_BELOW_STRIPE_MINIMUM'
                                    ? 'Amount below minimum — renew main plan first.'
                                    : q.reason}
                            </span>
                          ) : q?.amountDueMyr != null ? (
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
                              <span>
                                <span className="text-muted-foreground">Due now</span>{' '}
                                <span className="font-semibold text-foreground">
                                  RM{' '}
                                  {q.amountDueMyr.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </span>
                              </span>
                              {q.daysRemaining != null ? (
                                <span className="text-[11px] text-muted-foreground sm:text-xs">
                                  · {q.daysRemaining}d to renewal
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            '—'
                          )}
                        </div>
                      </dl>
                      <Button
                        size="sm"
                        variant={isActive ? 'outline' : 'default'}
                        className="w-full"
                        disabled={isActive || !canPay || busy}
                        onClick={() => canPay && startAddonCheckout(addon)}
                      >
                        {isActive ? 'Added' : busy ? 'Redirecting…' : 'Pay & add'}
                      </Button>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Billing History</CardTitle>
            </CardHeader>
            <CardContent>
              {saasBillingLoading ? (
                <p className="text-sm text-muted-foreground">Loading billing history…</p>
              ) : saasBillingHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No platform invoices yet. After Stripe checkout or admin billing, rows appear here with invoice ID and
                  link.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left">
                        <th className="p-3 font-medium">Invoice ID</th>
                        <th className="p-3 font-medium">Date</th>
                        <th className="p-3 font-medium">Description</th>
                        <th className="p-3 font-medium text-right">Amount</th>
                        <th className="p-3 font-medium w-[1%] whitespace-nowrap">Invoice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saasBillingHistory.map((row) => (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="p-3 font-mono text-xs align-top">{row.invoiceId?.trim() || '—'}</td>
                          <td className="p-3 whitespace-nowrap align-top">
                            {row.createdAt
                              ? new Date(row.createdAt).toLocaleDateString('en-MY', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                })
                              : '—'}
                          </td>
                          <td className="p-3 align-top">
                            <p className="font-medium">{row.itemLabel}</p>
                          </td>
                          <td className="p-3 text-right tabular-nums align-top">
                            {row.amountMyr != null
                              ? `MYR ${Number(row.amountMyr).toLocaleString('en-MY', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`
                              : '—'}
                          </td>
                          <td className="p-3 align-top">
                            {row.invoiceUrl?.trim() ? (
                              <Button variant="outline" size="sm" asChild>
                                <a href={row.invoiceUrl.trim()} target="_blank" rel="noopener noreferrer">
                                  Invoice
                                  <ExternalLink className="ml-1 h-3 w-3" />
                                </a>
                              </Button>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={showPaymentDialog}
        onOpenChange={(open) => {
          setShowPaymentDialog(open)
          if (!open) {
            setPaymentGatewayStep('choose')
            setPaymentGatewayFromManage(false)
            setXenditSecretInput('')
            setXenditCallbackTokenInput('')
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {paymentGatewayStep === 'stripe-manage'
                ? 'Stripe'
                : paymentGatewayStep === 'xendit-form'
                  ? 'Xendit'
                  : 'Connect payment gateway'}
            </DialogTitle>
            {paymentGatewayStep === 'choose' ? (
              <DialogDescription>
                Stripe uses OAuth to your own Stripe account. Xendit uses your own secret key and callback token; paste
                the webhook URL into Xendit (same pattern as Coliving operator company).
              </DialogDescription>
            ) : paymentGatewayStep === 'stripe-manage' ? (
              <DialogDescription>Stripe Connect is active for this company. Disconnect here if you need to switch gateway.</DialogDescription>
            ) : (
              <DialogDescription>
                The server never returns your full secret. When a value is already stored, the inputs are pre-filled with
                dots + last characters — paste a full new key or token to replace; you can change one or both before Save.
              </DialogDescription>
            )}
          </DialogHeader>
          {paymentGatewayStep === 'stripe-manage' ? (
            <>
              <div className="rounded-lg border p-4 space-y-3">
                <p className="text-sm text-muted-foreground">Funds use your connected Stripe account for client invoice card payments.</p>
              </div>
              <Button
                type="button"
                variant="destructive"
                className="w-full"
                onClick={() =>
                  void disconnectPayment().then(() => {
                    setShowPaymentDialog(false)
                  })
                }
              >
                Disconnect Stripe
              </Button>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowPaymentDialog(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : paymentGatewayStep === 'choose' ? (
            <>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  className={`w-full border rounded-lg p-3 text-left ${selectedPaymentProvider === 'stripe' ? 'border-primary bg-primary/5' : 'border-border'}`}
                  onClick={() => setSelectedPaymentProvider('stripe')}
                >
                  <p className="font-medium">Stripe</p>
                  <p className="text-xs text-muted-foreground">Connect your own account (OAuth)</p>
                </button>
                <button
                  type="button"
                  className={`w-full border rounded-lg p-3 text-left ${selectedPaymentProvider === 'xendit' ? 'border-primary bg-primary/5' : 'border-border'}`}
                  onClick={() => setSelectedPaymentProvider('xendit')}
                >
                  <p className="font-medium">Xendit</p>
                  <p className="text-xs text-muted-foreground">Secret key + X-CALLBACK-TOKEN + webhook URL</p>
                </button>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (selectedPaymentProvider === 'stripe') void startStripeConnectOAuth()
                    else {
                      primeXenditCredentialInputs()
                      setPaymentGatewayStep('xendit-form')
                    }
                  }}
                >
                  Continue
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Status</p>
                  <Badge variant={xenditGatewayState.connectionStatus === 'connected' ? 'default' : 'secondary'}>
                    {xenditGatewayStatusLabel}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  <strong>Pending verification</strong> is normal after save: keys are stored, but status becomes{' '}
                  <strong>Connected</strong> only after Xendit sends a server-to-server callback to your webhook URL with
                  the correct <strong>X-CALLBACK-TOKEN</strong>.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Webhook URL</Label>
                <Input readOnly value={clnXenditWebhookUrl || '(set NEXT_PUBLIC_CLEANLEMON_API_URL in portal .env)'} className="mt-1 bg-muted text-xs" />
                {(clnXenditWebhookUrl || '').startsWith('http://localhost') ? (
                  <p className="text-xs text-amber-800">
                    Xendit runs in the cloud: it cannot reach localhost. Use a public URL (e.g. ngrok to port 5000) in
                    Xendit, or test on your deployed API, or status will stay Pending.
                  </p>
                ) : null}
              </div>
              <div>
                <Label className="text-xs font-semibold">Xendit secret key</Label>
                <Input
                  type="password"
                  placeholder="xnd_development_… or xnd_production_…"
                  value={xenditSecretInput}
                  onChange={(e) => setXenditSecretInput(e.target.value)}
                  className="mt-1"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold">X-CALLBACK-TOKEN</Label>
                <Input
                  type="password"
                  placeholder="Paste your X-CALLBACK-TOKEN"
                  value={xenditCallbackTokenInput}
                  onChange={(e) => setXenditCallbackTokenInput(e.target.value)}
                  className="mt-1"
                  autoComplete="off"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Dots in the fields are a saved placeholder (not your full secret). Select all and paste to replace.
              </p>
              <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                In Xendit webhook / callback settings, enable invoice / payment result callbacks (and match this URL
                exactly, including <code className="text-xs">operator_id</code>).
              </div>
              <Button
                className="w-full"
                style={{ background: 'var(--brand)' }}
                disabled={xenditCredentialBusy || !xenditCredentialsSaveEnabled}
                onClick={() => void saveClnXenditCredentialsFromDialog()}
              >
                {xenditCredentialBusy ? 'Saving…' : 'Save Xendit credentials'}
              </Button>
              <p className="text-xs text-muted-foreground">
                After saving, trigger a test callback from Xendit. Status becomes Connected when our server verifies the
                token.
              </p>
              {integrationState.xendit ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  disabled={xenditCredentialBusy}
                  onClick={() => void disconnectPayment().then(() => setShowPaymentDialog(false))}
                >
                  Disconnect Xendit
                </Button>
              ) : null}
              <DialogFooter className="gap-2 sm:gap-0">
                {!paymentGatewayFromManage ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setPaymentGatewayStep('choose')
                        setXenditSecretInput('')
                        setXenditCallbackTokenInput('')
                      }}
                    >
                      Back
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowPaymentDialog(false)}>
                      Close
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setShowPaymentDialog(false)}>
                    Close
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showAccountingDialog} onOpenChange={setShowAccountingDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select accounting provider</DialogTitle>
            <DialogDescription>Choose one provider to connect for accounting.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <button
              type="button"
              className={`w-full border rounded-lg p-3 text-left ${selectedAccountingProvider === 'bukku' ? 'border-primary bg-primary/5' : 'border-border'}`}
              onClick={() => setSelectedAccountingProvider('bukku')}
            >
              <p className="font-medium">Bukku</p>
              <p className="text-xs text-muted-foreground">Secret key + subdomain (same as Coliving)</p>
            </button>
            <button
              type="button"
              className={`w-full border rounded-lg p-3 text-left ${selectedAccountingProvider === 'xero' ? 'border-primary bg-primary/5' : 'border-border'}`}
              onClick={() => setSelectedAccountingProvider('xero')}
            >
              <p className="font-medium">Xero</p>
              <p className="text-xs text-muted-foreground">OAuth — register redirect URL in Xero app</p>
            </button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAccountingDialog(false)}>Cancel</Button>
            <Button onClick={() => void connectSelectedAccountingProvider()}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBukkuDialog} onOpenChange={setShowBukkuDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Bukku</DialogTitle>
            <DialogDescription>Enter your Bukku API secret key and company subdomain.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="bukku-subdomain">Subdomain</Label>
              <Input
                id="bukku-subdomain"
                placeholder="yourcompany"
                value={bukkuSubdomain}
                onChange={(e) => setBukkuSubdomain(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">The part before .bukku.com in your Bukku URL.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bukku-secret">Secret key</Label>
              <Input
                id="bukku-secret"
                type="password"
                placeholder="Bukku secret key"
                value={bukkuToken}
                onChange={(e) => setBukkuToken(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBukkuDialog(false)} disabled={bukkuSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitBukkuConnect()} disabled={bukkuSaving}>
              {bukkuSaving ? 'Saving…' : 'Connect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAiProviderDialog} onOpenChange={setShowAiProviderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select model provider ({OPERATOR_SCHEDULE_AI_DISPLAY_NAME})</DialogTitle>
            <DialogDescription>Choose vendor before entering the API key for {OPERATOR_SCHEDULE_AI_DISPLAY_NAME}.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <button
              type="button"
              className={`w-full border rounded-lg p-3 text-left ${selectedAiProvider === 'openai' ? 'border-primary bg-primary/5' : 'border-border'}`}
              onClick={() => setSelectedAiProvider('openai')}
            >
              <p className="font-medium">OpenAI</p>
              <p className="text-xs text-muted-foreground">ChatGPT / OpenAI models</p>
            </button>
            <button
              type="button"
              className={`w-full border rounded-lg p-3 text-left ${selectedAiProvider === 'deepseek' ? 'border-primary bg-primary/5' : 'border-border'}`}
              onClick={() => setSelectedAiProvider('deepseek')}
            >
              <p className="font-medium">DeepSeek</p>
              <p className="text-xs text-muted-foreground">DeepSeek models</p>
            </button>
            <button
              type="button"
              className={`w-full border rounded-lg p-3 text-left ${selectedAiProvider === 'gemini' ? 'border-primary bg-primary/5' : 'border-border'}`}
              onClick={() => setSelectedAiProvider('gemini')}
            >
              <p className="font-medium">Gemini</p>
              <p className="text-xs text-muted-foreground">Google Gemini models</p>
            </button>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row sm:justify-end">
            {integrationState.ai ? (
              <Button
                type="button"
                variant="destructive"
                className="w-full sm:w-auto sm:mr-auto"
                onClick={() => {
                  void disconnectAiProvider().finally(() => setShowAiProviderDialog(false))
                }}
              >
                Disconnect
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setShowAiProviderDialog(false)}>Cancel</Button>
            <Button onClick={continueAiProviderSelection}>Next</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAiApiKeyDialog} onOpenChange={setShowAiApiKeyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter API key</DialogTitle>
            <DialogDescription>
              Provider: {selectedAiProvider === 'openai' ? 'OpenAI' : selectedAiProvider === 'gemini' ? 'Gemini' : 'DeepSeek'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ai-api-key">API key</Label>
            <Input
              id="ai-api-key"
              type="password"
              placeholder="Paste API key"
              value={aiApiKeyInput}
              onChange={(e) => setAiApiKeyInput(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAiApiKeyDialog(false)}>Cancel</Button>
            <Button onClick={connectAiProvider}>Connect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showTtlockDialog}
        onOpenChange={(open) => {
          setShowTtlockDialog(open)
          if (!open) {
            setTtlockStep('choose')
            setTtlockFormPass('')
            setTtlockAccountName('')
            setManageSlot(null)
            setTtlockViewCreds(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>TTLock</DialogTitle>
            <DialogDescription>
              {ttlockStep === 'manage'
                ? `Manage “${ttlockAccounts.find((x) => x.slot === manageSlot)?.accountName?.trim() || 'this account'}”.`
                : ttlockStep === 'choose'
                  ? 'Register on TTLock first if needed, then log in with your existing account.'
                  : 'Enter a display name and your TTLock username and password. We verify and store the API token.'}
            </DialogDescription>
          </DialogHeader>
          {ttlockStep === 'manage' && manageSlot != null ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-semibold">TTLock username</Label>
                <Input readOnly className="mt-1 bg-muted font-mono text-sm" value={ttlockViewCreds?.username ?? ''} />
              </div>
              <div>
                <Label className="text-xs font-semibold">TTLock password</Label>
                <Input readOnly type="text" className="mt-1 bg-muted font-mono text-sm" value={ttlockViewCreds?.password ?? ''} />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setShowTtlockDialog(false)} disabled={ttlockBusy}>
                  Close
                </Button>
                <Button
                  variant="destructive"
                  disabled={ttlockBusy}
                  onClick={() => void disconnectTtlockAtSlot(manageSlot)}
                >
                  {ttlockBusy ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </DialogFooter>
            </div>
          ) : ttlockStep === 'choose' ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full shrink-0 justify-center sm:flex-1 sm:min-w-0"
                  onClick={() => window.open('https://lock2.ttlock.com/', '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="h-4 w-4 mr-2 shrink-0" />
                  Register new account
                </Button>
                <Button type="button" className="w-full shrink-0 justify-center sm:flex-1 sm:min-w-0" onClick={() => setTtlockStep('existing')}>
                  Log in existing account
                </Button>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowTtlockDialog(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label htmlFor="cln-ttlock-account-name" className="text-xs font-semibold">
                  Account name
                </Label>
                <Input
                  id="cln-ttlock-account-name"
                  autoComplete="off"
                  placeholder="e.g. Main office, Warehouse"
                  value={ttlockAccountName}
                  onChange={(e) => setTtlockAccountName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="cln-ttlock-user" className="text-xs font-semibold">
                  TTLock username
                </Label>
                <Input
                  id="cln-ttlock-user"
                  autoComplete="username"
                  placeholder="TTLock username"
                  value={ttlockFormUser}
                  onChange={(e) => setTtlockFormUser(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="cln-ttlock-pass" className="text-xs font-semibold">
                  TTLock password
                </Label>
                <Input
                  id="cln-ttlock-pass"
                  type="password"
                  autoComplete="current-password"
                  placeholder="TTLock password"
                  value={ttlockFormPass}
                  onChange={(e) => setTtlockFormPass(e.target.value)}
                  className="mt-1"
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" disabled={ttlockBusy} onClick={() => setTtlockStep('choose')}>
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={
                    ttlockBusy ||
                    !ttlockAccountName.trim() ||
                    !ttlockFormUser.trim() ||
                    !ttlockFormPass.trim()
                  }
                  onClick={() => void submitTtlockConnect()}
                >
                  {ttlockBusy ? 'Connecting…' : 'Connect TTLock'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
