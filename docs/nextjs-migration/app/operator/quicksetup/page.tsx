"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import {
  Building2,
  DoorOpen,
  Lock,
  Zap,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  SkipForward,
  Info,
  Upload,
  UserPlus,
  Plus,
  Trash2,
  RefreshCw,
  ClipboardList,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  getApartmentNames,
  insertProperty,
  insertRoom,
  updateRoom,
  updateProperty,
  setPropertyActive,
  setRoomActive,
  saveOwnerInvitation,
  uploadFile,
  previewSmartDoorSelection,
  insertSmartDoors,
  insertMetersFromPreview,
  updateMeter,
  rollbackQuickSetupOnboarding,
  isLikelyImageFile,
  getPropertyOwners,
} from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import { wixImageToStatic } from "@/lib/utils"

const DRAFT_KEY = "operator-quicksetup-draft"

const REMARK_OPTIONS = [
  { label: "—", value: "" },
  { label: "Mix Gender", value: "Mix Gender" },
  { label: "Girl Only", value: "Girl Only" },
  { label: "Male Only", value: "Male Only" },
] as const

type StepId = "property" | "room" | "smartdoor" | "meter" | "owner" | "summary"

interface RoomDraft {
  roomName: string
  price: string
  description_fld: string
  remark: string
  photos: string[]
}

interface MeterDraft {
  meterId: string
  title: string
  rate: string
}

interface QuicksetupDraft {
  stepIndex: number
  /** When selecting existing building: "apartmentName||country". When new: "__new__". */
  selectedPropertyId: string
  unitNumberForSelected: string
  newProperty: { apartmentName: string; unitNumber: string; address: string; country: "MY" | "SG" }
  /** Applies to the property being created (new or existing building + unit). */
  ownerSettlementModel: "management_percent_gross" | "management_percent_net" | "management_percent_rental_income_only" | "management_fees_fixed" | "rental_unit" | "guarantee_return_fixed_plus_share"
  managementPercent: string
  fixedRentToOwner: string
  rooms: RoomDraft[]
  skipped: Record<string, boolean>
  /**
   * "" = none · "__new__" = add by email · else = existing owner id from propertysetting/owners.
   */
  ownerSelection: string
  /** When ownerSelection === "__new__". */
  ownerEmail: string
  meters: MeterDraft[]
}

const STEPS: { id: StepId; label: string; icon: typeof Building2; canSkip: boolean }[] = [
  { id: "property", label: "Property", icon: Building2, canSkip: false },
  { id: "room", label: "Room (min 1)", icon: DoorOpen, canSkip: false },
  { id: "smartdoor", label: "Smart Door", icon: Lock, canSkip: true },
  { id: "meter", label: "Meter", icon: Zap, canSkip: true },
  { id: "owner", label: "Bind Owner", icon: UserPlus, canSkip: true },
  { id: "summary", label: "Summary", icon: ClipboardList, canSkip: false },
]

const defaultDraft: QuicksetupDraft = {
  stepIndex: 0,
  selectedPropertyId: "",
  unitNumberForSelected: "",
  newProperty: { apartmentName: "", unitNumber: "", address: "", country: "MY" },
  ownerSettlementModel: "management_percent_gross",
  managementPercent: "",
  fixedRentToOwner: "",
  rooms: [{ roomName: "", price: "", description_fld: "", remark: "", photos: [] }],
  skipped: {},
  ownerSelection: "",
  ownerEmail: "",
  meters: [],
}

function loadDraft(): QuicksetupDraft | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as QuicksetupDraft
    return {
      ...defaultDraft,
      ...parsed,
      unitNumberForSelected: parsed.unitNumberForSelected ?? defaultDraft.unitNumberForSelected,
      newProperty: { ...defaultDraft.newProperty, ...parsed.newProperty },
      ownerSettlementModel:
        parsed.ownerSettlementModel === "management_percent_net"
          ? "management_percent_net"
          : parsed.ownerSettlementModel === "management_percent_rental_income_only"
            ? "management_percent_rental_income_only"
          : parsed.ownerSettlementModel === "management_fees_fixed"
            ? "management_fees_fixed"
            : parsed.ownerSettlementModel === "rental_unit" || parsed.ownerSettlementModel === "fixed_rent_to_owner"
              ? "rental_unit"
              : parsed.ownerSettlementModel === "guarantee_return_fixed_plus_share"
                ? "guarantee_return_fixed_plus_share"
                : "management_percent_gross",
      managementPercent: typeof parsed.managementPercent === "string" ? parsed.managementPercent : defaultDraft.managementPercent,
      fixedRentToOwner: typeof parsed.fixedRentToOwner === "string" ? parsed.fixedRentToOwner : defaultDraft.fixedRentToOwner,
      rooms: Array.isArray(parsed.rooms) && parsed.rooms.length >= 1
        ? parsed.rooms.map((r) => ({ ...defaultDraft.rooms[0], ...r, photos: Array.isArray((r as RoomDraft).photos) ? (r as RoomDraft).photos : [] }))
        : defaultDraft.rooms,
      skipped: { ...defaultDraft.skipped, ...parsed.skipped },
      ownerSelection: (() => {
        const p = parsed as QuicksetupDraft & { ownerId?: string }
        if (typeof p.ownerSelection === "string" && p.ownerSelection !== "") return p.ownerSelection
        if (p.ownerEmail && String(p.ownerEmail).trim()) return "__new__"
        if (typeof p.ownerId === "string" && p.ownerId) return p.ownerId
        return ""
      })(),
      meters: Array.isArray(parsed.meters) ? parsed.meters : defaultDraft.meters,
    }
  } catch {
    return null
  }
}

function saveDraft(draft: QuicksetupDraft) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {}
}

function clearDraft() {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {}
}

/** Hint text under a field */
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
      <Info size={12} className="flex-shrink-0" />
      {children}
    </p>
  )
}

type BuildingOption = { apartmentName: string; country: string }

