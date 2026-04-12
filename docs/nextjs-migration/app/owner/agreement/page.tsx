"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { FileText, Download, Pen, Clock, CheckCircle2, AlertCircle } from "lucide-react"
import { getOwner, getAgreementList, getAgreement, updateAgreementSign, completeAgreementApproval } from "@/lib/owner-api"
import { portalHttpsAssetUrl, toDrivePreviewUrl } from "@/lib/utils"

interface AgreementItem {
  _id: string
  property?: { shortname?: string }
  status?: string
  agreement?: { _id?: string; pdfurl?: string; agreementtemplate?: string; property?: string; tenancy?: string; client?: string }
  agreementid?: string
  propertyid?: string
  tenancyid?: string
  clientid?: string
}

type AgreementStatus = "pending" | "waiting_third" | "completed"

function getStatusInfo(status: AgreementStatus) {
  switch (status) {
    case "pending":
      return {
        label: "Pending Signature",
        color: "bg-red-100 text-red-800",
        icon: AlertCircle,
        textColor: "text-destructive",
      }
    case "waiting_third":
      return {
        label: "Pending Complete",
        color: "bg-yellow-100 text-yellow-800",
        icon: Clock,
        textColor: "text-muted-foreground",
      }
    case "completed":
      return {
        label: "Completed",
        color: "bg-green-100 text-green-800",
        icon: CheckCircle2,
        textColor: "text-foreground",
      }
  }
}

function normalizeOwnerAgreementStatus(raw?: string): AgreementStatus {
  const st = String(raw || "").trim().toLowerCase()
  if (st === "completed") return "completed"
  // ready_for_signature / locked / pending are all signable waiting states for owner UI
  if (st === "ready_for_signature" || st === "locked" || st === "pending") return "pending"
  if (st === "waiting_third") return "waiting_third"
  return "pending"
}

function hasOwnerSigned(item: AgreementItem): boolean {
  const sign = String((item.agreement as { ownersign?: string } | undefined)?.ownersign || "").trim()
  const signedAt = String((item.agreement as { ownerSignedAt?: string } | undefined)?.ownerSignedAt || "").trim()
  return sign !== "" || signedAt !== ""
}

