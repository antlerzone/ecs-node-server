"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FileText, Pen, Clock, CheckCircle2, AlertCircle, Download, Loader2 } from "lucide-react"
import { cn, portalHttpsAssetUrl, toDrivePreviewUrl } from "@/lib/utils"
import {
  fetchClientPortalAgreements,
  fetchClientAgreementPreviewBlob,
  signOperatorAgreement,
} from "@/lib/cleanlemon-api"
import { useAuth } from "@/lib/auth-context"
import { toast } from "sonner"

const ClientAgreementPdfScroll = dynamic(
  () =>
    import("@/components/portal/client-agreement-pdf-scroll").then((mod) => mod.ClientAgreementPdfScroll),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
        <span className="text-sm">Preparing viewer…</span>
      </div>
    ),
  }
)

interface AgreementItem {
  id?: string
  _id: string
  operatorCompanyName?: string
  templateName?: string
  templateMode?: string
  finalAgreementUrl?: string
  property?: { shortname?: string; property_name?: string }
  status?: string
  signedMeta?: {
    parties?: { client?: { signatureDataUrl?: string; signedAt?: string } }
    clientSignAt?: string
  }
  agreement?: { _id?: string }
  createdAt?: string
  signedAt?: string
}

function agreementRowId(a: AgreementItem): string {
  return String(a.agreement?._id || a.id || a._id || "").trim()
}

function clientAgreementCardTitle(a: AgreementItem): string {
  const op = String(a.operatorCompanyName || "").trim()
  if (op) return op
  const prop = String(a.property?.shortname || a.property?.property_name || "").trim()
  if (prop) return prop
  const tpl = String(a.templateName || "").trim()
  if (tpl) return tpl
  return "Agreement"
}

function clientHasSigned(a: AgreementItem): boolean {
  const m = a.signedMeta
  if (m?.parties?.client?.signatureDataUrl) return true
  if (String(m?.clientSignAt || "").trim()) return true
  return false
}

function isAgreementComplete(a: AgreementItem): boolean {
  const st = String(a.status || "")
    .trim()
    .toLowerCase()
  return st === "complete" || st === "signed"
}

type RowKind = "needs_sign" | "waiting_final" | "complete"

function rowKind(a: AgreementItem): RowKind {
  if (isAgreementComplete(a)) return "complete"
  if (clientHasSigned(a)) return "waiting_final"
  return "needs_sign"
}

/** Align with Coliving owner agreement badges (see `coliving/next-app/app/owner/agreement/page.tsx`). */
function getStatusInfo(kind: RowKind): {
  label: string
  className: string
  Icon: typeof AlertCircle
  textColor: string
} {
  switch (kind) {
    case "needs_sign":
      return {
        label: "Pending Signature",
        className: "bg-red-100 text-red-800",
        Icon: AlertCircle,
        textColor: "text-destructive",
      }
    case "waiting_final":
      return {
        label: "Pending Complete",
        className: "bg-yellow-100 text-yellow-800",
        Icon: Clock,
        textColor: "text-muted-foreground",
      }
    default:
      return {
        label: "Completed",
        className: "bg-green-100 text-green-800",
        Icon: CheckCircle2,
        textColor: "text-foreground",
      }
  }
}

function formatShortDate(iso?: string): string {
  if (!iso || !String(iso).trim()) return "—"
  try {
    return new Date(iso).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })
  } catch {
    return "—"
  }
}

/** Avoid raw ENOENT / server paths in the sign dialog. */
function friendlyPdfError(raw?: string): string {
  const s = String(raw || "").trim()
  if (!s) return "Could not load agreement preview."
  if (/ENOENT|GOOGLE_APPLICATION_CREDENTIALS|saas-coliving|ecs-user[/\\]app[/\\]secrets/i.test(s)) {
    return "Preview cannot run on this machine (Google key file missing or wrong path). Close this dialog or ask your operator for a copy."
  }
  if (/PDF_UNAVAILABLE|GOOGLE_DRIVE_NOT_CONNECTED/i.test(s)) {
    return "Preview is not available until Google Drive is connected for your operator. Try “Try new tab” below or ask your operator for a copy."
  }
  return s
}

