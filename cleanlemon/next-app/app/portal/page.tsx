"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { 
  Building2, 
  Users, 
  Home,
  Shield,
  Code,
  LogOut,
  ChevronRight 
} from 'lucide-react'
import type { UserRole } from '@/lib/types'
import { pickFirstClientIdFromMemberRoles, type CleanlemonsJwtContext } from '@/lib/auth-context'
import { fetchOperatorSubscription, fetchPortalMemberRoles } from '@/lib/cleanlemon-api'
import { isPortalOfflineDemo } from '@/lib/portal-auth-mock'

export default function PortalSelectionPage() {
  const { user, isLoading, setUserRole, logout, updateUser } = useAuth()
  const router = useRouter()
  const offlineDemo = isPortalOfflineDemo()
  const [hasActiveOperatorSubscription, setHasActiveOperatorSubscription] = useState(false)
  const [hasApiPortalAddon, setHasApiPortalAddon] = useState(false)
  const [isSaasAdmin, setIsSaasAdmin] = useState(false)
  /** Until both calls finish, portal count/cards can jump (e.g. 2→3 when SaaS Admin appears). */
  const [subscriptionReady, setSubscriptionReady] = useState(offlineDemo)
  const [memberRolesReady, setMemberRolesReady] = useState(offlineDemo)
  const email = String(user?.email || '').trim().toLowerCase()
  /** Member-roles effect must not depend on full `user` — updateUser() would retrigger and clear SaaS from state. */
  const userRef = useRef(user)
  userRef.current = user
  /** 與 portal.colivingjb.com/portal 一致：Welcome 用 email 的 @ 前綴，不用 OAuth 佔位名 */
  const welcomeName = useMemo(() => {
    if (email.includes('@')) return email.split('@')[0]
    return String(user?.name || '').trim() || 'User'
  }, [email, user?.name])

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/')
    }
  }, [user, isLoading, router])

  /** New login email → drop previous account’s SaaS flag until member-roles returns. */
  useEffect(() => {
    setIsSaasAdmin(false)
  }, [email])

  const handleSelectPortal = (role: UserRole) => {
    if (!role) return
    setUserRole(role)
    if (role === 'saas-admin') {
      router.push('/admin/subscription')
      return
    }
    const rolePathMap: Record<string, string> = {
      'api-user': 'api-integration',
    }
    const target = rolePathMap[String(role)] || String(role)
    router.push(`/portal/${target}`)
  }

  const handleLogout = () => {
    logout()
    router.push('/')
  }

  useEffect(() => {
    if (offlineDemo) return
    if (!email) {
      setSubscriptionReady(true)
      return
    }
    let cancelled = false
    ;(async () => {
      const u = userRef.current
      if (!u) {
        if (!cancelled) setSubscriptionReady(true)
        return
      }
      try {
        const r = await fetchOperatorSubscription({
          operatorId: u.operatorId || '',
          email,
        })
        if (cancelled) return
        const active = !!r?.ok && !!r.item && String(r.item.status || '').toLowerCase() === 'active'
        setHasActiveOperatorSubscription(active)
        const addonRows = Array.isArray(r?.item?.addons) ? r.item.addons : []
        const hasAddon = addonRows.some((addon) => {
          const status = String(addon?.status || '').trim().toLowerCase()
          if (status !== 'active') return false
          const rawCode = String(addon?.addonCode || '')
          const normalizedCode = rawCode.trim().toLowerCase().replace(/[_\s]+/g, '-')
          return normalizedCode === 'api-portal' || normalizedCode === 'api-integration'
        })
        setHasApiPortalAddon(hasAddon)
      } finally {
        if (!cancelled) setSubscriptionReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [offlineDemo, user?.operatorId, email])

  useEffect(() => {
    if (offlineDemo) return
    if (!email) {
      setMemberRolesReady(true)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetchPortalMemberRoles()
        if (cancelled) return
        const rows = Array.isArray(r?.roles) ? r.roles : []
        const hasSaasRow = rows.some(
          (row) => String(row?.type || '').trim().toLowerCase() === 'saas_admin'
        )
        setIsSaasAdmin(hasSaasRow)
        // 與後端同步：OAuth JWT 可能缺 operatorChoices（主檔僅在 cln_operatordetail.email）
        const cln = r?.cleanlemons as CleanlemonsJwtContext | null | undefined
        const u = userRef.current
        if (r?.ok && cln && u) {
          const choices = Array.isArray(cln.operatorChoices) ? cln.operatorChoices : []
          const nextOp =
            choices.length > 0
              ? String(choices[0].operatorId || '').trim()
              : pickFirstClientIdFromMemberRoles(rows)
          if (!nextOp || nextOp === 'op_demo_001') return
          const prev = String(u.operatorId || '').trim()
          const staleCln = !u.cleanlemons?.operatorChoices?.length
          if (staleCln || prev === '' || prev === 'op_demo_001') {
            updateUser({ cleanlemons: cln, operatorId: nextOp })
          }
        }
      } finally {
        if (!cancelled) setMemberRolesReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [offlineDemo, email, updateUser])

  const portals = useMemo(() => ([
    {
      role: 'operator' as const,
      title: 'Operator Portal',
      description: 'Manage cleaning company, staff, clients, and operations',
      icon: Building2,
      color: 'bg-primary',
    },
    {
      role: 'employee' as const,
      title: 'Employee Portal',
      description:
        'Staff tasks, attendance, and agreements. If your operator assigns you as Driver or Dobi, those areas appear in the side menu.',
      icon: Users,
      color: 'bg-secondary',
    },
    {
      role: 'client' as const,
      title: 'Client Portal',
      description: 'View schedules, submit feedback, and manage properties',
      icon: Home,
      color: 'bg-destructive/10',
    },
    {
      role: 'saas-admin' as const,
      title: 'SaaS Admin',
      description: 'Platform analytics and subscription management',
      icon: Shield,
      color: 'bg-muted',
    },
    {
      role: 'api-user' as const,
      title: 'API Portal',
      description: 'API keys, documentation, and integration settings',
      icon: Code,
      color: 'bg-primary/10',
    },
  ]), [])

  /** JWT often carries `saas-admin` before member-roles API returns — avoids SaaS Admin row flashing off→on. */
  const canAccessSaasAdmin = useMemo(() => {
    if (String(user?.role || '').trim().toLowerCase() === 'saas-admin') return true
    return isSaasAdmin
  }, [user?.role, isSaasAdmin])

  const visiblePortals = useMemo(() => {
    if (offlineDemo) return portals
    return portals.filter((portal) => {
      if (portal.role === 'client') return true
      if (portal.role === 'operator') return hasActiveOperatorSubscription
      if (portal.role === 'saas-admin') return canAccessSaasAdmin
      if (portal.role === 'api-user') return hasApiPortalAddon
      if (portal.role === 'employee') {
        return true
      }
      return false
    })
  }, [offlineDemo, portals, hasActiveOperatorSubscription, hasApiPortalAddon, canAccessSaasAdmin])

  const portalListReady = offlineDemo || (subscriptionReady && memberRolesReady)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-foreground">Loading...</div>
      </div>
    )
  }

  if (!user) return null

  return (
    <main className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="w-full py-4 px-6 border-b border-border">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Welcome back,</p>
            <h1 className="text-2xl font-bold text-foreground">{welcomeName}</h1>
          </div>
          
          <Button 
            variant="ghost"
            onClick={handleLogout}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 p-6">
        <div className="w-full max-w-4xl mx-auto">
          {/* Logo/Branding */}
          <div className="text-center mb-12">
            <div className="inline-block">
              <p className="text-sm font-semibold text-primary uppercase tracking-widest">
                Cleanlemons
              </p>
              <h2 className="text-2xl font-bold text-foreground">Management</h2>
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-8">
            <h3 className="text-3xl font-bold text-foreground mb-2">
              Select Your Portal
            </h3>
            <p className="text-muted-foreground">
              {offlineDemo
                ? 'Demo mode — all portals shown (no API).'
                : !portalListReady
                  ? 'Loading your portals…'
                  : `You have access to ${visiblePortals.length} portals.`}
            </p>
          </div>

          {/* Portal List */}
          <div className="space-y-3 mb-12">
            {!portalListReady ? (
              <div className="w-full space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-[88px] w-full animate-pulse rounded-lg border border-border bg-muted/40"
                  />
                ))}
              </div>
            ) : null}
            {portalListReady
              ? visiblePortals.map((portal) => {
              const Icon = portal.icon
              return (
                <button
                  key={portal.role}
                  onClick={() => handleSelectPortal(portal.role)}
                  className="w-full p-4 border border-border rounded-lg hover:border-primary/50 hover:shadow-md transition-all bg-card hover:bg-muted/50 group"
                >
                  <div className="flex items-center gap-4">
                    {/* Icon */}
                    <div className={`w-12 h-12 rounded-full ${portal.color} flex items-center justify-center shrink-0 flex-none`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 text-left">
                      <h4 className="font-semibold text-foreground text-base mb-0.5">
                        {portal.title}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {portal.description}
                      </p>
                    </div>

                    {/* Arrow */}
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                  </div>
                </button>
              )
            })
              : null}
            {portalListReady && visiblePortals.length === 0 ? (
              <div className="w-full p-4 border border-dashed border-border rounded-lg text-sm text-muted-foreground">
                No portal assigned for this account yet. Please contact admin to grant role access.
              </div>
            ) : null}
          </div>

          {/* Back Link */}
          <div className="text-center">
            <Button variant="link" className="text-muted-foreground hover:text-foreground">
              Back to Home
            </Button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full py-4 px-6 border-t border-border text-center text-xs text-muted-foreground">
        <p>Logged in as {user.email}</p>
      </footer>
    </main>
  )
}
