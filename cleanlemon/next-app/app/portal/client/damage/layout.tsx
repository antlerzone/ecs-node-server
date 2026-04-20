import type { ReactNode } from 'react'

/**
 * Avoid prerender + long-cache HTML on this route (stale shell / chunk mismatch after deploy).
 * See cleanlemon/docs/portal-chunk-prevention.md pattern.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function ClientDamageLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
