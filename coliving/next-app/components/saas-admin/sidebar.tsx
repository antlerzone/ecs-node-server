"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Users, CreditCard, Package, Mail, BookOpen, Receipt, Zap, Building2, LogOut, X, ArrowLeft } from "lucide-react"
import { clearPortalSession } from "@/lib/portal-session"

type NavItem = { id: string; label: string; icon: typeof LayoutDashboard }

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "clients", label: "Clients", icon: Users },
  { id: "topup", label: "Credit Top-up", icon: CreditCard },
  { id: "pricing", label: "Pricing Plan", icon: Package },
  { id: "processing-fees", label: "Processing Fees", icon: Receipt },
  { id: "meters", label: "All Meter", icon: Zap },
  { id: "properties", label: "All Property", icon: Building2 },
  { id: "enquiry", label: "Enquiry", icon: Mail },
  { id: "apidocs", label: "API Docs", icon: BookOpen },
]

interface SaasAdminSidebarProps {
  mobileOpen: boolean
  onMobileClose: () => void
}

export default function SaasAdminSidebar({ mobileOpen, onMobileClose }: SaasAdminSidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get("tab") || "dashboard"

  useEffect(() => {
    onMobileClose()
  }, [pathname, searchParams, onMobileClose])

  const tabHref = (id: string) => (id === "dashboard" ? "/saas-admin" : `/saas-admin?tab=${id}`)

  const sidebarContent = (
    <aside className="w-64 flex-shrink-0 bg-card border-r border-border flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-6 border-b border-border flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-base font-black tracking-widest uppercase text-primary">Coliving</span>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
          <span className="text-[9px] tracking-[0.25em] text-muted-foreground/60 uppercase mt-0.5">SaaS Admin</span>
        </div>
        <button
          onClick={onMobileClose}
          className="lg:hidden ml-2 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 px-4 py-4 flex flex-col gap-0.5">
        {navItems.map((item) => {
          const isActive = activeTab === item.id
          return (
            <Link
              key={item.id}
              href={tabHref(item.id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                isActive ? "text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              style={isActive ? { background: "var(--brand)" } : undefined}
            >
              <item.icon size={17} />
              <span className="flex-1 truncate">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="px-4 py-4 border-t border-border flex flex-col gap-2">
        <Link
          href="/portal"
          onClick={() => onMobileClose()}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
            "text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent"
          )}
        >
          <ArrowLeft size={17} className="flex-shrink-0" />
          <span className="flex-1 text-left">Back to Portal</span>
        </Link>
        <button
          type="button"
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
            "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          )}
          onClick={() => {
            clearPortalSession()
            window.location.href = "/portal"
          }}
        >
          <LogOut size={17} className="flex-shrink-0" />
          <span className="flex-1 text-left">Log out</span>
        </button>
      </div>
    </aside>
  )

  return (
    <>
      <div className="hidden lg:block flex-shrink-0 h-screen sticky top-0">{sidebarContent}</div>
      <div
        className={cn(
          "lg:hidden fixed inset-0 z-50 flex transition-all duration-300",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
      >
        <div
          onClick={onMobileClose}
          className={cn(
            "absolute inset-0 bg-foreground/40 backdrop-blur-sm transition-opacity duration-300",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
          aria-hidden="true"
        />
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
