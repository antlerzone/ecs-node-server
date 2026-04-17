"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getOperatorTransactions } from "@/lib/operator-api"

type TxRow = {
  id: string
  provider: string
  status: string
  paymentStatus?: string
  settlementStatus?: string
  payoutStatus?: string
  currency: string
  grossAmount: number
  processingFee: number
  createdAt: string
  estimatePayoutAt?: string | null
  estimateReceiveAt?: string | null
  receivedAt?: string | null
  payoutAt?: string | null
  accountingJournalId?: string | null
  transactionId: string
  referenceNumber: string
  payBy: string
  details?: { tenantName?: string; propertyName?: string; roomName?: string; tenancyId?: string }
  invoice?: { source?: string; recordId?: string; invoiceId?: string }
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

function formatMoney(currency: string, value: number) {
  const c = String(currency || "").toUpperCase()
  const symbol = c === "MYR" ? "RM" : c === "SGD" ? "S$" : c ? `${c} ` : ""
  const n = Number(value || 0)
  return `${symbol} ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDateTime(dt: unknown) {
  if (!dt) return "—"
  const t = new Date(String(dt))
  if (Number.isNaN(t.getTime())) return "—"
  return t.toLocaleString("en-MY", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function statusBadge(status: string) {
  const s = String(status || "").toLowerCase()
  if (s === "failed") return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Failed</Badge>
  if (s === "received") return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Received</Badge>
  if (s === "paid") return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Payout done</Badge>
  return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Pending MDR</Badge>
}

export default function OperatorTransactionPage() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<TxRow[]>([])
  const [total, setTotal] = useState(0)
  const [showDetail, setShowDetail] = useState(false)
  const [selected, setSelected] = useState<TxRow | null>(null)

  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<"all" | "pending" | "settlement">("all")
  const [sort, setSort] = useState<"date_desc" | "date_asc" | "amount_desc" | "amount_asc">("date_desc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getOperatorTransactions({
        provider: "xendit",
        status,
        search,
        sort,
        page,
        pageSize,
      })
      const items = Array.isArray(res?.items) ? (res.items as TxRow[]) : []
      setRows(items)
      setTotal(Number(res?.total ?? 0) || 0)
    } catch (e) {
      console.error("[operator/transaction] load", e)
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [status, search, sort, page, pageSize])

  useEffect(() => { load() }, [load])

  return (
    <main className="p-3 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Transactions</h1>
        <p className="text-sm text-muted-foreground">Tenant payments recorded in the system. Settlement to sub-account happens after MDR is confirmed.</p>
      </div>

      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search payment id / reference / tenant..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v as any); setPage(1) }}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending MDR</SelectItem>
              <SelectItem value="settlement">Settlement</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => { setSort(v as any); setPage(1) }}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">Latest</SelectItem>
              <SelectItem value="date_asc">Oldest</SelectItem>
              <SelectItem value="amount_desc">Amount (High)</SelectItem>
              <SelectItem value="amount_asc">Amount (Low)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Pay by</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Date & time</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Transaction ID</th>
                  <th className="text-right p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Amount</th>
                  <th className="text-right p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Processing fee</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Estimate payout date</th>
                  <th className="text-right p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">Loading...</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">No transactions</td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-b border-border hover:bg-secondary/20">
                      <td className="p-4">
                        {r.paymentStatus === "failed"
                          ? statusBadge("failed")
                          : (r.payoutStatus === "paid"
                            ? statusBadge("paid")
                            : (r.settlementStatus === "received" ? statusBadge("received") : statusBadge("pending")))}
                      </td>
                      <td className="p-4 text-sm font-medium">{r.payBy || r.details?.tenantName || "—"}</td>
                      <td className="p-4 text-sm text-muted-foreground">{fmtDateTime(r.createdAt)}</td>
                      <td className="p-4 font-mono text-xs break-all">{r.transactionId || r.referenceNumber}</td>
                      <td className="p-4 text-right font-semibold">{formatMoney(r.currency, r.grossAmount)}</td>
                      <td className="p-4 text-right text-muted-foreground">{formatMoney(r.currency, r.processingFee)}</td>
                      <td className="p-4 text-sm">
                        {r.estimateReceiveAt ? fmtDateTime(r.estimateReceiveAt) : (r.estimatePayoutAt ? fmtDateTime(r.estimatePayoutAt) : "—")}
                      </td>
                      <td className="p-4 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setSelected(r); setShowDetail(true) }}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Per page</Label>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => { setPageSize(Number(v) as any); setPage(1) }}
                  >
                    <SelectTrigger className="w-20 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  Previous
                </Button>
                <span className="px-2 text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDetail} onOpenChange={(open) => { setShowDetail(open); if (!open) setSelected(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Transaction</DialogTitle>
            <DialogDescription>See which invoice was paid and settlement timeline.</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Payment status</p>
                  <div>
                    {selected.paymentStatus === "failed"
                      ? <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Failed</Badge>
                      : selected.paymentStatus === "complete"
                        ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Complete</Badge>
                        : <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Pending</Badge>}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Settlement status</p>
                  <div>
                    {selected.settlementStatus === "received"
                      ? <Badge variant="outline">Received on {selected.receivedAt ? fmtDateTime(selected.receivedAt) : "—"}</Badge>
                      : <Badge variant="outline">Pending (est. {selected.estimateReceiveAt ? fmtDateTime(selected.estimateReceiveAt) : "—"})</Badge>}
                  </div>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Transaction ID</p>
                  <p className="font-mono text-xs break-all select-all">{selected.transactionId || selected.referenceNumber}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Paid by</p>
                  <p className="text-sm font-semibold">{selected.payBy || selected.details?.tenantName || "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      selected.details?.propertyName ? `Property: ${selected.details.propertyName}` : "",
                      selected.details?.roomName ? `Room: ${selected.details.roomName}` : "",
                    ].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-secondary/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Amount</p>
                    <p className="text-lg font-bold">{formatMoney(selected.currency, selected.grossAmount)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Processing fee</p>
                    <p className="text-sm font-semibold text-muted-foreground">{formatMoney(selected.currency, selected.processingFee)}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Paid invoice</p>
                <p className="text-sm">
                  {selected.invoice?.source ? `${selected.invoice.source}` : "—"}
                  {selected.invoice?.recordId ? ` · record: ${selected.invoice.recordId}` : ""}
                  {selected.invoice?.invoiceId ? ` · invoice: ${selected.invoice.invoiceId}` : ""}
                </p>
                <div className="text-xs text-muted-foreground">
                  Tip: open Tenant Invoice page and search by this transaction id / invoice id.
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Payout to bank</p>
                {selected.payoutStatus === "paid"
                  ? <Badge variant="outline">Payout on {selected.payoutAt ? fmtDateTime(selected.payoutAt) : "—"}</Badge>
                  : <Badge variant="outline">Pending</Badge>}
                {selected.accountingJournalId
                  ? <p className="text-xs text-muted-foreground mt-1">Accounting journal: <span className="font-mono">{selected.accountingJournalId}</span></p>
                  : null}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetail(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

