/**
 * Tenant portal navigation gates — strict order:
 * 1. Profile complete
 * 2. Operator approval (pending invite)
 * 3. Agreement signed
 * 4. Payment (due today or overdue)
 * 5. Payment method link (operator policy "strictly" until tenantdetail.profile.payment_method_linked)
 *
 * Shapes are structural; call sites use full TenantProfile / TenantTenancy from context.
 */

export type TenantGateLayer = 1 | 2 | 3 | 4 | 5 | "open"

const LAYER_REDIRECT: Record<Exclude<TenantGateLayer, "open">, string> = {
  1: "/tenant/profile?reason=profile",
  2: "/tenant/approval",
  3: "/tenant/agreement",
  4: "/tenant/payment?reason=overdue",
  5: "/tenant/payment?reason=payment_method",
}

/** Paths allowed while blocked at each layer (prefix match allowed for sub-routes). */
export const TENANT_GATE_ALLOWED_PATHS: Record<Exclude<TenantGateLayer, "open">, string[]> = {
  1: ["/tenant/profile"],
  2: ["/tenant/profile", "/tenant/approval"],
  3: ["/tenant/profile", "/tenant/approval", "/tenant/agreement"],
  4: ["/tenant/profile", "/tenant/approval", "/tenant/agreement", "/tenant/payment"],
  5: ["/tenant/profile", "/tenant/approval", "/tenant/agreement", "/tenant/payment"],
}

export function normalizeTenantPathname(pathname: string): string {
  return (pathname || "").replace(/\/+$/, "") || "/"
}

export interface TenantAgreementLite {
  tenantsign?: string
}

export interface TenantTenancyLite {
  agreements?: TenantAgreementLite[]
  pendingDraftAgreements?: Array<{ _id?: string }>
  /** From tenantdashboard init: expired/terminated tenancies are view-only in the portal. */
  isPortalReadOnly?: boolean
}

export interface TenantProfileLite {
  fullname?: string
  nric?: string
  phone?: string
  address?: string
  bankName?: string
  bankAccount?: string
  accountholder?: string
  nricFront?: string
  nricback?: string
  profile?: {
    entity_type?: string
    reg_no_type?: string
    avatar_url?: string
    bank_refund_remark?: string
    id_type?: string
    /** Set when card/bank bind completes (webhook); clears layer 5 "strictly" gate. */
    payment_method_linked?: boolean
  }
  approvalRequest?: Array<{ clientId?: string; status?: string }>
}

function isPendingAgreement(a: TenantAgreementLite): boolean {
  return !a?.tenantsign
}

/** Any formal agreement missing tenant sign, or draft row still in flow. Ignores view-only (ended) tenancies. */
export function tenantHasPendingAgreementToSign(tenancies: TenantTenancyLite[]): boolean {
  return (tenancies || [])
    .filter((t) => t && !t.isPortalReadOnly)
    .some((t) => {
      if ((t.agreements || []).some(isPendingAgreement)) return true
      const drafts = t.pendingDraftAgreements
      return Array.isArray(drafts) && drafts.length > 0
    })
}

export function computeTenantProfileComplete(tenant: TenantProfileLite | null): boolean {
  if (!tenant) return false
  const legalName = (tenant.fullname || "").trim()
  const nric = (tenant.nric || "").trim()
  const entityType = (tenant.profile?.entity_type || "").trim()
  const idType = (tenant.profile?.id_type || tenant.profile?.reg_no_type || "").trim()
  const mobileNumber = (tenant.phone || "").trim()
  const addressLine = (tenant.address || "").trim()
  const nricFront = (tenant.nricFront || "").trim()
  const nricBack = (tenant.nricback || "").trim()
  const bankName = (tenant.bankName || "").trim()
  const bankAccount = (tenant.bankAccount || "").trim()
  const accountHolder = (tenant.accountholder || "").trim()
  const exempt = entityType === "EXEMPTED_PERSON"
  const isSingaporeEntity = entityType === "FOREIGN_INDIVIDUAL" || entityType === "FOREIGN_COMPANY"
  const normalizedIdType = idType.toUpperCase()
  const requiresBackImage = normalizedIdType !== "PASSPORT"
  return (
    legalName.length > 0 &&
    entityType.length > 0 &&
    idType.length > 0 &&
    mobileNumber.length > 0 &&
    addressLine.length > 0 &&
    (isSingaporeEntity || (bankName.length > 0 && bankAccount.length > 0 && accountHolder.length > 0)) &&
    (exempt || (nric.length > 0 && nricFront.length > 0 && (!requiresBackImage || nricBack.length > 0)))
  )
}

export function computeHasPendingOperatorInvite(tenant: TenantProfileLite | null): boolean {
  const ar = tenant?.approvalRequest
  if (!Array.isArray(ar)) return false
  return ar.some((r) => r && r.status === "pending" && r.clientId)
}

export function getTenantGateLayer(input: {
  tenant: TenantProfileLite | null
  profileComplete: boolean
  hasPendingOperatorInvite: boolean
  hasPendingAgreement: boolean
  hasOverduePayment: boolean
  /** Operator "strictly" and tenant not yet linked (profile.payment_method_linked). */
  requiresPaymentMethodLink?: boolean
}): TenantGateLayer {
  if (!input.tenant || !input.profileComplete) return 1
  if (input.hasPendingOperatorInvite) return 2
  if (input.hasPendingAgreement) return 3
  if (input.hasOverduePayment) return 4
  if (input.requiresPaymentMethodLink) return 5
  return "open"
}

export function isTenantPathAllowedForGateLayer(pathname: string, layer: TenantGateLayer): boolean {
  if (layer === "open") return true
  const p = normalizeTenantPathname(pathname)
  const allowed = TENANT_GATE_ALLOWED_PATHS[layer]
  return allowed.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))
}

export function getTenantGateRedirectUrl(layer: Exclude<TenantGateLayer, "open">): string {
  return LAYER_REDIRECT[layer]
}

/** Build layer from init response (e.g. tutorial page outside TenantProvider). */
export function getTenantGateLayerFromInitPayload(payload: {
  tenant?: TenantProfileLite | null
  tenancies?: TenantTenancyLite[] | null
  hasOverduePayment?: boolean
  requiresPaymentMethodLink?: boolean
}): TenantGateLayer {
  const tenant = payload.tenant ?? null
  const tenancies = payload.tenancies ?? []
  const profileComplete = computeTenantProfileComplete(tenant)
  const hasPendingOperatorInvite = computeHasPendingOperatorInvite(tenant)
  const hasPendingAgreement = tenantHasPendingAgreementToSign(tenancies)
  const hasOverduePayment = !!payload.hasOverduePayment
  const requiresPaymentMethodLink = !!payload.requiresPaymentMethodLink
  return getTenantGateLayer({
    tenant,
    profileComplete,
    hasPendingOperatorInvite,
    hasPendingAgreement,
    hasOverduePayment,
    requiresPaymentMethodLink,
  })
}
