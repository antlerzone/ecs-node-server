"use client"

import { useEffect, useState } from "react"
import OwnerSidebar from "@/components/owner/sidebar"
import OwnerProfileGate from "@/components/owner/profile-gate"
import { OwnerProvider } from "@/contexts/owner-context"
import { Menu } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { ensureColivingPortalDetail } from "@/lib/unified-profile-portal-api"

export default function OwnerLayoutClient({ children }: { children: React.ReactNode }) {
  // Owner Portal: 谁都可以登入，不要求 owner role；须先填好 Profile 才能进入其他页面（与 Tenant 一致）
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
      await ensureColivingPortalDetail("owner")
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
    <OwnerProvider>
    <OwnerProfileGate>
    <div className="flex min-h-screen bg-background w-full">
      <OwnerSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <div className="flex-1 flex flex-col w-full">
        {/* Mobile header with hamburger */}
        <header className="lg:hidden sticky top-0 z-40 flex items-center gap-3 bg-card border-b border-border px-4 py-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <span className="text-sm font-semibold text-foreground">Owner Portal</span>
        </header>

        <main className="flex-1 overflow-y-auto w-full">{children}</main>
      </div>
    </div>
    </OwnerProfileGate>
    </OwnerProvider>
  )
}
