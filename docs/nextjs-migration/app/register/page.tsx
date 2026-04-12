"use client"

import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { ArrowLeft, CheckCircle, Eye, EyeOff } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { isDemoSite } from "@/lib/portal-api"
import { PortalSlidingAuthCard } from "@/components/portal-sliding-auth-card"
import { SlidingSignInPanel } from "@/components/sliding-sign-in-panel"

function getEcsBase(): string {
  return (process.env.NEXT_PUBLIC_ECS_BASE_URL ?? "").replace(/\/$/, "")
}

function RegisterPageInner() {
  const searchParams = useSearchParams()
  const nextAfterRegister = searchParams.get("next")
  const postRegisterHref =
    nextAfterRegister && nextAfterRegister.startsWith("/") && !nextAfterRegister.startsWith("//")
      ? nextAfterRegister
      : "/login"

  const fromEnquiry = nextAfterRegister === "/enquiry"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState("")

  const set = (key: string, val: string) => {
    if (key === "email") setEmail(val)
    else if (key === "password") setPassword(val)
    else if (key === "confirmPassword") setConfirmPassword(val)
    setErrors((e) => ({ ...e, [key]: "" }))
    setSubmitError("")
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!email.trim()) newErrors.email = "Required"
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = "Invalid email"
    if (!password) newErrors.password = "Required"
    else if (password.length < 8) newErrors.password = "Must be at least 8 characters"
    if (!confirmPassword) newErrors.confirmPassword = "Required"
    else if (password !== confirmPassword) newErrors.confirmPassword = "Passwords do not match"
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setIsLoading(true)
    setSubmitError("")
    if (isDemoSite()) {
      setSubmitted(true)
      setIsLoading(false)
      return
    }
    const base = getEcsBase()

    if (!base) {
      setSubmitError("API not configured. Set NEXT_PUBLIC_ECS_BASE_URL and rebuild.")
      setIsLoading(false)
      return
    }

    try {
      const res = await fetch(`${base}/api/portal-auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string; email?: string }

      if (data.ok) {
        setSubmitted(true)
      } else if (data.reason === "EMAIL_NOT_REGISTERED") {
        setSubmitError("This email is not in our system. Please ask your operator to add you first, then register.")
      } else if (data.reason === "EMAIL_ALREADY_REGISTERED") {
        setSubmitError("An account with this email already exists. Go to login.")
      } else if (data.reason === "NO_EMAIL" || data.reason === "INVALID_PASSWORD") {
        setSubmitError(data.reason === "INVALID_PASSWORD" ? "Invalid password." : "Email is required.")
      } else {
        setSubmitError(data.reason ?? "Registration failed. Please try again.")
      }
    } catch (err) {
      setSubmitError("Network error. Check that the API is running and CORS allows this site. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Account ready</h2>
          <p className="text-muted-foreground mb-6">
            You can log in with your email and password. If you use Google, that still works too.
          </p>
          <Link
            href={postRegisterHref}
            style={{ background: "var(--brand)" }}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white font-semibold hover:opacity-90"
          >
            {nextAfterRegister === "/enquiry" ? "Continue to onboarding" : "Go to Login"}
          </Link>
        </div>
      </div>
    )
  }

  const backHref = fromEnquiry ? "/enquiry" : "/login"
  const backLabel = fromEnquiry ? "Back to enquiry" : "Back to Login"

  const signUpForm = (
    <div className="w-full max-w-[300px] mx-auto space-y-5">
      <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Create Account</h2>
      <p className="text-xs text-muted-foreground">Register with your work email and a secure password.</p>

      {submitError && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm text-left">{submitError}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 text-left">
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Email Address</label>
          <Input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => set("email", e.target.value)}
            className={errors.email ? "border-destructive bg-[#e8ecf4] border" : "bg-[#e8ecf4] border-0"}
            autoComplete="email"
          />
          {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Password</label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => set("password", e.target.value)}
              className={errors.password ? "border-destructive pr-10" : "bg-[#e8ecf4] border-0 pr-10"}
              autoComplete="new-password"
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
          {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Confirm Password</label>
          <div className="relative">
            <Input
              type={showConfirmPassword ? "text" : "password"}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => set("confirmPassword", e.target.value)}
              className={errors.confirmPassword ? "border-destructive pr-10" : "bg-[#e8ecf4] border-0 pr-10"}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.confirmPassword && <p className="text-xs text-destructive mt-1">{errors.confirmPassword}</p>}
        </div>

        <p className="text-xs text-muted-foreground">
          By creating an account, you agree to our Terms of Service and Privacy Policy.
        </p>

        <Button type="submit" style={{ background: "var(--brand)" }} disabled={isLoading} className="w-full gap-2 rounded-xl">
          {isLoading ? (
            <>
              <Spinner size="sm" /> Creating...
            </>
          ) : (
            <>
              Create Account <CheckCircle size={14} />
            </>
          )}
        </Button>
      </form>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[920px] mx-auto px-4 sm:px-6 pt-8 pb-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-bold tracking-widest text-primary uppercase">Coliving</span>
            <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
          </div>
          <Link
            href={backHref}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 w-fit"
          >
            <ArrowLeft size={14} /> {backLabel}
          </Link>
        </div>

        <PortalSlidingAuthCard
          defaultMode="signup"
          signIn={
            <SlidingSignInPanel afterLogin={postRegisterHref} oauthEnquiry={fromEnquiry} />
          }
          signUp={signUpForm}
        />
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Spinner size="md" />
        </div>
      }
    >
      <RegisterPageInner />
    </Suspense>
  )
}
