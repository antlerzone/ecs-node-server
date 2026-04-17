"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  Building2, Users, DoorOpen, Wrench,
  TrendingUp, ArrowRight,
  FileText, PenLine, RefreshCw, AlertTriangle,
} from "lucide-react"
import { useOperatorContext } from "@/contexts/operator-context"
import {
  getAdminList,
  getMyBillingInfo,
  getRentalList,
  getTenancyList,
  getTenancySettingList,
  getPropertyList,
  getRoomList,
} from "@/lib/operator-api"
import { formatRentalDueDateMalaysia, getTodayMalaysiaYmd, rentalDueDateToMalaysiaYmd } from "@/lib/dateMalaysia"

const statusStyle = (status: string) => {
  if (status === "open" || status === "Open") return { bg: "#fff1f2", text: "#f43f5e", label: "Pending" }
  if (status === "in-progress" || status === "In Progress") return { bg: "#fff7ed", text: "#f97316", label: "In Progress" }
  return { bg: "#f0fdf4", text: "#22c55e", label: "Resolved" }
}

function toDaysLeft(endDate?: string | null): number | null {
  if (!endDate) return null
  const target = new Date(endDate)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.floor((target.getTime() - today.getTime()) / 86400000)
}

function formatEndDate(endDate?: string | null): string {
  if (!endDate) return "—"
  try {
    return new Date(endDate).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })
  } catch {
    return "—"
  }
}

function extractPlanExpiredAt(expired: unknown): string | null {
  if (!expired) return null
  if (typeof expired === "string") return expired
  if (typeof expired === "object") {
    const obj = expired as { expiredAt?: string; isExpired?: boolean }
    if (obj.expiredAt && String(obj.expiredAt).trim()) return String(obj.expiredAt)
  }
  return null
}

type OverdueRentalRow = {
  id: string
  tenant: string
  room: string
  property: string
  amount: number
  dueLabel: string
  dateYmd: string
}

function invoiceCurrencySymbol(code: string): string {
  const cc = String(code || "").trim().toUpperCase()
  if (cc === "SGD") return "S$"
  if (cc === "MYR") return "RM"
  return cc ? `${cc} ` : "RM"
}

