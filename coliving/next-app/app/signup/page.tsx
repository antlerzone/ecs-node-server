"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { setMember } from "@/lib/portal-session"
import { isDemoSite } from "@/lib/portal-api"
import { buildPortalOAuthStartUrl } from "@/components/portal-auth-form"
import { Spinner } from "@/components/ui/spinner"

function getEcsBase(): string {
  return (process.env.NEXT_PUBLIC_ECS_BASE_URL ?? "").replace(/\/$/, "")
}

function SignUpInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get("next")
  const oauthEnquiry = nextPath === "/enquiry"
  const [oauthError, setOauthError] = useState("")

  function startOAuth(provider: "google" | "facebook") {
    if (isDemoSite()) {
      const demoEmail = "demo@demo.com"
      setMember({
        email: demoEmail,
        roles: [
          {
            type: "staff",
            staffSource: "coliving_client_user",
            staffId: "demo-staff",
            clientId: "demo-client",
            clientTitle: "Demo Client",
          },
        ],
      })
      if (typeof window !== "undefined") {
        localStorage.setItem("user", JSON.stringify({
          email: demoEmail,
          name: "demo",
          roles: ["operator"],
        }))
      }
      router.push(oauthEnquiry ? "/enquiry" : "/portal")
      return
    }
    const base = getEcsBase()
    if (!base) {
      setOauthError("API not configured.")
      return
    }
    setOauthError("")
    window.location.assign(buildPortalOAuthStartUrl(base, provider, { enquiry: oauthEnquiry }))
  }

  const registerHref = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? `/register?next=${encodeURIComponent(nextPath)}` : "/register"

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">Sign Up</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Already a member?{" "}
            <Link href={oauthEnquiry ? "/enquiry" : "/login"} className="text-primary font-semibold hover:underline">
              Log In
            </Link>
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm space-y-4">
          {oauthError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {oauthError}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 h-11"
            onClick={() => startOAuth("google")}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign up with Google
          </Button>

          <Button
            type="button"
            className="w-full gap-2 h-11 bg-[#1877F2] text-white border-[#1877F2] hover:bg-[#166FE5] hover:text-white"
            onClick={() => startOAuth("facebook")}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Sign up with Facebook
          </Button>

          <div className="relative py-2">
            <span className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </span>
            <span className="relative flex justify-center text-sm text-muted-foreground bg-card px-2">
              or
            </span>
          </div>

          <Button variant="outline" className="w-full h-11" asChild>
            <Link href={registerHref}>Sign up with email</Link>
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          <a href="https://www.colivingjb.com" className="hover:text-foreground transition-colors">
            Back to Home
          </a>
        </p>
      </div>
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Spinner size="md" />
        </div>
      }
    >
      <SignUpInner />
    </Suspense>
  )
}
