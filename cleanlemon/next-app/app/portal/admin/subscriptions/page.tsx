'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ExternalLink, MoreHorizontal, Search, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  addAdminSubscriptionAddon,
  createAdminSubscriptionManual,
  fetchAdminOperatordetailByEmail,
  fetchAdminSubscriptions,
  fetchClmAddonCatalog,
  fetchClnPricingPlans,
  terminateAdminSubscription,
  updateAdminSubscription,
  type AdminSubscription,
  type ClmAddonCatalogItem,
} from '@/lib/cleanlemon-api'
import { CLN_ADDON_CATALOG_FALLBACK, PRICING_PLANS } from '@/lib/types'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

type PlanChangeMode = 'upgrade' | 'renew'
type UiBillingCycle = 'monthly' | 'quarterly' | 'yearly'

type PendingPlanChange = {
  operatorId: string
  email: string
  companyName: string
  planChangeMode: PlanChangeMode
  planCode: string
  monthlyPrice: number
  billingCycle: UiBillingCycle
  activeFrom: string
}

function normalizeUiBillingCycle(c: string | undefined | null): UiBillingCycle {
  const x = String(c || 'monthly').toLowerCase()
  if (x === 'yearly') return 'yearly'
  if (x === 'quarterly') return 'quarterly'
  return 'monthly'
}

function cycleLabel(c: UiBillingCycle): string {
  if (c === 'yearly') return 'yearly'
  if (c === 'quarterly') return 'quarterly'
  return 'monthly'
}

