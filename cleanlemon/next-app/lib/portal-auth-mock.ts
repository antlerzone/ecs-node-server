/**
 * When ECS API URL is unset, points at this frontend, or NEXT_PUBLIC_PORTAL_AUTH_MOCK is set,
 * Google OAuth must not redirect to same-origin /api/portal-auth/google (Next has no ECS routes → 404).
 *
 * Hosts:
 * - portal.cleanlemons.com — production portal: never mock OAuth; never "offline demo" all-cards UI.
 * - demo.cleanlemons.com — mockup / staging: may use mock OAuth and demo cards when API unset.
 */

export const CLEANLEMON_LIVE_PORTAL_HOST = "portal.cleanlemons.com";
export const CLEANLEMON_DEMO_HOST = "demo.cleanlemons.com";

/** Browser → ECS via portal 同域 /api/（与 Nginx、CLEANLEMON_PORTAL_AUTH_BASE_URL 默认一致）。勿用无效证书的 api 子域。 */
export const DEFAULT_CLEANLEMON_PROD_API = "https://portal.cleanlemons.com";

/**
 * Public API base for Next.js → ECS calls. Uses NEXT_PUBLIC_CLEANLEMON_API_URL when set.
 * On **portal.cleanlemons.com** (or live-portal build), falls back to DEFAULT_CLEANLEMON_PROD_API so Google OAuth works without extra env.
 */
export function getCleanlemonApiBase(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_CLEANLEMON_API_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (isLivePortalCleanlemonsBuild()) return DEFAULT_CLEANLEMON_PROD_API;
  if (typeof window !== "undefined" && isLivePortalCleanlemonsHost()) return DEFAULT_CLEANLEMON_PROD_API;
  return "";
}

/** Server Route Handlers: resolve API base using Host header when env is unset. */
export function getCleanlemonApiBaseForRequest(hostHeader: string | null | undefined): string {
  const fromEnv = (process.env.NEXT_PUBLIC_CLEANLEMON_API_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (isLivePortalCleanlemonsHostname(hostHeader)) return DEFAULT_CLEANLEMON_PROD_API;
  if (isLivePortalCleanlemonsBuild()) return DEFAULT_CLEANLEMON_PROD_API;
  return "";
}

/**
 * Public marketing route `/{slug}` (SSR): must reach Cleanlemons Node (`/api/public/...` on port 5001).
 * - Nginx may send `Host: 127.0.0.1:3100` → `getCleanlemonApiBaseForRequest` is empty → was "server not configured".
 * - Do **not** fall back to `https://portal.cleanlemons.com` for SSR: many installs proxy `/api/` on that host
 *   to Coliving (5000), which returns unrelated 404 / "client not found".
 * Prefer same-host API: `CLEANLEMON_INTERNAL_API_ORIGIN` (see Xero webhook route) or default `http://127.0.0.1:5001` in production.
 */
export function getCleanlemonApiBaseForMarketingSsr(hostHeader: string | null | undefined): string {
  const primary = getCleanlemonApiBaseForRequest(hostHeader).trim().replace(/\/$/, "");
  if (primary) return primary;

  const internal = (process.env.CLEANLEMON_INTERNAL_API_ORIGIN || "").trim().replace(/\/$/, "");
  if (internal) return internal;

  if (process.env.NODE_ENV === "production") {
    return "http://127.0.0.1:5001";
  }
  return "";
}

export function isPortalAuthMockExplicit(): boolean {
  const v = process.env.NEXT_PUBLIC_PORTAL_AUTH_MOCK;
  return v === "true" || v === "1";
}

/** Request Host header (server) or browser — normalized hostname without port. */
export function parseRequestHostname(hostHeader: string | null | undefined): string {
  const raw = String(hostHeader || "").trim();
  if (!raw) return "";
  // X-Forwarded-Host may list multiple hosts: "client, proxy"
  const first = raw.split(",")[0].trim();
  // host:port (typical); avoid IPv6 bracket forms in Host for this product
  return first.split(":")[0].trim().toLowerCase();
}

/** Server / middleware: live production portal (real Google OAuth only). */
export function isLivePortalCleanlemonsHostname(hostHeader: string | null | undefined): boolean {
  return parseRequestHostname(hostHeader) === CLEANLEMON_LIVE_PORTAL_HOST;
}

/** Server: demo / mockup site hostname. */
export function isDemoCleanlemonsHostname(hostHeader: string | null | undefined): boolean {
  return parseRequestHostname(hostHeader) === CLEANLEMON_DEMO_HOST;
}

/** Client: production portal in the browser. */
export function isLivePortalCleanlemonsHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.toLowerCase() === CLEANLEMON_LIVE_PORTAL_HOST;
}

/** Client: demo.cleanlemons.com */
export function isDemoCleanlemonsHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.toLowerCase() === CLEANLEMON_DEMO_HOST;
}

/**
 * Build-time: set on portal.cleanlemons.com deployments so SSR matches live (no window).
 * Optional if NEXT_PUBLIC_CLEANLEMON_API_URL is always set on that build.
 */
export function isLivePortalCleanlemonsBuild(): boolean {
  const v = process.env.NEXT_PUBLIC_CLEANLEMON_LIVE_PORTAL;
  return v === "true" || v === "1";
}

/** Browser: use client mock for Google (no redirect to ECS). Never on portal.cleanlemons.com. */
export function shouldUseMockOAuthClient(): boolean {
  if (isLivePortalCleanlemonsBuild()) return false;
  if (isLivePortalCleanlemonsHost()) return false;
  if (isPortalAuthMockExplicit()) return true;
  const base = getCleanlemonApiBase();
  if (!base) return true;
  if (typeof window === "undefined") return false;
  try {
    const api = new URL(base.startsWith("http") ? base : `https://${base}`);
    if (api.hostname === window.location.hostname) return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * `/portal` role cards: no ECS — show every portal (skip subscription, invites, email allowlists).
 * Never true on portal.cleanlemons.com (live site uses API rules).
 * demo.cleanlemons.com: behaves like mockup when API URL unset or flags set.
 */
export function isPortalOfflineDemo(): boolean {
  if (isLivePortalCleanlemonsBuild()) return false;
  if (isLivePortalCleanlemonsHost()) return false;
  if (isPortalAuthMockExplicit()) return true;
  const force = process.env.NEXT_PUBLIC_PORTAL_SHOW_ALL_CARDS;
  if (force === "true" || force === "1") return true;
  return !getCleanlemonApiBase();
}
