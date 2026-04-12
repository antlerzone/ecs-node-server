"use client"

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Map,
  List,
  Search,
  Link2,
  Unlink,
  ChevronDown,
  ChevronsUpDown,
  Loader2,
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
} from '@/lib/cleanlemon-api'
import { useAuth } from '@/lib/auth-context'

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
  securitySystem: 'icare' | 'ecommunity'
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
  securitySystem: Property['securitySystem']
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

const PROPERTY_LIST_PAGE_SIZES = [10, 20, 50, 100, 200, 500] as const

function mapApiRowToProperty(row: Record<string, unknown>): Property {
  const secRaw = String(row.securitySystem || '').trim().toLowerCase()
  const securitySystem = secRaw === 'ecommunity' ? ('ecommunity' as const) : ('icare' as const)
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
    status: 'active' as const,
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
  const [propertyListPageSize, setPropertyListPageSize] = useState(10)
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
    cleaningPriceByType: {},
    estimatedTime: '',
    latitude: '',
    longitude: '',
    checklist: [],
  })

  const reloadProperties = useCallback(async () => {
    const r = await fetchOperatorProperties(operatorId)
    if (!r?.ok) return
    setProperties((r.items || []).map((row: Record<string, unknown>) => mapApiRowToProperty(row)))
  }, [operatorId])

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
      securitySystem: property.securitySystem,
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

  const columns: Column<Property>[] = [
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
      render: (value) => <span className="text-sm">{String(value || '-')}</span>,
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

  const actions: Action<Property>[] = [
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
      label: 'Delete',
      icon: <Trash2 className="h-4 w-4 mr-2" />,
      variant: 'destructive',
      onClick: async (row) => {
        const r = await deleteOperatorProperty(row.id, operatorId)
        if (!r?.ok) {
          toast.error(
            r?.reason === 'OPERATOR_MISMATCH'
              ? 'This property belongs to another operator.'
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
      },
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
      toast.message('Clients may need to approve binding under Approvals.')
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
      toast.success(`Disconnected client on ${ok} propert${ok === 1 ? 'y' : 'ies'} (you can bind another client).`)
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
    const next = toPropertyPayload(editingPropertyId, 'active')
    const patch: Record<string, unknown> = {
      operatorId,
      name: next.name,
      address: next.address,
      unitNumber: next.unitNumber,
      client: next.client,
      team: '',
      premisesType: propertyForm.siteKind,
      securitySystem: propertyForm.securitySystem,
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

      const validPoints = properties.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
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
    }

    void initMap()

    return () => {
      cancelled = true
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
    }
  }, [properties, viewMode])

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Property Management</h2>
          <p className="text-muted-foreground">Manage all your service locations</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground mr-1">{properties.length} registered</span>
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
                <div className="space-y-2">
                  <Label htmlFor="site-kind">Premises type</Label>
                  <Select
                    value={propertyForm.siteKind}
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
                    onChange={(e) => setPropertyForm({ ...propertyForm, unitNumber: e.target.value })}
                    placeholder="e.g., A-12 / Level 8"
                  />
                </div>
                <div className="space-y-3">
                  <Label>Key Collection</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2 border rounded-md p-3">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={propertyForm.keyCollection.mailboxPassword}
                          onCheckedChange={(checked) =>
                            setPropertyForm({
                              ...propertyForm,
                              keyCollection: { ...propertyForm.keyCollection, mailboxPassword: !!checked },
                            })
                          }
                        />
                        Mailbox Password
                      </label>
                      {propertyForm.keyCollection.mailboxPassword && (
                        <Input
                          value={propertyForm.mailboxPasswordValue}
                          onChange={(e) => setPropertyForm({ ...propertyForm, mailboxPasswordValue: e.target.value })}
                          placeholder="Mailbox password"
                        />
                      )}
                    </div>
                    <div className="space-y-2 border rounded-md p-3">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={propertyForm.keyCollection.smartdoorPassword}
                          onCheckedChange={(checked) =>
                            setPropertyForm({
                              ...propertyForm,
                              keyCollection: { ...propertyForm.keyCollection, smartdoorPassword: !!checked },
                            })
                          }
                        />
                        Smartdoor (Password)
                      </label>
                      {propertyForm.keyCollection.smartdoorPassword && (
                        <Input
                          value={propertyForm.smartdoorPasswordValue}
                          onChange={(e) => setPropertyForm({ ...propertyForm, smartdoorPasswordValue: e.target.value })}
                          placeholder="Smartdoor password"
                        />
                      )}
                    </div>
                    <div className="space-y-2 border rounded-md p-3 md:col-span-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={propertyForm.keyCollection.smartdoorToken}
                          onCheckedChange={(checked) =>
                            setPropertyForm({
                              ...propertyForm,
                              keyCollection: { ...propertyForm.keyCollection, smartdoorToken: !!checked },
                            })
                          }
                        />
                        Smartdoor (Token)
                      </label>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Security System</Label>
                  <Select
                    value={propertyForm.securitySystem}
                    onValueChange={(value: Property['securitySystem']) => setPropertyForm({ ...propertyForm, securitySystem: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="icare">icare</SelectItem>
                      <SelectItem value="ecommunity">ecommunity</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>After Clean Photo Sample (Preview Required)</Label>
                  <Input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'afterCleanPhotoSample')} />
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
                  <Input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'keyPhoto')} />
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
                <Button onClick={() => openMapConfirmBeforeSubmit(editingPropertyId ? 'edit' : 'add')}>
                  {editingPropertyId ? 'Save Changes' : 'Add Property'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {Object.entries(typeIcons).map(([type, Icon]) => {
          const count = properties.filter(p => p.type === type).length
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
        <Card>
          <CardHeader>
            <CardTitle>All Properties</CardTitle>
            <CardDescription>{properties.length} properties registered</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Label htmlFor="property-list-page-size" className="text-sm text-muted-foreground whitespace-nowrap">
                Show
              </Label>
              <Select
                value={String(propertyListPageSize)}
                onValueChange={(v) => setPropertyListPageSize(Number(v) || 10)}
              >
                <SelectTrigger id="property-list-page-size" className="w-[100px] h-9">
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
            {selectedPropertyIds.size > 0 ? (
              <p className="text-sm text-muted-foreground">
                {selectedPropertyIds.size} selected
                {selectedBulkDisconnectClientCount > 0 || selectedBulkRemoveOperatorCount > 0
                  ? ` · ${selectedBulkDisconnectClientCount} can disconnect client · ${selectedBulkRemoveOperatorCount} can remove operator`
                  : null}
              </p>
            ) : null}
            <DataTable
              data={properties}
              columns={columns}
              actions={actions}
              searchKeys={['name', 'address', 'client']}
              pageSize={propertyListPageSize}
              emptyMessage="No properties found. Add your first property."
              rowSelection={{
                selectedIds: selectedPropertyIds,
                onSelectionChange: setSelectedPropertyIds,
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Property Map</CardTitle>
            <CardDescription>View all properties on the map</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-[500px] bg-muted rounded-lg overflow-hidden">
              <div ref={mapContainerRef} className="absolute inset-0" />
              
              {/* Property List Overlay */}
              <div className="absolute z-[1000] top-4 left-4 w-72 max-h-[calc(100%-2rem)] bg-card rounded-lg shadow-lg border overflow-hidden">
                <div className="p-3 border-b">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search properties..." className="pl-9 h-9" />
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {properties.map((property) => {
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
              {selectedPropertyIds.size === 1 ? 'y' : 'ies'}. Clients may need to approve under Approvals (same as
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
              Only applies to properties you created. Clears the B2B client binding and client name; your operator stays on
              the property so you can bind another client (same as Disconnect in the editor). Use &quot;Bulk delete
              (remove operator)&quot; to drop client-created links or remove yourself entirely.
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
    </div>
  )
}
