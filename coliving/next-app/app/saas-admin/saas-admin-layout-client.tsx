"use client"

import { useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import SaasAdminSidebar from "@/components/saas-admin/sidebar"
import { Menu } from "lucide-react"

export default function SaasAdminLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth("saas_admin")
  const [mobileOpen, setMobileOpen] = useState(false)

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

  return (
    <div className="flex min-h-screen bg-background w-full">
      <SaasAdminSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col w-full">
        <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between bg-card border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-semibold text-foreground">SaaS Admin</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto w-full">{children}</main>
      </div>
    </div>
  )
}
