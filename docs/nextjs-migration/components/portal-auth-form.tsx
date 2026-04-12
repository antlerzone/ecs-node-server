"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, ArrowLeft, LogIn } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { PORTAL_KEYS, setMember } from "@/lib/portal-session"
import { setCurrentRole } from "@/lib/portal-session"
import { isDemoSite } from "@/lib/portal-api"

function getEcsBase(): string {
  if (typeof window !== "undefined") return (process.env.NEXT_PUBLIC_ECS_BASE_URL ?? "").replace(/\/$/, "")
  return (process.env.NEXT_PUBLIC_ECS_BASE_URL ?? "").replace(/\/$/, "")
}

/** OAuth：enquiry=1 時後端允許首登（Google/Facebook state）。 */
export function buildPortalOAuthStartUrl(
  base: string,
  provider: "google" | "facebook",
  opts?: { enquiry?: boolean }
): string {
  const frontend =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host}`
      : ""
  const params = new URLSearchParams()
  if (frontend) params.set("frontend", frontend)
  if (opts?.enquiry) params.set("enquiry", "1")
  const q = params.toString() ? `?${params.toString()}` : ""
  return `${base}/api/portal-auth/${provider}${q}`
}

export async function loginWithPassword(
  email: string,
  password: string
): Promise<{
  ok: boolean
  reason?: string
  email?: string
  roles?: { type: string }[]
  token?: string
}> {
  const base = getEcsBase()
  if (!base) return { ok: false, reason: "NO_API" }
  const res = await fetch(`${base}/api/portal-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password }),
  })
  const data = await res.json().catch(() => ({}))
  return data as { ok: boolean; reason?: string; email?: string; roles?: { type: string }[]; token?: string }
}

export type PortalAuthFormProps = {
  /** fullpage：與 /login 相同置中；embedded：放進 enquiry 右欄 */
  layout?: "fullpage" | "embedded"
  /** 與 /enquiry 一致：OAuth 首登可建 portal_account */
  oauthEnquiry?: boolean
  /** 密碼登入成功後導向（預設 /portal） */
  afterPasswordLogin?: string
  /** 標題下說明文字 */
  subtitle?: string
  /** 「建立帳號」連結（預設 /signup） */
  createAccountHref?: string
  /** 「聯絡我們」連結（embedded 預設 mailto） */
  contactHref?: string
}

export function PortalAuthForm({
  layout = "fullpage",
  oauthEnquiry = false,
  afterPasswordLogin = "/portal",
  subtitle = "Sign in to access your portal",
  createAccountHref,
  contactHref,
}: PortalAuthFormProps) {
  const router = useRouter()
  const embedded = layout === "embedded"
  const signupLink = createAccountHref ?? (embedded ? "/signup?next=/enquiry" : "/signup")
  const contactLink = contactHref ?? (embedded ? "mailto:colivingmanagement@gmail.com" : "/enquiry")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [rememberMe, setRememberMe] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    const err = new URLSearchParams(window.location.search).get("error")
    if (window.opener && err) {
      const reason =
        err === "OAUTH_NOT_CONFIGURED"
          ? "Google/Facebook sign-in is not configured."
          : err === "OAUTH_ERROR"
            ? "Sign-in failed. Please try again."
            : err === "OAUTH_FAILED" || err === "EMAIL_NOT_REGISTERED"
              ? "This account is not in our system. Please register first."
              : "Sign-in failed. Please try again."
      try {
        window.opener.postMessage({ type: "portal-oauth", ok: false, reason }, window.location.origin)
      } catch {
        // ignore
      }
      try {
        window.close()
      } catch {
        /* ignore */
      }
      return
    }
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
      setError("Please enter your email")
      return
    }

    if (isDemoSite()) {
      setMember({
        email: email.trim(),
        roles: [{ type: "staff", staffId: "demo-staff", clientId: "demo-client", clientTitle: "Demo Client" }],
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
      router.push(afterPasswordLogin)
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
        router.push(afterPasswordLogin)
        return
      }
      if (result.reason === "INVALID_CREDENTIALS" || result.reason === "NO_EMAIL") {
        setError("Invalid email or password. Not registered? Create an account first.")
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
        roles: [{ type: "staff", staffId: "demo-staff", clientId: "demo-client", clientTitle: "Demo Client" }],
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
      router.push(afterPasswordLogin)
      return
    }
    const base = getEcsBase()
    if (!base) {
      setError("API not configured. Please use email and password.")
      return
    }
    setError("")
    window.location.assign(buildPortalOAuthStartUrl(base, provider, { enquiry: oauthEnquiry }))
  }

  const inner = (
    <>
      {!embedded && (
        <div className="mb-6">
          <a
            href="https://www.colivingjb.com"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={15} /> Back to Home
          </a>
        </div>
      )}

      <div className={`text-center ${embedded ? "mb-6" : "mb-8"}`}>
        <div className="flex flex-col items-center">
          <span className="text-2xl font-bold tracking-widest text-primary uppercase">Coliving</span>
          <span className="text-xs tracking-[0.3em] text-muted-foreground uppercase">Management</span>
        </div>
        <p className="text-sm text-muted-foreground mt-4">{subtitle}</p>
      </div>

      <form onSubmit={handleLogin} className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">
              Email Address
            </label>
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pr-10"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded border-border accent-primary"
              />
              <span className="text-sm text-muted-foreground">Remember me</span>
            </label>
            <Link href="/forgot-password" className="text-sm text-primary hover:underline">
              Forgot password?
            </Link>
          </div>

          <Button type="submit" disabled={isLoading} className="w-full gap-2" style={{ background: "var(--brand)" }}>
            {isLoading ? (
              <>
                <Spinner size="sm" /> Signing in...
              </>
            ) : (
              <>
                <LogIn size={16} /> Sign In
              </>
            )}
          </Button>

          <div className="relative my-4">
            <span className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </span>
            <span className="relative flex justify-center text-xs uppercase text-muted-foreground bg-card px-2">
              Or continue with
            </span>
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
            className="w-full gap-2"
            onClick={() => startOAuth("google")}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
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
            className="w-full gap-2 bg-[#1877F2] text-white border-[#1877F2] hover:bg-[#166FE5] hover:text-white"
            onClick={() => startOAuth("facebook")}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Sign in with Facebook
          </Button>
        </div>

        <div className="mt-6 pt-6 border-t border-border text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Not registered?{" "}
            <Link href={signupLink} className="text-primary font-semibold hover:underline">
              Create an account
            </Link>
            {embedded && (
              <>
                {" · "}
                <Link href="/register?next=/enquiry" className="text-primary font-semibold hover:underline">
                  Register with email
                </Link>
              </>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            Have questions?{" "}
            {contactLink.startsWith("mailto:") ? (
              <a href={contactLink} className="text-primary font-semibold hover:underline">
                Contact us
              </a>
            ) : (
              <Link href={contactLink} className="text-primary font-semibold hover:underline">
                Contact us
              </Link>
            )}
          </p>
        </div>
      </form>
    </>
  )

  if (embedded) {
    return <div className="w-full min-w-0">{inner}</div>
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">{inner}</div>
    </div>
  )
}
