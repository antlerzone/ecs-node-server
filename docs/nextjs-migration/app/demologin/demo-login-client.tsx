"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { EnquirySwapAuthLayout } from "@/components/enquiry-swap-auth-layout"
import { EnquiryPostAuthSplitLayout } from "@/components/enquiry-post-auth-split-layout"
import { SlidingSignInPanel } from "@/components/sliding-sign-in-panel"
import { SlidingRegisterPanel } from "@/components/sliding-register-panel"
import { GovIdConnectButtons } from "@/components/gov-id-connect-buttons"
import { PORTAL_KEYS } from "@/lib/portal-session"
import { fetchGovIdStatus, disconnectGovIdApi } from "@/lib/unified-profile-portal-api"
import { shouldUseDemoMock, isDemoSite } from "@/lib/portal-api"
import { getEnquiryApiBase } from "@/lib/enquiry-portal-api"
import { formatGovIdErrorReason } from "@/lib/gov-id-callback-messages"
import { cn } from "@/lib/utils"


/**
 * Same shell as `/enquiry`: header + `EnquirySwapAuthLayout`. After sign-in, same split (`EnquiryPostAuthSplitLayout`) with Gov ID demo on the white half.
 * OAuth uses `oauthEnquiry={false}` so Google/Facebook return to normal portal login, not forced `/enquiry` redirect (see portal-auth Google callback).
 */
