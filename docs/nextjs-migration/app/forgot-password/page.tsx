"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { ArrowLeft, Mail } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { isDemoSite } from "@/lib/portal-api"

function getEcsBase(): string {
  return (process.env.NEXT_PUBLIC_ECS_BASE_URL ?? "").replace(/\/$/, "")
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) {
      setError("Please enter your email address.")
      return
    }
    setError("")
    setIsLoading(true)
    try {
      if (isDemoSite()) {
        setSent(true)
        return
      }
      const base = getEcsBase()
      if (!base) {
        setError("API not configured.")
        setIsLoading(false)
        return
      }
      const res = await fetch(`${base}/api/portal-auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed })
      })
      const data = await res.json().catch(() => ({}))
      if (data.ok) {
        setSent(true)
      } else {
        if (data.reason === "NO_EMAIL") {
          setError("Please enter your email.")
        } else if (data.reason === "DB_ERROR" || data.message === "client not found") {
          setError("Service temporarily unavailable. Please try again later or contact support.")
        } else {
          setError("Something went wrong. Please try again.")
        }
      }
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Check your email</h1>
          <p className="text-muted-foreground mb-6">
            If an account exists for <strong>{email.trim()}</strong>, we’ve sent a verification code. Use it on the reset password page to set a new password. The code expires in 30 minutes.
          </p>
          <Link
            href="/reset-password"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white font-semibold hover:opacity-90"
            style={{ background: "var(--brand)" }}
          >
            Enter code and new password
          </Link>
          <p className="mt-6">
            <Link href="/login" className="text-sm text-primary hover:underline">Back to Login</Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full">
        <div className="mb-6">
          <a
            href="/login"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={15} /> Back to Login
          </a>
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Forgot password?</h1>
        <p className="text-muted-foreground mb-6">
          Enter your email and we’ll send you a verification code to reset your password.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">
              Email Address
            </label>
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError("") }}
              className="w-full"
              autoComplete="email"
            />
          </div>
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full gap-2"
            style={{ background: "var(--brand)" }}
          >
            {isLoading ? <><Spinner size="sm" /> Sending...</> : <><Mail size={16} /> Send verification code</>}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/enquiry" className="text-primary hover:underline">Contact us</Link> if you need help.
        </p>
      </div>
    </div>
  )
}
