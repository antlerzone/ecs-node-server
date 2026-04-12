'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, type CleanlemonsJwtContext } from '@/lib/auth-context'
import { fetchPortalMemberRoles } from '@/lib/cleanlemon-api'
import {
  canAccessOperatorPortalFromCleanlemons,
  operatorPortalDenyHref,
} from '@/lib/cleanlemon-operator-portal-access'
import { isPortalOfflineDemo } from '@/lib/portal-auth-mock'

/**
 * `/portal/operator/*`: only emails with a row in `cln_operatordetail` (JWT `sources` includes `master`).
 * Supervisors without company master row → `/portal/supervisor`; field staff → `/portal/employee`.
 */
export function OperatorPortalRouteGate({ children }: { children: React.ReactNode }) {
  const offlineDemo = isPortalOfflineDemo()
  const { user, isLoading, updateUser } = useAuth()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (offlineDemo) return

    if (isLoading) return

    if (!user) {
      router.replace('/login')
      return
    }

    const jwtCln = user.cleanlemons as CleanlemonsJwtContext | null | undefined
    if (canAccessOperatorPortalFromCleanlemons(jwtCln)) {
      setAllowed(true)
      setReady(true)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const r = await fetchPortalMemberRoles()
        if (cancelled) return
        const cln = r?.cleanlemons as CleanlemonsJwtContext | null | undefined
        if (canAccessOperatorPortalFromCleanlemons(cln)) {
          if (user && cln) {
            updateUser({ cleanlemons: cln })
          }
          setAllowed(true)
        } else {
          router.replace(operatorPortalDenyHref(cln ?? jwtCln))
        }
      } catch {
        if (!cancelled) router.replace('/portal')
      } finally {
        if (!cancelled) setReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isLoading, user, router, offlineDemo, updateUser])

  if (offlineDemo) {
    return <>{children}</>
  }

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] w-full items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  if (!allowed) {
    return null
  }

  return <>{children}</>
}
