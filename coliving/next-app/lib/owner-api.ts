/**
 * Owner Portal API – all calls go through Next proxy to ECS /api/ownerportal/*.
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
  return portalPost<T>(`ownerportal/${path}`, { email, ...body });
}

/** POST owner – get owner by email (with property/client as arrays) */
export async function getOwner() {
  return post<{ ok: boolean; owner?: unknown; reason?: string }>("owner", {});
}

/** POST load-cms-data – owner + properties + rooms + tenancies in one call */
export async function loadCmsData() {
  return post<{
    ok: boolean;
    owner?: unknown;
    properties?: unknown[];
    rooms?: unknown[];
    tenancies?: unknown[];
    reason?: string;
  }>("load-cms-data", {});
}

/** POST clients – get clients by ids (operator dropdown) */
export async function getClientsForOperator() {
  return post<{ ok: boolean; items?: unknown[]; reason?: string }>("clients", {});
}

/** POST banks – returns list of banks */
export async function getBanks() {
  return post<{ ok: boolean; items?: unknown[]; reason?: string }>("banks", {});
}

/** POST update-profile – body: ownerName, mobileNumber, nric, bankAccount, accountholder, bankName, profile, nricFront, nricback */
export async function updateOwnerProfile(payload: Record<string, unknown>) {
  return post<{ ok: boolean; owner?: unknown; reason?: string }>("update-profile", payload);
}

/** POST portal-auth/change-password – change logged-in user password. Body: email, currentPassword, newPassword (email from session). */
export async function changePassword(currentPassword: string, newPassword: string) {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  return portalPost<{ ok: boolean; reason?: string }>("portal-auth/change-password", { email, currentPassword, newPassword });
}

/** POST owner-payout-list – body: { propertyId, startDate, endDate } */
export async function getOwnerPayoutList(opts: {
  propertyId?: string;
  startDate: string | Date;
  endDate: string | Date;
}) {
  const startStr = portalDateInputToMalaysiaYmd(opts.startDate);
  const endStr = portalDateInputToMalaysiaYmd(opts.endDate);
  return post<{ ok: boolean; items?: unknown[]; reason?: string }>("owner-payout-list", {
    ...(opts.propertyId ? { propertyId: opts.propertyId } : {}),
    startDate: startStr,
    endDate: endStr,
  });
}

/** POST cost-list – body: { propertyId, startDate, endDate, skip?, limit? } */
export async function getCostList(opts: {
  propertyId: string;
  startDate: string | Date;
  endDate: string | Date;
  skip?: number;
  limit?: number;
}) {
  const startStr = portalDateInputToMalaysiaYmd(opts.startDate);
  const endStr = portalDateInputToMalaysiaYmd(opts.endDate);
  return post<{ ok: boolean; items?: unknown[]; totalCount?: number; reason?: string }>("cost-list", {
    propertyId: opts.propertyId,
    startDate: startStr,
    endDate: endStr,
    ...(opts.skip != null ? { skip: opts.skip } : {}),
    ...(opts.limit != null ? { limit: opts.limit } : {}),
  });
}

/** POST agreement-list – body: { ownerId } */
export async function getAgreementList(opts: { ownerId: string }) {
  return post<{ ok: boolean; items?: unknown[]; reason?: string }>("agreement-list", opts);
}

/** POST agreement-template – body: { templateId } */
export async function getAgreementTemplate(opts: { templateId: string }) {
  return post<{ ok: boolean; template?: unknown; reason?: string }>("agreement-template", opts);
}

/** POST agreement-get – body: { agreementId } */
export async function getAgreement(opts: { agreementId: string }) {
  return post<{ ok: boolean; agreement?: unknown; reason?: string }>("agreement-get", opts);
}

/** POST agreement-update-sign – body: { agreementId, ownersign, ownerSignedAt?, status? } */
export async function updateAgreementSign(opts: {
  agreementId: string;
  ownersign: string;
  ownerSignedAt?: Date;
  status?: string;
}) {
  return post<{ ok: boolean; reason?: string }>("agreement-update-sign", {
    ...opts,
    ownerSignedAt: opts.ownerSignedAt ?? new Date(),
  });
}

/** POST complete-agreement-approval – body: { ownerId, propertyId, clientId, agreementId } */
export async function completeAgreementApproval(opts: {
  ownerId: string;
  propertyId: string;
  clientId: string;
  agreementId: string;
}) {
  return post<{ ok: boolean; reason?: string; message?: string }>("complete-agreement-approval", opts);
}

/** POST merge-owner-multi-reference – body: { ownerId, propertyId, clientId } */
export async function mergeOwnerMultiReference(opts: {
  ownerId: string;
  propertyId: string;
  clientId: string;
}) {
  return post<{ ok: boolean; reason?: string; message?: string }>("merge-owner-multi-reference", opts);
}

/** POST remove-approval-pending – body: { ownerId, propertyId, clientId } */
export async function removeApprovalPending(opts: {
  ownerId: string;
  propertyId: string;
  clientId: string;
}) {
  return post<{ ok: boolean; reason?: string }>("remove-approval-pending", opts);
}

