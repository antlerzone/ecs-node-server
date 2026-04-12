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

export type CleanlemonPricingConfig = {
  selectedServices: string[];
  activeServiceTab: string;
  serviceConfigs: Record<string, unknown>;
  bookingMode: string;
  /** Per pricing service key (`general`, `homestay`, …): `instant` | `request_approve`. Overrides global `bookingMode` when set. */
  bookingModeByService?: Record<string, string>;
  leadTime: string;
  /** Optional — merged by KPI Settings; preserved when Pricing save spreads previous config */
  employeeCleanerKpi?: EmployeeCleanerKpiPersisted;
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
  if (envApiToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${envApiToken}`);
  } else if (typeof window !== 'undefined' && !headers.has('Authorization')) {
    try {
      const pjwt = localStorage.getItem(PORTAL_JWT_KEY) || '';
      if (pjwt) headers.set('Authorization', `Bearer ${pjwt}`);
    } catch {
      /* ignore */
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
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
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

/** Client portal — TTLock onboarding status (requires B2B client ↔ operator link). */
export async function fetchClientTtlockOnboardStatus(
  email: string,
  operatorId: string
): Promise<{
  ok?: boolean;
  ttlockConnected?: boolean;
  ttlockCreateEverUsed?: boolean;
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
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function fetchClientTtlockCredentials(
  email: string,
  operatorId: string
): Promise<{ ok?: boolean; username?: string; password?: string; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/ttlock/credentials',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email || '').trim().toLowerCase(), operatorId: String(operatorId || '').trim() }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    username?: string;
    password?: string;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postClientTtlockConnect(
  email: string,
  operatorId: string,
  username: string,
  password: string
): Promise<{ ok?: boolean; mode?: string; username?: string; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/ttlock/connect',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      operatorId: String(operatorId || '').trim(),
      username: String(username || '').trim(),
      password: String(password || ''),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; mode?: string; username?: string; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postClientTtlockDisconnect(
  email: string,
  operatorId: string
): Promise<{ ok?: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/client/ttlock/disconnect',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email || '').trim().toLowerCase(), operatorId: String(operatorId || '').trim() }),
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
  premisesType?: string;
  /** Cleanlemons operator (`cln_property.operator_id` → company master). */
  operatorId?: string;
  operatorName?: string;
  operatorEmail?: string;
  /** Pending `client_requests_operator` row — operator has not approved yet. */
  clientOperatorLinkPending?: boolean;
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

export type ClientPortalPropertyDetail = {
  id: string;
  name: string;
  address: string;
  unitNumber: string;
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
  afterCleanPhotoUrl?: string;
  keyPhotoUrl?: string;
  smartdoorPassword?: string;
  smartdoorTokenEnabled?: boolean;
  smartdoorBindings?: ClientPortalSmartdoorBindings;
  /** WGS84 from `cln_property.latitude` / `longitude` when set. */
  latitude?: number | null;
  longitude?: number | null;
  updatedAt?: string | null;
};

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

/** Operator portal — TTLock (`cln_operator_integration` + `cln_ttlocktoken`). */
export async function fetchOperatorTtlockOnboardStatus(operatorId: string): Promise<{
  ok?: boolean;
  ttlockConnected?: boolean;
  ttlockCreateEverUsed?: boolean;
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
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function fetchOperatorTtlockCredentials(
  operatorId: string
): Promise<{ ok?: boolean; username?: string; password?: string; reason?: string }> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/ttlock/credentials?${qs.toString()}`,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    username?: string;
    password?: string;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postOperatorTtlockConnect(
  operatorId: string,
  username: string,
  password: string
): Promise<{ ok?: boolean; mode?: string; username?: string; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/ttlock/connect',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operatorId: String(operatorId || '').trim(),
      username: String(username || '').trim(),
      password: String(password || ''),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    mode?: string;
    username?: string;
    reason?: string;
  };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return data;
}

export async function postOperatorTtlockDisconnect(operatorId: string): Promise<{ ok?: boolean; reason?: string }> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/ttlock/disconnect',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId: String(operatorId || '').trim() }),
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
  opts?: { propertyId?: string; keyword?: string; search?: string; filter?: string; sort?: string; page?: number; pageSize?: number; limit?: number }
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

export async function clnUnlockSmartDoor(scope: CleanlemonSmartDoorScope, ctx: { operatorId: string; email: string }, lockDetailId: string) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string }>(scope, 'unlock', { email, operatorId, id: lockDetailId });
}

export async function clnPreviewSmartDoorSelection(scope: CleanlemonSmartDoorScope, ctx: { operatorId: string; email: string }) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
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
  }>(scope, 'preview-selection', { email, operatorId });
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
  payload: { type: string; externalId: string; name: string }
) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok: boolean; reason?: string }>(scope, 'sync-name', { email, operatorId, ...payload });
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

export async function clnSyncSmartDoorLocksFromTtlock(scope: CleanlemonSmartDoorScope, ctx: { operatorId: string; email: string }) {
  const email = String(ctx.email || '').trim().toLowerCase();
  const operatorId = String(ctx.operatorId || '').trim();
  return postCleanlemonSmartDoor<{ ok: boolean; lockCount?: number; gatewayCount?: number; reason?: string }>(
    scope,
    'sync-locks-from-ttlock',
    { email, operatorId }
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

export async function fetchOperatorDashboard(): Promise<any> {
  const r = await apiFetch({ path: '/api/cleanlemon/operator/dashboard', cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function fetchOperatorProperties(operatorId?: string): Promise<any> {
  const qs = new URLSearchParams({ limit: '500' });
  if (operatorId) qs.set('operatorId', String(operatorId));
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/properties?${qs.toString()}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
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
export async function fetchGlobalPropertyNames(params?: { q?: string; limit?: number }): Promise<any> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', String(params.q));
  if (params?.limit != null) qs.set('limit', String(params.limit));
  const suffix = qs.toString();
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/property-names-global${suffix ? `?${suffix}` : ''}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/** Most common address + Waze + Google Maps URL for a shared `property_name` (all properties). */
export async function fetchPropertyNameDefaults(name: string): Promise<{
  ok: boolean;
  address?: string;
  wazeUrl?: string;
  googleMapsUrl?: string;
  reason?: string;
}> {
  const qs = new URLSearchParams({ name: String(name || '').trim() });
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/property-name-defaults?${qs.toString()}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

/** OpenStreetMap Nominatim address search (server proxy; default Malaysia `countrycodes=my`). */
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

/** Search operator master (`cln_operatordetail`) for dropdown. */
export async function fetchOperatorLookup(params?: { q?: string; limit?: number }): Promise<{
  ok: boolean;
  items?: Array<{ id: string; name?: string; email?: string }>;
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

/** B2B client — cleaning jobs for linked properties (JWT or email+operatorId). */
export async function fetchClientScheduleJobs(
  email: string,
  operatorId: string,
  opts?: { limit?: number }
): Promise<{ ok: boolean; items?: unknown[]; reason?: string }> {
  const qs = new URLSearchParams({
    email: String(email || '').trim().toLowerCase(),
    operatorId: String(operatorId || '').trim(),
  });
  if (opts?.limit != null) qs.set('limit', String(opts.limit));
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

/** Client portal — extend / reschedule: same schedule row, new working day + in-progress. */
export async function updateClientScheduleJob(body: {
  email: string;
  operatorId: string;
  scheduleId: string;
  workingDay: string;
  status?: string;
  statusSetByEmail?: string;
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

export async function fetchOperatorInvoices(): Promise<any> {
  return fetchJsonSafe(
    apiFetch({ path: '/api/cleanlemon/operator/invoices?limit=500', cache: 'no-store' })
  );
}

export async function createOperatorInvoice(payload: any): Promise<any> {
  const r = await apiFetch({
    path: '/api/cleanlemon/operator/invoices',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
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
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/invoices/${encodeURIComponent(id)}/status`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status,
      operatorId: opts?.operatorId,
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

export async function fetchOperatorAgreements(operatorId?: string): Promise<any> {
  const qs = operatorId ? `?operatorId=${encodeURIComponent(String(operatorId))}` : '';
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/agreements${qs}`,
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
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
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/agreements/${encodeURIComponent(id)}/sign`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
  if (!r.ok) return { ok: false, reason: data.reason || `HTTP_${r.status}` };
  return { ok: true, ...data };
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

export async function readOperatorNotification(id: string): Promise<any> {
  const r = await apiFetch({ path: `/api/cleanlemon/operator/notifications/${encodeURIComponent(id)}/read`, method: 'PUT' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function dismissOperatorNotification(id: string): Promise<any> {
  const r = await apiFetch({ path: `/api/cleanlemon/operator/notifications/${encodeURIComponent(id)}`, method: 'DELETE' });
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

export async function fetchOperatorSalaries(operatorId?: string): Promise<any> {
  const oid = String(operatorId || '').trim()
  const path = oid
    ? `/api/cleanlemon/operator/salaries?operatorId=${encodeURIComponent(oid)}`
    : '/api/cleanlemon/operator/salaries'
  const r = await apiFetch({ path, cache: 'no-store' });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
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

export async function deleteOperatorContact(id: string): Promise<any> {
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/contacts/${encodeURIComponent(id)}`,
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

export async function fetchOperatorScheduleJobs(opts?: { limit?: number; operatorId?: string }): Promise<any> {
  const limit = opts?.limit ?? 800;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (opts?.operatorId) params.set('operatorId', opts.operatorId);
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

export async function fetchOperatorScheduleAiSettings(operatorId: string): Promise<{
  ok: boolean;
  data?: {
    regionGroups: OperatorRegionGroup[];
    pinnedConstraints: unknown[];
    schedulePrefs: OperatorScheduleAiPrefs;
    promptExtra: string;
    chatSummary: string;
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
  }
): Promise<{ ok: boolean; data?: unknown; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/schedule/ai-settings',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: String(operatorId || '').trim(), ...body }),
    })
  );
}

export async function fetchOperatorScheduleAiChat(
  operatorId: string,
  limit?: number
): Promise<{ ok: boolean; items?: Array<{ id: string; role: string; content: string; createdAt: string }>; reason?: string }> {
  const qs = new URLSearchParams({ operatorId: String(operatorId || '').trim() });
  if (limit != null) qs.set('limit', String(limit));
  return fetchJsonSafe(
    apiFetch({ path: `/api/cleanlemon/operator/schedule/ai-chat?${qs.toString()}`, cache: 'no-store' })
  );
}

export async function postOperatorScheduleAiChat(
  operatorId: string,
  message: string,
  mergeExtractedConstraints?: boolean
): Promise<{ ok: boolean; reply?: string; pinnedMerged?: boolean; reason?: string }> {
  return fetchJsonSafe(
    apiFetch({
      path: '/api/cleanlemon/operator/schedule/ai-chat',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: String(operatorId || '').trim(),
        message: String(message || '').trim(),
        mergeExtractedConstraints: !!mergeExtractedConstraints,
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

export async function fetchClientDamageReports(opts?: {
  limit?: number
  operatorId?: string
}): Promise<{ ok?: boolean; items?: DamageReportItem[]; reason?: string }> {
  const limit = opts?.limit ?? 200;
  const params = new URLSearchParams();
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
  body: { operatorId: string }
): Promise<{ ok?: boolean; alreadyAcknowledged?: boolean; reason?: string }> {
  const r = await apiFetch({
    path: `/api/cleanlemon/client/damage-reports/${encodeURIComponent(reportId)}/acknowledge`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId: String(body.operatorId || '').trim() }),
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

export async function postEmployeeScheduleGroupEnd(body: {
  operatorId: string;
  jobIds: string[];
  photos: string[];
  remark?: string;
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

export async function updateOperatorCalendarAdjustment(id: string, payload: any): Promise<any> {
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/calendar-adjustments/${encodeURIComponent(id)}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  if (!r.ok) return { ok: false, reason: `HTTP_${r.status}` };
  return r.json();
}

export async function deleteOperatorCalendarAdjustment(id: string): Promise<any> {
  const r = await apiFetch({
    path: `/api/cleanlemon/operator/calendar-adjustments/${encodeURIComponent(id)}`,
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