export default function OperatorDashboard() {
  const { refresh } = useOperatorContext()
  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)
  const [adminItems, setAdminItems] = useState<unknown[]>([])
  const [tenancyItems, setTenancyItems] = useState<unknown[]>([])
  const [handoverPendingItems, setHandoverPendingItems] = useState<unknown[]>([])
  const [propertyCount, setPropertyCount] = useState(0)
  const [roomCount, setRoomCount] = useState(0)
  const [planExpiredAt, setPlanExpiredAt] = useState<string | null>(null)
  const [overdueRentals, setOverdueRentals] = useState<OverdueRentalRow[]>([])
  const [rentalCurrencyCode, setRentalCurrencyCode] = useState("MYR")

  const loadData = async () => {
    try {
      const [adminRes, tenancyRes, tenancySettingRes, propRes, roomRes, billingRes, rentalRes] = await Promise.all([
        getAdminList({ filterType: "ALL", limit: 500, sort: "new" }),
        getTenancyList({ limit: 100, sort: "new" }),
        getTenancySettingList({ limit: 300, sort: "new" }),
        getPropertyList({ pageSize: 1000 }),
        getRoomList({ pageSize: 10000 }),
        getMyBillingInfo(),
        getRentalList({}),
      ])
      setAdminItems(Array.isArray(adminRes.items) ? adminRes.items : [])
      setTenancyItems(Array.isArray((tenancyRes as { items?: unknown[] }).items) ? (tenancyRes as { items: unknown[] }).items : [])
      const tItems = Array.isArray((tenancySettingRes as { items?: unknown[] }).items) ? (tenancySettingRes as { items: unknown[] }).items : []
      const pending = tItems.filter((row) => {
        const r = row as { status?: string | boolean; handoverCheckinAt?: string | null; handoverCheckoutAt?: string | null; hasCheckinHandover?: boolean; hasCheckoutHandover?: boolean }
        const status = r.status
        const isActive = status === true || status === "true" || status === "active"
        const isCompleted = status === "completed" || status === false || status === "false"
        const checkinDue = Boolean(r.handoverCheckinAt) && !r.hasCheckinHandover
        const checkoutDue = (Boolean(r.handoverCheckoutAt) || isCompleted) && !r.hasCheckoutHandover
        return (isActive && checkinDue) || checkoutDue
      }).slice(0, 5)
      setHandoverPendingItems(pending)
      setPropertyCount(Array.isArray((propRes as { items?: unknown[] }).items) ? (propRes as { items: unknown[] }).items.length : 0)
      setRoomCount(Array.isArray((roomRes as { items?: unknown[] }).items) ? (roomRes as { items: unknown[] }).items.length : 0)
      setPlanExpiredAt(extractPlanExpiredAt((billingRes as { expired?: unknown })?.expired))
      const cc =
        typeof (rentalRes as { currency?: string })?.currency === "string" && (rentalRes as { currency: string }).currency.trim()
          ? (rentalRes as { currency: string }).currency.trim().toUpperCase()
          : "MYR"
      setRentalCurrencyCode(cc)
      const today = getTodayMalaysiaYmd()
      const rentalItems = Array.isArray((rentalRes as { items?: unknown[] }).items) ? (rentalRes as { items: unknown[] }).items : []
      const overdue = rentalItems
        .map((row) => {
          const r = row as Record<string, unknown>
          const isPaid = Boolean(r.isPaid)
          if (isPaid) return null
          const dateYmd = rentalDueDateToMalaysiaYmd(r.date)
          if (!dateYmd || dateYmd >= today) return null
          const tenant = r.tenant as { fullname?: string } | null
          const room = r.room as { title_fld?: string } | null
          const prop = r.property as { shortname?: string } | null
          return {
            id: String(r.id ?? r._id ?? ""),
            tenant: tenant?.fullname ?? "—",
            room: room?.title_fld ?? "—",
            property: prop?.shortname ?? "—",
            amount: Number(r.amount ?? 0),
            dueLabel: formatRentalDueDateMalaysia(r.date),
            dateYmd,
          } as OverdueRentalRow
        })
        .filter((x): x is OverdueRentalRow => Boolean(x))
        .sort((a, b) => a.dateYmd.localeCompare(b.dateYmd))
        .slice(0, 8)
      setOverdueRentals(overdue)
    } catch {
      setAdminItems([])
      setTenancyItems([])
      setHandoverPendingItems([])
      setPlanExpiredAt(null)
      setOverdueRentals([])
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    setSyncDone(false)
    try {
      await Promise.all([refresh(), loadData()])
      setSyncDone(true)
      setTimeout(() => setSyncDone(false), 3000)
    } finally {
      setSyncing(false)
    }
  }

  const feedbackItems = adminItems.filter((i) => (i as { _type?: string })._type === "FEEDBACK")
  const refundItems = adminItems.filter((i) => (i as { _type?: string })._type === "REFUND")
  const pendingAgreements = adminItems.filter((i) => (i as { _type?: string })._type === "PENDING_OPERATOR_AGREEMENT").slice(0, 5)
  const feedbackRefundTotal = feedbackItems.length + refundItems.length
  const feedbackRefundCompleted =
    feedbackItems.filter((i) => Boolean((i as { done?: boolean }).done)).length +
    refundItems.filter((i) => Boolean((i as { done?: boolean }).done)).length
  const occupiedRooms = Math.min(tenancyItems.length, roomCount)
  const expiringSoonFromTenancy = (Array.isArray(tenancyItems) ? tenancyItems : [])
    .map((it) => {
      const row = it as {
        id?: string
        _id?: string
        end?: string
        status?: string | boolean
        tenant?: { fullname?: string }
        room?: { title_fld?: string; roomname?: string }
        property?: { shortname?: string }
      }
      const daysLeft = toDaysLeft(row.end)
      const st = row.status
      const isActive = st === true || st === "true" || st === "active" || st == null
      if (!isActive || daysLeft == null || daysLeft < 0 || daysLeft > 60) return null
      return {
        id: row.id ?? row._id ?? "",
        tenantName: row.tenant?.fullname ?? "—",
        roomName: row.room?.title_fld ?? row.room?.roomname ?? "—",
        propertyName: row.property?.shortname ?? "",
        end: row.end ?? null,
        daysLeft,
      }
    })
    .filter(
      (x): x is { id: string; tenantName: string; roomName: string; propertyName: string; end: string | null; daysLeft: number } =>
        Boolean(x)
    )
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 8)
  const planDaysLeft = toDaysLeft(planExpiredAt)
  const showPlanMarquee = planDaysLeft != null && planDaysLeft >= 0 && planDaysLeft <= 60
  const planMarqueeText = showPlanMarquee
    ? `Pricing plan expires in ${planDaysLeft} day${planDaysLeft === 1 ? "" : "s"} (${formatEndDate(planExpiredAt)}). Please renew soon in Billing.`
    : ""

  const currencySym = invoiceCurrencySymbol(rentalCurrencyCode)

  const kpis = [
    { label: "Properties", value: String(propertyCount), icon: Building2, delta: null },
    { label: "Total Rooms", value: `${occupiedRooms}/${roomCount}`, icon: DoorOpen, delta: null },
    { label: "Active Tenancies", value: String(tenancyItems.length), icon: Users, delta: null },
    { label: "Feedback & Refunds", value: `${feedbackRefundCompleted}/${feedbackRefundTotal}`, icon: TrendingUp, delta: null },
  ]

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {showPlanMarquee && (
        <div className="mb-5 rounded-xl border border-amber-300/80 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="overflow-hidden whitespace-nowrap py-2">
            <div className="inline-flex min-w-full animate-[operatorMarquee_18s_linear_infinite] items-center">
              <span className="mx-8 text-sm font-semibold text-amber-900 dark:text-amber-200">{planMarqueeText}</span>
              <span className="mx-8 text-sm font-semibold text-amber-900 dark:text-amber-200">{planMarqueeText}</span>
              <span className="mx-8 text-sm font-semibold text-amber-900 dark:text-amber-200">{planMarqueeText}</span>
            </div>
          </div>
        </div>
      )}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground">Operator Dashboard</h1>
          <p className="text-muted-foreground mt-1">Manage properties, tenants, and operations.</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-border bg-card hover:bg-secondary transition-colors disabled:opacity-60 flex-shrink-0"
        >
          <RefreshCw size={15} className={syncing ? "animate-spin" : ""} style={{ color: "var(--brand)" }} />
          {syncing ? "Syncing..." : syncDone ? "Synced!" : "Sync"}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--brand-muted)" }}>
                <kpi.icon size={17} style={{ color: "var(--brand)" }} />
              </div>
              {kpi.delta && (
                <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  {kpi.delta}
                </span>
              )}
            </div>
            <div className="text-2xl font-black text-foreground mb-0.5">{kpi.value}</div>
            <div className="text-[10px] tracking-[0.2em] uppercase font-semibold text-muted-foreground">{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Pending Agreements (Operator Sign) */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-black text-lg text-foreground">Pending Agreements (Your Sign)</h2>
            <Link href="/operator/agreements" className="text-sm text-primary font-semibold flex items-center gap-1 hover:underline">
              View All <ArrowRight size={14} />
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {pendingAgreements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No pending agreements.</p>
            ) : (
              pendingAgreements.map((agr) => {
                const a = agr as { id?: string; _id?: string; tenant?: { fullname?: string }; room?: { title_fld?: string }; agreement?: { _id?: string } }
                const id = a.id ?? a._id ?? ""
                const tenantName = a.tenant?.fullname ?? "—"
                const roomLabel = a.room?.title_fld ?? "—"
                return (
                  <div key={id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--brand-muted)" }}>
                        <FileText size={13} style={{ color: "var(--brand)" }} />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-foreground">{tenantName}</div>
                        <div className="text-xs text-muted-foreground">{roomLabel}</div>
                      </div>
                    </div>
                    <Link
                      href={`/operator/agreements?sign=${id}`}
                      className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                      style={{ background: "var(--brand)", color: "white" }}
                    >
                      <PenLine size={12} /> Sign
                    </Link>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-black text-lg text-foreground">Handover Pending</h2>
            <Link href="/operator/tenancy" className="text-sm text-primary font-semibold flex items-center gap-1 hover:underline">
              Go Tenancy <ArrowRight size={14} />
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {handoverPendingItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No pending handover tasks.</p>
            ) : (
              handoverPendingItems.map((it) => {
                const row = it as { id?: string; _id?: string; tenant?: { fullname?: string }; room?: { title_fld?: string } }
                return (
                  <div key={row.id ?? row._id ?? ""} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30">
                    <div>
                      <div className="font-semibold text-sm text-foreground">{row.tenant?.fullname ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{row.room?.title_fld ?? "—"}</div>
                    </div>
                    <Link href="/operator/tenancy" className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: "var(--brand)" }}>
                      Update
                    </Link>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-black text-lg text-foreground">Expiring Soon Tenancies</h2>
            <Link href="/operator/tenancy" className="text-sm text-primary font-semibold flex items-center gap-1 hover:underline">
              Go Tenancy <ArrowRight size={14} />
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {expiringSoonFromTenancy.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No tenancy ending within 2 months.</p>
            ) : (
              expiringSoonFromTenancy.map((row) => (
                <div key={row.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30">
                  <div>
                    <div className="font-semibold text-sm text-foreground">{row.tenantName}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.roomName}{row.propertyName ? ` · ${row.propertyName}` : ""}
                    </div>
                    <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                      Ends {formatEndDate(row.end)} ({row.daysLeft} day{row.daysLeft === 1 ? "" : "s"} left)
                    </div>
                  </div>
                  <Link href="/operator/tenancy" className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: "var(--brand)" }}>
                    Follow up
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Feedback (Tenant) */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-black text-lg text-foreground">Tenant Feedback</h2>
            <Link href="/operator/approval" className="text-sm text-primary font-semibold flex items-center gap-1 hover:underline">
              View All <ArrowRight size={14} />
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {feedbackItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No feedback items.</p>
            ) : (
              feedbackItems.slice(0, 5).map((f) => {
                const item = f as { id?: string; _id?: string; description?: string; done?: boolean; room?: { title_fld?: string } }
                const s = statusStyle(item.done ? "resolved" : "open")
                return (
                  <div key={item.id ?? item._id ?? ""} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: s.bg }}>
                      <Wrench size={13} style={{ color: s.text }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate">{item.description || "—"}</div>
                      <div className="text-xs text-muted-foreground">{item.room?.title_fld ?? "—"}</div>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full flex-shrink-0" style={{ background: s.bg, color: s.text }}>
                      {s.label}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Refunds + Pending Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-black text-lg text-foreground">Deposit Refunds</h2>
            <Link href="/operator/refund" className="text-sm text-primary font-semibold flex items-center gap-1 hover:underline">
              View All <ArrowRight size={14} />
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {refundItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No refund items.</p>
            ) : (
              refundItems.slice(0, 5).map((r) => {
                const item = r as { id?: string; _id?: string; amount?: number; tenant?: { fullname?: string }; room?: { title_fld?: string }; done?: boolean }
                return (
                  <div key={item.id ?? item._id ?? ""} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30">
                    <div>
                      <div className="font-semibold text-sm text-foreground">{item.tenant?.fullname ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{item.room?.title_fld ?? "—"}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-foreground text-sm">RM {item.amount ?? 0}</div>
                      <div className="text-[10px] text-muted-foreground">{item.done ? "Done" : "Pending"}</div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-black text-lg text-foreground">Overdue payments</h2>
            <Link href="/operator/invoice" className="text-sm text-primary font-semibold flex items-center gap-1 hover:underline">
              View Invoices <ArrowRight size={14} />
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {overdueRentals.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No overdue invoices (same rule as Tenant Invoice → Overdue).</p>
            ) : (
              overdueRentals.map((inv) => (
                <Link
                  key={inv.id}
                  href="/operator/invoice"
                  className="flex items-center justify-between p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-red-100 dark:bg-red-950/50">
                      <AlertTriangle size={13} className="text-red-600 dark:text-red-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate">{inv.tenant}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {inv.room}
                        {inv.property ? ` · ${inv.property}` : ""}
                      </div>
                      <div className="text-[11px] text-red-700 dark:text-red-300 mt-0.5">Due {inv.dueLabel}</div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 pl-2">
                    <div className="font-black text-foreground text-sm">
                      {currencySym}{" "}
                      {inv.amount.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Overdue</div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes operatorMarquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  )
}
