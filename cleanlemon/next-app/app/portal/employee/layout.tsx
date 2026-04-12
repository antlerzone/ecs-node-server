"use client"

import { useEffect, useMemo, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  LayoutDashboard,
  ClipboardList,
  Clock,
  BarChart3,
  Package2,
  FileSignature,
  Building2,
  User,
  LogOut,
  Menu,
  Bell,
  ChevronLeft,
  Truck,
  Shirt,
} from 'lucide-react'
import { ensureCleanlemonsEmployeeProfile, fetchOperatorScheduleJobs } from '@/lib/cleanlemon-api'
import {
  filterOperatorsForPortal,
  hasOperatorBindingsForPortal,
} from '@/lib/cleanlemons-portal-helpers'

type NavItem = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
}

const fullNavItems: NavItem[] = [
  { href: '/employee', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/employee/profile', label: 'Profile', icon: User },
  { href: '/employee/working', label: 'Working', icon: Clock },
  { href: '/employee/task', label: 'Tasks', icon: ClipboardList },
  { href: '/employee/agreement', label: 'Agreement', icon: FileSignature },
  { href: '/employee/linens', label: 'Linens', icon: Package2 },
  { href: '/employee/kpi', label: 'KPI', icon: BarChart3 },
]

const dobiPortalNav: NavItem = { href: '/portal/dobi', label: 'Dobi', icon: Shirt }
const driverPortalNav: NavItem = { href: '/portal/driver', label: 'Driver', icon: Truck }

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const normalizedPathname = pathname?.startsWith('/portal/')
    ? pathname.replace('/portal', '')
    : pathname
  const router = useRouter()
  const { user, logout, updateUser } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedOperatorId, setSelectedOperatorId] = useState('')
  const [sessionReady, setSessionReady] = useState(false)
  const [currentTeam, setCurrentTeam] = useState<string>('-')

  const hasStaffBinding = hasOperatorBindingsForPortal(user?.cleanlemons, 'staff')
  const hasDriverBinding = hasOperatorBindingsForPortal(user?.cleanlemons, 'driver')
  const hasDobiBinding = hasOperatorBindingsForPortal(user?.cleanlemons, 'dobi')
  const hasAnyEmployeeBinding = hasStaffBinding || hasDriverBinding || hasDobiBinding

  const operatorOptions = useMemo(
    () => filterOperatorsForPortal(user?.cleanlemons, 'staff'),
    [user?.cleanlemons]
  )

  const navItems = useMemo(() => {
    const base: NavItem[] = hasStaffBinding
      ? fullNavItems
      : fullNavItems.filter((i) => i.href === '/employee/profile')
    const extra: NavItem[] = []
    if (hasDobiBinding) extra.push(dobiPortalNav)
    if (hasDriverBinding) extra.push(driverPortalNav)
    return [...base, ...extra]
  }, [hasStaffBinding, hasDobiBinding, hasDriverBinding])

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
    if (hasAnyEmployeeBinding) return
    if (normalizedPathname === '/employee/profile') return
    router.replace('/employee/profile')
  }, [sessionReady, hasAnyEmployeeBinding, normalizedPathname, router])

  useEffect(() => {
    const stored = localStorage.getItem('cleanlemons_employee_operator_id')
    if (!operatorOptions.length) {
      setSelectedOperatorId('')
      return
    }
    if (stored && operatorOptions.some((x) => x.id === stored)) {
      setSelectedOperatorId(stored)
      return
    }
    const first = operatorOptions[0].id
    setSelectedOperatorId(first)
    localStorage.setItem('cleanlemons_employee_operator_id', first)
  }, [operatorOptions])

  const handleOperatorChange = (value: string) => {
    setSelectedOperatorId(value)
    localStorage.setItem('cleanlemons_employee_operator_id', value)
  }

  useEffect(() => {
    if (!hasStaffBinding) {
      setCurrentTeam('-')
      return
    }
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorScheduleJobs()
      if (cancelled) return
      const jobs = Array.isArray(r?.items) ? r.items : []
      const keys = new Set<string>()
      const email = String(user?.email || '').trim().toLowerCase()
      const name = String(user?.name || '').trim().toLowerCase()
      const id = String(user?.id || '').trim().toLowerCase()
      if (email) keys.add(email)
      if (email.includes('@')) keys.add(email.split('@')[0])
      if (name) keys.add(name)
      if (id) keys.add(id)
      if (keys.size === 0) {
        setCurrentTeam('-')
        return
      }
      const teamCount = new Map<string, number>()
      for (const job of jobs) {
        const team = String(job?.teamName || job?.team || '').trim() || 'Unassigned'
        const candidates = [
          String(job?.staffEmail || ''),
          String(job?.staffName || ''),
          String(job?.cleanerName || ''),
          String(job?.assignedTo || ''),
          String(job?.submitBy || ''),
        ]
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean)
        const matched = candidates.some((x) => {
          if (keys.has(x)) return true
          for (const key of keys) {
            if (!key) continue
            if (x.includes(key) || key.includes(x)) return true
          }
          return false
        })
        if (!matched) continue
        teamCount.set(team, (teamCount.get(team) || 0) + 1)
      }
      if (teamCount.size === 0) {
        setCurrentTeam('-')
        return
      }
      const picked = Array.from(teamCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
      setCurrentTeam(picked)
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email, user?.name, user?.id, selectedOperatorId, hasStaffBinding])

  const handleLogout = () => {
    logout()
    router.push('/')
  }

  const NavContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-sidebar-primary flex items-center justify-center">
            <span className="text-sidebar-primary-foreground font-bold">CL</span>
          </div>
          <div>
            <span className="text-sidebar-foreground font-bold">Cleanlemons</span>
            <Badge variant="secondary" className="ml-2 text-xs">Employee</Badge>
          </div>
        </div>
      </div>

      {hasStaffBinding && (
        <div className="p-3 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-full flex items-center gap-2 rounded-lg border border-sidebar-border px-2 py-1.5 bg-sidebar-accent/30">
              <Building2 className="h-4 w-4 text-sidebar-foreground/70" />
              <Select value={selectedOperatorId} onValueChange={handleOperatorChange}>
                <SelectTrigger className="h-auto w-full border-0 bg-transparent px-0 py-0 shadow-none">
                  <SelectValue placeholder="Select operator" />
                </SelectTrigger>
                <SelectContent>
                  {operatorOptions.map((op) => (
                    <SelectItem key={op.id} value={op.id}>
                      {op.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="mt-2 text-xs text-sidebar-foreground/70">Current team: {currentTeam}</p>
        </div>
      )}

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = normalizedPathname === item.href
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
              <span className="font-medium">{item.label}</span>
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
                {navItems.find((item) => item.href === normalizedPathname)?.label || 'Employee Portal'}
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center">
                  2
                </span>
              </Button>
            </div>
          </div>
        </header>

        <main className="p-4 lg:p-6 pb-24 lg:pb-6">
          {children}
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border px-2 py-2 z-20">
        <div className="flex items-center justify-around">
          {navItems.map((item) => {
            const isActive = normalizedPathname === item.href
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
    </div>
  )
}
