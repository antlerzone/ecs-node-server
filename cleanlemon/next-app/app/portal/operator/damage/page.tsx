"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Eye, Loader2, AlertTriangle, Search, Download, ListFilter, ChevronLeft, ChevronRight } from "lucide-react"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { Button } from "@/components/ui/button"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/lib/auth-context"
import { useEffectiveOperatorId } from "@/lib/cleanlemon-effective-operator-id"
import { fetchOperatorDamageReports, type DamageReportItem } from "@/lib/cleanlemon-api"
import { damageReportDateYmd, damageReportDateLabel } from "@/lib/damage-report-dates"
import { DamageMediaAttachments } from "@/components/shared/damage-media-attachments"
import { toast } from "sonner"

function propertyLabel(r: DamageReportItem): string {
  const u = r.unitNumber ? ` · ${r.unitNumber}` : ""
  return `${r.propertyName || "—"}${u}`
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200] as const

export default function OperatorDamagePage() {
  const { user } = useAuth()
  const operatorId = useEffectiveOperatorId(user)
  const [items, setItems] = useState<DamageReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<DamageReportItem | null>(null)

  const [search, setSearch] = useState("")
  const [propertyFilter, setPropertyFilter] = useState("all")
  const [ackFilter, setAckFilter] = useState<"all" | "pending" | "acknowledged" | "complete">("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [pageSize, setPageSize] = useState(20)
  const [currentPage, setCurrentPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetchOperatorDamageReports({ operatorId: operatorId || undefined, limit: 1000 })
      if (r?.ok && Array.isArray(r.items)) setItems(r.items)
      else setItems([])
    } finally {
      setLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    void load()
  }, [load])

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
      if (propertyFilter !== "all") {
        const key = String(r.propertyId || "").trim() || propertyLabel(r)
        if (key !== propertyFilter) return false
      }
      const ymd = damageReportDateYmd(r)
      if (dateFrom && ymd && ymd < dateFrom) return false
      if (dateTo && ymd && ymd > dateTo) return false
      if ((dateFrom || dateTo) && !ymd) return false
      if (!q) return true
      const hay = [
        r.propertyName,
        r.unitNumber,
        r.clientName,
        r.staffEmail,
        r.remark,
        damageReportDateLabel(r),
      ]
        .join(" ")
        .toLowerCase()
      return hay.includes(q)
    })
  }, [items, search, propertyFilter, ackFilter, dateFrom, dateTo])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, propertyFilter, ackFilter, dateFrom, dateTo])

  const totalPages = useMemo(
    () => (filteredItems.length === 0 ? 1 : Math.max(1, Math.ceil(filteredItems.length / pageSize))),
    [filteredItems.length, pageSize]
  )

  useEffect(() => {
    if (totalPages < 1) return
    setCurrentPage((p) => (p > totalPages ? totalPages : p))
  }, [totalPages])

  const paginatedItems = useMemo(
    () => filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredItems, currentPage, pageSize]
  )

  const hasActiveFilters = useMemo(() => {
    return propertyFilter !== "all" || ackFilter !== "all" || Boolean(dateFrom) || Boolean(dateTo)
  }, [propertyFilter, ackFilter, dateFrom, dateTo])

  const exportFileStem = useMemo(() => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `damage-reports-${y}${m}${day}`
  }, [])

  const rowToExportCells = useCallback((r: DamageReportItem) => {
    return {
      property: r.propertyName || "—",
      unit: r.unitNumber || "",
      client: r.clientName || "—",
      staff: r.staffEmail || "—",
      when: damageReportDateLabel(r),
      remark: (r.remark || "").replace(/\r?\n/g, " "),
    }
  }, [])

  const escapeCsvCell = (s: string) => {
    const t = String(s)
    if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`
    return t
  }

  const exportCsv = useCallback(() => {
    if (filteredItems.length === 0) {
      toast.error("No rows to export.")
      return
    }
    const header = ["Property", "Unit", "Client", "Staff email", "When", "Remark"]
    const lines = [header.join(",")]
    for (const r of filteredItems) {
      const c = rowToExportCells(r)
      lines.push(
        [
          escapeCsvCell(c.property),
          escapeCsvCell(c.unit),
          escapeCsvCell(c.client),
          escapeCsvCell(c.staff),
          escapeCsvCell(c.when),
          escapeCsvCell(c.remark),
        ].join(",")
      )
    }
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${exportFileStem}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("CSV downloaded.")
  }, [filteredItems, exportFileStem, rowToExportCells])

  const exportPdf = useCallback(() => {
    if (filteredItems.length === 0) {
      toast.error("No rows to export.")
      return
    }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
    doc.setFontSize(11)
    doc.text("Damage reports (filtered)", 8, 10)
    const body = filteredItems.map((r) => {
      const c = rowToExportCells(r)
      return [c.property, c.unit || "—", c.client, c.staff, c.when, c.remark]
    })
    autoTable(doc, {
      startY: 14,
      head: [["Property", "Unit", "Client", "Staff", "When", "Remark"]],
      body,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 64, 175] },
      columnStyles: {
        0: { cellWidth: 42 },
        1: { cellWidth: 20 },
        2: { cellWidth: 36 },
        3: { cellWidth: 40 },
        4: { cellWidth: 44 },
        5: { cellWidth: "auto" },
      },
      margin: { left: 8, right: 8 },
    })
    doc.save(`${exportFileStem}.pdf`)
    toast.success("PDF downloaded.")
  }, [filteredItems, exportFileStem, rowToExportCells])

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
            Damage reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Staff reports from jobs (schedule + property) plus older imported rows for properties under your
            company. Open a row to preview photos and remarks.
          </p>
        </div>
        <div className="hidden shrink-0 md:block">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0" disabled={loading}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportPdf}>Export as PDF</DropdownMenuItem>
              <DropdownMenuItem onClick={exportCsv}>Export as CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search property, client, staff, remark…"
              className="border-input pl-9"
              disabled={loading}
            />
          </div>
          <Button
            type="button"
            variant={filterExpanded ? "secondary" : "outline"}
            className="shrink-0"
            disabled={loading}
            onClick={() => setFilterExpanded((v) => !v)}
            aria-expanded={filterExpanded}
          >
            <ListFilter className="h-4 w-4 mr-2" />
            Filter
            {hasActiveFilters ? (
              <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-primary" aria-hidden />
            ) : null}
          </Button>
        </div>

        {filterExpanded ? (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
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
                  <SelectValue placeholder="Client acknowledge" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Not acknowledged</SelectItem>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setDateFrom("")
                    setDateTo("")
                  }}
                >
                  Clear dates
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>All reports</CardTitle>
          <CardDescription>Property, client, who submitted, and when.</CardDescription>
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
                    <TableHead>Client</TableHead>
                    <TableHead>Submit by</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Remark</TableHead>
                    <TableHead className="w-[90px]">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedItems.map((r) => {
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.propertyName}
                          {r.unitNumber ? (
                            <span className="text-muted-foreground font-normal"> · {r.unitNumber}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>{r.clientName || "—"}</TableCell>
                        <TableCell className="text-sm">{r.staffEmail || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap max-w-[220px]">
                          {damageReportDateLabel(r)}
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate" title={r.remark}>
                          {r.remark || "—"}
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => setPreview(r)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {!loading && filteredItems.length > 0 ? (
            <div className="flex shrink-0 flex-col gap-3 border-t border-border pt-4 mt-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-muted-foreground order-2 lg:order-1">
                  Showing {(currentPage - 1) * pageSize + 1} to{" "}
                  {Math.min(currentPage * pageSize, filteredItems.length)} of {filteredItems.length} results
                </p>
                <div className="order-1 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:order-2">
                  <div className="flex items-center justify-center gap-2 sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1 || totalPages <= 1}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-[7rem] text-center text-sm tabular-nums">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages || totalPages <= 1}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
                    <Label htmlFor="operator-damage-page-size" className="text-sm text-muted-foreground whitespace-nowrap">
                      Show
                    </Label>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => {
                        const n = Number(v)
                        if (PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number])) {
                          setPageSize(n)
                          setCurrentPage(1)
                        }
                      }}
                    >
                      <SelectTrigger id="operator-damage-page-size" className="h-9 w-[100px] border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground whitespace-nowrap">per page</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
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
                <span className="text-muted-foreground">Client: </span>
                {preview.clientName || "—"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Submit by: </span>
                {preview.staffEmail || "—"}
              </p>
              <p className="text-sm text-muted-foreground">{damageReportDateLabel(preview)}</p>
              <div>
                <p className="text-sm font-medium mb-1">Remark</p>
                <p className="text-sm whitespace-pre-wrap rounded-md bg-muted/50 p-3">{preview.remark || "—"}</p>
              </div>
              <DamageMediaAttachments
                urls={preview.photoUrls}
                attachments={preview.photoAttachments}
                emptyLabel="No photos or videos."
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
