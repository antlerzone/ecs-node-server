"use client"

import { useCallback, useEffect, useState } from "react"
import { Building2, CheckCircle2, XCircle, ArrowUpRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"
import {
  CLN_PLR_KIND_OPERATOR_REQUESTS_CLIENT,
  decideClientPropertyLinkRequest,
  fetchClientPropertyLinkRequests,
  type CleanlemonPropertyLinkRequestRow,
} from "@/lib/cleanlemon-api"

function formatPropertyLine(row: CleanlemonPropertyLinkRequestRow): string {
  const parts = [row.propertyName, row.unitName].map((s) => String(s || "").trim()).filter(Boolean)
  const head = parts.join(" · ") || "Property"
  const addr = String(row.address || "").trim()
  return addr ? `${head} — ${addr}` : head
}

export default function ClientApprovalPage() {
  const { user } = useAuth()
  const email = String(user?.email || "").trim().toLowerCase()
  const operatorId = String(user?.operatorId || "").trim() || "op_demo_001"

  const [items, setItems] = useState<CleanlemonPropertyLinkRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CleanlemonPropertyLinkRequestRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [actionLoading, setActionLoading] = useState(false)

  const load = useCallback(async () => {
    if (!email) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const r = await fetchClientPropertyLinkRequests(email, operatorId, {
        status: "pending",
        kind: CLN_PLR_KIND_OPERATOR_REQUESTS_CLIENT,
      })
      if (!r?.ok) {
        toast.error(r?.reason || "Failed to load approvals")
        setItems([])
        return
      }
      setItems(Array.isArray(r.items) ? r.items : [])
    } finally {
      setLoading(false)
    }
  }, [email, operatorId])

  useEffect(() => {
    void load()
  }, [load])

  const handleAction = async (action: "approve" | "reject") => {
    if (!selected || !email) return
    setActionLoading(true)
    try {
      const res = await decideClientPropertyLinkRequest(selected.id, {
        email,
        operatorId,
        decision: action,
        remarks: remarks.trim() || undefined,
      })
      if (!res?.ok) {
        toast.error(res?.reason || "Request failed")
        return
      }
      toast.success(action === "approve" ? "Binding approved." : "Request rejected.")
      setDialogOpen(false)
      setSelected(null)
      setRemarks("")
      await load()
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Operator approvals</h1>
        <p className="text-muted-foreground mt-1">
          Review when an operator asks to bind your account to a new or updated property.
        </p>
      </div>

      <div className="mb-8">
        <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-4">
          Pending ({loading ? "…" : items.length})
        </h2>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelected(item)
                  setDialogOpen(true)
                }}
                className="w-full text-left bg-card border border-border rounded-2xl p-5 hover:border-primary hover:shadow-md transition-all"
              >
                <div className="flex items-start gap-4">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--brand-muted)" }}
                  >
                    <ArrowUpRight size={18} style={{ color: "var(--brand)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-foreground truncate">{formatPropertyLine(item)}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">
                        PENDING
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1 min-w-0">
                        <Building2 size={12} className="shrink-0" />
                        <span className="truncate">Operator: {item.operatorId.slice(0, 8)}…</span>
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {!loading && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          No pending approvals.
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review binding request</DialogTitle>
            <DialogDescription>
              An operator wants to link this property to your client account.
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 py-2">
              <div className="flex items-start justify-between gap-4">
                <span className="text-sm text-muted-foreground shrink-0">Property</span>
                <span className="font-semibold text-right text-sm">{formatPropertyLine(selected)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Operator</span>
                <span className="font-mono text-xs">{selected.operatorId}</span>
              </div>
              <div>
                <span className="text-sm text-muted-foreground block mb-1">Your remarks (optional)</span>
                <Textarea
                  placeholder="Add any notes or reason…"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => void handleAction("reject")}
              disabled={actionLoading}
              className="flex-1"
            >
              <XCircle size={16} className="mr-2" /> Reject
            </Button>
            <Button
              onClick={() => void handleAction("approve")}
              disabled={actionLoading}
              className="flex-1 text-white"
              style={{ background: "var(--brand)" }}
            >
              <CheckCircle2 size={16} className="mr-2" /> Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
