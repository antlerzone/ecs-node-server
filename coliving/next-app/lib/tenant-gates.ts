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
  1: "/tenant/profile?gate=required",
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

/** `/demoprofile` — demo Gov/eKYC UI; no tenant gate redirects or mandatory-field UX. */
export function isDemoprofilePath(pathname: string): boolean {
  return normalizeTenantPathname(pathname) === "/demoprofile"
}

export interface TenantAgreementLite {
  tenantsign?: string
  status?: string
  /** From tenantdashboard init: operator manual PDF path sets `completed` + locked without `tenantsign`. */
  columns_locked?: boolean | number | string
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
  /** ISO from portal_account.profile_self_verified_at — required with field-complete for portal gate */
  profileSelfVerifiedAt?: string | null
  /** Server: true when self-attested or Aliyun eKYC locked */
  profileIdentityVerified?: boolean
  /** portal_account.aliyun_ekyc_locked — required for tenant portal layer 1 (with field-complete) */
  aliyunEkycLocked?: boolean
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

function isColumnsLockedVal(v: unknown): boolean {
  return v === true || v === 1 || v === "1"
}

/** Canonical `completed`; DB may store legacy typo `complete` on agreement.status. */
export function isAgreementCompletedStatus(status: string | undefined | null): boolean {
  const s = String(status ?? "").trim().toLowerCase()
  return s === "completed" || s === "complete"
}

/**
 * True when the tenant should still complete the in-portal canvas signature flow.
 * False when already signed, or when the row is operator manual upload / server-finalized (`completed`/`complete` and `columns_locked`).
 */
export function agreementNeedsTenantPortalSignature(a: TenantAgreementLite | null | undefined): boolean {
  if (!a) return false
  if (String(a.tenantsign ?? "").trim() !== "") return false
  if (isAgreementCompletedStatus(a.status) && isColumnsLockedVal(a.columns_locked)) return false
  return true
}

function isPendingAgreement(a: TenantAgreementLite): boolean {
  return agreementNeedsTenantPortalSignature(a)
}

/** Any formal agreement that still needs portal signature, or draft row still in flow. Ignores view-only (ended) tenancies. Manual-upload `completed`+`columns_locked` rows are excluded. */
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
  const isSingaporeEntity =
    entityType === "FOREIGN_INDIVIDUAL" ||
    entityType === "FOREIGN_COMPANY" ||
    entityType === "SINGAPORE_INDIVIDUAL"
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

/** UI field keys for highlighting — must match `computeTenantProfileComplete` / gate logic. */
export type TenantGateIncompleteField =
  | "entityType"
  | "legalName"
  | "idType"
  | "idNumber"
  | "phone"
  | "address"
  | "bank"
  | "bankAccount"
  | "accountHolder"
  | "nricFront"
  | "nricBack"

/**
 * Which profile fields are still required for the tenant portal gate (layer 1).
 * Pass the same shape as `TenantProfileLite` (e.g. built from the profile form state).
 */
export function getTenantProfileIncompleteFields(tenant: TenantProfileLite | null): TenantGateIncompleteField[] {
  if (!tenant) {
    return [
      "entityType",
      "legalName",
      "idType",
      "idNumber",
      "phone",
      "address",
      "bank",
      "bankAccount",
      "accountHolder",
      "nricFront",
      "nricBack",
    ]
  }
  const missing: TenantGateIncompleteField[] = []
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
  const isForeignEntity =
    entityType === "FOREIGN_INDIVIDUAL" ||
    entityType === "FOREIGN_COMPANY" ||
    entityType === "SINGAPORE_INDIVIDUAL"
  const requiresBackImage = (idType || "").toUpperCase() !== "PASSPORT"

  if (!entityType) missing.push("entityType")
  if (!legalName) missing.push("legalName")
  if (!idType) missing.push("idType")
  if (!mobileNumber) missing.push("phone")
  if (!addressLine) missing.push("address")

  if (!isForeignEntity) {
    if (!bankName) missing.push("bank")
    if (!bankAccount) missing.push("bankAccount")
    if (!accountHolder) missing.push("accountHolder")
  }

  if (!exempt) {
    if (!nric) missing.push("idNumber")
    if (!nricFront) missing.push("nricFront")
    if (requiresBackImage && !nricBack) missing.push("nricBack")
  }

  return missing
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
  const profileFieldsComplete = computeTenantProfileComplete(tenant)
  const profileSelfVerified = tenant?.aliyunEkycLocked === true
  const profileComplete = profileFieldsComplete && profileSelfVerified
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
