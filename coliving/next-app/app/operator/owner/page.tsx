"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Edit, CheckCircle, AlertCircle, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getOwnerList, removeOwnerMapping } from "@/lib/operator-api"

type OwnerItem = { _id?: string; id?: string; ownerName?: string; name?: string; ownername?: { ownerName?: string }; email?: string; properties?: Array<{ shortname?: string; id?: string }>; status?: string; verified?: boolean }

export default function OwnerManagementPage() {
  const [loading, setLoading] = useState(true)
  const [owners, setOwners] = useState<OwnerItem[]>([])
  const [search, setSearch] = useState("")
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)

  const handleDisconnect = useCallback(async (ownerId: string) => {
    if (!ownerId || !confirm("Disconnect this owner from your properties? This removes the mapping only.")) return
    setDisconnectingId(ownerId)
    try {
      const res = await removeOwnerMapping(ownerId)
      if (res?.ok) {
        setOwners((prev) => prev.filter((o) => (o._id || o.id) !== ownerId))
      } else {
        alert(res?.reason || "Failed to disconnect")
      }
    } catch (e) {
      console.error(e)
      alert("Failed to disconnect owner")
    } finally {
      setDisconnectingId(null)
    }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getOwnerList({ search: search || undefined, pageSize: 50 })
      const items = (r?.items || []) as OwnerItem[]
      setOwners(items)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => { loadData() }, [loadData])

  return (
    <main className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Owner Management</h1>
          <p className="text-sm text-muted-foreground">Manage property owners and their contracts</p>
        </div>
        <div className="flex gap-2">
          <input type="text" placeholder="Search owner..." value={search} onChange={(e) => setSearch(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm w-48" />
          <Button className="gap-2" style={{ background: "var(--brand)" }} disabled>
            <Plus size={18} /> Add Owner
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Owner Name</th>
                <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Email</th>
                <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Properties</th>
                <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Status</th>
                <th className="text-center py-3 px-4 font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((owner, i) => (
                <tr key={owner._id || owner.id || i} className="border-b border-border hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-4 font-semibold">{owner.ownername?.ownerName ?? owner.ownerName ?? owner.name ?? "—"}</td>
                  <td className="py-3 px-4">{owner.email || "—"}</td>
                  <td className="py-3 px-4">{Array.isArray(owner.properties) ? owner.properties.map((p: { shortname?: string }) => p.shortname).filter(Boolean).join(", ") : "—"}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${owner.status === "Active" || owner.verified ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                      {owner.status === "Active" || owner.verified ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                      {owner.status || (owner.verified ? "Verified" : "Pending")}
                    </span>
                  </td>
                  <td className="py-3 px-4 flex items-center justify-center gap-2">
                    <Button variant="outline" size="icon" className="rounded-lg h-8 w-8" disabled title="Edit">
                      <Edit size={14} />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-lg h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDisconnect(owner._id || owner.id || "")}
                      disabled={!(owner._id || owner.id) || disconnectingId === (owner._id || owner.id)}
                      title="Disconnect owner (remove mapping)"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && owners.length === 0 && <div className="py-12 text-center text-muted-foreground">No owners found.</div>}
    </main>
  )
}
