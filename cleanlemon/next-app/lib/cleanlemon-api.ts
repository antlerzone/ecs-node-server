/**
 * ECS Node Cleanlemons API (portal). Demo builds: leave NEXT_PUBLIC_CLEANLEMON_API_URL unset.
 */
import { getCleanlemonApiBase } from './portal-auth-mock';

const envApiToken = (process.env.NEXT_PUBLIC_CLEANLEMON_API_TOKEN || '').trim();
const envApiUsername = (process.env.NEXT_PUBLIC_CLEANLEMON_API_USERNAME || '').trim();

function resolveApiBase(): string {
  return getCleanlemonApiBase();
}

export type CleanlemonHealth = {
  ok: boolean;
  module?: string;
  clnTables?: number;
  reason?: string;
};

export type CleanlemonStats = {
  ok: boolean;
  clients?: number;
  properties?: number;
  schedules?: number;
  reason?: string;
};

/** Employee/Cleaner KPI: points per completed job by pricing service + deduction points by category. */
export type EmployeeCleanerKpiPersisted = {
  servicePointRules: Record<
    string,
    { mode: 'percentage_of_price' | 'fixed_points'; value: number }
  >;
  /** tab key -> row id -> deduction points */
  deductionPoints: Record<string, Record<string, number>>;
  /** period goal minimum scores for team/person/company */
  goalsByPeriod?: Record<
    'week' | 'month' | 'quarter',
    { teamMinScore: number; personMinScore: number; companyMinScore: number }
  >;
  goalCards?: Array<{
    id: string;
    name: string;
    period: 'week' | 'month' | 'quarter';
    startDate?: string;
    endDate?: string;
    goalItems?: Array<{
      id: string;
      target: 'team' | 'person' | 'company';
      minScore: number;
    }>;
    /** legacy support */
    minScores?: { team: number; person: number; company: number };
    remark?: string;
    status: 'active' | 'archived';
    kpiCountMethod?: string;
    staffKpiRules?: Array<{
      id: string;
      serviceProvider: string;
      countBy: 'by_price' | 'by_room' | 'by_job';
      rewardMode: 'fixed' | 'percentage';
      rewardValue: number;
      createdAt: string;
    }>;
    serviceKpiRules?: Record<string, { mode: 'percentage_of_price' | 'fixed_points'; value: number }>;
    createdAt: string;
    updatedAt: string;
  }>;
  deductionLogs?: Array<{
    id: string;
    team: string;
    remark: string;
    score: number;
    actionDate?: string;
    createdAt: string;
  }>;
  allowanceLogs?: Array<{
    id: string;
    team: string;
    remark: string;
    score: number;
    actionDate?: string;
    createdAt: string;
  }>;
};

/** Operator Pricing → Services location map (saved inside pricing JSON). */
export type ServiceAreaZoneMode = 'include' | 'exclude';

export type ServiceAreaZone = {
  id: string;
  lat: number;
  lng: number;
  /** Radius in kilometres (UI + saved JSON). Leaflet circles use `radiusKm * 1000` metres. */
  radiusKm: number;
  mode: ServiceAreaZoneMode;
  /** Display line from address search */
  label?: string;
};

/** Service location circle radius (km), UI + validation. */
export const SERVICE_AREA_RADIUS_KM_MIN = 0.01;
export const SERVICE_AREA_RADIUS_KM_MAX = 50;

export function normalizeServiceAreaZones(raw: unknown): ServiceAreaZone[] {
  if (!Array.isArray(raw)) return [];
  const out: ServiceAreaZone[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const id =
      typeof o.id === 'string' && o.id.trim()
        ? o.id.trim()
        : `zone-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const lat = Number(o.lat);
    const lng = Number(o.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    let radiusKm: number;
    const rk = Number(o.radiusKm);
    if (Number.isFinite(rk) && rk > 0) {
      radiusKm = rk;
    } else {
      /** Legacy: `radiusM` in older saved configs */
      const rm = Number(o.radiusM);
      if (Number.isFinite(rm) && rm > 0) {
        radiusKm = rm / 1000;
      } else {
        radiusKm = 0.03;
      }
    }
    radiusKm = Math.min(SERVICE_AREA_RADIUS_KM_MAX, Math.max(SERVICE_AREA_RADIUS_KM_MIN, radiusKm));
    const mode: ServiceAreaZoneMode = o.mode === 'exclude' ? 'exclude' : 'include';
    const label = typeof o.label === 'string' ? o.label : undefined;
    out.push({ id, lat, lng, radiusKm, mode, label });
  }
  return out;
}

export type CleanlemonPricingConfig = {
  selectedServices: string[];
  activeServiceTab: string;
  serviceConfigs: Record<string, unknown>;
  bookingMode: string;
  /** Per pricing service key (`general`, `homestay`, …): `instant` | `request_approve`. Overrides global `bookingMode` when set. */
  bookingModeByService?: Record<string, string>;
  leadTime: string;
  /** Per service lead-time key (same vocabulary as `leadTime`). Overrides global `leadTime` when set. */
  leadTimeByService?: Record<string, string>;
  /** Optional — merged by KPI Settings; preserved when Pricing save spreads previous config */
  employeeCleanerKpi?: EmployeeCleanerKpiPersisted;
  /** Geographic service circles (include / exclude); empty or omitted = no geo restriction. */
  serviceAreaZones?: ServiceAreaZone[];
};

export type AdminSubscription = {
  operatorId: string;
  operatorName: string;
  operatorEmail: string;
  planCode: string;
  monthlyPrice: number;
  status: string;
  activeFrom?: string | null;
  billingCycle?: 'monthly' | 'yearly' | string;
  terminatedAt?: string | null;
  terminatedBy?: string;
  terminatedReason?: string;
  /** Platform SaaS Bukku cash invoice (same idea as Coliving pricingplanlogs.invoiceid / invoiceurl) */
  saasBukkuInvoiceId?: string | null;
  saasBukkuInvoiceUrl?: string | null;
  addons?: Array<{
    id: string;
    addonCode: string;
    addonName: string;
    status: string;
    note?: string;
    saasBukkuInvoiceId?: string | null;
    saasBukkuInvoiceUrl?: string | null;
  }>;
  updatedAt?: string;
  expiryDate?: string | null;
};

export type OperatorSubscription = {
  operatorId: string;
  operatorName: string;
  operatorEmail: string;
  planCode: string;
  monthlyPrice: number;
  status: string;
  approvalStatus?: string;
  activeFrom?: string | null;
  expiryDate?: string | null;
  billingCycle?: 'monthly' | 'yearly' | string;
  updatedAt?: string;
  updatedNote?: string;
  saasBukkuInvoiceId?: string | null;
  saasBukkuInvoiceUrl?: string | null;
  addons?: Array<{
    id: string;
    addonCode: string;
    addonName: string;
    status: string;
    saasBukkuInvoiceId?: string | null;
    saasBukkuInvoiceUrl?: string | null;
  }>;
};

/** Cleanlemons `cln_pricingplan` rows (operator Stripe catalog). */
export type ClnPricingplanItem = {
  id: string;
  planCode: string;
  packageTitle: string;
  stripeProductId: string;
  stripePriceId: string;
  amountMyr: number;
  currency: string;
  intervalCode: 'month' | 'quarter' | 'year' | string;
  sortOrder?: number;
};

/** Cleanlemons `cln_addon` catalog (e.g. annual add-on price). */
export type ClmAddonCatalogItem = {
  id: string;
  addonCode: string;
  title: string;
  description?: string | null;
  amountMyr: number;
  currency: string;
  intervalCode: string;
  stripePriceId?: string;
  sortOrder?: number;
};

export type ClnAddonUiBilling = 'monthly' | 'quarterly' | 'yearly';

/** MYR amount to display/charge for one period, from a catalog row (yearly price ÷12 / ÷4). */
export function clnAddonAmountForBillingCycle(
  item: Pick<ClmAddonCatalogItem, 'amountMyr' | 'intervalCode'>,
  billing: ClnAddonUiBilling
): number {
  const interval = String(item.intervalCode || 'year').toLowerCase();
  const amount = Number(item.amountMyr || 0);
  if (interval === 'year') {
    if (billing === 'yearly') return Math.round(amount);
    if (billing === 'quarterly') return Math.round(amount / 4);
    return Math.round(amount / 12);
  }
  if (interval === 'quarter') {
    if (billing === 'yearly') return Math.round(amount * 4);
    if (billing === 'quarterly') return Math.round(amount);
    return Math.round(amount / 3);
  }
  if (billing === 'yearly') return Math.round(amount * 12);
  if (billing === 'quarterly') return Math.round(amount * 3);
  return Math.round(amount);
}

const PORTAL_JWT_KEY = 'cleanlemons_portal_jwt';

type FetchOptions = RequestInit & { path: string };

async function apiFetch({ path, ...init }: FetchOptions): Promise<Response> {
  const base = resolveApiBase();
  const url = base ? `${base}${path}` : path;
  const headers = new Headers(init.headers || undefined);
  /** Logged-in portal JWT must win over NEXT_PUBLIC_CLEANLEMON_API_TOKEN (otherwise company-email / TAC calls get 401). */
  if (!headers.has('Authorization')) {
    if (typeof window !== 'undefined') {
      try {
        const pjwt = localStorage.getItem(PORTAL_JWT_KEY) || '';
        if (pjwt) headers.set('Authorization', `Bearer ${pjwt}`);
      } catch {
        /* ignore */
      }
    }
    if (!headers.has('Authorization') && envApiToken) {
      headers.set('Authorization', `Bearer ${envApiToken}`);
    }
  }
  if (envApiUsername && !headers.has('X-API-Username')) {
    headers.set('X-API-Username', envApiUsername);
  }
  return fetch(url, { ...init, headers });
}

function getPortalJwt(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(PORTAL_JWT_KEY) || '';
  } catch {
    return '';
  }
}

/** Portal JWT (OAuth callback) — for /api/portal-auth/* user endpoints. */
async function portalUserFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = resolveApiBase();
  const url = base ? `${base}${path}` : path;
  const headers = new Headers(init.headers || undefined);
  const jwt = getPortalJwt();
  if (jwt) {
    headers.set('Authorization', `Bearer ${jwt}`);
  }
  return fetch(url, { ...init, headers });
}

export async function fetchPortalPasswordStatus(): Promise<{
  ok: boolean;
  hasPassword?: boolean;
  reason?: string;
}> {
  if (!getPortalJwt()) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  const r = await portalUserFetch('/api/portal-auth/password-status', { cache: 'no-store' });
  if (r.status === 401) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; hasPassword?: boolean; reason?: string };
  if (!r.ok) {
    return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  }
  return data;
}

/** Upsert `cln_employeedetail` for JWT email; returns fresh `cleanlemons` for `user.cleanlemons`. */
export async function ensureCleanlemonsEmployeeProfile(body?: {
  fullName?: string;
}): Promise<{
  ok: boolean;
  cleanlemons?: import('./auth-context').CleanlemonsJwtContext | null;
  reason?: string;
}> {
  if (!getPortalJwt()) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  const r = await portalUserFetch('/api/portal-auth/cleanlemons-ensure-employee', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body && typeof body === 'object' ? body : {}),
  });
  if (r.status === 401) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    cleanlemons?: import('./auth-context').CleanlemonsJwtContext | null;
    reason?: string;
  };
  if (!r.ok) {
    return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  }
  return { ok: !!data.ok, cleanlemons: data.cleanlemons ?? null };
}

export async function fetchPortalMemberRoles(): Promise<{
  ok: boolean;
  email?: string;
  roles?: Array<{ type?: string; [k: string]: unknown }>;
  cleanlemons?: unknown;
  reason?: string;
}> {
  if (!getPortalJwt()) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  const r = await portalUserFetch('/api/portal-auth/member-roles', { cache: 'no-store' });
  if (r.status === 401) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    email?: string;
    roles?: Array<{ type?: string; [k: string]: unknown }>;
    cleanlemons?: unknown;
    reason?: string;
  };
  if (!r.ok) {
    return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  }
  return { ok: !!data.ok, email: data.email, roles: data.roles, cleanlemons: data.cleanlemons };
}

export async function requestPortalPasswordResetEmail(email: string): Promise<{ ok: boolean; reason?: string }> {
  const base = resolveApiBase();
  const url = base ? `${base}/api/portal-auth/forgot-password` : '/api/portal-auth/forgot-password';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      /** Lets ECS Node pick CLEANLEMON_* SMTP (local dev may use port 3000, not only 3100). */
      'X-Cleanlemons-Portal': '1',
    },
    body: JSON.stringify({ email: String(email || '').trim() }),
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
  const base = resolveApiBase();
  const url = base ? `${base}/api/portal-auth/reset-password` : '/api/portal-auth/reset-password';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cleanlemons-Portal': '1',
    },
    body: JSON.stringify({
      email: String(params.email || '').trim(),
      code: String(params.code || '').trim(),
      newPassword: String(params.newPassword || ''),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

/** Avoids unhandled rejections when fetch fails or response is non-JSON (e.g. 502 HTML). */
async function fetchJsonSafe<T>(promise: Promise<Response>): Promise<T> {
  try {
    const r = await promise;
    const data = (await r.json().catch(() => ({}))) as T & { reason?: string };
    if (!r.ok) {
      const reason =
        data && typeof data === 'object' && 'reason' in data && (data as { reason?: string }).reason
          ? String((data as { reason?: string }).reason)
          : `HTTP_${r.status}`;
      return { ...(data as object), ok: false, reason } as T;
    }
    return data as T;
  } catch {
    return { ok: false, reason: 'NETWORK_ERROR' } as T;
  }
}

export { getCleanlemonApiBase } from './portal-auth-mock';

export async function fetchCleanlemonHealth(): Promise<CleanlemonHealth> {
  const base = resolveApiBase();
  if (!base) {
    const r = await fetch('/api/cleanlemon/health', { cache: 'no-store' });
    if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
    return r.json();
  }
  const r = await fetch(`${base}/api/cleanlemon/health`, { cache: 'no-store' });
  if (!r.ok) {
    return { ok: false, reason: `HTTP_${r.status}` };
  }
  return r.json();
}

export async function fetchCleanlemonStats(): Promise<CleanlemonStats> {
  const base = resolveApiBase();
  if (!base) {
    const r = await fetch('/api/cleanlemon/stats', { cache: 'no-store' });
    if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
    return r.json();
  }
  const r = await fetch(`${base}/api/cleanlemon/stats`, { cache: 'no-store' });
  if (!r.ok) {
    return { ok: false, reason: `HTTP_${r.status}` };
  }
  return r.json();
}

export async function fetchEmployeeBanks(): Promise<{ ok: boolean; items?: Array<{ id: string; bankname?: string }> ; reason?: string }> {
  const r = await apiFetch({ path: '/api/cleanlemon/banks', cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function uploadEmployeeFileToOss(file: File, clientId: string): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('clientId', clientId);
  const r = await apiFetch({
    path: '/api/cleanlemon/upload',
    method: 'POST',
    body: formData,
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchEmployeeProfileByEmail(
  email: string,
  operatorId?: string
): Promise<{ ok: boolean; profile?: any; reason?: string }> {
  const qs = new URLSearchParams({ email: String(email || '') });
  const oid = String(operatorId || '').trim();
  if (oid) qs.set('operatorId', oid);
  const r = await apiFetch({ path: `/api/cleanlemon/employee/profile?${qs.toString()}`, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function saveEmployeeProfile(payload: any): Promise<{ ok: boolean; profile?: any; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/profile',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function requestPortalEmailChangeOtp(newEmail: string): Promise<{
  ok: boolean;
  reason?: string;
  newEmail?: string;
}> {
  if (!getPortalJwt()) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  const r = await portalUserFetch('/api/portal-auth/email-change/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newEmail: String(newEmail || '').trim() }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string; newEmail?: string };
  if (!r.ok) {
    return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  }
  return { ok: data.ok !== false, newEmail: data.newEmail };
}

export async function confirmPortalEmailChange(params: {
  newEmail: string;
  code: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!getPortalJwt()) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  const r = await portalUserFetch('/api/portal-auth/email-change/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      newEmail: String(params.newEmail || '').trim(),
      code: String(params.code || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) {
    return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  }
  return { ok: data.ok !== false };
}

/** Aliyun eKYC — portal JWT; same backend as Coliving. */
export async function startPortalAliyunIdvEkyc(params: {
  metaInfo: string;
  docType?: 'MYS01001' | 'GLB03002';
  returnPath?: string;
}): Promise<{
  ok: boolean;
  transactionId?: string;
  transactionUrl?: string;
  reason?: string;
  message?: string;
}> {
  if (!getPortalJwt()) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  const r = await portalUserFetch('/api/portal-auth/aliyun-idv/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      metaInfo: String(params.metaInfo || '').trim(),
      docType: params.docType || 'MYS01001',
      returnPath: params.returnPath || '/portal/client/profile',
    }),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    return { ok: false, reason: (data.reason as string) || `HTTP_${r.status}` };
  }
  return data as {
    ok: boolean;
    transactionId?: string;
    transactionUrl?: string;
    reason?: string;
    message?: string;
  };
}

export async function fetchPortalAliyunIdvResult(transactionId: string): Promise<{
  ok: boolean;
  passed?: boolean;
  subCode?: string;
  reason?: string;
  message?: string;
  profileApplied?: boolean;
  profileReason?: string;
  profileBoundEmail?: string;
}> {
  if (!getPortalJwt()) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  const tid = encodeURIComponent(String(transactionId || '').trim());
  const r = await portalUserFetch(`/api/portal-auth/aliyun-idv/result?transactionId=${tid}`, {
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    return { ok: false, reason: (data.reason as string) || `HTTP_${r.status}` };
  }
  return data as {
    ok: boolean;
    passed?: boolean;
    subCode?: string;
    reason?: string;
    message?: string;
    profileApplied?: boolean;
    profileReason?: string;
    profileBoundEmail?: string;
  };
}

export type ClnDriverTripPayload = {
  id: string;
  operatorId: string;
  requesterEmployeeId: string;
  requesterEmail: string;
  pickup: string;
  dropoff: string;
  scheduleOffset: string;
  orderTimeUtc: string | null;
  businessTimeZone: string;
  status: string;
  fulfillmentType: string;
  acceptedDriverEmployeeId: string | null;
  acceptedAtUtc: string | null;
  completedAtUtc: string | null;
  createdAtUtc: string | null;
  updatedAtUtc: string | null;
  requesterFullName?: string;
  /** Requester's team label from operator CRM (`crm_json.team`), when present. */
  requesterTeamName?: string | null;
  acceptedDriverFullName?: string;
  acceptedDriverPhone?: string;
  acceptedDriverAvatarUrl?: string;
  /** From accepted driver's profile (driver vehicle) — same idea as Grab plate for display on requester order. */
  acceptedDriverCarPlate?: string | null;
  acceptedDriverCarFrontUrl?: string | null;
  acceptedDriverCarBackUrl?: string | null;
  /** Driver tapped "Start trip" after pickup (required before Finish when migration applied). */
  driverStartedAtUtc?: string | null;
  grabCarPlate?: string;
  grabPhone?: string;
  grabProofImageUrl?: string;
  grabBookedByEmail?: string;
  grabBookedAtUtc?: string | null;
};

export async function uploadDriverVehiclePhoto(
  file: File
): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/driver-vehicle-photo',
    method: 'POST',
    body: formData,
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchDriverVehicle(): Promise<{
  ok: boolean;
  vehicle?: { carPlate: string; carFrontUrl: string; carBackUrl: string };
  legacy?: boolean;
  reason?: string;
}> {
  const r = await apiFetch({ path: '/api/cleanlemon/employee/driver-vehicle', cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function saveDriverVehicle(body: {
  carPlate?: string;
  carFrontUrl?: string;
  carBackUrl?: string;
}): Promise<{ ok: boolean; vehicle?: { carPlate: string; carFrontUrl: string; carBackUrl: string }; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/driver-vehicle',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/** Requester — create route order (`POST /employee/driver-trip`). */
export async function postEmployeeDriverTrip(body: {
  operatorId: string;
  pickup: string;
  dropoff: string;
  scheduleOffset: 'now' | '15' | '30';
  orderTimeIso: string;
}): Promise<{ ok: boolean; trip?: ClnDriverTripPayload; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/driver-trip',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; trip?: ClnDriverTripPayload; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, trip: data.trip, reason: data.reason };
}

export async function fetchPendingDriverTrips(operatorId: string): Promise<{
  ok: boolean;
  items?: ClnDriverTripPayload[];
  reason?: string;
}> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const r = await apiFetch({ path: `/api/cleanlemon/employee/driver-trip/open?${qs}`, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchActiveDriverTrip(operatorId: string): Promise<{
  ok: boolean;
  trip?: ClnDriverTripPayload | null;
  reason?: string;
}> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const r = await apiFetch({ path: `/api/cleanlemon/employee/driver-trip/driver-active?${qs}`, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchDriverTripHistory(
  operatorId: string,
  limit = 40
): Promise<{ ok: boolean; items?: ClnDriverTripPayload[]; reason?: string }> {
  const qs = new URLSearchParams({
    operatorId: String(operatorId || '').trim(),
    limit: String(limit),
  });
  const r = await apiFetch({ path: `/api/cleanlemon/employee/driver-trip/driver-history?${qs}`, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function acceptDriverTripRequest(
  tripId: string,
  operatorId: string
): Promise<{ ok: boolean; trip?: ClnDriverTripPayload; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/driver-trip/accept',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      tripId: String(tripId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    trip?: ClnDriverTripPayload;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, trip: data.trip, reason: data.reason };
}

export async function postDriverTripStart(
  tripId: string,
  operatorId: string
): Promise<{ ok: boolean; trip?: ClnDriverTripPayload; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/driver-trip/start',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      tripId: String(tripId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    trip?: ClnDriverTripPayload;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, trip: data.trip, reason: data.reason };
}

export async function postDriverTripReleaseAccept(
  tripId: string,
  operatorId: string
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/driver-trip/release-accept',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      tripId: String(tripId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, reason: data.reason };
}

export async function finishDriverTripRequest(
  tripId: string,
  operatorId: string
): Promise<{ ok: boolean; trip?: ClnDriverTripPayload; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/driver-trip/finish',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      tripId: String(tripId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    trip?: ClnDriverTripPayload;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, trip: data.trip, reason: data.reason };
}

/** Employee (requester) — active route order they placed (pending / driver accepted / Grab). */
export async function fetchRequesterActiveDriverTrip(operatorId: string): Promise<{
  ok: boolean;
  trip?: ClnDriverTripPayload | null;
  reason?: string;
}> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const r = await apiFetch({
    path: `/api/cleanlemon/employee/driver-trips/requester-active?${qs}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    trip?: ClnDriverTripPayload | null;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, trip: data.trip ?? null };
}

