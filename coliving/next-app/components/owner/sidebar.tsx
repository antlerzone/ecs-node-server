"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Building2, User, FileText, FileBarChart, Receipt, CheckCircle, LogOut, X, Lock, MessageCircle, BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { useEffect } from "react"
import { getMember } from "@/lib/portal-session"

const navItems = [
  { href: "/owner", label: "Dashboard", icon: LayoutDashboard },
  { href: "/owner/properties", label: "My Properties", icon: Building2 },
  { href: "/owner/smart-door", label: "Smart Door", icon: Lock },
  { href: "/owner/profile", label: "Profile", icon: User },
  { href: "/owner/agreement", label: "Agreement", icon: FileText },
  { href: "/owner/report", label: "Owner Report", icon: FileBarChart },
  { href: "/owner/cost", label: "Cost Report", icon: Receipt },
  { href: "/owner/approval", label: "Approvals", icon: CheckCircle },
  { href: "/tutorial", label: "Tutorial", icon: BookOpen },
]

interface OwnerSidebarProps {
  mobileOpen: boolean
  onMobileClose: () => void
}

export default function OwnerSidebar({ mobileOpen, onMobileClose }: OwnerSidebarProps) {
  const pathname = usePathname()

  // Close sidebar on route change (mobile)
  useEffect(() => {
    onMobileClose()
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  const sidebarContent = (
    <aside className="w-64 flex-shrink-0 bg-card border-r border-border flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-6 border-b border-border flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-base font-black tracking-widest uppercase text-primary">Coliving</span>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
          <span className="text-[9px] tracking-[0.25em] text-muted-foreground/60 uppercase mt-0.5">Owner Portal</span>
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

      <nav className="flex-1 px-4 py-4 flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                isActive ? "text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              style={isActive ? { background: "var(--brand)" } : undefined}
            >
              <item.icon size={18} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="px-4 py-2 border-t border-border">
        <button
          onClick={() => window.open("https://wa.me/60123456789?text=Hi, I need help with my property.", "_blank")}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <MessageCircle size={16} />
          Contact Support
        </button>
      </div>

      <div className="px-4 py-4 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ background: "var(--brand)" }}>
            {(getMember()?.email || "O").charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-foreground truncate">{(getMember()?.email || "").split("@")[0] || "Owner"}</div>
            <div className="text-xs text-muted-foreground truncate">Property Owner</div>
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
      {/* Desktop: always visible */}
      <div className="hidden lg:block flex-shrink-0 h-screen sticky top-0">
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
