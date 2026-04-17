"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BookOpen, Check, Loader2, RefreshCw, Search } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { getAccountList, getAccountSystem, saveAccount, syncAccounts } from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import { useToast } from "@/hooks/use-toast"

type AccountItem = {
  _id?: string
  id?: string
  title?: string
  type?: string
  is_product?: boolean
  uses_platform_collection_gl?: boolean
  _myAccount?: {
    accountid?: string
    productId?: string
    system?: string
    _accountFromPlatformCollection?: boolean
  }
  _protected?: boolean
}

function typeBadgeLabel(t: string | undefined): string {
  const x = (t || "").toLowerCase()
  if (x === "income" || x === "revenue" || x === "other_income") return "Income"
  if (
    x === "liability" ||
    x === "current_liability" ||
    x === "current_liabilities" ||
    x === "non_current_liabilities" ||
    x === "currliab"
  )
    return "Liability"
  if (
    x === "asset" ||
    x === "bank" ||
    x === "current_asset" ||
    x === "current_assets" ||
    x === "non_current_assets" ||
    x === "other_assets"
  )
    return "Asset"
  if (x === "equity") return "Equity"
  if (x === "expenses" || x === "expense" || x === "taxation") return "Expenses"
  if (x === "cost_of_sales") return "Cost of sales"
  return t ? t : "—"
}

/**
 * Filter bucket for the type dropdown: product | asset | liability | income | expenses | other.
 * Platform–collection product lines (`uses_platform_collection_gl`) are grouped under **product** first.
 */
function rowAccountingFilterBucket(row: AccountItem): string {
  if (row.uses_platform_collection_gl === true || row.uses_platform_collection_gl === 1) {
    return "product"
  }
  const x = (row.type || "").trim().toLowerCase()
  if (
    ["bank", "current_asset", "current_assets", "non_current_assets", "other_assets", "asset", "cash"].includes(x)
  )
    return "asset"
  if (["current_liability", "current_liabilities", "non_current_liabilities", "liability", "currliab"].includes(x))
    return "liability"
  if (["revenue", "income", "other_income"].includes(x)) return "income"
  if (["expense", "expenses", "taxation", "cost_of_sales"].includes(x)) return "expenses"
  return "other"
}

function hasProductId(ma: AccountItem["_myAccount"]): boolean {
  return ma?.productId != null && String(ma.productId).trim() !== ""
}

/** Template row: product line + GL from Platform Collection — no chart account on this row (DB `type` may be null). */
function isProductOnlyPlatformCollectionRow(row: AccountItem | null): boolean {
  if (!row) return false
  return row.uses_platform_collection_gl === true || row.uses_platform_collection_gl === 1
}

/**
 * Canonical account template id → badges shown (matches operator chart in account.service.js).
 * Rows not listed fall back to `type` + Product when sync/mapping expects a product line.
 */
const ACCOUNT_BADGE_LABELS_BY_ID: Record<string, string[]> = {
  "1c7e41b6-9d57-4c03-8122-a76baad3b592": ["Asset"], // Bank
  "a1b2c3d4-0001-4000-8000-000000000001": ["Asset"], // Cash
  "e1b2c3d4-2003-4000-8000-000000000303": ["Income", "Product"], // Agreement Fees
  "e1b2c3d4-2008-4000-8000-000000000308": ["Income", "Product"], // Admin Charge
  "a1b2c3d4-0002-4000-8000-000000000002": ["Income", "Product"], // Management Fees
  "94b4e060-3999-4c76-8189-f969615c0a7d": ["Product"], // Other
  "86da59c0-992c-4e40-8efd-9d6d793eaf6a": ["Income", "Product"], // Owner Commission
  "e1b2c3d4-2007-4000-8000-000000000307": ["Cost of sales", "Product"], // Processing Fees
  "e1b2c3d4-2006-4000-8000-000000000306": ["Cost of sales", "Product"], // Referral Fees
  "ae94f899-7f34-4aba-b6ee-39b97496e2a3": ["Product"], // Rental Income
  "e1b2c3d4-2002-4000-8000-000000000302": ["Income", "Product"], // Tenant Commission
  "a1b2c3d4-1001-4000-8000-000000000101": ["Product"], // Topup Aircond
  "e1b2c3d4-2004-4000-8000-000000000304": ["Product"], // Parking Fees
  "2020b22b-028e-4216-906c-c816dcb33a85": ["Product"], // Forfeit Deposit
}

const PRODUCT_ONLY_BADGE_IDS = new Set([
  "94b4e060-3999-4c76-8189-f969615c0a7d",
  "ae94f899-7f34-4aba-b6ee-39b97496e2a3",
  "a1b2c3d4-1001-4000-8000-000000000101",
])

