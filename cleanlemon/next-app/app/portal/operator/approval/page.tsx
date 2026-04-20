"use client"

import { useCallback, useEffect, useState } from "react"
import { CalendarClock, CheckCircle2, Loader2, XCircle, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"
import {
  decideOperatorClientBookingRequest,
  fetchOperatorPendingClientBookingRequests,
  fetchOperatorScheduleAiSettings,
  saveOperatorScheduleAiSettings,
  type CleanlemonPendingBookingJobRow,
} from "@/lib/cleanlemon-api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

function formatDateShort(iso: string | undefined | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function formatJobDateOnly(iso: string | undefined | null): string {
  if (!iso) return "—"
  const s = String(iso).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00`)
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(undefined, { dateStyle: "medium" })
  }
  return formatDateShort(iso)
}

export default function OperatorApprovalPage() {
  const { user } = useAuth()
  const operatorId = String(user?.operatorId || "").trim() || "op_demo_001"
  const staffEmail = String(user?.email || "").trim().toLowerCase()

  const [bookingItems, setBookingItems] = useState<CleanlemonPendingBookingJobRow[]>([])
  const [bookingLoading, setBookingLoading] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<CleanlemonPendingBookingJobRow | null>(null)
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false)
  const [bookingActionLoading, setBookingActionLoading] = useState(false)
  const [scheduleAiError, setScheduleAiError] = useState<{
    message: string
    at?: string | null
    source?: string | null
  } | null>(null)
  const [scheduleAiErrorDismissLoading, setScheduleAiErrorDismissLoading] = useState(false)

  const loadScheduleAiNotice = useCallback(async () => {
    const r = await fetchOperatorScheduleAiSettings(operatorId)
    if (!r?.ok || !r.data) {
      setScheduleAiError(null)
      return
    }
    const msg = r.data.scheduleAiLastErrorMessage
    if (msg && String(msg).trim()) {
      setScheduleAiError({
        message: String(msg),
        at: r.data.scheduleAiLastErrorAt ?? null,
        source: r.data.scheduleAiLastErrorSource ?? null,
      })
    } else {
      setScheduleAiError(null)
    }
  }, [operatorId])

  useEffect(() => {
    void loadScheduleAiNotice()
  }, [loadScheduleAiNotice])

  const dismissScheduleAiNotice = async () => {
    setScheduleAiErrorDismissLoading(true)
    try {
      const r = await saveOperatorScheduleAiSettings(operatorId, { clearScheduleAiLastError: true })
      if (!r?.ok) {
        toast.error(r?.reason || "Could not dismiss notice")
        return
      }
      setScheduleAiError(null)
      toast.success("Notice dismissed")
    } finally {
      setScheduleAiErrorDismissLoading(false)
    }
  }

  const refreshBookings = useCallback(async () => {
    setBookingLoading(true)
    try {
      const r = await fetchOperatorPendingClientBookingRequests({ operatorId, limit: 200 })
      if (!r?.ok) {
        setBookingItems([])
        toast.error(r?.reason || "Failed to load booking requests")
        return
      }
      setBookingItems(Array.isArray(r.items) ? r.items : [])
    } finally {
      setBookingLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    void refreshBookings()
  }, [refreshBookings])

  const openBookingReview = (row: CleanlemonPendingBookingJobRow) => {
    setSelectedBooking(row)
    setBookingDialogOpen(true)
  }

  const handleBookingDecision = async (decision: "approve" | "reject") => {
    if (!selectedBooking) return
    setBookingActionLoading(true)
    try {
      const res = await decideOperatorClientBookingRequest(selectedBooking.id, {
        operatorId,
        decision,
        ...(staffEmail ? { email: staffEmail } : {}),
      })
      if (!res?.ok) {
        toast.error(res?.reason || "Request failed")
        return
      }
      toast.success(
        decision === "approve"
          ? "Booking approved. The job appears on Schedule as ready to clean."
          : "Booking request rejected."
      )
      setBookingDialogOpen(false)
      setSelectedBooking(null)
      await refreshBookings()
    } finally {
      setBookingActionLoading(false)
    }
  }

  return (
    <div className="pb-20 lg:pb-0">
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-foreground">Booking requests</h1>
          <p className="text-muted-foreground mt-1 text-sm">Approve or reject pending client jobs.</p>
        </div>
        {bookingItems.length > 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 shrink-0">
            <CalendarClock className="h-4 w-4 opacity-70" />
            {bookingItems.length} pending
          </p>
        ) : null}
      </div>

      {scheduleAiError ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Automatic schedule AI did not finish</AlertTitle>
          <AlertDescription className="space-y-2 text-left">
            <p className="whitespace-pre-wrap break-words">{scheduleAiError.message}</p>
            {scheduleAiError.at ? (
              <p className="text-xs opacity-90">
                {formatDateShort(scheduleAiError.at)}
                {scheduleAiError.source ? ` · ${scheduleAiError.source}` : ""}
              </p>
            ) : null}
            <p className="text-xs opacity-90">
              Check <span className="font-medium">Company → Connect AI</span> and your AI provider.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={scheduleAiErrorDismissLoading}
              onClick={() => void dismissScheduleAiNotice()}
            >
              {scheduleAiErrorDismissLoading ? "…" : "Dismiss"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {bookingLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : bookingItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          No pending booking requests.
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto bg-card">
          <Table className="w-full min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="min-w-[160px] whitespace-normal">Address</TableHead>
                <TableHead className="min-w-[140px] whitespace-normal">Client</TableHead>
                <TableHead className="whitespace-normal">Service</TableHead>
                <TableHead>Job date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookingItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium whitespace-normal min-w-[140px]">
                    {String(item.property || "").trim() || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {String(item.unitNumber || item.unit || "").trim() || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-normal min-w-[180px]">
                    {String(item.address || "").trim() || "—"}
                  </TableCell>
                  <TableCell className="whitespace-normal">{String(item.client || "").trim() || "—"}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-normal text-sm">
                    {String(item.cleaningType || item.serviceProvider || "").trim() || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {formatJobDateOnly(item.date)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {String(item.time || "").trim() || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" type="button" onClick={() => openBookingReview(item)}>
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={bookingDialogOpen} onOpenChange={setBookingDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review booking request</DialogTitle>
            <DialogDescription>Approve to add to Schedule; reject cancels for the client.</DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm py-2">
              <span className="text-muted-foreground">Property</span>
              <span className="font-semibold text-right">
                {String(selectedBooking.property || "").trim() || "—"}
              </span>
              <span className="text-muted-foreground">Unit</span>
              <span className="text-right">{String(selectedBooking.unitNumber || selectedBooking.unit || "").trim() || "—"}</span>
              <span className="text-muted-foreground">Address</span>
              <span className="text-right whitespace-normal">{String(selectedBooking.address || "").trim() || "—"}</span>
              <span className="text-muted-foreground">Client</span>
              <span className="text-right whitespace-normal">{String(selectedBooking.client || "").trim() || "—"}</span>
              <span className="text-muted-foreground">Service</span>
              <span className="text-right whitespace-normal">
                {String(selectedBooking.cleaningType || selectedBooking.serviceProvider || "").trim() || "—"}
              </span>
              <span className="text-muted-foreground">Job date</span>
              <span className="text-right">{formatJobDateOnly(selectedBooking.date)}</span>
              <span className="text-muted-foreground">Time</span>
              <span className="text-right">{String(selectedBooking.time || "").trim() || "—"}</span>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => void handleBookingDecision("reject")}
              disabled={bookingActionLoading}
              className="flex-1"
            >
              <XCircle size={16} className="mr-2" /> Reject
            </Button>
            <Button
              onClick={() => void handleBookingDecision("approve")}
              disabled={bookingActionLoading}
              className="flex-1 text-white"
              style={{ background: "var(--brand)" }}
            >
              <CheckCircle2 size={16} className="mr-2" /> Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
