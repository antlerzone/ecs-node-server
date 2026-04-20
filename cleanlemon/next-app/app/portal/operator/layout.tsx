"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import {
  fetchOperatorNotifications,
  readOperatorNotification,
  dismissOperatorNotification,
  fetchOperatorSubscription,
  fetchOperatorPortalSetupStatus,
  fetchOperatorSettings,
} from '@/lib/cleanlemon-api'
import { CLEANLEMONS_ACTIVE_OPERATOR_ID_KEY } from '@/lib/cleanlemon-portal-constants'
import { useEffectiveOperatorId } from '@/lib/cleanlemon-effective-operator-id'
import { isPortalOfflineDemo } from '@/lib/portal-auth-mock'
import { OperatorPortalRouteGate } from '@/components/operator-portal-route-gate'
import { planAllowsAccounting } from '@/lib/cleanlemon-subscription-plan'
import {
  LayoutDashboard,
  Users,
  Building2,
  Calendar,
  BarChart3,
  Wallet,
  FileText,
  Settings,
  LogOut,
  Menu,
  Bell,
  ChevronLeft,
  Briefcase,
  Target,
  UserCog,
  UserCircle,
  Receipt,
  Tags,
  Link2,
  Lock,
  CheckSquare,
  AlertTriangle,
  ChevronDown,
  Check,
  X,
  Clock,
  Truck,
  Megaphone,
  MoreHorizontal,
  Sparkles,
  UnfoldVertical,
  FoldVertical,
  Droplets,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: typeof LayoutDashboard
  badge?: string
  /** Mobile quick bar: elevated center button (client-style FAB). */
  prominent?: boolean
}

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { href: '/operator', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/operator/profile', label: 'Profile', icon: UserCircle },
      { href: '/operator/company', label: 'Company', icon: Briefcase },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/operator/contact', label: 'Contacts', icon: Users },
      { href: '/operator/approval', label: 'Booking requests', icon: CheckSquare },
      { href: '/operator/team', label: 'Teams', icon: UserCog },
      { href: '/operator/property', label: 'Properties', icon: Building2 },
      { href: '/operator/smart-door', label: 'Smart Door', icon: Lock },
      { href: '/operator/schedule', label: 'Schedule', icon: Calendar },
      { href: '/operator/trip', label: 'Driver routes', icon: Truck },
      { href: '/operator/dobi-settings', label: 'Dobi', icon: Droplets },
      { href: '/operator/damage', label: 'Damage', icon: AlertTriangle },
      { href: '/operator/agreement', label: 'Agreements', icon: FileText },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/operator/invoices', label: 'Invoices', icon: Receipt },
      { href: '/operator/pricing', label: 'Pricing', icon: Tags },
      { href: '/operator/calender', label: 'Calender', icon: Calendar },
      { href: '/operator/salary', label: 'Salary', icon: Wallet },
      { href: '/operator/accounting', label: 'Accounting', icon: Link2, badge: 'Growth+' },
    ],
  },
  {
    title: 'Performance',
    items: [
      { href: '/operator/kpi', label: 'KPI Reports', icon: BarChart3 },
      { href: '/operator/kpi-settings', label: 'KPI Settings', icon: Target },
    ],
  },
]

interface Notification {
  id: string
  title: string
  message: string
  time: string
  read: boolean
  type: 'info' | 'success' | 'warning' | 'error'
}

/** Match current route to nav href (dashboard exact; deeper paths for nested routes). */
function pathMatchesItem(normalizedPathname: string, href: string): boolean {
  const p = (normalizedPathname || '').split('?')[0].replace(/\/$/, '') || '/'
  const h = href.split('?')[0].replace(/\/$/, '') || '/'
  if (h === '/operator') return p === '/operator'
  return p === h || p.startsWith(`${h}/`)
}

/** Mobile bottom bar: highlight current section (Dashboard exact; others allow nested paths). */
function operatorMobileQuickItemActive(href: string, normalizedPathname: string): boolean {
  const path = (normalizedPathname || '').split('?')[0].replace(/\/$/, '') || '/'
  const h = href.split('?')[0].replace(/\/$/, '') || '/'
  if (h === '/operator') return path === '/operator'
  return path === h || path.startsWith(`${h}/`)
}

