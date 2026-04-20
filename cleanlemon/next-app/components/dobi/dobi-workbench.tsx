"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  fetchDobiDay,
  fetchDobiDayEvents,
  postDobiLotAction,
  postDobiDamageLinen,
  postDobiAppendIntake,
  uploadEmployeeFileToOss,
} from "@/lib/cleanlemon-api"
import { DobiLinenQrScanDialog } from "@/components/dobi/dobi-linen-qr-scan-dialog"
import { useEffectiveOperatorId } from "@/lib/cleanlemon-effective-operator-id"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "sonner"
import { AlertTriangle, Filter, HelpCircle, ImagePlus, Loader2, Plus, QrCode, Trash2 } from "lucide-react"

function myBusinessDateStr(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" })
}

/** Inclusive list of YYYY-MM-DD from from to to (max 62 days). */
function enumerateInclusiveDates(from: string, to: string): string[] {
  const a = String(from || "").slice(0, 10)
  const b = String(to || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return []
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  const out: string[] = []
  const parse = (s: string) => {
    const [y, mo, d] = s.split("-").map(Number)
    return new Date(Date.UTC(y, mo - 1, d))
  }
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10)
  let cur = parse(lo)
  const endT = parse(hi)
  let n = 0
  while (cur <= endT && n++ < 62) {
    out.push(fmt(cur))
    cur = new Date(cur.getTime() + 86400000)
  }
  return out
}

function formatMy(iso?: string | null) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })
  } catch {
    return "—"
  }
}

type Lot = {
  id: string
  batchIndex: number
  stage: string
  machineId?: string | null
  pcsTotal: number
  plannedEndAtUtc?: string | null
  items: Array<{ id: string; itemTypeId: string; teamName: string; qty: number }>
}

type LineRow = { teamName: string; itemTypeId: string; qty: string }

const EVT_LABEL: Record<string, string> = {
  intake_lot_created: "Batch created",
  intake_committed: "Intake saved",
  start_wash: "Start wash",
  finish_wash: "Take out (wash)",
  start_dry: "Start dry",
  finish_dry: "Take out (dry)",
  start_iron: "Start iron",
  finish_iron: "Mark ready",
  mark_returned: "Returned",
  skip: "Skipped",
  damage_linen: "Damage report",
}

