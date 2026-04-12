"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Zap,
  CreditCard,
  DoorOpen,
  FileText,
  User,
  MessageSquare,
  CheckCircle,
  ChevronDown,
  LogOut,
  X,
  MessageCircle,
  BookOpen,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useEffect } from "react"
import { useTenantOptional } from "@/contexts/tenant-context"
import { TenantAvatarCircle } from "@/components/tenant/tenant-avatar-circle"

const navItems = [
  { href: "/tenant", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tenant/meter", label: "Meter", icon: Zap },
  { href: "/tenant/payment", label: "Payment", icon: CreditCard },
  { href: "/tenant/smart-door", label: "Smart Door", icon: DoorOpen },
  { href: "/tenant/cleaning", label: "Cleaning", icon: Sparkles },
  { href: "/tenant/agreement", label: "Agreement", icon: FileText },
  { href: "/tenant/profile", label: "Profile", icon: User },
  { href: "/tenant/feedback", label: "Feedback", icon: MessageSquare },
  { href: "/tenant/approval", label: "Approvals", icon: CheckCircle },
  { href: "/tutorial", label: "Tutorial", icon: BookOpen },
]

interface TenantSidebarProps {
  mobileOpen: boolean
  onMobileClose: () => void
}

function tenancyCurrency(client: { currency?: string } | null | undefined): string {
  return (client?.currency || "MYR").toString().toUpperCase()
}

function tenancyLifecycleSuffix(t: { portalLifecycle?: string }): string {
  if (t.portalLifecycle === "terminated") return " (Terminated)"
  if (t.portalLifecycle === "expired") return " (Expired)"
  return ""
}

/** Avoid "MYR MYR room 01" when roomname already starts with a currency token. */
function roomTitleWithCurrency(
  client: { currency?: string } | null | undefined,
  roomPlain: string,
  lifecycleSuffix: string
): string {
  const cur = tenancyCurrency(client)
  const rn = (roomPlain || "—").trim()
  if (!rn || rn === "—") return `—${lifecycleSuffix}`
  const head = rn.slice(0, 12).toUpperCase()
  const already =
    head.startsWith(`${cur} `) ||
    head.startsWith(`${cur}—`) ||
    (cur === "MYR" && (/^RM\s/i.test(rn) || /^MYR\s/i.test(rn))) ||
    (cur === "SGD" && /^S\$\s?/i.test(rn))
  const base = already ? rn : `${cur} ${rn}`
  return `${base}${lifecycleSuffix}`
}

export default function TenantSidebar({ mobileOpen, onMobileClose }: TenantSidebarProps) {
  const pathname = usePathname()
  const [roomOpen, setRoomOpen] = useState(false)
  const state = useTenantOptional()
  const tenancies = state?.tenancies ?? []
  const selectedTenancyId = state?.selectedTenancyId ?? null
  const setSelectedTenancyId = state?.setSelectedTenancyId
  const first = tenancies[0]
  const currentTenancy =
    tenancies.find((t) => (t?.id ?? t?._id) === selectedTenancyId) ?? first
  const pendingInvite = state?.hasPendingOperatorInvite ?? false
  const roomPlain =
    tenancies.length === 0 && pendingInvite
      ? "Awaiting your approval"
      : currentTenancy?.room?.roomname || currentTenancy?.room?.title_fld || "—"
  const activeRoom =
    tenancies.length === 0 && pendingInvite
      ? roomPlain
      : roomTitleWithCurrency(currentTenancy?.client, roomPlain, tenancyLifecycleSuffix(currentTenancy ?? {}))
  const property =
    tenancies.length === 0 && pendingInvite ? "See Approvals" : currentTenancy?.property?.shortname || "—"
  const tenantName = state?.tenant?.fullname || state?.tenant?.email || "—"
  const hasMeterMenu = !!currentTenancy?.room?.hasMeter
  const hasSmartDoorMenu = !!(currentTenancy?.room?.hasSmartDoor || currentTenancy?.property?.hasSmartDoor)
  const hasCleaningMenu = !!currentTenancy?.hasCleaningOrder
  const visibleNavItems = navItems.filter((item) => {
    if (item.href === "/tenant/meter") return hasMeterMenu
    if (item.href === "/tenant/smart-door") return hasSmartDoorMenu
    if (item.href === "/tenant/cleaning") return hasCleaningMenu
    return true
  })
  const clientContact = currentTenancy?.client?.contact
  const whatsappPhone = typeof clientContact === "string" && clientContact.trim()
    ? clientContact.trim().replace(/\D/g, "")
    : null
  const whatsappUrl = whatsappPhone
    ? `https://wa.me/${whatsappPhone}`
    : "https://wa.me/60123456789"

  // Close sidebar on route change (mobile)
  useEffect(() => {
    onMobileClose()
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  const sidebarContent = (
    <aside className="w-64 flex-shrink-0 bg-card border-r border-border flex flex-col h-full overflow-y-auto">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-border flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-base font-black tracking-widest uppercase text-primary">Coliving</span>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
          <span className="text-[9px] tracking-[0.25em] text-muted-foreground/60 uppercase mt-0.5">Tenant Ecosystem</span>
        </div>
        {/* Close button — only visible on mobile */}
        <button
          onClick={onMobileClose}
          className="lg:hidden ml-2 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Active Room Selector */}
      <div className="px-4 py-4 border-b border-border">
        <p className="text-[9px] font-semibold tracking-[0.25em] uppercase text-muted-foreground mb-2">Active Room</p>
        <button
          onClick={() => setRoomOpen(!roomOpen)}
          className="w-full flex items-center justify-between bg-secondary rounded-xl px-3 py-2.5 hover:bg-secondary/80 transition-colors"
        >
          <div className="text-left">
            <div className="font-bold text-foreground text-sm">{activeRoom}</div>
            <div className="text-[11px] text-muted-foreground">{property}</div>
          </div>
          <ChevronDown size={15} className={cn("text-muted-foreground transition-transform", roomOpen && "rotate-180")} />
        </button>
        {roomOpen && tenancies.length > 0 && (
          <div className="mt-1 bg-card border border-border rounded-xl overflow-hidden shadow-lg">
            {tenancies.map((t) => {
              const id = t?.id ?? t?._id
              const rn = t?.room?.roomname || t?.room?.title_fld || "—"
              const pn = t?.property?.shortname || "—"
              const suf = tenancyLifecycleSuffix(t ?? {})
              const line1 = roomTitleWithCurrency(t?.client, rn, suf)
              const selected = id != null && id === selectedTenancyId
              return (
                <button
                  key={String(id ?? rn)}
                  type="button"
                  onClick={() => {
                    if (id != null) setSelectedTenancyId?.(String(id))
                    setRoomOpen(false)
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 text-sm transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <span className="font-semibold block">{line1}</span>
                  <span className="text-[11px] opacity-90">{pn}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 py-4 flex flex-col gap-1">
        {visibleNavItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                isActive
                  ? "text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              style={isActive ? { background: "var(--brand)" } : undefined}
            >
              <item.icon size={18} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Contact Operator */}
      <div className="px-4 py-2 border-t border-border">
        <button
          type="button"
          onClick={() => window.open(whatsappUrl, "_blank")}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <MessageCircle size={16} />
          {whatsappPhone ? "Contact Operator" : "Contact Support"}
        </button>
      </div>

      {/* User */}
      <div className="px-4 py-4 border-t border-border">
        <div className="flex items-center gap-3">
          <TenantAvatarCircle
            avatarUrl={state?.tenant?.profile?.avatar_url}
            initials={(tenantName as string).slice(0, 2).toUpperCase() || "—"}
            title={tenantName as string}
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-foreground truncate">{tenantName}</div>
            <div className="text-xs text-muted-foreground truncate">{activeRoom}</div>
          </div>
          <Link href="/portal" className="text-muted-foreground hover:text-foreground transition-colors" title="Logout">
            <LogOut size={16} />
          </Link>
        </div>
      </div>
    </aside>
  )

  return (
    <>
      {/* Desktop: always visible */}
      <div className="hidden lg:flex h-screen sticky top-0">
        {sidebarContent}
      </div>

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
            "relative h-full flex-shrink-0 transition-transform duration-300 ease-in-out shadow-2xl",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {sidebarContent}
        </div>
      </div>
    </>
  )
}
