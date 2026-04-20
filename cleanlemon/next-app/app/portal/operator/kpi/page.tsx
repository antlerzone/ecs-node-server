"use client"

import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "sonner"
import { Check, ListFilter, MoreHorizontal, Pencil, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchCleanlemonPricingConfig, fetchOperatorScheduleJobs, saveCleanlemonPricingConfig, type CleanlemonPricingConfig, type EmployeeCleanerKpiPersisted } from "@/lib/cleanlemon-api"

type GoalTarget = "team" | "person" | "company"
type GoalCard = {
  id: string
  name: string
  status: "active" | "archived"
  goalItems?: Array<{
    id: string
    target: GoalTarget
    minScore: number
  }>
}

type TicketStatus = "pending" | "approved" | "void"
type TicketActionKind = "deduct" | "allowance"
type DeductionTicket = {
  id: string
  actionKind: TicketActionKind
  team: string
  staff: string
  submitBy: string
  pointDeduct: number
  content: string
  status: TicketStatus
  actionDate?: string
  createdAt: string
}

export default function KPIPage() {
  const { user } = useAuth()
  const operatorId = user?.operatorId || "op_demo_001"
  const [activeTab, setActiveTab] = useState<"dashboard" | "report">("dashboard")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fullConfig, setFullConfig] = useState<CleanlemonPricingConfig | null>(null)
  const [ek, setEk] = useState<Partial<EmployeeCleanerKpiPersisted>>({})
  const [goalCards, setGoalCards] = useState<GoalCard[]>([])
  const [jobs, setJobs] = useState<any[]>([])
  const [tickets, setTickets] = useState<DeductionTicket[]>([])
  const [selectedGoalId, setSelectedGoalId] = useState<string>("")
  const [editingTicket, setEditingTicket] = useState<DeductionTicket | null>(null)
  const [editPoints, setEditPoints] = useState(0)
  const [editContent, setEditContent] = useState("")
  const [editActionDate, setEditActionDate] = useState("")
  const [ticketSearch, setTicketSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all")
  const [contentKeyword, setContentKeyword] = useState("")
  const [teamFilter, setTeamFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [ticketFiltersExpanded, setTicketFiltersExpanded] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    actionKind: "deduct" as TicketActionKind,
    assignBy: "team" as "team" | "staff",
    team: "",
    staff: "",
    pointDeduct: 0,
    content: "",
    actionDate: new Date().toISOString().slice(0, 10),
  })

  const persistTickets = async (nextTickets: DeductionTicket[]) => {
    if (!fullConfig) return
    setSaving(true)
    const latest = await fetchCleanlemonPricingConfig(operatorId)
    const base = (latest.ok && latest.config ? latest.config : fullConfig) as CleanlemonPricingConfig
    const nextEk: Partial<EmployeeCleanerKpiPersisted> = {
      ...ek,
      deductionLogs: nextTickets
        .filter((t) => t.actionKind === "deduct")
        .map((t) => ({
          id: t.id,
          team: t.team,
          remark: t.content,
          score: t.pointDeduct,
          actionDate: t.actionDate || t.createdAt.slice(0, 10),
          createdAt: t.createdAt,
        })),
      allowanceLogs: nextTickets
        .filter((t) => t.actionKind === "allowance")
        .map((t) => ({
        id: t.id,
        team: t.team,
        remark: t.content,
        score: t.pointDeduct,
        actionDate: t.actionDate || t.createdAt.slice(0, 10),
        createdAt: t.createdAt,
      })),
    }
    const payload: CleanlemonPricingConfig = {
      ...base,
      employeeCleanerKpi: nextEk as EmployeeCleanerKpiPersisted,
    }
    const r = await saveCleanlemonPricingConfig(operatorId, payload)
    setSaving(false)
    if (!r.ok) {
      toast.error(`Save failed (${r.reason || "unknown"})`)
      return
    }
    setFullConfig(payload)
    setEk(nextEk)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [cfgR, jobsR] = await Promise.all([
        fetchCleanlemonPricingConfig(operatorId),
        fetchOperatorScheduleJobs({ operatorId, limit: 800 }),
      ])
      if (cancelled) return
      const cfg = (cfgR.ok && cfgR.config ? cfgR.config : null) as CleanlemonPricingConfig | null
      setFullConfig(cfg)
      const currentEk = (cfg?.employeeCleanerKpi || {}) as Partial<EmployeeCleanerKpiPersisted>
      setEk(currentEk)
      const goals = Array.isArray(currentEk.goalCards)
        ? (currentEk.goalCards as GoalCard[]).filter((g) => g.status !== "archived")
        : []
      setGoalCards(goals)
      setSelectedGoalId((prev) => prev || (goals[0]?.id || ""))
      const scheduleJobs = Array.isArray(jobsR?.items) ? jobsR.items : []
      setJobs(scheduleJobs)
      const logs = Array.isArray(currentEk.deductionLogs) ? currentEk.deductionLogs : []
      const allowanceLogs = Array.isArray(currentEk.allowanceLogs) ? currentEk.allowanceLogs : []
      const mappedDeductTickets: DeductionTicket[] = logs.map((x) => ({
        id: String(x.id || `ticket-${Date.now()}`),
        actionKind: "deduct",
        team: String(x.team || "Unassigned"),
        staff: "N/A",
        submitBy: "system",
        pointDeduct: Number(x.score) || 0,
        content: String(x.remark || ""),
        status: "pending",
        actionDate: String(x.actionDate || x.createdAt || "").slice(0, 10),
        createdAt: String(x.createdAt || new Date().toISOString()),
      }))
      const mappedAllowanceTickets: DeductionTicket[] = allowanceLogs.map((x) => ({
        id: String(x.id || `ticket-${Date.now()}`),
        actionKind: "allowance",
        team: String(x.team || "Unassigned"),
        staff: "N/A",
        submitBy: "system",
        pointDeduct: Number(x.score) || 0,
        content: String(x.remark || ""),
        status: "pending",
        actionDate: String(x.actionDate || x.createdAt || "").slice(0, 10),
        createdAt: String(x.createdAt || new Date().toISOString()),
      }))
      setTickets([...mappedDeductTickets, ...mappedAllowanceTickets])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  const selectedGoal = useMemo(
    () => goalCards.find((g) => g.id === selectedGoalId) || null,
    [goalCards, selectedGoalId],
  )

  const pendingCount = tickets.filter((t) => t.status === "pending").length
  const approvedCount = tickets.filter((t) => t.status === "approved").length
  const voidCount = tickets.filter((t) => t.status === "void").length
  const teamOptions = useMemo(() => {
    const set = new Set<string>()
    for (const t of tickets) set.add(t.team || "Unassigned")
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [tickets])

  const filteredTickets = useMemo(() => {
    const key = ticketSearch.trim().toLowerCase()
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null
    return tickets.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false
      if (contentKeyword.trim() && !t.content.toLowerCase().includes(contentKeyword.trim().toLowerCase())) return false
      if (teamFilter !== "all" && t.team !== teamFilter) return false
      if (key) {
        const text = `${t.team} ${t.staff} ${t.submitBy} ${t.content}`.toLowerCase()
        if (!text.includes(key)) return false
      }
      const ts = new Date(t.createdAt).getTime()
      if (fromMs != null && ts < fromMs) return false
      if (toMs != null && ts > toMs) return false
      return true
    })
  }, [tickets, statusFilter, contentKeyword, teamFilter, ticketSearch, dateFrom, dateTo])

  const hasActiveTicketFilters = useMemo(
    () =>
      statusFilter !== "all" ||
      Boolean(contentKeyword.trim()) ||
      teamFilter !== "all" ||
      Boolean(dateFrom) ||
      Boolean(dateTo),
    [statusFilter, contentKeyword, teamFilter, dateFrom, dateTo],
  )

  const updateTicketStatus = (id: string, status: TicketStatus) => {
    const next = tickets.map((t) => (t.id === id ? { ...t, status } : t))
    setTickets(next)
    void persistTickets(next)
  }

  const saveEditTicket = () => {
    if (!editingTicket) return
    if (editPoints <= 0) {
      toast.error("Point deduct must be > 0")
      return
    }
    const next = tickets.map((t) =>
      t.id === editingTicket.id ? { ...t, pointDeduct: editPoints, content: editContent, actionDate: editActionDate } : t,
    )
    setTickets(next)
    void persistTickets(next)
    setEditingTicket(null)
    toast.success("Ticket updated")
  }

  const createTicket = () => {
    if (createForm.assignBy === "team" && !createForm.team.trim()) {
      toast.error("Please select team")
      return
    }
    if (createForm.assignBy === "staff" && !createForm.staff.trim()) {
      toast.error("Please select staff")
      return
    }
    if (!createForm.content.trim()) {
      toast.error("Please input content")
      return
    }
    if (createForm.pointDeduct <= 0) {
      toast.error(createForm.actionKind === "allowance" ? "Point allowance must be > 0" : "Point deduct must be > 0")
      return
    }
    const inferredTeam =
      createForm.assignBy === "team"
        ? createForm.team.trim()
        : String(jobs.find((j) => String(j?.staffName || j?.cleanerName || j?.assignedTo || "") === createForm.staff)?.teamName || jobs.find((j) => String(j?.staffName || j?.cleanerName || j?.assignedTo || "") === createForm.staff)?.team || "Unassigned")
    const nextTicket: DeductionTicket = {
      id: `ticket-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      actionKind: createForm.actionKind,
      team: inferredTeam,
      staff: createForm.assignBy === "staff" ? createForm.staff.trim() : "N/A",
      submitBy: "manual",
      pointDeduct: createForm.pointDeduct,
      content: createForm.content.trim(),
      status: "pending",
      actionDate: createForm.actionDate,
      createdAt: `${createForm.actionDate || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
    }
    const next = [nextTicket, ...tickets]
    setTickets(next)
    void persistTickets(next)
    setCreateOpen(false)
    setCreateForm({
      actionKind: "deduct",
      assignBy: "team",
      team: "",
      staff: "",
      pointDeduct: 0,
      content: "",
      actionDate: new Date().toISOString().slice(0, 10),
    })
    toast.success("Ticket created")
  }

  const reportSections = useMemo(() => {
    if (!selectedGoal) return []
    const targets = Array.isArray(selectedGoal.goalItems) ? selectedGoal.goalItems : []
    if (targets.length === 0) return []

    const approvedByTeam = new Map<string, number>()
    for (const t of tickets) {
      if (t.status !== "approved") continue
      approvedByTeam.set(t.team, (approvedByTeam.get(t.team) || 0) + t.pointDeduct)
    }
    return targets.map((item) => {
      if (item.target === "company") {
        const totalDeduct = Array.from(approvedByTeam.values()).reduce((a, b) => a + b, 0)
        const score = Math.max(0, 10000 - totalDeduct)
        return {
          key: item.id,
          title: "By company",
          rows: [{ label: "Cleanlemons Operator", score, target: item.minScore }],
        }
      }
      if (item.target === "person") {
        const m = new Map<string, number>()
        for (const j of jobs) {
          const label = String(j?.staffName || j?.cleanerName || j?.assignedTo || "Unknown Staff")
          m.set(label, (m.get(label) || 0) + 10)
        }
        const rows = Array.from(m.entries())
          .map(([label, score]) => ({ label, score, target: item.minScore }))
          .sort((a, b) => a.label.localeCompare(b.label))
        return { key: item.id, title: "By person", rows }
      }
      const m = new Map<string, number>()
      for (const j of jobs) {
        const label = String(j?.teamName || j?.team || "Unassigned")
        m.set(label, (m.get(label) || 0) + 10)
      }
      for (const [team, deducted] of approvedByTeam.entries()) {
        m.set(team, (m.get(team) || 0) - deducted)
      }
      const rows = Array.from(m.entries())
        .map(([label, score]) => ({ label, score: Math.max(0, score), target: item.minScore }))
        .sort((a, b) => a.label.localeCompare(b.label))
      return { key: item.id, title: "By team", rows }
    })
  }, [selectedGoal, tickets, jobs])

  if (loading) {
    return <div className="py-10 text-sm text-muted-foreground">Loading KPI...</div>
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div>
        <h2 className="text-2xl font-bold text-foreground">KPI</h2>
        <p className="text-muted-foreground">Dashboard for approvals and report by goal settings.</p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "dashboard" | "report")}>
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-2 md:gap-4">
            <div className="flex aspect-square flex-col items-center justify-center rounded-xl border bg-card p-2 text-center shadow-sm md:aspect-auto md:min-h-0 md:rounded-lg md:p-6">
              <span className="text-[10px] font-semibold uppercase leading-tight text-muted-foreground md:text-sm md:normal-case">
                Pending
              </span>
              <span className="mt-0.5 text-xl font-bold tabular-nums md:mt-1 md:text-3xl">{pendingCount}</span>
            </div>
            <div className="flex aspect-square flex-col items-center justify-center rounded-xl border bg-card p-2 text-center shadow-sm md:aspect-auto md:min-h-0 md:rounded-lg md:p-6">
              <span className="text-[10px] font-semibold uppercase leading-tight text-muted-foreground md:text-sm md:normal-case">
                Approved
              </span>
              <span className="mt-0.5 text-xl font-bold tabular-nums md:mt-1 md:text-3xl">{approvedCount}</span>
            </div>
            <div className="flex aspect-square flex-col items-center justify-center rounded-xl border bg-card p-2 text-center shadow-sm md:aspect-auto md:min-h-0 md:rounded-lg md:p-6">
              <span className="text-[10px] font-semibold uppercase leading-tight text-muted-foreground md:text-sm md:normal-case">
                Void
              </span>
              <span className="mt-0.5 text-xl font-bold tabular-nums md:mt-1 md:text-3xl">{voidCount}</span>
            </div>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Attendance Deduction Tickets</CardTitle>
                  <CardDescription>
                    Content types: complaint, clean delay, late work in, early work out.
                  </CardDescription>
                </div>
                <Button size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
                  Create Ticket
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {saving ? <p className="text-xs text-muted-foreground mb-2">Saving...</p> : null}
              <div className="mb-4 flex flex-col gap-2">
                <div className="relative min-w-0">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={ticketSearch}
                    onChange={(e) => setTicketSearch(e.target.value)}
                    placeholder="Search team/staff/property..."
                  />
                </div>
                <Button
                  type="button"
                  variant={ticketFiltersExpanded ? "secondary" : "outline"}
                  className="w-full shrink-0 sm:w-auto"
                  onClick={() => setTicketFiltersExpanded((v) => !v)}
                  aria-expanded={ticketFiltersExpanded}
                >
                  <ListFilter className="mr-2 h-4 w-4" />
                  Filter
                  {hasActiveTicketFilters ? (
                    <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-primary" aria-hidden />
                  ) : null}
                </Button>
                {ticketFiltersExpanded ? (
                  <div className="grid w-full min-w-0 gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Status</Label>
                      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | TicketStatus)}>
                        <SelectTrigger className="border-input w-full bg-background">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All status</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="void">Void</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                      <Label className="text-xs text-muted-foreground">Content contains</Label>
                      <Input
                        value={contentKeyword}
                        onChange={(e) => setContentKeyword(e.target.value)}
                        placeholder="Filter content..."
                        className="border-input bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Team</Label>
                      <Select value={teamFilter} onValueChange={setTeamFilter}>
                        <SelectTrigger className="border-input w-full bg-background">
                          <SelectValue placeholder="Team" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All team</SelectItem>
                          {teamOptions.map((team) => (
                            <SelectItem key={team} value={team}>
                              {team}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
                      <Label className="text-xs text-muted-foreground">Created between</Label>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          type="date"
                          className="border-input bg-background"
                          value={dateFrom}
                          onChange={(e) => setDateFrom(e.target.value)}
                        />
                        <span className="hidden text-center text-muted-foreground sm:inline sm:shrink-0">–</span>
                        <Input
                          type="date"
                          className="border-input bg-background"
                          value={dateTo}
                          onChange={(e) => setDateTo(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="md:hidden space-y-3">
                {filteredTickets.length === 0 ? (
                  <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No ticket matched filter.</div>
                ) : (
                  filteredTickets.map((t) => (
                    <div
                      key={t.id}
                      className="flex gap-3 rounded-lg border bg-card p-3 shadow-sm"
                    >
                      <div className="min-w-0 flex-1 space-y-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            className={cn(
                              "shrink-0 text-[10px] uppercase",
                              t.status === "pending" && "bg-amber-100 text-amber-900 hover:bg-amber-100",
                              t.status === "approved" && "bg-emerald-100 text-emerald-900 hover:bg-emerald-100",
                              t.status === "void" && "bg-slate-100 text-slate-700 hover:bg-slate-100",
                            )}
                          >
                            {t.status}
                          </Badge>
                          <span className="font-medium">{t.team}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t.staff} · {t.submitBy} · {t.actionKind}
                        </p>
                        <p className="break-words text-foreground">{t.content}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>Points: {t.pointDeduct}</span>
                          <span>{t.actionDate || t.createdAt.slice(0, 10)}</span>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" aria-label="Actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => updateTicketStatus(t.id, "approved")}>
                            <Check className="mr-2 h-4 w-4" />
                            Approval
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateTicketStatus(t.id, "void")}>
                            <X className="mr-2 h-4 w-4" />
                            Void
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingTicket(t)
                              setEditPoints(t.pointDeduct)
                              setEditContent(t.content)
                              setEditActionDate(t.actionDate || t.createdAt.slice(0, 10))
                            }}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))
                )}
              </div>

              <div className="hidden overflow-hidden rounded-lg border md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead>Staff</TableHead>
                      <TableHead>Submit by</TableHead>
                      <TableHead>Action type</TableHead>
                      <TableHead>Content</TableHead>
                      <TableHead>Point deduct</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTickets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground">
                          No ticket matched filter.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTickets.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>{t.team}</TableCell>
                          <TableCell>{t.staff}</TableCell>
                          <TableCell>{t.submitBy}</TableCell>
                          <TableCell>{t.actionKind}</TableCell>
                          <TableCell>{t.content}</TableCell>
                          <TableCell>{t.pointDeduct}</TableCell>
                          <TableCell>{t.actionDate || t.createdAt.slice(0, 10)}</TableCell>
                          <TableCell>
                            <Badge variant={t.status === "pending" ? "secondary" : t.status === "approved" ? "default" : "outline"}>
                              {t.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => updateTicketStatus(t.id, "approved")}>
                                  <Check className="h-4 w-4 mr-2" />
                                  Approval
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => updateTicketStatus(t.id, "void")}>
                                  <X className="h-4 w-4 mr-2" />
                                  Void
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingTicket(t)
                                    setEditPoints(t.pointDeduct)
                                    setEditContent(t.content)
                                    setEditActionDate(t.actionDate || t.createdAt.slice(0, 10))
                                  }}
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="report" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>KPI Report</CardTitle>
              <CardDescription>Select existing goal and show report by goal target.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-w-sm space-y-2">
                <Label>Goal</Label>
                <Select value={selectedGoalId} onValueChange={setSelectedGoalId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select goal" />
                  </SelectTrigger>
                  <SelectContent>
                    {goalCards.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!selectedGoal ? (
                <p className="text-sm text-muted-foreground">No goal found. Please create goal in KPI Settings first.</p>
              ) : reportSections.length === 0 ? (
                <p className="text-sm text-muted-foreground">Selected goal has no target item.</p>
              ) : (
                <div className="space-y-4">
                  {reportSections.map((section) => (
                    <Card key={section.key}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{section.title}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="rounded-lg border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{section.title.replace("By ", "")}</TableHead>
                                <TableHead className="text-right">Current score</TableHead>
                                <TableHead className="text-right">Goal target</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {section.rows.map((r) => (
                                <TableRow key={r.label}>
                                  <TableCell>{r.label}</TableCell>
                                  <TableCell className="text-right">{r.score}</TableCell>
                                  <TableCell className="text-right">{r.target}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editingTicket != null} onOpenChange={(open) => !open && setEditingTicket(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit ticket</DialogTitle>
            <DialogDescription>Update content and deduction points.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Content</Label>
              <Input value={editContent} onChange={(e) => setEditContent(e.target.value)} placeholder="Input content" />
            </div>
            <div className="space-y-2">
              <Label>Point deduct</Label>
              <Input type="number" min={1} value={editPoints} onChange={(e) => setEditPoints(Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={editActionDate} onChange={(e) => setEditActionDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTicket(null)}>Cancel</Button>
            <Button onClick={saveEditTicket}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create ticket</DialogTitle>
            <DialogDescription>Create pending ticket for operator approval/void.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>First action</Label>
              <Select value={createForm.actionKind} onValueChange={(v) => setCreateForm((p) => ({ ...p, actionKind: v as TicketActionKind }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deduct">Deduct</SelectItem>
                    <SelectItem value="allowance">Point allowance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Assign by</Label>
              <Select
                value={createForm.assignBy}
                onValueChange={(v) =>
                  setCreateForm((p) => ({
                    ...p,
                    assignBy: v as "team" | "staff",
                    team: "",
                    staff: "",
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Content</Label>
              <Input value={createForm.content} onChange={(e) => setCreateForm((p) => ({ ...p, content: e.target.value }))} placeholder="Manual input content" />
            </div>
            {createForm.assignBy === "team" ? (
              <div className="space-y-2">
                <Label>Team</Label>
                <Select value={createForm.team} onValueChange={(v) => setCreateForm((p) => ({ ...p, team: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
                  <SelectContent>
                    {teamOptions.map((team) => (
                      <SelectItem key={team} value={team}>{team}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Staff</Label>
                <Select value={createForm.staff} onValueChange={(v) => setCreateForm((p) => ({ ...p, staff: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                  <SelectContent>
                    {Array.from(
                      new Set(
                        jobs
                          .map((j) => String(j?.staffName || j?.cleanerName || j?.assignedTo || "").trim())
                          .filter(Boolean),
                      ),
                    )
                      .sort((a, b) => a.localeCompare(b))
                      .map((staff) => (
                        <SelectItem key={staff} value={staff}>{staff}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>{createForm.actionKind === "allowance" ? "Point allowance" : "Point deduct"}</Label>
              <Input type="number" min={1} value={createForm.pointDeduct} onChange={(e) => setCreateForm((p) => ({ ...p, pointDeduct: Number(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={createForm.actionDate} onChange={(e) => setCreateForm((p) => ({ ...p, actionDate: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createTicket}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
