"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getMember, getCurrentRole, clearPortalSession } from "@/lib/portal-session"
import type { PortalMember, CurrentRole } from "@/lib/portal-session"

export function usePortalSession(required: boolean = true) {
  const router = useRouter()
  const [member, setMember] = useState<PortalMember | null>(null)
  const [currentRole, setCurrentRoleState] = useState<CurrentRole | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const m = getMember()
    const r = getCurrentRole()
    if (required && (!m?.email || !m?.roles?.length)) {
      router.push("/login")
      return
    }
    setMember(m ?? null)
    setCurrentRoleState(r ?? null)
    setIsLoading(false)
  }, [router, required])

  const logout = () => {
    clearPortalSession()
    if (typeof window !== "undefined") localStorage.removeItem("user")
    router.push("/login")
  }

  return {
    member,
    currentRole,
    email: member?.email ?? null,
    clientId: currentRole?.clientId ?? null,
    isLoading,
    logout,
  }
}
