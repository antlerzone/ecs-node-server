"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Plus, Edit, Check, X, Upload, Image, Eye, Trash2, GripVertical, Download, Calendar, MoreHorizontal, ChevronLeft, ChevronRight, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getRoomList, getRoomFilters, getRoom, updateRoom, insertRoom, setRoomActive, deleteRoom, syncRoomAvailability, getRoomMeterOptions, getRoomSmartDoorOptions, updateRoomMeter, updateRoomSmartDoor, getTenancyForRoom, uploadFile, getCleanlemonsLinkStatus, getCleanlemonsCleaningPricing, scheduleCleanlemonsCleaningJob } from "@/lib/operator-api"
import { toast } from "@/hooks/use-toast"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { wixImageToStatic } from "@/lib/utils"

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200] as const
const REMARK_OPTIONS = [
  { label: "—", value: "" },
  { label: "Mix Gender", value: "Mix Gender" },
  { label: "Girl Only", value: "Girl Only" },
  { label: "Male Only", value: "Male Only" },
] as const

type TypeFilter = "ALL" | "AVAILABLE" | "AVAILABLE_SOON" | "NON_AVAILABLE"
/** roomdetail.active — listing on/off for Available Unit / booking */
type ListingActiveFilter = "ALL" | "ACTIVE" | "INACTIVE"
type RoomItem = { id: string; roomName?: string; property?: { shortname?: string; _id?: string }; propertyId?: string; active?: boolean; available?: boolean; availablesoon?: boolean; hasActiveTenancy?: boolean; meter?: string; smartdoor?: string; description_fld?: string; mainPhoto?: string | null; mediaGallery?: Array<{ type?: string; src?: string }>; price?: number; remark?: string }

