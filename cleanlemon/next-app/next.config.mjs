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
    ]
    if (redirectGoogleOAuthToDemoPage) {
      list.push({
        source: '/api/portal-auth/google',
        destination: '/auth/demo-google',
        permanent: false,
      })
    }
    return list
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
        source: '/client/:path*',
        destination: '/portal/client/:path*',
      },
      {
        source: '/linens',
        destination: '/portal/employee/linens',
      },
    ]
  },
}

export default nextConfig