/** Employee (requester) — past route orders for this operator (completed / cancelled). */
export async function fetchRequesterDriverTripHistory(
  operatorId: string,
  limit = 60
): Promise<{ ok: boolean; items?: ClnDriverTripPayload[]; reason?: string }> {
  const qs = new URLSearchParams({
    operatorId: String(operatorId || '').trim(),
    limit: String(Math.min(200, Math.max(1, limit))),
  });
  const r = await apiFetch({
    path: `/api/cleanlemon/employee/driver-trips/requester-history?${qs}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: ClnDriverTripPayload[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, items: data.items, reason: data.reason };
}

export async function postRequesterCancelDriverTrip(body: {
  operatorId: string;
  tripId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/driver-trips/requester-cancel',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true };
}

/** Dobi laundry — day bundle, machines, lots (`cln_dobi_*`). */
export async function fetchDobiDay(operatorId: string, businessDate: string): Promise<any> {
  const qs = new URLSearchParams({
    operatorId: String(operatorId || '').trim(),
    businessDate: String(businessDate || '').trim().slice(0, 10),
  });
  return fetchJsonSafe(apiFetch({ path: `/api/cleanlemon/employee/dobi/day?${qs}`, cache: 'no-store' }));
}

export async function postDobiPreviewSplit(body: {
  operatorId: string;
  lines: Array<{ teamName?: string; itemTypeId: string; qty: number }>;
}): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/employee/dobi/preview-split',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function postDobiCommitIntake(body: {
  operatorId: string;
  businessDate: string;
  lines: Array<{ teamName?: string; itemTypeId: string; qty: number }>;
}): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/employee/dobi/commit-intake',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function postDobiLotAction(body: {
  operatorId: string;
  lotId: string;
  action: string;
  machineId?: string;
  handoffRemark?: string;
  businessDate?: string;
  /** Partial return from ready: how many pcs taken per `cln_dobi_lot_item` row. */
  takeouts?: Array<{ itemLineId: string; qty: number }>;
}): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/employee/dobi/lot-action',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** Dobi staff — damaged linens (stored in `cln_dobi_event` as `damage_linen`). */
export async function postDobiDamageLinen(body: {
  operatorId: string;
  businessDate: string;
  remark: string;
  lines: Array<{ itemTypeId: string; qty: number; teamName?: string }>;
  photoUrls?: string[];
}): Promise<{ ok?: boolean; id?: string; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/employee/dobi/damage-linen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** Cleaner requests QR; dobi scans URL and approves (writes `linenLogs`). */
export async function fetchEmployeeLinensQrMode(operatorId: string): Promise<{
  ok?: boolean;
  linenQrStyle?: 'rotate_1min' | 'permanent';
  reason?: string;
}> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  return fetchJsonSafe(
    apiFetch({ path: `/api/cleanlemon/employee/linens/qr-mode?${qs}`, cache: 'no-store' })
  );
}

export async function postEmployeeLinensQrRequest(body: {
  operatorId: string;
  date: string;
  action: string;
  team?: string;
  totals: Record<string, number>;
  /** When set, intake uses these lines (item types from Dobi settings). */
  lines?: Array<{ itemTypeId: string; qty: number; label?: string }>;
  missingQty?: number;
  remark?: string;
}): Promise<{
  ok?: boolean;
  token?: string;
  expiresAt?: string;
  linenQrStyle?: 'rotate_1min' | 'permanent';
  reason?: string;
}> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/employee/linens/qr-request',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function fetchDobiLinenQrPreview(operatorId: string, token: string): Promise<any> {
  const qs = new URLSearchParams({
    operatorId: String(operatorId || '').trim(),
    token: String(token || '').trim(),
  });
  return fetchJsonSafe(apiFetch({ path: `/api/cleanlemon/employee/dobi/linen-qr?${qs}`, cache: 'no-store' }));
}

export async function postDobiLinenQrApprove(body: {
  operatorId: string;
  token: string;
}): Promise<{ ok?: boolean; entry?: unknown; reason?: string; missingKeys?: string[] }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/employee/dobi/linen-qr-approve',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** Dobi staff: add pending-wash batches manually (no linen QR). */
export async function postDobiAppendIntake(body: {
  operatorId: string;
  businessDate: string;
  lines: Array<{ teamName: string; itemTypeId: string; qty: number }>;
  /** `pending_wash` (default) or `ready` — skip machines and place straight in Ready. */
  targetStage?: 'pending_wash' | 'ready';
}): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/employee/dobi/append-intake',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function fetchDobiReport(operatorId: string, fromDate: string, toDate: string): Promise<any> {
  const qs = new URLSearchParams({
    operatorId: String(operatorId || '').trim(),
    fromDate: String(fromDate || '').slice(0, 10),
    toDate: String(toDate || '').slice(0, 10),
  });
  return fetchJsonSafe(apiFetch({ path: `/api/cleanlemon/employee/dobi/report?${qs}`, cache: 'no-store' }));
}

export async function fetchDobiSummary(operatorId: string, fromDate: string, toDate: string): Promise<any> {
  const qs = new URLSearchParams({
    operatorId: String(operatorId || '').trim(),
    fromDate: String(fromDate || '').slice(0, 10),
    toDate: String(toDate || '').slice(0, 10),
  });
  return fetchJsonSafe(apiFetch({ path: `/api/cleanlemon/employee/dobi/summary?${qs}`, cache: 'no-store' }));
}

/** Workflow audit for one business day (staff email, name, machine, time). */
export async function fetchDobiDayEvents(operatorId: string, businessDate: string): Promise<{
  ok?: boolean;
  events?: Array<{
    id: string;
    eventType: string;
    createdByEmail: string;
    staffName: string | null;
    createdAtUtc: string | null;
    machineName: string | null;
    machineKind: string | null;
  }>;
  reason?: string;
}> {
  const qs = new URLSearchParams({
    operatorId: String(operatorId || '').trim(),
    businessDate: String(businessDate || '').slice(0, 10),
  });
  return fetchJsonSafe(apiFetch({ path: `/api/cleanlemon/employee/dobi/day-events?${qs}`, cache: 'no-store' }));
}

export async function fetchOperatorDobiConfig(operatorId: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  return fetchJsonSafe(apiFetch({ path: `/api/cleanlemon/operator/dobi/config?${qs}`, cache: 'no-store' }));
}

export async function putOperatorDobiConfig(body: {
  operatorId: string;
  handoffWashToDryWarningMinutes?: number;
  linenQrStyle?: 'rotate_1min' | 'permanent';
}): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/dobi/config',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function putOperatorDobiItemTypes(body: {
  operatorId: string;
  items: Array<{
    id?: string;
    label: string;
    active?: boolean;
    /** Max pieces of this type per wash load (batches do not mix types). */
    washBatchPcs?: number;
    /** Planned wash duration (minutes) for this type when starting wash. */
    washRoundMinutes?: number;
  }>;
}): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/dobi/item-types',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function putOperatorDobiMachines(body: {
  operatorId: string;
  machines: Array<{
    id?: string;
    kind: 'washer' | 'dryer' | 'iron';
    name: string;
    capacityPcs?: number;
    roundMinutes?: number;
    active?: boolean;
  }>;
}): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/dobi/machines',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function fetchOperatorDriverTrips(params: {
  operatorId: string;
  status?: string;
  limit?: number;
  /** YYYY-MM-DD Malaysia business day on order/created instant */
  businessDate?: string;
  team?: string;
  /** `grab` | `driver` — pair with `acceptedDriverEmployeeId` for Driver A/B/C */
  fulfillment?: string;
  acceptedDriverEmployeeId?: string;
}): Promise<{ ok: boolean; items?: ClnDriverTripPayload[]; reason?: string }> {
  const oid = String(params.operatorId || '').trim();
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  const qs = new URLSearchParams({ operatorId: oid });
  const st = String(params.status || '').trim();
  if (st) qs.set('status', st);
  if (params.limit != null) qs.set('limit', String(params.limit));
  const bd = String(params.businessDate || '').trim();
  if (bd) qs.set('businessDate', bd);
  const tm = String(params.team || '').trim();
  if (tm) qs.set('team', tm);
  const fu = String(params.fulfillment || '').trim();
  if (fu) qs.set('fulfillment', fu);
  const ade = String(params.acceptedDriverEmployeeId || '').trim();
  if (ade) qs.set('acceptedDriverEmployeeId', ade);
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/driver-trips?${qs.toString()}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: ClnDriverTripPayload[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, items: data.items || [] };
}

export type ClnOperatorDriverEmployeeRow = {
  slotLabel: string;
  slotLetter: string;
  employeeId: string;
  fullName: string;
  email: string;
  phone: string;
  carPlate: string;
};

export async function fetchOperatorDriverEmployees(
  operatorId: string
): Promise<{ ok: boolean; items?: ClnOperatorDriverEmployeeRow[]; reason?: string }> {
  const oid = String(operatorId || '').trim();
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  const qs = new URLSearchParams({ operatorId: oid });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/driver-employees?${qs.toString()}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: ClnOperatorDriverEmployeeRow[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, items: data.items || [] };
}

export type ClnDriverFleetStatusRow = {
  employeeId: string;
  fullName: string;
  email: string;
  phone: string;
  fleetStatus: 'vacant' | 'waiting' | 'pickup' | 'ongoing' | 'off_duty';
  activeTrip: {
    id: string;
    pickupText: string;
    dropoffText: string;
    acceptedAtUtc: string | null;
    driverStartedAtUtc: string | null;
    orderTimeUtc: string | null;
    createdAtUtc: string | null;
  } | null;
};

export async function fetchOperatorDriverFleetStatus(
  operatorId: string
): Promise<{
  ok: boolean;
  items?: ClnDriverFleetStatusRow[];
  pendingPoolCount?: number;
  reason?: string;
}> {
  const oid = String(operatorId || '').trim();
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  const qs = new URLSearchParams({ operatorId: oid });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/driver-fleet-status?${qs.toString()}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: ClnDriverFleetStatusRow[];
    pendingPoolCount?: number;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, items: data.items || [], pendingPoolCount: data.pendingPoolCount ?? 0 };
}

export async function postOperatorDriverTripGrab(body: {
  operatorId: string;
  tripId: string;
  grabCarPlate?: string;
  grabPhone?: string;
  grabProofImageUrl?: string;
}): Promise<{ ok: boolean; trip?: ClnDriverTripPayload; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/driver-trip/grab',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    trip?: ClnDriverTripPayload;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, trip: data.trip };
}

/** Cleanlemons operator companies linked to this B2B client (`cln_client_operator`). */
export type ClientLinkedOperatorRow = {
  operatorId: string;
  operatorName: string;
  operatorEmail: string;
};

/** Coliving ↔ Cleanlemons bridge: which Coliving `operatordetail` (company) is integrated. */
export type ClientIntegrationColivingInfo = {
  linked: boolean;
  colivingOperatordetailId?: string;
  colivingOperatorTitle?: string;
  colivingOperatorEmail?: string;
};

export async function fetchClientIntegrationContext(
  email: string,
  operatorId: string
): Promise<{
  ok?: boolean;
  linkedOperators?: ClientLinkedOperatorRow[];
  coliving?: ClientIntegrationColivingInfo;
  reason?: string;
}> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/integration/context',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    linkedOperators?: ClientLinkedOperatorRow[];
    coliving?: ClientIntegrationColivingInfo;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

/** Client portal — one TTLock login (multi-slot); Coliving-synced rows are `source: 'coliving'`. */
export type ClientTtlockAccountRow = {
  slot: number;
  accountName: string;
  username: string;
  source: 'coliving' | 'manual';
  manageable: boolean;
  connected: boolean;
};

/** Client portal — TTLock onboarding status (requires B2B client ↔ operator link). */
export async function fetchClientTtlockOnboardStatus(
  email: string,
  operatorId: string
): Promise<{
  ok?: boolean;
  ttlockConnected?: boolean;
  ttlockCreateEverUsed?: boolean;
  accounts?: ClientTtlockAccountRow[];
  reason?: string;
}> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/ttlock/onboard-status',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email || '').trim().toLowerCase(), operatorId: String(operatorId || '').trim() }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    ttlockConnected?: boolean;
    ttlockCreateEverUsed?: boolean;
    accounts?: ClientTtlockAccountRow[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function fetchClientTtlockCredentials(
  email: string,
  operatorId: string,
  ttlockSlot = 0
): Promise<{ ok?: boolean; username?: string; password?: string; slot?: number; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/ttlock/credentials',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      ttlockSlot,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    username?: string;
    password?: string;
    slot?: number;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postClientTtlockConnect(
  email: string,
  operatorId: string,
  username: string,
  password: string,
  opts?: { accountName?: string }
): Promise<{ ok?: boolean; mode?: string; username?: string; slot?: number; source?: string; accountName?: string; reason?: string }> {
  const accountName = opts?.accountName != null ? String(opts.accountName).trim() : '';
  const r = await apiFetch({
    path: '/api/cleanlemon/client/ttlock/connect',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      username: String(username || '').trim(),
      password: String(password || ''),
      accountName: accountName || undefined,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    mode?: string;
    username?: string;
    slot?: number;
    source?: string;
    accountName?: string;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postClientTtlockDisconnect(
  email: string,
  operatorId: string,
  ttlockSlot = 0
): Promise<{ ok?: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/ttlock/disconnect',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      ttlockSlot,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

/** `cln_property_link_request` row (joined with property name/address). */
export type CleanlemonPropertyLinkRequestRow = {
  id: string;
  kind: string;
  propertyId: string;
  clientdetailId: string;
  operatorId: string;
  status: string;
  payload?: unknown;
  remarks?: string;
  decidedByEmail?: string;
  createdAt?: string;
  decidedAt?: string | null;
  propertyName?: string;
  unitName?: string;
  address?: string;
  /** From `cln_clientdetail.fullname` */
  clientName?: string;
  /** From `cln_clientdetail.email` */
  clientEmail?: string;
};

/** Client asked to link this operator to their property — operator must approve. */
export const CLN_PLR_KIND_CLIENT_REQUESTS_OPERATOR = 'client_requests_operator';
/** Operator created/updated property toward a client — client must approve binding. */
export const CLN_PLR_KIND_OPERATOR_REQUESTS_CLIENT = 'operator_requests_client';

export type ClientPortalPropertyRow = {
  id: string;
  name: string;
  address: string;
  unitNumber: string;
  /** True when created in client portal (`client_portal_owned=1`); false when Coliving-synced. */
  clientPortalOwned?: boolean;
  premisesType?: string;
  /** Cleanlemons operator (`cln_property.operator_id` → company master). */
  operatorId?: string;
  operatorName?: string;
  operatorEmail?: string;
  /** Pending `client_requests_operator` row — operator has not approved yet. */
  clientOperatorLinkPending?: boolean;
  /** Property group names (`cln_property_group` via link table), sorted. */
  groupNames?: string[];
  /** `owner` = your `cln_property` row; `shared` = visible via group membership only. */
  portalAccess?: 'owner' | 'shared';
  createdAt?: string;
  updatedAt?: string;
};

/** B2B client portal — `cln_property` rows with `clientdetail_id` (Coliving sync + creates). */
export async function fetchClientPortalProperties(
  email: string,
  operatorId: string
): Promise<{ ok: boolean; items?: ClientPortalPropertyRow[]; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/properties/list',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: ClientPortalPropertyRow[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, items: Array.isArray(data.items) ? data.items : [] };
}

/** Re-run Coliving → Cleanlemons property + room row upsert (operator link integration or existing `coliving_propertydetail_id` FKs). */
export async function fetchClientPortalSyncColivingProperties(
  email: string,
  operatorId: string
): Promise<{
  ok: boolean;
  syncedOperators?: number;
  itemCount?: number;
  reason?: string;
}> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/properties/sync-coliving',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    syncedOperators?: number;
    itemCount?: number;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return {
    ok: !!data.ok,
    syncedOperators: data.syncedOperators,
    itemCount: data.itemCount,
    reason: data.reason,
  };
}

export type ClientPortalPropertyPricingRow = {
  key: string;
  label: string;
  display: string;
  source?: string;
};

/** Coliving `propertydetail` / `roomdetail` smartdoor_id → lockdetail (B2B client portal, read-only). */
export type ClientPortalSmartdoorBindingsRoom = {
  roomId: string;
  roomDisplayLabel: string;
  lockdetailId: string;
  lockDisplayLabel: string;
};

export type ClientPortalSmartdoorBindings = {
  property: { lockdetailId: string; displayLabel: string } | null;
  rooms: ClientPortalSmartdoorBindingsRoom[];
};

/** Locks bound to this `cln_property` via `cln_property_lock` (M:N; not Coliving-only). */
export type ClnNativeLockBindingRow = {
  bindId: string;
  lockdetailId: string;
  integrationSource: string;
  ttlockSlot: number;
  lockLabel: string;
};

export type GroupPermTriplet = {
  create: boolean;
  edit: boolean;
  delete: boolean;
};

export type GroupMemberPerm = {
  property: GroupPermTriplet;
  booking: GroupPermTriplet;
  status: GroupPermTriplet;
};

export type ClientPortalPropertyDetail = {
  id: string;
  name: string;
  address: string;
  unitNumber: string;
  /** Created in client portal vs Coliving-imported (restricts editable fields). */
  clientPortalOwned?: boolean;
  /** When true, client may edit core fields (name, address, counts, lift, security, etc.). False = Coliving-list-only rows until operator links + B2B client is bound. */
  clientPortalAllowsFullEdit?: boolean;
  operatorId: string;
  cleanlemonsOperatorName: string;
  cleanlemonsOperatorEmail: string;
  colivingPropertydetailId: string;
  /** Coliving `roomdetail.id` when this `cln_property` row is room-scoped; empty if entire-unit row. */
  colivingRoomdetailId?: string;
  mailboxPassword: string;
  bedCount: number | null;
  roomCount: number | null;
  bathroomCount: number | null;
  kitchen: number | null;
  livingRoom: number | null;
  balcony: number | null;
  staircase: number | null;
  specialAreaCount: number | null;
  liftLevel: string;
  contact: string;
  colivingOperatorTitle: string;
  colivingOperatorContact: string;
  pricing: ClientPortalPropertyPricingRow[];
  premisesType?: string;
  securitySystem?: string;
  securityUsername?: string;
  /** Coliving `propertydetail.security_system_credentials_json` when linked. */
  securitySystemCredentials?: Record<string, unknown> | null;
  afterCleanPhotoUrl?: string;
  keyPhotoUrl?: string;
  smartdoorPassword?: string;
  smartdoorTokenEnabled?: boolean;
  /** TTLock keyboardPwdName snapshot for operator permanent PIN (full access). */
  operatorSmartdoorPasscodeName?: string;
  /** Lock has gateway linked for remote unlock. */
  smartdoorGatewayReady?: boolean;
  /** How the operator may open the door: full_access | temporary_password_only | … */
  operatorDoorAccessMode?: string;
  smartdoorBindings?: ClientPortalSmartdoorBindings;
  nativeLockBindings?: ClnNativeLockBindingRow[];
  /** False when linked to Coliving `propertydetail` — native bind UI disabled. */
  smartdoorBindManualAllowed?: boolean;
  /** WGS84 from `cln_property.latitude` / `longitude` when set. */
  latitude?: number | null;
  longitude?: number | null;
  updatedAt?: string | null;
  /** When property is accessed via group share (B2B). */
  groupAccess?: {
    access: string;
    groupId: string | null;
    perm: GroupMemberPerm;
  };
};

export type ClientPropertyGroupRow = {
  id: string;
  name: string;
  operatorId: string;
  propertyCount: number;
  /** True when this client is the group owner (can manage members). */
  isOwner?: boolean;
};

export type ClientPropertyGroupMemberRow = {
  id: string;
  inviteEmail: string;
  inviteStatus: string;
  perm: GroupMemberPerm;
  granteeClientdetailId: string | null;
};

export async function fetchClientPropertyGroups(
  email: string,
  operatorId: string
): Promise<{ ok: boolean; items?: ClientPropertyGroupRow[]; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-groups/list',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: ClientPropertyGroupRow[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, items: Array.isArray(data.items) ? data.items : [] };
}

export async function createClientPropertyGroup(
  email: string,
  operatorId: string,
  name: string
): Promise<{ ok: boolean; group?: { id: string; name: string; operatorId: string }; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-groups/create',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      name: String(name || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    group?: { id: string; name: string; operatorId: string };
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, group: data.group };
}

export async function fetchClientPropertyGroupDetail(
  email: string,
  operatorId: string,
  groupId: string
): Promise<{
  ok: boolean;
  group?: {
    id: string;
    name: string;
    operatorId: string;
    isOwner?: boolean;
    properties: Array<{ id: string; name: string; unitNumber: string }>;
  };
  reason?: string;
}> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-groups/detail',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      groupId: String(groupId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    group?: {
      id: string;
      name: string;
      operatorId: string;
      isOwner?: boolean;
      properties: Array<{ id: string; name: string; unitNumber: string }>;
    };
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, group: data.group };
}

export async function addPropertiesToClientGroup(
  email: string,
  operatorId: string,
  groupId: string,
  propertyIds: string[]
): Promise<{ ok: boolean; added?: number; reason?: string }> {
  const ids = (propertyIds || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (!ids.length) return { ok: false, reason: 'MISSING_PROPERTY_ID' };
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-groups/add-property',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      groupId,
      propertyIds: ids,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; added?: number; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, added: data.added ?? ids.length };
}

export async function addPropertyToClientGroup(
  email: string,
  operatorId: string,
  groupId: string,
  propertyId: string
): Promise<{ ok: boolean; reason?: string }> {
  return addPropertiesToClientGroup(email, operatorId, groupId, [propertyId]);
}

export async function removePropertyFromClientGroup(
  email: string,
  operatorId: string,
  groupId: string,
  propertyId: string
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-groups/remove-property',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      groupId,
      propertyId,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok };
}

export async function inviteClientGroupMember(
  email: string,
  operatorId: string,
  groupId: string,
  inviteEmail: string,
  perm: GroupMemberPerm
): Promise<{ ok: boolean; member?: { id: string; inviteEmail: string }; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-groups/invite',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      groupId,
      inviteEmail: String(inviteEmail || '').trim().toLowerCase(),
      perm,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    member?: { id: string; inviteEmail: string };
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, member: data.member };
}

export async function fetchClientPropertyGroupMembers(
  email: string,
  operatorId: string,
  groupId: string
): Promise<{ ok: boolean; items?: ClientPropertyGroupMemberRow[]; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-groups/members',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      groupId,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: ClientPropertyGroupMemberRow[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, items: Array.isArray(data.items) ? data.items : [] };
}

export async function kickClientGroupMember(
  email: string,
  operatorId: string,
  groupId: string,
  memberId: string
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-groups/kick',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      groupId,
      memberId,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok };
}

export async function deleteClientPropertyGroup(
  email: string,
  operatorId: string,
  groupId: string
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-groups/delete',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      groupId,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok };
}

/** Operator portal — property groups (separate from client `cln_property_group`). */
export type OperatorPropertyGroupRow = {
  id: string;
  name: string;
  propertyCount: number;
};

export async function fetchOperatorPropertyGroups(
  operatorId: string
): Promise<{ ok: boolean; items?: OperatorPropertyGroupRow[]; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/property-groups/list',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId: String(operatorId || '').trim() }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: OperatorPropertyGroupRow[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, items: Array.isArray(data.items) ? data.items : [] };
}

export async function createOperatorPropertyGroup(
  operatorId: string,
  name: string
): Promise<{ ok: boolean; group?: OperatorPropertyGroupRow; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/property-groups/create',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      name: String(name || '').trim(),
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    group?: OperatorPropertyGroupRow;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, group: data.group };
}

export async function fetchOperatorPropertyGroupDetail(
  operatorId: string,
  groupId: string
): Promise<{
  ok: boolean;
  group?: { id: string; name: string; properties: Array<{ id: string; name: string; address: string }> };
  reason?: string;
}> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/property-groups/detail',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      groupId: String(groupId || '').trim(),
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    group?: { id: string; name: string; properties: Array<{ id: string; name: string; address: string }> };
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, group: data.group };
}

export async function addPropertiesToOperatorGroup(
  operatorId: string,
  groupId: string,
  propertyIds: string[]
): Promise<{ ok: boolean; reason?: string }> {
  const ids = (propertyIds || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (!ids.length) return { ok: false, reason: 'MISSING_PROPERTY_ID' };
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/property-groups/add-properties',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      groupId: String(groupId || '').trim(),
      propertyIds: ids,
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok };
}

export async function removePropertyFromOperatorGroup(
  operatorId: string,
  groupId: string,
  propertyId: string
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/property-groups/remove-property',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      groupId: String(groupId || '').trim(),
      propertyId: String(propertyId || '').trim(),
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok };
}

export async function deleteOperatorPropertyGroup(
  operatorId: string,
  groupId: string
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/property-groups/delete',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      groupId: String(groupId || '').trim(),
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok };
}

export async function fetchClientPortalPropertyDetail(
  email: string,
  operatorId: string,
  propertyId: string
): Promise<{ ok: boolean; property?: ClientPortalPropertyDetail; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/properties/detail',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      propertyId: String(propertyId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    property?: ClientPortalPropertyDetail;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, property: data.property };
}

export async function patchClientPortalProperty(
  email: string,
  operatorId: string,
  propertyId: string,
  patch: Record<string, unknown>
): Promise<{ ok: boolean; property?: ClientPortalPropertyDetail; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/properties/patch',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      propertyId: String(propertyId || '').trim(),
      patch,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    property?: ClientPortalPropertyDetail;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, property: data.property };
}

export async function postOperatorPropertyLocksList(
  operatorId: string,
  propertyId: string
): Promise<{ ok: boolean; items?: ClnNativeLockBindingRow[]; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/property-locks/list',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      propertyId: String(propertyId || '').trim(),
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: ClnNativeLockBindingRow[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, items: data.items, reason: data.reason };
}

export async function postOperatorPropertyLocksBind(
  operatorId: string,
  propertyId: string,
  lockdetailId: string,
  opts?: { ttlockSlot?: number; integrationSource?: string }
): Promise<{ ok: boolean; bindId?: string; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/property-locks/bind',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      propertyId: String(propertyId || '').trim(),
      lockdetailId: String(lockdetailId || '').trim(),
      ttlockSlot: opts?.ttlockSlot != null ? Number(opts.ttlockSlot) : 0,
      integrationSource: opts?.integrationSource != null ? String(opts.integrationSource).trim() : '',
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; bindId?: string; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, bindId: data.bindId, reason: data.reason };
}

export async function postOperatorPropertyLocksUnbind(
  operatorId: string,
  propertyId: string,
  lockdetailId: string
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/property-locks/unbind',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      propertyId: String(propertyId || '').trim(),
      lockdetailId: String(lockdetailId || '').trim(),
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, reason: data.reason };
}

export async function postClientPropertyLocksList(
  email: string,
  operatorId: string,
  propertyId: string
): Promise<{ ok: boolean; items?: ClnNativeLockBindingRow[]; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-locks/list',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      propertyId: String(propertyId || '').trim(),
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: ClnNativeLockBindingRow[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, items: data.items, reason: data.reason };
}

export async function postClientPropertyLocksBind(
  email: string,
  operatorId: string,
  propertyId: string,
  lockdetailId: string,
  opts?: { ttlockSlot?: number; integrationSource?: string }
): Promise<{ ok: boolean; bindId?: string; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-locks/bind',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      propertyId: String(propertyId || '').trim(),
      lockdetailId: String(lockdetailId || '').trim(),
      ttlockSlot: opts?.ttlockSlot != null ? Number(opts.ttlockSlot) : 0,
      integrationSource: opts?.integrationSource != null ? String(opts.integrationSource).trim() : '',
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; bindId?: string; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, bindId: data.bindId, reason: data.reason };
}

export async function postClientPropertyLocksUnbind(
  email: string,
  operatorId: string,
  propertyId: string,
  lockdetailId: string
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/property-locks/unbind',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      propertyId: String(propertyId || '').trim(),
      lockdetailId: String(lockdetailId || '').trim(),
    }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, reason: data.reason };
}

/** Bulk request operator binding for not-yet-connected properties (pending operator approval). */
export async function postClientPortalBulkRequestOperator(
  email: string,
  operatorId: string,
  propertyIds: string[],
  targetOperatorId: string,
  authorizePropertyAndTtlock: boolean,
  replaceExistingBindings = false
): Promise<{
  ok: boolean;
  succeeded?: string[];
  failed?: Array<{ propertyId: string; reason: string }>;
  reason?: string;
}> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/properties/bulk-request-operator',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      propertyIds: Array.isArray(propertyIds) ? propertyIds.map((x) => String(x || '').trim()).filter(Boolean) : [],
      targetOperatorId: String(targetOperatorId || '').trim(),
      authorizePropertyAndTtlock: !!authorizePropertyAndTtlock,
      replaceExistingBindings: !!replaceExistingBindings,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    succeeded?: string[];
    failed?: Array<{ propertyId: string; reason: string }>;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return {
    ok: !!data.ok,
    succeeded: Array.isArray(data.succeeded) ? data.succeeded : [],
    failed: Array.isArray(data.failed) ? data.failed : [],
    reason: data.reason,
  };
}

/** Bulk clear `operator_id` on selected properties (skips rows that are not bound). */
export async function postClientPortalBulkDisconnect(
  email: string,
  operatorId: string,
  propertyIds: string[]
): Promise<{
  ok: boolean;
  succeeded?: string[];
  failed?: Array<{ propertyId: string; reason: string }>;
  reason?: string;
}> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/properties/bulk-disconnect',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      propertyIds: Array.isArray(propertyIds) ? propertyIds.map((x) => String(x || '').trim()).filter(Boolean) : [],
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    succeeded?: string[];
    failed?: Array<{ propertyId: string; reason: string }>;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return {
    ok: !!data.ok,
    succeeded: Array.isArray(data.succeeded) ? data.succeeded : [],
    failed: Array.isArray(data.failed) ? data.failed : [],
    reason: data.reason,
  };
}

/** Operator portal — TTLock accounts (multi-slot; same shape as client rows, source always manual). */
export type OperatorTtlockAccountRow = {
  slot: number;
  accountName: string;
  username: string;
  source: 'manual';
  manageable: boolean;
  connected: boolean;
};

/** Operator portal — TTLock (`cln_operator_integration` + `cln_ttlocktoken`). */
export async function fetchOperatorTtlockOnboardStatus(operatorId: string): Promise<{
  ok?: boolean;
  ttlockConnected?: boolean;
  ttlockCreateEverUsed?: boolean;
  accounts?: OperatorTtlockAccountRow[];
  reason?: string;
}> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/ttlock/onboard-status?${qs.toString()}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    ttlockConnected?: boolean;
    ttlockCreateEverUsed?: boolean;
    accounts?: OperatorTtlockAccountRow[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function fetchOperatorTtlockCredentials(
  operatorId: string,
  ttlockSlot = 0
): Promise<{ ok?: boolean; username?: string; password?: string; slot?: number; reason?: string }> {
  const qs = new URLSearchParams({
    operatorId: String(operatorId || '').trim(),
    ttlockSlot: String(ttlockSlot),
  });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/ttlock/credentials?${qs.toString()}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    username?: string;
    password?: string;
    slot?: number;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postOperatorTtlockConnect(
  operatorId: string,
  username: string,
  password: string,
  opts?: { accountName?: string }
): Promise<{
  ok?: boolean;
  mode?: string;
  username?: string;
  slot?: number;
  accountName?: string;
  reason?: string;
}> {
  const accountName = opts?.accountName != null ? String(opts.accountName).trim() : '';
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/ttlock/connect',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      username: String(username || '').trim(),
      password: String(password || ''),
      accountName: accountName || undefined,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    mode?: string;
    username?: string;
    slot?: number;
    accountName?: string;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postOperatorTtlockDisconnect(
  operatorId: string,
  ttlockSlot = 0
): Promise<{ ok?: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/ttlock/disconnect',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      ttlockSlot,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

/** Smart Door Setting — same API shape as Coliving `smartdoorsetting/*`; scoped by `cln_operator_integration` + operator id. */
export type CleanlemonSmartDoorScope = 'operator' | 'client';

async function postCleanlemonSmartDoor<T>(
  scope: CleanlemonSmartDoorScope,
  action: string,
  body: Record<string, unknown>
): Promise<T> {
  const r = await apiFetch({
    path: `/api/cleanlemon/${scope}/smartdoorsetting/${action}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as T & { reason?: string };
  if (!r.ok) {
    const msg = (data as { reason?: string })?.reason || `HTTP_${r.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function clnGetSmartDoorList(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  opts?: {
    propertyId?: string;
    keyword?: string;
    search?: string;
    filter?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
    limit?: number;
    /** Operator portal: `all` | `own` | cln_clientdetail id — filter devices by owner. */
    clnClientOwnership?: string;
  }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  const body: Record<string, unknown> = { email, operatorId, ...(opts || {}) };
  if (body.search != null && body.keyword == null) {
    body.keyword = body.search;
    delete body.search;
  }
  return postCleanlemonSmartDoor<{ ok?: boolean; items?: unknown[]; total?: number; totalPages?: number; currentPage?: number }>(
    scope,
    'list',
    body
  );
}

export async function clnGetSmartDoorFilters(scope: CleanlemonSmartDoorScope, ctx: { operatorId: string; email: string }) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok?: boolean; properties?: Array<{ value: string; label: string }> }>(scope, 'filters', {
    email,
    operatorId,
  });
}

export async function clnGetSmartDoorLock(scope: CleanlemonSmartDoorScope, ctx: { operatorId: string; email: string }, id: string) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<Record<string, unknown>>(scope, 'get-lock', { email, operatorId, id });
}

export async function clnGetSmartDoorGateway(scope: CleanlemonSmartDoorScope, ctx: { operatorId: string; email: string }, id: string) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<Record<string, unknown>>(scope, 'get-gateway', { email, operatorId, id });
}

export async function clnGetChildLockOptions(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  excludeLockId: string | null
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ options?: Array<{ label: string; value: string }> }>(scope, 'child-lock-options', {
    email,
    operatorId,
    excludeLockId: excludeLockId || undefined,
  });
}

export async function clnUpdateSmartDoorLock(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  id: string,
  payload: { lockAlias?: string; active?: boolean; childmeter?: string[] }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string }>(scope, 'update-lock', { email, operatorId, id, ...payload });
}

export async function clnUpdateSmartDoorGateway(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  id: string,
  payload: { gatewayName?: string }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string }>(scope, 'update-gateway', { email, operatorId, id, ...payload });
}

