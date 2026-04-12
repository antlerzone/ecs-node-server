"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { tenantInit } from "@/lib/tenant-api"
import {
  computeHasPendingOperatorInvite,
  computeTenantProfileComplete,
  getTenantGateLayer,
  tenantHasPendingAgreementToSign as computePendingAgreement,
  type TenantGateLayer,
} from "@/lib/tenant-gates"

export interface TenantAgreement {
  _id?: string
  status?: string
  tenantsign?: string
  url?: string
  pdfurl?: string
}

export interface TenantTenancy {
  _id?: string
  id?: string
  begin?: string
  end?: string
  rental?: number
  tenant?: { _id?: string; fullname?: string }
  room?: { _id?: string; roomname?: string; title_fld?: string; hasMeter?: boolean; hasSmartDoor?: boolean }
  property?: { _id?: string; shortname?: string; hasSmartDoor?: boolean }
  /** Cleanlemons room-rental cleaning: operator set tenant price on property/room; tenant can order one-off clean. */
  hasCleaningOrder?: boolean
  cleaningTenantPriceMyr?: number | null
  client?: { _id?: string; title?: string; contact?: string }
  agreements?: TenantAgreement[]
  /** Draft rows from tenantdashboard init (PDF generating / pre-sign flow). */
  pendingDraftAgreements?: Array<{ _id?: string; pdf_generating?: boolean; status?: string }>
  handoverCheckinAt?: string | null
  handoverCheckoutAt?: string | null
  /** Allowed time-of-day window for tenant handover appointments (company admin). */
  handoverScheduleWindow?: { start: string; end: string; source?: "handoverWorkingHour" } | null
  /** active | expired | terminated — from server tenancy status + Malaysia end date */
  portalLifecycle?: "active" | "expired" | "terminated"
  isPortalReadOnly?: boolean
}

export interface TenantApprovalRequest {
  clientId?: string
  status?: string
}

export interface TenantProfile {
  _id?: string
  id?: string
  fullname?: string
  email?: string
  phone?: string
  address?: string
  nric?: string
  bankName?: string
  bankAccount?: string
  accountholder?: string
  nricFront?: string
  nricback?: string
  /** Parsed tenantdetail.profile JSON (entity_type, reg_no_type, avatar_url, …) */
  profile?: {
    entity_type?: string
    reg_no_type?: string
    avatar_url?: string
    /** Bank / refund notes from tenant profile form */
    bank_refund_remark?: string
    /** After bind webhook sets true; clears "strictly" lock gate */
    payment_method_linked?: boolean
    /** Daily cron (Stripe/Xendit) may charge due unpaid invoices when true */
    rent_auto_debit_enabled?: boolean
    xendit_auto_debit?: boolean
  }
  approvalRequest?: TenantApprovalRequest[]
  account?: Array<{ clientId?: string }>
}

const TENANT_SELECTED_TENANCY_KEY = "tenant_selected_tenancy_id"

function tenancyIdOf(t: TenantTenancy | null | undefined): string | null {
  if (!t || typeof t !== "object") return null
  const id = t.id ?? t._id
  return id != null && String(id).trim() ? String(id) : null
}

interface TenantState {
  tenant: TenantProfile | null
  tenancies: TenantTenancy[]
  /** Active tenancy for meter/payment/sidebar when tenant has multiple rooms */
  selectedTenancyId: string | null
  setSelectedTenancyId: (id: string | null) => void
  overdueTenancyIds: string[]
  hasOverduePayment: boolean
  /** Operator policy "strictly" until profile.payment_method_linked */
  requiresPaymentMethodLink: boolean
  loading: boolean
  error: string | null
  refetch: () => Promise<{ tenant: TenantProfile | null; tenancies: TenantTenancy[] } | void>
  /** Merge into tenant.profile (e.g. avatar_url right after OSS upload) so header updates immediately */
  mergeTenantProfile: (partial: Partial<NonNullable<TenantProfile["profile"]>>) => void
  /** Derived: has any agreement ready_for_signature not yet signed by tenant */
  hasPendingAgreement: boolean
  /** Derived: operator invitation in approval_request_json with status pending */
  hasPendingOperatorInvite: boolean
  /** Derived: tenant has required profile fields for gate */
  profileComplete: boolean
  /** Strict portal layer: 1 profile → 2 approval → 3 agreement → 4 overdue → 5 link payment method → open */
  gateLayer: TenantGateLayer
}

