/**
 * Single-segment paths on portal.cleanlemons.com — must stay aligned with
 * `CLN_PUBLIC_SUBDOMAIN_RESERVED` in `src/modules/cleanlemon/cleanlemon.service.js`.
 */
const RESERVED = new Set([
  'login',
  'register',
  'pricing',
  'enquiry',
  'admin',
  'portal',
  'auth',
  'operator',
  'client',
  'employee',
  'linens',
  'api',
  '_next',
  'favicon',
  'favicon.ico',
  'robots',
  'robots.txt',
  'static',
  'assets',
  'images',
  'payment',
  'm',
  'p',
  'staff',
  'supervisor',
  'dobi',
  'driver',
  'saas-admin',
  'api-integration',
  'null',
  'undefined',
  'wp-admin',
])

export function isReservedPublicSubdomain(slug: string): boolean {
  const s = String(slug || '')
    .trim()
    .toLowerCase()
  return !s || RESERVED.has(s)
}
