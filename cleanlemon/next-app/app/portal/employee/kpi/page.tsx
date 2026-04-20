"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  fetchCleanlemonPricingConfig,
  fetchOperatorScheduleJobs,
  type EmployeeCleanerKpiPersisted,
} from "@/lib/cleanlemon-api"
import { ChevronDown, ChevronUp } from "lucide-react"

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

type KpiPersistedLog = {
  id: string
  team: string
  remark: string
  score: number
  actionDate?: string
  createdAt: string
}

type UnifiedLogRow = {
  id: string
  kind: "deduct" | "add"
  team: string
  remark: string
  score: number
  atSort: string
  day: string
}

function normalizeTeamName(v: unknown): string {
  return String(v || "").trim() || "Unassigned"
}

function extractDayFromStamp(iso: string): string {
  const s = String(iso || "").trim()
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  try {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  } catch {
    /* ignore */
  }
  return ""
}

function dayInRange(day: string, from: string, to: string): boolean {
  if (!day) {
    if (from || to) return false
    return true
  }
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

function detectEmployeeTeam(jobs: any[], user: { email?: string; name?: string; id?: string } | null): string | null {
  const keys = new Set<string>()
  const email = String(user?.email || "").trim().toLowerCase()
  const name = String(user?.name || "").trim().toLowerCase()
  const id = String(user?.id || "").trim().toLowerCase()
  if (email) keys.add(email)
  if (email.includes("@")) keys.add(email.split("@")[0] || "")
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

const PAGE_SIZES = [10, 20, 50, 100, 200] as const

export default function EmployeeKPIPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<any[]>([])
  const [goals, setGoals] = useState<GoalCard[]>([])
  const [deductionLogs, setDeductionLogs] = useState<KpiPersistedLog[]>([])
  const [allowanceLogs, setAllowanceLogs] = useState<KpiPersistedLog[]>([])
  const [selectedGoalId, setSelectedGoalId] = useState("")
  const [resolvedTeam, setResolvedTeam] = useState<string | null>(null)

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [filterKind, setFilterKind] = useState<"all" | "add" | "deduct">("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10)

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
      setDeductionLogs(Array.isArray(kpi.deductionLogs) ? (kpi.deductionLogs as KpiPersistedLog[]) : [])
      setAllowanceLogs(Array.isArray(kpi.allowanceLogs) ? (kpi.allowanceLogs as KpiPersistedLog[]) : [])
      setJobs(listJobs)
      setResolvedTeam(detectEmployeeTeam(listJobs, user))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId, user])

  useEffect(() => {
    if (loading) return
    if (goals.length === 0) {
      router.replace("/employee")
    }
  }, [loading, goals.length, router])

  useEffect(() => {
    setPage(1)
  }, [filterFrom, filterTo, filterKind, pageSize, selectedGoalId])

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
  const myTeamScore = myTeam ? teamScoreMap.get(myTeam) || 0 : 0
  const achieved = myTeamScore >= teamTarget
  const goalProgress = useMemo(() => {
    const target = Number(teamTarget) || 0
    const current = Number(myTeamScore) || 0
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
    const remaining = Math.max(0, target - current)
    return { target, current, pct, remaining }
  }, [teamTarget, myTeamScore])

  const unifiedLogs = useMemo(() => {
    const want = myTeam ? normalizeTeamName(myTeam) : ""
    const out: UnifiedLogRow[] = []
    for (const d of deductionLogs) {
      if (want && normalizeTeamName(d.team) !== want) continue
      const at = String(d.actionDate || d.createdAt || "")
      out.push({
        id: `d-${d.id}`,
        kind: "deduct",
        team: d.team,
        remark: d.remark,
        score: Number(d.score) || 0,
        atSort: at,
        day: extractDayFromStamp(at),
      })
    }
    for (const a of allowanceLogs) {
      if (want && normalizeTeamName(a.team) !== want) continue
      const at = String(a.actionDate || a.createdAt || "")
      out.push({
        id: `a-${a.id}`,
        kind: "add",
        team: a.team,
        remark: a.remark,
        score: Number(a.score) || 0,
        atSort: at,
        day: extractDayFromStamp(at),
      })
    }
    return out.sort((x, y) => String(y.atSort).localeCompare(String(x.atSort)))
  }, [deductionLogs, allowanceLogs, myTeam])

  const filteredLogs = useMemo(() => {
    return unifiedLogs.filter((row) => {
      if (filterKind === "add" && row.kind !== "add") return false
      if (filterKind === "deduct" && row.kind !== "deduct") return false
      if (!dayInRange(row.day, filterFrom, filterTo)) return false
      return true
    })
  }, [unifiedLogs, filterFrom, filterTo, filterKind])

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageSlice = useMemo(() => {
    const p = Math.min(Math.max(1, page), totalPages)
    const start = (p - 1) * pageSize
    return filteredLogs.slice(start, start + pageSize)
  }, [filteredLogs, page, pageSize, totalPages])

  if (loading) {
    return <div className="py-10 text-sm text-muted-foreground">Loading KPI...</div>
  }

  if (goals.length === 0) {
    return (
      <div className="py-10 text-sm text-muted-foreground">
        No KPI goals for this operator. Redirecting…
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Team KPI</h1>
        <p className="text-muted-foreground">Based on the same report calculation used by operator KPI report.</p>
      </div>

      {/* Mobile: one compact row of three stats */}
      <div className="grid grid-cols-3 gap-2 md:hidden">
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-muted/30 px-1 py-2.5 text-center">
          <p className="text-[9px] font-medium uppercase leading-tight text-muted-foreground">Goal</p>
          <p className="text-base font-bold tabular-nums leading-tight text-foreground">{goalProgress.pct}%</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-muted/30 px-1 py-2.5 text-center">
          <p className="text-[9px] font-medium uppercase leading-tight text-muted-foreground">Score</p>
          <p className="text-base font-bold tabular-nums leading-tight text-foreground">{goalProgress.current}</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-muted/30 px-1 py-2.5 text-center">
          <p className="text-[9px] font-medium uppercase leading-tight text-muted-foreground">Left</p>
          <p className="text-base font-bold tabular-nums leading-tight text-foreground">{goalProgress.remaining}</p>
        </div>
      </div>

      {/* Desktop: same metrics, readable cards */}
      <div className="hidden gap-4 md:grid md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Goal completion</p>
            <p className="text-2xl font-semibold tabular-nums">{goalProgress.pct}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Current score</p>
            <p className="text-2xl font-semibold tabular-nums">{goalProgress.current}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Remaining to target</p>
            <p className="text-2xl font-semibold tabular-nums">{goalProgress.remaining}</p>
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
            <p className="text-sm text-muted-foreground">No active goal found.</p>
          ) : !myTeam ? (
            <p className="text-sm text-muted-foreground">
              Cannot detect your team yet. Please ensure your schedule jobs are assigned to your account/team.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-3 md:gap-4">
                <Card>
                  <CardContent className="p-4 md:pt-6">
                    <p className="text-xs md:text-sm text-muted-foreground">My team</p>
                    <p className="text-lg md:text-2xl font-semibold truncate">{myTeam}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 md:pt-6">
                    <p className="text-xs md:text-sm text-muted-foreground">Current score</p>
                    <p className="text-lg md:text-2xl font-semibold tabular-nums">{myTeamScore}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 md:pt-6">
                    <p className="text-xs md:text-sm text-muted-foreground">Goal target</p>
                    <p className="text-lg md:text-2xl font-semibold tabular-nums">{teamTarget}</p>
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
                      <TableCell className="text-right tabular-nums">{myTeamScore}</TableCell>
                      <TableCell className="text-right tabular-nums">{teamTarget}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={achieved ? "default" : "secondary"}>
                          {achieved ? "On target" : "Below target"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {myTeam ? (
        <Card>
          <CardHeader>
            <CardTitle>Score log</CardTitle>
            <CardDescription>Add and deduct entries for your team (from operator KPI settings).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setFiltersOpen((o) => !o)}
              >
                Filters
                {filtersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
              {filtersOpen ? (
                <div className="mt-3 space-y-3 rounded-lg border bg-muted/20 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">From date</Label>
                      <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">To date</Label>
                      <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
                    </div>
                  </div>
                  <div className="max-w-xs space-y-1.5">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={filterKind}
                      onValueChange={(v) => setFilterKind(v as "all" | "add" | "deduct")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="add">Add</SelectItem>
                        <SelectItem value="deduct">Deduct</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Type</TableHead>
                    <TableHead className="whitespace-nowrap">Date</TableHead>
                    <TableHead>Remark</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageSlice.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground text-sm">
                        No log entries match your filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pageSlice.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Badge variant={row.kind === "add" ? "default" : "destructive"}>
                            {row.kind === "add" ? "Add" : "Deduct"}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {row.day || "—"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">{row.remark || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {row.kind === "add" ? "+" : "-"}
                          {row.score}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Rows per page</span>
                {PAGE_SIZES.map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant={pageSize === n ? "secondary" : "outline"}
                    size="sm"
                    className="h-8 min-w-[2.5rem] px-2"
                    onClick={() => setPageSize(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {filteredLogs.length === 0
                    ? "0"
                    : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filteredLogs.length)}`}{" "}
                  of {filteredLogs.length}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <span className="text-xs tabular-nums">
                  Page {safePage} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
