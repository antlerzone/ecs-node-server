"use client"

import { useState, useEffect, useCallback } from "react"
import { Lock, Edit, Search, Filter, RefreshCw, Wifi, WifiOff, Radio, DoorOpen, LayoutGrid, Trash2, ChevronDown, Plus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "@/components/ui/use-toast"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  getSmartDoorList,
  getSmartDoorFilters,
  getSmartDoorLock,
  getSmartDoorGateway,
  getChildLockOptions,
  updateSmartDoorLock,
  updateSmartDoorGateway,
  unlockSmartDoor,
  previewSmartDoorSelection,
  insertSmartDoors,
  syncTTLockName,
  deleteSmartDoorLock,
  deleteSmartDoorGateway,
  getOnboardStatus,
  syncSmartDoorLocksFromTtlock,
  syncSingleSmartDoorLockFromTtlock,
  syncSingleSmartDoorGatewayFromTtlock,
} from "@/lib/operator-api"

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200] as const

/** User-facing text for sync-name failures (TTLock duplicate name, HTML error pages, etc.). */
function describeTtlockSyncNameError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/TTLOCK_DUPLICATE_GATEWAY_NAME|identical Name|already exists/i.test(msg)) {
    return "TTLock already has a gateway with this name. Choose a name that is not used by another gateway."
  }
  if (/TTLOCK_API_ERROR/i.test(msg)) {
    return "TTLock returned an error. Try again later or check your TTLock integration under company settings."
  }
  return msg.length > 280 ? `${msg.slice(0, 280)}…` : msg
}

type LockItem = {
  _id: string
  __type: "lock"
  lockId: string
  lockAlias: string
  brand?: string
  isOnline: boolean
  active: boolean
  electricQuantity?: number
  childmeter?: string[]
  childmeterAliases?: string[]
  parentLockAlias?: string | null
  hasGateway?: boolean
}
type GatewayItem = { _id: string; __type: "gateway"; gatewayId: string; gatewayName: string; isOnline: boolean; lockNum?: number }
type SmartDoorItem = LockItem | GatewayItem

type ChildRow = { id: string; doorId: string | null }

type PreviewItem = {
  _id?: string
  type?: string
  externalId?: string
  lockId?: number
  gatewayId?: string | null
  lockAlias?: string
  gatewayName?: string
  networkName?: string
  lockNum?: number
  electricQuantity?: number
  hasGateway?: boolean
  active?: boolean
  isOnline?: boolean
  provider?: string
  mergeAction?: "insert" | "update"
  bindingLabels?: string[]
  bindingHint?: string | null
}

/** Status only — device type is the tabs (All / Smart Door / Gateway), not this dropdown. */
const filterOptions = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
]

