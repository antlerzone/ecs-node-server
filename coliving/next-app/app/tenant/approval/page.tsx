"use client"

import { useState, useEffect } from "react"
import { CheckCircle2, XCircle, Loader2, UserPlus, FileText } from "lucide-react"
import { useTenantOptional } from "@/contexts/tenant-context"
import { clientsByIds, tenantApprove, tenantReject, syncTenantForClient, approvalDetail } from "@/lib/tenant-api"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

type ApprovalRequest = { clientId?: string; status?: string }

export default function TenantApprovalPage() {
  const state = useTenantOptional()
  const tenant = state?.tenant as { approvalRequest?: ApprovalRequest[] } | null
  const refetch = state?.refetch

  const [clients, setClients] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailClientId, setDetailClientId] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<{
    clientName?: string
    tenancy?: { title?: string; begin?: string; end?: string }
    groups?: Array<{ dueDate: string; total: number; items: Array<{ label: string; amount: number; periodStart?: string | null; periodEnd?: string | null }> }>
  } | null>(null)

  const pendingRequests = (tenant?.approvalRequest ?? []).filter(
    (r) => r.status === "pending" && r.clientId
  )
  const clientIds = pendingRequests.map((r) => r.clientId!).filter(Boolean)

  useEffect(() => {
    if (clientIds.length === 0) {
      setClients({})
      return
    }
    setLoading(true)
    clientsByIds(clientIds)
      .then((res) => {
        const items = (res?.items ?? []) as { _id?: string; id?: string; title?: string }[]
        const map: Record<string, string> = {}
        for (const c of items) {
          const id = c._id ?? c.id
          if (id) map[id] = c.title ?? "Unknown"
        }
        setClients(map)
      })
      .catch(() => setClients({}))
      .finally(() => setLoading(false))
  }, [clientIds.join(",")])

  const openDetail = async (clientId: string) => {
    setDetailOpen(true)
    setDetailClientId(clientId)
    setDetailLoading(true)
    setDetailData(null)
    try {
      const res = await approvalDetail(clientId)
      if (res?.ok) {
        setDetailData({
          clientName: clients[clientId] ?? "Operator",
          tenancy: (res as { tenancy?: { title?: string; begin?: string; end?: string } }).tenancy,
          groups: (res as { groups?: Array<{ dueDate: string; total: number; items: Array<{ label: string; amount: number; periodStart?: string | null; periodEnd?: string | null }> }> }).groups,
        })
      } else {
        setDetailData({ clientName: clients[clientId] ?? "Operator", groups: [] })
      }
    } catch {
      setDetailData({ clientName: clients[clientId] ?? "Operator", groups: [] })
    } finally {
      setDetailLoading(false)
    }
  }

  const formatMoney = (n: number) => {
    const v = Math.round(Number(n) || 0)
    return `RM ${v.toLocaleString("en-MY")}`
  }

  const formatDate = (d: string) => {
    try {
      const raw = String(d || "").trim()
      if (!raw) return d
      // For date-only strings (YYYY-MM-DD), pin to Malaysia noon to avoid UTC/local day-shift.
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? new Date(`${raw}T12:00:00+08:00`)
        : new Date(raw)
      if (Number.isNaN(date.getTime())) return d
      return new Intl.DateTimeFormat("en-MY", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kuala_Lumpur",
      }).format(date)
    } catch {
      return d
    }
  }

  const handleApprove = async (clientId: string) => {
    setActionLoading(clientId)
    try {
      const res = await tenantApprove(clientId)
      if (res?.ok) {
        refetch?.()
        syncTenantForClient(clientId).catch((e) =>
          console.warn("Accounting sync after approve:", e)
        )
      } else {
        alert((res as { reason?: string })?.reason || "Approve failed.")
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approve failed.")
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (clientId: string) => {
    setActionLoading(clientId)
    try {
      const res = await tenantReject(clientId)
      if (res?.ok) {
        refetch?.()
      } else {
        alert((res as { reason?: string })?.reason || "Reject failed.")
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reject failed.")
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <Dialog open={detailOpen} onOpenChange={(open) => {
        setDetailOpen(open)
        if (!open) {
          setDetailClientId(null)
          setDetailData(null)
          setDetailLoading(false)
        }
      }}>
        <DialogContent className="max-w-xl p-0 overflow-hidden">
          <div className="p-6 border-b border-border">
            <DialogHeader>
              <DialogTitle className="text-xl font-black">Upcoming payments</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mt-1">
              {detailData?.clientName ? `For ${detailData.clientName}` : "Preview"}
            </p>
          </div>
          <ScrollArea className="h-[60vh]">
            <div className="p-6 space-y-4">
              {detailLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 size={18} className="animate-spin mr-2" /> Loading…
                </div>
              ) : (detailData?.groups?.length ?? 0) === 0 ? (
                <div className="bg-secondary/30 rounded-2xl p-4 text-sm text-muted-foreground">
                  No billing preview available yet.
                </div>
              ) : (
                (detailData?.groups ?? []).map((g) => (
                  <div key={g.dueDate} className="bg-card border border-border rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">Due</div>
                        <div className="font-black text-foreground">{formatDate(g.dueDate)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">Total</div>
                        <div className="font-black" style={{ color: "var(--brand)" }}>{formatMoney(g.total)}</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {g.items.map((it, idx) => {
                        const s = it.periodStart ? formatDate(it.periodStart) : null
                        const e = it.periodEnd ? formatDate(it.periodEnd) : null
                        const range = s && e && s !== e ? `${s} → ${e}` : null
                        return (
                          <div key={`${g.dueDate}-${idx}`} className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold text-foreground">{it.label}</div>
                              {range && <div className="text-xs text-muted-foreground">{range}</div>}
                            </div>
                            <div className="font-bold text-foreground whitespace-nowrap">{formatMoney(it.amount)}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
              {detailClientId && (
                <div className="bg-secondary/30 rounded-2xl p-4 text-xs text-muted-foreground">
                  Accepting will link your profile to this operator and generate invoices for payment tracking.
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Approvals & Requests</h1>
        <p className="text-muted-foreground mt-1">Review and respond to requests from your operator.</p>
      </div>

      {/* Pending Approvals */}
      <div className="mb-8">
        <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-4">
          Action Required ({pendingRequests.length})
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : pendingRequests.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-4" />
            <p className="font-bold text-foreground">No pending approvals</p>
            <p className="text-sm text-muted-foreground mt-1">You have no approval requests at the moment.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pendingRequests.map((req) => {
              const clientId = req.clientId!
              const clientName = clients[clientId] ?? "Loading…"
              const busy = actionLoading === clientId
              return (
                <div
                  key={clientId}
                  className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4"
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--brand-muted)" }}
                  >
                    <UserPlus size={18} style={{ color: "var(--brand)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-foreground">Join {clientName}</div>
                    <div className="text-sm text-muted-foreground">
                      You have been invited to join this operator. Accept to link your account.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => openDetail(clientId)}
                      disabled={busy}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                      Detail
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(clientId)}
                      disabled={busy}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApprove(clientId)}
                      disabled={busy}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                      style={{ background: "var(--brand)" }}
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      Accept
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-secondary/30 rounded-2xl p-4 text-sm text-muted-foreground">
        When you accept an invitation, your tenant profile will be linked to that operator. You can then view your tenancy, agreements, and payments for that property.
      </div>
    </div>
  )
}
