"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import QRCode from "react-qr-code"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  fetchEmployeeLinensQrMode,
  fetchOperatorDobiConfig,
  fetchOperatorScheduleJobs,
  postEmployeeLinensQrRequest,
} from "@/lib/cleanlemon-api"
import { toast } from "sonner"

type Job = {
  id: string
  date: string
  unitNumber: string
  property: string
  teamName?: string
  team?: string
  staffEmail?: string
  staffName?: string
  cleanerName?: string
  assignedTo?: string
  submitBy?: string
  bedCount?: number
}

type DobiItemType = { id: string; label: string; active?: boolean }

type LinenQrStyle = "rotate_1min" | "permanent"

function detectEmployeeTeam(jobs: Job[], user: { email?: string; name?: string; id?: string } | null): string | null {
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
    const team = String(job.teamName || job.team || "").trim() || "Unassigned"
    const candidates = [
      String(job.staffEmail || ""),
      String(job.staffName || ""),
      String(job.cleanerName || ""),
      String(job.assignedTo || ""),
      String(job.submitBy || ""),
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
    teamCount.set(team, (teamCount.get(team) || 0) + 1)
  }
  if (teamCount.size === 0) return null
  return Array.from(teamCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

/** Matches server `linenTotalsToDobiLines` label rules + per-bed estimates. */
function linenTotalsFromBed(bed: number) {
  return {
    bedsheet: bed,
    pillowCase: bed * 2,
    bedLinens: bed,
    bathmat: 1,
    towel: bed * 2,
  }
}

function distributeBedJobToItemQuantities(activeTypes: DobiItemType[], bed: number): Record<string, number> {
  const totals = linenTotalsFromBed(bed)
  const findMatch = (pred: (l: string) => boolean) => {
    for (const typ of activeTypes) {
      const l = String(typ.label).toLowerCase()
      if (pred(l)) return String(typ.id)
    }
    return null
  }
  const mapSpec: Array<[keyof ReturnType<typeof linenTotalsFromBed>, (l: string) => boolean]> = [
    ["bedsheet", (l) => l.includes("bedsheet")],
    ["pillowCase", (l) => l.includes("pillow")],
    ["bedLinens", (l) => l.includes("bed linen") || l === "linens"],
    ["bathmat", (l) => l.includes("bathmat") || l.includes("bath mat")],
    ["towel", (l) => l.includes("towel")],
  ]
  const acc: Record<string, number> = {}
  for (const [key, pred] of mapSpec) {
    const qty = totals[key]
    if (!qty) continue
    const id = findMatch(pred)
    if (!id) continue
    acc[id] = (acc[id] || 0) + qty
  }
  return acc
}

const ZERO_LEGACY_TOTALS = {
  bedsheet: 0,
  pillowCase: 0,
  bedLinens: 0,
  bathmat: 0,
  towel: 0,
}

export default function EmployeeLinensPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [jobs, setJobs] = useState<Job[]>([])
  const [team, setTeam] = useState<string | null>(null)
  const [itemTypes, setItemTypes] = useState<DobiItemType[]>([])
  const [actionOpen, setActionOpen] = useState(false)
  const [actionType, setActionType] = useState<"collected" | "return">("collected")
  const [remark, setRemark] = useState("")
  const [missingQty, setMissingQty] = useState("0")
  const [savingAction, setSavingAction] = useState(false)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [linenQrStyle, setLinenQrStyle] = useState<LinenQrStyle>("rotate_1min")
  const [expireAtMs, setExpireAtMs] = useState<number | null>(null)
  const [, setTick] = useState(0)
  const [dialogQty, setDialogQty] = useState<Record<string, string>>({})

  const qrPayloadRef = useRef({
    operatorId: "",
    selectedDate: "",
    actionType: "collected" as "collected" | "return",
    team: "",
    lines: [] as Array<{ itemTypeId: string; qty: number; label?: string }>,
    totalsLegacy: ZERO_LEGACY_TOTALS,
    missingQty: 0,
    remark: "",
  })

  const operatorId = useMemo(() => {
    if (typeof window !== "undefined") {
      const fromLayout = localStorage.getItem("cleanlemons_employee_operator_id")
      if (fromLayout) return fromLayout
    }
    return user?.operatorId || "op_demo_001"
  }, [user?.operatorId])

  const activeItemTypes = useMemo(() => itemTypes.filter((x) => x.active !== false), [itemTypes])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [jobRes, dobiRes] = await Promise.all([
        fetchOperatorScheduleJobs(),
        fetchOperatorDobiConfig(operatorId),
      ])
      if (cancelled) return
      const items = (Array.isArray(jobRes?.items) ? jobRes.items : []) as Job[]
      setJobs(items)
      setTeam(detectEmployeeTeam(items, user))
      if (dobiRes?.ok && Array.isArray(dobiRes.itemTypes)) {
        setItemTypes(dobiRes.itemTypes as DobiItemType[])
      } else {
        setItemTypes([])
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user, operatorId])

  useEffect(() => {
    if (!actionOpen || !operatorId) return
    let cancelled = false
    ;(async () => {
      const m = await fetchEmployeeLinensQrMode(operatorId)
      if (cancelled) return
      if (m?.ok && m.linenQrStyle) setLinenQrStyle(m.linenQrStyle)
    })()
    return () => {
      cancelled = true
    }
  }, [actionOpen, operatorId])

  const todayJobs = useMemo(() => {
    const byDate = jobs.filter((x) => String(x.date || "").slice(0, 10) === selectedDate)
    if (!team) return byDate
    return byDate.filter((x) => String(x.teamName || x.team || "").trim() === team)
  }, [jobs, selectedDate, team])

  const rows = useMemo(() => {
    return todayJobs.map((j) => {
      const bed = Number(j.bedCount) > 0 ? Number(j.bedCount) : 1
      const byItemId = distributeBedJobToItemQuantities(activeItemTypes, bed)
      return {
        id: j.id,
        unitNumber: j.unitNumber || "-",
        property: j.property || "-",
        bedCount: bed,
        byItemId,
      }
    })
  }, [todayJobs, activeItemTypes])

  const totalByItemId = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const it of activeItemTypes) acc[it.id] = 0
    for (const r of rows) {
      for (const it of activeItemTypes) {
        const q = r.byItemId[it.id] || 0
        acc[it.id] = (acc[it.id] || 0) + q
      }
    }
    return acc
  }, [rows, activeItemTypes])

  useEffect(() => {
    if (!actionOpen) return
    const next: Record<string, string> = {}
    for (const it of activeItemTypes) {
      next[it.id] = String(totalByItemId[it.id] ?? 0)
    }
    setDialogQty(next)
  }, [actionOpen, activeItemTypes, totalByItemId])

  useEffect(() => {
    const lines = activeItemTypes.map((it) => ({
      itemTypeId: it.id,
      label: it.label,
      qty: Math.max(0, Math.floor(Number(dialogQty[it.id]) || 0)),
    }))
    qrPayloadRef.current = {
      operatorId,
      selectedDate,
      actionType,
      team: team || "Unassigned",
      lines,
      totalsLegacy: ZERO_LEGACY_TOTALS,
      missingQty: Number(missingQty) || 0,
      remark: remark.trim(),
    }
  }, [operatorId, selectedDate, actionType, team, activeItemTypes, dialogQty, missingQty, remark])

  const gridColStyle = useMemo(() => {
    const n = Math.max(1, activeItemTypes.length)
    const cols = Math.min(n, 12)
    return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } as CSSProperties
  }, [activeItemTypes.length])

  const runQrRequest = useCallback(async (silent: boolean) => {
    const p = qrPayloadRef.current
    const sumLines = p.lines.reduce((a, x) => a + Math.max(0, Math.floor(Number(x.qty) || 0)), 0)
    if (sumLines <= 0) {
      if (!silent) toast.error("Set at least one item quantity.")
      return
    }
    if (p.actionType === "return" && p.missingQty > 0 && !p.remark) {
      if (!silent) toast.error("Please input remark when return has shortage.")
      return
    }
    if (!silent) {
      setSavingAction(true)
      setQrUrl(null)
      setExpireAtMs(null)
    }
    const r = await postEmployeeLinensQrRequest({
      operatorId: p.operatorId,
      date: p.selectedDate,
      action: p.actionType,
      team: p.team,
      totals: p.totalsLegacy,
      lines: p.lines.map((x) => ({
        itemTypeId: x.itemTypeId,
        qty: Math.max(0, Math.floor(Number(x.qty) || 0)),
        label: x.label,
      })),
      missingQty: p.missingQty,
      remark: p.remark,
    })
    if (!silent) setSavingAction(false)
    if (!r?.ok || !r.token) {
      if (!silent)
        toast.error(
          r?.reason === "REMARK_REQUIRED"
            ? "Remark required."
            : r?.reason === "INVALID_ITEM_TYPE"
              ? "Invalid item type — check Dobi settings."
              : `Request failed (${r?.reason || "unknown"})`,
        )
      return
    }
    const path = `/employee/dobi/linen-approve?operatorId=${encodeURIComponent(p.operatorId)}&token=${encodeURIComponent(r.token)}`
    const full = typeof window !== "undefined" ? `${window.location.origin}${path}` : path
    setQrUrl(full)
    if (r.linenQrStyle) setLinenQrStyle(r.linenQrStyle)
    const exp = r.expiresAt ? new Date(r.expiresAt).getTime() : NaN
    setExpireAtMs(Number.isFinite(exp) ? exp : null)
    if (!silent) toast.success("Show this QR to dobi staff to approve.")
  }, [])

  useEffect(() => {
    if (!actionOpen || !qrUrl || linenQrStyle !== "rotate_1min") return
    const id = window.setInterval(() => {
      void runQrRequest(true)
    }, 60_000)
    return () => clearInterval(id)
  }, [actionOpen, qrUrl, linenQrStyle, runQrRequest])

  useEffect(() => {
    if (!qrUrl || expireAtMs == null) return
    const id = window.setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [qrUrl, expireAtMs])

  const secondsLeft = expireAtMs != null ? Math.max(0, Math.floor((expireAtMs - Date.now()) / 1000)) : 0
  const mm = Math.floor(secondsLeft / 60)
  const ss = secondsLeft % 60
  const timeLeftLabel = secondsLeft > 0 ? `${mm}:${String(ss).padStart(2, "0")}` : "0:00"

  const closeDialog = (open: boolean) => {
    setActionOpen(open)
    if (!open) {
      setRemark("")
      setMissingQty("0")
      setQrUrl(null)
      setExpireAtMs(null)
    }
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Linens</h1>
          <p className="text-muted-foreground">
            Quantities follow Dobi item types and today&apos;s jobs (bed count). Labels like &quot;bedsheet&quot;, &quot;pillow&quot;,
            &quot;towel&quot; map to each type.
          </p>
        </div>
        <Button onClick={() => setActionOpen(true)} disabled={!activeItemTypes.length}>
          Collected & Return
        </Button>
      </div>

      {!activeItemTypes.length && !loading ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          No active Dobi item types — ask your operator to set them under Operator → Dobi.
        </p>
      ) : null}

      <div className="max-w-xs space-y-2">
        <Label>Date</Label>
        <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
      </div>

      <div className="grid gap-2 sm:gap-3 max-w-5xl" style={gridColStyle}>
        {activeItemTypes.map((it) => (
          <div
            key={it.id}
            className="aspect-square flex flex-col items-center justify-center rounded-xl border border-border bg-card p-1.5 sm:p-2 text-center shadow-sm min-w-0"
          >
            <span className="text-[10px] sm:text-xs text-muted-foreground leading-tight line-clamp-3">{it.label}</span>
            <span className="text-base sm:text-lg font-semibold tabular-nums mt-0.5">{totalByItemId[it.id] ?? 0}</span>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Linen Pick List</CardTitle>
          <CardDescription>{team ? `Filtered by your team: ${team}` : "Showing all jobs for selected date."}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">Loading linens...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No jobs for selected date.</p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
                    <div>
                      <p className="font-semibold text-foreground">{r.unitNumber}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{r.property}</p>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      <dt className="text-muted-foreground">Bed count</dt>
                      <dd className="text-right font-medium tabular-nums">{r.bedCount}</dd>
                      {activeItemTypes.map((it) => (
                        <FragmentRow key={it.id} label={it.label} qty={r.byItemId[it.id] ?? 0} />
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
              <div className="hidden md:block rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Bed Count</TableHead>
                      {activeItemTypes.map((it) => (
                        <TableHead key={it.id} className="whitespace-nowrap min-w-[5rem]">
                          {it.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.unitNumber}</div>
                          <div className="text-xs text-muted-foreground">{r.property}</div>
                        </TableCell>
                        <TableCell>{r.bedCount}</TableCell>
                        {activeItemTypes.map((it) => (
                          <TableCell key={it.id} className="tabular-nums">
                            {r.byItemId[it.id] ?? 0}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={actionOpen} onOpenChange={closeDialog}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Collected & Return</DialogTitle>
            <DialogDescription>
              Quantities are filled from the pick list — adjust if needed, then generate a QR for dobi to scan.
              {linenQrStyle === "rotate_1min"
                ? " This operator uses a code that refreshes every minute — dobi should scan within the time shown."
                : " This operator uses a long-lived QR — refreshes only when you tap Regenerate."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Action</Label>
              <Select value={actionType} onValueChange={(v) => setActionType(v as "collected" | "return")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="collected">Collected</SelectItem>
                  <SelectItem value="return">Return</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>Time: {new Date().toLocaleString()}</div>
              <div>Team: {team || "Unassigned"}</div>
            </div>
            <div className="space-y-2">
              <Label>Item quantities</Label>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {activeItemTypes.map((it) => (
                  <div key={it.id} className="flex items-center gap-2">
                    <span className="text-sm flex-1 min-w-0 truncate" title={it.label}>
                      {it.label}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      className="w-24 tabular-nums"
                      value={dialogQty[it.id] ?? "0"}
                      onChange={(e) => setDialogQty((prev) => ({ ...prev, [it.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
            {actionType === "return" ? (
              <div className="space-y-2">
                <Label>Missing qty (if any)</Label>
                <Input type="number" min={0} value={missingQty} onChange={(e) => setMissingQty(e.target.value)} />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>Remark {actionType === "return" && Number(missingQty) > 0 ? "(required when missing)" : "(optional)"}</Label>
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Example: return short 2 pillow case"
              />
            </div>
            {qrUrl ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 p-4">
                <p className="text-center text-sm text-muted-foreground">Ask dobi to scan — they approve on their phone (no signature).</p>
                {expireAtMs != null ? (
                  <p className="text-sm font-medium tabular-nums">
                    Valid for: {timeLeftLabel}
                    {linenQrStyle === "rotate_1min" ? " · auto-refresh every 1 min" : ""}
                  </p>
                ) : null}
                <div className="rounded-lg bg-white p-3">
                  <QRCode value={qrUrl} size={180} level="M" />
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => closeDialog(false)}>
              Close
            </Button>
            <Button onClick={() => void runQrRequest(false)} disabled={savingAction}>
              {savingAction ? "Working..." : qrUrl ? "Regenerate QR" : "Generate QR for dobi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FragmentRow({ label, qty }: { label: string; qty: number }) {
  return (
    <>
      <dt className="text-muted-foreground truncate">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{qty}</dd>
    </>
  )
}
