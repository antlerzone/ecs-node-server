"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { fetchSaasStripeFeePreview, type SaasStripeFeePreviewResponse } from "@/lib/portal-api"
import { uploadFile } from "@/lib/operator-api"
import { ManualPaymentBankPanel } from "@/components/manual-payment-bank-panel"
import { Loader2 } from "lucide-react"

function formatMajor(n: number | undefined, currency: string) {
  if (n == null || !Number.isFinite(n)) return "—"
  const sym = currency === "SGD" ? "S$" : "RM"
  return `${sym}${n.toFixed(2)}`
}

export type ManualPaymentSubmitPayload = {
  receiptUrl: string
}

export function SaasStripeFeeConfirmDialog({
  open,
  onOpenChange,
  subtotalMajor,
  currency,
  onContinueStripe,
  onManualPayment,
  manualBusy,
  stripeBusy,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  subtotalMajor: number
  currency: "MYR" | "SGD"
  onContinueStripe: () => void | Promise<void>
  /** Called only after operator uploads payment receipt and clicks Submit. Creates ticket + email. */
  onManualPayment: (payload: ManualPaymentSubmitPayload) => void | Promise<void>
  manualBusy?: boolean
  stripeBusy?: boolean
}) {
  const [step, setStep] = useState<"fee" | "bank">("fee")
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<SaasStripeFeePreviewResponse | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setFetchError(null)
      setStep("fee")
      setReceiptFile(null)
      setLocalError(null)
      setUploading(false)
      return
    }
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setFetchError(null)
      try {
        const data = await fetchSaasStripeFeePreview(subtotalMajor, currency)
        if (cancelled) return
        if (data?.ok === false) {
          setFetchError(typeof data?.reason === "string" ? data.reason : "Preview failed")
          setPreview(null)
        } else {
          setPreview(data)
        }
      } catch (e) {
        if (!cancelled) {
          setFetchError(e instanceof Error ? e.message : "Network error")
          setPreview(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [open, subtotalMajor, currency])

  const cur = preview?.currency || currency
  const feePct = preview?.transactionFeePercent
  const busy = manualBusy || stripeBusy || uploading
  const canSubmitReceipt = !!receiptFile && !uploading && !manualBusy

  const handleSubmitReceipt = async () => {
    if (!receiptFile) {
      setLocalError("Please choose a payment receipt file.")
      return
    }
    setLocalError(null)
    setUploading(true)
    try {
      const up = await uploadFile(receiptFile)
      if (!up.ok || !up.url) {
        setLocalError(up.reason || "Upload failed.")
        return
      }
      await onManualPayment({ receiptUrl: up.url })
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Submit failed.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={
          "w-full max-w-[min(36rem,calc(100vw-1rem))] box-border " +
          "max-h-[min(90vh,800px)] overflow-x-hidden overflow-y-auto overscroll-contain " +
          "gap-0 p-0 sm:rounded-xl " +
          "!flex !flex-col flex flex-col shadow-xl"
        }
      >
        {step === "fee" ? (
          <>
            <div className="flex min-w-0 max-w-full flex-col gap-4 px-6 pt-6 pb-2 pr-12 sm:px-8 sm:pt-8 sm:pb-3 sm:pr-14">
              <DialogHeader className="min-w-0 max-w-full shrink-0 space-y-3 text-left">
                <DialogTitle className="pr-2 text-xl font-semibold leading-snug">
                  Payment summary
                </DialogTitle>
                <DialogDescription className="max-w-full text-left text-sm leading-relaxed text-muted-foreground break-words [overflow:visible]">
                  {currency === "SGD" ? (
                    <>
                      Stripe Checkout shows two lines: <strong className="text-foreground">Pricing</strong> (your plan
                      or top-up amount) and <strong className="text-foreground">Transaction fees</strong> (
                      {feePct ?? 10}% of the pricing line). The total below is what will be charged.
                    </>
                  ) : (
                    <>
                      For <strong className="text-foreground">MYR</strong>, Stripe Checkout charges the{" "}
                      <strong className="text-foreground">Pricing</strong> amount only — no platform transaction fee line.
                      The total below is what will be charged.
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden />
                  <span className="text-sm">Calculating fees…</span>
                </div>
              ) : fetchError ? (
                <p className="text-sm text-destructive py-2">{fetchError}</p>
              ) : preview ? (
                <div className="space-y-3 text-sm w-full min-w-0">
                  <div className="rounded-xl border border-border bg-muted/30 p-4 sm:p-5 space-y-3 w-full">
                    <div className="flex justify-between gap-3 min-w-0">
                      <span className="text-muted-foreground shrink">Pricing</span>
                      <span className="font-medium tabular-nums text-right shrink-0">
                        {formatMajor(preview.baseMajor, cur)}
                      </span>
                    </div>
                    {(preview.transactionFeeMajor ?? 0) > 0 && (
                      <div className="flex justify-between gap-3 min-w-0">
                        <span className="text-muted-foreground">
                          Transaction fees{feePct != null ? ` (${feePct}%)` : ""}
                        </span>
                        <span className="font-medium tabular-nums text-right shrink-0">
                          {formatMajor(preview.transactionFeeMajor, cur)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-border pt-3 font-semibold gap-3">
                      <span>Total to pay</span>
                      <span className="tabular-nums text-right shrink-0">{formatMajor(preview.totalMajor, cur)}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <DialogFooter
              className={
                "!flex !flex-col flex-col gap-3 sm:!flex-col " +
                "w-full min-w-0 max-w-full overflow-x-hidden " +
                "border-t border-border/60 bg-background px-6 pb-6 pt-4 sm:px-8 sm:pb-8 " +
                "mt-auto shrink-0"
              }
            >
              {currency === "SGD" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 w-full min-w-0 max-w-full whitespace-normal break-words px-3 py-2.5 text-center text-sm leading-snug sm:px-4"
                  disabled={busy || loading}
                  onClick={() => {
                    setStep("bank")
                    setReceiptFile(null)
                    setLocalError(null)
                  }}
                >
                  Manual payment (~24h, skip transaction fees)
                </Button>
              ) : null}
              <Button
                type="button"
                className="h-auto min-h-11 w-full min-w-0 max-w-full whitespace-normal break-words px-3 py-2.5 text-center text-sm leading-snug text-white hover:text-white hover:brightness-95 sm:px-4"
                style={{ background: "var(--brand)" }}
                disabled={busy || loading || !!fetchError}
                onClick={() => void onContinueStripe()}
              >
                {stripeBusy ? <Loader2 className="mr-2 inline h-4 w-4 shrink-0 animate-spin" aria-hidden /> : null}
                Continue to card checkout (immediate)
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex min-w-0 max-w-full flex-col gap-4 px-6 pt-6 pb-2 pr-12 sm:px-8 sm:pt-8 sm:pb-3 sm:pr-14">
              <DialogHeader className="min-w-0 max-w-full shrink-0 space-y-2 text-left">
                <DialogTitle className="pr-2 text-xl font-semibold leading-snug">Manual payment</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Transfer the amount to the account below, then upload your payment receipt and submit. Your request is
                  only sent to our team after you submit.
                </DialogDescription>
              </DialogHeader>
              <ManualPaymentBankPanel />
              <div className="space-y-2">
                <Label htmlFor="manual-payment-receipt" className="text-sm font-medium">
                  Payment receipt <span className="text-destructive">*</span>
                </Label>
                <input
                  id="manual-payment-receipt"
                  type="file"
                  accept="image/*,.pdf,application/pdf"
                  className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null
                    setReceiptFile(f)
                    setLocalError(null)
                  }}
                />
                <p className="text-xs text-muted-foreground">PNG, JPG, or PDF.</p>
                {localError ? <p className="text-sm text-destructive">{localError}</p> : null}
              </div>
            </div>
            <DialogFooter
              className={
                "!flex !flex-col flex-col gap-3 sm:!flex-col sm:!flex-row sm:justify-between " +
                "w-full min-w-0 max-w-full overflow-x-hidden " +
                "border-t border-border/60 bg-background px-6 pb-6 pt-4 sm:px-8 sm:pb-8 " +
                "mt-auto shrink-0"
              }
            >
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setStep("fee")} disabled={uploading || !!manualBusy}>
                Back
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto text-white hover:text-white hover:brightness-95"
                style={{ background: "var(--brand)" }}
                disabled={!canSubmitReceipt}
                onClick={() => void handleSubmitReceipt()}
              >
                {uploading || manualBusy ? (
                  <Loader2 className="mr-2 inline h-4 w-4 shrink-0 animate-spin" aria-hidden />
                ) : null}
                Submit
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
