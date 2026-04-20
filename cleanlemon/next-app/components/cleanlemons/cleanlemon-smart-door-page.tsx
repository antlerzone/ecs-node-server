"use client"

import { useState, useEffect, useCallback } from "react"
import { Lock, Edit, Search, Filter, RefreshCw, Wifi, WifiOff, Radio, DoorOpen, LayoutGrid, Trash2, Info, AlertTriangle, KeyRound, ScrollText } from "lucide-react"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"
import type { CleanlemonSmartDoorScope, OperatorTtlockAccountRow } from "@/lib/cleanlemon-api"
import {
  clnGetSmartDoorList,
  clnGetSmartDoorFilters,
  clnGetSmartDoorLock,
  clnGetSmartDoorGateway,
  clnGetChildLockOptions,
  clnUpdateSmartDoorLock,
  clnUpdateSmartDoorGateway,
  clnUnlockSmartDoor,
  clnViewSmartDoorPassword,
  clnGetSmartDoorUnlockLogs,
  clnPreviewSmartDoorSelection,
  clnInsertSmartDoors,
  clnSyncTTLockName,
  clnDeleteSmartDoorLock,
  clnDeleteSmartDoorGateway,
  clnSyncSmartDoorLocksFromTtlock,
  fetchOperatorTtlockOnboardStatus,
} from "@/lib/cleanlemon-api"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { getEffectiveOperatorId } from "@/lib/cleanlemon-effective-operator-id"

const LIST_PAGE_SIZE = 20

/** User-facing text for sync-name failures (TTLock duplicate name, HTML error pages, etc.). */
function describeTtlockSyncNameError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/TTLOCK_DUPLICATE_GATEWAY_NAME|identical Name|already exists/i.test(msg)) {
    return "TTLock 上已有同名网关，请换一个不与其它网关重复的名称。"
  }
  if (/TTLOCK_API_ERROR/i.test(msg)) {
    return "TTLock 云端暂时返回异常，请稍后重试。若持续失败，请检查公司下的 TTLock 集成。"
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
  /** B2B client master row — operator may manage but not delete until property/client disconnect. */
  clnClientdetailId?: string
  ownedByClientName?: string
  ownedByClientEmail?: string
  needsGatewayDbLink?: boolean
  operatorCanDelete?: boolean
  /** TTLock multi-account slot (operator Company → Integration). */
  clnTtlockSlot?: number
  /** Operator list enrichment: property door policy */
  operatorDoorAccessMode?: string
  hasBookingToday?: boolean
  clnPropertyId?: string
}
type GatewayItem = {
  _id: string
  __type: "gateway"
  gatewayId: string
  gatewayName: string
  isOnline: boolean
  lockNum?: number
  clnClientdetailId?: string
  ownedByClientName?: string
  ownedByClientEmail?: string
  operatorCanDelete?: boolean
  clnTtlockSlot?: number
}
type SmartDoorItem = LockItem | GatewayItem

function ownedByClientLabel(item: SmartDoorItem): string | null {
  const cid = "clnClientdetailId" in item && item.clnClientdetailId ? String(item.clnClientdetailId).trim() : ""
  if (!cid) return null
  const name = String((item as LockItem).ownedByClientName || (item as GatewayItem).ownedByClientName || "").trim()
  const em = String((item as LockItem).ownedByClientEmail || (item as GatewayItem).ownedByClientEmail || "").trim()
  if (name) return name
  if (em) return em
  return `${cid.slice(0, 8)}…`
}

function operatorMayDelete(item: SmartDoorItem, scope: CleanlemonSmartDoorScope): boolean {
  if (scope !== "operator") return true
  if (item.operatorCanDelete === false) return false
  return true
}

function operatorRemoteUnlockAllowed(lock: LockItem): boolean {
  const gwOk = !!lock.hasGateway && !lock.needsGatewayDbLink
  const mode = String(lock.operatorDoorAccessMode || "temporary_password_only").trim().toLowerCase()
  if (mode === "fixed_password") return false
  if (!gwOk) return false
  if (mode === "full_access") return true
  if (mode === "working_date_only" || mode === "temporary_password_only") return !!lock.hasBookingToday
  return false
}

function operatorViewPasswordAllowed(lock: LockItem): boolean {
  const gwOk = !!lock.hasGateway && !lock.needsGatewayDbLink
  const mode = String(lock.operatorDoorAccessMode || "temporary_password_only").trim().toLowerCase()
  if (mode === "fixed_password") return true
  if (!gwOk) return false
  if (mode === "full_access") return true
  if (mode === "working_date_only" || mode === "temporary_password_only") return !!lock.hasBookingToday
  return false
}

/** Shown when operator delete is disabled (native title does not fire on disabled buttons). */
function operatorDeleteDisabledHint(item: SmartDoorItem): string {
  return item.__type === "lock"
    ? "Only deleting or unlinking the property from the client removes this lock — it cannot be deleted here."
    : "Only deleting or unlinking the property from the client removes this gateway — it cannot be deleted here."
}

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