/** Product line when API flags is_product or legacy heuristics on unified type. */
function isAccountPlusProductLine(row: AccountItem): boolean {
  if (row.is_product) return true
  const t = (row.type || "").trim().toLowerCase()
  return (
    t === "revenue" ||
    t === "income" ||
    t === "cost_of_sales" ||
    t === "expense" ||
    t === "expenses" ||
    t === "current_liability"
  )
}

/** True when this row has a saved account id, product id, or Platform Collection + product mapping. */
function isRowMapped(row: AccountItem): boolean {
  const ma = row._myAccount
  if (!ma) return false
  const aid = ma.accountid != null && String(ma.accountid).trim() !== ""
  const pid = hasProductId(ma)
  if (ma._accountFromPlatformCollection && pid) return true
  return aid || pid
}

/**
 * Row satisfies the same rules as Save: Platform-only lines need Product ID; account+product lines need both;
 * account-only lines (e.g. Bank) need Account ID.
 */
function isRowIntegrationComplete(row: AccountItem): boolean {
  const ma = row._myAccount
  const pid = hasProductId(ma)
  const aid = ma != null && ma.accountid != null && String(ma.accountid).trim() !== ""

  if (ma?._accountFromPlatformCollection && pid) return true

  if (isProductOnlyPlatformCollectionRow(row)) {
    return pid
  }

  const showProductField =
    row.is_product === true ||
    row.is_product === 1 ||
    !!ma?._accountFromPlatformCollection

  if (showProductField) {
    return aid && pid
  }

  return aid
}

function getBadgeLabelsForRow(row: AccountItem): string[] {
  const id = String(row._id || row.id || "").trim()
  let base: string[]
  if (id && ACCOUNT_BADGE_LABELS_BY_ID[id]) {
    base = [...ACCOUNT_BADGE_LABELS_BY_ID[id]]
  } else {
    const ma = row._myAccount
    const first = typeBadgeLabel(row.type)
    const showProduct = hasProductId(ma) || isAccountPlusProductLine(row)
    if (showProduct) {
      base = first === "Product" ? ["Product"] : [first, "Product"]
    } else {
      base = [first]
    }
  }
  if (isRowMapped(row) && !base.includes("Mapped")) {
    base.push("Mapped")
  }
  return base
}

function getProductBadgeTitle(row: AccountItem, labels: string[]): string | undefined {
  if (!labels.includes("Product")) return undefined
  const ma = row._myAccount
  if (hasProductId(ma)) return "Product ID is mapped in your accounting system"
  const id = String(row._id || row.id || "").trim()
  if (id && PRODUCT_ONLY_BADGE_IDS.has(id)) {
    return "Map Product ID in Edit or Sync (account may use Platform Collection)."
  }
  return "This template uses both an account and a product (e.g. Agreement Fees). Map IDs in Edit or Sync."
}

function mappedSummary(ma: AccountItem["_myAccount"] | undefined): string {
  if (!ma) return "Not set"
  const aid = ma.accountid != null && String(ma.accountid).trim() !== ""
  const pid = hasProductId(ma)
  if (ma._accountFromPlatformCollection && pid) {
    return `Product ${ma.productId} · Account via Platform Collection`
  }
  const parts: string[] = []
  if (aid) parts.push(`Account ${ma.accountid}`)
  if (pid) parts.push(`Product ${ma.productId}`)
  return parts.length ? parts.join(" · ") : "Not set"
}

