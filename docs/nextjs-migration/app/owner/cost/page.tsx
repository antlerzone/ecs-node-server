"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Download, Receipt, ChevronLeft, ChevronRight } from "lucide-react"
import { loadCmsData, getCostList, exportCostPdf } from "@/lib/owner-api"
import { getMalaysiaFirstDayOfYearYmd, getTodayMalaysiaYmd } from "@/lib/dateMalaysia"

interface CostItem {
  listingTitle?: string
  property?: { shortname?: string }
  period?: string | Date
  amount?: number
  description?: string
  bukkuurl?: string
}

const COST_PER_PAGE = 10

function formatRM(value: number | string) {
  const n = Number(value) || 0
  return `RM ${n.toLocaleString("en-MY")}`
}

function formatPeriod(period: string | Date | undefined) {
  if (!period) return "-"
  if (typeof period === "string") {
    const ymd = (period.length <= 7 ? `${period}-01` : period).slice(0, 10)
    const d = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(`${ymd}T12:00:00+08:00`) : new Date(period)
    return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-US", { timeZone: "Asia/Kuala_Lumpur", month: "short", year: "numeric" })
  }
  const d = period
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-US", { timeZone: "Asia/Kuala_Lumpur", month: "short", year: "numeric" })
}

export default function OwnerCostPage() {
  const [properties, setProperties] = useState<{ _id: string; shortname?: string }[]>([])
  const [costData, setCostData] = useState<CostItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [selectedProperty, setSelectedProperty] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [isExporting, setIsExporting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setStartDate(getMalaysiaFirstDayOfYearYmd())
    setEndDate(getTodayMalaysiaYmd())
  }, [])

  useEffect(() => {
    loadCmsData().then((data) => {
      if (data.ok && data.properties) {
        const props = data.properties as { _id: string; shortname?: string }[]
        setProperties(props)
        if (props[0]) setSelectedProperty(props[0]._id)
      }
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!selectedProperty || !startDate || !endDate) return
    const skip = (currentPage - 1) * COST_PER_PAGE
    getCostList({ propertyId: selectedProperty, startDate, endDate, skip, limit: COST_PER_PAGE }).then((res) => {
      if (res.ok) {
        setCostData((res.items as CostItem[]) || [])
        setTotalCount(res.totalCount ?? 0)
      }
    })
  }, [selectedProperty, startDate, endDate, currentPage])

  const totalPages = Math.max(1, Math.ceil(totalCount / COST_PER_PAGE))
  const totalCost = costData.reduce((sum, item) => sum + Number(item.amount || 0), 0)

  const handleExportPdf = async () => {
    if (!selectedProperty || !startDate || !endDate) return
    setIsExporting(true)
    try {
      const res = await exportCostPdf({ propertyId: selectedProperty, startDate, endDate })
      if (res.ok && res.downloadUrl) window.location.href = res.downloadUrl
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Cost Report</h1>
        <p className="text-muted-foreground">View expenses and maintenance costs for your properties.</p>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="w-full sm:w-48 min-w-0">
            <Label className="mb-2 block">Property</Label>
            <Select value={selectedProperty || undefined} onValueChange={setSelectedProperty}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select Property" />
              </SelectTrigger>
              <SelectContent>
              {properties.map((prop) => (
                <SelectItem key={prop._id} value={prop._id}>
                  {prop.shortname || "Unnamed"}
                </SelectItem>
              ))}
            </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-auto">
            <Label className="mb-2 block">Start Date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="w-full sm:w-auto">
            <Label className="mb-2 block">End Date</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <Button onClick={handleExportPdf} disabled={isExporting} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Exporting..." : "Export PDF"}
          </Button>
        </CardContent>
      </Card>

      {/* Summary Card */}
      <Card className="mb-6 bg-[var(--brand)] text-white">
        <CardContent className="flex items-center justify-between py-6">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-white/20 p-3">
              <Receipt className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-white/80">Total Costs</p>
              <p className="text-2xl font-bold">{formatRM(totalCost)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-white/80">{totalCount} items</p>
          </div>
        </CardContent>
      </Card>

      {/* Cost Table */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Property</th>
                  <th className="p-3 text-left font-medium">Period</th>
                  <th className="p-3 text-left font-medium">Description</th>
                  <th className="p-3 text-right font-medium">Amount</th>
                  <th className="p-3 text-center font-medium">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {costData.map((item, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="p-3">{item.listingTitle || item.property?.shortname || "-"}</td>
                    <td className="p-3">{item.period ? formatPeriod(item.period) : "-"}</td>
                    <td className="p-3">{item.description || "-"}</td>
                    <td className="p-3 text-right font-medium text-red-600">{formatRM(item.amount)}</td>
                    <td className="p-3 text-center">
                      {item.bukkuurl ? (
                        <a href={item.bukkuurl} target="_blank" rel="noreferrer">
                          <Button variant="ghost" size="sm">
                            <Download className="h-4 w-4" />
                          </Button>
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {costData.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Receipt className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-medium">No costs found</h3>
              <p className="text-sm text-muted-foreground">
                No expense records for the selected period.
              </p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