export async function clnUnlockSmartDoor(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  lockDetailId: string,
  opts?: { ttlockSlot?: number }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  const body: Record<string, unknown> = { email, operatorId, id: lockDetailId };
  if (opts?.ttlockSlot != null && Number.isFinite(Number(opts.ttlockSlot))) {
    body.ttlockSlot = Number(opts.ttlockSlot);
  }
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string }>(scope, 'unlock', body);
}

/** Operator: reveal static smart door password when policy allows (property linked + mode). */
export async function clnViewSmartDoorPassword(
  ctx: { operatorId: string; email: string },
  lockDetailId: string,
  opts?: { ttlockSlot?: number }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  const body: Record<string, unknown> = { email, operatorId, id: lockDetailId };
  if (opts?.ttlockSlot != null && Number.isFinite(Number(opts.ttlockSlot))) {
    body.ttlockSlot = Number(opts.ttlockSlot);
  }
  return postCleanlemonSmartDoor<{ ok: boolean; password?: string; reason?: string }>('operator', 'view-password', body);
}

/** Portal remote-unlock audit log for one lock (Malaysia date / range → UTC on server). */
export async function clnGetSmartDoorUnlockLogs(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  lockDetailId: string,
  query: { date?: string; from?: string; to?: string; page?: number; pageSize?: number; ttlockSlot?: number }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  const body: Record<string, unknown> = {
    email,
    operatorId,
    id: lockDetailId,
    date: query.date,
    from: query.from,
    to: query.to,
    page: query.page,
    pageSize: query.pageSize,
  };
  if (query.ttlockSlot != null && Number.isFinite(Number(query.ttlockSlot))) {
    body.ttlockSlot = Number(query.ttlockSlot);
  }
  return postCleanlemonSmartDoor<{
    ok?: boolean;
    items?: Array<Record<string, unknown>>;
    total?: number;
    page?: number;
    pageSize?: number;
    reason?: string;
  }>(scope, 'unlock-logs', body);
}

