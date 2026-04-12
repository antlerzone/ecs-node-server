"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
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
  Megaphone,
} from 'lucide-react'

type NavItem = {
  href: string
  label: string
  icon: typeof LayoutDashboard
  badge?: string
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
      { href: '/operator/approval', label: 'Approvals', icon: CheckSquare },
      { href: '/operator/team', label: 'Teams', icon: UserCog },
      { href: '/operator/property', label: 'Properties', icon: Building2 },
      { href: '/operator/smart-door', label: 'Smart Door', icon: Lock },
      { href: '/operator/schedule', label: 'Schedule', icon: Calendar },
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

function navItemIsActive(item: NavItem, normalizedPathname: string): boolean {
  return normalizedPathname === item.href.split('?')[0]
}

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
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-sidebar-primary flex items-center justify-center">
            <span className="text-sidebar-primary-foreground font-bold text-sm">CL</span>
          </div>
          <div>
            <span className="text-sidebar-foreground font-bold">Cleanlemons</span>
            <Badge variant="secondary" className="ml-2 text-xs bg-sidebar-accent text-sidebar-accent-foreground">Operator</Badge>
          </div>
        </div>
      </div>

      {/* Nav Items */}
      <ScrollArea className="flex-1">
        <nav className="p-3 space-y-4">
          {navSectionsVisible.map((section) => (
            <div key={section.title} className="space-y-1">
              <p className="px-3 text-[10px] uppercase tracking-wider text-sidebar-foreground/60">{section.title}</p>
              {section.items.map((item) => {
                const isActive = navItemIsActive(item, normalizedPathname || '')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="h-5 w-5" />
                      <span className="font-medium text-sm">{item.label}</span>
                    </div>
                    {item.badge && (
                      <Badge variant="outline" className="text-xs border-sidebar-border text-sidebar-foreground/70">
                        {item.badge}
                      </Badge>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* User Info */}
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
      <aside className="hidden lg:flex w-64 bg-sidebar border-r border-sidebar-border flex-col fixed h-full">
        <NavContent />
      </aside>

      {/* Main Content */}
      <div className="flex-1 lg:ml-64">
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
                <SheetContent side="left" className="w-64 p-0 bg-sidebar">
                  <NavContent />
                </SheetContent>
              </Sheet>
              
              <h1 className="text-lg font-semibold text-foreground">
                {flatNavItems.find((item) => navItemIsActive(item, normalizedPathname || ''))?.label ||
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
        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border px-2 py-2 z-20">
        <div className="flex items-center justify-around">
          {flatNavItems.slice(0, 5).map((item) => {
            const isActive = navItemIsActive(item, normalizedPathname || '')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-xs">{item.label.slice(0, 8)}</span>
              </Link>
            )
          })}
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
