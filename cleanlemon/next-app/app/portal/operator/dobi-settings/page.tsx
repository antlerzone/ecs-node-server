"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  fetchOperatorDobiConfig,
  putOperatorDobiConfig,
  putOperatorDobiItemTypes,
  putOperatorDobiMachines,
} from "@/lib/cleanlemon-api"
import { useEffectiveOperatorId } from "@/lib/cleanlemon-effective-operator-id"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Pencil, Plus, Settings, Trash2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

type ItemRow = { id: string; label: string; active: boolean; washBatchPcs: number; washRoundMinutes: number }
type MachineRow = {
  id: string
  kind: "washer" | "dryer" | "iron"
  name: string
  capacityPcs: number
  roundMinutes: number
  active: boolean
}

export default function OperatorDobiSettingsPage() {
  const { user } = useAuth()
  const effectiveOp = useEffectiveOperatorId(user)
  const operatorId = effectiveOp || user?.operatorId || ""

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [handoffMin, setHandoffMin] = useState(15)
  const [linenQrStyle, setLinenQrStyle] = useState<"rotate_1min" | "permanent">("rotate_1min")
  const [itemRows, setItemRows] = useState<ItemRow[]>([])
  const [machineRows, setMachineRows] = useState<MachineRow[]>([])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mainTab, setMainTab] = useState("items")

  const [itemDraft, setItemDraft] = useState<ItemRow | null>(null)
  const [machineDraft, setMachineDraft] = useState<MachineRow | null>(null)

  const load = useCallback(async () => {
    if (!operatorId) return
    setLoading(true)
    const r = await fetchOperatorDobiConfig(operatorId)
    setLoading(false)
    if (!r?.ok) {
      toast.error(r?.reason || "Load failed")
      return
    }
    setHandoffMin(Number(r.config?.handoffWashToDryWarningMinutes) || 15)
    const st = String(r.config?.linenQrStyle || "").toLowerCase()
    setLinenQrStyle(st === "permanent" ? "permanent" : "rotate_1min")
    const items = Array.isArray(r.itemTypes) ? r.itemTypes : []
    setItemRows(
      items.map(
        (x: {
          id: string
          label: string
          active?: boolean
          washBatchPcs?: number
          washRoundMinutes?: number
        }) => ({
          id: String(x.id),
          label: String(x.label || ""),
          active: x.active !== false,
          washBatchPcs: Math.max(1, Number(x.washBatchPcs) || 40),
          washRoundMinutes: Math.max(1, Number(x.washRoundMinutes) || 45),
        })
      )
    )
    const machines = Array.isArray(r.machines) ? r.machines : []
    setMachineRows(
      machines.map(
        (m: {
          id: string
          kind: string
          name: string
          capacityPcs?: number
          roundMinutes?: number
          active?: boolean
        }) => ({
          id: String(m.id),
          kind: (String(m.kind) as "washer" | "dryer" | "iron") || "washer",
          name: String(m.name || ""),
          capacityPcs: Number(m.capacityPcs) || 40,
          roundMinutes: Number(m.roundMinutes) || 45,
          active: m.active !== false,
        })
      )
    )
  }, [operatorId])

  useEffect(() => {
    load()
  }, [load])

  const saveSettingsOnly = async () => {
    if (!operatorId) {
      toast.error("No operator")
      return
    }
    const r = await putOperatorDobiConfig({
      operatorId,
      handoffWashToDryWarningMinutes: handoffMin,
      linenQrStyle,
    })
    if (!r?.ok) {
      toast.error(r?.reason || "Save failed")
      return
    }
    toast.success("Settings saved")
    void load()
    setSettingsOpen(false)
  }

  const saveAll = async () => {
    if (!operatorId) {
      toast.error("No operator")
      return
    }
    setSaving(true)
    try {
      const c = await putOperatorDobiConfig({
        operatorId,
        handoffWashToDryWarningMinutes: handoffMin,
        linenQrStyle,
      })
      if (!c?.ok) {
        toast.error(c?.reason || "Config save failed")
        return
      }
      const it = await putOperatorDobiItemTypes({
        operatorId,
        items: itemRows
          .filter((x) => x.label.trim())
          .map((x) => ({
            id: x.id,
            label: x.label.trim(),
            active: x.active,
            washBatchPcs: Math.max(1, Math.floor(x.washBatchPcs) || 40),
            washRoundMinutes: Math.max(1, Math.floor(x.washRoundMinutes) || 45),
          })),
      })
      if (!it?.ok) {
        toast.error(it?.reason || "Items save failed")
        return
      }
      const mc = await putOperatorDobiMachines({
        operatorId,
        machines: machineRows.map((m) => ({
          id: m.id,
          kind: m.kind,
          name: m.name || m.kind,
          capacityPcs: m.capacityPcs,
          roundMinutes: m.roundMinutes,
          active: m.active,
        })),
      })
      if (!mc?.ok) {
        toast.error(mc?.reason || "Machines save failed")
        return
      }
      toast.success("Saved")
      load()
    } finally {
      setSaving(false)
    }
  }

  const saveItemDraft = () => {
    if (!itemDraft) return
    setItemRows((rows) => rows.map((r) => (r.id === itemDraft.id ? { ...itemDraft } : r)))
    setItemDraft(null)
  }

  const deleteItemDraft = () => {
    if (!itemDraft) return
    setItemRows((rows) => rows.filter((r) => r.id !== itemDraft.id))
    setItemDraft(null)
  }

  const saveMachineDraft = () => {
    if (!machineDraft) return
    setMachineRows((rows) => rows.map((r) => (r.id === machineDraft.id ? { ...machineDraft } : r)))
    setMachineDraft(null)
  }

  const deleteMachineDraft = () => {
    if (!machineDraft) return
    setMachineRows((rows) => rows.filter((r) => r.id !== machineDraft.id))
    setMachineDraft(null)
  }

  const kindLabel = (k: string) =>
    k === "washer" ? "Washer" : k === "dryer" ? "Dryer" : k === "iron" ? "Iron" : k

  const isWasherKind = (k: string) => k === "washer"

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-20 lg:pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dobi settings</h1>
          <p className="text-sm text-muted-foreground">
            Each item type sets its own wash batch (pcs) and wash time. Machines: dryer/iron timing below; washer is only
            which machine to use.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setSettingsOpen(true)}>
          <Settings className="h-4 w-4" />
          Settings
        </Button>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Employee linen QR and wash→dry handoff warning.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="space-y-2">
              <Label className="text-base font-medium">Employee linen QR</Label>
              <p className="text-xs text-muted-foreground">
                How cleaners show the handoff QR on Employee → Linens. Rotate = new code every minute. Permanent = same
                code until approved or regenerated.
              </p>
              <Select
                value={linenQrStyle}
                onValueChange={(v) => setLinenQrStyle(v as "rotate_1min" | "permanent")}
                disabled={loading}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rotate_1min">Refresh every 1 minute (recommended)</SelectItem>
                  <SelectItem value="permanent">Permanent QR (long-lived token)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-base font-medium">Handoff</Label>
              <p className="text-xs text-muted-foreground">
                If wash finished and dry starts later than this many minutes, staff must enter a remark (employee Dobi
                flow).
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Wash → dry warning (minutes)</Label>
                <Input
                  type="number"
                  min={0}
                  max={600}
                  value={handoffMin}
                  onChange={(e) => setHandoffMin(Number(e.target.value) || 0)}
                  disabled={loading}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveSettingsOnly} disabled={loading}>
              Save settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={mainTab} onValueChange={setMainTab} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-2 p-1">
          <TabsTrigger value="items">Item types</TabsTrigger>
          <TabsTrigger value="machines">Machines</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setItemRows((r) => [
                  ...r,
                  { id: newId(), label: "", active: true, washBatchPcs: 40, washRoundMinutes: 45 },
                ])
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>

          {/* Desktop: table + edit dialog */}
          <div className="hidden md:block rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead className="text-right tabular-nums">Batch (pcs)</TableHead>
                  <TableHead className="text-right tabular-nums">Wash (min)</TableHead>
                  <TableHead className="w-[90px]">Active</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemRows.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No items — click Add or save to load defaults.
                    </TableCell>
                  </TableRow>
                ) : (
                  itemRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.label.trim() || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.washBatchPcs}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.washRoundMinutes}</TableCell>
                      <TableCell>
                        <Badge variant={row.active ? "default" : "secondary"}>{row.active ? "On" : "Off"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => setItemDraft({ ...row })}>
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: card list (inline edit) */}
          <Card className="md:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Item types</CardTitle>
              <CardDescription>Used when logging linens (bedsheet, towel, …).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {itemRows.length === 0 && !loading ? (
                <p className="text-sm text-muted-foreground">No items — click Add or Save all to load defaults.</p>
              ) : (
                itemRows.map((row, i) => (
                  <div key={row.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Label</Label>
                      <Input
                        value={row.label}
                        onChange={(e) => {
                          const v = e.target.value
                          setItemRows((rows) => rows.map((x, j) => (j === i ? { ...x, label: v } : x)))
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Batch (pcs / load)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={row.washBatchPcs}
                        onChange={(e) =>
                          setItemRows((rows) =>
                            rows.map((x, j) =>
                              j === i ? { ...x, washBatchPcs: Math.max(1, Number(e.target.value) || 1) } : x
                            )
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Wash (minutes)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={row.washRoundMinutes}
                        onChange={(e) =>
                          setItemRows((rows) =>
                            rows.map((x, j) =>
                              j === i ? { ...x, washRoundMinutes: Math.max(1, Number(e.target.value) || 1) } : x
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-2 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setItemRows((rows) => rows.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Remove
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Dialog open={!!itemDraft} onOpenChange={(o) => !o && setItemDraft(null)}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Edit item type</DialogTitle>
                <DialogDescription>
                  One wash load uses only this type (no mixing). Batch size and wash minutes apply when staff run the
                  washer for this type.
                </DialogDescription>
              </DialogHeader>
              {itemDraft ? (
                <div className="space-y-4 py-1">
                  <div className="space-y-1">
                    <Label>Label</Label>
                    <Input value={itemDraft.label} onChange={(e) => setItemDraft({ ...itemDraft, label: e.target.value })} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Batch (pcs per load)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={itemDraft.washBatchPcs}
                        onChange={(e) =>
                          setItemDraft({
                            ...itemDraft,
                            washBatchPcs: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Wash (minutes)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={itemDraft.washRoundMinutes}
                        onChange={(e) =>
                          setItemDraft({
                            ...itemDraft,
                            washRoundMinutes: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Active</p>
                      <p className="text-xs text-muted-foreground">Inactive types are hidden from new logs.</p>
                    </div>
                    <Switch
                      checked={itemDraft.active}
                      onCheckedChange={(v) => setItemDraft({ ...itemDraft, active: v })}
                    />
                  </div>
                </div>
              ) : null}
              <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
                <Button type="button" variant="destructive" className="w-full sm:mr-auto sm:w-auto" onClick={deleteItemDraft}>
                  Delete
                </Button>
                <div className="flex w-full gap-2 sm:w-auto sm:justify-end">
                  <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => setItemDraft(null)}>
                    Cancel
                  </Button>
                  <Button type="button" className="flex-1 sm:flex-none" onClick={saveItemDraft}>
                    Save
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="machines" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setMachineRows((r) => [
                  ...r,
                  { id: newId(), kind: "washer", name: "Washer", capacityPcs: 40, roundMinutes: 45, active: true },
                ])
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>

          <div className="hidden md:block rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Capacity</TableHead>
                  <TableHead className="text-right">Round (min)</TableHead>
                  <TableHead className="w-[90px]">Active</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {machineRows.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Add machines staff will pick in the Dobi flow. Wash batch size is set per item type (not here for
                      washers).
                    </TableCell>
                  </TableRow>
                ) : (
                  machineRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{kindLabel(row.kind)}</TableCell>
                      <TableCell className="font-medium">{row.name || "—"}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${isWasherKind(row.kind) ? "text-muted-foreground" : ""}`}
                        title={isWasherKind(row.kind) ? "Per item type" : undefined}
                      >
                        {isWasherKind(row.kind) ? "—" : row.capacityPcs}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${isWasherKind(row.kind) ? "text-muted-foreground" : ""}`}
                        title={isWasherKind(row.kind) ? "Per item type" : undefined}
                      >
                        {isWasherKind(row.kind) ? "—" : row.roundMinutes}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.active ? "default" : "secondary"}>{row.active ? "On" : "Off"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => setMachineDraft({ ...row })}>
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <Card className="md:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Machines</CardTitle>
              <CardDescription>
                Dryer/iron: capacity and round time here. Washer: only name/active — batch size and wash minutes are on
                each item type.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {machineRows.map((row, i) => (
                <div key={row.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Kind</Label>
                    <Select
                      value={row.kind}
                      onValueChange={(v) =>
                        setMachineRows((rows) =>
                          rows.map((x, j) => (j === i ? { ...x, kind: v as "washer" | "dryer" | "iron" } : x))
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="washer">Washer</SelectItem>
                        <SelectItem value="dryer">Dryer</SelectItem>
                        <SelectItem value="iron">Iron</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={row.name}
                      onChange={(e) =>
                        setMachineRows((rows) => rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                      }
                    />
                  </div>
                  {isWasherKind(row.kind) ? (
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      Washer: batch size and wash time are set under Item types (each product is washed separately).
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Capacity (pcs / round)</Label>
                        <Input
                          type="number"
                          min={1}
                          value={row.capacityPcs}
                          onChange={(e) =>
                            setMachineRows((rows) =>
                              rows.map((x, j) => (j === i ? { ...x, capacityPcs: Number(e.target.value) || 1 } : x))
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Round (minutes)</Label>
                        <Input
                          type="number"
                          min={1}
                          value={row.roundMinutes}
                          onChange={(e) =>
                            setMachineRows((rows) =>
                              rows.map((x, j) => (j === i ? { ...x, roundMinutes: Number(e.target.value) || 1 } : x))
                            )
                          }
                        />
                      </div>
                    </>
                  )}
                  <div className="sm:col-span-2 flex justify-end">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setMachineRows((rows) => rows.filter((_, j) => j !== i))}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              {machineRows.length === 0 && !loading && (
                <p className="text-sm text-muted-foreground">Add washer, dryer, and iron machines for the Dobi flow.</p>
              )}
            </CardContent>
          </Card>

          <Sheet open={!!machineDraft} onOpenChange={(o) => !o && setMachineDraft(null)}>
            <SheetContent className="flex flex-col gap-0 overflow-y-auto sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Edit machine</SheetTitle>
              </SheetHeader>
              {machineDraft ? (
                <div className="flex flex-1 flex-col gap-4 py-4">
                  <div className="space-y-1">
                    <Label>Kind</Label>
                    <Select
                      value={machineDraft.kind}
                      onValueChange={(v) => setMachineDraft({ ...machineDraft, kind: v as "washer" | "dryer" | "iron" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="washer">Washer</SelectItem>
                        <SelectItem value="dryer">Dryer</SelectItem>
                        <SelectItem value="iron">Iron</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Name</Label>
                    <Input value={machineDraft.name} onChange={(e) => setMachineDraft({ ...machineDraft, name: e.target.value })} />
                  </div>
                  {isWasherKind(machineDraft.kind) ? (
                    <p className="text-sm text-muted-foreground">
                      Batch size and wash duration for this washer come from each item type (bedsheet, towel, …), not from
                      the machine row.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label>Capacity (pcs / round)</Label>
                        <Input
                          type="number"
                          min={1}
                          value={machineDraft.capacityPcs}
                          onChange={(e) =>
                            setMachineDraft({ ...machineDraft, capacityPcs: Number(e.target.value) || 1 })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Round (minutes)</Label>
                        <Input
                          type="number"
                          min={1}
                          value={machineDraft.roundMinutes}
                          onChange={(e) =>
                            setMachineDraft({ ...machineDraft, roundMinutes: Number(e.target.value) || 1 })
                          }
                        />
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Active</p>
                      <p className="text-xs text-muted-foreground">Inactive machines are hidden from staff.</p>
                    </div>
                    <Switch
                      checked={machineDraft.active}
                      onCheckedChange={(v) => setMachineDraft({ ...machineDraft, active: v })}
                    />
                  </div>
                </div>
              ) : null}
              <SheetFooter className="mt-auto flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-between">
                <Button type="button" variant="destructive" className="w-full sm:w-auto" onClick={deleteMachineDraft}>
                  Delete
                </Button>
                <div className="flex w-full gap-2 sm:w-auto sm:justify-end">
                  <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => setMachineDraft(null)}>
                    Cancel
                  </Button>
                  <Button type="button" className="flex-1 sm:flex-none" onClick={saveMachineDraft}>
                    Save
                  </Button>
                </div>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={saveAll} disabled={saving || loading || !operatorId}>
          {saving ? "Saving…" : "Save all"}
        </Button>
      </div>
    </div>
  )
}