export async function clnPreviewSmartDoorSelection(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  opts?: { ttlockSlot?: number }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  const body: Record<string, unknown> = { email, operatorId };
  if (opts?.ttlockSlot != null && Number.isFinite(Number(opts.ttlockSlot))) {
    body.ttlockSlot = Number(opts.ttlockSlot);
  }
  return postCleanlemonSmartDoor<{
    ok?: boolean;
    total?: number;
    list?: Array<{
      _id?: string;
      type?: string;
      externalId?: string;
      lockId?: number;
      gatewayId?: number;
      lockAlias?: string;
      gatewayName?: string;
      networkName?: string;
      lockNum?: number;
      electricQuantity?: number;
      hasGateway?: boolean;
      active?: boolean;
      isOnline?: boolean;
      provider?: string;
      mergeAction?: 'insert' | 'update';
      bindingLabels?: string[];
      bindingHint?: string | null;
    }>;
  }>(scope, 'preview-selection', body);
}

export async function clnInsertSmartDoors(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  payload: {
    gateways?: Array<{
      gatewayId: number;
      gatewayName: string;
      networkName?: string;
      lockNum?: number;
      isOnline?: boolean;
      type?: string;
    }>;
    locks?: Array<{
      lockId: number;
      lockAlias?: string;
      lockName?: string;
      electricQuantity?: number;
      type?: string;
      hasGateway?: boolean;
      brand?: string;
      active?: boolean;
      gatewayId?: string | null;
      __tmpGatewayExternalId?: number | null;
    }>;
    /** Cleanlemons operator multi TTLock account (Company → Integration). */
    ttlockSlot?: number;
  }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string }>(scope, 'insert-smartdoors', {
    email,
    operatorId,
    ...payload,
  });
}

export async function clnSyncTTLockName(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  payload: { type: string; externalId: string; name: string; ttlockSlot?: number }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  const body: Record<string, unknown> = { email, operatorId, type: payload.type, externalId: payload.externalId, name: payload.name };
  if (payload.ttlockSlot != null && Number.isFinite(Number(payload.ttlockSlot))) {
    body.ttlockSlot = Number(payload.ttlockSlot);
  }
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string }>(scope, 'sync-name', body);
}

export async function clnDeleteSmartDoorLock(scope: CleanlemonSmartDoorScope, ctx: { operatorId: string; email: string }, id: string) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string }>(scope, 'delete-lock', { email, operatorId, id });
}

export async function clnDeleteSmartDoorGateway(scope: CleanlemonSmartDoorScope, ctx: { operatorId: string; email: string }, id: string) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string }>(scope, 'delete-gateway', { email, operatorId, id });
}

export async function clnSyncSmartDoorLocksFromTtlock(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  opts?: { ttlockSlot?: number }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  const body: Record<string, unknown> = { email, operatorId };
  if (opts?.ttlockSlot != null && Number.isFinite(Number(opts.ttlockSlot))) {
    body.ttlockSlot = Number(opts.ttlockSlot);
  }
  return postCleanlemonSmartDoor<{ ok: boolean; lockCount?: number; gatewayCount?: number; reason?: string }>(
    scope,
    'sync-locks-from-ttlock',
    body
  );
}

export async function clnSyncSingleSmartDoorLockFromTtlock(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  lockDetailId: string
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string; lock?: Record<string, unknown> }>(
    scope,
    'sync-single-lock-from-ttlock',
    { email, operatorId, id: lockDetailId }
  );
}

export async function clnSyncSingleSmartDoorGatewayFromTtlock(
  scope: CleanlemonSmartDoorScope,
  ctx: { operatorId: string; email: string },
  gatewayDetailId: string
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string; gateway?: Record<string, unknown> }>(
    scope,
    'sync-single-gateway-from-ttlock',
    { email, operatorId, id: gatewayDetailId }
  );
}

/** Third-party integration key for current operator (get-or-create). */
export async function postClientIntegrationApiKeyEnsure(
  email: string,
  operatorId: string
): Promise<{ ok?: boolean; apiKey?: string; created?: boolean; clientId?: string; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/integration-api-key',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email || '').trim().toLowerCase(), operatorId: String(operatorId || '').trim() }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    apiKey?: string;
    created?: boolean;
    clientId?: string;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postClientIntegrationApiKeyRotate(
  email: string,
  operatorId: string
): Promise<{ ok?: boolean; apiKey?: string; clientId?: string; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/integration-api-key/rotate',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email || '').trim().toLowerCase(), operatorId: String(operatorId || '').trim() }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    apiKey?: string;
    clientId?: string;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

/** Coliving ECS API (cross-product handoff). Set NEXT_PUBLIC_COLIVING_API_URL for non-default hosts. */
export function getColivingApiBaseForBridge(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_COLIVING_API_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return 'https://api.colivingjb.com';
}

export async function postColivingCleanlemonsOauthComplete(payload: {
  state: string;
  cleanlemonsClientdetailId: string;
  cleanlemonsOperatorId: string;
}): Promise<{ ok?: boolean; redirectUrl?: string; reason?: string }> {
  const base = getColivingApiBaseForBridge();
  const r = await fetch(`${base}/api/companysetting/cleanlemons-oauth/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; redirectUrl?: string; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function fetchEmployeeAttendance(
  email: string,
  operatorId?: string
): Promise<{ ok: boolean; items?: any[]; reason?: string }> {
  const qs = new URLSearchParams({ email: String(email || '') })
  const oid = String(operatorId || '').trim()
  if (oid) qs.set('operatorId', oid)
  const r = await apiFetch({ path: `/api/cleanlemon/employee/attendance?${qs.toString()}`, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function employeeCheckIn(payload: any): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/attendance/check-in',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function employeeCheckOut(payload: any): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/attendance/check-out',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchCleanlemonPricingConfig(operatorId: string): Promise<{ ok: boolean; config?: CleanlemonPricingConfig; reason?: string }> {
  const base = resolveApiBase();
  if (!base) {
    const qs = new URLSearchParams({ operatorId });
    const r = await fetch(`/api/cleanlemon/pricing-config?${qs.toString()}`, { cache: 'no-store' });
    if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
    return r.json();
  }
  const qs = new URLSearchParams({ operatorId });
  const r = await fetch(`${base}/api/cleanlemon/pricing-config?${qs.toString()}`, { cache: 'no-store' });
  if (!r.ok) {
    return { ok: false, reason: `HTTP_${r.status}` };
  }
  return r.json();
}

export async function saveCleanlemonPricingConfig(
  operatorId: string,
  config: CleanlemonPricingConfig
): Promise<{ ok: boolean; reason?: string }> {
  const base = resolveApiBase();
  if (!base) {
    const r = await fetch('/api/cleanlemon/pricing-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId, config }),
    });
    if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
    return r.json();
  }
  const r = await fetch(`${base}/api/cleanlemon/pricing-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId, config }),
  });
  if (!r.ok) {
    return { ok: false, reason: `HTTP_${r.status}` };
  }
  return r.json();
}

