"use client"

import { AppSidebar } from '@/components/layout/app-sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { 
  Home, 
  Camera, 
  ClipboardCheck, 
  DollarSign,
  User
} from 'lucide-react'

const navItems = [
  { href: '', icon: Home, label: 'Home' },
  { href: '/attendance', icon: Camera, label: 'Attendance' },
  { href: '/tasks', icon: ClipboardCheck, label: 'Tasks' },
  { href: '/salary', icon: DollarSign, label: 'Salary' },
  { href: '/profile', icon: User, label: 'Profile' },
]

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar 
        items={navItems} 
        basePath="/portal/staff"
        title="Staff Portal"
      />
      <main className="flex-1 pb-20 md:pb-0">
        {children}
      </main>
      <MobileNav items={navItems} basePath="/portal/staff" />
    </div>
  )
}
