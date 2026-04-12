"use client"

import { useAuth } from "@/lib/auth-context"
import { EmployeeCleanerKpiSettings } from "./employee-cleaner-kpi-settings"

export default function KPISettingsPage() {
  const { user } = useAuth()
  const operatorId = user?.operatorId || "op_demo_001"

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">KPI Settings</h1>
          <p className="text-muted-foreground">Configure KPI points with filter, sort and search</p>
        </div>
      </div>
      <EmployeeCleanerKpiSettings operatorId={operatorId} />
    </div>
  )
}
