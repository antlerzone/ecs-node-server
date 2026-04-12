/**
 * Coliving portal profile — same data model as Cleanlemons: GET/PUT /api/portal-auth/profile + banks + uploads.
 */

import { shouldUseDemoMock, portalPost } from "./portal-api";
import { PORTAL_KEYS, getMember } from "./portal-session";
import { banks } from "./tenant-api";

export function getPortalApiBase(): string {
  if (shouldUseDemoMock()) return "";
  if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_USE_SAME_ORIGIN_API === "true") {
    return "/api";
  }
  const useProxy = typeof window !== "undefined" && process.env.NEXT_PUBLIC_USE_PROXY === "true";
  const base = process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com";
  return useProxy ? "/api/portal/proxy" : `${base.replace(/\/$/, "")}/api`;
}

export function getPortalJwt(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(PORTAL_KEYS.PORTAL_JWT) || "";
  } catch {
    return "";
  }
}

async function portalUserFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getPortalApiBase();
  const url = `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const headers = new Headers(init.headers || undefined);
  const jwt = getPortalJwt();
  if (jwt) headers.set("Authorization", `Bearer ${jwt}`);
  return fetch(url, { ...init, headers });
}

/** Same mapping as `mapPortalProfileToUnifiedEmployee` in cleanlemon.service.js */
export function mapPortalGetResponseToUnified(
  portalResult: { ok?: boolean; profile?: Record<string, unknown> | null },
  normalizedEmail: string
) {
  if (!portalResult?.ok || !portalResult.profile) return null;
  const p = portalResult.profile;
  const parts = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  const fullName = String(p.fullname || parts || "").trim();
  const reg = String(p.reg_no_type || p.id_type || "NRIC").toUpperCase();
  const idType = ["NRIC", "PASSPORT", "BRN"].includes(reg) ? reg : "NRIC";
  return {
    id: null,
    clientId: null,
    email: normalizedEmail,
    fullName,
    legalName: String(p.fullname || fullName || "").trim(),
    nickname: String(p.first_name || "").trim(),
    phone: String(p.phone || "").trim(),
    address: String(p.address || "").trim(),
    entityType: String(p.entity_type || "MALAYSIAN_INDIVIDUAL"),
    idType,
    idNumber: String(p.nric || "").trim(),
    taxIdNo: String(p.tax_id_no || "").trim(),
    bankId: p.bankname_id != null ? String(p.bankname_id) : "",
    bankAccountNo: String(p.bankaccount || "").trim(),
    bankAccountHolder: String(p.accountholder || "").trim(),
    nricFrontUrl: String(p.nricfront || "").trim(),
    nricBackUrl: String(p.nricback || "").trim(),
    avatarUrl: String(p.avatar_url || "").trim(),
  };
}

export function buildPortalPayloadFromUnified(payload: {
  fullName: string;
  legalName: string;
  nickname: string;
  phone: string;
  address: string;
  entityType: string;
  idType: string;
  idNumber: string;
  taxIdNo: string;
  bankId: string;
  bankAccountNo: string;
  bankAccountHolder: string;
  avatarUrl: string;
  nricFrontUrl: string | null;
  nricBackUrl: string | null;
}): Record<string, unknown> {
  const fullname = payload.fullName != null ? String(payload.fullName).trim() : "";
  const legal = payload.legalName != null ? String(payload.legalName).trim() : "";
  const bid =
    payload.bankId != null && String(payload.bankId).trim() !== "" ? String(payload.bankId).trim() : null;
  return {
    fullname: fullname || legal || null,
    first_name: payload.nickname != null ? String(payload.nickname).trim() || null : null,
    phone: payload.phone != null ? String(payload.phone).trim() || null : null,
    address: payload.address != null ? String(payload.address).trim() || null : null,
    nric: payload.idNumber != null ? String(payload.idNumber).trim() || null : null,
    tax_id_no: payload.taxIdNo != null ? String(payload.taxIdNo).trim() || null : null,
    entity_type: payload.entityType != null ? String(payload.entityType).trim() || null : null,
    reg_no_type: payload.idType != null ? String(payload.idType).trim() || null : null,
    id_type: payload.idType != null ? String(payload.idType).trim() || null : null,
    bankname_id: bid,
    bankaccount: payload.bankAccountNo != null ? String(payload.bankAccountNo).trim() || null : null,
    accountholder: payload.bankAccountHolder != null ? String(payload.bankAccountHolder).trim() || null : null,
    avatar_url: payload.avatarUrl != null ? String(payload.avatarUrl).trim() || null : null,
    nricfront: payload.nricFrontUrl != null ? String(payload.nricFrontUrl).trim() || null : null,
    nricback: payload.nricBackUrl != null ? String(payload.nricBackUrl).trim() || null : null,
  };
}

export async function fetchPortalProfileByEmail(email: string): Promise<{
  ok: boolean;
  profile?: Record<string, unknown> | null;
  reason?: string;
}> {
  const base = getPortalApiBase();
  if (!base) return { ok: true, profile: null };
  try {
    const data = (await portalPost("access/portal-profile", {
      email: String(email || "").trim(),
    })) as {
      ok?: boolean;
      profile?: Record<string, unknown> | null;
      reason?: string;
    };
    if (data?.ok === false) {
      return { ok: false, reason: data.reason || "PROFILE_FAILED" };
    }
    const normalized = String(email || "").trim().toLowerCase();
    const unified = mapPortalGetResponseToUnified(data, normalized);
    return { ok: true, profile: unified as unknown as Record<string, unknown> };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "NETWORK_ERROR",
    };
  }
}

export async function savePortalProfile(payload: {
  fullName: string;
  legalName: string;
  nickname: string;
  phone: string;
  address: string;
  entityType: string;
  idType: string;
  idNumber: string;
  taxIdNo: string;
  bankId: string;
  bankAccountNo: string;
  bankAccountHolder: string;
  avatarUrl: string;
  nricFrontUrl: string | null;
  nricBackUrl: string | null;
  /** Ignored by portal PUT — kept for parity with Cleanlemons payload shape */
  clientId?: string;
  email?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const base = getPortalApiBase();
  if (!base) return { ok: true };
  const body = buildPortalPayloadFromUnified(payload);
  try {
    const data = (await portalPost("access/portal-profile-save", {
      email: String(payload.email || "").trim(),
      ...body,
    })) as { ok?: boolean; reason?: string };
    return { ok: data.ok !== false };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "SAVE_FAILED",
    };
  }
}

export async function fetchPortalPasswordStatus(emailArg?: string): Promise<{
  ok: boolean;
  hasPassword?: boolean;
  reason?: string;
}> {
  const base = getPortalApiBase();
  if (!base) return { ok: true, hasPassword: false };
  const em = String((emailArg ?? getMember()?.email) || "").trim();
  if (!em) return { ok: false, reason: "NO_EMAIL" };
  try {
    return (await portalPost("access/portal-password-status", { email: em })) as {
      ok: boolean;
      hasPassword?: boolean;
      reason?: string;
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "NETWORK_ERROR",
    };
  }
}

export async function fetchProfileBanks(): Promise<{
  ok: boolean;
  items?: Array<{ id: string; bankname?: string; label?: string; value?: string }>;
  reason?: string;
}> {
  return banks() as Promise<{
    ok: boolean;
    items?: Array<{ id: string; bankname?: string; label?: string; value?: string }>;
    reason?: string;
  }>;
}

export async function requestPortalPasswordResetEmail(email: string): Promise<{ ok: boolean; reason?: string }> {
  const base = getPortalApiBase();
  if (!base) return { ok: true };
  const url = `${base.replace(/\/$/, "")}/portal-auth/forgot-password`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: String(email || "").trim() }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function confirmPortalPasswordReset(params: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const base = getPortalApiBase();
  if (!base) return { ok: true };
  const url = `${base.replace(/\/$/, "")}/portal-auth/reset-password`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: String(params.email || "").trim(),
      code: String(params.code || "").trim(),
      newPassword: String(params.newPassword || ""),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

/** Coliving: ensure `tenantdetail` or `ownerdetail` exists before portal data loads (JWT). Demo: no-op. */
export async function ensureColivingPortalDetail(
  role: "tenant" | "owner"
): Promise<{ ok: boolean; reason?: string }> {
  const base = getPortalApiBase();
  if (!base) return { ok: true };
  const email = String(getMember()?.email || "").trim();
  if (!email) return { ok: false, reason: "NO_EMAIL" };
  try {
    const data = (await portalPost("access/coliving-ensure-detail", { email, role })) as {
      ok?: boolean;
      reason?: string;
    };
    return { ok: data.ok !== false, reason: data.reason };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "NETWORK_ERROR",
    };
  }
}
