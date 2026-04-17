"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CheckCircle, Eye, EyeOff } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { GovIdConnectButtons } from "@/components/gov-id-connect-buttons"
import { isDemoSite, shouldUseDemoMock } from "@/lib/portal-api"

function getEcsBase(): string {
  return (process.env.NEXT_PUBLIC_ECS_BASE_URL ?? "").replace(/\/$/, "")
}

export function SlidingRegisterPanel({
  nextPath = "/enquiry",
  /** When set, show MyDigital / Singpass under the form (same as sign-in). */
  govIdReturnPath,
  emailHint,
}: {
  /** Post-success “Continue” target (must be same-origin path) */
  nextPath?: string
  govIdReturnPath?: string
  emailHint?: string
}) {
  const postRegisterHref =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/login"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState("")

  useEffect(() => {
    if (emailHint?.trim()) setEmail(emailHint.trim())
  }, [emailHint])

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
        setSubmitError("An account with this email already exists. Use Sign in on the left.")
      } else if (data.reason === "NO_EMAIL" || data.reason === "INVALID_PASSWORD") {
        setSubmitError(data.reason === "INVALID_PASSWORD" ? "Invalid password." : "Email is required.")
      } else {
        setSubmitError(data.reason ?? "Registration failed. Please try again.")
      }
    } catch {
      setSubmitError("Network error. Check that the API is running and CORS allows this site. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="w-full max-w-[300px] mx-auto space-y-5 text-center py-2">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
          <CheckCircle size={28} className="text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Account ready</h2>
        <p className="text-sm text-muted-foreground">
          You can sign in with your email and password. Google sign-in works too if your email matches.
        </p>
        <Link
          href={postRegisterHref}
          style={{ background: "var(--brand)" }}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 w-full"
        >
          {postRegisterHref === "/enquiry" ? "Continue to onboarding" : "Continue"}
        </Link>
      </div>
    )
  }

  return (
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
            className={errors.email ? "border-destructive" : "bg-[var(--brand-muted)] border-0"}
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
              className={errors.password ? "border-destructive pr-10" : "bg-[var(--brand-muted)] border-0 pr-10"}
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
              className={errors.confirmPassword ? "border-destructive pr-10" : "bg-[var(--brand-muted)] border-0 pr-10"}
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

      {govIdReturnPath ? (
        <GovIdConnectButtons
          returnPath={govIdReturnPath}
          variant="stacked"
          appearance="enquiry"
          disabled={isLoading || shouldUseDemoMock()}
        />
      ) : null}
    </div>
  )
}