/** Next period end from active_from (same rules as MySQL DATE_ADD in subscriptionPeriodEndExpr). */
function computeNewExpiryDate(activeFromYmd: string, cycle: UiBillingCycle): string {
  const parts = activeFromYmd.split('-').map(Number)
  const dt = new Date(parts[0], parts[1] - 1, parts[2])
  if (cycle === 'yearly') dt.setFullYear(dt.getFullYear() + 1)
  else if (cycle === 'quarterly') dt.setMonth(dt.getMonth() + 3)
  else dt.setMonth(dt.getMonth() + 1)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function catalogPlanRank(planCode: string): number {
  const x = String(planCode || '').toLowerCase()
  if (x === 'starter' || x === 'basic') return 0
  if (x === 'growth' || x === 'grow') return 1
  if (x === 'enterprise' || x === 'scale') return 2
  return 0
}

function dbPlanToCatalogPlan(planCode: string): 'basic' | 'grow' | 'enterprise' {
  const x = String(planCode || '').toLowerCase()
  if (x === 'starter' || x === 'basic') return 'basic'
  if (x === 'growth' || x === 'grow') return 'grow'
  return 'enterprise'
}

/** Maps UI/basic/grow/enterprise or DB starter/growth to catalog API key. */
function uiPlanToApiKey(planInput: string): 'starter' | 'growth' | 'enterprise' {
  const x = String(planInput || '').toLowerCase()
  if (x === 'basic' || x === 'starter') return 'starter'
  if (x === 'grow' || x === 'growth') return 'growth'
  return 'enterprise'
}

type ClnAmountMap = Record<string, { month: number; quarter: number; year: number }> | null

function catalogPeriodAmountForUi(uiPlan: string, cycle: UiBillingCycle, amounts: ClnAmountMap): number {
  const api = uiPlanToApiKey(uiPlan)
  const a = amounts?.[api]
  if (!a) return 0
  if (cycle === 'yearly') return a.year
  if (cycle === 'quarterly') return a.quarter
  return a.month
}

/** Monthly equivalent stored in `cln_operator_subscription.monthly_price` (matches backend). */
function storedMonthlyFromCatalog(
  planInput: string,
  cycle: UiBillingCycle,
  amounts: ClnAmountMap
): number {
  const a = amounts?.[uiPlanToApiKey(planInput)]
  if (a) {
    if (cycle === 'yearly' && a.year > 0) return Number((a.year / 12).toFixed(2))
    if (cycle === 'quarterly' && a.quarter > 0) return Number((a.quarter / 3).toFixed(2))
    if (a.month > 0) return Number(a.month.toFixed(2))
  }
  const key = dbPlanToCatalogPlan(planInput)
  const p = PRICING_PLANS.find((x) => x.plan === key)
  return p ? p.price : 0
}

function money(value: number): string {
  return `RM ${Number(value || 0).toFixed(2)}`
}

/** Price column: catalog amount for operator plan + cycle; fallback stored monthly. */
function formatAdminListPrice(sub: AdminSubscription, amounts: ClnAmountMap): string {
  const cycle = normalizeUiBillingCycle(sub.billingCycle)
  const ui = dbPlanToCatalogPlan(sub.planCode)
  const amt = catalogPeriodAmountForUi(ui, cycle, amounts)
  if (amt > 0) {
    const suf = cycle === 'yearly' ? 'yr' : cycle === 'quarterly' ? 'qtr' : 'mo'
    return `${money(amt)}/${suf}`
  }
  return `${money(sub.monthlyPrice)}/mo`
}

function isOnPlan(sub: AdminSubscription): boolean {
  if (String(sub.status || '').toLowerCase() !== 'active') return false
  if (sub.terminatedAt) return false
  return true
}

const SubscriptionsPage = () => {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterPlan, setFilterPlan] = useState('all')
  const [filterCycle, setFilterCycle] = useState('all')
  const [items, setItems] = useState<AdminSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [error, setError] = useState('')
  const [activeItem, setActiveItem] = useState<AdminSubscription | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [billingOpen, setBillingOpen] = useState(false)
  const [pendingPlanChange, setPendingPlanChange] = useState<PendingPlanChange | null>(null)
  const [terminateOpen, setTerminateOpen] = useState(false)
  const [addonWizardOpen, setAddonWizardOpen] = useState(false)
  const [addonWizardOperatorId, setAddonWizardOperatorId] = useState('')
  const [addonWizardCode, setAddonWizardCode] = useState('')
  const [addonWizardAccounting, setAddonWizardAccounting] = useState<'yes' | 'no'>('no')
  const [addonWizardPaymentMethod, setAddonWizardPaymentMethod] = useState<'bank' | 'cash'>('bank')
  const [manualForm, setManualForm] = useState({
    email: '',
    companyName: '',
    activeFrom: '',
    planCode: 'basic',
    monthlyPrice: '699',
    billingCycle: 'monthly',
    accountingIncluded: 'no' as 'yes' | 'no',
    accountingPaymentMethod: 'bank' as 'bank' | 'cash',
  })
  const [manualEmailLookup, setManualEmailLookup] = useState<'idle' | 'loading' | 'done'>('idle')
  const [manualOperatordetailExists, setManualOperatordetailExists] = useState<boolean | null>(null)
  const [manualSubscriptionSummary, setManualSubscriptionSummary] = useState('')
  const [manualSubscriptionSummaryCode, setManualSubscriptionSummaryCode] = useState('')
  const [editForm, setEditForm] = useState({
    email: '',
    companyName: '',
    activeFrom: '',
    planCode: 'basic',
    monthlyPrice: '699',
    billingCycle: 'monthly',
  })
  const [upgradeMode, setUpgradeMode] = useState<PlanChangeMode>('upgrade')
  const [upgradePlanCode, setUpgradePlanCode] = useState('grow')
  const [upgradeActiveFrom, setUpgradeActiveFrom] = useState('')
  const [upgradeBillingCycle, setUpgradeBillingCycle] = useState<UiBillingCycle>('monthly')
  const [billingKind, setBillingKind] = useState<'foc' | 'manual'>('foc')
  const [billingPaymentMethod, setBillingPaymentMethod] = useState<'bank' | 'cash'>('bank')
  const [billingPaymentDate, setBillingPaymentDate] = useState('')
  const [terminateReason, setTerminateReason] = useState('')
  const [clnPlanAmounts, setClnPlanAmounts] = useState<Record<
    string,
    { month: number; quarter: number; year: number }
  > | null>(null)
  const [clmAddonCatalog, setClmAddonCatalog] = useState<ClmAddonCatalogItem[]>(
    () => CLN_ADDON_CATALOG_FALLBACK as unknown as ClmAddonCatalogItem[]
  )

  const loadItems = async () => {
    setLoading(true)
    setError('')
    const result = await fetchAdminSubscriptions({
      search: searchTerm || undefined,
      plan: filterPlan === 'all' ? undefined : filterPlan,
    })
    if (!result.ok) {
      setError(result.reason || 'LOAD_FAILED')
      setItems([])
      setLoading(false)
      return
    }
    setItems(Array.isArray(result.items) ? result.items : [])
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadItems()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchTerm, filterPlan])

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
      if (cancelled || !r?.ok || !r.items?.length) return
      setClmAddonCatalog(r.items)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const prettyPlan = (planCode: string) => {
    const x = String(planCode || '').toLowerCase()
    if (x === 'grow' || x === 'growth') return 'Grow'
    if (x === 'enterprise' || x === 'scale') return 'Enterprise'
    return 'Basic'
  }

  const getPlanColor = (plan: string) => {
    const x = String(plan || '').toLowerCase()
    if (x === 'basic' || x === 'starter') return 'bg-blue-100 text-blue-800'
    if (x === 'grow' || x === 'growth') return 'bg-yellow-100 text-yellow-800'
    if (x === 'enterprise' || x === 'scale') return 'bg-purple-100 text-purple-800'
    return 'bg-gray-100 text-gray-800'
  }

  const busy = useMemo(() => Boolean(savingKey), [savingKey])

  const manualCreatePriceLabel = useMemo(() => {
    const cyc = normalizeUiBillingCycle(manualForm.billingCycle)
    const periodAmt = catalogPeriodAmountForUi(manualForm.planCode, cyc, clnPlanAmounts)
    const moEq = storedMonthlyFromCatalog(manualForm.planCode, cyc, clnPlanAmounts)
    const suf = cyc === 'yearly' ? '/yr' : cyc === 'quarterly' ? '/qtr' : '/mo'
    if (periodAmt > 0) {
      return `${money(periodAmt)}${suf} (catalog) · stored monthly equivalent ${money(moEq)}/mo`
    }
    return `Stored monthly equivalent ${money(moEq)}/mo`
  }, [manualForm.planCode, manualForm.billingCycle, clnPlanAmounts])

  const upgradablePlans = useMemo(() => {
    if (!activeItem) return []
    const r = catalogPlanRank(activeItem.planCode)
    return PRICING_PLANS.filter((p) => catalogPlanRank(p.plan) > r)
  }, [activeItem])

  const openCreateDialog = () => {
    const cyc: UiBillingCycle = 'monthly'
    const eq = storedMonthlyFromCatalog('basic', cyc, clnPlanAmounts)
    const today = new Date().toISOString().slice(0, 10)
    setManualForm({
      email: '',
      companyName: '',
      activeFrom: today,
      planCode: 'basic',
      monthlyPrice: String(eq > 0 ? eq : 699),
      billingCycle: 'monthly',
      accountingIncluded: 'no',
      accountingPaymentMethod: 'bank',
    })
    setManualEmailLookup('idle')
    setManualOperatordetailExists(null)
    setManualSubscriptionSummary('')
    setManualSubscriptionSummaryCode('')
    setCreateOpen(true)
  }

  const runManualEmailLookup = async () => {
    const e = manualForm.email.trim().toLowerCase()
    if (!e) {
      setError('Enter an email first')
      return
    }
    setManualEmailLookup('loading')
    setError('')
    const res = await fetchAdminOperatordetailByEmail(e)
    setManualEmailLookup('done')
    if (!res.ok) {
      setError(res.reason || 'EMAIL_LOOKUP_FAILED')
      setManualOperatordetailExists(null)
      setManualSubscriptionSummary('')
      setManualSubscriptionSummaryCode('')
      return
    }
    setManualOperatordetailExists(Boolean(res.found))
    if (res.found) {
      setManualForm((s) => ({
        ...s,
        companyName: String(res.companyName || '').trim() || s.companyName,
      }))
      setManualSubscriptionSummary(String(res.subscriptionSummary || '').trim())
      setManualSubscriptionSummaryCode(String(res.subscriptionSummaryCode || '').trim())
    } else {
      setManualForm((s) => ({ ...s, companyName: '' }))
      setManualSubscriptionSummary('')
      setManualSubscriptionSummaryCode('')
    }
  }

  const newPeriodEndPreview = useMemo(() => {
    if (!activeItem || !upgradeOpen) return ''
    const start = upgradeMode === 'renew' ? activeItem.expiryDate || '' : upgradeActiveFrom
    if (!start) return ''
    return computeNewExpiryDate(start, upgradeBillingCycle)
  }, [activeItem, upgradeOpen, upgradeMode, upgradeActiveFrom, upgradeBillingCycle])

  const openEditDialog = (item: AdminSubscription) => {
    setActiveItem(item)
    setEditForm({
      email: item.operatorEmail || '',
      companyName: item.operatorName || '',
      activeFrom: item.activeFrom || '',
      planCode: item.planCode || 'basic',
      monthlyPrice: String(Number(item.monthlyPrice || 0)),
      billingCycle: normalizeUiBillingCycle(item.billingCycle),
    })
    setEditOpen(true)
  }

  const openUpgradeDialog = (item: AdminSubscription) => {
    setActiveItem(item)
    setUpgradeMode('upgrade')
    const r = catalogPlanRank(item.planCode)
    const next = PRICING_PLANS.filter((p) => catalogPlanRank(p.plan) > r)
    setUpgradePlanCode(next[0]?.plan || dbPlanToCatalogPlan(item.planCode))
    setUpgradeActiveFrom(new Date().toISOString().slice(0, 10))
    setUpgradeBillingCycle(normalizeUiBillingCycle(item.billingCycle))
    setUpgradeOpen(true)
  }

  const openTerminateDialog = (item: AdminSubscription) => {
    setActiveItem(item)
    setTerminateReason('')
    setTerminateOpen(true)
  }

  const openAddonWizard = (preselect?: AdminSubscription | null) => {
    setAddonWizardOperatorId(preselect?.operatorId || '')
    setAddonWizardCode('')
    setAddonWizardAccounting('no')
    setAddonWizardPaymentMethod('bank')
    setAddonWizardOpen(true)
  }

  const handleManualCreate = async () => {
    if (manualEmailLookup !== 'done' || manualOperatordetailExists === null) {
      setError('Look up the email first (Check email).')
      return
    }
    if (manualOperatordetailExists === false && !manualForm.companyName.trim()) {
      setError('Company name is required for a new operator.')
      return
    }
    if (!manualForm.activeFrom.trim()) {
      setError('Starting date is required.')
      return
    }
    if (manualForm.accountingIncluded === 'yes' && manualForm.planCode === 'basic') {
      setError('Accounting integration requires Grow or Enterprise — change plan or set Accounting to No.')
      return
    }
    const cycCreate = normalizeUiBillingCycle(manualForm.billingCycle)
    const invoiceAmountMyr = catalogPeriodAmountForUi(manualForm.planCode, cycCreate, clnPlanAmounts)
    setSavingKey('manual-create')
    const result = await createAdminSubscriptionManual({
      email: manualForm.email.trim(),
      companyName: manualForm.companyName.trim(),
      activeFrom: manualForm.activeFrom || undefined,
      planCode: manualForm.planCode,
      monthlyPrice: Number(manualForm.monthlyPrice || 0),
      billingCycle: manualForm.billingCycle as UiBillingCycle,
      createCompanyIfMissing: manualOperatordetailExists === false,
      accountingIncluded: manualForm.accountingIncluded === 'yes',
      ...(manualForm.accountingIncluded === 'yes'
        ? {
            accountingPaymentMethod: manualForm.accountingPaymentMethod,
            invoiceAmountMyr: invoiceAmountMyr > 0 ? invoiceAmountMyr : undefined,
          }
        : {}),
    })
    setSavingKey('')
    if (!result.ok) {
      setError(result.reason || 'MANUAL_CREATE_FAILED')
      return
    }
    setCreateOpen(false)
    const cyc: UiBillingCycle = 'monthly'
    const eq = storedMonthlyFromCatalog('basic', cyc, clnPlanAmounts)
    const today = new Date().toISOString().slice(0, 10)
    setManualForm({
      email: '',
      companyName: '',
      activeFrom: today,
      planCode: 'basic',
      monthlyPrice: String(eq > 0 ? eq : 699),
      billingCycle: 'monthly',
      accountingIncluded: 'no',
      accountingPaymentMethod: 'bank',
    })
    setManualEmailLookup('idle')
    setManualOperatordetailExists(null)
    setManualSubscriptionSummary('')
    setManualSubscriptionSummaryCode('')
    await loadItems()
  }

  const handleEditSubscription = async () => {
    if (!activeItem) return
    setSavingKey(`edit-${activeItem.operatorId}`)
    const result = await updateAdminSubscription(activeItem.operatorId, {
      email: editForm.email.trim(),
      companyName: editForm.companyName.trim(),
      activeFrom: editForm.activeFrom || undefined,
      planCode: editForm.planCode,
      monthlyPrice: Number(editForm.monthlyPrice || 0),
      billingCycle: editForm.billingCycle as UiBillingCycle,
      updatedBy: 'saas-admin',
      note: 'manual_edit',
    })
    setSavingKey('')
    if (!result.ok) {
      setError(result.reason || 'EDIT_SUBSCRIPTION_FAILED')
      return
    }
    setEditOpen(false)
    await loadItems()
  }

  const handleUpgradeContinue = () => {
    if (!activeItem) return
    const cycle = upgradeBillingCycle
    if (upgradeMode === 'renew') {
      const exp = activeItem.expiryDate
      if (!exp) {
        setError('MISSING_EXPIRY_FOR_RENEW')
        return
      }
      setPendingPlanChange({
        operatorId: activeItem.operatorId,
        email: activeItem.operatorEmail || '',
        companyName: activeItem.operatorName || '',
        planChangeMode: 'renew',
        planCode: String(activeItem.planCode || 'basic').toLowerCase(),
        monthlyPrice: storedMonthlyFromCatalog(activeItem.planCode, cycle, clnPlanAmounts),
        billingCycle: cycle,
        activeFrom: exp,
      })
    } else {
      const price = storedMonthlyFromCatalog(upgradePlanCode, cycle, clnPlanAmounts)
      if (catalogPlanRank(upgradePlanCode) <= catalogPlanRank(activeItem.planCode)) {
        setError('UPGRADE_MUST_BE_HIGHER_TIER')
        return
      }
      if (!upgradeActiveFrom.trim()) {
        setError('MISSING_START_DATE')
        return
      }
      setPendingPlanChange({
        operatorId: activeItem.operatorId,
        email: activeItem.operatorEmail || '',
        companyName: activeItem.operatorName || '',
        planChangeMode: 'upgrade',
        planCode: upgradePlanCode,
        monthlyPrice: price,
        billingCycle: cycle,
        activeFrom: upgradeActiveFrom.trim(),
      })
    }
    setError('')
    setUpgradeOpen(false)
    setBillingKind('foc')
    setBillingPaymentMethod('bank')
    setBillingPaymentDate(new Date().toISOString().slice(0, 10))
    setBillingOpen(true)
  }

  const handleBillingConfirm = async () => {
    if (!pendingPlanChange) return
    if (billingKind === 'manual') {
      if (!billingPaymentDate.trim()) {
        setError('MANUAL_BILLING_REQUIRES_PAYMENT')
        return
      }
    }
    setSavingKey(`billing-${pendingPlanChange.operatorId}`)
    const result = await updateAdminSubscription(pendingPlanChange.operatorId, {
      email: pendingPlanChange.email,
      companyName: pendingPlanChange.companyName,
      activeFrom: pendingPlanChange.activeFrom,
      planCode: pendingPlanChange.planCode,
      monthlyPrice: pendingPlanChange.monthlyPrice,
      billingCycle: pendingPlanChange.billingCycle,
      updatedBy: 'saas-admin',
      note: 'plan_change',
      planChangeMode: pendingPlanChange.planChangeMode,
      billingKind,
      paymentMethod: billingKind === 'manual' ? billingPaymentMethod : undefined,
      paymentDate: billingKind === 'manual' ? billingPaymentDate : undefined,
    })
    setSavingKey('')
    if (!result.ok) {
      setError(result.reason || 'PLAN_CHANGE_FAILED')
      return
    }
    setBillingOpen(false)
    setPendingPlanChange(null)
    await loadItems()
  }

  const handleTerminate = async () => {
    if (!activeItem) return
    setSavingKey(`terminate-${activeItem.operatorId}`)
    const result = await terminateAdminSubscription(activeItem.operatorId, {
      terminatedBy: 'saas-admin',
      reason: terminateReason || 'manual_terminate',
    })
    setSavingKey('')
    if (!result.ok) {
      setError(result.reason || 'TERMINATE_FAILED')
      return
    }
    setTerminateOpen(false)
    await loadItems()
  }

  const handleAddonWizardActivate = async () => {
    const oid = String(addonWizardOperatorId || '').trim()
    const code = String(addonWizardCode || '').trim().toLowerCase()
    if (!oid || !code) {
      setError('Choose a client and an add-on.')
      return
    }
    const addonMeta = clmAddonCatalog.find((a) => String(a.addonCode).toLowerCase() === code)
    const addonName = addonMeta?.title || code
    setSavingKey(`addon-wizard-${oid}`)
    const addonAmt = Number(addonMeta?.amountMyr || 0)
    const result = await addAdminSubscriptionAddon(oid, {
      addonCode: code,
      addonName,
      createdBy: 'saas-admin',
      accountingIncluded: addonWizardAccounting === 'yes',
      ...(addonWizardAccounting === 'yes'
        ? {
            accountingPaymentMethod: addonWizardPaymentMethod,
            invoiceAmountMyr: addonAmt > 0 ? addonAmt : undefined,
          }
        : {}),
    })
    setSavingKey('')
    if (!result.ok) {
      setError(result.reason || 'ADDON_CREATE_FAILED')
      return
    }
    setAddonWizardOpen(false)
    await loadItems()
  }

  const filteredSubscriptions = items.filter((sub) => {
    const matchSearch =
      sub.operatorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.operatorEmail.toLowerCase().includes(searchTerm.toLowerCase())
    const matchPlan = filterPlan === 'all' || sub.planCode === filterPlan
    const matchCycle = filterCycle === 'all' || (sub.billingCycle || 'monthly') === filterCycle
    return matchSearch && matchPlan && matchCycle
  })

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Subscriptions</h1>
          <p className="text-muted-foreground">Single plan per operator with manual subscription control</p>
        </div>

        <div className="flex gap-4 mb-6 items-center">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Search operator or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <select
            value={filterPlan}
            onChange={(e) => setFilterPlan(e.target.value)}
            className="px-4 py-2 border border-input rounded-lg bg-background text-foreground"
          >
            <option value="all">All Plans</option>
            <option value="basic">Basic</option>
            <option value="grow">Grow</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <select
            value={filterCycle}
            onChange={(e) => setFilterCycle(e.target.value)}
            className="px-4 py-2 border border-input rounded-lg bg-background text-foreground"
          >
            <option value="all">All Cycles</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
          <Button variant="outline" onClick={() => openAddonWizard(null)} disabled={!items.length}>
            Activate add-on
          </Button>
          <Button onClick={openCreateDialog}>Create Subscription</Button>
        </div>
        {error ? <p className="mb-4 text-sm text-red-600">Error: {error}</p> : null}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-input">
                    <th className="text-left py-3 px-4 font-medium text-foreground">Operator</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Email</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Plan</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Price</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Cycle</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Active Date</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Updated</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Platform invoice</th>
                    <th className="text-right py-3 px-4 font-medium text-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="py-8 px-4 text-center text-muted-foreground">
                        Loading subscriptions...
                      </td>
                    </tr>
                  ) : null}
                  {!loading &&
                    filteredSubscriptions.map((sub) => (
                      <tr key={sub.operatorId} className="border-b border-input hover:bg-muted/50">
                        <td className="py-3 px-4 text-foreground font-medium">{sub.operatorName || sub.operatorId}</td>
                        <td className="py-3 px-4 text-foreground">{sub.operatorEmail || '-'}</td>
                        <td className="py-3 px-4">
                          <Badge className={getPlanColor(sub.planCode)}>{prettyPlan(sub.planCode)}</Badge>
                        </td>
                        <td className="py-3 px-4 text-foreground font-medium">{formatAdminListPrice(sub, clnPlanAmounts)}</td>
                        <td className="py-3 px-4 text-foreground">{sub.billingCycle || 'monthly'}</td>
                        <td className="py-3 px-4 text-foreground">{sub.activeFrom || '-'}</td>
                        <td className="py-3 px-4 text-foreground">{sub.updatedAt || '-'}</td>
                        <td className="py-3 px-4 text-foreground">
                          {sub.saasBukkuInvoiceUrl ? (
                            <a
                              href={sub.saasBukkuInvoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              {sub.saasBukkuInvoiceId ? `#${sub.saasBukkuInvoiceId}` : 'Open'}
                              <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden />
                            </a>
                          ) : sub.saasBukkuInvoiceId ? (
                            <span className="text-muted-foreground">#{sub.saasBukkuInvoiceId}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" disabled={busy}>
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => (isOnPlan(sub) ? openUpgradeDialog(sub) : openEditDialog(sub))}
                              >
                                {isOnPlan(sub) ? 'Upgrade plan' : 'Edit subscription'}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openTerminateDialog(sub)}>
                                Terminate Subscription
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openAddonWizard(sub)}>Add On</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  {!loading && !filteredSubscriptions.length ? (
                    <tr>
                      <td colSpan={9} className="py-8 px-4 text-center text-muted-foreground">
                        No subscription records found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create subscription (manual)</DialogTitle>
            <DialogDescription>
              Look up email against <span className="font-medium">cln_operatordetail</span>, then set plan, billing period, and
              accounting. Price comes from catalog (read-only).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 block">1. Operator email</Label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="name@company.com"
                  value={manualForm.email}
                  onChange={(e) => {
                    setManualForm((s) => ({ ...s, email: e.target.value }))
                    setManualEmailLookup('idle')
                    setManualOperatordetailExists(null)
                    setManualSubscriptionSummary('')
                    setManualSubscriptionSummaryCode('')
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void runManualEmailLookup()}
                  disabled={busy || manualEmailLookup === 'loading' || !manualForm.email.trim()}
                >
                  {manualEmailLookup === 'loading' ? '…' : 'Check email'}
                </Button>
              </div>
              {manualEmailLookup === 'done' && manualOperatordetailExists === true ? (
                <p className="text-xs text-muted-foreground mt-1">Found in company master — name prefilled (editable).</p>
              ) : null}
              {manualEmailLookup === 'done' && manualOperatordetailExists === true && manualSubscriptionSummary ? (
                <div
                  className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
                    manualSubscriptionSummaryCode === 'expired'
                      ? 'border-amber-500/50 bg-amber-50 dark:bg-amber-950/25'
                      : manualSubscriptionSummaryCode === 'active'
                        ? 'border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/25'
                        : manualSubscriptionSummaryCode === 'terminated'
                          ? 'border-destructive/40 bg-destructive/5'
                          : 'border-border bg-muted/50'
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Current subscription status
                  </p>
                  <p className="text-foreground font-medium leading-snug">{manualSubscriptionSummary}</p>
                </div>
              ) : null}
              {manualEmailLookup === 'done' && manualOperatordetailExists === false ? (
                <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">New email — enter company name; a company row will be created.</p>
              ) : null}
            </div>
            <div>
              <Label className="mb-1.5 block">2. Company name</Label>
              <Input
                placeholder={manualOperatordetailExists === false ? 'Required for new operator' : 'Company / legal name'}
                value={manualForm.companyName}
                onChange={(e) => setManualForm((s) => ({ ...s, companyName: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label className="mb-1.5 block">3. Starting date (active from)</Label>
              <Input
                type="date"
                value={manualForm.activeFrom}
                onChange={(e) => setManualForm((s) => ({ ...s, activeFrom: e.target.value }))}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">4. Plan</Label>
              <select
                value={manualForm.planCode}
                onChange={(e) => {
                  const planCode = e.target.value
                  const cyc = normalizeUiBillingCycle(manualForm.billingCycle)
                  const eq = storedMonthlyFromCatalog(planCode, cyc, clnPlanAmounts)
                  setManualForm((s) => ({ ...s, planCode, monthlyPrice: String(eq) }))
                }}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
              >
                <option value="basic">Basic</option>
                <option value="grow">Grow</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <Label className="mb-1.5 block">Price (from catalog)</Label>
              <Input readOnly disabled className="bg-muted/60" value={manualCreatePriceLabel} />
            </div>
            <div>
              <Label className="mb-1.5 block">5. Billing period</Label>
              <select
                value={manualForm.billingCycle}
                onChange={(e) => {
                  const billingCycle = e.target.value
                  const cyc = normalizeUiBillingCycle(billingCycle)
                  const eq = storedMonthlyFromCatalog(manualForm.planCode, cyc, clnPlanAmounts)
                  setManualForm((s) => ({ ...s, billingCycle, monthlyPrice: String(eq) }))
                }}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div>
              <Label className="mb-2 block">6. Accounting integration (Bukku / Xero)</Label>
              <RadioGroup
                value={manualForm.accountingIncluded}
                onValueChange={(v) => setManualForm((s) => ({ ...s, accountingIncluded: v as 'yes' | 'no' }))}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="yes" id="man-acc-y" />
                  <label htmlFor="man-acc-y" className="text-sm cursor-pointer">
                    Yes — requires Grow or Enterprise
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="no" id="man-acc-n" />
                  <label htmlFor="man-acc-n" className="text-sm cursor-pointer">
                    No
                  </label>
                </div>
              </RadioGroup>
            </div>
            {manualForm.accountingIncluded === 'yes' ? (
              <div>
                <Label className="mb-1.5 block">7. Payment method (platform Bukku deposit)</Label>
                <select
                  value={manualForm.accountingPaymentMethod}
                  onChange={(e) =>
                    setManualForm((s) => ({ ...s, accountingPaymentMethod: e.target.value as 'bank' | 'cash' }))
                  }
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                >
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleManualCreate()}
              disabled={
                busy ||
                !manualForm.email.trim() ||
                manualEmailLookup !== 'done' ||
                manualOperatordetailExists === null
              }
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Subscription</DialogTitle>
            <DialogDescription>Update plan, active date and billing cycle for this operator.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Operator email"
              value={editForm.email}
              onChange={(e) => setEditForm((s) => ({ ...s, email: e.target.value }))}
            />
            <Input
              placeholder="Company name"
              value={editForm.companyName}
              onChange={(e) => setEditForm((s) => ({ ...s, companyName: e.target.value }))}
            />
            <Input
              type="date"
              value={editForm.activeFrom}
              onChange={(e) => setEditForm((s) => ({ ...s, activeFrom: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={editForm.planCode}
                onChange={(e) => {
                  const planCode = e.target.value
                  const cyc = normalizeUiBillingCycle(editForm.billingCycle)
                  const eq = storedMonthlyFromCatalog(planCode, cyc, clnPlanAmounts)
                  setEditForm((s) => ({ ...s, planCode, monthlyPrice: String(eq) }))
                }}
                className="px-3 py-2 border border-input rounded-md bg-background text-foreground"
              >
                <option value="basic">Basic</option>
                <option value="grow">Grow</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <Input
                type="number"
                placeholder="Monthly equivalent (stored)"
                value={editForm.monthlyPrice}
                onChange={(e) => setEditForm((s) => ({ ...s, monthlyPrice: e.target.value }))}
              />
            </div>
            <select
              value={editForm.billingCycle}
              onChange={(e) => {
                const billingCycle = e.target.value
                const cyc = normalizeUiBillingCycle(billingCycle)
                const eq = storedMonthlyFromCatalog(editForm.planCode, cyc, clnPlanAmounts)
                setEditForm((s) => ({ ...s, billingCycle, monthlyPrice: String(eq) }))
              }}
              className="px-3 py-2 border border-input rounded-md bg-background text-foreground w-full"
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSubscription} disabled={!activeItem || busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upgrade plan</DialogTitle>
            <DialogDescription>
              {activeItem
                ? `Operator: ${activeItem.operatorName || activeItem.operatorId} · Current ${prettyPlan(activeItem.planCode)} (${formatAdminListPrice(activeItem, clnPlanAmounts)} · ${activeItem.billingCycle || 'monthly'})`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Action</Label>
              <select
                value={upgradeMode}
                onChange={(e) => setUpgradeMode(e.target.value as PlanChangeMode)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
              >
                <option value="upgrade">Upgrade</option>
                <option value="renew">Renew</option>
              </select>
            </div>
            <div>
              <Label className="mb-2 block">Billing period</Label>
              <select
                value={upgradeBillingCycle}
                onChange={(e) => setUpgradeBillingCycle(e.target.value as UiBillingCycle)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            {upgradeMode === 'upgrade' ? (
              <>
                <div>
                  <Label className="mb-2 block">New plan (higher tier only)</Label>
                  {upgradablePlans.length ? (
                    <select
                      value={upgradePlanCode}
                      onChange={(e) => setUpgradePlanCode(e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                    >
                      {upgradablePlans.map((p) => {
                        const listAmt = catalogPeriodAmountForUi(p.plan, upgradeBillingCycle, clnPlanAmounts)
                        const period =
                          upgradeBillingCycle === 'yearly' ? 'yr' : upgradeBillingCycle === 'quarterly' ? 'qtr' : 'mo'
                        const label =
                          listAmt > 0
                            ? `${p.plan} — ${money(listAmt)}/${period} (catalog)`
                            : `${p.plan} — RM ${p.price}/mo`
                        return (
                          <option key={p.plan} value={p.plan}>
                            {label}
                          </option>
                        )
                      })}
                    </select>
                  ) : (
                    <p className="text-sm text-muted-foreground">No higher tier available (already on top plan).</p>
                  )}
                </div>
                <div>
                  <Label className="mb-2 block">Starting date</Label>
                  <Input type="date" value={upgradeActiveFrom} onChange={(e) => setUpgradeActiveFrom(e.target.value)} />
                </div>
                {newPeriodEndPreview ? (
                  <p className="text-sm text-muted-foreground">
                    New expire date:{' '}
                    <span className="text-foreground font-medium">{newPeriodEndPreview}</span>
                  </p>
                ) : null}
              </>
            ) : (
              <div className="rounded-lg border p-3 text-sm space-y-2">
                <p className="font-medium">Renew from expiry</p>
                <p className="text-muted-foreground">
                  New period starts on{' '}
                  <span className="text-foreground font-medium">{activeItem?.expiryDate || '—'}</span>
                  {` (${cycleLabel(upgradeBillingCycle)} billing).`}
                </p>
                {activeItem?.expiryDate && newPeriodEndPreview ? (
                  <p className="text-muted-foreground">
                    New expire date:{' '}
                    <span className="text-foreground font-medium">{newPeriodEndPreview}</span>
                  </p>
                ) : null}
                {!activeItem?.expiryDate ? (
                  <p className="text-amber-600">Set an active-from date on the subscription before renewing.</p>
                ) : null}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpgradeContinue}
              disabled={
                !activeItem ||
                busy ||
                (upgradeMode === 'upgrade' && (!upgradablePlans.length || !upgradeActiveFrom)) ||
                (upgradeMode === 'renew' && !activeItem.expiryDate)
              }
            >
              Continue to billing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={billingOpen} onOpenChange={(o) => !busy && setBillingOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Billing</DialogTitle>
            <DialogDescription>
              {pendingPlanChange?.planChangeMode === 'renew' ? 'Confirm renewal billing.' : 'Confirm upgrade billing.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Billing type</Label>
              <select
                value={billingKind}
                onChange={(e) => setBillingKind(e.target.value as 'foc' | 'manual')}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
              >
                <option value="foc">FOC</option>
                <option value="manual">Manual billing</option>
              </select>
            </div>
            {billingKind === 'manual' ? (
              <>
                <div>
                  <Label className="mb-2 block">Payment method</Label>
                  <select
                    value={billingPaymentMethod}
                    onChange={(e) => setBillingPaymentMethod(e.target.value as 'bank' | 'cash')}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                  >
                    <option value="bank">Bank</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
                <div>
                  <Label className="mb-2 block">Date</Label>
                  <Input type="date" value={billingPaymentDate} onChange={(e) => setBillingPaymentDate(e.target.value)} />
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => !busy && setBillingOpen(false)} disabled={busy}>
              Back
            </Button>
            <Button
              onClick={handleBillingConfirm}
              disabled={
                busy ||
                !pendingPlanChange ||
                (billingKind === 'manual' && !billingPaymentDate.trim())
              }
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={terminateOpen} onOpenChange={setTerminateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terminate Subscription</DialogTitle>
            <DialogDescription>
              {activeItem ? `Operator: ${activeItem.operatorName || activeItem.operatorId}` : 'Terminate current subscription.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Reason (optional)"
            value={terminateReason}
            onChange={(e) => setTerminateReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminateOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleTerminate} disabled={!activeItem || busy}>
              Terminate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addonWizardOpen} onOpenChange={setAddonWizardOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Activate add-on
            </DialogTitle>
            <DialogDescription>
              Choose client, add-on module, and whether this activation includes accounting integration (for your records).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 block">Client (operator)</Label>
              <select
                value={addonWizardOperatorId}
                onChange={(e) => setAddonWizardOperatorId(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
              >
                <option value="">Select operator…</option>
                {items.map((sub) => (
                  <option key={sub.operatorId} value={sub.operatorId}>
                    {(sub.operatorName || sub.operatorId).slice(0, 48)} — {sub.operatorEmail}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1.5 block">Add-on plan</Label>
              <select
                value={addonWizardCode}
                onChange={(e) => setAddonWizardCode(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
              >
                <option value="">Select add-on…</option>
                {clmAddonCatalog.map((a) => (
                  <option key={a.addonCode} value={a.addonCode}>
                    {a.title} · RM {Number(a.amountMyr || 0).toLocaleString()}/yr list
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-2 block">Accounting integration</Label>
              <RadioGroup
                value={addonWizardAccounting}
                onValueChange={(v) => setAddonWizardAccounting(v as 'yes' | 'no')}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="yes" id="wiz-acc-y" />
                  <label htmlFor="wiz-acc-y" className="text-sm cursor-pointer">
                    Yes
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="no" id="wiz-acc-n" />
                  <label htmlFor="wiz-acc-n" className="text-sm cursor-pointer">
                    No
                  </label>
                </div>
              </RadioGroup>
            </div>
            {addonWizardAccounting === 'yes' ? (
              <div>
                <Label className="mb-1.5 block">Payment method (platform Bukku)</Label>
                <select
                  value={addonWizardPaymentMethod}
                  onChange={(e) => setAddonWizardPaymentMethod(e.target.value as 'bank' | 'cash')}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                >
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddonWizardOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAddonWizardActivate()}
              disabled={busy || !addonWizardOperatorId || !addonWizardCode}
            >
              Activate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SubscriptionsPage
