"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Clock, AlertCircle, ArrowRight, CalendarDays, RefreshCw, Wifi, UserPlus, CreditCard } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { useTenantOptional } from "@/contexts/tenant-context"
import { room, meterSync, propertyWithSmartdoor, updateHandoverSchedule } from "@/lib/tenant-api"
import { agreementNeedsTenantPortalSignature } from "@/lib/tenant-gates"

function getActionItems(
  hasPendingOperatorInvite: boolean,
  hasPendingAgreement: boolean,
  hasOverduePayment: boolean,
  requiresPaymentMethodLink: boolean,
  hasExpiringSoonTenancy: boolean
) {
  const items: { icon: typeof Clock; iconBg: string; iconColor: string; title: string; desc: string; href: string }[] = []
  if (hasPendingOperatorInvite) {
    items.push({
      icon: UserPlus,
      iconBg: "#f0fdf4",
      iconColor: "#16a34a",
      title: "Operator invitation",
      desc: "An operator invited you to link your account. Accept or decline under Approvals.",
      href: "/tenant/approval",
    })
  }
  if (hasPendingAgreement) {
    items.push({
      icon: Clock,
      iconBg: "#fff7ed",
      iconColor: "#f97316",
      title: "Sign Your Agreement",
      desc: "You have a pending tenancy agreement that needs your signature.",
      href: "/tenant/agreement",
    })
  }
  if (hasOverduePayment) {
    items.push({
      icon: AlertCircle,
      iconBg: "#fff1f2",
      iconColor: "#f43f5e",
      title: "Unpaid Invoices",
      desc: "You have unpaid invoices. Please settle them to avoid service interruption.",
      href: "/tenant/payment",
    })
  }
  if (requiresPaymentMethodLink) {
    items.push({
      icon: CreditCard,
      iconBg: "#fef3c7",
      iconColor: "#d97706",
      title: "Link payment method",
      desc: "Your operator requires a linked card or bank account. Open Payments to complete.",
      href: "/tenant/payment?reason=payment_method",
    })
  }
  if (hasExpiringSoonTenancy) {
    items.push({
      icon: CalendarDays,
      iconBg: "#eff6ff",
      iconColor: "#2563eb",
      title: "Tenancy Renewal Reminder",
      desc: "Your tenancy is ending within 2 months. Contact operator now to request renewal.",
      href: "/tenant/feedback",
    })
  }
  return items
}

function formatDate(d: string | undefined): string {
  if (!d) return "—"
  try {
    return new Date(d).toLocaleDateString("en-MY", { month: "short", year: "numeric", day: "numeric" })
  } catch {
    return "—"
  }
}

function daysUntil(endDate: string | undefined): number | null {
  if (!endDate) return null
  const target = new Date(endDate)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.floor((target.getTime() - today.getTime()) / 86400000)
}

