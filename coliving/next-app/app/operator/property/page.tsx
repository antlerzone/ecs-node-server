"use client"

import "leaflet/dist/leaflet.css"
import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Building2, MapPin, Plus, Edit, ExternalLink, User, Car, Wrench, MoreHorizontal, Trash2, Download, Calendar, Loader2, Search, List, Map as MapIcon, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  getPropertyList,
  getProperty,
  updateProperty,
  insertProperty,
  setPropertyActive,
  setPropertyArchived,
  getPropertyOwners,
  getOwnerDetail,
  getPropertyAgreementTemplates,
  savePropertyOwnerAgreement,
  isPropertyFullyOccupied,
  getApartmentNames,
  getPropertySuppliers,
  getPropertySupplierExtra,
  savePropertySupplierExtra,
  getParkingLots,
  saveParkingLots,
  getRoomMeterOptions,
  getRoomSmartDoorOptions,
  getCleanlemonsLinkStatus,
  getCleanlemonsCleaningPricing,
  scheduleCleanlemonsCleaningJob,
  fetchAddressSearch,
} from "@/lib/operator-api"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/hooks/use-toast"
import { useOperatorContext } from "@/contexts/operator-context"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type PropertyItem = {
  id: string
  shortname?: string
  apartmentName?: string
  address?: string
  /** WGS84; persisted on `propertydetail` like `cln_property`. */
  latitude?: number | null
  longitude?: number | null
  active?: boolean
  archived?: boolean
  owner_id?: string
  signagreement?: string
  country?: string | null
  folder?: string | null
  availableUnitCount?: number
  totalRoomCount?: number
  /** Property-level utility binding (Property → Utilities); must clear before delete. */
  meter?: string | null
  smartdoor?: string | null
  premisesType?: string
  securitySystem?: string
  securityUsername?: string
  securitySystemCredentials?: Record<string, unknown> | null
  mailboxPassword?: string
  smartdoorPassword?: string
  smartdoorTokenEnabled?: boolean
}

const SECURITY_SYSTEM_IDS = ["icare", "ecommunity", "veemios", "gprop", "css"] as const
type SecuritySystemIdOption = (typeof SECURITY_SYSTEM_IDS)[number]

function parseSecuritySystemFromDb(raw: string | undefined | null): SecuritySystemIdOption {
  const s = String(raw || "").trim().toLowerCase()
  return (SECURITY_SYSTEM_IDS as readonly string[]).includes(s) ? (s as SecuritySystemIdOption) : "icare"
}

function isCompleteSecurityCredentials(
  system: SecuritySystemIdOption,
  cred: Record<string, unknown> | null | undefined
): boolean {
  if (!cred || typeof cred !== "object") return false
  switch (system) {
    case "icare":
      return !!(String(cred.phoneNumber || "").trim() && String(cred.dateOfBirth || "").trim() && String(cred.password || ""))
    case "ecommunity":
      return !!(String(cred.username || (cred as { user?: string }).user || "").trim() && String(cred.password || ""))
    case "veemios":
    case "gprop":
      return !!(String(cred.userId || (cred as { user_id?: string }).user_id || "").trim() && String(cred.password || ""))
    case "css":
      return !!(String(cred.loginCode || (cred as { login_code?: string }).login_code || "").trim() && String(cred.password || ""))
    default:
      return false
  }
}

function formatSecuritySystemSummary(system: SecuritySystemIdOption, cred: Record<string, unknown> | null): string | null {
  if (!cred || !isCompleteSecurityCredentials(system, cred)) return null
  const pwPlain = String(cred.password || "").trim()
  switch (system) {
    case "icare":
      return `Phone: ${String(cred.phoneNumber)} · DOB: ${String(cred.dateOfBirth)} · Password: ${pwPlain}`
    case "ecommunity":
      return `User: ${String(cred.username || (cred as { user?: string }).user || "")} · Password: ${pwPlain}`
    case "veemios":
    case "gprop":
      return `User ID: ${String(cred.userId || (cred as { user_id?: string }).user_id || "")} · Password: ${pwPlain}`
    case "css":
      return `Login code: ${String(cred.loginCode || (cred as { login_code?: string }).login_code || "")} · Password: ${pwPlain}`
    default:
      return null
  }
}
type BuildingOption = { apartmentName: string; country: string }
type BedType = "single" | "supersingle" | "queen" | "king" | "superking"
type PremisesTypeOption = "landed" | "apartment" | "other" | "office" | "commercial"

/** Captured when user clicks Save (before map); Confirm & save must use this — live React state can reset while the map dialog is open. */
type PendingEditSaveSnapshot = {
  shortname: string
  apartmentName: string
  address: string
  unitNumber: string
  country: string
  owner_id: string
  folder: string
  ownerSettlementModel:
    | "management_percent_gross"
    | "management_percent_net"
    | "management_percent_rental_income_only"
    | "management_fees_fixed"
    | "rental_unit"
    | "guarantee_return_fixed_plus_share"
  managementFeesValue: string | number
  managementFeesFixedValue: string | number
  propertyType: PremisesTypeOption
  securitySystem: string
  keyCollection: { mailboxPassword: boolean; smartdoorPassword: boolean; smartdoorToken: boolean }
  mailboxPassword: string
  smartdoorPassword: string
}

/** Property form fields for `propertysetting/update`. Omit `coords` to leave DB latitude/longitude unchanged. */
function buildEditPropertyPayloadFromSnapshot(
  s: PendingEditSaveSnapshot,
  coords: { lat: string; lng: string } | null
): Record<string, unknown> {
  const n = Number(s.managementFeesValue)
  const nFixed = Number(s.managementFeesFixedValue)
  const isFixedLike = s.ownerSettlementModel === "management_fees_fixed" || s.ownerSettlementModel === "rental_unit"
  const isGuarantee = s.ownerSettlementModel === "guarantee_return_fixed_plus_share"
  const payload: Record<string, unknown> = {
    shortname: s.shortname.trim(),
    apartmentName: s.apartmentName.trim() || null,
    address: s.address.trim(),
    unitNumber: s.unitNumber.trim() || null,
    country: (s.country === "SG" ? "SG" : "MY") || null,
    owner_id: s.owner_id?.trim() ? s.owner_id.trim() : null,
    folder: s.folder?.trim() ? s.folder.trim() : null,
    ownerSettlementModel: s.ownerSettlementModel,
    percentage: isGuarantee ? n : isFixedLike ? null : n,
    fixedRentToOwner: isGuarantee ? nFixed : isFixedLike ? nFixed : null,
    premisesType: s.propertyType,
    securitySystem: s.securitySystem,
    securityUsername: null,
    mailboxPassword: s.keyCollection.mailboxPassword ? s.mailboxPassword.trim() || null : null,
    smartdoorPassword: s.keyCollection.smartdoorPassword ? s.smartdoorPassword.trim() || null : null,
    smartdoorTokenEnabled: !!s.keyCollection.smartdoorToken,
  }
  if (coords) {
    payload.latitude = coords.lat.trim()
    payload.longitude = coords.lng.trim()
  }
  return payload
}

/** DB column is still `apartmentname`; label follows premises type (Taman for non-apartment MY context). */
function premisesBuildingNameLabel(propertyType: PremisesTypeOption): string {
  return propertyType === "apartment" ? "Apartment / Building name" : "Name of Taman"
}

function premisesBuildingSelectPlaceholder(propertyType: PremisesTypeOption): string {
  return propertyType === "apartment" ? "Select building" : "Select taman"
}

function addPremisesBuildingDialogTitle(propertyType: PremisesTypeOption): string {
  return propertyType === "apartment" ? "Add apartment / building name" : "Add name of Taman"
}

function getBuildingSelectValue(apartmentName: string | undefined, country: string | undefined, options: BuildingOption[], operatorCountry: "MY" | "SG") {
  const name = String(apartmentName || "").trim()
  if (!name) return "__none__"
  const desiredCountry = country === "SG" ? "SG" : (country === "MY" ? "MY" : operatorCountry)
  const nameLo = name.toLowerCase()
  const match = options.find(
    (b) =>
      String(b.apartmentName || "").trim().toLowerCase() === nameLo &&
      b.country === desiredCountry
  )
  if (match) return `${match.apartmentName}||${match.country}`
  return `${name}||${desiredCountry}`
}

type AddressSearchRow = { displayName: string; lat: string; lon: string; placeId: string }

/** Default pin when no saved coords (Johor Bahru — same idea as Cleanlemons operator property map). */
const DEFAULT_MAP_LAT = 1.492659
const DEFAULT_MAP_LNG = 103.741359

/**
 * Parse WGS84 from form/API strings. Empty strings must NOT become 0 — `Number("") === 0` was centering the
 * confirm map on the Gulf of Guinea ("in the sea") when lat/lng were missing in the form.
 */
function parseCoordStrings(latStr: unknown, lngStr: unknown): { lat: number; lng: number } | null {
  const a = String(latStr ?? "").trim()
  const b = String(lngStr ?? "").trim()
  if (a === "" || b === "") return null
  const la = Number(a)
  const lo = Number(b)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null
  if (la === 0 && lo === 0) return null
  return { lat: la, lng: lo }
}

function resolveInitialMapCoords(latStr: string, lngStr: string): { lat: number; lng: number } {
  const p = parseCoordStrings(latStr, lngStr)
  if (p) return p
  return { lat: DEFAULT_MAP_LAT, lng: DEFAULT_MAP_LNG }
}

function normalizeAddressOneLine(s: string): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
}

/** Edit flow: saved list row + form; if address changed, geocode current address for map center. */
async function resolveInitialMapCoordsForEdit(
  form: { latitude: string; longitude: string; address: string; apartmentName: string; country: string },
  saved: Pick<PropertyItem, "latitude" | "longitude" | "address"> | null
): Promise<{ lat: number; lng: number }> {
  const formAddr = normalizeAddressOneLine(form.address)
  const savedAddr = saved ? normalizeAddressOneLine(saved.address ?? "") : ""
  const addrChanged = !!(saved && formAddr !== savedAddr)

  const fromForm = parseCoordStrings(form.latitude, form.longitude)
  const fromSaved = saved ? parseCoordStrings(saved.latitude, saved.longitude) : null

  if (addrChanged && form.address.trim().length >= 3) {
    try {
      const r = await fetchAddressSearch({
        q: form.address.trim(),
        limit: 1,
        countrycodes: form.country === "SG" ? "sg" : "my",
        propertyName: form.apartmentName.trim() || undefined,
      })
      const first = r?.ok && r.items?.[0]
      if (first?.lat != null && String(first.lat).trim() !== "" && first?.lon != null && String(first.lon).trim() !== "") {
        const g = parseCoordStrings(String(first.lat), String(first.lon))
        if (g) return g
      }
    } catch {
      /* ignore */
    }
  }

  if (fromForm) return fromForm
  if (fromSaved) return fromSaved
  return { lat: DEFAULT_MAP_LAT, lng: DEFAULT_MAP_LNG }
}

/** Add flow: optional geocode when form has no pin yet. */
async function resolveInitialMapCoordsForAdd(form: {
  latitude: string
  longitude: string
  address: string
  apartmentName: string
  country: string
}): Promise<{ lat: number; lng: number }> {
  const fromForm = parseCoordStrings(form.latitude, form.longitude)
  if (fromForm) return fromForm
  if (form.address.trim().length >= 3) {
    try {
      const r = await fetchAddressSearch({
        q: form.address.trim(),
        limit: 1,
        countrycodes: form.country === "SG" ? "sg" : "my",
        propertyName: form.apartmentName.trim() || undefined,
      })
      const first = r?.ok && r.items?.[0]
      if (first?.lat != null && String(first.lat).trim() !== "" && first?.lon != null && String(first.lon).trim() !== "") {
        const g = parseCoordStrings(String(first.lat), String(first.lon))
        if (g) return g
      }
    } catch {
      /* ignore */
    }
  }
  return { lat: DEFAULT_MAP_LAT, lng: DEFAULT_MAP_LNG }
}

