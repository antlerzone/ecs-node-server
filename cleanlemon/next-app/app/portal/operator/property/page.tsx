"use client"

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Match client portal / Coliving security systems (icare … css). */
const SECURITY_SYSTEM_IDS = ['icare', 'ecommunity', 'veemios', 'gprop', 'css'] as const
type SecuritySystemIdOption = (typeof SECURITY_SYSTEM_IDS)[number]

function parseSecuritySystemFromDb(raw: string | undefined | null): SecuritySystemIdOption {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
  return (SECURITY_SYSTEM_IDS as readonly string[]).includes(s) ? (s as SecuritySystemIdOption) : 'icare'
}

function isCompleteSecurityCredentials(
  system: SecuritySystemIdOption,
  cred: Record<string, unknown> | null | undefined
): boolean {
  if (!cred || typeof cred !== 'object') return false
  switch (system) {
    case 'icare':
      return !!(
        String(cred.phoneNumber || '').trim() &&
        String(cred.dateOfBirth || '').trim() &&
        String(cred.password || '')
      )
    case 'ecommunity':
      return !!(
        String(cred.username || (cred as { user?: string }).user || '').trim() &&
        String(cred.password || '')
      )
    case 'veemios':
    case 'gprop':
      return !!(
        String(cred.userId || (cred as { user_id?: string }).user_id || '').trim() &&
        String(cred.password || '')
      )
    case 'css':
      return !!(
        String(cred.loginCode || (cred as { login_code?: string }).login_code || '').trim() &&
        String(cred.password || '')
      )
    default:
      return false
  }
}

function formatSecuritySystemSummary(
  system: SecuritySystemIdOption,
  cred: Record<string, unknown> | null
): string | null {
  if (!cred || !isCompleteSecurityCredentials(system, cred)) return null
  const pwPlain = String(cred.password || '').trim()
  switch (system) {
    case 'icare':
      return `Phone: ${String(cred.phoneNumber)} · DOB: ${String(cred.dateOfBirth)} · Password: ${pwPlain}`
    case 'ecommunity':
      return `User: ${String(cred.username || (cred as { user?: string }).user || '')} · Password: ${pwPlain}`
    case 'veemios':
    case 'gprop':
      return `User ID: ${String(cred.userId || (cred as { user_id?: string }).user_id || '')} · Password: ${pwPlain}`
    case 'css':
      return `Login code: ${String(cred.loginCode || (cred as { login_code?: string }).login_code || '')} · Password: ${pwPlain}`
    default:
      return null
  }
}
import 'leaflet/dist/leaflet.css'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, Column, Action } from '@/components/shared/data-table'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { 
  Plus, 
  Building2, 
  MapPin, 
  Home, 
  Building, 
  Warehouse,
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
  Archive,
  RotateCcw,
  Map,
  List,
  Search,
  ListFilter,
  Link2,
  Unlink,
  ChevronDown,
  ChevronsUpDown,
  Loader2,
  UserMinus,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchOperatorProperties,
  fetchOperatorDistinctPropertyNames,
  fetchGlobalPropertyNames,
  fetchPropertyNameDefaults,
  fetchAddressSearch,
  createOperatorProperty,
  updateOperatorProperty,
  deleteOperatorProperty,
  fetchOperatorLinkedClientdetails,
  fetchOperatorPropertyDetail,
  clnUnlockSmartDoor,
} from '@/lib/cleanlemon-api'
import { useAuth } from '@/lib/auth-context'
import { CleanlemonDoorOpenDialog } from '@/components/cleanlemons/cleanlemon-door-open-dialog'

interface Property {
  id: string
  name: string
  address: string
  unitNumber: string
  /** Mirrors `premises_type` for list UI (office / commercial / apartment / landed / other). */
  type: 'office' | 'commercial' | 'apartment' | 'landed' | 'other'
  client: string
  /** `cln_clientdetail.id` when bound */
  clientdetailId?: string
  /** 1 in DB = created from client portal; operator cannot change binding */
  clientPortalOwned?: boolean
  /** Operator portal archive (operator-created rows only; persisted when DB column exists). */
  operatorPortalArchived?: boolean
  /** `cln_property.operator_id` when linked (used to unlink client-owned rows from operator list). */
  linkedOperatorId?: string
  /** `cln_property.premises_type` */
  premisesType?: string
  status: 'active' | 'inactive'
  lat: number
  lng: number
  /** Computed from map pin (lat/lng). */
  googleMapUrl?: string
  /** Saved Google Maps share / short link. */
  googleMapsUrl?: string
  wazeUrl?: string
  securitySystem: SecuritySystemIdOption
  securityUsername?: string
  cleaningTypes: string[]
  keyCollection: {
    mailboxPassword: string
    smartdoorPassword: string
    smartdoorToken: string
  }
  remark?: string
  estimatedTime?: string
  cleaningPriceSummary: string
  afterCleanPhotoSample?: string
  keyPhoto?: string
  checklist: ChecklistItem[]
  lastCleaned?: string
}

interface ChecklistItem {
  id: string
  title: string
  remark: string
  photo?: string
}

type SiteKind = 'landed' | 'apartment' | 'office' | 'commercial' | 'other'

const SITE_KIND_OPTIONS: { value: SiteKind; label: string }[] = [
  { value: 'landed', label: 'Landed' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'office', label: 'Office' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'other', label: 'Other' },
]

function inferSiteKind(property: Property, apartmentNames: string[]): SiteKind {
  const n = String(property.name || '').trim()
  if (n && apartmentNames.some((x) => String(x).trim() === n)) return 'apartment'
  if (property.type === 'office') return 'office'
  if (property.type === 'commercial') return 'commercial'
  if (property.type === 'apartment') return 'apartment'
  if (property.type === 'landed') return 'landed'
  if (property.type === 'other') return 'other'
  return 'other'
}

/** List `type` matches Premises type (persisted as `premises_type`). */
function siteKindToPropertyType(siteKind: SiteKind): Property['type'] {
  if (siteKind === 'office') return 'office'
  if (siteKind === 'commercial') return 'commercial'
  if (siteKind === 'apartment') return 'apartment'
  if (siteKind === 'landed') return 'landed'
  if (siteKind === 'other') return 'other'
  return 'other'
}

function premisesTypeToSiteKind(pt: string): SiteKind {
  const s = String(pt || '').trim().toLowerCase()
  if (s === 'landed' || s === 'apartment' || s === 'office' || s === 'commercial' || s === 'other') return s
  return 'other'
}

function apartmentNamesStorageKey(operatorId: string) {
  return `cleanlemon-apartment-names:${operatorId}`
}

interface PropertyFormState {
  name: string
  siteKind: SiteKind
  bindingClient: string
  bindingClientId: string
  propertyAddress: string
  wazeUrl: string
  googleMapsUrl: string
  unitNumber: string
  remark: string
  keyCollection: {
    mailboxPassword: boolean
    smartdoorPassword: boolean
    smartdoorToken: boolean
  }
  mailboxPasswordValue: string
  smartdoorPasswordValue: string
  securitySystem: SecuritySystemIdOption
  securityUsername: string
  afterCleanPhotoSample?: string
  cleaningPriceByType: Record<string, { defaultPrice: string; adjustAmount: string }>
  estimatedTime: string
  keyPhoto?: string
  latitude: string
  longitude: string
  checklist: ChecklistItem[]
}

/** Single row in Cleaning Price Summary (no per–cleaning-type picker on this form). */
const PRICE_SUMMARY_LABEL = 'Cleaning'

/** Smartdoor (Token) is checkbox-only (no text field); non-empty marks enabled in `Property.keyCollection`. */
const SMARTDOOR_TOKEN_ENABLED_MARKER = '1'

/** Old hard-coded map placeholder (Kuala Lumpur). Replaced for display logic so we can detect bad seed data. */
const LEGACY_KL_PLACEHOLDER_LAT = 3.139
const LEGACY_KL_PLACEHOLDER_LNG = 101.6869

/** Default pin when no coordinates — Johor Bahru (Cleanlemons ops area), not Kuala Lumpur. */
const DEFAULT_PROPERTY_MAP_LAT = 1.492659
const DEFAULT_PROPERTY_MAP_LNG = 103.741359

/** Parse lat/lng from Waze `ll=` or Google Maps `@lat,lng` in stored URLs. */
function parseLatLngFromNavigationUrls(wazeUrl: string, googleMapsUrl: string): { lat: number; lng: number } | null {
  const s = `${wazeUrl || ''} ${googleMapsUrl || ''}`
  const ll = s.match(/[?&]ll=([\d.+-]+)(?:%2C|,)([\d.+-]+)/i)
  if (ll) {
    const lat = parseFloat(ll[1])
    const lng = parseFloat(ll[2])
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng }
    }
  }
  const at = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)(?:[,z]|\?|\/|$)/)
  if (at) {
    const lat = parseFloat(at[1])
    const lng = parseFloat(at[2])
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng }
    }
  }
  return null
}

/** Strip http(s) URLs for shorter `q=` — matches server `clnPlainAddressForNavigationQuery`. */
function plainAddressForNavigationQuery(address: string): string {
  const s = String(address ?? '').trim()
  if (!s) return ''
  const stripped = s.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim()
  return stripped || s
}

function navigationUrlsFromPlainAddress(address: string): { wazeUrl: string; googleMapsUrl: string } | null {
  const q = plainAddressForNavigationQuery(address)
  if (!q) return null
  const enc = encodeURIComponent(q)
  return {
    wazeUrl: `https://www.waze.com/ul?q=${enc}`,
    googleMapsUrl: `https://www.google.com/maps?q=${enc}`,
  }
}

/**
 * When address text changes, fill Waze + Google Maps search URLs unless the user had customized them
 * (same idea as `resolveClnPropertyNavigationUrls` on the API).
 */
function mergeNavUrlsForAddressChange(
  prevForm: PropertyFormState,
  newAddressRaw: string,
  previousAddressSnapshot: string
): Pick<PropertyFormState, 'wazeUrl' | 'googleMapsUrl'> {
  const prevNav = navigationUrlsFromPlainAddress(previousAddressSnapshot)
  const nextNav = navigationUrlsFromPlainAddress(newAddressRaw.trim())
  const w = prevForm.wazeUrl.trim()
  const g = prevForm.googleMapsUrl.trim()
  const wWasAuto = w === '' || (prevNav != null && w === prevNav.wazeUrl)
  const gWasAuto = g === '' || (prevNav != null && g === prevNav.googleMapsUrl)
  if (!nextNav) {
    return {
      wazeUrl: wWasAuto ? '' : prevForm.wazeUrl,
      googleMapsUrl: gWasAuto ? '' : prevForm.googleMapsUrl,
    }
  }
  return {
    wazeUrl: wWasAuto ? nextNav.wazeUrl : prevForm.wazeUrl,
    googleMapsUrl: gWasAuto ? nextNav.googleMapsUrl : prevForm.googleMapsUrl,
  }
}

function isLegacyKualaLumpurPlaceholder(latStr: string, lngStr: string): boolean {
  const lat = Number(latStr)
  const lng = Number(lngStr)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  return (
    Math.abs(lat - LEGACY_KL_PLACEHOLDER_LAT) < 0.02 && Math.abs(lng - LEGACY_KL_PLACEHOLDER_LNG) < 0.02
  )
}

const typeIcons = {
  office: Building,
  commercial: Warehouse,
  apartment: Building2,
  landed: Home,
  other: MoreHorizontal,
}

const typeColors = {
  office: 'bg-purple-100 text-purple-800',
  commercial: 'bg-amber-100 text-amber-800',
  apartment: 'bg-blue-100 text-blue-800',
  landed: 'bg-green-100 text-green-800',
  other: 'bg-slate-100 text-slate-800',
}

const PROPERTY_LIST_PAGE_SIZES = [10, 20, 50, 100, 200] as const

function mapApiRowToProperty(row: Record<string, unknown>): Property {
  const securitySystem = parseSecuritySystemFromDb(String(row.securitySystem ?? ''))
  const tokenOn = Number(row.smartdoorTokenEnabled) === 1
  const pt = String(row.premisesType || '').trim().toLowerCase()
  const tableType: Property['type'] =
    pt === 'office'
      ? 'office'
      : pt === 'commercial'
        ? 'commercial'
        : pt === 'apartment'
          ? 'apartment'
          : pt === 'landed'
            ? 'landed'
            : pt === 'other'
              ? 'other'
              : 'other'
  return {
    id: String(row.id),
    name: String(row.name || 'Property'),
    address: String(row.address || ''),
    unitNumber: String(row.unitNumber || ''),
    type: tableType,
    client: String(row.client || ''),
    clientdetailId: String(row.clientdetailId || '').trim(),
    clientPortalOwned: Number(row.clientPortalOwned) === 1,
    linkedOperatorId: String(row.operatorId ?? row.operator_id ?? '').trim(),
    premisesType: String(row.premisesType || '').trim(),
    operatorPortalArchived: Number(row.operatorPortalArchived) === 1,
    status: (Number(row.operatorPortalArchived) === 1 ? 'inactive' : 'active') as Property['status'],
    ...(() => {
      const dbLat = row.latitude != null ? Number(row.latitude) : NaN
      const dbLng = row.longitude != null ? Number(row.longitude) : NaN
      if (Number.isFinite(dbLat) && Number.isFinite(dbLng)) {
        return { lat: dbLat, lng: dbLng }
      }
      const wz = String(row.wazeUrl ?? (row as { waze_url?: unknown }).waze_url ?? '').trim()
      const gz = String(row.googleMapsUrl ?? (row as { google_maps_url?: unknown }).google_maps_url ?? '').trim()
      const parsed = parseLatLngFromNavigationUrls(wz, gz)
      return {
        lat: parsed?.lat ?? DEFAULT_PROPERTY_MAP_LAT,
        lng: parsed?.lng ?? DEFAULT_PROPERTY_MAP_LNG,
      }
    })(),
    securitySystem,
    securityUsername: String(row.securityUsername || '').trim(),
    cleaningTypes: [] as string[],
    keyCollection: {
      mailboxPassword: String(row.mailboxPassword || ''),
      smartdoorPassword: String(row.smartdoorPassword || ''),
      smartdoorToken: tokenOn ? SMARTDOOR_TOKEN_ENABLED_MARKER : '',
    },
    cleaningPriceSummary: '',
    checklist: [],
    afterCleanPhotoSample: String(row.afterCleanPhotoUrl || ''),
    keyPhoto: String(row.keyPhotoUrl || ''),
    lastCleaned: (row.updated_at || row.created_at) as string | undefined,
    googleMapsUrl: String(row.googleMapsUrl || '').trim(),
    wazeUrl: String(row.wazeUrl || '').trim(),
  }
}