export default function TenantDashboard() {
  const state = useTenantOptional()
  const tenancies = (state?.tenancies ?? []) as {
    id?: string
    _id?: string
    room?: { _id?: string; id?: string; roomname?: string; title_fld?: string }
    property?: { shortname?: string }
    begin?: string
    end?: string
    handoverCheckinAt?: string | null
    handoverCheckoutAt?: string | null
    handoverScheduleWindow?: { start: string; end: string; source?: string } | null
    agreements?: Array<{ tenantsign?: string; status?: string; columns_locked?: boolean }>
    parkingLotDisplay?: string
    parkingLots?: Array<{ parkinglot?: string }>
  }[]
  const tenant = state?.tenant as { fullname?: string } | null
  const refetch = state?.refetch
  const hasPendingOperatorInvite = state?.hasPendingOperatorInvite ?? false
  const hasPendingAgreement = state?.hasPendingAgreement ?? false
  const hasOverduePayment = state?.hasOverduePayment ?? false
  const requiresPaymentMethodLink = state?.requiresPaymentMethodLink ?? false
  const expiringSoonTenancies = tenancies
    .map((t) => {
      const daysLeft = daysUntil(t.end)
      if (daysLeft == null || daysLeft < 0 || daysLeft > 60) return null
      return {
        id: t.id ?? t._id ?? "",
        roomName: t.room?.roomname ?? t.room?.title_fld ?? "Room",
        propertyName: t.property?.shortname ?? "Property",
        end: t.end,
        daysLeft,
      }
    })
    .filter((x): x is { id: string; roomName: string; propertyName: string; end?: string; daysLeft: number } => Boolean(x))
    .sort((a, b) => a.daysLeft - b.daysLeft)
  const hasExpiringSoonTenancy = expiringSoonTenancies.length > 0
  const actionItems = getActionItems(
    hasPendingOperatorInvite,
    hasPendingAgreement,
    hasOverduePayment,
    requiresPaymentMethodLink,
    hasExpiringSoonTenancy
  )

  const [meterBalance, setMeterBalance] = useState<number | null>(null)
  const [meterLoading, setMeterLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)

  const [wifiUsername, setWifiUsername] = useState<string | null>(null)
  const [wifiPassword, setWifiPassword] = useState<string | null>(null)
  const [wifiLoading, setWifiLoading] = useState(false)
  const [handoverCheckinAt, setHandoverCheckinAt] = useState("")
  const [handoverCheckoutAt, setHandoverCheckoutAt] = useState("")
  const [savingHandoverSchedule, setSavingHandoverSchedule] = useState(false)

  const selectedTenancyId = state?.selectedTenancyId ?? null
  const activeTenancy =
    tenancies.find((t) => (t.id ?? t._id) === selectedTenancyId) ?? tenancies[0]
  const firstTenancyId = activeTenancy?.id ?? activeTenancy?._id
  const handoverWindow = activeTenancy?.handoverScheduleWindow
  const hasTenantSigned =
    Array.isArray(activeTenancy?.agreements) &&
    activeTenancy.agreements.some((a) => !agreementNeedsTenantPortalSignature(a))
  const roomId = activeTenancy?.room?.id ?? activeTenancy?.room?._id
  const propertyId = activeTenancy?.property?.id ?? activeTenancy?.property?._id
  const parkingLotDisplay = (() => {
    const direct = typeof activeTenancy?.parkingLotDisplay === "string" ? activeTenancy.parkingLotDisplay.trim() : ""
    if (direct) return direct
    const fromList = Array.isArray(activeTenancy?.parkingLots)
      ? activeTenancy.parkingLots
          .map((x) => (x?.parkinglot ? String(x.parkinglot).trim() : ""))
          .filter(Boolean)
          .join(", ")
      : ""
    return fromList
  })()

  useEffect(() => {
    setHandoverCheckinAt(activeTenancy?.handoverCheckinAt || "")
    setHandoverCheckoutAt(activeTenancy?.handoverCheckoutAt || "")
  }, [activeTenancy?.handoverCheckinAt, activeTenancy?.handoverCheckoutAt])

  useEffect(() => {
    if (!roomId) {
      setMeterBalance(null)
      return
    }
    setMeterLoading(true)
    room(roomId)
      .then((res) => {
        const r = res?.room as { meter?: { balance?: number | string } } | undefined
        const bal = r?.meter?.balance
        setMeterBalance(bal != null ? Number(bal) : null)
      })
      .catch(() => setMeterBalance(null))
      .finally(() => setMeterLoading(false))
  }, [roomId])

  useEffect(() => {
    if (!propertyId) {
      setWifiUsername(null)
      setWifiPassword(null)
      return
    }
    setWifiLoading(true)
    propertyWithSmartdoor(propertyId, roomId ?? undefined)
      .then((res) => {
        const prop = (res as { property?: { wifiUsername?: string; wifiPassword?: string } })?.property
        setWifiUsername(prop?.wifiUsername ?? null)
        setWifiPassword(prop?.wifiPassword ?? null)
      })
      .catch(() => {
        setWifiUsername(null)
        setWifiPassword(null)
      })
      .finally(() => setWifiLoading(false))
  }, [propertyId, roomId])

  const handleMeterSync = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (!roomId) return
    setSyncing(true)
    setSyncDone(false)
    try {
      const res = await meterSync(roomId)
      if (res?.ok) {
        setSyncDone(true)
        if (res.after != null && typeof (res.after as { balance?: number }).balance === "number") {
          setMeterBalance((res.after as { balance: number }).balance)
        } else if (roomId) {
          const r = await room(roomId)
          const rm = (r?.room as { meter?: { balance?: number | string } })?.meter
          if (rm?.balance != null) setMeterBalance(Number(rm.balance))
        }
        refetch?.()
        setTimeout(() => setSyncDone(false), 3000)
      }
    } catch {
      setSyncing(false)
    }
    setSyncing(false)
  }

  const begin = activeTenancy?.begin
  const end = activeTenancy?.end
  const progressPercent = begin && end
    ? Math.min(100, Math.max(0, ((Date.now() - new Date(begin).getTime()) / (new Date(end).getTime() - new Date(begin).getTime())) * 100))
    : 25

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {hasExpiringSoonTenancy && (
        <div className="mb-6 rounded-2xl border border-amber-300/80 bg-amber-50 px-5 py-4 dark:border-amber-900/60 dark:bg-amber-950/40">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Tenancy ending within 2 months</p>
              <p className="mt-1 text-sm text-amber-800/90 dark:text-amber-200/80">
                {expiringSoonTenancies[0].roomName} ({expiringSoonTenancies[0].propertyName}) ends on{" "}
                <strong>{formatDate(expiringSoonTenancies[0].end)}</strong>{" "}
                ({expiringSoonTenancies[0].daysLeft} day{expiringSoonTenancies[0].daysLeft === 1 ? "" : "s"} left).
              </p>
              {expiringSoonTenancies.length > 1 && (
                <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/70">
                  +{expiringSoonTenancies.length - 1} more tenancy ending soon.
                </p>
              )}
            </div>
            <Link
              href="/tenant/feedback"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white"
              style={{ background: "var(--brand)" }}
            >
              Contact Operator for Renewal
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-foreground">Welcome back, {tenant?.fullname || "Guest"}</h1>
          <p className="text-muted-foreground mt-1">
            {tenancies.length > 0
              ? `You have ${tenancies.length} active room(s) with us.`
              : hasPendingOperatorInvite
                ? "You have a pending operator invitation — accept it under Approvals to see your room and tenancy."
                : "No active tenancy."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {tenancies.length > 0 && tenancies.map((t, i) => {
            const rn = t.room?.roomname ?? t.room?.title_fld
            const label = typeof rn === "string" && rn.trim()
              ? rn.replace(/^room\s*/i, "").trim().slice(0, 6) || `R${i + 1}`
              : `R${i + 1}`
            return (
              <div
                key={t.id ?? t._id}
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
                style={{ background: "var(--brand)" }}
                title={`${rn || t.room?.roomname || "Room"} · ${t.property?.shortname || ""}`}
              >
                {label}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Action Required */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">Action Required</h2>
          {actionItems.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-6 text-center">
              <p className="text-muted-foreground">No action required at the moment.</p>
            </div>
          ) : (
          actionItems.map((item) => (
            <Link
              key={item.title}
              href={item.href}
              className="group bg-card border border-border rounded-2xl p-5 flex items-center gap-4 hover:border-primary hover:shadow-md transition-all"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: item.iconBg }}
              >
                <item.icon size={22} style={{ color: item.iconColor }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-foreground mb-0.5">{item.title}</div>
                <div className="text-sm text-muted-foreground leading-relaxed">{item.desc}</div>
              </div>
              <ArrowRight
                size={18}
                className="text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0"
              />
            </Link>
          )))}
        </div>

        {/* Quick Stats */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">Quick Stats</h2>
            {roomId && (
              <button
                type="button"
                onClick={handleMeterSync}
                disabled={syncing}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-border bg-card hover:bg-secondary transition-colors disabled:opacity-60"
                title="Sync meter balance"
              >
                <RefreshCw size={12} className={syncing ? "animate-spin" : ""} style={{ color: "var(--brand)" }} />
                {syncing ? "Syncing..." : syncDone ? "Synced" : "Sync"}
              </button>
            )}
          </div>

          {/* Meter Balance */}
          <div className="rounded-2xl p-6 relative" style={{ background: "var(--brand)" }}>
            <p className="text-[10px] font-semibold tracking-[0.25em] uppercase text-white/60 mb-2">Meter Balance</p>
            <div className="flex items-baseline gap-2 mb-4">
              {meterLoading ? (
                <span className="text-white/80 text-sm">Loading…</span>
              ) : (
                <>
                  <span className="text-4xl font-black text-white">{meterBalance != null ? Number(meterBalance).toFixed(2) : "—"}</span>
                  <span className="text-white/60 font-medium">kWh</span>
                </>
              )}
            </div>
            <Link
              href="/tenant/meter"
              className="w-full block text-center bg-white font-bold text-sm py-2.5 rounded-xl hover:bg-white/90 transition-colors"
              style={{ color: "var(--brand)" }}
            >
              Top-up Now
            </Link>
          </div>

          {/* WiFi (property) */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Wifi size={15} className="text-muted-foreground" />
              <p className="text-[10px] font-semibold tracking-[0.25em] uppercase text-muted-foreground">WiFi</p>
            </div>
            {wifiLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (wifiUsername || wifiPassword) ? (
              <div className="space-y-2 text-sm">
                {wifiUsername != null && wifiUsername !== "" && (
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground mb-0.5">Username / Network</p>
                    <p className="font-mono font-semibold text-foreground break-all">{wifiUsername}</p>
                  </div>
                )}
                {wifiPassword != null && wifiPassword !== "" && (
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground mb-0.5">Password</p>
                    <p className="font-mono font-semibold text-foreground break-all">{wifiPassword}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not set by operator.</p>
            )}
          </div>

          {/* Parking Lot (selected tenancy) */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <p className="text-[10px] font-semibold tracking-[0.25em] uppercase text-muted-foreground mb-1">Parking Lot</p>
            {parkingLotDisplay ? (
              <p className="font-semibold text-foreground break-words">{parkingLotDisplay}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No parking lot selected.</p>
            )}
          </div>

          {/* Tenancy Period */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <CalendarDays size={15} className="text-muted-foreground" />
              <p className="text-[10px] font-semibold tracking-[0.25em] uppercase text-muted-foreground">Tenancy Period</p>
            </div>
            <p className="font-black text-foreground text-lg mb-3">{formatDate(begin)} – {formatDate(end)}</p>
            <Progress value={progressPercent} className="h-2 mb-2" />
            <p className="text-xs text-muted-foreground">
              <span className="text-primary font-semibold">{Math.round(progressPercent)}%</span> of your tenancy has passed.
            </p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6">
            <p className="text-[10px] font-semibold tracking-[0.25em] uppercase text-muted-foreground mb-3">Handover Schedule</p>
            {hasTenantSigned ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Check-in date & time</p>
                  <input type="datetime-local" value={handoverCheckinAt} onChange={(e) => setHandoverCheckinAt(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Check-out date & time</p>
                  <input type="datetime-local" value={handoverCheckoutAt} onChange={(e) => setHandoverCheckoutAt(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground" />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  You can update your appointment time here. Each save is logged (time, your email) so staff know the latest schedule and who changed it.
                </p>
                {handoverWindow ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300/90 leading-relaxed">
                    Appointment times must fall between <strong>{handoverWindow.start}</strong> and <strong>{handoverWindow.end}</strong>{" "}
                    (<strong>Handover working hours</strong> in company settings only — not general working hours). If your operator has not set handover hours, <strong>10:00–19:00</strong> is used. Staff can set other times when needed.
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={savingHandoverSchedule || !firstTenancyId}
                  onClick={async () => {
                    if (!firstTenancyId) return
                    setSavingHandoverSchedule(true)
                    try {
                      await updateHandoverSchedule({
                        tenancyId: firstTenancyId,
                        handoverCheckinAt: handoverCheckinAt || undefined,
                        handoverCheckoutAt: handoverCheckoutAt || undefined,
                      })
                      await state?.refetch?.()
                    } catch (e) {
                      window.alert(e instanceof Error ? e.message : String(e))
                    } finally {
                      setSavingHandoverSchedule(false)
                    }
                  }}
                  className="w-full py-2 rounded-xl font-bold text-white text-sm disabled:opacity-60"
                  style={{ background: "var(--brand)" }}
                >
                  {savingHandoverSchedule ? "Saving..." : "Save Handover Schedule"}
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">You can set handover schedule after signing agreement.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