function ClientAgreementPageContent() {
  const searchParams = useSearchParams()
  const { user, isLoading: authLoading } = useAuth()
  const [agreements, setAgreements] = useState<AgreementItem[]>([])
  const [selectedAgreement, setSelectedAgreement] = useState<AgreementItem | null>(null)
  const [signDialogStep, setSignDialogStep] = useState<"preview" | "signature">("preview")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSigning, setIsSigning] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState("")
  const [loading, setLoading] = useState(true)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const signatureWrapRef = useRef<HTMLDivElement>(null)
  const drawingRef = useRef(false)
  const signSubmitInFlightRef = useRef(false)

  const ecsBase = useMemo(
    () => (process.env.NEXT_PUBLIC_CLEANLEMON_API_URL || "").trim().replace(/\/$/, ""),
    [],
  )

  const reload = useCallback(async () => {
    if (authLoading) return [] as AgreementItem[]
    const email = String(user?.email || "").trim().toLowerCase()
    if (!email) {
      return [] as AgreementItem[]
    }
    const res = await fetchClientPortalAgreements(email)
    if (!res?.ok) {
      toast.error(res?.reason || "Could not load agreements.")
      return [] as AgreementItem[]
    }
    const raw = (res.items || []) as AgreementItem[]
    return raw.map((row) => ({
      ...row,
      _id: String(row._id || row.id || "").trim() || String(row.agreement?._id || "").trim(),
    }))
  }, [user?.email, authLoading])

  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const items = await reload()
        if (!cancelled) setAgreements(items)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reload, authLoading])

  useEffect(() => {
    const idFromUrl = String(searchParams.get("id") || "").trim()
    if (!idFromUrl) return
    setAgreements((prev) => {
      const exists = prev.some((a) => agreementRowId(a) === idFromUrl)
      if (exists) return prev
      return [
        {
          _id: idFromUrl,
          agreement: { _id: idFromUrl },
          status: "signing",
          property: { shortname: "Agreement" },
        },
        ...prev,
      ]
    })
  }, [searchParams])

  /** Owner-style list: needs action first, then waiting operator, then completed. */
  const sortedAgreements = useMemo(() => {
    const rank = (a: AgreementItem) => {
      const k = rowKind(a)
      if (k === "needs_sign") return 0
      if (k === "waiting_final") return 1
      return 2
    }
    return [...agreements].sort((a, b) => {
      const d = rank(a) - rank(b)
      if (d !== 0) return d
      const ta = String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
      return -ta
    })
  }, [agreements])

  const revokePdfUrl = useCallback(() => {
    setPdfUrl((prev) => {
      if (prev) {
        try {
          URL.revokeObjectURL(prev)
        } catch {
          /* ignore */
        }
      }
      return null
    })
  }, [])

  useEffect(() => {
    if (!isDialogOpen || !selectedAgreement) {
      revokePdfUrl()
      setPdfError(null)
      setPdfLoading(false)
      return
    }
    const id = agreementRowId(selectedAgreement)
    if (!id) return
    let cancelled = false
    setPdfLoading(true)
    setPdfError(null)
    revokePdfUrl()
    void (async () => {
      const out = await fetchClientAgreementPreviewBlob(id, user?.email)
      if (cancelled) return
      if (!out.ok || !out.blob) {
        setPdfError(friendlyPdfError(out.reason))
        setPdfLoading(false)
        return
      }
      const url = URL.createObjectURL(out.blob)
      if (cancelled) {
        URL.revokeObjectURL(url)
        return
      }
      setPdfUrl(url)
      setPdfLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [isDialogOpen, selectedAgreement, revokePdfUrl, user?.email])

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
    const wrap = signatureWrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let rafId = 0
    const applySize = () => {
      const dpr = Math.max(1, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(2, Math.floor(rect.width))
      const h = Math.max(2, Math.floor(rect.height))
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.touchAction = "none"
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = "#111827"
      ctx.lineWidth = 2 * dpr
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      setSignatureDataUrl("")
    }

    const schedule = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(applySize)
    }
    schedule()
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null
    ro?.observe(wrap)
    window.addEventListener("resize", schedule)
    return () => {
      cancelAnimationFrame(rafId)
      ro?.disconnect()
      window.removeEventListener("resize", schedule)
    }
  }, [isDialogOpen, signDialogStep, selectedAgreement ? agreementRowId(selectedAgreement) : ""])

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    canvas.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const p = getCanvasPoint(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const p = getCanvasPoint(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* */
    }
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      setSignatureDataUrl(canvas.toDataURL("image/png"))
    } catch {
      /* */
    }
  }

  const openPreviewInNewTab = async (a: AgreementItem) => {
    const id = agreementRowId(a)
    if (!id) return
    const out = await fetchClientAgreementPreviewBlob(id, user?.email)
    if (!out.ok || !out.blob) {
      toast.error(friendlyPdfError(out.reason))
      return
    }
    const url = URL.createObjectURL(out.blob)
    const w = window.open(url, "_blank", "noopener,noreferrer")
    if (!w) {
      URL.revokeObjectURL(url)
      toast.error("Popup blocked — allow popups or use Preview on desktop.")
      return
    }
    setTimeout(() => URL.revokeObjectURL(url), 120_000)
  }

  const openFinalPdf = (a: AgreementItem) => {
    const u = String(a.finalAgreementUrl || "").trim()
    if (!u) {
      toast.info("Final PDF is not ready yet.")
      return
    }
    const openUrl = toDrivePreviewUrl(portalHttpsAssetUrl(u, ecsBase))
    window.open(openUrl, "_blank", "noopener,noreferrer")
  }

  const handleSign = async () => {
    if (!selectedAgreement || !signatureDataUrl) return
    const agreementId = agreementRowId(selectedAgreement)
    if (!agreementId) return
    if (signSubmitInFlightRef.current) return
    signSubmitInFlightRef.current = true
    setIsSigning(true)
    try {
      const res = await signOperatorAgreement(agreementId, {
        signerName: user?.name || "",
        signerEmail: user?.email || "",
        signatureDataUrl,
        signedFrom: "client_portal",
        signedAt: new Date().toISOString(),
      })
      if (!res?.ok) throw new Error(res?.reason || "Sign failed")
      toast.success("Signed. Your operator will sign next to complete the agreement.")
      const items = await reload()
      setAgreements(items)
      setIsDialogOpen(false)
      setSignDialogStep("preview")
      setSelectedAgreement(null)
      setSignatureDataUrl("")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign failed")
    } finally {
      setIsSigning(false)
      signSubmitInFlightRef.current = false
    }
  }

  const openSignDialog = (a: AgreementItem) => {
    setSignDialogStep("preview")
    setSelectedAgreement(a)
    setSignatureDataUrl("")
    setIsDialogOpen(true)
  }

  const onDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open)
    if (!open) {
      setSignDialogStep("preview")
      setSelectedAgreement(null)
      setSignatureDataUrl("")
      revokePdfUrl()
      setPdfError(null)
    }
  }

  const goBackToPreviewStep = () => {
    clearSignature()
    setSignDialogStep("preview")
  }

  if (loading || authLoading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center p-6">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
      </div>
    )
  }

  const signedOut = !String(user?.email || "").trim()

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">My agreements</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Each card is one cleaning company (operator). Use <strong className="text-foreground">Preview &amp; sign</strong> when your signature is
          required; open the final PDF when the agreement is complete.
        </p>
      </header>

      {signedOut ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground" aria-hidden />
            <h3 className="text-lg font-medium text-foreground">Sign in required</h3>
            <p className="max-w-md text-sm text-muted-foreground">Log in with the email your operator used as the agreement recipient.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sortedAgreements.map((a) => {
            const kind = rowKind(a)
            const statusInfo = getStatusInfo(kind)
            const StatusIcon = statusInfo.Icon
            const canClientSign = kind === "needs_sign"
            const finalUrl = String(a.finalAgreementUrl || "").trim()
            const op = String(a.operatorCompanyName || "").trim()
            const tpl = String(a.templateName || "").trim()
            const titleLine = op || tpl || clientAgreementCardTitle(a)
            const subLine = op && tpl ? tpl : null
            return (
              <Card key={agreementRowId(a) || a._id}>
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex-shrink-0 rounded-lg bg-primary/10 p-3">
                      <FileText className="h-6 w-6 text-primary" aria-hidden />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <h3 className={`truncate font-medium ${statusInfo.textColor}`}>{titleLine}</h3>
                      {subLine ? <p className="truncate text-xs text-muted-foreground sm:text-sm">{subLine}</p> : null}
                      <p className="text-xs text-muted-foreground">Updated {formatShortDate(a.signedAt || a.createdAt)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 sm:flex-nowrap sm:justify-end">
                    <Badge className={`${statusInfo.className} flex-shrink-0`}>
                      <StatusIcon className="mr-1 h-3 w-3" />
                      {statusInfo.label}
                    </Badge>

                    {canClientSign && (
                      <Button type="button" size="sm" className="flex-shrink-0 gap-1" onClick={() => openSignDialog(a)}>
                        <Pen className="h-4 w-4" />
                        Preview & sign
                      </Button>
                    )}

                    {kind === "complete" && finalUrl ? (
                      <Button type="button" size="sm" variant="outline" className="flex-shrink-0 gap-1" onClick={() => openFinalPdf(a)}>
                        <Download className="h-4 w-4" />
                        Open final agreement
                      </Button>
                    ) : null}

                    {kind === "waiting_final" && (
                      <Button type="button" size="sm" variant="outline" disabled className="flex-shrink-0 gap-1">
                        <Clock className="h-4 w-4" />
                        Pending
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {!signedOut && sortedAgreements.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-medium">No agreements found</h3>
            <p className="text-sm text-muted-foreground">You don&apos;t have any operator–client agreements yet.</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={onDialogOpenChange}>
        <DialogContent
          showCloseButton
          className={cn(
            "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 shadow-lg duration-200",
            "grid gap-0 overflow-hidden border-0 p-0 sm:rounded-lg sm:border",
            "h-[100dvh] max-h-[100dvh] max-w-[100vw] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl",
            "sm:h-[min(92dvh,780px)] sm:max-h-[92vh]"
          )}
        >
          {signDialogStep === "preview" ? (
            <>
              <DialogHeader className="space-y-1 border-b bg-background px-4 py-3 sm:px-6">
                <DialogTitle className="text-left text-base sm:text-lg">
                  Preview — {selectedAgreement ? clientAgreementCardTitle(selectedAgreement) : "Agreement"}
                </DialogTitle>
                <DialogDescription className="text-left text-xs sm:text-sm">
                  Use zoom if needed and read the full agreement. When you are ready to sign, tap <strong className="text-foreground">Sign</strong>.
                </DialogDescription>
              </DialogHeader>

              <div
                className={cn(
                  "relative h-full min-h-0 overflow-hidden bg-muted/20",
                  pdfError || (!pdfLoading && !pdfUrl) ? "min-h-[9rem] max-h-48 sm:max-h-56" : ""
                )}
              >
                {pdfLoading ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/80 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span className="text-sm">Loading agreement…</span>
                  </div>
                ) : pdfError ? (
                  <div className="flex h-full min-h-[9rem] flex-col items-center justify-center gap-3 overflow-y-auto p-4 text-center sm:p-6">
                    <p className="max-w-md text-sm text-destructive">{pdfError}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => selectedAgreement && void openPreviewInNewTab(selectedAgreement)}>
                      Try new tab
                    </Button>
                  </div>
                ) : pdfUrl ? (
                  <ClientAgreementPdfScroll key={pdfUrl} fileUrl={pdfUrl} />
                ) : (
                  <div className="flex h-full min-h-[9rem] items-center justify-center px-4 text-sm text-muted-foreground">No preview</div>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t bg-background px-4 py-4 sm:flex-row sm:justify-end sm:px-6 sm:py-4">
                <Button type="button" variant="outline" className="w-full sm:w-auto sm:min-w-[120px]" onClick={() => onDialogOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="button" className="w-full sm:w-auto sm:min-w-[120px]" onClick={() => setSignDialogStep("signature")}>
                  Sign
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader className="space-y-1 border-b bg-background px-4 py-3 sm:px-6">
                <DialogTitle className="text-left text-base sm:text-lg">
                  Sign — {selectedAgreement ? clientAgreementCardTitle(selectedAgreement) : "Agreement"}
                </DialogTitle>
                <DialogDescription className="text-left text-xs sm:text-sm">
                  Draw your signature in the box, then tap <strong className="text-foreground">Submit</strong>.
                </DialogDescription>
                <button
                  type="button"
                  className="text-left text-xs font-medium text-primary underline-offset-4 hover:underline sm:text-sm"
                  onClick={goBackToPreviewStep}
                >
                  Back to preview
                </button>
              </DialogHeader>

              <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background px-4 py-3 sm:px-6 sm:py-4">
                <p className="mb-3 text-xs text-muted-foreground sm:text-sm">By submitting, you agree to the terms in the agreement you previewed.</p>
                <span className="mb-2 block text-xs font-medium text-foreground">Your signature</span>
                <div
                  ref={signatureWrapRef}
                  className="relative isolate min-h-0 flex-1 overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/40 bg-white shadow-inner"
                  style={{ minHeight: "min(320px, 50dvh)" }}
                >
                  <canvas
                    ref={canvasRef}
                    className="block h-full w-full min-h-[200px] touch-none cursor-crosshair"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t bg-background px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3 sm:px-6">
                <Button type="button" variant="outline" size="sm" className="w-full sm:order-1 sm:w-auto" onClick={() => onDialogOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="outline" size="sm" className="w-full sm:order-2 sm:w-auto" onClick={clearSignature}>
                  Clear
                </Button>
                <Button
                  type="button"
                  size="lg"
                  className="w-full min-h-[48px] sm:order-3 sm:w-auto sm:min-w-[160px]"
                  onClick={() => void handleSign()}
                  disabled={isSigning || !signatureDataUrl}
                >
                  {isSigning ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    "Submit"
                  )}
                </Button>
              </div>
            </>
          )}
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
