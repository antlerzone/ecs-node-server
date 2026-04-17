"use client"

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { ClientMobileDrawer, ClientMobileHeader } from '@/components/layout/client-mobile-chrome'
import type { ClientNavItem } from '@/components/layout/client-mobile-chrome'
import { useAuth } from '@/lib/auth-context'
import { fetchEmployeeProfileByEmail, fetchOperatorInvoices } from '@/lib/cleanlemon-api'
import {
  Home,
  Calendar,
  Building2,
  CheckSquare,
  FileText,
  FileSignature,
  User,
  Plug,
  Lock,
  AlertTriangle,
  Sparkles,
} from 'lucide-react'
import { Toaster } from 'sonner'

/** Desktop sidebar: full list (order preserved). */
const clientPortalNavItemsFull: ClientNavItem[] = [
  { href: '', icon: Home, label: 'Dashboard' },
  { href: '/profile', icon: User, label: 'Profile' },
  { href: '/agreement', icon: FileSignature, label: 'Agreement' },
  { href: '/invoices', icon: FileText, label: 'Invoices' },
  { href: '/approval', icon: CheckSquare, label: 'Approval' },
  { href: '/booking', icon: Calendar, label: 'Booking', activeMatch: 'prefix' },
  { href: '/damage', icon: AlertTriangle, label: 'Damage' },
  { href: '/properties', icon: Building2, label: 'Properties' },
  { href: '/integration', icon: Plug, label: 'Integration' },
  { href: '/smart-door', icon: Lock, label: 'Smart Door' },
]

/** Mobile bottom bar (5): Dashboard → Schedule (dashboard tab) → Booking page → Invoice → Profile */
const mobileBottomNavItems: ClientNavItem[] = [
  { href: '', icon: Home, label: 'Dashboard', clientTab: 'home' },
  { href: '?tab=schedule', icon: Calendar, label: 'Schedule', clientTab: 'schedule' },
  { href: '/booking', icon: Sparkles, label: 'Booking', prominent: true },
  { href: '/invoices', icon: FileText, label: 'Invoice' },
  { href: '/profile', icon: User, label: 'Profile' },
]

/** Mobile left drawer — remaining links. */
const mobileDrawerNavItems: ClientNavItem[] = [
  { href: '/damage', icon: AlertTriangle, label: 'Damage' },
  { href: '/agreement', icon: FileSignature, label: 'Agreement' },
  { href: '/approval', icon: CheckSquare, label: 'Approval' },
  { href: '/properties', icon: Building2, label: 'Properties' },
  { href: '/integration', icon: Plug, label: 'Integration' },
  { href: '/smart-door', icon: Lock, label: 'Smart Door' },
]

function isProfileComplete(profile: Record<string, unknown> | null | undefined): boolean {
  if (!profile) return false
  const required = [
    'entityType',
    'legalName',
    'idType',
    'idNumber',
    'phone',
    'address',
  ]
  return required.every((key) => String(profile[key] || '').trim() !== '')
}

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const [checkingGate, setCheckingGate] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isProfileRoute = useMemo(() => {
    const p = String(pathname || '')
    return p.includes('/client/profile')
  }, [pathname])
  const isAgreementRoute = useMemo(() => {
    const p = String(pathname || '')
    return p.includes('/client/agreement')
  }, [pathname])
  const isApprovalRoute = useMemo(() => {
    const p = String(pathname || '')
    return p.includes('/client/approval')
  }, [pathname])
  const isInvoicesRoute = useMemo(() => {
    const p = String(pathname || '')
    return p.includes('/client/invoices')
  }, [pathname])
  const isIntegrationRoute = useMemo(() => {
    const p = String(pathname || '')
    return p.includes('/client/integration')
  }, [pathname])
  const isColivingLinkRoute = useMemo(() => {
    const p = String(pathname || '')
    return p.includes('/client/coliving-link')
  }, [pathname])
  const isSmartDoorRoute = useMemo(() => {
    const p = String(pathname || '')
    return p.includes('/client/smart-door')
  }, [pathname])

  useEffect(() => {
    let cancelled = false
    const email = String(user?.email || '').trim()
    if (!email) {
      setCheckingGate(false)
      return
    }

    ;(async () => {
      try {
        const res = await fetchEmployeeProfileByEmail(email)
        const profile = (res?.profile || {}) as Record<string, unknown>
        const complete = !!(res?.ok && isProfileComplete(profile))
        if (!complete && !isProfileRoute) {
          router.replace('/client/profile?gate=required')
          return
        }

        const approvalRaw =
          profile.approvalPending ??
          profile.approvalpending ??
          profile.pendingApprovals ??
          []
        const hasPendingApproval = Array.isArray(approvalRaw) && approvalRaw.length > 0
        if (hasPendingApproval && !isApprovalRoute) {
          router.replace('/client/approval?gate=required')
          return
        }

        const inv = await fetchOperatorInvoices()
        const allInvoices = Array.isArray(inv?.items) ? inv.items : []
        const myInvoices = allInvoices.filter((x: any) => {
          const em = String(x?.clientEmail || x?.email || '').trim().toLowerCase()
          if (!em) return true
          return em === email.toLowerCase()
        })
        const hasUnpaidInvoice = myInvoices.some((x: any) => {
          const st = String(x?.status || '').trim().toLowerCase()
          return st === 'pending' || st === 'overdue' || st === 'unpaid'
        })
        if (hasUnpaidInvoice && !isInvoicesRoute && !isIntegrationRoute && !isColivingLinkRoute && !isSmartDoorRoute) {
          router.replace('/client/invoices?gate=required')
          return
        }
      } finally {
        if (!cancelled) setCheckingGate(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user?.email, isProfileRoute, isApprovalRoute, isInvoicesRoute, isIntegrationRoute, isColivingLinkRoute, isSmartDoorRoute, router])

  if (
    checkingGate &&
    !isProfileRoute &&
    !isAgreementRoute &&
    !isApprovalRoute &&
    !isInvoicesRoute &&
    !isIntegrationRoute &&
    !isColivingLinkRoute &&
    !isSmartDoorRoute
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
      </div>
    )
  }

  /** Coliving OAuth handoff: popup-sized surface — no sidebar / bottom menu. */
  if (isColivingLinkRoute) {
    return (
      <div className="min-h-screen bg-background">
        <main className="min-h-0">{children}</main>
        <Toaster richColors position="top-center" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background md:h-screen md:max-h-screen">
      <AppSidebar items={clientPortalNavItemsFull} basePath="/client" title="Client Portal" />
      <ClientMobileHeader onOpenMenu={() => setMobileMenuOpen(true)} />
      <ClientMobileDrawer
        open={mobileMenuOpen}
        onOpenChange={setMobileMenuOpen}
        items={mobileDrawerNavItems}
        basePath="/client"
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-14 pb-20 md:pt-0 md:pb-0">
        {children}
      </main>
      <MobileNav items={mobileBottomNavItems} basePath="/client" />
      <Toaster richColors position="top-center" />
    </div>
  )
}
