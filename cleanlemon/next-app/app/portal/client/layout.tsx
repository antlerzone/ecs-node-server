"use client"

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'
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
} from 'lucide-react'
import { Toaster } from 'sonner'

const navItems = [
  { href: '', icon: Home, label: 'Dashboard' },
  { href: '/profile', icon: User, label: 'Profile' },
  { href: '/agreement', icon: FileSignature, label: 'Agreement' },
  { href: '/invoices', icon: FileText, label: 'Invoices' },
  { href: '/approval', icon: CheckSquare, label: 'Approval' },
  { href: '/schedule', icon: Calendar, label: 'Schedule' },
  { href: '/damage', icon: AlertTriangle, label: 'Damage' },
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
    <div className="flex min-h-screen bg-background">
      <AppSidebar 
        items={navItems} 
        basePath="/client"
        title="Client Portal"
      />
      <main className="flex-1 pb-20 md:pb-0">
        {children}
      </main>
      <MobileNav items={navItems} basePath="/client" />
      <Toaster richColors position="top-center" />
    </div>
  )
}