export async function fetchOperatorDashboard(operatorId: string): Promise<any> {
  const oid = String(operatorId || '').trim();
  const qs = new URLSearchParams({ operatorId: oid });
  const r = await apiFetch({ path: `/api/cleanlemon/operator/dashboard?${qs.toString()}`, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchOperatorProperties(
  operatorId?: string,
  opts?: { includeArchived?: boolean }
): Promise<any> {
  const qs = new URLSearchParams({ limit: '500' });
  if (operatorId) qs.set('operatorId', String(operatorId));
  if (opts?.includeArchived) qs.set('includeArchived', '1');
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/properties?${qs.toString()}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/** Smart door bindings from Coliving (read-only in portal). */
export type CleanlemonSmartdoorBindingsDetail = {
  property: { lockdetailId?: string; displayLabel?: string } | null;
  rooms: Array<{
    roomId: string;
    roomDisplayLabel?: string;
    lockDisplayLabel?: string;
  }>;
};

/** Operator edit dialog — Coliving-linked security credentials (GET). */
export async function fetchOperatorPropertyDetail(
  propertyId: string,
  operatorId?: string
): Promise<{
  ok: boolean;
  property?: {
    id: string;
    clientPortalOwned?: boolean;
    colivingPropertydetailId?: string;
    securitySystemCredentials?: Record<string, unknown> | null;
    smartdoorId?: string;
    mailboxPassword?: string;
    smartdoorPassword?: string;
    operatorDoorAccessMode?: string;
    smartdoorGatewayReady?: boolean;
    hasBookingToday?: boolean;
    smartdoorBindings?: CleanlemonSmartdoorBindingsDetail;
    nativeLockBindings?: ClnNativeLockBindingRow[];
    smartdoorBindManualAllowed?: boolean;
    operatorCleaningPricingLine?: string;
    operatorCleaningPriceMyr?: number | null;
    operatorCleaningPricingService?: string;
    /** Multi-row cleaning price (JSON on `cln_property`). Legacy columns mirror row 0. */
    operatorCleaningPricingRows?: Array<{ service: string; line: string; myr: number | null }>;
    bedCount?: number | null;
    roomCount?: number | null;
    bathroomCount?: number | null;
    kitchen?: number | null;
    livingRoom?: number | null;
    balcony?: number | null;
    staircase?: number | null;
    liftLevel?: string | null;
    specialAreaCount?: number | null;
  };
  reason?: string;
}> {
  const qs = new URLSearchParams();
  if (operatorId) qs.set('operatorId', String(operatorId));
  const q = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/properties/${encodeURIComponent(propertyId)}${q ? `?${q}` : ''}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    property?: {
      id: string;
      clientPortalOwned?: boolean;
      colivingPropertydetailId?: string;
      securitySystemCredentials?: Record<string, unknown> | null;
    };
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, property: data.property, reason: data.reason };
}

/** Distinct `cln_property.property_name` for the operator (building / condo picker). */
export async function fetchOperatorDistinctPropertyNames(operatorId?: string): Promise<any> {
  const qs = new URLSearchParams();
  if (operatorId) qs.set('operatorId', String(operatorId));
  const q = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/property-names${q ? `?${q}` : ''}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/** All operators: distinct building names (optional substring `q`) for apartment combobox. */
export async function fetchGlobalPropertyNames(params: {
  operatorId: string;
  q?: string;
  limit?: number;
}): Promise<any> {
  const qs = new URLSearchParams({ operatorId: String(params.operatorId || '').trim() });
  if (params?.q) qs.set('q', String(params.q));
  if (params?.limit != null) qs.set('limit', String(params.limit));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/property-names-global?${suffix}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/** Most common address + Waze + Google Maps URL for a shared `property_name` (all properties). */
export async function fetchPropertyNameDefaults(
  name: string,
  operatorId: string
): Promise<{
  ok: boolean;
  address?: string;
  wazeUrl?: string;
  googleMapsUrl?: string;
  reason?: string;
}> {
  const qs = new URLSearchParams({
    name: String(name || '').trim(),
    operatorId: String(operatorId || '').trim(),
  });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/property-name-defaults?${qs.toString()}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/** Address place search (server: Nominatim + fallback; default Malaysia `countrycodes=my`). */
export async function fetchAddressSearch(params: {
  q: string;
  limit?: number;
  /** Empty string = no country filter (worldwide). */
  countrycodes?: string;
  /** Building name from the form — if OSM has no hit for `q`, server retries with this (e.g. CITYWOODS). */
  propertyName?: string;
}): Promise<{
  ok: boolean;
  items?: Array<{ displayName: string; lat: string; lon: string; placeId: string }>;
  reason?: string;
}> {
  const qs = new URLSearchParams({ q: String(params.q || '').trim() });
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.countrycodes !== undefined) qs.set('countrycodes', params.countrycodes);
  if (params.propertyName != null && String(params.propertyName).trim() !== '') {
    qs.set('propertyName', String(params.propertyName).trim());
  }
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/address-search?${qs.toString()}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/** Public — operator reputation (no auth). */
export async function getPublicCleanlemonOperatorProfile(id: string): Promise<{
  ok: boolean;
  operator?: { id: string; name: string; email: string };
  summary?: { reviewCount: number; averageStars: number | null };
  reviews?: Array<{ id: string; stars: number; remark: string; evidenceUrls: string[]; createdAt: string }>;
  reason?: string;
}> {
  const base = resolveApiBase().replace(/\/$/, '');
  const path = `/api/public/cleanlemon-operator-profile/${encodeURIComponent(String(id || '').trim())}`;
  const url = base ? `${base}${path}` : path;
  const r = await fetch(url, { cache: 'no-store' });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    operator?: { id: string; name: string; email: string };
    summary?: { reviewCount: number; averageStars: number | null };
    reviews?: Array<{ id: string; stars: number; remark: string; evidenceUrls: string[]; createdAt: string }>;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data as {
    ok: boolean;
    operator?: { id: string; name: string; email: string };
    summary?: { reviewCount: number; averageStars: number | null };
    reviews?: Array<{ id: string; stars: number; remark: string; evidenceUrls: string[]; createdAt: string }>;
    reason?: string;
  };
}

export async function getPublicCleanlemonOperatorDirectory(params?: {
  limit?: number;
  offset?: number;
}): Promise<{
  ok: boolean;
  items?: Array<{
    id: string;
    name: string;
    email: string;
    clientToOperatorReviewCount: number;
    clientToOperatorAverageStars: number | null;
  }>;
  reason?: string;
}> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
  const base = resolveApiBase().replace(/\/$/, '');
  const path = `/api/public/cleanlemon-operator-directory${qs.toString() ? `?${qs}` : ''}`;
  const url = base ? `${base}${path}` : path;
  const r = await fetch(url, { cache: 'no-store' });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data as {
    ok: boolean;
    items?: Array<{
      id: string;
      name: string;
      email: string;
      clientToOperatorReviewCount: number;
      clientToOperatorAverageStars: number | null;
    }>;
    reason?: string;
  };
}

export async function postClnReview(body: Record<string, unknown>): Promise<{ ok: boolean; id?: string; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/portal/reviews',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, id: data.id, reason: data.reason };
}

/** Search operator master (`cln_operatordetail`) for dropdown. */
export async function fetchOperatorLookup(params?: { q?: string; limit?: number }): Promise<{
  ok: boolean;
  items?: Array<{
    id: string;
    name?: string;
    email?: string;
    clientToOperatorReviewCount?: number;
    clientToOperatorAverageStars?: number | null;
  }>;
  reason?: string;
}> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', String(params.q));
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/lookup${suffix ? `?${suffix}` : ''}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function createOperatorProperty(payload: any): Promise<any> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/properties',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function updateOperatorProperty(id: string, payload: any): Promise<any> {
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/properties/${encodeURIComponent(id)}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

/** Operator portal — property link requests by `status` (optionally filter by `kind`). */
export async function fetchOperatorPropertyLinkRequests(
  operatorId: string,
  opts?: { status?: string; kind?: string; limit?: number }
): Promise<{ ok: boolean; items?: CleanlemonPropertyLinkRequestRow[]; reason?: string }> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.kind) qs.set('kind', opts.kind);
  if (opts?.limit != null && Number.isFinite(opts.limit)) qs.set('limit', String(opts.limit));
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/property-link-requests?${qs.toString()}`,
      cache: 'no-store',
    })
  );
}

/** Tab badge counts: pending / approved / rejected for the same `kind` filter. */
export async function fetchOperatorPropertyLinkRequestCounts(
  operatorId: string,
  opts?: { kind?: string }
): Promise<{
  ok: boolean;
  counts?: { pending: number; approved: number; rejected: number };
  reason?: string;
}> {
  const qs = new URLSearchParams({
    operatorId: String(operatorId || '').trim(),
    counts: '1',
  });
  if (opts?.kind) qs.set('kind', opts.kind);
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/property-link-requests?${qs.toString()}`,
      cache: 'no-store',
    })
  );
}

export async function bulkDecideOperatorPropertyLinkRequests(
  body: {
    operatorId: string;
    email?: string;
    decision: 'approve' | 'reject';
    requestIds: string[];
    remarks?: string;
  }
): Promise<{
  ok: boolean;
  succeeded?: number;
  results?: { id: string; ok: boolean; reason?: string }[];
  reason?: string;
}> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/property-link-requests/bulk-decide',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function decideOperatorPropertyLinkRequest(
  requestId: string,
  body: { operatorId: string; email?: string; decision: 'approve' | 'reject'; remarks?: string }
): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/property-link-requests/${encodeURIComponent(requestId)}/decide`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** B2B client portal — list requests (JWT email or `email` + `operatorId` query). */
export async function fetchClientPropertyLinkRequests(
  email: string,
  operatorId: string,
  opts?: { status?: string; kind?: string }
): Promise<{ ok: boolean; items?: CleanlemonPropertyLinkRequestRow[]; reason?: string }> {
  const qs = new URLSearchParams({
    email: String(email || '').trim().toLowerCase(),
    operatorId: String(operatorId || '').trim(),
  });
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.kind) qs.set('kind', opts.kind);
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/client/property-link-requests?${qs.toString()}`,
      cache: 'no-store',
    })
  );
}

export async function decideClientPropertyLinkRequest(
  requestId: string,
  body: { email: string; operatorId: string; decision: 'approve' | 'reject'; remarks?: string }
): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/client/property-link-requests/${encodeURIComponent(requestId)}/decide`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** B2B client — cleaning jobs (email + optional portal operator; with groupId, lists all jobs in that group across property operators). */
/** B2B client — invoices (real `cln_client_invoice` rows for this portal client). */
export async function fetchClientPortalInvoices(
  email: string,
  operatorId: string,
  opts?: { limit?: number; filterOperatorId?: string }
): Promise<{
  ok: boolean;
  items?: Array<Record<string, unknown>>;
  operators?: Array<{ id: string; name: string }>;
  reason?: string;
}> {
  const qs = new URLSearchParams({
    email: String(email || '').trim().toLowerCase(),
    operatorId: String(operatorId || '').trim(),
  });
  if (opts?.limit != null) qs.set('limit', String(opts.limit));
  if (opts?.filterOperatorId) qs.set('filterOperatorId', String(opts.filterOperatorId).trim());
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/client/invoices?${qs.toString()}`,
      cache: 'no-store',
    })
  );
}

/** Coliving tenant-style: `create-payment` — optional `returnUrl` / `cancelUrl` (defaults to portal invoices page). */
export async function postClientPortalInvoicesCreatePayment(body: {
  email: string;
  operatorId: string;
  invoiceIds: string[];
  returnUrl?: string;
  cancelUrl?: string;
  paymentProvider?: 'stripe' | 'billplz' | 'xendit' | string;
}): Promise<{
  ok: boolean;
  type?: string;
  url?: string;
  sessionId?: string;
  provider?: string;
  reason?: string;
}> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/client/invoices/create-payment',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** After redirect (`success=1` + gateway refs), same role as tenant `confirm-payment`. */
export async function postClientPortalInvoicesConfirmPayment(body: {
  email: string;
  operatorId?: string;
  sessionId?: string;
  billId?: string;
  checkoutId?: string;
  provider?: string;
}): Promise<{ ok: boolean; reason?: string; idempotent?: boolean; alreadyPaid?: boolean }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/client/invoices/confirm-payment',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: body.email,
        operatorId: body.operatorId,
        session_id: body.sessionId,
        bill_id: body.billId,
        checkout_id: body.checkoutId,
        provider: body.provider,
      }),
    })
  );
}

/** Pay selected unpaid invoices for one operator (Stripe / Billplz / Xendit). */
export async function postClientPortalInvoicesCheckout(body: {
  email: string;
  operatorId: string;
  invoiceIds: string[];
  successUrl: string;
  cancelUrl: string;
  /** Default `stripe`. Use `billplz` or `xendit` when the operator has that channel configured. */
  paymentProvider?: 'stripe' | 'billplz' | 'xendit' | string;
}): Promise<{
  ok: boolean;
  url?: string;
  sessionId?: string;
  provider?: string;
  reason?: string;
}> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/client/invoices/checkout',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** Multipart: file, email, operatorId, invoiceIds (JSON string). */
export async function postClientPortalInvoiceReceiptUpload(opts: {
  email: string;
  operatorId: string;
  invoiceIds: string[];
  file: File;
}): Promise<{ ok: boolean; url?: string; updated?: number; reason?: string }> {
  const fd = new FormData();
  fd.set('email', String(opts.email || '').trim().toLowerCase());
  fd.set('operatorId', String(opts.operatorId || '').trim());
  fd.set('invoiceIds', JSON.stringify(opts.invoiceIds || []));
  fd.set('file', opts.file);
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/client/invoices/receipt-upload',
      method: 'POST',
      body: fd,
    })
  );
}

export type OperatorPaymentQueueRow = {
  paymentId: string;
  invoiceId: string;
  amount: number;
  paymentDate: string | null;
  receiptUrl: string | null;
  transactionId: string | null;
  /** Client portal receipt upload marker when set */
  receiptNumber?: string | null;
  createdAt: string | null;
  operatorAckAt: string | null;
  invoiceNo: string;
  invoicePaid: number;
  clientName: string;
  clientEmail: string;
  /** Same `receipt_batch_id` on each `cln_client_payment` row from one client upload */
  receiptBatchId?: string | null;
  isBatch?: boolean;
  paymentIds?: string[];
  invoiceIds?: string[];
  invoiceNos?: string[];
  amounts?: number[];
  totalAmount?: number;
};

export async function fetchOperatorPaymentQueue(
  operatorId: string,
  opts?: { limit?: number }
): Promise<{ ok: boolean; items?: OperatorPaymentQueueRow[]; reason?: string }> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  if (opts?.limit != null) qs.set('limit', String(opts.limit));
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/payment-queue?${qs.toString()}`,
      cache: 'no-store',
    })
  );
}

export async function postOperatorPaymentAcknowledge(
  paymentId: string,
  operatorId: string
): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/payment-queue/${encodeURIComponent(paymentId)}/acknowledge`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: String(operatorId || '').trim() }),
    })
  );
}

/** Reject client-portal uploaded receipt row (invoice stays unpaid). */
export async function postOperatorRejectClientPortalReceipt(
  paymentId: string,
  operatorId: string
): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/payment-queue/${encodeURIComponent(paymentId)}/reject-client-receipt`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: String(operatorId || '').trim() }),
    })
  );
}

/** Reject all portal receipt rows in one client upload batch (`receiptBatchId`), or legacy `paymentIds`. */
export async function postOperatorRejectClientPortalReceiptBatch(
  operatorId: string,
  body: { receiptBatchId?: string; paymentIds?: string[] }
): Promise<{ ok: boolean; reason?: string; deleted?: number }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/payment-queue/reject-client-receipt-batch',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: String(operatorId || '').trim(),
        ...(body.receiptBatchId ? { receiptBatchId: String(body.receiptBatchId).trim() } : {}),
        ...(Array.isArray(body.paymentIds) && body.paymentIds.length
          ? { paymentIds: body.paymentIds.map((x) => String(x || '').trim()).filter(Boolean) }
          : {}),
      }),
    })
  );
}

/** Operator company bank details (Company page) — for client pay when Stripe Connect / card checkout is unavailable. */
export async function fetchClientPortalOperatorBankTransferInfo(
  email: string,
  operatorId: string
): Promise<{
  ok: boolean;
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
  companyName?: string;
  reason?: string;
}> {
  const qs = new URLSearchParams({
    email: String(email || '').trim().toLowerCase(),
    operatorId: String(operatorId || '').trim(),
  });
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/client/operator/bank-transfer-info?${qs.toString()}`,
      cache: 'no-store',
    })
  );
}

export async function fetchClientScheduleJobs(
  email: string,
  operatorId: string,
  opts?: { limit?: number; groupId?: string }
): Promise<{ ok: boolean; items?: unknown[]; reason?: string }> {
  const qs = new URLSearchParams({
    email: String(email || '').trim().toLowerCase(),
    operatorId: String(operatorId || '').trim(),
  });
  if (opts?.limit != null) qs.set('limit', String(opts.limit));
  if (opts?.groupId) qs.set('groupId', String(opts.groupId).trim());
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/client/schedule-jobs?${qs.toString()}`,
      cache: 'no-store',
    })
  );
}

export async function createClientScheduleJob(body: {
  email: string;
  operatorId: string;
  propertyId: string;
  date: string;
  time?: string;
  /** End time HH:mm (non-homestay); stored in remarks like operator Create Job. */
  timeEnd?: string;
  serviceProvider?: string;
  addons?: Array<{
    id?: string;
    name: string;
    basis: 'fixed' | 'quantity' | 'bed' | 'room' | string;
    price: number;
    quantity: number;
  }>;
  /** Total RM (same idea as operator Create Job). */
  price?: number;
  /** Optional note appended to schedule remarks (operator-visible). */
  clientRemark?: string;
  /** When booking from a property group context. */
  groupId?: string;
  /** Homestay same-day checkout + check-in — marks job for operator priority (stored as `btob`). */
  btob?: boolean;
}): Promise<{ ok: boolean; id?: string; reason?: string; message?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/client/schedule-jobs',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** Client portal — extend / reschedule (workingDay) and/or status update. */
export async function updateClientScheduleJob(body: {
  email: string;
  operatorId: string;
  scheduleId: string;
  workingDay?: string;
  status?: string;
  statusSetByEmail?: string;
  groupId?: string;
  btob?: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  const { scheduleId, ...rest } = body;
  const r = await apiFetch({
    path: `/api/cleanlemon/client/schedule-jobs/${encodeURIComponent(scheduleId)}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: j.reason || `HTTP_${r.status}` };
  return { ok: true, ...j };
}

