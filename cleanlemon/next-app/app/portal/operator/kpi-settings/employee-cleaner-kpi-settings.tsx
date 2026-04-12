"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { Loader2, MoreHorizontal, Plus, Copy, Archive, Pencil, Settings2, Trash2 } from "lucide-react"
import {
  CLEANLEMON_OPERATOR_SERVICES,
  labelForOperatorService,
  type CleanlemonOperatorServiceKey,
} from "@/lib/cleanlemon-operator-services"
import {
  fetchCleanlemonPricingConfig,
  saveCleanlemonPricingConfig,
  type CleanlemonPricingConfig,
  type EmployeeCleanerKpiPersisted,
} from "@/lib/cleanlemon-api"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type GoalPeriod = "week" | "month" | "quarter"
type PageTab = "kpi_setting"

type StaffKpiRuleCard = {
  id: string
  serviceProvider: string
  countBy: "by_price" | "by_room" | "by_job"
  rewardMode: "fixed" | "percentage"
  rewardValue: number
  createdAt: string
}
type GoalTarget = "team" | "person" | "company"
type GoalItem = { id: string; target: GoalTarget; minScore: number }
type GoalCard = {
  id: string
  name: string
  period: GoalPeriod
  startDate: string
  endDate: string
  goalItems: GoalItem[]
  remark: string
  status: "active" | "archived"
  createdAt: string
  updatedAt: string
}

const PERIOD_LABEL: Record<GoalPeriod, string> = {
  week: "By week",
  month: "By month",
  quarter: "By quarter",
}