function escapeHtmlForPopup(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Group properties that share the same saved GPS (e.g. many units in one apartment block). */
function coordGroupKey(lat: number, lng: number): string {
  return `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`
}

function overviewMapPinColorForGroup(propIds: string[], occupancy: Record<string, boolean>): string {
  const occs = propIds.map((id) => occupancy[id])
  if (occs.some((o) => o === false)) return "#dc2626"
  if (propIds.length > 0 && occs.every((o) => o === true)) return "#16a34a"
  return "#94a3b8"
}

/** One or more unit cards; scroll when multiple at the same coordinates. */
function buildOverviewMapPopupHtml(props: PropertyItem[], occupancy: Record<string, boolean>): string {
  const cardHtml = (p: PropertyItem, isLast: boolean) => {
    const occ = occupancy[p.id]
    const full = occ === true
    const vacant = occ === false
    const title = escapeHtmlForPopup(p.shortname || p.apartmentName || p.id)
    const addr = escapeHtmlForPopup(p.address || "—")
    const occLine = full
      ? '<span style="color:#16a34a;font-weight:600">Full occupied</span>'
      : vacant
        ? '<span style="color:#dc2626;font-weight:600">Has vacant units</span>'
        : '<span style="color:#64748b">Loading occupancy…</span>'
    const sep = isLast ? "" : "border-bottom:1px solid #e5e7eb;margin-bottom:8px;padding-bottom:8px;"
    return `<div style="${sep}"><strong>${title}</strong><br/><span style="color:#666;font-size:12px">${addr}</span><br/><span style="display:block;margin-top:6px">${occLine}</span></div>`
  }
  const inner = props.map((p, i) => cardHtml(p, i === props.length - 1)).join("")
  if (props.length <= 1) {
    return `<div style="min-width:180px;font-size:13px">${inner}</div>`
  }
  return `<div style="min-width:200px;max-width:300px;font-size:13px"><div style="max-height:260px;overflow-y:auto;overflow-x:hidden;padding-right:6px;-webkit-overflow-scrolling:touch">${inner}</div></div>`
}

/**
 * OSM/Nominatim often returns street-level lines without house/lot numbers (common for landed).
 * If the user typed a leading lot/house (e.g. `59, Jalan …` or `No. 59, …`), prepend it when the chosen row does not already start with it.
 */
function extractLeadingHouseTokenFromAddressQuery(q: string): string | null {
  const s = String(q || "").trim()
  if (!s) return null
  const withComma = s.match(/^\s*(?:(?:no\.?|lot)\s+)?(\d+[A-Za-z0-9/-]*)\s*,\s*/i)
  if (withComma) return withComma[1]
  const withSpace = s.match(/^\s*(?:(?:no\.?|lot)\s+)?(\d{1,4}[A-Za-z0-9/-]*)\s+(?=[A-Za-z])/i)
  if (withSpace) return withSpace[1]
  return null
}

function mergeLeadingHouseNumberFromQuery(userQuery: string, osmDisplayName: string): string {
  const osm = String(osmDisplayName || "").trim()
  if (!osm) return String(userQuery || "").trim()
  const house = extractLeadingHouseTokenFromAddressQuery(userQuery)
  if (!house) return osm
  const h = house.toLowerCase()
  const o = osm.toLowerCase()
  if (o.startsWith(`${h},`) || o.startsWith(`${h} `) || o.startsWith(`no. ${h}`) || o.startsWith(`no ${h}`) || o.startsWith(`lot ${h}`)) {
    return osm
  }
  return `${house}, ${osm}`
}

/** OSM-backed address field (aligned with Cleanlemons operator property). */
function PropertyAddressField({
  value,
  onChange,
  readOnly,
  countrycodes,
  buildingName,
  onPickSuggestion,
  landedHint,
}: {
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
  countrycodes: "my" | "sg"
  buildingName: string
  /** When user picks an OSM row, receive lat/lon for WGS84 fields (same as Cleanlemons operator property). */
  onPickSuggestion?: (item: AddressSearchRow) => void
  /** Show short note that OSM may be street-only; put lot/house before comma so it is kept on pick (landed). */
  landedHint?: boolean
}) {
  const [items, setItems] = useState<AddressSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const scheduleAddressSearch = useCallback(
    (raw: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      const q = raw.trim()
      if (q.length < 3) {
        setItems([])
        setLoading(false)
        return
      }
      setLoading(true)
      timerRef.current = setTimeout(() => {
        void (async () => {
          const r = await fetchAddressSearch({
            q,
            limit: 8,
            countrycodes,
            propertyName: buildingName.trim() || undefined,
          })
          setLoading(false)
          if (!r?.ok || !Array.isArray(r.items)) {
            setItems([])
            return
          }
          setItems(r.items)
          if (r.items.length > 0) setOpen(true)
        })()
      }, 450)
    },
    [countrycodes, buildingName]
  )

  const regionLabel = countrycodes === "sg" ? "Singapore" : "Malaysia"

  if (readOnly) {
    return <Input value={value} readOnly className="mt-1" />
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="mt-1 pl-9 pr-9"
          value={value}
          onChange={(e) => {
            const v = e.target.value
            onChange(v)
            if (v.trim().length >= 3) setOpen(true)
            scheduleAddressSearch(v)
          }}
          onFocus={() => {
            setOpen(true)
            if (value.trim().length >= 3) {
              scheduleAddressSearch(value)
            }
          }}
          placeholder="Type to search (Malaysia / Singapore) or enter address manually"
          autoComplete="off"
        />
        {loading ? (
          <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {open && items.length > 0 ? (
        <ul
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          role="listbox"
        >
          {items.map((item, idx) => (
            <li key={`${item.placeId || "p"}-${idx}`}>
              <button
                type="button"
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(mergeLeadingHouseNumberFromQuery(value, item.displayName))
                  onPickSuggestion?.(item)
                  setOpen(false)
                  setItems([])
                }}
              >
                {item.displayName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && !loading && items.length === 0 && value.trim().length >= 3 ? (
        <div
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover px-2 py-2 text-xs text-muted-foreground shadow-md"
          role="status"
        >
          No OpenStreetMap matches for this text in {regionLabel}. Try the exact building name, add city or area, or
          paste the address manually.
        </div>
      ) : null}
      {landedHint ? (
        <p className="text-xs text-muted-foreground mt-1">
          Map search often returns the street only. Type the lot/house first with a comma (e.g. 59, Jalan …); it is kept when you pick a result. You can still edit the full line.
        </p>
      ) : null}
    </div>
  )
}

export default function PropertySettingsPage() {
  const router = useRouter()
  const { refresh: refreshOperatorCtx, accessCtx } = useOperatorContext()
  const operatorCountry: "MY" | "SG" =
    String(accessCtx?.client?.currency || "").toUpperCase() === "SGD" ? "SG" : "MY"
  const [loading, setLoading] = useState(true)
  const [properties, setProperties] = useState<PropertyItem[]>([])
  const [keyword, setKeyword] = useState("")
  const [filter, setFilter] = useState("ACTIVE_ONLY")
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingProp, setEditingProp] = useState<PropertyItem | null>(null)
  const [viewMode] = useState<"edit">("edit")
  const [editForm, setEditForm] = useState({
    shortname: "",
    apartmentName: "",
    address: "",
    unitNumber: "",
    country: "MY",
    owner_id: "",
    folder: "",
    latitude: "",
    longitude: "",
    ownerSettlementModel: "management_percent_gross" as "management_percent_gross" | "management_percent_net" | "management_percent_rental_income_only" | "management_fees_fixed" | "rental_unit" | "guarantee_return_fixed_plus_share",
    managementFeesValue: "" as string | number,
    managementFeesFixedValue: "" as string | number,
  })
  const [mapConfirmOpen, setMapConfirmOpen] = useState(false)
  const [pendingSaveMode, setPendingSaveMode] = useState<"edit" | "add" | null>(null)
  const mapConfirmContainerRef = useRef<HTMLDivElement | null>(null)
  const mapConfirmInitialRef = useRef<{ lat: number; lng: number }>({
    lat: DEFAULT_MAP_LAT,
    lng: DEFAULT_MAP_LNG,
  })
  /** Synchronous: Radix may fire parent Dialog onOpenChange(false) before React re-renders mapConfirmOpen. */
  const mapConfirmOpenRef = useRef(false)
  /** Edit save after map confirm must not depend on editingProp — opening the map dialog can clear editingProp first. */
  const pendingEditPropertyIdRef = useRef<string | null>(null)
  /** Form + Access fields at Save click; avoids stale/reset state when Confirm runs after the map step. */
  const pendingEditFormSnapshotRef = useRef<PendingEditSaveSnapshot | null>(null)
  const leafletMapRef = useRef<import("leaflet").Map | null>(null)
  const leafletMarkerRef = useRef<import("leaflet").Marker | null>(null)
  const [mapDialogReady, setMapDialogReady] = useState(false)
  /** True while resolving map center (geocode / fallbacks) before opening confirm dialog. */
  const [mapPreflightBusy, setMapPreflightBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [owners, setOwners] = useState<Array<{ label: string; value: string }>>([])
  const [agreementTemplates, setAgreementTemplates] = useState<Array<{ label: string; value: string }>>([])
  const [ownerAgreementOwnerId, setOwnerAgreementOwnerId] = useState("")
  const [ownerAgreementType, setOwnerAgreementType] = useState<"system" | "manual">("system")
  const [ownerAgreementTemplateId, setOwnerAgreementTemplateId] = useState("")
  const [ownerAgreementUrl, setOwnerAgreementUrl] = useState("")
  const [savingOwnerAgreement, setSavingOwnerAgreement] = useState(false)
  const [agreementProp, setAgreementProp] = useState<PropertyItem | null>(null)
  const [buildingOptions, setBuildingOptions] = useState<BuildingOption[]>([])
  const [showAddBuildingDialog, setShowAddBuildingDialog] = useState(false)
  const [newBuildingName, setNewBuildingName] = useState("")
  const [propertyViewMode, setPropertyViewMode] = useState<"list" | "map">("list")
  const overviewMapContainerRef = useRef<HTMLDivElement | null>(null)
  const overviewMapRef = useRef<import("leaflet").Map | null>(null)
  const overviewMarkersByPropertyIdRef = useRef<Record<string, import("leaflet").Marker>>({})
  const [selectedMapListPropertyId, setSelectedMapListPropertyId] = useState<string | null>(null)
  const [propertyOccupancy, setPropertyOccupancy] = useState<Record<string, boolean>>({})
  const [utilityProp, setUtilityProp] = useState<PropertyItem | null>(null)
  const [editUtilityForm, setEditUtilityForm] = useState({
    electricId: "",
    electricSupplierId: "",
    waterId: "",
    waterSupplierId: "",
    internetId: "",
    internetSupplierId: "",
    managementSupplierId: "",
    wifiUsername: "",
    wifiPassword: "",
    ownerSettlementModel: "management_percent_gross" as "management_percent_gross" | "management_percent_net" | "management_percent_rental_income_only" | "management_fees_fixed" | "rental_unit" | "guarantee_return_fixed_plus_share",
    percentage: "" as string | number,
    remark: "",
    meter: "",
    smartdoor: "",
    tenantCleaningPrice: "" as string,
  })
  const [addSettlementModel, setAddSettlementModel] = useState<"management_percent_gross" | "management_percent_net" | "management_percent_rental_income_only" | "management_fees_fixed" | "rental_unit" | "guarantee_return_fixed_plus_share">("management_percent_gross")
  const [addManagementPercent, setAddManagementPercent] = useState("")
  const [addFixedManagementFee, setAddFixedManagementFee] = useState("")
  const [utilityExtraRows, setUtilityExtraRows] = useState<Array<{ supplier_id: string; value: string }>>([])
  const [suppliersOptions, setSuppliersOptions] = useState<Array<{ label: string; value: string }>>([])
  const [meterOptions, setMeterOptions] = useState<Array<{ label: string; value: string }>>([])
  const [smartdoorOptions, setSmartdoorOptions] = useState<Array<{ label: string; value: string }>>([])
  const [parkingLotProp, setParkingLotProp] = useState<PropertyItem | null>(null)
  const [parkingLotItems, setParkingLotItems] = useState<string[]>([])
  const [savingParkingLot, setSavingParkingLot] = useState(false)
  const [savingUtility, setSavingUtility] = useState(false)
  const [cleanlemonsLinked, setCleanlemonsLinked] = useState(false)
  const [cleaningPricing, setCleaningPricing] = useState<{
    showRefGeneralCleaning?: boolean
    refGeneralCleaning?: number | null
    clnPropertyId?: string | null
  } | null>(null)
  const [scheduleProperty, setScheduleProperty] = useState<PropertyItem | null>(null)
  const [scheduleDate, setScheduleDate] = useState("")
  const [scheduleTime, setScheduleTime] = useState("09:00")
  const [schedulingJob, setSchedulingJob] = useState(false)
  const [showOwnerProfileDialog, setShowOwnerProfileDialog] = useState(false)
  const [ownerProfileLoading, setOwnerProfileLoading] = useState(false)
  const [ownerProfile, setOwnerProfile] = useState<{
    ownerName?: string
    email?: string
    bankName?: string
    bankAccount?: string
    bankHolder?: string
    account?: Array<{ provider?: string; clientId?: string; id?: string }>
  } | null>(null)
  const [opsForm, setOpsForm] = useState({
    propertyType: "apartment" as PremisesTypeOption,
    keyCollection: {
      mailboxPassword: false,
      smartdoorPassword: false,
      smartdoorToken: false,
    },
    mailboxPassword: "",
    smartdoorPassword: "",
    securitySystem: "icare" as SecuritySystemIdOption,
    bedSection: {
      single: 0,
      supersingle: 0,
      queen: 0,
      king: 0,
      superking: 0,
    } as Record<BedType, number>,
    totalBed: 0,
    numberOfRoom: "",
    numberOfBathroom: "",
  })

  const [persistedSecurityCredentials, setPersistedSecurityCredentials] = useState<Record<string, unknown> | null>(null)
  const [insertSecurityCredentials, setInsertSecurityCredentials] = useState<Record<string, unknown> | null>(null)
  const [secCredModalOpen, setSecCredModalOpen] = useState(false)
  const [secCredModalFromAdd, setSecCredModalFromAdd] = useState(false)
  const [secCredModalSaving, setSecCredModalSaving] = useState(false)
  const [secCredModalSystem, setSecCredModalSystem] = useState<SecuritySystemIdOption>("icare")
  const [secCredPhone, setSecCredPhone] = useState("")
  const [secCredDob, setSecCredDob] = useState("")
  const [secCredUser, setSecCredUser] = useState("")
  const [secCredUserId, setSecCredUserId] = useState("")
  const [secCredLoginCode, setSecCredLoginCode] = useState("")
  const [secCredPassword, setSecCredPassword] = useState("")

  const resetOpsForm = () => {
    setInsertSecurityCredentials(null)
    setOpsForm({
      propertyType: "apartment",
      keyCollection: {
        mailboxPassword: false,
        smartdoorPassword: false,
        smartdoorToken: false,
      },
      mailboxPassword: "",
      smartdoorPassword: "",
      securitySystem: "icare" as SecuritySystemIdOption,
      bedSection: {
        single: 0,
        supersingle: 0,
        queen: 0,
        king: 0,
        superking: 0,
      },
      totalBed: 0,
      numberOfRoom: "",
      numberOfBathroom: "",
    })
  }

  const setBedQty = (bedType: BedType, qty: number) => {
    setOpsForm((prev) => {
      const nextBed = { ...prev.bedSection, [bedType]: Number.isFinite(qty) ? Math.max(0, qty) : 0 }
      const totalBed = Object.values(nextBed).reduce((sum, value) => sum + Number(value || 0), 0)
      return { ...prev, bedSection: nextBed, totalBed }
    })
  }

  const securitySystemSummaryText =
    showAddDialog && insertSecurityCredentials
      ? formatSecuritySystemSummary(parseSecuritySystemFromDb(opsForm.securitySystem), insertSecurityCredentials)
      : !showAddDialog && persistedSecurityCredentials
        ? formatSecuritySystemSummary(parseSecuritySystemFromDb(opsForm.securitySystem), persistedSecurityCredentials)
        : null

  const openSecurityCredentialsModal = (fromAdd: boolean) => {
    setSecCredModalFromAdd(fromAdd)
    const sys = parseSecuritySystemFromDb(opsForm.securitySystem)
    setSecCredModalSystem(sys)
    const src = fromAdd ? insertSecurityCredentials : persistedSecurityCredentials
    setSecCredPhone(src && typeof src === "object" ? String((src as { phoneNumber?: string }).phoneNumber || "") : "")
    setSecCredDob(src && typeof src === "object" ? String((src as { dateOfBirth?: string }).dateOfBirth || "") : "")
    setSecCredUser(
      src && typeof src === "object"
        ? String((src as { username?: string }).username || (src as { user?: string }).user || "")
        : ""
    )
    setSecCredUserId(
      src && typeof src === "object"
        ? String((src as { userId?: string }).userId || (src as { user_id?: string }).user_id || "")
        : ""
    )
    setSecCredLoginCode(
      src && typeof src === "object"
        ? String((src as { loginCode?: string }).loginCode || (src as { login_code?: string }).login_code || "")
        : ""
    )
    setSecCredPassword(
      src && typeof src === "object" && String((src as { password?: string }).password || "").trim()
        ? String((src as { password?: string }).password)
        : ""
    )
    setSecCredModalOpen(true)
  }

  const handleSecurityCredentialsModalSave = async () => {
    const sys = secCredModalSystem
    const prevObj = secCredModalFromAdd ? insertSecurityCredentials : persistedSecurityCredentials
    const prevPw =
      prevObj && typeof prevObj === "object" && String((prevObj as { password?: string }).password || "").trim()
        ? String((prevObj as { password?: string }).password)
        : ""
    const pw = secCredPassword.trim() !== "" ? secCredPassword.trim() : prevPw
    let body: Record<string, unknown> = {}
    if (sys === "icare") {
      body = { phoneNumber: secCredPhone.trim(), dateOfBirth: secCredDob.trim(), password: pw }
    } else if (sys === "ecommunity") {
      body = { username: secCredUser.trim(), password: pw }
    } else if (sys === "veemios" || sys === "gprop") {
      body = { userId: secCredUserId.trim(), password: pw }
    } else {
      body = { loginCode: secCredLoginCode.trim(), password: pw }
    }
    if (!isCompleteSecurityCredentials(sys, body)) {
      toast({
        title: "Missing fields",
        description: "Fill every field for this security system. Leave password empty only when keeping the existing password.",
        variant: "destructive",
      })
      return
    }
    if (secCredModalFromAdd) {
      setOpsForm((prev) => ({ ...prev, securitySystem: sys }))
      setInsertSecurityCredentials(body)
      setSecCredModalOpen(false)
      toast({ title: "Security credentials saved", description: "They will be stored when you create the property." })
      return
    }
    const pid = editingProp?.id
    if (!pid) {
      toast({ title: "No property", description: "Open a property first.", variant: "destructive" })
      return
    }
    setSecCredModalSaving(true)
    try {
      await updateProperty(pid, { securitySystem: sys, securitySystemCredentials: body })
      setPersistedSecurityCredentials(body)
      setOpsForm((prev) => ({ ...prev, securitySystem: sys }))
      setSecCredModalOpen(false)
      toast({ title: "Saved", description: "Security system login details were saved." })
    } catch (e) {
      console.error(e)
      const reason = e instanceof Error ? e.message : String(e)
      toast({
        title: "Save failed",
        description: reason.includes("INVALID_SECURITY") ? "Check all required fields." : reason || "Could not save.",
        variant: "destructive",
      })
    } finally {
      setSecCredModalSaving(false)
    }
  }

  const openOrDownloadAgreementUrl = (url: string, filename: string) => {
    const safeUrl = String(url || "").trim()
    if (!safeUrl || safeUrl === "#") return
    try {
      const a = document.createElement("a")
      a.href = safeUrl
      a.download = filename
      a.rel = "noopener noreferrer"
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      window.open(safeUrl, "_blank", "noopener,noreferrer")
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getPropertyList({ keyword: keyword || undefined, filter: filter !== "ALL" ? filter : undefined, pageSize: 200 })
      const items = (r?.items || []) as PropertyItem[]
      setProperties(items)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [keyword, filter])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    let cancelled = false
    getCleanlemonsLinkStatus()
      .then((cl) => {
        if (cancelled) return
        setCleanlemonsLinked(
          !!(cl?.ok && cl.confirmed && (cl.cleanlemonsClientdetailId || cl.cleanlemonsOperatorId))
        )
      })
      .catch(() => {
        if (!cancelled) setCleanlemonsLinked(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    getApartmentNames().then((res) => {
      const items = (res?.items ?? []) as BuildingOption[]
      setBuildingOptions(items)
    }).catch(() => {})
  }, [])

  // Load occupancy for each property (for "Full occupied" label + bg)
  useEffect(() => {
    if (properties.length === 0) return
    let cancelled = false
    Promise.all(properties.map(async (p) => {
      const res = await isPropertyFullyOccupied(p.id)
      return { id: p.id, fullyOccupied: !!res?.fullyOccupied }
    })).then((results) => {
      if (cancelled) return
      setPropertyOccupancy((prev) => {
        const next = { ...prev }
        results.forEach(({ id, fullyOccupied }) => { next[id] = fullyOccupied })
        return next
      })
    }).catch((e) => console.error(e))
    return () => { cancelled = true }
  }, [properties])

  /** General-cleaning reference price from Cleanlemons; schedule only when canSchedule. */
  const [propertyCleaningScheduleInfo, setPropertyCleaningScheduleInfo] = useState<
    Record<string, { canSchedule: boolean; refGeneralCleaning: number | null }>
  >({})
  useEffect(() => {
    if (!cleanlemonsLinked || properties.length === 0) {
      setPropertyCleaningScheduleInfo({})
      return
    }
    let cancelled = false
    ;(async () => {
      const results = await Promise.all(
        properties.map(async (p) => {
          try {
            const pr = await getCleanlemonsCleaningPricing({ propertyId: p.id })
            if (!pr || !pr.ok) {
              return { id: p.id, canSchedule: false, refGeneralCleaning: null as number | null }
            }
            const ref = pr.refGeneralCleaning != null ? Number(pr.refGeneralCleaning) : null
            const can =
              !!pr.showRefGeneralCleaning &&
              ref != null &&
              Number.isFinite(ref) &&
              ref > 0
            return { id: p.id, canSchedule: can, refGeneralCleaning: can ? ref : null }
          } catch {
            return { id: p.id, canSchedule: false, refGeneralCleaning: null as number | null }
          }
        })
      )
      if (cancelled) return
      const next: Record<string, { canSchedule: boolean; refGeneralCleaning: number | null }> = {}
      results.forEach((r) => {
        next[r.id] = { canSchedule: r.canSchedule, refGeneralCleaning: r.refGeneralCleaning }
      })
      setPropertyCleaningScheduleInfo(next)
    })()
    return () => {
      cancelled = true
    }
  }, [properties, cleanlemonsLinked])

  const openDetail = async (prop: PropertyItem) => {
    setEditingProp(prop)
    setInsertSecurityCredentials(null)
    try {
      const r = await getProperty(prop.id)
      const p = (r && typeof r === "object" && "property" in r) ? (r as { property: PropertyItem }).property : (r as PropertyItem & { owner_id?: string; signagreement?: string })
      const unitNumber = String((p as { unitNumber?: string }).unitNumber || "").trim()
      const aptNameRaw = String((p as { apartmentName?: string; apartmentname?: string }).apartmentName || (p as { apartmentname?: string }).apartmentname || "").trim()
      const shortnameRaw = String(p.shortname || "").trim()
      const aptNameFromShortname =
        !aptNameRaw && shortnameRaw
          ? (unitNumber && shortnameRaw.toLowerCase().endsWith(unitNumber.toLowerCase())
              ? shortnameRaw.slice(0, Math.max(0, shortnameRaw.length - unitNumber.length)).trim()
              : shortnameRaw)
          : ""
      const aptName = aptNameRaw || aptNameFromShortname
      const country = (p as { country?: string | null }).country === "SG" ? "SG" : operatorCountry
      const rawSettlementModel = String((p as { ownerSettlementModel?: string }).ownerSettlementModel || "management_percent_gross").trim()
      const settlementModel: "management_percent_gross" | "management_percent_net" | "management_percent_rental_income_only" | "management_fees_fixed" | "rental_unit" | "guarantee_return_fixed_plus_share" =
        rawSettlementModel === "management_percent_net"
          ? "management_percent_net"
          : rawSettlementModel === "management_percent_rental_income_only"
            ? "management_percent_rental_income_only"
          : rawSettlementModel === "guarantee_return_fixed_plus_share"
            ? "guarantee_return_fixed_plus_share"
          : rawSettlementModel === "rental_unit"
            ? "rental_unit"
          : rawSettlementModel === "management_fees_fixed"
            ? "management_fees_fixed"
            : "management_percent_gross"
      const managementFeesValueRaw =
        settlementModel === "management_fees_fixed"
          ? ((p as { fixedRentToOwner?: number | null }).fixedRentToOwner ?? p?.percentage ?? "")
          : (p?.percentage ?? "")
      const latRaw = (p as PropertyItem).latitude
      const lngRaw = (p as PropertyItem).longitude
      setEditForm({
        shortname: p.shortname || "",
        apartmentName: aptName,
        address: p.address || "",
        unitNumber: unitNumber || "",
        country,
        owner_id: (p as { owner_id?: string }).owner_id ?? "",
        folder: p.folder || "",
        latitude:
          latRaw != null && String(latRaw).trim() !== "" && Number.isFinite(Number(latRaw))
            ? String(latRaw)
            : "",
        longitude:
          lngRaw != null && String(lngRaw).trim() !== "" && Number.isFinite(Number(lngRaw))
            ? String(lngRaw)
            : "",
        ownerSettlementModel: settlementModel,
        managementFeesValue: managementFeesValueRaw as string | number,
        managementFeesFixedValue: ((p as { fixedRentToOwner?: number | null }).fixedRentToOwner ?? "") as string | number,
      })
      const ptRaw = String((p as PropertyItem).premisesType || "").trim().toLowerCase()
      const premisesTypeLoaded: PremisesTypeOption = (
        ptRaw === "landed" || ptRaw === "apartment" || ptRaw === "other" || ptRaw === "office" || ptRaw === "commercial"
          ? ptRaw
          : "apartment"
      )
      const secRaw = String((p as PropertyItem).securitySystem || "").trim().toLowerCase()
      const credRaw = (p as PropertyItem).securitySystemCredentials
      setPersistedSecurityCredentials(
        credRaw != null && typeof credRaw === "object" ? (credRaw as Record<string, unknown>) : null
      )
      const mb = String((p as { mailboxPassword?: string }).mailboxPassword || "").trim()
      const sdp = String((p as { smartdoorPassword?: string }).smartdoorPassword || "").trim()
      const tok = !!(p as { smartdoorTokenEnabled?: boolean }).smartdoorTokenEnabled
      setOpsForm((prev) => ({
        ...prev,
        propertyType: premisesTypeLoaded,
        securitySystem: parseSecuritySystemFromDb(secRaw),
        keyCollection: {
          mailboxPassword: !!mb,
          smartdoorPassword: !!sdp,
          smartdoorToken: tok,
        },
        mailboxPassword: mb,
        smartdoorPassword: sdp,
      }))
      setOwnerAgreementOwnerId((p as { owner_id?: string }).owner_id ?? "")
      if (aptName) {
        setBuildingOptions((prev) => {
          const nameLo = aptName.toLowerCase()
          if (prev.some((b) => String(b.apartmentName || "").trim().toLowerCase() === nameLo && b.country === country)) return prev
          return [...prev, { apartmentName: aptName, country }].sort((a, b) =>
            (a.apartmentName || "").localeCompare(b.apartmentName || "") || (a.country || "MY").localeCompare(b.country || "MY")
          )
        })
      }
      setOwnerAgreementTemplateId("")
      setOwnerAgreementUrl("")
      const [ownersRes, templatesRes] = await Promise.allSettled([getPropertyOwners(), getPropertyAgreementTemplates()])
      const ownersOptions = ownersRes.status === "fulfilled"
        ? ((ownersRes.value as { options?: Array<{ label: string; value: string }> })?.options ?? [])
        : []
      const templateOptions = templatesRes.status === "fulfilled"
        ? ((templatesRes.value as { options?: Array<{ label: string; value: string }> })?.options ?? [])
        : []
      setOwners(ownersOptions as Array<{ label: string; value: string }>)
      setAgreementTemplates(templateOptions as Array<{ label: string; value: string }>)
    } catch (e) {
      console.error(e)
    }
  }

  const openCreateAgreement = async (prop: PropertyItem) => {
    setAgreementProp(prop)
    try {
      const r = await getProperty(prop.id)
      const p = (r && typeof r === "object" && "property" in r) ? (r as { property: PropertyItem }).property : (r as PropertyItem & { owner_id?: string; signagreement?: string })
      setOwnerAgreementOwnerId((p as { owner_id?: string }).owner_id ?? "")
      setOwnerAgreementTemplateId("")
      setOwnerAgreementUrl("")
      const [ownersRes, templatesRes] = await Promise.allSettled([getPropertyOwners(), getPropertyAgreementTemplates()])
      const ownersOptions = ownersRes.status === "fulfilled"
        ? ((ownersRes.value as { options?: Array<{ label: string; value: string }> })?.options ?? [])
        : []
      const templateOptions = templatesRes.status === "fulfilled"
        ? ((templatesRes.value as { options?: Array<{ label: string; value: string }> })?.options ?? [])
        : []
      setOwners(ownersOptions as Array<{ label: string; value: string }>)
      setAgreementTemplates(templateOptions as Array<{ label: string; value: string }>)
    } catch (e) {
      console.error(e)
    }
  }

  const handleSaveOwnerAgreement = async (propertyId?: string) => {
    const targetPropertyId = propertyId || editingProp?.id
    if (!targetPropertyId || !ownerAgreementOwnerId) return
    setSavingOwnerAgreement(true)
    try {
      const payload: { ownerId: string; type?: string; templateId?: string; url?: string } = { ownerId: ownerAgreementOwnerId }
      if (ownerAgreementType === "system") {
        if (!ownerAgreementTemplateId) return
        payload.type = "system"
        payload.templateId = ownerAgreementTemplateId
      } else {
        if (!ownerAgreementUrl.trim()) return
        payload.type = "manual"
        payload.url = ownerAgreementUrl.trim()
      }
      await savePropertyOwnerAgreement(targetPropertyId, payload)
      const updated = await getProperty(targetPropertyId)
      const p = (updated && typeof updated === "object" && "property" in updated) ? (updated as { property: PropertyItem }).property : (updated as PropertyItem & { signagreement?: string })
      if (p?.signagreement) {
      setEditingProp((prev) => prev && prev.id === targetPropertyId ? { ...prev, signagreement: p.signagreement } : prev)
      }
      await loadData()
      await refreshOperatorCtx()
      toast({
        title: "Agreement request submitted",
        description: "You can sign it in Operator > Agreements once draft is ready.",
      })
    } catch (e) {
      console.error(e)
      toast({
        title: "Create agreement failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setSavingOwnerAgreement(false)
    }
  }

  const handleToggleActive = async (prop: PropertyItem) => {
    try {
      const r = await setPropertyActive(prop.id, !prop.active)
      if (r?.ok === false) {
        const reason = String(r.reason || "")
        const msg =
          reason === "PROPERTY_HAS_ONGOING_TENANCY"
            ? "Cannot set property inactive while any room has ongoing tenancy."
            : reason || "Failed to update Active status."
        toast({ title: "Active update blocked", description: msg, variant: "destructive" })
        return
      }
      await loadData()
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      const detail = msg.includes("PROPERTY_HAS_ONGOING_TENANCY")
        ? "Cannot set property inactive while any room has ongoing tenancy."
        : msg
      toast({ title: "Active update blocked", description: detail, variant: "destructive" })
    }
  }

  const handleToggleArchived = async (prop: PropertyItem) => {
    try {
      const next = !(prop.archived === true)
      const r = await setPropertyArchived(prop.id, next)
      if (r?.ok !== false) await loadData()
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      const detail = msg.includes("PROPERTY_HAS_ONGOING_TENANCY")
        ? "Archive only when every room is vacant (no ongoing tenancy for any room in this property)."
        : msg
      toast({ title: "Archive blocked", description: detail, variant: "destructive" })
    }
  }

  const openOwnerProfile = async () => {
    const ownerId = String(editForm.owner_id || "").trim()
    if (!ownerId) {
      toast({
        title: "No owner selected",
        description: "Please select owner first.",
        variant: "destructive",
      })
      return
    }
    setOwnerProfileLoading(true)
    setShowOwnerProfileDialog(true)
    try {
      const res = await getOwnerDetail(ownerId)
      setOwnerProfile({
        ownerName: res?.ownerName || "",
        email: res?.email || "",
        bankName: res?.bankName || "",
        bankAccount: res?.bankAccount || "",
        bankHolder: res?.bankHolder || "",
        account: res?.account || [],
      })
    } catch (e) {
      console.error(e)
      toast({
        title: "Failed to load owner profile",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
      setOwnerProfile(null)
    } finally {
      setOwnerProfileLoading(false)
    }
  }

  const propertyDeleteBlockedReason = (prop: PropertyItem): string | null => {
    const roomCount = prop.totalRoomCount ?? 0
    if (roomCount > 0) {
      return `This property has ${roomCount} room(s). Remove rooms in Room Setting first.`
    }
    const hasMeter = Boolean(prop.meter && String(prop.meter).trim())
    const hasLock = Boolean(prop.smartdoor && String(prop.smartdoor).trim())
    if (hasMeter || hasLock) {
      const parts = [
        hasMeter ? "meter" : null,
        hasLock ? "smart lock" : null,
      ].filter(Boolean)
      return `Unbind ${parts.join(" and ")} under Property → Edit utility, then try again.`
    }
    return null
  }

  const handleDeleteProperty = async (prop: PropertyItem) => {
    const blocked = propertyDeleteBlockedReason(prop)
    if (blocked) {
      toast({ title: "Cannot delete property", description: blocked, variant: "destructive" })
      return
    }
    const confirmed = window.confirm(`Delete property "${prop.shortname || prop.apartmentName || prop.id}"?`)
    if (!confirmed) return
    try {
      const r = await setPropertyArchived(prop.id, true)
      if (r?.ok !== false) {
        toast({ title: "Property deleted", description: "Moved to archived list." })
        await loadData()
      }
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      const detail = msg.includes("PROPERTY_HAS_ROOMS")
        ? "This property still has rooms. Remove rooms in Room Setting first."
        : msg.includes("PROPERTY_HAS_METER_BOUND")
          ? "Unbind the meter under Property → Edit utility before deleting."
          : msg.includes("PROPERTY_HAS_LOCK_BOUND")
            ? "Unbind the smart lock under Property → Edit utility before deleting."
            : msg.includes("PROPERTY_HAS_ONGOING_TENANCY")
              ? "Archive only when every room is vacant (no ongoing tenancy for any room in this property)."
              : msg
      toast({ title: "Delete failed", description: detail, variant: "destructive" })
    }
  }

  const openEditUtility = async (prop: PropertyItem) => {
    setUtilityProp(prop)
    try {
      const results = await Promise.allSettled([
        getProperty(prop.id),
        getPropertySuppliers(),
        getRoomMeterOptions(undefined, prop.id),
        getRoomSmartDoorOptions(undefined, prop.id),
        getPropertySupplierExtra(prop.id),
      ])
      const [propRes, suppliersRes, meterRes, smartdoorRes, extraRes] = results.map((r) => (r.status === "fulfilled" ? r.value : null))
      const p = (propRes && typeof propRes === "object" && "property" in propRes) ? (propRes as { property: Record<string, unknown> }).property : (propRes as Record<string, unknown>)
      const extraItems = ((extraRes as { items?: Array<{ supplier_id: string; value: string; slot?: string }> } | null)?.items ?? []) as Array<{ supplier_id: string; value: string; slot?: string }>
      const suppliersOpt = (suppliersRes as { options?: Array<{ label: string; value: string }> } | null)?.options
      setSuppliersOptions(Array.isArray(suppliersOpt) ? suppliersOpt : [])
      const meterOpt = (meterRes as { options?: Array<{ label: string; value: string }> } | null)?.options
      setMeterOptions(Array.isArray(meterOpt) ? meterOpt : [])
      const smartdoorOpt = (smartdoorRes as { options?: Array<{ label: string; value: string }> } | null)?.options
      setSmartdoorOptions(Array.isArray(smartdoorOpt) ? smartdoorOpt : [])
      const bySlot = (slot: string) => extraItems.find((i) => (i.slot || "extra") === slot)
      setEditUtilityForm({
        electricId: bySlot("electric")?.value ?? String(p?.tnb ?? p?.electric ?? ""),
        electricSupplierId: bySlot("electric")?.supplier_id ?? "",
        waterId: bySlot("water")?.value ?? String(p?.saj ?? p?.water ?? ""),
        waterSupplierId: bySlot("water")?.supplier_id ?? "",
        internetId: bySlot("wifi")?.value ?? String(p?.wifi ?? ""),
        internetSupplierId: bySlot("wifi")?.supplier_id ?? String(p?.internetType ?? p?.internettype_id ?? ""),
        managementSupplierId: bySlot("management")?.supplier_id ?? String(p?.management ?? p?.management_id ?? ""),
        wifiUsername: String(p?.wifiUsername ?? ""),
        wifiPassword: String(p?.wifiPassword ?? ""),
        ownerSettlementModel:
          (p as { ownerSettlementModel?: string }).ownerSettlementModel === "management_percent_net"
            ? "management_percent_net"
            : (p as { ownerSettlementModel?: string }).ownerSettlementModel === "management_percent_rental_income_only"
              ? "management_percent_rental_income_only"
            : (p as { ownerSettlementModel?: string }).ownerSettlementModel === "rental_unit"
              ? "rental_unit"
            : (p as { ownerSettlementModel?: string }).ownerSettlementModel === "guarantee_return_fixed_plus_share"
              ? "guarantee_return_fixed_plus_share"
            : (p as { ownerSettlementModel?: string }).ownerSettlementModel === "management_fees_fixed"
              ? "management_fees_fixed"
              : "management_percent_gross",
        percentage: p?.percentage ?? "",
        remark: (p?.remark ?? "") as string,
        meter: (p?.meter ?? p?.meter_id ?? "") as string,
        smartdoor: (p?.smartdoor ?? p?.smartdoor_id ?? "") as string,
        tenantCleaningPrice:
          (p as { cleanlemonsCleaningTenantPriceMyr?: number | null }).cleanlemonsCleaningTenantPriceMyr != null
            ? String((p as { cleanlemonsCleaningTenantPriceMyr?: number | null }).cleanlemonsCleaningTenantPriceMyr)
            : "",
      })
      setUtilityExtraRows(extraItems.filter((i) => (i.slot || "extra") === "extra").map((i) => ({ supplier_id: i.supplier_id, value: i.value })))
      try {
        if (cleanlemonsLinked) {
          const pr = await getCleanlemonsCleaningPricing({ propertyId: prop.id })
          setCleaningPricing(pr && pr.ok ? pr : null)
        } else {
          setCleaningPricing(null)
        }
      } catch {
        setCleaningPricing(null)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleSaveUtility = async () => {
    if (!utilityProp?.id) return
    setSavingUtility(true)
    try {
      const mainRows: Array<{ slot: string; supplier_id: string; value: string }> = []
      if (editUtilityForm.electricSupplierId) mainRows.push({ slot: "electric", supplier_id: editUtilityForm.electricSupplierId, value: editUtilityForm.electricId.trim() })
      if (editUtilityForm.waterSupplierId) mainRows.push({ slot: "water", supplier_id: editUtilityForm.waterSupplierId, value: editUtilityForm.waterId.trim() })
      // Always send wifi row so propertydetail.wifi_id gets updated even when no supplier chosen
      mainRows.push({ slot: "wifi", supplier_id: editUtilityForm.internetSupplierId || "", value: editUtilityForm.internetId.trim() })
      if (editUtilityForm.managementSupplierId) mainRows.push({ slot: "management", supplier_id: editUtilityForm.managementSupplierId, value: "" })
      const extraRows = utilityExtraRows.filter((r) => r.supplier_id.trim()).map((r) => ({ slot: "extra" as const, supplier_id: r.supplier_id, value: r.value.trim() }))
      const allItems = [...mainRows, ...extraRows]
      await savePropertySupplierExtra(utilityProp.id, allItems)
      const updatePayload: Record<string, unknown> = {
        remark: editUtilityForm.remark || undefined,
        meter: editUtilityForm.meter || null,
        smartdoor: editUtilityForm.smartdoor || null,
        wifiUsername: editUtilityForm.wifiUsername.trim() || undefined,
        wifiPassword: editUtilityForm.wifiPassword.trim() || undefined,
        cleanlemonsCleaningTenantPriceMyr: (() => {
          const t = editUtilityForm.tenantCleaningPrice.trim()
          if (t === "") return null
          const n = Number(t)
          return Number.isFinite(n) ? n : null
        })(),
      }
      await updateProperty(utilityProp.id, updatePayload)
      setUtilityProp(null)
      await loadData()
    } catch (e) {
      console.error(e)
      const code = e instanceof Error ? e.message : String(e)
      const smartDoorMsg =
        code === "SMART_DOOR_ALREADY_USED_BY_ROOM"
          ? "This lock is already bound to a room. Remove it in Room Setting first."
          : code === "SMART_DOOR_ALREADY_USED_BY_PROPERTY"
            ? "This lock is already bound to another property."
            : code === "INVALID_OR_INACTIVE_SMART_DOOR"
              ? "Invalid or inactive lock."
              : null
      toast({
        title: smartDoorMsg ? "Smart door" : "Utilities save failed",
        description: smartDoorMsg ?? code,
        variant: "destructive",
      })
    } finally {
      setSavingUtility(false)
    }
  }

  const submitScheduleCleaningProperty = async () => {
    if (!scheduleProperty?.id || !scheduleDate) return
    setSchedulingJob(true)
    try {
      const r = await scheduleCleanlemonsCleaningJob({
        propertyId: scheduleProperty.id,
        date: scheduleDate,
        time: scheduleTime || "09:00",
        serviceProvider: "general-cleaning",
      })
      if (r?.ok) {
        toast({ title: "Cleaning scheduled", description: "Job created in Cleanlemons." })
        setScheduleProperty(null)
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

  const openParkingLot = async (prop: PropertyItem) => {
    setParkingLotProp(prop)
    try {
      const res = await getParkingLots(prop.id)
      const items = (res?.items || []) as Array<{ parkinglot?: string }>
      const list = items.map((i) => (i.parkinglot ?? "").trim())
      setParkingLotItems(list.length ? list : [""])
    } catch (e) {
      console.error(e)
      setParkingLotItems([""])
    }
  }

  const handleSaveParkingLots = async () => {
    if (!parkingLotProp?.id) return
    setSavingParkingLot(true)
    try {
      const toSave = parkingLotItems.map((s) => s.trim()).filter(Boolean)
      const r = await saveParkingLots(parkingLotProp.id, toSave.map((parkinglot) => ({ parkinglot })))
      if (r?.ok !== false) {
        setParkingLotProp(null)
        await loadData()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSavingParkingLot(false)
    }
  }

  const handleEditSettlementModelChange = (model: "management_percent_gross" | "management_percent_net" | "management_percent_rental_income_only" | "management_fees_fixed" | "rental_unit" | "guarantee_return_fixed_plus_share") => {
    setEditForm((f) => ({ ...f, ownerSettlementModel: model, managementFeesValue: "", managementFeesFixedValue: "" }))
  }

  /** After form fields were saved on Save: persist only WGS84 from the map step. */
  const performPatchPropertyCoordinates = async (propertyId: string, latitudeStr: string, longitudeStr: string) => {
    if (!propertyId) return
    setSaving(true)
    try {
      const r = await updateProperty(propertyId, {
        latitude: latitudeStr.trim(),
        longitude: longitudeStr.trim(),
      })
      if (r?.ok !== false) {
        pendingEditPropertyIdRef.current = null
        pendingEditFormSnapshotRef.current = null
        setEditingProp(null)
        await loadData()
        toast({
          title: "Saved",
          description: "Property details and map location are updated.",
        })
      }
    } catch (e) {
      console.error(e)
      const reason = e instanceof Error ? e.message : String(e)
      if (reason.includes("INVALID_LAT_LNG")) {
        toast({
          title: "Invalid coordinates",
          description: "Adjust the pin on the map and try again.",
          variant: "destructive",
        })
      } else {
        toast({
          title: "Map location not saved",
          description: reason || "Please try again.",
          variant: "destructive",
        })
      }
    } finally {
      setSaving(false)
    }
  }

  /** Same validation as save; then open map to confirm WGS84 (aligned with Cleanlemons `cln_property` flow). */
  const requestSaveEdit = async () => {
    if (!editingProp) return
    const n = Number(editForm.managementFeesValue)
    const nFixed = Number(editForm.managementFeesFixedValue)
    const isFixedLike = editForm.ownerSettlementModel === "management_fees_fixed" || editForm.ownerSettlementModel === "rental_unit"
    const isGuarantee = editForm.ownerSettlementModel === "guarantee_return_fixed_plus_share"
    const invalid =
      (isFixedLike && (!Number.isFinite(nFixed) || nFixed <= 0)) ||
      (isGuarantee && ((!Number.isFinite(nFixed) || nFixed <= 0) || !Number.isFinite(n) || n < 0)) ||
      (!isFixedLike && !isGuarantee && (!Number.isFinite(n) || n < 0))
    if (invalid) {
      toast({
        title: "Management fees required",
        description:
          isGuarantee
            ? "Enter guaranteed rental amount (> 0) and owner share % (0 or greater)."
            : isFixedLike
              ? "Enter fixed management fee amount greater than 0."
              : "Enter management fee % (0 or greater).",
        variant: "destructive",
      })
      return
    }
    const snap: PendingEditSaveSnapshot = {
      shortname: editForm.shortname,
      apartmentName: editForm.apartmentName,
      address: editForm.address,
      unitNumber: editForm.unitNumber,
      country: editForm.country,
      owner_id: editForm.owner_id,
      folder: editForm.folder || "",
      ownerSettlementModel: editForm.ownerSettlementModel,
      managementFeesValue: editForm.managementFeesValue,
      managementFeesFixedValue: editForm.managementFeesFixedValue,
      propertyType: opsForm.propertyType,
      securitySystem: opsForm.securitySystem,
      keyCollection: { ...opsForm.keyCollection },
      mailboxPassword: opsForm.mailboxPassword,
      smartdoorPassword: opsForm.smartdoorPassword,
    }
    pendingEditFormSnapshotRef.current = snap
    setMapPreflightBusy(true)
    try {
      mapConfirmInitialRef.current = await resolveInitialMapCoordsForEdit(editForm, editingProp)
    } catch (e) {
      console.error(e)
      mapConfirmInitialRef.current = resolveInitialMapCoords(editForm.latitude, editForm.longitude)
    } finally {
      setMapPreflightBusy(false)
    }
    const propertyId = editingProp.id
    setSaving(true)
    try {
      await updateProperty(propertyId, buildEditPropertyPayloadFromSnapshot(snap, null))
    } catch (e) {
      console.error(e)
      pendingEditFormSnapshotRef.current = null
      const reason = e instanceof Error ? e.message : String(e)
      toast({
        title: "Save failed",
        description: reason.includes("API") ? reason : reason || "Could not save property details.",
        variant: "destructive",
      })
      return
    } finally {
      setSaving(false)
    }
    toast({
      title: "Details saved",
      description: "Adjust the map pin if needed, then tap Confirm & save to update coordinates.",
    })
    mapConfirmOpenRef.current = true
    pendingEditPropertyIdRef.current = propertyId
    setPendingSaveMode("edit")
    setMapConfirmOpen(true)
  }

  const performAdd = async (latitudeStr: string, longitudeStr: string) => {
    setSaving(true)
    try {
      const base = {
        unitNumber: editForm.unitNumber.trim() || undefined,
        apartmentName: editForm.apartmentName.trim() || undefined,
        shortname: editForm.shortname.trim() || undefined,
        address: editForm.address.trim() || undefined,
        country: editForm.country === "SG" ? "SG" : "MY",
        ownerSettlementModel: addSettlementModel,
        premisesType: opsForm.propertyType,
        securitySystem: opsForm.securitySystem,
        securityUsername: null,
        latitude: latitudeStr.trim(),
        longitude: longitudeStr.trim(),
        mailboxPassword: opsForm.keyCollection.mailboxPassword
          ? opsForm.mailboxPassword.trim() || null
          : null,
        smartdoorPassword: opsForm.keyCollection.smartdoorPassword
          ? opsForm.smartdoorPassword.trim() || null
          : null,
        smartdoorTokenEnabled: !!opsForm.keyCollection.smartdoorToken,
        ...(addSettlementModel === "guarantee_return_fixed_plus_share"
          ? { fixedRentToOwner: Number(addFixedManagementFee), percentage: Number(addManagementPercent) }
          : (addSettlementModel === "management_fees_fixed" || addSettlementModel === "rental_unit")
            ? { fixedRentToOwner: Number(addFixedManagementFee) }
            : { percentage: Number(addManagementPercent) }),
        ...(insertSecurityCredentials &&
        isCompleteSecurityCredentials(parseSecuritySystemFromDb(opsForm.securitySystem), insertSecurityCredentials)
          ? { securitySystemCredentials: insertSecurityCredentials }
          : {}),
      }
      const r = await insertProperty([base])
      if (r?.ok !== false) {
        setShowAddDialog(false)
        setInsertSecurityCredentials(null)
        setEditForm({ shortname: "", apartmentName: "", address: "", unitNumber: "", country: "MY", owner_id: "", folder: "", latitude: "", longitude: "", ownerSettlementModel: "management_percent_gross", managementFeesValue: "", managementFeesFixedValue: "" })
        setAddSettlementModel("management_percent_gross")
        setAddManagementPercent("")
        setAddFixedManagementFee("")
        resetOpsForm()
        await loadData()
      }
    } catch (e) {
      console.error(e)
      const reason = e instanceof Error ? e.message : String(e)
      if (reason.includes("INVALID_LAT_LNG")) {
        toast({
          title: "Invalid coordinates",
          description: "Adjust the pin on the map and try again.",
          variant: "destructive",
        })
      }
    } finally {
      setSaving(false)
    }
  }

  const requestAdd = async () => {
    if (addSettlementModel === "guarantee_return_fixed_plus_share") {
      const n = Number(addManagementPercent)
      const nFixed = Number(addFixedManagementFee)
      if (!Number.isFinite(n) || n < 0 || !Number.isFinite(nFixed) || nFixed <= 0) {
        toast({ title: "Guarantee return required", description: "Enter fixed amount (> 0) and owner share % (0 or greater).", variant: "destructive" })
        return
      }
    } else if (addSettlementModel === "management_fees_fixed" || addSettlementModel === "rental_unit") {
      const n = Number(addFixedManagementFee)
      if (!Number.isFinite(n) || n <= 0) {
        toast({ title: "Fixed fee required", description: "Enter a fixed management fee amount (e.g. 2000).", variant: "destructive" })
        return
      }
    } else {
      const n = Number(addManagementPercent)
      if (!Number.isFinite(n) || n < 0) {
        toast({ title: "Management fee % required", description: "Enter a percentage of 0 or greater (e.g. 10).", variant: "destructive" })
        return
      }
    }
    setMapPreflightBusy(true)
    try {
      mapConfirmInitialRef.current = await resolveInitialMapCoordsForAdd(editForm)
    } catch (e) {
      console.error(e)
      mapConfirmInitialRef.current = resolveInitialMapCoords(editForm.latitude, editForm.longitude)
    } finally {
      setMapPreflightBusy(false)
    }
    mapConfirmOpenRef.current = true
    setPendingSaveMode("add")
    setMapConfirmOpen(true)
  }

  const confirmMapLocationAndSave = () => {
    const marker = leafletMarkerRef.current
    const mode = pendingSaveMode
    if (!mode) {
      setMapConfirmOpen(false)
      setPendingSaveMode(null)
      return
    }
    if (!marker) {
      toast({
        title: "Map loading",
        description: "Wait for the map to appear, then confirm.",
        variant: "destructive",
      })
      return
    }
    const ll = marker.getLatLng()
    const latStr = String(ll.lat)
    const lngStr = String(ll.lng)
    const editPropertyId =
      mode === "edit" ? (pendingEditPropertyIdRef.current ?? editingProp?.id ?? "") : ""

    if (mode === "edit") {
      if (!editPropertyId) {
        toast({
          title: "Could not save",
          description: "Edit session was reset. Close and open Edit property again, then save.",
          variant: "destructive",
        })
        return
      }
    }

    setEditForm((f) => ({ ...f, latitude: latStr, longitude: lngStr }))
    mapConfirmOpenRef.current = false
    pendingEditPropertyIdRef.current = null
    pendingEditFormSnapshotRef.current = null
    setMapConfirmOpen(false)
    setPendingSaveMode(null)

    if (mode === "edit") {
      void performPatchPropertyCoordinates(editPropertyId, latStr, lngStr)
    } else void performAdd(latStr, lngStr)
  }

  useEffect(() => {
    if (!mapConfirmOpen) {
      setMapDialogReady(false)
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
      leafletMarkerRef.current = null
      return
    }
    setMapDialogReady(false)
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const L = await import("leaflet")
        if (cancelled) return
        const el = mapConfirmContainerRef.current
        if (!el) return
        const { lat, lng } = mapConfirmInitialRef.current
        if (leafletMapRef.current) {
          leafletMapRef.current.remove()
          leafletMapRef.current = null
        }
        leafletMarkerRef.current = null
        const map = L.map(el).setView([lat, lng], 16)
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map)
        const pinIcon = L.divIcon({
          className: "coliving-property-map-pin",
          html: '<div style="width:14px;height:14px;background:#dc2626;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        })
        const marker = L.marker([lat, lng], { draggable: true, icon: pinIcon }).addTo(map)
        leafletMarkerRef.current = marker
        leafletMapRef.current = map
        map.on("click", (e) => {
          marker.setLatLng(e.latlng)
        })
        map.invalidateSize()
        setMapDialogReady(true)
      })()
    }, 100)
    return () => {
      cancelled = true
      clearTimeout(timer)
      setMapDialogReady(false)
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
      leafletMarkerRef.current = null
    }
  }, [mapConfirmOpen])

  useEffect(() => {
    if (propertyViewMode !== "map" || loading) {
      overviewMarkersByPropertyIdRef.current = {}
      if (overviewMapRef.current) {
        overviewMapRef.current.remove()
        overviewMapRef.current = null
      }
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const L = await import("leaflet")
        if (cancelled) return
        const el = overviewMapContainerRef.current
        if (!el) return
        const pts: Array<{ p: PropertyItem; lat: number; lng: number }> = []
        for (const p of properties) {
          const lat = p.latitude != null ? Number(p.latitude) : NaN
          const lng = p.longitude != null ? Number(p.longitude) : NaN
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180
          ) {
            continue
          }
          pts.push({ p, lat, lng })
        }
        if (overviewMapRef.current) {
          overviewMapRef.current.remove()
          overviewMapRef.current = null
        }
        const center: [number, number] =
          pts.length > 0 ? [pts[0].lat, pts[0].lng] : [DEFAULT_MAP_LAT, DEFAULT_MAP_LNG]
        const map = L.map(el).setView(center, pts.length === 1 ? 15 : pts.length === 0 ? 11 : 12)
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map)
        const latlngs: [number, number][] = []
        overviewMarkersByPropertyIdRef.current = {}
        const byCoord = new Map<string, Array<{ p: PropertyItem; lat: number; lng: number }>>()
        for (const item of pts) {
          const k = coordGroupKey(item.lat, item.lng)
          const arr = byCoord.get(k)
          if (arr) arr.push(item)
          else byCoord.set(k, [item])
        }
        for (const group of byCoord.values()) {
          group.sort((a, b) =>
            String(a.p.shortname || a.p.apartmentName || a.p.id).localeCompare(
              String(b.p.shortname || b.p.apartmentName || b.p.id),
              undefined,
              { sensitivity: "base" }
            )
          )
          const { lat, lng } = group[0]
          latlngs.push([lat, lng])
          const propList = group.map((g) => g.p)
          const pinColor = overviewMapPinColorForGroup(
            propList.map((p) => p.id),
            propertyOccupancy
          )
          const count = group.length
          const pinHtml =
            count > 1
              ? `<div style="position:relative;width:18px;height:18px;display:flex;align-items:center;justify-content:center"><div style="width:12px;height:12px;background:${pinColor};border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div><span style="position:absolute;bottom:-2px;right:-4px;min-width:14px;height:14px;padding:0 3px;background:#fff;border:1px solid #ccc;border-radius:7px;font-size:9px;font-weight:600;line-height:12px;text-align:center;color:#374151">${count}</span></div>`
              : `<div style="width:12px;height:12px;background:${pinColor};border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`
          const pinIcon = L.divIcon({
            className: "coliving-overview-pin",
            html: pinHtml,
            iconSize: count > 1 ? [18, 18] : [12, 12],
            iconAnchor: count > 1 ? [9, 9] : [6, 6],
          })
          const m = L.marker([lat, lng], { icon: pinIcon }).addTo(map)
          m.bindPopup(buildOverviewMapPopupHtml(propList, propertyOccupancy))
          for (const g of group) {
            overviewMarkersByPropertyIdRef.current[g.p.id] = m
          }
        }
        if (latlngs.length > 1) {
          map.fitBounds(latlngs, { padding: [48, 48], maxZoom: 16 })
        }
        overviewMapRef.current = map
        window.setTimeout(() => {
          map.invalidateSize()
        }, 200)
      })()
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
      overviewMarkersByPropertyIdRef.current = {}
      if (overviewMapRef.current) {
        overviewMapRef.current.remove()
        overviewMapRef.current = null
      }
    }
  }, [propertyViewMode, properties, loading, propertyOccupancy])

  useEffect(() => {
    if (propertyViewMode !== "map") setSelectedMapListPropertyId(null)
  }, [propertyViewMode])

  const focusPropertyOnOverviewMap = useCallback((prop: PropertyItem) => {
    setSelectedMapListPropertyId(prop.id)
    const lat = prop.latitude != null ? Number(prop.latitude) : NaN
    const lng = prop.longitude != null ? Number(prop.longitude) : NaN
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      toast({
        title: "No map location",
        description: "Edit the property, save, and confirm the pin to add GPS.",
        variant: "destructive",
      })
      return
    }
    const map = overviewMapRef.current
    const marker = overviewMarkersByPropertyIdRef.current[prop.id]
    if (!map || !marker) {
      toast({
        title: "Map loading",
        description: "Wait for the map to finish loading, then try again.",
        variant: "destructive",
      })
      return
    }
    map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true })
    marker.openPopup()
    window.setTimeout(() => map.invalidateSize(), 150)
  }, [])

  return (
    <main className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Property Settings</h1>
          <p className="text-sm text-muted-foreground">Manage all your properties and configurations</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-border rounded-lg overflow-hidden">
            <Button
              type="button"
              variant={propertyViewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none gap-1"
              onClick={() => setPropertyViewMode("list")}
              title="List view"
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">List</span>
            </Button>
            <Button
              type="button"
              variant={propertyViewMode === "map" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none gap-1"
              onClick={() => setPropertyViewMode("map")}
              title="Map view"
            >
              <MapIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Map</span>
            </Button>
          </div>
          {propertyViewMode === "list" ? (
            <>
              <input
                type="text"
                placeholder="Search..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="border border-border rounded-lg px-3 py-2 text-sm w-40"
              />
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm">
                <option value="ALL">All</option>
                <option value="ACTIVE_ONLY">Active only</option>
                <option value="INACTIVE_ONLY">Inactive only</option>
                <option value="ARCHIVED_ONLY">Archived unit</option>
              </select>
            </>
          ) : null}
          <Button
            className="gap-2"
            style={{ background: "var(--brand)" }}
            onClick={() => {
              setEditForm({ shortname: "", apartmentName: "", address: "", unitNumber: "", country: "MY", owner_id: "", folder: "", latitude: "", longitude: "", ownerSettlementModel: "management_percent_gross", managementFeesValue: "", managementFeesFixedValue: "" })
              setAddSettlementModel("management_percent_gross")
              setAddManagementPercent("")
              setAddFixedManagementFee("")
              resetOpsForm()
              setShowAddDialog(true)
            }}
          >
            <Plus size={18} /> Add Property
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading...</div>
      ) : properties.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">No properties found.</div>
      ) : propertyViewMode === "map" ? (
        <div className="space-y-3">
          {properties.every(
            (p) =>
              p.latitude == null ||
              p.longitude == null ||
              !Number.isFinite(Number(p.latitude)) ||
              !Number.isFinite(Number(p.longitude))
          ) ? (
            <p className="text-sm text-muted-foreground">
              No saved GPS on these properties yet. Edit a property, save, and confirm the pin on the map to show pins here.
            </p>
          ) : null}
          <div className="flex flex-col md:flex-row rounded-lg border border-border overflow-hidden bg-background min-h-[min(70vh,640px)]">
            <aside className="flex w-full md:w-[min(100%,320px)] md:max-w-[38vw] shrink-0 flex-col border-b md:border-b-0 md:border-r border-border bg-muted/30 max-h-[min(40vh,360px)] md:max-h-none md:h-auto">
              <div className="px-3 py-2.5 border-b border-border text-sm font-semibold text-foreground">
                Properties ({properties.length})
              </div>
              <div className="overflow-y-auto flex-1 p-2 space-y-1 min-h-0">
                {properties.map((p) => {
                  const hasGps =
                    p.latitude != null &&
                    p.longitude != null &&
                    Number.isFinite(Number(p.latitude)) &&
                    Number.isFinite(Number(p.longitude)) &&
                    Math.abs(Number(p.latitude)) <= 90 &&
                    Math.abs(Number(p.longitude)) <= 180
                  const label = p.shortname || p.apartmentName || p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => focusPropertyOnOverviewMap(p)}
                      className={cn(
                        "w-full rounded-md border border-transparent px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/80",
                        selectedMapListPropertyId === p.id && "border border-primary/40 bg-accent"
                      )}
                    >
                      <div className="font-medium text-foreground line-clamp-2">{label}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{p.address || "—"}</div>
                      {!hasGps ? (
                        <span className="text-[10px] text-muted-foreground mt-1 block">No GPS saved</span>
                      ) : null}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {p.active === false ? <Badge variant="secondary" className="text-[10px] px-1 py-0">Inactive</Badge> : null}
                        {p.archived === true ? <Badge variant="secondary" className="text-[10px] px-1 py-0">Archived</Badge> : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            </aside>
            <div
              ref={overviewMapContainerRef}
              className="flex-1 min-h-[280px] md:min-h-[min(70vh,640px)] h-[min(50vh,480px)] md:h-auto bg-muted z-0 min-w-0"
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {properties.map((prop) => {
            const fullyOccupied = propertyOccupancy[prop.id]
            return (
              <Card
                key={prop.id}
                className={`p-6 transition-colors ${fullyOccupied ? "bg-green-500/10 border-green-500/30 dark:bg-green-950/30" : ""}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-4 flex-1 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                      <Building2 size={24} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-lg text-foreground">{prop.shortname || prop.apartmentName || prop.id}</h3>
                        {prop.active === false && <Badge variant="secondary">Inactive</Badge>}
                        {prop.archived === true && <Badge variant="secondary">Archived</Badge>}
                        <Badge variant="outline">
                          {Number(prop.availableUnitCount || 0)}/{Number(prop.totalRoomCount || 0)} room
                        </Badge>
                        {fullyOccupied && (
                          <Badge className="bg-green-600 text-white border-0">Full occupied</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mb-3">
                        <MapPin size={14} /> {prop.address || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">{prop.apartmentName || ""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground whitespace-nowrap">Active</Label>
                      <Switch
                        checked={prop.active !== false}
                        onCheckedChange={() => handleToggleActive(prop)}
                        title="Toggle active"
                        disabled={prop.archived === true}
                      />
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="rounded-lg" title="Actions">
                          <MoreHorizontal size={18} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDetail(prop)}>
                          <Edit size={14} className="mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEditUtility(prop)}>
                          <Wrench size={14} className="mr-2" /> Edit utility
                        </DropdownMenuItem>
                        {cleanlemonsLinked && propertyCleaningScheduleInfo[prop.id]?.canSchedule && (
                          <DropdownMenuItem
                            onClick={() => {
                              setScheduleProperty(prop)
                              setScheduleDate(new Date().toISOString().slice(0, 10))
                              setScheduleTime("09:00")
                            }}
                          >
                            <Calendar size={14} className="mr-2" /> Schedule cleaning
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => openParkingLot(prop)}>
                          <Car size={14} className="mr-2" /> Parking lot
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openCreateAgreement(prop)}>
                          <User size={14} className="mr-2" /> Create agreement
                        </DropdownMenuItem>
                        {prop.archived === true ? (
                          <DropdownMenuItem onClick={() => handleToggleArchived(prop)}>
                            Unarchive
                          </DropdownMenuItem>
                        ) : propertyDeleteBlockedReason(prop) ? (
                          <DropdownMenuItem
                            disabled
                            className="opacity-60 cursor-not-allowed"
                            title="Remove all rooms, unbind meter and smart lock (Property → Edit utility), then delete."
                          >
                            <Trash2 size={14} className="mr-2" /> Delete
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => handleDeleteProperty(prop)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 size={14} className="mr-2" /> Delete
                          </DropdownMenuItem>
                        )}
                        {prop.signagreement &&
                          String(prop.signagreement).trim() !== "" &&
                          String(prop.signagreement) !== "#" && (
                            <DropdownMenuItem
                              onClick={() =>
                                openOrDownloadAgreementUrl(String(prop.signagreement), "agreement.pdf")
                              }
                            >
                              <Download size={14} className="mr-2" /> Download agreement
                            </DropdownMenuItem>
                          )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog
        open={!!editingProp}
        onOpenChange={(o) => {
          if (!o && mapConfirmOpenRef.current) return
          if (!o) setEditingProp(null)
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{viewMode === "view" ? "Property Details" : "Edit Property"}</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">
            {editingProp && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <Label className="text-xs font-medium">Active</Label>
                <Switch checked={editingProp.active !== false} onCheckedChange={() => handleToggleActive(editingProp)} disabled={viewMode === "view"} />
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Property details</p>
              <div>
                <Label className="text-xs">Property type</Label>
                <Select value={opsForm.propertyType} onValueChange={(v) => setOpsForm((prev) => ({ ...prev, propertyType: v as PremisesTypeOption }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="landed">Landed</SelectItem>
                    <SelectItem value="apartment">Apartment</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                    <SelectItem value="office">Office</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Short name</Label>
                <Input value={editForm.shortname} onChange={(e) => setEditForm(f => ({ ...f, shortname: e.target.value }))} className="mt-1" readOnly={viewMode === "view"} />
              </div>
              <div>
                <Label className="text-xs">{premisesBuildingNameLabel(opsForm.propertyType)}</Label>
                <div className="flex gap-2 mt-1">
                  <Select
                    value={getBuildingSelectValue(editForm.apartmentName, editForm.country, buildingOptions, operatorCountry)}
                    onValueChange={(v) => {
                      if (v === "__none__") setEditForm(f => ({ ...f, apartmentName: "", country: operatorCountry }))
                      else {
                        const [name, country] = v.split("||")
                        setEditForm(f => ({ ...f, apartmentName: name ?? "", country: (country === "SG" ? "SG" : "MY") }))
                      }
                    }}
                    disabled={viewMode === "view"}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder={premisesBuildingSelectPlaceholder(opsForm.propertyType)} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{premisesBuildingSelectPlaceholder(opsForm.propertyType)}</SelectItem>
                      {buildingOptions.map((b) => (
                        <SelectItem key={`${b.apartmentName}||${b.country}`} value={`${b.apartmentName}||${b.country}`}>
                          {b.apartmentName} | {b.country}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {viewMode === "edit" && (
                    <Button type="button" variant="outline" size="sm" onClick={() => { setNewBuildingName(""); setShowAddBuildingDialog(true) }}>Add new</Button>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-xs">Unit number</Label>
                <Input value={editForm.unitNumber} onChange={(e) => setEditForm(f => ({ ...f, unitNumber: e.target.value }))} className="mt-1" readOnly={viewMode === "view"} />
              </div>
              <div>
                <Label className="text-xs">Address</Label>
                <PropertyAddressField
                  value={editForm.address}
                  onChange={(v) => setEditForm((f) => ({ ...f, address: v }))}
                  readOnly={viewMode === "view"}
                  countrycodes={editForm.country === "SG" ? "sg" : "my"}
                  buildingName={editForm.apartmentName}
                  landedHint={opsForm.propertyType === "landed"}
                  onPickSuggestion={(item) => {
                    setEditForm((f) => ({
                      ...f,
                      latitude: item.lat && String(item.lat).trim() ? String(item.lat) : f.latitude,
                      longitude: item.lon && String(item.lon).trim() ? String(item.lon) : f.longitude,
                    }))
                  }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Owner</p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="flex-1 min-w-0">
                  <Label className="text-xs">Owner</Label>
                  <Select
                    value={editForm.owner_id?.trim() ? editForm.owner_id.trim() : "__none__"}
                    onValueChange={(v) => setEditForm((f) => ({ ...f, owner_id: v === "__none__" ? "" : v }))}
                    disabled={viewMode === "view"}
                  >
                    <SelectTrigger
                      className={cn(
                        "mt-1",
                        viewMode === "edit" && !editForm.owner_id?.trim() && "border-destructive ring-2 ring-destructive/25",
                      )}
                    >
                      <SelectValue placeholder="Select owner" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select owner</SelectItem>
                      {owners.filter((o) => o.value).map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {viewMode === "edit" && (
                  <Button type="button" variant="outline" className="shrink-0 w-full sm:w-auto" onClick={openOwnerProfile} disabled={!String(editForm.owner_id || "").trim()}>
                    View profile
                  </Button>
                )}
              </div>
              {viewMode === "edit" && !editForm.owner_id?.trim() && (
                <p className="text-xs text-destructive">No owner: you can still save. Owner is needed for owner payout bank files and agreements.</p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Access</p>
              <div>
                <Label className="text-xs">Key collection</Label>
                <div className="space-y-2 mt-2">
                  <label className="flex items-center gap-2 text-xs"><Checkbox checked={opsForm.keyCollection.mailboxPassword} onCheckedChange={(v) => setOpsForm((prev) => ({ ...prev, keyCollection: { ...prev.keyCollection, mailboxPassword: v === true } }))} />Mailbox password</label>
                  {opsForm.keyCollection.mailboxPassword && <Input value={opsForm.mailboxPassword} onChange={(e) => setOpsForm((prev) => ({ ...prev, mailboxPassword: e.target.value }))} placeholder="Mailbox password" />}
                  <label className="flex items-center gap-2 text-xs"><Checkbox checked={opsForm.keyCollection.smartdoorPassword} onCheckedChange={(v) => setOpsForm((prev) => ({ ...prev, keyCollection: { ...prev.keyCollection, smartdoorPassword: v === true } }))} />Smartdoor (password)</label>
                  {opsForm.keyCollection.smartdoorPassword && <Input value={opsForm.smartdoorPassword} onChange={(e) => setOpsForm((prev) => ({ ...prev, smartdoorPassword: e.target.value }))} placeholder="Smartdoor password" />}
                  <label className="flex items-center gap-2 text-xs"><Checkbox checked={opsForm.keyCollection.smartdoorToken} onCheckedChange={(v) => setOpsForm((prev) => ({ ...prev, keyCollection: { ...prev.keyCollection, smartdoorToken: v === true } }))} />Smartdoor (token)</label>
                </div>
              </div>
              <div>
                <Label className="text-xs">Security system</Label>
                <div className="flex flex-col sm:flex-row gap-2 mt-1 sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium text-foreground capitalize">{parseSecuritySystemFromDb(opsForm.securitySystem)}</p>
                    {securitySystemSummaryText ? (
                      <p className="text-xs text-muted-foreground break-words">{securitySystemSummaryText}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not configured. Use Edit to choose the system and enter login details (saved in MySQL).</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 w-full sm:w-auto"
                    disabled={viewMode === "view"}
                    onClick={() => openSecurityCredentialsModal(false)}
                  >
                    Edit
                  </Button>
                </div>
              </div>
              {opsForm.propertyType === "other" && (
                <div className="border rounded-md border-border bg-background p-3 space-y-3">
                  <p className="text-xs font-medium">Bed counts (other / homestay-style)</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Single</Label>
                      <Input type="number" min={0} value={opsForm.bedSection.single} onChange={(e) => setBedQty("single", Number(e.target.value || 0))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Super Single</Label>
                      <Input type="number" min={0} value={opsForm.bedSection.supersingle} onChange={(e) => setBedQty("supersingle", Number(e.target.value || 0))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Queen</Label>
                      <Input type="number" min={0} value={opsForm.bedSection.queen} onChange={(e) => setBedQty("queen", Number(e.target.value || 0))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">King</Label>
                      <Input type="number" min={0} value={opsForm.bedSection.king} onChange={(e) => setBedQty("king", Number(e.target.value || 0))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Super King</Label>
                      <Input type="number" min={0} value={opsForm.bedSection.superking} onChange={(e) => setBedQty("superking", Number(e.target.value || 0))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Total bed</Label>
                      <Input value={String(opsForm.totalBed)} readOnly className="mt-1" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Number of room</Label>
                      <Input type="number" min={0} value={opsForm.numberOfRoom} onChange={(e) => setOpsForm((prev) => ({ ...prev, numberOfRoom: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Number of bathroom</Label>
                      <Input type="number" min={0} value={opsForm.numberOfBathroom} onChange={(e) => setOpsForm((prev) => ({ ...prev, numberOfBathroom: e.target.value }))} className="mt-1" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Owner settlement &amp; files</p>
              <div>
                <Label className="text-xs">Owner settlement</Label>
                <Select
                  value={editForm.ownerSettlementModel}
                  onValueChange={(v) => handleEditSettlementModelChange(v as "management_percent_gross" | "management_percent_net" | "management_percent_rental_income_only" | "management_fees_fixed" | "rental_unit" | "guarantee_return_fixed_plus_share")}
                  disabled={viewMode === "view"}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="management_percent_gross">Management Fees % of Gross income</SelectItem>
                    <SelectItem value="management_percent_net">Management Fees % of Net income</SelectItem>
                    <SelectItem value="management_percent_rental_income_only">Management Fees % of Rental Income Only</SelectItem>
                    <SelectItem value="management_fees_fixed">Management Fees on fixed amount</SelectItem>
                    <SelectItem value="rental_unit">Rental unit</SelectItem>
                    <SelectItem value="guarantee_return_fixed_plus_share">Guarantee return (fixed amount)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(editForm.ownerSettlementModel === "guarantee_return_fixed_plus_share") ? (
                <>
                  <div>
                    <Label className="text-xs">Guaranteed rental amount (to owner)</Label>
                    <Input
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={editForm.managementFeesFixedValue}
                      onChange={(e) => setEditForm((f) => ({ ...f, managementFeesFixedValue: e.target.value }))}
                      className="mt-1"
                      placeholder="e.g. 2000"
                      readOnly={viewMode === "view"}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Owner share of remaining (%)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={editForm.managementFeesValue}
                      onChange={(e) => setEditForm((f) => ({ ...f, managementFeesValue: e.target.value }))}
                      className="mt-1"
                      placeholder="e.g. 50"
                      readOnly={viewMode === "view"}
                    />
                  </div>
                </>
              ) : (
                <div>
                  <Label className="text-xs">
                    {(editForm.ownerSettlementModel === "management_fees_fixed" || editForm.ownerSettlementModel === "rental_unit") ? "Management Fees (fixed amount)" : "Management Fees (%)"}
                  </Label>
                  <Input
                    type="number"
                    min={
                      editForm.ownerSettlementModel === "management_fees_fixed" || editForm.ownerSettlementModel === "rental_unit"
                        ? 0.01
                        : 0
                    }
                    step="0.01"
                    value={
                      editForm.ownerSettlementModel === "management_fees_fixed" || editForm.ownerSettlementModel === "rental_unit"
                        ? editForm.managementFeesFixedValue
                        : editForm.managementFeesValue
                    }
                    onChange={(e) => {
                      const v = e.target.value
                      setEditForm((f) => {
                        const fixedLike = f.ownerSettlementModel === "management_fees_fixed" || f.ownerSettlementModel === "rental_unit"
                        return fixedLike ? { ...f, managementFeesFixedValue: v } : { ...f, managementFeesValue: v }
                      })
                    }}
                    className="mt-1"
                    placeholder={(editForm.ownerSettlementModel === "management_fees_fixed" || editForm.ownerSettlementModel === "rental_unit") ? "e.g. 2000" : "e.g. 10"}
                    readOnly={viewMode === "view"}
                  />
                </div>
              )}
              <div>
                <Label className="text-xs">Drive folder (URL or ID)</Label>
                <Input
                  value={editForm.folder || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, folder: e.target.value }))}
                  placeholder="https://drive.google.com/drive/folders/<folderId> (or just <folderId>)"
                  className="mt-1"
                  readOnly={viewMode === "view"}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Used to upload owner report PDFs on Report page.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProp(null)}>Cancel</Button>
            {viewMode === "edit" && (
              <Button
                style={{ background: "var(--brand)" }}
                onClick={() => void requestSaveEdit()}
                disabled={saving || mapPreflightBusy}
              >
                {saving ? "Saving..." : mapPreflightBusy ? "Preparing map…" : "Save"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!agreementProp} onOpenChange={(o) => !o && setAgreementProp(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create agreement</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {agreementProp?.signagreement ? (
              <a href={agreementProp.signagreement} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
                <ExternalLink size={14} /> Open current agreement
              </a>
            ) : null}
            <div>
              <Label className="text-xs">Owner</Label>
              <p className="text-sm text-muted-foreground mt-2">
                {owners.find((o) => o.value === ownerAgreementOwnerId)?.label || ownerAgreementOwnerId || "—"}
              </p>
              {!ownerAgreementOwnerId?.trim() && (
                <p className="text-xs text-destructive mt-2">Please bind owner in "Edit Property" first.</p>
              )}
            </div>
            <div>
              <Label className="text-xs">Agreement type</Label>
              <Select value={ownerAgreementType} onValueChange={(v) => setOwnerAgreementType(v as "system" | "manual")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System template</SelectItem>
                  <SelectItem value="manual">Manual URL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ownerAgreementType === "system" ? (
              <div>
                <Label className="text-xs">Template</Label>
                <Select value={ownerAgreementTemplateId} onValueChange={setOwnerAgreementTemplateId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select template" /></SelectTrigger>
                  <SelectContent>
                    {agreementTemplates.filter((t) => t.value).map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label className="text-xs">Agreement URL</Label>
                <Input value={ownerAgreementUrl} onChange={(e) => setOwnerAgreementUrl(e.target.value)} placeholder="https://..." className="mt-1" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAgreementProp(null)}>Cancel</Button>
            <Button
              style={{ background: "var(--brand)" }}
              onClick={async () => {
                if (!agreementProp) return
                await handleSaveOwnerAgreement(agreementProp.id)
                setAgreementProp(null)
              }}
              disabled={savingOwnerAgreement || !ownerAgreementOwnerId}
            >
              {savingOwnerAgreement ? "Saving..." : "Create agreement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={secCredModalOpen} onOpenChange={setSecCredModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Security system login</DialogTitle>
            <DialogDescription>
              Choose the system here and enter login details. Data is saved to MySQL and shown in plain text on this screen when you reopen the property. Leave password empty only when saving without changing an existing password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Security system</Label>
              <Select value={secCredModalSystem} onValueChange={(v) => setSecCredModalSystem(v as SecuritySystemIdOption)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="icare">icare</SelectItem>
                  <SelectItem value="ecommunity">ecommunity</SelectItem>
                  <SelectItem value="veemios">veemios</SelectItem>
                  <SelectItem value="gprop">gprop</SelectItem>
                  <SelectItem value="css">css</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {secCredModalSystem === "icare" ? (
              <>
                <div>
                  <Label className="text-xs">Phone number</Label>
                  <Input value={secCredPhone} onChange={(e) => setSecCredPhone(e.target.value)} className="mt-1" autoComplete="off" />
                </div>
                <div>
                  <Label className="text-xs">Date of birth</Label>
                  <Input type="date" value={secCredDob} onChange={(e) => setSecCredDob(e.target.value)} className="mt-1" />
                </div>
              </>
            ) : null}
            {secCredModalSystem === "ecommunity" ? (
              <div>
                <Label className="text-xs">User</Label>
                <Input value={secCredUser} onChange={(e) => setSecCredUser(e.target.value)} className="mt-1" autoComplete="off" />
              </div>
            ) : null}
            {(secCredModalSystem === "veemios" || secCredModalSystem === "gprop") ? (
              <div>
                <Label className="text-xs">User ID</Label>
                <Input value={secCredUserId} onChange={(e) => setSecCredUserId(e.target.value)} className="mt-1" autoComplete="off" />
              </div>
            ) : null}
            {secCredModalSystem === "css" ? (
              <div>
                <Label className="text-xs">Login code</Label>
                <Input value={secCredLoginCode} onChange={(e) => setSecCredLoginCode(e.target.value)} className="mt-1" autoComplete="off" />
              </div>
            ) : null}
            <div>
              <Label className="text-xs">Password</Label>
              <Input type="text" value={secCredPassword} onChange={(e) => setSecCredPassword(e.target.value)} className="mt-1 font-mono text-sm" autoComplete="off" spellCheck={false} placeholder="Required (leave blank to keep existing when editing)" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSecCredModalOpen(false)}>Cancel</Button>
            <Button type="button" style={{ background: "var(--brand)" }} disabled={secCredModalSaving} onClick={() => void handleSecurityCredentialsModalSave()}>
              {secCredModalSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showAddDialog}
        onOpenChange={(o) => {
          if (!o && mapConfirmOpenRef.current) return
          setShowAddDialog(o)
          if (!o) setInsertSecurityCredentials(null)
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Property</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Property details</p>
              <div>
                <Label className="text-xs">Property type</Label>
                <Select value={opsForm.propertyType} onValueChange={(v) => setOpsForm((prev) => ({ ...prev, propertyType: v as PremisesTypeOption }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="landed">Landed</SelectItem>
                    <SelectItem value="apartment">Apartment</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                    <SelectItem value="office">Office</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Short name</Label>
                <Input value={editForm.shortname} onChange={(e) => setEditForm(f => ({ ...f, shortname: e.target.value }))} placeholder="Optional; default: building + unit" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">{premisesBuildingNameLabel(opsForm.propertyType)}</Label>
                <div className="flex gap-2 mt-1">
                  <Select
                    value={getBuildingSelectValue(editForm.apartmentName, editForm.country, buildingOptions, operatorCountry)}
                    onValueChange={(v) => {
                      if (v === "__none__") setEditForm(f => ({ ...f, apartmentName: "", country: operatorCountry }))
                      else {
                        const [name, country] = v.split("||")
                        setEditForm(f => ({ ...f, apartmentName: name ?? "", country: (country === "SG" ? "SG" : "MY") }))
                      }
                    }}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder={premisesBuildingSelectPlaceholder(opsForm.propertyType)} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{premisesBuildingSelectPlaceholder(opsForm.propertyType)}</SelectItem>
                      {buildingOptions.map((b) => (
                        <SelectItem key={`${b.apartmentName}||${b.country}`} value={`${b.apartmentName}||${b.country}`}>
                          {b.apartmentName} | {b.country}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" onClick={() => { setNewBuildingName(""); setShowAddBuildingDialog(true) }}>Add new</Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Unit number</Label>
                <Input value={editForm.unitNumber} onChange={(e) => setEditForm(f => ({ ...f, unitNumber: e.target.value }))} placeholder="e.g. A-01" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Address</Label>
                <PropertyAddressField
                  value={editForm.address}
                  onChange={(v) => setEditForm((f) => ({ ...f, address: v }))}
                  countrycodes={editForm.country === "SG" ? "sg" : "my"}
                  buildingName={editForm.apartmentName}
                  landedHint={opsForm.propertyType === "landed"}
                  onPickSuggestion={(item) => {
                    setEditForm((f) => ({
                      ...f,
                      latitude: item.lat && String(item.lat).trim() ? String(item.lat) : f.latitude,
                      longitude: item.lon && String(item.lon).trim() ? String(item.lon) : f.longitude,
                    }))
                  }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Access</p>
              <div>
                <Label className="text-xs">Key collection</Label>
                <div className="space-y-2 mt-2">
                  <label className="flex items-center gap-2 text-xs"><Checkbox checked={opsForm.keyCollection.mailboxPassword} onCheckedChange={(v) => setOpsForm((prev) => ({ ...prev, keyCollection: { ...prev.keyCollection, mailboxPassword: v === true } }))} />Mailbox password</label>
                  {opsForm.keyCollection.mailboxPassword && <Input value={opsForm.mailboxPassword} onChange={(e) => setOpsForm((prev) => ({ ...prev, mailboxPassword: e.target.value }))} placeholder="Mailbox password" className="mt-1" />}
                  <label className="flex items-center gap-2 text-xs"><Checkbox checked={opsForm.keyCollection.smartdoorPassword} onCheckedChange={(v) => setOpsForm((prev) => ({ ...prev, keyCollection: { ...prev.keyCollection, smartdoorPassword: v === true } }))} />Smartdoor (password)</label>
                  {opsForm.keyCollection.smartdoorPassword && <Input value={opsForm.smartdoorPassword} onChange={(e) => setOpsForm((prev) => ({ ...prev, smartdoorPassword: e.target.value }))} placeholder="Smartdoor password" className="mt-1" />}
                  <label className="flex items-center gap-2 text-xs"><Checkbox checked={opsForm.keyCollection.smartdoorToken} onCheckedChange={(v) => setOpsForm((prev) => ({ ...prev, keyCollection: { ...prev.keyCollection, smartdoorToken: v === true } }))} />Smartdoor (token)</label>
                </div>
              </div>
              <div>
                <Label className="text-xs">Security system</Label>
                <div className="flex flex-col sm:flex-row gap-2 mt-1 sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium text-foreground capitalize">{parseSecuritySystemFromDb(opsForm.securitySystem)}</p>
                    {securitySystemSummaryText ? (
                      <p className="text-xs text-muted-foreground break-words">{securitySystemSummaryText}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not configured. Use Edit to choose the system and enter login details (saved in MySQL when you create the property).</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 w-full sm:w-auto"
                    onClick={() => openSecurityCredentialsModal(true)}
                  >
                    Edit
                  </Button>
                </div>
              </div>
              {opsForm.propertyType === "other" && (
                <div className="border rounded-md border-border bg-background p-3 space-y-3">
                  <p className="text-xs font-medium">Bed counts (other / homestay-style)</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Single</Label>
                      <Input type="number" min={0} value={opsForm.bedSection.single} onChange={(e) => setBedQty("single", Number(e.target.value || 0))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Super Single</Label>
                      <Input type="number" min={0} value={opsForm.bedSection.supersingle} onChange={(e) => setBedQty("supersingle", Number(e.target.value || 0))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Queen</Label>
                      <Input type="number" min={0} value={opsForm.bedSection.queen} onChange={(e) => setBedQty("queen", Number(e.target.value || 0))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">King</Label>
                      <Input type="number" min={0} value={opsForm.bedSection.king} onChange={(e) => setBedQty("king", Number(e.target.value || 0))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Super King</Label>
                      <Input type="number" min={0} value={opsForm.bedSection.superking} onChange={(e) => setBedQty("superking", Number(e.target.value || 0))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Total bed</Label>
                      <Input value={String(opsForm.totalBed)} readOnly className="mt-1" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Number of room</Label>
                      <Input type="number" min={0} value={opsForm.numberOfRoom} onChange={(e) => setOpsForm((prev) => ({ ...prev, numberOfRoom: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Number of bathroom</Label>
                      <Input type="number" min={0} value={opsForm.numberOfBathroom} onChange={(e) => setOpsForm((prev) => ({ ...prev, numberOfBathroom: e.target.value }))} className="mt-1" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Owner settlement</p>
              <div>
                <Label className="text-xs">Model</Label>
                <Select value={addSettlementModel} onValueChange={(v) => setAddSettlementModel(v as "management_percent_gross" | "management_percent_net" | "management_percent_rental_income_only" | "management_fees_fixed" | "rental_unit" | "guarantee_return_fixed_plus_share")}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="management_percent_gross">Management Fees % of Gross income</SelectItem>
                    <SelectItem value="management_percent_net">Management Fees % of Net income</SelectItem>
                    <SelectItem value="management_percent_rental_income_only">Management Fees % of Rental Income Only</SelectItem>
                    <SelectItem value="management_fees_fixed">Management Fees on fixed amount</SelectItem>
                    <SelectItem value="rental_unit">Rental unit</SelectItem>
                    <SelectItem value="guarantee_return_fixed_plus_share">Guarantee return (fixed amount)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {addSettlementModel === "guarantee_return_fixed_plus_share" ? (
                <>
                  <div>
                    <Label className="text-xs">Guaranteed rental amount (to owner) *</Label>
                    <Input
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={addFixedManagementFee}
                      onChange={(e) => setAddFixedManagementFee(e.target.value)}
                      placeholder="e.g. 2000"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Owner share of remaining (%) *</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={addManagementPercent}
                      onChange={(e) => setAddManagementPercent(e.target.value)}
                      placeholder="e.g. 50"
                      className="mt-1"
                    />
                  </div>
                </>
              ) : (addSettlementModel === "management_fees_fixed" || addSettlementModel === "rental_unit") ? (
                <div>
                  <Label className="text-xs">Management Fees (fixed amount) *</Label>
                  <Input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={addFixedManagementFee}
                    onChange={(e) => setAddFixedManagementFee(e.target.value)}
                    placeholder="e.g. 2000"
                    className="mt-1"
                  />
                </div>
              ) : (
                <div>
                  <Label className="text-xs">Management Fees (%) *</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={addManagementPercent}
                    onChange={(e) => setAddManagementPercent(e.target.value)}
                    placeholder="e.g. 10"
                    className="mt-1"
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button
              style={{ background: "var(--brand)" }}
              onClick={() => void requestAdd()}
              disabled={
                saving ||
                mapPreflightBusy ||
                !editForm.apartmentName?.trim() ||
                !editForm.unitNumber?.trim() ||
                (addSettlementModel === "guarantee_return_fixed_plus_share" && (
                  addManagementPercent.trim() === "" ||
                  !Number.isFinite(Number(addManagementPercent)) ||
                  Number(addManagementPercent) < 0 ||
                  !addFixedManagementFee.trim() ||
                  Number(addFixedManagementFee) <= 0
                )) ||
                (addSettlementModel !== "management_fees_fixed" &&
                  addSettlementModel !== "rental_unit" &&
                  addSettlementModel !== "guarantee_return_fixed_plus_share" &&
                  (addManagementPercent.trim() === "" ||
                    !Number.isFinite(Number(addManagementPercent)) ||
                    Number(addManagementPercent) < 0)) ||
                ((addSettlementModel === "management_fees_fixed" || addSettlementModel === "rental_unit") && (!addFixedManagementFee.trim() || Number(addFixedManagementFee) <= 0))
              }
            >
              {saving ? "Adding..." : mapPreflightBusy ? "Preparing map…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mapConfirmOpen}
        onOpenChange={(o) => {
          if (!o) {
            mapConfirmOpenRef.current = false
            setMapConfirmOpen(false)
            setPendingSaveMode(null)
            pendingEditPropertyIdRef.current = null
            pendingEditFormSnapshotRef.current = null
          }
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Confirm property location</DialogTitle>
            <DialogDescription>
              Drag the pin or click the map to set WGS84 coordinates (same flow as Cleanlemons). The map starts at your saved position, or from the address suggestion, or Johor Bahru as a fallback.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div
              ref={mapConfirmContainerRef}
              className="h-[min(55vh,420px)] w-full rounded-md border border-border overflow-hidden bg-muted z-0"
            />
            <p className="text-xs text-muted-foreground">
              OpenStreetMap tiles. Confirm when the pin matches the property entrance or building.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                mapConfirmOpenRef.current = false
                setMapConfirmOpen(false)
                setPendingSaveMode(null)
                pendingEditPropertyIdRef.current = null
                pendingEditFormSnapshotRef.current = null
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              style={{ background: "var(--brand)" }}
              onClick={confirmMapLocationAndSave}
              disabled={!mapDialogReady}
            >
              Confirm &amp; save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showOwnerProfileDialog} onOpenChange={setShowOwnerProfileDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[70vw]">
          <DialogHeader><DialogTitle>Owner Profile</DialogTitle></DialogHeader>
          {ownerProfileLoading ? (
            <div className="py-8 text-sm text-muted-foreground">Loading owner profile...</div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Owner Name</Label>
                  <Input className="mt-1" value={ownerProfile?.ownerName || "-"} readOnly />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input className="mt-1" value={ownerProfile?.email || "-"} readOnly />
                </div>
                <div>
                  <Label className="text-xs">Bank Name</Label>
                  <Input className="mt-1" value={ownerProfile?.bankName || "-"} readOnly />
                </div>
                <div>
                  <Label className="text-xs">Bank Holder</Label>
                  <Input className="mt-1" value={ownerProfile?.bankHolder || "-"} readOnly />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">Bank Account</Label>
                  <Input className="mt-1" value={ownerProfile?.bankAccount || "-"} readOnly />
                </div>
              </div>
              <div>
                <Label className="text-xs">Accounting Contact IDs</Label>
                <div className="mt-2 border rounded-md p-3 text-sm">
                  {ownerProfile?.account?.length ? (
                    ownerProfile.account.map((item, idx) => (
                      <div key={`${item.provider || "provider"}-${idx}`} className="mb-1 last:mb-0">
                        {(item.provider || "provider").toUpperCase()} - {item.id || "-"}
                      </div>
                    ))
                  ) : (
                    <span className="text-muted-foreground">No account mapping found.</span>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOwnerProfileDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!utilityProp} onOpenChange={(o) => !o && setUtilityProp(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit utility – {utilityProp?.shortname || utilityProp?.id}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Suppliers are managed in Contact setting. Add more utility types (e.g. cukai harta, indah water) below for bank transfer / JomPay.</p>
          <div className="grid gap-3 py-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="text-xs">Electric ID</Label>
                <Input value={editUtilityForm.electricId} onChange={(e) => setEditUtilityForm((f) => ({ ...f, electricId: e.target.value }))} className="mt-1" placeholder="Account no." />
              </div>
              <div className="flex-1 min-w-[140px]">
                <Label className="text-xs">Choose supplier</Label>
                <Select value={editUtilityForm.electricSupplierId || "__none__"} onValueChange={(v) => setEditUtilityForm((f) => ({ ...f, electricSupplierId: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Supplier" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none__">—</SelectItem>{suppliersOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="text-xs">Water ID</Label>
                <Input value={editUtilityForm.waterId} onChange={(e) => setEditUtilityForm((f) => ({ ...f, waterId: e.target.value }))} className="mt-1" placeholder="Account no." />
              </div>
              <div className="flex-1 min-w-[140px]">
                <Label className="text-xs">Choose supplier</Label>
                <Select value={editUtilityForm.waterSupplierId || "__none__"} onValueChange={(v) => setEditUtilityForm((f) => ({ ...f, waterSupplierId: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Supplier" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none__">—</SelectItem>{suppliersOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="text-xs">Wifi id</Label>
                <Input value={editUtilityForm.internetId} onChange={(e) => setEditUtilityForm((f) => ({ ...f, internetId: e.target.value }))} className="mt-1" placeholder="ID" />
              </div>
              <div className="flex-1 min-w-[140px]">
                <Label className="text-xs">Choose supplier</Label>
                <Select value={editUtilityForm.internetSupplierId || "__none__"} onValueChange={(v) => setEditUtilityForm((f) => ({ ...f, internetSupplierId: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Supplier" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none__">—</SelectItem>{suppliersOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">WiFi username</Label>
              <Input value={editUtilityForm.wifiUsername} onChange={(e) => setEditUtilityForm((f) => ({ ...f, wifiUsername: e.target.value }))} className="mt-1" placeholder="Network name / SSID" />
            </div>
            <div>
              <Label className="text-xs">WiFi password</Label>
              <Input type="password" value={editUtilityForm.wifiPassword} onChange={(e) => setEditUtilityForm((f) => ({ ...f, wifiPassword: e.target.value }))} className="mt-1" placeholder="Password (tenant portal visible)" />
            </div>
            <div>
              <Label className="text-xs">Management</Label>
              <Select value={editUtilityForm.managementSupplierId || "__none__"} onValueChange={(v) => setEditUtilityForm((f) => ({ ...f, managementSupplierId: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">—</SelectItem>{suppliersOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="border-t pt-3 mt-1">
              <Label className="text-xs font-medium">More utilities (cukai harta, cukai tanah, indah water, etc.)</Label>
              {utilityExtraRows.map((row, index) => (
                <div key={index} className="flex gap-2 items-end mt-2">
                  <div className="flex-1 min-w-[120px]">
                    <Select value={row.supplier_id || "__none__"} onValueChange={(v) => setUtilityExtraRows((prev) => { const n = [...prev]; n[index] = { ...n[index], supplier_id: v === "__none__" ? "" : v }; return n })}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Supplier" /></SelectTrigger>
                      <SelectContent><SelectItem value="__none__">—</SelectItem>{suppliersOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Input value={row.value} onChange={(e) => setUtilityExtraRows((prev) => { const n = [...prev]; n[index] = { ...n[index], value: e.target.value }; return n })} placeholder="ID / Account no." className="flex-1" />
                  <Button type="button" variant="ghost" size="icon" className="shrink-0 text-destructive hover:text-destructive" onClick={() => setUtilityExtraRows((prev) => prev.filter((_, i) => i !== index))} title="Remove"><Trash2 size={16} /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setUtilityExtraRows((prev) => [...prev, { supplier_id: "", value: "" }])}>
                <Plus size={14} className="mr-1" /> Add
              </Button>
            </div>
            <div className="space-y-3 border-t pt-3">
              <div>
                <Label className="text-xs">Remark</Label>
                <Input value={editUtilityForm.remark} onChange={(e) => setEditUtilityForm((f) => ({ ...f, remark: e.target.value }))} className="mt-1" placeholder="Remark" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Meter</Label>
              <Select value={editUtilityForm.meter || "__none__"} onValueChange={(v) => setEditUtilityForm((f) => ({ ...f, meter: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select meter" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">—</SelectItem>{meterOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Smart door</Label>
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
                      Same rule as meter: one lock can only be bound to either this property or one room—not both. Locks already on any room are not listed.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select value={editUtilityForm.smartdoor || "__none__"} onValueChange={(v) => setEditUtilityForm((f) => ({ ...f, smartdoor: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select smart door" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">—</SelectItem>{smartdoorOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              {utilityProp && smartdoorOptions.length === 0 && (
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">No locks listed for this property</span>
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
            {cleanlemonsLinked && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-semibold">Cleanlemons — General cleaning</p>
                    <p className="text-xs text-muted-foreground">
                      Default pricing (from Cleanlemons):{" "}
                      {cleaningPricing?.showRefGeneralCleaning && cleaningPricing.refGeneralCleaning != null ? (
                        <span className="font-medium text-foreground">RM {Number(cleaningPricing.refGeneralCleaning).toFixed(2)}</span>
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
                        aria-label="About general cleaning pricing"
                      >
                        <Info size={16} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-left">
                      <p>
                        Reference cost from Cleanlemons; tenant portal only sees &quot;Tenant price&quot; below. Times for scheduling: Malaysia UTC+8.
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
                    value={editUtilityForm.tenantCleaningPrice}
                    onChange={(e) => setEditUtilityForm((f) => ({ ...f, tenantCleaningPrice: e.target.value }))}
                    className="mt-1"
                    placeholder="e.g. 80"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUtilityProp(null)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSaveUtility} disabled={savingUtility}>{savingUtility ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!scheduleProperty} onOpenChange={(o) => !o && setScheduleProperty(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Schedule cleaning — {scheduleProperty?.shortname || scheduleProperty?.id}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">General cleaning · Malaysia time (UTC+8)</p>
          {scheduleProperty?.id && propertyCleaningScheduleInfo[scheduleProperty.id]?.refGeneralCleaning != null && (
            <p className="text-sm font-medium text-foreground">
              Reference (operator): RM{" "}
              {Number(propertyCleaningScheduleInfo[scheduleProperty.id].refGeneralCleaning).toFixed(2)}
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
            <Button variant="outline" onClick={() => setScheduleProperty(null)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={submitScheduleCleaningProperty} disabled={schedulingJob || !scheduleDate}>
              {schedulingJob ? "Scheduling..." : "Create job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!parkingLotProp} onOpenChange={(o) => !o && setParkingLotProp(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Parking lots – {parkingLotProp?.shortname || parkingLotProp?.id}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">One property can have multiple parking lots. Add or remove rows below.</p>
          <div className="space-y-2 py-2">
            {parkingLotItems.map((value, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input
                  value={value}
                  onChange={(e) => setParkingLotItems((prev) => {
                    const next = [...prev]
                    next[index] = e.target.value
                    return next
                  })}
                  placeholder="Parking lot name / number"
                  className="flex-1"
                />
                <Button type="button" variant="ghost" size="icon" className="shrink-0 text-destructive hover:text-destructive" onClick={() => setParkingLotItems((prev) => prev.filter((_, i) => i !== index))} title="Remove">
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setParkingLotItems((prev) => [...prev, ""])}>
              <Plus size={14} className="mr-1" /> Add row
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParkingLotProp(null)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSaveParkingLots} disabled={savingParkingLot}>{savingParkingLot ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddBuildingDialog} onOpenChange={setShowAddBuildingDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{addPremisesBuildingDialogTitle(opsForm.propertyType)}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">{premisesBuildingNameLabel(opsForm.propertyType)}</Label>
              <Input
                value={newBuildingName}
                onChange={(e) => setNewBuildingName(e.target.value)}
                placeholder={opsForm.propertyType === "apartment" ? "e.g. Paragon Suite" : "e.g. Taman Molek"}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Country</Label>
              <Input value={operatorCountry} className="mt-1 bg-muted" disabled />
              <p className="text-xs text-muted-foreground mt-1">Country follows your operator company and cannot be changed here.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddBuildingDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={() => {
              const name = newBuildingName.trim()
              if (name) {
                const selectedCountry = operatorCountry
                setEditForm((f) => ({ ...f, apartmentName: name, country: selectedCountry }))
                setBuildingOptions((prev) => {
                  const nameLo = name.toLowerCase()
                  if (prev.some((b) => String(b.apartmentName || "").trim().toLowerCase() === nameLo && b.country === selectedCountry)) return prev
                  return [...prev, { apartmentName: name, country: selectedCountry }].sort((a, b) =>
                    (a.apartmentName || "").localeCompare(b.apartmentName || "") || (a.country || "MY").localeCompare(b.country || "MY")
                  )
                })
                setShowAddBuildingDialog(false)
                setNewBuildingName("")
              }
            }} disabled={!newBuildingName.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
