"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { FileText, Pen, Clock, CheckCircle2, AlertCircle } from "lucide-react"
import { fetchOperatorAgreements, signOperatorAgreement } from "@/lib/cleanlemon-api"
import { toast } from "sonner"

interface AgreementItem {
  _id: string
  property?: { shortname?: string; property_name?: string }
  status?: string
  agreement?: { _id?: string }
  agreementid?: string
  propertyid?: string
}

type AgreementStatus = "pending" | "waiting_third" | "completed"

function getStatusInfo(status: AgreementStatus) {
  switch (status) {
    case "pending":
      return { label: "Pending Signature", color: "bg-red-100 text-red-800", icon: AlertCircle, textColor: "text-destructive" }
    case "waiting_third":
      return { label: "Pending Complete", color: "bg-yellow-100 text-yellow-800", icon: Clock, textColor: "text-muted-foreground" }
    case "completed":
      return { label: "Completed", color: "bg-green-100 text-green-800", icon: CheckCircle2, textColor: "text-foreground" }
  }
}

function normalizeClientAgreementStatus(raw?: string): AgreementStatus {
  const st = String(raw || "").trim().toLowerCase()
  if (st === "completed") return "completed"
  if (st === "waiting_third") return "waiting_third"
  return "pending"
}

function ClientAgreementPageContent() {
  const searchParams = useSearchParams()
  const [agreements, setAgreements] = useState<AgreementItem[]>([])
  const [selectedAgreement, setSelectedAgreement] = useState<AgreementItem | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSigning, setIsSigning] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState("")
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const res = await fetchOperatorAgreements()
        const items = ((res?.items || res?.agreements || []) as AgreementItem[]) || []
        if (!cancelled) setAgreements(items)
      } catch {
        if (!cancelled) setAgreements([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const idFromUrl = String(searchParams.get("id") || "").trim()
    if (!idFromUrl) return
    setAgreements((prev) => {
      const exists = prev.some((a) => (a.agreement?._id || a._id) === idFromUrl)
      if (exists) return prev
      return [
        {
          _id: idFromUrl,
          agreement: { _id: idFromUrl },
          status: "pending",
          property: { shortname: "Agreement" },
        },
        ...prev,
      ]
    })
  }, [searchParams])

  const clearSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setSignatureDataUrl("")
  }

  useEffect(() => {
    if (!isDialogOpen) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "#000"
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    setSignatureDataUrl("")
  }, [isDialogOpen, selectedAgreement?._id])

  const getCanvasPoint = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const clientX = "touches" in e ? e.touches[0]?.clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0]?.clientY : e.clientY
    if (clientX == null || clientY == null) return null
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const p = getCanvasPoint(e)
    if (!p || !canvasRef.current) return
    const ctx = canvasRef.current.getContext("2d")
    if (!ctx) return
    drawingRef.current = true
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const moveDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!drawingRef.current) return
    const p = getCanvasPoint(e)
    if (!p || !canvasRef.current) return
    const ctx = canvasRef.current.getContext("2d")
    if (!ctx) return
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  const endDraw = () => {
    if (!drawingRef.current || !canvasRef.current) return
    drawingRef.current = false
    try {
      setSignatureDataUrl(canvasRef.current.toDataURL("image/png"))
    } catch {
      // ignore
    }
  }

  const handleSign = async () => {
    if (!selectedAgreement || !signatureDataUrl) return
    const agreementId = selectedAgreement.agreement?._id || selectedAgreement._id
    if (!agreementId) return
    setIsSigning(true)
    try {
      const res = await signOperatorAgreement(agreementId, {
        signerName: "",
        signerEmail: "",
        signatureDataUrl,
        signedFrom: "client_portal",
        signedAt: new Date().toISOString(),
      })
      if (!res?.ok) throw new Error(res?.reason || "Sign failed")
      toast.success("Signed. Operator will sign next to complete.")
      setAgreements((prev) =>
        prev.map((it) =>
          (it.agreement?._id || it._id) === agreementId ? { ...it, status: "waiting_third" } : it
        )
      )
      setIsDialogOpen(false)
      setSelectedAgreement(null)
      setSignatureDataUrl("")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign failed")
    } finally {
      setIsSigning(false)
    }
  }

  const openAgreement = (agreement: AgreementItem) => {
    setSelectedAgreement(agreement)
    setSignatureDataUrl("")
    setIsDialogOpen(true)
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">My Agreements</h1>
        <p className="text-muted-foreground">View and sign your property agreements.</p>
      </div>

      <div className="space-y-4">
        {agreements.map((agreement) => {
          const status = normalizeClientAgreementStatus(agreement.status)
          const statusInfo = getStatusInfo(status)
          const StatusIcon = statusInfo.icon
          const canClientSign = status === "pending"
          const title = agreement.property?.shortname || agreement.property?.property_name || "Unknown"
          return (
            <Card key={agreement._id}>
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex-shrink-0 rounded-lg bg-primary/10 p-3">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className={`truncate font-medium ${statusInfo.textColor}`}>{title}</h3>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3 sm:flex-nowrap">
                  <Badge className={`${statusInfo.color} flex-shrink-0`}>
                    <StatusIcon className="mr-1 h-3 w-3" />
                    {statusInfo.label}
                  </Badge>
                  {canClientSign && (
                    <Button size="sm" onClick={() => openAgreement(agreement)} className="flex-shrink-0">
                      <Pen className="mr-2 h-4 w-4" />
                      Sign
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {agreements.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-medium">No agreements found</h3>
            <p className="text-sm text-muted-foreground">You don&apos;t have any agreements yet.</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sign Agreement - {selectedAgreement?.property?.shortname || selectedAgreement?.property?.property_name || "Agreement"}</DialogTitle>
            <DialogDescription>Review and sign your agreement below.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium">Your Signature</label>
            <div
              className="rounded-lg border-2 border-dashed border-border bg-white w-full overflow-hidden"
              style={{ height: 220 }}
              onMouseDown={startDraw}
              onMouseMove={moveDraw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={moveDraw}
              onTouchEnd={endDraw}
            >
              <canvas
                ref={canvasRef}
                className="block w-full h-full touch-none cursor-crosshair"
                style={{ width: "100%", height: "100%" }}
                width={400}
                height={220}
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={clearSignature}>
                <Pen size={14} /> Clear
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSign} disabled={isSigning || !signatureDataUrl}>
              {isSigning ? "Signing..." : "Agree & Sign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function ClientAgreementPage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Loading…</div>}>
      <ClientAgreementPageContent />
    </Suspense>
  )
}
