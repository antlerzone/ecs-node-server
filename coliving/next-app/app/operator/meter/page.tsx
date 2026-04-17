"use client"

import { useState, useEffect, useCallback } from "react"
import { Zap, Plus, Edit, Search, Filter, RefreshCw, Wallet, Trash2, MoreHorizontal, Link2, Unlink, GitBranch, Users, ArrowRight, Settings, DollarSign, CheckCircle2, AlertCircle, BarChart3, HelpCircle, FileDown, Eraser, ChevronLeft, ChevronRight } from "lucide-react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts"
import { getMeterList, getMeterFilters, getRoomList, syncMeter, syncAllMeters, meterClientTopup, clearMeterKwhBalance, updateMeter, updateMeterStatus, getMeterUsageSummary, insertMetersFromPreview, bindMeterToProperty, updateRoomMeter, deleteMeter } from "@/lib/operator-api"
import { toast } from "@/hooks/use-toast"

/** Map API reason codes to English for toasts */
function meterSettingMessage(reason: string | undefined, fallback: string): string {
  if (!reason) return fallback
  const map: Record<string, string> = {
    STATUS_REQUIRED: "Request was invalid. Please toggle Active again.",
    NO_METER_ID: "Meter ID is missing.",
    METER_NOT_FOUND: "Meter not found.",
    NO_CLIENT: "No company selected.",
    ACCESS_DENIED: "Access denied.",
    INVALID_RATE: "Rate must be greater than 0.",
    RATE_NOT_IN_PRICE_LIST: "This rate is not in the CNYIOT price list.",
    RATE_CREATE_FAILED: "Could not create price on CNYIOT.",
    CLIENT_SUBDOMAIN_REQUIRED: "Set your company subdomain in Company Setting first.",
    CLEAR_KWH_PREPAID_ONLY: "Clear kWh applies to prepaid meters only.",
  }
  return map[reason] || (/^[A-Z][A-Z0-9_]+$/.test(reason) ? fallback : reason)
}

/** Delete meter: backend calls CNYIOT first; DB row is removed only after platform succeeds. */
function meterDeleteErrorMessageZh(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/METER_PLATFORM_ID_MISSING/i.test(raw)) {
    return "系统里没有该电表的 11 位平台表号，无法向 CNYIOT 申请删除。请先点「同步」拉取平台信息，或检查资料是否完整。"
  }
  if (/METER_NOT_FOUND/i.test(raw)) {
    return "找不到这笔电表记录，请刷新列表后重试。"
  }
  const codeMatch = raw.match(/CNYIOT_DELETE_FAILED_(\d+)/)
  if (codeMatch) {
    return `CNYIOT 平台拒绝删除（错误码 ${codeMatch[1]}）。请到 CNYIOT 后台确认该表是否仍绑定用户、是否仍在使用，或稍后再试。`
  }
  if (/CNYIOT_DELETE_FAILED|CNYIOT refused to delete/i.test(raw)) {
    return "CNYIOT 平台删除未成功。请到 CNYIOT 后台处理该电表后，再在此重试删除。"
  }
  return raw || "删除失败，请稍后再试。"
}

import { useOperatorContext } from "@/contexts/operator-context"

// Group modes matching old frontend
type GroupMode = "single" | "parent_auto" | "parent_manual" | "brother" | "child"
type SharingMode = "equal" | "usage" | "percentage"

interface Meter {
  id: string
  meterId: string
  title: string
  /** propertydetail id (UUID) */
  propertyId: string
  property: string
  room: string | null
  mode: "prepaid" | "postpaid"
  isOnline: boolean
  status: boolean
  /** Remaining **kWh** on meter (DB `meterdetail.balance`) — not RM; use rate × balance for money equivalent. */
  balance: number
  rate: number
  productName: string
  groupMode: GroupMode
  groupId: string | null
  parentId: string | null
  sharing: SharingMode | null
  percentage?: number
}

const GROUP_MODE_OPTIONS = [
  { value: "single", label: "Single Meter" },
  { value: "parent_auto", label: "Parent Meter (Auto)" },
  { value: "parent_manual", label: "Parent Meter (Manual)" },
  { value: "brother", label: "Brother Meter" },
]

const SHARING_OPTIONS = [
  { value: "equal", label: "Equal Split" },
  { value: "usage", label: "By Usage" },
  { value: "percentage", label: "By Percentage" },
]

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200] as const

const filterOptions = [
  { value: "ALL", label: "All" },
  { value: "PREPAID", label: "Prepaid" },
  { value: "POSTPAID", label: "Postpaid" },
  { value: "ONLINE", label: "Online" },
  { value: "OFFLINE", label: "Offline" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "SINGLE", label: "Single Meters" },
  { value: "PARENT", label: "Parent Meters" },
  { value: "CHILD", label: "Child Meters" },
  { value: "BROTHER", label: "Brother Meters" },
]

function mapApiMeterToMeter(r: Record<string, unknown>): Meter {
  const ms = (r.metersharing as Record<string, unknown> | null) || {}
  const groupMode = (ms.groupMode as GroupMode) || "single"
  return {
    id: String(r.id ?? r._id ?? ""),
    meterId: String(r.meterId ?? r.meterid ?? ""),
    title: String(r.title ?? ""),
    propertyId: String(r.property ?? ""),
    property: String(r.propertyShortname ?? r.property ?? ""),
    room: (r.roomTitle as string) || (r.room ? String(r.room) : null),
    mode: (r.mode === "prepaid" || r.mode === "postpaid" ? r.mode : "prepaid") as "prepaid" | "postpaid",
    isOnline: !!r.isOnline,
    status: !!r.status,
    balance: Number(r.balance ?? 0),
    rate: Number(r.rate ?? 0),
    productName: String(r.productName ?? r.productname ?? ""),
    groupMode,
    groupId: (ms.groupId as string) || null,
    parentId: (ms.parentId as string) || null,
    sharing: (ms.sharing as SharingMode) || null,
  }
}

function formatCurrency(amount: number, currency?: string): string {
  const c = (currency || "").toUpperCase()
  if (!c) return `${amount.toFixed(2)}`
  if (c === "MYR") return `RM ${amount.toFixed(2)}`
  if (c === "SGD") return `SGD ${amount.toFixed(2)}`
  return `${c} ${amount.toFixed(2)}`
}

/** DB/API balance is kWh, not currency. */
function formatKwh(kwh: number): string {
  const n = Number(kwh) || 0
  if (!Number.isFinite(n)) return "0 kWh"
  const abs = Math.abs(n)
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 3 : 4
  let s = n.toFixed(decimals).replace(/\.?0+$/, "")
  if (s === "-0") s = "0"
  return `${s || "0"} kWh`
}

function prepaidEquivalentRm(kwh: number, ratePerKwh: number): number | null {
  const k = Number(kwh) || 0
  const r = Number(ratePerKwh) || 0
  if (r <= 0) return null
  return k * r
}

/** Table/card line: primary kWh; prepaid + rate → secondary ≈ RM */
function MeterBalanceDisplay({
  meter,
  currency,
  align = "right",
}: {
  meter: Pick<Meter, "balance" | "rate" | "mode">
  currency?: string
  align?: "left" | "right" | "center"
}) {
  const kwh = Number(meter.balance) || 0
  const eq = meter.mode === "prepaid" ? prepaidEquivalentRm(kwh, meter.rate) : null
  const alignClass = align === "left" ? "text-left" : align === "center" ? "text-center" : "text-right"
  return (
    <div className={alignClass}>
      <span className="font-semibold">{formatKwh(kwh)}</span>
      {eq != null && (
        <span className="block text-xs text-muted-foreground">≈ {formatCurrency(eq, currency)}</span>
      )}
    </div>
  )
}

