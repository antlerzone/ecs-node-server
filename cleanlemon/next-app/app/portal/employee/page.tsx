"use client"

import { Suspense, useEffect } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { EmployeeDashboardSchedule } from "@/components/portal/employee/employee-dashboard-schedule"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Building2, User } from "lucide-react"
import { hasOperatorBindingsForPortal } from "@/lib/cleanlemons-portal-helpers"

function ScrollToScheduleWhenTab() {
  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get("tab") !== "schedule") return
    const id = window.setTimeout(() => {
      document.getElementById("employee-schedule")?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 100)
    return () => window.clearTimeout(id)
  }, [searchParams])
  return null
}

export default function EmployeeDashboard() {
  const { user } = useAuth()
  const hasStaffBinding = hasOperatorBindingsForPortal(user?.cleanlemons, "staff")

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
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Your schedule is below. Hover Team in the top bar to see who is on your team.</p>
      </div>

      <Suspense fallback={null}>
        <ScrollToScheduleWhenTab />
      </Suspense>

      <EmployeeDashboardSchedule />
    </div>
  )
}
