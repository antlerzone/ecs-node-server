/**
 * Tenant Portal API – all calls go through Next proxy to ECS /api/tenantdashboard/*.
 * Email is taken from session (getMember) and sent in every request body.
 */

import { portalPost } from "./portal-api";
import { getMember } from "./portal-session";
import { portalDateInputToMalaysiaYmd } from "./dateMalaysia";

function getEmail(): string | null {
  const member = getMember();
  return member?.email ?? null;
}

async function post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  return portalPost<T>(`tenantdashboard/${path}`, { email, ...body });
}

/** POST init – tenant + tenancies + overdueTenancyIds/hasOverduePayment. Cached in TenantProvider. */
export async function tenantInit() {
  return post<{
    ok: boolean;
    tenant: unknown;
    tenancies: unknown[];
    overdueTenancyIds?: string[];
    hasOverduePayment?: boolean;
    requiresPaymentMethodLink?: boolean;
  }>("init", {});
}

/** POST cleaning-order — Malaysia local scheduledDate (YYYY-MM-DD) + scheduledTime (HH:mm). */
export async function tenantCleaningOrder(body: {
  tenancyId: string;
  scheduledDate: string;
  scheduledTime?: string;
  /** `door_unlocked` = did not lock the door; `other` = tenant text in roomAccessDetail */
  roomAccessMode: "door_unlocked" | "other";
  roomAccessDetail?: string;
}) {
  return post<{ ok: boolean; rentalcollectionId?: string; reason?: string }>("cleaning-order", body);
}

/** POST cleaning-order-latest — latest tenant cleaning charge for this tenancy (created + preferred slot + access). */
export async function tenantCleaningOrderLatest(tenancyId: string) {
  return post<{
    ok: boolean;
    reason?: string;
    item?: {
      id: string;
      createdAt: string | null;
      preferredDate: string | null;
      scheduledDate: string | null;
      scheduledTime: string | null;
      roomAccessMode: string | null;
      roomAccessDetail: string | null;
    } | null;
  }>("cleaning-order-latest", { tenancyId });
}

/** POST clients-by-ids – body: { clientIds } */
export async function clientsByIds(clientIds: string[]) {
  return post<{ ok: boolean; items: unknown[] }>("clients-by-ids", { clientIds });
}

/** POST room – body: { roomId } */
export async function room(roomId: string) {
  return post<{ ok: boolean; room: unknown }>("room", { roomId });
}

/** POST property-with-smartdoor – body: { propertyId, roomId? } */
export async function propertyWithSmartdoor(propertyId: string, roomId?: string) {
  return post<{ ok: boolean; property?: unknown; smartdoor?: unknown }>("property-with-smartdoor", {
    propertyId,
    ...(roomId ? { roomId } : {}),
  });
}

/** POST banks – returns list of banks. */
export async function banks() {
  return post<{ ok: boolean; items: unknown[] }>("banks", {});
}

/** POST update-profile – body: profile payload (fullname, phone, etc.). Email cannot be changed here; use requestEmailChange + confirmEmailChange. */
export async function updateProfile(payload: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("update-profile", payload);
}

/** POST portal-auth/change-password – change logged-in user password (Tenant). */
export async function changePassword(currentPassword: string, newPassword: string) {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  return portalPost<{ ok: boolean; reason?: string }>("portal-auth/change-password", { email, currentPassword, newPassword });
}

/** POST request-email-change – body: { newEmail }. Sends verification code to new email. */
export async function requestEmailChange(newEmail: string) {
  return post<{ ok: boolean; reason?: string }>("request-email-change", { newEmail });
}

/** POST confirm-email-change – body: { newEmail, code }. Verifies code and updates email. */
export async function confirmEmailChange(newEmail: string, code: string) {
  return post<{ ok: boolean; reason?: string }>("confirm-email-change", { newEmail, code });
}

/** POST agreement-html – body: { tenancyId, agreementTemplateId?, staffVars? } */
export async function agreementHtml(tenancyId: string, agreementTemplateId?: string, staffVars?: Record<string, unknown>) {
  return post<{ ok: boolean; html?: string }>("agreement-html", {
    tenancyId,
    ...(agreementTemplateId ? { agreementTemplateId } : {}),
    ...(staffVars ? { staffVars } : {}),
  });
}

/** POST agreement-update-sign – body: { agreementId, tenantsign, status? } */
export async function agreementUpdateSign(agreementId: string, tenantsign: string, status?: string) {
  return post<{ ok: boolean }>("agreement-update-sign", { agreementId, tenantsign, ...(status ? { status } : {}) });
}

/** POST agreement-get – body: { agreementId } */
export async function agreementGet(agreementId: string) {
  return post<{ ok: boolean; agreement?: unknown }>("agreement-get", { agreementId });
}

