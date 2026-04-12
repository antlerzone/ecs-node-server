"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Toaster } from '@/components/ui/sonner'
import {
  LayoutDashboard,
  User,
  Wallet,
  BarChart3,
  LogOut,
  Menu,
  Bell,
  ChevronLeft,
  Shirt,
} from 'lucide-react'
import { ensureCleanlemonsEmployeeProfile } from '@/lib/cleanlemon-api'
import { hasOperatorBindingsForPortal } from '@/lib/cleanlemons-portal-helpers'

const fullNavItems = [
  { href: '/portal/dobi', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/portal/dobi/profile', label: 'Profile', icon: User },
  { href: '/portal/dobi/salary', label: 'Salary', icon: Wallet },
  { href: '/portal/dobi/kpi', label: 'My KPI', icon: BarChart3 },
]

const PROFILE_HREF = '/portal/dobi/profile'

export default function DobiLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout, updateUser } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)

  const hasDobiBinding = hasOperatorBindingsForPortal(user?.cleanlemons, 'dobi')

  const navItems = useMemo(() => {
    if (!hasDobiBinding) {
      return fullNavItems.filter((i) => i.href === PROFILE_HREF)
    }
    return fullNavItems
  }, [hasDobiBinding])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!user?.email) {
        setSessionReady(true)
        return
      }
      const r = await ensureCleanlemonsEmployeeProfile()
      if (cancelled) return
      if (r?.ok && r.cleanlemons) {
        updateUser({ cleanlemons: r.cleanlemons })
      }
      setSessionReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email])

  useEffect(() => {
    if (!sessionReady) return
    if (hasDobiBinding) return
    if (pathname === PROFILE_HREF) return
    router.replace(PROFILE_HREF)
  }, [sessionReady, hasDobiBinding, pathname, router])

  const handleLogout = () => {
    logout()
    router.push('/')
  }

  const NavContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-sidebar-primary flex items-center justify-center">
            <Shirt className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          <div>
            <span className="text-sidebar-foreground font-bold">Cleanlemons</span>
            <Badge variant="secondary" className="ml-2 text-xs bg-sidebar-accent text-sidebar-accent-foreground">Dobi</Badge>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                isActive
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent'
              }`}
            >
              <item.icon className="h-5 w-5" />
              <span className="font-medium text-sm">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={user?.avatar} />
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground">
              {user?.name?.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{user?.name}</p>
            <p className="text-xs text-sidebar-foreground/70 truncate">{user?.email}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => router.push('/portal')}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Switch
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )

  if (!sessionReady) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="hidden lg:flex w-64 bg-sidebar border-r border-sidebar-border flex-col fixed h-full">
        <NavContent />
      </aside>

      <div className="flex-1 lg:ml-64">
        <header className="sticky top-0 z-20 bg-card border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="lg:hidden">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 p-0 bg-sidebar">
                  <NavContent />
                </SheetContent>
              </Sheet>
              <h1 className="text-lg font-semibold text-foreground">
                {navItems.find((item) => item.href === pathname)?.label || 'Dobi Portal'}
              </h1>
            </div>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center">
                1
              </span>
            </Button>
          </div>
        </header>

        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border px-2 py-2 z-20">
        <div className="flex items-center justify-around">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-xs">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      <Toaster />
    </div>
  )
}
