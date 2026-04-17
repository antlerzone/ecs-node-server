"use client"

import TenantSidebar from "@/components/tenant/sidebar"
import { TenantHeader } from "@/components/tenant/header"
import { TenantReadonlyMarquee } from "@/components/tenant/tenant-readonly-marquee"
import ProfileGate from "@/components/tenant/profile-gate"
import { TenantProvider } from "@/contexts/tenant-context"
import { useEffect, useState } from "react"
import { Menu } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { ensureColivingPortalDetail } from "@/lib/unified-profile-portal-api"

export default function TenantLayoutClient({ children }: { children: React.ReactNode }) {
  // Tenant Portal: 谁都可以登入，不要求 tenant role
  const { user, isLoading } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [detailReady, setDetailReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!user?.email) {
        setDetailReady(true)
        return
      }
      await ensureColivingPortalDetail("tenant")
      if (!cancelled) setDetailReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  if (!detailReady) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <TenantProvider>
    <ProfileGate>
      <div className="flex flex-col min-h-screen bg-background w-full">
        <TenantReadonlyMarquee />

        <div className="flex flex-1 min-h-0 min-w-0 w-full">
          <TenantSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

          <div className="flex-1 flex flex-col min-w-0 w-full">
            {/* Desktop header with profile */}
            <TenantHeader />
            {/* Mobile top bar with hamburger */}
            <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 bg-card border-b border-border">
              <button
                onClick={() => setMobileOpen(true)}
                className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Open menu"
              >
                <Menu size={20} />
              </button>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-black tracking-widest uppercase text-primary">Coliving</span>
                <span className="text-[9px] tracking-[0.25em] text-muted-foreground uppercase">Management</span>
              </div>
            </header>

            <main className="flex-1 overflow-y-auto w-full">
              {children}
            </main>
          </div>
        </div>
      </div>
    </ProfileGate>
    </TenantProvider>
  )
}