/** POST rental-list – body: { tenancyId } */
export async function rentalList(tenancyId: string) {
  return post<{
    ok: boolean;
    items?: unknown[];
    /** Operator setting from company Set Fees: strictly | no_allow | flexible */
    tenantPaymentMethodPolicy?: "strictly" | "no_allow" | "flexible";
    /** Operator: show "Charge due rent automatically" switch (default true if omitted) */
    tenantRentAutoDebitOffered?: boolean;
    /** Active payment gateway mode for this operator: stripe | payex(xendit) | billplz | paynow */
    paymentGatewayProvider?: "stripe" | "payex" | "billplz" | "paynow";
    /** For SG with Stripe/Xendit: whether PayNow is also allowed */
    paymentGatewayAllowPaynow?: boolean;
  }>("rental-list", { tenancyId });
}

/** POST approval-detail – body: { clientId }. Preview billing for pending approval (latest tenancy of client). */
export async function approvalDetail(clientId: string) {
  return post<{
    ok: boolean;
    reason?: string;
    clientId?: string;
    tenancy?: { _id?: string; title?: string; begin?: string; end?: string; created_at?: string };
    groups?: Array<{
      dueDate: string;
      total: number;
      items: Array<{ label: string; amount: number; periodStart?: string | null; periodEnd?: string | null }>;
    }>;
  }>("approval-detail", { clientId });
}

/** POST tenant-approve – body: { clientId } */
export async function tenantApprove(clientId: string) {
  return post<{ ok: boolean }>("tenant-approve", { clientId });
}

/** POST tenant-reject – body: { clientId } */
export async function tenantReject(clientId: string) {
  return post<{ ok: boolean }>("tenant-reject", { clientId });
}

/** POST generate-from-tenancy – body: { tenancyId } */
export async function generateFromTenancy(tenancyId: string) {
  return post<{ ok: boolean }>("generate-from-tenancy", { tenancyId });
}

/** POST sync-tenant-for-client – body: { clientId } */
export async function syncTenantForClient(clientId: string, extra?: Record<string, unknown>) {
  return post<{ ok: boolean }>("sync-tenant-for-client", { clientId, ...extra });
}

/** POST feedback-list – returns { ok, items } list of feedback for tenant. */
export async function feedbackList() {
  return post<{ ok: boolean; items?: unknown[] }>("feedback-list", {});
}

/** POST feedback – body: { tenancyId, roomId?, propertyId?, clientId?, description, photo?, video? } */
export async function feedback(payload: {
  tenancyId: string;
  roomId?: string;
  propertyId?: string;
  clientId?: string;
  description: string;
  photo?: string;
  video?: string;
}) {
  return post<{ ok: boolean }>("feedback", payload);
}

/** POST feedback/append – append tenant comment (requires DB migration 0134). Also registered as feedback-message on the server. */
export async function feedbackAppendMessage(
  feedbackId: string,
  text: string,
  attachments?: Array<{ src: string; type: "image" | "video" }>
) {
  return post<{ ok: boolean; reason?: string }>("feedback/append", { feedbackId, text, attachments });
}

/** POST create-payment – returns { ok, type: 'redirect', url } or { ok: false, reason }. */
export async function createPayment(payload: {
  tenancyId: string;
  type: "meter" | "invoice";
  amount: number;
  referenceNumber?: string;
  metadata?: Record<string, unknown>;
  returnUrl?: string;
  cancelUrl?: string;
}) {
  return post<{ ok: boolean; type?: string; url?: string; reason?: string }>("create-payment", payload);
}

/** POST submit-paynow-receipt – PayNow flow: after paying to UEN, upload receipt. Body: tenancyId, receipt_url, amount, invoiceIds?. */
export async function submitPaynowReceipt(payload: {
  tenancyId: string;
  receipt_url: string;
  amount: number;
  invoiceIds?: string[];
}) {
  return post<{ ok: boolean; data?: { id: string; status: string }; reason?: string }>("submit-paynow-receipt", payload);
}

/** POST confirm-payment – after provider redirect. Verifies by Stripe session_id or Xendit reference_number. */
export async function confirmPayment(params: {
  sessionId?: string
  clientId?: string
  provider?: "stripe" | "payex" | "billplz"
  referenceNumber?: string
  billId?: string
  paymentType?: "invoice" | "meter"
  meterTransactionId?: string
}) {
  return post<{ ok: boolean; result?: unknown; reason?: string }>("confirm-payment", {
    ...(params.sessionId ? { session_id: params.sessionId } : {}),
    ...(params.clientId ? { client_id: params.clientId } : {}),
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.referenceNumber ? { reference_number: params.referenceNumber } : {}),
    ...(params.billId ? { bill_id: params.billId } : {}),
    ...(params.paymentType ? { payment_type: params.paymentType } : {}),
    ...(params.meterTransactionId ? { meter_transaction_id: params.meterTransactionId } : {}),
  });
}

/** POST create-payment-method-setup – Stripe Checkout setup, or Xendit Payment Session SAVE. bindType bank_dd may return UNSUPPORTED for MY/SG. */
export async function createPaymentMethodSetup(
  tenancyId: string,
  cancelUrl?: string,
  bindType?: "card" | "bank_dd"
) {
  return post<{ ok: boolean; type?: string; url?: string; reason?: string; provider?: string }>("create-payment-method-setup", {
    tenancyId,
    ...(cancelUrl ? { cancelUrl } : {}),
    ...(bindType ? { bindType } : {}),
  });
}

