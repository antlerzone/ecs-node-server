'use client'

import { AppSidebar } from '@/components/layout/app-sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { SaasAdminRouteGate } from '@/components/saas-admin-route-gate'
import { AuthProvider } from '@/lib/auth-context'
import { CreditCard, GitMerge, ScrollText } from 'lucide-react'

const navItems = [
  { href: '/subscription', icon: CreditCard, label: 'Subscription' },
  { href: '/merge', icon: GitMerge, label: 'Merge' },
  { href: '/log', icon: ScrollText, label: 'Unlock log' },
]

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SaasAdminRouteGate>
        <div className="flex min-h-screen bg-background">
          <AppSidebar items={navItems} basePath="/admin" title="Admin" />
          <main className="flex-1 pb-20 md:pb-0">{children}</main>
          <MobileNav items={navItems} basePath="/admin" />
        </div>
      </SaasAdminRouteGate>
    </AuthProvider>
  )
}