export default function SmartDoorPage() {
  const [deviceTypeTab, setDeviceTypeTab] = useState<"all" | "smartdoor" | "gateway">("all")
  const [search, setSearch] = useState("")
  const [filterType, setFilterType] = useState("ALL")
  const [filterProperty, setFilterProperty] = useState("ALL")

  useEffect(() => {
    if (filterType === "LOCK" || filterType === "GATEWAY") setFilterType("ALL")
  }, [filterType])
  const [detailOpen, setDetailOpen] = useState(false)
  const [currentItem, setCurrentItem] = useState<SmartDoorItem | null>(null)
  const [detailLockAlias, setDetailLockAlias] = useState("")
  const [detailGatewayName, setDetailGatewayName] = useState("")
  const [detailActive, setDetailActive] = useState(true)
  const [detailSaving, setDetailSaving] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncSaving, setSyncSaving] = useState(false)
  const [previewList, setPreviewList] = useState<Array<PreviewItem & { selected?: boolean; alias?: string }>>([])
  const [items, setItems] = useState<SmartDoorItem[]>([])
  const [properties, setProperties] = useState<{ value: string; label: string }[]>([{ value: "ALL", label: "All Properties" }])
  const [loading, setLoading] = useState(true)
  const [listPage, setListPage] = useState(1)
  const [listPageSize, setListPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [childOptions, setChildOptions] = useState<Array<{ label: string; value: string }>>([])
  const [childRows, setChildRows] = useState<ChildRow[]>([])
  const [unlockingId, setUnlockingId] = useState<string | null>(null)
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<SmartDoorItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [tableSyncing, setTableSyncing] = useState(false)
  /** Single-row TTLock sync (lock or gateway row `id`). */
  const [rowSyncingId, setRowSyncingId] = useState<string | null>(null)
  const [ttlockConnected, setTtlockConnected] = useState<boolean | null>(null)
  const [ttlockStatusLoading, setTtlockStatusLoading] = useState(false)

  const ttlockMissing = ttlockConnected === false
  const ttlockUnknown = ttlockConnected === null

  const loadData = useCallback(async () => {
    setLoading(true)
    // Tabs: All / Smart Door / Gateway. Second dropdown: All / Active / Inactive (locks only for active state).
    const filter =
      deviceTypeTab === "gateway"
        ? "GATEWAY"
        : deviceTypeTab === "smartdoor"
          ? filterType === "ACTIVE"
            ? "ACTIVE"
            : filterType === "INACTIVE"
              ? "INACTIVE"
              : "LOCK"
          : filterType === "ACTIVE"
            ? "ACTIVE"
            : filterType === "INACTIVE"
              ? "INACTIVE"
              : "ALL"
    const listOpts = { search, propertyId: filterProperty !== "ALL" ? filterProperty : undefined, filter, page: listPage, pageSize: listPageSize }
    console.log("[smart-door] loadData request opts=", JSON.stringify(listOpts))
    try {
      const [listRes, filtersRes] = await Promise.all([
        getSmartDoorList(listOpts),
        getSmartDoorFilters(),
      ])
      const listResAny = listRes as Record<string, unknown> | null
      const topKeys = listResAny ? Object.keys(listResAny) : []
      const fromItems = (listResAny?.items ?? []) as unknown[]
      const fromList = (listResAny?.list ?? []) as unknown[]
      const fromLockdetail = (listResAny?.lockdetail ?? listResAny?.lockDetail ?? []) as unknown[]
      const rawItems = (fromItems.length ? fromItems : fromList.length ? fromList : fromLockdetail) as Array<Record<string, unknown>>
      console.log("[smart-door] list response: filter=%s topKeys=%s items.length=%s list.length=%s lockdetail.length=%s rawItems.length=%s",
        listOpts.filter, topKeys, fromItems.length, fromList.length, fromLockdetail.length, rawItems.length)
      if (rawItems.length === 0 && listOpts.filter === "LOCK") {
        console.log("[smart-door] LOCK filter returned 0 items (lockdetail empty for this client). Full response keys:", listResAny ? Object.keys(listResAny) : [], "total=", listResAny?.total)
      }
      console.log("[smart-door] full listRes (for lockdetail debug)=", JSON.stringify(listResAny ?? null, null, 2).slice(0, 2000))
      if (rawItems.length > 0) {
        console.log("[smart-door] first raw item keys=", Object.keys(rawItems[0]), "sample=", rawItems[0])
      }
      const listItems = rawItems.map((r, idx) => {
        const __type = (r.__type ?? r.type ?? (r.lockId != null || r.lockid != null ? "lock" : "gateway")) as "lock" | "gateway"
        if (idx < 3) console.log("[smart-door] item", idx, "keys=", Object.keys(r), "__type=", __type, "lockId/lockid=", r.lockId ?? r.lockid)
        return {
          ...r,
          _id: r._id ?? r.id ?? "",
          __type,
        }
      }) as SmartDoorItem[]
      setItems(listItems)
      const totalP = (listResAny?.totalPages ?? 1) as number
      const totalC = (listResAny?.total ?? listItems.length) as number
      setTotalPages(totalP)
      setTotalCount(totalC)
      // Only auto-switch to "all" when on Smart Door tab and got 0 locks (so user sees gateways). Do not switch when on Gateway tab.
      const hasLocks = listItems.some((i) => i.__type === "lock")
      if (deviceTypeTab === "smartdoor" && !hasLocks && listItems.length > 0) {
        setDeviceTypeTab("all")
      }
      const props = ((filtersRes as { properties?: Array<{ value: string; label: string }> })?.properties || [])
      setProperties([{ value: "ALL", label: "All Properties" }, ...props])
    } catch (e) {
      console.error("[smart-door] loadData error", e)
    } finally {
      setLoading(false)
    }
  }, [search, filterProperty, filterType, listPage, listPageSize, deviceTypeTab])

  useEffect(() => { setListPage(1) }, [search, filterProperty, filterType, deviceTypeTab, listPageSize])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setTtlockStatusLoading(true)
      try {
        const res = await getOnboardStatus()
        if (cancelled) return
        setTtlockConnected(Boolean(res?.ttlockConnected))
      } catch (e) {
        if (cancelled) return
        console.error("[smart-door] getOnboardStatus error", e)
        setTtlockConnected(null)
      } finally {
        if (!cancelled) setTtlockStatusLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredItems = items
  // Server already returns only lockdetail (LOCK) or gatewaydetail (GATEWAY) or both (ALL) per request filter
  const displayItems = filteredItems

  const openDetail = async (item: SmartDoorItem) => {
    setCurrentItem(item)
    if (item.__type === "lock") {
      setDetailLockAlias((item as LockItem).lockAlias || "")
      setDetailActive((item as LockItem).active)
      setChildRows([])
      setChildOptions([])
      try {
        const [lockRes, optsRes] = await Promise.all([
          getSmartDoorLock(item._id),
          getChildLockOptions(item._id),
        ])
        const lockData = lockRes as { childmeter?: string[] } | null
        const childIds = lockData?.childmeter ?? (item as LockItem).childmeter ?? []
        setChildRows(childIds.map((doorId, idx) => ({ id: `row-${idx}-${doorId}`, doorId })))
        const opts = (optsRes as { options?: Array<{ label: string; value: string }> })?.options ?? []
        setChildOptions(opts)
      } catch (e) {
        console.error("[smart-door] openDetail fetch", e)
      }
    } else {
      setDetailGatewayName((item as GatewayItem).gatewayName || "")
    }
    setDetailOpen(true)
  }

  const handleDetailUpdate = async () => {
    if (!currentItem) return
    setDetailSaving(true)
    const prevLockAlias = currentItem.__type === "lock" ? (currentItem as LockItem).lockAlias : undefined
    const prevGatewayName = currentItem.__type === "gateway" ? (currentItem as GatewayItem).gatewayName : undefined
    try {
      if (currentItem.__type === "lock") {
        const childmeter = childRows.map((r) => r.doorId).filter(Boolean) as string[]
        const res = await updateSmartDoorLock(currentItem._id, { lockAlias: detailLockAlias, active: detailActive, childmeter })
        if ((res as { ok?: boolean })?.ok !== false) {
          setItems((prev) => prev.map((i) => (i._id === currentItem._id ? { ...i, lockAlias: detailLockAlias, active: detailActive, childmeter } : i)))
          if (detailLockAlias.trim() !== (prevLockAlias ?? "").trim()) {
            const lockId = (currentItem as LockItem).lockId
            if (lockId) await syncTTLockName({ type: "lock", externalId: String(lockId), name: detailLockAlias.trim() })
          }
          setDetailOpen(false)
        }
      } else {
        const res = await updateSmartDoorGateway(currentItem._id, { gatewayName: detailGatewayName })
        if ((res as { ok?: boolean })?.ok !== false) {
          setItems((prev) => prev.map((i) => (i._id === currentItem._id ? { ...i, gatewayName: detailGatewayName } : i)))
          if (detailGatewayName.trim() !== (prevGatewayName ?? "").trim()) {
            const gatewayId = (currentItem as GatewayItem).gatewayId
            if (gatewayId) await syncTTLockName({ type: "gateway", externalId: String(gatewayId), name: detailGatewayName.trim() })
          }
          setDetailOpen(false)
        }
      }
    } catch (e) {
      console.error(e)
      toast({
        variant: "destructive",
        title: "TTLock 名称同步失败",
        description: describeTtlockSyncNameError(e),
      })
    } finally {
      setDetailSaving(false)
    }
  }

  const handleUnlock = async (lockId: string) => {
    setUnlockingId(lockId)
    try {
      await unlockSmartDoor(lockId)
    } catch (e) {
      console.error(e)
    } finally {
      setUnlockingId(null)
    }
  }

  const handleConfirmDelete = async () => {
    const item = deleteConfirmItem
    if (!item) return
    setDeleting(true)
    try {
      if (item.__type === "lock") {
        const res = await deleteSmartDoorLock(item._id)
        if ((res as { ok?: boolean })?.ok !== false) {
          setItems((prev) => prev.filter((i) => i._id !== item._id))
          toast({ title: "Deleted", description: "Smart door removed from list." })
        } else {
          toast({ variant: "destructive", title: "Delete failed", description: (res as { reason?: string }).reason || "Unknown error" })
        }
      } else {
        const res = await deleteSmartDoorGateway(item._id)
        if ((res as { ok?: boolean })?.ok !== false) {
          setItems((prev) => prev.filter((i) => i._id !== item._id))
          toast({ title: "Deleted", description: "Gateway removed from list." })
        } else {
          toast({ variant: "destructive", title: "Delete failed", description: (res as { reason?: string }).reason || "Unknown error" })
        }
      }
      setDeleteConfirmItem(null)
    } catch (e) {
      console.error(e)
      toast({ variant: "destructive", title: "Delete failed", description: e instanceof Error ? e.message : String(e) })
    } finally {
      setDeleting(false)
    }
  }

  const handleSync = async () => {
    if (ttlockMissing || ttlockUnknown) {
      toast({
        variant: "destructive",
        title: "TTLock not connected",
        description: "Please connect TTLock in Operator > Company first.",
      })
      return
    }
    setSyncLoading(true)
    try {
      const res = await previewSmartDoorSelection()
      const list = (res?.list || []).map((item) => ({
        ...item,
        selected: false,
        alias: item.type === "gateway" ? (item.gatewayName || "") : (item.lockAlias || ""),
      }))
      setPreviewList(list)
    } catch (e) {
      console.error(e)
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setSyncLoading(false)
    }
  }

  const handleSyncSave = async () => {
    const selected = previewList.filter((p) => p.selected && (p.alias || "").trim())
    if (selected.length === 0) {
      toast({
        variant: "destructive",
        title: "Nothing to save",
        description: "Select at least 1 device and set its display name.",
      })
      return
    }
    setSyncSaving(true)
    try {
      const gateways: Array<{ gatewayId: number; gatewayName: string; networkName?: string; lockNum?: number; isOnline?: boolean; type?: string }> = []
      const locks: Array<{ lockId: number; lockAlias?: string; lockName?: string; electricQuantity?: number; type?: string; hasGateway?: boolean; brand?: string; active?: boolean; gatewayId?: string | null }> = []
      for (const p of selected) {
        const alias = (p.alias || "").trim()
        if (p.type === "gateway") {
          gateways.push({
            gatewayId: Number(p.externalId || p.gatewayId || 0),
            gatewayName: alias,
            networkName: p.networkName || "",
            lockNum: p.lockNum || 0,
            isOnline: !!p.isOnline,
            type: "Gateway",
          })
        } else {
          locks.push({
            lockId: Number(p.externalId || p.lockId || 0),
            lockAlias: alias,
            lockName: p.lockName || "",
            electricQuantity: p.electricQuantity || 0,
            type: "Smartlock",
            hasGateway: !!p.hasGateway,
            brand: "ttlock",
            active: Boolean(p.active),
            gatewayId: p.gatewayId || null,
          })
        }
      }
      const insertRes = await insertSmartDoors({ gateways, locks })
      if ((insertRes as { ok?: boolean; reason?: string } | null)?.ok === false) {
        throw new Error((insertRes as { reason?: string }).reason || "Save failed")
      }

      const renameJobs = [
        ...gateways.map((g) => syncTTLockName({ type: "gateway", externalId: String(g.gatewayId), name: g.gatewayName })),
        ...locks.map((l) => syncTTLockName({ type: "lock", externalId: String(l.lockId), name: (l.lockAlias || "").trim() })),
      ]
      const renameRes = await Promise.allSettled(renameJobs)
      const renameFailed = renameRes.filter((r) => r.status === "rejected")

      const nUp = selected.filter((p) => p.mergeAction === "update").length
      const nNew = selected.length - nUp
      toast({
        title: "Saved",
        description:
          nUp > 0 && nNew > 0
            ? `Saved: ${nNew} new, ${nUp} updated (same TTLock ID is never inserted twice).`
            : nUp > 0
              ? `Updated ${nUp} existing row(s).`
              : `Inserted ${locks.length} lock(s) and ${gateways.length} gateway(s).`,
      })
      if (renameFailed.length > 0) {
        const first = renameFailed[0]
        const reason =
          first.status === "rejected" && first.reason instanceof Error
            ? describeTtlockSyncNameError(first.reason)
            : "部分设备同步名称到 TTLock 失败，请刷新后重试或修改名称。"
        toast({
          variant: "destructive",
          title: "名称同步部分失败",
          description: `${renameFailed.length} 个设备未同步。${reason}`,
        })
      }
      setSyncOpen(false)
      setPreviewList([])
      await loadData()
    } catch (e) {
      console.error(e)
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setSyncSaving(false)
    }
  }

  const setPreviewItem = (idx: number, patch: Partial<PreviewItem & { selected?: boolean; alias?: string }>) => {
    setPreviewList((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  }

  const handleRefreshStatusFromTtlock = async () => {
    if (ttlockMissing || ttlockUnknown) {
      toast({
        variant: "destructive",
        title: "TTLock not connected",
        description: "Please connect TTLock in Operator > Company first.",
      })
      return
    }
    setTableSyncing(true)
    try {
      const res = await syncSmartDoorLocksFromTtlock()
      if ((res as { ok?: boolean })?.ok === false) {
        toast({ variant: "destructive", title: "Refresh failed", description: (res as { reason?: string }).reason || "Unknown error" })
        return
      }
      const lc = (res as { lockCount?: number }).lockCount
      const gc = (res as { gatewayCount?: number }).gatewayCount
      toast({
        title: "Status updated",
        description:
          typeof lc === "number" && typeof gc === "number"
            ? `TTLock: ${lc} lock(s) merged (battery & gateway link), ${gc} gateway row(s) merged (online & lock count).`
            : "Lock battery, gateway link, and gateway status updated from TTLock.",
      })
      await loadData()
    } catch (e) {
      console.error(e)
      toast({ variant: "destructive", title: "Refresh failed", description: e instanceof Error ? e.message : String(e) })
    } finally {
      setTableSyncing(false)
    }
  }

  const describeSingleSyncError = (reason: string | undefined) => {
    if (reason === "TTLOCK_LOCK_NOT_FOUND") return "This lock was not found on TTLock for the current account."
    if (reason === "TTLOCK_GATEWAY_NOT_FOUND") return "This gateway was not found on TTLock for the current account."
    return reason || "Unknown error"
  }

  const listOffset = (listPage - 1) * listPageSize
  let rangeStart = 0
  let rangeEnd = 0
  if (totalCount > 0 && displayItems.length > 0) {
    rangeStart = listOffset + 1
    rangeEnd = Math.min(listOffset + displayItems.length, totalCount)
  }

  const handleSyncSingleLockRow = async (lockDetailId: string) => {
    setRowSyncingId(lockDetailId)
    try {
      const res = await syncSingleSmartDoorLockFromTtlock(lockDetailId)
      if ((res as { ok?: boolean })?.ok === false) {
        toast({
          variant: "destructive",
          title: "Sync failed",
          description: describeSingleSyncError((res as { reason?: string }).reason),
        })
        return
      }
      toast({ title: "Updated", description: "Synced this lock from TTLock (battery, gateway link, name)." })
      await loadData()
    } catch (e) {
      console.error(e)
      toast({ variant: "destructive", title: "Sync failed", description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRowSyncingId(null)
    }
  }

  const handleSyncSingleGatewayRow = async (gatewayDetailId: string) => {
    setRowSyncingId(gatewayDetailId)
    try {
      const res = await syncSingleSmartDoorGatewayFromTtlock(gatewayDetailId)
      if ((res as { ok?: boolean })?.ok === false) {
        toast({
          variant: "destructive",
          title: "Sync failed",
          description: describeSingleSyncError((res as { reason?: string }).reason),
        })
        return
      }
      toast({ title: "Updated", description: "Synced this gateway from TTLock (online, lock count, name)." })
      await loadData()
    } catch (e) {
      console.error(e)
      toast({ variant: "destructive", title: "Sync failed", description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRowSyncingId(null)
    }
  }

  return (
    <main className="p-3 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Smart Door Setting</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage smart locks and gateway devices</p>
          {ttlockStatusLoading ? (
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-1">Checking TTLock connection status…</p>
          ) : null}
          {ttlockMissing ? (
            <p className="text-[11px] sm:text-xs text-amber-700 dark:text-amber-200 mt-1">
              TTLock is not connected. Add Lock and Sync All are disabled until TTLock is connected in Company.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button
            type="button"
            size="sm"
            className="gap-2"
            style={{ background: "var(--brand)" }}
            onClick={() => {
              if (ttlockMissing || ttlockUnknown) {
                toast({
                  variant: "destructive",
                  title: "TTLock not connected",
                  description: "Please connect TTLock in Operator > Company first.",
                })
                return
              }
              setSyncOpen(true)
              setPreviewList([])
            }}
            title="Import locks or gateways from TTLock that are not in the list yet"
            disabled={ttlockMissing || ttlockUnknown}
          >
            <Plus size={14} />
            Add Lock
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={handleRefreshStatusFromTtlock}
            disabled={tableSyncing || loading || ttlockMissing || ttlockUnknown}
            title="Sync all existing devices from TTLock (battery, gateway links, gateway online status)"
          >
            <RefreshCw size={14} className={tableSyncing ? "animate-spin" : ""} />
            {tableSyncing ? "Syncing…" : "Sync All"}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Filters */}
        <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <Input placeholder="Search device name..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 text-sm" />
                </div>
                <Select value={filterProperty} onValueChange={setFilterProperty}>
                  <SelectTrigger className="w-full sm:w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-full sm:w-32">
                    <Filter size={14} className="mr-2 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filterOptions.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
        </Card>

        {/* Device List */}
        <Card>
            <CardHeader className="p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 min-w-0">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    {deviceTypeTab === "all" ? <LayoutGrid size={18} className="text-muted-foreground" /> : deviceTypeTab === "smartdoor" ? <Lock size={18} /> : <Radio size={18} />}
                    {deviceTypeTab === "all" ? "All devices" : deviceTypeTab === "smartdoor" ? "Smart Doors" : "Gateways"} ({totalCount})
                  </CardTitle>
                </div>
                <Tabs value={deviceTypeTab} onValueChange={(v) => setDeviceTypeTab(v as "all" | "smartdoor" | "gateway")} className="w-auto">
                  <TabsList className="h-8 text-xs">
                    <TabsTrigger value="all" className="px-3">All</TabsTrigger>
                    <TabsTrigger value="smartdoor" className="px-3">Smart Door</TabsTrigger>
                    <TabsTrigger value="gateway" className="px-3">Gateway</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="space-y-2 sm:space-y-3">
                {loading ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
                ) : displayItems.length === 0 ? (
                  <div className="text-center py-8 space-y-1">
                    <p className="text-sm text-muted-foreground">
                      No {deviceTypeTab === "all" ? "devices" : deviceTypeTab === "smartdoor" ? "smart doors" : "gateways"} found
                    </p>
                    {deviceTypeTab === "smartdoor" && items.some((i) => i.__type === "gateway") && (
                      <p className="text-xs text-muted-foreground">You only have gateways. Use the <strong>All</strong> or <strong>Gateway</strong> tab to manage them.</p>
                    )}
                  </div>
                ) : (
                  <>
                    {(deviceTypeTab === "all" || deviceTypeTab === "smartdoor") && (() => {
                      const lowBatteryLocks = displayItems.filter((i) => i.__type === "lock" && ((i as LockItem).electricQuantity ?? 0) < 20)
                      return lowBatteryLocks.length > 0 ? (
                        <div className="mb-3 p-3 rounded-lg bg-destructive/15 border border-destructive/40 text-destructive text-sm font-medium">
                          ⚠ {lowBatteryLocks.length} lock{lowBatteryLocks.length > 1 ? "s" : ""} with low or no battery (&lt;20%). Please replace batteries.
                        </div>
                      ) : null
                    })()}
                    {displayItems.map((item) => {
                    const isLock = item.__type === "lock"
                    const lock = item as LockItem
                    const gateway = item as GatewayItem
                    const battery = isLock && lock.electricQuantity != null ? lock.electricQuantity : null
                    const isLowBattery = isLock && (battery == null || battery < 20)
                    const lockNum = !isLock && gateway.lockNum != null ? gateway.lockNum : null
                    
                    return (
                      <div
                        key={item._id}
                        className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-3 sm:p-4 border rounded-lg ${isLowBattery ? "border-destructive bg-destructive/10" : "border-border"}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isLock ? <Lock size={16} className="text-muted-foreground" /> : <Radio size={16} className="text-muted-foreground" />}
                            <h3 className="font-semibold text-sm sm:text-base text-foreground">
                              {isLock ? lock.lockAlias : gateway.gatewayName}
                            </h3>
                            {isLock && (
                              <Badge variant={isLowBattery ? "destructive" : "outline"} className="text-xs">
                                Battery: {typeof (lock.electricQuantity) === "number" ? `${lock.electricQuantity}%` : "N/A"}
                              </Badge>
                            )}
                            {isLock ? (
                              lock.hasGateway ? (
                                <Badge className="text-xs border-transparent bg-emerald-600 text-white hover:bg-emerald-600">
                                  <Radio size={10} className="mr-1" />
                                  Gateway
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs text-muted-foreground">
                                  No gateway
                                </Badge>
                              )
                            ) : (
                              <Badge variant={item.isOnline ? "default" : "secondary"} className="text-xs">
                                {item.isOnline ? <><Wifi size={10} className="mr-1" /> Online</> : <><WifiOff size={10} className="mr-1" /> Offline</>}
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-xs">{isLock ? "Smart Door" : "Gateway"}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {isLock ? `${lock.lockId}` : `${gateway.gatewayId}${lockNum != null ? ` · ${lockNum} locks connected` : ""}`}
                          </p>
                          {isLock && (lock.parentLockAlias || lock.childmeter?.length) ? (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {lock.parentLockAlias ? `Child lock | connect with lock ${lock.parentLockAlias}` : lock.childmeter?.length ? `Parent Lock | connect with lock ${(lock.childmeterAliases ?? lock.childmeter ?? []).join(", ")}` : ""}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          {isLock ? (
                            <div className="inline-flex rounded-md shadow-sm" role="group">
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-r-none border-r-0"
                                onClick={() => handleUnlock(item._id)}
                                disabled={!!unlockingId}
                                title="Remote unlock"
                              >
                                <DoorOpen size={14} />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" className="rounded-l-none px-2" aria-label="Lock actions">
                                    <ChevronDown size={14} />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-[12rem]">
                                  <DropdownMenuItem onClick={() => openDetail(item)}>
                                    <Edit size={14} />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => void handleSyncSingleLockRow(item._id)}
                                    disabled={!!rowSyncingId || tableSyncing || loading}
                                  >
                                    <RefreshCw size={14} className={rowSyncingId === item._id ? "animate-spin" : ""} />
                                    Sync lock
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => setDeleteConfirmItem(item)}
                                  >
                                    <Trash2 size={14} />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          ) : (
                            <div className="inline-flex rounded-md shadow-sm" role="group">
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-r-none border-r-0"
                                onClick={() => openDetail(item)}
                                title="View / Edit"
                              >
                                <Edit size={14} />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" className="rounded-l-none px-2" aria-label="Gateway actions">
                                    <ChevronDown size={14} />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-[12rem]">
                                  <DropdownMenuItem
                                    onClick={() => void handleSyncSingleGatewayRow(item._id)}
                                    disabled={!!rowSyncingId || tableSyncing || loading}
                                  >
                                    <RefreshCw size={14} className={rowSyncingId === item._id ? "animate-spin" : ""} />
                                    Sync gateway
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => setDeleteConfirmItem(item)}
                                  >
                                    <Trash2 size={14} />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  </>
                )}
              </div>
              {!loading && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-4 border-t mt-4 flex-wrap">
                  <p className="text-sm text-muted-foreground order-2 sm:order-1">
                    Showing {rangeStart}–{rangeEnd} of {totalCount}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 order-1 sm:order-2 sm:ml-auto">
                    <span className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">Rows per page</span>
                    <Select
                      value={String(listPageSize)}
                      onValueChange={(v) => setListPageSize(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-[4.5rem] text-xs sm:text-sm" aria-label="Rows per page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1 sm:gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setListPage((p) => Math.max(1, p - 1))}
                        disabled={totalCount === 0 || listPage <= 1 || totalPages <= 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs sm:text-sm text-muted-foreground px-1 tabular-nums">
                        Page {totalCount === 0 ? 1 : listPage} / {totalCount === 0 ? 1 : Math.max(1, totalPages)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setListPage((p) => Math.min(totalPages, p + 1))}
                        disabled={totalCount === 0 || listPage >= totalPages || totalPages <= 1}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
      </div>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {currentItem?.__type === "lock" ? "Lock Details" : "Gateway Details"}
            </DialogTitle>
            <DialogDescription>View and update device configuration</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {currentItem?.__type === "lock" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Lock ID (read-only)</Label>
                    <Input value={(currentItem as LockItem).lockId} readOnly className="bg-muted" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input value={detailLockAlias} onChange={(e) => setDetailLockAlias(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Battery</Label>
                    <Input value={`${(currentItem as LockItem).electricQuantity ?? 0}%`} readOnly className="bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label>Gateway</Label>
                    {(currentItem as LockItem).hasGateway ? (
                      <Badge className="border-transparent bg-emerald-600 text-white hover:bg-emerald-600">Connected</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">Not connected</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={detailActive} onCheckedChange={setDetailActive} />
                  <Label>Active</Label>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Child locks</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setChildRows((r) => [...r, { id: `row-${Date.now()}`, doorId: null }])}
                    >
                      Add child
                    </Button>
                  </div>
                  {childRows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No child locks. Add to link locks under this parent.</p>
                  ) : (
                    <div className="space-y-2 border rounded p-2 bg-muted/30">
                      {childRows.map((row) => (
                        <div key={row.id} className="flex items-center gap-2">
                          <Select
                            value={row.doorId ?? ""}
                            onValueChange={(v) => setChildRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, doorId: v || null } : r)))}
                          >
                            <SelectTrigger className="flex-1 text-sm">
                              <SelectValue placeholder="Select lock" />
                            </SelectTrigger>
                            <SelectContent>
                              {childOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setChildRows((prev) => prev.filter((r) => r.id !== row.id))}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            {currentItem?.__type === "gateway" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Gateway ID (read-only)</Label>
                    <Input value={(currentItem as GatewayItem).gatewayId} readOnly className="bg-muted" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input value={detailGatewayName} onChange={(e) => setDetailGatewayName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Connected Locks</Label>
                  <Input value={String((currentItem as GatewayItem).lockNum ?? 0)} readOnly className="bg-muted" />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleDetailUpdate} disabled={detailSaving}>
              {detailSaving ? "Updating..." : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Smart Door Dialog – connect in TTLock app, then Sync to add */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add devices from TTLock</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={handleSync}
              disabled={syncLoading || ttlockMissing || ttlockUnknown}
            >
              <RefreshCw size={14} className={syncLoading ? "animate-spin" : ""} />
              {syncLoading ? "Syncing..." : "Sync"}
            </Button>
            {previewList.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-end">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={previewList.length > 0 && previewList.every((p) => p.selected)}
                      onCheckedChange={(v) => {
                        const checked = !!v
                        setPreviewList((prev) => prev.map((p) => ({ ...p, selected: checked })))
                      }}
                    />
                    Select All
                  </label>
                </div>
                <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
                  {previewList.map((p, idx) => (
                    <div key={p._id || idx} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Checkbox
                          checked={!!p.selected}
                          onCheckedChange={(v) => setPreviewItem(idx, { selected: !!v })}
                        />
                        <span className="w-20 shrink-0 text-sm font-medium">{p.type === "gateway" ? "Gateway" : "Lock"}</span>
                        <Input
                          className="min-w-0 flex-1 text-sm"
                          placeholder="Display name"
                          value={p.alias ?? ""}
                          onChange={(e) => setPreviewItem(idx, { alias: e.target.value })}
                        />
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                          {p.type === "gateway" ? `ID: ${p.externalId || p.gatewayId}` : `ID: ${p.externalId || p.lockId}`}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pl-8 sm:pl-0">
                        <span className="text-xs text-muted-foreground sm:hidden">
                          {p.type === "gateway" ? `ID: ${p.externalId || p.gatewayId}` : `ID: ${p.externalId || p.lockId}`}
                        </span>
                        {p.mergeAction === "update" ? (
                          <Badge variant="secondary" className="max-w-full whitespace-normal text-left text-xs font-normal">
                            {p.bindingHint || `Already linked: ${(p.bindingLabels || []).join(" · ")}`}
                          </Badge>
                        ) : p.mergeAction === "insert" ? (
                          <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                            New
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncOpen(false)}>Cancel</Button>
            <Button
              style={{ background: "var(--brand)" }}
              onClick={handleSyncSave}
              disabled={syncSaving || ttlockMissing || ttlockUnknown || previewList.filter((p) => p.selected && (p.alias || "").trim()).length === 0}
            >
              {syncSaving ? "Saving..." : "Save Selected"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmItem} onOpenChange={(open) => { if (!open) setDeleteConfirmItem(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm delete?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmItem && (
                <>
                  Permanently remove{" "}
                  <strong>{deleteConfirmItem.__type === "lock" ? (deleteConfirmItem as LockItem).lockAlias : (deleteConfirmItem as GatewayItem).gatewayName}</strong>
                  {" "}from the list. {deleteConfirmItem.__type === "lock" ? "Room/property links to this lock will be cleared." : "Locks linked to this gateway will be unlinked."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={deleting} onClick={handleConfirmDelete}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
