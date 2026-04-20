"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ChevronDown,
  Filter,
  HelpCircle,
  MoreHorizontal,
  Pencil,
  Check,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { fetchOperatorSettings } from "@/lib/cleanlemon-api"
import {
  buildWorkingWindow,
  computeDeviationsMinutes,
  computeMoneyFromDeviations,
  type MoneyRates,
} from "@/lib/employee-attendance-payroll"
const TZ = "Asia/Kuala_Lumpur"

type AttendanceRecord = {
  dateKey: string
  workingInIso: string
  workingOutIso: string | null
}

type RowStatus = "pending" | "approved" | "rejected"

type RowOverride = { status: RowStatus }

function storageKey(operatorId: string, email: string) {
  return `cln-emp-working-payroll-${operatorId}-${email.toLowerCase()}`
}

function loadOverrides(operatorId: string, email: string): Record<string, RowOverride> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(storageKey(operatorId, email))
    if (!raw) return {}
    const j = JSON.parse(raw)
    return typeof j === "object" && j !== null ? j : {}
  } catch {
    return {}
  }
}

function saveOverrides(operatorId: string, email: string, o: Record<string, RowOverride>) {
  localStorage.setItem(storageKey(operatorId, email), JSON.stringify(o))
}

const RATES_KEY = "cln-emp-working-rates"

function loadRates(): MoneyRates {
  if (typeof window === "undefined") {
    return {
      earlyArrivalPerMin: 0.5,
      latePerMin: 1,
      earlyLeavePerMin: 1,
      otPerHour: 15,
    }
  }
  try {
    const raw = localStorage.getItem(RATES_KEY)
    if (!raw) throw new Error("empty")
    const j = JSON.parse(raw)
    return {
      earlyArrivalPerMin: Number(j.earlyArrivalPerMin) || 0.5,
      latePerMin: Number(j.latePerMin) || 1,
      earlyLeavePerMin: Number(j.earlyLeavePerMin) || 1,
      otPerHour: Number(j.otPerHour) || 15,
    }
  } catch {
    return {
      earlyArrivalPerMin: 0.5,
      latePerMin: 1,
      earlyLeavePerMin: 1,
      otPerHour: 15,
    }
  }
}

function saveRates(r: MoneyRates) {
  localStorage.setItem(RATES_KEY, JSON.stringify(r))
}

