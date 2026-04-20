"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { postDobiLinenQrApprove } from "@/lib/cleanlemon-api"
import { cn } from "@/lib/utils"

export function parseLinenApproveFromScan(raw: string): { operatorId: string; token: string } | null {
  const s = String(raw || "").trim()
  if (!s) return null
  try {
    const u = s.includes("://") ? new URL(s) : new URL(s, typeof window !== "undefined" ? window.location.origin : "http://localhost")
    if (!u.pathname.includes("linen-approve")) return null
    const token = u.searchParams.get("token")
    const operatorId = u.searchParams.get("operatorId")
    if (!token || !operatorId) return null
    return { token, operatorId }
  } catch {
    return null
  }
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  expectedOperatorId: string
  onApproved: () => void | Promise<void>
}

/** Full-screen camera scan (no modal dialog). */
export function DobiLinenQrScanDialog({ open, onOpenChange, expectedOperatorId, onApproved }: Props) {
  const regionId = useMemo(() => `h5qr-${Math.random().toString(36).slice(2, 12)}`, [])
  const [paste, setPaste] = useState("")
  const [busy, setBusy] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const processingRef = useRef(false)
  const expectedOpRef = useRef(expectedOperatorId)
  const onApprovedRef = useRef(onApproved)
  expectedOpRef.current = expectedOperatorId
  onApprovedRef.current = onApproved

  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  const close = () => {
    setShowPaste(false)
    setPaste("")
    onOpenChangeRef.current(false)
  }

  const approvePair = async (token: string, operatorId: string) => {
    if (processingRef.current) return
    if (operatorId !== expectedOpRef.current) {
      toast.error("This linen QR belongs to another operator.")
      return
    }
    processingRef.current = true
    setBusy(true)
    try {
      const r = await postDobiLinenQrApprove({ operatorId, token })
      if (!r?.ok) {
        if (r?.reason === "EXPIRED") toast.error("QR expired — ask for a fresh code.")
        else if (r?.reason === "ALREADY_DONE") toast.error("Already approved.")
        else if (r?.reason === "NO_LINEN_ITEM_TYPE_MATCH")
          toast.error("Linen types do not match Dobi item list — check Operator → Dobi settings.")
        else toast.error(r?.reason || "Approve failed.")
        return
      }
      toast.success("Approved — added to pending wash.")
      setPaste("")
      close()
      await onApprovedRef.current()
    } finally {
      setBusy(false)
      processingRef.current = false
    }
  }

  const approvePairRef = useRef(approvePair)
  approvePairRef.current = approvePair

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setCamError(null)
      return
    }
    let cancelled = false
    const instRef = { current: null as import("html5-qrcode").Html5Qrcode | null }

    const safeStop = async (h: import("html5-qrcode").Html5Qrcode | null) => {
      if (!h) return
      try {
        await h.stop()
      } catch {
        /* already stopped or never started — html5-qrcode throws here */
      }
      try {
        await h.clear()
      } catch {
        /* ignore */
      }
    }

    ;(async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode")
        if (cancelled) return
        const html5 = new Html5Qrcode(regionId)
        instRef.current = html5
        await html5.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const min = Math.min(viewfinderWidth, viewfinderHeight)
              const s = Math.min(280, Math.floor(min * 0.85))
              return { width: s, height: s }
            },
          },
          (decodedText) => {
            const p = parseLinenApproveFromScan(decodedText)
            if (!p) return
            void approvePairRef.current(p.token, p.operatorId)
          },
          () => {},
        )
        if (cancelled) {
          await safeStop(html5)
          return
        }
      } catch (e: unknown) {
        if (!cancelled) setCamError(e instanceof Error ? e.message : "Camera unavailable")
      }
    })()

    return () => {
      cancelled = true
      const h = instRef.current
      instRef.current = null
      void safeStop(h)
    }
  }, [open, regionId])

  const submitPaste = () => {
    const p = parseLinenApproveFromScan(paste)
    if (!p) {
      toast.error("Paste the full linen approval link (includes token).")
      return
    }
    void approvePair(p.token, p.operatorId)
  }

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Scan linen QR"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <p className="truncate text-sm font-medium text-white">Point camera at linen QR</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-white hover:bg-white/10"
          onClick={close}
          aria-label="Close scanner"
        >
          <X className="h-6 w-6" />
        </Button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center p-3">
        {busy ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60">
            <Loader2 className="h-12 w-12 animate-spin text-white" aria-hidden />
          </div>
        ) : null}
        <div id={regionId} className="min-h-[240px] w-full max-w-lg flex-1 max-h-[min(72vh,560px)]" />
        {camError ? (
          <p className="absolute bottom-20 left-4 right-4 text-center text-sm text-amber-300">{camError}</p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-white/10 bg-zinc-950 px-3 py-3">
        <button
          type="button"
          className="mb-2 w-full text-left text-xs text-white/70 underline-offset-2 hover:underline"
          onClick={() => setShowPaste((v) => !v)}
        >
          {showPaste ? "Hide paste link" : "Camera not working? Paste link"}
        </button>
        <div className={cn("space-y-2", !showPaste && "hidden")}>
          <Label htmlFor="linen-qr-paste" className="text-white/80">
            Linen approval URL
          </Label>
          <div className="flex gap-2">
            <Input
              id="linen-qr-paste"
              placeholder="https://…/linen-approve?…"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
            />
            <Button type="button" variant="secondary" disabled={busy} onClick={submitPaste} className="shrink-0">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "OK"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
