/**
 * Enquiry onboarding — calls ECS /api/enquiry/* with portal JWT where required.
 * Same-origin 必须用 /api/portal/proxy（转发 Authorization）；勿用裸 /api（Next 无 enquiry/me 路由会 404）。
 */

import { shouldUseDemoMock } from "./portal-api"
import { PORTAL_KEYS } from "./portal-session"

/** 与 portal 其它需 JWT 的请求一致：同域时走 portal proxy。 */
export function getEnquiryApiBase(): string {
  if (shouldUseDemoMock()) return ""
  const ecs = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
  if (typeof window !== "undefined") {
    if (process.env.NEXT_PUBLIC_USE_SAME_ORIGIN_API === "true" || process.env.NEXT_PUBLIC_USE_PROXY === "true") {
      return "/api/portal/proxy"
    }
  }
  return `${ecs}/api`
}

export interface EnquiryOperatorProfile {
  id: string
  title?: string
  email?: string
  status?: number
  currency?: string
  expired?: unknown
  hasActivePlan?: boolean
  /** Digits-only mobile from client_profile.contact */
  contact?: string | null
}

export async function enquiryPostJson<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
  const base = getEnquiryApiBase()
  if (!base) {
    throw new Error("API not configured")
  }
  const jwt = typeof window !== "undefined" ? localStorage.getItem(PORTAL_KEYS.PORTAL_JWT) || "" : ""
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (jwt) headers.Authorization = `Bearer ${jwt}`
  const url = `${base.replace(/\/$/, "")}/enquiry/${path.replace(/^\//, "")}`
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as T
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      try {
        localStorage.removeItem(PORTAL_KEYS.PORTAL_JWT)
      } catch {
        /* ignore */
      }
    }
    const r = data as { reason?: string; message?: string }
    throw new Error(r?.message || r?.reason || `HTTP ${res.status}`)
  }
  return data
}

export async function fetchEnquiryMe(): Promise<{
  ok?: boolean
  hasOperator?: boolean
  operator?: EnquiryOperatorProfile
  reason?: string
}> {
  return enquiryPostJson("me", {})
}

export async function submitEnquiryProfile(payload: {
  title: string
  currency: string
  country?: string
  contact?: string
  number_of_units?: string
  plan_of_interest?: string
  remark?: string
}): Promise<{ ok?: boolean; clientId?: string; reason?: string }> {
  return enquiryPostJson("submit-profile", payload as Record<string, unknown>)
}

/** 無 operatordetail 時建立最小檔案（MY/SG）；已有則返回與 me 相同結構 */
export async function ensureEnquiryOperator(body: {
  country?: string
  /** Mobile — Google sign-in does not provide a phone number */
  contact?: string
}): Promise<{
  ok?: boolean
  hasOperator?: boolean
  operator?: EnquiryOperatorProfile
  reason?: string
}> {
  return enquiryPostJson("ensure-operator", body as Record<string, unknown>)
}

/** 已有 operator 時補寫 client_profile.contact（至少 6 位數字） */
export async function updateEnquiryContact(contact: string): Promise<{
  ok?: boolean
  hasOperator?: boolean
  operator?: EnquiryOperatorProfile
  reason?: string
}> {
  return enquiryPostJson("update-contact", { contact })
}

export async function createPlanBillplz(planId: string, remark?: string): Promise<{
  ok?: boolean
  billUrl?: string
  billId?: string
  pricingplanlogId?: string
  reason?: string
}> {
  return enquiryPostJson("create-plan-billplz", {
    planId,
    ...(remark ? { remark } : {}),
  })
}

/**
 * MYR/SGD：將方案意向寫入 `client_profile`（手動付款、跳過卡費），SaaS Admin → Enquiry 可見。
 * 線上付用 {@link createPlanBillplz}（Stripe Checkout）。
 */
export async function submitSgdPlanEnquiry(
  planId: string,
  receiptUrl?: string
): Promise<{
  ok?: boolean
  planTitle?: string
  reason?: string
}> {
  return enquiryPostJson("submit-sgd-plan-enquiry", {
    planId,
    ...(receiptUrl ? { receiptUrl } : {}),
  })
}

/** After Xendit redirect (?plan_finalize=…): poll invoice and apply plan if webhook was late (enquiry users may have no staff row). */
export async function syncEnquiryPlanFromXendit(pricingplanlogId: string): Promise<{
  ok?: boolean
  paid?: boolean
  already?: boolean
  status?: string
  reason?: string
  pricingplanlogId?: string
}> {
  return enquiryPostJson("xendit-plan-sync", { pricingplanlogId })
}

/** After Stripe Checkout (?plan_finalize=…&session_id=…): confirm session and apply plan if webhook was late. */
export async function syncEnquiryPlanFromStripe(
  pricingplanlogId: string,
  sessionId: string
): Promise<{
  ok?: boolean
  paid?: boolean
  already?: boolean
  status?: string
  reason?: string
  pricingplanlogId?: string
}> {
  return enquiryPostJson("stripe-plan-sync", { pricingplanlogId, sessionId })
}
