"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Building2, CalendarClock, CheckCircle2, Loader2, XCircle, AlertTriangle } from "lucide-react"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  CLN_PLR_KIND_CLIENT_REQUESTS_OPERATOR,
  bulkDecideOperatorPropertyLinkRequests,
  decideOperatorClientBookingRequest,
  decideOperatorPropertyLinkRequest,
  fetchOperatorPendingClientBookingRequests,
  fetchOperatorPropertyLinkRequestCounts,
  fetchOperatorPropertyLinkRequests,
  fetchOperatorScheduleAiSettings,
  saveOperatorScheduleAiSettings,
  type CleanlemonPendingBookingJobRow,
  type CleanlemonPropertyLinkRequestRow,
} from "@/lib/cleanlemon-api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type StatusTab = "pending" | "approved" | "rejected"
type ApprovalSectionTab = "property_links" | "booking_requests"

function formatClientCell(row: CleanlemonPropertyLinkRequestRow): { title: string; sub?: string } {
  const name = String(row.clientName || "").trim()
  const email = String(row.clientEmail || "").trim()
  if (name && email) return { title: name, sub: email }
  if (name) return { title: name }
  if (email) return { title: email }
  const id = String(row.clientdetailId || "").trim()
  return { title: id ? `${id.slice(0, 8)}…` : "—" }
}

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

  const [tab, setTab] = useState<StatusTab>("pending")
  const [items, setItems] = useState<CleanlemonPropertyLinkRequestRow[]>([])
  const [counts, setCounts] = useState<{ pending: number; approved: number; rejected: number } | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CleanlemonPropertyLinkRequestRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [actionLoading, setActionLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false)
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false)
  const [bulkRemarks, setBulkRemarks] = useState("")
  const [approvalSection, setApprovalSection] = useState<ApprovalSectionTab>("property_links")
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
  const approvalSectionRef = useRef(approvalSection)
  approvalSectionRef.current = approvalSection

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
        if (approvalSectionRef.current === "booking_requests") {
          toast.error(r?.reason || "Failed to load booking requests")
        }
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

  const loadCounts = useCallback(async () => {
    const r = await fetchOperatorPropertyLinkRequestCounts(operatorId, {
      kind: CLN_PLR_KIND_CLIENT_REQUESTS_OPERATOR,
    })
    if (r?.ok && r.counts) setCounts(r.counts)
  }, [operatorId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetchOperatorPropertyLinkRequests(operatorId, {
        status: tab,
        kind: CLN_PLR_KIND_CLIENT_REQUESTS_OPERATOR,
        limit: 200,
      })
      if (!r?.ok) {
        toast.error(r?.reason || "Failed to load approvals")
        setItems([])
        return
      }
      setItems(Array.isArray(r.items) ? r.items : [])
    } finally {
      setLoading(false)
    }
  }, [operatorId, tab])

  useEffect(() => {
    void loadCounts()
  }, [loadCounts])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [tab])

  const pendingIds = useMemo(() => new Set(items.map((i) => i.id)), [items])
  const allSelected =
    tab === "pending" && items.length > 0 && items.every((i) => selectedIds.has(i.id))
  const someSelected = tab === "pending" && selectedIds.size > 0

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(items.map((i) => i.id)))
  }

  const refreshAfterMutation = async () => {
    await load()
    await loadCounts()
    setSelectedIds(new Set())
  }

  const handleAction = async (action: "approve" | "reject") => {
    if (!selected) return
    setActionLoading(true)
    try {
      const res = await decideOperatorPropertyLinkRequest(selected.id, {
        operatorId,
        email: staffEmail || undefined,
        decision: action,
        remarks: remarks.trim() || undefined,
      })
      if (!res?.ok) {
        toast.error(res?.reason || "Request failed")
        return
      }
      toast.success(action === "approve" ? "Approval granted." : "Request rejected.")
      setDialogOpen(false)
      setSelected(null)
      setRemarks("")
      await refreshAfterMutation()
    } finally {
      setActionLoading(false)
    }
  }

  const runBulk = async (decision: "approve" | "reject", bulkRemark?: string) => {
    const ids = [...selectedIds].filter((id) => pendingIds.has(id))
    if (!ids.length) {
      toast.error("No rows selected.")
      return
    }
    setActionLoading(true)
    try {
      const res = await bulkDecideOperatorPropertyLinkRequests({
        operatorId,
        email: staffEmail || undefined,
        decision,
        requestIds: ids,
        remarks: bulkRemark?.trim() || undefined,
      })
      if (!res?.ok) {
        toast.error(res?.reason || "Bulk request failed")
        return
      }
      const failed = (res.results || []).filter((x) => !x.ok)
      if (failed.length) {
        toast.warning(`Done: ${res.succeeded ?? 0} ok, ${failed.length} failed.`)
      } else {
        toast.success(decision === "approve" ? `Approved ${ids.length} request(s).` : `Rejected ${ids.length} request(s).`)
      }
      setBulkApproveOpen(false)
      setBulkRejectOpen(false)
      setBulkRemarks("")
      await refreshAfterMutation()
    } finally {
      setActionLoading(false)
    }
  }

  const openReview = (row: CleanlemonPropertyLinkRequestRow) => {
    setSelected(row)
    setRemarks("")
    setDialogOpen(true)
  }

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
      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Approvals</h1>
        <p className="text-muted-foreground mt-1">
          Approve client property links and cleaning jobs submitted under{" "}
          <span className="text-foreground/90">Pricing → Booking → Request booking &amp; approve</span>.
        </p>
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
              Often caused by missing/invalid API key, insufficient provider balance or quota, or a bad response from the
              model. Check <span className="font-medium">Company → Connect AI</span> and your provider account.
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

      <Tabs
        value={approvalSection}
        onValueChange={(v) => setApprovalSection(v as ApprovalSectionTab)}
        className="gap-4"
      >
        <TabsList className="h-auto flex-wrap justify-start gap-1 p-1 w-full max-w-full">
          <TabsTrigger value="property_links" className="px-3 gap-2">
            <Building2 className="h-4 w-4 shrink-0 opacity-70" />
            Client property links
            {counts && counts.pending > 0 ? (
              <span className="text-muted-foreground font-normal">({counts.pending} pending)</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="booking_requests" className="px-3 gap-2">
            <CalendarClock className="h-4 w-4 shrink-0 opacity-70" />
            Booking requests
            {bookingItems.length > 0 ? (
              <span className="text-muted-foreground font-normal">({bookingItems.length} pending)</span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="property_links" className="mt-0">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as StatusTab)}
        className="gap-4"
      >
        <TabsList className="h-auto flex-wrap justify-start gap-1 p-1">
          <TabsTrigger value="pending" className="px-3">
            Pending{counts ? ` (${counts.pending})` : ""}
          </TabsTrigger>
          <TabsTrigger value="approved" className="px-3">
            Approved{counts ? ` (${counts.approved})` : ""}
          </TabsTrigger>
          <TabsTrigger value="rejected" className="px-3">
            Rejected{counts ? ` (${counts.rejected})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-0">
          {tab === "pending" && someSelected && (
            <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl border border-border bg-muted/40">
              <span className="text-sm text-muted-foreground mr-2">{selectedIds.size} selected</span>
              <Button
                size="sm"
                onClick={() => setBulkApproveOpen(true)}
                disabled={actionLoading}
                style={{ background: "var(--brand)" }}
                className="text-white"
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Approve selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBulkRejectOpen(true)}
                disabled={actionLoading}
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Reject selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} type="button">
                Clear
              </Button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
              {tab === "pending"
                ? "No pending client link requests."
                : tab === "approved"
                  ? "No approved requests in the recent list."
                  : "No rejected requests in the recent list."}
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto bg-card">
              <Table className="w-full min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    {tab === "pending" && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={(c) => toggleAll(c === true)}
                          aria-label="Select all"
                        />
                      </TableHead>
                    )}
                    <TableHead>Property</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="min-w-[160px] whitespace-normal">Address</TableHead>
                    <TableHead className="min-w-[180px] whitespace-normal">Client</TableHead>
                    <TableHead>Requested</TableHead>
                    {tab !== "pending" && <TableHead>Decided</TableHead>}
                    <TableHead className="w-[100px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const client = formatClientCell(item)
                    return (
                      <TableRow key={item.id}>
                        {tab === "pending" && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(item.id)}
                              onCheckedChange={(c) => toggleOne(item.id, c === true)}
                              aria-label={`Select ${item.propertyName || "property"}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="font-medium whitespace-normal min-w-[140px]">
                          {String(item.propertyName || "").trim() || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {String(item.unitName || "").trim() || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-normal min-w-[180px]">
                          {String(item.address || "").trim() || "—"}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="flex items-start gap-1.5 min-w-0">
                            <Building2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate">{client.title}</div>
                              {client.sub ? (
                                <div className="text-xs text-muted-foreground truncate">{client.sub}</div>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                          {formatDateShort(item.createdAt)}
                        </TableCell>
                        {tab !== "pending" && (
                          <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                            {formatDateShort(item.decidedAt)}
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" type="button" onClick={() => openReview(item)}>
                            {tab === "pending" ? "Review" : "View"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
        </TabsContent>

        <TabsContent value="booking_requests" className="mt-0 space-y-4">
          <p className="text-sm text-muted-foreground">
            When a B2B client books a job while your pricing uses request-and-approve mode, the job stays here until
            you accept it. Approved jobs move to{" "}
            <span className="text-foreground/90 font-medium">Schedule</span> as ready to clean; rejected jobs are
            cancelled for the client.
          </p>
          {bookingLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : bookingItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
              No pending booking requests. If clients use instant booking, or request mode is off in Pricing, nothing
              appears here.
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
      </Tabs>

      <AlertDialog open={bulkApproveOpen} onOpenChange={setBulkApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve {selectedIds.size} request(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              The selected properties will be linked to your operator account. This matches approving each row
              individually.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionLoading}
              onClick={(e) => {
                e.preventDefault()
                void runBulk("approve")
              }}
              className="text-white"
              style={{ background: "var(--brand)" }}
            >
              {actionLoading ? "Working…" : "Approve all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject {selectedIds.size} request(s)</DialogTitle>
            <DialogDescription>Optional note stored on each rejected request.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason (optional)…"
            value={bulkRemarks}
            onChange={(e) => setBulkRemarks(e.target.value)}
            rows={3}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkRejectOpen(false)} disabled={actionLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void runBulk("reject", bulkRemarks)} disabled={actionLoading}>
              Reject all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tab === "pending" ? "Review link request" : "Request details"}</DialogTitle>
            <DialogDescription>
              {tab === "pending"
                ? "The client wants your operator account linked to this property."
                : `Status: ${selected?.status || ""}`}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <span className="text-muted-foreground">Property</span>
                <span className="font-semibold text-right">
                  {String(selected.propertyName || "").trim() || "—"}
                </span>
                <span className="text-muted-foreground">Unit</span>
                <span className="text-right">{String(selected.unitName || "").trim() || "—"}</span>
                <span className="text-muted-foreground">Address</span>
                <span className="text-right whitespace-normal">{String(selected.address || "").trim() || "—"}</span>
                <span className="text-muted-foreground">Client</span>
                <span className="text-right whitespace-normal">
                  {formatClientCell(selected).title}
                  {formatClientCell(selected).sub ? (
                    <span className="block text-xs text-muted-foreground font-normal">
                      {formatClientCell(selected).sub}
                    </span>
                  ) : null}
                </span>
                {selected.clientdetailId ? (
                  <>
                    <span className="text-muted-foreground">Client ID</span>
                    <span className="font-mono text-xs text-right break-all">{selected.clientdetailId}</span>
                  </>
                ) : null}
                <span className="text-muted-foreground">Requested</span>
                <span className="text-right">{formatDateShort(selected.createdAt)}</span>
                {tab !== "pending" && (
                  <>
                    <span className="text-muted-foreground">Decided</span>
                    <span className="text-right">{formatDateShort(selected.decidedAt)}</span>
                    {selected.decidedByEmail ? (
                      <>
                        <span className="text-muted-foreground">By</span>
                        <span className="text-right text-xs">{selected.decidedByEmail}</span>
                      </>
                    ) : null}
                    {selected.remarks ? (
                      <>
                        <span className="text-muted-foreground">Remarks</span>
                        <span className="text-right whitespace-normal text-xs">{selected.remarks}</span>
                      </>
                    ) : null}
                  </>
                )}
              </div>
              {tab === "pending" && (
                <div>
                  <span className="text-sm text-muted-foreground block mb-1">Remarks (optional)</span>
                  <Textarea
                    placeholder="Notes for your records…"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={3}
                  />
                </div>
              )}
            </div>
          )}

          {tab === "pending" ? (
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => void handleAction("reject")}
                disabled={actionLoading}
                className="flex-1"
              >
                <XCircle size={16} className="mr-2" /> Reject
              </Button>
              <Button
                onClick={() => void handleAction("approve")}
                disabled={actionLoading}
                className="flex-1 text-white"
                style={{ background: "var(--brand)" }}
              >
                <CheckCircle2 size={16} className="mr-2" /> Approve
              </Button>
            </DialogFooter>
          ) : (
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDialogOpen(false)} type="button">
                Close
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={bookingDialogOpen} onOpenChange={setBookingDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review booking request</DialogTitle>
            <DialogDescription>
              Client-submitted job under request-and-approve booking. Approve to add it to your schedule, or reject to
              cancel it for the client.
            </DialogDescription>
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