function mkId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toYmd(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function normalizeDate(input?: string): Date {
  if (!input) return new Date()
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function quickEndDateByPeriod(startDate: string, period: GoalPeriod): string {
  const start = normalizeDate(startDate)
  if (period === "week") {
    return toYmd(addDays(start, 6))
  }
  if (period === "month") {
    const y = start.getFullYear()
    const m = start.getMonth()
    return toYmd(new Date(y, m + 1, 0))
  }
  const y = start.getFullYear()
  const m = start.getMonth()
  const quarter = Math.floor(m / 3)
  const quarterEndMonth = quarter * 3 + 2
  return toYmd(new Date(y, quarterEndMonth + 1, 0))
}

export function EmployeeCleanerKpiSettings({ operatorId }: { operatorId: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<PageTab>("kpi_setting")
  const [fullConfig, setFullConfig] = useState<CleanlemonPricingConfig | null>(null)
  const [legacyEk, setLegacyEk] = useState<Partial<EmployeeCleanerKpiPersisted>>({})
  const [goalCards, setGoalCards] = useState<GoalCard[]>([])

  const [goalDialogOpen, setGoalDialogOpen] = useState(false)
  const [goalDialogMode, setGoalDialogMode] = useState<"create" | "edit">("create")
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null)
  const [goalForm, setGoalForm] = useState({
    name: "",
    period: "week" as GoalPeriod,
    startDate: todayYmd(),
    endDate: quickEndDateByPeriod(todayYmd(), "week"),
    goalItems: [{ id: mkId("goal-item"), target: "team" as GoalTarget, minScore: 0 }] as GoalItem[],
    remark: "",
  })

  const [setKpiDialogOpen, setSetKpiDialogOpen] = useState(false)
  const [staffKpiCardsDraft, setStaffKpiCardsDraft] = useState<StaffKpiRuleCard[]>([])
  const [kpiRuleDialogOpen, setKpiRuleDialogOpen] = useState(false)
  const [kpiRuleForm, setKpiRuleForm] = useState({
    serviceProvider: "",
    countBy: "by_job" as "by_price" | "by_room" | "by_job",
    rewardMode: "fixed" as "fixed" | "percentage",
    rewardValue: 0,
  })

  const countByHint =
    kpiRuleForm.countBy === "by_job"
      ? "By job = fixed points per job, regardless of price."
      : kpiRuleForm.countBy === "by_price"
        ? "By price = percentage of the job amount (example: 10% of RM90 = 9 points)."
        : "By room = number of rooms x fixed points (example: 4 rooms x 5 = 20 points)."
  const rewardHint =
    kpiRuleForm.rewardMode === "percentage"
      ? "Enter percentage value (for by price only)."
      : "Enter fixed points value."

  const reload = useCallback(async () => {
    setLoading(true)
    const cfgR = await fetchCleanlemonPricingConfig(operatorId)

    if (!cfgR.ok) {
      setFullConfig(null)
      setLoading(false)
      return
    }
    const cfg = (cfgR.config as CleanlemonPricingConfig | null | undefined) ?? {
      selectedServices: [],
      activeServiceTab: "general",
      serviceConfigs: {},
      bookingMode: "instant",
      leadTime: "same_day",
    }
    setFullConfig(cfg)

    const ek = (cfg.employeeCleanerKpi || {}) as Partial<EmployeeCleanerKpiPersisted>
    setLegacyEk(ek)
    const normalizedGoals = ((ek.goalCards || []) as any[]).map((g) => {
      const goalItems: GoalItem[] = Array.isArray(g.goalItems)
        ? g.goalItems.map((it: any) => ({
            id: String(it.id || mkId("goal-item")),
            target: (it.target === "team" || it.target === "person" || it.target === "company") ? it.target : "team",
            minScore: Number(it.minScore) || 0,
          }))
        : [
            { id: mkId("goal-item"), target: "team" as GoalTarget, minScore: Number(g?.minScores?.team) || 0 },
            { id: mkId("goal-item"), target: "person" as GoalTarget, minScore: Number(g?.minScores?.person) || 0 },
            { id: mkId("goal-item"), target: "company" as GoalTarget, minScore: Number(g?.minScores?.company) || 0 },
          ].filter((x) => x.minScore > 0)
      return {
        id: String(g.id || mkId("goal")),
        name: String(g.name || "Untitled Goal"),
        period: (g.period === "week" || g.period === "month" || g.period === "quarter") ? g.period : "week",
        startDate: String(g.startDate || todayYmd()),
        endDate: String(g.endDate || quickEndDateByPeriod(String(g.startDate || todayYmd()), (g.period === "week" || g.period === "month" || g.period === "quarter") ? g.period : "week")),
        goalItems: goalItems.length > 0 ? goalItems : [{ id: mkId("goal-item"), target: "team", minScore: 0 }],
        remark: String(g.remark || ""),
        status: g.status === "archived" ? "archived" : "active",
        createdAt: String(g.createdAt || nowIso()),
        updatedAt: String(g.updatedAt || nowIso()),
      } as GoalCard
    })
    setGoalCards(normalizedGoals)

    setLoading(false)
  }, [operatorId])

  useEffect(() => {
    reload()
  }, [reload])

  const persistAll = async (
    nextGoalCards: GoalCard[] = goalCards,
    nextLegacyEk: Partial<EmployeeCleanerKpiPersisted> = legacyEk,
  ) => {
    if (!fullConfig) return false
    setSaving(true)
    const latest = await fetchCleanlemonPricingConfig(operatorId)
    const base = (latest.ok && latest.config ? latest.config : fullConfig) as CleanlemonPricingConfig
    const employeeCleanerKpi: EmployeeCleanerKpiPersisted = {
      ...nextLegacyEk,
      goalCards: nextGoalCards,
    } as EmployeeCleanerKpiPersisted
    const payload: CleanlemonPricingConfig = { ...base, employeeCleanerKpi }
    const r = await saveCleanlemonPricingConfig(operatorId, payload)
    setSaving(false)
    if (!r.ok) {
      toast.error(`Save failed (${r.reason || "unknown"})`)
      return false
    }
    setFullConfig(payload)
    setLegacyEk(employeeCleanerKpi)
    return true
  }

  const persistAndSync = async (
    nextGoalCards: GoalCard[],
  ) => {
    setGoalCards(nextGoalCards)
    await persistAll(nextGoalCards)
  }

  const selectedServices = useMemo((): CleanlemonOperatorServiceKey[] => {
    const list = fullConfig?.selectedServices
    if (!Array.isArray(list)) return []
    const allowed = new Set(CLEANLEMON_OPERATOR_SERVICES.map((s) => s.key))
    return list.filter((k): k is CleanlemonOperatorServiceKey => typeof k === "string" && allowed.has(k as CleanlemonOperatorServiceKey))
  }, [fullConfig])

  const openCreateGoal = () => {
    setGoalDialogMode("create")
    setEditingGoalId(null)
    setGoalForm({
      name: "",
      period: "week",
      startDate: todayYmd(),
      endDate: quickEndDateByPeriod(todayYmd(), "week"),
      goalItems: [{ id: mkId("goal-item"), target: "team", minScore: 0 }],
      remark: "",
    })
    setGoalDialogOpen(true)
  }

  const openEditGoal = (card: GoalCard) => {
    setGoalDialogMode("edit")
    setEditingGoalId(card.id)
    setGoalForm({
      name: card.name,
      period: card.period,
      startDate: card.startDate,
      endDate: card.endDate,
      goalItems: card.goalItems.map((item) => ({ ...item })),
      remark: card.remark || "",
    })
    setGoalDialogOpen(true)
  }

  const addGoalItem = () => {
    setGoalForm((prev) => ({
      ...prev,
      goalItems: [...prev.goalItems, { id: mkId("goal-item"), target: "team", minScore: 0 }],
    }))
  }

  const removeGoalItem = (id: string) => {
    setGoalForm((prev) => {
      const next = prev.goalItems.filter((item) => item.id !== id)
      return {
        ...prev,
        goalItems: next.length > 0 ? next : [{ id: mkId("goal-item"), target: "team", minScore: 0 }],
      }
    })
  }

  const submitGoalDialog = () => {
    if (!goalForm.name.trim()) {
      toast.error("Goal name is required")
      return
    }
    if (goalDialogMode === "create") {
      const t = nowIso()
      const created: GoalCard = {
        id: mkId("goal"),
        name: goalForm.name.trim(),
        period: goalForm.period,
        startDate: goalForm.startDate,
        endDate: goalForm.endDate,
        goalItems: goalForm.goalItems.map((it) => ({ ...it, minScore: Math.max(0, Number(it.minScore) || 0) })),
        remark: goalForm.remark.trim(),
        status: "active",
        createdAt: t,
        updatedAt: t,
      }
      const next = [created, ...goalCards]
      void persistAndSync(next)
      toast.success("Goal card created")
    } else if (editingGoalId) {
      const next = goalCards.map((card) =>
          card.id === editingGoalId
            ? {
                ...card,
                name: goalForm.name.trim(),
                period: goalForm.period,
                startDate: goalForm.startDate,
                endDate: goalForm.endDate,
                goalItems: goalForm.goalItems.map((it) => ({ ...it, minScore: Math.max(0, Number(it.minScore) || 0) })),
                remark: goalForm.remark.trim(),
                updatedAt: nowIso(),
              }
            : card,
      )
      void persistAndSync(next)
      toast.success("Goal card updated")
    }
    setGoalDialogOpen(false)
  }

  const duplicateGoalCard = (card: GoalCard) => {
    const t = nowIso()
    const duplicated: GoalCard = {
      ...card,
      id: mkId("goal"),
      name: `${card.name} (Copy)`,
      createdAt: t,
      updatedAt: t,
      status: "active",
    }
    const next = [duplicated, ...goalCards]
    void persistAndSync(next)
    toast.success("Goal card duplicated")
  }

  const archiveGoalCard = (cardId: string) => {
    const next = goalCards.map((c) => (c.id === cardId ? { ...c, status: "archived", updatedAt: nowIso() } : c))
    void persistAndSync(next)
    toast.success("Goal card archived")
  }

  const openSetKpiDialog = () => {
    const fallbackRulesFromGoal = goalCards.find((g: any) => Array.isArray(g?.staffKpiRules))?.staffKpiRules || []
    const globalRules = (legacyEk as any)?.serviceKpiRules
    setStaffKpiCardsDraft(Array.isArray(globalRules) ? globalRules : fallbackRulesFromGoal)
    setSetKpiDialogOpen(true)
  }

  const saveSetKpiDialog = () => {
    const nextLegacyEk: Partial<EmployeeCleanerKpiPersisted> = {
      ...legacyEk,
      serviceKpiRules: [...staffKpiCardsDraft],
    }
    void persistAll(goalCards, nextLegacyEk)
    setSetKpiDialogOpen(false)
    toast.success("KPI rules updated")
  }

  const openAddKpiRuleDialog = () => {
    const defaultCountBy: "by_price" | "by_room" | "by_job" = "by_job"
    setKpiRuleForm({
      serviceProvider: selectedServices[0] || "",
      countBy: defaultCountBy,
      rewardMode: defaultCountBy === "by_price" ? "percentage" : "fixed",
      rewardValue: 0,
    })
    setKpiRuleDialogOpen(true)
  }

  const saveKpiRuleDialog = () => {
    if (!kpiRuleForm.serviceProvider) {
      toast.error("Service provider is required")
      return
    }
    if (kpiRuleForm.rewardValue <= 0) {
      toast.error("Value must be more than 0")
      return
    }
    const enforcedMode: "fixed" | "percentage" = kpiRuleForm.countBy === "by_price" ? "percentage" : "fixed"
    const next: StaffKpiRuleCard = {
      id: mkId("staff-kpi-rule"),
      serviceProvider: kpiRuleForm.serviceProvider,
      countBy: kpiRuleForm.countBy,
      rewardMode: enforcedMode,
      rewardValue: kpiRuleForm.rewardValue,
      createdAt: nowIso(),
    }
    setStaffKpiCardsDraft((prev) => [next, ...prev])
    setKpiRuleDialogOpen(false)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-12">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading KPI settings...
      </div>
    )
  }

  if (!fullConfig) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pricing not available</CardTitle>
          <CardDescription>Could not load operator pricing. Check API and operator ID.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">KPI controls</h2>
          <p className="text-sm text-muted-foreground">Manage goal and KPI rule settings in one place.</p>
        </div>
        {saving ? <p className="text-xs text-muted-foreground">Saving...</p> : null}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PageTab)} className="w-full">
        <TabsList className="grid grid-cols-1 w-full max-w-xl">
          <TabsTrigger value="kpi_setting">KPI Setting</TabsTrigger>
        </TabsList>

        <TabsContent value="kpi_setting" className="space-y-4 mt-4">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={openSetKpiDialog}>
              <Settings2 className="h-4 w-4 mr-2" />
              KPI Setting
            </Button>
            <Button size="sm" onClick={openCreateGoal}>
              <Plus className="h-4 w-4 mr-2" />
              Add Goal
            </Button>
          </div>

          {goalCards.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">No goal card yet. Click Add to create one.</CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {goalCards.map((card) => (
                <Card key={card.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{card.name}</CardTitle>
                        <CardDescription>
                          {PERIOD_LABEL[card.period]} · {card.startDate} to {card.endDate}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={card.status === "archived" ? "secondary" : "outline"}>{card.status}</Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditGoal(card)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => duplicateGoalCard(card)}>
                              <Copy className="h-4 w-4 mr-2" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => archiveGoalCard(card.id)}>
                              <Archive className="h-4 w-4 mr-2" />
                              Archived
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {card.goalItems.map((item) => (
                      <p key={item.id}>
                        Minimum per <strong>{item.target}</strong>: <strong>{item.minScore}</strong>
                      </p>
                    ))}
                    {card.remark ? <p className="text-muted-foreground">Remark: {card.remark}</p> : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

      </Tabs>

      <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{goalDialogMode === "create" ? "Create goal card" : "Edit goal card"}</DialogTitle>
            <DialogDescription>Set period and minimum scores for this KPI goal card.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Goal name</Label>
              <Input value={goalForm.name} onChange={(e) => setGoalForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. March KPI Goal" />
            </div>
            <div className="space-y-2">
              <Label>Between date</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={goalForm.startDate}
                  onChange={(e) =>
                    setGoalForm((p) => ({
                      ...p,
                      startDate: e.target.value,
                    }))
                  }
                />
                <Input
                  type="date"
                  value={goalForm.endDate}
                  onChange={(e) =>
                    setGoalForm((p) => ({
                      ...p,
                      endDate: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Period quick action</Label>
              <Select
                value={goalForm.period}
                onValueChange={(v) =>
                  setGoalForm((p) => {
                    const period = v as GoalPeriod
                    return {
                      ...p,
                      period,
                      endDate: quickEndDateByPeriod(p.startDate, period),
                    }
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">By week</SelectItem>
                  <SelectItem value="month">By month</SelectItem>
                  <SelectItem value="quarter">By quarter</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Quick action uses start date to auto-calculate end date.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Goal cards</Label>
                <Button type="button" size="sm" variant="outline" onClick={addGoalItem}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add card
                </Button>
              </div>
              <div className="space-y-2">
                {goalForm.goalItems.map((item) => (
                  <div key={item.id} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5 space-y-1">
                      <Label className="text-xs">Minimum for</Label>
                      <Select
                        value={item.target}
                        onValueChange={(v) =>
                          setGoalForm((prev) => ({
                            ...prev,
                            goalItems: prev.goalItems.map((x) => (x.id === item.id ? { ...x, target: v as GoalTarget } : x)),
                          }))
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="team">Team</SelectItem>
                          <SelectItem value="person">Person</SelectItem>
                          <SelectItem value="company">Company</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-5 space-y-1">
                      <Label className="text-xs">Minimum score</Label>
                      <Input
                        type="number"
                        min={0}
                        value={item.minScore}
                        onChange={(e) =>
                          setGoalForm((prev) => ({
                            ...prev,
                            goalItems: prev.goalItems.map((x) =>
                              x.id === item.id ? { ...x, minScore: Number(e.target.value) || 0 } : x,
                            ),
                          }))
                        }
                      />
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeGoalItem(item.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Remark</Label>
              <Textarea
                value={goalForm.remark}
                onChange={(e) => setGoalForm((p) => ({ ...p, remark: e.target.value }))}
                placeholder="Input remark for this goal card..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitGoalDialog}>{goalDialogMode === "create" ? "Create" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={setKpiDialogOpen} onOpenChange={setSetKpiDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Set KPI</DialogTitle>
            <DialogDescription>
              Configure all services provider individual KPI setting in this period, and how to count KPI for each service.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <Label className="text-base">Staff KPI setting cards</Label>
              <Button size="sm" onClick={openAddKpiRuleDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
            {staffKpiCardsDraft.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  No KPI card yet. Click Add to create one.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {staffKpiCardsDraft.map((rule) => (
                  <Card key={rule.id}>
                    <CardContent className="pt-4 text-sm space-y-1">
                      <p><strong>Service:</strong> {labelForOperatorService(rule.serviceProvider)}</p>
                      <p><strong>Count by:</strong> {rule.countBy}</p>
                      <p>
                        <strong>Each complete can get:</strong>{" "}
                        {rule.countBy === "by_job" && `fixed ${rule.rewardValue} points / job`}
                        {rule.countBy === "by_price" && `${rule.rewardValue}% of job price`}
                        {rule.countBy === "by_room" && `${rule.rewardValue} points x number of rooms`}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetKpiDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveSetKpiDialog}>Save KPI rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={kpiRuleDialogOpen} onOpenChange={setKpiRuleDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add KPI card</DialogTitle>
            <DialogDescription>Set service provider and KPI reward method.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Services provider</Label>
              <Select value={kpiRuleForm.serviceProvider} onValueChange={(v) => setKpiRuleForm((p) => ({ ...p, serviceProvider: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {selectedServices.map((s) => (
                    <SelectItem key={s} value={s}>{labelForOperatorService(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Count KPI by</Label>
              <Select
                value={kpiRuleForm.countBy}
                onValueChange={(v) => {
                  const nextCountBy = v as "by_price" | "by_room" | "by_job"
                  setKpiRuleForm((p) => ({
                    ...p,
                    countBy: nextCountBy,
                    rewardMode: nextCountBy === "by_price" ? "percentage" : "fixed",
                  }))
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="by_price">By price</SelectItem>
                  <SelectItem value="by_room">By room</SelectItem>
                  <SelectItem value="by_job">By job</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {countByHint}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Each complete can get</Label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={kpiRuleForm.rewardMode} disabled>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="percentage">Percentage</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" min={0} value={kpiRuleForm.rewardValue} onChange={(e) => setKpiRuleForm((p) => ({ ...p, rewardValue: Number(e.target.value) || 0 }))} />
              </div>
              <p className="text-xs text-muted-foreground">
                {rewardHint}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKpiRuleDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveKpiRuleDialog}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
