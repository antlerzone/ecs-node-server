"use client"

import { useEffect, useState } from "react"
import { Building2, CheckCircle2, XCircle, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { getOwner, mergeOwnerMultiReference, removeApprovalPending, syncOwnerForClient } from "@/lib/owner-api"

interface ApprovalPending {
  propertyid?: string
  propertyId?: string
  clientid?: string
  clientId?: string
  clientName?: string
  propertyShortname?: string
  title?: string
}

export default function OwnerApprovalPage() {
  const [owner, setOwner] = useState<{ _id?: string; approvalpending?: ApprovalPending[] } | null>(null)
  const [selectedApproval, setSelectedApproval] = useState<ApprovalPending | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    getOwner().then((res) => {
      if (res.ok && res.owner) setOwner(res.owner as { _id?: string; approvalpending?: ApprovalPending[] })
      setLoading(false)
    })
  }, [])

  const pendingApprovals = (owner?.approvalpending || []) as ApprovalPending[]

  const handleAction = async (action: "approve" | "reject") => {
    if (!selectedApproval || !owner?._id) return
    const propertyId = selectedApproval.propertyid ?? selectedApproval.propertyId ?? undefined
    const clientId = selectedApproval.clientid ?? selectedApproval.clientId
    if (!clientId) return
    // Contact-origin entries have only clientId (no propertyId); Owner Setting flow has both
    setActionLoading(true)
    try {
      if (action === "approve") {
        await mergeOwnerMultiReference({ ownerId: owner._id, propertyId: propertyId || undefined, clientId })
        await removeApprovalPending({ ownerId: owner._id, propertyId: propertyId || undefined, clientId })
        // If operator has accounting, sync owner to their system (find or create contact). Best-effort, non-blocking.
        syncOwnerForClient({ ownerId: owner._id, clientId }).catch((e) =>
          console.warn("Accounting sync after approve:", e)
        )
      } else {
        await removeApprovalPending({ ownerId: owner._id, propertyId, clientId })
      }
      const res = await getOwner()
      if (res.ok && res.owner) setOwner(res.owner as { _id?: string; approvalpending?: ApprovalPending[] })
      setDialogOpen(false)
      setSelectedApproval(null)
      setRemarks("")
    } catch (e) {
      console.error("Approval action failed", e)
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Operator Approvals</h1>
        <p className="text-muted-foreground mt-1">Review and approve operator requests to add you to their properties.</p>
      </div>

      {/* Pending Approvals */}
      <div className="mb-8">
        <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-4">
          Pending Approvals ({pendingApprovals.length})
        </h2>
        <div className="flex flex-col gap-3">
          {pendingApprovals.map((item, idx) => (
            <button
              key={`${item.propertyid || item.propertyId}_${item.clientid || item.clientId}_${idx}`}
              onClick={() => {
                setSelectedApproval(item)
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
                    <span className="font-bold text-foreground">{item.title || `${item.clientName || "Operator"} | ${item.propertyShortname || "Property"} | Pending Approval`}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                      PENDING
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Building2 size={12} /> {item.propertyShortname || "Property"}
                    </span>
                    <span>{item.clientName || "Operator"}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {pendingApprovals.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          No pending approvals.
        </div>
      )}

      {/* Approval Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review Approval Request</DialogTitle>
            <DialogDescription>
              Review the details below and approve or reject this request.
            </DialogDescription>
          </DialogHeader>

          {selectedApproval && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Operator</span>
                <span className="font-semibold">{selectedApproval.clientName || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Property</span>
                <span className="font-semibold">{selectedApproval.propertyShortname || "—"}</span>
              </div>
              <div>
                <span className="text-sm text-muted-foreground block mb-1">Your Remarks (Optional)</span>
                <Textarea
                  placeholder="Add any notes or reason..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => handleAction("reject")} disabled={actionLoading} className="flex-1">
              <XCircle size={16} className="mr-2" /> Reject
            </Button>
            <Button onClick={() => handleAction("approve")} disabled={actionLoading} className="flex-1 text-white" style={{ background: "var(--brand)" }}>
              <CheckCircle2 size={16} className="mr-2" /> Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
