"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Building2, Users, TrendingUp, Wallet, ArrowUpRight, ArrowRight } from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import { loadCmsData, getOwnerPayoutList } from "@/lib/owner-api"
import { getMalaysiaFirstDayOfYearYmd, getTodayMalaysiaYmd } from "@/lib/dateMalaysia"

interface Owner {
  _id?: string
  ownerName?: string
  property?: string[] | { _id: string }[]
}
interface Property {
  _id: string
  shortname?: string
  address?: string
}
interface Room {
  _id: string
  property?: string | { _id: string }
  roomname?: string
}
interface PayoutItem {
  period?: string
  totalrental?: number
  totalutility?: number
  totalcollection?: number
  expenses?: number
  netpayout?: number
}
interface Tenancy {
  _id: string
  room?: string
  begin?: string
  end?: string
  rental?: number
}

export default function OwnerDashboard() {
  const [owner, setOwner] = useState<Owner | null>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [payoutItems, setPayoutItems] = useState<PayoutItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const data = await loadCmsData()
        if (!data.ok) {
          setError(data.reason || "Unable to load dashboard. Please try again or complete your profile.")
          return
        }
        const o = (data.owner as Owner) || null
        setOwner(o)
        setProperties((data.properties as Property[]) || [])
        setRooms((data.rooms as Room[]) || [])
        setTenancies((data.tenancies as Tenancy[]) || [])

        const propIds = o && Array.isArray(o.property)
          ? o.property.map((p) => (typeof p === "object" && p._id ? p._id : p)).filter(Boolean)
          : []
        const firstPropId = propIds[0] || (data.properties as Property[])?.[0]?._id
        if (firstPropId && !cancelled) {
          const payoutRes = await getOwnerPayoutList({
            propertyId: firstPropId,
            startDate: getMalaysiaFirstDayOfYearYmd(),
            endDate: getTodayMalaysiaYmd(),
          })
          if (payoutRes.ok && payoutRes.items && !cancelled) {
            setPayoutItems((payoutRes.items as PayoutItem[]) || [])
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong. Please try again.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  const totalUnits = rooms.length
  const now = Date.now()
  const occupiedRoomIds = new Set(
    tenancies
      .filter((t) => t.end && new Date(t.end).getTime() >= now)
      .map((t) => t.room)
      .filter(Boolean)
  )
  const occupiedCount = occupiedRoomIds.size
  const occupancyPct = totalUnits > 0 ? Math.round((occupiedCount / totalUnits) * 100) : 0
  const thisMonthPayout = payoutItems.reduce((sum, i) => sum + Number(i.netpayout || 0), 0)
  const formatRM = (v: number) => `RM ${Number(v).toLocaleString("en-MY")}`
  const formatPeriod = (p: string | undefined) => {
    if (!p) return "—"
    const s = String(p).substring(0, 10)
    const iso = s.length <= 7 ? `${s}-01` : s
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+08:00`) : new Date(p)
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { timeZone: "Asia/Kuala_Lumpur", month: "short" })
  }
  const formatPeriodLong = (p: string | undefined) => {
    if (!p) return "—"
    const s = String(p).substring(0, 10)
    const iso = s.length <= 7 ? `${s}-01` : s
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+08:00`) : new Date(p)
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { timeZone: "Asia/Kuala_Lumpur", month: "long", year: "numeric" })
  }
  const incomeDataRaw = payoutItems.slice(-6).map((i) => ({
    month: formatPeriod(i.period),
    income: Number(i.netpayout || 0),
  }))
  const incomeData = incomeDataRaw.length > 0 ? incomeDataRaw : [{ month: "—", income: 0 }]
  const roomCountByProp = rooms.reduce<Record<string, number>>((acc, r) => {
    const pid = typeof r.property === "object" ? (r.property as { _id?: string })?._id : r.property
    if (pid) acc[pid] = (acc[pid] || 0) + 1
    return acc
  }, {})
  const roomToProp: Record<string, string> = {}
  rooms.forEach((r) => {
    const pid = typeof r.property === "object" ? (r.property as { _id?: string })?._id : r.property
    if (pid) roomToProp[r._id] = pid
  })
  const occupiedByProp = tenancies
    .filter((t) => t.end && new Date(t.end).getTime() >= now && t.room)
    .reduce<Record<string, number>>((acc, t) => {
      const pid = roomToProp[t.room as string]
      if (pid) acc[pid] = (acc[pid] || 0) + 1
      return acc
    }, {})

  if (loading) {
    return (
      <div className="p-8 max-w-6xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  const hasNoData = !owner || (properties.length === 0 && rooms.length === 0)

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Owner Dashboard</h1>
        <p className="text-muted-foreground mt-1">Track your property performance and payouts.</p>
      </div>

      {hasNoData && (
        <div className="mb-6 rounded-2xl border border-border bg-muted/40 p-6 text-center">
          <p className="text-muted-foreground">
            No properties linked yet. Complete your profile in the Profile section or wait for an operator to add you.
          </p>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Properties", value: String(properties.length), icon: Building2, delta: null },
          { label: "Total Units", value: String(totalUnits), icon: Users, delta: null },
          { label: "Occupancy", value: `${occupiedCount}/${totalUnits}`, icon: TrendingUp, delta: totalUnits > 0 ? `${occupancyPct}%` : null },
          { label: "Total Payout (Period)", value: formatRM(thisMonthPayout), icon: Wallet, delta: null },
        ].map((kpi) => (
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Income Chart */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-black text-lg text-foreground">Monthly Income</h2>
            {!hasNoData && payoutItems.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                <ArrowUpRight size={14} /> +8% this month
              </div>
            )}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={incomeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", fontSize: 12 }}
                formatter={(v: number) => [`RM ${v.toLocaleString()}`, "Income"]}
              />
              <Bar dataKey="income" fill="var(--brand)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Payout Summary */}
        <div className="bg-foreground rounded-2xl p-6 text-white">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={16} className="text-white/60" />
            <span className="text-[10px] tracking-[0.25em] uppercase font-semibold text-white/60">Payout Summary</span>
          </div>
          <div className="text-4xl font-black mb-1">{formatRM(thisMonthPayout)}</div>
          <div className="text-sm text-white/60 mb-6">Selected period</div>
          <div className="flex flex-col gap-2">
            {payoutItems.slice(-3).map((i) => (
              <div key={i.period || ""} className="flex items-center justify-between py-2 border-t border-white/10">
                <span className="text-sm text-white/70">{formatPeriodLong(i.period)}</span>
                <span className="font-bold text-white">{formatRM(Number(i.netpayout || 0))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Properties */}
      <div className="mt-6 bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-black text-lg text-foreground">My Properties</h2>
          <Link href="/owner/properties" className="text-sm text-primary font-semibold flex items-center gap-1 hover:underline">
            View All <ArrowRight size={14} />
          </Link>
        </div>
        <div className="flex flex-col gap-4">
          {properties.map((p) => {
            const units = roomCountByProp[p._id] || 0
            const occupied = occupiedByProp[p._id] || 0
            return (
              <div key={p._id} className="flex items-center gap-4 p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-muted)" }}>
                  <Building2 size={18} style={{ color: "var(--brand)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-foreground">{p.shortname || "Unnamed"}</div>
                  <div className="text-xs text-muted-foreground">{p.address || "—"}</div>
                </div>
                <div className="text-center">
                  <div className="font-black text-foreground text-sm">{occupied}/{units}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Occupied</div>
                </div>
                <Link href={"/owner/properties"} className="text-right">
                  <div className="font-black text-primary text-sm">View</div>
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
