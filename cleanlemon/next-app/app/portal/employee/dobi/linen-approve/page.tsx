"use client"

import { Fragment, Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { fetchDobiLinenQrPreview, postDobiLinenQrApprove } from "@/lib/cleanlemon-api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

function Inner() {
  const sp = useSearchParams()
  const { user } = useAuth()
  const token = String(sp.get("token") || "").trim()
  const opFromQuery = String(sp.get("operatorId") || "").trim()
  const operatorId = opFromQuery || String(user?.operatorId || "").trim()

  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<{
    ok?: boolean
    reason?: string
    payload?: {
      date?: string
      action?: string
      team?: string
      totals?: Record<string, number>
      lines?: Array<{ itemTypeId: string; qty: number; label?: string }>
      missingQty?: number
      remark?: string
    }
    requestedByEmail?: string
    requestedAt?: string
    expiresAt?: string
  } | null>(null)
  const [approving, setApproving] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token || !operatorId) {
        setPreview({ ok: false, reason: "MISSING_PARAMS" })
        setLoading(false)
        return
      }
      const r = (await fetchDobiLinenQrPreview(operatorId, token)) as typeof preview
      if (cancelled) return
      setPreview(r)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [token, operatorId])

  useEffect(() => {
    if (!preview?.ok || !preview.expiresAt) return
    const id = window.setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [preview?.ok, preview?.expiresAt])

  useEffect(() => {
    if (!token || !operatorId || !preview?.ok) return
    const id = window.setInterval(async () => {
      const r = (await fetchDobiLinenQrPreview(operatorId, token)) as typeof preview
      if (!r?.ok && r?.reason === "EXPIRED") setPreview(r)
    }, 10_000)
    return () => clearInterval(id)
  }, [token, operatorId, preview?.ok])

  const totals = preview?.payload?.totals
  const lineItems = preview?.payload?.lines

  const title = useMemo(() => {
    if (!preview?.ok && preview?.reason === "DOBI_ROLE_REQUIRED") return "Dobi access only"
    if (!preview?.ok && preview?.reason === "NOT_FOUND") return "Request not found"
    if (!preview?.ok && preview?.reason === "EXPIRED") return "QR expired"
    if (!preview?.ok && preview?.reason === "ALREADY_DONE") return "Already done"
    if (!preview?.ok && preview?.reason === "MISSING_PARAMS") return "Invalid link"
    return "Linen approval"
  }, [preview])

  const onApprove = async () => {
    if (!token || !operatorId) return
    setApproving(true)
    const r = (await postDobiLinenQrApprove({ operatorId, token })) as { ok?: boolean; reason?: string }
    setApproving(false)
    if (!r?.ok) {
      toast.error(r?.reason === "EXPIRED" ? "QR expired." : r?.reason === "ALREADY_DONE" ? "Already approved." : "Approve failed.")
      return
    }
    toast.success("Approved.")
    setPreview({ ok: false, reason: "ALREADY_DONE" })
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!preview?.ok) {
    const reason = preview?.reason
    return (
      <div className="mx-auto max-w-md space-y-4 p-4 pb-24">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              {reason === "DOBI_ROLE_REQUIRED"
                ? "Sign in with a dobi staff account for this operator, then open the link again."
                : reason === "MISSING_PARAMS"
                  ? "Open this page from the QR link (includes operator and token)."
                  : "This request cannot be approved."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const p = preview.payload || {}
  const expMs = preview.expiresAt ? new Date(preview.expiresAt).getTime() : NaN
  const hasExpiry = Number.isFinite(expMs)
  const secondsLeft = hasExpiry ? Math.max(0, Math.floor((expMs - Date.now()) / 1000)) : 86400 * 7
  const mm = Math.floor(secondsLeft / 60)
  const ss = secondsLeft % 60
  const timeLeftLabel = `${mm}:${String(ss).padStart(2, "0")}`

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <Card>
        <CardHeader>
          <CardTitle>Linen handoff</CardTitle>
          <CardDescription>
            Confirm totals, then approve (no signature).
            {hasExpiry ? (
              <span className="mt-2 block font-medium text-foreground tabular-nums">Time left: {timeLeftLabel}</span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 text-muted-foreground">
            <span>Date</span>
            <span className="text-foreground font-medium">{p.date || "—"}</span>
            <span>Action</span>
            <span className="text-foreground font-medium">{p.action || "—"}</span>
            <span>Team</span>
            <span className="text-foreground font-medium">{p.team || "—"}</span>
            <span>From</span>
            <span className="text-foreground font-medium break-all">{preview.requestedByEmail || "—"}</span>
          </div>
          {Array.isArray(lineItems) && lineItems.length > 0 ? (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground mb-2">Items</p>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
                {lineItems.map((l) => (
                  <Fragment key={l.itemTypeId}>
                    <dt className="text-muted-foreground">{l.label || l.itemTypeId}</dt>
                    <dd className="text-right tabular-nums">{Number(l.qty) || 0}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          ) : totals && typeof totals === "object" ? (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground mb-2">Totals</p>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
                <dt className="text-muted-foreground">Bedsheet</dt>
                <dd className="text-right tabular-nums">{Number(totals.bedsheet) || 0}</dd>
                <dt className="text-muted-foreground">Pillow</dt>
                <dd className="text-right tabular-nums">{Number(totals.pillowCase) || 0}</dd>
                <dt className="text-muted-foreground">Bed linens</dt>
                <dd className="text-right tabular-nums">{Number(totals.bedLinens) || 0}</dd>
                <dt className="text-muted-foreground">Bathmat</dt>
                <dd className="text-right tabular-nums">{Number(totals.bathmat) || 0}</dd>
                <dt className="text-muted-foreground">Towel</dt>
                <dd className="text-right tabular-nums">{Number(totals.towel) || 0}</dd>
              </dl>
            </div>
          ) : null}
          {p.action === "return" && (Number(p.missingQty) || 0) > 0 ? (
            <div>
              <p className="text-xs text-muted-foreground">Missing qty</p>
              <p className="font-medium">{Number(p.missingQty) || 0}</p>
            </div>
          ) : null}
          {p.remark ? (
            <div>
              <p className="text-xs text-muted-foreground">Remark</p>
              <p className="whitespace-pre-wrap">{String(p.remark)}</p>
            </div>
          ) : null}
          <Button
            className="w-full"
            size="lg"
            onClick={onApprove}
            disabled={approving || (hasExpiry && secondsLeft <= 0)}
          >
            {approving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : hasExpiry && secondsLeft <= 0 ? (
              "Expired"
            ) : (
              "Approve"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default function DobiLinenApprovePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center p-6">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <Inner />
    </Suspense>
  )
}
