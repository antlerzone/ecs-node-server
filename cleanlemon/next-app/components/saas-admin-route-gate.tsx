'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { fetchPortalMemberRoles } from '@/lib/cleanlemon-api'

function isSaasAdminRole(role: string | null | undefined): boolean {
  return String(role || '').trim().toLowerCase() === 'saas-admin'
}

/**
 * Restricts routes to platform SaaS admin only (member role `saas_admin`).
 * — Not logged in → `/login`
 * — Logged in but not SaaS admin → `/portal`
 */
export function SaasAdminRouteGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (isLoading) return

    if (!user) {
      router.replace('/login')
      return
    }

    if (isSaasAdminRole(user.role)) {
      setAllowed(true)
      setReady(true)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const r = await fetchPortalMemberRoles()
        if (cancelled) return
        const rows = Array.isArray(r?.roles) ? r.roles : []
        const isSaas = rows.some(
          (row) => String(row?.type || '').trim().toLowerCase() === 'saas_admin'
        )
        if (isSaas) {
          setAllowed(true)
          setReady(true)
        } else {
          router.replace('/portal')
        }
      } catch {
        if (!cancelled) router.replace('/portal')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isLoading, user, router])

  if (!ready || !allowed) {
    return (
      <div className="flex min-h-[40vh] w-full items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  return <>{children}</>
}