/** POST disconnect-payment-method – remove saved Stripe card (detach) or Xendit token; clears auto-debit flags. */
export async function disconnectPaymentMethod(tenancyId: string) {
  return post<{ ok: boolean; reason?: string }>("disconnect-payment-method", { tenancyId });
}

export type TenantSmartDoorScope = "all" | "property" | "room";

/** POST remote-unlock – body: { tenancyId, smartDoorScope? }. TTLock remote unlock (default all locks). */
export async function tenantTtlockUnlock(tenancyId: string, smartDoorScope?: TenantSmartDoorScope) {
  return post<{
    ok: boolean;
    reason?: string;
    partial?: boolean;
    warning?: string;
    unlockedCount?: number;
    unlockedLockIds?: Array<string | number>;
    failedUnlocks?: Array<{ lockId: string | number; reason: string }>;
  }>("remote-unlock", {
    tenancyId,
    ...(smartDoorScope ? { smartDoorScope } : {}),
  });
}

/** POST passcode – body: { tenancyId, smartDoorScope? }. Get PIN for selected door scope. */
export async function tenantTtlockPasscode(tenancyId: string, smartDoorScope?: TenantSmartDoorScope) {
  return post<{
    ok: boolean;
    smartDoorScope?: TenantSmartDoorScope;
    hasPropertyLock?: boolean;
    hasRoomLock?: boolean;
    propertyLockId?: string | null;
    roomLockId?: string | null;
    passwordProperty?: string | null;
    passwordRoom?: string | null;
    passwordMismatch?: boolean;
    lockIds?: string[];
    primaryLockId?: string | null;
    password?: string | null;
    keyboardPwdId?: number | null;
    reason?: string;
  }>("passcode", {
    tenancyId,
    ...(smartDoorScope ? { smartDoorScope } : {}),
  });
}

/** POST passcode-save – body: { tenancyId, newPassword, smartDoorScope? }. Update TTLock passcode for scope. */
export async function tenantTtlockPasscodeSave(
  tenancyId: string,
  newPassword: string,
  smartDoorScope?: TenantSmartDoorScope
) {
  return post<{
    ok: boolean;
    reason?: string;
    partial?: boolean;
    noop?: boolean;
    warning?: string;
    failedTargets?: Array<{ type: "property" | "room"; lockId: string | number; reason: string }>;
    conflictScope?: "property" | "room";
    conflictLockId?: string | number;
    conflictLabel?: string;
    message?: string;
  }>("passcode-save", {
    tenancyId,
    newPassword,
    ...(smartDoorScope ? { smartDoorScope } : {}),
  });
}

/** POST meter-sync – body: { roomId }. Sync CNYIoT meter for tenant's room. */
export async function meterSync(roomId: string) {
  return post<{ ok: boolean; reason?: string; after?: unknown }>("meter-sync", { roomId });
}

/** POST usage-summary – body: { roomId, start?, end? }. start/end: YYYY-MM-DD or ISO string. Returns { ok, total, records: { date, consumption }[], children }. */
export async function usageSummary(
  roomId: string,
  start?: string | Date,
  end?: string | Date
): Promise<{ ok: boolean; total?: number; records?: { date: string; consumption: number }[]; children?: Record<string, number>; reason?: string }> {
  const startStr =
    start != null ? (typeof start === "string" ? start : portalDateInputToMalaysiaYmd(start as Date)) : undefined;
  const endStr =
    end != null ? (typeof end === "string" ? end : portalDateInputToMalaysiaYmd(end as Date)) : undefined;
  return post("usage-summary", { roomId, start: startStr, end: endStr }) as Promise<{
    ok: boolean;
    total?: number;
    records?: { date: string; consumption: number }[];
    children?: Record<string, number>;
    reason?: string;
  }>;
}

/** POST handover-schedule – body: { tenancyId, handoverCheckinAt?, handoverCheckoutAt? } */
export async function updateHandoverSchedule(payload: {
  tenancyId: string;
  handoverCheckinAt?: string;
  handoverCheckoutAt?: string;
}) {
  return post<{
    ok: boolean;
    reason?: string;
    message?: string;
    window?: { start: string; end: string; source?: string };
  }>("handover-schedule", payload);
}

/** POST upload – multipart form: file, email. Returns { ok, url }. Use for NRIC and feedback attachments. */
export async function uploadFile(file: File): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const email = getEmail();
  if (!email) return { ok: false, reason: "Not logged in" };
  const form = new FormData();
  form.append("email", email);
  form.append("file", file);
  const base = typeof window !== "undefined" && (window as { __PORTAL_PROXY_BASE__?: string }).__PORTAL_PROXY_BASE__ != null
    ? (window as { __PORTAL_PROXY_BASE__: string }).__PORTAL_PROXY_BASE__
    : "/api/portal/proxy";
  const res = await fetch(`${base}/tenantdashboard/upload`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: (data as { reason?: string }).reason || "Upload failed" };
  return (data as { ok?: boolean; url?: string }).ok ? { ok: true, url: (data as { url: string }).url } : { ok: false, reason: (data as { reason?: string }).reason };
}

export { getEmail as getTenantEmail };