/** POST sync-owner-for-client – body: { ownerId, clientId } */
export async function syncOwnerForClient(opts: { ownerId: string; clientId: string }) {
  return post<{ ok: boolean; reason?: string }>("sync-owner-for-client", opts);
}

/** POST export-report-pdf – body: { propertyId, startDate, endDate }. Returns { downloadUrl } */
export async function exportOwnerReportPdf(opts: {
  propertyId?: string;
  startDate: string | Date;
  endDate: string | Date;
}) {
  const startStr = portalDateInputToMalaysiaYmd(opts.startDate);
  const endStr = portalDateInputToMalaysiaYmd(opts.endDate);
  return post<{ ok: boolean; downloadUrl?: string; reason?: string }>("export-report-pdf", {
    ...(opts.propertyId ? { propertyId: opts.propertyId } : {}),
    startDate: startStr,
    endDate: endStr,
  });
}

/** POST owner-report-pdf-download – body: { payoutId }. Uses same source as operator report history PDF. */
export async function downloadOwnerReportPdfById(payoutId: string) {
  return post<{ ok: boolean; downloadUrl?: string; reason?: string }>("owner-report-pdf-download", { payoutId });
}

/** POST rooms-with-locks – list rooms with smart door for owner's properties */
export async function getRoomsWithLocks() {
  return post<{ ok: boolean; items?: unknown[]; reason?: string }>("rooms-with-locks", {});
}

/** POST remote-unlock – body: { itemId }. itemId = "property:${propertyId}". TTLock remote unlock. */
export async function ownerTtlockUnlock(itemId: string) {
  return post<{ ok: boolean; reason?: string }>("remote-unlock", { itemId });
}

/** POST passcode – body: { itemId }. Get owner passcode for property. */
export async function ownerTtlockPasscode(itemId: string) {
  return post<{ ok: boolean; password?: string; reason?: string }>("passcode", { itemId });
}

/** POST passcode-save – body: { itemId, newPassword }. Set owner passcode for property. */
export async function ownerTtlockPasscodeSave(itemId: string, newPassword: string) {
  return post<{ ok: boolean; password?: string; reason?: string }>("passcode-save", { itemId, newPassword });
}

/** POST export-cost-pdf – body: { propertyId, startDate, endDate }. Returns { downloadUrl } */
export async function exportCostPdf(opts: {
  propertyId: string;
  startDate: string | Date;
  endDate: string | Date;
}) {
  const startStr = portalDateInputToMalaysiaYmd(opts.startDate);
  const endStr = portalDateInputToMalaysiaYmd(opts.endDate);
  return post<{ ok: boolean; downloadUrl?: string; reason?: string }>("export-cost-pdf", {
    propertyId: opts.propertyId,
    startDate: startStr,
    endDate: endStr,
  });
}

/** Upload file (NRIC etc.) – multipart form. Backend uploads to OSS under owner-{ownerId}. */
export async function uploadFile(file: File): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const email = getEmail();
  if (!email) return { ok: false, reason: "Not logged in" };
  const form = new FormData();
  form.append("email", email);
  form.append("file", file);

  const base =
    typeof window !== "undefined" && (window as { __PORTAL_PROXY_BASE__?: string }).__PORTAL_PROXY_BASE__ != null
      ? (window as { __PORTAL_PROXY_BASE__: string }).__PORTAL_PROXY_BASE__
      : "/api/portal/proxy";

  const res = await fetch(`${base}/ownerportal/upload`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: (data as { reason?: string }).reason || "Upload failed" };
  return (data as { ok?: boolean; url?: string }).ok
    ? { ok: true, url: (data as { url: string }).url }
    : { ok: false, reason: (data as { reason?: string }).reason };
}

/** Agreement context for owner – tenant-context, owner-context, or owner-tenant-context. */
export async function getAgreementContext(opts: {
  mode?: "tenant_operator" | "owner_tenant" | "owner_operator";
  tenancyId?: string;
  agreementId?: string;
  ownerId?: string;
  propertyId?: string;
  clientId?: string;
  staffVars?: Record<string, string>;
}) {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  const base = "agreement";
  const staffVars = opts.staffVars ?? {};

  if (opts.mode === "tenant_operator") {
    return portalPost<{ ok: boolean; variables?: Record<string, string>; reason?: string }>(
      `${base}/tenant-context`,
      { email, tenancyId: opts.tenancyId, agreementTemplateId: opts.agreementId, staffVars }
    );
  }
  if (opts.mode === "owner_tenant") {
    return portalPost<{ ok: boolean; variables?: Record<string, string>; reason?: string }>(
      `${base}/owner-tenant-context`,
      { email, tenancyId: opts.tenancyId, agreementTemplateId: opts.agreementId, staffVars }
    );
  }
  return portalPost<{ ok: boolean; variables?: Record<string, string>; reason?: string }>(
    `${base}/owner-context`,
    {
      email,
      ownerId: opts.ownerId,
      propertyId: opts.propertyId,
      clientId: opts.clientId,
      agreementTemplateId: opts.agreementId,
      staffVars,
    }
  );
}

export { getEmail as getOwnerEmail };
