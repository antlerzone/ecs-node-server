"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { fetchOperatorAgreements } from "@/lib/cleanlemon-api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileSignature, Building2, User } from "lucide-react"
import {
  filterOperatorsForPortal,
  hasOperatorBindingsForPortal,
} from "@/lib/cleanlemons-portal-helpers"

function normalize(v: unknown): string {
  return String(v || "").trim().toLowerCase()
}

export default function EmployeeDashboard() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [agreePendingCount, setAgreePendingCount] = useState(0)

  const hasStaffBinding = hasOperatorBindingsForPortal(user?.cleanlemons, "staff")
  const staffOperators = useMemo(
    () => filterOperatorsForPortal(user?.cleanlemons, "staff"),
    [user?.cleanlemons]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasStaffBinding) {
        setAgreePendingCount(0)
        setLoading(false)
        return
      }
      setLoading(true)
      const email = normalize(user?.email)
      const name = normalize(user?.name)
      const ag = await fetchOperatorAgreements()
      if (cancelled) return
      const allAg = Array.isArray(ag?.items) ? ag.items : []
      const minePending = allAg.filter((x: Record<string, unknown>) => {
        const type = normalize(x?.recipientType || "employee")
        const em = normalize(x?.recipientEmail)
        const nm = normalize(x?.recipientName)
        const st = normalize(x?.status)
        const mine = (email && em === email) || (name && nm && (nm.includes(name) || name.includes(nm)))
        return type === "employee" && mine && st !== "signed"
      })
      setAgreePendingCount(minePending.length)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email, user?.name, hasStaffBinding])

  if (!hasStaffBinding) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Employee Dashboard</h2>
          <p className="text-muted-foreground">
            You are not linked to a company yet. Ask your operator to add you under Contacts, then return here.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Next step
            </CardTitle>
            <CardDescription>
              Complete your profile so we can match you when your company adds your email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/employee/profile">
                <User className="mr-2 h-4 w-4" />
                Open Profile
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Employee Dashboard</h2>
        <p className="text-muted-foreground">Your company links come from Operator Contacts — no invite approval needed.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Companies (staff)</p>
            <p className="text-2xl font-semibold">{staffOperators.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Pending agreement</p>
            <p className="text-2xl font-semibold">{loading ? "…" : agreePendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Shortcuts</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/employee/working">Working</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/employee/agreement">
                  <FileSignature className="mr-1 h-4 w-4" />
                  Agreement
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