export default function RoomSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [rooms, setRooms] = useState<RoomItem[]>([])
  const [properties, setProperties] = useState<Array<{ value: string; label: string }>>([])
  const [propertyId, setPropertyId] = useState<string>("")
  const [keyword, setKeyword] = useState("")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL")
  const [listingActiveFilter, setListingActiveFilter] = useState<ListingActiveFilter>("ACTIVE")
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingRoom, setEditingRoom] = useState<RoomItem | null>(null)
  const [editForm, setEditForm] = useState({ roomName: "", propertyId: "", meterId: "", smartDoorId: "", description_fld: "", mainPhoto: "" as string | null, mediaGallery: [] as Array<{ type?: string; src?: string }>, active: true, available: true, availableSoon: false, price: "" as string, remark: "" as string, tenantCleaningPrice: "" as string })
  const [cleanlemonsLinked, setCleanlemonsLinked] = useState(false)
  const [cleaningPricing, setCleaningPricing] = useState<{
    showRefGeneralCleaning?: boolean
    refGeneralCleaning?: number | null
    showRefWarmcleaning?: boolean
    refWarmcleaning?: number | null
  } | null>(null)
  const [scheduleRoom, setScheduleRoom] = useState<RoomItem | null>(null)
  const [scheduleDate, setScheduleDate] = useState("")
  const [scheduleTime, setScheduleTime] = useState("09:00")
  const [schedulingJob, setSchedulingJob] = useState(false)
  const [meterOptions, setMeterOptions] = useState<Array<{ label: string; value: string }>>([])
  const [smartDoorOptions, setSmartDoorOptions] = useState<Array<{ label: string; value: string }>>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** Saved DB bindings when edit dialog opened — delete only allowed when both cleared (save after unbinding). */
  const [roomBindingsSaved, setRoomBindingsSaved] = useState({ meter: false, smartdoor: false })
  const [uploading, setUploading] = useState(false)
  const [viewDetailRoom, setViewDetailRoom] = useState<RoomItem | null>(null)
  const [tenancyDetail, setTenancyDetail] = useState<{ tenant?: { fullname?: string; phone?: string }; rental?: number; begin?: string; end?: string } | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const mainPhotoInputRef = useRef<HTMLInputElement>(null)
  /** Room-rental-cleaning reference price; schedule menu only when canSchedule. */
  const [roomCleaningScheduleInfo, setRoomCleaningScheduleInfo] = useState<
    Record<string, { canSchedule: boolean; refWarmcleaning: number | null }>
  >({})

  /** Server-side list + pagination; availability filter on ECS. Pass `page` / `listingActiveFilter` to fetch without waiting for React state (e.g. after add room). */
  const loadData = useCallback(
    async (opts?: { silent?: boolean; page?: number; listingActiveFilter?: ListingActiveFilter }) => {
      const silent = !!opts?.silent
      const page = opts?.page ?? currentPage
      const effectiveListing =
        opts?.listingActiveFilter !== undefined ? opts.listingActiveFilter : listingActiveFilter
      if (!silent) setLoading(true)
      try {
        const [listRes, filtersRes] = await Promise.all([
          getRoomList({
            propertyId: propertyId || undefined,
            keyword: keyword || undefined,
            page,
            pageSize,
            availability: typeFilter !== "ALL" ? typeFilter : undefined,
            activeFilter: effectiveListing !== "ALL" ? effectiveListing : undefined,
          }),
          getRoomFilters(),
        ])
        const items = (listRes?.items ?? []) as RoomItem[]
        setRooms(Array.isArray(items) ? items : [])
        setTotal(Number(listRes?.total ?? 0))
        setTotalPages(Math.max(1, Number(listRes?.totalPages ?? 1)))
        const props = ((filtersRes as { properties?: Array<{ value: string; label: string }> })?.properties ?? [])
        setProperties(Array.isArray(props) ? props : [])
        if (opts?.page != null) setCurrentPage(opts.page)
      } catch (e) {
        console.error(e)
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [propertyId, keyword, typeFilter, listingActiveFilter, currentPage, pageSize]
  )

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    let cancelled = false
    getCleanlemonsLinkStatus()
      .then((cl) => {
        if (cancelled) return
        setCleanlemonsLinked(!!(cl?.ok && cl.confirmed && (cl.cleanlemonsClientdetailId || cl.cleanlemonsOperatorId)))
      })
      .catch(() => {
        if (!cancelled) setCleanlemonsLinked(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!cleanlemonsLinked || rooms.length === 0) {
      setRoomCleaningScheduleInfo({})
      return
    }
    let cancelled = false
    const withPid = rooms.filter((r) => r.propertyId || r.property?._id)
    const BATCH = 25
    ;(async () => {
      const acc: Record<string, { canSchedule: boolean; refWarmcleaning: number | null }> = {}
      for (let i = 0; i < withPid.length; i += BATCH) {
        if (cancelled) return
        const chunk = withPid.slice(i, i + BATCH)
        const results = await Promise.all(
          chunk.map(async (room) => {
            const pid = String(room.propertyId || room.property?._id || "")
            try {
              const pr = await getCleanlemonsCleaningPricing({ propertyId: pid, roomId: room.id })
              if (!pr || !pr.ok) {
                return { id: room.id, canSchedule: false, refWarmcleaning: null as number | null }
              }
              const ref = pr.refWarmcleaning != null ? Number(pr.refWarmcleaning) : null
              const can =
                !!pr.showRefWarmcleaning &&
                ref != null &&
                Number.isFinite(ref) &&
                ref > 0
              return { id: room.id, canSchedule: can, refWarmcleaning: can ? ref : null }
            } catch {
              return { id: room.id, canSchedule: false, refWarmcleaning: null as number | null }
            }
          })
        )
        results.forEach((r) => {
          acc[r.id] = { canSchedule: r.canSchedule, refWarmcleaning: r.refWarmcleaning }
        })
        if (!cancelled) setRoomCleaningScheduleInfo({ ...acc })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rooms, cleanlemonsLinked])

  const rangeFrom = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const rangeTo = Math.min(currentPage * pageSize, total)

  const openViewDetail = useCallback(async (room: RoomItem) => {
    setViewDetailRoom(room)
    setTenancyDetail(null)
    setLoadingDetail(true)
    try {
      const res = await getTenancyForRoom(room.id)
      const data = res && typeof res === "object" && !("ok" in res && res.ok === false) ? res as { tenant?: { fullname?: string; phone?: string }; rental?: number; begin?: string; end?: string } : null
      setTenancyDetail(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    if (currentPage > totalPages && totalPages >= 1) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  const openEdit = async (room: RoomItem) => {
    setEditingRoom(room)
    setRoomBindingsSaved({ meter: false, smartdoor: false })
    try {
      const [roomRes, meterRes, smartRes] = await Promise.all([
        getRoom(room.id),
        // Only pass roomId: parent property's meter/lock must not be injected into room dropdowns
        getRoomMeterOptions(room.id),
        getRoomSmartDoorOptions(room.id),
      ])
      const rm = (roomRes && typeof roomRes === "object" && "room" in roomRes) ? (roomRes as { room: RoomItem }).room : (roomRes as RoomItem)
      setRoomBindingsSaved({
        meter: !!String(rm.meter || "").trim(),
        smartdoor: !!String(rm.smartdoor || "").trim(),
      })
      setEditForm({
        roomName: rm.roomName || "",
        propertyId: rm.propertyId || rm.property?._id || "",
        meterId: rm.meter || "",
        smartDoorId: rm.smartdoor || "",
        description_fld: rm.description_fld || "",
        mainPhoto: rm.mainPhoto || null,
        mediaGallery: Array.isArray(rm.mediaGallery) ? rm.mediaGallery : [],
        active: rm.active !== false,
        available: rm.available !== false,
        availableSoon: !!rm.availablesoon,
        price: rm.price != null ? String(rm.price) : "",
        remark: typeof rm.remark === "string" ? rm.remark : "",
        tenantCleaningPrice:
          (rm as { cleanlemonsCleaningTenantPriceMyr?: number | null }).cleanlemonsCleaningTenantPriceMyr != null
            ? String((rm as { cleanlemonsCleaningTenantPriceMyr?: number | null }).cleanlemonsCleaningTenantPriceMyr)
            : "",
      })
      try {
        if (cleanlemonsLinked && (rm.propertyId || rm.property?._id)) {
          const pid = String(rm.propertyId || rm.property?._id || "")
          const pr = await getCleanlemonsCleaningPricing({ propertyId: pid, roomId: rm.id || room.id })
          setCleaningPricing(pr && pr.ok ? pr : null)
        } else {
          setCleaningPricing(null)
        }
      } catch {
        setCleaningPricing(null)
      }
      const meterOpts = (meterRes as { options?: Array<{ label?: string; value?: string }> })?.options
      setMeterOptions(Array.isArray(meterOpts) ? meterOpts.map((o) => ({ label: String(o?.label ?? o?.value ?? "Meter"), value: String(o?.value ?? "") })).filter((o) => (o.value ?? "").trim() !== "") : [])
      const smartOpts = (smartRes as { options?: Array<{ label?: string; value?: string }> })?.options
      setSmartDoorOptions(Array.isArray(smartOpts) ? smartOpts.map((o) => ({ label: String(o?.label ?? o?.value ?? "Smart Door"), value: String(o?.value ?? "") })).filter((o) => (o.value ?? "").trim() !== "") : [])
    } catch (e) {
      console.error(e)
    }
  }

  const handleAddImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (imageFiles.length === 0) {
      toast({ title: "No images selected", description: "Choose one or more image files.", variant: "destructive" })
      e.target.value = ""
      return
    }
    setUploading(true)
    try {
      const results = await Promise.all(imageFiles.map((file) => uploadFile(file)))
      const urls = results.filter((res) => res.ok && res.url).map((res) => res.url as string)
      if (urls.length > 0) {
        setEditForm((f) => {
          const list = [
            ...(f.mainPhoto ? [f.mainPhoto] : []),
            ...(f.mediaGallery ?? []).map((g) => g.src),
            ...urls,
          ]
          return {
            ...f,
            mainPhoto: list[0] || null,
            mediaGallery: list.slice(1).map((src) => ({ type: "image" as const, src })),
          }
        })
      }
      if (urls.length < imageFiles.length) {
        toast({
          title: "Some uploads failed",
          description: `${urls.length} of ${imageFiles.length} file(s) uploaded.`,
          variant: "destructive",
        })
      }
    } catch (err) {
      console.error(err)
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" })
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  const imageList = useMemo(() => {
    const out: string[] = []
    if (editForm.mainPhoto) out.push(editForm.mainPhoto)
    ;(editForm.mediaGallery ?? []).forEach((g) => { if (g?.src) out.push(g.src) })
    return out
  }, [editForm.mainPhoto, editForm.mediaGallery])

  const setImageList = useCallback((urls: string[]) => {
    setEditForm((f) => ({
      ...f,
      mainPhoto: urls[0] || null,
      mediaGallery: urls.slice(1).map((src) => ({ type: "image" as const, src })),
    }))
  }, [])

  const removeImageAt = useCallback((index: number) => {
    setEditForm((f) => {
      const list = [...(f.mainPhoto ? [f.mainPhoto] : []), ...(f.mediaGallery ?? []).map((g) => g.src)]
      list.splice(index, 1)
      return { ...f, mainPhoto: list[0] || null, mediaGallery: list.slice(1).map((src) => ({ type: "image" as const, src })) }
    })
  }, [])

  const [draggedImageIndex, setDraggedImageIndex] = useState<number | null>(null)
  const [syncingAvail, setSyncingAvail] = useState(false)
  const handleImageDragStart = (index: number) => setDraggedImageIndex(index)
  const handleImageDragOver = (e: React.DragEvent) => e.preventDefault()
  const handleImageDrop = (toIndex: number) => {
    if (draggedImageIndex == null) return
    setEditForm((f) => {
      const list = [...(f.mainPhoto ? [f.mainPhoto] : []), ...(f.mediaGallery ?? []).map((g) => g.src)]
      const [removed] = list.splice(draggedImageIndex, 1)
      list.splice(toIndex, 0, removed)
      return { ...f, mainPhoto: list[0] || null, mediaGallery: list.slice(1).map((src) => ({ type: "image" as const, src })) }
    })
    setDraggedImageIndex(null)
  }
  const handleImageDragEnd = () => setDraggedImageIndex(null)

  const getDownloadFilename = useCallback((url: string, index: number) => {
    try {
      const parsed = new URL(url)
      const raw = decodeURIComponent(parsed.pathname.split("/").pop() || "")
      const cleaned = raw.split("?")[0].trim()
      if (cleaned) return cleaned
    } catch {
      // fallback below
    }
    return `room-image-${index + 1}.jpg`
  }, [])

  const handleDownloadAllImages = useCallback(async () => {
    if (imageList.length === 0) {
      toast({ title: "No images", description: "This room has no images to download." })
      return
    }

    let successCount = 0
    for (let i = 0; i < imageList.length; i += 1) {
      const src = imageList[i]
      try {
        const imageUrl = wixImageToStatic(src)
        const proxyUrl = `/api/portal/proxy-image?url=${encodeURIComponent(imageUrl)}`
        const res = await fetch(proxyUrl, { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = objectUrl
        a.download = getDownloadFilename(imageUrl, i)
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(objectUrl)
        successCount += 1
      } catch (e) {
        console.error("download image failed", e)
      }
    }

    if (successCount === imageList.length) {
      toast({ title: "Download started", description: `Starting download for ${successCount} image(s).` })
      return
    }
    toast({
      title: "Partial download",
      description: `Started ${successCount}/${imageList.length} image downloads.`,
      variant: "destructive",
    })
  }, [getDownloadFilename, imageList])

  const handleSaveEdit = async () => {
    if (!editingRoom) return
    setSaving(true)
    try {
      const priceNum = editForm.price.trim() !== "" ? Number(editForm.price) : undefined
      const r = await updateRoom(editingRoom.id, {
        roomName: editForm.roomName.trim(),
        description_fld: editForm.description_fld || undefined,
        mainPhoto: editForm.mainPhoto || undefined,
        mediaGallery: editForm.mediaGallery,
        active: editForm.active,
        price: priceNum,
        remark: editForm.remark.trim() || undefined,
        cleanlemonsCleaningTenantPriceMyr: (() => {
          const t = editForm.tenantCleaningPrice.trim()
          if (t === "") return null
          const n = Number(t)
          return Number.isFinite(n) ? n : null
        })(),
      } as Record<string, unknown>)
      if (r?.ok !== false) {
        await updateRoomMeter(editingRoom.id, editForm.meterId || null)
        await updateRoomSmartDoor(editingRoom.id, editForm.smartDoorId || null)
        setEditingRoom(null)
        await loadData({ silent: true })
      }
    } catch (e) {
      console.error(e)
      const code = e instanceof Error ? e.message : String(e)
      const activeMsg =
        code === "PROPERTY_INACTIVE_CANNOT_ACTIVATE_ROOM"
          ? "Room can be active only when its property is active."
          : code === "PROPERTY_ARCHIVED_CANNOT_ACTIVATE_ROOM"
            ? "Unarchive the property first, or keep the room inactive while the property is archived."
            : null
      const smartDoorMsg =
        code === "SMART_DOOR_ALREADY_USED_BY_PROPERTY"
          ? "This lock is already bound to a property. Remove it under Property → Utilities first."
          : code === "SMART_DOOR_ALREADY_USED_BY_ROOM"
            ? "This lock is already bound to another room."
            : code === "INVALID_OR_INACTIVE_SMART_DOOR"
              ? "Invalid or inactive lock."
              : null
      toast({
        title: activeMsg ? "Room Active blocked" : smartDoorMsg ? "Smart door" : "Save failed",
        description: activeMsg ?? smartDoorMsg ?? code,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const submitScheduleCleaningRoom = async () => {
    const pid = String(scheduleRoom?.propertyId || scheduleRoom?.property?._id || "")
    if (!scheduleRoom?.id || !pid || !scheduleDate) return
    setSchedulingJob(true)
    try {
      const r = await scheduleCleanlemonsCleaningJob({
        propertyId: pid,
        roomId: scheduleRoom.id,
        date: scheduleDate,
        time: scheduleTime || "09:00",
        serviceProvider: "room-rental-cleaning",
      })
      if (r?.ok) {
        toast({ title: "Cleaning scheduled", description: "Job created in Cleanlemons." })
        setScheduleRoom(null)
      } else {
        toast({
          title: "Schedule failed",
          description: (r as { reason?: string })?.reason || "Unknown error",
          variant: "destructive",
        })
      }
    } catch (e) {
      console.error(e)
      toast({ title: "Schedule failed", variant: "destructive" })
    } finally {
      setSchedulingJob(false)
    }
  }

  const handleDeleteRoom = async () => {
    if (!editingRoom) return
    if (roomBindingsSaved.meter || roomBindingsSaved.smartdoor) {
      toast({
        title: "Cannot delete room",
        description: "Unbind meter and smart door (set to None and Save), then delete.",
        variant: "destructive",
      })
      return
    }
    if (editingRoom.hasActiveTenancy) {
      toast({
        title: "Cannot delete room",
        description: "End or expire the active tenancy for this room first.",
        variant: "destructive",
      })
      return
    }
    const confirmed = window.confirm("Delete this room? This only works when tenancy is not ongoing, and meter/smart door are unbound.")
    if (!confirmed) return
    setDeleting(true)
    try {
      const res = await deleteRoom(editingRoom.id)
      if (res?.ok === false) {
        const reason = String(res.reason || "")
        const msg =
          reason === "ROOM_HAS_ONGOING_TENANCY"
            ? "Cannot delete: tenancy is still ongoing. Please terminate/expire tenancy first."
            : reason === "ROOM_METER_BOUND"
              ? "Cannot delete: this room is still bound to a meter. Unmap meter first."
              : reason === "ROOM_SMARTDOOR_BOUND"
                ? "Cannot delete: this room is still bound to a smart door. Unmap smart door first."
                : reason || "Delete failed."
        toast({ title: "Delete blocked", description: msg, variant: "destructive" })
        return
      }
      setEditingRoom(null)
      await loadData({ silent: true })
      toast({ title: "Room deleted" })
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      const detail =
        msg.includes("ROOM_HAS_ONGOING_TENANCY")
          ? "Tenancy is still ongoing. Terminate or expire tenancy first."
          : msg.includes("ROOM_METER_BOUND")
            ? "This room is still bound to a meter. Unbind in this dialog (None + Save), then delete."
            : msg.includes("ROOM_SMARTDOOR_BOUND")
              ? "This room is still bound to a smart door. Unbind in this dialog (None + Save), then delete."
              : msg
      toast({ title: "Delete failed", description: detail, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  const handleSyncRoomAvailability = async () => {
    if (!editingRoom) return
    setSyncingAvail(true)
    try {
      const res = (await syncRoomAvailability(editingRoom.id)) as { ok?: boolean; room?: RoomItem; reason?: string }
      if (res?.ok === false) {
        toast({ title: "Sync failed", description: res?.reason || "Could not sync availability.", variant: "destructive" })
        return
      }
      const rm = res?.room as RoomItem | undefined
      if (rm) {
        setEditForm((f) => ({
          ...f,
          available: rm.available !== false,
          availableSoon: !!rm.availablesoon,
        }))
      }
      await loadData({ silent: true })
      toast({ title: "Availability updated", description: "Flags were recalculated from tenancy data for this room." })
    } catch (e) {
      console.error(e)
      toast({
        title: "Sync failed",
        description: e instanceof Error ? e.message : "Network error",
        variant: "destructive",
      })
    } finally {
      setSyncingAvail(false)
    }
  }

  const handleToggleRoomActive = async (room: RoomItem) => {
    const next = !room.active
    try {
      const r = await setRoomActive(room.id, next) as { ok?: boolean; reason?: string }
      if (r?.ok === false) {
        const reason = String(r.reason || "")
        const msg =
          reason === "PROPERTY_INACTIVE_CANNOT_ACTIVATE_ROOM"
            ? "Room can be active only when its property is active."
            : reason === "PROPERTY_ARCHIVED_CANNOT_ACTIVATE_ROOM"
              ? "Unarchive the property first, or keep the room inactive while the property is archived."
              : (r.reason || "Could not update room Active.")
        toast({
          title: "Active update failed",
          description: msg,
          variant: "destructive",
        })
        return
      }
      await loadData({ silent: true })
    } catch (e) {
      console.error(e)
      toast({
        title: "Active update failed",
        description:
          e instanceof Error && e.message.includes("PROPERTY_INACTIVE_CANNOT_ACTIVATE_ROOM")
            ? "Room can be active only when its property is active."
            : e instanceof Error && e.message.includes("PROPERTY_ARCHIVED_CANNOT_ACTIVATE_ROOM")
              ? "Unarchive the property first, or keep the room inactive while the property is archived."
              : (e instanceof Error ? e.message : "Network error"),
        variant: "destructive",
      })
    }
  }

  const addDialogPropertyValid =
    !!editForm.propertyId &&
    (properties ?? []).some((p) => p.value === editForm.propertyId)

  const handleAdd = async () => {
    if (!addDialogPropertyValid || !editForm.roomName.trim()) return
    setSaving(true)
    try {
      const r = await insertRoom([{ roomName: editForm.roomName.trim(), property: editForm.propertyId }])
      if (r?.ok !== false) {
        setShowAddDialog(false)
        const nextProp = (properties ?? []).find((p) => p.value)?.value || ""
        setEditForm({
          roomName: "",
          propertyId: nextProp,
          meterId: "",
          smartDoorId: "",
          description_fld: "",
          mainPhoto: null,
          mediaGallery: [],
          active: true,
          available: true,
          availableSoon: false,
          price: "",
          remark: "",
          tenantCleaningPrice: "",
        })
        setListingActiveFilter("ALL")
        await loadData({ silent: true, page: 1, listingActiveFilter: "ALL" })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Room Settings</h1>
          <p className="text-sm text-muted-foreground">Configure room details, pricing, and amenities</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search..."
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              setCurrentPage(1)
            }}
            className="border border-border rounded-lg px-3 py-2 text-sm w-40"
          />
          <select
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value)
              setCurrentPage(1)
            }}
            className="border border-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All properties</option>
            {(properties ?? []).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as TypeFilter); setCurrentPage(1) }} className="border border-border rounded-lg px-3 py-2 text-sm">
            <option value="ALL">All</option>
            <option value="AVAILABLE">Available</option>
            <option value="AVAILABLE_SOON">Available Soon</option>
            <option value="NON_AVAILABLE">Not available</option>
          </select>
          <select
            value={listingActiveFilter}
            onChange={(e) => {
              setListingActiveFilter(e.target.value as ListingActiveFilter)
              setCurrentPage(1)
            }}
            className="border border-border rounded-lg px-3 py-2 text-sm"
            title="Filter by room listing Active (roomdetail.active)"
            aria-label="Filter by listing active or inactive"
          >
            <option value="ALL">Listing: all</option>
            <option value="ACTIVE">Listing: active</option>
            <option value="INACTIVE">Listing: inactive</option>
          </select>
          <Button
            className="gap-2"
            style={{ background: "var(--brand)" }}
            onClick={() => {
              /* Page property filter only affects the table; modal uses its own dropdown (default = first property). */
              const defaultProp = (properties ?? []).find((p) => p.value)?.value || ""
              setEditForm({ roomName: "", propertyId: defaultProp, meterId: "", smartDoorId: "", description_fld: "", mainPhoto: null, mediaGallery: [], active: true, available: true, availableSoon: false, price: "", remark: "", tenantCleaningPrice: "" })
              setShowAddDialog(true)
            }}
          >
            <Plus size={18} /> Add Room
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
                <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Property</th>
                <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Room</th>
                <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Status</th>
                <th className="text-left py-3 px-4 font-semibold text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help border-b border-dotted border-muted-foreground">Active</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-left">
                      <p className="font-medium">Room listing (DB: roomdetail.active)</p>
                      <p className="mt-1 text-muted-foreground">
                        <strong>Not</strong> meter power — relay is <strong>Meter Setting</strong> → Active. Top-up / Clear kWh / Sync <strong>do not</strong> update this field.
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Toggle here controls whether the room is <strong>live</strong> for Available Unit / booking (together with Available). Separate from <strong>Meter Setting</strong> → Active (power).
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </th>
                <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Available</th>
                <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Tenant</th>
                <th className="text-center py-3 px-4 font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-4">{room.property?.shortname || room.propertyId || "—"}</td>
                  <td className="py-3 px-4 font-semibold">{room.roomName || room.id}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${room.hasActiveTenancy ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                      {room.hasActiveTenancy ? <Check size={12} /> : <X size={12} />}
                      {room.hasActiveTenancy ? "Occupied" : "Vacant"}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <Switch
                      checked={room.active !== false}
                      onCheckedChange={() => handleToggleRoomActive(room)}
                    />
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${
                      room.availablesoon ? "bg-teal-700 text-white" : room.available ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {room.availablesoon ? "Available Soon" : room.available ? "Available" : "Not available"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground text-xs">—</td>
                  <td className="py-3 px-4 text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="rounded-lg h-8 w-8" title="Actions">
                          <MoreHorizontal size={18} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openViewDetail(room)}>
                          <Eye size={14} className="mr-2" /> View detail
                        </DropdownMenuItem>
                        {cleanlemonsLinked &&
                          (room.propertyId || room.property?._id) &&
                          roomCleaningScheduleInfo[room.id]?.canSchedule && (
                            <DropdownMenuItem
                              onClick={() => {
                                setScheduleRoom(room)
                                setScheduleDate(new Date().toISOString().slice(0, 10))
                                setScheduleTime("09:00")
                              }}
                            >
                              <Calendar size={14} className="mr-2" /> Schedule cleaning
                            </DropdownMenuItem>
                          )}
                        <DropdownMenuItem onClick={() => openEdit(room)}>
                          <Edit size={14} className="mr-2" /> Edit
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-1 py-3 border-t border-border text-sm rounded-lg">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>Show</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="border border-border rounded-lg px-2 py-1.5 text-sm bg-background w-[76px]"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>per page</span>
          </div>
          <div className="text-muted-foreground text-center sm:flex-1">
            {total === 0 ? (
              <span>0 rooms</span>
            ) : (
              <span>
                Showing <span className="font-medium text-foreground tabular-nums">{rangeFrom}</span>–
                <span className="font-medium text-foreground tabular-nums">{rangeTo}</span> of{" "}
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
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="px-2 text-muted-foreground tabular-nums min-w-[6.5rem] text-center">
              Page {currentPage} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
      {!loading && total === 0 && <div className="py-8 text-center text-muted-foreground">No rooms match your search or filters.</div>}

      <Dialog
        open={!!editingRoom}
        onOpenChange={(o) => {
          if (!o) {
            setEditingRoom(null)
            setCleaningPricing(null)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle>Edit Room</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-4 py-2">
            {editingRoom && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0 flex-1">
                  <Label className="text-xs">Available (system — bookings & tenancies)</Label>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${
                      editForm.availableSoon
                        ? "bg-teal-700 text-white"
                        : editForm.available
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {editForm.availableSoon ? "Available soon" : editForm.available ? "Available" : "Not available"}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={handleSyncRoomAvailability} disabled={syncingAvail}>
                    {syncingAvail ? "Syncing…" : "Sync"}
                  </Button>
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs">Room name</Label>
              <Input value={editForm.roomName} onChange={(e) => setEditForm(f => ({ ...f, roomName: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <textarea
                value={editForm.description_fld}
                onChange={(e) => setEditForm(f => ({ ...f, description_fld: e.target.value }))}
                className="mt-1 w-full min-h-[80px] px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Room description..."
              />
            </div>
            <div>
              <Label className="text-xs">Price</Label>
              <Input type="number" min={0} step={0.01} value={editForm.price} onChange={(e) => setEditForm(f => ({ ...f, price: e.target.value }))} className="mt-1" placeholder="0" />
            </div>
            <div>
              <Label className="text-xs">Remark</Label>
              <select
                value={editForm.remark}
                onChange={(e) => setEditForm(f => ({ ...f, remark: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground"
              >
                {REMARK_OPTIONS.map((o) => <option key={o.value || "__empty"} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {cleanlemonsLinked && editingRoom && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-semibold">Cleanlemons — Room rental cleaning</p>
                    <p className="text-xs text-muted-foreground">
                      Default pricing (from Cleanlemons):{" "}
                      {cleaningPricing?.showRefWarmcleaning && cleaningPricing.refWarmcleaning != null ? (
                        <span className="font-medium text-foreground">RM {Number(cleaningPricing.refWarmcleaning).toFixed(2)}</span>
                      ) : (
                        <span>—</span>
                      )}
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground shrink-0 rounded-sm p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="About room rental cleaning"
                      >
                        <Info size={16} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-left">
                      <p>
                        Reference cost from Cleanlemons; tenant portal only sees &quot;Tenant price&quot; below. Scheduling uses Malaysia time (UTC+8).
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div>
                  <Label className="text-xs">Tenant price (MYR)</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Amount you charge the tenant. Empty = hide cleaning order on tenant portal.
                  </p>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={editForm.tenantCleaningPrice}
                    onChange={(e) => setEditForm((f) => ({ ...f, tenantCleaningPrice: e.target.value }))}
                    className="mt-1"
                    placeholder="e.g. 80"
                  />
                </div>
                {cleaningPricing?.showRefWarmcleaning &&
                  cleaningPricing.refWarmcleaning != null &&
                  Number(cleaningPricing.refWarmcleaning) > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        if (!editingRoom) return
                        const rw = cleaningPricing?.refWarmcleaning
                        if (rw != null && Number(rw) > 0) {
                          setRoomCleaningScheduleInfo((prev) => ({
                            ...prev,
                            [editingRoom.id]: { canSchedule: true, refWarmcleaning: Number(rw) },
                          }))
                        }
                        setScheduleRoom(editingRoom)
                        setScheduleDate(new Date().toISOString().slice(0, 10))
                        setScheduleTime("09:00")
                      }}
                    >
                      <Calendar size={14} /> Schedule cleaning
                    </Button>
                  )}
              </div>
            )}
            <div>
              <Label className="text-xs">Images (first = main photo; drag to reorder)</Label>
              <div className="mt-1 space-y-2">
                <div className="flex flex-wrap gap-2 items-start">
                  {imageList.map((src, index) => (
                    <div
                      key={`${src}-${index}`}
                      draggable
                      onDragStart={() => handleImageDragStart(index)}
                      onDragOver={handleImageDragOver}
                      onDrop={() => handleImageDrop(index)}
                      onDragEnd={handleImageDragEnd}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border border-border bg-muted/30 min-w-[100px] ${draggedImageIndex === index ? "opacity-50" : ""}`}
                    >
                      <div className="flex items-center gap-1 w-full justify-between">
                        <GripVertical size={14} className="text-muted-foreground cursor-grab shrink-0" />
                        <span className="text-[10px] text-muted-foreground truncate flex-1">{index === 0 ? "Main" : `${index + 1}`}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive hover:text-destructive" onClick={() => removeImageAt(index)} title="Delete">
                          <Trash2 size={12} />
                        </Button>
                      </div>
                      <a href={wixImageToStatic(src)} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded overflow-hidden border border-border bg-background shrink-0">
                        <img src={wixImageToStatic(src)} alt="" className="w-full h-full object-cover" />
                      </a>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="file" ref={mainPhotoInputRef} accept="image/*" multiple className="hidden" onChange={handleAddImage} />
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => mainPhotoInputRef.current?.click()} disabled={uploading}>
                    <Upload size={14} /> {uploading ? "Uploading..." : "Add images"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={handleDownloadAllImages} disabled={imageList.length === 0}>
                    <Download size={14} /> Download all
                  </Button>
                </div>
              </div>
            </div>
            <div>
              <Label className="text-xs">Property</Label>
              <Select value={(editForm.propertyId && (properties ?? []).some((p) => p.value === editForm.propertyId)) ? editForm.propertyId : ((properties ?? [])[0]?.value ?? "__placeholder__")} onValueChange={(v) => setEditForm(f => ({ ...f, propertyId: v === "__placeholder__" ? "" : v }))} disabled={!!editingRoom}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select property" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__placeholder__">Select property</SelectItem>
                  {(properties ?? []).filter((p) => p.value).map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {editingRoom && <p className="text-xs text-muted-foreground mt-1">Property cannot be changed when editing a room.</p>}
            </div>
            <div>
              <Label className="text-xs">Meter</Label>
              <Select value={editForm.meterId ? editForm.meterId : "__none__"} onValueChange={(v) => setEditForm(f => ({ ...f, meterId: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {(meterOptions ?? []).map((o) => <SelectItem key={o.value || o.label} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {editingRoom && (meterOptions ?? []).length === 0 && <p className="text-xs text-muted-foreground mt-1">No meters available. Add or unbind in Meter Setting.</p>}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Smart Door</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground rounded-sm p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Smart door binding rules"
                    >
                      <Info size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm text-left">
                    <p>
                      Same rule as meter: one lock can only be bound to either the property (Property → Utilities) or one room—not both. Locks already on a property are not shown here.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select value={editForm.smartDoorId ? editForm.smartDoorId : "__none__"} onValueChange={(v) => setEditForm(f => ({ ...f, smartDoorId: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {(smartDoorOptions ?? []).map((o) => <SelectItem key={o.value || o.label} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {editingRoom && (smartDoorOptions ?? []).length === 0 && (
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">No locks listed for this room</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground rounded-sm p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Why no smart doors in list"
                      >
                        <Info size={14} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-left">
                      <p>No smart doors available. Add devices in Smart Door setting, or unbind elsewhere.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
            </div>
          </div>
          <DialogFooter className="shrink-0">
            <Button
              variant="destructive"
              onClick={handleDeleteRoom}
              disabled={
                saving ||
                deleting ||
                roomBindingsSaved.meter ||
                roomBindingsSaved.smartdoor ||
                !!editingRoom?.hasActiveTenancy
              }
              title={
                roomBindingsSaved.meter || roomBindingsSaved.smartdoor
                  ? "Unbind meter and smart door (None + Save), then delete."
                  : editingRoom?.hasActiveTenancy
                    ? "End tenancy before deleting this room."
                    : undefined
              }
              className="mr-auto"
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
            <Button variant="outline" onClick={() => setEditingRoom(null)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSaveEdit} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!scheduleRoom} onOpenChange={(o) => !o && setScheduleRoom(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Schedule cleaning — {scheduleRoom?.roomName || scheduleRoom?.id}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Room rental cleaning · Malaysia time (UTC+8)</p>
          {scheduleRoom?.id && roomCleaningScheduleInfo[scheduleRoom.id]?.refWarmcleaning != null && (
            <p className="text-sm font-medium text-foreground">
              Reference (operator): RM{" "}
              {Number(roomCleaningScheduleInfo[scheduleRoom.id].refWarmcleaning).toFixed(2)}
            </p>
          )}
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Time</Label>
              <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleRoom(null)}>Cancel</Button>
            <Button
              style={{ background: "var(--brand)" }}
              onClick={submitScheduleCleaningRoom}
              disabled={schedulingJob || !scheduleDate}
            >
              {schedulingJob ? "Scheduling..." : "Create job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader><DialogTitle>Add Room</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Room name</Label>
              <Input value={editForm.roomName} onChange={(e) => setEditForm(f => ({ ...f, roomName: e.target.value }))} placeholder="e.g. 101" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Property</Label>
              <Select
                value={addDialogPropertyValid ? editForm.propertyId! : "__placeholder__"}
                onValueChange={(v) => setEditForm((f) => ({ ...f, propertyId: v === "__placeholder__" ? "" : v }))}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select property" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__placeholder__">Select property</SelectItem>
                  {(properties ?? []).filter((p) => p.value).map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleAdd} disabled={saving || !addDialogPropertyValid || !editForm.roomName.trim()}>{saving ? "Adding..." : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewDetailRoom} onOpenChange={(o) => !o && setViewDetailRoom(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Room detail</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {viewDetailRoom && <p className="font-semibold text-foreground">{viewDetailRoom.roomName || viewDetailRoom.id}</p>}
            {loadingDetail && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!loadingDetail && tenancyDetail && (
              <div className="text-sm space-y-2">
                {tenancyDetail.tenant && (
                  <>
                    <p><span className="text-muted-foreground">Tenant:</span> {tenancyDetail.tenant.fullname || "—"}</p>
                    <p><span className="text-muted-foreground">Phone:</span> {tenancyDetail.tenant.phone || "—"}</p>
                  </>
                )}
                {tenancyDetail.rental != null && <p><span className="text-muted-foreground">Rental:</span> RM {tenancyDetail.rental}</p>}
                {(tenancyDetail.begin || tenancyDetail.end) && (
                  <p><span className="text-muted-foreground">Period:</span>{" "}
                    {tenancyDetail.begin && tenancyDetail.end
                      ? `${new Date(tenancyDetail.begin).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} – ${new Date(tenancyDetail.end).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
                      : tenancyDetail.begin || tenancyDetail.end || "—"}
                  </p>
                )}
              </div>
            )}
            {!loadingDetail && !tenancyDetail && viewDetailRoom && <p className="text-sm text-muted-foreground">No active tenancy for this room.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDetailRoom(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
