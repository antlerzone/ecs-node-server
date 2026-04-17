"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Download, TrendingUp, TrendingDown, Banknote, Receipt, Wallet, MoreHorizontal, FileText, ScrollText } from "lucide-react"
import { loadCmsData, getOwnerPayoutList, exportOwnerReportPdf } from "@/lib/owner-api"
import { getMalaysiaFirstDayOfYearYmd, getTodayMalaysiaYmd } from "@/lib/dateMalaysia"
import { portalHttpsAssetUrl, toDrivePreviewUrl } from "@/lib/utils"

interface PayoutItem {
  id?: string
  propertyName?: string
  period?: string
  totalrental?: number
  totalutility?: number
  totalcollection?: number
  expenses?: number
  netpayout?: number
  monthlyreport?: string
  paymentDate?: string | null
  /** Bukku management fee invoice URL (after operator marks paid with accounting) */
  bukkuinvoice?: string | null
  /** Bukku owner payout bill URL */
  bukkubills?: string | null
}

function formatRM(value: number | string) {
  const n = Number(value) || 0
  return `RM ${n.toLocaleString("en-MY")}`
}

function netPayoutClass(value: number | string | undefined) {
  const n = Number(value ?? 0)
  if (n < 0) return "text-red-600"
  if (n > 0) return "text-emerald-600"
  return "text-foreground"
}

function formatPeriod(period: string) {
  if (!period) return "-"
  const s = String(period).substring(0, 10)
  const iso = s.length <= 7 ? `${s}-01` : s
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+08:00`) : new Date(period)
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-US", { timeZone: "Asia/Kuala_Lumpur", month: "long", year: "numeric" })
}

function formatPaidDate(dateVal?: string | null) {
  if (!dateVal) return "-"
  const s = String(dateVal).slice(0, 10)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00+08:00`) : new Date(dateVal)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Kuala_Lumpur" })
}

function normalizeHttpUrl(url?: string | null) {
  const u = String(url || "").trim()
  return /^https?:\/\//i.test(u) ? u : ""
}

function isBukkuBillsUrl(url?: string | null) {
  const u = normalizeHttpUrl(url)
  if (!u) return false
  return /bukku\.my/i.test(u)
}

