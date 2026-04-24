"use client"

import { Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  LayoutDashboard,
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
  MoreHorizontal,
  Users,
  Car,
} from 'lucide-react'
import {
  ensureCleanlemonsEmployeeProfile,
  fetchCleanlemonPricingConfig,
  fetchEmployeeProfileByEmail,
  fetchOperatorScheduleJobs,
} from '@/lib/cleanlemon-api'
import {
  hasOperatorBindingsForPortal,
  listOperatorChoicesForEmployeeDropdown,
} from '@/lib/cleanlemons-portal-helpers'

type NavItem = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
}

/** Pathname is normalized (leading `/portal` stripped). `href` uses canonical `/employee/...` (rewritten to `app/portal/employee`). */
function employeeNavItemIsActive(normalizedPathname: string, href: string): boolean {
  const np = normalizedPathname || '/'
  const target = href.startsWith('/portal')
    ? href.replace(/^\/portal(?=\/|$)/, '') || '/'
    : href
  if (np === target) return true
  if (target !== '/' && np.startsWith(`${target}/`)) return true
  return false
}

const staffNavCore: NavItem[] = [
  { href: '/employee', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/employee/profile', label: 'Profile', icon: User },
  { href: '/employee/working', label: 'Working', icon: Clock },
  { href: '/employee/transport', label: 'Transport', icon: Car },
  { href: '/employee/agreement', label: 'Agreement', icon: FileSignature },
  { href: '/employee/linens', label: 'Linens', icon: Package2 },
]
const staffNavKpiItem: NavItem = { href: '/employee/kpi', label: 'KPI', icon: BarChart3 }

/** Dobi / Driver live under `/employee/*` (same page modules as legacy `/portal/dobi|driver`, which redirect here). */
const dobiPortalNav: NavItem = { href: '/employee/dobi', label: 'Dobi', icon: Shirt }
const driverPortalNav: NavItem = { href: '/employee/driver', label: 'Driver', icon: Truck }

function isProfileComplete(profile: Record<string, unknown> | null | undefined): boolean {
  if (!profile) return false
  const required = ['entityType', 'legalName', 'idType', 'idNumber', 'phone', 'address']
  return required.every((key) => String(profile[key] || '').trim() !== '')
}

/** When false: do not redirect to `/employee/profile?gate=required` or block other routes on incomplete profile. */
const EMPLOYEE_PROFILE_GATE_ENABLED = false

/** Mobile quick bar: staff = Dashboard + Transport + Working + Linens + Other; driver/dobi field = role home + Working + Other (both roles = Driver + Dobi + Working + Other). */
type EmployeeMobileBarVariant = 'staffFull' | 'fieldDriverOnly' | 'fieldDobiOnly' | 'fieldDriverAndDobi'

function resolveEmployeeMobileBarVariant(
  hasStaff: boolean,
  hasDriver: boolean,
  hasDobi: boolean
): EmployeeMobileBarVariant {
  if (hasStaff) return 'staffFull'
  if (hasDriver && hasDobi) return 'fieldDriverAndDobi'
  if (hasDriver) return 'fieldDriverOnly'
  if (hasDobi) return 'fieldDobiOnly'
  return 'staffFull'
}

function EmployeeQuickBar({
  normalizedPathname,
  sidebarOpen,
  setSidebarOpen,
  variant,
}: {
  normalizedPathname: string
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  variant: EmployeeMobileBarVariant
}) {
  const tab = useSearchParams().get('tab')
  const onEmployeeRoot = normalizedPathname === '/employee'
  const dashboardActive = onEmployeeRoot && tab !== 'schedule'
  const workingActive =
    normalizedPathname === '/employee/working' || normalizedPathname.startsWith('/employee/working/')
  const transportActive =
    normalizedPathname === '/employee/transport' || normalizedPathname.startsWith('/employee/transport/')
  const driverActive =
    employeeNavItemIsActive(normalizedPathname, '/employee/driver') ||
    normalizedPathname.startsWith('/employee/driver/')
  const dobiActive =
    employeeNavItemIsActive(normalizedPathname, '/employee/dobi') ||
    normalizedPathname.startsWith('/employee/dobi/')

  const tabBtn =
    'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 transition-colors'

  const dashboardLink = (
    <Link
      href="/employee"
      scroll={false}
      className={cn(
        tabBtn,
        dashboardActive ? 'bg-accent/50 text-primary' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <LayoutDashboard className={cn('h-5 w-5 shrink-0', dashboardActive && 'text-primary')} />
      <span className="max-w-full truncate text-center text-[10px] font-medium leading-tight">Dashboard</span>
    </Link>
  )

  const workingLink = (
    <Link
      href="/employee/working"
      scroll={false}
      className={cn(
        tabBtn,
        workingActive ? 'bg-accent/50 text-primary' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Clock className={cn('h-5 w-5 shrink-0', workingActive && 'text-primary')} />
      <span className="max-w-full truncate text-center text-[10px] font-medium leading-tight">Working</span>
    </Link>
  )

  const transportLink = (
    <Link
      href="/employee/transport"
      scroll={false}
      className={cn(
        tabBtn,
        transportActive ? 'bg-accent/50 text-primary' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Car className={cn('h-5 w-5 shrink-0', transportActive && 'text-primary')} />
      <span className="max-w-full truncate text-center text-[10px] font-medium leading-tight">Transport</span>
    </Link>
  )

  const linensLink = (
    <Link
      href="/employee/linens"
      scroll={false}
      className={cn(
        tabBtn,
        normalizedPathname === '/employee/linens' || normalizedPathname.startsWith('/employee/linens/')
          ? 'bg-accent/50 text-primary'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Package2
        className={cn(
          'h-5 w-5 shrink-0',
          (normalizedPathname === '/employee/linens' || normalizedPathname.startsWith('/employee/linens/')) &&
            'text-primary'
        )}
      />
      <span className="max-w-full truncate text-center text-[10px] font-medium leading-tight">Linens</span>
    </Link>
  )

  const driverLink = (
    <Link
      href="/employee/driver"
      scroll={false}
      className={cn(
        tabBtn,
        driverActive ? 'bg-accent/50 text-primary' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Truck className={cn('h-5 w-5 shrink-0', driverActive && 'text-primary')} />
      <span className="max-w-full truncate text-center text-[10px] font-medium leading-tight">Driver</span>
    </Link>
  )

  const dobiLink = (
    <Link
      href="/employee/dobi"
      scroll={false}
      className={cn(
        tabBtn,
        dobiActive ? 'bg-accent/50 text-primary' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Shirt className={cn('h-5 w-5 shrink-0', dobiActive && 'text-primary')} />
      <span className="max-w-full truncate text-center text-[10px] font-medium leading-tight">Dobi</span>
    </Link>
  )

  const otherButton = (
    <button
      type="button"
      onClick={() => setSidebarOpen(true)}
      className={cn(
        tabBtn,
        sidebarOpen ? 'bg-accent/50 text-primary' : 'text-muted-foreground hover:text-foreground'
      )}
      aria-expanded={sidebarOpen}
      aria-label="Open more navigation"
    >
      <MoreHorizontal className={cn('h-5 w-5 shrink-0', sidebarOpen && 'text-primary')} />
      <span className="max-w-full truncate text-center text-[10px] font-medium leading-tight">Other</span>
    </button>
  )

  return (
    <div className="flex max-w-full items-center justify-between gap-0.5 overflow-hidden">
      {variant === 'staffFull' ? (
        <>
          {dashboardLink}
          {transportLink}
          {workingLink}
          {linensLink}
          {otherButton}
        </>
      ) : null}
      {variant === 'fieldDriverOnly' ? (
        <>
          {driverLink}
          {workingLink}
          {otherButton}
        </>
      ) : null}
      {variant === 'fieldDobiOnly' ? (
        <>
          {dobiLink}
          {workingLink}
          {otherButton}
        </>
      ) : null}
      {variant === 'fieldDriverAndDobi' ? (
        <>
          {driverLink}
          {dobiLink}
          {workingLink}
          {otherButton}
        </>
      ) : null}
    </div>
  )
}

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
  const [checkingProfileGate, setCheckingProfileGate] = useState(EMPLOYEE_PROFILE_GATE_ENABLED)
  const [currentTeam, setCurrentTeam] = useState<string>('-')
  const [teamMembers, setTeamMembers] = useState<{ name: string; email: string }[]>([])
  const [showEmployeeKpiNav, setShowEmployeeKpiNav] = useState(false)

  const hasStaffBinding = hasOperatorBindingsForPortal(user?.cleanlemons, 'staff')
  const hasDriverBinding = hasOperatorBindingsForPortal(user?.cleanlemons, 'driver')
  const hasDobiBinding = hasOperatorBindingsForPortal(user?.cleanlemons, 'dobi')
  const hasAnyEmployeeBinding = hasStaffBinding || hasDriverBinding || hasDobiBinding

  const isEmployeeProfileRoute = useMemo(() => {
    const p = String(normalizedPathname || '')
    return p === '/employee/profile' || p.startsWith('/employee/profile/')
  }, [normalizedPathname])

  const operatorOptions = useMemo(
    () => listOperatorChoicesForEmployeeDropdown(user?.cleanlemons),
    [user?.cleanlemons]
  )

  /** Radix Select in sidebar sometimes does not render ItemText; show operator name explicitly. */
  const selectedOperatorDisplayName = useMemo(() => {
    const id = String(selectedOperatorId || '').trim()
    if (!id) return ''
    const hit = operatorOptions.find((o) => o.id === id)
    const name = hit?.name != null ? String(hit.name).trim() : ''
    return name || id
  }, [selectedOperatorId, operatorOptions])

  const navItems = useMemo(() => {
    const staffList: NavItem[] = showEmployeeKpiNav ? [...staffNavCore, staffNavKpiItem] : staffNavCore
    const base: NavItem[] = hasStaffBinding
      ? staffList
      : staffNavCore.filter((i) => i.href === '/employee/profile')
    const extra: NavItem[] = []
    if (hasDobiBinding) extra.push(dobiPortalNav)
    if (hasDriverBinding) extra.push(driverPortalNav)
    return [...base, ...extra]
  }, [hasStaffBinding, hasDobiBinding, hasDriverBinding, showEmployeeKpiNav])

  useEffect(() => {
    if (!hasStaffBinding) {
      setShowEmployeeKpiNav(false)
      return
    }
    const op = String(selectedOperatorId || '').trim()
    if (!op) {
      setShowEmployeeKpiNav(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetchCleanlemonPricingConfig(op)
        if (cancelled) return
        const ek =
          r?.ok && r.config?.employeeCleanerKpi && typeof r.config.employeeCleanerKpi === 'object'
            ? r.config.employeeCleanerKpi
            : {}
        const cards = Array.isArray((ek as { goalCards?: unknown }).goalCards)
          ? (ek as { goalCards: Array<{ status?: string }> }).goalCards
          : []
        const active = cards.filter((g) => String(g?.status || '') !== 'archived')
        setShowEmployeeKpiNav(active.length > 0)
      } catch {
        if (!cancelled) setShowEmployeeKpiNav(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasStaffBinding, selectedOperatorId])

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
    let cancelled = false
    if (!sessionReady) return
    if (!EMPLOYEE_PROFILE_GATE_ENABLED) {
      setCheckingProfileGate(false)
      return
    }
    if (!hasAnyEmployeeBinding) {
      setCheckingProfileGate(false)
      return
    }
    const email = String(user?.email || '').trim()
    if (!email) {
      setCheckingProfileGate(false)
      return
    }
    ;(async () => {
      try {
        const res = await fetchEmployeeProfileByEmail(email)
        if (cancelled) return
        const profile = (res?.profile || {}) as Record<string, unknown>
        const complete = !!(res?.ok && isProfileComplete(profile))
        if (!complete && !isEmployeeProfileRoute) {
          router.replace('/employee/profile?gate=required')
        }
      } finally {
        if (!cancelled) setCheckingProfileGate(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionReady, hasAnyEmployeeBinding, user?.email, isEmployeeProfileRoute, router])

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
      setTeamMembers([])
      return
    }
    let cancelled = false
    ;(async () => {
      const op = String(selectedOperatorId || '').trim()
      const r = await fetchOperatorScheduleJobs({
        operatorId: op || undefined,
        limit: 800,
      })
      if (cancelled) return
      const jobs = Array.isArray(r?.items) ? r.items : []
      const keys = new Set<string>()
      const email = String(user?.email || '').trim().toLowerCase()
      const name = String(user?.name || '').trim().toLowerCase()
      const id = String(user?.id || '').trim().toLowerCase()
      if (email) keys.add(email)
      if (email.includes('@')) keys.add(email.split('@')[0] || '')
      if (name) keys.add(name)
      if (id) keys.add(id)
      if (keys.size === 0) {
        setCurrentTeam('-')
        setTeamMembers([])
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
        setTeamMembers([])
        return
      }
      const picked = Array.from(teamCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
      setCurrentTeam(picked)

      const byKey = new Map<string, { name: string; email: string }>()
      for (const job of jobs) {
        const team = String(job?.teamName || job?.team || '').trim() || 'Unassigned'
        if (team !== picked) continue
        const emailRaw = String(job?.staffEmail || '').trim()
        const nameRaw = String(job?.staffName || job?.cleanerName || '').trim()
        if (emailRaw.includes('@')) {
          const k = emailRaw.toLowerCase()
          if (!byKey.has(k)) {
            byKey.set(k, {
              name: nameRaw || emailRaw.split('@')[0] || emailRaw,
              email: emailRaw,
            })
          }
        } else if (nameRaw) {
          const k = `name:${nameRaw.toLowerCase()}`
          if (!byKey.has(k)) {
            byKey.set(k, { name: nameRaw, email: '—' })
          }
        }
      }
      setTeamMembers(
        Array.from(byKey.values()).sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        ),
      )
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
                <SelectTrigger className="h-auto w-full min-w-0 border-0 bg-transparent px-0 py-0 text-left font-medium text-sidebar-foreground shadow-none [&_svg]:text-sidebar-foreground/70">
                  <SelectValue placeholder="Select operator">
                    {selectedOperatorDisplayName ? (
                      <span className="block min-w-0 truncate">{selectedOperatorDisplayName}</span>
                    ) : null}
                  </SelectValue>
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
          const isActive = employeeNavItemIsActive(normalizedPathname || '', item.href)
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

  if (checkingProfileGate && hasAnyEmployeeBinding && !isEmployeeProfileRoute) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen max-w-[100vw] overflow-x-hidden bg-background">
      <aside className="hidden lg:flex w-64 bg-sidebar border-r border-sidebar-border flex-col fixed h-full">
        <NavContent />
      </aside>

      <div className="min-w-0 flex-1 lg:ml-64">
        <header className="sticky top-0 z-20 bg-card border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="lg:hidden">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 p-0 bg-sidebar">
                  <SheetTitle className="sr-only">Menu</SheetTitle>
                  <NavContent />
                </SheetContent>
              </Sheet>

              <h1 className="truncate text-lg font-semibold text-foreground">
                {normalizedPathname === '/employee'
                  ? 'Dashboard'
                  : navItems.find((item) => item.href === normalizedPathname)?.label || 'Employee Portal'}
              </h1>
            </div>

            <div className="flex min-w-0 items-center gap-2">
              {hasStaffBinding ? (
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex max-w-[min(11rem,42vw)] shrink items-center gap-1.5 truncate rounded-md border border-border bg-muted/50 px-2 py-1 text-left text-xs font-medium text-foreground hover:bg-muted"
                    >
                      <Users className="h-3.5 w-3.5 shrink-0 opacity-80" />
                      <span className="min-w-0 truncate">
                        <span className="text-muted-foreground">Team</span>
                        {currentTeam !== '-' ? (
                          <span className="text-foreground"> · {currentTeam}</span>
                        ) : null}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end" className="max-w-sm">
                    <p className="mb-2 font-semibold text-zinc-50">
                      {currentTeam !== '-' ? currentTeam : 'Team'}
                    </p>
                    {teamMembers.length > 0 ? (
                      <ul className="space-y-1.5 text-zinc-200">
                        {teamMembers.map((m) => (
                          <li key={`${m.email}:${m.name}`}>
                            <span className="font-medium">{m.name}</span>
                            <span className="text-zinc-400"> · </span>
                            <span>{m.email}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-zinc-400">
                        {currentTeam !== '-'
                          ? 'No teammate names or emails found on schedule rows for this team yet.'
                          : 'Could not infer your team from schedule yet — check back after jobs are assigned.'}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <Button variant="ghost" size="icon" className="relative shrink-0">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                  2
                </span>
              </Button>
            </div>
          </div>
        </header>

        <main className="min-w-0 max-w-full overflow-x-hidden p-4 pb-[calc(6.75rem+env(safe-area-inset-bottom,0px))] lg:p-6 lg:pb-6">
          {children}
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-card px-1 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]">
        {hasStaffBinding || hasDriverBinding || hasDobiBinding ? (
          <Suspense
            fallback={
              <div className="flex h-11 items-center justify-center text-[10px] text-muted-foreground">Loading…</div>
            }
          >
            <EmployeeQuickBar
              variant={resolveEmployeeMobileBarVariant(
                hasStaffBinding,
                hasDriverBinding,
                hasDobiBinding
              )}
              normalizedPathname={normalizedPathname || ''}
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
            />
          </Suspense>
        ) : (
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
        )}
      </nav>
    </div>
  )
}
