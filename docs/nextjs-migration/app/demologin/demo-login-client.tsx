"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { EnquirySwapAuthLayout } from "@/components/enquiry-swap-auth-layout"
import { SlidingSignInPanel } from "@/components/sliding-sign-in-panel"
import { SlidingRegisterPanel } from "@/components/sliding-register-panel"
import { PORTAL_KEYS } from "@/lib/portal-session"
import { isDemoSite } from "@/lib/portal-api"
import { getEnquiryApiBase } from "@/lib/enquiry-portal-api"

/** Same shell as `/enquiry`: header + `EnquirySwapAuthLayout`. */
export default function DemoLoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [jwtReady, setJwtReady] = useState(
    () => typeof window !== "undefined" && !!localStorage.getItem(PORTAL_KEYS.PORTAL_JWT)
  )

  const showLiveFlow = !isDemoSite() && !!getEnquiryApiBase()
  const showFullLogin = !jwtReady
  const authInitialPage =
    searchParams.get("mode") === "signup" ? ("signup" as const) : ("signin" as const)

  useEffect(() => {
    if (typeof window === "undefined") return
    setJwtReady(!!localStorage.getItem(PORTAL_KEYS.PORTAL_JWT))
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const onStorage = (e: StorageEvent) => {
      if (e.key === PORTAL_KEYS.PORTAL_JWT || e.key === null) {
        setJwtReady(!!localStorage.getItem(PORTAL_KEYS.PORTAL_JWT))
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  useEffect(() => {
    if (!jwtReady) return
    router.replace("/portal")
  }, [jwtReady, router])

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {/* Match `/enquiry` header exactly (no extra nav items). */}
      <header className="shrink-0 border-b border-border bg-card px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-lg font-bold tracking-widest text-primary uppercase">Coliving</span>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Link
            href="/pricing"
            className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/privacy-policy"
            className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
          >
            Privacy Policy
          </Link>
          <Link
            href="/demologin?mode=signup"
            className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
          >
            Sign up
          </Link>
          <Link
            href="/demologin"
            className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
          >
            Sign in
          </Link>
          <a
            href="https://www.colivingjb.com"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={14} /> Back to Home
          </a>
        </div>
      </header>

      {showLiveFlow && showFullLogin ? (
        <div className="flex flex-1 flex-col w-full min-h-0">
          <div className="flex flex-1 flex-col min-h-0 w-full">
            <EnquirySwapAuthLayout
              initialPage={authInitialPage}
              signIn={
                <SlidingSignInPanel
                  afterLogin="/demologin"
                  oauthEnquiry={false}
                />
              }
              signUp={
                <SlidingRegisterPanel
                  nextPath="/demologin"
                />
              }
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
            Open this page on portal.colivingjb.com with the live API to use the same sign-in layout as Enquiry.
          </p>
        </div>
      )}
    </div>
  )
}
