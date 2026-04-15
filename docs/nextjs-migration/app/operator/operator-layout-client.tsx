"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import OperatorSidebar from "@/components/operator/sidebar"
import { hasPermissionForPath } from "@/lib/operator-permissions"
import { Menu, Coins, AlertTriangle, MessageCircle, BookOpen, Rocket } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { OperatorProvider, useOperatorContext } from "@/contexts/operator-context"
import { isDemoSite } from "@/lib/portal-api"

const CREDIT_LOW_THRESHOLD = 100

/** Zero-balance operators may still complete onboarding; do not trap them on Credit before terms / company / profile / quick setup. */
const CREDIT_REDIRECT_EXEMPT = new Set<string>([
  "/operator/credit",
  "/operator/terms",
  "/operator/company",
  "/operator/profile",
  "/operator/quicksetup",
])

function OperatorLayoutInner({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth("operator")
  const router = useRouter()
  const pathname = usePathname()
  const { creditBalance, creditOk, accessCtx, permission, companyProfileComplete, personalProfileComplete, termsAccepted, hasAccountingCapability, isLoading: ctxLoading, error } = useOperatorContext()
  const [mobileOpen, setMobileOpen] = useState(false)
  const isLowCredit = creditOk && creditBalance < CREDIT_LOW_THRESHOLD

  useEffect(() => {
    if (ctxLoading || !accessCtx?.ok) return
    // Demo (demo.colivingjb.com): no redirect – default high credit, open all
    if (typeof window !== "undefined" && isDemoSite()) return
    // No accounting: cannot enter /operator/accounting → redirect to /operator
    if (!hasAccountingCapability && pathname === "/operator/accounting") {
      router.replace("/operator")
      return
    }
    // New operators: redirect to credit when balance is 0, except onboarding routes (see CREDIT_REDIRECT_EXEMPT).
    if (creditBalance <= 0 && !CREDIT_REDIRECT_EXEMPT.has(pathname)) {
      router.replace("/operator/credit")
      return
    }
    // 1) Terms first – must accept before company/profile/other tabs
    if (!termsAccepted && pathname !== "/operator/terms" && pathname !== "/operator/quicksetup") {
      router.replace("/operator/terms")
      return
    }
    // 2) Company profile (Company Settings)
    if (termsAccepted && !companyProfileComplete && pathname !== "/operator/company" && pathname !== "/operator/quicksetup") {
      router.replace("/operator/company")
      return
    }
    // 3) Personal profile (My Profile – staff name at minimum)
    if (termsAccepted && companyProfileComplete && !personalProfileComplete && pathname !== "/operator/profile" && pathname !== "/operator/quicksetup") {
      router.replace("/operator/profile")
      return
    }
    if (pathname !== "/operator/billing" && pathname !== "/operator/credit" && pathname !== "/operator/quicksetup" && !hasPermissionForPath(permission, pathname)) {
      router.replace("/operator/billing")
    }
  }, [pathname, ctxLoading, accessCtx?.ok, creditBalance, companyProfileComplete, personalProfileComplete, termsAccepted, hasAccountingCapability, permission, router])

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

  if (ctxLoading && !accessCtx) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (error || (accessCtx && !accessCtx.ok)) {
    const is502 = typeof error === "string" && (error.includes("502") || error.includes("PROXY_ERROR"))
    const msg = error ?? (accessCtx?.reason === "NO_PERMISSION" ? "You don't have permission" : "You don't have account yet")
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <AlertTriangle size={48} className="mx-auto text-amber-500 mb-4" />
          <h2 className="text-lg font-bold text-foreground mb-2">
            {is502 ? "API Connection Error" : "Access Denied"}
          </h2>
          <p className="text-muted-foreground mb-2">{msg}</p>
          {is502 && (
            <p className="text-xs text-muted-foreground mb-4">
              The portal cannot reach the API server. Check that ECS (api.colivingjb.com) is running and reachable from this server. See docs/nextjs-migration/portal-frontend-backend-connection.md
            </p>
          )}
          <Link href="/portal" className="text-primary font-semibold hover:underline">Back to Portal</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background w-full lg:items-start">
      <OperatorSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col w-full">
        {/* Credit Banner - shows when credit is low (only when balance > 0) */}
        {isLowCredit && creditBalance > 0 && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-center gap-2 text-sm text-amber-800">
            <AlertTriangle size={14} />
            <span>Low credit balance! You have <strong>{creditBalance}</strong> credits remaining.</span>
            <Link href="/operator/credit" className="font-semibold underline ml-1">Top up now</Link>
          </div>
        )}

        {/* Desktop header with Quick Setup + Tutorial + Contact Support + credit */}
        <header className="hidden lg:flex sticky top-0 z-40 items-center justify-end gap-4 bg-card border-b border-border px-6 py-3">
          <Link
            href="/operator/quicksetup"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-xs font-medium"
            title="Quick Setup – onboard a new property"
          >
            <Rocket size={14} />
            Quick Setup
          </Link>
          <Link
            href="/tutorial"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-xs font-medium"
            title="Step-by-step tutorial"
          >
            <BookOpen size={14} />
            Tutorial
          </Link>
          <button
            type="button"
            onClick={() => window.open("https://wa.me/60198579627?text=Hi, I need support.", "_blank")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors text-sm font-medium text-foreground"
          >
            <MessageCircle size={16} />
            Contact Support
          </button>
          <Link
            href="/operator/credit"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
          >
            <Coins size={16} style={{ color: "var(--brand)" }} />
            <span className="text-sm font-semibold text-foreground">{creditBalance}</span>
            <span className="text-xs text-muted-foreground">credits</span>
          </Link>
        </header>

        {/* Mobile header with hamburger */}
        <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between bg-card border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-semibold text-foreground">Operator Portal</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/operator/quicksetup"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary text-xs"
              title="Quick Setup"
            >
              <Rocket size={14} />
            </Link>
            <Link
              href="/tutorial"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary text-xs"
              title="Tutorial"
            >
              <BookOpen size={14} />
            </Link>
            <button
              type="button"
              onClick={() => window.open("https://wa.me/60198579627?text=Hi, I need support.", "_blank")}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary text-xs font-medium"
            >
              <MessageCircle size={14} />
              Support
            </button>
            <Link
              href="/operator/credit"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary"
            >
              <Coins size={14} style={{ color: "var(--brand)" }} />
              <span className="text-xs font-semibold text-foreground">{creditBalance}</span>
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto w-full">{children}</main>
      </div>
    </div>
  )
}

export default function OperatorLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <OperatorProvider>
      <OperatorLayoutInner>{children}</OperatorLayoutInner>
    </OperatorProvider>
  )
}
