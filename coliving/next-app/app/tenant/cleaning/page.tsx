"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Sparkles, Loader2 } from "lucide-react"
import { useTenantOptional } from "@/contexts/tenant-context"
import { tenantCleaningOrder, tenantCleaningOrderLatest } from "@/lib/tenant-api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { getTodayMalaysiaYmd } from "@/lib/dateMalaysia"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type AccessMode = "door_unlocked" | "other"

type LatestCleaning = {
  id: string
  createdAt: string | null
  preferredDate: string | null
  scheduledDate: string | null
  scheduledTime: string | null
  roomAccessMode: string | null
  roomAccessDetail: string | null
}

function formatCreatedAt(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d)
}

function formatPreferredSlot(row: LatestCleaning): string {
  const date = row.scheduledDate || row.preferredDate || ""
  const time = row.scheduledTime?.trim() || ""
  if (date && time) return `${date} · ${time} (Malaysia)`
  if (date) return `${date} (Malaysia)`
  return "—"
}

function accessSummary(row: LatestCleaning): string {
  const mode = row.roomAccessMode
  if (mode === "door_unlocked") return "Did not lock the door"
  if (mode === "other" && row.roomAccessDetail?.trim()) return row.roomAccessDetail.trim()
  if (mode === "other") return "Other"
  return "—"
}

export default function TenantCleaningPage() {
  const state = useTenantOptional()
  const { toast } = useToast()
  const tenancies = state?.tenancies ?? []
  const selectedTenancyId = state?.selectedTenancyId ?? null
  const current =
    tenancies.find((t) => (t?.id ?? t?._id) === selectedTenancyId) ?? tenancies[0]
  const tenancyId = current ? String(current.id ?? current._id ?? "") : ""
  const tenancyReadOnly = !!(current as { isPortalReadOnly?: boolean } | undefined)?.isPortalReadOnly
  const hasCleaning = !!current?.hasCleaningOrder
  const priceMyr = current?.cleaningTenantPriceMyr

  const [scheduledDate, setScheduledDate] = useState(() => getTodayMalaysiaYmd())
  const [scheduledTime, setScheduledTime] = useState("09:00")
  const [submitting, setSubmitting] = useState(false)

  const [latest, setLatest] = useState<LatestCleaning | null>(null)
  const [latestLoading, setLatestLoading] = useState(false)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [roomAccessMode, setRoomAccessMode] = useState<AccessMode>("door_unlocked")
  const [roomAccessOther, setRoomAccessOther] = useState("")

  const loadLatest = useCallback(async () => {
    if (!tenancyId) return
    setLatestLoading(true)
    try {
      const r = await tenantCleaningOrderLatest(tenancyId)
      if (r?.ok && r.item) setLatest(r.item as LatestCleaning)
      else setLatest(null)
    } catch (e) {
      console.error(e)
      setLatest(null)
    } finally {
      setLatestLoading(false)
    }
  }, [tenancyId])

  useEffect(() => {
    loadLatest()
  }, [loadLatest])

  const priceLabel = useMemo(() => {
    if (priceMyr == null || !Number.isFinite(Number(priceMyr))) return null
    return `RM ${Number(priceMyr).toFixed(2)}`
  }, [priceMyr])

  const openConfirm = () => {
    if (tenancyReadOnly) return
    setRoomAccessMode("door_unlocked")
    setRoomAccessOther("")
    setConfirmOpen(true)
  }

  const confirmDisabled =
    roomAccessMode === "other" && !String(roomAccessOther || "").trim()

  const submitFromDialog = async () => {
    if (tenancyReadOnly) return
    if (!tenancyId || !hasCleaning) return
    if (confirmDisabled) return
    setSubmitting(true)
    try {
      const r = await tenantCleaningOrder({
        tenancyId,
        scheduledDate,
        scheduledTime: scheduledTime || "09:00",
        roomAccessMode,
        roomAccessDetail: roomAccessMode === "other" ? roomAccessOther.trim() : undefined,
      })
      if (r?.ok) {
        setConfirmOpen(false)
        toast({
          title: "Cleaning requested",
          description: "An invoice will appear under Payment when ready.",
        })
        await loadLatest()
      } else {
        toast({
          title: "Could not place order",
          description: (r as { reason?: string })?.reason || "Unknown error",
          variant: "destructive",
        })
      }
    } catch (e) {
      console.error(e)
      toast({
        title: "Could not place order",
        description: e instanceof Error ? e.message : "Network error",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (state?.loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground">
        <Loader2 className="animate-spin h-8 w-8" />
      </div>
    )
  }

  if (!current) {
    return (
      <div className="max-w-lg mx-auto p-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          Cleaning
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">No active tenancy. Select a room from the sidebar when available.</p>
      </div>
    )
  }

  if (!hasCleaning) {
    return (
      <div className="max-w-lg mx-auto p-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          Cleaning
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Cleaning orders are not enabled for this room. Ask your operator to set a tenant cleaning price on the property or room.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          Cleaning
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Request a one-off room cleaning. Date and time are in Malaysia (UTC+8). You will be invoiced{" "}
          {priceLabel ? <span className="font-medium text-foreground">{priceLabel}</span> : "the price your operator set"}
          .
        </p>
      </div>

      {latestLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your requests…
        </div>
      ) : latest ? (
        <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-2 text-sm">
          <p className="font-medium text-foreground">Current request</p>
          <p>
            <span className="text-muted-foreground">Created: </span>
            {formatCreatedAt(latest.createdAt)}
          </p>
          <p>
            <span className="text-muted-foreground">Preferred date and time: </span>
            {formatPreferredSlot(latest)}
          </p>
          <p>
            <span className="text-muted-foreground">How to enter: </span>
            {accessSummary(latest)}
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        {tenancyReadOnly ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            This tenancy is ended — cleaning requests are disabled.
          </p>
        ) : null}
        <div>
          <Label className="text-xs">Preferred date</Label>
          <Input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="mt-1"
            disabled={tenancyReadOnly}
          />
        </div>
        <div>
          <Label className="text-xs">Preferred time</Label>
          <Input
            type="time"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            className="mt-1"
            disabled={tenancyReadOnly}
          />
        </div>
        <Button
          className="w-full"
          style={{ background: "var(--brand)" }}
          onClick={openConfirm}
          disabled={submitting || !scheduledDate || tenancyReadOnly}
        >
          Request cleaning
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Confirm cleaning request</DialogTitle>
            <DialogDescription>
              Preferred slot:{" "}
              <span className="text-foreground font-medium">
                {scheduledDate} {scheduledTime || "09:00"} (Malaysia)
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Label className="text-sm font-medium">How should staff enter the room?</Label>
            <Select
              value={roomAccessMode}
              onValueChange={(v) => setRoomAccessMode(v as AccessMode)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose one" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="door_unlocked">Did not lock the door</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            {roomAccessMode === "other" ? (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Describe access</Label>
                <Input
                  value={roomAccessOther}
                  onChange={(e) => setRoomAccessOther(e.target.value)}
                  placeholder="e.g. Key under mat, gate code…"
                  maxLength={500}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              style={{ background: "var(--brand)" }}
              disabled={submitting || confirmDisabled}
              onClick={() => void submitFromDialog()}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Submitting…
                </>
              ) : (
                "Confirm request"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
