"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { BookOpen, Check, Loader2, RefreshCw, Search, Unplug } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import {
  fetchOperatorAccountingMappings,
  fetchOperatorSettings,
  saveOperatorAccountingMapping,
  syncOperatorAccountingMappings,
  fetchOperatorSubscription,
} from "@/lib/cleanlemon-api"
import { planAllowsAccounting } from "@/lib/cleanlemon-subscription-plan"
import { useAuth } from "@/lib/auth-context"

interface AccountMapping {
  id: string
  cleanlemonsAccount: string
  externalAccount: string
  externalProduct?: string
  type: "income" | "expense" | "asset" | "liability"
  mapped: boolean
  isProduct: boolean
}

export default function AccountingMappingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const operatorId = user?.operatorId || "op_demo_001"
  const [planGate, setPlanGate] = useState<"loading" | "ok" | "denied">("loading")
  const [mappings, setMappings] = useState<AccountMapping[]>([])
  const [listLoad, setListLoad] = useState<"loading" | "ready" | "error">("loading")
  /** null = not connected; reflects Company → Integration (Bukku / Xero). */
  const [accountingProvider, setAccountingProvider] = useState<"bukku" | "xero" | null>(null)
  const [integrationLoad, setIntegrationLoad] = useState<"loading" | "ready">("loading")
  const [isSyncing, setIsSyncing] = useState(false)
  const [search, setSearch] = useState("")
  const [filterType, setFilterType] = useState<string>("all")
  const [sortAz, setSortAz] = useState<"az" | "za">("az")
  const [editOpen, setEditOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingIsProduct, setEditingIsProduct] = useState(false)
  const [formAccount, setFormAccount] = useState("")
  const [formProduct, setFormProduct] = useState("")
  const [mapRefresh, setMapRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sub = await fetchOperatorSubscription({
        operatorId,
        email: String(user?.email || "")
          .trim()
          .toLowerCase(),
      })
      if (cancelled) return
      if (!planAllowsAccounting(sub?.item?.planCode)) {
        setPlanGate("denied")
        toast.error("Accounting is available on Growth and Enterprise plans only.")
        router.replace("/portal/operator/company")
        return
      }
      setPlanGate("ok")
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId, router, user?.email])

  useEffect(() => {
    if (planGate !== "ok") return
    let cancelled = false
    setListLoad("loading")
    ;(async () => {
      const r = await fetchOperatorAccountingMappings(operatorId)
      if (cancelled) return
      if (!r?.ok || !Array.isArray(r.items)) {
        setListLoad("error")
        setMappings([])
        toast.error(typeof r?.reason === "string" ? r.reason : "Could not load account mappings")
        return
      }
      const rows: AccountMapping[] = r.items.map((item: any) => ({
        id: String(item.id),
        cleanlemonsAccount: String(item.cleanlemonsAccount || ""),
        externalAccount: String(item.externalAccount || ""),
        externalProduct: item.externalProduct ? String(item.externalProduct) : undefined,
        type: (item.type || "income") as AccountMapping["type"],
        mapped: Boolean(item.mapped),
        isProduct: Boolean(item.isProduct),
      }))
      setMappings(rows)
      setListLoad("ready")
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId, mapRefresh, planGate])

  useEffect(() => {
    if (planGate !== "ok") return
    let cancelled = false
    setIntegrationLoad("loading")
    ;(async () => {
      const r = await fetchOperatorSettings(operatorId)
      if (cancelled) return
      const s = (r as { settings?: { bukku?: boolean; xero?: boolean } })?.settings
      const bukku = !!s?.bukku
      const xero = !!s?.xero
      if (bukku) setAccountingProvider("bukku")
      else if (xero) setAccountingProvider("xero")
      else setAccountingProvider(null)
      setIntegrationLoad("ready")
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId, planGate])

  /** Header check: only when every account line is mapped (not merely “integration connected”). */
  const allAccountLinesMapped = useMemo(() => {
    if (listLoad !== "ready") return false
    if (mappings.length === 0) return false
    return mappings.every((m) => m.mapped)
  }, [listLoad, mappings])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = mappings.filter((m) => {
      if (!q) return true
      return (
        m.cleanlemonsAccount.toLowerCase().includes(q) ||
        m.externalAccount.toLowerCase().includes(q) ||
        (m.externalProduct || "").toLowerCase().includes(q)
      )
    })
    if (filterType !== "all") rows = rows.filter((m) => m.type === filterType)
    rows.sort((a, b) =>
      sortAz === "az"
        ? a.cleanlemonsAccount.localeCompare(b.cleanlemonsAccount)
        : b.cleanlemonsAccount.localeCompare(a.cleanlemonsAccount)
    )
    return rows
  }, [mappings, search, filterType, sortAz])

  const handleSync = async () => {
    setIsSyncing(true)
    const r = await syncOperatorAccountingMappings(operatorId)
    setIsSyncing(false)
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Sync failed")
      return
    }
    const w = (r as { warnings?: string[] }).warnings
    if (Array.isArray(w) && w.length > 0) {
      toast.info(w.slice(0, 4).join(" · "))
    }
    toast.success("Sync completed")
    setMapRefresh((k) => k + 1)
  }

  const openEdit = (row: AccountMapping) => {
    setEditingId(row.id)
    setEditingIsProduct(row.isProduct)
    setFormAccount(row.isProduct ? "" : row.externalAccount)
    setFormProduct(row.externalProduct || "")
    setEditOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    const nextProduct = formProduct.trim()
    if (editingIsProduct) {
      if (!nextProduct) {
        toast.error("Product ID is required for service mapping")
        return
      }
    } else {
      const nextAccount = formAccount.trim()
      if (!nextAccount) {
        toast.error("Account ID is required")
        return
      }
    }
    const current = mappings.find((m) => m.id === editingId)
    if (!current) return
    const nextAccount = editingIsProduct ? "" : formAccount.trim()
    const updated = {
      ...current,
      externalAccount: nextAccount,
      externalProduct: current.isProduct ? nextProduct : undefined,
      mapped: true,
    }
    const r = await saveOperatorAccountingMapping(operatorId, updated)
    if (!r?.ok) {
      toast.error(r?.reason || "Failed to save mapping")
      return
    }
    setMappings((prev) => prev.map((m) => (m.id === editingId ? updated : m)))
    setEditOpen(false)
    toast.success("Mapping updated")
  }

  if (planGate !== "ok") {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <span>{planGate === "denied" ? "Redirecting…" : "Loading…"}</span>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex flex-wrap items-center gap-2">
            <BookOpen className="size-7 text-muted-foreground" />
            Accounting
            {integrationLoad === "loading" ? (
              <span className="text-2xl font-medium text-muted-foreground">| …</span>
            ) : accountingProvider === "bukku" ? (
              <>
                <span className="text-2xl font-medium text-muted-foreground">| Bukku</span>
                {allAccountLinesMapped ? (
                  <Check className="size-6 text-emerald-600" aria-label="All account mappings complete" />
                ) : null}
              </>
            ) : accountingProvider === "xero" ? (
              <>
                <span className="text-2xl font-medium text-muted-foreground">| Xero</span>
                {allAccountLinesMapped ? (
                  <Check className="size-6 text-emerald-600" aria-label="All account mappings complete" />
                ) : null}
              </>
            ) : (
              <>
                <span className="text-2xl font-medium text-muted-foreground">| Not connected</span>
                <Unplug className="size-6 text-muted-foreground" aria-label="No accounting integration" />
              </>
            )}
          </h1>
        </div>
        <Button type="button" variant="outline" disabled={isSyncing} onClick={() => void handleSync()}>
          {isSyncing ? <Loader2 className="size-4 animate-spin mr-2" /> : <RefreshCw className="size-4 mr-2" />}
          Sync Account
        </Button>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-3xl">Account Mapping ({filtered.length})</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search accounts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="asset">Asset</SelectItem>
                <SelectItem value="liability">Liability</SelectItem>
                <SelectItem value="expense">Expenses</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortAz} onValueChange={(v) => setSortAz(v as "az" | "za")}>
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="az">A → Z</SelectItem>
                <SelectItem value="za">Z → A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {listLoad === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span>Loading mappings…</span>
            </div>
          ) : listLoad === "error" ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Failed to load mappings. Refresh the page or try again later.</p>
          ) : (
            filtered.map((row) => (
              <div
                key={row.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{row.cleanlemonsAccount}</span>
                    {row.isProduct ? (
                      <Badge
                        variant="outline"
                        className="border-sky-500/70 bg-sky-50 text-sky-900 dark:border-sky-500/50 dark:bg-sky-950/50 dark:text-sky-100"
                      >
                        Product
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="capitalize">{row.type}</Badge>
                    )}
                    {row.mapped ? (
                      <Badge variant="outline" className="border-emerald-500 text-emerald-700">Mapped</Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground">
                    {row.isProduct
                      ? row.externalProduct
                        ? `Product ${row.externalProduct} (uses Sales Income account)`
                        : "Not mapped — add your accounting product / item ID."
                      : row.externalAccount
                        ? `Account ${row.externalAccount}`
                        : "Not mapped — add your accounting account ID."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => openEdit(row)}
                >
                  Edit
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Mapping</DialogTitle>
            <DialogDescription>
              {editingIsProduct
                ? "Service items map to your product/item ID only. Income uses the Sales Income account."
                : "Update the account ID in your accounting software."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {editingIsProduct ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                No separate account ID — revenue posts to <span className="font-medium text-foreground">Sales Income</span>. Map that row with your income GL code.
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium">Account ID</label>
                <Input
                  value={formAccount}
                  onChange={(e) => setFormAccount(e.target.value)}
                  placeholder="e.g. 30922"
                />
              </div>
            )}
            <div className="space-y-2">
              {editingIsProduct ? (
                <>
                  <label className="text-sm font-medium">Product / item ID</label>
                  <Input
                    value={formProduct}
                    onChange={(e) => setFormProduct(e.target.value)}
                    placeholder="e.g. ITM030923"
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">This line does not use a product ID.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSaveEdit()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