const filterOptions = [
  { value: "ALL", label: "All" },
  { value: "LOCK", label: "Smart Door" },
  { value: "GATEWAY", label: "Gateway" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
]

function resolvePortalOperatorContextId(user: { operatorId?: string; cleanlemons?: { operatorChoices?: Array<{ operatorId?: string }> } } | null): string {
  const direct = String(user?.operatorId || "").trim()
  if (direct) return direct
  const first = user?.cleanlemons?.operatorChoices?.[0]?.operatorId
  return String(first || "").trim()
}

/** Operator Smart Door: JWT user + operatorChoices, then OAuth/layout persisted `cleanlemons_active_operator_id`. */
function resolveOperatorSmartDoorContextId(
  user: { operatorId?: string; cleanlemons?: { operatorChoices?: Array<{ operatorId?: string }> } } | null
): string {
  const direct = String(user?.operatorId || "").trim()
  if (direct) return direct
  const first = user?.cleanlemons?.operatorChoices?.[0]?.operatorId
  if (first) return String(first).trim()
  return getEffectiveOperatorId(user, "")
}

export function CleanlemonSmartDoorPage({ scope }: { scope: CleanlemonSmartDoorScope }) {
  const { user, isLoading: authLoading } = useAuth()
  const email = String(user?.email || "").trim().toLowerCase()
  const operatorId =
    scope === "operator" ? resolveOperatorSmartDoorContextId(user) : resolvePortalOperatorContextId(user)
  /** Client portal: `operatorId` may be empty when JWT is valid — API resolves cln_clientdetail by email. */
  const ctx = { email, operatorId }

  const [deviceTypeTab, setDeviceTypeTab] = useState<"all" | "smartdoor" | "gateway">("all")
  const [search, setSearch] = useState("")
  const [filterType, setFilterType] = useState("ALL")
  const [filterProperty, setFilterProperty] = useState("ALL")
  const [detailOpen, setDetailOpen] = useState(false)
  const [currentItem, setCurrentItem] = useState<SmartDoorItem | null>(null)
  const [detailLockAlias, setDetailLockAlias] = useState("")
  const [detailGatewayName, setDetailGatewayName] = useState("")
  const [detailActive, setDetailActive] = useState(true)
  const [detailSaving, setDetailSaving] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncSaving, setSyncSaving] = useState(false)
  const [importConfirmOpen, setImportConfirmOpen] = useState(false)
  const [previewList, setPreviewList] = useState<Array<PreviewItem & { selected?: boolean; alias?: string }>>([])
  const [items, setItems] = useState<SmartDoorItem[]>([])
  const [properties, setProperties] = useState<{ value: string; label: string }[]>([{ value: "ALL", label: "All Properties" }])
  const [loading, setLoading] = useState(true)
  const [listPage, setListPage] = useState(1)
  const [listPageSize] = useState(LIST_PAGE_SIZE)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [childOptions, setChildOptions] = useState<Array<{ label: string; value: string }>>([])
  const [childRows, setChildRows] = useState<ChildRow[]>([])
  const [unlockingId, setUnlockingId] = useState<string | null>(null)
  const [passwordBusyId, setPasswordBusyId] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [logLock, setLogLock] = useState<LockItem | null>(null)
  const [logFrom, setLogFrom] = useState("")
  const [logTo, setLogTo] = useState("")
  const [logLoading, setLogLoading] = useState(false)
  const [logRows, setLogRows] = useState<Array<Record<string, unknown>>>([])
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<SmartDoorItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [tableSyncing, setTableSyncing] = useState(false)
  const [ttlockConnected, setTtlockConnected] = useState<boolean | null>(null)
  const [ttlockStatusLoading, setTtlockStatusLoading] = useState(false)
  const [operatorTtlockAccounts, setOperatorTtlockAccounts] = useState<OperatorTtlockAccountRow[]>([])
  const [selectedOperatorTtlockSlot, setSelectedOperatorTtlockSlot] = useState(0)
  const [syncAccountPickOpen, setSyncAccountPickOpen] = useState(false)
  const [syncAccountPickSlot, setSyncAccountPickSlot] = useState(0)

  const operatorTtlockMissing = scope === "operator" && ttlockConnected === false
  const operatorTtlockUnknown = scope === "operator" && ttlockConnected === null

  const smartDoorPageInfoHint =
    scope === "operator"
      ? "Manage smart locks and gateway devices.\n\nEach row shows “Owned by client: …” when the device is tied to a B2B client property, or “Manual” when it belongs to your operator TTLock only. Client-owned rows cannot be deleted here until the property is disconnected from that client. After a client approves your link, we sync their TTLock data so gateway links update in the database."
      : "Manage smart locks and gateway devices."

  const ttlockDisconnectedHint =
    "TTLock is not connected for this operator. Connect TTLock in Company first; Sync Lock and TTLock refresh are disabled."

  const ttlockCheckingHint = "Checking TTLock connection status…"

  const loadData = useCallback(async () => {
    setLoading(true)
    // Smart Door = lockdetail only (LOCK), Gateway = gatewaydetail only (GATEWAY), All = use dropdown filter (ALL/ACTIVE/INACTIVE)
    const filter = deviceTypeTab === "smartdoor" ? "LOCK" : deviceTypeTab === "gateway" ? "GATEWAY" : (filterType !== "ALL" ? filterType : "ALL")
    const listOpts = { search, propertyId: filterProperty !== "ALL" ? filterProperty : undefined, filter, page: listPage, pageSize: listPageSize }
    console.log("[smart-door] loadData request opts=", JSON.stringify(listOpts))
    try {
      const [listRes, filtersRes] = await Promise.all([
        clnGetSmartDoorList(scope, ctx, listOpts),
        clnGetSmartDoorFilters(scope, ctx),
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
        const slotRaw = r.clnTtlockSlot ?? r.cln_ttlock_slot
        return {
          ...r,
          _id: r._id ?? r.id ?? "",
          __type,
          clnTtlockSlot: slotRaw != null && slotRaw !== "" ? Number(slotRaw) : undefined,
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
  }, [search, filterProperty, filterType, listPage, listPageSize, deviceTypeTab, scope, email, operatorId])

  useEffect(() => { setListPage(1) }, [search, filterProperty, filterType, deviceTypeTab])

  useEffect(() => {
    if (!email) return
    if (scope === "operator" && !operatorId) return
    loadData()
  }, [loadData, scope, operatorId, email])

  useEffect(() => {
    if (scope !== "operator") return
    if (!operatorId) return
    let cancelled = false
    ;(async () => {
      setTtlockStatusLoading(true)
      try {
        const res = await fetchOperatorTtlockOnboardStatus(operatorId)
        if (cancelled) return
        setTtlockConnected(Boolean(res?.ttlockConnected))
        const acc = Array.isArray(res?.accounts) ? res.accounts : []
        setOperatorTtlockAccounts(acc)
        const connected = acc.filter((a) => a.connected)
        if (connected.length > 0) {
          setSelectedOperatorTtlockSlot((prev) =>
            connected.some((c) => c.slot === prev) ? prev : connected[0].slot
          )
        }
      } catch (e) {
        if (cancelled) return
        console.error("[smart-door] fetchOperatorTtlockOnboardStatus error", e)
        // Fail-safe: unknown status should block TTLock sync actions to avoid backend 500.
        setTtlockConnected(null)
      } finally {
        if (!cancelled) setTtlockStatusLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [scope, operatorId])

  const filteredItems = items
  // Server already returns only lockdetail (LOCK) or gatewaydetail (GATEWAY) or both (ALL) per request filter
  const displayItems = filteredItems

  const connectedOperatorTtlockAccounts = operatorTtlockAccounts.filter((a) => a.connected)

  const detailReadOnlyOperator =
    scope === "operator" && currentItem != null && Boolean(ownedByClientLabel(currentItem))

  const openDetail = async (item: SmartDoorItem) => {
    setCurrentItem(item)
    if (item.__type === "lock") {
      setDetailLockAlias((item as LockItem).lockAlias || "")
      setDetailActive((item as LockItem).active)
      setChildRows([])
      setChildOptions([])
      try {
        const [lockRes, optsRes] = await Promise.all([
          clnGetSmartDoorLock(scope, ctx, item._id),
          clnGetChildLockOptions(scope, ctx, item._id),
        ])
        const lockData = lockRes as LockItem | null
        if (lockData && lockData._id) {
          setCurrentItem({ ...item, ...lockData })
        }
        const childIds = lockData?.childmeter ?? (item as LockItem).childmeter ?? []
        setChildRows(childIds.map((doorId, idx) => ({ id: `row-${idx}-${doorId}`, doorId })))
        const opts = (optsRes as { options?: Array<{ label: string; value: string }> })?.options ?? []
        setChildOptions(opts)
      } catch (e) {
        console.error("[smart-door] openDetail fetch", e)
      }
    } else {
      setDetailGatewayName((item as GatewayItem).gatewayName || "")
      try {
        const gwRes = await clnGetSmartDoorGateway(scope, ctx, item._id)
        const g = gwRes as GatewayItem | null
        if (g && g._id) {
          setCurrentItem({ ...item, ...g })
        }
      } catch (e) {
        console.error("[smart-door] openDetail gateway fetch", e)
      }
    }
    setDetailOpen(true)
  }

  const handleDetailUpdate = async () => {
    if (!currentItem) return
    if (scope === "operator" && ownedByClientLabel(currentItem)) {
      toast.error("Cannot edit", { description: "This device is owned by a client. Editing is only available in the client portal." })
      return
    }
    setDetailSaving(true)
    const prevLockAlias = currentItem.__type === "lock" ? (currentItem as LockItem).lockAlias : undefined
    const prevGatewayName = currentItem.__type === "gateway" ? (currentItem as GatewayItem).gatewayName : undefined
    try {
      if (currentItem.__type === "lock") {
        const childmeter = childRows.map((r) => r.doorId).filter(Boolean) as string[]
        const res = await clnUpdateSmartDoorLock(scope, ctx, currentItem._id, { lockAlias: detailLockAlias, active: detailActive, childmeter })
        if ((res as { ok?: boolean })?.ok !== false) {
          setItems((prev) => prev.map((i) => (i._id === currentItem._id ? { ...i, lockAlias: detailLockAlias, active: detailActive, childmeter } : i)))
          if (detailLockAlias.trim() !== (prevLockAlias ?? "").trim()) {
            const lockId = (currentItem as LockItem).lockId
            const slot = (currentItem as LockItem).clnTtlockSlot
            if (lockId) {
              await clnSyncTTLockName(scope, ctx, {
                type: "lock",
                externalId: String(lockId),
                name: detailLockAlias.trim(),
                ...(scope === "operator" && slot != null && Number.isFinite(Number(slot)) ? { ttlockSlot: Number(slot) } : {}),
              })
            }
          }
          setDetailOpen(false)
        }
      } else {
        const res = await clnUpdateSmartDoorGateway(scope, ctx, currentItem._id, { gatewayName: detailGatewayName })
        if ((res as { ok?: boolean })?.ok !== false) {
          setItems((prev) => prev.map((i) => (i._id === currentItem._id ? { ...i, gatewayName: detailGatewayName } : i)))
          if (detailGatewayName.trim() !== (prevGatewayName ?? "").trim()) {
            const gatewayId = (currentItem as GatewayItem).gatewayId
            const slot = (currentItem as GatewayItem).clnTtlockSlot
            if (gatewayId) {
              await clnSyncTTLockName(scope, ctx, {
                type: "gateway",
                externalId: String(gatewayId),
                name: detailGatewayName.trim(),
                ...(scope === "operator" && slot != null && Number.isFinite(Number(slot)) ? { ttlockSlot: Number(slot) } : {}),
              })
            }
          }
          setDetailOpen(false)
        }
      }
    } catch (e) {
      console.error(e)
      toast.error("TTLock 名称同步失败", { description: describeTtlockSyncNameError(e) })
    } finally {
      setDetailSaving(false)
    }
  }

  const handleUnlock = async (lock: LockItem) => {
    const lockId = lock._id
    if (scope === "operator" && !operatorRemoteUnlockAllowed(lock)) {
      toast.error("Cannot open remotely", {
        description: "Check operator door mode, gateway link, and today’s booking (if applicable).",
      })
      return
    }
    setUnlockingId(lockId)
    try {
      await clnUnlockSmartDoor(scope, ctx, lockId, {
        ttlockSlot: lock.clnTtlockSlot != null && Number.isFinite(Number(lock.clnTtlockSlot)) ? Number(lock.clnTtlockSlot) : undefined,
      })
      toast.success("Unlock sent")
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      const map: Record<string, string> = {
        OPERATOR_DOOR_USE_PASSWORD: "This property uses a fixed password — use “View password” instead of remote open.",
        OPERATOR_DOOR_GATEWAY_REQUIRED: "Link the lock to a gateway in the database before remote unlock.",
        OPERATOR_DOOR_NO_BOOKING_TODAY: "Remote unlock is only allowed on days with a scheduled job (Malaysia date).",
      }
      toast.error("Unlock failed", { description: map[msg] || msg })
    } finally {
      setUnlockingId(null)
    }
  }

  const handleViewPassword = async (lock: LockItem) => {
    if (scope !== "operator") return
    if (!ownedByClientLabel(lock)) {
      toast.error("No property password", { description: "Only locks tied to a client property have a stored password here." })
      return
    }
    if (!operatorViewPasswordAllowed(lock)) {
      toast.error("Password not available", {
        description: "Check gateway link and today’s booking when the mode requires it.",
      })
      return
    }
    setPasswordBusyId(lock._id)
    try {
      const res = await clnViewSmartDoorPassword(ctx, lock._id, {
        ttlockSlot: lock.clnTtlockSlot != null && Number.isFinite(Number(lock.clnTtlockSlot)) ? Number(lock.clnTtlockSlot) : undefined,
      })
      if (!res?.ok) {
        const r = String(res?.reason || "")
        const map: Record<string, string> = {
          NO_PROPERTY_LINK: "This lock is not linked to a property row.",
          OPERATOR_DOOR_GATEWAY_REQUIRED: "Gateway must be linked before showing the password for this mode.",
          OPERATOR_DOOR_NO_BOOKING_TODAY: "Password is only shown on days with a scheduled job (Malaysia date).",
        }
        toast.error("Could not load password", { description: map[r] || r })
        return
      }
      const pw = String(res.password ?? "").trim()
      toast.success(pw ? `Password: ${pw}` : "No password stored for this property.", { duration: 12000 })
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : "Failed")
    } finally {
      setPasswordBusyId(null)
    }
  }

  const defaultMyYmd = () => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(
        new Date()
      )
    } catch {
      return new Date().toISOString().slice(0, 10)
    }
  }

  const loadUnlockLog = async (lock: LockItem, fromY: string, toY: string) => {
    setLogLoading(true)
    try {
      const res = await clnGetSmartDoorUnlockLogs(scope, ctx, lock._id, {
        from: fromY.slice(0, 10),
        to: toY.slice(0, 10),
        page: 1,
        pageSize: 50,
        ttlockSlot:
          lock.clnTtlockSlot != null && Number.isFinite(Number(lock.clnTtlockSlot)) ? Number(lock.clnTtlockSlot) : undefined,
      })
      const items = Array.isArray(res?.items) ? res.items : []
      setLogRows(items as Array<Record<string, unknown>>)
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : "Failed to load log")
    } finally {
      setLogLoading(false)
    }
  }

  const openUnlockLog = (lock: LockItem) => {
    const y = defaultMyYmd()
    setLogLock(lock)
    setLogFrom(y)
    setLogTo(y)
    setLogRows([])
    setLogOpen(true)
    void loadUnlockLog(lock, y, y)
  }

  const handleConfirmDelete = async () => {
    const item = deleteConfirmItem
    if (!item) return
    setDeleting(true)
    try {
      if (item.__type === "lock") {
        const res = await clnDeleteSmartDoorLock(scope, ctx, item._id)
        if ((res as { ok?: boolean })?.ok !== false) {
          setItems((prev) => prev.filter((i) => i._id !== item._id))
          toast.success("Deleted", { description: "Smart door removed from list." })
        } else {
          const reason = (res as { reason?: string }).reason
          if (reason === "CLN_CLIENT_OWNED_DISCONNECT_FIRST") {
            toast.error("Cannot delete", {
              description:
                "This device is owned by a client. Disconnect the property from the client first; then manage removal from the client portal if needed.",
            })
          } else {
            toast.error("Delete failed", { description: reason || "Unknown error" })
          }
        }
      } else {
        const res = await clnDeleteSmartDoorGateway(scope, ctx, item._id)
        if ((res as { ok?: boolean })?.ok !== false) {
          setItems((prev) => prev.filter((i) => i._id !== item._id))
          toast.success("Deleted", { description: "Gateway removed from list." })
        } else {
          const reason = (res as { reason?: string }).reason
          if (reason === "CLN_CLIENT_OWNED_DISCONNECT_FIRST") {
            toast.error("Cannot delete", {
              description:
                "This gateway is owned by a client. Disconnect the property from the client first; then manage removal from the client portal if needed.",
            })
          } else {
            toast.error("Delete failed", { description: reason || "Unknown error" })
          }
        }
      }
      setDeleteConfirmItem(null)
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === "CLN_CLIENT_OWNED_DISCONNECT_FIRST") {
        toast.error("Cannot delete", {
          description:
            "This device is owned by a client. Disconnect the property from the client first; then manage removal from the client portal if needed.",
        })
      } else {
        toast.error("Delete failed", { description: msg })
      }
    } finally {
      setDeleting(false)
    }
  }

  const handleSync = async () => {
    setSyncLoading(true)
    try {
      const res = await clnPreviewSmartDoorSelection(
        scope,
        ctx,
        scope === "operator" ? { ttlockSlot: selectedOperatorTtlockSlot } : undefined
      )
      const list = (res?.list || []).map((item) => ({
        ...item,
        selected: false,
        alias: item.type === "gateway" ? (item.gatewayName || "") : (item.lockAlias || ""),
      }))
      setPreviewList(list)
    } catch (e) {
      console.error(e)
      toast.error("Sync failed", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSyncLoading(false)
    }
  }

  const getSelectedImportRows = () => previewList.filter((p) => p.selected && (p.alias || "").trim())

  const openSyncLockDialog = () => {
    if (operatorTtlockMissing || operatorTtlockUnknown) {
      toast.error("TTLock not connected", { description: "Connect TTLock in Operator > Company first, then try Sync Lock." })
      return
    }
    if (scope === "operator") {
      const connected = operatorTtlockAccounts.filter((a) => a.connected)
      if (connected.length === 0) {
        toast.error("TTLock not connected", {
          description: "Connect at least one TTLock account in Operator > Company → Integration.",
        })
        return
      }
      if (connected.length > 1) {
        setSyncAccountPickSlot(
          connected.some((c) => c.slot === selectedOperatorTtlockSlot) ? selectedOperatorTtlockSlot : connected[0].slot
        )
        setSyncAccountPickOpen(true)
        return
      }
      setSelectedOperatorTtlockSlot(connected[0].slot)
    }
    setSyncOpen(true)
    setPreviewList([])
  }

  const confirmSyncAccountAndOpen = () => {
    const connected = operatorTtlockAccounts.filter((a) => a.connected)
    if (!connected.some((c) => c.slot === syncAccountPickSlot)) {
      toast.error("Invalid account", { description: "Choose a connected TTLock account." })
      return
    }
    setSelectedOperatorTtlockSlot(syncAccountPickSlot)
    setSyncAccountPickOpen(false)
    setSyncOpen(true)
    setPreviewList([])
  }

  const openImportConfirm = () => {
    const selected = getSelectedImportRows()
    if (selected.length === 0) {
      toast.error("Nothing to import", { description: "Select at least one device and set its display name." })
      return
    }
    setImportConfirmOpen(true)
  }

  const performSyncImport = async () => {
    const selected = getSelectedImportRows()
    if (selected.length === 0) {
      setImportConfirmOpen(false)
      return
    }
    setImportConfirmOpen(false)
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
      const insertRes = await clnInsertSmartDoors(scope, ctx, {
        gateways,
        locks,
        ...(scope === "operator" ? { ttlockSlot: selectedOperatorTtlockSlot } : {}),
      })
      if ((insertRes as { ok?: boolean; reason?: string } | null)?.ok === false) {
        throw new Error((insertRes as { reason?: string }).reason || "Save failed")
      }

      const slotOpt = scope === "operator" ? selectedOperatorTtlockSlot : undefined
      const renameJobs = [
        ...gateways.map((g) =>
          clnSyncTTLockName(scope, ctx, {
            type: "gateway",
            externalId: String(g.gatewayId),
            name: g.gatewayName,
            ...(slotOpt !== undefined ? { ttlockSlot: slotOpt } : {}),
          })
        ),
        ...locks.map((l) =>
          clnSyncTTLockName(scope, ctx, {
            type: "lock",
            externalId: String(l.lockId),
            name: (l.lockAlias || "").trim(),
            ...(slotOpt !== undefined ? { ttlockSlot: slotOpt } : {}),
          })
        ),
      ]
      const renameRes = await Promise.allSettled(renameJobs)
      const renameFailed = renameRes.filter((r) => r.status === "rejected")

      const nUp = selected.filter((p) => p.mergeAction === "update").length
      const nNew = selected.length - nUp
      const desc =
        nUp > 0 && nNew > 0
          ? `Saved: ${nNew} new, ${nUp} updated (no duplicate rows for the same TTLock device).`
          : nUp > 0
            ? `Updated ${nUp} existing row(s) (merged Coliving / Cleanlemons bindings).`
            : `Inserted ${locks.length} lock(s) and ${gateways.length} gateway(s) into lockdetail / gatewaydetail.`
      toast.success("Import complete", { description: desc })
      if (renameFailed.length > 0) {
        const first = renameFailed[0]
        const reason =
          first.status === "rejected" && first.reason instanceof Error
            ? describeTtlockSyncNameError(first.reason)
            : "Some devices could not sync names to TTLock. Refresh and try again or change the name."
        toast.error("Name sync partially failed", { description: `${renameFailed.length} device(s) not synced. ${reason}` })
      }
      setSyncOpen(false)
      setPreviewList([])
      await loadData()
    } catch (e) {
      console.error(e)
      toast.error("Save failed", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSyncSaving(false)
    }
  }

  const setPreviewItem = (idx: number, patch: Partial<PreviewItem & { selected?: boolean; alias?: string }>) => {
    setPreviewList((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  }

  const handleRefreshStatusFromTtlock = async () => {
    if (operatorTtlockMissing || operatorTtlockUnknown) {
      toast.error("TTLock not connected", { description: "Connect TTLock in Operator > Company first, then refresh status." })
      return
    }
    setTableSyncing(true)
    try {
      const res = await clnSyncSmartDoorLocksFromTtlock(
        scope,
        ctx,
        scope === "operator" ? { ttlockSlot: selectedOperatorTtlockSlot } : undefined
      )
      if ((res as { ok?: boolean })?.ok === false) {
        toast.error("Refresh failed", { description: (res as { reason?: string }).reason || "Unknown error" })
        return
      }
      const lc = (res as { lockCount?: number }).lockCount
      const gc = (res as { gatewayCount?: number }).gatewayCount
      toast.success("Status updated", {
        description:
          typeof lc === "number" && typeof gc === "number"
            ? `TTLock: ${lc} lock(s) merged (battery & gateway link), ${gc} gateway row(s) merged (online & lock count).`
            : "Lock battery, gateway link, and gateway status updated from TTLock.",
      })
      await loadData()
    } catch (e) {
      console.error(e)
      toast.error("Refresh failed", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setTableSyncing(false)
    }
  }

  if (authLoading) {
    return (
      <main className="p-3 sm:p-6 flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    )
  }

  if (!email) {
    return (
      <main className="p-3 sm:p-6">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">Smart Door Setting</h1>
        <p className="text-sm text-muted-foreground">Please sign in to manage smart doors.</p>
      </main>
    )
  }

  if (scope === "operator" && !operatorId) {
    return (
      <main className="p-3 sm:p-6">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">Smart Door Setting</h1>
        <p className="text-sm text-muted-foreground">
          Select your company from the sidebar (operator context), then open Smart Door again.
        </p>
      </main>
    )
  }

  return (
    <main className="p-3 sm:p-6">
      {/* Same as Coliving operator smart-door: title left, Sync Lock top-right */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Smart Door Setting</h1>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
                aria-label="About this page"
              >
                <Info className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="z-[60] max-w-sm px-3 py-2 text-xs leading-relaxed whitespace-pre-line text-balance">
              {smartDoorPageInfoHint}
            </TooltipContent>
          </Tooltip>
          {scope === "operator" && ttlockStatusLoading ? (
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0 text-muted-foreground" aria-hidden>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="z-[60] max-w-xs text-xs">
                {ttlockCheckingHint}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {scope === "operator" && operatorTtlockMissing ? (
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0 text-amber-700 dark:text-amber-200" aria-label="TTLock not connected">
                  <AlertTriangle className="h-4 w-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="z-[60] max-w-sm px-3 py-2 text-xs leading-relaxed">
                {ttlockDisconnectedHint}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {scope === "operator" && connectedOperatorTtlockAccounts.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap shrink-0">TTLock account (refresh)</Label>
            <Select
              value={String(selectedOperatorTtlockSlot)}
              onValueChange={(v) => setSelectedOperatorTtlockSlot(Number(v))}
            >
              <SelectTrigger className="h-8 w-[min(100%,220px)] text-xs">
                <SelectValue placeholder="Account" />
              </SelectTrigger>
              <SelectContent>
                {connectedOperatorTtlockAccounts.map((a) => (
                  <SelectItem key={`hdr-ttlock-${a.slot}`} value={String(a.slot)}>
                    {a.accountName?.trim() || `Slot ${a.slot}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="default"
          className="gap-2 self-end sm:self-auto shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
          title={
            operatorTtlockMissing
              ? ttlockDisconnectedHint
              : operatorTtlockUnknown
                ? ttlockCheckingHint
                : "Open dialog: load TTLock preview, then import selected devices into MySQL (lockdetail / gatewaydetail)"
          }
          onClick={openSyncLockDialog}
          disabled={operatorTtlockMissing || operatorTtlockUnknown}
        >
          <RefreshCw size={14} /> Sync Lock
        </Button>
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
                    {deviceTypeTab === "all" ? "All devices" : deviceTypeTab === "smartdoor" ? "Smart Doors" : "Gateways"} ({displayItems.length})
                  </CardTitle>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-2 self-start sm:self-auto shrink-0"
                    onClick={handleRefreshStatusFromTtlock}
                    disabled={tableSyncing || loading || operatorTtlockMissing || operatorTtlockUnknown}
                    title="From TTLock: update lock battery & gateway link; update gateway online status & connected lock count (existing rows only)"
                  >
                    <RefreshCw size={14} className={tableSyncing ? "animate-spin" : ""} />
                    {tableSyncing ? "Refreshing…" : "Refresh status"}
                  </Button>
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
                    const mayDelete = operatorMayDelete(item, scope)
                    const deleteDisabledOperator = scope === "operator" && !mayDelete
                    const deleteButton = (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 disabled:opacity-40"
                        onClick={() => setDeleteConfirmItem(item)}
                        disabled={!mayDelete}
                        title={mayDelete ? "Delete" : undefined}
                        aria-label={mayDelete ? "Delete" : operatorDeleteDisabledHint(item)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )

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
                            {scope === "operator" ? (
                              ownedByClientLabel(item) ? (
                                <Badge
                                  variant="secondary"
                                  className="text-xs max-w-[220px] truncate"
                                  title={`Owned by client: ${ownedByClientLabel(item)}`}
                                >
                                  Owned by client: {ownedByClientLabel(item)}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs text-muted-foreground">
                                  Manual
                                </Badge>
                              )
                            ) : null}
                            {scope === "operator" && isLock && (lock as LockItem).needsGatewayDbLink ? (
                              <Badge variant="outline" className="text-xs border-amber-500/60 text-amber-800 dark:text-amber-200 bg-amber-500/10">
                                Gateway DB link pending
                              </Badge>
                            ) : null}
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
                        <div className="flex items-center gap-2 flex-wrap">
                          {isLock && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUnlock(lock)}
                                disabled={
                                  !!unlockingId ||
                                  (scope === "operator" && !operatorRemoteUnlockAllowed(lock))
                                }
                                title={
                                  scope === "operator" && !operatorRemoteUnlockAllowed(lock)
                                    ? "Remote open not allowed for this mode / gateway / booking"
                                    : "Open / Unlock"
                                }
                              >
                                <DoorOpen size={14} />
                              </Button>
                              {scope === "operator" && ownedByClientLabel(item) ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleViewPassword(lock)}
                                  disabled={passwordBusyId === item._id || !operatorViewPasswordAllowed(lock)}
                                  title="View property smart door password"
                                >
                                  <KeyRound size={14} />
                                </Button>
                              ) : null}
                              {lock.hasGateway && !lock.needsGatewayDbLink ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openUnlockLog(lock)}
                                  title="Remote unlock log (portal)"
                                >
                                  <ScrollText size={14} />
                                </Button>
                              ) : null}
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openDetail(item)}
                            title={
                              scope === "operator" && ownedByClientLabel(item)
                                ? "View (client-owned, read-only)"
                                : "View / Edit"
                            }
                          >
                            <Edit size={14} />
                          </Button>
                          {deleteDisabledOperator ? (
                            <Tooltip delayDuration={200}>
                              <TooltipTrigger asChild>
                                <span className="inline-flex cursor-not-allowed rounded-md">{deleteButton}</span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                sideOffset={6}
                                className="z-[60] max-w-[280px] px-3 py-2 text-xs leading-snug text-balance"
                              >
                                {operatorDeleteDisabledHint(item)}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            deleteButton
                          )}
                        </div>
                      </div>
                    )
                  })}
                  </>
                )}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {listPage} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setListPage((p) => Math.max(1, p - 1))} disabled={listPage <= 1}>
                      Previous
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setListPage((p) => Math.min(totalPages, p + 1))} disabled={listPage >= totalPages}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
      </div>

      {/* Operator: choose TTLock account before Sync Lock import (multi-slot) */}
      <Dialog open={syncAccountPickOpen} onOpenChange={setSyncAccountPickOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Choose TTLock account</DialogTitle>
            <DialogDescription>
              Same accounts as Operator → Company → Integration. Preview and import use the selected login.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={String(syncAccountPickSlot)}
            onValueChange={(v) => setSyncAccountPickSlot(Number(v))}
            className="gap-3"
          >
            {operatorTtlockAccounts
              .filter((a) => a.connected)
              .map((a) => (
                <div key={`pick-ttlock-${a.slot}`} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <RadioGroupItem value={String(a.slot)} id={`pick-slot-${a.slot}`} className="mt-0.5" />
                  <Label htmlFor={`pick-slot-${a.slot}`} className="flex-1 cursor-pointer font-normal leading-snug">
                    <span className="font-medium text-foreground">
                      {a.accountName?.trim() || `Account slot ${a.slot}`}
                    </span>
                    {a.username?.trim() ? (
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{a.username}</span>
                    ) : null}
                  </Label>
                </div>
              ))}
          </RadioGroup>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setSyncAccountPickOpen(false)}>
              Cancel
            </Button>
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={confirmSyncAccountAndOpen}>
              Continue to Sync Lock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-2xl max-h-[min(90dvh,90vh)] flex flex-col">
          <DialogHeader>
            <DialogTitle>Remote unlock log</DialogTitle>
            <DialogDescription>
              Portal remote unlock events for this lock (Malaysia calendar range → server UTC). {logLock?.lockAlias ? ` — ${logLock.lockAlias}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={logFrom.slice(0, 10)} onChange={(e) => setLogFrom(e.target.value)} className="w-[11rem]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={logTo.slice(0, 10)} onChange={(e) => setLogTo(e.target.value)} className="w-[11rem]" />
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={logLoading || !logLock}
              onClick={() => logLock && void loadUnlockLog(logLock, logFrom, logTo)}
            >
              Refresh
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto rounded-md border">
            {logLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : logRows.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No remote-unlock events in this date range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2 font-medium">Time (UTC)</th>
                    <th className="text-left p-2 font-medium">Actor</th>
                    <th className="text-left p-2 font-medium">Email</th>
                    <th className="text-left p-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {logRows.map((row) => (
                    <tr key={String(row.id ?? row.createdAt)} className="border-t">
                      <td className="p-2 align-top whitespace-nowrap">{String(row.createdAt ?? "")}</td>
                      <td className="p-2 align-top">{String(row.actorDisplayName ?? "") || "—"}</td>
                      <td className="p-2 align-top break-all">{String(row.actorEmail ?? "")}</td>
                      <td className="p-2 align-top text-muted-foreground">{String(row.portalSource ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {currentItem?.__type === "lock" ? "Lock Details" : "Gateway Details"}
              {detailReadOnlyOperator ? " (read-only)" : ""}
            </DialogTitle>
            <DialogDescription>
              {detailReadOnlyOperator
                ? "This device is registered under the client’s TTLock — viewing only."
                : "View and update device configuration"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {scope === "operator" && currentItem ? (
              ownedByClientLabel(currentItem) ? (
                <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Owned by client: </span>
                  <span className="font-medium text-foreground">{ownedByClientLabel(currentItem)}</span>
                </div>
              ) : (
                <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
                  <span className="font-medium text-foreground">Manual</span>
                  <span className="text-muted-foreground"> — device under operator TTLock, not tied to a B2B client property row.</span>
                </div>
              )
            ) : null}
            {scope === "operator" && currentItem?.__type === "lock" && (currentItem as LockItem).needsGatewayDbLink ? (
              <p className="text-xs text-amber-900 dark:text-amber-100 bg-amber-500/10 border border-amber-500/35 rounded-md px-3 py-2">
                TTLock reports a gateway, but the database link is still missing. After the client approves your property link, we sync from{" "}
                <strong>their</strong> TTLock account. If this message remains, ask the client to open Smart Door and tap{" "}
                <strong>Refresh status</strong>.
              </p>
            ) : null}
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
                  <Input
                    value={detailLockAlias}
                    onChange={(e) => setDetailLockAlias(e.target.value)}
                    readOnly={detailReadOnlyOperator}
                    className={detailReadOnlyOperator ? "bg-muted" : undefined}
                  />
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
                  <Switch checked={detailActive} onCheckedChange={setDetailActive} disabled={detailReadOnlyOperator} />
                  <Label>Active</Label>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Child locks</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={detailReadOnlyOperator}
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
                            disabled={detailReadOnlyOperator}
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
                            disabled={detailReadOnlyOperator}
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
                  <Input
                    value={detailGatewayName}
                    onChange={(e) => setDetailGatewayName(e.target.value)}
                    readOnly={detailReadOnlyOperator}
                    className={detailReadOnlyOperator ? "bg-muted" : undefined}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Connected Locks</Label>
                  <Input value={String((currentItem as GatewayItem).lockNum ?? 0)} readOnly className="bg-muted" />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              {detailReadOnlyOperator ? "Close" : "Cancel"}
            </Button>
            {detailReadOnlyOperator ? null : (
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleDetailUpdate} disabled={detailSaving}>
                {detailSaving ? "Updating..." : "Update"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Smart Door Dialog – connect in TTLock app, then Sync to add */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Sync Lock — import from TTLock</DialogTitle>
            {scope === "operator" ? (
              <p className="text-sm text-muted-foreground">
                Account:{" "}
                <span className="font-medium text-foreground">
                  {operatorTtlockAccounts.find((a) => a.slot === selectedOperatorTtlockSlot)?.accountName?.trim() ||
                    `Slot ${selectedOperatorTtlockSlot}`}
                </span>
              </p>
            ) : null}
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={handleSync}
              disabled={syncLoading || operatorTtlockMissing || operatorTtlockUnknown}
            >
              <RefreshCw size={14} className={syncLoading ? "animate-spin" : ""} />
              {syncLoading ? "Loading…" : "Load preview from TTLock"}
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
                            Not in database
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
            <Button variant="outline" onClick={() => setSyncOpen(false)}>Close</Button>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={openImportConfirm}
              disabled={syncSaving || getSelectedImportRows().length === 0 || operatorTtlockMissing || operatorTtlockUnknown}
            >
              Import selected…
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={importConfirmOpen} onOpenChange={setImportConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import selected devices?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {(() => {
                  const sel = getSelectedImportRows()
                  const nGw = sel.filter((p) => p.type === "gateway").length
                  const nLock = sel.length - nGw
                  const nUp = sel.filter((p) => p.mergeAction === "update").length
                  const nNew = sel.length - nUp
                  return (
                    <>
                      <p>
                        This will apply bindings for this portal (
                        <code className="text-xs">client_id</code> / <code className="text-xs">cln_clientid</code> /{" "}
                        <code className="text-xs">cln_operatorid</code>
                        ): <strong>{nLock}</strong> lock row(s), <strong>{nGw}</strong> gateway row(s).
                      </p>
                      <p>
                        About <strong>{nNew}</strong> new and <strong>{nUp}</strong> update(s); the same TTLock ID is never inserted twice.
                      </p>
                      <p>Display names will also be pushed to TTLock where possible. Continue?</p>
                    </>
                  )
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={syncSaving}>Cancel</AlertDialogCancel>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={syncSaving} onClick={() => void performSyncImport()}>
              {syncSaving ? "Importing…" : "Confirm import"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