function bulkUpdateBasePatch(p: Property): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    name: p.name,
    address: p.address,
    unitNumber: p.unitNumber,
    client: p.client,
    team: '',
    wazeUrl: p.wazeUrl ?? '',
    googleMapsUrl: p.googleMapsUrl ?? '',
  }
  if (p.premisesType) patch.premisesType = p.premisesType
  return patch
}

export default function PropertyPage() {
  const { user } = useAuth()
  const operatorId = user?.operatorId || 'op_demo_001'
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  /** List fetch + filter: active = non-archived only; all = include archived; archived = archived rows only (client-side). */
  const [propertyArchiveFilter, setPropertyArchiveFilter] = useState<'all' | 'active' | 'archived'>('active')
  /** Mobile list search (stacked rows — no horizontal table scroll). */
  const [mobileOperatorListSearch, setMobileOperatorListSearch] = useState('')
  const [operatorMobileListFiltersOpen, setOperatorMobileListFiltersOpen] = useState(false)
  /** Same keys as DataTable column filters: client, origin, type, status */
  const [operatorMobileColumnFilters, setOperatorMobileColumnFilters] = useState<Record<string, string>>({})
  const [properties, setProperties] = useState<Property[]>([])
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [isPriceSummaryOpen, setIsPriceSummaryOpen] = useState(false)
  const [isChecklistOpen, setIsChecklistOpen] = useState(false)
  const [isOwnerProfileOpen, setIsOwnerProfileOpen] = useState(false)
  const [isMapConfirmOpen, setIsMapConfirmOpen] = useState(false)
  const [pendingSubmitMode, setPendingSubmitMode] = useState<'add' | 'edit' | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const leafletMapRef = useRef<any>(null)
  const leafletLibRef = useRef<any>(null)
  const [bookingClients, setBookingClients] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [apartmentPropertyNames, setApartmentPropertyNames] = useState<string[]>([])
  /** Distinct `cln_property.property_name` from API (per operator). */
  const [dbDistinctPropertyNames, setDbDistinctPropertyNames] = useState<string[]>([])
  const [apartmentNamesStorageReady, setApartmentNamesStorageReady] = useState(false)
  const [isAddApartmentNameOpen, setIsAddApartmentNameOpen] = useState(false)
  const [apartmentNameDraft, setApartmentNameDraft] = useState('')
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<string>>(() => new Set())
  const [bulkBindOpen, setBulkBindOpen] = useState(false)
  const [bulkBindClientId, setBulkBindClientId] = useState('')
  const [bulkDisconnectOpen, setBulkDisconnectOpen] = useState(false)
  const [bulkRemoveOperatorOpen, setBulkRemoveOperatorOpen] = useState(false)
  const [bulkWorking, setBulkWorking] = useState(false)
  /** Two-step delete (archived operator rows only). */
  const [deletePropertyDialogOpen, setDeletePropertyDialogOpen] = useState(false)
  const [deletePropertyPhase, setDeletePropertyPhase] = useState<1 | 2>(1)
  const [pendingDeleteProperty, setPendingDeleteProperty] = useState<Property | null>(null)
  const [deletePropertyWorking, setDeletePropertyWorking] = useState(false)
  /** Client-created row: remove operator link from property. */
  const [removeFromListOpen, setRemoveFromListOpen] = useState(false)
  const [pendingRemoveFromList, setPendingRemoveFromList] = useState<Property | null>(null)
  const [removeFromListWorking, setRemoveFromListWorking] = useState(false)
  const [transferToClientOpen, setTransferToClientOpen] = useState(false)
  const [pendingTransferToClient, setPendingTransferToClient] = useState<Property | null>(null)
  const [transferToClientWorking, setTransferToClientWorking] = useState(false)
  const [doorOpenPayload, setDoorOpenPayload] = useState<{
    title: string
    smartdoorId: string
    mailboxPassword: string
    smartdoorPassword: string
    operatorDoorAccessMode: string
    smartdoorGatewayReady: boolean
    hasBookingToday: boolean
  } | null>(null)
  const [persistedSecurityCredentials, setPersistedSecurityCredentials] = useState<Record<
    string,
    unknown
  > | null>(null)
  const [operatorEditColivingPdId, setOperatorEditColivingPdId] = useState('')
  const [secCredModalOpen, setSecCredModalOpen] = useState(false)
  const [secCredModalSaving, setSecCredModalSaving] = useState(false)
  const [secCredModalSystem, setSecCredModalSystem] = useState<SecuritySystemIdOption>('icare')
  const [secCredPhone, setSecCredPhone] = useState('')
  const [secCredDob, setSecCredDob] = useState('')
  const [secCredUser, setSecCredUser] = useState('')
  const [secCredUserId, setSecCredUserId] = useState('')
  const [secCredLoginCode, setSecCredLoginCode] = useState('')
  const [secCredPassword, setSecCredPassword] = useState('')
  const [propertyListPageSize, setPropertyListPageSize] = useState(10)
  const [mobilePropertyListPage, setMobilePropertyListPage] = useState(1)
  /** Apartment building combobox: global name hints + local merge */
  const [buildingComboOpen, setBuildingComboOpen] = useState(false)
  const [buildingNameInput, setBuildingNameInput] = useState('')
  const [globalBuildingHints, setGlobalBuildingHints] = useState<string[]>([])
  /** Address OSM search */
  const [addressSuggestOpen, setAddressSuggestOpen] = useState(false)
  const [addressSearchItems, setAddressSearchItems] = useState<
    Array<{ displayName: string; lat: string; lon: string; placeId: string }>
  >([])
  const [addressSearchLoading, setAddressSearchLoading] = useState(false)
  const addressSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addressFieldWrapRef = useRef<HTMLDivElement | null>(null)
  /** When edit dialog opens: resolved clientdetail id (same as form). Save compares to this — address-only edits do not trigger defer binding. */
  const bindingClientIdBaselineRef = useRef<string>('')

  const [propertyForm, setPropertyForm] = useState<PropertyFormState>({
    name: '',
    siteKind: 'landed',
    bindingClient: '',
    bindingClientId: '',
    propertyAddress: '',
    wazeUrl: '',
    googleMapsUrl: '',
    unitNumber: '',
    remark: '',
    keyCollection: {
      mailboxPassword: false,
      smartdoorPassword: false,
      smartdoorToken: false,
    },
    mailboxPasswordValue: '',
    smartdoorPasswordValue: '',
    securitySystem: 'icare',
    securityUsername: '',
    cleaningPriceByType: {},
    estimatedTime: '',
    latitude: '',
    longitude: '',
    checklist: [],
  })

  const reloadProperties = useCallback(async () => {
    const includeArchived = propertyArchiveFilter !== 'active'
    const r = await fetchOperatorProperties(operatorId, { includeArchived })
    if (!r?.ok) return
    setProperties((r.items || []).map((row: Record<string, unknown>) => mapApiRowToProperty(row)))
  }, [operatorId, propertyArchiveFilter])

  useEffect(() => {
    void reloadProperties()
  }, [reloadProperties])

  useEffect(() => {
    const ids = new Set(properties.map((p) => p.id))
    setSelectedPropertyIds((prev) => new Set([...prev].filter((id) => ids.has(id))))
  }, [properties])

  const selectedRows = useMemo(
    () =>
      [...selectedPropertyIds]
        .map((id) => properties.find((p) => p.id === id))
        .filter((p): p is Property => !!p),
    [selectedPropertyIds, properties]
  )

  const visibleListProperties = useMemo(() => {
    if (propertyArchiveFilter === 'archived') {
      return properties.filter((p) => p.status === 'inactive')
    }
    return properties
  }, [properties, propertyArchiveFilter])

  /** Stage 1 — your properties only: clear B2B client binding / label (operator row stays). */
  const selectedBulkDisconnectClientCount = useMemo(
    () =>
      selectedRows.filter(
        (p) =>
          !p.clientPortalOwned &&
          (String(p.clientdetailId || '').trim() || String(p.client || '').trim())
      ).length,
    [selectedRows]
  )

  /** Stage 2 — remove this operator from the property (and delete the row if it had no B2B client). */
  const selectedBulkRemoveOperatorCount = useMemo(
    () => selectedRows.filter((p) => String(p.linkedOperatorId || '').trim() !== '').length,
    [selectedRows]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorDistinctPropertyNames(operatorId)
      if (cancelled || !r?.ok || !Array.isArray(r.items)) return
      setDbDistinctPropertyNames(r.items.map((x: unknown) => String(x).trim()).filter(Boolean))
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  useEffect(() => {
    if (!isAddDialogOpen) return
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorDistinctPropertyNames(operatorId)
      if (cancelled || !r?.ok || !Array.isArray(r.items)) return
      setDbDistinctPropertyNames(r.items.map((x: unknown) => String(x).trim()).filter(Boolean))
    })()
    return () => {
      cancelled = true
    }
  }, [isAddDialogOpen, operatorId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorLinkedClientdetails(operatorId)
      if (cancelled || !r?.ok) return
      const raw = Array.isArray(r.items) ? r.items : []
      setBookingClients(
        raw
          .map((x: { id?: string; name?: string; email?: string }) => ({
            id: String(x.id || '').trim(),
            name: String(x.name || x.email || x.id || '').trim(),
            email: String(x.email || '').trim(),
          }))
          .filter((c) => c.id)
      )
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(apartmentNamesStorageKey(operatorId))
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          setApartmentPropertyNames(
            [...new Set(parsed.map((x) => String(x).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
          )
        }
      }
    } catch {
      /* ignore */
    }
    setApartmentNamesStorageReady(true)
  }, [operatorId])

  useEffect(() => {
    if (!apartmentNamesStorageReady) return
    try {
      localStorage.setItem(apartmentNamesStorageKey(operatorId), JSON.stringify(apartmentPropertyNames))
    } catch {
      /* ignore */
    }
  }, [operatorId, apartmentPropertyNames, apartmentNamesStorageReady])

  const apartmentNameChoices = useMemo(() => {
    const s = new Set<string>()
    dbDistinctPropertyNames.forEach((n) => {
      const t = String(n).trim()
      if (t) s.add(t)
    })
    apartmentPropertyNames.forEach((n) => {
      const t = String(n).trim()
      if (t) s.add(t)
    })
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [dbDistinctPropertyNames, apartmentPropertyNames])

  const mergedBuildingNames = useMemo(() => {
    const s = new Set<string>()
    apartmentNameChoices.forEach((n) => {
      const t = String(n).trim()
      if (t) s.add(t)
    })
    globalBuildingHints.forEach((n) => {
      const t = String(n).trim()
      if (t) s.add(t)
    })
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [apartmentNameChoices, globalBuildingHints])

  const filteredBuildingNames = useMemo(() => {
    const q = buildingNameInput.trim().toLowerCase()
    if (!q) return mergedBuildingNames
    return mergedBuildingNames.filter((n) => n.toLowerCase().includes(q))
  }, [mergedBuildingNames, buildingNameInput])

  useEffect(() => {
    if (!buildingComboOpen) return
    setBuildingNameInput(propertyForm.name)
  }, [buildingComboOpen, propertyForm.name])

  useEffect(() => {
    if (propertyForm.siteKind !== 'apartment' || !buildingComboOpen) return
    const t = buildingNameInput.trim()
    let cancelled = false
    const id = window.setTimeout(() => {
      void (async () => {
        const r = await fetchGlobalPropertyNames({ q: t, limit: 80 })
        if (cancelled || !r?.ok || !Array.isArray(r.items)) return
        setGlobalBuildingHints(r.items.map((x: unknown) => String(x).trim()).filter(Boolean))
      })()
    }, 380)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [buildingNameInput, propertyForm.siteKind, buildingComboOpen])

  useEffect(() => {
    const el = addressFieldWrapRef.current
    if (!el) return
    const onDoc = (e: MouseEvent) => {
      if (!addressSuggestOpen) return
      const t = e.target
      if (t instanceof Node && !el.contains(t)) setAddressSuggestOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [addressSuggestOpen])

  useEffect(() => {
    if (!propertyForm.bindingClient || propertyForm.bindingClientId) return
    const m = bookingClients.find((c) => c.name === propertyForm.bindingClient)
    if (!m) return
    setPropertyForm((prev) => (prev.bindingClientId === m.id ? prev : { ...prev, bindingClientId: m.id }))
  }, [bookingClients, propertyForm.bindingClient, propertyForm.bindingClientId])

  const cleaningPriceSummaryText = useMemo(() => {
    const priceRow = propertyForm.cleaningPriceByType[PRICE_SUMMARY_LABEL] || { defaultPrice: '0', adjustAmount: '0' }
    return `${PRICE_SUMMARY_LABEL}: Default RM${priceRow.defaultPrice || '0'} + adjusted RM${priceRow.adjustAmount || '0'}`
  }, [propertyForm.cleaningPriceByType])

  const applyBuildingDefaults = useCallback(async (name: string) => {
    const n = String(name || '').trim()
    if (!n) return
    const r = await fetchPropertyNameDefaults(n)
    if (!r?.ok) {
      toast.error('Could not load saved hints for this building')
      return
    }
    /** Replace address + navigation fields from plurality defaults for this building name (server). */
    setPropertyForm((prev) => ({
      ...prev,
      name: n,
      propertyAddress: String(r.address ?? '').trim(),
      wazeUrl: String(r.wazeUrl ?? '').trim(),
      googleMapsUrl: String(r.googleMapsUrl ?? '').trim(),
    }))
  }, [])

  const scheduleAddressSearch = useCallback((raw: string, buildingNameForFallback?: string) => {
    if (addressSearchTimerRef.current) clearTimeout(addressSearchTimerRef.current)
    const q = raw.trim()
    if (q.length < 3) {
      setAddressSearchItems([])
      setAddressSearchLoading(false)
      return
    }
    setAddressSearchLoading(true)
    const propertyName = String(buildingNameForFallback ?? '').trim()
    addressSearchTimerRef.current = setTimeout(() => {
      void (async () => {
        const r = await fetchAddressSearch({
          q,
          limit: 8,
          propertyName: propertyName || undefined,
        })
        setAddressSearchLoading(false)
        if (!r?.ok || !Array.isArray(r.items)) {
          setAddressSearchItems([])
          return
        }
        setAddressSearchItems(r.items)
        if (r.items.length > 0) setAddressSuggestOpen(true)
      })()
    }, 450)
  }, [])

  const pickAddressSuggestion = useCallback(
    (item: { displayName: string; lat: string; lon: string }) => {
      setPropertyForm((prev) => {
        const nav = mergeNavUrlsForAddressChange(prev, item.displayName, prev.propertyAddress)
        return {
          ...prev,
          propertyAddress: item.displayName,
          ...nav,
          latitude: item.lat && String(item.lat).trim() ? String(item.lat) : prev.latitude,
          longitude: item.lon && String(item.lon).trim() ? String(item.lon) : prev.longitude,
        }
      })
      setAddressSuggestOpen(false)
      setAddressSearchItems([])
    },
    []
  )

  const resetForm = () => {
    bindingClientIdBaselineRef.current = ''
    setAddressSuggestOpen(false)
    setAddressSearchItems([])
    setAddressSearchLoading(false)
    setGlobalBuildingHints([])
    setBuildingNameInput('')
    setBuildingComboOpen(false)
    setPropertyForm({
      name: '',
      siteKind: 'landed',
      bindingClient: '',
      bindingClientId: '',
      propertyAddress: '',
      wazeUrl: '',
      googleMapsUrl: '',
      unitNumber: '',
      remark: '',
      keyCollection: {
        mailboxPassword: false,
        smartdoorPassword: false,
        smartdoorToken: false,
      },
      mailboxPasswordValue: '',
      smartdoorPasswordValue: '',
      securitySystem: 'icare',
      securityUsername: '',
      cleaningPriceByType: {},
      estimatedTime: '',
      latitude: '',
      longitude: '',
      checklist: [],
    })
  }

  const seedFormFromProperty = (property: Property) => {
    const siteKind = property.premisesType
      ? premisesTypeToSiteKind(property.premisesType)
      : inferSiteKind(property, apartmentNameChoices)
    const matchByDetailId = property.clientdetailId
      ? bookingClients.find((c) => c.id === property.clientdetailId)
      : undefined
    const clientLabel = String(property.client || '').trim().toLowerCase()
    const matchClient =
      matchByDetailId ||
      bookingClients.find(
        (c) =>
          String(c.name || '').trim().toLowerCase() === clientLabel ||
          String(c.email || '').trim().toLowerCase() === clientLabel
      )
    const dp = property.cleaningPriceSummary.match(/Default RM(\d+)/)?.[1] || '0'
    const ap = property.cleaningPriceSummary.match(/adjusted RM(\d+)/)?.[1] || '0'
    const resolvedBindingId = String(property.clientdetailId || matchClient?.id || '').trim()
    bindingClientIdBaselineRef.current = resolvedBindingId
    setPropertyForm({
      name: property.name,
      siteKind,
      bindingClient: matchByDetailId?.name || property.client,
      bindingClientId: resolvedBindingId,
      propertyAddress: property.address,
      wazeUrl: property.wazeUrl || '',
      googleMapsUrl: property.googleMapsUrl || '',
      unitNumber: property.unitNumber,
      remark: property.remark || '',
      keyCollection: {
        mailboxPassword: !!property.keyCollection.mailboxPassword,
        smartdoorPassword: !!property.keyCollection.smartdoorPassword,
        smartdoorToken: !!property.keyCollection.smartdoorToken,
      },
      mailboxPasswordValue: property.keyCollection.mailboxPassword,
      smartdoorPasswordValue: property.keyCollection.smartdoorPassword,
      securitySystem: parseSecuritySystemFromDb(String(property.securitySystem ?? '')),
      securityUsername: property.securityUsername || '',
      afterCleanPhotoSample: property.afterCleanPhotoSample,
      cleaningPriceByType: {
        [PRICE_SUMMARY_LABEL]: { defaultPrice: dp, adjustAmount: ap },
      },
      estimatedTime: property.estimatedTime || '',
      latitude: String(property.lat),
      longitude: String(property.lng),
      keyPhoto: property.keyPhoto,
      checklist: property.checklist,
    })
  }

  const getGoogleMapUrl = (lat: string, lng: string) => `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`
  const getGoogleMapEmbedUrl = (lat: string, lng: string) =>
    `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=15&output=embed`

  const resolveGoogleMapsLink = (p: Pick<Property, 'googleMapsUrl' | 'googleMapUrl' | 'lat' | 'lng'>) => {
    const stored = String(p.googleMapsUrl || '').trim()
    if (stored) return stored
    return p.googleMapUrl || getGoogleMapUrl(String(p.lat), String(p.lng))
  }

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>, field: 'afterCleanPhotoSample' | 'keyPhoto') => {
    const file = e.target.files?.[0]
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    setPropertyForm((prev) => ({ ...prev, [field]: previewUrl }))
  }

  const addChecklistItem = () => {
    setPropertyForm((prev) => ({
      ...prev,
      checklist: [...prev.checklist, { id: `check-${Date.now()}`, title: '', remark: '' }],
    }))
  }

  const selectedBookingClient = useMemo(
    () => bookingClients.find((c) => c.id === propertyForm.bindingClientId),
    [bookingClients, propertyForm.bindingClientId]
  )

  const bindingLocked = useMemo(() => {
    if (!editingPropertyId) return false
    const row = properties.find((p) => p.id === editingPropertyId)
    return !!row?.clientPortalOwned
  }, [editingPropertyId, properties])

  /** Client-registered unit: operator cannot edit identity / access (matches backend). */
  const canEditCorePropertyFields = !bindingLocked

  useEffect(() => {
    if (!isAddDialogOpen || !editingPropertyId) {
      setPersistedSecurityCredentials(null)
      setOperatorEditColivingPdId('')
      return
    }
    const row = properties.find((p) => p.id === editingPropertyId)
    if (row?.clientPortalOwned) {
      setPersistedSecurityCredentials(null)
      setOperatorEditColivingPdId('')
      return
    }
    let cancelled = false
    void (async () => {
      const r = await fetchOperatorPropertyDetail(editingPropertyId, operatorId)
      if (cancelled || !r?.ok || !r.property) return
      const c = r.property.securitySystemCredentials
      setPersistedSecurityCredentials(
        c && typeof c === 'object' ? { ...(c as Record<string, unknown>) } : null
      )
      setOperatorEditColivingPdId(String(r.property.colivingPropertydetailId || '').trim())
    })()
    return () => {
      cancelled = true
    }
  }, [isAddDialogOpen, editingPropertyId, operatorId, properties])

  const securitySystemSummaryText = useMemo(() => {
    const sys = parseSecuritySystemFromDb(propertyForm.securitySystem)
    return formatSecuritySystemSummary(sys, persistedSecurityCredentials)
  }, [propertyForm.securitySystem, persistedSecurityCredentials])

  const openSecurityCredentialsModal = useCallback(() => {
    if (!canEditCorePropertyFields) {
      toast.error('This unit was registered by the client. Only the client can change key collection and security.')
      return
    }
    const sys = parseSecuritySystemFromDb(propertyForm.securitySystem)
    setSecCredModalSystem(sys)
    const src = persistedSecurityCredentials
    setSecCredPhone(
      src && typeof src === 'object' ? String((src as { phoneNumber?: string }).phoneNumber || '') : ''
    )
    setSecCredDob(
      src && typeof src === 'object' ? String((src as { dateOfBirth?: string }).dateOfBirth || '') : ''
    )
    setSecCredUser(
      src && typeof src === 'object'
        ? String((src as { username?: string }).username || (src as { user?: string }).user || '')
        : ''
    )
    setSecCredUserId(
      src && typeof src === 'object'
        ? String((src as { userId?: string }).userId || (src as { user_id?: string }).user_id || '')
        : ''
    )
    setSecCredLoginCode(
      src && typeof src === 'object'
        ? String((src as { loginCode?: string }).loginCode || (src as { login_code?: string }).login_code || '')
        : ''
    )
    setSecCredPassword(
      src && typeof src === 'object' && String((src as { password?: string }).password || '').trim()
        ? String((src as { password?: string }).password)
        : ''
    )
    setSecCredModalOpen(true)
  }, [canEditCorePropertyFields, propertyForm.securitySystem, persistedSecurityCredentials])

  const handleSecurityCredentialsModalSave = useCallback(async () => {
    if (!editingPropertyId || !canEditCorePropertyFields) return
    const colivingPd = String(operatorEditColivingPdId || '').trim()
    if (!colivingPd) {
      toast.error(
        'Link this unit to a Coliving property first (Sync from Coliving). Security login details are stored on the Coliving property row.'
      )
      return
    }
    const sys = secCredModalSystem
    const prevObj = persistedSecurityCredentials
    const prevPw =
      prevObj && typeof prevObj === 'object' && String((prevObj as { password?: string }).password || '').trim()
        ? String((prevObj as { password?: string }).password)
        : ''
    const pw = secCredPassword.trim() !== '' ? secCredPassword.trim() : prevPw
    let body: Record<string, unknown> = {}
    if (sys === 'icare') {
      body = { phoneNumber: secCredPhone.trim(), dateOfBirth: secCredDob.trim(), password: pw }
    } else if (sys === 'ecommunity') {
      body = { username: secCredUser.trim(), password: pw }
    } else if (sys === 'veemios' || sys === 'gprop') {
      body = { userId: secCredUserId.trim(), password: pw }
    } else {
      body = { loginCode: secCredLoginCode.trim(), password: pw }
    }
    if (!isCompleteSecurityCredentials(sys, body)) {
      toast.error(
        'Fill every field for this security system. Leave password empty only when keeping the existing password.'
      )
      return
    }
    setSecCredModalSaving(true)
    try {
      const next = toPropertyPayload(editingPropertyId, 'active')
      const patch: Record<string, unknown> = {
        operatorId,
        name: next.name,
        address: next.address,
        unitNumber: next.unitNumber,
        client: next.client,
        team: '',
        premisesType: propertyForm.siteKind,
        securitySystem: sys,
        securityUsername: propertyForm.securityUsername.trim() || null,
        securitySystemCredentials: body,
        mailboxPassword: propertyForm.mailboxPasswordValue,
        smartdoorPassword: propertyForm.keyCollection.smartdoorPassword ? propertyForm.smartdoorPasswordValue : '',
        smartdoorTokenEnabled: propertyForm.keyCollection.smartdoorToken,
        afterCleanPhotoUrl: propertyForm.afterCleanPhotoSample,
        keyPhotoUrl: propertyForm.keyPhoto,
        wazeUrl: propertyForm.wazeUrl.trim(),
        googleMapsUrl: propertyForm.googleMapsUrl.trim(),
        latitude: (() => {
          const n = Number(propertyForm.latitude)
          return Number.isFinite(n) ? n : undefined
        })(),
        longitude: (() => {
          const n = Number(propertyForm.longitude)
          return Number.isFinite(n) ? n : undefined
        })(),
      }
      const baselineCd = bindingClientIdBaselineRef.current
      const nextCd = String(propertyForm.bindingClientId || '').trim()
      const bindChanged = nextCd !== baselineCd
      if (propertyForm.bindingClientId && bindChanged && !bindingLocked) {
        patch.clientdetailId = propertyForm.bindingClientId
        patch.deferClientBinding = true
      } else if (!propertyForm.bindingClientId && !bindingLocked && bindChanged) {
        patch.clearClientdetail = true
      }
      const r = await updateOperatorProperty(editingPropertyId, patch)
      if (!r?.ok) {
        toast.error(typeof r?.reason === 'string' ? r.reason : 'Save failed')
        return
      }
      toast.success('Security system login details were saved.')
      setPropertyForm((f) => ({ ...f, securitySystem: sys }))
      setPersistedSecurityCredentials({ ...body })
      setSecCredModalOpen(false)
      await reloadProperties()
    } catch {
      toast.error('Save failed')
    } finally {
      setSecCredModalSaving(false)
    }
  }, [
    editingPropertyId,
    canEditCorePropertyFields,
    operatorEditColivingPdId,
    secCredModalSystem,
    secCredPhone,
    secCredDob,
    secCredUser,
    secCredUserId,
    secCredLoginCode,
    secCredPassword,
    persistedSecurityCredentials,
    propertyForm.securityUsername,
    propertyForm,
    bindingLocked,
    reloadProperties,
  ])

  const commitNewApartmentName = () => {
    const trimmed = apartmentNameDraft.trim()
    if (!trimmed) {
      toast.error('Enter a property name')
      return
    }
    const exists = apartmentNameChoices.includes(trimmed)
    if (!exists) {
      setApartmentPropertyNames((prev) => [...prev, trimmed].sort((a, b) => a.localeCompare(b)))
      toast.success('Property name added')
    } else {
      toast.message('Name already in list — selected.')
    }
    setPropertyForm((prev) => ({ ...prev, name: trimmed }))
    setApartmentNameDraft('')
    setIsAddApartmentNameOpen(false)
  }

  const updateChecklistItem = (id: string, next: Partial<ChecklistItem>) => {
    setPropertyForm((prev) => ({
      ...prev,
      checklist: prev.checklist.map((item) => (item.id === id ? { ...item, ...next } : item)),
    }))
  }

  const mobileFilteredOperatorProperties = useMemo(() => {
    let list = visibleListProperties
    const q = mobileOperatorListSearch.trim().toLowerCase()
    if (q) {
      list = list.filter((p) =>
        [p.name, p.address, p.client, p.unitNumber].some((f) => String(f || '').toLowerCase().includes(q))
      )
    }
    const cf = operatorMobileColumnFilters
    const cv = cf.client
    if (cv && cv !== 'all') {
      list = list.filter((row) =>
        cv === '__none__' ? !String(row.client || '').trim() : String(row.client || '') === cv
      )
    }
    const ov = cf.origin
    if (ov && ov !== 'all') {
      list = list.filter((row) =>
        ov === 'client' ? !!row.clientPortalOwned : !row.clientPortalOwned
      )
    }
    const tv = cf.type
    if (tv && tv !== 'all') {
      list = list.filter((row) => row.type === tv)
    }
    const sv = cf.status
    if (sv && sv !== 'all') {
      list = list.filter((row) => row.status === sv)
    }
    return list
  }, [visibleListProperties, mobileOperatorListSearch, operatorMobileColumnFilters])

  const mobileOperatorTotalPages = useMemo(() => {
    const len = mobileFilteredOperatorProperties.length
    if (len === 0) return 0
    return Math.max(1, Math.ceil(len / propertyListPageSize))
  }, [mobileFilteredOperatorProperties.length, propertyListPageSize])

  const mobilePageEffective =
    mobileOperatorTotalPages === 0
      ? 1
      : Math.min(mobilePropertyListPage, mobileOperatorTotalPages)

  const mobilePaginatedOperatorProperties = useMemo(() => {
    const list = mobileFilteredOperatorProperties
    if (list.length === 0) return []
    const start = (mobilePageEffective - 1) * propertyListPageSize
    return list.slice(start, start + propertyListPageSize)
  }, [mobileFilteredOperatorProperties, mobilePageEffective, propertyListPageSize])

  useEffect(() => {
    setMobilePropertyListPage(1)
  }, [
    mobileOperatorListSearch,
    operatorMobileColumnFilters,
    propertyArchiveFilter,
    propertyListPageSize,
    visibleListProperties,
  ])

  const operatorMobileHasActiveFilters = useMemo(
    () =>
      Object.entries(operatorMobileColumnFilters).some(([, v]) => v && v !== 'all') ||
      propertyArchiveFilter !== 'active',
    [operatorMobileColumnFilters, propertyArchiveFilter]
  )

  const clientNameFilterOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const p of visibleListProperties) {
      const c = String(p.client || '').trim()
      if (c) seen.add(c)
    }
    return [...seen].sort((a, b) => a.localeCompare(b)).map((name) => ({ label: name, value: name }))
  }, [visibleListProperties])

  const clientFilterOptsMobile = useMemo(
    () => [{ label: 'Unassigned', value: '__none__' }, ...clientNameFilterOptions],
    [clientNameFilterOptions]
  )

  const columns = useMemo<Column<Property>[]>(() => {
    const clientFilterOpts: { label: string; value: string }[] = [
      { label: 'Unassigned', value: '__none__' },
      ...clientNameFilterOptions,
    ]
    return [
    {
      key: 'name',
      label: 'Property',
      sortable: true,
      render: (_, row) => {
        const Icon = typeIcons[row.type]
        return (
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${typeColors[row.type].split(' ')[0]}`}>
              <Icon className={`h-4 w-4 ${typeColors[row.type].split(' ')[1]}`} />
            </div>
            <div>
              <p className="font-medium">{row.name}</p>
              <p className="text-xs text-muted-foreground">{row.unitNumber || '-'}</p>
            </div>
          </div>
        )
      },
    },
    {
      key: 'unitNumber',
      label: 'Unit Number',
      sortable: true,
      render: (value) => <span className="text-sm">{String(value || '-')}</span>,
    },
    {
      key: 'client',
      label: 'Client',
      sortable: true,
      filterable: true,
      filterOptions: clientFilterOpts,
      filterMatch: (row, v) =>
        v === '__none__' ? !String(row.client || '').trim() : String(row.client || '') === v,
      render: (value) => <span className="text-sm">{String(value || '-')}</span>,
    },
    {
      key: 'origin',
      label: 'Origin',
      sortable: false,
      filterable: true,
      filterOptions: [
        { label: 'Operator-created', value: 'operator' },
        { label: 'Client-created', value: 'client' },
      ],
      filterMatch: (row, v) =>
        v === 'client' ? !!row.clientPortalOwned : !row.clientPortalOwned,
      render: (_, row) => (
        <Badge
          variant="outline"
          className={
            row.clientPortalOwned
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-slate-200 bg-slate-50 text-slate-800'
          }
        >
          {row.clientPortalOwned ? 'Client' : 'Operator'}
        </Badge>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      filterable: true,
      filterOptions: [
        { label: 'Apartment', value: 'apartment' },
        { label: 'Landed', value: 'landed' },
        { label: 'Office', value: 'office' },
        { label: 'Commercial', value: 'commercial' },
        { label: 'Other', value: 'other' },
      ],
      render: (value) => (
        <Badge variant="secondary" className={typeColors[value as keyof typeof typeColors]}>
          {String(value)}
        </Badge>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      filterable: true,
      filterOptions: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
      ],
      render: (value) => (
        <Badge
          variant="secondary"
          className={value === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}
        >
          {String(value)}
        </Badge>
      ),
    },
    {
      key: 'lastCleaned',
      label: 'Last Cleaned',
      sortable: true,
      render: (value) => value ? new Date(String(value)).toLocaleDateString('en-MY') : '-',
    },
  ]
  }, [clientNameFilterOptions])

  const openDeletePropertyDialog = (row: Property) => {
    setPendingDeleteProperty(row)
    setDeletePropertyPhase(1)
    setDeletePropertyDialogOpen(true)
  }

  const runConfirmedDeleteProperty = async () => {
    if (!pendingDeleteProperty) return
    setDeletePropertyWorking(true)
    try {
      const row = pendingDeleteProperty
      const r = await deleteOperatorProperty(row.id, operatorId)
      if (!r?.ok) {
        toast.error(
          r?.reason === 'PROPERTY_NOT_ARCHIVED'
            ? 'Archive this property before deleting it.'
            : r?.reason === 'OPERATOR_MISMATCH'
              ? 'This property belongs to another operator.'
              : r?.reason === 'CLIENT_PORTAL_OWNED'
                ? 'Client-created units cannot be deleted — use Remove from my list instead.'
                : `Delete ${row.name} failed`
        )
        return
      }
      setProperties((prev) => prev.filter((p) => p.id !== row.id))
      const namesR = await fetchOperatorDistinctPropertyNames(operatorId)
      if (namesR?.ok && Array.isArray(namesR.items)) {
        setDbDistinctPropertyNames(namesR.items.map((x: unknown) => String(x).trim()).filter(Boolean))
      }
      toast.success(`${row.name} deleted`)
      setDeletePropertyDialogOpen(false)
      setPendingDeleteProperty(null)
      setDeletePropertyPhase(1)
    } finally {
      setDeletePropertyWorking(false)
    }
  }

  const runRemoveOperatorFromClientProperty = async () => {
    if (!pendingRemoveFromList) return
    setRemoveFromListWorking(true)
    try {
      const row = pendingRemoveFromList
      const r = (await updateOperatorProperty(row.id, {
        removeOperatorLink: true,
        operatorId,
      })) as { ok?: boolean; reason?: string }
      if (!r?.ok) {
        toast.error(typeof r.reason === 'string' ? r.reason : 'Remove failed')
        return
      }
      toast.success(`Removed your operator from ${row.name}. The client keeps their property.`)
      setRemoveFromListOpen(false)
      setPendingRemoveFromList(null)
      await reloadProperties()
    } finally {
      setRemoveFromListWorking(false)
    }
  }

  const runTransferOwnershipToClient = async () => {
    if (!pendingTransferToClient) return
    setTransferToClientWorking(true)
    try {
      const row = pendingTransferToClient
      const r = (await updateOperatorProperty(row.id, {
        operatorId,
        transferOwnershipToClient: true,
      })) as { ok?: boolean; reason?: string }
      if (!r?.ok) {
        toast.error(
          r?.reason === 'TRANSFER_REQUIRES_BOUND_CLIENT'
            ? 'Bind a B2B client to this unit first.'
            : r?.reason === 'ALREADY_CLIENT_OWNED'
              ? 'This unit is already client-managed.'
              : r?.reason === 'UNSUPPORTED'
                ? 'Server needs client_portal_owned column.'
                : typeof r.reason === 'string'
                  ? r.reason
                  : 'Transfer failed'
        )
        return
      }
      toast.success(`${row.name} is now owned by the client portal — they edit core fields; your operator link stays for service where configured.`)
      setTransferToClientOpen(false)
      setPendingTransferToClient(null)
      await reloadProperties()
    } finally {
      setTransferToClientWorking(false)
    }
  }

  const actions: Action<Property>[] = [
    {
      label: 'Open door',
      icon: <DoorOpen className="h-4 w-4 mr-2" />,
      onClick: async (row) => {
        const r = await fetchOperatorPropertyDetail(row.id, operatorId)
        if (!r?.ok || !r.property) {
          toast.error(r?.reason || 'Could not load property')
          return
        }
        const p = r.property
        setDoorOpenPayload({
          title: `${row.name} — ${row.unitNumber || 'Unit'}`,
          smartdoorId: String(p.smartdoorId || '').trim(),
          mailboxPassword: String(p.mailboxPassword || ''),
          smartdoorPassword: String(p.smartdoorPassword || ''),
          operatorDoorAccessMode: String(p.operatorDoorAccessMode || 'temporary_password_only'),
          smartdoorGatewayReady: !!p.smartdoorGatewayReady,
          hasBookingToday: !!p.hasBookingToday,
        })
      },
    },
    {
      label: 'View Details',
      icon: <Eye className="h-4 w-4 mr-2" />,
      onClick: (row) => setSelectedProperty(row),
    },
    {
      label: 'Edit',
      icon: <Edit className="h-4 w-4 mr-2" />,
      onClick: (row) => {
        setEditingPropertyId(row.id)
        seedFormFromProperty(row)
        setIsAddDialogOpen(true)
      },
    },
    {
      label: 'Remove from my list',
      icon: <UserMinus className="h-4 w-4 mr-2" />,
      visible: (row) =>
        row.clientPortalOwned && String(row.linkedOperatorId || '').trim() === String(operatorId || '').trim(),
      onClick: (row) => {
        setPendingRemoveFromList(row)
        setRemoveFromListOpen(true)
      },
    },
    {
      label: 'Transfer to client',
      icon: <ArrowRightLeft className="h-4 w-4 mr-2" />,
      visible: (row) =>
        !row.clientPortalOwned &&
        row.status === 'active' &&
        String(row.clientdetailId || '').trim() !== '',
      onClick: (row) => {
        setPendingTransferToClient(row)
        setTransferToClientOpen(true)
      },
    },
    {
      label: 'Archive',
      icon: <Archive className="h-4 w-4 mr-2" />,
      visible: (row) => !row.clientPortalOwned && row.status === 'active',
      onClick: async (row) => {
        const r = await updateOperatorProperty(row.id, { operatorId, operatorPortalArchived: true })
        if (!r?.ok) {
          toast.error(
            r?.reason === 'NOT_CLIENT_PORTAL_OWNED'
              ? 'Not allowed for this unit.'
              : r?.reason === 'UNSUPPORTED'
                ? 'Archive needs a database update on the server.'
                : 'Archive failed'
          )
          return
        }
        await reloadProperties()
        toast.success(`${row.name} archived — hidden from client portal until restored.`)
      },
    },
    {
      label: 'Restore',
      icon: <RotateCcw className="h-4 w-4 mr-2" />,
      visible: (row) => !row.clientPortalOwned && row.status === 'inactive',
      onClick: async (row) => {
        const r = await updateOperatorProperty(row.id, { operatorId, operatorPortalArchived: false })
        if (!r?.ok) {
          toast.error(
            r?.reason === 'NOT_CLIENT_PORTAL_OWNED'
              ? 'Not allowed for this unit.'
              : r?.reason === 'UNSUPPORTED'
                ? 'Restore needs a database update on the server.'
                : 'Restore failed'
          )
          return
        }
        await reloadProperties()
        toast.success(`${row.name} restored`)
      },
    },
    {
      label: 'Delete',
      icon: <Trash2 className="h-4 w-4 mr-2" />,
      variant: 'destructive',
      visible: (row) => !row.clientPortalOwned && row.status === 'inactive',
      onClick: (row) => openDeletePropertyDialog(row),
    },
  ]

  const runBulkBindClient = async () => {
    const cd = String(bulkBindClientId || '').trim()
    if (!cd) {
      toast.error('Select a client to bind')
      return
    }
    const client = bookingClients.find((c) => c.id === cd)
    if (!client) {
      toast.error('Invalid client')
      return
    }
    const targets = selectedRows.filter((p) => !p.clientPortalOwned)
    if (targets.length === 0) {
      toast.error('No eligible properties selected')
      return
    }
    setBulkWorking(true)
    let ok = 0
    let fail = 0
    let skipped = 0
    for (const p of targets) {
      if (String(p.clientdetailId || '').trim() === cd) {
        skipped += 1
        continue
      }
      const patch: Record<string, unknown> = {
        ...bulkUpdateBasePatch(p),
        client: client.name || client.email || p.client,
        clientdetailId: cd,
        deferClientBinding: true,
      }
      const r = await updateOperatorProperty(p.id, patch)
      if (r?.ok) ok += 1
      else fail += 1
    }
    setBulkWorking(false)
    setBulkBindOpen(false)
    setBulkBindClientId('')
    setSelectedPropertyIds(new Set())
    await reloadProperties()
    const parts: string[] = []
    if (ok) parts.push(`${ok} binding request(s) sent`)
    if (skipped) parts.push(`${skipped} already bound to this client`)
    if (fail) parts.push(`${fail} failed`)
    if (parts.length === 0) parts.push('No changes')
    toast.success(parts.join(' · '))
    if (ok > 0 && fail === 0) {
      toast.message('Clients confirm binding in the client portal.')
    }
  }

  const runBulkDisconnectClient = async () => {
    const targets = selectedRows.filter(
      (p) =>
        !p.clientPortalOwned &&
        (String(p.clientdetailId || '').trim() || String(p.client || '').trim())
    )
    if (targets.length === 0) {
      toast.error('No operator-owned properties with a client binding in the selection')
      setBulkDisconnectOpen(false)
      return
    }
    setBulkWorking(true)
    let ok = 0
    let fail = 0
    for (const p of targets) {
      const patch: Record<string, unknown> = {
        ...bulkUpdateBasePatch(p),
        client: '',
        clearClientdetail: true,
      }
      const r = await updateOperatorProperty(p.id, patch)
      if (r?.ok) ok += 1
      else fail += 1
    }
    setBulkWorking(false)
    setBulkDisconnectOpen(false)
    setSelectedPropertyIds(new Set())
    await reloadProperties()
    if (fail) {
      toast.error(`Disconnected client on ${ok}, failed ${fail}`)
    } else {
      toast.success(
        `Disconnected client on ${ok} propert${ok === 1 ? 'y' : 'ies'}. Those clients no longer see these units; you can bind another client.`
      )
    }
  }

  const runBulkRemoveOperator = async () => {
    const targets = selectedRows.filter((p) => String(p.linkedOperatorId || '').trim() !== '')
    if (targets.length === 0) {
      toast.error('No properties linked to your operator in the selection')
      setBulkRemoveOperatorOpen(false)
      return
    }
    setBulkWorking(true)
    let ok = 0
    let fail = 0
    for (const p of targets) {
      const r = (await updateOperatorProperty(p.id, {
        removeOperatorLink: true,
        operatorId,
      })) as { ok?: boolean; reason?: string }
      if (r?.ok) ok += 1
      else fail += 1
    }
    setBulkWorking(false)
    setBulkRemoveOperatorOpen(false)
    setSelectedPropertyIds(new Set())
    await reloadProperties()
    if (fail) {
      toast.error(
        `Removed operator on ${ok}, failed ${fail}. If a row could not be removed, it may still be referenced (e.g. schedules).`
      )
    } else {
      toast.success(
        `Removed your operator from ${ok} propert${ok === 1 ? 'y' : 'ies'}. Rows with no client were deleted; rows with a client remain for the client portal.`
      )
    }
  }

  const toPropertyPayload = (id: string, status: Property['status']): Property => ({
    ...(() => {
      const parsedLat = Number(propertyForm.latitude)
      const parsedLng = Number(propertyForm.longitude)
      const lat = Number.isFinite(parsedLat) ? parsedLat : DEFAULT_PROPERTY_MAP_LAT
      const lng = Number.isFinite(parsedLng) ? parsedLng : DEFAULT_PROPERTY_MAP_LNG
      return {
        lat,
        lng,
        googleMapUrl: getGoogleMapUrl(String(lat), String(lng)),
      }
    })(),
    id,
    name: propertyForm.name,
    address: propertyForm.propertyAddress,
    wazeUrl: propertyForm.wazeUrl.trim(),
    googleMapsUrl: propertyForm.googleMapsUrl.trim(),
    unitNumber: propertyForm.unitNumber,
    type: siteKindToPropertyType(propertyForm.siteKind),
    client: propertyForm.bindingClient,
    status,
    securitySystem: propertyForm.securitySystem,
    securityUsername: propertyForm.securityUsername.trim(),
    cleaningTypes: [],
    keyCollection: {
      mailboxPassword: propertyForm.keyCollection.mailboxPassword ? propertyForm.mailboxPasswordValue : '',
      smartdoorPassword: propertyForm.keyCollection.smartdoorPassword ? propertyForm.smartdoorPasswordValue : '',
      smartdoorToken: propertyForm.keyCollection.smartdoorToken ? SMARTDOOR_TOKEN_ENABLED_MARKER : '',
    },
    remark: propertyForm.remark,
    cleaningPriceSummary: cleaningPriceSummaryText,
    estimatedTime: propertyForm.estimatedTime.trim() ? propertyForm.estimatedTime.trim() : undefined,
    afterCleanPhotoSample: propertyForm.afterCleanPhotoSample,
    keyPhoto: propertyForm.keyPhoto,
    checklist: propertyForm.checklist,
    lastCleaned: undefined,
  })

  const handleAddProperty = async () => {
    const id = `${Date.now()}`
    const next = toPropertyPayload(id, 'active')
    const payload: Record<string, unknown> = {
      name: next.name,
      address: next.address,
      unitNumber: next.unitNumber,
      client: next.client,
      team: '',
      operatorId,
      premisesType: propertyForm.siteKind,
      securitySystem: propertyForm.securitySystem,
      securityUsername: propertyForm.securityUsername.trim() || null,
      mailboxPassword: propertyForm.mailboxPasswordValue,
      smartdoorPassword: propertyForm.keyCollection.smartdoorPassword ? propertyForm.smartdoorPasswordValue : '',
      smartdoorTokenEnabled: propertyForm.keyCollection.smartdoorToken,
      smartdoorToken: propertyForm.keyCollection.smartdoorToken ? SMARTDOOR_TOKEN_ENABLED_MARKER : '',
      afterCleanPhotoUrl: propertyForm.afterCleanPhotoSample,
      keyPhotoUrl: propertyForm.keyPhoto,
      clientPortalOwned: 0,
      wazeUrl: propertyForm.wazeUrl.trim(),
      googleMapsUrl: propertyForm.googleMapsUrl.trim(),
      latitude: (() => {
        const n = Number(propertyForm.latitude)
        return Number.isFinite(n) ? n : undefined
      })(),
      longitude: (() => {
        const n = Number(propertyForm.longitude)
        return Number.isFinite(n) ? n : undefined
      })(),
    }
    if (propertyForm.bindingClientId) {
      payload.clientdetailId = propertyForm.bindingClientId
      payload.deferClientBinding = true
    }
    const r = await createOperatorProperty(payload)
    if (!r?.ok) {
      toast.error('Failed to add property')
      return
    }
    setProperties((prev) => [{ ...next, id: r.id || id }, ...prev])
    const namesR = await fetchOperatorDistinctPropertyNames(operatorId)
    if (namesR?.ok && Array.isArray(namesR.items)) {
      setDbDistinctPropertyNames(namesR.items.map((x: unknown) => String(x).trim()).filter(Boolean))
    }
    if (r.deferClientBinding) {
      toast.success('Property saved. Client approval is pending for the binding.')
    } else {
      toast.success(`${propertyForm.name} has been added successfully!`)
    }
    setIsAddDialogOpen(false)
    resetForm()
  }

  const handleUpdateProperty = async () => {
    if (!editingPropertyId) return
    if (bindingLocked) {
      toast.error(
        'This unit was registered by the client. They manage address and access; use Remove from my list if you no longer service it.'
      )
      return
    }
    const prevRow = properties.find((p) => p.id === editingPropertyId)
    const next = toPropertyPayload(editingPropertyId, prevRow?.status ?? 'active')
    const patch: Record<string, unknown> = {
      operatorId,
      name: next.name,
      address: next.address,
      unitNumber: next.unitNumber,
      client: next.client,
      team: '',
      premisesType: propertyForm.siteKind,
      securitySystem: propertyForm.securitySystem,
      securityUsername: propertyForm.securityUsername.trim() || null,
      mailboxPassword: propertyForm.mailboxPasswordValue,
      smartdoorPassword: propertyForm.keyCollection.smartdoorPassword ? propertyForm.smartdoorPasswordValue : '',
      smartdoorTokenEnabled: propertyForm.keyCollection.smartdoorToken,
      afterCleanPhotoUrl: propertyForm.afterCleanPhotoSample,
      keyPhotoUrl: propertyForm.keyPhoto,
      wazeUrl: propertyForm.wazeUrl.trim(),
      googleMapsUrl: propertyForm.googleMapsUrl.trim(),
      latitude: (() => {
        const n = Number(propertyForm.latitude)
        return Number.isFinite(n) ? n : undefined
      })(),
      longitude: (() => {
        const n = Number(propertyForm.longitude)
        return Number.isFinite(n) ? n : undefined
      })(),
    }
    const baselineCd = bindingClientIdBaselineRef.current
    const nextCd = String(propertyForm.bindingClientId || '').trim()
    const bindChanged = nextCd !== baselineCd
    if (propertyForm.bindingClientId && bindChanged && !bindingLocked) {
      patch.clientdetailId = propertyForm.bindingClientId
      patch.deferClientBinding = true
    } else if (!propertyForm.bindingClientId && !bindingLocked && bindChanged) {
      patch.clearClientdetail = true
    }
    const r = await updateOperatorProperty(editingPropertyId, patch)
    if (!r?.ok) {
      toast.error('Failed to update property')
      return
    }
    setProperties((prev) => prev.map((item) => (item.id === editingPropertyId ? toPropertyPayload(editingPropertyId, item.status) : item)))
    const namesR = await fetchOperatorDistinctPropertyNames(operatorId)
    if (namesR?.ok && Array.isArray(namesR.items)) {
      setDbDistinctPropertyNames(namesR.items.map((x: unknown) => String(x).trim()).filter(Boolean))
    }
    setIsAddDialogOpen(false)
    setEditingPropertyId(null)
    if (patch.deferClientBinding) {
      toast.success('Update saved. Client approval is pending for the new binding.')
    } else {
      toast.success(`${propertyForm.name} has been updated successfully!`)
    }
    resetForm()
  }

  const handleRemoveClientOwnedFromMyList = async () => {
    if (!editingPropertyId) return
    const row = properties.find((p) => p.id === editingPropertyId)
    if (!row?.clientPortalOwned) {
      toast.error('This action applies only to properties created by a client')
      return
    }
    if (!String(row.linkedOperatorId || '').trim()) {
      toast.error('This property is not linked to your company')
      return
    }
    setBulkWorking(true)
    const r = (await updateOperatorProperty(editingPropertyId, {
      removeOperatorLink: true,
      operatorId,
    })) as { ok?: boolean; reason?: string }
    setBulkWorking(false)
    if (!r?.ok) {
      toast.error(typeof r?.reason === 'string' ? r.reason : 'Failed to remove from list')
      return
    }
    toast.success('Removed from your list. The client still has this property.')
    setIsAddDialogOpen(false)
    setEditingPropertyId(null)
    resetForm()
    await reloadProperties()
  }

  const openMapConfirmBeforeSubmit = (mode: 'add' | 'edit') => {
    if (propertyForm.siteKind === 'apartment') {
      const n = propertyForm.name.trim()
      if (!n) {
        toast.error('Select or add a building name for apartment premises')
        return
      }
    } else if (!propertyForm.name.trim()) {
      toast.error('Enter a property name')
      return
    }
    setPendingSubmitMode(mode)
    setPropertyForm((prev) => {
      const hasUsefulCoords =
        prev.latitude.trim() &&
        prev.longitude.trim() &&
        !isLegacyKualaLumpurPlaceholder(prev.latitude, prev.longitude)
      if (hasUsefulCoords) return prev
      const parsed = parseLatLngFromNavigationUrls(prev.wazeUrl, prev.googleMapsUrl)
      const lat = parsed?.lat ?? DEFAULT_PROPERTY_MAP_LAT
      const lng = parsed?.lng ?? DEFAULT_PROPERTY_MAP_LNG
      return { ...prev, latitude: String(lat), longitude: String(lng) }
    })
    setIsMapConfirmOpen(true)
  }

  const confirmMapAndSubmit = () => {
    if (pendingSubmitMode === 'add') {
      handleAddProperty()
    } else if (pendingSubmitMode === 'edit') {
      handleUpdateProperty()
    }
    setPendingSubmitMode(null)
    setIsMapConfirmOpen(false)
  }

  const focusPropertyOnMap = (property: Property) => {
    const map = leafletMapRef.current
    if (!map) return
    if (!Number.isFinite(property.lat) || !Number.isFinite(property.lng)) return
    map.setView([property.lat, property.lng], 15, { animate: true })
  }

  useEffect(() => {
    let cancelled = false

    const initMap = async () => {
      if (viewMode !== 'map') return
      if (!mapContainerRef.current) return
      if (typeof window === 'undefined') return

      const L = await import('leaflet')
      if (cancelled) return
      leafletLibRef.current = L

      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }

      const validPoints = visibleListProperties.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      const initial = validPoints[0] || { lat: DEFAULT_PROPERTY_MAP_LAT, lng: DEFAULT_PROPERTY_MAP_LNG }
      const map = L.map(mapContainerRef.current).setView([initial.lat, initial.lng], 11)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)

      const bounds: Array<[number, number]> = []
      validPoints.forEach((property) => {
        bounds.push([property.lat, property.lng])
        L.circleMarker([property.lat, property.lng], {
          radius: 8,
          color: '#1d4ed8',
          fillColor: '#3b82f6',
          fillOpacity: 0.85,
          weight: 2,
        })
          .addTo(map)
          .bindPopup(
            `<div style="min-width:180px">
              <strong>${property.name}</strong><br/>
              <span>${property.address}</span><br/>
              ${
                property.wazeUrl
                  ? `<a href="${property.wazeUrl}" target="_blank" rel="noreferrer">Waze</a><br/>`
                  : ''
              }
              <a href="${resolveGoogleMapsLink(property)}" target="_blank" rel="noreferrer">Google Maps</a>
            </div>`
          )
      })

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [24, 24] })
      }

      leafletMapRef.current = map
      window.setTimeout(() => {
        try {
          map.invalidateSize()
        } catch {
          /* ignore */
        }
      }, 120)
    }

    void initMap()

    return () => {
      cancelled = true
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
    }
  }, [visibleListProperties, viewMode])

  const archiveScopeFilterSelect = (
    <Select
      value={propertyArchiveFilter}
      onValueChange={(v) => setPropertyArchiveFilter(v as 'all' | 'active' | 'archived')}
    >
      <SelectTrigger className="h-10 w-full min-w-0 border-input" aria-label="Property status">
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All status</SelectItem>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="archived">Archived</SelectItem>
      </SelectContent>
    </Select>
  )

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Property Management</h2>
          <p className="text-muted-foreground">Manage all your service locations</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground mr-1">{visibleListProperties.length} registered</span>
          <div className="flex border rounded-lg">
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="rounded-r-none"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'map' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('map')}
              className="rounded-l-none"
            >
              <Map className="h-4 w-4" />
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="default" className="gap-2 min-w-[7.5rem]">
                Actions
                <ChevronDown className="h-4 w-4 opacity-80" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[14rem] w-max max-w-[20rem]">
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onClick={() => {
                  setEditingPropertyId(null)
                  resetForm()
                  setIsAddDialogOpen(true)
                }}
              >
                <Plus className="h-4 w-4 shrink-0" />
                Add property
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={
                  viewMode !== 'list' ||
                  bulkWorking ||
                  bookingClients.length === 0 ||
                  selectedPropertyIds.size === 0
                }
                className="gap-2 cursor-pointer"
                onClick={() => {
                  if (viewMode !== 'list') {
                    toast.error('Switch to list view to select properties')
                    return
                  }
                  if (selectedPropertyIds.size === 0) {
                    toast.error('Select one or more properties first')
                    return
                  }
                  if (bookingClients.length === 0) {
                    toast.error('No linked clients — add links under Contacts first')
                    return
                  }
                  setBulkBindOpen(true)
                }}
              >
                <Link2 className="h-4 w-4 shrink-0" />
                Bind client… ({selectedPropertyIds.size})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={viewMode !== 'list' || bulkWorking || selectedBulkDisconnectClientCount === 0}
                className="gap-2 cursor-pointer"
                onClick={() => {
                  if (viewMode !== 'list') {
                    toast.error('Switch to list view to select properties')
                    return
                  }
                  if (selectedBulkDisconnectClientCount === 0) {
                    toast.error('No operator-owned properties with a client binding in the selection')
                    return
                  }
                  setBulkDisconnectOpen(true)
                }}
              >
                <Unlink className="h-4 w-4 shrink-0" />
                Disconnect client (remove client)… ({selectedBulkDisconnectClientCount})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={viewMode !== 'list' || bulkWorking || selectedBulkRemoveOperatorCount === 0}
                className="gap-2 cursor-pointer"
                onClick={() => {
                  if (viewMode !== 'list') {
                    toast.error('Switch to list view to select properties')
                    return
                  }
                  if (selectedBulkRemoveOperatorCount === 0) {
                    toast.error('No properties linked to your operator in the selection')
                    return
                  }
                  setBulkRemoveOperatorOpen(true)
                }}
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                Bulk delete (remove operator)… ({selectedBulkRemoveOperatorCount})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog
            open={isAddDialogOpen}
            onOpenChange={(open) => {
              setIsAddDialogOpen(open)
              if (!open) {
                setEditingPropertyId(null)
                setIsAddApartmentNameOpen(false)
                setApartmentNameDraft('')
                resetForm()
              }
            }}
          >
            <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingPropertyId ? 'Edit Property' : 'Add New Property'}</DialogTitle>
                <DialogDescription>
                  {editingPropertyId ? 'Update the property details below.' : 'Enter the property details below.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Binding client</Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                    <Select
                      value={propertyForm.bindingClientId || '__none__'}
                      disabled={bindingLocked}
                      onValueChange={(id) => {
                        if (id === '__none__') {
                          setPropertyForm({ ...propertyForm, bindingClientId: '', bindingClient: '' })
                          return
                        }
                        const c = bookingClients.find((x) => x.id === id)
                        setPropertyForm({
                          ...propertyForm,
                          bindingClientId: id,
                          bindingClient: c?.name || '',
                        })
                      }}
                    >
                      <SelectTrigger className="sm:flex-1">
                        <SelectValue placeholder="Select client" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select client</SelectItem>
                        {bookingClients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name || c.email || c.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!bindingLocked ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          disabled={!propertyForm.bindingClientId}
                          onClick={() =>
                            setPropertyForm((f) => ({ ...f, bindingClientId: '', bindingClient: '' }))
                          }
                        >
                          Disconnect
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => setIsOwnerProfileOpen(true)}
                          disabled={!propertyForm.bindingClientId}
                        >
                          View Profile
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => setIsOwnerProfileOpen(true)}
                          disabled={!propertyForm.bindingClientId}
                        >
                          View Profile
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          disabled={
                            bulkWorking ||
                            !String(properties.find((p) => p.id === editingPropertyId)?.linkedOperatorId || '').trim()
                          }
                          onClick={() => void handleRemoveClientOwnedFromMyList()}
                        >
                          Remove from my list
                        </Button>
                      </>
                    )}
                  </div>
                  {bindingLocked ? (
                    <p className="text-xs text-muted-foreground">
                      Created by a client: you cannot change who is bound. Use &quot;Remove from my list&quot; to drop this
                      property from your operator view; the client keeps it.
                    </p>
                  ) : null}
                  {bookingClients.length === 0 && (
                    <p className="text-xs text-muted-foreground">No clients linked to this operator yet.</p>
                  )}
                </div>
                {bindingLocked ? (
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    Client-registered unit: name, address, navigation links, unit number, keys and security are managed by
                    the client. You can still use pricing, checklist and remarks below, or remove this unit from your list.
                  </p>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="site-kind">Premises type</Label>
                  <Select
                    value={propertyForm.siteKind}
                    disabled={!canEditCorePropertyFields}
                    onValueChange={(value: SiteKind) => {
                      setPropertyForm((prev) => ({ ...prev, siteKind: value }))
                    }}
                  >
                    <SelectTrigger id="site-kind">
                      <SelectValue placeholder="Select premises type" />
                    </SelectTrigger>
                    <SelectContent>
                      {SITE_KIND_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={propertyForm.siteKind === 'apartment' ? 'property-name-select' : 'name'}>
                    Property name
                  </Label>
                  {propertyForm.siteKind === 'apartment' ? (
                    <div className="space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <Popover open={buildingComboOpen} onOpenChange={setBuildingComboOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                id="property-name-select"
                                type="button"
                                variant="outline"
                                role="combobox"
                                aria-expanded={buildingComboOpen}
                                disabled={!canEditCorePropertyFields}
                                className="h-10 w-full justify-between px-3 font-normal"
                              >
                                <span className={cn('truncate', !propertyForm.name.trim() && 'text-muted-foreground')}>
                                  {propertyForm.name.trim() || 'Search or select building / condo'}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="z-[100] w-[min(100vw-2rem,var(--radix-popover-trigger-width))] min-w-[min(100%,20rem)] max-h-[min(70vh,22rem)] flex flex-col overflow-hidden p-0"
                              align="start"
                              onWheel={(e) => e.stopPropagation()}
                            >
                              <Command
                                shouldFilter={false}
                                className="max-h-[min(70vh,22rem)] min-h-0 flex flex-col overflow-hidden"
                              >
                                <CommandInput
                                  placeholder="Search buildings (saved by any operator)…"
                                  value={buildingNameInput}
                                  onValueChange={setBuildingNameInput}
                                />
                                <CommandList className="max-h-[min(50vh,18rem)] flex-1">
                                  <CommandEmpty>No building found.</CommandEmpty>
                                  <CommandGroup>
                                    <CommandItem
                                      value="__clear__"
                                      onSelect={() => {
                                        setPropertyForm((p) => ({ ...p, name: '' }))
                                        setBuildingComboOpen(false)
                                      }}
                                    >
                                      Clear selection
                                    </CommandItem>
                                    {filteredBuildingNames.map((n) => (
                                      <CommandItem
                                        key={n}
                                        value={n}
                                        onSelect={() => {
                                          void applyBuildingDefaults(n)
                                          setBuildingComboOpen(false)
                                        }}
                                      >
                                        {n}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 shrink-0 whitespace-nowrap sm:w-auto w-full"
                          disabled={!canEditCorePropertyFields}
                          onClick={() => setIsAddApartmentNameOpen(true)}
                        >
                          Add property name
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Selecting a building fills address, Waze, and Google Maps from the most common values saved for that name (all operators). You can edit after.
                      </p>
                    </div>
                  ) : (
                    <Input
                      id="name"
                      value={propertyForm.name}
                      disabled={!canEditCorePropertyFields}
                      onChange={(e) => setPropertyForm({ ...propertyForm, name: e.target.value })}
                      placeholder="e.g., Sunrise Villa A-12"
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Property Address</Label>
                  <div ref={addressFieldWrapRef} className="relative">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="address"
                        className="pl-9 pr-9"
                        disabled={!canEditCorePropertyFields}
                        value={propertyForm.propertyAddress}
                        onChange={(e) => {
                          const v = e.target.value
                          setPropertyForm((prev) => {
                            const nav = mergeNavUrlsForAddressChange(prev, v, prev.propertyAddress)
                            return { ...prev, propertyAddress: v, ...nav }
                          })
                          if (v.trim().length >= 3) setAddressSuggestOpen(true)
                          scheduleAddressSearch(v, propertyForm.name)
                        }}
                        onFocus={() => {
                          setAddressSuggestOpen(true)
                          if (propertyForm.propertyAddress.trim().length >= 3) {
                            scheduleAddressSearch(propertyForm.propertyAddress, propertyForm.name)
                          }
                        }}
                        placeholder="Type to search (Malaysia) or enter address manually"
                        autoComplete="off"
                      />
                      {addressSearchLoading ? (
                        <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                      ) : null}
                    </div>
                    {addressSuggestOpen && addressSearchItems.length > 0 ? (
                      <ul
                        className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                        role="listbox"
                      >
                        {addressSearchItems.map((item, idx) => (
                          <li key={`${item.placeId || 'p'}-${idx}`}>
                            <button
                              type="button"
                              className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => pickAddressSuggestion(item)}
                            >
                              {item.displayName}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {addressSuggestOpen &&
                    !addressSearchLoading &&
                    addressSearchItems.length === 0 &&
                    propertyForm.propertyAddress.trim().length >= 3 ? (
                      <div
                        className="absolute z-50 mt-1 w-full rounded-md border bg-popover px-2 py-2 text-xs text-muted-foreground shadow-md"
                        role="status"
                      >
                        No OpenStreetMap matches for this text in Malaysia. Try the exact building name
                        (e.g. Citywoods), add city or area, or paste the address manually.
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    OpenStreetMap search (server proxy, Malaysia by default). If your text finds nothing, we also try
                    your Property name above. Choose a result to set the text and map pin.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waze-url">Waze URL</Label>
                  <Input
                    id="waze-url"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    disabled={!canEditCorePropertyFields}
                    value={propertyForm.wazeUrl}
                    onChange={(e) => setPropertyForm({ ...propertyForm, wazeUrl: e.target.value })}
                    placeholder="https://waze.com/ul/…"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="google-maps-url">Google Maps URL</Label>
                  <Input
                    id="google-maps-url"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    disabled={!canEditCorePropertyFields}
                    value={propertyForm.googleMapsUrl}
                    onChange={(e) => setPropertyForm({ ...propertyForm, googleMapsUrl: e.target.value })}
                    placeholder="https://maps.app.goo.gl/…"
                  />
                  <p className="text-xs text-muted-foreground">
                    When you change the property address above, Waze and Google Maps are filled with search links for
                    that text (same as save). Edit these fields if you need a specific share link.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unit">Unit Number</Label>
                  <Input
                    id="unit"
                    value={propertyForm.unitNumber}
                    disabled={!canEditCorePropertyFields}
                    onChange={(e) => setPropertyForm({ ...propertyForm, unitNumber: e.target.value })}
                    placeholder="e.g., A-12 / Level 8"
                  />
                </div>
                <div className="rounded-lg border p-4 space-y-4">
                  <p className="text-sm font-semibold text-foreground">Key collection &amp; security</p>
                  <p className="text-xs text-muted-foreground">
                    Same pattern as client Properties: mailbox and smart door on the unit row; security system login is
                    stored on the linked Coliving property when you use Edit login.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="op-mailbox-pw">Mailbox password</Label>
                    <Input
                      id="op-mailbox-pw"
                      type="text"
                      autoComplete="off"
                      disabled={!canEditCorePropertyFields}
                      value={propertyForm.mailboxPasswordValue}
                      onChange={(e) =>
                        setPropertyForm((prev) => ({
                          ...prev,
                          mailboxPasswordValue: e.target.value,
                          keyCollection: {
                            ...prev.keyCollection,
                            mailboxPassword: e.target.value.trim() !== '',
                          },
                        }))
                      }
                      placeholder="Mailbox password"
                    />
                  </div>
                  <div className="rounded-md border p-3 space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={propertyForm.keyCollection.smartdoorPassword}
                        disabled={!canEditCorePropertyFields}
                        onCheckedChange={(checked) =>
                          setPropertyForm({
                            ...propertyForm,
                            keyCollection: { ...propertyForm.keyCollection, smartdoorPassword: !!checked },
                          })
                        }
                      />
                      Smart door (password)
                    </label>
                    {propertyForm.keyCollection.smartdoorPassword ? (
                      <Input
                        value={propertyForm.smartdoorPasswordValue}
                        disabled={!canEditCorePropertyFields}
                        onChange={(e) => setPropertyForm({ ...propertyForm, smartdoorPasswordValue: e.target.value })}
                        placeholder="Smart door password"
                      />
                    ) : null}
                  </div>
                  <div className="rounded-md border p-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={propertyForm.keyCollection.smartdoorToken}
                        disabled={!canEditCorePropertyFields}
                        onCheckedChange={(checked) =>
                          setPropertyForm({
                            ...propertyForm,
                            keyCollection: { ...propertyForm.keyCollection, smartdoorToken: !!checked },
                          })
                        }
                      />
                      Smart door (token)
                    </label>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="op-security-username" className="text-xs">
                      Security username
                    </Label>
                    <Input
                      id="op-security-username"
                      className="mt-1"
                      disabled={!canEditCorePropertyFields}
                      value={propertyForm.securityUsername}
                      onChange={(e) => setPropertyForm({ ...propertyForm, securityUsername: e.target.value })}
                      placeholder="e.g. icare / gprop username"
                    />
                  </div>
                  {editingPropertyId && operatorEditColivingPdId ? (
                    <div>
                      <Label className="text-xs">Security system</Label>
                      <div className="flex flex-col sm:flex-row gap-2 mt-1 sm:items-start sm:justify-between">
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-sm font-medium text-foreground capitalize">
                            {parseSecuritySystemFromDb(propertyForm.securitySystem)}
                          </p>
                          {securitySystemSummaryText ? (
                            <p className="text-xs text-muted-foreground break-words">{securitySystemSummaryText}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Not configured. Use Edit to choose the system and enter login details (saved on the linked
                              Coliving property).
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0 w-full sm:w-auto"
                          disabled={!canEditCorePropertyFields}
                          onClick={() => openSecurityCredentialsModal()}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Security system (unit row)</Label>
                      <Select
                        value={propertyForm.securitySystem}
                        disabled={!canEditCorePropertyFields}
                        onValueChange={(value: SecuritySystemIdOption) =>
                          setPropertyForm({ ...propertyForm, securitySystem: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SECURITY_SYSTEM_IDS.map((id) => (
                            <SelectItem key={id} value={id}>
                              {id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Full login details (password, etc.) are saved after you link a Coliving property — then use Edit
                        above.
                      </p>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>After Clean Photo Sample (Preview Required)</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    disabled={!canEditCorePropertyFields}
                    onChange={(e) => handleImageUpload(e, 'afterCleanPhotoSample')}
                  />
                  {propertyForm.afterCleanPhotoSample && (
                    <img src={propertyForm.afterCleanPhotoSample} alt="After clean sample preview" className="h-28 rounded-md border object-cover" />
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Cleaning Price Summary</Label>
                  <div className="flex gap-2">
                    <Input value={cleaningPriceSummaryText} readOnly />
                    <Button variant="outline" type="button" onClick={() => setIsPriceSummaryOpen(true)}>
                      Edit
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Estimate time (optional)</Label>
                  <Input
                    value={propertyForm.estimatedTime}
                    onChange={(e) => setPropertyForm({ ...propertyForm, estimatedTime: e.target.value })}
                    placeholder="e.g., 2h 30m"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Key Photo</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    disabled={!canEditCorePropertyFields}
                    onChange={(e) => handleImageUpload(e, 'keyPhoto')}
                  />
                  {propertyForm.keyPhoto && (
                    <img src={propertyForm.keyPhoto} alt="Key photo preview" className="h-28 rounded-md border object-cover" />
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Checklist</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{propertyForm.checklist.length} item(s)</span>
                    <Button variant="outline" type="button" onClick={() => setIsChecklistOpen(true)}>
                      Detail
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Remark</Label>
                  <Textarea
                    id="notes"
                    value={propertyForm.remark}
                    onChange={(e) => setPropertyForm({ ...propertyForm, remark: e.target.value })}
                    placeholder="Any special instructions or notes"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!!(editingPropertyId && bindingLocked)}
                  onClick={() => openMapConfirmBeforeSubmit(editingPropertyId ? 'edit' : 'add')}
                >
                  {editingPropertyId ? 'Save Changes' : 'Add Property'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Dialog open={secCredModalOpen} onOpenChange={setSecCredModalOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Security system login</DialogTitle>
            <DialogDescription>
              Choose the system here and enter login details. Data is saved to MySQL and shown in plain text when you
              reopen the property. Leave password empty only when saving without changing an existing password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Security system</Label>
              <Select
                value={secCredModalSystem}
                onValueChange={(v) => setSecCredModalSystem(v as SecuritySystemIdOption)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECURITY_SYSTEM_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {secCredModalSystem === 'icare' ? (
              <>
                <div>
                  <Label className="text-xs">Phone number</Label>
                  <Input
                    value={secCredPhone}
                    onChange={(e) => setSecCredPhone(e.target.value)}
                    className="mt-1"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label className="text-xs">Date of birth</Label>
                  <Input
                    type="date"
                    value={secCredDob}
                    onChange={(e) => setSecCredDob(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </>
            ) : null}
            {secCredModalSystem === 'ecommunity' ? (
              <div>
                <Label className="text-xs">User</Label>
                <Input
                  value={secCredUser}
                  onChange={(e) => setSecCredUser(e.target.value)}
                  className="mt-1"
                  autoComplete="off"
                />
              </div>
            ) : null}
            {secCredModalSystem === 'veemios' || secCredModalSystem === 'gprop' ? (
              <div>
                <Label className="text-xs">User ID</Label>
                <Input
                  value={secCredUserId}
                  onChange={(e) => setSecCredUserId(e.target.value)}
                  className="mt-1"
                  autoComplete="off"
                />
              </div>
            ) : null}
            {secCredModalSystem === 'css' ? (
              <div>
                <Label className="text-xs">Login code</Label>
                <Input
                  value={secCredLoginCode}
                  onChange={(e) => setSecCredLoginCode(e.target.value)}
                  className="mt-1"
                  autoComplete="off"
                />
              </div>
            ) : null}
            <div>
              <Label className="text-xs">Password</Label>
              <Input
                type="text"
                value={secCredPassword}
                onChange={(e) => setSecCredPassword(e.target.value)}
                className="mt-1 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
                placeholder="Required (leave blank to keep existing when editing)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSecCredModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={secCredModalSaving} onClick={() => void handleSecurityCredentialsModalSave()}>
              {secCredModalSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2 inline" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stats — premises-type breakdown: desktop only (hidden on mobile). */}
      <div className="hidden lg:grid lg:grid-cols-5 gap-4">
        {Object.entries(typeIcons).map(([type, Icon]) => {
          const count = visibleListProperties.filter((p) => p.type === type).length
          return (
            <Card key={type}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${typeColors[type as keyof typeof typeColors].split(' ')[0]}`}>
                    <Icon className={`h-5 w-5 ${typeColors[type as keyof typeof typeColors].split(' ')[1]}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{count}</p>
                    <p className="text-sm text-muted-foreground capitalize">{type}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Content */}
      {viewMode === 'list' ? (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 border py-4 shadow-sm">
          <CardHeader className="flex flex-col gap-3 px-4 pb-0 pt-0 sm:px-6">
            <div className="min-w-0 space-y-1">
              <CardTitle>All Properties</CardTitle>
              <CardDescription>{visibleListProperties.length} properties registered</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-0 px-4 pb-2 pt-0 sm:px-6">
            {selectedPropertyIds.size > 0 ? (
              <p className="mb-3 text-sm text-muted-foreground md:mb-4">
                {selectedPropertyIds.size} selected
                {selectedBulkDisconnectClientCount > 0 || selectedBulkRemoveOperatorCount > 0
                  ? ` · ${selectedBulkDisconnectClientCount} can disconnect client (operator units) · ${selectedBulkRemoveOperatorCount} can remove operator / disconnect client units`
                  : null}
              </p>
            ) : null}

            {/* Mobile: search + Filter toggle — expand panel matches client/damage */}
            <div className="flex flex-col gap-3 md:hidden">
              <p className="text-xs text-muted-foreground">
                Tap a property for details. Use the menu for more actions.
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search name, address, client, unit…"
                      value={mobileOperatorListSearch}
                      onChange={(e) => setMobileOperatorListSearch(e.target.value)}
                      className="h-10 border-input pl-9"
                      aria-label="Search properties"
                    />
                  </div>
                  <Button
                    type="button"
                    variant={operatorMobileListFiltersOpen ? 'secondary' : 'outline'}
                    className="h-10 shrink-0"
                    onClick={() => setOperatorMobileListFiltersOpen((v) => !v)}
                    aria-expanded={operatorMobileListFiltersOpen}
                  >
                    <ListFilter className="h-4 w-4 mr-2" />
                    Filter
                    {operatorMobileHasActiveFilters ? (
                      <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-primary" aria-hidden />
                    ) : null}
                  </Button>
                </div>
                {operatorMobileListFiltersOpen ? (
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                      {archiveScopeFilterSelect}
                      <Select
                        value={operatorMobileColumnFilters.client || 'all'}
                        onValueChange={(v) =>
                          setOperatorMobileColumnFilters((prev) => ({ ...prev, client: v }))
                        }
                      >
                        <SelectTrigger className="w-full border-input lg:w-[200px]">
                          <SelectValue placeholder="Client" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All clients</SelectItem>
                          {clientFilterOptsMobile.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={operatorMobileColumnFilters.origin || 'all'}
                        onValueChange={(v) =>
                          setOperatorMobileColumnFilters((prev) => ({ ...prev, origin: v }))
                        }
                      >
                        <SelectTrigger className="w-full border-input lg:w-[200px]">
                          <SelectValue placeholder="Origin" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All origins</SelectItem>
                          <SelectItem value="operator">Operator-created</SelectItem>
                          <SelectItem value="client">Client-created</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={operatorMobileColumnFilters.type || 'all'}
                        onValueChange={(v) =>
                          setOperatorMobileColumnFilters((prev) => ({ ...prev, type: v }))
                        }
                      >
                        <SelectTrigger className="w-full border-input lg:w-[200px]">
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All types</SelectItem>
                          <SelectItem value="apartment">Apartment</SelectItem>
                          <SelectItem value="landed">Landed</SelectItem>
                          <SelectItem value="office">Office</SelectItem>
                          <SelectItem value="commercial">Commercial</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={operatorMobileColumnFilters.status || 'all'}
                        onValueChange={(v) =>
                          setOperatorMobileColumnFilters((prev) => ({ ...prev, status: v }))
                        }
                      >
                        <SelectTrigger className="w-full border-input lg:w-[180px]">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All status</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-md border border-border bg-card divide-y divide-border">
                {mobileFilteredOperatorProperties.length === 0 ? (
                  <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                    {properties.length === 0
                      ? 'No properties found. Add your first property.'
                      : propertyArchiveFilter === 'archived'
                        ? 'No archived properties.'
                        : 'No properties match your search or filters.'}
                  </div>
                ) : (
                  mobilePaginatedOperatorProperties.map((row) => {
                    const visibleActions = actions
                      .filter((a) => !a.visible || a.visible(row))
                      .filter((a) => a.label !== 'Edit')
                    return (
                      <div key={row.id} className="flex items-center gap-2 px-3 py-4">
                        <div
                          className="flex shrink-0 items-center self-center"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedPropertyIds.has(row.id)}
                            onCheckedChange={(c) => {
                              const next = new Set(selectedPropertyIds)
                              if (c === true) next.add(row.id)
                              else next.delete(row.id)
                              setSelectedPropertyIds(next)
                            }}
                            aria-label="Select property"
                          />
                        </div>
                        <button
                          type="button"
                          className="min-w-0 flex-1 space-y-1.5 text-left"
                          onClick={() => setSelectedProperty(row)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-bold leading-snug text-foreground">{row.name}</h2>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Unit {row.unitNumber || '—'}
                            {row.client ? <span> · {row.client}</span> : null}
                          </p>
                          <p className="line-clamp-2 text-sm text-foreground/90">{row.address}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                row.clientPortalOwned
                                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                                  : 'border-slate-200 bg-slate-50 text-slate-800'
                              }
                            >
                              {row.clientPortalOwned ? 'Client' : 'Operator'}
                            </Badge>
                            <Badge variant="secondary" className={typeColors[row.type]}>
                              {row.type}
                            </Badge>
                            <Badge
                              variant="secondary"
                              className={
                                row.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                              }
                            >
                              {row.status}
                            </Badge>
                          </div>
                          {row.lastCleaned ? (
                            <p className="text-xs text-muted-foreground">
                              Updated {new Date(String(row.lastCleaned)).toLocaleDateString('en-MY')}
                            </p>
                          ) : null}
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5 self-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9"
                            title="Edit"
                            onClick={() => {
                              setEditingPropertyId(row.id)
                              seedFormFromProperty(row)
                              setIsAddDialogOpen(true)
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          {visibleActions.length > 0 ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9"
                                  aria-label="Property actions"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                {visibleActions.map((action, idx) => (
                                  <DropdownMenuItem
                                    key={idx}
                                    onClick={() => action.onClick(row)}
                                    className={action.variant === 'destructive' ? 'text-destructive' : ''}
                                  >
                                    {action.icon}
                                    {action.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
              {mobileFilteredOperatorProperties.length > 0 ? (
                <div className="flex shrink-0 flex-col gap-3 border-t border-border pt-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <p className="text-sm text-muted-foreground order-2 lg:order-1">
                      Showing {(mobilePageEffective - 1) * propertyListPageSize + 1} to{' '}
                      {Math.min(
                        mobilePageEffective * propertyListPageSize,
                        mobileFilteredOperatorProperties.length
                      )}{' '}
                      of {mobileFilteredOperatorProperties.length} results
                    </p>
                    <div className="order-1 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:order-2">
                      <div className="flex items-center justify-center gap-2 sm:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setMobilePropertyListPage((p) => Math.max(1, p - 1))}
                          disabled={mobilePageEffective <= 1 || mobileOperatorTotalPages <= 1}
                          aria-label="Previous page"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="min-w-[7rem] text-center text-sm tabular-nums">
                          Page {mobilePageEffective} of {mobileOperatorTotalPages}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() =>
                            setMobilePropertyListPage((p) =>
                              Math.min(mobileOperatorTotalPages, p + 1)
                            )
                          }
                          disabled={
                            mobilePageEffective >= mobileOperatorTotalPages ||
                            mobileOperatorTotalPages <= 1
                          }
                          aria-label="Next page"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
                        <Label
                          htmlFor="property-mobile-list-page-size"
                          className="text-sm text-muted-foreground whitespace-nowrap"
                        >
                          Show
                        </Label>
                        <Select
                          value={String(propertyListPageSize)}
                          onValueChange={(v) => setPropertyListPageSize(Number(v) || 10)}
                        >
                          <SelectTrigger id="property-mobile-list-page-size" className="h-9 w-[100px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PROPERTY_LIST_PAGE_SIZES.map((n) => (
                              <SelectItem key={n} value={String(n)}>
                                {n}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-sm text-muted-foreground whitespace-nowrap">per page</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Desktop: table with internal scroll, no horizontal pan */}
            <div className="hidden min-h-0 flex-col md:flex md:h-[min(70vh,720px)] md:min-h-[22rem]">
              <DataTable
                data={visibleListProperties}
                columns={columns}
                actions={actions}
                onEditClick={(row) => {
                  setEditingPropertyId(row.id)
                  seedFormFromProperty(row)
                  setIsAddDialogOpen(true)
                }}
                searchKeys={['name', 'address', 'client']}
                pageSize={propertyListPageSize}
                fillContainer
                noHorizontalScroll
                collapsibleFilters
                collapsibleFilterExtra={archiveScopeFilterSelect}
                collapsibleFiltersExtraActive={propertyArchiveFilter !== 'active'}
                pageSizeSelect={{
                  id: 'property-list-page-size',
                  value: propertyListPageSize,
                  onChange: (n) => setPropertyListPageSize(n),
                  options: [...PROPERTY_LIST_PAGE_SIZES],
                }}
                emptyMessage={
                  properties.length === 0
                    ? 'No properties found. Add your first property.'
                    : propertyArchiveFilter === 'archived'
                      ? 'No archived properties.'
                      : 'No properties match your filters.'
                }
                rowSelection={{
                  selectedIds: selectedPropertyIds,
                  onSelectionChange: setSelectedPropertyIds,
                }}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card
          className={cn(
            'flex flex-col min-h-0 overflow-hidden',
            'max-lg:fixed max-lg:inset-0 max-lg:z-[100] max-lg:rounded-none max-lg:border-0 max-lg:shadow-xl max-lg:h-[100dvh]',
          )}
        >
          <CardHeader className="max-lg:shrink-0 max-lg:py-3 max-lg:space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg sm:text-2xl">Property Map</CardTitle>
              <div className="flex items-center gap-2 lg:hidden">
                <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={() => setViewMode('list')}>
                  <List className="h-4 w-4" />
                  List
                </Button>
              </div>
            </div>
            <CardDescription className="max-lg:hidden">View all properties on the map</CardDescription>
            <p className="text-xs text-muted-foreground lg:hidden">Tap List to exit full screen</p>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 min-h-0 p-4 sm:p-6 pt-0 max-lg:flex-1 max-lg:min-h-0 max-lg:p-3 max-lg:pt-0">
            <div
              className={cn(
                'relative bg-muted rounded-lg overflow-hidden flex-1 min-h-[min(500px,70vh)] w-full',
                'max-lg:min-h-0 max-lg:flex-1 max-lg:rounded-md',
                'lg:h-[500px]',
              )}
            >
              <div ref={mapContainerRef} className="absolute inset-0 z-0" />
              
              {/* Property List Overlay */}
              <div className="absolute z-[1000] top-4 left-4 w-72 max-h-[calc(100%-2rem)] bg-card rounded-lg shadow-lg border overflow-hidden">
                <div className="p-3 border-b">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search properties..." className="pl-9 h-9" />
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {visibleListProperties.map((property) => {
                    const Icon = typeIcons[property.type]
                    return (
                      <div
                        key={property.id}
                        className="p-3 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => {
                          focusPropertyOnMap(property)
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <Icon className={`h-4 w-4 mt-0.5 ${typeColors[property.type].split(' ')[1]}`} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{property.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{property.address}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Property Detail Dialog */}
      <Dialog open={!!selectedProperty} onOpenChange={() => setSelectedProperty(null)}>
        <DialogContent className="max-w-lg">
          {selectedProperty && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(() => {
                    const Icon = typeIcons[selectedProperty.type]
                    return <Icon className="h-5 w-5" />
                  })()}
                  {selectedProperty.name}
                </DialogTitle>
                <DialogDescription>{selectedProperty.client}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <span className="text-sm">{selectedProperty.address}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Type</p>
                    <Badge variant="secondary" className={`mt-1 ${typeColors[selectedProperty.type]}`}>
                      {selectedProperty.type}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Unit Number</p>
                    <p className="font-medium mt-1">{selectedProperty.unitNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge
                      variant="secondary"
                      className={`mt-1 ${selectedProperty.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}
                    >
                      {selectedProperty.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Cleaning Type</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {selectedProperty.cleaningTypes.map((item) => (
                      <Badge key={item} variant="outline">{item}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Price Summary</p>
                  <p className="text-sm">{selectedProperty.cleaningPriceSummary}</p>
                </div>
                {selectedProperty.estimatedTime && (
                  <div>
                    <p className="text-sm text-muted-foreground">Estimate time</p>
                    <p className="text-sm">{selectedProperty.estimatedTime}</p>
                  </div>
                )}
                {selectedProperty.lastCleaned && (
                  <div>
                    <p className="text-sm text-muted-foreground">Last Cleaned</p>
                    <p className="font-medium">{new Date(selectedProperty.lastCleaned).toLocaleDateString('en-MY', { 
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Coordinates</p>
                  <p className="text-sm font-mono">{selectedProperty.lat}, {selectedProperty.lng}</p>
                  <div className="mt-2 flex flex-col gap-1">
                    {selectedProperty.wazeUrl ? (
                      <a
                        href={selectedProperty.wazeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary hover:underline"
                      >
                        Open in Waze
                      </a>
                    ) : null}
                    <a
                      href={resolveGoogleMapsLink(selectedProperty)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      {selectedProperty.googleMapsUrl ? 'Open Google Maps (saved link)' : 'Open Google Maps (pin)'}
                    </a>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedProperty(null)}>
                  Close
                </Button>
                <Button>
                  Schedule Cleaning
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isPriceSummaryOpen} onOpenChange={setIsPriceSummaryOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw]">
          <DialogHeader>
            <DialogTitle>Cleaning Price Summary</DialogTitle>
            <DialogDescription>Default calculated price and adjust amount for this property.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(() => {
              const type = PRICE_SUMMARY_LABEL
              const row = propertyForm.cleaningPriceByType[type] || { defaultPrice: '0', adjustAmount: '0' }
              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border rounded-md p-3">
                  <div className="space-y-2">
                    <Label>Line</Label>
                    <Input value={type} readOnly />
                  </div>
                  <div className="space-y-2">
                    <Label>Default Calculate Price</Label>
                    <Input
                      value={row.defaultPrice}
                      onChange={(e) =>
                        setPropertyForm((prev) => ({
                          ...prev,
                          cleaningPriceByType: {
                            ...prev.cleaningPriceByType,
                            [type]: { ...row, defaultPrice: e.target.value },
                          },
                        }))
                      }
                      placeholder="e.g., 220"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Adjust Amount</Label>
                    <Input
                      type="number"
                      value={row.adjustAmount}
                      onChange={(e) =>
                        setPropertyForm((prev) => ({
                          ...prev,
                          cleaningPriceByType: {
                            ...prev.cleaningPriceByType,
                            [type]: { ...row, adjustAmount: e.target.value },
                          },
                        }))
                      }
                      placeholder="0"
                    />
                  </div>
                </div>
              )
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPriceSummaryOpen(false)}>Close</Button>
            <Button onClick={() => setIsPriceSummaryOpen(false)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isChecklistOpen} onOpenChange={setIsChecklistOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Checklist Detail</DialogTitle>
            <DialogDescription>Add checklist item, each item supports remark and optional photo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {propertyForm.checklist.map((item) => (
              <div key={item.id} className="border rounded-md p-3 space-y-2">
                <Input
                  value={item.title}
                  onChange={(e) => updateChecklistItem(item.id, { title: e.target.value })}
                  placeholder="Checklist item title"
                />
                <Textarea
                  value={item.remark}
                  onChange={(e) => updateChecklistItem(item.id, { remark: e.target.value })}
                  placeholder="Remark"
                  rows={2}
                />
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    updateChecklistItem(item.id, { photo: URL.createObjectURL(file) })
                  }}
                />
                {item.photo && <img src={item.photo} alt="Checklist item preview" className="h-24 rounded border object-cover" />}
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addChecklistItem}>
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsChecklistOpen(false)}>Close</Button>
            <Button onClick={() => setIsChecklistOpen(false)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isOwnerProfileOpen} onOpenChange={setIsOwnerProfileOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Owner Profile</DialogTitle>
            <DialogDescription>Owner contact and payment details.</DialogDescription>
          </DialogHeader>
          {selectedBookingClient ? (
            <div className="space-y-3 py-2">
              <div>
                <Label>Name</Label>
                <Input value={selectedBookingClient.name} readOnly />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={selectedBookingClient.email || '—'} readOnly />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">Select a binding client to view profile.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOwnerProfileOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isMapConfirmOpen} onOpenChange={setIsMapConfirmOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw]">
          <DialogHeader>
            <DialogTitle>Confirm Property Location</DialogTitle>
            <DialogDescription>
              Confirm GPS before submit. Coordinates are taken from your Waze/Google links when present, otherwise
              Johor Bahru as a starting point (not Kuala Lumpur). Adjust the pin if needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Latitude</Label>
                <Input
                  value={propertyForm.latitude}
                  onChange={(e) => setPropertyForm((prev) => ({ ...prev, latitude: e.target.value }))}
                  placeholder={`e.g. ${DEFAULT_PROPERTY_MAP_LAT.toFixed(4)}`}
                />
              </div>
              <div className="space-y-2">
                <Label>Longitude</Label>
                <Input
                  value={propertyForm.longitude}
                  onChange={(e) => setPropertyForm((prev) => ({ ...prev, longitude: e.target.value }))}
                  placeholder={`e.g. ${DEFAULT_PROPERTY_MAP_LNG.toFixed(4)}`}
                />
              </div>
            </div>
            <div className="rounded-md border overflow-hidden">
              <iframe
                title="Property location preview"
                src={getGoogleMapEmbedUrl(
                  propertyForm.latitude || String(DEFAULT_PROPERTY_MAP_LAT),
                  propertyForm.longitude || String(DEFAULT_PROPERTY_MAP_LNG)
                )}
                className="w-full h-[320px]"
                loading="lazy"
              />
            </div>
            <a
              href={getGoogleMapUrl(
                propertyForm.latitude || String(DEFAULT_PROPERTY_MAP_LAT),
                propertyForm.longitude || String(DEFAULT_PROPERTY_MAP_LNG)
              )}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary hover:underline"
            >
              Open current GPS on Google Maps
            </a>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsMapConfirmOpen(false)
                setPendingSubmitMode(null)
              }}
            >
              Cancel
            </Button>
            <Button onClick={confirmMapAndSubmit}>Confirm & Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAddApartmentNameOpen}
        onOpenChange={(open) => {
          setIsAddApartmentNameOpen(open)
          if (!open) setApartmentNameDraft('')
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add property name</DialogTitle>
            <DialogDescription>
              Save a building or condominium name to reuse when adding apartment-type properties.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="apartment-name-draft">Building / condo name</Label>
            <Input
              id="apartment-name-draft"
              value={apartmentNameDraft}
              onChange={(e) => setApartmentNameDraft(e.target.value)}
              placeholder="e.g., The Mews KLCC"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitNewApartmentName()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsAddApartmentNameOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={commitNewApartmentName}>
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkBindOpen}
        onOpenChange={(open) => {
          setBulkBindOpen(open)
          if (!open) setBulkBindClientId('')
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk bind client</DialogTitle>
            <DialogDescription>
              Send a binding request for {selectedPropertyIds.size} selected propert
              {selectedPropertyIds.size === 1 ? 'y' : 'ies'}. Clients confirm in the client portal (same as
              single-property bind).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="bulk-bind-client">Client</Label>
            <Select value={bulkBindClientId || '__none__'} onValueChange={(v) => setBulkBindClientId(v === '__none__' ? '' : v)}>
              <SelectTrigger id="bulk-bind-client" className="w-full">
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select client…</SelectItem>
                {bookingClients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.email ? ` (${c.email})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bookingClients.length === 0 ? (
              <p className="text-sm text-muted-foreground">No linked clients. Link clients under Contacts first.</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={bulkWorking} onClick={() => setBulkBindOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={bulkWorking || !bulkBindClientId} onClick={() => void runBulkBindClient()}>
              {bulkWorking ? 'Working…' : 'Send binding requests'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkDisconnectOpen} onOpenChange={setBulkDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect client (remove client) on {selectedBulkDisconnectClientCount} propert
              {selectedBulkDisconnectClientCount === 1 ? 'y' : 'ies'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Only applies to units you created (operator-owned). Clears the B2B client binding and label. That client will
              no longer see these properties in their portal. Your operator row stays so you can bind another client (same
              as Disconnect in the editor). For client-created units, use Remove operator / Remove from my list instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkWorking}
              onClick={(e) => {
                e.preventDefault()
                void runBulkDisconnectClient()
              }}
            >
              {bulkWorking ? 'Working…' : 'Disconnect client (remove client)'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkRemoveOperatorOpen} onOpenChange={setBulkRemoveOperatorOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove operator from {selectedBulkRemoveOperatorCount} propert
              {selectedBulkRemoveOperatorCount === 1 ? 'y' : 'ies'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Clears your operator link on each row. If a property still has a B2B client, the client keeps it and can bind
              another operator. If it had no client, the property row is deleted. Client-created properties are never
              deleted—only unlinked from your list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkWorking}
              onClick={(e) => {
                e.preventDefault()
                void runBulkRemoveOperator()
              }}
            >
              {bulkWorking ? 'Working…' : 'Remove operator'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deletePropertyDialogOpen}
        onOpenChange={(open) => {
          setDeletePropertyDialogOpen(open)
          if (!open) {
            setPendingDeleteProperty(null)
            setDeletePropertyPhase(1)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletePropertyPhase === 1 ? 'Permanently delete this property?' : 'Final confirmation'}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              {deletePropertyPhase === 1 ? (
                <>
                  <p>
                    Only archived operator-owned units can be deleted. This removes the row from your list and deletes the
                    database record when the server allows (same rules as before).
                  </p>
                  <p className="font-medium text-foreground">You will be asked to confirm again on the next step.</p>
                </>
              ) : (
                <p>
                  Last step: delete cannot be undone. Neither portal should keep this row after a successful delete (per
                  server rules). Confirm permanent deletion?
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            {deletePropertyPhase === 2 ? (
              <Button
                type="button"
                variant="outline"
                disabled={deletePropertyWorking}
                onClick={() => setDeletePropertyPhase(1)}
              >
                Back
              </Button>
            ) : null}
            <AlertDialogCancel type="button" disabled={deletePropertyWorking}>
              Cancel
            </AlertDialogCancel>
            {deletePropertyPhase === 1 ? (
              <AlertDialogAction
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  setDeletePropertyPhase(2)
                }}
              >
                Continue
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                type="button"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:ring-destructive"
                disabled={deletePropertyWorking}
                onClick={(e) => {
                  e.preventDefault()
                  void runConfirmedDeleteProperty()
                }}
              >
                {deletePropertyWorking ? 'Working…' : 'Delete permanently'}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removeFromListOpen}
        onOpenChange={(open) => {
          setRemoveFromListOpen(open)
          if (!open) setPendingRemoveFromList(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from your list?</AlertDialogTitle>
            <AlertDialogDescription>
              This client-registered unit stays with the client. You will unlink your operator from it (same as bulk
              &quot;Remove operator&quot; for one row). The client still sees their property.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeFromListWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeFromListWorking}
              onClick={(e) => {
                e.preventDefault()
                void runRemoveOperatorFromClientProperty()
              }}
            >
              {removeFromListWorking ? 'Working…' : 'Remove from my list'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={transferToClientOpen}
        onOpenChange={(open) => {
          setTransferToClientOpen(open)
          if (!open) setPendingTransferToClient(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer ownership to client?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <p>
                This unit has a bound B2B client. After transfer, the row becomes <strong>client-managed</strong>: the
                client edits name, address, keys and security in their portal (your operator edit form will be limited,
                same as other client-registered units).
              </p>
              <p>Your operator can stay linked for scheduling and service unless you remove yourself later.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transferToClientWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={transferToClientWorking}
              onClick={(e) => {
                e.preventDefault()
                void runTransferOwnershipToClient()
              }}
            >
              {transferToClientWorking ? 'Working…' : 'Transfer to client'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CleanlemonDoorOpenDialog
        open={doorOpenPayload != null}
        onOpenChange={(v) => {
          if (!v) setDoorOpenPayload(null)
        }}
        title={doorOpenPayload?.title}
        operatorDoorAccessMode={doorOpenPayload?.operatorDoorAccessMode}
        smartdoorGatewayReady={doorOpenPayload?.smartdoorGatewayReady}
        hasBookingToday={doorOpenPayload?.hasBookingToday}
        mailboxPassword={doorOpenPayload?.mailboxPassword}
        smartdoorPassword={doorOpenPayload?.smartdoorPassword}
        onUnlock={async () => {
          const p = doorOpenPayload
          if (!p?.smartdoorId) {
            return { ok: false, reason: 'No smart lock linked to this property.' }
          }
          const email = String(user?.email || '')
            .trim()
            .toLowerCase()
          if (!email) {
            return { ok: false, reason: 'Sign in again to unlock.' }
          }
          return clnUnlockSmartDoor('operator', { email, operatorId }, p.smartdoorId)
        }}
      />
    </div>
  )
}