export default function DobiWorkbench() {
  const { user } = useAuth()
  const effectiveOp = useEffectiveOperatorId(user)
  const operatorId = effectiveOp || user?.operatorId || ""

  const [mainTab, setMainTab] = useState<string>("s1")
  const [loading, setLoading] = useState(true)
  const [bundle, setBundle] = useState<any>(null)
  const [, setTick] = useState(0)

  const [events, setEvents] = useState<any[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [histFrom, setHistFrom] = useState(() => myBusinessDateStr())
  const [histTo, setHistTo] = useState(() => myBusinessDateStr())
  const [histFilterOpen, setHistFilterOpen] = useState(false)
  const [histDraftFrom, setHistDraftFrom] = useState(() => myBusinessDateStr())
  const [histDraftTo, setHistDraftTo] = useState(() => myBusinessDateStr())

  const [handoffOpen, setHandoffOpen] = useState(false)
  const [handoffBody, setHandoffBody] = useState<{ lotId: string; machineId: string; gapMinutes?: number } | null>(null)
  const [handoffRemark, setHandoffRemark] = useState("")

  const [damageOpen, setDamageOpen] = useState(false)
  const [damageLines, setDamageLines] = useState<LineRow[]>([{ teamName: "Unassigned", itemTypeId: "", qty: "1" }])
  const [damageRemark, setDamageRemark] = useState("")
  const [damagePhotoFiles, setDamagePhotoFiles] = useState<File[]>([])
  const [damageSaving, setDamageSaving] = useState(false)
  const damagePhotoInputRef = useRef<HTMLInputElement>(null)

  const [linenScanOpen, setLinenScanOpen] = useState(false)
  const [manualAddOpen, setManualAddOpen] = useState(false)
  const [manualTargetStage, setManualTargetStage] = useState<"pending_wash" | "ready">("pending_wash")
  const [manualLines, setManualLines] = useState<LineRow[]>([{ teamName: "Unassigned", itemTypeId: "", qty: "1" }])
  const [manualSaving, setManualSaving] = useState(false)
  const [readyTakeouts, setReadyTakeouts] = useState<Record<string, string>>({})
  const [readyReturnSaving, setReadyReturnSaving] = useState(false)

  const [washerDlg, setWasherDlg] = useState<{ machine: { id: string; name: string } } | null>(null)
  const [dryerDlg, setDryerDlg] = useState<{ machine: { id: string; name: string } } | null>(null)
  const [ironStartDlg, setIronStartDlg] = useState(false)
  const [ironFinishDlg, setIronFinishDlg] = useState<Lot | null>(null)
  const [readyDlg, setReadyDlg] = useState<Lot | null>(null)
  const [pickLotId, setPickLotId] = useState("")
  const [pickIronId, setPickIronId] = useState<string>("")

  const loadDay = useCallback(async () => {
    if (!operatorId) return
    const bd = myBusinessDateStr()
    setLoading(true)
    const r = await fetchDobiDay(operatorId, bd)
    setLoading(false)
    if (!r?.ok && r?.reason === "MIGRATION_REQUIRED") {
      toast.error("Database migration required (dobi tables).")
      return
    }
    setBundle(r)
  }, [operatorId])

  const loadEventsRange = useCallback(async () => {
    if (!operatorId) return
    setEventsLoading(true)
    const days = enumerateInclusiveDates(histFrom, histTo)
    if (days.length === 0) {
      setEvents([])
      setEventsLoading(false)
      return
    }
    const merged: Array<Record<string, unknown> & { businessDate?: string }> = []
    const seen = new Set<string>()
    for (const d of days) {
      const r = await fetchDobiDayEvents(operatorId, d)
      if (r?.ok && Array.isArray(r.events)) {
        for (const ev of r.events) {
          const id = String((ev as { id?: string }).id || "")
          if (id && seen.has(id)) continue
          if (id) seen.add(id)
          merged.push({ ...(ev as object), businessDate: d })
        }
      }
    }
    merged.sort((a, b) => {
      const ta = new Date(String((a as { createdAtUtc?: string }).createdAtUtc || 0)).getTime()
      const tb = new Date(String((b as { createdAtUtc?: string }).createdAtUtc || 0)).getTime()
      return tb - ta
    })
    setEvents(merged as any[])
    setEventsLoading(false)
  }, [operatorId, histFrom, histTo])

  useEffect(() => {
    loadDay()
  }, [loadDay])

  const prevMainTab = useRef<string | null>(null)
  useEffect(() => {
    if (prevMainTab.current === "hist" && mainTab !== "hist") {
      void loadDay()
    }
    prevMainTab.current = mainTab
  }, [mainTab, loadDay])

  useEffect(() => {
    if (mainTab !== "hist") return
    void loadEventsRange()
  }, [mainTab, histFrom, histTo, loadEventsRange])

  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (washerDlg) setPickLotId("")
  }, [washerDlg])

  useEffect(() => {
    if (dryerDlg) setPickLotId("")
  }, [dryerDlg])

  useEffect(() => {
    if (!readyDlg?.items?.length) {
      setReadyTakeouts({})
      return
    }
    const next: Record<string, string> = {}
    for (const it of readyDlg.items) {
      next[it.id] = String(it.qty)
    }
    setReadyTakeouts(next)
  }, [readyDlg?.id])

  const itemTypes = bundle?.itemTypes || []
  /** Operator → Dobi settings: only active types for manual add (no free-text types). */
  const operatorItemTypesForManual = useMemo(() => {
    const raw = bundle?.itemTypes
    const arr = Array.isArray(raw) ? raw : []
    return arr.filter((it: { active?: boolean }) => it.active !== false)
  }, [bundle?.itemTypes])
  const machines: Array<{ id: string; kind: string; name: string; active?: boolean; roundMinutes?: number }> =
    bundle?.machines || []
  const lots: Lot[] = bundle?.lots || []
  const config = bundle?.config

  const itemLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const it of itemTypes) m.set(String(it.id), String(it.label || it.id))
    return (id: string) => m.get(id) || id
  }, [itemTypes])

  const washers = useMemo(() => machines.filter((m) => m.kind === "washer" && m.active !== false), [machines])
  const dryers = useMemo(() => machines.filter((m) => m.kind === "dryer" && m.active !== false), [machines])
  const irons = useMemo(() => machines.filter((m) => m.kind === "iron" && m.active !== false), [machines])

  const pendingWashLots = useMemo(() => lots.filter((l) => l.stage === "pending_wash"), [lots])
  const washingByMachine = useMemo(() => {
    const m = new Map<string, Lot>()
    for (const l of lots) {
      if (l.stage === "washing" && l.machineId) m.set(l.machineId, l)
    }
    return m
  }, [lots])

  const pendingDryLots = useMemo(() => lots.filter((l) => l.stage === "pending_dry"), [lots])
  const dryingByMachine = useMemo(() => {
    const m = new Map<string, Lot>()
    for (const l of lots) {
      if (l.stage === "drying" && l.machineId) m.set(l.machineId, l)
    }
    return m
  }, [lots])

  const pendingIronLots = useMemo(() => lots.filter((l) => l.stage === "pending_iron"), [lots])
  const ironingLots = useMemo(() => lots.filter((l) => l.stage === "ironing"), [lots])
  const readyLots = useMemo(() => lots.filter((l) => l.stage === "ready"), [lots])

  const aggregateItems = useCallback(
    (subset: Lot[]) => {
      const map = new Map<string, number>()
      for (const lot of subset) {
        for (const it of lot.items || []) {
          const k = it.itemTypeId
          map.set(k, (map.get(k) || 0) + (Number(it.qty) || 0))
        }
      }
      return Array.from(map.entries()).map(([itemTypeId, qty]) => ({ itemTypeId, qty, label: itemLabel(itemTypeId) }))
    },
    [itemLabel],
  )

  const pendingWashTotals = useMemo(() => aggregateItems(pendingWashLots), [aggregateItems, pendingWashLots])
  const pendingDryTotals = useMemo(() => aggregateItems(pendingDryLots), [aggregateItems, pendingDryLots])

  const minsLeft = (plannedIso?: string | null) => {
    if (!plannedIso) return null
    const end = new Date(plannedIso).getTime()
    const s = Math.max(0, Math.floor((end - Date.now()) / 1000))
    return Math.floor(s / 60)
  }

  const doLot = async (
    lotId: string,
    action: string,
    machineId?: string,
    extra?: { handoffRemark?: string; takeouts?: Array<{ itemLineId: string; qty: number }> },
  ) => {
    if (!operatorId) return
    const r = await postDobiLotAction({
      operatorId,
      lotId,
      action,
      machineId,
      handoffRemark: extra?.handoffRemark,
      businessDate: myBusinessDateStr(),
      ...(extra?.takeouts != null ? { takeouts: extra.takeouts } : {}),
    })
    if (!r?.ok) {
      if (r?.reason === "HANDOFF_REMARK_REQUIRED") {
        setHandoffBody({ lotId, machineId: machineId || "", gapMinutes: r.gapMinutes })
        setHandoffRemark("")
        setHandoffOpen(true)
        return
      }
      toast.error(r?.reason || "Action failed")
      return
    }
    setBundle(r)
    setWasherDlg(null)
    setDryerDlg(null)
    setIronStartDlg(false)
    setIronFinishDlg(null)
    setReadyDlg(null)
    setPickLotId("")
    toast.success("Updated")
  }

  const submitHandoff = async () => {
    if (!handoffBody?.lotId || !handoffBody.machineId) return
    if (!handoffRemark.trim()) {
      toast.error("Remark required")
      return
    }
    setHandoffOpen(false)
    await doLot(handoffBody.lotId, "start_dry", handoffBody.machineId, { handoffRemark: handoffRemark.trim() })
    setHandoffBody(null)
  }

  const submitDamage = async () => {
    if (!operatorId) return
    const rem = damageRemark.trim()
    if (!rem) {
      toast.error("Describe the damage")
      return
    }
    const dl = damageLines
      .filter((l) => l.itemTypeId && Number(l.qty) > 0)
      .map((l) => ({
        itemTypeId: l.itemTypeId,
        qty: Number(l.qty) || 0,
        teamName: "Unassigned",
      }))
    if (!dl.length) {
      toast.error("Add at least one item line")
      return
    }
    setDamageSaving(true)
    const photoUrls: string[] = []
    for (const file of damagePhotoFiles) {
      const up = await uploadEmployeeFileToOss(file, operatorId)
      if (!up.ok || !up.url) {
        toast.error(up.reason || "Photo upload failed")
        setDamageSaving(false)
        return
      }
      photoUrls.push(up.url)
    }
    const r = await postDobiDamageLinen({
      operatorId,
      businessDate: myBusinessDateStr(),
      remark: rem,
      lines: dl,
      photoUrls: photoUrls.length ? photoUrls : undefined,
    })
    setDamageSaving(false)
    if (!r?.ok) {
      toast.error(r?.reason || "Submit failed")
      return
    }
    toast.success("Damage report saved")
    setDamageOpen(false)
    setDamageRemark("")
    setDamageLines([{ teamName: "Unassigned", itemTypeId: "", qty: "1" }])
    setDamagePhotoFiles([])
    if (damagePhotoInputRef.current) damagePhotoInputRef.current.value = ""
  }

  const onDamageDialogOpenChange = (open: boolean) => {
    if (!open) {
      setDamageRemark("")
      setDamageLines([{ teamName: "Unassigned", itemTypeId: "", qty: "1" }])
      setDamagePhotoFiles([])
      if (damagePhotoInputRef.current) damagePhotoInputRef.current.value = ""
    }
    setDamageOpen(open)
  }

  const addDamagePhotoFiles = (list: FileList | null) => {
    if (!list?.length) return
    setDamagePhotoFiles((prev) => [...prev, ...Array.from(list)].slice(0, 10))
    if (damagePhotoInputRef.current) damagePhotoInputRef.current.value = ""
  }

  const renderMachineRow = (
    kind: "washer" | "dryer",
    m: { id: string; name: string },
    activeLot: Lot | undefined,
    onOpen: () => void,
  ) => {
    const busy = !!activeLot
    const left = busy ? minsLeft(activeLot.plannedEndAtUtc) : null
    const overdue = busy && activeLot.plannedEndAtUtc && Date.now() > new Date(activeLot.plannedEndAtUtc).getTime()
    let status = "Vacant"
    if (busy) {
      status = overdue ? "Finish (overdue)" : `Washing… ~${left ?? "—"} min left`
      if (kind === "dryer") status = overdue ? "Finish (overdue)" : `Drying… ~${left ?? "—"} min left`
    }
    return (
      <button
        key={m.id}
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:bg-muted/40"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{m.name}</span>
          <Badge variant={busy ? "default" : "secondary"}>{busy ? (overdue ? "Action" : "Running") : "Vacant"}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{status}</p>
      </button>
    )
  }

  const hasLots = lots.length > 0
  const bizDate = myBusinessDateStr()

  const submitManualAppend = async () => {
    if (!operatorId) return
    const bodyLines = manualLines
      .filter((l) => l.itemTypeId && Number(l.qty) > 0)
      .map((l) => ({
        teamName: "Unassigned",
        itemTypeId: l.itemTypeId,
        qty: Number(l.qty) || 0,
      }))
    if (!bodyLines.length) {
      toast.error("Add at least one line with item and quantity.")
      return
    }
    setManualSaving(true)
    const r = await postDobiAppendIntake({
      operatorId,
      businessDate: bizDate,
      lines: bodyLines,
      targetStage: manualTargetStage,
    })
    setManualSaving(false)
    if (!r?.ok) {
      toast.error(r?.reason || "Could not add")
      return
    }
    toast.success(manualTargetStage === "ready" ? "Added to ready" : "Added to pending wash")
    setBundle(r)
    setManualAddOpen(false)
    setManualTargetStage("pending_wash")
    setManualLines([{ teamName: "Unassigned", itemTypeId: "", qty: "1" }])
  }

  const submitReadyReturn = async () => {
    if (!readyDlg || !operatorId) return
    const takeouts = readyDlg.items
      .map((it) => ({
        itemLineId: it.id,
        qty: Math.min(
          Math.max(0, Math.floor(Number(readyTakeouts[it.id]) || 0)),
          Math.max(0, Math.floor(Number(it.qty) || 0)),
        ),
      }))
      .filter((t) => t.qty > 0)
    if (!takeouts.length) {
      toast.error("Enter how many pieces were taken out (at least one line).")
      return
    }
    setReadyReturnSaving(true)
    try {
      await doLot(readyDlg.id, "mark_returned", undefined, { takeouts })
    } finally {
      setReadyReturnSaving(false)
    }
  }

  const onManualDialogOpenChange = (open: boolean) => {
    if (!open) {
      setManualTargetStage("pending_wash")
      setManualLines([{ teamName: "Unassigned", itemTypeId: "", qty: "1" }])
    }
    setManualAddOpen(open)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-28 pt-1 lg:pb-10">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Dobi</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Today&apos;s flow (Malaysia date). Use History → Filter to view other days.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="destructive" size="sm" className="gap-1" onClick={() => setDamageOpen(true)}>
          <AlertTriangle className="h-4 w-4" />
          Damaged linens
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1"
          onClick={() => setLinenScanOpen(true)}
          disabled={!operatorId}
        >
          <QrCode className="h-4 w-4" />
          Scan linen QR
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => {
            setManualTargetStage("pending_wash")
            setManualAddOpen(true)
          }}
          disabled={!operatorId}
        >
          <Plus className="h-4 w-4" />
          Add manually
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center text-muted-foreground">
              <HelpCircle className="h-4 w-4" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Wash→dry gap over {config?.handoffWashToDryWarningMinutes ?? 15} min needs a remark when starting dry.
          </TooltipContent>
        </Tooltip>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : null}

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="flex h-auto w-full flex-col gap-1.5 p-1 sm:flex-row sm:flex-wrap sm:gap-1">
          <TabsTrigger value="s1" className="w-full shrink-0 justify-start sm:w-auto sm:flex-1 sm:justify-center">
            1 · Pending wash
          </TabsTrigger>
          <TabsTrigger value="s2" className="w-full shrink-0 justify-start sm:w-auto sm:flex-1 sm:justify-center">
            2 · Washer
          </TabsTrigger>
          <TabsTrigger value="s3" className="w-full shrink-0 justify-start sm:w-auto sm:flex-1 sm:justify-center">
            3 · Dryer
          </TabsTrigger>
          <TabsTrigger value="s4" className="w-full shrink-0 justify-start sm:w-auto sm:flex-1 sm:justify-center">
            4 · Iron
          </TabsTrigger>
          <TabsTrigger value="s5" className="w-full shrink-0 justify-start sm:w-auto sm:flex-1 sm:justify-center">
            5 · Ready
          </TabsTrigger>
          <TabsTrigger value="hist" className="w-full shrink-0 justify-start sm:w-auto sm:flex-1 sm:justify-center">
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="s1" className="space-y-3 pt-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pending wash (totals)</CardTitle>
              <CardDescription>Remaining pieces waiting for a washer. When you start a load on step 2, these decrease.</CardDescription>
            </CardHeader>
            <CardContent>
              {!hasLots ? (
                <p className="text-sm text-muted-foreground">
                  No batches for this date. Ask your operator to register today&apos;s intake.
                </p>
              ) : pendingWashTotals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing left in pending wash — check step 2 or later.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {pendingWashTotals.map((row) => (
                    <div key={row.itemTypeId} className="rounded-lg border bg-muted/30 px-3 py-2">
                      <div className="text-xs text-muted-foreground">{row.label}</div>
                      <div className="text-xl font-semibold tabular-nums">{row.qty}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="s2" className="space-y-3 pt-3">
          <p className="text-sm text-muted-foreground">Tap a washer. Load a pending batch, then start washing.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {washers.map((w) =>
              renderMachineRow("washer", w, washingByMachine.get(w.id), () => setWasherDlg({ machine: { id: w.id, name: w.name } })),
            )}
          </div>
          {washers.length === 0 ? <p className="text-sm text-muted-foreground">No washers — add them in Operator Dobi settings.</p> : null}
        </TabsContent>

        <TabsContent value="s3" className="space-y-3 pt-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Waiting for dryer</CardTitle>
              <CardDescription>Batches taken out of the washer but not yet in a dryer.</CardDescription>
            </CardHeader>
            <CardContent>
              {pendingDryTotals.length === 0 ? (
                <p className="text-sm text-muted-foreground">None pending dry.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {pendingDryTotals.map((row) => (
                    <div key={row.itemTypeId} className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-muted-foreground">{row.label}</div>
                      <div className="text-lg font-semibold tabular-nums">{row.qty}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground">Tap a dryer to move a batch in and start drying.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {dryers.map((d) =>
              renderMachineRow("dryer", d, dryingByMachine.get(d.id), () => setDryerDlg({ machine: { id: d.id, name: d.name } })),
            )}
          </div>
          {dryers.length === 0 ? <p className="text-sm text-muted-foreground">No dryers in settings.</p> : null}
        </TabsContent>

        <TabsContent value="s4" className="space-y-3 pt-3">
          <p className="text-sm text-muted-foreground">Start iron for a batch, then mark ready when folding is done.</p>
          {pendingIronLots.length ? (
            <div className="space-y-2">
              <Label>Pending iron</Label>
              {pendingIronLots.map((lot) => (
                <Card key={lot.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <span className="font-medium">Batch #{lot.batchIndex + 1}</span> · {lot.pcsTotal} pcs
                    </div>
                    <Button size="sm" onClick={() => {
                      setPickLotId(lot.id)
                      setPickIronId(irons[0]?.id || "")
                      setIronStartDlg(true)
                    }}>
                      Start iron
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No batch waiting for iron.</p>
          )}
          {ironingLots.length ? (
            <div className="space-y-2">
              <Label>In progress</Label>
              {ironingLots.map((lot) => (
                <Card key={lot.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <span className="font-medium">Batch #{lot.batchIndex + 1}</span> · ironing
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setIronFinishDlg(lot)}>
                      Mark ready
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="s5" className="space-y-3 pt-3">
          <p className="text-sm text-muted-foreground">Ready to return to teams. Confirm delivery when handed over.</p>
          {readyLots.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing in ready.</p>
          ) : (
            readyLots.map((lot) => (
              <Card key={lot.id}>
                <CardContent className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">Batch #{lot.batchIndex + 1}</span> · {lot.pcsTotal} pcs
                    </div>
                    <Button size="sm" onClick={() => setReadyDlg(lot)}>
                      Record handover
                    </Button>
                  </div>
                  {(lot.items || []).length ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {(lot.items || []).map((it) => (
                        <span key={it.id}>
                          {itemLabel(it.itemTypeId)} ×{it.qty}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="hist" className="space-y-3 pt-3">
          <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base">Workflow log</CardTitle>
                <CardDescription>
                  {histFrom === histTo
                    ? `Date: ${histFrom}`
                    : `Dates: ${histFrom} → ${histTo}`}{" "}
                  (Malaysia calendar days)
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1"
                onClick={() => {
                  setHistDraftFrom(histFrom)
                  setHistDraftTo(histTo)
                  setHistFilterOpen(true)
                }}
              >
                <Filter className="h-4 w-4" />
                Filter
              </Button>
            </CardHeader>
            <CardContent>
              {eventsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events for this range (or no batches yet).</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Day</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Staff</TableHead>
                        <TableHead>Machine</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map((ev) => (
                        <TableRow
                          key={`${String((ev as { id?: string }).id)}-${String((ev as { businessDate?: string }).businessDate || "")}`}
                        >
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {(ev as { businessDate?: string }).businessDate || "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{formatMy(ev.createdAtUtc)}</TableCell>
                          <TableCell className="text-xs">{EVT_LABEL[ev.eventType] || ev.eventType}</TableCell>
                          <TableCell className="text-xs">
                            <div>{ev.staffName || "—"}</div>
                            <div className="text-muted-foreground">{ev.createdByEmail}</div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {ev.machineName ? (
                              <>
                                {ev.machineName}
                                {ev.machineKind ? <span className="text-muted-foreground"> ({ev.machineKind})</span> : null}
                              </>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={histFilterOpen} onOpenChange={setHistFilterOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Filter by date</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={histDraftFrom} onChange={(e) => setHistDraftFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={histDraftTo} onChange={(e) => setHistDraftTo(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Up to 62 days. Uses Malaysia calendar dates.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setHistFilterOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const from = histDraftFrom.slice(0, 10)
                const to = histDraftTo.slice(0, 10)
                if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
                  toast.error("Pick valid dates.")
                  return
                }
                if (enumerateInclusiveDates(from, to).length > 62) {
                  toast.error("Choose at most 62 days.")
                  return
                }
                setHistFrom(from)
                setHistTo(to)
                setHistFilterOpen(false)
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Washer dialog */}
      <Dialog open={!!washerDlg} onOpenChange={(o) => !o && setWasherDlg(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{washerDlg?.machine.name}</DialogTitle>
          </DialogHeader>
          {washerDlg ? (
            (() => {
              const active = washingByMachine.get(washerDlg.machine.id)
              if (active) {
                const left = minsLeft(active.plannedEndAtUtc)
                return (
                  <div className="space-y-3 text-sm">
                    <p>
                      Batch #{active.batchIndex + 1} · {active.pcsTotal} pcs — {left != null ? `~${left} min left` : "running"}
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {active.items.map((it, i) => (
                          <TableRow key={i}>
                            <TableCell>{itemLabel(it.itemTypeId)}</TableCell>
                            <TableCell className="text-right">{it.qty}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <Button className="w-full" onClick={() => doLot(active.id, "finish_wash")}>
                      Take out (finish wash)
                    </Button>
                  </div>
                )
              }
              return (
                <div className="space-y-3">
                  <Label>Choose a pending batch</Label>
                  <Select value={pickLotId} onValueChange={setPickLotId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select batch" />
                    </SelectTrigger>
                    <SelectContent>
                      {pendingWashLots.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          Batch #{l.batchIndex + 1} · {l.pcsTotal} pcs
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {pickLotId ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(pendingWashLots.find((x) => x.id === pickLotId)?.items || []).map((it, i) => (
                          <TableRow key={i}>
                            <TableCell>{itemLabel(it.itemTypeId)}</TableCell>
                            <TableCell className="text-right">{it.qty}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                  <Button
                    className="w-full"
                    disabled={!pickLotId}
                    onClick={() => pickLotId && doLot(pickLotId, "start_wash", washerDlg.machine.id)}
                  >
                    Start washing
                  </Button>
                </div>
              )
            })()
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Dryer dialog */}
      <Dialog open={!!dryerDlg} onOpenChange={(o) => !o && setDryerDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dryerDlg?.machine.name}</DialogTitle>
          </DialogHeader>
          {dryerDlg ? (
            (() => {
              const active = dryingByMachine.get(dryerDlg.machine.id)
              if (active) {
                const left = minsLeft(active.plannedEndAtUtc)
                return (
                  <div className="space-y-3 text-sm">
                    <p>
                      Batch #{active.batchIndex + 1} · {left != null ? `~${left} min left` : "drying"}
                    </p>
                    <Button className="w-full" onClick={() => doLot(active.id, "finish_dry")}>
                      Take out (finish dry)
                    </Button>
                  </div>
                )
              }
              return (
                <div className="space-y-3">
                  <Label>Choose a batch waiting for dryer</Label>
                  <Select value={pickLotId} onValueChange={setPickLotId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select batch" />
                    </SelectTrigger>
                    <SelectContent>
                      {pendingDryLots.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          Batch #{l.batchIndex + 1} · {l.pcsTotal} pcs
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    className="w-full"
                    disabled={!pickLotId}
                    onClick={() => pickLotId && doLot(pickLotId, "start_dry", dryerDlg.machine.id)}
                  >
                    Start drying now
                  </Button>
                </div>
              )
            })()
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Iron start */}
      <Dialog open={ironStartDlg} onOpenChange={setIronStartDlg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start iron</DialogTitle>
          </DialogHeader>
          {irons.length ? (
            <div className="space-y-2">
              <Label>Iron station (optional)</Label>
              <Select value={pickIronId} onValueChange={setPickIronId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {irons.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIronStartDlg(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!pickLotId) return
                doLot(pickLotId, "start_iron", pickIronId || irons[0]?.id)
              }}
            >
              Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Iron finish */}
      <Dialog open={!!ironFinishDlg} onOpenChange={(o) => !o && setIronFinishDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark ready</DialogTitle>
          </DialogHeader>
          {ironFinishDlg ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Batch #{ironFinishDlg.batchIndex + 1} — confirm pieces are ready.</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ironFinishDlg.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell>{itemLabel(it.itemTypeId)}</TableCell>
                      <TableCell className="text-right">{it.qty}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIronFinishDlg(null)}>
              Cancel
            </Button>
            <Button onClick={() => ironFinishDlg && doLot(ironFinishDlg.id, "finish_iron")}>Submit · Ready</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ready handover — reduce counts by how many pieces left */}
      <Dialog open={!!readyDlg} onOpenChange={(o) => !o && setReadyDlg(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record handover</DialogTitle>
            <DialogDescription>
              Batch #{readyDlg ? readyDlg.batchIndex + 1 : "—"} — enter how many pieces were taken out per line. The ready
              total goes down; if nothing is left, the batch is marked returned.
            </DialogDescription>
          </DialogHeader>
          {readyDlg && readyDlg.items?.length ? (
            <div className="space-y-3">
              {readyDlg.items.map((it) => (
                <div key={it.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[8rem] flex-1 text-sm">
                    {itemLabel(it.itemTypeId)}
                    {it.teamName && it.teamName !== "Unassigned" ? (
                      <span className="text-muted-foreground"> · {it.teamName}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">in stock {it.qty}</span>
                  <Label className="sr-only" htmlFor={`takeout-${it.id}`}>
                    Taken out
                  </Label>
                  <Input
                    id={`takeout-${it.id}`}
                    className="w-[5.5rem]"
                    type="number"
                    min={0}
                    max={it.qty}
                    value={readyTakeouts[it.id] ?? ""}
                    onChange={(e) =>
                      setReadyTakeouts((prev) => ({ ...prev, [it.id]: e.target.value }))
                    }
                  />
                  <span className="text-xs text-muted-foreground">taken</span>
                </div>
              ))}
            </div>
          ) : readyDlg ? (
            <p className="text-sm text-muted-foreground">No line items on this batch — contact support if this looks wrong.</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReadyDlg(null)} disabled={readyReturnSaving}>
              Cancel
            </Button>
            <Button onClick={submitReadyReturn} disabled={readyReturnSaving || !readyDlg?.items?.length}>
              {readyReturnSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={handoffOpen} onOpenChange={setHandoffOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Handoff remark</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-destructive">
            Long wait after wash before dry
            {handoffBody?.gapMinutes != null ? ` (~${Math.round(handoffBody.gapMinutes)} min)` : ""}. Enter reason.
          </p>
          <Textarea value={handoffRemark} onChange={(e) => setHandoffRemark(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setHandoffOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitHandoff}>Confirm dry start</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DobiLinenQrScanDialog
        open={linenScanOpen}
        onOpenChange={setLinenScanOpen}
        expectedOperatorId={operatorId}
        onApproved={async () => {
          await loadDay()
        }}
      />

      <Dialog open={manualAddOpen} onOpenChange={onManualDialogOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add linens (manual)</DialogTitle>
            <DialogDescription>
              Item types come from Operator → Dobi settings. Choose whether they go to pending wash or straight to ready
              (skip machines).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Add to</Label>
            <Select
              value={manualTargetStage}
              onValueChange={(v) => setManualTargetStage(v as "pending_wash" | "ready")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending_wash">Pending wash</SelectItem>
                <SelectItem value="ready">Ready</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {operatorItemTypesForManual.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active item types for this operator. Ask your operator to add them under Dobi settings.
            </p>
          ) : (
            <>
              {manualLines.map((row, i) => (
                <div key={i} className="flex w-full min-w-0 flex-nowrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Select
                      value={row.itemTypeId || undefined}
                      onValueChange={(v) => setManualLines((L) => L.map((x, j) => (j === i ? { ...x, itemTypeId: v } : x)))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Item type" />
                      </SelectTrigger>
                      <SelectContent>
                        {operatorItemTypesForManual.map((it: { id: string; label: string }) => (
                          <SelectItem key={it.id} value={String(it.id)}>
                            {it.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    className="w-[5.5rem]"
                    type="number"
                    min={1}
                    placeholder="Pcs"
                    value={row.qty}
                    onChange={(e) => setManualLines((L) => L.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setManualLines((L) => L.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setManualLines((L) => [...L, { teamName: "Unassigned", itemTypeId: "", qty: "1" }])}
              >
                <Plus className="mr-1 h-4 w-4" /> Line
              </Button>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onManualDialogOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={manualSaving || operatorItemTypesForManual.length === 0}
              onClick={submitManualAppend}
            >
              {manualSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {manualTargetStage === "ready" ? "Add to ready" : "Add to pending wash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={damageOpen} onOpenChange={onDamageDialogOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Damaged linens</DialogTitle>
            <DialogDescription>
              Same item list as manual add: pick type and pieces, describe what happened, add photos if needed.
            </DialogDescription>
          </DialogHeader>
          {operatorItemTypesForManual.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active item types for this operator. Ask your operator to add them under Dobi settings.
            </p>
          ) : (
            <>
              {damageLines.map((row, i) => (
                <div key={i} className="flex w-full min-w-0 flex-nowrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Select
                      value={row.itemTypeId || undefined}
                      onValueChange={(v) =>
                        setDamageLines((L) => L.map((x, j) => (j === i ? { ...x, itemTypeId: v } : x)))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Item type" />
                      </SelectTrigger>
                      <SelectContent>
                        {operatorItemTypesForManual.map((it: { id: string; label: string }) => (
                          <SelectItem key={it.id} value={String(it.id)}>
                            {it.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    className="w-[5.5rem]"
                    type="number"
                    min={1}
                    placeholder="Pcs"
                    value={row.qty}
                    onChange={(e) =>
                      setDamageLines((L) => L.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setDamageLines((L) => L.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setDamageLines((L) => [...L, { teamName: "Unassigned", itemTypeId: "", qty: "1" }])
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Line
              </Button>
            </>
          )}
          <div className="space-y-1">
            <Label>What happened (required)</Label>
            <Textarea value={damageRemark} onChange={(e) => setDamageRemark(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">Photos (optional, max 10)</Label>
            <input
              ref={damagePhotoInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => addDamagePhotoFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={damagePhotoFiles.length >= 10}
              onClick={() => damagePhotoInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              Upload photos
            </Button>
            {damagePhotoFiles.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {damagePhotoFiles.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                    <span className="truncate text-muted-foreground">{f.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setDamagePhotoFiles((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onDamageDialogOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={damageSaving || operatorItemTypesForManual.length === 0}
              onClick={submitDamage}
            >
              {damageSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
