"use client"

import { useEffect, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useTenantOptional } from "@/contexts/tenant-context"
import { isDemoSite } from "@/lib/portal-api"
import {
  getTenantGateRedirectUrl,
  isDemoprofilePath,
  isTenantPathAllowedForGateLayer,
  normalizeTenantPathname,
} from "@/lib/tenant-gates"

function isProfilePath(path: string): boolean {
  return normalizeTenantPathname(path) === "/tenant/profile"
}

export default function ProfileGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const state = useTenantOptional()

  useEffect(() => {
    if (!state) return
    if (state.loading) return
    // Demo: no profile requirement, no redirects – open all permission
    if (typeof window !== "undefined" && isDemoSite()) return
    // Demo profile page (portal live + demo): never redirect away for gate layers
    if (isDemoprofilePath(pathname)) return

    const noTenant = !state.tenant
    if (noTenant && !isProfilePath(pathname)) {
      router.replace("/tenant/profile")
      return
    }

    const layer = state.gateLayer

    if (!isProfilePath(pathname) && layer === 1) {
      router.replace(getTenantGateRedirectUrl(1))
      return
    }

    if (layer !== "open" && pathname.startsWith("/tenant") && !isTenantPathAllowedForGateLayer(pathname, layer)) {
      router.replace(getTenantGateRedirectUrl(layer))
      return
    }
  }, [state, pathname, router])

  if (!state) return <>{children}</>

  if (state.loading && !isDemoprofilePath(pathname)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return <>{children}</>
}
