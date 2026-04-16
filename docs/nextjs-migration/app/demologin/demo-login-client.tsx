"use client"

import { useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { buildPortalOAuthStartUrl } from "@/components/portal-auth-form"
import { formatGovIdErrorReason } from "@/lib/gov-id-callback-messages"
import { cn } from "@/lib/utils"

function getPortalEcsBase(): string {
  return (process.env.NEXT_PUBLIC_ECS_BASE_URL ?? "").replace(/\/$/, "")
}

async function postLookupPortalEmail(email: string): Promise<{ ok?: boolean; exists?: boolean; reason?: string }> {
  const base = getPortalEcsBase()
  if (!base) return { ok: false, reason: "NO_API" }
  const res = await fetch(`${base}/api/portal-auth/gov-id/lookup-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim() }),
  })
  return (await res.json().catch(() => ({}))) as { ok?: boolean; exists?: boolean; reason?: string }
}

function SingpassNeedEmailPanel({ pendingId }: { pendingId: string }) {
  const router = useRouter()
  const [emailInput, setEmailInput] = useState("")
  const [lookupBusy, setLookupBusy] = useState(false)

  const startOAuth = (provider: "google" | "facebook") => {
    const base = getPortalEcsBase()
    if (!base) {
      toast.error("API not configured (NEXT_PUBLIC_ECS_BASE_URL).")
      return
    }
    window.location.href = buildPortalOAuthStartUrl(base, provider, { govPending: pendingId })
  }

  const onEmailContinue = async (e: FormEvent) => {
    e.preventDefault()
    if (!emailInput.trim()) return
    setLookupBusy(true)
    try {
      const r = await postLookupPortalEmail(emailInput)
      if (!r.ok) {
        toast.error(r.reason === "NO_EMAIL" ? "Enter a valid email address." : r.reason || "Could not check email.")
        return
      }
      const em = encodeURIComponent(emailInput.trim())
      const pen = encodeURIComponent(pendingId)
      if (r.exists) {
        router.replace(`/demologin?mode=signin&gov_pending=${pen}&email_hint=${em}`)
      } else {
        router.replace(`/demologin?mode=signup&gov_pending=${pen}&email_hint=${em}`)
      }
    } finally {
      setLookupBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 w-full min-h-0">
      <div className="w-full max-w-[300px] mx-auto space-y-5 text-left">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Singpass</h1>
          <p className="text-sm text-muted-foreground mt-2">
            We couldn&apos;t find an email from Singpass tied to your account.
          </p>
        </div>

        <form onSubmit={(e) => void onEmailContinue(e)} className="space-y-4">
          <div>
            <label htmlFor="gov-pend-email" className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">
              Email address
            </label>
            <Input
              id="gov-pend-email"
              type="email"
              autoComplete="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="your@email.com"
              className="bg-[var(--brand-muted)] border-0"
              required
            />
            <p className="text-xs text-muted-foreground mt-2 leading-snug">
              Sign in or register with this email — we&apos;ll link Singpass after.
            </p>
          </div>
          <Button
            type="submit"
            disabled={lookupBusy}
            className="w-full gap-2 rounded-xl py-2.5 font-semibold"
            style={{ background: "var(--brand)" }}
          >
            {lookupBusy ? "…" : "Continue"}
          </Button>
        </form>

        <div className="relative my-4">
          <span className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </span>
          <span className="relative flex justify-center text-xs uppercase text-muted-foreground bg-background px-2">
            Or continue with
          </span>
        </div>

        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full h-11 rounded-full gap-2 border-border bg-white hover:bg-muted/50 shadow-sm justify-center"
            onClick={() => startOAuth("google")}
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full h-11 rounded-full gap-2 border-0 bg-[#1877F2] text-white hover:bg-[#166FE5] hover:text-white shadow-sm justify-center"
            onClick={() => startOAuth("facebook")}
          >
            <svg className="h-5 w-5 shrink-0 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Sign in with Facebook
          </Button>
        </div>
      </div>
    </div>
  )
}

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
  const pendingGovId = (searchParams.get("pending") || "").trim()
  const needEmailFlow = showLiveFlow && searchParams.get("gov") === "need_email" && !!pendingGovId
  const govPendingFromQuery = (searchParams.get("gov_pending") || "").trim()
  const emailHintFromQuery = (searchParams.get("email_hint") || "").trim()
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
                ? "Singpass connected"
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

      {needEmailFlow ? (
        <SingpassNeedEmailPanel pendingId={pendingGovId} />
      ) : showLiveFlow && showFullLogin ? (
        <div className="flex flex-1 flex-col w-full min-h-0">
          <div className="flex flex-1 flex-col min-h-0 w-full">
            <EnquirySwapAuthLayout
              initialPage={authInitialPage}
              signIn={
                <SlidingSignInPanel
                  afterLogin="/demologin"
                  oauthEnquiry={false}
                  govIdReturnPath={DEMO_GOV_RETURN_PATH}
                  govPendingId={govPendingFromQuery || undefined}
                  emailHint={emailHintFromQuery || undefined}
                />
              }
              signUp={
                <SlidingRegisterPanel
                  nextPath="/demologin"
                  govIdReturnPath={DEMO_GOV_RETURN_PATH}
                  govPendingId={govPendingFromQuery || undefined}
                  emailHint={emailHintFromQuery || undefined}
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
