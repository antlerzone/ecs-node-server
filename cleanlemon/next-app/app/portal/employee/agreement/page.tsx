"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { fetchOperatorAgreements, signOperatorAgreement } from "@/lib/cleanlemon-api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FileSignature, CheckCircle2, Clock3 } from "lucide-react"
import { toast } from "sonner"

type Agreement = {
  id: string
  recipientName?: string
  recipientEmail?: string
  recipientType?: string
  templateName?: string
  templateMode?: string
  salary?: number
  startDate?: string
  status?: string
  createdAt?: string
  signedAt?: string
  signedMeta?: unknown
}

function normalize(v: unknown): string {
  return String(v || "").trim().toLowerCase()
}

function clientHasSigned(meta: unknown): boolean {
  const m = meta as { parties?: { client?: { signatureDataUrl?: string } }; clientSignAt?: string } | null
  return !!(m?.parties?.client?.signatureDataUrl || m?.clientSignAt)
}

function isPendingStatus(v: unknown): boolean {
  const s = normalize(v)
  return (
    s === "sent" ||
    s === "draft" ||
    s === "pending" ||
    s === "signing" ||
    s === "pending_staff_sign" ||
    s === "pending_client_sign" ||
    s === "pending_operator_sign"
  )
}

/** Operator & staff contracts: employee signs. Operator & client: staff is not a signatory. */
function staffCanSignNow(status: unknown, templateMode?: unknown, signedMeta?: unknown): boolean {
  if (normalize(templateMode) === "operator_client") return false
  const s = normalize(status)
  const active =
    s === "signing" || s === "pending_staff_sign" || s === "sent" || s === "draft"
  if (!active) return false
  const m = signedMeta as { parties?: { staff?: { signatureDataUrl?: string } }; staffSignAt?: string } | null
  if (m?.parties?.staff?.signatureDataUrl) return false
  if (m?.staffSignAt) return false
  return true
}

