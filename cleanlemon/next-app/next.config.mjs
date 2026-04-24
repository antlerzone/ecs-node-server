import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Demo / preview builds: leave NEXT_PUBLIC_CLEANLEMON_API_URL unset → old clients still
 * GET /api/portal-auth/google (relative) and would 404. Redirect runs before filesystem.
 * Production: set NEXT_PUBLIC_CLEANLEMON_API_URL at build time so this is omitted.
 */
const portalAuthMockEnv =
  process.env.NEXT_PUBLIC_PORTAL_AUTH_MOCK === 'true' ||
  process.env.NEXT_PUBLIC_PORTAL_AUTH_MOCK === '1'
const redirectGoogleOAuthToDemoPage = portalAuthMockEnv

/** Node API for Cleanlemons routes (same machine as `next dev` / `next start`). */
const cleanlemonNodeProxyTarget =
  (process.env.CLEANLEMON_NODE_PROXY_TARGET || '').trim().replace(/\/$/, '') || 'http://127.0.0.1:5000'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure .env.local is visible to client bundles on all platforms (some dev setups omit inlined NEXT_PUBLIC_*).
  env: {
    NEXT_PUBLIC_CLEANLEMON_API_URL:
      process.env.NEXT_PUBLIC_CLEANLEMON_API_URL ?? '',
  },
  // Monorepo roots; production build uses webpack in package.json (aligned with Coliving portal).
  outputFileTracingRoot: path.join(__dirname, '../..'),
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    const list = [
      {
        source: '/portal/employee/order',
        destination: '/employee/transport',
        permanent: true,
      },
      {
        source: '/portal/employee/:path*',
        destination: '/employee/:path*',
        permanent: true,
      },
      {
        source: '/portal/operator/:path*',
        destination: '/operator/:path*',
        permanent: true,
      },
      {
        source: '/portal/client/:path*',
        destination: '/client/:path*',
        permanent: true,
      },
      {
        source: '/portal/dobi/:path*',
        destination: '/employee/dobi/:path*',
        permanent: true,
      },
      {
        source: '/portal/driver/:path*',
        destination: '/employee/driver/:path*',
        permanent: true,
      },
    ]
    list.push({
      source: '/employee/order',
      destination: '/employee/transport',
      permanent: true,
    })
    if (redirectGoogleOAuthToDemoPage) {
      list.push({
        source: '/api/portal-auth/google',
        destination: '/auth/demo-google',
        permanent: false,
      })
    }
    return list
  },
  /** After `next build`, avoid the browser reusing a cached HTML shell that still points at old `/_next/static/*` hashes (ChunkLoadError + 500 on missing chunks). */
  async headers() {
    const noStoreHtml = [
      {
        key: 'Cache-Control',
        value: 'private, no-cache, no-store, max-age=0, must-revalidate',
      },
    ]
    return [
      { source: '/client', headers: noStoreHtml },
      { source: '/client/:path*', headers: noStoreHtml },
      { source: '/portal/client', headers: noStoreHtml },
      { source: '/portal/client/:path*', headers: noStoreHtml },
      { source: '/employee', headers: noStoreHtml },
      { source: '/employee/:path*', headers: noStoreHtml },
      { source: '/portal/employee', headers: noStoreHtml },
      { source: '/portal/employee/:path*', headers: noStoreHtml },
      { source: '/profile', headers: noStoreHtml },
      { source: '/profile/:path*', headers: noStoreHtml },
      { source: '/portal/profile', headers: noStoreHtml },
      { source: '/portal/profile/:path*', headers: noStoreHtml },
      { source: '/cleaning-company', headers: noStoreHtml },
      { source: '/portal/cleaning-company', headers: noStoreHtml },
      { source: '/cleanlemons', headers: noStoreHtml },
      { source: '/portal/cleanlemons', headers: noStoreHtml },
      { source: '/operator', headers: noStoreHtml },
      { source: '/operator/:path*', headers: noStoreHtml },
      { source: '/portal/operator', headers: noStoreHtml },
      { source: '/portal/operator/:path*', headers: noStoreHtml },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/employee/:path*',
        destination: '/portal/employee/:path*',
      },
      {
        source: '/operator/:path*',
        destination: '/portal/operator/:path*',
      },
      {
        source: '/client',
        destination: '/portal/client',
      },
      {
        source: '/client/',
        destination: '/portal/client/',
      },
      {
        source: '/client/:path*',
        destination: '/portal/client/:path*',
      },
      {
        source: '/profile/:path*',
        destination: '/portal/profile/:path*',
      },
      {
        source: '/cleaning-company',
        destination: '/portal/cleaning-company',
      },
      {
        source: '/cleanlemons',
        destination: '/portal/cleanlemons',
      },
      {
        source: '/linens',
        destination: '/portal/employee/linens',
      },
      {
        source: '/api/cleanlemon/:path*',
        destination: `${cleanlemonNodeProxyTarget}/api/cleanlemon/:path*`,
      },
      {
        source: '/api/public/:path*',
        destination: `${cleanlemonNodeProxyTarget}/api/public/:path*`,
      },
      {
        source: '/api/portal-auth/:path*',
        destination: `${cleanlemonNodeProxyTarget}/api/portal-auth/:path*`,
      },
    ]
  },
}

export default nextConfig