const OPERATOR_MOBILE_QUICK_NAV: NavItem[] = [
  { href: '/operator', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/operator/schedule', label: 'Schedule', icon: Calendar },
  { href: '/operator/schedule', label: 'Booking', icon: Sparkles, prominent: true },
  { href: '/operator/approval', label: 'Approval', icon: CheckSquare },
]

const OPERATOR_SETUP_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const OPERATOR_SETUP_STEPS = ['company', 'profile', 'pricing'] as const
type OperatorSetupStep = (typeof OPERATOR_SETUP_STEPS)[number]

const OPERATOR_SETUP_PATH: Record<OperatorSetupStep, string> = {
  company: '/operator/company',
  profile: '/operator/profile',
  pricing: '/operator/pricing',
}

function OperatorLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const normalizedPathname = pathname?.startsWith('/portal/')
    ? pathname.replace('/portal', '')
    : pathname
  const router = useRouter()
  const { user, logout, updateUser } = useAuth()
  const operatorId = useEffectiveOperatorId(user)
  const offlineDemo = isPortalOfflineDemo()
  const setupGateLoadedRef = useRef(false)
  const [setupGateBlocking, setSetupGateBlocking] = useState(false)
  const [setupFirstIncomplete, setSetupFirstIncomplete] = useState<OperatorSetupStep | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [accountingNavAllowed, setAccountingNavAllowed] = useState(false)
  const [publicMarketingSubdomain, setPublicMarketingSubdomain] = useState('')

  const isOperatorPricingPage = useMemo(() => {
    const p = (normalizedPathname || '').split('?')[0].replace(/\/$/, '') || '/'
    return p === '/operator/pricing'
  }, [normalizedPathname])

  useEffect(() => {
    let cancelled = false
    const oid = user?.operatorId
    if (!oid) {
      setAccountingNavAllowed(false)
      return () => {
        cancelled = true
      }
    }
    ;(async () => {
      const r = await fetchOperatorSubscription({
        operatorId: oid,
        email: String(user?.email || '')
          .trim()
          .toLowerCase(),
      })
      if (cancelled) return
      setAccountingNavAllowed(planAllowsAccounting(r?.item?.planCode))
    })()
    return () => {
      cancelled = true
    }
  }, [user?.operatorId, user?.email])

  const navSectionsVisible = useMemo(() => {
    if (accountingNavAllowed) return navSections
    return navSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.href !== '/operator/accounting'),
      }))
      .filter((section) => section.items.length > 0)
  }, [accountingNavAllowed])

  const flatNavItems = useMemo(
    () => navSectionsVisible.flatMap((section) => section.items),
    [navSectionsVisible]
  )

  /** Section expand/collapse; omitted key → open section that contains current page */
  const [groupOpenOverride, setGroupOpenOverride] = useState<Record<string, boolean>>({})

  const activeGroupLabel = useMemo(() => {
    const path = normalizedPathname || ''
    for (const section of navSectionsVisible) {
      for (const item of section.items) {
        if (pathMatchesItem(path, item.href)) return section.title
      }
    }
    return null
  }, [navSectionsVisible, normalizedPathname])

  useEffect(() => {
    if (!activeGroupLabel) return
    setGroupOpenOverride((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, activeGroupLabel)) return prev
      const next = { ...prev }
      delete next[activeGroupLabel]
      return next
    })
  }, [normalizedPathname, activeGroupLabel])

  function isGroupExpanded(label: string): boolean {
    if (Object.prototype.hasOwnProperty.call(groupOpenOverride, label)) {
      return groupOpenOverride[label]
    }
    return label === activeGroupLabel
  }

  function toggleGroup(label: string) {
    setGroupOpenOverride((prev) => {
      const expanded = Object.prototype.hasOwnProperty.call(prev, label)
        ? prev[label]
        : label === activeGroupLabel
      return { ...prev, [label]: !expanded }
    })
  }

  const allGroupsExpanded = useMemo(() => {
    if (navSectionsVisible.length === 0) return false
    return navSectionsVisible.every((g) => {
      if (Object.prototype.hasOwnProperty.call(groupOpenOverride, g.title)) {
        return groupOpenOverride[g.title]
      }
      return g.title === activeGroupLabel
    })
  }, [navSectionsVisible, groupOpenOverride, activeGroupLabel])

  function expandAllSubmenus() {
    setGroupOpenOverride(() => {
      const next: Record<string, boolean> = {}
      for (const g of navSectionsVisible) next[g.title] = true
      return next
    })
  }

  function collapseAllSubmenus() {
    setGroupOpenOverride(() => {
      const next: Record<string, boolean> = {}
      for (const g of navSectionsVisible) next[g.title] = false
      return next
    })
  }

  function toggleExpandCollapseAll() {
    if (allGroupsExpanded) collapseAllSubmenus()
    else expandAllSubmenus()
  }

  useEffect(() => {
    let cancelled = false
    const oid = String(user?.operatorId || '').trim()
    if (!oid) {
      setNotifications([])
      return () => {
        cancelled = true
      }
    }
    ;(async () => {
      const r = await fetchOperatorNotifications(oid)
      if (cancelled || !r?.ok) return
      const items: Notification[] = (r.items || []).map((n: any) => ({
        id: String(n.id),
        title: String(n.title || 'Notification'),
        message: String(n.message || ''),
        time: n.createdAt ? new Date(n.createdAt).toLocaleString('en-MY') : '-',
        read: Boolean(n.isRead),
        type: (n.type || 'info'),
      }))
      setNotifications(items)
    })()
    return () => {
      cancelled = true
    }
  }, [user?.operatorId])

  useEffect(() => {
    if (!isOperatorPricingPage || !operatorId) {
      setPublicMarketingSubdomain('')
      return
    }
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorSettings(String(operatorId))
      if (cancelled || !r?.ok) return
      setPublicMarketingSubdomain(String(r.settings?.publicSubdomain || '').trim().toLowerCase())
    })()
    return () => {
      cancelled = true
    }
  }, [isOperatorPricingPage, operatorId])

  const userEmailNorm = useMemo(
    () => String(user?.email || '').trim().toLowerCase(),
    [user?.email]
  )

  useEffect(() => {
    setupGateLoadedRef.current = false
  }, [operatorId, userEmailNorm])

  useEffect(() => {
    if (offlineDemo || !user) {
      setSetupGateBlocking(false)
      setSetupFirstIncomplete(null)
      return
    }
    if (!userEmailNorm || !OPERATOR_SETUP_UUID_RE.test(String(operatorId || '').trim())) {
      setSetupGateBlocking(false)
      setSetupFirstIncomplete(null)
      return
    }
    let cancelled = false
    const blocking = !setupGateLoadedRef.current
    if (blocking) setSetupGateBlocking(true)
    ;(async () => {
      const r = await fetchOperatorPortalSetupStatus({
        operatorId: String(operatorId || '').trim(),
        email: userEmailNorm,
      })
      if (cancelled) return
      setupGateLoadedRef.current = true
      setSetupGateBlocking(false)
      if (!r.ok) {
        setSetupFirstIncomplete(null)
        return
      }
      const first = r.firstIncomplete
      if (first === 'company' || first === 'profile' || first === 'pricing') {
        setSetupFirstIncomplete(first)
      } else {
        setSetupFirstIncomplete(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [offlineDemo, user, operatorId, userEmailNorm, normalizedPathname])

  useEffect(() => {
    if (setupGateBlocking) return
    if (setupFirstIncomplete == null) return
    const raw = (normalizedPathname || '').split('?')[0]
    const pathOnly = raw.replace(/\/$/, '') || '/'
    const idx = OPERATOR_SETUP_STEPS.indexOf(setupFirstIncomplete)
    if (idx < 0) return
    const allowed = new Set(
      OPERATOR_SETUP_STEPS.slice(0, idx + 1).map((s) => OPERATOR_SETUP_PATH[s])
    )
    if (allowed.has(pathOnly)) return
    router.replace(OPERATOR_SETUP_PATH[setupFirstIncomplete])
  }, [setupGateBlocking, setupFirstIncomplete, normalizedPathname, router])

  const unreadCount = notifications.filter(n => !n.read).length

  const handleLogout = () => {
    logout()
    router.push('/')
  }

  const handleMarkAsRead = (id: string) => {
    void readOperatorNotification(id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    toast.success('All notifications marked as read')
  }

  const handleDismiss = (id: string) => {
    void dismissOperatorNotification(id)
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  const setupGateApplies =
    !offlineDemo &&
    !!user &&
    !!userEmailNorm &&
    OPERATOR_SETUP_UUID_RE.test(String(operatorId || '').trim())

  if (setupGateApplies && setupGateBlocking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    )
  }

  const NavContent = () => (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* Logo */}
      <div className="shrink-0 border-b border-sidebar-border p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sidebar-primary">
            <span className="text-sm font-bold text-sidebar-primary-foreground">CL</span>
          </div>
          <div className="min-w-0">
            <span className="font-bold text-sidebar-foreground">Cleanlemons</span>
            <Badge variant="secondary" className="ml-2 bg-sidebar-accent text-xs text-sidebar-accent-foreground">
              Operator
            </Badge>
          </div>
        </div>
      </div>

      {/* Nav — scrollable on mobile (native overflow; min-h-0 + flex chain) */}
      <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-gutter:stable]">
        <button
          type="button"
          onClick={toggleExpandCollapseAll}
          className="flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/30 px-3 py-2 text-xs font-semibold text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-expanded={allGroupsExpanded}
          aria-label={allGroupsExpanded ? 'Collapse all sections' : 'Expand all sections'}
        >
          {allGroupsExpanded ? (
            <FoldVertical className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <UnfoldVertical className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          {allGroupsExpanded ? 'Collapse all' : 'Expand all'}
        </button>
        {navSectionsVisible.map((section) => {
          const expanded = isGroupExpanded(section.title)
          const sectionActive = section.title === activeGroupLabel
          const sectionId = `operator-nav-${section.title.replace(/\s+/g, '-')}`
          return (
            <div
              key={section.title}
              className="shrink-0 overflow-hidden rounded-xl border border-sidebar-border/60 bg-sidebar-accent/20"
            >
              <button
                type="button"
                onClick={() => toggleGroup(section.title)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors',
                  sectionActive ? 'bg-sidebar-accent/80' : 'hover:bg-sidebar-accent/50'
                )}
                aria-expanded={expanded}
                aria-controls={sectionId}
              >
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-sidebar-foreground/60 transition-transform duration-200',
                    expanded ? 'rotate-0' : '-rotate-90'
                  )}
                  aria-hidden
                />
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-foreground/70">
                  {section.title}
                </span>
                <span className="ml-auto tabular-nums text-[10px] text-sidebar-foreground/50">{section.items.length}</span>
              </button>
              <div
                id={sectionId}
                className={cn(
                  'grid transition-[grid-template-rows] duration-200 ease-out',
                  expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                )}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="flex flex-col gap-0.5 px-2 pb-2 pt-0">
                    {section.items.map((item) => {
                      const isActive = pathMatchesItem(normalizedPathname || '', item.href)
                      return (
                        <Link
                          key={`${section.title}-${item.href}`}
                          href={item.href}
                          onClick={() => setSidebarOpen(false)}
                          className={cn(
                            'flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                              : 'text-sidebar-foreground hover:bg-sidebar-accent'
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <item.icon className="h-5 w-5 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </div>
                          {item.badge ? (
                            <Badge
                              variant="outline"
                              className="shrink-0 border-sidebar-border text-xs text-sidebar-foreground/70"
                            >
                              {item.badge}
                            </Badge>
                          ) : null}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      {/* User Info */}
      <div className="shrink-0 border-t border-sidebar-border p-4">
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
        {(() => {
          const choices = user?.cleanlemons?.operatorChoices ?? []
          const currentId = user?.operatorId || ''
          const currentLabel =
            choices.find((c) => c.operatorId === currentId)?.operatorName ||
            currentId ||
            '—'
          if (choices.length > 1) {
            return (
              <div className="mb-3">
                <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60 mb-1.5">Company</p>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-between text-xs h-9 border-sidebar-border bg-sidebar-accent/30 text-sidebar-foreground"
                    >
                      <span className="truncate text-left">{currentLabel}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="start">
                    <div className="p-1 max-h-64 overflow-y-auto">
                      {choices.map((c) => (
                        <button
                          key={c.operatorId}
                          type="button"
                          className={`w-full text-left rounded-md px-2 py-2 text-sm hover:bg-accent ${
                            c.operatorId === currentId ? 'bg-accent' : ''
                          }`}
                          onClick={() => {
                            updateUser({ operatorId: c.operatorId })
                            try {
                              localStorage.setItem(CLEANLEMONS_ACTIVE_OPERATOR_ID_KEY, c.operatorId)
                            } catch {
                              /* ignore */
                            }
                            toast.success(`Switched to ${c.operatorName}`)
                          }}
                        >
                          <span className="font-medium block truncate">{c.operatorName}</span>
                          <span className="text-[10px] text-muted-foreground capitalize">
                            {c.sources.join(' · ')}
                          </span>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )
          }
          if (choices.length === 1) {
            return (
              <div className="mb-3">
                <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60 mb-1">Company</p>
                <p className="text-xs text-sidebar-foreground truncate font-medium">{choices[0].operatorName}</p>
              </div>
            )
          }
          return null
        })()}
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

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <aside className="fixed hidden h-full min-h-0 w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <NavContent />
      </aside>

      {/* Main Content — min-w-0 so wide pages (e.g. Company) don’t overflow the viewport */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:ml-64">
        {/* Top Header */}
        <header className="sticky top-0 z-20 bg-card border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Mobile Menu */}
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="lg:hidden">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="flex h-full min-h-0 w-64 flex-col gap-0 overflow-hidden bg-sidebar p-0"
                >
                  <SheetTitle className="sr-only">Operator navigation menu</SheetTitle>
                  <NavContent />
                </SheetContent>
              </Sheet>
              
              <h1 className="text-lg font-semibold text-foreground">
                {flatNavItems.find((item) => pathMatchesItem(normalizedPathname || '', item.href))?.label ||
                  'Operator Portal'}
              </h1>
            </div>

            <div className="flex items-center gap-2">
              {isOperatorPricingPage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs shrink-0"
                  onClick={() => {
                    if (!publicMarketingSubdomain) {
                      toast.error('Set your subdomain on Company → Profile (Subdomain field)')
                      return
                    }
                    window.open(`/${publicMarketingSubdomain}`, '_blank', 'noopener,noreferrer')
                  }}
                >
                  <Megaphone className="h-4 w-4 mr-1" />
                  Marketing
                </Button>
              ) : null}
              {/* Notifications */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center">
                        {unreadCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="p-3 border-b flex items-center justify-between">
                    <h4 className="font-semibold">Notifications</h4>
                    {unreadCount > 0 && (
                      <Button variant="ghost" size="sm" onClick={handleMarkAllRead}>
                        Mark all read
                      </Button>
                    )}
                  </div>
                  <ScrollArea className="h-80">
                    {notifications.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        No notifications
                      </div>
                    ) : (
                      <div className="divide-y">
                        {notifications.map((notification) => (
                          <div
                            key={notification.id}
                            className={`p-3 hover:bg-muted/50 transition-colors ${!notification.read ? 'bg-primary/5' : ''}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`w-2 h-2 rounded-full mt-2 ${
                                notification.type === 'success' ? 'bg-green-500' :
                                notification.type === 'warning' ? 'bg-yellow-500' :
                                notification.type === 'error' ? 'bg-red-500' :
                                'bg-blue-500'
                              }`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{notification.title}</p>
                                <p className="text-xs text-muted-foreground truncate">{notification.message}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">{notification.time}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                {!notification.read && (
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMarkAsRead(notification.id)}>
                                    <Check className="h-3 w-3" />
                                  </Button>
                                )}
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDismiss(notification.id)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              <Button variant="ghost" size="icon" onClick={() => router.push('/operator/company')}>
                <Settings className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="min-w-0 p-4 lg:p-6">
          {children}
        </main>
      </div>

      {/* Mobile quick bar: Dashboard, Schedule, Booking (prominent), Approval, More */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-card pb-[env(safe-area-inset-bottom,0px)]">
        <div className="flex items-end justify-around gap-0.5 px-1 pb-2 pt-1">
          {OPERATOR_MOBILE_QUICK_NAV.map((item) => {
            const isActive = operatorMobileQuickItemActive(item.href, normalizedPathname || '')
            const quickKey = `${item.href}:${item.label}${item.prominent ? ':fab' : ''}`
            if (item.prominent) {
              return (
                <div key={quickKey} className="flex min-w-0 flex-1 flex-col items-center">
                  <Link
                    href={item.href}
                    className={cn(
                      'relative z-10 -mt-4 flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full shadow-lg ring-4 ring-card transition-transform active:scale-95',
                      isActive
                        ? 'bg-primary text-primary-foreground ring-primary/25'
                        : 'bg-primary text-primary-foreground hover:brightness-110'
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <item.icon className="h-6 w-6" strokeWidth={2} />
                  </Link>
                  <span
                    className={cn(
                      'mt-1 max-w-[4.5rem] truncate text-center text-[10px] font-semibold leading-tight',
                      isActive ? 'text-primary' : 'text-muted-foreground'
                    )}
                  >
                    {item.label}
                  </span>
                </div>
              )
            }
            return (
              <Link
                key={quickKey}
                href={item.href}
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="max-w-full truncate text-center text-[10px] font-medium leading-tight">
                  {item.label}
                </span>
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors text-muted-foreground hover:text-foreground'
            )}
          >
            <MoreHorizontal className="h-5 w-5 shrink-0" />
            <span className="max-w-full truncate text-center text-[10px] font-medium leading-tight">More</span>
          </button>
        </div>
      </nav>

      <Toaster />
    </div>
  )
}

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <OperatorPortalRouteGate>
      <OperatorLayoutInner>{children}</OperatorLayoutInner>
    </OperatorPortalRouteGate>
  )
}