export default function OwnerReportPage() {
  const ecsBase = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
  const toPreviewUrl = (url: string | null | undefined) => toDrivePreviewUrl(portalHttpsAssetUrl(url, ecsBase))

  const [properties, setProperties] = useState<{ _id: string; shortname?: string }[]>([])
  const [reportData, setReportData] = useState<PayoutItem[]>([])
  const [selectedProperty, setSelectedProperty] = useState("all")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isExporting, setIsExporting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setStartDate(getMalaysiaFirstDayOfYearYmd())
    setEndDate(getTodayMalaysiaYmd())
  }, [])

  useEffect(() => {
    let cancelled = false
    async function init() {
      const data = await loadCmsData()
      if (!data.ok || !data.owner) return
      const props = (data.properties as { _id: string; shortname?: string }[]) || []
      setProperties(props)
      setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!startDate || !endDate) return
    let cancelled = false
    getOwnerPayoutList({ propertyId: selectedProperty === "all" ? undefined : selectedProperty, startDate, endDate }).then((res) => {
      if (res.ok && res.items && !cancelled) {
        const items = (res.items as PayoutItem[]).map((i) => ({
          id: (i as { _id?: string; id?: string })._id ?? (i as { id?: string }).id,
          propertyName: (i as { propertyName?: string }).propertyName,
          period: i.period,
          totalrental: i.totalrental,
          totalutility: i.totalutility,
          totalcollection: i.totalcollection,
          expenses: i.expenses,
          netpayout: i.netpayout,
          monthlyreport: i.monthlyreport,
          paymentDate: (i as { paymentDate?: string | null }).paymentDate ?? null,
          bukkuinvoice: (i as { bukkuinvoice?: string | null }).bukkuinvoice ?? null,
          bukkubills: (i as { bukkubills?: string | null }).bukkubills ?? null,
        }))
        items.sort((a, b) => new Date(String(b.period || "")).getTime() - new Date(String(a.period || "")).getTime())
        setReportData(items)
      }
    })
    return () => { cancelled = true }
  }, [selectedProperty, startDate, endDate])

  const totals = reportData.reduce(
    (acc, item) => ({
      totalRental: acc.totalRental + Number(item.totalrental || 0),
      totalUtility: acc.totalUtility + Number(item.totalutility || 0),
      totalCollection: acc.totalCollection + Number(item.totalcollection || 0),
      expenses: acc.expenses + Number(item.expenses || 0),
      netPayout: acc.netPayout + Number(item.netpayout || 0),
    }),
    { totalRental: 0, totalUtility: 0, totalCollection: 0, expenses: 0, netPayout: 0 }
  )

  const handleExportPdf = async () => {
    if (!startDate || !endDate) return
    setIsExporting(true)
    try {
      const res = await exportOwnerReportPdf({ propertyId: selectedProperty === "all" ? undefined : selectedProperty, startDate, endDate })
      if (res.ok && res.downloadUrl) window.open(toPreviewUrl(res.downloadUrl), "_blank", "noopener,noreferrer")
    } finally {
      setIsExporting(false)
    }
  }

  const handlePreviewReportForRow = (item: PayoutItem) => {
    const u = item.monthlyreport?.trim()
    if (u && /^https?:\/\//i.test(u)) {
      window.open(toPreviewUrl(u), "_blank", "noopener,noreferrer")
      return
    }
    alert("No report file URL yet. Your operator can upload the monthly report PDF after generation.")
  }

  const openAccountingUrl = (url: string | null | undefined, missingMsg: string) => {
    const u = url?.trim()
    if (u && /^https?:\/\//i.test(u)) {
      window.open(u, "_blank", "noopener,noreferrer")
      return
    }
    alert(missingMsg)
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Owner Report</h1>
        <p className="text-muted-foreground">View your rental income and payout reports.</p>
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
              <SelectItem value="all">All Properties</SelectItem>
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
            {isExporting ? "Preparing..." : "Preview PDF"}
          </Button>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-blue-100 p-2">
                <Banknote className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Total Rental</p>
                <p className="text-xl font-bold whitespace-nowrap">{formatRM(totals.totalRental)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-yellow-100 p-2">
                <TrendingUp className="h-5 w-5 text-yellow-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Utility</p>
                <p className="text-base font-bold whitespace-nowrap">{formatRM(totals.totalUtility)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-green-100 p-2">
                <Receipt className="h-5 w-5 text-green-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Gross Collection</p>
                <p className="text-xl font-bold whitespace-nowrap">{formatRM(totals.totalCollection)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-red-100 p-2">
                <TrendingDown className="h-5 w-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Expenses</p>
                <p className="text-base font-bold whitespace-nowrap">{formatRM(totals.expenses)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[var(--brand)] text-white">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-white/20 p-2">
                <Wallet className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-white/80">Net Payout</p>
                <p className="text-xl font-bold whitespace-nowrap">{formatRM(totals.netPayout)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Report Table */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Period</th>
                  <th className="p-3 text-left font-medium">Property</th>
                  <th className="p-3 text-right font-medium">Rental</th>
                  <th className="p-3 text-right font-medium">Utility</th>
                  <th className="p-3 text-right font-medium">Gross</th>
                  <th className="p-3 text-right font-medium">Expenses</th>
                  <th className="p-3 text-right font-medium">Net Payout</th>
                  <th className="p-3 text-center font-medium">Paid Date</th>
                  <th className="p-3 text-center font-medium">Report</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map((item) => (
                  (() => {
                    const invoiceUrl = normalizeHttpUrl(item.bukkuinvoice)
                    const billsUrl = normalizeHttpUrl(item.bukkubills)
                    const showInvoiceAction = !!invoiceUrl
                    // Owner portal only shows bills download for Bukku flow.
                    const showBillsAction = !!billsUrl && isBukkuBillsUrl(billsUrl)
                    return (
                  <tr key={item.id || item.period || ""} className="border-b">
                    <td className="p-3 font-medium">{formatPeriod(item.period || "")}</td>
                    <td className="p-3">{item.propertyName || "-"}</td>
                    <td className="p-3 text-right">{formatRM(item.totalrental)}</td>
                    <td className="p-3 text-right">{formatRM(item.totalutility)}</td>
                    <td className="p-3 text-right">{formatRM(item.totalcollection)}</td>
                    <td className="p-3 text-right text-red-600">{formatRM(item.expenses)}</td>
                    <td className={`p-3 text-right font-medium ${netPayoutClass(item.netpayout)}`}>
                      {formatRM(item.netpayout)}
                    </td>
                    <td className="p-3 text-center">{formatPaidDate(item.paymentDate)}</td>
                    <td className="p-3 text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 px-2"
                            aria-label="Download options"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handlePreviewReportForRow(item)}>
                            <FileText className="h-4 w-4 mr-2" /> Preview report
                          </DropdownMenuItem>
                          {showInvoiceAction && (
                            <DropdownMenuItem onClick={() => openAccountingUrl(invoiceUrl, "No invoice link yet.")}>
                              <Receipt className="h-4 w-4 mr-2" /> Download invoice
                            </DropdownMenuItem>
                          )}
                          {showBillsAction && (
                            <DropdownMenuItem onClick={() => openAccountingUrl(billsUrl, "No bills link yet.")}>
                              <ScrollText className="h-4 w-4 mr-2" /> Download bills
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                    )
                  })()
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