/** Client portal — delete schedule row (e.g. after confirming “Customer extend”). */
export async function deleteClientScheduleJob(body: {
  email: string;
  operatorId?: string;
  scheduleId: string;
  groupId?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { scheduleId, ...rest } = body;
  const r = await apiFetch({
    path: `/api/cleanlemon/client/schedule-jobs/${encodeURIComponent(scheduleId)}`,
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: j.reason || `HTTP_${r.status}` };
  return { ok: true, ...j };
}

export async function deleteOperatorProperty(id: string, operatorId?: string): Promise<any> {
  const qs = new URLSearchParams();
  if (operatorId) qs.set('operatorId', String(operatorId));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/properties/${encodeURIComponent(id)}${suffix ? `?${suffix}` : ''}`,
    method: 'DELETE',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function fetchOperatorInvoices(operatorId?: string): Promise<any> {
  const oid = String(operatorId || '').trim()
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID', items: [] }
  const qs = new URLSearchParams({ limit: '500', operatorId: oid })
  return fetchJsonSafe(
    apiFetch({ path: `/api/cleanlemon/operator/invoices?${qs.toString()}`, cache: 'no-store' })
  )
}

export async function createOperatorInvoice(payload: any): Promise<any> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/invoices',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    id?: string;
    invoiceNo?: string;
    pdfUrl?: string;
    reason?: string;
    detail?: string;
    code?: string;
  };
  if (!r.ok) {
    const line = {
      httpStatus: r.status,
      code: data.code,
      reason: data.reason,
      detail: data.detail,
    };
    if (typeof window !== 'undefined') {
      console.error(`[createOperatorInvoice] ${JSON.stringify(line)}`);
    }
    return { ok: false, reason: data.reason || `HTTP_${r.status}`, detail: data.detail, code: data.code };
  }
  return data;
}

export async function updateOperatorInvoice(id: string, payload: any): Promise<any> {
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/invoices/${encodeURIComponent(id)}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchOperatorInvoiceFormOptions(operatorId?: string): Promise<any> {
  const qs = new URLSearchParams();
  if (operatorId) qs.set('operatorId', String(operatorId));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/invoice-form-options${suffix ? `?${suffix}` : ''}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/** B2B clients (`cln_clientdetail`) linked to operator via `cln_client_operator` — use for property binding. */
export async function fetchOperatorLinkedClientdetails(operatorId?: string): Promise<{
  ok: boolean;
  items?: Array<{ id: string; name: string; email: string }>;
  reason?: string;
}> {
  const qs = new URLSearchParams();
  if (operatorId) qs.set('operatorId', String(operatorId));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/linked-clientdetails${suffix ? `?${suffix}` : ''}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: Array<{ id: string; name: string; email: string }>;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, items: Array.isArray(data.items) ? data.items : [] };
}

export async function updateOperatorInvoiceStatus(
  id: string,
  status: string,
  opts?: { operatorId?: string; paymentMethod?: string; paymentDate?: string }
): Promise<any> {
  const oid = String(opts?.operatorId || '').trim();
  const qs = oid ? `?operatorId=${encodeURIComponent(oid)}` : '';
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/invoices/${encodeURIComponent(id)}/status${qs}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status,
      ...(oid ? { operatorId: oid } : {}),
      paymentMethod: opts?.paymentMethod,
      paymentDate: opts?.paymentDate,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function deleteOperatorInvoice(id: string, operatorId?: string): Promise<any> {
  const qs = operatorId ? `?operatorId=${encodeURIComponent(String(operatorId))}` : '';
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/invoices/${encodeURIComponent(id)}${qs}`,
    method: 'DELETE',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

/** Sends payment reminder from ECS using CLEANLEMON_SMTP_* (same pool as password reset). */
export async function sendOperatorInvoicePaymentReminder(
  invoiceId: string,
  operatorId?: string
): Promise<{ ok: boolean; reason?: string }> {
  const oid = String(operatorId || '').trim();
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/invoices/${encodeURIComponent(invoiceId)}/send-payment-reminder`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId: oid }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, reason: data.reason };
}

export async function fetchOperatorAgreements(operatorId?: string): Promise<any> {
  const qs = operatorId ? `?operatorId=${encodeURIComponent(String(operatorId))}` : '';
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/agreements${qs}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/**
 * B2B client portal — operator–client agreements for this email (POST + body `email`, same pattern as `client/properties/list`).
 */
export async function fetchClientPortalAgreements(email?: string): Promise<{
  ok: boolean;
  items?: unknown[];
  reason?: string;
}> {
  const em = String(email || '').trim().toLowerCase();
  const r = await apiFetch({
    path: '/api/cleanlemon/client/agreements/list',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: em }),
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; items?: unknown[]; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}`, items: [] };
  return { ok: !!data.ok, items: Array.isArray(data.items) ? data.items : [] };
}

/** Filled agreement PDF for reading before sign (server checks `email` matches agreement recipient). */
export async function fetchClientAgreementPreviewBlob(agreementId: string, email?: string): Promise<{
  ok: boolean;
  blob?: Blob;
  reason?: string;
}> {
  const id = String(agreementId || '').trim();
  if (!id) return { ok: false, reason: 'NO_ID' };
  const em = String(email || '').trim().toLowerCase();
  const r = await apiFetch({
    path: `/api/cleanlemon/client/agreements/${encodeURIComponent(id)}/preview-pdf`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: em }),
  });
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (!r.ok) {
    if (ct.includes('application/json')) {
      const data = (await r.json().catch(() => ({}))) as { reason?: string };
      return { ok: false, reason: data.reason || `HTTP_${r.status}` };
    }
    return { ok: false, reason: `HTTP_${r.status}` };
  }
  if (!ct.includes('application/pdf')) {
    return { ok: false, reason: 'INVALID_RESPONSE' };
  }
  const blob = await r.blob();
  return { ok: true, blob };
}

export async function createOperatorAgreement(payload: any): Promise<any> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/agreements',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string; id?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function signOperatorAgreement(id: string, payload: any): Promise<any> {
  const p = { ...(payload || {}) };
  /** Route uses `clientPortalAuthFromRequest(req, req.body?.email)` — same field as agreements list / preview-pdf. */
  if (String(p.signedFrom || '').trim() === 'client_portal') {
    const em = String(p.email || p.signerEmail || '').trim().toLowerCase();
    if (em) p.email = em;
  }
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/agreements/${encodeURIComponent(id)}/sign`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, ...data };
}

/** Filled agreement PDF for operator portal preview; persists hash_draft on first generation. */
export async function fetchOperatorAgreementInstancePdfBlob(
  agreementId: string,
  operatorId: string
): Promise<{ ok: boolean; blob?: Blob; reason?: string }> {
  const id = String(agreementId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!id || !oid) return { ok: false, reason: 'NO_ID' };
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/agreements/${encodeURIComponent(id)}/preview-pdf`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId: oid }),
  });
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (!r.ok) {
    if (ct.includes('application/json')) {
      const data = (await r.json().catch(() => ({}))) as { reason?: string };
      return { ok: false, reason: data.reason || `HTTP_${r.status}` };
    }
    return { ok: false, reason: `HTTP_${r.status}` };
  }
  if (!ct.includes('application/pdf')) {
    return { ok: false, reason: 'INVALID_RESPONSE' };
  }
  const blob = await r.blob();
  return { ok: true, blob };
}

/** Deletes agreement only when not finalized (no hash_final / final PDF / complete). */
export async function deleteOperatorAgreement(
  agreementId: string,
  operatorId: string
): Promise<{ ok: boolean; reason?: string }> {
  const id = String(agreementId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!id || !oid) return { ok: false, reason: 'NO_ID' };
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/agreements/${encodeURIComponent(id)}/delete`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId: oid }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, reason: data.reason };
}

/** After all parties signed: rebuild merged PDF + upload to Drive if the automatic pass left `finalAgreementUrl` empty. */
export async function finalizeOperatorAgreementPdf(
  agreementId: string,
  operatorId: string
): Promise<{ ok: boolean; finalAgreementUrl?: string; reason?: string }> {
  const id = String(agreementId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!id || !oid) return { ok: false, reason: 'NO_ID' };
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/agreements/${encodeURIComponent(id)}/finalize-pdf`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId: oid }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    reason?: string;
    finalAgreementUrl?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: !!data.ok, finalAgreementUrl: data.finalAgreementUrl, reason: data.reason };
}

export async function fetchOperatorAgreementTemplates(operatorId?: string): Promise<any> {
  const qs = operatorId ? `?operatorId=${encodeURIComponent(String(operatorId))}` : '';
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/agreement-templates${qs}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function createOperatorAgreementTemplate(payload: any): Promise<any> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/agreement-templates',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/**
 * Opens template preview PDF in a new tab (same backend path as Coliving agreement-setting preview: Node + Google Docs).
 */
export async function openOperatorAgreementTemplatePreview(
  operatorId: string,
  templateId: string
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/agreement-templates/preview-pdf',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId, templateId }),
  });
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (!r.ok) {
    if (ct.includes('application/json')) {
      const data = (await r.json().catch(() => ({}))) as {
        reason?: string;
        message?: string;
      };
      return { ok: false, reason: data.message || data.reason || `HTTP_${r.status}` };
    }
    return { ok: false, reason: `HTTP_${r.status}` };
  }
  if (!ct.includes('application/pdf')) {
    return { ok: false, reason: 'INVALID_RESPONSE' };
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const w = typeof window !== 'undefined' ? window.open(url, '_blank', 'noopener,noreferrer') : null;
  if (!w) {
    URL.revokeObjectURL(url);
    return { ok: false, reason: 'POPUP_BLOCKED' };
  }
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return { ok: true };
}

/** Download one Word (.docx): table with all variables (column A) and examples (column B). */
export async function downloadClnAgreementVariablesReferenceDocx(): Promise<{ ok: boolean; reason?: string }> {
  const { clnAgreementVariablesReferenceDocxQuery } = await import('./cln-agreement-variable-reference');
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/agreement-variables-reference.docx?${clnAgreementVariablesReferenceDocxQuery()}`,
    cache: 'no-store',
  });
  if (!r.ok) {
    const data = (await r.json().catch(() => ({}))) as { reason?: string };
    return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cleanlemons-agreement-variables-reference.docx';
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true };
}

export async function fetchOperatorKpi(operatorId?: string): Promise<any> {
  const oid = String(operatorId || '').trim()
  const path = oid
    ? `/api/cleanlemon/operator/kpi?operatorId=${encodeURIComponent(oid)}`
    : '/api/cleanlemon/operator/kpi'
  const r = await apiFetch({ path, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchOperatorNotifications(operatorId?: string): Promise<any> {
  const oid = String(operatorId || '').trim()
  const path = oid
    ? `/api/cleanlemon/operator/notifications?operatorId=${encodeURIComponent(oid)}`
    : '/api/cleanlemon/operator/notifications'
  const r = await apiFetch({ path, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function readOperatorNotification(id: string, operatorId: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/notifications/${encodeURIComponent(id)}/read?${qs.toString()}`,
    method: 'PUT',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function dismissOperatorNotification(id: string, operatorId: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/notifications/${encodeURIComponent(id)}?${qs.toString()}`,
    method: 'DELETE',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchOperatorSettings(operatorId: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId });
  return fetchJsonSafe(
    apiFetch({ path: `/api/cleanlemon/operator/settings?${qs.toString()}`, cache: 'no-store' })
  );
}

export type OperatorPortalSetupStatus = {
  ok: boolean;
  reason?: string;
  operatorId?: string;
  email?: string;
  companyComplete?: boolean;
  profileComplete?: boolean;
  pricingComplete?: boolean;
  firstIncomplete?: 'company' | 'profile' | 'pricing' | null;
};

export async function fetchOperatorPortalSetupStatus(ctx: {
  operatorId: string;
  email: string;
}): Promise<OperatorPortalSetupStatus> {
  const operatorId = String(ctx.operatorId || '').trim();
  const email = String(ctx.email || '').trim().toLowerCase();
  const qs = new URLSearchParams({ operatorId, email });
  return fetchJsonSafe(
    apiFetch({ path: `/api/cleanlemon/operator/setup-status?${qs.toString()}`, cache: 'no-store' })
  );
}

export async function saveOperatorSettings(operatorId: string, settings: any): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/settings',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId, settings }),
    })
  );
}

/** Master-only: company login email (cln_operatordetail.email) — read-only on Company page; change via TAC + 7-day delay. */
export async function getClnOperatorCompanyEmailChangeStatus(ctx: {
  operatorId: string;
  email: string;
}): Promise<{
  ok: boolean;
  master?: boolean;
  companyEmail?: string;
  canChangeCompanyEmail?: boolean;
  pending?: {
    newEmail: string;
    status: string;
    tacExpiresAt: string | null;
    effectiveAt: string | null;
  } | null;
  reason?: string;
}> {
  const operatorId = String(ctx.operatorId || '').trim();
  const email = String(ctx.email || '').trim().toLowerCase();
  /** Never use NEXT_PUBLIC_CLEANLEMON_API_TOKEN here — backend requires portal JWT. */
  return fetchJsonSafe(
    portalUserFetch('/api/cleanlemon/operator/company-email-change/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId, email }),
      cache: 'no-store',
    })
  );
}

export async function requestClnOperatorCompanyEmailChange(
  newEmail: string,
  ctx: { operatorId: string; email: string }
): Promise<{ ok: boolean; reason?: string; effectiveAt?: string | null }> {
  return fetchJsonSafe(
    portalUserFetch('/api/cleanlemon/operator/company-email-change/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: String(ctx.operatorId || '').trim(),
        email: String(ctx.email || '').trim().toLowerCase(),
        newEmail,
      }),
      cache: 'no-store',
    })
  );
}

export async function confirmClnOperatorCompanyEmailChange(
  newEmail: string,
  code: string,
  ctx: { operatorId: string; email: string }
): Promise<{ ok: boolean; reason?: string; newEmail?: string; effectiveAt?: string | null }> {
  return fetchJsonSafe(
    portalUserFetch('/api/cleanlemon/operator/company-email-change/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: String(ctx.operatorId || '').trim(),
        email: String(ctx.email || '').trim().toLowerCase(),
        newEmail,
        code,
      }),
      cache: 'no-store',
    })
  );
}

export async function cancelClnOperatorCompanyEmailChange(ctx: {
  operatorId: string;
  email: string;
}): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    portalUserFetch('/api/cleanlemon/operator/company-email-change/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: String(ctx.operatorId || '').trim(),
        email: String(ctx.email || '').trim().toLowerCase(),
      }),
      cache: 'no-store',
    })
  );
}

/** Bukku secret + subdomain (Clean Lemons `cln_operator_integration`, same pattern as Coliving). */
export async function postCleanlemonBukkuConnect(payload: {
  operatorId: string;
  token: string;
  subdomain: string;
  einvoice?: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/bukku-connect',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
}

export async function fetchCleanlemonBukkuCredentials(operatorId: string): Promise<{
  ok: boolean;
  token?: string;
  subdomain?: string;
  reason?: string;
}> {
  const qs = new URLSearchParams({ operatorId });
  return fetchJsonSafe(
    apiFetch({ path: `/api/cleanlemon/operator/bukku-credentials?${qs}`, cache: 'no-store' })
  );
}

export async function postCleanlemonBukkuDisconnect(operatorId: string): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/bukku-disconnect',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId }),
    })
  );
}

export async function fetchCleanlemonXeroAuthUrl(params: {
  redirectUri: string;
  state?: string;
}): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const qs = new URLSearchParams({ redirectUri: params.redirectUri });
  if (params.state) qs.set('state', params.state);
  return fetchJsonSafe(
    apiFetch({ path: `/api/cleanlemon/operator/xero-auth-url?${qs.toString()}`, cache: 'no-store' })
  );
}

export async function postCleanlemonXeroConnect(
  operatorId: string,
  body: { code: string; redirectUri: string } | Record<string, unknown>
): Promise<{ ok: boolean; tenantId?: string; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/xero-connect',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId, ...body }),
    })
  );
}

export async function postCleanlemonXeroDisconnect(operatorId: string): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/xero-disconnect',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId }),
    })
  );
}

export async function postCleanlemonGoogleDriveOAuthUrl(operatorId: string): Promise<{
  ok: boolean;
  url?: string;
  reason?: string;
}> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/google-drive/oauth-url',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId }),
    })
  );
}

export async function postCleanlemonGoogleDriveDisconnect(operatorId: string): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/google-drive/disconnect',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId }),
    })
  );
}

export async function postCleanlemonStripeConnectOAuthUrl(operatorId: string): Promise<{
  ok: boolean;
  url?: string;
  reason?: string;
}> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/stripe-connect/oauth-url',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId }),
    })
  );
}

export async function postCleanlemonStripeConnectDisconnect(
  operatorId: string
): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/stripe-connect/disconnect',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId }),
    })
  );
}

/** Operator’s own Xendit for B2B client invoices — secret + X-CALLBACK-TOKEN (Coliving-style). */
export async function postClnOperatorClientInvoiceXenditCredentials(payload: {
  operatorId: string;
  /** Omit to keep existing secret on server. */
  secretKey?: string;
  /** Omit to keep existing token on server. */
  callbackToken?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const body: Record<string, string> = {
    operatorId: String(payload.operatorId || '').trim(),
  };
  if (payload.secretKey !== undefined) body.secretKey = String(payload.secretKey);
  if (payload.callbackToken !== undefined) body.callbackToken = String(payload.callbackToken);
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/client-invoice-xendit-credentials',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function postClnOperatorClientInvoiceXenditDisconnect(
  operatorId: string
): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/client-invoice-xendit-disconnect',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: String(operatorId || '').trim() }),
    })
  );
}

export async function postCleanlemonAiAgentConnect(payload: {
  operatorId: string;
  provider: 'openai' | 'deepseek' | 'gemini';
  apiKey: string;
}): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/ai-agent/connect',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: String(payload.operatorId || '').trim(),
        provider: payload.provider,
        apiKey: String(payload.apiKey || '').trim(),
      }),
    })
  );
}

export async function postCleanlemonAiAgentDisconnect(operatorId: string): Promise<{ ok: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/ai-agent/disconnect',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: String(operatorId || '').trim() }),
    })
  );
}

export async function fetchOperatorSubscription(params: {
  operatorId?: string;
  email?: string;
}): Promise<{ ok: boolean; item?: OperatorSubscription | null; reason?: string }> {
  const qs = new URLSearchParams();
  if (params.operatorId) qs.set('operatorId', String(params.operatorId));
  if (params.email) qs.set('email', String(params.email));
  const suffix = qs.toString();
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/subscription${suffix ? `?${suffix}` : ''}`,
      cache: 'no-store',
    })
  );
}

/** Rows from `cln_pricingplanlog` (Bukku SaaS subscription + add-on invoices). */
export type OperatorSaasBillingRow = {
  id: string;
  logKind: string;
  source: string | null;
  scenario: string | null;
  planCode: string | null;
  billingCycle: string | null;
  addonCode: string | null;
  amountMyr: number | null;
  invoiceId: string | null;
  invoiceUrl: string | null;
  stripeSessionId: string | null;
  createdAt: string | null;
  /** Bukku cash invoice `form_items[].description` (company, payment label, email, service). */
  lineItemDescription: string | null;
  /** Legacy aggregate; server may duplicate `lineItemDescription` or fall back to Stripe/Manual label. */
  paymentMethod: string;
  itemLabel: string;
};