export default function EmployeeAgreementPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Agreement[]>([])
  const [signOpen, setSignOpen] = useState(false)
  const [selected, setSelected] = useState<Agreement | null>(null)
  const [remark, setRemark] = useState("")
  const [saving, setSaving] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState("")
  const [hasSignature, setHasSignature] = useState(false)

  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const signatureWrapRef = useRef<HTMLDivElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)

  const load = async () => {
    setLoading(true)
    const r = await fetchOperatorAgreements()
    const all = (Array.isArray(r?.items) ? r.items : []) as Agreement[]
    const meEmail = normalize(user?.email)
    const meName = normalize(user?.name)
    const mine = all.filter((x) => {
      const targetEmail = normalize(x.recipientEmail)
      const targetName = normalize(x.recipientName)
      const isEmployee = normalize(x.recipientType || "employee") === "employee"
      if (!isEmployee) return false
      if (meEmail && targetEmail === meEmail) return true
      if (meName && targetName && (targetName.includes(meName) || meName.includes(targetName))) return true
      return false
    })
    setItems(mine)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [user?.email, user?.name])

  const pending = useMemo(() => items.filter((x) => isPendingStatus(x.status)), [items])
  const signed = useMemo(() => {
    const s = (v: unknown) => normalize(v)
    return items.filter((x) => s(x.status) === "signed" || s(x.status) === "complete")
  }, [items])

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
    setSignatureDataUrl(canvas.toDataURL("image/png"))
  }

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setSignatureDataUrl("")
    setHasSignature(false)
  }

  useEffect(() => {
    if (!signOpen) return
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
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#111827"
    ctx.lineWidth = 2 * dpr
  }, [signOpen])

  const openSign = (ag: Agreement) => {
    setSelected(ag)
    setRemark("")
    setSignatureDataUrl("")
    setHasSignature(false)
    setSignOpen(true)
  }

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

  const submitSign = async () => {
    if (!selected?.id) return
    if (!hasSignature || !signatureDataUrl) {
      toast.error("Please draw your signature first.")
      return
    }
    setSaving(true)
    const location = await getCurrentLocation()
    const res = await signOperatorAgreement(selected.id, {
      signerName: user?.name || selected.recipientName || "",
      signerEmail: user?.email || selected.recipientEmail || "",
      signatureDataUrl,
      remark: remark.trim(),
      location,
      signedFrom: "employee_portal",
      signedAt: new Date().toISOString(),
    })
    setSaving(false)
    if (!res?.ok) {
      toast.error(`Sign failed (${res?.reason || "unknown"})`)
      return
    }
    toast.success("Your signature saved. Your employer will sign next on Operator → Agreements.")
    setSignOpen(false)
    setSelected(null)
    await load()
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Agreement</h1>
        <p className="text-muted-foreground">Review and sign your employee contract.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Agreements</CardTitle>
          <CardDescription>Only your agreements are shown here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading agreements...</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending agreement.</p>
          ) : (
            pending.map((ag) => {
              const canSign = staffCanSignNow(ag.status, ag.templateMode, ag.signedMeta)
              const st = normalize(ag.status)
              const mode = normalize(ag.templateMode)
              return (
                <div key={ag.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{ag.templateName || "Employee Contract"}</p>
                      <p className="text-xs text-muted-foreground">Agreement ID: {ag.id}</p>
                      <p className="text-xs text-muted-foreground">Start Date: {ag.startDate || "-"}</p>
                      <p className="text-xs text-muted-foreground">Salary: RM {Number(ag.salary || 0).toLocaleString()}</p>
                    </div>
                    <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                      <Clock3 className="mr-1 h-3.5 w-3.5" />
                      {ag.status || "pending"}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    {canSign ? (
                      <Button onClick={() => openSign(ag)}>
                        <FileSignature className="mr-2 h-4 w-4" />
                        Sign Agreement
                      </Button>
                    ) : mode === "operator_client" &&
                      clientHasSigned(ag.signedMeta) &&
                      (st === "pending_operator_sign" || st === "signing") ? (
                      <p className="text-sm text-muted-foreground">
                        <strong>Operator &amp; client</strong> contract: client has signed; waiting for your employer
                        (operator/supervisor) to sign on <strong>Operator → Agreements</strong> — not staff.
                      </p>
                    ) : mode === "operator_client" ? (
                      <p className="text-sm text-muted-foreground">
                        <strong>Operator &amp; client</strong> contract: only the <strong>customer</strong> and{' '}
                        <strong>operator</strong> sign — staff do not sign this document.
                      </p>
                    ) : (st === "pending_operator_sign" || st === "signing") && mode === "operator_staff" && !canSign ? (
                      <p className="text-sm text-muted-foreground">
                        You have signed. Waiting for your employer (operator/supervisor) to sign on{' '}
                        <strong>Operator → Agreements</strong>.
                      </p>
                    ) : st === "pending_client_sign" ? (
                      <p className="text-sm text-muted-foreground">
                        Waiting for <strong>client</strong> (customer) to sign.
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Waiting for profiles (yours and/or operator company) to be completed before you can sign.
                      </p>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signed Agreements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {signed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No signed agreement yet.</p>
          ) : (
            signed.map((ag) => (
              <div key={ag.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium">{ag.templateName || "Employee Contract"}</p>
                  <p className="text-xs text-muted-foreground">Signed at: {ag.signedAt || "-"}</p>
                </div>
                <Badge variant="secondary" className="bg-green-100 text-green-800">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  complete
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign Agreement</DialogTitle>
            <DialogDescription>
              Draw your signature to accept this contract.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
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
            <div className="space-y-2">
              <Label>Remark (optional)</Label>
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Optional notes before submitting signature"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignOpen(false)}>Cancel</Button>
            <Button onClick={submitSign} disabled={saving}>
              {saving ? "Submitting..." : "Submit Signature"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

