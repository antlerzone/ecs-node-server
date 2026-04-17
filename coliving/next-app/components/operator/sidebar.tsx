"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Building2, DoorOpen, Users,
  BookOpen, Receipt, BarChart3, Settings, LogOut, X,
  Zap, Lock, FileText, TrendingDown, Mail, CheckCircle, ClipboardList, User, Banknote, LayoutDashboard,
  ChevronDown,
  Percent,
  PanelLeftClose,
  PanelLeftOpen,
  UnfoldVertical,
  FoldVertical,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useEffect, useMemo, useState } from "react"
import { useOperatorContext } from "@/contexts/operator-context"
import { hasPermissionForPath, type StaffPermissionKey } from "@/lib/operator-permissions"
import { isDemoSite } from "@/lib/portal-api"

type NavItem = { href: string; label: string; icon: typeof Settings; permission: StaffPermissionKey | "" }

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/operator", label: "Dashboard", icon: LayoutDashboard, permission: "" },
      { href: "/operator/profile", label: "My Profile", icon: User, permission: "profilesetting" },
    ],
  },
  {
    label: "Property Setup",
    items: [
      { href: "/operator/company", label: "Company Settings", icon: Settings, permission: "profilesetting" },
      { href: "/operator/property", label: "Property Settings", icon: Building2, permission: "propertylisting" },
      { href: "/operator/room", label: "Room Settings", icon: DoorOpen, permission: "marketing" },
      { href: "/operator/meter", label: "Meter Setting", icon: Zap, permission: "propertylisting" },
      { href: "/operator/smart-door", label: "Smart Door", icon: Lock, permission: "propertylisting" },
    ],
  },
  {
    label: "Tenancy",
    items: [
      { href: "/operator/agreement-setting", label: "Agreement Setting", icon: FileText, permission: "propertylisting" },
      { href: "/operator/agreements", label: "Agreements", icon: FileText, permission: "propertylisting" },
      { href: "/operator/tenancy", label: "Tenancy Setting", icon: Users, permission: "tenantdetail" },
      { href: "/operator/booking", label: "Booking", icon: ClipboardList, permission: "booking" },
      { href: "/operator/approval", label: "Approval", icon: CheckCircle, permission: "tenantdetail" },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/operator/invoice", label: "Tenant Invoice", icon: Receipt, permission: "finance" },
      { href: "/operator/commission", label: "Commission", icon: Percent, permission: "finance" },
      { href: "/operator/expenses", label: "Expenses", icon: TrendingDown, permission: "finance" },
      { href: "/operator/refund", label: "Deposit Refund", icon: Banknote, permission: "finance" },
      { href: "/operator/accounting", label: "Accounting", icon: BookOpen, permission: "integration" },
      { href: "/operator/report", label: "Generate Report", icon: BarChart3, permission: "finance" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/operator/billing", label: "Billing & Plan", icon: Receipt, permission: "" },
      { href: "/operator/credit", label: "Credit Log", icon: Zap, permission: "finance" },
      { href: "/operator/terms", label: "Terms & Conditions", icon: FileText, permission: "" },
      { href: "/operator/contact", label: "Contact Settings", icon: Mail, permission: "tenantdetail" },
    ],
  },
]

interface OperatorSidebarProps {
  mobileOpen: boolean
  onMobileClose: () => void
}

const OPERATOR_SIDEBAR_COLLAPSED_KEY = "operator-sidebar-desktop-collapsed"

