"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fetchOperatorScheduleJobs, fetchOperatorSettings, saveOperatorSettings } from "@/lib/cleanlemon-api"
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

export default function EmployeeLinensPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [jobs, setJobs] = useState<Job[]>([])
  const [team, setTeam] = useState<string | null>(null)
  const [actionOpen, setActionOpen] = useState(false)
  const [actionType, setActionType] = useState<"collected" | "return">("collected")
  const [signature, setSignature] = useState("")
  const [hasSignature, setHasSignature] = useState(false)
  const [remark, setRemark] = useState("")
  const [missingQty, setMissingQty] = useState("0")
  const [savingAction, setSavingAction] = useState(false)
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const signatureWrapRef = useRef<HTMLDivElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)

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
      const r = await fetchOperatorScheduleJobs()
      if (cancelled) return
      const items = (Array.isArray(r?.items) ? r.items : []) as Job[]
      setJobs(items)
      setTeam(detectEmployeeTeam(items, user))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  const todayJobs = useMemo(() => {
    const byDate = jobs.filter((x) => String(x.date || "").slice(0, 10) === selectedDate)
    if (!team) return byDate
    return byDate.filter((x) => String(x.teamName || x.team || "").trim() === team)
  }, [jobs, selectedDate, team])

  const rows = useMemo(() => {
    return todayJobs.map((j) => {
      const bed = Number(j.bedCount) > 0 ? Number(j.bedCount) : 1
      return {
        id: j.id,
        unitNumber: j.unitNumber || "-",
        property: j.property || "-",
        bedCount: bed,
        bedsheet: bed,
        pillowCase: bed * 2,
        bedLinens: bed,
        bathmat: 1,
        towel: bed * 2,
      }
    })
  }, [todayJobs])

  const total = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        bedsheet: acc.bedsheet + r.bedsheet,
        pillowCase: acc.pillowCase + r.pillowCase,
        bedLinens: acc.bedLinens + r.bedLinens,
        bathmat: acc.bathmat + r.bathmat,
        towel: acc.towel + r.towel,
      }),
      { bedsheet: 0, pillowCase: 0, bedLinens: 0, bathmat: 0, towel: 0 },
    )
  }, [rows])

  const getCurrentLocation = async (): Promise<{ lat: number | null; lng: number | null }> => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return { lat: null, lng: null }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve({ lat: null, lng: null }),
        { timeout: 8000, enableHighAccuracy: true },
      )
    })
  }

  const submitLinenAction = async () => {
    if (!hasSignature || !signature.trim()) {
      toast.error("Signature is required.")
      return
    }
    if (actionType === "return" && Number(missingQty) > 0 && !remark.trim()) {
      toast.error("Please input remark when return has shortage.")
      return
    }
    setSavingAction(true)
    const now = new Date().toISOString()
    const location = await getCurrentLocation()
    const entry = {
      id: `linen-${Date.now()}`,
      date: selectedDate,
      action: actionType,
      team: team || "Unassigned",
      totals: total,
      missingQty: Number(missingQty) || 0,
      remark: remark.trim(),
      signature: signature.trim(),
      submittedAt: now,
      location,
    }
    const old = await fetchOperatorSettings(operatorId)
    const settings = old?.ok && old.settings && typeof old.settings === "object" ? old.settings : {}
    const prevLogs = Array.isArray(settings.linenLogs) ? settings.linenLogs : []
    const nextSettings = { ...settings, linenLogs: [entry, ...prevLogs].slice(0, 500) }
    const saved = await saveOperatorSettings(operatorId, nextSettings)
    setSavingAction(false)
    if (!saved?.ok) {
      toast.error(`Save failed (${saved?.reason || "unknown"})`)
      return
    }
    setActionOpen(false)
    setRemark("")
    setSignature("")
    setHasSignature(false)
    setMissingQty("0")
    toast.success(`Linen ${actionType} submitted.`)
  }

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const beginDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    canvas.setPointerCapture(e.pointerId)
    const p = getCanvasPoint(e)
    drawingRef.current = true
    lastPointRef.current = p
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = signatureCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const p = getCanvasPoint(e)
    const last = lastPointRef.current
    if (!last) return
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPointRef.current = p
    if (!hasSignature) setHasSignature(true)
  }

  const endDraw = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPointRef.current = null
    const canvas = signatureCanvasRef.current
    if (!canvas) return
    setSignature(canvas.toDataURL("image/png"))
  }

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setSignature("")
    setHasSignature(false)
  }

  useEffect(() => {
    if (!actionOpen) return
    const canvas = signatureCanvasRef.current
    const wrap = signatureWrapRef.current
    if (!canvas || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const cssWidth = Math.max(320, Math.floor(rect.width))
    const cssHeight = 180
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
    canvas.width = Math.floor(cssWidth * dpr)
    canvas.height = Math.floor(cssHeight * dpr)
    canvas.style.touchAction = "none"
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#111827"
    ctx.lineWidth = 2 * dpr
  }, [actionOpen])

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Linens</h1>
          <p className="text-muted-foreground">Based on today jobs and property bed count.</p>
        </div>
        <Button onClick={() => setActionOpen(true)}>Collected & Return</Button>
      </div>

      <div className="max-w-xs space-y-2">
        <Label>Date</Label>
        <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-5">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Bedsheet</p><p className="text-2xl font-semibold">{total.bedsheet}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Pillow Case</p><p className="text-2xl font-semibold">{total.pillowCase}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Bed Linens</p><p className="text-2xl font-semibold">{total.bedLinens}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Bathmat</p><p className="text-2xl font-semibold">{total.bathmat}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Towel</p><p className="text-2xl font-semibold">{total.towel}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Linen Pick List</CardTitle>
          <CardDescription>{team ? `Filtered by your team: ${team}` : "Showing all jobs for selected date."}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Bed Count</TableHead>
                  <TableHead>Bedsheet</TableHead>
                  <TableHead>Pillow Case</TableHead>
                  <TableHead>Bed Linens</TableHead>
                  <TableHead>Bathmat</TableHead>
                  <TableHead>Towel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">Loading linens...</TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">No jobs for selected date.</TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.unitNumber}</div>
                        <div className="text-xs text-muted-foreground">{r.property}</div>
                      </TableCell>
                      <TableCell>{r.bedCount}</TableCell>
                      <TableCell>{r.bedsheet}</TableCell>
                      <TableCell>{r.pillowCase}</TableCell>
                      <TableCell>{r.bedLinens}</TableCell>
                      <TableCell>{r.bathmat}</TableCell>
                      <TableCell>{r.towel}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={actionOpen} onOpenChange={setActionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Collected & Return</DialogTitle>
            <DialogDescription>
              Submit linen collected/return with signature, time and location.
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
              <Label>Signature</Label>
              <div ref={signatureWrapRef} className="rounded-md border bg-background p-2">
                <canvas
                  ref={signatureCanvasRef}
                  className="h-[180px] w-full touch-none rounded border bg-white"
                  onPointerDown={beginDraw}
                  onPointerMove={moveDraw}
                  onPointerUp={endDraw}
                  onPointerLeave={endDraw}
                />
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Please sign by finger/mouse.</p>
                  <Button type="button" variant="outline" size="sm" onClick={clearSignature}>
                    Clear
                  </Button>
                </div>
              </div>
            </div>
            {actionType === "return" ? (
              <div className="space-y-2">
                <Label>Missing qty (if any)</Label>
                <Input
                  type="number"
                  min={0}
                  value={missingQty}
                  onChange={(e) => setMissingQty(e.target.value)}
                />
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionOpen(false)}>Cancel</Button>
            <Button onClick={submitLinenAction} disabled={savingAction}>
              {savingAction ? "Saving..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