export default function MeterSettingPage() {
  const { accessCtx } = useOperatorContext()
  const clientCurrency = accessCtx?.client?.currency || ""
  const [activeTab, setActiveTab] = useState("list")
  const [search, setSearch] = useState("")
  const [filterType, setFilterType] = useState("ALL")
  const [filterProperty, setFilterProperty] = useState("ALL")
  /** Current page rows (server pagination). */
  const [meters, setMeters] = useState<Meter[]>([])
  /** Up to 500 rows matching filters — for group UI, badges, and new-meter room checks. */
  const [metersAll, setMetersAll] = useState<Meter[]>([])
  const [properties, setProperties] = useState<{ value: string; label: string }[]>([{ value: "ALL", label: "All Properties" }])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  /** `silent`: refetch without full-table Loading row (avoids scroll jumping to top after delete/sync/edit). */
  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent
    if (!silent) setLoading(true)
    const listParams = {
      search,
      propertyId: filterProperty !== "ALL" ? filterProperty : undefined,
      filter: filterType !== "ALL" ? filterType : undefined,
    }
    try {
      const [listRes, filtersRes, fullRes] = await Promise.all([
        getMeterList({ ...listParams, page, pageSize }),
        getMeterFilters(),
        getMeterList({ ...listParams, limit: 500 }),
      ])
      const items = (listRes?.items || []) as Record<string, unknown>[]
      setMeters(items.map(mapApiMeterToMeter))
      const fullItems = (fullRes?.items || []) as Record<string, unknown>[]
      setMetersAll(fullItems.map(mapApiMeterToMeter))
      const tp = Math.max(1, Number(listRes?.totalPages ?? 1))
      setTotal(Number(listRes?.total ?? 0))
      setTotalPages(tp)
      const props = ((filtersRes as { properties?: Array<{ value: string; label: string }> })?.properties || []) as Array<{ value: string; label: string }>
      setProperties([{ value: "ALL", label: "All Properties" }, ...props.map(p => ({ value: p.value, label: p.label }))])
    } catch (e) {
      console.error(e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [search, filterProperty, filterType, page, pageSize])

  useEffect(() => {
    if (totalPages >= 1 && page > totalPages) setPage(totalPages)
  }, [totalPages, page])

  useEffect(() => { loadData() }, [loadData])
  const [detailOpen, setDetailOpen] = useState(false)
  const [topupOpen, setTopupOpen] = useState(false)
  const [currentMeter, setCurrentMeter] = useState<Meter | null>(null)
  const [newMeterOpen, setNewMeterOpen] = useState(false)
  const [groupModeOpen, setGroupModeOpen] = useState(false)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [rateEditOpen, setRateEditOpen] = useState(false)
  const [rateEditValue, setRateEditValue] = useState("")
  const [topupAmount, setTopupAmount] = useState("")
  const [savingRate, setSavingRate] = useState(false)
  const [savingTopup, setSavingTopup] = useState(false)
  const [syncingMeterId, setSyncingMeterId] = useState<string | null>(null)
  const [syncingAllMeters, setSyncingAllMeters] = useState(false)
  const [syncResult, setSyncResult] = useState<{ meterId: string; success: boolean; message: string } | null>(null)
  const [usageOpen, setUsageOpen] = useState(false)
  const [usageMeter, setUsageMeter] = useState<Meter | null>(null)
  const [usageStart, setUsageStart] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1); return d.toISOString().slice(0, 10); })
  const [usageEnd, setUsageEnd] = useState(() => { const d = new Date(); d.setMonth(d.getMonth()); d.setDate(0); return d.toISOString().slice(0, 10); })
  const [usageData, setUsageData] = useState<{ total?: number; records?: Array<{ date?: string; consumption?: number }> } | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [detailTitle, setDetailTitle] = useState("")
  const [detailRate, setDetailRate] = useState("")
  const [detailStatus, setDetailStatus] = useState(true)
  const [savingDetail, setSavingDetail] = useState(false)
  const [statusTogglingId, setStatusTogglingId] = useState<string | null>(null)
  
  // Group mode edit state
  const [editGroupMode, setEditGroupMode] = useState<GroupMode>("single")
  const [editSharing, setEditSharing] = useState<SharingMode>("equal")
  const [editParentId, setEditParentId] = useState<string>("")
  const [editChildMeters, setEditChildMeters] = useState<string[]>([])

  // Create group state
  const [newGroupType, setNewGroupType] = useState<"parent_auto" | "parent_manual" | "brother">("parent_auto")
  const [newGroupName, setNewGroupName] = useState("")
  const [newGroupSharing, setNewGroupSharing] = useState<SharingMode>("equal")
  const [newGroupParentMeter, setNewGroupParentMeter] = useState("")
  const [newGroupChildMeters, setNewGroupChildMeters] = useState<string[]>([""])

  // New Meter form state
  const [newMeterPropertyId, setNewMeterPropertyId] = useState("")
  const [newMeterRoomId, setNewMeterRoomId] = useState("__whole_unit__")
  const [roomsForProperty, setRoomsForProperty] = useState<Array<{ value: string; label: string }>>([])
  const [newMeterPlatformId, setNewMeterPlatformId] = useState("")
  const [newMeterTitle, setNewMeterTitle] = useState("")
  const [newMeterRate, setNewMeterRate] = useState("1")
  const [newMeterMode, setNewMeterMode] = useState<"prepaid" | "postpaid">("prepaid")
  const [savingNewMeter, setSavingNewMeter] = useState(false)
  const [newMeterError, setNewMeterError] = useState<string | null>(null)
  const [meterToDelete, setMeterToDelete] = useState<Meter | null>(null)
  const [meterToClearKwh, setMeterToClearKwh] = useState<Meter | null>(null)
  const [clearingKwh, setClearingKwh] = useState(false)
  const [deletingMeter, setDeletingMeter] = useState(false)

  useEffect(() => {
    if (!newMeterPropertyId || newMeterPropertyId === "ALL") {
      setRoomsForProperty([])
      setNewMeterRoomId("__whole_unit__")
      return
    }
    getRoomList({ propertyId: newMeterPropertyId, limit: 500 }).then((res) => {
      const items = (res?.items || []) as Array<{
        id?: string
        _id?: string
        roomName?: string
        title_fld?: string
        meter?: string | null
      }>
      const opts = items
        .filter((r) => !r.meter)
        .map((r) => ({
          value: r.id || r._id || "",
          label: r.title_fld || r.roomName || r.id || r._id || "",
        }))
        .filter((o) => o.value)
      setRoomsForProperty(opts)
      const parentTaken = metersAll.some(
        (m) => m.propertyId === newMeterPropertyId && (m.room == null || String(m.room).trim() === "")
      )
      if (!parentTaken) setNewMeterRoomId("__whole_unit__")
      else if (opts.length > 0) setNewMeterRoomId(opts[0].value)
      else setNewMeterRoomId("__no_slot__")
    }).catch(() => {
      setRoomsForProperty([])
      setNewMeterRoomId("__whole_unit__")
    })
  }, [newMeterPropertyId, metersAll])

  const parentMeters = metersAll.filter(m => m.groupMode === "parent_auto" || m.groupMode === "parent_manual")
  const brotherGroups = [...new Set(metersAll.filter(m => m.groupMode === "brother").map(m => m.groupId))].filter(Boolean)
  const getChildMeters = (parentId: string) => metersAll.filter(m => m.parentId === parentId)
  const getBrotherMeters = (groupId: string | null) => groupId ? metersAll.filter(m => m.groupId === groupId && m.groupMode === "brother") : []
  const getParentMeter = (parentId: string | null) => parentId ? metersAll.find(m => m.id === parentId) : null
  const getAvailableMeters = () => metersAll.filter(m => m.groupMode === "single")
  const getAllUngroupedMeters = () => metersAll.filter(m => m.groupMode === "single" || !m.groupId)

  const openDetail = (meter: Meter) => {
    setCurrentMeter(meter)
    setDetailTitle(meter.title)
    setDetailRate(String(meter.rate))
    setDetailStatus(meter.status)
    setDetailOpen(true)
  }

  const handleSaveDetail = async () => {
    if (!currentMeter) return
    setSavingDetail(true)
    try {
      const r = await updateMeter(currentMeter.id, { title: detailTitle.trim(), rate: parseFloat(detailRate) || 0, status: detailStatus })
      if (r?.ok !== false) {
        toast({ title: "Meter saved", description: "Changes have been saved." })
        setDetailOpen(false)
        await loadData({ silent: true })
      } else {
        toast({
          variant: "destructive",
          title: "Save failed",
          description: meterSettingMessage((r as { reason?: string })?.reason, "Please try again."),
        })
      }
    } catch (e) { console.error(e) } finally { setSavingDetail(false) }
  }

  const handleStatusToggle = async (meter: Meter, checked: boolean) => {
    setStatusTogglingId(meter.id)
    try {
      const r = await updateMeterStatus(meter.id, checked)
      if (r?.ok === false) {
        toast({
          variant: "destructive",
          title: "Active update failed",
          description: meterSettingMessage((r as { reason?: string })?.reason, "Please try again."),
        })
        return
      }
      await loadData({ silent: true })
      if (r?.relayOk === false) {
        toast({
          variant: "destructive",
          title: "Relay command may have failed",
          description: checked
            ? "Power-on was not confirmed. Tap Sync Meter or try again."
            : "Power-off was not confirmed. Tap Sync Meter or try again.",
        })
        return
      }
      if (!checked) {
        toast({
          title: "Power disconnected",
          description: "Power-off command was sent. The meter relay should open (no load power).",
        })
      } else if (r?.hint === "ON_PREPAID_ZERO_BALANCE") {
        toast({
          title: "Power connected",
          description:
            "Relay closed, but balance is 0 kWh—appliances may not run until you top up.",
        })
      } else if (r?.hint === "ON_PREPAID_HAS_BALANCE") {
        toast({
          title: "Power connected",
          description: "Relay closed; there is balance, electricity should work.",
        })
      } else if (r?.hint === "ON_POSTPAID") {
        toast({
          title: "Power connected",
          description: "Postpaid meter: relay closed.",
        })
      } else {
        toast({
          title: checked ? "Active on" : "Active off",
          description: "Status saved.",
        })
      }
    } catch (e) {
      console.error(e)
      toast({
        variant: "destructive",
        title: "Active update failed",
        description: e instanceof Error ? e.message : "Please try again.",
      })
    } finally {
      setStatusTogglingId(null)
    }
  }

  const openTopup = (meter: Meter) => {
    setCurrentMeter(meter)
    setTopupOpen(true)
  }

  const openRateEdit = (meter: Meter) => {
    setCurrentMeter(meter)
    setRateEditValue(String(meter.rate))
    setRateEditOpen(true)
  }

  const handleSaveRate = async () => {
    if (!currentMeter) return
    setSavingRate(true)
    try {
      const r = await updateMeter(currentMeter.id, { rate: parseFloat(rateEditValue) || 0 })
      if (r?.ok !== false) {
        toast({ title: "Rate updated", description: "Billing rate saved and synced where possible." })
        setRateEditOpen(false)
        await loadData({ silent: true })
      } else {
        toast({
          variant: "destructive",
          title: "Rate update failed",
          description: meterSettingMessage((r as { reason?: string })?.reason, "Please try again."),
        })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSavingRate(false)
    }
  }

  const handleTopup = async () => {
    if (!currentMeter || !topupAmount) return
    setSavingTopup(true)
    try {
      const r = await meterClientTopup(currentMeter.id, currentMeter.meterId, parseFloat(topupAmount) || 0)
      if (r?.ok !== false) {
        const bal = Number(r?.balance ?? 0)
        const activeOn = r?.status !== false
        setMeters((prev) =>
          prev.map((m) => (m.id === currentMeter.id ? { ...m, balance: bal, status: activeOn } : m))
        )
        setTopupOpen(false)
        setTopupAmount("")
        const rate = Number(currentMeter.rate) || 0
        const eqRm =
          currentMeter.mode === "prepaid" && rate > 0 ? bal * rate : null
        toast({
          title: "Top-up complete",
          description: `Balance: ${formatKwh(bal)}${eqRm != null ? ` (≈ ${formatCurrency(eqRm, clientCurrency)})` : ""}. Active is ON (power connect sent).`,
        })
      } else {
        toast({
          variant: "destructive",
          title: "Top-up failed",
          description: meterSettingMessage((r as { reason?: string })?.reason, "Please try again."),
        })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSavingTopup(false)
    }
  }

  const openGroupMode = (meter: Meter) => {
    setCurrentMeter(meter)
    setEditGroupMode(meter.groupMode)
    setEditSharing(meter.sharing || "equal")
    setEditParentId(meter.parentId || "")
    if (meter.groupMode === "parent_auto" || meter.groupMode === "parent_manual") {
      setEditChildMeters(getChildMeters(meter.id).map(c => c.id))
    } else if (meter.groupMode === "brother") {
      setEditChildMeters(getBrotherMeters(meter.groupId).filter(m => m.id !== meter.id).map(b => b.id))
    } else {
      setEditChildMeters([])
    }
    setGroupModeOpen(true)
  }

  const handleConfirmClearKwh = async () => {
    if (!meterToClearKwh) return
    setClearingKwh(true)
    try {
      const r = await clearMeterKwhBalance(meterToClearKwh.id)
      if (r?.ok === false) {
        toast({
          variant: "destructive",
          title: "Clear kWh failed",
          description: (r as { message?: string; reason?: string }).message || meterSettingMessage((r as { reason?: string }).reason, "Please try again."),
        })
        return
      }
      const clearedId = meterToClearKwh.id
      setMeterToClearKwh(null)
      const activeAfter = (r as { status?: boolean }).status === true
      setMeters((prev) =>
        prev.map((m) =>
          m.id === clearedId
            ? { ...m, balance: Number((r as { balance?: number }).balance ?? 0), status: activeAfter }
            : m
        )
      )
      toast({
        title: "kWh cleared",
        description: activeAfter
          ? "Balance set to 0. Active still ON — check device or try turning off manually."
          : "Balance set to 0. Active is OFF (power disconnect sent).",
      })
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Clear kWh failed",
        description: e instanceof Error ? e.message : "Please try again.",
      })
    } finally {
      setClearingKwh(false)
    }
  }

  const handleConfirmDeleteMeter = async () => {
    if (!meterToDelete) return
    setDeletingMeter(true)
    setSyncResult(null)
    const m = meterToDelete
    try {
      const r = await deleteMeter(m.id)
      if (r?.ok !== false) {
        setMeterToDelete(null)
        setSyncResult({
          meterId: m.id,
          success: true,
          message: `Meter ${m.meterId} removed from your account.`,
        })
        await loadData({ silent: true })
      } else {
        const msg = meterDeleteErrorMessageZh(
          new Error((r as { reason?: string })?.reason || "Delete failed.")
        )
        setSyncResult({ meterId: m.id, success: false, message: msg })
        toast({ variant: "destructive", title: "删除失败", description: msg })
      }
    } catch (e) {
      const msg = meterDeleteErrorMessageZh(e)
      setSyncResult({
        meterId: m.id,
        success: false,
        message: msg,
      })
      toast({ variant: "destructive", title: "删除失败", description: msg })
    } finally {
      setDeletingMeter(false)
      setTimeout(() => setSyncResult(null), 5000)
    }
  }

  const handleSyncMeter = async (meter: Meter) => {
    setSyncingMeterId(meter.id)
    setSyncResult(null)
    try {
      const r = await syncMeter(meter.meterId)
      if (r?.ok !== false) {
        setSyncResult({ meterId: meter.id, success: true, message: `${meter.meterId} synced successfully` })
        await loadData({ silent: true })
      } else {
        setSyncResult({ meterId: meter.id, success: false, message: (r as { reason?: string })?.reason ?? `Failed to sync ${meter.meterId}` })
      }
    } catch (e) {
      setSyncResult({ meterId: meter.id, success: false, message: `Failed to sync ${meter.meterId}` })
    } finally {
      setSyncingMeterId(null)
      setTimeout(() => setSyncResult(null), 3000)
    }
  }

  const handleSyncAllMeters = async () => {
    setSyncingAllMeters(true)
    setSyncResult(null)
    try {
      const r = await syncAllMeters()
      const total = r?.total ?? 0
      const succeeded = r?.succeeded ?? 0
      const failed = r?.failed ?? 0
      if ((r as { message?: string })?.message === "NO_METERS_TO_SYNC" || total === 0) {
        const desc = "No meters with a platform ID to sync."
        setSyncResult({
          meterId: "__all__",
          success: true,
          message: desc,
        })
        toast({ title: "Nothing to sync", description: desc })
        return
      }
      if (r?.ok !== false && failed === 0) {
        const desc = `Synced ${succeeded} meter(s). Balances and status updated from CNYIoT.`
        setSyncResult({
          meterId: "__all__",
          success: true,
          message: desc,
        })
        toast({ title: "Meters synced", description: desc })
        await loadData({ silent: true })
      } else if (succeeded > 0) {
        const errSample = (r?.errors && r.errors[0]?.reason) || r?.reason || ""
        const desc = `Synced ${succeeded} of ${total}. ${failed} failed.${errSample ? ` (${errSample.slice(0, 120)})` : ""}`
        setSyncResult({
          meterId: "__all__",
          success: true,
          message: desc,
        })
        toast({ title: "Partial sync", description: desc })
        await loadData({ silent: true })
      } else {
        const errSample = (r?.errors && r.errors[0]?.reason) || r?.reason || "Sync failed"
        setSyncResult({
          meterId: "__all__",
          success: false,
          message: errSample,
        })
        toast({
          variant: "destructive",
          title: "Sync failed",
          description: errSample,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sync all meters failed."
      setSyncResult({
        meterId: "__all__",
        success: false,
        message: msg,
      })
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: msg,
      })
    } finally {
      setSyncingAllMeters(false)
      setTimeout(() => setSyncResult(null), 6000)
    }
  }

  const openUsage = (meter: Meter) => {
    setUsageMeter(meter)
    setUsageData(null)
    setUsageOpen(true)
  }

  const loadUsage = useCallback(async () => {
    if (!usageMeter) return
    setUsageLoading(true)
    setUsageData(null)
    try {
      const res = await getMeterUsageSummary({ meterIds: [usageMeter.meterId], start: usageStart, end: usageEnd })
      if (res && (res as { ok?: boolean }).ok !== false) setUsageData(res as { total?: number; records?: Array<{ date?: string; consumption?: number }> })
      else setUsageData({ records: [] })
    } catch {
      setUsageData({ records: [] })
    } finally {
      setUsageLoading(false)
    }
  }, [usageMeter, usageStart, usageEnd])

  useEffect(() => { if (usageOpen && usageMeter) loadUsage() }, [usageOpen, usageMeter, usageStart, usageEnd, loadUsage])

  const openCreateGroup = () => {
    setCreateGroupOpen(true)
  }

  const resetNewMeterForm = useCallback(() => {
    const first = properties.find((p) => p.value && p.value !== "ALL")?.value || ""
    setNewMeterPropertyId(first)
    setNewMeterRoomId("__whole_unit__")
    setNewMeterPlatformId("")
    setNewMeterTitle("")
    setNewMeterRate("1")
    setNewMeterMode("prepaid")
    setNewMeterError(null)
  }, [properties])

  const handleSubmitNewMeter = async () => {
    const mid = newMeterPlatformId.trim()
    const title = newMeterTitle.trim()
    setNewMeterError(null)
    if (!mid || !title) {
      setNewMeterError("Meter ID and meter name are required.")
      return
    }
    if (!newMeterPropertyId) {
      setNewMeterError("Please select a property.")
      return
    }
    if (newMeterRoomId === "__no_slot__") {
      setNewMeterError("This property already has a whole-unit meter and every room has a meter. Remove or reassign a meter first.")
      return
    }
    const rateNum = parseFloat(newMeterRate)
    if (Number.isNaN(rateNum) || rateNum <= 0) {
      setNewMeterError("Rate must be greater than 0.")
      return
    }
    setSavingNewMeter(true)
    try {
      const ins = await insertMetersFromPreview([{ meterId: mid, title, mode: newMeterMode }])
      const inserted = ins?.inserted ?? 0
      const ids = ins?.ids ?? []
      if (inserted < 1 || !ids[0]) {
        setNewMeterError("Meter was not added (duplicate ID on your account, or CNYIOT rejected the ID). Check Company subdomain & meter ID.")
        return
      }
      const cmsId = ids[0]
      let bindFail: string | null = null
      if (newMeterRoomId && newMeterRoomId !== "__whole_unit__") {
        const rm = await updateRoomMeter(newMeterRoomId, cmsId)
        if (rm?.ok === false) {
          bindFail = (rm as { reason?: string }).reason || "Binding to room failed. Link the meter in Room Setting."
        }
      } else {
        try {
          const bp = await bindMeterToProperty(cmsId, newMeterPropertyId)
          if (bp?.ok === false) {
            bindFail = (bp as { reason?: string }).reason || "Property bind failed."
          }
        } catch (be) {
          bindFail = be instanceof Error ? be.message : String(be)
        }
      }
      try {
        await updateMeter(cmsId, { rate: rateNum, title, mode: newMeterMode })
      } catch {
        /* rate sync to CNYIOT may fail; table still has row */
      }
      await loadData({ silent: true })
      if (bindFail) {
        setNewMeterError(`${bindFail} The meter was created — assign property/room if needed.`)
        return
      }
      setNewMeterOpen(false)
      resetNewMeterForm()
      toast({ title: "Meter added", description: "The meter is registered and bound to the property or room." })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setNewMeterError(
        msg.includes("CLIENT_SUBDOMAIN_REQUIRED")
          ? "Set client subdomain in Company Setting first."
          : msg.includes("CNYIOT_ADD_FAILED")
            ? "CNYIOT rejected this meter ID. Use an ID that exists on your CNYIOT account or contact support."
            : msg
      )
    } finally {
      setSavingNewMeter(false)
    }
  }

  const handleAddChildMeter = () => {
    setEditChildMeters([...editChildMeters, ""])
  }

  const handleRemoveChildMeter = (index: number) => {
    setEditChildMeters(editChildMeters.filter((_, i) => i !== index))
  }

  const handleChildMeterChange = (index: number, value: string) => {
    const updated = [...editChildMeters]
    updated[index] = value
    setEditChildMeters(updated)
  }

  const handleNewGroupAddChild = () => {
    setNewGroupChildMeters([...newGroupChildMeters, ""])
  }

  const handleNewGroupRemoveChild = (index: number) => {
    setNewGroupChildMeters(newGroupChildMeters.filter((_, i) => i !== index))
  }

  const handleNewGroupChildChange = (index: number, value: string) => {
    const updated = [...newGroupChildMeters]
    updated[index] = value
    setNewGroupChildMeters(updated)
  }

  const getGroupModeBadge = (meter: Meter) => {
    if (meter.groupMode === "parent_auto") {
      const childCount = getChildMeters(meter.id).length
      return <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200"><GitBranch size={10} className="mr-1" /> Parent Auto ({childCount})</Badge>
    }
    if (meter.groupMode === "parent_manual") {
      const childCount = getChildMeters(meter.id).length
      return <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200"><GitBranch size={10} className="mr-1" /> Parent Manual ({childCount})</Badge>
    }
    if (meter.groupMode === "child") {
      return <Badge className="text-xs bg-green-100 text-green-700 border-green-200"><ArrowRight size={10} className="mr-1" /> Child</Badge>
    }
    if (meter.groupMode === "brother") {
      const brotherCount = getBrotherMeters(meter.groupId).length
      return <Badge className="text-xs bg-purple-100 text-purple-700 border-purple-200"><Users size={10} className="mr-1" /> Brother ({brotherCount})</Badge>
    }
    return <Badge variant="outline" className="text-xs">Single</Badge>
  }

  // Summary counts (full filtered list, up to 500)
  const singleCount = metersAll.filter(m => m.groupMode === "single").length
  const parentCount = metersAll.filter(m => m.groupMode === "parent_auto" || m.groupMode === "parent_manual").length
  const childCount = metersAll.filter(m => m.groupMode === "child").length
  const brotherCount = metersAll.filter(m => m.groupMode === "brother").length

  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeTo = Math.min(page * pageSize, total)

  return (
    <main className="p-3 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Meter Setting</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Configure meters, groups (Parent/Child/Brother), and billing rates</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={syncingAllMeters || loading}
            onClick={handleSyncAllMeters}
            title="Pull latest balance and status from CNYIoT for all your meters"
          >
            <RefreshCw size={14} className={syncingAllMeters ? "animate-spin" : ""} />
            Sync meter
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={openCreateGroup}>
            <Link2 size={14} /> Create Group
          </Button>
          <Button
            size="sm"
            className="gap-2 flex-shrink-0"
            style={{ background: "var(--brand)" }}
            onClick={() => {
              resetNewMeterForm()
              setNewMeterOpen(true)
            }}
          >
            <Plus size={14} /> Add Meter
          </Button>
        </div>
      </div>

      {/* Sync Result Toast */}
      {syncResult && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium mb-4 border ${syncResult.success ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
          {syncResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {syncResult.message}
        </div>
      )}

      <AlertDialog open={!!meterToDelete} onOpenChange={(open) => { if (!open) setMeterToDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete meter?</AlertDialogTitle>
            <AlertDialogDescription>
              {meterToDelete && (
                <>
                  Permanently remove <strong>{meterToDelete.title}</strong> ({meterToDelete.meterId}): first from{" "}
                  <strong>CNYIOT</strong>, then from your database. Room bindings will be cleared. If CNYIOT returns an
                  error, the meter will stay in your list.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingMeter}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deletingMeter}
              onClick={handleConfirmDeleteMeter}
            >
              {deletingMeter ? "Deleting…" : "Delete meter"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!meterToClearKwh} onOpenChange={(open) => { if (!open) setMeterToClearKwh(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear prepaid kWh balance?</AlertDialogTitle>
            <AlertDialogDescription>
              {meterToClearKwh && (() => {
                const eqClear = prepaidEquivalentRm(meterToClearKwh.balance, meterToClearKwh.rate)
                return (
                  <>
                    This calls CNYIOT <strong>clearKwh</strong> for <strong>{meterToClearKwh.title}</strong> ({meterToClearKwh.meterId}
                    ). Current balance ~{formatKwh(meterToClearKwh.balance)}
                    {eqClear != null ? ` (≈ ${formatCurrency(eqClear, clientCurrency)})` : ""} will be zeroed on the meter.
                    This cannot be undone from the portal.
                  </>
                )
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingKwh}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={clearingKwh} onClick={handleConfirmClearKwh}>
              {clearingKwh ? "Clearing…" : "Clear kWh"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground font-semibold uppercase">Total</p>
          <p className="text-2xl font-bold text-foreground">{total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground font-semibold uppercase">Single</p>
          <p className="text-2xl font-bold text-foreground">{singleCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground font-semibold uppercase">Parent</p>
          <p className="text-2xl font-bold text-blue-600">{parentCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground font-semibold uppercase">Child</p>
          <p className="text-2xl font-bold text-green-600">{childCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground font-semibold uppercase">Brother</p>
          <p className="text-2xl font-bold text-purple-600">{brotherCount}</p>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-flex">
          <TabsTrigger value="list">Meter List</TabsTrigger>
          <TabsTrigger value="groups">Meter Groups</TabsTrigger>
          <TabsTrigger value="rates">Rate Settings</TabsTrigger>
        </TabsList>

        {/* Meter List Tab */}
        <TabsContent value="list" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <Input
                    placeholder="Search meter ID or title..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value)
                      setPage(1)
                    }}
                    className="pl-9 text-sm"
                  />
                </div>
                <Select value={filterProperty} onValueChange={(v) => { setFilterProperty(v); setPage(1) }}>
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(1) }}>
                  <SelectTrigger className="w-full sm:w-44">
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

          {/* Meter List */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left p-3 font-semibold">Meter</th>
                      <th className="text-center p-3 font-semibold">Online</th>
                      <th className="text-left p-3 font-semibold hidden md:table-cell">Property / Room</th>
                      <th className="text-left p-3 font-semibold hidden sm:table-cell">Mode</th>
                      <th className="text-left p-3 font-semibold">Group</th>
                      <th className="text-right p-3 font-semibold hidden lg:table-cell">Rate</th>
                      <th className="text-center p-3 font-semibold">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dotted border-muted-foreground">Active</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-left">
                            <p className="font-medium">Off = disconnect power (relay trip)</p>
                            <p className="mt-1">
                              On = close relay. Prepaid with 0 balance: line may energise but no kWh for loads; with balance,
                              appliances can run.
                            </p>
                            <p className="mt-2 text-muted-foreground">
                              This is only <strong>meter</strong> power (<code className="text-xs">meterdetail.status</code>). It does{" "}
                              <strong>not</strong> change <strong>Room</strong> → Active (room can stay on the market with no power).
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </th>
                      <th className="text-right p-3 font-semibold hidden md:table-cell">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dotted border-muted-foreground">Balance (kWh)</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-left">
                            <p>Stored value is <strong>kWh</strong> remaining (CNYIOT / DB), not RM.</p>
                            <p className="mt-1">Prepaid: top-up RM ÷ rate = kWh added. We show <strong>≈ RM</strong> as rate × kWh for reference.</p>
                          </TooltipContent>
                        </Tooltip>
                      </th>
                      <th className="text-center p-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading...</td></tr>
                    ) : meters.length === 0 ? (
                      <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No meters match your filters.</td></tr>
                    ) : meters.map((meter) => (
                      <tr key={meter.id} className="border-b border-border hover:bg-muted/30">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div>
                              <p className="font-semibold text-foreground">{meter.title}</p>
                              <p className="text-xs text-muted-foreground">{meter.meterId}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <span className={meter.isOnline ? "text-green-600 font-medium" : "text-red-600"}>{meter.isOnline ? "Online" : "Offline"}</span>
                        </td>
                        <td className="p-3 hidden md:table-cell">
                          <p className="text-foreground">{meter.property}</p>
                          <p className="text-xs text-muted-foreground">{meter.room || "No room"}</p>
                        </td>
                        <td className="p-3 hidden sm:table-cell">
                          <Badge variant={meter.mode === "prepaid" ? "default" : "outline"} className="capitalize">
                            {meter.mode}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {getGroupModeBadge(meter)}
                        </td>
                        <td className="p-3 text-right hidden lg:table-cell">
                          <span className="font-semibold">{formatCurrency(meter.rate, clientCurrency)}</span>
                          <span className="text-xs text-muted-foreground">/kWh</span>
                        </td>
                        <td className="p-3 text-center">
                          <Switch
                            checked={meter.status}
                            disabled={statusTogglingId === meter.id}
                            onCheckedChange={(checked) => handleStatusToggle(meter, !!checked)}
                          />
                        </td>
                        <td className="p-3 text-right hidden md:table-cell">
                          <MeterBalanceDisplay meter={meter} currency={clientCurrency} align="right" />
                        </td>
                        <td className="p-3 text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm"><MoreHorizontal size={16} /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openUsage(meter)}>
                                <BarChart3 size={14} className="mr-2" /> View Usage
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDetail(meter)}>
                                <Edit size={14} className="mr-2" /> Edit Meter
                              </DropdownMenuItem>
                              {meter.mode === "prepaid" && (
                                <DropdownMenuItem onClick={() => openTopup(meter)}>
                                  <Wallet size={14} className="mr-2" /> Client Topup
                                </DropdownMenuItem>
                              )}
                              {meter.mode === "prepaid" && (
                                <DropdownMenuItem onClick={() => setMeterToClearKwh(meter)}>
                                  <Eraser size={14} className="mr-2" /> Clear kWh balance
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleSyncMeter(meter)} disabled={syncingMeterId === meter.id}>
                                <RefreshCw size={14} className={`mr-2 ${syncingMeterId === meter.id ? "animate-spin" : ""}`} />
                                {syncingMeterId === meter.id ? "Syncing..." : "Sync Meter"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => openGroupMode(meter)}>
                                <Settings size={14} className="mr-2" /> Set Group Mode
                              </DropdownMenuItem>
                              {(meter.groupMode === "parent_auto" || meter.groupMode === "parent_manual") && (
                                <DropdownMenuItem onClick={() => openGroupMode(meter)}>
                                  <Plus size={14} className="mr-2" /> Add Child Meter
                                </DropdownMenuItem>
                              )}
                              {meter.groupMode === "brother" && (
                                <DropdownMenuItem onClick={() => openGroupMode(meter)}>
                                  <Plus size={14} className="mr-2" /> Add Brother Meter
                                </DropdownMenuItem>
                              )}
                              {meter.groupMode !== "single" && (
                                <DropdownMenuItem className="text-destructive">
                                  <Unlink size={14} className="mr-2" /> Remove from Group
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setMeterToDelete(meter)}
                              >
                                <Trash2 size={14} className="mr-2" /> Delete Meter
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!loading && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-3 py-3 border-t border-border text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <span>Show</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => {
                        setPageSize(Number(v))
                        setPage(1)
                      }}
                    >
                      <SelectTrigger className="w-[76px] h-8" aria-label="Rows per page">
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
                    <span>per page</span>
                  </div>
                  <div className="text-muted-foreground text-center sm:flex-1">
                    {total === 0 ? (
                      <span>0 meters</span>
                    ) : (
                      <span>
                        Showing <span className="font-medium text-foreground tabular-nums">{rangeFrom}</span>
                        –
                        <span className="font-medium text-foreground tabular-nums">{rangeTo}</span>
                        {" "}of{" "}
                        <span className="font-medium text-foreground tabular-nums">{total}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-center sm:justify-end gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 px-2"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={16} />
                    </Button>
                    <span className="px-2 text-muted-foreground tabular-nums min-w-[6.5rem] text-center">
                      Page {page} / {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 px-2"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight size={16} />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Meter Groups Tab */}
        <TabsContent value="groups" className="space-y-6">
          {/* Create Group Button */}
          <div className="flex justify-end">
            <Button size="sm" className="gap-2" style={{ background: "var(--brand)" }} onClick={openCreateGroup}>
              <Plus size={14} /> Create Meter Group
            </Button>
          </div>

          {/* Parent-Child Groups */}
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-base flex items-center gap-2">
                <GitBranch size={18} className="text-blue-600" /> Parent-Child Groups
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              {parentMeters.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-border rounded-lg">
                  <p className="text-sm text-muted-foreground mb-3">No parent-child meter groups configured</p>
                  <Button size="sm" variant="outline" onClick={openCreateGroup}>
                    <Plus size={14} className="mr-2" /> Create Group
                  </Button>
                </div>
              ) : (
                parentMeters.map((parent) => {
                  const children = getChildMeters(parent.id)
                  return (
                    <div key={parent.id} className="border border-blue-200 bg-blue-50/30 rounded-xl p-4">
                      {/* Parent Info */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <GitBranch size={20} className="text-blue-600" />
                          </div>
                          <div>
                            <p className="font-bold text-foreground">{parent.title}</p>
                            <p className="text-xs text-muted-foreground">{parent.meterId} · {parent.groupMode === "parent_auto" ? "Auto Calculation" : "Manual Entry"} · Rate: {formatCurrency(parent.rate, clientCurrency)}/kWh</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="text-xs" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
                            {parent.sharing === "equal" ? "Equal Split" : parent.sharing === "usage" ? "By Usage" : "By %"}
                          </Badge>
                          <Button size="sm" variant="outline" onClick={() => openGroupMode(parent)}>
                            <Settings size={14} />
                          </Button>
                        </div>
                      </div>

                      {/* Child Meters */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                        {children.map((child, idx) => (
                          <div key={child.id} className="p-3 border border-blue-200 bg-white rounded-lg">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-blue-700">Child {idx + 1}</span>
                              <Badge variant={child.isOnline ? "default" : "secondary"} className="text-xs">{child.isOnline ? "Online" : "Offline"}</Badge>
                            </div>
                            <h4 className="font-semibold text-sm text-foreground">{child.title}</h4>
                            <p className="text-xs text-muted-foreground">{child.meterId} · {child.room || "No room"}</p>
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-xs text-muted-foreground">Rate: {formatCurrency(child.rate, clientCurrency)}/kWh</span>
                              <div className="text-sm" style={{ color: "var(--brand)" }}>
                                <MeterBalanceDisplay meter={child} currency={clientCurrency} align="right" />
                              </div>
                            </div>
                          </div>
                        ))}
                        <button
                          onClick={() => openGroupMode(parent)}
                          className="p-3 border border-dashed border-blue-300 rounded-lg flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:border-blue-500 transition-colors"
                        >
                          <Plus size={16} /> Add Child
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {/* Brother Groups */}
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Users size={18} className="text-purple-600" /> Brother Groups
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              {brotherGroups.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-border rounded-lg">
                  <p className="text-sm text-muted-foreground mb-3">No brother meter groups configured</p>
                  <Button size="sm" variant="outline" onClick={openCreateGroup}>
                    <Plus size={14} className="mr-2" /> Create Group
                  </Button>
                </div>
              ) : (
                brotherGroups.map((groupId, groupIdx) => {
                  const brothers = getBrotherMeters(groupId)
                  const firstBrother = brothers[0]
                  return (
                    <div key={groupId} className="border border-purple-200 bg-purple-50/30 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Users size={18} className="text-purple-600" />
                          <div>
                            <p className="font-bold text-foreground">Brother Group {groupIdx + 1}</p>
                            <p className="text-xs text-muted-foreground">{brothers.length} meters · Sharing: {firstBrother?.sharing === "equal" ? "Equal Split" : firstBrother?.sharing === "usage" ? "By Usage" : "By %"}</p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => brothers[0] && openGroupMode(brothers[0])}>
                          <Settings size={14} />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {brothers.map((brother, idx) => (
                          <div key={brother.id} className="p-3 border border-purple-200 bg-white rounded-lg">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-purple-700">{idx + 1})</span>
                              <Badge variant={brother.isOnline ? "default" : "secondary"} className="text-xs">{brother.isOnline ? "Online" : "Offline"}</Badge>
                            </div>
                            <h4 className="font-semibold text-sm text-foreground">{brother.title}</h4>
                            <p className="text-xs text-muted-foreground">{brother.meterId} · {brother.room || "No room"}</p>
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-xs text-muted-foreground">Rate: {formatCurrency(brother.rate, clientCurrency)}/kWh</span>
                              <div className="text-sm" style={{ color: "var(--brand)" }}>
                                <MeterBalanceDisplay meter={brother} currency={clientCurrency} align="right" />
                              </div>
                            </div>
                          </div>
                        ))}
                        <button
                          onClick={() => brothers[0] && openGroupMode(brothers[0])}
                          className="p-3 border border-dashed border-purple-300 rounded-lg flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:border-purple-500 transition-colors"
                        >
                          <Plus size={16} /> Add Brother
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rate Settings Tab - Per Meter */}
        <TabsContent value="rates" className="space-y-4">
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign size={18} /> Rate Settings (Per Meter)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left p-3 font-semibold">Meter</th>
                      <th className="text-left p-3 font-semibold">Property</th>
                      <th className="text-left p-3 font-semibold">Room</th>
                      <th className="text-left p-3 font-semibold">Group</th>
                      <th className="text-right p-3 font-semibold">Current Rate</th>
                      <th className="text-center p-3 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Loading...</td></tr>
                    ) : metersAll.length === 0 ? (
                      <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No meters.</td></tr>
                    ) : (
                      metersAll.map((meter) => (
                        <tr key={meter.id} className="border-b border-border hover:bg-muted/30">
                          <td className="p-3">
                            <p className="font-semibold text-foreground">{meter.title}</p>
                            <p className="text-xs text-muted-foreground">{meter.meterId}</p>
                          </td>
                          <td className="p-3 text-foreground">{meter.property}</td>
                          <td className="p-3 text-muted-foreground">{meter.room || "-"}</td>
                          <td className="p-3">{getGroupModeBadge(meter)}</td>
                          <td className="p-3 text-right">
                            <span className="font-bold text-lg" style={{ color: "var(--brand)" }}>{formatCurrency(meter.rate, clientCurrency)}</span>
                            <span className="text-xs text-muted-foreground">/kWh</span>
                          </td>
                          <td className="p-3 text-center">
                            <Button size="sm" variant="outline" onClick={() => openRateEdit(meter)}>
                              <Edit size={14} className="mr-1" /> Edit
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Meter Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Meter Details</DialogTitle>
            <DialogDescription>View and edit meter information. Rate updates sync to CNYIOT (price list). Mode cannot be changed after create.</DialogDescription>
          </DialogHeader>
          {currentMeter && (
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-xl bg-secondary/50 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-lg">{currentMeter.title}</span>
                  <Badge variant={currentMeter.isOnline ? "default" : "secondary"}>{currentMeter.isOnline ? "Online" : "Offline"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{currentMeter.meterId}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-semibold">Meter ID</Label>
                  <Input value={currentMeter.meterId} readOnly disabled className="mt-1 bg-muted" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Meter Name</Label>
                  <Input value={detailTitle} onChange={(e) => setDetailTitle(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Rate (per kWh)</Label>
                  <Input type="number" step="0.01" value={detailRate} onChange={(e) => setDetailRate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Mode (read-only)</Label>
                  <Select value={currentMeter.mode} disabled>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prepaid">Prepaid</SelectItem>
                      <SelectItem value="postpaid">Postpaid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={detailStatus} onCheckedChange={setDetailStatus} />
                <Label>Active</Label>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <div className="flex justify-between mb-1"><span className="text-muted-foreground">Property:</span><span className="font-semibold">{currentMeter.property}</span></div>
                <div className="flex justify-between mb-1"><span className="text-muted-foreground">Room:</span><span className="font-semibold">{currentMeter.room || "Not assigned"}</span></div>
                <div className="flex justify-between mb-1"><span className="text-muted-foreground">Brand:</span><span className="font-semibold">{currentMeter.productName}</span></div>
                <div className="flex justify-between gap-2 items-start">
                  <span className="text-muted-foreground shrink-0">Balance (kWh):</span>
                  <MeterBalanceDisplay meter={currentMeter} currency={clientCurrency} align="right" />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSaveDetail} disabled={savingDetail}>{savingDetail ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rate Edit Dialog */}
      <Dialog open={rateEditOpen} onOpenChange={setRateEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Meter Rate</DialogTitle>
            <DialogDescription>Configure the billing rate for this specific meter.</DialogDescription>
          </DialogHeader>
          {currentMeter && (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg bg-secondary/50 border border-border">
                <p className="font-semibold">{currentMeter.title}</p>
                <p className="text-xs text-muted-foreground">{currentMeter.meterId} · {currentMeter.property}</p>
              </div>
              <div>
                <Label className="text-xs font-semibold">Electricity Rate ({clientCurrency === "MYR" ? "RM" : clientCurrency} per kWh)</Label>
                <Input type="number" step="0.01" min="0" value={rateEditValue} onChange={(e) => setRateEditValue(e.target.value)} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1">This rate will be used for billing calculations for this meter only.</p>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-xs text-amber-800"><strong>Note:</strong> Changing this rate will apply to all future billing calculations. Past invoices will not be affected.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateEditOpen(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSaveRate} disabled={savingRate}>{savingRate ? "Saving..." : "Save Rate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Group Dialog */}
      <Dialog open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Meter Group</DialogTitle>
            <DialogDescription>Set up a new meter group for shared billing calculations.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Label className="text-xs font-semibold">Group Type</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="inline-flex text-muted-foreground hover:text-foreground" aria-label="Group type help">
                      <HelpCircle size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[260px]">
                    <p className="font-semibold mb-1">Parent-Child (Auto):</p>
                    <p className="mb-2">One parent meter; usage is auto-calculated and split among child meters.</p>
                    <p className="font-semibold mb-1">Parent-Child (Manual):</p>
                    <p className="mb-2">One parent meter; you enter usage manually per child for billing.</p>
                    <p className="font-semibold mb-1">Brother Group:</p>
                    <p>Multiple meters as peers; costs are shared equally (e.g. equal split or by percentage).</p>
                  </TooltipContent>
                </Tooltip>
                <a
                  href="/meter-group-guide.pdf"
                  download="meter-group-guide.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <FileDown size={12} /> Download guide (PDF)
                </a>
              </div>
              <Select value={newGroupType} onValueChange={(v) => setNewGroupType(v as "parent_auto" | "parent_manual" | "brother")}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent_auto">Parent-Child (Auto Calculation)</SelectItem>
                  <SelectItem value="parent_manual">Parent-Child (Manual Entry)</SelectItem>
                  <SelectItem value="brother">Brother Group (Equal Peers)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {newGroupType === "parent_auto" && "Parent meter auto-calculates usage for child meters."}
                {newGroupType === "parent_manual" && "Parent meter requires manual usage entry for children."}
                {newGroupType === "brother" && "All meters in the group share costs equally as peers."}
              </p>
            </div>

            <div>
              <Label className="text-xs font-semibold">Sharing Mode</Label>
              <Select value={newGroupSharing} onValueChange={(v) => setNewGroupSharing(v as SharingMode)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHARING_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Parent-Child: Select Parent + Add Children */}
            {(newGroupType === "parent_auto" || newGroupType === "parent_manual") && (
              <>
                <div>
                  <Label className="text-xs font-semibold">Parent Meter</Label>
                  <Select value={newGroupParentMeter} onValueChange={setNewGroupParentMeter}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select parent meter" />
                    </SelectTrigger>
                    <SelectContent>
                      {getAllUngroupedMeters().map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.title} ({m.meterId})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold">Child Meters</Label>
                    <Button type="button" size="sm" variant="outline" onClick={handleNewGroupAddChild}>
                      <Plus size={12} className="mr-1" /> Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {newGroupChildMeters.map((childId, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Select value={childId} onValueChange={(v) => handleNewGroupChildChange(idx, v)}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select child meter" />
                          </SelectTrigger>
                          <SelectContent>
                            {getAllUngroupedMeters().filter(m => m.id !== newGroupParentMeter && !newGroupChildMeters.includes(m.id)).map(m => (
                              <SelectItem key={m.id} value={m.id}>{m.title} ({m.meterId})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {newGroupChildMeters.length > 1 && (
                          <Button type="button" size="sm" variant="ghost" onClick={() => handleNewGroupRemoveChild(idx)}>
                            <Trash2 size={14} className="text-destructive" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Brother: Add Brother Meters */}
            {newGroupType === "brother" && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-semibold">Brother Meters</Label>
                  <Button type="button" size="sm" variant="outline" onClick={handleNewGroupAddChild}>
                    <Plus size={12} className="mr-1" /> Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {newGroupChildMeters.map((childId, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Select value={childId} onValueChange={(v) => handleNewGroupChildChange(idx, v)}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select meter" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAllUngroupedMeters().filter(m => !newGroupChildMeters.includes(m.id)).map(m => (
                            <SelectItem key={m.id} value={m.id}>{m.title} ({m.meterId})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {newGroupChildMeters.length > 1 && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => handleNewGroupRemoveChild(idx)}>
                          <Trash2 size={14} className="text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Brother meters share costs equally without a parent meter. At least 2 meters are required.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateGroupOpen(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={() => setCreateGroupOpen(false)}>Create Group</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Group Mode Dialog */}
      <Dialog open={groupModeOpen} onOpenChange={setGroupModeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Set Meter Group Mode</DialogTitle>
            <DialogDescription>Configure meter grouping for billing calculations.</DialogDescription>
          </DialogHeader>
          {currentMeter && (
            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
              <div className="p-3 rounded-lg bg-secondary/50 border border-border">
                <p className="font-semibold">{currentMeter.title}</p>
                <p className="text-xs text-muted-foreground">{currentMeter.meterId}</p>
              </div>

              {/* Group Mode Selection */}
              <div>
                <Label className="text-xs font-semibold">Group Mode</Label>
                <Select value={editGroupMode} onValueChange={(v) => setEditGroupMode(v as GroupMode)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_MODE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {editGroupMode === "single" && "This meter operates independently, not linked to any group."}
                  {editGroupMode === "parent_auto" && "Parent meter with automatic usage calculation for child meters."}
                  {editGroupMode === "parent_manual" && "Parent meter with manual usage entry for child meters."}
                  {editGroupMode === "brother" && "Brother meters share costs equally without a parent meter."}
                </p>
              </div>

              {/* Sharing Mode (not for single) */}
              {editGroupMode !== "single" && (
                <div>
                  <Label className="text-xs font-semibold">Sharing Mode</Label>
                  <Select value={editSharing} onValueChange={(v) => setEditSharing(v as SharingMode)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SHARING_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Parent Meters: Add Child Meters */}
              {(editGroupMode === "parent_auto" || editGroupMode === "parent_manual") && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold">Child Meters</Label>
                    <Button type="button" size="sm" variant="outline" onClick={handleAddChildMeter}>
                      <Plus size={12} className="mr-1" /> Add Child
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {editChildMeters.map((childId, idx) => {
                      const childMeter = metersAll.find(m => m.id === childId)
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <Select value={childId} onValueChange={(v) => handleChildMeterChange(idx, v)}>
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select child meter" />
                            </SelectTrigger>
                            <SelectContent>
                              {getAvailableMeters().concat(childMeter ? [childMeter] : []).map(m => (
                                <SelectItem key={m.id} value={m.id}>{m.title} ({m.meterId})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button type="button" size="sm" variant="ghost" onClick={() => handleRemoveChildMeter(idx)}>
                            <Trash2 size={14} className="text-destructive" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Brother Mode: Add Brother Meters */}
              {editGroupMode === "brother" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold">Brother Meters</Label>
                    <Button type="button" size="sm" variant="outline" onClick={handleAddChildMeter}>
                      <Plus size={12} className="mr-1" /> Add Brother
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {editChildMeters.map((brotherId, idx) => {
                      const brotherMeter = metersAll.find(m => m.id === brotherId)
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <Select value={brotherId} onValueChange={(v) => handleChildMeterChange(idx, v)}>
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select brother meter" />
                            </SelectTrigger>
                            <SelectContent>
                              {getAvailableMeters().concat(brotherMeter ? [brotherMeter] : []).filter(m => m.id !== currentMeter.id).map(m => (
                                <SelectItem key={m.id} value={m.id}>{m.title} ({m.meterId})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button type="button" size="sm" variant="ghost" onClick={() => handleRemoveChildMeter(idx)}>
                            <Trash2 size={14} className="text-destructive" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Brother meters share costs equally. This meter will be included in the group.</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupModeOpen(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={() => setGroupModeOpen(false)}>Save Group Settings</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Topup Dialog */}
      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Client Topup</DialogTitle>
            <DialogDescription>Manual top-up by operator. Adds prepaid credit (kWh balance) on this meter via CNYIOT.</DialogDescription>
          </DialogHeader>
          {currentMeter && (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg bg-secondary/50 border border-border">
                <p className="font-semibold">{currentMeter.title}</p>
                <p className="text-xs text-muted-foreground">{currentMeter.meterId}</p>
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground">Current balance (kWh)</p>
                  <div className="font-bold text-base" style={{ color: "var(--brand)" }}>
                    <MeterBalanceDisplay meter={currentMeter} currency={clientCurrency} align="left" />
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-xs font-semibold">Topup Amount ({clientCurrency === "MYR" ? "RM" : clientCurrency})</Label>
                <Input type="number" step="0.01" min="1" placeholder="Enter amount" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} className="mt-1" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTopupOpen(false); setTopupAmount("") }}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleTopup} disabled={savingTopup || !topupAmount}>{savingTopup ? "Processing..." : "Topup"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Usage Dialog */}
      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>View Usage</DialogTitle>
            <DialogDescription>Usage summary for the selected date range.</DialogDescription>
          </DialogHeader>
          {usageMeter && (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg bg-muted/50 border border-border">
                <p className="font-semibold">{usageMeter.title}</p>
                <p className="text-xs text-muted-foreground">{usageMeter.meterId}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-semibold">From</Label>
                  <Input type="date" value={usageStart} onChange={(e) => setUsageStart(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">To</Label>
                  <Input type="date" value={usageEnd} onChange={(e) => setUsageEnd(e.target.value)} className="mt-1" />
                </div>
              </div>
              {usageLoading ? (
                <p className="text-sm text-muted-foreground py-4">Loading usage...</p>
              ) : usageData && (
                <>
                  {usageData.total != null && (
                    <p className="text-sm font-semibold">Total usage: {Number(usageData.total).toFixed(2)} kWhz</p>
                  )}
                  {usageData.records && usageData.records.length > 0 ? (
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={usageData.records.map((r) => ({ date: r.date ?? "", consumption: r.consumption ?? 0 }))}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <RechartsTooltip formatter={(v: number) => [Number(v).toFixed(2), "kWhz"]} />
                          <Bar dataKey="consumption" fill="var(--brand)" name="kWhz" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4">No usage data for this range.</p>
                  )}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* New Meter Dialog */}
      <Dialog
        open={newMeterOpen}
        onOpenChange={(open) => {
          setNewMeterOpen(open)
          if (!open) {
            setNewMeterPropertyId("")
            setNewMeterRoomId("__whole_unit__")
            setRoomsForProperty([])
            setNewMeterError(null)
          } else {
            resetNewMeterForm()
          }
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Meter</DialogTitle>
            <DialogDescription>
              Registers the meter on CNYIOT (platform) and in your account. Use the real 11-digit meter ID from the device / CNYIOT.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {newMeterError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {newMeterError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs font-semibold">Meter ID</Label>
                <Input
                  placeholder="e.g. 19102881976"
                  className="mt-1"
                  value={newMeterPlatformId}
                  onChange={(e) => setNewMeterPlatformId(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs font-semibold">Meter Name</Label>
                <Input
                  placeholder="e.g. Room 101"
                  className="mt-1"
                  value={newMeterTitle}
                  onChange={(e) => setNewMeterTitle(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs font-semibold">Property</Label>
                <Select value={newMeterPropertyId || "__none__"} onValueChange={(v) => setNewMeterPropertyId(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select property" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select property</SelectItem>
                    {properties.filter((p) => p.value && p.value !== "ALL").map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-semibold">Room (Optional)</Label>
                <Select
                  value={newMeterRoomId}
                  onValueChange={setNewMeterRoomId}
                  disabled={!newMeterPropertyId}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={newMeterPropertyId ? "Select…" : "Select property first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {newMeterRoomId === "__no_slot__" ? (
                      <SelectItem value="__no_slot__">No available slot</SelectItem>
                    ) : (
                      <>
                        {newMeterPropertyId &&
                          !metersAll.some(
                            (m) =>
                              m.propertyId === newMeterPropertyId &&
                              (m.room == null || String(m.room).trim() === "")
                          ) && (
                            <SelectItem value="__whole_unit__">Parent Meter (Whole Unit)</SelectItem>
                          )}
                        {roomsForProperty.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
                {newMeterRoomId === "__no_slot__" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This property already has a whole-unit meter and every room has a meter.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs font-semibold">Rate ({clientCurrency === "MYR" ? "RM" : clientCurrency} per kWh)</Label>
                <Input type="number" step="0.01" min="0.01" className="mt-1" value={newMeterRate} onChange={(e) => setNewMeterRate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Mode</Label>
                <Select value={newMeterMode} onValueChange={(v) => setNewMeterMode(v as "prepaid" | "postpaid")}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prepaid">Prepaid</SelectItem>
                    <SelectItem value="postpaid">Postpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 md:col-span-3">
                <Label className="text-xs font-semibold">Product/Brand</Label>
                <div className="mt-1 px-3 py-2 rounded-lg border border-border bg-muted/50 text-sm text-muted-foreground">CNYIOT</div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewMeterOpen(false)} disabled={savingNewMeter}>
              Cancel
            </Button>
            <Button
              style={{ background: "var(--brand)" }}
              onClick={handleSubmitNewMeter}
              disabled={savingNewMeter || newMeterRoomId === "__no_slot__"}
            >
              {savingNewMeter ? "Adding…" : "Add Meter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