export default function OperatorAccountingPage() {
  const { accessCtx, hasAccountingCapability } = useOperatorContext()
  const { toast } = useToast()
  const clientId = accessCtx?.client?.id ?? null

  const [items, setItems] = useState<AccountItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState("")
  const [filterType, setFilterType] = useState<string>("all")
  const [sortAz, setSortAz] = useState<"az" | "za">("az")

  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<AccountItem | null>(null)
  const [formAccountId, setFormAccountId] = useState("")
  const [formProductId, setFormProductId] = useState("")
  const [saving, setSaving] = useState(false)
  const [accountSystem, setAccountSystem] = useState<string>("")

  const accountingProviderLabel = useMemo(() => {
    const p = String(accountSystem || "").trim().toLowerCase()
    if (p === "xero") return "Xero"
    if (p === "bukku") return "Bukku"
    if (p === "autocount") return "AutoCount"
    if (p === "sql") return "SQL"
    return ""
  }, [accountSystem])

  const load = useCallback(
    async (opts?: { quiet?: boolean }): Promise<boolean> => {
      setLoading(true)
      try {
        const res = await getAccountList()
        if (res?.ok === false) {
          if (!opts?.quiet) {
            toast({ variant: "destructive", title: "Could not load accounts", description: res?.reason || "Unknown" })
          }
          setItems([])
          return false
        }
        setItems(Array.isArray(res?.items) ? (res.items as AccountItem[]) : [])
        return true
      } catch (e) {
        if (!opts?.quiet) {
          toast({
            variant: "destructive",
            title: "Could not load accounts",
            description: e instanceof Error ? e.message : String(e),
          })
        }
        setItems([])
        return false
      } finally {
        setLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    if (hasAccountingCapability) void load()
    else setLoading(false)
  }, [hasAccountingCapability, load])

  useEffect(() => {
    let cancelled = false
    if (!hasAccountingCapability) return
    void getAccountSystem()
      .then((res) => {
        if (cancelled) return
        const provider = String(res?.provider || "").trim().toLowerCase()
        if (provider) setAccountSystem(provider)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hasAccountingCapability])

  const filtered = useMemo(() => {
    let rows = [...items]
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.title || "").toLowerCase().includes(q) || (r.type || "").toLowerCase().includes(q)
      )
    }
    if (filterType !== "all") {
      rows = rows.filter((r) => rowAccountingFilterBucket(r) === filterType.toLowerCase())
    }
    rows.sort((a, b) => {
      const ta = (a.title || "").toLowerCase()
      const tb = (b.title || "").toLowerCase()
      return sortAz === "az" ? ta.localeCompare(tb) : tb.localeCompare(ta)
    })
    return rows
  }, [items, search, filterType, sortAz])

  const defaultSystem = useMemo(() => {
    const first = items.find((i) => i._myAccount?.system)
    return (first?._myAccount?.system || "bukku").toLowerCase()
  }, [items])

  const allAccountsIntegrated = useMemo(() => {
    if (loading || items.length === 0) return false
    return items.every(isRowIntegrationComplete)
  }, [items, loading])

  const openEdit = (row: AccountItem) => {
    setEditing(row)
    setFormAccountId(row._myAccount?.accountid != null ? String(row._myAccount.accountid) : "")
    setFormProductId(row._myAccount?.productId != null ? String(row._myAccount.productId) : "")
    setEditOpen(true)
  }

  const handleSave = async () => {
    if (!editing?._id && !editing?.id) return
    const id = editing._id || editing.id
    const platformProductOnly = isProductOnlyPlatformCollectionRow(editing)
    const showProductField =
      platformProductOnly ||
      editing.is_product === true ||
      editing.is_product === 1 ||
      !!editing._accountFromPlatformCollection
    const productRequired = showProductField
    if (productRequired && !String(formProductId || "").trim()) {
      toast({
        variant: "destructive",
        title: "Product ID required",
        description: "Enter the product / item ID from your accounting system.",
      })
      return
    }
    setSaving(true)
    try {
      const saveSystem = String(accountSystem || defaultSystem || "bukku").trim().toLowerCase()
      const res = await saveAccount({
        item: { _id: id! },
        clientId: clientId ?? undefined,
        system: saveSystem,
        accountId: platformProductOnly ? "" : formAccountId.trim(),
        productId: formProductId.trim() || undefined,
      })
      if (res?.ok === false) {
        toast({ variant: "destructive", title: "Save failed", description: res?.reason || "Unknown" })
        return
      }
      toast({ title: "Mapping saved" })
      setEditOpen(false)
      await load()
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await syncAccounts()
      if (res?.ok === false) {
        toast({ variant: "destructive", title: "Sync failed", description: res?.reason || "Unknown" })
        return
      }
      const ca = res?.createdAccounts ?? 0
      const la = res?.linkedAccounts ?? 0
      const cp = res?.createdProducts ?? 0
      const lp = res?.linkedProducts ?? 0
      const pv = res?.provider ? String(res.provider) : ""
      const summary = `Accounts ${la} matched · ${ca} created · Products ${lp} matched · ${cp} created`
      const sf = Number(res?.saveMappingFailed ?? 0)
      const warnList = Array.isArray(res?.warnings) ? res.warnings : []
      const warnSuffix =
        sf > 0 || warnList.length
          ? ` · Mapping save issues: ${sf}${warnList.length ? ` — ${warnList.slice(0, 3).join(" | ")}` : ""}${warnList.length > 3 ? " …" : ""}`
          : ""

      const listOk = await load({ quiet: true })
      if (listOk) {
        toast({
          title: pv ? `Sync completed (${pv})` : "Sync completed",
          description: summary + warnSuffix,
        })
      } else {
        toast({
          variant: "destructive",
          title: "Sync ran on server; list could not refresh",
          description: `${summary}${warnSuffix} — Reload after fixing API (e.g. account list must not reference removed DB columns).`,
        })
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setSyncing(false)
    }
  }

  if (!hasAccountingCapability) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-muted-foreground">Accounting is not enabled for this workspace.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex flex-wrap items-center gap-2">
            <BookOpen className="size-7 text-muted-foreground" />
            Accounting
            {accountingProviderLabel ? (
              <span className="text-xl font-medium text-muted-foreground">| {accountingProviderLabel}</span>
            ) : null}
            {allAccountsIntegrated ? (
              <Check
                className="size-6 shrink-0 stroke-[2.5] text-emerald-600 dark:text-emerald-400"
                aria-label="All account mappings complete"
                title="All templates have the required Account / Product IDs mapped"
              />
            ) : null}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Map accounts to your accounting software.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={syncing || loading} onClick={() => void handleSync()}>
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span className="ml-2">Sync Account</span>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Account Mapping ({filtered.length})</CardTitle>
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
                <SelectItem value="product">Product</SelectItem>
                <SelectItem value="asset">Asset</SelectItem>
                <SelectItem value="liability">Liability</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expenses">Expenses</SelectItem>
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
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="size-5 animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-16">No accounts found</p>
          ) : (
            filtered.map((row) => {
              const ma = row._myAccount
              const badgeLabels = getBadgeLabelsForRow(row)
              const amber = mappedSummary(ma) === "Not set"
              const productBadgeTitle = getProductBadgeTitle(row, badgeLabels)
              return (
                <div
                  key={row._id || row.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{row.title || "—"}</span>
                      {badgeLabels.map((label) =>
                        label === "Product" ? (
                          <Badge
                            key="product"
                            variant="secondary"
                            className="font-medium"
                            title={productBadgeTitle}
                          >
                            Product
                          </Badge>
                        ) : label === "Mapped" ? (
                          <Badge
                            key="mapped"
                            variant="outline"
                            className="border-emerald-600/45 text-emerald-800 dark:text-emerald-400"
                            title="Account / product mapping saved for this client"
                          >
                            Mapped
                          </Badge>
                        ) : (
                          <Badge key={label} variant="outline">
                            {label}
                          </Badge>
                        )
                      )}
                    </div>
                    <p className={`text-sm ${amber ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"}`}>
                      {mappedSummary(ma)}
                    </p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => openEdit(row)}>
                    Edit
                  </Button>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing?.title ? `Update Account — ${editing.title}` : "Edit mapping"}
            </DialogTitle>
            <DialogDescription className="space-y-1.5">
              {editing && isProductOnlyPlatformCollectionRow(editing) ? (
                <>
                  <span className="block">Map this account to your accounting system.</span>
                  <span className="block text-muted-foreground">
                    No account type or separate chart account on this line — use Platform Collection for GL. Enter
                    Product ID only.
                  </span>
                </>
              ) : (
                <>
                  <span className="block">Map this account to your accounting system.</span>
                  {editing?._accountFromPlatformCollection ? (
                    <span className="block text-amber-700 dark:text-amber-400">
                      Account ID is Platform Collection — enter Product ID here; map Platform Collection on its row.
                    </span>
                  ) : null}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {editing && isProductOnlyPlatformCollectionRow(editing) ? (
              <div>
                <Label htmlFor="acc-product-id">
                  Product ID <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="acc-product-id"
                  value={formProductId}
                  onChange={(e) => setFormProductId(e.target.value)}
                  placeholder="Product / item ID from your accounting system"
                  className="mt-1"
                  required
                  autoComplete="off"
                />
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="acc-map-id">Account ID</Label>
                  <Input
                    id="acc-map-id"
                    value={formAccountId}
                    onChange={(e) => setFormAccountId(e.target.value)}
                    placeholder="e.g. Bukku account number"
                    disabled={!!editing?._accountFromPlatformCollection}
                    className="mt-1"
                  />
                </div>
                {editing &&
                (editing.is_product === true ||
                  editing.is_product === 1 ||
                  editing._accountFromPlatformCollection) ? (
                  <div>
                    <Label htmlFor="acc-product-id">
                      Product ID <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="acc-product-id"
                      value={formProductId}
                      onChange={(e) => setFormProductId(e.target.value)}
                      placeholder="Product / item ID from your accounting system"
                      className="mt-1"
                      required
                      autoComplete="off"
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
