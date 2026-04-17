'use client'

import { AppSidebar } from '@/components/layout/app-sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { SaasAdminRouteGate } from '@/components/saas-admin-route-gate'
import { Bot, LayoutDashboard, CreditCard, GitMerge, ScrollText, Settings } from 'lucide-react'

const navItems = [
  { href: '', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/subscriptions', icon: CreditCard, label: 'Subscriptions' },
  { href: '/ai', icon: Bot, label: 'AI rules' },
  { href: '/merge', icon: GitMerge, label: 'Merge' },
  { href: '/log', icon: ScrollText, label: 'Unlock log' },
  { href: '/settings', icon: Settings, label: 'Settings' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SaasAdminRouteGate>
      <div className="flex min-h-screen bg-background">
        <AppSidebar items={navItems} basePath="/portal/admin" title="Admin" />
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
        <MobileNav items={navItems} basePath="/portal/admin" />
      </div>
    </SaasAdminRouteGate>
  )
}