export default function OwnerAgreementPage() {
  const [owner, setOwner] = useState<{ _id?: string } | null>(null)
  const [agreements, setAgreements] = useState<AgreementItem[]>([])
  const [selectedAgreement, setSelectedAgreement] = useState<AgreementItem | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSigning, setIsSigning] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState("")
  const [signError, setSignError] = useState<string>("")
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const [loading, setLoading] = useState(true)

  const ecsBase = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")

  const openAgreementPreviewUrl = (url: string) => {
    const normalized = toDrivePreviewUrl(portalHttpsAssetUrl(url, ecsBase))
    if (!normalized.startsWith("http")) return
    window.open(normalized, "_blank", "noopener,noreferrer")
  }

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const ownerRes = await getOwner()
        if (ownerRes.ok && ownerRes.owner) {
          const o = ownerRes.owner as { _id?: string }
          setOwner(o)
          const listRes = await getAgreementList({ ownerId: o._id || "" })
          if (listRes.ok && listRes.items && !cancelled) {
            setAgreements((listRes.items as AgreementItem[]) || [])
          }
        }
      } catch (e) {
        console.error("Agreement init", e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  const handleSign = async () => {
    if (!selectedAgreement || !signatureDataUrl || !owner) return
    setIsSigning(true)
    setSignError("")
    try {
      const freshRes = await getAgreement({ agreementId: selectedAgreement.agreement?._id || selectedAgreement._id })
      if (!freshRes.ok || !freshRes.agreement) throw new Error("Agreement not found")
      await updateAgreementSign({
        agreementId: selectedAgreement.agreement?._id || selectedAgreement._id,
        ownersign: signatureDataUrl,
      })
      await completeAgreementApproval({
        ownerId: owner._id!,
        propertyId: selectedAgreement.propertyid || selectedAgreement.agreement?.property as string || "",
        clientId: selectedAgreement.clientid || selectedAgreement.agreement?.client as string || "",
        agreementId: selectedAgreement.agreement?._id || selectedAgreement._id,
      })
      setIsDialogOpen(false)
      setSelectedAgreement(null)
      setSignatureDataUrl("")
      const listRes = await getAgreementList({ ownerId: owner._id! })
      if (listRes.ok && listRes.items) setAgreements((listRes.items as AgreementItem[]) || [])
    } catch (e) {
      console.error("Sign failed", e)
      setSignError(e instanceof Error ? e.message : "Sign failed")
    } finally {
      setIsSigning(false)
    }
  }

  const openAgreement = async (agreement: AgreementItem) => {
    setSelectedAgreement(agreement)
    const canOwnerSign =
      (agreement.status === "ready_for_signature" || agreement.status === "pending" || agreement.status === "locked") &&
      !hasOwnerSigned(agreement)
    if (canOwnerSign) {
      setSignatureDataUrl("")
      setIsDialogOpen(true)
    }
  }

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
    // Reset signature canvas each time we open a sign dialog.
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
      const data = canvasRef.current.toDataURL("image/png")
      setSignatureDataUrl(data)
    } catch (_) {
      // ignore
    }
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

      {/* Agreement List */}
      <div className="space-y-4">
        {agreements.map((agreement) => {
          const status = normalizeOwnerAgreementStatus(agreement.status)
          const statusInfo = getStatusInfo(status)
          const StatusIcon = statusInfo.icon
          const canOwnerSign =
            (agreement.status === "pending" || agreement.status === "ready_for_signature" || agreement.status === "locked") &&
            !hasOwnerSigned(agreement)

          return (
            <Card key={agreement._id}>
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex-shrink-0 rounded-lg bg-primary/10 p-3">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className={`truncate font-medium ${statusInfo.textColor}`}>{agreement.property?.shortname || "Unknown"}</h3>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3 sm:flex-nowrap">
                  <Badge className={`${statusInfo.color} flex-shrink-0`}>
                    <StatusIcon className="mr-1 h-3 w-3" />
                    {statusInfo.label}
                  </Badge>

                  {canOwnerSign && (
                    <Button size="sm" onClick={() => openAgreement(agreement)} className="flex-shrink-0">
                      <Pen className="mr-2 h-4 w-4" />
                      Sign
                    </Button>
                  )}

                  {/* Final PDF only after all parties signed + `generateFinalPdfAndComplete` → status === completed; draft/locked uses same url until then. */}
                  {agreement.status === "completed" &&
                    agreement.agreement?.pdfurl &&
                    String(agreement.agreement.pdfurl).trim() !== "" &&
                    String(agreement.agreement.pdfurl) !== "#" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-shrink-0"
                        onClick={() =>
                          openAgreementPreviewUrl(String(agreement.agreement?.pdfurl))
                        }
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Open final agreement
                      </Button>
                    )}

                  {agreement.status === "waiting_third" && (
                    <Button size="sm" variant="outline" disabled className="flex-shrink-0">
                      <Clock className="mr-2 h-4 w-4" />
                      Pending
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
            <p className="text-sm text-muted-foreground">
              You don&apos;t have any agreements yet.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Signing Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sign Agreement - {selectedAgreement?.property?.shortname}</DialogTitle>
            <DialogDescription>
              Review and sign your property management agreement below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 mb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Agreement document</div>
              {selectedAgreement?.agreement?.pdfurl && String(selectedAgreement.agreement.pdfurl).trim() !== "" && String(selectedAgreement.agreement.pdfurl) !== "#" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() =>
                    openAgreementPreviewUrl(String(selectedAgreement.agreement?.pdfurl))
                  }
                >
                  <Download size={14} />
                  Open preview
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Document not ready yet</span>
              )}
            </div>
          </div>

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
          {signError ? (
            <p className="text-sm text-destructive px-6 pb-4" style={{ marginTop: -6 }}>
              {signError}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