const TenantContext = createContext<TenantState | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<TenantProfile | null>(null)
  const [tenancies, setTenancies] = useState<TenantTenancy[]>([])
  const [selectedTenancyId, setSelectedTenancyIdState] = useState<string | null>(null)
  const [overdueTenancyIds, setOverdueTenancyIds] = useState<string[]>([])
  const [requiresPaymentMethodLink, setRequiresPaymentMethodLink] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const setSelectedTenancyId = useCallback((id: string | null) => {
    setSelectedTenancyIdState(id)
    try {
      if (id) sessionStorage.setItem(TENANT_SELECTED_TENANCY_KEY, id)
      else sessionStorage.removeItem(TENANT_SELECTED_TENANCY_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const mergeTenantProfile = useCallback((partial: Partial<NonNullable<TenantProfile["profile"]>>) => {
    setTenant((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        profile: { ...(prev.profile ?? {}), ...partial },
      }
    })
  }, [])

  const fetchInit = useCallback(
    async (opts?: { silent?: boolean }): Promise<{ tenant: TenantProfile | null; tenancies: TenantTenancy[] } | void> => {
    const silent = opts?.silent === true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await tenantInit()
      if (res?.ok) {
        const incoming = (res.tenant as TenantProfile) ?? null
        const tenanciesDataRaw = (res.tenancies as TenantTenancy[]) ?? []
        const tenanciesData = tenanciesDataRaw.filter(
          (t): t is TenantTenancy => !!t && typeof t === "object"
        )
        setTenant((prev) => {
          if (!incoming) return null
          const incP = incoming.profile ?? {}
          const prevP = prev?.profile ?? {}
          const incAv = incP.avatar_url != null && String(incP.avatar_url).trim() ? String(incP.avatar_url).trim() : ""
          const prevAv = prevP.avatar_url != null && String(prevP.avatar_url).trim() ? String(prevP.avatar_url).trim() : ""
          const avatar_url = incAv || prevAv
          return {
            ...incoming,
            profile: {
              ...incP,
              ...(avatar_url ? { avatar_url } : {}),
            },
          }
        })
        setTenancies(tenanciesData)
        const overdueIds = Array.isArray((res as { overdueTenancyIds?: unknown }).overdueTenancyIds)
          ? ((res as { overdueTenancyIds?: unknown[] }).overdueTenancyIds ?? []).map((x) => String(x)).filter(Boolean)
          : []
        setOverdueTenancyIds(overdueIds)
        setRequiresPaymentMethodLink(!!res.requiresPaymentMethodLink)
        return { tenant: incoming, tenancies: tenanciesData }
      } else {
        setTenant(null)
        setTenancies([])
        setOverdueTenancyIds([])
        return
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load"
      console.error("[TenantProvider] init failed:", msg)
      setError(msg)
      setTenant(null)
      setTenancies([])
      setOverdueTenancyIds([])
      setRequiresPaymentMethodLink(false)
      return
    } finally {
      if (!silent) setLoading(false)
    }
  },
    []
  )

  /** Background refresh: do not set loading — avoids ProfileGate unmounting tenant pages (e.g. profile auto-save loop). */
  const refetch = useCallback(() => fetchInit({ silent: true }), [fetchInit])

  useEffect(() => {
    void fetchInit()
  }, [fetchInit])

  /** Keep selection valid when tenancies load or change (refetch / different account). */
  useEffect(() => {
    if (tenancies.length === 0) {
      setSelectedTenancyIdState(null)
      try {
        sessionStorage.removeItem(TENANT_SELECTED_TENANCY_KEY)
      } catch {
        /* ignore */
      }
      return
    }
    setSelectedTenancyIdState((prev) => {
      let next: string | null
      if (prev && tenancies.some((t) => tenancyIdOf(t) === prev)) {
        next = prev
      } else {
        try {
          const raw = sessionStorage.getItem(TENANT_SELECTED_TENANCY_KEY)
          if (raw && tenancies.some((t) => tenancyIdOf(t) === raw)) next = raw
          else {
            const firstActive = tenancies.find((t) => !t.isPortalReadOnly)
            next = tenancyIdOf(firstActive ?? tenancies[0])
          }
        } catch {
          const firstActive = tenancies.find((t) => !t.isPortalReadOnly)
          next = tenancyIdOf(firstActive ?? tenancies[0])
        }
      }
      try {
        if (next) sessionStorage.setItem(TENANT_SELECTED_TENANCY_KEY, next)
        else sessionStorage.removeItem(TENANT_SELECTED_TENANCY_KEY)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [tenancies])

  const hasPendingAgreement = useMemo(() => computePendingAgreement(tenancies), [tenancies])

  const activeTenancyId = useMemo(() => {
    if (selectedTenancyId && tenancies.some((t) => tenancyIdOf(t) === selectedTenancyId)) return selectedTenancyId
    return tenancyIdOf(tenancies[0]) ?? null
  }, [selectedTenancyId, tenancies])

  const hasOverduePayment = useMemo(() => {
    if (!activeTenancyId) return false
    return overdueTenancyIds.includes(activeTenancyId)
  }, [activeTenancyId, overdueTenancyIds])

  const hasPendingOperatorInvite = useMemo(() => computeHasPendingOperatorInvite(tenant), [tenant])

  const profileComplete = useMemo(() => computeTenantProfileComplete(tenant), [tenant])

  const gateLayer = useMemo(
    () =>
      getTenantGateLayer({
        tenant,
        profileComplete,
        hasPendingOperatorInvite,
        hasPendingAgreement,
        hasOverduePayment,
        requiresPaymentMethodLink,
      }),
    [tenant, profileComplete, hasPendingOperatorInvite, hasPendingAgreement, hasOverduePayment, requiresPaymentMethodLink]
  )

  const value = useMemo<TenantState>(
    () => ({
      tenant,
      tenancies,
      selectedTenancyId,
      setSelectedTenancyId,
      overdueTenancyIds,
      hasOverduePayment,
      requiresPaymentMethodLink,
      loading,
      error,
      refetch,
      mergeTenantProfile,
      hasPendingAgreement,
      hasPendingOperatorInvite,
      profileComplete,
      gateLayer,
    }),
    [
      tenant,
      tenancies,
      selectedTenancyId,
      setSelectedTenancyId,
      overdueTenancyIds,
      hasOverduePayment,
      requiresPaymentMethodLink,
      loading,
      error,
      refetch,
      mergeTenantProfile,
      hasPendingAgreement,
      hasPendingOperatorInvite,
      profileComplete,
      gateLayer,
    ]
  )

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant(): TenantState {
  const ctx = useContext(TenantContext)
  if (!ctx) {
    throw new Error("useTenant must be used within TenantProvider")
  }
  return ctx
}

export function useTenantOptional(): TenantState | null {
  return useContext(TenantContext)
}

export { type TenantGateLayer } from "@/lib/tenant-gates"
/** @deprecated Prefer `computePendingAgreement` from `@/lib/tenant-gates` */
export function tenantHasPendingAgreementToSign(tenancies: TenantTenancy[]): boolean {
  return computePendingAgreement(tenancies)
}
