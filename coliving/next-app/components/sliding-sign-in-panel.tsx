"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, LogIn } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import {
  buildPortalOAuthStartUrl,
  loginWithPassword,
} from "@/components/portal-auth-form"
import { GovIdConnectButtons } from "@/components/gov-id-connect-buttons"
import { PORTAL_KEYS, setMember, setCurrentRole } from "@/lib/portal-session"
import { isDemoSite, shouldUseDemoMock } from "@/lib/portal-api"

function getEcsBase(): string {
  return (process.env.NEXT_PUBLIC_ECS_BASE_URL ?? "").replace(/\/$/, "")
}

export function SlidingSignInPanel({
  afterLogin,
  oauthEnquiry = false,
  /** When set (e.g. `/demologin`), show MyDigital ID & Singpass under Google/Facebook. */
  govIdReturnPath,
  emailHint,
}: {
  afterLogin: string
  /** Pass enquiry OAuth flag when onboarding from /enquiry */
  oauthEnquiry?: boolean
  govIdReturnPath?: string
  emailHint?: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (emailHint?.trim()) setEmail(emailHint.trim())
  }, [emailHint])

  useEffect(() => {
    if (typeof window === "undefined") return
    const err = new URLSearchParams(window.location.search).get("error")
    if (!err) return
    const msg =
      err === "OAUTH_NOT_CONFIGURED"
        ? "Google/Facebook sign-in is not configured. Please use email and password."
        : err === "OAUTH_ERROR"
          ? "Sign-in failed. Please try again or use email and password."
          : err === "OAUTH_FAILED" || err === "EMAIL_NOT_REGISTERED"
            ? "This account is not in our system. Please register first or use email and password."
            : "Sign-in failed. Please try again."
    setError(msg)
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!email?.trim()) {
      setError("Please enter your email or NRIC / ID number")
      return
    }
    if (isDemoSite()) {
      setMember({
        email: email.trim(),
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
      setCurrentRole({
        type: "staff",
        staffId: "demo-staff",
        clientId: "demo-client",
        clientTitle: "Demo Client",
      })
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "user",
          JSON.stringify({
            email: email.trim(),
            name: email.trim().split("@")[0],
            roles: ["operator"],
          })
        )
      }
      router.push(afterLogin)
      return
    }
    if (!password) {
      setError("Please enter your password")
      return
    }
    setIsLoading(true)
    try {
      const result = await loginWithPassword(email.trim(), password)
      if (result.ok && result.email && Array.isArray(result.roles)) {
        setMember({ email: result.email, roles: result.roles })
        if (typeof window !== "undefined") {
          if (result.token) {
            try {
              localStorage.setItem(PORTAL_KEYS.PORTAL_JWT, result.token)
            } catch {
              /* ignore */
            }
          }
          localStorage.setItem(
            "user",
            JSON.stringify({
              email: result.email,
              name: result.email.split("@")[0],
              roles: result.roles.map((r) => (r.type === "staff" ? "operator" : r.type)),
            })
          )
        }
        router.push(afterLogin)
        return
      }
      if (result.reason === "INVALID_CREDENTIALS") {
        setError("Invalid email, NRIC, or password.")
      } else if (result.reason === "NO_EMAIL") {
        setError("Please enter your email or NRIC / ID number.")
      } else if (result.reason === "ACCOUNT_NOT_FOUND_EMAIL") {
        setError("Can't find your account. Check the email address.")
      } else if (result.reason === "ACCOUNT_NOT_FOUND_NRIC") {
        setError("Can't find your login details. Check your NRIC / ID number.")
      } else {
        setError(result.reason === "DB_ERROR" ? "Server error. Please try again." : result.reason || "Login failed.")
      }
    } catch {
      setError("Network error. Please check your connection and try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const startOAuth = (provider: "google" | "facebook") => {
    if (isDemoSite()) {
      const demoEmail = email?.trim() || "demo@demo.com"
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
      setCurrentRole({
        type: "staff",
        staffId: "demo-staff",
        clientId: "demo-client",
        clientTitle: "Demo Client",
      })
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "user",
          JSON.stringify({
            email: demoEmail,
            name: demoEmail.split("@")[0],
            roles: ["operator"],
          })
        )
      }
      router.push(afterLogin)
      return
    }
    const base = getEcsBase()
    if (!base) {
      setError("API not configured. Please use email and password.")
      return
    }
    setError("")
    window.location.assign(
      buildPortalOAuthStartUrl(base, provider, {
        enquiry: oauthEnquiry,
      }),
    )
  }

  return (
    <div className="w-full max-w-[300px] mx-auto space-y-5">
      <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Sign In</h2>
      <p className="text-xs text-muted-foreground">Use your email or NRIC / ID number and password, or Google / Facebook below.</p>

      <form onSubmit={handleLogin} className="space-y-4 text-left">
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>
        )}
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">
            Email or NRIC / ID number
          </label>
          <Input
            type="text"
            placeholder="your@email.com or e.g. 901010105678"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            className="bg-[var(--brand-muted)] border-0"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Password</label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="bg-[var(--brand-muted)] border-0 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <p className="text-xs text-right">
          <Link href="/forgot-password" className="text-muted-foreground hover:underline" style={{ color: "var(--brand)" }}>
            Forget your password?
          </Link>
        </p>
        <Button type="submit" disabled={isLoading} className="w-full gap-2 rounded-xl" style={{ background: "var(--brand)" }}>
          {isLoading ? (
            <>
              <Spinner size="sm" /> Signing in...
            </>
          ) : (
            <>
              <LogIn size={16} /> SIGN IN
            </>
          )}
        </Button>

        <div className="relative my-4">
          <span className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </span>
          <span className="relative flex justify-center text-xs uppercase text-muted-foreground bg-background px-2">
            Or continue with
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isLoading}
          className="w-full h-11 rounded-full gap-2 border-border bg-white hover:bg-muted/50 shadow-sm"
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
          disabled={isLoading}
          className="w-full h-11 rounded-full gap-2 border-0 bg-[#1877F2] text-white hover:bg-[#166FE5] hover:text-white shadow-sm"
          onClick={() => startOAuth("facebook")}
        >
          <svg className="h-5 w-5 shrink-0 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
          </svg>
          Sign in with Facebook
        </Button>
      </form>

      <p className="text-xs text-red-600 text-center leading-snug px-1">
        Don&apos;t use a company email — you may need to verify your identity.
      </p>

    </div>
  )
}