export default function QuickSetupPage() {
  const { refresh, accessCtx, isLoading: operatorCtxLoading } = useOperatorContext()
  const [draft, setDraft] = useState<QuicksetupDraft>(defaultDraft)
  const [hydrated, setHydrated] = useState(false)
  const [buildingOptions, setBuildingOptions] = useState<BuildingOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [smartDoorPreviewList, setSmartDoorPreviewList] = useState<Array<Record<string, unknown> & { selected?: boolean; alias?: string }>>([])
  const [smartDoorSyncing, setSmartDoorSyncing] = useState(false)
  const [smartDoorImportSaving, setSmartDoorImportSaving] = useState(false)
  const [addOwnerOpen, setAddOwnerOpen] = useState(false)
  const [ownerOptions, setOwnerOptions] = useState<Array<{ label: string; value: string }>>([])
  const [roomPhotoUploading, setRoomPhotoUploading] = useState<number | null>(null)
  const [roomPhotoError, setRoomPhotoError] = useState<string | null>(null)
  const operatorCountry: "MY" | "SG" =
    String(accessCtx?.client?.currency || "").toUpperCase() === "SGD" ? "SG" : "MY"
  const canUploadRoomPhotos =
    !operatorCtxLoading && accessCtx?.ok === true && Boolean(accessCtx?.client?.id)

  useEffect(() => {
    const stored = loadDraft()
    if (stored) setDraft(stored)
    setHydrated(true)
  }, [])

  useEffect(() => {
    getApartmentNames(operatorCountry).then((r) => {
      const items = (r?.items ?? []) as BuildingOption[]
      setBuildingOptions(items)
    }).catch(() => {})
  }, [operatorCountry])

  const effectiveStepIndex = Math.max(0, Math.min(draft.stepIndex, STEPS.length - 1))
  const currentStepId = STEPS[effectiveStepIndex]?.id ?? "property"
  const StepIcon = STEPS[effectiveStepIndex]?.icon ?? Building2

  useEffect(() => {
    if (currentStepId !== "owner" && currentStepId !== "summary") return
    getPropertyOwners()
      .then((r) => setOwnerOptions(Array.isArray(r?.options) ? r.options : []))
      .catch(() => setOwnerOptions([]))
  }, [currentStepId])
  const filteredBuildingOptions = buildingOptions.filter((b) => ((b.country || "").toUpperCase() === "SG" ? "SG" : "MY") === operatorCountry)
  const isPropertyNew = draft.selectedPropertyId === "__new__"
  const settlementValid = draft.ownerSettlementModel === "guarantee_return_fixed_plus_share"
    ? Number(draft.fixedRentToOwner) > 0 && Number(draft.managementPercent) > 0
    : (draft.ownerSettlementModel === "management_fees_fixed" || draft.ownerSettlementModel === "rental_unit")
      ? Number(draft.fixedRentToOwner) > 0
      : Number(draft.managementPercent) > 0
  const propertyValid =
    settlementValid &&
    (isPropertyNew
      ? draft.newProperty.apartmentName.trim() !== "" && draft.newProperty.unitNumber.trim() !== ""
      : draft.selectedPropertyId.trim() !== "" && draft.unitNumberForSelected.trim() !== "")
  const persistDraft = useCallback((next: Partial<QuicksetupDraft> | ((prev: QuicksetupDraft) => QuicksetupDraft)) => {
    setDraft((prev) => {
      const nextDraft = typeof next === "function" ? next(prev) : { ...prev, ...next }
      saveDraft(nextDraft)
      return nextDraft
    })
  }, [])

  const summaryStepIndex = STEPS.findIndex((s) => s.id === "summary")
  const ownerStepIndex = STEPS.findIndex((s) => s.id === "owner")

  useEffect(() => {
    persistDraft((prev) => {
      let changed = false
      const next = { ...prev, newProperty: { ...prev.newProperty } }
      if (next.newProperty.country !== operatorCountry) {
        next.newProperty.country = operatorCountry
        changed = true
      }
      if (next.selectedPropertyId && next.selectedPropertyId !== "__new__") {
        const selectedCountry = ((next.selectedPropertyId.split("||")[1] || "").toUpperCase() === "SG" ? "SG" : "MY")
        if (selectedCountry !== operatorCountry) {
          next.selectedPropertyId = ""
          next.unitNumberForSelected = ""
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [operatorCountry, persistDraft])

  const goNext = () => {
    setError(null)
    if (effectiveStepIndex < STEPS.length - 1) {
      const nextIndex = effectiveStepIndex + 1
      persistDraft({ stepIndex: nextIndex })
    }
  }

  const goPrev = () => {
    setError(null)
    if (effectiveStepIndex > 0) {
      let prevIndex = effectiveStepIndex - 1
      if (currentStepId === "summary" && draft.skipped.owner) {
        prevIndex = ownerStepIndex
      }
      persistDraft({ stepIndex: prevIndex })
    }
  }

  const handleSkip = () => {
    setError(null)
    const step = STEPS[effectiveStepIndex]
    if (!step?.canSkip) return
    let nextIndex = Math.min(effectiveStepIndex + 1, STEPS.length - 1)
    if (step.id === "owner") {
      nextIndex = summaryStepIndex
    }
    persistDraft((prev) => ({
      ...prev,
      skipped: { ...prev.skipped, [step.id]: true },
      stepIndex: nextIndex,
    }))
  }

  const handleComplete = async () => {
    if (!propertyValid) {
      setError("Select a property or add a new building.")
      return
    }
    if (draft.rooms.length < 1 || draft.rooms.some((r) => !r.roomName.trim())) {
      setError("At least one room with a name is required.")
      return
    }
    if (roomPhotoUploading !== null) {
      setError("Wait for room photos to finish uploading.")
      return
    }
    if (draft.rooms.some((r) => r.photos.some((u) => String(u).startsWith("blob:")))) {
      setError("Wait until each photo finishes uploading (local preview will switch to the saved image).")
      return
    }
    setSubmitting(true)
    setError(null)

    let propertyIdForRollback: string | undefined
    let roomIdsForRollback: string[] = []
    let meterIdsForRollback: string[] = []

    const doRollback = async () => {
      if (!propertyIdForRollback && roomIdsForRollback.length === 0 && meterIdsForRollback.length === 0) return
      try {
        await rollbackQuickSetupOnboarding({
          propertyId: propertyIdForRollback,
          roomIds: roomIdsForRollback,
          meterIds: meterIdsForRollback,
        })
      } catch (rbErr) {
        console.error("[quicksetup] rollback-onboarding failed", rbErr)
      }
    }

    let committed = false
    try {
      let propertyId: string
      if (isPropertyNew) {
        const propRes = await insertProperty([
          {
            apartmentName: draft.newProperty.apartmentName.trim(),
            unitNumber: draft.newProperty.unitNumber.trim() || undefined,
            country: operatorCountry,
            ownerSettlementModel: draft.ownerSettlementModel,
            ...(draft.ownerSettlementModel === "management_percent_gross" || draft.ownerSettlementModel === "management_percent_net"
              ? { percentage: Number(draft.managementPercent) }
              : draft.ownerSettlementModel === "management_percent_rental_income_only"
                ? { percentage: Number(draft.managementPercent) }
              : draft.ownerSettlementModel === "guarantee_return_fixed_plus_share"
                ? { percentage: Number(draft.managementPercent), fixedRentToOwner: Number(draft.fixedRentToOwner) }
                : { fixedRentToOwner: Number(draft.fixedRentToOwner) }),
          },
        ])
        const ids = (propRes as { ids?: string[] })?.ids
        if (!ids?.[0]) {
          setError((propRes as { reason?: string })?.reason || "Failed to create property.")
          return
        }
        propertyId = ids[0]
        propertyIdForRollback = propertyId
        if (draft.newProperty.address.trim()) {
          await updateProperty(propertyId, { address: draft.newProperty.address.trim() })
        }
      } else {
        const [apartmentName, country] = draft.selectedPropertyId.split("||")
        const selectedCountry = country === "SG" ? "SG" : "MY"
        if (selectedCountry !== operatorCountry) {
          setError(`Selected building country does not match operator country (${operatorCountry}).`)
          return
        }
        const propRes = await insertProperty([
          {
            apartmentName: (apartmentName || "").trim(),
            unitNumber: draft.unitNumberForSelected.trim() || undefined,
            country: operatorCountry,
            ownerSettlementModel: draft.ownerSettlementModel,
            ...(draft.ownerSettlementModel === "management_percent_gross" || draft.ownerSettlementModel === "management_percent_net"
              ? { percentage: Number(draft.managementPercent) }
              : draft.ownerSettlementModel === "management_percent_rental_income_only"
                ? { percentage: Number(draft.managementPercent) }
              : draft.ownerSettlementModel === "guarantee_return_fixed_plus_share"
                ? { percentage: Number(draft.managementPercent), fixedRentToOwner: Number(draft.fixedRentToOwner) }
                : { fixedRentToOwner: Number(draft.fixedRentToOwner) }),
          },
        ])
        const ids = (propRes as { ids?: string[] })?.ids
        if (!ids?.[0]) {
          setError((propRes as { reason?: string })?.reason || "Failed to create property.")
          return
        }
        propertyId = ids[0]
        propertyIdForRollback = propertyId
      }

      const roomRecords = draft.rooms.map((r) => ({
        roomName: r.roomName.trim(),
        property: propertyId,
      }))
      const roomRes = await insertRoom(roomRecords)
      const roomIds = (roomRes as { ids?: string[] })?.ids ?? []
      roomIdsForRollback = [...roomIds]

      for (let i = 0; i < roomIds.length; i++) {
        const roomId = roomIds[i]
        const r = draft.rooms[i]
        if (roomId && r) {
          const mainPhoto = r.photos[0] || undefined
          const mediaGallery = r.photos.length > 1 ? r.photos.slice(1).map((src) => ({ type: "image" as const, src })) : []
          await updateRoom(roomId, {
            price: r.price ? Number(r.price) : undefined,
            description_fld: r.description_fld.trim() || undefined,
            remark: r.remark.trim() || undefined,
            mainPhoto,
            mediaGallery,
          })
        }
      }
      if (isPropertyNew) await setPropertyActive(propertyId, false)
      for (const roomId of roomIds) {
        await setRoomActive(roomId, false)
      }

      const validMeters = draft.meters.filter((m) => m.meterId.trim() !== "")
      if (validMeters.length > 0 && !draft.skipped.meter) {
        const meterRes = await insertMetersFromPreview(
          validMeters.map((m) => ({ meterId: m.meterId.trim(), title: m.title.trim() || m.meterId.trim() }))
        )
        const mIds = (meterRes as { ids?: string[] })?.ids ?? []
        meterIdsForRollback = [...mIds]
        for (let i = 0; i < mIds.length && i < validMeters.length; i++) {
          const rate = parseFloat(validMeters[i].rate)
          if (!Number.isNaN(rate)) await updateMeter(mIds[i], { rate })
        }
      }

      if (!draft.skipped.owner) {
        const choice = draft.ownerSelection.trim()
        if (choice === "__new__") {
          const oem = draft.ownerEmail.trim()
          if (oem) {
            const inv = await saveOwnerInvitation({ email: oem, propertyId })
            if (!inv?.ok) {
              throw new Error(
                (inv as { reason?: string })?.reason === "PROPERTY_ALREADY_HAS_OWNER"
                  ? "This property already has an owner invitation or linked owner."
                  : (inv as { reason?: string })?.reason || "Failed to save owner invitation."
              )
            }
          }
        } else if (choice) {
          const inv = await saveOwnerInvitation({ ownerId: choice, propertyId })
          if (!inv?.ok) {
            throw new Error(
              (inv as { reason?: string })?.reason === "PROPERTY_ALREADY_HAS_OWNER"
                ? "This property already has an owner invitation or linked owner."
                : (inv as { reason?: string })?.reason || "Failed to save owner invitation."
            )
          }
        }
      }

      committed = true
      clearDraft()
      setSuccess(true)
      try {
        await refresh()
      } catch (re) {
        console.error("[quicksetup] refresh after success", re)
      }
    } catch (e) {
      if (!committed) {
        await doRollback()
        setError(e instanceof Error ? e.message : "Something went wrong.")
      } else {
        console.error("[quicksetup] post-commit error", e)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const addRoom = () => {
    persistDraft((prev) => ({
      ...prev,
      rooms: [...prev.rooms, { roomName: "", price: "", description_fld: "", remark: "", photos: [] }],
    }))
  }

  const removeRoom = (index: number) => {
    if (draft.rooms.length <= 1) return
    persistDraft((prev) => ({ ...prev, rooms: prev.rooms.filter((_, i) => i !== index) }))
  }

  const updateRoomAt = (index: number, field: keyof RoomDraft, value: string | string[]) => {
    persistDraft((prev) => ({
      ...prev,
      rooms: prev.rooms.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    }))
  }

  const handleRoomPhotosUpload = async (roomIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    // Snapshot before clearing input — some browsers empty FileList / strip File.name after value="".
    const picked = Array.from(files)
    console.log("[quicksetup] room photo file input change", {
      roomIndex,
      fileCount: picked.length,
      names: picked.map((f) => f.name),
      canUploadRoomPhotos,
      clientId: accessCtx?.client?.id ? `${String(accessCtx.client.id).slice(0, 8)}…` : null,
    })
    e.target.value = ""
    setRoomPhotoError(null)
    const fileArray = picked.filter(isLikelyImageFile)
    if (!fileArray.length) {
      console.warn("[quicksetup] room photo: no file passed isLikelyImageFile filter")
      setRoomPhotoError("No supported image files (try JPG or PNG).")
      return
    }
    const blobUrls = fileArray.map((f) => URL.createObjectURL(f))
    persistDraft((prev) => ({
      ...prev,
      rooms: prev.rooms.map((r, i) =>
        i === roomIndex ? { ...r, photos: [...r.photos, ...blobUrls] } : r
      ),
    }))
    setRoomPhotoUploading(roomIndex)
    try {
      for (let i = 0; i < fileArray.length; i++) {
        const blobUrl = blobUrls[i]
        console.log("[quicksetup] room photo upload start", {
          roomIndex,
          index: i,
          name: fileArray[i].name,
          size: fileArray[i].size,
        })
        const res = await uploadFile(fileArray[i], {
          clientId: accessCtx?.client?.id ?? undefined,
        })
        console.log("[quicksetup] room photo upload result", {
          roomIndex,
          index: i,
          ok: res.ok,
          reason: res.reason,
          hasUrl: Boolean(res.url),
        })
        if (res.ok && res.url) {
          persistDraft((prev) => ({
            ...prev,
            rooms: prev.rooms.map((r, j) =>
              j === roomIndex
                ? { ...r, photos: r.photos.map((u) => (u === blobUrl ? res.url! : u)) }
                : r
            ),
          }))
          URL.revokeObjectURL(blobUrl)
        } else {
          persistDraft((prev) => ({
            ...prev,
            rooms: prev.rooms.map((r, j) =>
              j === roomIndex ? { ...r, photos: r.photos.filter((u) => u !== blobUrl) } : r
            ),
          }))
          URL.revokeObjectURL(blobUrl)
          setRoomPhotoError(
            res.reason === "NO_CLIENT_ID"
              ? "Company not selected. Open the dashboard first, then try Quick Setup again."
              : res.reason || "Upload failed"
          )
        }
      }
    } catch (err) {
      setRoomPhotoError(err instanceof Error ? err.message : "Upload failed")
      persistDraft((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r, j) =>
          j === roomIndex ? { ...r, photos: r.photos.filter((u) => !blobUrls.includes(u)) } : r
        ),
      }))
      blobUrls.forEach((u) => {
        try {
          URL.revokeObjectURL(u)
        } catch {
          /* ignore */
        }
      })
    } finally {
      setRoomPhotoUploading(null)
    }
  }

  const removeRoomPhoto = (roomIndex: number, photoIndex: number) => {
    persistDraft((prev) => {
      const url = prev.rooms[roomIndex]?.photos[photoIndex]
      if (url && String(url).startsWith("blob:")) {
        try {
          URL.revokeObjectURL(url)
        } catch {
          /* ignore */
        }
      }
      return {
        ...prev,
        rooms: prev.rooms.map((r, i) =>
          i === roomIndex ? { ...r, photos: r.photos.filter((_, j) => j !== photoIndex) } : r
        ),
      }
    })
  }

  const moveRoomPhoto = (roomIndex: number, fromIdx: number, direction: "up" | "down") => {
    const toIdx = direction === "up" ? fromIdx - 1 : fromIdx + 1
    if (toIdx < 0 || toIdx >= draft.rooms[roomIndex]?.photos.length) return
    persistDraft((prev) => {
      const room = prev.rooms[roomIndex]
      const arr = [...room.photos]
      ;[arr[fromIdx], arr[toIdx]] = [arr[toIdx], arr[fromIdx]]
      return {
        ...prev,
        rooms: prev.rooms.map((r, i) => (i === roomIndex ? { ...r, photos: arr } : r)),
      }
    })
  }

  const addMeter = () => {
    persistDraft((prev) => ({ ...prev, meters: [...prev.meters, { meterId: "", title: "", rate: "" }] }))
  }
  const removeMeter = (index: number) => {
    persistDraft((prev) => ({ ...prev, meters: prev.meters.filter((_, i) => i !== index) }))
  }
  const updateMeterAt = (index: number, field: keyof MeterDraft, value: string) => {
    persistDraft((prev) => ({
      ...prev,
      meters: prev.meters.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    }))
  }

  const handleSmartDoorSync = async () => {
    setSmartDoorSyncing(true)
    setSmartDoorPreviewList([])
    try {
      const res = await previewSmartDoorSelection()
      const list = (res?.list ?? []) as Array<Record<string, unknown>>
      setSmartDoorPreviewList(
        list.map((item) => ({
          ...item,
          selected: false,
          alias: String(item.type) === "gateway" ? (item.gatewayName ?? item.lockAlias ?? "") : (item.lockAlias ?? ""),
        }))
      )
    } catch (e) {
      console.error(e)
    } finally {
      setSmartDoorSyncing(false)
    }
  }

  const setSmartDoorItem = (i: number, patch: { selected?: boolean; alias?: string }) => {
    setSmartDoorPreviewList((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  /** Same as Smart Door → Sync Lock: import devices into MySQL only. No sync-name to TTLock here — operator binds/renames in Smart Door setting. */
  const handleSmartDoorSaveSelected = async () => {
    const selected = smartDoorPreviewList.filter((p) => p.selected && (p.alias ?? "").trim())
    if (selected.length === 0) return
    setSmartDoorImportSaving(true)
    try {
      const gateways: Array<{ gatewayId: number; gatewayName: string; networkName?: string; lockNum?: number; isOnline?: boolean; type?: string }> = []
      const locks: Array<{ lockId: number; lockAlias?: string; lockName?: string; electricQuantity?: number; type?: string; hasGateway?: boolean; brand?: string; active?: boolean; gatewayId?: string | null }> = []
      for (const p of selected) {
        const alias = (p.alias ?? "").trim()
        if (String(p.type) === "gateway") {
          gateways.push({
            gatewayId: Number(p.externalId ?? p.gatewayId ?? 0),
            gatewayName: alias,
            networkName: (p.networkName as string) ?? "",
            lockNum: (p.lockNum as number) ?? 0,
            isOnline: !!p.isOnline,
            type: "Gateway",
          })
        } else {
          locks.push({
            lockId: Number(p.externalId ?? p.lockId ?? 0),
            lockAlias: alias,
            lockName: (p.lockName as string) ?? "",
            electricQuantity: (p.electricQuantity as number) ?? 0,
            type: "Smartlock",
            hasGateway: !!p.hasGateway,
            brand: "ttlock",
            active: Boolean(p.active),
            gatewayId: (p.gatewayId as string) || null,
          })
        }
      }
      await insertSmartDoors({ gateways, locks })
      setSmartDoorPreviewList((prev) => prev.filter((p) => !p.selected))
    } catch (e) {
      console.error(e)
    } finally {
      setSmartDoorImportSaving(false)
    }
  }

  if (!hydrated) {
    return (
      <main className="p-6 flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </main>
    )
  }

  const progressPct = ((effectiveStepIndex + 1) / STEPS.length) * 100

  return (
    <main className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Quick Setup</h1>
          <p className="text-sm text-muted-foreground">Onboard a new property step by step. You can save draft and continue later.</p>
        </div>
        <Link href="/operator" className="text-sm text-muted-foreground hover:text-foreground">
          Exit to Dashboard
        </Link>
      </div>

      {/* Progressive bar */}
      <div className="mb-8">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Step {effectiveStepIndex + 1} of {STEPS.length}</span>
          <span>{Math.round(progressPct)}%</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%`, background: "var(--brand)" }}
          />
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] ${
                i < effectiveStepIndex ? "bg-green-500/20 text-green-700 dark:text-green-400" : i === effectiveStepIndex ? "bg-primary/20 text-primary font-medium" : "bg-muted text-muted-foreground"
              }`}
            >
              {i < effectiveStepIndex ? <CheckCircle size={10} /> : null}
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {success ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <CheckCircle size={48} className="text-green-600" />
              <h2 className="text-xl font-semibold text-foreground">Onboarding complete</h2>
              <p className="text-sm text-muted-foreground">
                Please activate your property and rooms in <strong>Property Setting</strong> & <strong>Room Setting</strong>.
              </p>
              <div className="flex gap-2">
                <Link href="/operator/property">
                  <Button style={{ background: "var(--brand)" }}>Property Setting</Button>
                </Link>
                <Link href="/operator/room">
                  <Button variant="outline">Room Setting</Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <StepIcon size={20} style={{ color: "var(--brand)" }} />
              {STEPS[effectiveStepIndex]?.label}
              {STEPS[effectiveStepIndex]?.canSkip && (
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Step: Property */}
            {currentStepId === "property" && (
              <div className="space-y-4">
                <div>
                  <Label>Apartment / Building name *</Label>
                  <div className="flex gap-2 mt-1 flex-wrap items-center">
                    <select
                      value={isPropertyNew ? "" : draft.selectedPropertyId}
                      onChange={(e) => persistDraft({ selectedPropertyId: e.target.value })}
                      className="flex-1 min-w-[200px] rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      disabled={isPropertyNew}
                    >
                      <option value="">Select building</option>
                      {filteredBuildingOptions.map((b) => (
                        <option key={`${b.apartmentName}||${b.country}`} value={`${b.apartmentName}||${b.country}`}>
                          {b.apartmentName} | {b.country}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => persistDraft({ selectedPropertyId: "__new__" })}
                      disabled={isPropertyNew}
                    >
                      <Plus size={16} className="mr-1" /> Add new building
                    </Button>
                  </div>
                  <Hint>Select a building in your operator country only ({operatorCountry}), or add new.</Hint>
                </div>
                {/* Unit number: when existing building selected */}
                {!isPropertyNew && draft.selectedPropertyId && (
                  <div>
                    <Label>Unit number *</Label>
                    <Input
                      value={draft.unitNumberForSelected}
                      onChange={(e) => persistDraft({ unitNumberForSelected: e.target.value })}
                      placeholder="e.g. 12-01, Unit 101"
                      className="mt-1"
                    />
                    <Hint>Unit or floor number for this building.</Hint>
                  </div>
                )}
                {isPropertyNew && (
                  <>
                    <div className="pt-2 border-t border-border space-y-4">
                      <div>
                        <Label>Apartment / Building name *</Label>
                        <Input
                          value={draft.newProperty.apartmentName}
                          onChange={(e) => persistDraft({ newProperty: { ...draft.newProperty, apartmentName: e.target.value } })}
                          placeholder="e.g. Block A, Sunrise Tower"
                          className="mt-1"
                        />
                        <Hint>Same as Property Setting: building or apartment block name.</Hint>
                      </div>
                      <div>
                        <Label>Country</Label>
                        <Input
                          value={operatorCountry}
                          className="mt-1 bg-muted"
                          disabled
                        />
                        <Hint>Country follows your operator company and cannot be changed here.</Hint>
                      </div>
                      <div>
                        <Label>Unit number *</Label>
                        <Input
                          value={draft.newProperty.unitNumber}
                          onChange={(e) => persistDraft({ newProperty: { ...draft.newProperty, unitNumber: e.target.value } })}
                          placeholder="e.g. 12-01, Unit 101"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Address</Label>
                        <Input
                          value={draft.newProperty.address}
                          onChange={(e) => persistDraft({ newProperty: { ...draft.newProperty, address: e.target.value } })}
                          placeholder="Full address"
                          className="mt-1"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => persistDraft({ selectedPropertyId: "" })}
                        style={{ background: "var(--brand)" }}
                        className="text-white hover:opacity-90"
                      >
                        Cancel (select existing)
                      </Button>
                    </div>
                  </>
                )}
                <div className="pt-4 border-t border-border space-y-3">
                  <Label>Owner settlement *</Label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={draft.ownerSettlementModel}
                    onChange={(e) =>
                      persistDraft({
                        ownerSettlementModel: (
                          e.target.value === "management_percent_net" ||
                          e.target.value === "management_percent_rental_income_only" ||
                          e.target.value === "management_fees_fixed" ||
                          e.target.value === "rental_unit" ||
                          e.target.value === "guarantee_return_fixed_plus_share"
                        )
                          ? e.target.value
                          : "management_percent_gross",
                      })
                    }
                  >
                    <option value="management_percent_gross">Management Fees % of Gross income</option>
                    <option value="management_percent_net">Management Fees % of Net income</option>
                    <option value="management_percent_rental_income_only">Management Fees % of Rental Income Only</option>
                    <option value="management_fees_fixed">Management Fees on fixed amount</option>
                    <option value="rental_unit">Rental unit (fixed monthly rent to owner)</option>
                    <option value="guarantee_return_fixed_plus_share">Guarantee return (fixed amount)</option>
                  </select>
                  <Hint>
                    Rental unit: you pay the owner a fixed amount each month; net profit = total income − expenses − fixed rent.
                  </Hint>
                  {draft.ownerSettlementModel === "guarantee_return_fixed_plus_share" ? (
                    <>
                      <div>
                        <Label>Guaranteed rental amount (to owner) *</Label>
                        <Input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={draft.fixedRentToOwner}
                          onChange={(e) => persistDraft({ fixedRentToOwner: e.target.value })}
                          placeholder="e.g. 2000"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Owner share of remaining (%) *</Label>
                        <Input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={draft.managementPercent}
                          onChange={(e) => persistDraft({ managementPercent: e.target.value })}
                          placeholder="e.g. 50"
                          className="mt-1"
                        />
                      </div>
                    </>
                  ) : (draft.ownerSettlementModel === "management_fees_fixed" || draft.ownerSettlementModel === "rental_unit") ? (
                    <div>
                      <Label>Management Fees (fixed amount) *</Label>
                      <Input
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={draft.fixedRentToOwner}
                        onChange={(e) => persistDraft({ fixedRentToOwner: e.target.value })}
                        placeholder="e.g. 2000"
                        className="mt-1"
                      />
                    </div>
                  ) : (
                    <div>
                      <Label>Management fee (% of rental) *</Label>
                      <Input
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={draft.managementPercent}
                        onChange={(e) => persistDraft({ managementPercent: e.target.value })}
                        placeholder="e.g. 10"
                        className="mt-1"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step: Room */}
            {currentStepId === "room" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Add at least one room. Include rental and photos.</p>
                {draft.rooms.map((room, index) => (
                  <div key={index} className="p-4 rounded-lg border border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">Room {index + 1}</span>
                      {draft.rooms.length > 1 && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeRoom(index)} className="text-destructive">
                          Remove
                        </Button>
                      )}
                    </div>
                    <div>
                      <Label>Room name *</Label>
                      <Input
                        value={room.roomName}
                        onChange={(e) => updateRoomAt(index, "roomName", e.target.value)}
                        placeholder="e.g. Room A, Bedroom 1"
                        className="mt-1"
                      />
                      <Hint>Display name for this room (required).</Hint>
                    </div>
                    <div>
                      <Label>Rental (RM/month)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={room.price}
                        onChange={(e) => updateRoomAt(index, "price", e.target.value)}
                        placeholder="e.g. 800"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Remark</Label>
                      <select
                        value={room.remark}
                        onChange={(e) => updateRoomAt(index, "remark", e.target.value)}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      >
                        {REMARK_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <Hint>Optional. e.g. Mix Gender, Girl Only, Male Only.</Hint>
                    </div>
                    <div>
                      <Label>Description</Label>
                      <Input
                        value={room.description_fld}
                        onChange={(e) => updateRoomAt(index, "description_fld", e.target.value)}
                        placeholder="Short description"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Photos</Label>
                      {roomPhotoError && (
                        <p className="text-xs text-destructive mt-1">{roomPhotoError}</p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-2 items-start">
                        {room.photos.map((url, photoIdx) => (
                          <div key={photoIdx} className="relative group">
                            <img src={wixImageToStatic(url)} alt="" className="h-20 w-20 object-cover rounded border border-border" referrerPolicy="no-referrer" />
                            <div className="absolute inset-0 flex items-center justify-center gap-0.5 bg-black/50 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => moveRoomPhoto(index, photoIdx, "up")}
                                disabled={photoIdx === 0}
                                className="p-1 rounded bg-white/90 text-xs disabled:opacity-40"
                                title="Move left"
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                onClick={() => moveRoomPhoto(index, photoIdx, "down")}
                                disabled={photoIdx === room.photos.length - 1}
                                className="p-1 rounded bg-white/90 text-xs disabled:opacity-40"
                                title="Move right"
                              >
                                →
                              </button>
                              <button
                                type="button"
                                onClick={() => removeRoomPhoto(index, photoIdx)}
                                className="p-1 rounded bg-red-500 text-white"
                                title="Delete"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <input
                          id={`room-photo-upload-${index}`}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => handleRoomPhotosUpload(index, e)}
                          disabled={roomPhotoUploading === index || !canUploadRoomPhotos}
                        />
                        <label
                          htmlFor={`room-photo-upload-${index}`}
                          onClick={() => {
                            console.log("[quicksetup] room photo upload button clicked", {
                              roomIndex: index,
                              canUploadRoomPhotos,
                              operatorCtxLoading,
                              clientId: accessCtx?.client?.id
                                ? `${String(accessCtx.client.id).slice(0, 8)}…`
                                : null,
                              inputDisabled: roomPhotoUploading === index || !canUploadRoomPhotos,
                            })
                          }}
                          title={
                            !canUploadRoomPhotos
                              ? operatorCtxLoading
                                ? "Loading company context…"
                                : "Sign in and load dashboard context before uploading."
                              : undefined
                          }
                          className={
                            "h-20 w-20 rounded border-2 border-dashed border-border bg-muted/50 flex items-center justify-center text-muted-foreground transition-colors " +
                            (canUploadRoomPhotos
                              ? "hover:border-primary hover:bg-muted cursor-pointer"
                              : "opacity-50 cursor-not-allowed")
                          }
                        >
                          {roomPhotoUploading === index ? (
                            <span className="text-xs">Uploading…</span>
                          ) : (
                            <Upload size={24} />
                          )}
                        </label>
                      </div>
                      <Hint>Click to add images. You can select several. First photo is the main cover.</Hint>
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addRoom} className="w-full">
                  + Add another room
                </Button>
              </div>
            )}

            {/* Step: Smart door (skip) */}
            {currentStepId === "smartdoor" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Sync loads <strong>all</strong> TTLock devices (same API as Smart Door). Rows already in the database show a binding hint; Save Selected <strong>updates</strong> those and only <strong>inserts</strong> new ones. Link locks to property/rooms later in Smart Door setting.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSmartDoorSync}
                  disabled={smartDoorSyncing}
                  className="gap-2"
                >
                  <RefreshCw size={16} className={smartDoorSyncing ? "animate-spin" : ""} />
                  {smartDoorSyncing ? "Syncing…" : "Sync"}
                </Button>
                {smartDoorPreviewList.length > 0 && (
                  <div className="rounded-lg border border-border p-3 max-h-64 overflow-y-auto space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">All TTLock devices — select and save (existing rows are updated)</p>
                    {smartDoorPreviewList.map((item, i) => (
                      <div key={i} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <label className="flex cursor-pointer items-center gap-2 shrink-0">
                            <input
                              type="checkbox"
                              checked={!!item.selected}
                              onChange={(e) => setSmartDoorItem(i, { selected: e.target.checked })}
                              className="accent-primary"
                            />
                            <Lock size={14} className="text-muted-foreground" />
                            <span className="text-sm">
                              {String(item.type) === "gateway" ? `Gateway ${item.gatewayId ?? item.externalId}` : `Lock ${item.lockId ?? item.externalId}`}
                            </span>
                          </label>
                          <Input
                            value={item.alias ?? ""}
                            onChange={(e) => setSmartDoorItem(i, { alias: e.target.value })}
                            placeholder={String(item.type) === "gateway" ? "Gateway name" : "Lock alias"}
                            className="h-8 min-w-[120px] flex-1 text-sm"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2 pl-7 sm:pl-0">
                          {item.mergeAction === "update" ? (
                            <Badge variant="secondary" className="text-xs font-normal">
                              {String(item.bindingHint || `Already linked: ${(item.bindingLabels as string[]).join(" · ")}`)}
                            </Badge>
                          ) : item.mergeAction === "insert" ? (
                            <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                              New
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      style={{ background: "var(--brand)" }}
                      onClick={handleSmartDoorSaveSelected}
                      disabled={smartDoorImportSaving || !smartDoorPreviewList.some((p) => p.selected)}
                      className="gap-2"
                    >
                      {smartDoorImportSaving ? "Saving…" : "Save Selected"}
                    </Button>
                  </div>
                )}
                <Hint>Skip to configure later in Smart Door setting.</Hint>
              </div>
            )}

            {/* Step: Meter (skip) */}
            {currentStepId === "meter" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Add meters (11-digit meter ID, title/rename, rate). You can map to rooms later in Meter Setting.
                </p>
                {draft.meters.map((m, index) => (
                  <div key={index} className="p-3 rounded-lg border border-border flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[120px]">
                      <Label className="text-xs">Meter ID (11-digit)</Label>
                      <Input
                        value={m.meterId}
                        onChange={(e) => updateMeterAt(index, "meterId", e.target.value)}
                        placeholder="e.g. 12345678901"
                        className="mt-1"
                      />
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <Label className="text-xs">Title / Name</Label>
                      <Input
                        value={m.title}
                        onChange={(e) => updateMeterAt(index, "title", e.target.value)}
                        placeholder="Display name"
                        className="mt-1"
                      />
                    </div>
                    <div className="w-24">
                      <Label className="text-xs">Rate (RM/kWh)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={m.rate}
                        onChange={(e) => updateMeterAt(index, "rate", e.target.value)}
                        placeholder="0.00"
                        className="mt-1"
                      />
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeMeter(index)} className="text-destructive mt-6">
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addMeter} className="gap-1">
                  <Plus size={16} /> Add meter
                </Button>
                <Hint>Refer Meter page for rename and rate. Skip to add later.</Hint>
              </div>
            )}

            {/* Step: Bind owner (skip) — before Agreement because agreement requires owner */}
            {currentStepId === "owner" && (
              <div className="space-y-4">
                <div>
                  <Label>Owner</Label>
                  <select
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={draft.ownerSelection}
                    onChange={(e) => {
                      const v = e.target.value
                      persistDraft((prev) => ({
                        ...prev,
                        ownerSelection: v,
                        ownerEmail: v === "__new__" ? prev.ownerEmail : "",
                      }))
                    }}
                  >
                    <option value="">Select owner or add new owner (optional)</option>
                    {ownerOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    <option value="__new__">Add new owner</option>
                  </select>
                </div>
                {draft.ownerSelection === "__new__" && (
                  <div className="space-y-3">
                    {draft.ownerEmail ? (
                      <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/50">
                        <span className="text-sm font-medium">{draft.ownerEmail}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => persistDraft({ ownerEmail: "" })}
                        >
                          Clear email
                        </Button>
                      </div>
                    ) : null}
                    <Button type="button" variant="outline" onClick={() => setAddOwnerOpen(true)} className="gap-2">
                      <UserPlus size={16} /> Add owner
                    </Button>
                  </div>
                )}
                <Hint>Skip if you don&apos;t need to bind an owner now.</Hint>
              </div>
            )}

            {/* Step: Summary */}
            {currentStepId === "summary" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Please confirm the details below. Click &quot;Confirm & Complete onboarding&quot; to save.
                </p>
                <div className="rounded-lg border border-border divide-y divide-border">
                  <div className="p-3 flex items-start gap-2">
                    <Building2 size={18} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Property</p>
                      <p className="text-sm font-medium text-foreground">
                        {isPropertyNew
                          ? `New: ${draft.newProperty.apartmentName || "—"} | ${draft.newProperty.country || "MY"} ${draft.newProperty.unitNumber ? `(${draft.newProperty.unitNumber})` : ""}`
                          : `${(draft.selectedPropertyId || "").replace(/\|\|/g, " | ") || "—"}${draft.unitNumberForSelected ? ` — Unit ${draft.unitNumberForSelected}` : ""}`}
                      </p>
                      {isPropertyNew && draft.newProperty.address && (
                        <p className="text-xs text-muted-foreground mt-0.5">{draft.newProperty.address}</p>
                      )}
                    </div>
                  </div>
                  <div className="p-3 flex items-start gap-2">
                    <DoorOpen size={18} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rooms</p>
                      <ul className="text-sm mt-1 space-y-1">
                        {draft.rooms.map((r, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-medium">{r.roomName || "—"}</span>
                            {r.price && <span className="text-muted-foreground">RM {r.price}/mo</span>}
                            {r.remark && <span className="text-muted-foreground">({r.remark})</span>}
                            <span className="text-muted-foreground text-xs">{r.photos.length} photo(s)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="p-3 flex items-start gap-2">
                    <Lock size={18} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Smart Door</p>
                      <p className="text-sm text-foreground">{draft.skipped.smartdoor ? "Skipped" : "Configure later in Smart Door setting"}</p>
                    </div>
                  </div>
                  <div className="p-3 flex items-start gap-2">
                    <Zap size={18} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Meter</p>
                      {draft.skipped.meter || draft.meters.filter((m) => m.meterId.trim()).length === 0 ? (
                        <p className="text-sm text-foreground">Skipped</p>
                      ) : (
                        <ul className="text-sm mt-1 space-y-0.5">
                          {draft.meters.filter((m) => m.meterId.trim()).map((m, i) => (
                            <li key={i}>{m.title || m.meterId} {m.rate ? `— RM ${m.rate}/kWh` : ""}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="p-3 flex items-start gap-2">
                    <UserPlus size={18} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Owner</p>
                      <p className="text-sm text-foreground">
                        {draft.skipped.owner
                          ? "Skipped"
                          : draft.ownerSelection === "__new__"
                            ? draft.ownerEmail.trim() || "Add new owner (email not set)"
                            : draft.ownerSelection.trim()
                              ? ownerOptions.find((o) => o.value === draft.ownerSelection)?.label ||
                                `Owner (${draft.ownerSelection.slice(0, 8)}…)`
                              : "None"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Add owner dialog */}
            <Dialog open={addOwnerOpen} onOpenChange={setAddOwnerOpen}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Add owner</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 pt-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={draft.ownerEmail}
                    onChange={(e) =>
                      persistDraft({ ownerEmail: e.target.value, ownerSelection: "__new__" })
                    }
                    placeholder="owner@example.com"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => setAddOwnerOpen(false)}>Cancel</Button>
                    <Button
                      style={{ background: "var(--brand)" }}
                      onClick={() => setAddOwnerOpen(false)}
                    >
                      Done
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border">
              <div className="flex gap-2">
                {effectiveStepIndex > 0 && (
                  <Button variant="outline" onClick={goPrev}>
                    <ArrowLeft size={16} className="mr-1" /> Back
                  </Button>
                )}
                {currentStepId !== "summary" && STEPS[effectiveStepIndex]?.canSkip && !draft.skipped[currentStepId] && (
                  <Button variant="ghost" onClick={handleSkip}>
                    <SkipForward size={16} className="mr-1" /> Skip
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {currentStepId === "summary" ? (
                  <Button
                    onClick={handleComplete}
                    disabled={submitting || !!error}
                    title={error ? "Fix the issue above or go back to edit, then try again." : undefined}
                    style={{ background: "var(--brand)" }}
                  >
                    {submitting ? "Saving…" : "Confirm & Complete onboarding"}
                  </Button>
                ) : (
                  <Button
                    onClick={goNext}
                    disabled={
                      (currentStepId === "property" && !propertyValid) ||
                      (currentStepId === "room" && (draft.rooms.length < 1 || draft.rooms.some((r) => !r.roomName.trim())))
                    }
                    style={{ background: "var(--brand)" }}
                  >
                    Next <ArrowRight size={16} className="ml-1" />
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