export default function DemoLoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [jwtReady, setJwtReady] = useState(
    () => typeof window !== "undefined" && !!localStorage.getItem(PORTAL_KEYS.PORTAL_JWT)
  )
  const [govSingpass, setGovSingpass] = useState(false)
  const [govMydigital, setGovMydigital] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [govSwitchDialogOpen, setGovSwitchDialogOpen] = useState(false)

  const showLiveFlow = !isDemoSite() && !!getEnquiryApiBase()
  /** Gov callbacks return here so errors keep full login (email / Google / Facebook / Gov) after URL is cleaned. */
  const DEMO_GOV_RETURN_PATH = "/demologin?mode=signin&keep_login_ui=1"
  const govErrInUrl = searchParams.get("gov") === "error" && !!searchParams.get("reason")
  const keepLoginUi = searchParams.get("keep_login_ui") === "1"
  /** First paint with `?gov=error` must show full login (not only Gov demo). */
  const showFullLogin = !jwtReady || govErrInUrl || keepLoginUi
  const authInitialPage =
    keepLoginUi || searchParams.get("gov") === "error"
      ? ("signin" as const)
      : searchParams.get("mode") === "signup"
        ? ("signup" as const)
        : ("signin" as const)

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

  useEffect(() => {
    const gov = searchParams.get("gov")
    const provider = searchParams.get("provider")
    const reason = searchParams.get("reason")
    if (gov === "success") {
      toast.success(`Connected${provider ? ` (${provider})` : ""}`)
      router.replace("/demologin", { scroll: false })
    } else if (gov === "error" && reason) {
      const key = decodeURIComponent(reason).trim()
      const boundEmail = searchParams.get("boundEmail")
      if (key === "GOV_ID_SWITCH_REQUIRED") {
        setGovSwitchDialogOpen(true)
      } else if (
        (key === "SUB_ALREADY_LINKED" || key === "NATIONAL_ID_ALREADY_BOUND") &&
        boundEmail
      ) {
        toast.error(
          `This identity is already linked to ${decodeURIComponent(boundEmail)}. Please sign in with that email or contact support.`,
        )
      } else {
        toast.error(formatGovIdErrorReason(reason))
      }
      router.replace(`${DEMO_GOV_RETURN_PATH}`, { scroll: false })
    }
  }, [searchParams, router])

  useEffect(() => {
    if (!jwtReady || shouldUseDemoMock()) return
    let c = false
    ;(async () => {
      setRefreshing(true)
      try {
        const jwt = typeof window !== "undefined" ? localStorage.getItem(PORTAL_KEYS.PORTAL_JWT) : null
        if (!jwt) return
        const s = await fetchGovIdStatus()
        if (c || !s.ok) return
        setGovSingpass(!!s.singpass)
        setGovMydigital(!!s.mydigital)
      } finally {
        if (!c) setRefreshing(false)
      }
    })()
    return () => {
      c = true
    }
  }, [jwtReady])

  const disconnect = async (provider: "singpass" | "mydigital") => {
    const r = await disconnectGovIdApi(provider)
    if (!r.ok) {
      toast.error(r.reason || "Failed")
      return
    }
    toast.success("Disconnected")
    if (provider === "singpass") setGovSingpass(false)
    else setGovMydigital(false)
  }

  const verified = govSingpass || govMydigital

  const govDemoInner = (
    <div className="w-full max-w-[300px] mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black text-foreground mb-1">Gov ID demo</h1>
        <p className="text-sm text-muted-foreground">
          Connect Singpass or MyDigital ID. Callback returns here with <code className="text-xs">?gov=success</code>.
        </p>
      </div>

      {shouldUseDemoMock() ? (
        <p className="text-sm text-muted-foreground">
          Gov ID demo requires the live API (not demo.colivingjb.com mock). Use portal.colivingjb.com with backend env
          configured.
        </p>
      ) : (
        <>
          {verified ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1.5 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4" />
              {govSingpass && !govMydigital
                ? "Myinfo retrieved"
                : govMydigital && !govSingpass
                  ? "MyDigital connected"
                  : "Gov ID verified"}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{refreshing ? "Checking status…" : "Not linked"}</p>
          )}

          <GovIdConnectButtons
            returnPath={DEMO_GOV_RETURN_PATH}
            variant="solo"
            appearance="fill"
            singpassLinked={govSingpass}
            mydigitalLinked={govMydigital}
          />

          {(govMydigital || govSingpass) && (
            <div className="flex flex-col gap-2 border-t border-border pt-6">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Disconnect</p>
              {govMydigital ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void disconnect("mydigital")}>
                  Disconnect MyDigital ID
                </Button>
              ) : null}
              {govSingpass ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void disconnect("singpass")}>
                  Disconnect Singpass
                </Button>
              ) : null}
            </div>
          )}

          <p className="text-center text-sm pt-2">
            <Link href="/demoprofile" className="text-primary font-semibold underline-offset-4 hover:underline">
              Open demo profile (same UI as tenant profile)
            </Link>
          </p>
        </>
      )}
    </div>
  )

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
                  govIdReturnPath={DEMO_GOV_RETURN_PATH}
                />
              }
              signUp={
                <SlidingRegisterPanel
                  nextPath="/demologin"
                  govIdReturnPath={DEMO_GOV_RETURN_PATH}
                />
              }
            />
          </div>
        </div>
      ) : showLiveFlow && jwtReady ? (
        <EnquiryPostAuthSplitLayout signupHref="/demologin?mode=signup">{govDemoInner}</EnquiryPostAuthSplitLayout>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
            Open this page on portal.colivingjb.com with the live API to use the same sign-in layout as Enquiry and Gov ID
            demo.
          </p>
        </div>
      )}

      <Dialog open={govSwitchDialogOpen} onOpenChange={setGovSwitchDialogOpen}>
        <DialogContent
          className={cn(
            "sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden",
            "top-[5%] translate-y-0 sm:top-[50%] sm:translate-y-[-50%]",
          )}
        >
          <DialogHeader>
            <DialogTitle>Switch government ID</DialogTitle>
            <DialogDescription>
              This account already has a different government ID linked. Sign in, open{" "}
              <Link href="/demoprofile" className="font-semibold text-primary underline-offset-4 hover:underline">
                Profile
              </Link>{" "}
              → Verification, disconnect the current ID, then return here and connect the ID you want.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setGovSwitchDialogOpen(false)}>
              Close
            </Button>
            <Button type="button" asChild>
              <Link href="/demologin?mode=signin&keep_login_ui=1">Back to sign in</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
