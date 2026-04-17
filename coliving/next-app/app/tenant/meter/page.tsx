"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { Zap, DollarSign, Plus, Calendar, Download, TrendingUp, TrendingDown, CheckCircle2, RefreshCw } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useTenantOptional } from "@/contexts/tenant-context"
import { room, createPayment, usageSummary, confirmPayment, meterSync } from "@/lib/tenant-api"
import { cn } from "@/lib/utils"
import {
  addDaysMalaysiaYmd,
  dateInstantToMalaysiaYmd,
  getTodayMalaysiaYmd,
} from "@/lib/dateMalaysia"

const topupAmounts = [10, 20, 50, 100, 200, 500]

/** Usage chart range: Malaysia calendar (UTC+8); API receives `YYYY-MM-DD` for MY days. */
function getMeterUsageRangeMalaysia(range: string): { start: string; end: string; fetchStart: string } {
  const end = getTodayMalaysiaYmd()
  let start = end
  if (range === "7days") start = addDaysMalaysiaYmd(end, -7)
  else if (range === "30days") start = addDaysMalaysiaYmd(end, -30)
  else if (range === "3months") {
    const d = new Date(`${end}T12:00:00+08:00`)
    d.setMonth(d.getMonth() - 3)
    start = dateInstantToMalaysiaYmd(d)
  } else if (range === "6months") {
    const d = new Date(`${end}T12:00:00+08:00`)
    d.setMonth(d.getMonth() - 6)
    start = dateInstantToMalaysiaYmd(d)
  } else if (range === "1year") {
    const d = new Date(`${end}T12:00:00+08:00`)
    d.setFullYear(d.getFullYear() - 1)
    start = dateInstantToMalaysiaYmd(d)
  } else start = addDaysMalaysiaYmd(end, -7)
  const fetchStart = range === "7days" ? addDaysMalaysiaYmd(end, -14) : start
  return { start, end, fetchStart }
}

function formatDayLabel(dateStr: string): string {
  const ymd = dateStr.slice(0, 10)
  const d = new Date(`${ymd}T12:00:00+08:00`)
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  return days[d.getDay()] ?? dateStr
}