function pathMatchesItem(pathname: string, href: string): boolean {
  if (href === "/operator") return pathname === "/operator"
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function OperatorSidebar({ mobileOpen, onMobileClose }: OperatorSidebarProps) {
  const pathname = usePathname()
  const { permission, hasAccountingCapability, feedbackPendingCount = 0, paymentVerificationPendingCount = 0 } = useOperatorContext()
  const approvalBadgeCount = feedbackPendingCount + paymentVerificationPendingCount
  const canShowAccounting = hasAccountingCapability || isDemoSite()
  /** Explicit expand/collapse overrides; omitted key → derive from active section */
  const [groupOpenOverride, setGroupOpenOverride] = useState<Record<string, boolean>>({})
  const [desktopPanelHidden, setDesktopPanelHidden] = useState(false)

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && localStorage.getItem(OPERATOR_SIDEBAR_COLLAPSED_KEY) === "1") {
        setDesktopPanelHidden(true)
      }
    } catch {
      /* ignore */
    }
  }, [])

  function setDesktopPanelHiddenPersist(next: boolean) {
    setDesktopPanelHidden(next)
    try {
      localStorage.setItem(OPERATOR_SIDEBAR_COLLAPSED_KEY, next ? "1" : "0")
    } catch {
      /* ignore */
    }
  }

  // Close sidebar on route change (mobile)
  useEffect(() => {
    onMobileClose()
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredGroups = navGroups.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => item.permission === "" || hasPermissionForPath(permission, item.href))
      .filter((item) => item.href !== "/operator/accounting" || canShowAccounting),
  })).filter((g) => g.items.length > 0)

  const activeGroupLabel = useMemo(() => {
    for (const group of filteredGroups) {
      for (const item of group.items) {
        if (pathMatchesItem(pathname, item.href)) return group.label
      }
    }
    return null
  }, [filteredGroups, pathname])

  // After navigation, expand the section that contains the current page (drop stale collapse override).
  useEffect(() => {
    if (!activeGroupLabel) return
    setGroupOpenOverride((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, activeGroupLabel)) return prev
      const next = { ...prev }
      delete next[activeGroupLabel]
      return next
    })
  }, [pathname, activeGroupLabel])

  function isGroupExpanded(label: string): boolean {
    if (Object.prototype.hasOwnProperty.call(groupOpenOverride, label)) {
      return groupOpenOverride[label]
    }
    return label === activeGroupLabel
  }

  function toggleGroup(label: string) {
    setGroupOpenOverride((prev) => ({
      ...prev,
      [label]: !isGroupExpanded(label),
    }))
  }

  const allGroupsExpanded = useMemo(() => {
    if (filteredGroups.length === 0) return false
    return filteredGroups.every((g) => {
      if (Object.prototype.hasOwnProperty.call(groupOpenOverride, g.label)) {
        return groupOpenOverride[g.label]
      }
      return g.label === activeGroupLabel
    })
  }, [filteredGroups, groupOpenOverride, activeGroupLabel])

  function expandAllSubmenus() {
    setGroupOpenOverride(() => {
      const next: Record<string, boolean> = {}
      for (const g of filteredGroups) next[g.label] = true
      return next
    })
  }

  function collapseAllSubmenus() {
    setGroupOpenOverride(() => {
      const next: Record<string, boolean> = {}
      for (const g of filteredGroups) next[g.label] = false
      return next
    })
  }

  function toggleExpandCollapseAll() {
    if (allGroupsExpanded) collapseAllSubmenus()
    else expandAllSubmenus()
  }

  const sidebarContent = (
    <aside className="flex min-h-0 w-64 flex-1 flex-shrink-0 flex-col overflow-hidden bg-card border-r border-border">
      <div className="shrink-0 px-6 py-6 border-b border-border flex items-center justify-between gap-2">
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-base font-black tracking-widest uppercase text-primary">Coliving</span>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
          <span className="text-[9px] tracking-[0.25em] text-muted-foreground/60 uppercase mt-0.5">Operator Portal</span>
        </div>
        <div className="flex items-center flex-shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setDesktopPanelHiddenPersist(true)}
            className="hidden lg:flex p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Hide sidebar"
            title="Hide sidebar"
          >
            <PanelLeftClose size={18} />
          </button>
          {/* Close button — only visible on mobile */}
          <button
            type="button"
            onClick={onMobileClose}
            className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <nav className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-scroll overscroll-contain px-4 py-4 [scrollbar-gutter:stable]">
        <button
          type="button"
          onClick={toggleExpandCollapseAll}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/80 bg-background/80 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors shrink-0"
          aria-expanded={allGroupsExpanded}
          aria-label={allGroupsExpanded ? "Collapse all sections" : "Expand all sections"}
        >
          {allGroupsExpanded ? (
            <FoldVertical size={14} className="shrink-0" aria-hidden />
          ) : (
            <UnfoldVertical size={14} className="shrink-0" aria-hidden />
          )}
          {allGroupsExpanded ? "Collapse all" : "Expand all"}
        </button>
        {filteredGroups.map((group) => {
          const expanded = isGroupExpanded(group.label)
          const sectionActive = group.label === activeGroupLabel
          return (
            <div
              key={group.label}
              className="shrink-0 rounded-xl border border-border/60 bg-secondary/20 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors",
                  sectionActive ? "bg-secondary/80" : "hover:bg-secondary/50"
                )}
                aria-expanded={expanded}
                aria-controls={`operator-nav-${group.label.replace(/\s+/g, "-")}`}
              >
                <ChevronDown
                  size={16}
                  className={cn(
                    "flex-shrink-0 text-muted-foreground transition-transform duration-200",
                    expanded ? "rotate-0" : "-rotate-90"
                  )}
                  aria-hidden
                />
                <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground">
                  {group.label}
                </span>
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/70">{group.items.length}</span>
              </button>
              <div
                id={`operator-nav-${group.label.replace(/\s+/g, "-")}`}
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                )}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="flex flex-col gap-0.5 px-2 pb-2 pt-0">
                    {group.items.map((item) => {
                      const isActive = pathMatchesItem(pathname, item.href)
                      const badgeCount = item.href === "/operator/approval" ? approvalBadgeCount : 0
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                            isActive ? "text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                          )}
                          style={isActive ? { background: "var(--brand)" } : undefined}
                        >
                          <item.icon size={17} />
                          <span className="flex-1 truncate">{item.label}</span>
                          {badgeCount > 0 && (
                            <span
                              className={cn(
                                "flex-shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-bold flex items-center justify-center",
                                isActive ? "bg-white/20 text-white" : "bg-destructive text-destructive-foreground"
                              )}
                            >
                              {badgeCount > 99 ? "99+" : badgeCount}
                            </span>
                          )}
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

      <div className="px-4 py-4 border-t border-border shrink-0 bg-card">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ background: "var(--brand)" }}>
            AD
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-foreground truncate">Admin User</div>
            <div className="text-xs text-muted-foreground truncate">Operator</div>
          </div>
          <Link href="/portal" className="text-muted-foreground hover:text-foreground transition-colors">
            <LogOut size={16} />
          </Link>
        </div>
      </div>
    </aside>
  )

  return (
    <>
      {/* Desktop: full sidebar or hidden — expand control when hidden */}
      {!desktopPanelHidden ? (
        <div className="sticky top-0 z-30 hidden h-screen max-h-screen min-h-0 w-64 flex-shrink-0 flex-col lg:flex lg:self-start">
          {sidebarContent}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDesktopPanelHiddenPersist(false)}
          className="hidden lg:flex fixed left-0 top-1/2 -translate-y-1/2 z-40 h-14 w-10 items-center justify-center rounded-r-xl border border-l-0 border-border bg-card text-muted-foreground shadow-md hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Show sidebar"
          title="Show sidebar"
        >
          <PanelLeftOpen size={20} />
        </button>
      )}

      {/* Mobile: slide-in drawer with backdrop */}
      <div
        className={cn(
          "lg:hidden fixed inset-0 z-50 flex transition-all duration-300",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
      >
        {/* Backdrop */}
        <div
          onClick={onMobileClose}
          className={cn(
            "absolute inset-0 bg-foreground/40 backdrop-blur-sm transition-opacity duration-300",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
          aria-hidden="true"
        />
        {/* Drawer */}
        <div
          className={cn(
            "relative flex h-full min-h-0 max-h-full w-fit flex-shrink-0 flex-col transition-transform duration-300 ease-in-out shadow-2xl",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {sidebarContent}
        </div>
      </div>
    </>
  )
}