function formatUtc8Date(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

function formatUtc8Time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-MY", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function EmployeeWorkingPayrollTable({
  operatorId,
  email,
  attendanceRecords,
}: {
  operatorId: string
  email: string
  attendanceRecords: AttendanceRecord[]
}) {
  const [whFrom, setWhFrom] = useState("")
  const [whTo, setWhTo] = useState("")
  const [rates, setRates] = useState<MoneyRates>(loadRates)
  const [overrides, setOverrides] = useState<Record<string, RowOverride>>({})
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"all" | RowStatus>("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editOpen, setEditOpen] = useState(false)
  const [editDateKey, setEditDateKey] = useState<string | null>(null)

  useEffect(() => {
    setOverrides(loadOverrides(operatorId, email))
  }, [operatorId, email])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await fetchOperatorSettings(operatorId)
      if (cancelled || !r?.ok || !r.settings) return
      const cp = r.settings.companyProfile
      if (cp && typeof cp === "object") {
        const raw = cp as Record<string, unknown>
        setWhFrom(String(raw.workingHourFrom || raw.working_hour_from || "").trim())
        setWhTo(String(raw.workingHourTo || raw.working_hour_to || "").trim())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  const win = useMemo(() => buildWorkingWindow(whFrom, whTo), [whFrom, whTo])

  const rows = useMemo(() => {
    const list: Array<{
      dateKey: string
      inIso: string
      outIso: string | null
      dev: ReturnType<typeof computeDeviationsMinutes>
      money: ReturnType<typeof computeMoneyFromDeviations> | null
      status: RowStatus
    }> = []
    for (const rec of attendanceRecords) {
      if (!rec.workingOutIso) continue
      const dev = computeDeviationsMinutes(rec, win)
      const money =
        dev && win
          ? computeMoneyFromDeviations(dev, rates)
          : null
      const st = overrides[rec.dateKey]?.status ?? ("pending" as RowStatus)
      list.push({
        dateKey: rec.dateKey,
        inIso: rec.workingInIso,
        outIso: rec.workingOutIso,
        dev,
        money,
        status: st,
      })
    }
    list.sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    return list
  }, [attendanceRecords, win, rates, overrides])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false
      const q = search.trim().toLowerCase()
      if (!q) return true
      const blob = `${r.dateKey} ${formatUtc8Date(r.inIso)}`.toLowerCase()
      return blob.includes(q)
    })
  }, [rows, search, statusFilter])

  const persistOverride = useCallback(
    (dateKey: string, patch: Partial<RowOverride>) => {
      setOverrides((prev) => {
        const prevRow = prev[dateKey]
        const status: RowStatus =
          patch.status ?? prevRow?.status ?? "pending"
        const next = { ...prev, [dateKey]: { status } }
        saveOverrides(operatorId, email, next)
        return next
      })
    },
    [operatorId, email]
  )

  const setStatusBulk = (keys: string[], status: RowStatus) => {
    setOverrides((prev) => {
      const next = { ...prev }
      for (const k of keys) {
        next[k] = { ...next[k], status }
      }
      saveOverrides(operatorId, email, next)
      return next
    })
    toast.success(status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Updated")
  }

  const allVisibleIds = filtered.map((r) => r.dateKey)
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id))
  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allVisibleIds))
  }

  const editRow = rows.find((r) => r.dateKey === editDateKey)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">OT, late &amp; early (vs company hours)</CardTitle>
        <CardDescription>
          Compared to Operator → Company <strong>Working hours</strong> ({whFrom || "—"} – {whTo || "—"}). Set
          rates below; amounts are illustrative until payroll is linked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!whFrom || !whTo ? (
          <p className="text-sm text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2">
            Company working hours are missing. Ask your operator to set <strong>Working hour from / to</strong>{" "}
            under <strong>Operator → Company</strong>.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1">
            <Label className="text-xs">Early arrival bonus (RM / min)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={rates.earlyArrivalPerMin}
              onChange={(e) => {
                const v = { ...rates, earlyArrivalPerMin: Math.max(0, Number(e.target.value) || 0) }
                setRates(v)
                saveRates(v)
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Late deduction (RM / min)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={rates.latePerMin}
              onChange={(e) => {
                const v = { ...rates, latePerMin: Math.max(0, Number(e.target.value) || 0) }
                setRates(v)
                saveRates(v)
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Early leave deduction (RM / min)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={rates.earlyLeavePerMin}
              onChange={(e) => {
                const v = { ...rates, earlyLeavePerMin: Math.max(0, Number(e.target.value) || 0) }
                setRates(v)
                saveRates(v)
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">OT / late exit (RM / hour)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={rates.otPerHour}
              onChange={(e) => {
                const v = { ...rates, otPerHour: Math.max(0, Number(e.target.value) || 0) }
                setRates(v)
                saveRates(v)
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex flex-1 flex-wrap items-center gap-2">
            <Input
              placeholder="Search date…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Collapsible open={filterOpen} onOpenChange={setFilterOpen}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="gap-1">
                  <Filter className="h-4 w-4" />
                  Filter
                  <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 rounded-lg border bg-muted/30 p-3 sm:absolute sm:z-10 sm:min-w-[220px]">
                <p className="text-xs font-medium text-muted-foreground mb-2">Status</p>
                <div className="flex flex-wrap gap-2">
                  {(["all", "pending", "approved", "rejected"] as const).map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant={statusFilter === s ? "default" : "outline"}
                      onClick={() => setStatusFilter(s)}
                    >
                      {s === "all" ? "All" : s}
                    </Button>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!filtered.some((r) => r.status === "pending" && selected.has(r.dateKey))}
              onClick={() =>
                setStatusBulk(
                  filtered.filter((r) => r.status === "pending" && selected.has(r.dateKey)).map((r) => r.dateKey),
                  "approved"
                )
              }
            >
              Approve selected
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!filtered.some((r) => r.status === "pending" && selected.has(r.dateKey))}
              onClick={() =>
                setStatusBulk(
                  filtered.filter((r) => r.status === "pending" && selected.has(r.dateKey)).map((r) => r.dateKey),
                  "rejected"
                )
              }
            >
              Reject selected
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" size="sm">
                  Allowance actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    setStatusBulk(
                      filtered.filter((r) => r.status === "pending").map((r) => r.dateKey),
                      "approved"
                    )
                  }
                >
                  Approve all pending (filtered)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setStatusBulk(
                      filtered.filter((r) => r.status === "pending").map((r) => r.dateKey),
                      "rejected"
                    )
                  }
                >
                  Reject all pending (filtered)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="w-10 px-2 py-2 text-left">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-2 py-2 text-left">Date</th>
                <th className="px-2 py-2 text-left">In / Out</th>
                <th className="px-2 py-2 text-right">早到+</th>
                <th className="px-2 py-2 text-right">迟到−</th>
                <th className="px-2 py-2 text-right">早退−</th>
                <th className="px-2 py-2 text-right">OT+</th>
                <th className="px-2 py-2 text-right">Net adj.</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                    No completed check-in/out rows, or nothing matches filters.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const m = r.money
                  const dev = r.dev
                  return (
                    <tr key={r.dateKey} className="border-t">
                      <td className="px-2 py-2">
                        <Checkbox
                          checked={selected.has(r.dateKey)}
                          onCheckedChange={(c) => {
                            setSelected((prev) => {
                              const n = new Set(prev)
                              if (c === true) n.add(r.dateKey)
                              else n.delete(r.dateKey)
                              return n
                            })
                          }}
                        />
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">{formatUtc8Date(r.inIso)}</td>
                      <td className="px-2 py-2 font-mono text-xs">
                        {formatUtc8Time(r.inIso)} → {r.outIso ? formatUtc8Time(r.outIso) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {dev ? `${dev.earlyArrivalMin}m` : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{dev ? `${dev.lateMin}m` : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {dev ? `${dev.earlyLeaveMin}m` : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{dev ? `${dev.otMin}m` : "—"}</td>
                      <td className="px-2 py-2 text-right font-medium tabular-nums">
                        {m ? `RM ${m.netAdjustment.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditDateKey(r.dateKey)
                                setEditOpen(true)
                              }}
                            >
                              <Pencil className="h-4 w-4 mr-2" /> Edit / explain
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={r.status !== "pending"}
                              onClick={() => {
                                persistOverride(r.dateKey, { status: "approved" })
                                toast.success("Approved")
                              }}
                            >
                              <Check className="h-4 w-4 mr-2" /> Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={r.status !== "pending"}
                              onClick={() => {
                                persistOverride(r.dateKey, { status: "rejected" })
                                toast.success("Rejected")
                              }}
                            >
                              <X className="h-4 w-4 mr-2" /> Reject
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground flex items-start gap-1">
          <HelpCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Night shifts (working hours crossing midnight) are not split here yet — show as 0 deviation. Approve/reject
          is stored in this browser for now.
        </p>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>How this row is calculated</DialogTitle>
              <DialogDescription>
                Company window {whFrom || "—"} – {whTo || "—"} (UTC+8). Rates: early +RM{rates.earlyArrivalPerMin}/min,
                late −RM{rates.latePerMin}/min, early leave −RM{rates.earlyLeavePerMin}/min, OT +RM{rates.otPerHour}/hr.
              </DialogDescription>
            </DialogHeader>
            {editRow && editRow.dev && editRow.money ? (
              <div className="space-y-3 text-sm">
                <div className="rounded-lg border p-3 space-y-2">
                  <p>
                    <strong>Check-in</strong> {formatUtc8Time(editRow.inIso)} · <strong>Check-out</strong>{" "}
                    {editRow.outIso ? formatUtc8Time(editRow.outIso) : "—"}
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                    <li>
                      早到 (early): {editRow.dev.earlyArrivalMin} min × RM {rates.earlyArrivalPerMin}/min = +RM{" "}
                      {editRow.money.allowanceEarly.toFixed(2)}
                    </li>
                    <li>
                      迟到 (late): {editRow.dev.lateMin} min × RM {rates.latePerMin}/min = −RM{" "}
                      {editRow.money.deductionLate.toFixed(2)}
                    </li>
                    <li>
                      早退 (early leave): {editRow.dev.earlyLeaveMin} min × RM {rates.earlyLeavePerMin}/min = −RM{" "}
                      {editRow.money.deductionEarlyLeave.toFixed(2)}
                    </li>
                    <li>
                      迟退 / OT: {editRow.dev.otMin} min ÷ 60 × RM {rates.otPerHour}/hr = +RM{" "}
                      {editRow.money.allowanceOt.toFixed(2)}
                    </li>
                  </ul>
                  <p className="font-semibold border-t pt-2">
                    Net adjustment (allowances − deductions): RM {editRow.money.netAdjustment.toFixed(2)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No deviation data for this day.</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
