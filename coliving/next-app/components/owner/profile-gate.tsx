"use client"

import { useEffect, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useOwnerOptional } from "@/contexts/owner-context"
import { isDemoSite } from "@/lib/portal-api"

/** Only the profile route counts — `/owner` is the dashboard and must redirect when incomplete (same idea as tenant gate). */
function isProfilePath(path: string): boolean {
  return path === "/owner/profile"
}

function isAgreementPath(path: string): boolean {
  return path === "/owner/agreement"
}

export default function OwnerProfileGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const state = useOwnerOptional()

  useEffect(() => {
    if (!state) return
    if (state.loading) return
    if (typeof window !== "undefined" && isDemoSite()) return

    if (!state.profileComplete && !isProfilePath(pathname)) {
      router.replace("/owner/profile?gate=required")
      return
    }

    if (state.hasPendingAgreement && !isProfilePath(pathname) && !isAgreementPath(pathname)) {
      router.replace("/owner/agreement")
    }
  }, [state, pathname, router])

  if (!state) return <>{children}</>

  if (state.loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return <>{children}</>
}
