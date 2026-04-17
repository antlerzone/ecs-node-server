"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Spinner } from "@/components/ui/spinner"
import { PORTAL_KEYS, setMember } from "@/lib/portal-session"
import { isDemoSite } from "@/lib/portal-api"

function getEcsBase(): string {
  return (process.env.NEXT_PUBLIC_ECS_BASE_URL ?? "").replace(/\/$/, "")
}

/**
 * Try to close the OAuth popup. COOP / some browsers may no-op without throwing — we always show
 * the hint after a tick so users are not stuck on a blank tab (and DevTools may still log COOP).
 */
function tryClosePopup(setShowCloseHint: (show: boolean) => void) {
  queueMicrotask(() => {
    try {
      window.close()
    } catch {
      /* ignore */
    }
  })
  setTimeout(() => setShowCloseHint(true), 800)
}

function AuthCallbackContent() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [showCloseHint, setShowCloseHint] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    const token = new URLSearchParams(window.location.search).get("token")
    const isPopup = typeof window !== "undefined" && !!window.opener
    if (isDemoSite()) {
      const demoEmail = "demo@demo.com"
      if (isPopup && window.opener) {
        window.opener.postMessage(
          { type: "portal-oauth", ok: true, email: demoEmail, roles: [{ type: "staff" }] },
          window.location.origin
        )
        tryClosePopup(setShowCloseHint)
        return
      }
      setMember({ email: demoEmail, roles: [{ type: "staff", staffId: "demo-staff", clientId: "demo-client", clientTitle: "Demo Client" }] })
      router.replace("/portal")
      return
    }
    if (!token) {
      setError("Missing token")
      return
    }
    const base = getEcsBase()
    if (!base) {
      setError("API not configured")
      return
    }
    fetch(`${base}/api/portal-auth/verify?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; email?: string; roles?: { type: string }[] }) => {
        if (data?.ok && data.email && Array.isArray(data.roles)) {
          if (isPopup && window.opener) {
            const origin = window.location.origin
            window.opener.postMessage(
              { type: "portal-oauth", ok: true, email: data.email, roles: data.roles },
              origin
            )
            tryClosePopup(setShowCloseHint)
            return
          }
          setMember({ email: data.email, roles: data.roles })
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem(PORTAL_KEYS.PORTAL_JWT, token)
            } catch {
              /* ignore */
            }
            localStorage.setItem("user", JSON.stringify({
              email: data.email,
              name: data.email.split("@")[0],
              roles: data.roles.map((r) => (r.type === "staff" ? "operator" : r.type)),
            }))
          }
          const nextRaw = new URLSearchParams(window.location.search).get("next")
          const nextPath =
            nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/portal"
          router.replace(nextPath)
        } else {
          if (isPopup && window.opener) {
            window.opener.postMessage(
              { type: "portal-oauth", ok: false, reason: "Invalid or expired link." },
              window.location.origin
            )
            tryClosePopup(setShowCloseHint)
            return
          }
          setError("Invalid or expired link. Please sign in again.")
        }
      })
      .catch(() => {
        if (isPopup && window.opener) {
          window.opener.postMessage(
            { type: "portal-oauth", ok: false, reason: "Verification failed." },
            window.location.origin
          )
          tryClosePopup(setShowCloseHint)
          return
        }
        setError("Verification failed. Please try again.")
      })
  }, [router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-md">
          <p className="text-destructive mb-4">{error}</p>
          <a
            href="/login"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-primary border border-border hover:bg-muted"
          >
            Back to Login
          </a>
        </div>
      </div>
    )
  }

  if (showCloseHint) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-md">
          <p className="text-muted-foreground">Sign-in complete. You can close this window.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="md" />
        <p className="text-sm text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return <AuthCallbackContent />
}
