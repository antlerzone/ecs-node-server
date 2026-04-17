"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { User, Shield, LayoutGrid, ArrowRight, LogOut, Settings2, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getMember, clearPortalSession, setMember } from "@/lib/portal-session"
import { isDemoSite, getApiDocsMyAccess, getMemberRoles } from "@/lib/portal-api"

type UserRole = "tenant" | "owner" | "operator" | "saas_admin"

interface UserData {
  email: string
  name: string
  roles: UserRole[]
}

interface PortalItem {
  href: string
  icon: React.ComponentType<{ size?: number }>
  title: string
  desc: string
  role: UserRole
  showToAll?: boolean
  apiDocsOnly?: boolean
}

// Portal 顯示規則（portal.colivingjb.com/portal）：
// - Tenant Portal: 谁都可以登入，不 filter，一律顯示 card
// - Owner Portal: 谁都可以登入，不 filter，一律顯示 card
// - Operator: 只有 client（該公司 staff）看到 card，只有 operator 才能登入
// - SaaS Admin: 固定 3 個 email（saasadmin 表）
// - API Docs: 只有有 API access 的才看到 card
const allPortals: PortalItem[] = [
  {
    href: "/tenant",
    icon: User,
    title: "Tenant Portal",
    desc: "Manage your room, payments, and access.",
    role: "tenant" as UserRole,
    showToAll: true,
  },
  {
    href: "/owner",
    icon: Shield,
    title: "Owner Portal",
    desc: "Track property performance and payouts.",
    role: "owner" as UserRole,
    showToAll: true,
  },
  {
    href: "/operator",
    icon: LayoutGrid,
    title: "Operator Portal",
    desc: "Manage properties, tenants, and staff.",
    role: "operator" as UserRole,
  },
  {
    href: "/saas-admin",
    icon: Settings2,
    title: "SaaS Admin",
    desc: "Manage clients, credits, and pricing plans.",
    role: "saas_admin" as UserRole,
  },
  {
    href: "/docs",
    icon: BookOpen,
    title: "API Docs",
    desc: "API documentation for operator integration.",
    role: "operator" as UserRole,
    apiDocsOnly: true,
  },
]

/** Billplz redirect 會帶 billplz[paid]=true；此時 JWT/portal_member 的 roles 可能仍為付款前快照，需向後端重拉 member-roles。 */
function isBillplzPaidReturn(sp: ReturnType<typeof useSearchParams>): boolean {
  const paid = sp.get("billplz[paid]") ?? sp.get("billplz%5Bpaid%5D")
  return paid === "true" || paid === "1"
}

/**
 * Xendit enquiry / 方案款回跳：常見為 plan_finalize=(pricingplanlogs id) 且 paid=1。
 * 若 Dashboard 只設 success URL 帶 paid=1（無 plan_finalize），同樣觸發重拉 roles 以顯示 Operator card。
 */
function isXenditEnquiryPortalReturn(sp: ReturnType<typeof useSearchParams>): boolean {
  if (sp.get("plan_finalize")?.trim()) return true
  if (sp.get("paid") === "1") return true
  return false
}

/** 任一付款完成回跳到 /portal：需輪詢直到 getMemberRoles 含 staff（Operator card） */
function isPostPaymentPortalReturn(sp: ReturnType<typeof useSearchParams>): boolean {
  return isBillplzPaidReturn(sp) || isXenditEnquiryPortalReturn(sp)
}

function memberRolesToUserData(email: string, roles: { type: string }[]): UserData {
  const mapped: UserRole[] = (roles || []).map((r) =>
    r.type === "staff" ? "operator" : (r.type as UserRole)
  )
  return {
    email,
    name: email.split("@")[0],
    roles: mapped,
  }
}

function PortalSelectionPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<UserData | null>(null)
  const [hasApiDocsAccess, setHasApiDocsAccess] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  /** Billplz / Xendit enquiry 回跳後正在向後端同步 roles（含 webhook 延遲重試） */
  const [syncingPostPaymentRoles, setSyncingPostPaymentRoles] = useState(false)

  useEffect(() => {
    // Check if user is logged in (portal_member is source of truth; fallback to user for legacy)
    const member = getMember()
    if (member?.email && Array.isArray(member.roles)) {
      // 有 email 即視為已登入；roles 可為空（例如僅在 operatordetail 的公司 email，尚未有 staff/tenant/owner 身分）
      const roles: UserRole[] = (member.roles || []).map((r) =>
        r.type === "staff" ? "operator" : (r.type as UserRole)
      )
      setUser({
        email: member.email,
        name: member.email.split("@")[0],
        roles,
      })
    } else {
      const userData = localStorage.getItem("user")
      if (!userData) {
        router.push("/login")
        return
      }
      try {
        const parsed = JSON.parse(userData) as UserData
        setUser(parsed)
      } catch {
        router.push("/login")
      }
    }
    setIsLoading(false)
  }, [router])

  useEffect(() => {
    if (!user?.email || isDemoSite()) return
    getApiDocsMyAccess(user.email).then((r) => setHasApiDocsAccess(r.hasAccess))
  }, [user?.email])

  useEffect(() => {
    if (!user?.email || isDemoSite()) return
    if (!isPostPaymentPortalReturn(searchParams)) return

    let cancelled = false
    const email = user.email

    ;(async () => {
      setSyncingPostPaymentRoles(true)
      const maxAttempts = 12
      const delayMs = 1200
      for (let i = 0; i < maxAttempts; i++) {
        if (cancelled) return
        const r = await getMemberRoles(email)
        if (cancelled) return
        const roles = r.roles ?? []
        const hasStaff = roles.some((x) => x.type === "staff")
        setMember({ email, roles })
        setUser(memberRolesToUserData(email, roles))
        if (hasStaff || i === maxAttempts - 1) {
          const docs = await getApiDocsMyAccess(email)
          if (!cancelled) setHasApiDocsAccess(docs.hasAccess)
          break
        }
        await new Promise((res) => setTimeout(res, delayMs))
      }
      if (!cancelled) {
        router.replace("/portal", { scroll: false })
      }
      if (!cancelled) setSyncingPostPaymentRoles(false)
    })()

    return () => {
      cancelled = true
    }
  }, [user?.email, searchParams, router])

  const handleLogout = () => {
    clearPortalSession()
    if (typeof window !== "undefined") localStorage.removeItem("user")
    router.push("/login")
  }

  // Filter: showToAll → 顯示；apiDocsOnly → 僅 hasApiDocsAccess；否則僅當 user.roles 含該 role 時顯示
  const accessiblePortals = isDemoSite()
    ? allPortals.filter((portal) => portal.href !== "/saas-admin" && portal.href !== "/docs")
    : (user ? allPortals.filter(portal => {
        if (portal.apiDocsOnly) return hasApiDocsAccess
        return portal.showToAll || user.roles.includes(portal.role)
      }) : [])

  if (isLoading || syncingPostPaymentRoles) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">
            {syncingPostPaymentRoles ? "Updating your portal access after payment…" : "Loading..."}
          </p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md">
        {/* Header with user info */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-sm text-muted-foreground">Welcome back,</p>
            <p className="font-bold text-foreground">{user.name}</p>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleLogout}
            className="gap-2 text-muted-foreground hover:text-destructive"
          >
            <LogOut size={16} /> Logout
          </Button>
        </div>

        {/* Logo */}
        <div className="text-center mb-10">
          <div className="flex flex-col items-center leading-tight mb-6">
            <span className="text-2xl font-black tracking-widest uppercase text-primary">Coliving</span>
            <span className="text-xs tracking-[0.35em] text-muted-foreground uppercase">Management</span>
          </div>
          <h1 className="text-2xl font-black text-foreground mb-2">Select Your Portal</h1>
          <p className="text-sm text-muted-foreground">
            {isDemoSite() ? "Choose a portal to explore (demo – no backend)." : `You have access to ${accessiblePortals.length} portal${accessiblePortals.length !== 1 ? "s" : ""}.`}
          </p>
        </div>

        {/* Portal Options */}
        <div className="flex flex-col gap-4">
          {accessiblePortals.map((portal) => (
            <Link
              key={portal.href}
              href={portal.href}
              className="group flex items-center gap-4 bg-card border border-border rounded-2xl p-5 hover:border-primary hover:shadow-md transition-all"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--brand-muted)" }}
              >
                <portal.icon size={22} style={{ color: "var(--brand)" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-foreground">{portal.title}</div>
                <div className="text-sm text-muted-foreground">{portal.desc}</div>
              </div>
              <ArrowRight size={18} className="text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
            </Link>
          ))}
        </div>

        {accessiblePortals.length === 0 && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">You don't have access to any portals.</p>
            <p className="text-sm text-muted-foreground mt-2">Please contact your administrator.</p>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground mt-8">
          <a href="https://www.colivingjb.com" className="hover:underline">Back to Home</a>
        </p>
      </div>
    </div>
  )
}

export default function PortalSelectionPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
      }
    >
      <PortalSelectionPageInner />
    </Suspense>
  )
}