export async function fetchOperatorSaasBillingHistory(params: {
  operatorId?: string;
  email?: string;
}): Promise<{ ok: boolean; items?: OperatorSaasBillingRow[]; reason?: string }> {
  const qs = new URLSearchParams();
  const oid = String(params.operatorId || '').trim();
  const em = String(params.email || '').trim().toLowerCase();
  if (oid) qs.set('operatorId', oid);
  if (em) qs.set('email', em);
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/saas-billing-history?${qs.toString()}`,
      cache: 'no-store',
    })
  );
}

/** Operator subscription Stripe catalog (`cln_pricingplan`). */
export async function fetchClnPricingPlans(): Promise<{
  ok: boolean;
  items?: ClnPricingplanItem[];
  reason?: string;
}> {
  return fetchJsonSafe(apiFetch({ path: '/api/cleanlemon/subscription/pricing', cache: 'no-store' }));
}

/** Cleanlemons `cln_addon` rows (subscription add-ons). */
export async function fetchClmAddonCatalog(): Promise<{
  ok: boolean;
  items?: ClmAddonCatalogItem[];
  reason?: string;
}> {
  return fetchJsonSafe(apiFetch({ path: '/api/cleanlemon/subscription/addon-catalog', cache: 'no-store' }));
}

/** Yearly add-on from MySQL, prorated by days until operator subscription expiry (see backend). */
export async function fetchAddonProrationQuote(params: {
  operatorId: string;
  email: string;
  addonCode: string;
}): Promise<{
  ok: boolean;
  reason?: string;
  yearlyAmountMyr?: number;
  amountDueMyr?: number;
  daysRemaining?: number;
  subscriptionExpiryDate?: string;
  addonTitle?: string;
}> {
  const qs = new URLSearchParams({
    operatorId: params.operatorId,
    email: params.email,
    addonCode: params.addonCode,
  });
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/subscription/addon-quote?${qs.toString()}`,
      cache: 'no-store',
    })
  );
}

export async function postAddonCheckoutSession(params: {
  operatorId: string;
  email: string;
  name: string;
  addonCode: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ ok: boolean; url?: string; sessionId?: string; quote?: unknown; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/subscription/addon-checkout',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  );
}

/** Stripe Checkout for operator subscription (same path as `payment/page` relative fetch). */
export async function postSubscriptionCheckoutSession(payload: Record<string, unknown>): Promise<{
  ok: boolean;
  url?: string;
  reason?: string;
  sessionId?: string;
}> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/subscription/checkout',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
}

export async function fetchOperatorSalaries(operatorId?: string, period?: string): Promise<any> {
  const oid = String(operatorId || '').trim()
  const qs = new URLSearchParams()
  if (oid) qs.set('operatorId', oid)
  if (period && String(period).trim()) qs.set('period', String(period).trim())
  const path = `/api/cleanlemon/operator/salaries?${qs.toString()}`
  const r = await apiFetch({ path, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchOperatorSalarySettings(operatorId: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() })
  return fetchJsonSafe(apiFetch({ path: `/api/cleanlemon/operator/salary-settings?${qs}`, cache: 'no-store' }))
}

export async function saveOperatorSalarySettings(
  operatorId: string,
  payDays: number[],
  payrollDefaults?: import('./malaysia-flex-payroll.types').PayrollDefaultsJson | null
): Promise<any> {
  const body: Record<string, unknown> = { operatorId, payDays }
  if (payrollDefaults !== undefined) body.payrollDefaults = payrollDefaults
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/salary-settings',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

export async function postOperatorSalariesComputePreview(payload: Record<string, unknown>): Promise<{
  ok?: boolean
  result?: import('./malaysia-flex-payroll.types').MalaysiaFlexPayrollResult
  reason?: string
}> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/salaries/compute-preview',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  )
}

export async function postOperatorSalariesSyncFromContacts(payload: {
  operatorId: string
  period: string
}): Promise<{ ok?: boolean; created?: number; skipped?: number; eligible?: number; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/salaries/sync-from-contacts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  )
}

export async function fetchOperatorSalaryLines(operatorId: string, period: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim(), period: String(period || '').trim() })
  return fetchJsonSafe(apiFetch({ path: `/api/cleanlemon/operator/salary-lines?${qs}`, cache: 'no-store' }))
}

export async function postOperatorSalaryLine(payload: Record<string, unknown>): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/salary-lines',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  )
}

export async function deleteOperatorSalaryLine(operatorId: string, lineId: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() })
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/salary-lines/${encodeURIComponent(lineId)}?${qs}`,
    method: 'DELETE',
  })
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` }
  return r.json()
}

export async function patchOperatorSalaryLine(
  operatorId: string,
  lineId: string,
  payload: Record<string, unknown>
): Promise<any> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() })
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/salary-lines/${encodeURIComponent(lineId)}?${qs}`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  )
}

export async function postOperatorSalaryRecord(payload: Record<string, unknown>): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/salaries',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  )
}

export async function patchOperatorSalaryRecord(
  id: string,
  payload: Record<string, unknown>
): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/salaries/${encodeURIComponent(id)}`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  )
}

/** Accrual sync: uses operator’s connected accounting (Bukku or Xero). */
export async function postOperatorSalariesSyncAccounting(
  operatorId: string,
  recordIds: string[],
  journalDate?: string
): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/salaries/sync-accounting',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId, recordIds, journalDate: journalDate || undefined }),
    })
  )
}

/** @deprecated Use postOperatorSalariesSyncAccounting (same API behaviour). */
export async function postOperatorSalariesSyncBukku(
  operatorId: string,
  recordIds: string[],
  journalDate?: string
): Promise<any> {
  return postOperatorSalariesSyncAccounting(operatorId, recordIds, journalDate)
}

export async function postOperatorSalariesMarkPaid(payload: {
  operatorId: string
  recordIds: string[]
  paymentDate: string
  paymentMethod: string
  /** Optional per-record MYR amounts for this payout run; omit to release full remaining balance each. */
  releaseAmounts?: Record<string, number>
}): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/salaries/mark-paid',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  )
}

export async function fetchOperatorContacts(operatorId?: string): Promise<any> {
  const qs = operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : '';
  const r = await apiFetch({ path: `/api/cleanlemon/operator/contacts${qs}`, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function postOperatorContactsSync(
  operatorId: string,
  direction: 'to-accounting' | 'from-accounting'
): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/contacts/sync-all',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId, direction }),
    })
  );
}

export async function createOperatorContact(payload: any): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/contacts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
}

