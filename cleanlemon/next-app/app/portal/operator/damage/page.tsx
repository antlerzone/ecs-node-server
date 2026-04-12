"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Eye, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { useAuth } from "@/lib/auth-context"
import { useEffectiveOperatorId } from "@/lib/cleanlemon-effective-operator-id"
import { fetchOperatorDamageReports, type DamageReportItem } from "@/lib/cleanlemon-api"
import { DamageMediaAttachments } from "@/components/shared/damage-media-attachments"

function formatWhen(r: DamageReportItem): string {
  const parts: string[] = []
  if (r.jobDate) parts.push(r.jobDate)
  if (r.jobStartTime) parts.push(r.jobStartTime)
  if (r.reportedAt) {
    const d = new Date(r.reportedAt)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`Reported ${d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`)
    }
  }
  return parts.length ? parts.join(" · ") : "—"
}

export default function OperatorDamagePage() {
  const { user } = useAuth()
  const operatorId = useEffectiveOperatorId(user)
  const [items, setItems] = useState<DamageReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<DamageReportItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetchOperatorDamageReports({ operatorId: operatorId || undefined, limit: 500 })
      if (r?.ok && Array.isArray(r.items)) setItems(r.items)
      else setItems([])
    } finally {
      setLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
            Damage reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Staff-submitted damage from jobs (property + schedule). Open a row to preview photos and remarks.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/operator">Back to dashboard</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All reports</CardTitle>
          <CardDescription>Property, client, who submitted, and when.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No damage reports yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Submit by</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead className="w-[100px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.propertyName}
                        {r.unitNumber ? (
                          <span className="text-muted-foreground font-normal"> · {r.unitNumber}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{r.clientName || "—"}</TableCell>
                      <TableCell className="text-sm">{r.staffEmail || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatWhen(r)}
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => setPreview(r)}>
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
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
                <span className="text-muted-foreground">Client: </span>
                {preview.clientName || "—"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Submit by: </span>
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
