"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  XCircle,
  AlertTriangle,
  Banknote,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { OPERATOR_SCHEDULE_AI_DISPLAY_NAME } from "@/lib/cleanlemon-operator-ai-brand"
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
import { useEffectiveOperatorId } from "@/lib/cleanlemon-effective-operator-id"
import {
  decideOperatorClientBookingRequest,
  fetchOperatorPendingClientBookingRequests,
  fetchOperatorScheduleAiSettings,
  saveOperatorScheduleAiSettings,
  fetchOperatorPaymentQueue,
  postOperatorRejectClientPortalReceipt,
  postOperatorRejectClientPortalReceiptBatch,
  updateOperatorInvoiceStatus,
  fetchOperatorSettings,
  type CleanlemonPendingBookingJobRow,
  type OperatorPaymentQueueRow,
} from "@/lib/cleanlemon-api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

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

type PaymentQueueSortKey = "client" | "invoice" | "amount" | "paymentDate" | "status"

function receiptUrlKind(url: string): "image" | "pdf" | "other" {
  const u = String(url || "").trim().split("?")[0].toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(u)) return "image"
  if (/\.pdf$/i.test(u)) return "pdf"
  return "other"
}

function SortablePaymentHead({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
  rightAlign,
}: {
  label: string
  sortKey: PaymentQueueSortKey
  activeKey: PaymentQueueSortKey | null
  dir: "asc" | "desc"
  onSort: (k: PaymentQueueSortKey) => void
  className?: string
  rightAlign?: boolean
}) {
  const active = activeKey === sortKey
  return (
    <TableHead className={cn(rightAlign && "text-right", className)}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 select-none font-medium text-foreground hover:text-primary",
          rightAlign ? "w-full justify-end text-right" : "text-left",
        )}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        {active ? (
          dir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          )
        ) : (
          <span className="inline-flex flex-col leading-none opacity-35" aria-hidden>
            <ChevronUp className="h-2.5 w-2.5 -mb-0.5" />
            <ChevronDown className="h-2.5 w-2.5" />
          </span>
        )}
      </button>
    </TableHead>
  )
}

function parseStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.map((x) => String(x ?? "").trim()).filter(Boolean)
  return out.length ? out : undefined
}

function mapPaymentQueueRow(raw: Record<string, unknown>): OperatorPaymentQueueRow {
  const paymentIds = parseStringArray(raw.paymentIds ?? raw.paymentids)
  const invoiceIds = parseStringArray(raw.invoiceIds ?? raw.invoiceids)
  const invoiceNos = parseStringArray(raw.invoiceNos ?? raw.invoicenos)
  const amountsRaw = Array.isArray(raw.amounts) ? raw.amounts : null
  const amounts =
    amountsRaw && amountsRaw.length
      ? amountsRaw.map((x) => Number(x ?? 0) || 0)
      : undefined
  const receiptBatchIdRaw = raw.receiptBatchId ?? raw.receiptbatchid
  const receiptBatchId =
    receiptBatchIdRaw != null && String(receiptBatchIdRaw).trim() !== ""
      ? String(receiptBatchIdRaw).trim()
      : null
  const isBatch = Boolean(raw.isBatch === true || raw.isbatch === true)
  const totalAmount = raw.totalAmount != null ? Number(raw.totalAmount) : raw.totalamount != null ? Number(raw.totalamount) : undefined
  return {
    paymentId: String(raw.paymentId ?? raw.paymentid ?? ""),
    invoiceId: String(raw.invoiceId ?? raw.invoiceid ?? ""),
    amount: Number(raw.amount ?? 0) || 0,
    paymentDate: raw.paymentDate != null ? String(raw.paymentDate) : null,
    receiptUrl: raw.receiptUrl != null ? String(raw.receiptUrl) : null,
    transactionId: raw.transactionId != null ? String(raw.transactionId) : null,
    receiptNumber:
      raw.receiptNumber != null
        ? String(raw.receiptNumber)
        : raw.receiptnumber != null
          ? String(raw.receiptnumber)
          : null,
    createdAt: raw.createdAt != null ? String(raw.createdAt) : null,
    operatorAckAt: raw.operatorAckAt != null ? String(raw.operatorAckAt) : raw.operatorackat != null ? String(raw.operatorackat) : null,
    invoiceNo: String(raw.invoiceNo ?? raw.invoiceno ?? ""),
    invoicePaid: Number(raw.invoicePaid ?? raw.invoicepaid ?? 0) || 0,
    clientName: String(raw.clientName ?? raw.clientname ?? ""),
    clientEmail: String(raw.clientEmail ?? raw.clientemail ?? ""),
    receiptBatchId,
    isBatch: isBatch || (paymentIds != null && paymentIds.length > 1),
    paymentIds,
    invoiceIds,
    invoiceNos,
    amounts,
    totalAmount: totalAmount != null && Number.isFinite(totalAmount) ? totalAmount : undefined,
  }
}

