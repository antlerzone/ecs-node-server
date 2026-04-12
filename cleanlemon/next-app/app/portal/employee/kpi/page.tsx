"use client"

import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fetchCleanlemonPricingConfig, fetchOperatorScheduleJobs, type EmployeeCleanerKpiPersisted } from "@/lib/cleanlemon-api"

type GoalCard = {
  id: string
  name: string
  status: "active" | "archived"
  goalItems?: Array<{
    id: string
    target: "team" | "person" | "company"
    minScore: number
  }>
  minScores?: {
    team?: number
  }
}

type TicketLog = {
  team?: string
  score?: number
}

function normalizeTeamName(v: unknown): string {
  return String(v || "").trim() || "Unassigned"
}

function detectEmployeeTeam(jobs: any[], user: { email?: string; name?: string; id?: string } | null): string | null {
  const keys = new Set<string>()
  const email = String(user?.email || "").trim().toLowerCase()
  const name = String(user?.name || "").trim().toLowerCase()
  const id = String(user?.id || "").trim().toLowerCase()
  if (email) keys.add(email)
  if (email.includes("@")) keys.add(email.split("@")[0])
  if (name) keys.add(name)
  if (id) keys.add(id)
  if (keys.size === 0) return null

  const teamCount = new Map<string, number>()
  for (const job of jobs) {
    const rawTeam = normalizeTeamName(job?.teamName || job?.team)
    const candidates = [
      String(job?.staffEmail || ""),
      String(job?.staffName || ""),
      String(job?.cleanerName || ""),
      String(job?.assignedTo || ""),
      String(job?.submitBy || ""),
    ]
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)

    const matched = candidates.some((x) => {
      if (keys.has(x)) return true
      for (const key of keys) {
        if (!key) continue
        if (x.includes(key) || key.includes(x)) return true
      }
      return false
    })
    if (!matched) continue
    teamCount.set(rawTeam, (teamCount.get(rawTeam) || 0) + 1)
  }

  if (teamCount.size === 0) return null
  return Array.from(teamCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

export default function EmployeeKPIPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<any[]>([])
  const [goals, setGoals] = useState<GoalCard[]>([])
  const [deductionLogs, setDeductionLogs] = useState<TicketLog[]>([])
  const [allowanceLogs, setAllowanceLogs] = useState<TicketLog[]>([])
  const [selectedGoalId, setSelectedGoalId] = useState("")
  const [resolvedTeam, setResolvedTeam] = useState<string | null>(null)

  const operatorId = useMemo(() => {
    if (typeof window !== "undefined") {
      const fromLayout = localStorage.getItem("cleanlemons_employee_operator_id")
      if (fromLayout) return fromLayout
    }
    return user?.operatorId || "op_demo_001"
  }, [user?.operatorId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [cfgR, jobsR] = await Promise.all([
        fetchCleanlemonPricingConfig(operatorId),
        fetchOperatorScheduleJobs(),
      ])
      if (cancelled) return

      const kpi = (cfgR.ok && cfgR.config?.employeeCleanerKpi
        ? cfgR.config.employeeCleanerKpi
        : {}) as Partial<EmployeeCleanerKpiPersisted>
      const goalCards = Array.isArray(kpi.goalCards)
        ? (kpi.goalCards as GoalCard[]).filter((g) => g.status !== "archived")
        : []
      const listJobs = Array.isArray(jobsR?.items) ? jobsR.items : []

      setGoals(goalCards)
      setSelectedGoalId(goalCards[0]?.id || "")
      setDeductionLogs(Array.isArray(kpi.deductionLogs) ? kpi.deductionLogs : [])
      setAllowanceLogs(Array.isArray(kpi.allowanceLogs) ? kpi.allowanceLogs : [])
      setJobs(listJobs)
      setResolvedTeam(detectEmployeeTeam(listJobs, user))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId, user])

  const selectedGoal = useMemo(
    () => goals.find((g) => g.id === selectedGoalId) || null,
    [goals, selectedGoalId],
  )

  const teamTarget = useMemo(() => {
    if (!selectedGoal) return 0
    const fromGoalItems = selectedGoal.goalItems?.find((x) => x.target === "team")?.minScore
    const fromLegacy = selectedGoal.minScores?.team
    return Number(fromGoalItems ?? fromLegacy ?? 0)
  }, [selectedGoal])

  const teamScoreMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const job of jobs) {
      const team = normalizeTeamName(job?.teamName || job?.team)
      m.set(team, (m.get(team) || 0) + 10)
    }
    for (const d of deductionLogs) {
      const team = normalizeTeamName(d.team)
      m.set(team, Math.max(0, (m.get(team) || 0) - (Number(d.score) || 0)))
    }
    for (const a of allowanceLogs) {
      const team = normalizeTeamName(a.team)
      m.set(team, (m.get(team) || 0) + (Number(a.score) || 0))
    }
    return m
  }, [jobs, deductionLogs, allowanceLogs])

  const myTeam = resolvedTeam || (teamScoreMap.size === 1 ? Array.from(teamScoreMap.keys())[0] : null)
  const myTeamScore = myTeam ? (teamScoreMap.get(myTeam) || 0) : 0
  const achieved = myTeamScore >= teamTarget
  const goalProgress = useMemo(() => {
    const target = Number(teamTarget) || 0
    const current = Number(myTeamScore) || 0
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
    const remaining = Math.max(0, target - current)
    return { target, current, pct, remaining }
  }, [teamTarget, myTeamScore])

  if (loading) {
    return <div className="py-10 text-sm text-muted-foreground">Loading KPI...</div>
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Team KPI</h1>
        <p className="text-muted-foreground">Based on the same report calculation used by operator KPI report.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Goal completion</p>
            <p className="text-2xl font-semibold">{goalProgress.pct}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Current score</p>
            <p className="text-2xl font-semibold">{goalProgress.current}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Remaining to target</p>
            <p className="text-2xl font-semibold">{goalProgress.remaining}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team KPI Report</CardTitle>
          <CardDescription>Only your team score is shown on employee side.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm space-y-2">
            <Label>Goal</Label>
            <Select value={selectedGoalId} onValueChange={setSelectedGoalId}>
              <SelectTrigger>
                <SelectValue placeholder="Select goal" />
              </SelectTrigger>
              <SelectContent>
                {goals.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!selectedGoal ? (
            <p className="text-sm text-muted-foreground">No active goal found. Please create goal in KPI Settings first.</p>
          ) : !myTeam ? (
            <p className="text-sm text-muted-foreground">Cannot detect your team yet. Please ensure your schedule jobs are assigned to your account/team.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">My team</p>
                    <p className="text-2xl font-semibold">{myTeam}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">Current score</p>
                    <p className="text-2xl font-semibold">{myTeamScore}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">Goal target</p>
                    <p className="text-2xl font-semibold">{teamTarget}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-right">Current score</TableHead>
                      <TableHead className="text-right">Goal target</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>{myTeam}</TableCell>
                      <TableCell className="text-right">{myTeamScore}</TableCell>
                      <TableCell className="text-right">{teamTarget}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={achieved ? "default" : "secondary"}>{achieved ? "On target" : "Below target"}</Badge>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
