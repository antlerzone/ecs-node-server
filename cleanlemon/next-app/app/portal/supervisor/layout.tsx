"use client"

import { AppSidebar } from '@/components/layout/app-sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { 
  LayoutDashboard, 
  Users, 
  Calendar, 
  ClipboardList, 
  MapPin,
  Settings
} from 'lucide-react'

const navItems = [
  { href: '', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/teams', icon: Users, label: 'Teams' },
  { href: '/schedule', icon: Calendar, label: 'Schedule' },
  { href: '/tasks', icon: ClipboardList, label: 'Tasks' },
  { href: '/locations', icon: MapPin, label: 'Locations' },
]

export default function SupervisorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar 
        items={navItems} 
        basePath="/portal/supervisor"
        title="Supervisor Portal"
      />
      <main className="flex-1 pb-20 md:pb-0">
        {children}
      </main>
      <MobileNav items={navItems} basePath="/portal/supervisor" />
    </div>
  )
}