function formatDateShort(dateStr: string): string {
  try {
    const ymd = dateStr.slice(0, 10)
    return new Date(`${ymd}T12:00:00+08:00`).toLocaleDateString("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  } catch {
    return dateStr
  }
}

interface RoomMeter {
  balance?: number | string
  rate?: number | string
  mode?: string
  canTopup?: boolean
}

export default function MeterPage() {
  const state = useTenantOptional()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tenancies = (state?.tenancies ?? []) as {
    id?: string
    _id?: string
    room?: { _id?: string; id?: string; roomname?: string; hasMeter?: boolean }
    property?: { shortname?: string }
  }[]
  const selectedTenancyId = state?.selectedTenancyId ?? null
  const setSelectedTenancyId = state?.setSelectedTenancyId

  const [meter, setMeter] = useState<RoomMeter | null>(null)
  const [roomLoading, setRoomLoading] = useState(false)
  const [usageData, setUsageData] = useState<{ total: number; records: { date: string; consumption: number }[] } | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [dateRange, setDateRange] = useState("7days")
  const [chartType, setChartType] = useState<"daily" | "monthly">("daily")
  const [selected, setSelected] = useState(10)
  const [showTopupDialog, setShowTopupDialog] = useState(false)
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [reportRange, setReportRange] = useState("thisMonth")
  const [reportSummary, setReportSummary] = useState<{ total: number; start: string; end: string } | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)
  const confirmDoneRef = useRef(false)

  const selectedTenancy = tenancies.find((t) => (t.id ?? t._id) === selectedTenancyId) ?? tenancies[0]
  const tenancyReadOnly = !!(selectedTenancy as { isPortalReadOnly?: boolean } | undefined)?.isPortalReadOnly
  const client = selectedTenancy && (selectedTenancy as { client?: { currency?: string } }).client
  const clientCurrency = (client?.currency ?? "").toString().toUpperCase()
  const currencySymbol = clientCurrency === "SGD" ? "S$" : "RM"
  const roomId = selectedTenancy?.room?.id ?? selectedTenancy?.room?._id
  const hasMeterAccess = !!selectedTenancy?.room?.hasMeter

  useEffect(() => {
    if (!roomId) {
      setMeter(null)
      return
    }
    setRoomLoading(true)
    room(roomId)
      .then((res) => {
        const r = res?.room as { meter?: RoomMeter } | undefined
        setMeter(r?.meter ?? null)
      })
      .catch(() => setMeter(null))
      .finally(() => setRoomLoading(false))
  }, [roomId])

  const { start: rangeStartStr, end: rangeEndStr, fetchStart: fetchStartStr } = getMeterUsageRangeMalaysia(dateRange)

  useEffect(() => {
    if (!roomId) {
      setUsageData(null)
      return
    }
    setUsageLoading(true)
    usageSummary(roomId, fetchStartStr, rangeEndStr)
      .then((res) => {
        if (res?.ok && res.records) {
          setUsageData({ total: res.total ?? 0, records: res.records })
        } else {
          setUsageData(null)
        }
      })
      .catch(() => setUsageData(null))
      .finally(() => setUsageLoading(false))
  }, [roomId, dateRange, fetchStartStr, rangeEndStr])

  const handleMeterSync = async () => {
    if (!roomId) return
    setSyncing(true)
    setSyncDone(false)
    try {
      const res = await meterSync(roomId)
      if (res?.ok) {
        setSyncDone(true)
        const after = res.after as { balance?: number | string; rate?: number | string; mode?: string } | undefined
        if (after != null && after.balance !== undefined && after.balance !== null) {
          setMeter((m) => ({
            ...m,
            balance: after.balance,
            ...(after.rate !== undefined ? { rate: after.rate } : {}),
            ...(after.mode !== undefined ? { mode: after.mode } : {}),
          }))
        } else {
          setRoomLoading(true)
          try {
            const r = await room(roomId)
            const rm = (r?.room as { meter?: RoomMeter })?.meter
            setMeter(rm ?? null)
          } finally {
            setRoomLoading(false)
          }
        }
        const { fetchStart, end } = getMeterUsageRangeMalaysia(dateRange)
        setUsageLoading(true)
        usageSummary(roomId, fetchStart, end)
          .then((ures) => {
            if (ures?.ok && ures.records) {
              setUsageData({ total: ures.total ?? 0, records: ures.records })
            }
          })
          .catch(() => {})
          .finally(() => setUsageLoading(false))
        void state?.refetch?.()
        setTimeout(() => setSyncDone(false), 3000)
      }
    } catch {
      // keep prior meter / usage
    } finally {
      setSyncing(false)
    }
  }

  const balance = meter?.balance != null ? Number(meter.balance) : null
  const rate = meter?.rate != null ? Number(meter.rate) : 0.65
  const canTopup = meter?.canTopup !== false && !tenancyReadOnly
  const isPostpaid = (meter?.mode || "").toLowerCase() === "postpaid"

  const chartDaily = useMemo(() => {
    if (!usageData?.records?.length) return []
    const sorted = [...usageData.records].sort((a, b) => a.date.localeCompare(b.date))
    const forChart = dateRange === "7days" ? sorted.slice(-7) : sorted
    return forChart.map((r) => ({ day: formatDayLabel(r.date), value: r.consumption, date: r.date }))
  }, [usageData, dateRange])

  const chartMonthly = useMemo(() => {
    if (!usageData?.records?.length) return []
    const byMonth: Record<string, { usage: number; cost: number }> = {}
    for (const r of usageData.records) {
      const monthKey = r.date.slice(0, 7)
      if (!byMonth[monthKey]) byMonth[monthKey] = { usage: 0, cost: 0 }
      byMonth[monthKey].usage += r.consumption
      byMonth[monthKey].cost += r.consumption * rate
    }
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, v]) => ({
        month: new Date(`${monthKey}-01T12:00:00+08:00`).toLocaleDateString("en-MY", {
          month: "short",
          timeZone: "Asia/Kuala_Lumpur",
        }),
        usage: Number(v.usage.toFixed(2)),
        cost: Number(v.cost.toFixed(2)),
      }))
  }, [usageData, rate])

  const usageHistoryRows = useMemo(() => {
    if (!usageData?.records?.length) return []
    return [...usageData.records]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((r) => ({
        date: r.date,
        usage: r.consumption,
        cost: r.consumption * rate,
      }))
  }, [usageData, rate])

  const sortedRecords = useMemo(
    () => (usageData?.records ? [...usageData.records].sort((a, b) => a.date.localeCompare(b.date)) : []),
    [usageData]
  )
  const thisPeriodRecords = dateRange === "7days" ? sortedRecords.slice(-7) : sortedRecords
  const totalUsage = thisPeriodRecords.reduce((s, r) => s + r.consumption, 0)
  const daysCount = thisPeriodRecords.length || 1
  const avgDaily = (totalUsage / daysCount).toFixed(1)

  const lastWeekTotal = useMemo(() => {
    if (dateRange !== "7days" || sortedRecords.length < 7) return null
    const thisWeek = sortedRecords.slice(-7).reduce((s, r) => s + r.consumption, 0)
    const lastWeek = sortedRecords.length >= 14 ? sortedRecords.slice(0, 7).reduce((s, r) => s + r.consumption, 0) : 0
    return { thisWeek, lastWeek }
  }, [dateRange, sortedRecords])

  const changePercent =
    lastWeekTotal && lastWeekTotal.lastWeek > 0
      ? (((lastWeekTotal.thisWeek - lastWeekTotal.lastWeek) / lastWeekTotal.lastWeek) * 100).toFixed(1)
      : null
  const isUp = changePercent != null && Number(changePercent) > 0

  const estimatedKwh = (selected / rate).toFixed(2)

  const handleConfirmPayment = async () => {
    if (!selectedTenancyId || !canTopup || isPostpaid) return
    setPayError(null)
    setPayLoading(true)
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : ""
      const res = await createPayment({
        tenancyId: selectedTenancyId,
        type: "meter",
        amount: selected,
        returnUrl: origin ? `${origin}/tenant/meter?success=1` : undefined,
        cancelUrl: origin ? `${origin}/tenant/meter?cancel=1` : undefined,
      })
      if (res?.ok && res.type === "redirect" && res.url) {
        window.location.href = res.url
        return
      }
      setPayError((res as { reason?: string })?.reason || "Payment could not be started.")
    } catch {
      setPayError("Payment could not be started.")
    } finally {
      setPayLoading(false)
    }
  }

  useEffect(() => {
    const success = searchParams.get("success")
    const sessionId = searchParams.get("session_id")
    const billId = searchParams.get("bill_id") ?? searchParams.get("billplz[id]") ?? undefined
    const paymentType = (searchParams.get("payment_type") ?? "meter") as "invoice" | "meter"
    const meterTransactionId = searchParams.get("meter_transaction_id") ?? undefined
    const provider = (searchParams.get("provider") ?? (sessionId ? "stripe" : billId ? "billplz" : searchParams.get("reference_number") ? "payex" : "")).toLowerCase()
    const referenceNumber = searchParams.get("reference_number") ?? undefined
    const clientId = searchParams.get("client_id") ?? undefined
    if (success !== "1" || (!sessionId && !referenceNumber && !billId) || confirmDoneRef.current) return
    confirmDoneRef.current = true
    void confirmPayment({
      sessionId: sessionId ?? undefined,
      clientId,
      provider: provider === "payex" ? "payex" : provider === "billplz" ? "billplz" : "stripe",
      referenceNumber,
      billId,
      paymentType,
      meterTransactionId,
    }).catch(() => {})
  }, [searchParams])

  const loadReportSummary = () => {
    if (!roomId) return
    const today = getTodayMalaysiaYmd()
    let startY = today
    let endY = today
    if (reportRange === "thisMonth") {
      startY = `${today.slice(0, 7)}-01`
    } else if (reportRange === "lastMonth") {
      const d = new Date(`${today}T12:00:00+08:00`)
      d.setDate(0)
      endY = dateInstantToMalaysiaYmd(d)
      startY = `${endY.slice(0, 7)}-01`
    } else if (reportRange === "last3Months") {
      const d = new Date(`${today}T12:00:00+08:00`)
      d.setMonth(d.getMonth() - 3)
      startY = dateInstantToMalaysiaYmd(d)
    } else if (reportRange === "last6Months") {
      const d = new Date(`${today}T12:00:00+08:00`)
      d.setMonth(d.getMonth() - 6)
      startY = dateInstantToMalaysiaYmd(d)
    } else if (reportRange === "thisYear") {
      startY = `${today.slice(0, 4)}-01-01`
    } else if (reportRange === "last7days") {
      startY = addDaysMalaysiaYmd(today, -7)
    }
    setReportLoading(true)
    usageSummary(roomId, startY, endY)
      .then((res) => {
        if (res?.ok) {
          setReportSummary({
            total: res.total ?? 0,
            start: startY,
            end: endY,
          })
        } else {
          setReportSummary(null)
        }
      })
      .catch(() => setReportSummary(null))
      .finally(() => setReportLoading(false))
  }

  useEffect(() => {
    if (showReportDialog && roomId) loadReportSummary()
  }, [showReportDialog, roomId, reportRange])

  if (state?.loading) {
    return (
      <div className="p-8 max-w-6xl mx-auto flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (tenancies.length > 0 && !hasMeterAccess) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h1 className="text-2xl font-black text-foreground">Meter not available</h1>
          <p className="text-muted-foreground mt-2">
            The selected tenancy does not have a meter bound. Please switch room or contact your operator.
          </p>
          <Button className="mt-4" onClick={() => router.replace("/tenant")} style={{ background: "var(--brand)" }}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  const meterSuccess = searchParams.get("success") === "1"
  const meterCancel = searchParams.get("cancel") === "1"
  const clearMeterResult = () => router.replace(pathname || "/tenant/meter")

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground">Utility Control</h1>
          <p className="text-muted-foreground mt-1">Monitor and manage your electricity usage.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void handleMeterSync()}
            disabled={!roomId || syncing}
            title="Sync meter balance from utility provider"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : syncDone ? "Synced" : "Sync"}
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowReportDialog(true)}>
            <Download size={14} /> Usage Report
          </Button>
        </div>
      </div>

      {meterSuccess && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            Top-up successful. Your meter balance has been updated.
          </span>
          <button type="button" onClick={clearMeterResult} className="shrink-0 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200">
            Dismiss
          </button>
        </div>
      )}
      {meterCancel && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-medium">Top-up was cancelled. You can try again when ready.</span>
          <button type="button" onClick={clearMeterResult} className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200">
            Dismiss
          </button>
        </div>
      )}

      {tenancies.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {tenancies.map((t) => {
            const id = t.id ?? t._id
            const label = t.property?.shortname || t.room?.roomname || id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedTenancyId?.(id ?? null)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium",
                  selectedTenancyId === id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/80"
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-2xl p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "var(--brand-muted)" }}>
                  <Zap size={14} style={{ color: "var(--brand)" }} />
                </div>
              </div>
              <p className="text-[9px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-0.5">Balance</p>
              {roomLoading ? (
                <div className="h-8 w-16 bg-secondary animate-pulse rounded" />
              ) : (
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl sm:text-3xl font-black text-foreground">
                    {balance != null ? Number(balance).toFixed(2) : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">kWh</span>
                </div>
              )}
            </div>

            <div className="bg-card border border-border rounded-2xl p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "var(--brand-muted)" }}>
                  <DollarSign size={14} style={{ color: "var(--brand)" }} />
                </div>
              </div>
              <p className="text-[9px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-0.5">Rate</p>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl sm:text-3xl font-black text-foreground">{rate.toFixed(2)}</span>
                <span className="text-xs text-muted-foreground">{currencySymbol}/kWh</span>
              </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-4 sm:p-6">
              <p className="text-[9px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-0.5">Avg Daily</p>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl sm:text-3xl font-black text-foreground">
                  {usageLoading ? "—" : avgDaily}
                </span>
                <span className="text-xs text-muted-foreground">kWh</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {dateRange === "7days" ? "This week" : `Last ${dateRange.replace("days", " days").replace("months", " months").replace("year", " year")}`}
              </p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-4 sm:p-6">
              <p className="text-[9px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-0.5">vs Last Week</p>
              {changePercent != null ? (
                <div className="flex items-center gap-1">
                  {isUp ? <TrendingUp size={18} className="text-red-500" /> : <TrendingDown size={18} className="text-emerald-500" />}
                  <span className={cn("text-2xl sm:text-3xl font-black", isUp ? "text-red-500" : "text-emerald-500")}>
                    {Number(changePercent) > 0 ? "+" : ""}{changePercent}%
                  </span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h2 className="font-black text-lg text-foreground">Usage Trends</h2>
              <div className="flex items-center gap-2">
                <Select value={chartType} onValueChange={(v: "daily" | "monthly") => setChartType(v)}>
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <Calendar size={12} className="mr-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7days">Last 7 days</SelectItem>
                    <SelectItem value="30days">Last 30 days</SelectItem>
                    <SelectItem value="3months">Last 3 months</SelectItem>
                    <SelectItem value="6months">Last 6 months</SelectItem>
                    <SelectItem value="1year">Last year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {usageLoading ? (
              <div className="h-[220px] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
              </div>
            ) : chartType === "daily" ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart
                  data={chartDaily.length ? chartDaily : [{ day: "—", value: 0 }]}
                  margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="usageGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--brand)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--brand)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", fontSize: 12 }}
                    formatter={(value: number) => [`${Number(value).toFixed(2)} kWh`, "Usage"]}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--brand)" strokeWidth={2.5} fill="url(#usageGrad)" dot={false} activeDot={{ r: 5, fill: "var(--brand)" }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={chartMonthly.length ? chartMonthly : [{ month: "—", usage: 0, cost: 0 }]}
                  margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", fontSize: 12 }}
                    formatter={(value: number, name: string) => [
                      name === "usage" ? `${value} kWh` : `${currencySymbol} ${value}`,
                      name === "usage" ? "Usage" : "Cost"
                    ]}
                  />
                  <Bar dataKey="usage" fill="var(--brand)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-card border border-border rounded-2xl p-6">
            <h2 className="font-black text-lg text-foreground mb-4">Usage History</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                    <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Usage</th>
                    <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usageLoading ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-muted-foreground">
                        Loading…
                      </td>
                    </tr>
                  ) : usageHistoryRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-muted-foreground">
                        No usage data for this period.
                      </td>
                    </tr>
                  ) : (
                    usageHistoryRows.map((row, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-3 text-foreground">{formatDateShort(row.date)}</td>
                        <td className="py-3 text-right text-foreground">{row.usage.toFixed(2)} kWh</td>
                        <td className="py-3 text-right text-red-500">-{currencySymbol} {row.cost.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <div className="bg-foreground rounded-2xl p-6 text-white sticky top-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <Plus size={16} className="text-white" />
              </div>
              <h2 className="font-black text-lg">Quick Top-up</h2>
            </div>

            {tenancyReadOnly && (
              <p className="text-sm text-amber-100 mb-4 rounded-lg bg-white/10 px-3 py-2">
                This tenancy is ended — meter top-up is disabled. You can still view usage below.
              </p>
            )}
            {isPostpaid && (
              <p className="text-sm text-white/80 mb-4">This room uses postpaid billing. Top-up is not available.</p>
            )}

            <div className="grid grid-cols-3 gap-2 mb-6">
              {topupAmounts.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setSelected(amt)}
                  disabled={isPostpaid || !canTopup}
                  className="py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                  style={
                    selected === amt
                      ? { background: "var(--brand)", color: "white" }
                      : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }
                  }
                >
                  {currencySymbol} {amt}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between mb-6 pb-6 border-b border-white/10">
              <span className="text-sm text-white/60">Estimated kWh</span>
              <span className="font-bold text-white">{estimatedKwh} kWh</span>
            </div>

            {payError && <p className="text-sm text-rose-300 mb-2">{payError}</p>}
            <button
              type="button"
              onClick={() => setShowTopupDialog(true)}
              disabled={isPostpaid || !canTopup || !selectedTenancyId}
              className="w-full py-3.5 rounded-xl font-bold text-white text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--brand)" }}
            >
              Confirm Payment
            </button>
          </div>
        </div>
      </div>

      <Dialog open={showTopupDialog} onOpenChange={setShowTopupDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Top-up</DialogTitle>
            <DialogDescription>You are about to top up your meter balance.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold">{currencySymbol} {selected}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Estimated kWh</span>
              <span className="font-semibold">{estimatedKwh} kWh</span>
            </div>
            <div className="flex justify-between text-sm border-t border-border pt-3">
              <span className="text-muted-foreground">New Balance</span>
              <span className="font-bold text-foreground">
                {(balance != null ? balance + parseFloat(estimatedKwh) : parseFloat(estimatedKwh)).toFixed(2)} kWh
              </span>
            </div>
          </div>
          {payError && <p className="text-sm text-destructive">{payError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTopupDialog(false)}>Cancel</Button>
            <Button
              style={{ background: "var(--brand)" }}
              disabled={payLoading || !canTopup}
              onClick={() => {
                setShowTopupDialog(false)
                handleConfirmPayment()
              }}
            >
              {payLoading ? "Redirecting…" : `Pay ${currencySymbol} ${selected}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Usage Report</DialogTitle>
            <DialogDescription>View usage summary for the selected date range.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-2">Date Range</label>
              <Select value={reportRange} onValueChange={setReportRange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="thisMonth">This Month</SelectItem>
                  <SelectItem value="lastMonth">Last Month</SelectItem>
                  <SelectItem value="last3Months">Last 3 Months</SelectItem>
                  <SelectItem value="last6Months">Last 6 Months</SelectItem>
                  <SelectItem value="thisYear">This Year</SelectItem>
                  <SelectItem value="last7days">Last 7 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reportLoading ? (
              <div className="py-4 flex justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
              </div>
            ) : reportSummary ? (
              <div className="rounded-xl bg-secondary/50 p-4 text-sm">
                <p className="font-semibold text-foreground mb-1">Usage Summary</p>
                <p className="text-muted-foreground">
                  {formatDateShort(reportSummary.start)} – {formatDateShort(reportSummary.end)}
                </p>
                <p className="mt-2 font-bold text-foreground text-lg">{reportSummary.total.toFixed(2)} kWh</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No data for this period.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReportDialog(false)}>Close</Button>
            <Button style={{ background: "var(--brand)" }} className="gap-2" onClick={() => setShowReportDialog(false)}>
              <Download size={14} /> Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