export default function OperatorApprovalPage() {
  const { user } = useAuth()
  const operatorId = useEffectiveOperatorId(user)
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

  const [mainTab, setMainTab] = useState<"booking" | "payment">("booking")
  const [paymentRows, setPaymentRows] = useState<OperatorPaymentQueueRow[]>([])
  const [paymentLoading, setPaymentLoading] = useState(false)
  /** Single dialog: receipt preview + mark as paid (when invoice still unpaid). */
  const [paymentReviewRow, setPaymentReviewRow] = useState<OperatorPaymentQueueRow | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank">("bank")
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split("T")[0])
  const [markPaidBusy, setMarkPaidBusy] = useState(false)
  const [rejectReceiptBusy, setRejectReceiptBusy] = useState(false)
  const [hasAccountingIntegration, setHasAccountingIntegration] = useState(false)
  const [paymentSortKey, setPaymentSortKey] = useState<PaymentQueueSortKey | null>(null)
  const [paymentSortDir, setPaymentSortDir] = useState<"asc" | "desc">("asc")

  /** API returns client-portal receipts, grouped by `receipt_batch_id` (or legacy same-upload heuristic). */
  const manualPaymentRows = paymentRows

  const sortedManualPaymentRows = useMemo(() => {
    const list = [...manualPaymentRows]
    const k = paymentSortKey
    if (!k) return list
    const dir = paymentSortDir === "asc" ? 1 : -1
    const cmp = (a: OperatorPaymentQueueRow, b: OperatorPaymentQueueRow) => {
      if (k === "client") {
        const sa = `${a.clientName} ${a.clientEmail}`.toLowerCase()
        const sb = `${b.clientName} ${b.clientEmail}`.toLowerCase()
        return sa < sb ? -dir : sa > sb ? dir : 0
      }
      if (k === "invoice") {
        const sa = String(a.invoiceNo || a.invoiceId).toLowerCase()
        const sb = String(b.invoiceNo || b.invoiceId).toLowerCase()
        return sa < sb ? -dir : sa > sb ? dir : 0
      }
      if (k === "amount") {
        const na = (a.totalAmount ?? a.amount) || 0
        const nb = (b.totalAmount ?? b.amount) || 0
        return na < nb ? -dir : na > nb ? dir : 0
      }
      if (k === "paymentDate") {
        const sa = String(a.paymentDate || "")
        const sb = String(b.paymentDate || "")
        return sa < sb ? -dir : sa > sb ? dir : 0
      }
      if (k === "status") {
        const na = a.invoicePaid === 1 ? 1 : 0
        const nb = b.invoicePaid === 1 ? 1 : 0
        return na < nb ? -dir : na > nb ? dir : 0
      }
      return 0
    }
    list.sort(cmp)
    return list
  }, [manualPaymentRows, paymentSortKey, paymentSortDir])

  const onPaymentSort = useCallback((key: PaymentQueueSortKey) => {
    setPaymentSortKey((prev) => {
      if (prev === key) {
        setPaymentSortDir((d) => (d === "asc" ? "desc" : "asc"))
        return prev
      }
      setPaymentSortDir("asc")
      return key
    })
  }, [])

  const openPaymentReview = useCallback((row: OperatorPaymentQueueRow) => {
    setPaymentReviewRow(row)
    setPaymentDate(new Date().toISOString().split("T")[0])
    setPaymentMethod("bank")
  }, [])

  const loadScheduleAiNotice = useCallback(async () => {
    const r = await fetchOperatorScheduleAiSettings(operatorId, { email: staffEmail })
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
  }, [operatorId, staffEmail])

  useEffect(() => {
    void loadScheduleAiNotice()
  }, [loadScheduleAiNotice])

  const dismissScheduleAiNotice = async () => {
    setScheduleAiErrorDismissLoading(true)
    try {
      const r = await saveOperatorScheduleAiSettings(
        operatorId,
        { clearScheduleAiLastError: true },
        { email: staffEmail }
      )
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

  const refreshPayments = useCallback(async () => {
    setPaymentLoading(true)
    try {
      const r = await fetchOperatorPaymentQueue(operatorId, { limit: 200 })
      if (!r?.ok) {
        setPaymentRows([])
        return
      }
      const raw = Array.isArray(r.items) ? r.items : []
      setPaymentRows(raw.map((x) => mapPaymentQueueRow(x as Record<string, unknown>)))
    } finally {
      setPaymentLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    if (mainTab !== "payment") return
    void refreshPayments()
  }, [mainTab, refreshPayments])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await fetchOperatorSettings(operatorId)
      if (cancelled || !s?.ok) return
      const parsed = (s as { settings?: { bukku?: unknown; xero?: unknown } }).settings || {}
      setHasAccountingIntegration(Boolean(parsed?.bukku || parsed?.xero))
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

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

  const confirmMarkPaidInReview = async () => {
    const row = paymentReviewRow
    if (!row) return
    const targets =
      row.invoiceIds && row.invoiceIds.length
        ? [...new Set(row.invoiceIds.map((x) => String(x || "").trim()).filter(Boolean))]
        : [String(row.invoiceId || "").trim()].filter(Boolean)
    if (!targets.length) return
    setMarkPaidBusy(true)
    try {
      const oid = String(operatorId || "").trim()
      for (const invId of targets) {
        const r = await updateOperatorInvoiceStatus(invId, "paid", {
          operatorId: oid || undefined,
          paymentMethod,
          paymentDate,
        })
        if (!r?.ok) {
          toast.error(String(r?.reason || "Could not mark paid"))
          return
        }
      }
      toast.success(targets.length > 1 ? `Recorded ${targets.length} invoices as paid` : "Recorded as paid")
      setPaymentReviewRow(null)
      void refreshPayments()
    } finally {
      setMarkPaidBusy(false)
    }
  }

  const confirmRejectReceiptInReview = async () => {
    const row = paymentReviewRow
    if (!row) return
    const n = row.paymentIds?.length || 1
    if (
      !window.confirm(
        n > 1
          ? `Reject this upload (${n} invoices)? All receipt copies will be removed and the client can upload again.`
          : "Reject this uploaded receipt? It will be removed and the client can upload again.",
      )
    )
      return
    setRejectReceiptBusy(true)
    try {
      const oid = String(operatorId || "").trim()
      const bid = String(row.receiptBatchId || "").trim()
      const pids = row.paymentIds?.length ? row.paymentIds : [String(row.paymentId || "").trim()].filter(Boolean)
      let r: { ok?: boolean; reason?: string }
      if (bid) {
        r = await postOperatorRejectClientPortalReceiptBatch(oid, { receiptBatchId: bid })
      } else if (pids.length > 1) {
        r = await postOperatorRejectClientPortalReceiptBatch(oid, { paymentIds: pids })
      } else {
        r = await postOperatorRejectClientPortalReceipt(pids[0] || row.paymentId, oid)
      }
      if (!r?.ok) {
        toast.error(String(r?.reason || "Could not reject"))
        return
      }
      toast.success(n > 1 ? "Upload rejected" : "Receipt rejected")
      setPaymentReviewRow(null)
      void refreshPayments()
    } finally {
      setRejectReceiptBusy(false)
    }
  }

  return (
    <div className="pb-20 lg:pb-0">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-foreground">Approvals</h1>
          <p className="text-muted-foreground mt-1 text-sm">Booking requests and client payment activity.</p>
        </div>
      </div>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "booking" | "payment")} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="booking" className="gap-2">
            <CalendarClock className="h-4 w-4" />
            Booking
          </TabsTrigger>
          <TabsTrigger value="payment" className="gap-2">
            <Banknote className="h-4 w-4" />
            Payment
          </TabsTrigger>
        </TabsList>

        <TabsContent value="booking" className="space-y-6 mt-0">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <p className="text-muted-foreground text-sm">Approve or reject pending client jobs.</p>
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
          <AlertTitle>{OPERATOR_SCHEDULE_AI_DISPLAY_NAME}: automatic schedule run did not finish</AlertTitle>
          <AlertDescription className="space-y-2 text-left">
            <p className="whitespace-pre-wrap break-words">{scheduleAiError.message}</p>
            {scheduleAiError.at ? (
              <p className="text-xs opacity-90">
                {formatDateShort(scheduleAiError.at)}
                {scheduleAiError.source ? ` · ${scheduleAiError.source}` : ""}
              </p>
            ) : null}
            <p className="text-xs opacity-90">
              Check{' '}
              <span className="font-medium">Company → API Integration ({OPERATOR_SCHEDULE_AI_DISPLAY_NAME})</span> and
              your model provider.
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
        </TabsContent>

        <TabsContent value="payment" className="space-y-4 mt-0">
          <p className="text-sm text-muted-foreground">
            One line per client receipt upload (several invoices can share one proof). Balances stay unpaid until you mark
            paid here, or reject so they can re-upload.{" "}
            <Link href="/portal/operator/invoices" className="text-primary underline-offset-2 hover:underline">
              Open Invoices
            </Link>{" "}
            for full payment history.
          </p>
          {paymentLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : sortedManualPaymentRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
              No manual receipt items pending review.
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto bg-card">
              <Table className="w-full min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <SortablePaymentHead
                      label="Client"
                      sortKey="client"
                      activeKey={paymentSortKey}
                      dir={paymentSortDir}
                      onSort={onPaymentSort}
                    />
                    <SortablePaymentHead
                      label="Invoice"
                      sortKey="invoice"
                      activeKey={paymentSortKey}
                      dir={paymentSortDir}
                      onSort={onPaymentSort}
                    />
                    <SortablePaymentHead
                      label="Amount (MYR)"
                      sortKey="amount"
                      activeKey={paymentSortKey}
                      dir={paymentSortDir}
                      onSort={onPaymentSort}
                      rightAlign
                      className="text-right"
                    />
                    <SortablePaymentHead
                      label="Payment date"
                      sortKey="paymentDate"
                      activeKey={paymentSortKey}
                      dir={paymentSortDir}
                      onSort={onPaymentSort}
                    />
                    <SortablePaymentHead
                      label="Invoice status"
                      sortKey="status"
                      activeKey={paymentSortKey}
                      dir={paymentSortDir}
                      onSort={onPaymentSort}
                    />
                    <TableHead className="w-[100px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedManualPaymentRows.map((row) => (
                    <TableRow key={row.paymentId}>
                      <TableCell className="whitespace-normal max-w-[200px]">
                        <div className="font-medium">{row.clientName || "—"}</div>
                        {row.clientEmail ? (
                          <div className="text-xs text-muted-foreground truncate">{row.clientEmail}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-sm whitespace-normal max-w-[220px]">
                        {row.invoiceNo || row.invoiceId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {(row.totalAmount ?? row.amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {row.paymentDate || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.invoicePaid === 1 ? (
                          <span className="text-green-700 font-medium">Paid</span>
                        ) : (
                          <span className="text-amber-700 font-medium">Unpaid</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="outline" size="sm" onClick={() => openPaymentReview(row)}>
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

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

      <Dialog open={!!paymentReviewRow} onOpenChange={(o) => !o && setPaymentReviewRow(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payment preview</DialogTitle>
            <DialogDescription>
              Client receipt only — balance stays unpaid until you mark paid here, or reject so they can re-upload.
            </DialogDescription>
          </DialogHeader>
          {paymentReviewRow ? (
            <div className="space-y-4 text-sm py-2">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted-foreground">Client</span>
                <span className="text-right font-medium">{paymentReviewRow.clientName || "—"}</span>
                <span className="text-muted-foreground">Invoice(s)</span>
                <span className="text-right font-mono text-xs whitespace-pre-wrap break-all">
                  {paymentReviewRow.invoiceNos && paymentReviewRow.invoiceNos.length > 1
                    ? paymentReviewRow.invoiceNos
                        .map((no, idx) => {
                          const amt = paymentReviewRow.amounts?.[idx]
                          const a =
                            amt != null
                              ? ` RM ${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : ""
                          return `${no || paymentReviewRow.invoiceIds?.[idx] || "—"}${a}`
                        })
                        .join("\n")
                    : paymentReviewRow.invoiceNo || paymentReviewRow.invoiceId}
                </span>
                <span className="text-muted-foreground">Amount</span>
                <span className="text-right tabular-nums">
                  RM{" "}
                  {(paymentReviewRow.totalAmount ?? paymentReviewRow.amount).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-muted-foreground">Recorded date</span>
                <span className="text-right">{paymentReviewRow.paymentDate || "—"}</span>
                <span className="text-muted-foreground">Reference</span>
                <span className="text-right break-all text-xs">{paymentReviewRow.transactionId || "—"}</span>
              </div>
              {paymentReviewRow.receiptUrl && /^https?:\/\//i.test(paymentReviewRow.receiptUrl) ? (
                <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                  {receiptUrlKind(paymentReviewRow.receiptUrl) === "image" ? (
                    <img
                      src={paymentReviewRow.receiptUrl}
                      alt="Payment receipt"
                      className="max-h-[min(50vh,420px)] w-full object-contain bg-background"
                    />
                  ) : receiptUrlKind(paymentReviewRow.receiptUrl) === "pdf" ? (
                    <iframe
                      title="Receipt PDF"
                      src={paymentReviewRow.receiptUrl}
                      className="h-[min(50vh,420px)] w-full bg-background"
                    />
                  ) : (
                    <img
                      src={paymentReviewRow.receiptUrl}
                      alt="Payment receipt"
                      className="max-h-[min(50vh,420px)] w-full object-contain bg-background"
                    />
                  )}
                </div>
              ) : null}

              {paymentReviewRow.invoicePaid !== 1 ? (
                <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                  <p className="font-medium text-foreground">Mark as paid</p>
                  <p className="text-xs text-muted-foreground">
                    {hasAccountingIntegration
                      ? "If accounting (Bukku/Xero) is connected, we will try to post the payment there; otherwise only MySQL is updated."
                      : "This updates your invoice in MySQL only."}
                  </p>
                  <div className="space-y-2">
                    <Label>Payment method</Label>
                    <Select value={paymentMethod} onValueChange={(v: "cash" | "bank") => setPaymentMethod(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="cash">Cash</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Payment date</Label>
                    <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This invoice is already marked paid.</p>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={markPaidBusy || rejectReceiptBusy}
              onClick={() => setPaymentReviewRow(null)}
            >
              Close
            </Button>
            {paymentReviewRow && paymentReviewRow.invoicePaid !== 1 ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={markPaidBusy || rejectReceiptBusy}
                  onClick={() => void confirmRejectReceiptInReview()}
                >
                  {rejectReceiptBusy ? "…" : paymentReviewRow.isBatch ? "Reject batch" : "Reject receipt"}
                </Button>
                <Button
                  type="button"
                  disabled={markPaidBusy || rejectReceiptBusy}
                  onClick={() => void confirmMarkPaidInReview()}
                >
                  {markPaidBusy ? "Saving…" : "Mark as paid"}
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
