/**
 * Coliving portal profile — same data model as Cleanlemons: GET/PUT /api/portal-auth/profile + banks + uploads.
 */

import { shouldUseDemoMock, portalPost } from "./portal-api";
import { PORTAL_KEYS, getMember } from "./portal-session";
import { banks } from "./tenant-api";

export function getPortalApiBase(): string {
  if (shouldUseDemoMock()) return "";
  if (process.env.NEXT_PUBLIC_USE_SAME_ORIGIN_API === "true") {
    return "/api";
  }
  const useProxy = process.env.NEXT_PUBLIC_USE_PROXY === "true";
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

/** Some reverse proxies strip `Authorization` to Next; duplicate token so proxy can forward. */
const PORTAL_AUTH_HEADER_FALLBACK = "X-Portal-Authorization";

async function portalUserFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getPortalApiBase();
  const url = `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const headers = new Headers(init.headers || undefined);
  const jwt = getPortalJwt();
  if (jwt) {
    const bearer = `Bearer ${jwt}`;
    headers.set("Authorization", bearer);
    headers.set(PORTAL_AUTH_HEADER_FALLBACK, bearer);
  }
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
    govIdentityLocked:
      !!(p as { gov_identity_locked?: unknown }).gov_identity_locked ||
      !!(p as { aliyun_ekyc_locked?: unknown }).aliyun_ekyc_locked,
    aliyunEkycLocked: !!(p as { aliyun_ekyc_locked?: unknown }).aliyun_ekyc_locked,
    singpassLinked: !!(p as { singpass_linked?: unknown }).singpass_linked,
    mydigitalLinked: !!(p as { mydigital_linked?: unknown }).mydigital_linked,
    phoneVerified: !!(p as { phone_verified?: unknown }).phone_verified,
    passportExpiryDate: (() => {
      const raw =
        (p as { passport_expiry_date?: unknown }).passport_expiry_date ??
        (p as { passportExpiryDate?: unknown }).passportExpiryDate;
      if (raw == null || raw === "") return "";
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
      const s = String(raw).trim();
      const ymd = /^(\d{4}-\d{2}-\d{2})/.exec(s);
      if (ymd) return ymd[1];
      return s.replace(/\s*T.*$/, "").slice(0, 10);
    })(),
    profileSelfVerifiedAt: (() => {
      const raw =
        (p as { profile_self_verified_at?: unknown }).profile_self_verified_at ??
        (p as { profileSelfVerifiedAt?: unknown }).profileSelfVerifiedAt;
      if (raw == null || raw === "") return "";
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
      return String(raw).trim();
    })(),
  };
}

export function buildPortalPayloadFromUnified(
  payload: {
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
  },
  options?: { identityLocked?: boolean; aliyunEkycVerified?: boolean; selfVerify?: boolean }
): Record<string, unknown> {
  const fullname = payload.fullName != null ? String(payload.fullName).trim() : "";
  const legal = payload.legalName != null ? String(payload.legalName).trim() : "";
  const bid =
    payload.bankId != null && String(payload.bankId).trim() !== "" ? String(payload.bankId).trim() : null;
  /** `portal_account.fullname` is legal name; prefer Legal name over Display full name so auto-save cannot overwrite eKYC/OCR with the nickname row. */
  const body: Record<string, unknown> = {
    fullname: legal || fullname || null,
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
  if (options?.identityLocked) {
    delete body.fullname;
    delete body.nric;
    delete body.entity_type;
  }
  /** After Aliyun eKYC, auto-save must not overwrite server-filled legal name / NRIC / OCR address (DB aliyun_ekyc_locked may be missing). */
  if (options?.aliyunEkycVerified) {
    delete body.fullname;
    delete body.nric;
    delete body.entity_type;
    delete body.reg_no_type;
    delete body.id_type;
    delete body.address;
    delete body.passport_expiry_date;
  }
  if (options?.selfVerify === true) {
    body.selfVerify = true;
  }
  return body;
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

export async function savePortalProfile(
  payload: {
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
  },
  options?: { govIdentityLocked?: boolean; aliyunEkycVerified?: boolean; selfVerify?: boolean }
): Promise<{ ok: boolean; reason?: string }> {
  const base = getPortalApiBase();
  if (!base) return { ok: true };
  const body = buildPortalPayloadFromUnified(payload, {
    identityLocked: options?.govIdentityLocked,
    aliyunEkycVerified: options?.aliyunEkycVerified,
    selfVerify: options?.selfVerify,
  });
  try {
    const data = (await portalPost("access/portal-profile-save", {
      email: String(payload.email || "").trim(),
      ...body,
    })) as { ok?: boolean; reason?: string };
    return { ok: data.ok !== false, reason: data.reason };
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
async function portalAuthFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getPortalApiBase();
  const method = (init.method ?? "GET").toUpperCase();
  let rel = path.replace(/^\//, "");
  const jwt = getPortalJwt();
  /** GET: append portalToken in query — some stacks strip Authorization on GET; Node accepts query (getPortalBearerToken). */
  if (jwt && method === "GET" && !/[?&]portalToken=/.test(rel)) {
    const joiner = rel.includes("?") ? "&" : "?";
    rel = `${rel}${joiner}portalToken=${encodeURIComponent(jwt)}`;
  }
  const url = `${base.replace(/\/$/, "")}/${rel}`;
  const headers = new Headers(init.headers || undefined);
  if (jwt) {
    const bearer = `Bearer ${jwt}`;
    headers.set("Authorization", bearer);
    headers.set(PORTAL_AUTH_HEADER_FALLBACK, bearer);
  }
  return fetch(url, { ...init, headers });
}

/** Gov ID link status (Singpass / MyDigital). Uses access/* + email like portal-profile (avoids long JWT in GET query). */
export async function fetchGovIdStatus(): Promise<{
  ok: boolean;
  singpass?: boolean;
  mydigital?: boolean;
  identityLocked?: boolean;
  aliyunEkycLocked?: boolean;
  reason?: string;
}> {
  const base = getPortalApiBase();
  if (!base) return { ok: false, reason: "NO_API" };
  const email = String(getMember()?.email || "").trim();
  if (!email) return { ok: false, reason: "NO_EMAIL" };
  try {
    const data = (await portalPost("access/gov-id-status", { email })) as {
      ok?: boolean;
      singpass?: boolean;
      mydigital?: boolean;
      identityLocked?: boolean;
      aliyunEkycLocked?: boolean;
      reason?: string;
    };
    if (data?.ok === false) return { ok: false, reason: data.reason || "REQUEST_FAILED" };
    return data as {
      ok: boolean;
      singpass?: boolean;
      mydigital?: boolean;
      identityLocked?: boolean;
      aliyunEkycLocked?: boolean;
      reason?: string;
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

export async function disconnectGovIdApi(provider: "singpass" | "mydigital"): Promise<{ ok: boolean; reason?: string }> {
  const base = getPortalApiBase();
  if (!base) return { ok: false, reason: "NO_API" };
  try {
    const r = await portalAuthFetch("portal-auth/gov-id/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
    if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
    return { ok: data.ok !== false };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

type OkReason = { ok: boolean; reason?: string; newEmail?: string };

export async function requestPortalEmailChangeOtp(newEmail: string): Promise<OkReason> {
  const base = getPortalApiBase();
  if (!base) return { ok: false, reason: "NO_API" };
  if (!getPortalJwt()) return { ok: false, reason: "NO_JWT" };
  try {
    const r = await portalAuthFetch("portal-auth/email-change/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newEmail: String(newEmail || "").trim() }),
    });
    const data = (await r.json().catch(() => ({}))) as OkReason;
    if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
    return data;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

export async function confirmPortalEmailChange(params: {
  newEmail: string;
  code: string;
}): Promise<OkReason> {
  const base = getPortalApiBase();
  if (!base) return { ok: false, reason: "NO_API" };
  if (!getPortalJwt()) return { ok: false, reason: "NO_JWT" };
  try {
    const r = await portalAuthFetch("portal-auth/email-change/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newEmail: String(params.newEmail || "").trim(),
        code: String(params.code || "").trim(),
      }),
    });
    const data = (await r.json().catch(() => ({}))) as OkReason;
    if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
    return data;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

export async function requestPortalPhoneVerifyOtp(phone: string): Promise<OkReason> {
  const base = getPortalApiBase();
  if (!base) return { ok: false, reason: "NO_API" };
  if (!getPortalJwt()) return { ok: false, reason: "NO_JWT" };
  try {
    const r = await portalAuthFetch("portal-auth/phone-verify/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: String(phone || "").trim() }),
    });
    const data = (await r.json().catch(() => ({}))) as OkReason;
    if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
    return data;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

export async function confirmPortalPhoneVerify(params: {
  phone: string;
  code: string;
}): Promise<OkReason> {
  const base = getPortalApiBase();
  if (!base) return { ok: false, reason: "NO_API" };
  if (!getPortalJwt()) return { ok: false, reason: "NO_JWT" };
  try {
    const r = await portalAuthFetch("portal-auth/phone-verify/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: String(params.phone || "").trim(),
        code: String(params.code || "").trim(),
      }),
    });
    const data = (await r.json().catch(() => ({}))) as OkReason;
    if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
    return data;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

export async function requestPortalPhoneChangeOtp(newPhone: string): Promise<OkReason> {
  const base = getPortalApiBase();
  if (!base) return { ok: false, reason: "NO_API" };
  if (!getPortalJwt()) return { ok: false, reason: "NO_JWT" };
  try {
    const r = await portalAuthFetch("portal-auth/phone-change/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPhone: String(newPhone || "").trim() }),
    });
    const data = (await r.json().catch(() => ({}))) as OkReason;
    if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
    return data;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

export async function confirmPortalPhoneChange(params: {
  newPhone: string;
  code: string;
}): Promise<OkReason> {
  const base = getPortalApiBase();
  if (!base) return { ok: false, reason: "NO_API" };
  if (!getPortalJwt()) return { ok: false, reason: "NO_JWT" };
  try {
    const r = await portalAuthFetch("portal-auth/phone-change/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newPhone: String(params.newPhone || "").trim(),
        code: String(params.code || "").trim(),
      }),
    });
    const data = (await r.json().catch(() => ({}))) as OkReason;
    if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
    return data;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

/**
 * Full browser redirect must hit the **Node API** host (not the Next `/api/portal/proxy` path).
 * Gov ID linking is account-bound, so portal JWT is required for both providers.
 */
export function buildGovIdStartUrl(
  provider: "singpass" | "mydigital",
  returnPath = "/demologin"
): string {
  const jwt = getPortalJwt();
  const ecs =
    typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
      : "";
  if (!ecs) return "";
  const frontend =
    typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "";
  const params = new URLSearchParams({
    provider,
    frontend,
    returnPath: returnPath.startsWith("/") ? returnPath : `/${returnPath}`,
  });
  if (!jwt) return "";
  params.set("portal_token", jwt);
  return `${ecs}/api/portal-auth/gov-id/start?${params.toString()}`;
}

/** Aliyun eKYC_PRO — uses /api/access/* (ECS token + email), same as portal-profile; MetaInfo from Web SDK. */
export async function startAliyunIdvEkyc(params: {
  metaInfo: string;
  docType?: "MYS01001" | "GLB03002";
  returnPath?: string;
}): Promise<{
  ok: boolean;
  transactionId?: string;
  transactionUrl?: string;
  reason?: string;
  message?: string;
}> {
  const base = getPortalApiBase();
  if (!base) return { ok: false, reason: "NO_API" };
  const email = String(getMember()?.email || "").trim();
  if (!email) return { ok: false, reason: "NO_EMAIL" };
  try {
    const data = (await portalPost("access/aliyun-idv/start", {
      email,
      metaInfo: String(params.metaInfo || "").trim(),
      docType: params.docType || "MYS01001",
      returnPath: params.returnPath || "/demoprofile",
    })) as {
      ok?: boolean;
      transactionId?: string;
      transactionUrl?: string;
      reason?: string;
      message?: string;
    };
    if (data?.ok === false) {
      return {
        ok: false,
        reason: data.reason || "START_FAILED",
        message: data.message,
      };
    }
    return {
      ok: true,
      transactionId: data.transactionId,
      transactionUrl: data.transactionUrl,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

export async function fetchAliyunIdvResult(transactionId: string): Promise<{
  ok: boolean;
  passed?: boolean;
  subCode?: string;
  reason?: string;
  message?: string;
  profileApplied?: boolean;
  profileReason?: string;
  profileBoundEmail?: string;
  /** Present when profile apply failed with EKYC_OCR_INCOMPLETE: key names/types only (no PII). */
  profileOcrDebug?: unknown;
  /** Alibaba CheckResult body.result shape: whether name/ID keys & non-empty strings exist (no raw values). */
  resultHints?: {
    hasNameKey?: boolean;
    hasIdKey?: boolean;
    nameKeys?: string[];
    idKeys?: string[];
    keyCount?: number;
    nameStringPresent?: boolean;
    idStringPresent?: boolean;
  };
}> {
  const base = getPortalApiBase();
  if (!base) return { ok: false, reason: "NO_API" };
  const email = String(getMember()?.email || "").trim();
  if (!email) return { ok: false, reason: "NO_EMAIL" };
  const tid = String(transactionId || "").trim();
  if (!tid) return { ok: false, reason: "NO_TRANSACTION_ID" };
  try {
    const data = (await portalPost("access/aliyun-idv/result", {
      email,
      transactionId: tid,
    })) as {
      ok?: boolean;
      passed?: boolean;
      subCode?: string;
      reason?: string;
      message?: string;
      profileApplied?: boolean;
      profileReason?: string;
      profileBoundEmail?: string;
      profileOcrDebug?: unknown;
      resultHints?: {
        hasNameKey?: boolean;
        hasIdKey?: boolean;
        nameKeys?: string[];
        idKeys?: string[];
        keyCount?: number;
        nameStringPresent?: boolean;
        idStringPresent?: boolean;
      };
    };
    if (data?.ok === false) {
      return {
        ok: false,
        reason: data.reason || "CHECK_FAILED",
        message: data.message,
      };
    }
    return {
      ok: true,
      passed: data.passed,
      subCode: data.subCode,
      profileApplied: data.profileApplied,
      profileReason: data.profileReason,
      profileBoundEmail: data.profileBoundEmail,
      profileOcrDebug: data.profileOcrDebug,
      resultHints: data.resultHints,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

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
