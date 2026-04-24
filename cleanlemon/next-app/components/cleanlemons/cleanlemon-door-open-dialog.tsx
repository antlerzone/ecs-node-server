"use client"

import { useState } from "react"
import { Lock, Unlock, RefreshCw, Copy } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

function modeNorm(m: string | undefined) {
  return String(m || "")
    .trim()
    .toLowerCase()
}

export type CleanlemonDoorOpenPanelProps = {
  /** When empty, remote unlock UI is hidden — only mailbox / PIN rows show when present. */
  smartdoorId?: string
  operatorDoorAccessMode?: string
  smartdoorGatewayReady?: boolean
  hasBookingToday?: boolean
  mailboxPassword?: string
  smartdoorPassword?: string
  onUnlock: () => Promise<{ ok: boolean; reason?: string }>
}

/** Shared body: big-circle remote unlock + optional PIN / mailbox (use inside any dialog or standalone). */
export function CleanlemonDoorOpenPanel(props: CleanlemonDoorOpenPanelProps) {
  const {
    smartdoorId,
    operatorDoorAccessMode,
    smartdoorGatewayReady,
    hasBookingToday,
    mailboxPassword,
    smartdoorPassword,
    onUnlock,
  } = props

  const hasSmartLock = Boolean(String(smartdoorId || "").trim())
  const mode = modeNorm(operatorDoorAccessMode)
  const tempLike = mode === "temporary_password_only" || mode === "working_date_only"
  const showPinsForLock = !tempLike || !!hasBookingToday
  /** Without a linked lock, always show mailbox / door PIN when stored (no "job today" gate). */
  const showPins = hasSmartLock ? showPinsForLock : true
  const unlockDisabled = tempLike && !hasBookingToday

  const [loading, setLoading] = useState(false)
  const [unlocked, setUnlocked] = useState(false)

  const runUnlock = async () => {
    setLoading(true)
    try {
      const r = await onUnlock()
      if (r?.ok) {
        setUnlocked(true)
        toast.success("Door unlock sent")
        setTimeout(() => setUnlocked(false), 2500)
      } else {
        toast.error(r?.reason || "Unlock failed")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unlock failed")
    } finally {
      setLoading(false)
    }
  }

  const copy = async (t: string) => {
    const s = String(t || "").trim()
    if (!s) return
    try {
      await navigator.clipboard.writeText(s)
      toast.success("Copied")
    } catch {
      toast.error("Could not copy")
    }
  }

  const mailboxOnly =
    !hasSmartLock &&
    !!String(mailboxPassword || "").trim() &&
    !String(smartdoorPassword || "").trim()

  return (
    <div
      className={cn(
        "flex flex-col gap-4 py-2",
        mailboxOnly ? "items-stretch" : "items-center",
      )}
    >
      {hasSmartLock ? (
        <>
          <button
            type="button"
            disabled={loading || unlockDisabled}
            onClick={() => void runUnlock()}
            className={cn(
              "flex h-36 w-36 items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
            )}
            style={{
              background: unlocked ? "#22c55e" : "hsl(var(--primary))",
              boxShadow: unlocked
                ? "0 0 0 12px rgba(34,197,94,0.15)"
                : "0 0 0 12px hsl(var(--primary) / 0.12)",
            }}
          >
            {loading ? (
              <RefreshCw size={48} className="animate-spin text-primary-foreground" />
            ) : unlocked ? (
              <Unlock size={48} className="text-white" />
            ) : (
              <Lock size={48} className="text-primary-foreground" />
            )}
          </button>
          <p className="text-center text-sm text-muted-foreground">
            {loading ? "Connecting…" : unlocked ? "Unlocked" : unlockDisabled ? "Remote unlock when there is a job today." : "Tap to send remote unlock"}
          </p>
          {smartdoorGatewayReady === false ? (
            <p className="text-center text-xs text-amber-700">Gateway not linked — remote unlock may fail.</p>
          ) : null}
        </>
      ) : null}

      {showPins && mailboxPassword ? (
        <div className="w-full space-y-1">
          <Label className="text-xs">Mailbox</Label>
          <div className="flex gap-2">
            <Input readOnly className="font-mono" value={mailboxPassword} />
            <Button type="button" size="icon" variant="outline" onClick={() => void copy(mailboxPassword)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
      {showPins && smartdoorPassword ? (
        <div className="w-full space-y-1">
          <Label className="text-xs">Door PIN</Label>
          <div className="flex gap-2">
            <Input readOnly className="font-mono" value={smartdoorPassword} />
            <Button type="button" size="icon" variant="outline" onClick={() => void copy(smartdoorPassword)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
      {!hasSmartLock && !mailboxPassword?.trim() && !smartdoorPassword?.trim() ? (
        <p className="text-center text-sm text-muted-foreground">No smart lock or mailbox on file for this unit.</p>
      ) : null}
    </div>
  )
}

/** Operator / employee: dialog wrapper around `CleanlemonDoorOpenPanel`. */
export function CleanlemonDoorOpenDialog(
  props: CleanlemonDoorOpenPanelProps & {
    open: boolean
    onOpenChange: (v: boolean) => void
    title?: string
    subtitle?: string
  }
) {
  const { open, onOpenChange, title = "Open door", subtitle, ...panel } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle ? <DialogDescription>{subtitle}</DialogDescription> : null}
        </DialogHeader>
        <CleanlemonDoorOpenPanel {...panel} />
      </DialogContent>
    </Dialog>
  )
}
