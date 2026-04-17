"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Loader2, AlertTriangle, CheckCircle2, Eye, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/lib/auth-context"
import {
  fetchClientDamageReports,
  acknowledgeClientDamageReport,
  type DamageReportItem,
} from "@/lib/cleanlemon-api"
import { toast } from "sonner"
import { DamageMediaAttachments } from "@/components/shared/damage-media-attachments"

function formatWhen(r: DamageReportItem): string {
  const parts: string[] = []
  if (r.jobDate) parts.push(r.jobDate)
  if (r.jobStartTime) parts.push(`Start ${r.jobStartTime}`)
  if (r.reportedAt) {
    const d = new Date(r.reportedAt)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`Reported ${d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`)
    }
  }
  return parts.length ? parts.join(" · ") : "—"
}

/** YYYY-MM-DD for date filters — job date first, else reported day (Malaysia display uses row as-is). */
function reportSortYmd(r: DamageReportItem): string {
  const jd = (r.jobDate || "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(jd)) return jd.slice(0, 10)
  if (r.reportedAt) {
    const d = new Date(r.reportedAt)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  return ""
}

function propertyLabel(r: DamageReportItem): string {
  const u = r.unitNumber ? ` · ${r.unitNumber}` : ""
  return `${r.propertyName || "—"}${u}`
}

/** Row label — Pending vs Acknowledged; Complete is the same case in DB (filter “Complete” lists these too). */
function damageStatusLabel(r: DamageReportItem): "Pending" | "Acknowledged" {
  if (!r.acknowledgedAt) return "Pending"
  return "Acknowledged"
}

export default function ClientDamagePage() {
  const { user } = useAuth()
  const operatorId = String(user?.operatorId || "").trim()
  const [items, setItems] = useState<DamageReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [preview, setPreview] = useState<DamageReportItem | null>(null)

  const [search, setSearch] = useState("")
  const [operatorFilter, setOperatorFilter] = useState("all")
  const [propertyFilter, setPropertyFilter] = useState("all")
  /** DB only has client ack time — "Acknowledged" and "Complete" filters both match acknowledged rows. */
  const [ackFilter, setAckFilter] = useState<"all" | "pending" | "acknowledged" | "complete">("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetchClientDamageReports({ operatorId: operatorId || undefined, limit: 500 })
      if (r?.ok && Array.isArray(r.items)) setItems(r.items)
      else setItems([])
    } finally {
      setLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    void load()
  }, [load])

  const operatorOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of items) {
      const id = String(x.operatorId || "").trim()
      if (!id) continue
      const name = String(x.operatorName || "").trim() || id
      m.set(id, name)
    }
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [items])

  const propertyOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of items) {
      const key = String(x.propertyId || "").trim() || propertyLabel(x)
      const label = propertyLabel(x)
      m.set(key, label)
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [items])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((r) => {
      const acked = !!r.acknowledgedAt
      if (ackFilter === "pending" && acked) return false
      if ((ackFilter === "acknowledged" || ackFilter === "complete") && !acked) return false
      if (operatorFilter !== "all" && String(r.operatorId || "").trim() !== operatorFilter) return false
      if (propertyFilter !== "all") {
        const key = String(r.propertyId || "").trim() || propertyLabel(r)
        if (key !== propertyFilter) return false
      }
      const ymd = reportSortYmd(r)
      if (dateFrom && ymd && ymd < dateFrom) return false
      if (dateTo && ymd && ymd > dateTo) return false
      if ((dateFrom || dateTo) && !ymd) return false
      if (!q) return true
      const hay = [
        r.propertyName,
        r.unitNumber,
        r.operatorName,
        r.staffEmail,
        r.remark,
        formatWhen(r),
      ]
        .join(" ")
        .toLowerCase()
      return hay.includes(q)
    })
  }, [items, search, operatorFilter, propertyFilter, ackFilter, dateFrom, dateTo])

  const onAck = async (id: string) => {
    if (!operatorId) {
      toast.error("Missing operator context.")
      return
    }
    setBusyId(id)
    try {
      const r = await acknowledgeClientDamageReport(id, { operatorId })
      if (!r?.ok) {
        toast.error(r?.reason || "Acknowledge failed")
        return
      }
      toast.success(r.alreadyAcknowledged ? "Already acknowledged" : "Acknowledged")
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
            Damage reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Reports from your operator&apos;s staff. Acknowledge when you have noted the issue.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/client">Back to dashboard</Link>
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search property, staff, remark, operator…"
              className="border-input pl-9"
              disabled={loading}
            />
          </div>
          <Select value={operatorFilter} onValueChange={setOperatorFilter} disabled={loading}>
            <SelectTrigger className="w-full border-input lg:w-[200px]">
              <SelectValue placeholder="Operator" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All operators</SelectItem>
              {operatorOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={propertyFilter} onValueChange={setPropertyFilter} disabled={loading}>
            <SelectTrigger className="w-full border-input lg:w-[240px]">
              <SelectValue placeholder="Property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              {propertyOptions.map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label.length > 42 ? `${label.slice(0, 42)}…` : label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={ackFilter}
            onValueChange={(v) =>
              setAckFilter(v as "all" | "pending" | "acknowledged" | "complete")
            }
            disabled={loading}
          >
            <SelectTrigger className="w-full border-input lg:w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Date from</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value.slice(0, 10))}
              className="w-full border-input sm:w-[160px]"
              disabled={loading}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Date to</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value.slice(0, 10))}
              className="w-full border-input sm:w-[160px]"
              disabled={loading}
            />
          </div>
          {(dateFrom || dateTo) && (
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setDateFrom(""); setDateTo("") }}>
              Clear dates
            </Button>
          )}
        </div>
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Your properties</CardTitle>
          <CardDescription>Operator name, staff, and time of report.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              {items.length === 0 ? "No damage reports yet." : "No reports match your filters."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Submit by (staff)</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Remark</TableHead>
                    <TableHead className="w-[90px]">View</TableHead>
                    <TableHead className="w-[140px]">Acknowledge</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((r) => {
                    const acked = !!r.acknowledgedAt
                    const statusLabel = damageStatusLabel(r)
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.propertyName}
                          {r.unitNumber ? (
                            <span className="text-muted-foreground font-normal"> · {r.unitNumber}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              statusLabel === "Pending"
                                ? "border-amber-300 bg-amber-50 text-amber-900"
                                : "border-emerald-300 bg-emerald-50 text-emerald-900"
                            }
                          >
                            {statusLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{r.operatorName || "—"}</TableCell>
                        <TableCell className="text-sm">{r.staffEmail || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap max-w-[220px]">
                          {formatWhen(r)}
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate" title={r.remark}>
                          {r.remark || "—"}
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => setPreview(r)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                        <TableCell>
                          {acked ? (
                            <span className="inline-flex items-center gap-1 text-sm text-green-700">
                              <CheckCircle2 className="h-4 w-4" />
                              Acknowledged
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              disabled={busyId === r.id}
                              onClick={() => onAck(r.id)}
                            >
                              {busyId === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Acknowledge"
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Damage detail</DialogTitle>
            <DialogDescription>
              {preview?.propertyName}
              {preview?.unitNumber ? ` · ${preview.unitNumber}` : ""}
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Operator: </span>
                {preview.operatorName || "—"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Staff: </span>
                {preview.staffEmail || "—"}
              </p>
              <p className="text-sm text-muted-foreground">{formatWhen(preview)}</p>
              <div>
                <p className="text-sm font-medium mb-1">Remark</p>
                <p className="text-sm whitespace-pre-wrap rounded-md bg-muted/50 p-3">{preview.remark || "—"}</p>
              </div>
              <DamageMediaAttachments urls={preview.photoUrls} emptyLabel="No photos or videos." />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