export async function updateOperatorContact(id: string, payload: any): Promise<any> {
  return fetchJsonSafe(
    apiFetch({
      path: `/api/cleanlemon/operator/contacts/${encodeURIComponent(id)}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
}

export async function deleteOperatorContact(id: string, operatorId: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/contacts/${encodeURIComponent(id)}?${qs.toString()}`,
    method: 'DELETE',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchOperatorTeams(operatorId?: string): Promise<any> {
  const q = operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : '';
  const r = await apiFetch({ path: `/api/cleanlemon/operator/teams${q}`, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function createOperatorTeam(payload: any): Promise<any> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/teams',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function updateOperatorTeam(id: string, payload: any): Promise<any> {
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/teams/${encodeURIComponent(id)}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function deleteOperatorTeam(id: string, operatorId: string): Promise<any> {
  const q = `?operatorId=${encodeURIComponent(operatorId)}`;
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/teams/${encodeURIComponent(id)}${q}`,
    method: 'DELETE',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchOperatorScheduleJobs(opts?: {
  limit?: number
  operatorId?: string
  bustCache?: boolean
  /** Malaysia calendar job date (YYYY-MM-DD), inclusive — server filters `working_day` in KL. */
  dateFrom?: string
  dateTo?: string
}): Promise<any> {
  const limit = opts?.limit ?? 800;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (opts?.operatorId) params.set('operatorId', opts.operatorId);
  const df = String(opts?.dateFrom || '').trim().slice(0, 10);
  const dt = String(opts?.dateTo || '').trim().slice(0, 10);
  if (df && dt) {
    params.set('dateFrom', df);
    params.set('dateTo', dt);
  }
  if (opts?.bustCache) params.set('_cb', String(Date.now()));
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/schedule-jobs?${params.toString()}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/** Schedule row from `listOperatorPendingClientBookingRequests` (same shape as operator schedule jobs). */
export type CleanlemonPendingBookingJobRow = {
  id: string
  propertyId?: string
  property?: string
  unitNumber?: string
  client?: string
  address?: string
  date?: string
  cleaningType?: string
  serviceProvider?: string
  status?: string
  time?: string
}

export async function fetchOperatorPendingClientBookingRequests(opts: {
  operatorId: string
  limit?: number
}): Promise<{ ok: boolean; items?: CleanlemonPendingBookingJobRow[]; reason?: string }> {
  const params = new URLSearchParams();
  params.set('operatorId', String(opts.operatorId || '').trim());
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/pending-client-booking-requests?${params.toString()}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function decideOperatorClientBookingRequest(
  scheduleId: string,
  body: { operatorId: string; decision: "approve" | "reject"; email?: string; statusSetByEmail?: string }
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/pending-client-booking-requests/${encodeURIComponent(scheduleId)}/decide`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string }
  if (!r.ok) return { ok: false, reason: j.reason || `HTTP_${r.status}` }
  return { ok: true, ...j }
}

export async function updateOperatorScheduleJob(id: string, payload: any): Promise<any> {
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/schedule-jobs/${encodeURIComponent(id)}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function deleteOperatorScheduleJob(
  scheduleId: string,
  operatorId: string
): Promise<{ ok: boolean; reason?: string }> {
  const q = `?operatorId=${encodeURIComponent(operatorId)}`;
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/schedule-jobs/${encodeURIComponent(scheduleId)}${q}`,
    method: 'DELETE',
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: j.reason || `HTTP_${r.status}` };
  return { ok: true, ...j };
}

/** Geographic areas for map colors + AI team distribution (propertyIds = cln_property.id) */
export type OperatorRegionGroup = {
  id: string;
  name: string;
  color: string;
  propertyIds: string[];
};

export type OperatorScheduleAiPrefs = {
  aiScheduleCronEnabled?: boolean;
  /** 1–7: at KL midnight, assign for anchor day through anchor+N-1 */
  aiSchedulePlanningHorizonDays?: number;
  /** @deprecated ignored; midnight is fixed KL 00:00 */
  aiScheduleCronTimeLocal?: string;
  aiScheduleOnJobCreate?: boolean;
  aiScheduleProgressWatchEnabled?: boolean;
  /** After staff completes jobs (group-end), run rebalance for that KL day if today */
  aiScheduleRebalanceOnTaskComplete?: boolean;
  aiScheduleRebalanceIntervalMinutes?: number;
  aiSchedulePreferSameTeamWhenPossible?: boolean;
  aiScheduleSamePropertyDifferentTeamAlways?: boolean;
  /** prefer_same | rotate_same_property | balanced — server normalizes with the two booleans */
  aiScheduleTeamAssignmentMode?: string;
  maxJobsPerTeamPerDay?: number;
  /** @deprecated migrated to same/different location buffers */
  aiScheduleMinBufferMinutesBetweenJobs?: number;
  /** Minutes between back-to-back jobs at the same property (model hint) */
  aiScheduleMinBufferMinutesSameLocation?: number;
  /** Minutes between jobs at different properties (model hint) */
  aiScheduleMinBufferMinutesDifferentLocation?: number;
  /** Homestay service window start (HH:mm, KL) — no fixed job time; work fits in this band */
  aiScheduleHomestayWindowStartLocal?: string;
  /** Homestay service window end (HH:mm, KL) */
  aiScheduleHomestayWindowEndLocal?: string;
};

/** Platform AI rules (`cln_saasadmin_ai_md`) — also returned read-only on operator schedule AI settings. */
export type SaasadminAiMdItem = {
  id: string;
  /** Stable display id e.g. 0001 (after migration 0270). */
  ruleCode?: string;
  title: string;
  bodyMd: string;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

/** SaaS master policy for operator-facing AI (`cln_saasadmin_operator_ai_policy`). */
export type PlatformOperatorAiPolicy = {
  accessEnabled: boolean;
  /** e.g. `cln_schedule` — schedule jobs only until more scopes exist */
  allowedDataScopes: string[];
  updatedAt?: string | null;
};

export async function fetchOperatorScheduleAiSettings(
  operatorId: string,
  opts?: { email?: string }
): Promise<{
  ok: boolean;
  data?: {
    regionGroups: OperatorRegionGroup[];
    pinnedConstraints: unknown[];
    schedulePrefs: OperatorScheduleAiPrefs;
    promptExtra: string;
    chatSummary: string;
    /** SaaS platform rules (read-only for operator; same source as Admin → AI rules) */
    platformRules?: SaasadminAiMdItem[];
    /** SaaS master switch + allowed data scopes for operator AI */
    platformOperatorAi?: PlatformOperatorAiPolicy;
    /** YYYY-MM-DD (KL) last successful midnight batch anchor */
    lastScheduleAiCronDayYmd?: string | null;
    /** When automatic schedule AI last failed (e.g. API / token) */
    scheduleAiLastErrorAt?: string | null;
    scheduleAiLastErrorMessage?: string | null;
    scheduleAiLastErrorSource?: string | null;
  };
  reason?: string;
}> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const em = String(opts?.email || '')
    .trim()
    .toLowerCase();
  if (em) qs.set('email', em);
  return fetchJsonSafe(
    apiFetch({ path: `/api/cleanlemon/operator/schedule/ai-settings?${qs.toString()}`, cache: 'no-store' })
  );
}

export async function saveOperatorScheduleAiSettings(
  operatorId: string,
  body: {
    regionGroups?: OperatorRegionGroup[];
    pinnedConstraints?: unknown[];
    schedulePrefs?: OperatorScheduleAiPrefs;
    promptExtra?: string;
    chatSummary?: string;
    /** Clear the “last schedule AI error” banner (stored in DB) */
    clearScheduleAiLastError?: boolean;
  },
  opts?: { email?: string }
): Promise<{ ok: boolean; data?: unknown; reason?: string }> {
  const em = String(opts?.email || '')
    .trim()
    .toLowerCase();
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/schedule/ai-settings',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: String(operatorId || '').trim(),
        ...(em ? { email: em } : {}),
        ...body,
      }),
    })
  );
}

export async function fetchOperatorScheduleAiChat(
  operatorId: string,
  limit?: number,
  opts?: { email?: string }
): Promise<{ ok: boolean; items?: Array<{ id: string; role: string; content: string; createdAt: string }>; reason?: string }> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  if (limit != null) qs.set('limit', String(limit));
  const em = String(opts?.email || '')
    .trim()
    .toLowerCase();
  if (em) qs.set('email', em);
  return fetchJsonSafe(
    apiFetch({ path: `/api/cleanlemon/operator/schedule/ai-chat?${qs.toString()}`, cache: 'no-store' })
  );
}

export async function postOperatorScheduleAiChat(
  operatorId: string,
  message: string,
  mergeExtractedConstraints?: boolean,
  opts?: { email?: string; contextWorkingDay?: string }
): Promise<{
  ok: boolean;
  reply?: string;
  options?: Array<{ id: string; label: string }>;
  pinnedMerged?: boolean;
  schedulePrefsMerged?: boolean;
  usedFallback?: boolean;
  /** Present when a short "yes" after a team draft triggered server-side auto-assign. */
  scheduleSuggestApplied?: {
    ok: boolean;
    applied?: number;
    workingDay?: string;
    reason?: string;
    message?: string;
    error?: string;
  };
  /** Present when "yes" confirmed bulk pending-checkout → ready-to-clean for the toolbar working day. */
  scheduleStatusApplied?: {
    ok: boolean;
    applied?: number;
    workingDay?: string;
  };
  /** Present when "yes" confirmed delete row(s) for the toolbar working day. */
  scheduleJobsDeleted?: {
    ok: boolean;
    applied?: number;
    workingDay?: string;
  };
  /** Present when "yes" confirmed new schedule row(s) from Jarvis create flow. */
  scheduleJobCreated?: {
    ok?: boolean;
    id?: string;
    ids?: string[];
    workingDay?: string;
  };
  /** True when schedule rows were created — portal should refetch job list even if `scheduleJobCreated` shape is missing. */
  scheduleListRefresh?: boolean;
  reason?: string;
}> {
  const em = String(opts?.email || '')
    .trim()
    .toLowerCase();
  const cwd = String(opts?.contextWorkingDay || '')
    .trim()
    .slice(0, 10);
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/schedule/ai-chat',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: String(operatorId || '').trim(),
        message: String(message || '').trim(),
        mergeExtractedConstraints: !!mergeExtractedConstraints,
        ...(em ? { email: em } : {}),
        ...(cwd && /^\d{4}-\d{2}-\d{2}$/.test(cwd) ? { contextWorkingDay: cwd } : {}),
      }),
    })
  );
}

/** Bulk-create homestay jobs for all properties whose name contains `nameContains` (Malaysia `workingDay`). */
export async function postOperatorBulkHomestayByPropertyName(
  operatorId: string,
  workingDay: string,
  nameContains: string,
  opts?: { email?: string }
): Promise<{
  ok: boolean;
  workingDay?: string;
  nameContains?: string;
  matched?: number;
  created?: number;
  skipped?: number;
  errors?: Array<{ propertyId?: string; propertyName?: string; unitNumber?: string; message?: string; code?: string }>;
  reason?: string;
}> {
  const em = String(opts?.email || '')
    .trim()
    .toLowerCase();
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/schedule/bulk-create-homestay-by-name',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: String(operatorId || '').trim(),
        workingDay: String(workingDay || '').trim().slice(0, 10),
        nameContains: String(nameContains || '').trim(),
        ...(em ? { email: em } : {}),
      }),
    })
  );
}

export async function postOperatorScheduleAiSuggest(
  operatorId: string,
  workingDay: string,
  apply?: boolean,
  extras?: {
    mode?: 'full' | 'incremental' | 'rebalance'
    newJobIds?: string[]
    /** Manual rebalance from portal: bypasses "Progress watch" pref (still needs AI key). */
    force?: boolean
    /** Portal staff email when JWT is absent (e.g. demo). */
    email?: string
  }
): Promise<{
  ok: boolean
  mode?: string
  assignments?: Array<{ jobId: string; teamId: string; reason?: string }>
  reassignments?: Array<{ jobId: string; toTeamId: string; reason?: string }>
  rejected?: Array<{ jobId: string; reason: string }>
  applied?: number
  message?: string
  reason?: string
  skipped?: boolean
}> {
  const mode = extras?.mode && extras.mode !== 'full' ? extras.mode : undefined
  const body: Record<string, unknown> = {
    operatorId: String(operatorId || '').trim(),
    workingDay: String(workingDay || '').slice(0, 10),
    apply: !!apply,
  }
  const em = String(extras?.email || '')
    .trim()
    .toLowerCase()
  if (em) body.email = em
  if (mode) body.mode = mode
  if (extras?.newJobIds?.length) body.newJobIds = extras.newJobIds
  if (extras?.force) body.force = true
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/schedule/ai-suggest',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

export type DamagePhotoAttachment = {
  url: string
  kind: 'image' | 'video'
  posterUrl?: string | null
}

export type DamageReportItem = {
  id: string
  scheduleId: string
  propertyId: string
  propertyName: string
  unitNumber: string
  clientName: string
  operatorId: string
  operatorName: string
  staffEmail: string
  remark: string
  photoUrls: string[]
  /** When present (API ≥ this change), use for correct image vs video rendering (Wix import + OSS). */
  photoAttachments?: DamagePhotoAttachment[]
  reportedAt: string | null
  jobDate: string | null
  jobStartTime: string | null
  acknowledgedAt: string | null
  acknowledgedByEmail?: string | null
}

export async function postEmployeeScheduleDamageReport(
  scheduleId: string,
  body: {
    operatorId: string
    remark: string
    photos: string[]
    location?: unknown
  }
): Promise<{ ok?: boolean; id?: string; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/employee/schedule-jobs/${encodeURIComponent(scheduleId)}/damage-report`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(body.operatorId || '').trim(),
      remark: body.remark,
      photos: Array.isArray(body.photos) ? body.photos : [],
      location: body.location,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function fetchOperatorDamageReports(opts?: {
  limit?: number
  operatorId?: string
}): Promise<{ ok?: boolean; items?: DamageReportItem[]; reason?: string }> {
  const limit = opts?.limit ?? 200;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (opts?.operatorId) params.set('operatorId', opts.operatorId);
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/damage-reports?${params.toString()}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; items?: DamageReportItem[]; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function fetchClientDamageReports(opts: {
  email: string
  limit?: number
  operatorId?: string
}): Promise<{ ok?: boolean; items?: DamageReportItem[]; reason?: string }> {
  const limit = opts?.limit ?? 200;
  const params = new URLSearchParams();
  params.set('email', String(opts.email || '').trim().toLowerCase());
  params.set('limit', String(limit));
  if (opts?.operatorId) params.set('operatorId', opts.operatorId);
  const r = await apiFetch({
    path: `/api/cleanlemon/client/damage-reports?${params.toString()}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; items?: DamageReportItem[]; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function acknowledgeClientDamageReport(
  reportId: string,
  body: { email: string; operatorId?: string }
): Promise<{ ok?: boolean; alreadyAcknowledged?: boolean; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/client/damage-reports/${encodeURIComponent(reportId)}/acknowledge`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(body.email || '').trim().toLowerCase(),
      operatorId: String(body.operatorId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean
    alreadyAcknowledged?: boolean
    reason?: string
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export type EmployeeUnlockTarget = {
  lockDetailId: string;
  lockId: string;
  label: string;
  role: string;
  scopeKind?: string;
};

export async function postEmployeeScheduleGroupStart(body: {
  operatorId: string;
  jobIds: string[];
  estimateCompleteAt?: string;
  estimatePhotoCount?: number;
}): Promise<{ ok?: boolean; reason?: string; groupOperationId?: string; updatedIds?: string[] }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/schedule-jobs/group-start',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string; groupOperationId?: string; updatedIds?: string[] };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export type JobCompletionAddonDef = { id: string; name: string; priceMyr: number };

export async function fetchEmployeeJobCompletionAddons(
  operatorId: string
): Promise<{ ok?: boolean; items?: JobCompletionAddonDef[]; reason?: string }> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const r = await apiFetch({
    path: `/api/cleanlemon/employee/job-completion-addons?${qs.toString()}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: JobCompletionAddonDef[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postEmployeeScheduleGroupEnd(body: {
  operatorId: string;
  jobIds: string[];
  photos: string[];
  remark?: string;
  completionAddons?: JobCompletionAddonDef[];
}): Promise<{ ok?: boolean; reason?: string; groupOperationId?: string; updatedIds?: string[] }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/schedule-jobs/group-end',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string; groupOperationId?: string; updatedIds?: string[] };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postEmployeeTaskUnlockTargets(
  operatorId: string,
  jobId: string
): Promise<{ ok?: boolean; targets?: EmployeeUnlockTarget[]; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/task/unlock-targets',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId: String(operatorId || '').trim(), jobId: String(jobId || '').trim() }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; targets?: EmployeeUnlockTarget[]; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postEmployeeTaskUnlock(
  operatorId: string,
  jobId: string,
  lockDetailId: string
): Promise<{ ok?: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/employee/task/unlock',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      jobId: String(jobId || '').trim(),
      lockDetailId: String(lockDetailId || '').trim(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function createOperatorScheduleJob(payload: any): Promise<any> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/schedule-jobs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchOperatorAccountingMappings(operatorId: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId });
  const r = await apiFetch({ path: `/api/cleanlemon/operator/accounting-mappings?${qs.toString()}`, cache: 'no-store' });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; items?: unknown[]; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function saveOperatorAccountingMapping(operatorId: string, item: any): Promise<any> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/accounting-mappings',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId, item }),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function syncOperatorAccountingMappings(operatorId: string): Promise<any> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/accounting-mappings/sync',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function fetchOperatorCalendarAdjustments(operatorId: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId });
  const r = await apiFetch({ path: `/api/cleanlemon/operator/calendar-adjustments?${qs.toString()}`, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function createOperatorCalendarAdjustment(operatorId: string, payload: any): Promise<any> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/calendar-adjustments',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId, payload }),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function updateOperatorCalendarAdjustment(
  id: string,
  operatorId: string,
  payload: any
): Promise<any> {
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/calendar-adjustments/${encodeURIComponent(id)}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId: String(operatorId || '').trim(), payload }),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function deleteOperatorCalendarAdjustment(id: string, operatorId: string): Promise<any> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/calendar-adjustments/${encodeURIComponent(id)}?${qs.toString()}`,
    method: 'DELETE',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchAdminOperatordetailByEmail(
  email: string
): Promise<{
  ok: boolean;
  found?: boolean;
  operatorId?: string | null;
  companyName?: string;
  phone?: string;
  subscriptionSummary?: string;
  subscriptionSummaryCode?: string;
  reason?: string;
}> {
  const e = String(email || '').trim();
  if (!e) return { ok: true, found: false, operatorId: null, companyName: '', phone: '' };
  const qs = new URLSearchParams({ email: e });
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/operatordetail-by-email?${qs.toString()}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchAdminSubscriptions(filters?: {
  search?: string;
  plan?: string;
  status?: string;
  approvalStatus?: string;
}): Promise<{ ok: boolean; items?: AdminSubscription[]; reason?: string }> {
  const qs = new URLSearchParams();
  if (filters?.search) qs.set('search', filters.search);
  if (filters?.plan) qs.set('plan', filters.plan);
  if (filters?.status) qs.set('status', filters.status);
  if (filters?.approvalStatus) qs.set('approvalStatus', filters.approvalStatus);
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/subscriptions${suffix ? `?${suffix}` : ''}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export type AdminLockUnlockLogRow = {
  id: string;
  lockdetailId: string;
  createdAt: string;
  actorEmail: string;
  openMethod: string;
  portalSource: string | null;
  jobId: string | null;
  lockAlias: string | null;
  lockName: string | null;
  ttlockLockId: number | null;
};

export async function fetchAdminLockUnlockLogs(filters?: {
  q?: string;
  lockdetailId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  ok: boolean;
  items?: AdminLockUnlockLogRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  reason?: string;
}> {
  const qs = new URLSearchParams();
  if (filters?.q) qs.set('q', filters.q);
  if (filters?.lockdetailId) qs.set('lockdetailId', filters.lockdetailId);
  if (filters?.from) qs.set('from', filters.from);
  if (filters?.to) qs.set('to', filters.to);
  if (filters?.page != null) qs.set('page', String(filters.page));
  if (filters?.pageSize != null) qs.set('pageSize', String(filters.pageSize));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/lock-unlock-logs${suffix ? `?${suffix}` : ''}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchAdminLockUnlockLogLockOptions(): Promise<{
  ok: boolean;
  items?: { lockdetailId: string; label: string }[];
  reason?: string;
}> {
  const r = await apiFetch({
    path: '/api/cleanlemon/admin/lock-unlock-logs/lock-options',
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function updateAdminSubscriptionPlan(
  operatorId: string,
  payload: { planCode: string; monthlyPrice?: number; updatedBy?: string; note?: string }
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/subscriptions/${encodeURIComponent(operatorId)}/plan`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function updateAdminSubscriptionApproval(
  operatorId: string,
  payload: { decision: 'approved' | 'rejected' | 'pending'; approvedBy?: string; note?: string }
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/subscriptions/${encodeURIComponent(operatorId)}/approval`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function createAdminSubscriptionManual(payload: {
  email: string;
  activeFrom?: string;
  planCode: string;
  monthlyPrice?: number;
  billingCycle?: 'monthly' | 'quarterly' | 'yearly';
  companyName?: string;
  createCompanyIfMissing?: boolean;
  accountingIncluded?: boolean;
  accountingPaymentMethod?: 'bank' | 'cash';
  invoiceAmountMyr?: number;
}): Promise<{
  ok: boolean;
  operatorId?: string;
  saasBukkuInvoiceId?: string | null;
  saasBukkuInvoiceUrl?: string | null;
  reason?: string;
}> {
  const r = await apiFetch({
    path: '/api/cleanlemon/admin/subscriptions/manual-create',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function updateAdminSubscription(
  operatorId: string,
  payload: {
    email?: string;
    companyName?: string;
    activeFrom?: string;
    planCode: string;
    monthlyPrice?: number;
    billingCycle?: 'monthly' | 'quarterly' | 'yearly';
    updatedBy?: string;
    note?: string;
    planChangeMode?: 'upgrade' | 'renew';
    billingKind?: 'foc' | 'manual';
    paymentMethod?: 'bank' | 'cash';
    paymentDate?: string;
  }
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/subscriptions/${encodeURIComponent(operatorId)}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function terminateAdminSubscription(
  operatorId: string,
  payload: { terminatedBy?: string; reason?: string }
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/subscriptions/${encodeURIComponent(operatorId)}/terminate`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function addAdminSubscriptionAddon(
  operatorId: string,
  payload: {
    addonCode: string;
    addonName?: string;
    note?: string;
    createdBy?: string;
    accountingIncluded?: boolean;
    accountingPaymentMethod?: 'bank' | 'cash';
    invoiceAmountMyr?: number;
    invoiceDateYmd?: string;
  }
): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/subscriptions/${encodeURIComponent(operatorId)}/addons`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export type AdminPropertyBrief = {
  id: string;
  /** Building + unit when both set: "Name · Unit" */
  label: string;
  propertyName: string;
  unitName: string;
  operatorId: string;
  operatorName: string;
  clientdetailId: string;
  clientdetailName: string;
};

export type AdminIdLabel = { id: string; label: string };

export async function fetchAdminGlobalPropertyNames(q?: string, limit?: number): Promise<{
  ok: boolean;
  names?: string[];
  reason?: string;
}> {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (limit != null) qs.set('limit', String(limit));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/property-names${suffix ? `?${suffix}` : ''}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchAdminPropertiesBrief(q?: string, limit?: number): Promise<{
  ok: boolean;
  items?: AdminPropertyBrief[];
  reason?: string;
}> {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (limit != null) qs.set('limit', String(limit));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/properties${suffix ? `?${suffix}` : ''}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchAdminOperatorsBrief(q?: string, limit?: number): Promise<{
  ok: boolean;
  items?: AdminIdLabel[];
  reason?: string;
}> {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (limit != null) qs.set('limit', String(limit));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/operators-brief${suffix ? `?${suffix}` : ''}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchAdminClientdetailsBrief(q?: string, limit?: number): Promise<{
  ok: boolean;
  items?: AdminIdLabel[];
  reason?: string;
}> {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (limit != null) qs.set('limit', String(limit));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/clientdetails-brief${suffix ? `?${suffix}` : ''}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function postAdminMergePropertyNames(
  fromName: string,
  toName: string
): Promise<{ ok: boolean; updated?: number; colivingUpdated?: number; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/admin/properties/merge-names',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromName: String(fromName || '').trim(), toName: String(toName || '').trim() }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    updated?: number;
    colivingUpdated?: number;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postAdminTransferProperty(payload: {
  propertyId: string;
  operatorId?: string;
  clientdetailId?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/admin/properties/transfer',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export type AdminPropertyDeletePreviewRow = {
  id: string;
  propertyName: string;
  unitName: string;
  address: string;
  operatorId: string;
  operatorName: string;
  operatorEmail: string;
  clientdetailId: string;
  clientdetailName: string;
  clientdetailEmail: string;
  colivingPropertydetailId: string;
  colivingRoomdetailId: string;
};

export type AdminPropertyDeleteCounts = {
  schedules: number;
  legacyDamages: number;
  damageReports: number;
  linkRequests: number;
  operatorTeamsReferencing: number;
};

export async function fetchAdminPropertyDeletePreview(propertyId: string): Promise<{
  ok: boolean;
  property?: AdminPropertyDeletePreviewRow;
  counts?: AdminPropertyDeleteCounts;
  reason?: string;
}> {
  const id = String(propertyId || '').trim();
  if (!id) return { ok: false, reason: 'MISSING_PROPERTY_ID' };
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/properties/${encodeURIComponent(id)}/delete-preview`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    property?: AdminPropertyDeletePreviewRow;
    counts?: AdminPropertyDeleteCounts;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postAdminPropertyDelete(propertyId: string): Promise<{
  ok: boolean;
  deletedPropertyId?: string;
  deleted?: {
    damageReports: number;
    linkRequests: number;
    operatorTeamsUpdated: number;
  };
  reason?: string;
}> {
  const id = String(propertyId || '').trim();
  if (!id) return { ok: false, reason: 'MISSING_PROPERTY_ID' };
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/properties/${encodeURIComponent(id)}/delete`,
    method: 'POST',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    deletedPropertyId?: string;
    deleted?: { damageReports: number; linkRequests: number; operatorTeamsUpdated: number };
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function fetchSaasadminAiMdRules(): Promise<{
  ok: boolean;
  items?: SaasadminAiMdItem[];
  reason?: string;
}> {
  const r = await apiFetch({ path: '/api/cleanlemon/admin/saasadmin-ai-md', cache: 'no-store' });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: SaasadminAiMdItem[];
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, items: data.items || [] };
}

export async function fetchSaasadminOperatorAiAccess(): Promise<{
  ok: boolean;
  policy?: PlatformOperatorAiPolicy;
  reason?: string;
}> {
  const r = await apiFetch({ path: '/api/cleanlemon/admin/operator-ai-access', cache: 'no-store' });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    policy?: PlatformOperatorAiPolicy;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, policy: data.policy };
}

export async function putSaasadminOperatorAiAccess(body: {
  accessEnabled?: boolean;
  allowedDataScopes?: string[];
}): Promise<{ ok: boolean; policy?: PlatformOperatorAiPolicy; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/admin/operator-ai-access',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    policy?: PlatformOperatorAiPolicy;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, policy: data.policy };
}

export async function createSaasadminAiMdRule(body: {
  title: string;
  bodyMd?: string;
  sortOrder?: number;
}): Promise<{ ok: boolean; item?: SaasadminAiMdItem; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/admin/saasadmin-ai-md',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    item?: SaasadminAiMdItem;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, item: data.item };
}

export async function updateSaasadminAiMdRule(
  id: string,
  body: { title?: string; bodyMd?: string; sortOrder?: number }
): Promise<{ ok: boolean; item?: SaasadminAiMdItem; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/saasadmin-ai-md/${encodeURIComponent(id)}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    item?: SaasadminAiMdItem;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, item: data.item };
}

export async function deleteSaasadminAiMdRule(id: string): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/admin/saasadmin-ai-md/${encodeURIComponent(id)}`,
    method: 'DELETE',
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true };
}

export type SaasadminAiChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export async function postSaasadminAiChat(body: {
  message?: string;
  messages?: SaasadminAiChatMessage[];
}): Promise<{ ok: boolean; reply?: string; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/admin/saasadmin-ai-chat',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reply?: string; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, reply: data.reply };
}
