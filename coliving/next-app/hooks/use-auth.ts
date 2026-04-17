"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getMember, clearPortalSession } from "@/lib/portal-session"
import { isDemoSite } from "@/lib/portal-api"

export type UserRole = "tenant" | "owner" | "operator" | "saas_admin"

export interface UserData {
  email: string
  name: string
  roles: UserRole[]
}

function toFrontendRole(type: string): UserRole {
  if (type === "staff") return "operator"
  if (type === "tenant" || type === "owner" || type === "saas_admin") return type as UserRole
  return type as UserRole
}

export function useAuth(requiredRole?: UserRole) {
  const router = useRouter()
  const [user, setUser] = useState<UserData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    function proceed(member: { email: string; roles?: { type: string }[] } | null) {
      if (!member?.email) {
        router.push("/login")
        return
      }
      // roles 可為空（例如僅在 operatordetail 的公司 email）；有 email 即視為已登入
      let roles: UserRole[] = (member.roles || []).map((r) => toFrontendRole(r.type))
    // Demo: allow entry to tenant & owner portals without backend; treat as having the required role
    if (typeof window !== "undefined" && isDemoSite() && requiredRole) {
      if (requiredRole === "tenant" || requiredRole === "owner") {
        if (!roles.includes(requiredRole)) roles = [...roles, requiredRole]
      }
    }
    const userData: UserData = {
      email: member.email,
      name: member.email.split("@")[0],
      roles,
    }
      if (requiredRole && !roles.includes(requiredRole)) {
        router.push("/portal")
        return
      }
      setUser(userData)
      setIsLoading(false)
    }

    let member = getMember()
    if (!member?.email) {
      // 避免 hydration 時 localStorage 尚未就緒就重定向；短暫延遲再檢查一次
      const t = setTimeout(() => {
        member = getMember()
        if (member?.email) proceed(member)
        else router.push("/login")
      }, 150)
      return () => clearTimeout(t)
    }
    proceed(member)
  }, [router, requiredRole])

  const logout = () => {
    clearPortalSession()
    if (typeof window !== "undefined") localStorage.removeItem("user")
    router.push("/login")
  }

  return { user, isLoading, logout }
}
