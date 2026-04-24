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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  Map as MapIcon,
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
  Users,
  ExternalLink,
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
  fetchCleanlemonPricingConfig,
  fetchOperatorPropertyGroups,
  fetchOperatorPropertyGroupDetail,
  createOperatorPropertyGroup,
  addPropertiesToOperatorGroup,
  removePropertyFromOperatorGroup,
  deleteOperatorPropertyGroup,
  fetchOperatorTeams,
  type CleanlemonPricingConfig,
  type CleanlemonSmartdoorBindingsDetail,
  type OperatorPropertyGroupRow,
} from '@/lib/cleanlemon-api'
import { PRICING_SERVICES, type ServiceKey } from '@/lib/cleanlemon-pricing-services'
import { useAuth } from '@/lib/auth-context'
import { CleanlemonDoorOpenDialog } from '@/components/cleanlemons/cleanlemon-door-open-dialog'
import { CleanlemonPropertyNativeLocksPanel } from '@/components/cleanlemons/cleanlemon-property-native-locks-panel'
import { normalizeDamageAttachmentUrl } from '@/lib/media-url-kind'

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
  cleaningTypes: string[]
  keyCollection: {
    mailboxPassword: string
    smartdoorPassword: string
    smartdoorToken: string
  }
  remark?: string
  /** Estimated job duration in whole minutes (same as DB `min_value`). */
  estimatedTime?: string
  /** Display line for table / detail (derived). */
  cleaningPriceSummary: string
  operatorCleaningPricingLine?: string
  operatorCleaningPriceMyr?: number | null
  /** Pricing "Services provider" key (general, homestay, …). */
  operatorCleaningPricingService?: string
  /** Saved multi-row cleaning prices (when API returns them). */
  operatorCleaningPricingRows?: Array<{ service: string; line: string; myr: number | null }>
  /** Operator-only group name (separate from client groups). */
  operatorPropertyGroupName?: string
  /** `cln_property.team` — default cleaning team (name matches `cln_operator_team.name`). */
  team?: string
  operatorDoorAccessMode?: string
  afterCleanPhotoSample?: string
  keyPhoto?: string
  checklist: ChecklistItem[]
  lastCleaned?: string
  bedCount?: number | null
  roomCount?: number | null
  bathroomCount?: number | null
  kitchen?: number | null
  livingRoom?: number | null
  balcony?: number | null
  staircase?: number | null
  liftLevel?: string | null
  specialAreaCount?: number | null
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

/** Map overview popups — escape user text for innerHTML. */
function escapeHtmlForMapPopup(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * List / map label: building name → unit → id snippet (DB `property_name` can be empty after bulk/import;
 * confirm pin does not set names).
 */
function propertyDisplayName(p: { id?: string; name?: string; unitNumber?: string }): string {
  const n = String(p.name ?? '').trim()
  if (n) return n
  const u = String(p.unitNumber ?? '').trim()
  if (u) return u
  const id = String(p.id ?? '').trim()
  if (id) return id.length > 14 ? `${id.slice(0, 10)}…` : id
  return '—'
}

/** Red when there is a building name or unit but no address (id-only label stays neutral). */
function propertyNameWarnMissingAddress(p: { name?: string; unitNumber?: string; address?: string }): boolean {
  const hasBuildingOrUnit = !!String(p.name ?? '').trim() || !!String(p.unitNumber ?? '').trim()
  return hasBuildingOrUnit && !String(p.address ?? '').trim()
}

/** Group list row: show name, or id when name is empty. */
function propertyGroupMemberLabel(p: { id: string; name?: string }): string {
  const n = String(p.name ?? '').trim()
  return n || p.id
}

/** Group list row: red only when a real name exists but address is missing. */
function propertyGroupMemberNameWarn(p: { name?: string; address?: string }): boolean {
  return !!String(p.name ?? '').trim() && !String(p.address ?? '').trim()
}

/** MySQL / JSON sometimes delivers DECIMAL as string — `Number.isFinite('1.2')` is false without this. */
function toOverviewMapNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : NaN
}

/**
 * Map overview: saved WGS84 on the row, else lat/lng embedded in Waze/Google URLs (`ll=` / `@lat,lng`).
 * Search-only links (`?q=address`) do not count — returns null so we do not fake pins (matches Coliving list/map).
 */
function overviewLatLngForProperty(p: Pick<Property, 'lat' | 'lng' | 'wazeUrl' | 'googleMapsUrl'>): {
  lat: number
  lng: number
} | null {
  const lat = toOverviewMapNumber(p.lat)
  const lng = toOverviewMapNumber(p.lng)
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  ) {
    return { lat, lng }
  }
  return parseLatLngFromNavigationUrls(String(p.wazeUrl || ''), String(p.googleMapsUrl || ''))
}

/** Group units that share the same saved WGS84 (e.g. many apartments at one pin). */
function overviewCoordGroupKey(lat: number, lng: number): string {
  return `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`
}

function overviewMapPinColorForProperties(properties: Property[]): string {
  const act = properties.filter((p) => p.status === 'active').length
  const inact = properties.length - act
  if (inact === 0) return '#16a34a'
  if (act === 0) return '#94a3b8'
  return '#d97706'
}

function buildCleanlemonOverviewMapPopupHtml(
  properties: Property[],
  googleHref: (p: Property) => string
): string {
  const cardHtml = (p: Property, isLast: boolean) => {
    const gm = escapeHtmlForMapPopup(googleHref(p))
    const wz = String(p.wazeUrl || '').trim()
    const wazeLink = wz ? `<a href="${escapeHtmlForMapPopup(wz)}" target="_blank" rel="noopener noreferrer">Waze</a> · ` : ''
    const st = p.status === 'active' ? 'Active' : 'Inactive'
    const stColor = p.status === 'active' ? '#16a34a' : '#64748b'
    const sep = isLast ? '' : 'border-bottom:1px solid #e5e7eb;margin-bottom:8px;padding-bottom:8px;'
    return `<div style="${sep}"><strong>${escapeHtmlForMapPopup(propertyDisplayName(p))}</strong><br/><span style="color:#666;font-size:12px">${escapeHtmlForMapPopup(p.address || '—')}</span><br/><span style="font-size:11px;color:#64748b">Unit ${escapeHtmlForMapPopup(p.unitNumber || '—')} · <span style="color:${stColor}">${st}</span></span><br/><span style="display:block;margin-top:6px;font-size:12px">${wazeLink}<a href="${gm}" target="_blank" rel="noopener noreferrer">Google Maps</a></span></div>`
  }
  const inner = properties.map((p, i) => cardHtml(p, i === properties.length - 1)).join('')
  if (properties.length <= 1) {
    return `<div style="min-width:180px;font-size:13px">${inner}</div>`
  }
  return `<div style="min-width:200px;max-width:300px;font-size:13px"><div style="max-height:260px;overflow-y:auto;overflow-x:hidden;padding-right:6px;-webkit-overflow-scrolling:touch">${inner}</div></div>`
}

/**
 * Apartment "Property name" is building / condo only. Strip trailing " (…)" from DB rows that stored unit/room labels.
 * e.g. "Aliff Residences (… Balcony Room)" → "Aliff Residences"
 */
function apartmentBuildingDisplayName(raw: string): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const i = s.indexOf(' (')
  if (i === -1) return s
  const left = s.slice(0, i).trim()
  return left || s
}

/** `cln_property.id` is UUID-shaped; never use that as a human-readable building/property name in bulk flows. */
function looksLikeClnPropertyIdString(s: string): boolean {
  const t = String(s ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)
}

/** Seed / patch: drop id-shaped garbage so bulk edit does not overwrite every row with a UUID. */
function sanitizedOperatorPropertyDisplayNameForBulk(
  raw: string,
  opts?: { rowId?: string; selectedIds?: Set<string> }
): string {
  const t = String(raw ?? '').trim()
  if (!t) return ''
  const rowId = String(opts?.rowId ?? '').trim()
  if (rowId && t === rowId) return ''
  if (opts?.selectedIds?.size && opts.selectedIds.has(t)) return ''
  if (looksLikeClnPropertyIdString(t)) return ''
  return t
}

function filterDistinctPropertyNameList(items: unknown[]): string[] {
  return items
    .map((x: unknown) => String(x).trim())
    .filter(Boolean)
    .filter((n) => !looksLikeClnPropertyIdString(n))
}

function inferSiteKind(property: Property, apartmentNames: string[]): SiteKind {
  const n = String(property.name || '').trim()
  const nBuilding = apartmentBuildingDisplayName(n)
  if (
    n &&
    apartmentNames.some((x) => {
      const x0 = String(x).trim()
      return x0 === n || x0 === nBuilding
    })
  ) {
    return 'apartment'
  }
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

function normalizeOperatorDoorAccessMode(raw: string | undefined): string {
  const modeRaw = String(raw || '')
    .trim()
    .toLowerCase()
  return ['full_access', 'temporary_password_only', 'working_date_only', 'fixed_password'].includes(modeRaw)
    ? modeRaw
    : 'temporary_password_only'
}

/** One row in the cleaning price dialog (service + MYR; `line` is unused and always cleared for API). */
interface CleaningPricingRowForm {
  service: string
  line: string
  myr: string
}

function defaultCleaningPricingRow(): CleaningPricingRowForm {
  return { service: 'general', line: '', myr: '' }
}

function normalizeCleaningRowsFromProperty(property: Property): CleaningPricingRowForm[] {
  const raw = property.operatorCleaningPricingRows
  const stripLine = (rows: CleaningPricingRowForm[]) => rows.map((r) => ({ ...r, line: '' }))
  if (Array.isArray(raw) && raw.length > 0) {
    return stripLine(
      raw.map((r) => ({
        service: String(r.service || 'general').trim() || 'general',
        line: String(r.line || '').trim(),
        myr: r.myr != null && Number.isFinite(Number(r.myr)) ? String(r.myr) : '',
      }))
    )
  }
  const opSvc = String(property.operatorCleaningPricingService || '').trim()
  const opPrice =
    property.operatorCleaningPriceMyr != null && Number.isFinite(Number(property.operatorCleaningPriceMyr))
      ? String(property.operatorCleaningPriceMyr)
      : ''
  return [{ service: opSvc || 'general', line: '', myr: opPrice }]
}

function withSyncedLegacyFromCleaningRows(prev: PropertyFormState, nextRows: CleaningPricingRowForm[]): PropertyFormState {
  const sanitized = nextRows.map((r) => ({ ...r, line: '' }))
  const first = sanitized[0]
  return {
    ...prev,
    operatorCleaningPricingRows: sanitized,
    operatorCleaningPricingService: first?.service || 'general',
    operatorCleaningPricingLine: '',
    operatorCleaningPriceMyr: first?.myr ?? '',
  }
}

function buildOperatorCleaningPricingRowsApiPayload(
  rows: CleaningPricingRowForm[]
): Array<{ service: string; line: string; myr: number | null }> {
  return rows.map((r) => {
    const t = String(r.myr || '').trim()
    const n = Number(t)
    const myr = t === '' ? null : Number.isFinite(n) && n >= 0 ? n : null
    return {
      service: String(r.service || 'general').trim() || 'general',
      line: '',
      myr,
    }
  })
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
  afterCleanPhotoSample?: string
  /** full_access | temporary_password_only | working_date_only | fixed_password */
  operatorDoorAccessMode: string
  /** Multi-row editing; legacy single fields below mirror row 0 for saves/API compatibility. */
  operatorCleaningPricingRows: CleaningPricingRowForm[]
  operatorCleaningPricingLine: string
  operatorCleaningPriceMyr: string
  operatorCleaningPricingService: string
  estimatedTime: string
  keyPhoto?: string
  latitude: string
  longitude: string
  checklist: ChecklistItem[]
  bedCount: string
  roomCount: string
  bathroomCount: string
  kitchen: string
  livingRoom: string
  balcony: string
  staircase: string
  liftLevel: string
  specialAreaCount: string
  /** `cln_operator_team.id`; empty = unassigned. */
  bindingTeamId: string
}

/** Smartdoor (Token) is checkbox-only (no text field); non-empty marks enabled in `Property.keyCollection`. */
const SMARTDOOR_TOKEN_ENABLED_MARKER = '1'

/** Coliving Operator portal — Property → Edit utility (smart door binding lives on `propertydetail`). */
const COLIVING_PORTAL_ORIGIN = (
  process.env.NEXT_PUBLIC_COLIVING_PORTAL_ORIGIN || 'https://portal.colivingjb.com'
).replace(/\/$/, '')

function detailNumToForm(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : ''
}

function formDetailOptInt(s: string): number | undefined {
  const t = String(s ?? '').trim()
  if (t === '') return undefined
  const n = parseInt(t, 10)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

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

/** Initial pin for the post-save map dialog (saved coords → nav URLs → JB default). */
function resolveMapConfirmInitialCoordsFromForm(form: PropertyFormState): { lat: number; lng: number } {
  const laS = String(form.latitude || '').trim()
  const loS = String(form.longitude || '').trim()
  if (laS && loS && !isLegacyKualaLumpurPlaceholder(laS, loS)) {
    const la = Number(laS)
    const lo = Number(loS)
    if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
      return { lat: la, lng: lo }
    }
  }
  const parsed = parseLatLngFromNavigationUrls(form.wazeUrl, form.googleMapsUrl)
  if (parsed) return parsed
  return { lat: DEFAULT_PROPERTY_MAP_LAT, lng: DEFAULT_PROPERTY_MAP_LNG }
}

/** Bulk-edit map seed: explicit OSM pick → else nav links from address text → JB default. */
function resolveMapConfirmInitialCoordsFromBulkFields(
  address: string,
  latStr: string,
  lngStr: string
): { lat: number; lng: number } {
  const la = Number(String(latStr || '').trim())
  const lo = Number(String(lngStr || '').trim())
  if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
    return { lat: la, lng: lo }
  }
  const nav = navigationUrlsFromPlainAddress(String(address || '').trim())
  if (nav) {
    const p = parseLatLngFromNavigationUrls(nav.wazeUrl, nav.googleMapsUrl)
    if (p) return p
  }
  return { lat: DEFAULT_PROPERTY_MAP_LAT, lng: DEFAULT_PROPERTY_MAP_LNG }
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

/**
 * Parse legacy estimate strings (`2h 30m`, plain digits) into minutes — mirrors
 * `parseClnEstimateTimeInputToMinutes` in cleanlemon.service.js.
 */
function parseEstimateTextToMinutes(raw: string): number | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  let total = 0
  const hMatch = s.match(/(\d+)\s*h/)
  const mMatch = s.match(/(\d+)\s*m/)
  if (hMatch) total += parseInt(hMatch[1], 10) * 60
  if (mMatch) total += parseInt(mMatch[1], 10)
  if (hMatch || mMatch) return total
  const n = Number(s)
  if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  return null
}

/** List row: show + edit as integer minutes (`min_value` or legacy API label). */
function estimateTimeMinutesFromRow(row: Record<string, unknown>): string {
  const mv = row.minValue
  if (mv != null && mv !== '') {
    const mins = Math.floor(Number(mv))
    if (Number.isFinite(mins) && mins > 0) return String(mins)
  }
  const et = String(row.estimatedTime ?? '').trim()
  if (!et) return ''
  const p = parseEstimateTextToMinutes(et)
  return p != null && p > 0 ? String(p) : ''
}

/** GET detail → form field (minutes only). */
function estimateTimeMinutesFromDetail(rp: { estimatedTime?: unknown; min_value?: unknown; minValue?: unknown }): string {
  const rawMin = rp.minValue ?? rp.min_value
  if (rawMin != null && String(rawMin).trim() !== '') {
    const mins = Math.floor(Number(rawMin))
    if (Number.isFinite(mins) && mins > 0) return String(mins)
  }
  const p = parseEstimateTextToMinutes(String(rp.estimatedTime ?? ''))
  return p != null && p > 0 ? String(p) : ''
}

/** PUT/POST: minutes as digits, or empty string to clear `min_value`. */
function coerceEstimatedTimeMinutesForApi(formVal: string): string {
  const t = String(formVal ?? '').trim()
  if (!t) return ''
  const n = parseInt(t, 10)
  return Number.isFinite(n) && n >= 0 ? String(n) : ''
}

function teamIdFromPropertyTeamName(
  teamName: string | undefined,
  teams: { id: string; name: string }[]
): string {
  const t = String(teamName ?? '').trim()
  if (!t || teams.length === 0) return ''
  const hit = teams.find((x) => String(x.name ?? '').trim() === t)
  return hit ? String(hit.id) : ''
}

/** Add Wix legacy columns as pricing rows when missing (same order as API merge). */
function mergeWixLegacyCleaningPriceRows(
  rows: Array<{ service: string; line: string; myr: number | null }>,
  row: Record<string, unknown>
) {
  const out = [...rows]
  const seen = new Set(out.map((r) => String(r.service || '').trim().toLowerCase()).filter(Boolean))
  const add = (service: string, raw: unknown) => {
    const sk = String(service || '').trim().toLowerCase()
    if (!sk || seen.has(sk)) return
    if (raw == null || raw === '') return
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return
    out.push({ service: sk, line: '', myr: n })
    seen.add(sk)
  }
  add('warm', row.warmCleaning)
  add('deep', row.deepCleaning)
  add('general', row.generalCleaning)
  add('renovation', row.renovationCleaning)
  add('homestay', row.cleaningFees)
  return out
}

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
    name: String(row.name ?? '').trim(),
    address: String(row.address || ''),
    unitNumber: String(row.unitNumber || ''),
    type: tableType,
    client: String(row.client || ''),
    team: String(row.team ?? '').trim(),
    clientdetailId: String(row.clientdetailId || '').trim(),
    clientPortalOwned: Number(row.clientPortalOwned) === 1,
    linkedOperatorId: String(row.operatorId ?? row.operator_id ?? '').trim(),
    premisesType: String(row.premisesType || '').trim(),
    operatorPortalArchived: Number(row.operatorPortalArchived) === 1,
    status: (Number(row.operatorPortalArchived) === 1 ? 'inactive' : 'active') as Property['status'],
    ...(() => {
      const rawLat =
        row.latitude ??
        (row as { Latitude?: unknown }).Latitude ??
        (row as { lat?: unknown }).lat
      const rawLng =
        row.longitude ??
        (row as { Longitude?: unknown }).Longitude ??
        (row as { lng?: unknown }).lng
      const dbLat = rawLat != null && rawLat !== '' ? Number(rawLat) : NaN
      const dbLng = rawLng != null && rawLng !== '' ? Number(rawLng) : NaN
      if (
        Number.isFinite(dbLat) &&
        Number.isFinite(dbLng) &&
        Math.abs(dbLat) <= 90 &&
        Math.abs(dbLng) <= 180 &&
        !(dbLat === 0 && dbLng === 0)
      ) {
        return { lat: Number(dbLat), lng: Number(dbLng) }
      }
      const wz = String(row.wazeUrl ?? (row as { waze_url?: unknown }).waze_url ?? '').trim()
      const gz = String(row.googleMapsUrl ?? (row as { google_maps_url?: unknown }).google_maps_url ?? '').trim()
      const parsed = parseLatLngFromNavigationUrls(wz, gz)
      if (parsed && !(parsed.lat === 0 && parsed.lng === 0)) {
        return { lat: parsed.lat, lng: parsed.lng }
      }
      return { lat: NaN, lng: NaN }
    })(),
    securitySystem,
    cleaningTypes: [] as string[],
    keyCollection: {
      mailboxPassword: String(row.mailboxPassword || ''),
      smartdoorPassword: String(row.smartdoorPassword || ''),
      smartdoorToken: tokenOn ? SMARTDOOR_TOKEN_ENABLED_MARKER : '',
    },
    ...(() => {
      const rowsJson = (row as { operatorCleaningPricingRows?: unknown }).operatorCleaningPricingRows
      let rows: Array<{ service: string; line: string; myr: number | null }> = []
      if (Array.isArray(rowsJson) && rowsJson.length) {
        rows = rowsJson.map((x: { service?: unknown; line?: unknown; myr?: unknown }) => {
          const svc = String(x?.service ?? '').trim() || 'general'
          const line = String(x?.line ?? '').trim()
          const n = Number(x?.myr)
          const myr = x?.myr != null && Number.isFinite(n) && n >= 0 ? n : null
          return { service: svc, line, myr }
        })
      } else {
        const opSvc = String(row.operatorCleaningPricingService ?? '').trim()
        const opLine = String(row.operatorCleaningPricingLine ?? '').trim()
        const opPriceRaw = row.operatorCleaningPriceMyr
        const opPrice = opPriceRaw != null ? Number(opPriceRaw) : NaN
        const hasPrice = Number.isFinite(opPrice) && opPrice >= 0
        if (opSvc || opLine || hasPrice) {
          rows = [{ service: opSvc || 'general', line: opLine, myr: hasPrice ? opPrice : null }]
        }
      }
      if (!rows.length) {
        const cf = row.cleaningFees
        const n = cf != null && cf !== '' ? Number(cf) : NaN
        if (Number.isFinite(n) && n >= 0) {
          rows = [{ service: 'homestay', line: '', myr: n }]
        }
      }
      rows = mergeWixLegacyCleaningPriceRows(rows, row).map((r) => ({ ...r, line: '' }))
      const rowSummaries = rows
        .map((r) => {
          const svcLabel = r.service
            ? PRICING_SERVICES.find((s) => s.key === (r.service as ServiceKey))?.label || r.service
            : ''
          const parts = [svcLabel, r.myr != null ? `RM ${r.myr}` : ''].filter(Boolean)
          return parts.join(' · ')
        })
        .filter(Boolean)
      const cleaningPriceSummary = rowSummaries.length ? rowSummaries.join(' | ') : ''
      const first = rows[0]
      return {
        cleaningPriceSummary,
        operatorCleaningPricingRows: rows,
        operatorCleaningPricingLine: '',
        operatorCleaningPriceMyr: first?.myr != null ? first.myr : null,
        operatorCleaningPricingService: first?.service ?? '',
        operatorPropertyGroupName: String(row.operatorPropertyGroupName ?? '').trim(),
      }
    })(),
    checklist: [],
    afterCleanPhotoSample: String(row.afterCleanPhotoUrl || ''),
    keyPhoto: String(row.keyPhotoUrl || ''),
    lastCleaned: (row.updated_at || row.created_at) as string | undefined,
    googleMapsUrl: String(row.googleMapsUrl || '').trim(),
    wazeUrl: String(row.wazeUrl || '').trim(),
    bedCount: row.bedCount != null && row.bedCount !== '' ? Number(row.bedCount) : null,
    roomCount: row.roomCount != null && row.roomCount !== '' ? Number(row.roomCount) : null,
    bathroomCount: row.bathroomCount != null && row.bathroomCount !== '' ? Number(row.bathroomCount) : null,
    kitchen: row.kitchen != null && row.kitchen !== '' ? Number(row.kitchen) : null,
    livingRoom: row.livingRoom != null && row.livingRoom !== '' ? Number(row.livingRoom) : null,
    balcony: row.balcony != null && row.balcony !== '' ? Number(row.balcony) : null,
    staircase: row.staircase != null && row.staircase !== '' ? Number(row.staircase) : null,
    liftLevel: row.liftLevel != null ? String(row.liftLevel).trim() : null,
    specialAreaCount:
      row.specialAreaCount != null && row.specialAreaCount !== '' ? Number(row.specialAreaCount) : null,
    estimatedTime: estimateTimeMinutesFromRow(row),
  }
}

function bulkUpdateBasePatch(p: Property): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    name: p.name,
    address: p.address,
    unitNumber: p.unitNumber,
    client: p.client,
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
  const [isPropertyDetailSaving, setIsPropertyDetailSaving] = useState(false)
  const [mapConfirmPinLabel, setMapConfirmPinLabel] = useState<{ lat: number; lng: number }>({
    lat: DEFAULT_PROPERTY_MAP_LAT,
    lng: DEFAULT_PROPERTY_MAP_LNG,
  })
  const [mapConfirmPatching, setMapConfirmPatching] = useState(false)
  /** Bulk edit with address: nothing is written until user confirms the map pin. */
  const [mapConfirmBulkDeferred, setMapConfirmBulkDeferred] = useState(false)
  const mapConfirmContainerRef = useRef<HTMLDivElement | null>(null)
  const mapConfirmLeafletMapRef = useRef<any>(null)
  const mapConfirmMarkerRef = useRef<any>(null)
  const mapConfirmInitialRef = useRef<{ lat: number; lng: number }>({
    lat: DEFAULT_PROPERTY_MAP_LAT,
    lng: DEFAULT_PROPERTY_MAP_LNG,
  })
  const pendingCoordsTargetRef = useRef<
    | null
    | { variant: 'single'; propertyId: string }
    | { variant: 'bulk'; propertyIds: string[]; deferredFullPatch?: Record<string, unknown> }
  >(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const leafletMapRef = useRef<any>(null)
  /** Property id → Leaflet marker (grouped pins share one marker). */
  const overviewMarkersByPropertyIdRef = useRef<Record<string, any>>({})
  const [mapSidebarSearch, setMapSidebarSearch] = useState('')
  const [selectedMapListPropertyId, setSelectedMapListPropertyId] = useState<string | null>(null)
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
  const [operatorPortalMainTab, setOperatorPortalMainTab] = useState<'properties' | 'groups'>('properties')
  const [operatorPropertyGroups, setOperatorPropertyGroups] = useState<OperatorPropertyGroupRow[]>([])
  /** Group view: multi-select (same pattern as client /portal/client/properties). */
  const [selectedOperatorGroupIds, setSelectedOperatorGroupIds] = useState<Set<string>>(new Set())
  const [opGroupExpandedId, setOpGroupExpandedId] = useState<string | null>(null)
  const [opGroupDetailById, setOpGroupDetailById] = useState<
    Record<
      string,
      {
        loading: boolean
        detail: {
          id: string
          name: string
          properties: Array<{ id: string; name: string; address: string }>
        } | null
      }
    >
  >({})
  const [operatorGroupCreateOpen, setOperatorGroupCreateOpen] = useState(false)
  const [operatorNewGroupName, setOperatorNewGroupName] = useState('')
  const [operatorGroupCreating, setOperatorGroupCreating] = useState(false)
  const [addToOperatorGroupOpen, setAddToOperatorGroupOpen] = useState(false)
  const [addToOperatorGroupPickId, setAddToOperatorGroupPickId] = useState('')
  const [addToOperatorGroupBusy, setAddToOperatorGroupBusy] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkEditWorking, setBulkEditWorking] = useState(false)
  const [bulkEditUsePropertySection, setBulkEditUsePropertySection] = useState(false)
  const [bulkEditSiteKind, setBulkEditSiteKind] = useState<SiteKind>('landed')
  const [bulkEditName, setBulkEditName] = useState('')
  const [bulkEditPropertyAddress, setBulkEditPropertyAddress] = useState('')
  const [bulkEditLatitude, setBulkEditLatitude] = useState('')
  const [bulkEditLongitude, setBulkEditLongitude] = useState('')
  const [bulkBuildingComboOpen, setBulkBuildingComboOpen] = useState(false)
  const [bulkBuildingNameInput, setBulkBuildingNameInput] = useState('')
  const [bulkAddressSuggestOpen, setBulkAddressSuggestOpen] = useState(false)
  const [bulkAddressSearchItems, setBulkAddressSearchItems] = useState<
    Array<{ displayName: string; lat: string; lon: string; placeId: string }>
  >([])
  const [bulkAddressSearchLoading, setBulkAddressSearchLoading] = useState(false)
  const bulkAddressSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bulkAddressFieldWrapRef = useRef<HTMLDivElement | null>(null)
  const [bulkEditService, setBulkEditService] = useState('general')
  const [bulkEditPrice, setBulkEditPrice] = useState('')
  const [bulkEditUsePricing, setBulkEditUsePricing] = useState(false)
  const [bulkEditUseTeam, setBulkEditUseTeam] = useState(false)
  const [bulkEditTeamId, setBulkEditTeamId] = useState('')
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
  /** Add-property flow: credentials chosen before create (same idea as Coliving operator property). */
  const [insertSecurityCredentials, setInsertSecurityCredentials] = useState<Record<string, unknown> | null>(null)
  const [secCredModalFromAdd, setSecCredModalFromAdd] = useState(false)
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
  /** `cln_property.team` name at open — save sends `teamId` only when the chosen team name differs. */
  const teamNameBaselineRef = useRef<string>('')
  /** Only send `operatorDoorAccessMode` on update when changed — avoids gateway validation when editing cleaning price only. */
  const operatorDoorAccessModeBaselineRef = useRef<string>('')

  const [operatorPricingConfig, setOperatorPricingConfig] = useState<CleanlemonPricingConfig | null>(null)
  const [editDialogSmartdoorBindings, setEditDialogSmartdoorBindings] =
    useState<CleanlemonSmartdoorBindingsDetail | null>(null)
  const [editDialogGatewayReady, setEditDialogGatewayReady] = useState(false)

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
    operatorDoorAccessMode: 'temporary_password_only',
    operatorCleaningPricingRows: [defaultCleaningPricingRow()],
    operatorCleaningPricingLine: '',
    operatorCleaningPriceMyr: '',
    operatorCleaningPricingService: 'general',
    estimatedTime: '',
    latitude: '',
    longitude: '',
    checklist: [],
    bindingTeamId: '',
  })

  const [operatorTeamsList, setOperatorTeamsList] = useState<Array<{ id: string; name: string }>>([])

  const reloadProperties = useCallback(async () => {
    const includeArchived = propertyArchiveFilter !== 'active'
    const r = await fetchOperatorProperties(operatorId, { includeArchived })
    if (!r?.ok) return
    setProperties((r.items || []).map((row: Record<string, unknown>) => mapApiRowToProperty(row)))
  }, [operatorId, propertyArchiveFilter])

  const loadOperatorPropertyGroups = useCallback(async () => {
    const r = await fetchOperatorPropertyGroups(operatorId)
    if (r?.ok && Array.isArray(r.items)) setOperatorPropertyGroups(r.items)
  }, [operatorId])

  const loadOperatorTeamsList = useCallback(async () => {
    const r = await fetchOperatorTeams(operatorId)
    if (!r?.ok || !Array.isArray(r.items)) {
      setOperatorTeamsList([])
      return
    }
    setOperatorTeamsList(
      r.items.map((t: { id?: string; name?: string }) => ({
        id: String(t.id || '').trim(),
        name: String(t.name || '').trim(),
      })).filter((t: { id: string }) => !!t.id)
    )
  }, [operatorId])

  useEffect(() => {
    void reloadProperties()
  }, [reloadProperties])

  useEffect(() => {
    void loadOperatorPropertyGroups()
  }, [loadOperatorPropertyGroups])

  useEffect(() => {
    void loadOperatorTeamsList()
  }, [loadOperatorTeamsList])

  useEffect(() => {
    if (!isAddDialogOpen || !operatorId) return
    let cancelled = false
    void (async () => {
      const r = await fetchCleanlemonPricingConfig(operatorId)
      if (cancelled || !r?.ok) return
      setOperatorPricingConfig(r.config ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [isAddDialogOpen, operatorId])

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

  const mapSidebarFilteredProperties = useMemo(() => {
    const q = mapSidebarSearch.trim().toLowerCase()
    if (!q) return visibleListProperties
    return visibleListProperties.filter((p) =>
      [p.name, p.address, p.client, p.unitNumber].some((x) =>
        String(x || '').toLowerCase().includes(q)
      )
    )
  }, [visibleListProperties, mapSidebarSearch])

  /** Saved WGS84 or URL-embedded coords — same rule as map markers. */
  const propertiesWithMapCoordinatesCount = useMemo(
    () => visibleListProperties.filter((p) => overviewLatLngForProperty(p) !== null).length,
    [visibleListProperties]
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
      setDbDistinctPropertyNames(filterDistinctPropertyNameList(r.items))
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
      setDbDistinctPropertyNames(filterDistinctPropertyNameList(r.items))
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
    const add = (raw: string) => {
      const t = apartmentBuildingDisplayName(String(raw).trim())
      if (t) s.add(t)
    }
    dbDistinctPropertyNames.forEach(add)
    apartmentPropertyNames.forEach(add)
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [dbDistinctPropertyNames, apartmentPropertyNames])

  const mergedBuildingNames = useMemo(() => {
    const s = new Set<string>()
    apartmentNameChoices.forEach((n) => {
      const t = apartmentBuildingDisplayName(String(n).trim())
      if (t) s.add(t)
    })
    globalBuildingHints.forEach((raw) => {
      const t = apartmentBuildingDisplayName(String(raw).trim())
      if (t) s.add(t)
    })
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [apartmentNameChoices, globalBuildingHints])

  const filteredBuildingNames = useMemo(() => {
    const q = buildingNameInput.trim().toLowerCase()
    if (!q) return mergedBuildingNames
    return mergedBuildingNames.filter((n) => n.toLowerCase().includes(q))
  }, [mergedBuildingNames, buildingNameInput])

  const filteredBulkBuildingNames = useMemo(() => {
    const q = bulkBuildingNameInput.trim().toLowerCase()
    if (!q) return mergedBuildingNames
    return mergedBuildingNames.filter((n) => n.toLowerCase().includes(q))
  }, [mergedBuildingNames, bulkBuildingNameInput])

  useEffect(() => {
    if (!buildingComboOpen) return
    setBuildingNameInput(propertyForm.name)
  }, [buildingComboOpen, propertyForm.name])

  useEffect(() => {
    if (!bulkBuildingComboOpen) return
    setBulkBuildingNameInput(bulkEditName)
  }, [bulkBuildingComboOpen, bulkEditName])

  useEffect(() => {
    if (propertyForm.siteKind !== 'apartment' || !buildingComboOpen) return
    const oid = String(operatorId || '').trim()
    if (!oid) return
    const t = buildingNameInput.trim()
    let cancelled = false
    const id = window.setTimeout(() => {
      void (async () => {
        const r = await fetchGlobalPropertyNames({ operatorId: oid, q: t, limit: 80 })
        if (cancelled || !r?.ok || !Array.isArray(r.items)) return
        setGlobalBuildingHints(filterDistinctPropertyNameList(r.items))
      })()
    }, 380)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [buildingNameInput, propertyForm.siteKind, buildingComboOpen, operatorId])

  useEffect(() => {
    if (bulkEditSiteKind !== 'apartment' || !bulkBuildingComboOpen) return
    const oid = String(operatorId || '').trim()
    if (!oid) return
    const t = bulkBuildingNameInput.trim()
    let cancelled = false
    const id = window.setTimeout(() => {
      void (async () => {
        const r = await fetchGlobalPropertyNames({ operatorId: oid, q: t, limit: 80 })
        if (cancelled || !r?.ok || !Array.isArray(r.items)) return
        setGlobalBuildingHints(filterDistinctPropertyNameList(r.items))
      })()
    }, 380)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [bulkBuildingNameInput, bulkEditSiteKind, bulkBuildingComboOpen, operatorId])

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
    const el = bulkAddressFieldWrapRef.current
    if (!el) return
    const onDoc = (e: MouseEvent) => {
      if (!bulkAddressSuggestOpen) return
      const t = e.target
      if (t instanceof Node && !el.contains(t)) setBulkAddressSuggestOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [bulkAddressSuggestOpen])

  useEffect(() => {
    if (!propertyForm.bindingClient || propertyForm.bindingClientId) return
    const m = bookingClients.find((c) => c.name === propertyForm.bindingClient)
    if (!m) return
    setPropertyForm((prev) => (prev.bindingClientId === m.id ? prev : { ...prev, bindingClientId: m.id }))
  }, [bookingClients, propertyForm.bindingClient, propertyForm.bindingClientId])

  const cleaningPriceSummaryText = useMemo(() => {
    const rows = propertyForm.operatorCleaningPricingRows || []
    if (rows.length === 0) return '—'
    const summaries = rows
      .map((row) => {
        const svcKey = String(row.service || '').trim()
        const svcLabel = svcKey
          ? PRICING_SERVICES.find((s) => s.key === (svcKey as ServiceKey))?.label || svcKey
          : ''
        const raw = String(row.myr || '').trim()
        const n = Number(raw)
        const priceOk = raw !== '' && Number.isFinite(n) && n >= 0
        if (!svcLabel && !priceOk) return ''
        const parts: string[] = []
        if (svcLabel) parts.push(svcLabel)
        if (priceOk) parts.push(`RM ${n}`)
        return parts.join(' · ')
      })
      .filter(Boolean)
    if (summaries.length === 0) return '—'
    return summaries.join(' | ')
  }, [propertyForm.operatorCleaningPricingRows])

  const pricingServiceSelectOptions = useMemo(() => {
    const cfg = operatorPricingConfig
    if (!cfg?.serviceConfigs || typeof cfg.serviceConfigs !== 'object') return PRICING_SERVICES
    const keys =
      Array.isArray(cfg.selectedServices) && cfg.selectedServices.length > 0
        ? cfg.selectedServices.map((x) => String(x))
        : Object.keys(cfg.serviceConfigs as Record<string, unknown>)
    const set = new Set(keys)
    return PRICING_SERVICES.filter((s) => set.has(s.key))
  }, [operatorPricingConfig])

  const refreshOpGroupDetail = useCallback(
    async (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      setOpGroupDetailById((prev) => ({
        ...prev,
        [gid]: { loading: true, detail: prev[gid]?.detail ?? null },
      }))
      const r = await fetchOperatorPropertyGroupDetail(operatorId, gid)
      if (r?.ok && r.group) {
        setOpGroupDetailById((prev) => ({
          ...prev,
          [gid]: { loading: false, detail: r.group! },
        }))
      } else {
        setOpGroupDetailById((prev) => ({
          ...prev,
          [gid]: { loading: false, detail: null },
        }))
      }
    },
    [operatorId]
  )

  const toggleOpGroupRow = useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      setOpGroupExpandedId((prev) => {
        if (prev === gid) return null
        void refreshOpGroupDetail(gid)
        return gid
      })
    },
    [refreshOpGroupDetail]
  )

  const runCreateOperatorGroup = async () => {
    const name = operatorNewGroupName.trim()
    if (!name) {
      toast.error('Enter a group name')
      return
    }
    setOperatorGroupCreating(true)
    const r = await createOperatorPropertyGroup(operatorId, name)
    setOperatorGroupCreating(false)
    if (!r?.ok || !r.group) {
      toast.error(typeof r?.reason === 'string' ? r.reason : 'Create failed')
      return
    }
    setOperatorPropertyGroups((prev) => [...prev, r.group!])
    setOperatorNewGroupName('')
    setOperatorGroupCreateOpen(false)
    toast.success('Group created')
  }

  const runAddSelectedToOperatorGroup = async () => {
    if (!addToOperatorGroupPickId || selectedPropertyIds.size === 0) return
    setAddToOperatorGroupBusy(true)
    const gid = addToOperatorGroupPickId
    const r = await addPropertiesToOperatorGroup(operatorId, gid, [...selectedPropertyIds])
    setAddToOperatorGroupBusy(false)
    if (!r?.ok) {
      toast.error(typeof r?.reason === 'string' ? r.reason : 'Add failed')
      return
    }
    setAddToOperatorGroupOpen(false)
    setAddToOperatorGroupPickId('')
    await reloadProperties()
    await loadOperatorPropertyGroups()
    if (opGroupExpandedId === gid) void refreshOpGroupDetail(gid)
    toast.success('Properties added to group')
  }

  const removePropFromOpGroup = async (groupId: string, propertyId: string) => {
    const r = await removePropertyFromOperatorGroup(operatorId, groupId, propertyId)
    if (!r?.ok) {
      toast.error(typeof r?.reason === 'string' ? r.reason : 'Remove failed')
      return
    }
    await reloadProperties()
    await loadOperatorPropertyGroups()
    void refreshOpGroupDetail(groupId)
  }

  const deleteOpGroup = async (groupId: string) => {
    const r = await deleteOperatorPropertyGroup(operatorId, groupId)
    if (!r?.ok) {
      toast.error(typeof r?.reason === 'string' ? r.reason : 'Delete failed')
      return
    }
    setOperatorPropertyGroups((prev) => prev.filter((g) => g.id !== groupId))
    setSelectedOperatorGroupIds((prev) => {
      const next = new Set(prev)
      next.delete(groupId)
      return next
    })
    if (opGroupExpandedId === groupId) setOpGroupExpandedId(null)
    await reloadProperties()
    toast.success('Group removed')
  }

  const openManageOperatorGroup = useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      setOpGroupExpandedId(gid)
      void refreshOpGroupDetail(gid)
    },
    [refreshOpGroupDetail]
  )

  const runBulkEditApply = async () => {
    if (selectedPropertyIds.size === 0) {
      toast.error('Select one or more properties first')
      return
    }
    if (!bulkEditUsePropertySection && !bulkEditUsePricing && !bulkEditUseTeam) {
      toast.error('Turn on property details, pricing, and/or team to apply changes')
      return
    }
    const ids = [...selectedPropertyIds]
    const bulkAddressForMap = bulkEditPropertyAddress.trim()
    const deferUntilMapPin = bulkEditUsePropertySection && !!bulkAddressForMap

    const buildBulkEditPatch = (): Record<string, unknown> => {
      const patch: Record<string, unknown> = { operatorId }
      if (bulkEditUsePropertySection) {
        patch.premisesType = bulkEditSiteKind
        const bulkNm = sanitizedOperatorPropertyDisplayNameForBulk(bulkEditName, { selectedIds: selectedPropertyIds })
        if (bulkNm) patch.name = bulkNm
        const addr = bulkEditPropertyAddress.trim()
        if (addr) {
          patch.address = addr
          const nav = navigationUrlsFromPlainAddress(addr)
          if (nav) {
            patch.wazeUrl = nav.wazeUrl
            patch.googleMapsUrl = nav.googleMapsUrl
          }
        }
      }
      if (bulkEditUsePricing) {
        const tp = bulkEditPrice.trim()
        const myr = tp === '' ? null : Number.isFinite(Number(tp)) && Number(tp) >= 0 ? Number(tp) : null
        patch.operatorCleaningPricingRows = [
          {
            service: bulkEditService.trim() || 'general',
            line: '',
            myr,
          },
        ]
      }
      if (bulkEditUseTeam) {
        patch.teamId = String(bulkEditTeamId || '').trim()
      }
      return patch
    }

    if (deferUntilMapPin) {
      setBulkEditWorking(true)
      try {
        const deferredFullPatch = buildBulkEditPatch()
        const seed = resolveMapConfirmInitialCoordsFromBulkFields(
          bulkEditPropertyAddress,
          bulkEditLatitude,
          bulkEditLongitude
        )
        mapConfirmInitialRef.current = seed
        setMapConfirmPinLabel(seed)
        pendingCoordsTargetRef.current = {
          variant: 'bulk',
          propertyIds: ids,
          deferredFullPatch,
        }
        setMapConfirmBulkDeferred(true)
        setBulkEditOpen(false)
        setIsMapConfirmOpen(true)
        toast.success(
          `Nothing saved yet — confirm the map pin to apply to ${ids.length} propert${ids.length === 1 ? 'y' : 'ies'}.`
        )
      } finally {
        setBulkEditWorking(false)
      }
      return
    }

    setBulkEditWorking(true)
    let ok = 0
    let fail = 0
    const patch = buildBulkEditPatch()
    for (const id of ids) {
      const r = await updateOperatorProperty(id, patch)
      if (r?.ok) ok += 1
      else fail += 1
    }
    setBulkEditWorking(false)
    setBulkEditOpen(false)
    await reloadProperties()
    if (fail) {
      toast.error(`Updated ${ok}, failed ${fail}`)
    } else {
      toast.success(`Updated ${ok} propert${ok === 1 ? 'y' : 'ies'}`)
    }
  }

  const applyBuildingDefaults = useCallback(async (name: string) => {
    const n = String(name || '').trim()
    if (!n) return
    const oid = String(operatorId || '').trim()
    if (!oid) return
    const r = await fetchPropertyNameDefaults(n, oid)
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
  }, [operatorId])

  const applyBulkBuildingDefaults = useCallback(async (name: string) => {
    const n = String(name || '').trim()
    if (!n) return
    const oid = String(operatorId || '').trim()
    if (!oid) return
    const r = await fetchPropertyNameDefaults(n, oid)
    if (!r?.ok) {
      toast.error('Could not load saved hints for this building')
      return
    }
    const addr = String(r.address ?? '').trim()
    setBulkEditName(n)
    setBulkEditPropertyAddress(addr)
    setBulkEditLatitude('')
    setBulkEditLongitude('')
  }, [operatorId])

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

  const scheduleBulkAddressSearch = useCallback((raw: string, buildingNameForFallback?: string) => {
    if (bulkAddressSearchTimerRef.current) clearTimeout(bulkAddressSearchTimerRef.current)
    const q = raw.trim()
    if (q.length < 3) {
      setBulkAddressSearchItems([])
      setBulkAddressSearchLoading(false)
      return
    }
    setBulkAddressSearchLoading(true)
    const propertyName = String(buildingNameForFallback ?? '').trim()
    bulkAddressSearchTimerRef.current = setTimeout(() => {
      void (async () => {
        const r = await fetchAddressSearch({
          q,
          limit: 8,
          propertyName: propertyName || undefined,
        })
        setBulkAddressSearchLoading(false)
        if (!r?.ok || !Array.isArray(r.items)) {
          setBulkAddressSearchItems([])
          return
        }
        setBulkAddressSearchItems(r.items)
        if (r.items.length > 0) setBulkAddressSuggestOpen(true)
      })()
    }, 450)
  }, [])

  const pickBulkAddressSuggestion = useCallback(
    (item: { displayName: string; lat: string; lon: string }) => {
      setBulkEditPropertyAddress(item.displayName)
      setBulkEditLatitude(item.lat && String(item.lat).trim() ? String(item.lat) : '')
      setBulkEditLongitude(item.lon && String(item.lon).trim() ? String(item.lon) : '')
      setBulkAddressSuggestOpen(false)
      setBulkAddressSearchItems([])
    },
    []
  )

  const resetForm = () => {
    bindingClientIdBaselineRef.current = ''
    teamNameBaselineRef.current = ''
    operatorDoorAccessModeBaselineRef.current = ''
    setEditDialogSmartdoorBindings(null)
    setEditDialogGatewayReady(false)
    setAddressSuggestOpen(false)
    setAddressSearchItems([])
    setAddressSearchLoading(false)
    setGlobalBuildingHints([])
    setBuildingNameInput('')
    setBuildingComboOpen(false)
    setInsertSecurityCredentials(null)
    setSecCredModalFromAdd(false)
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
      operatorDoorAccessMode: 'temporary_password_only',
      operatorCleaningPricingRows: [defaultCleaningPricingRow()],
      operatorCleaningPricingLine: '',
      operatorCleaningPriceMyr: '',
      operatorCleaningPricingService: 'general',
      estimatedTime: '',
      latitude: '',
      longitude: '',
      checklist: [],
      bedCount: '',
      roomCount: '',
      bathroomCount: '',
      kitchen: '',
      livingRoom: '',
      balcony: '',
      staircase: '',
      liftLevel: '',
      specialAreaCount: '',
      bindingTeamId: '',
    })
  }

  const seedFormFromProperty = (property: Property, teamsOverride?: Array<{ id: string; name: string }>) => {
    const teams = teamsOverride ?? operatorTeamsList
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
    const resolvedBindingId = String(property.clientdetailId || matchClient?.id || '').trim()
    bindingClientIdBaselineRef.current = resolvedBindingId
    teamNameBaselineRef.current = String(property.team ?? '').trim()
    operatorDoorAccessModeBaselineRef.current = normalizeOperatorDoorAccessMode(property.operatorDoorAccessMode)
    const pricingRows = normalizeCleaningRowsFromProperty(property)
    const first = pricingRows[0]
    setPropertyForm({
      name: siteKind === 'apartment' ? apartmentBuildingDisplayName(property.name) : property.name,
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
      afterCleanPhotoSample: property.afterCleanPhotoSample,
      operatorDoorAccessMode: normalizeOperatorDoorAccessMode(property.operatorDoorAccessMode),
      operatorCleaningPricingRows: pricingRows,
      operatorCleaningPricingLine: '',
      operatorCleaningPriceMyr: first?.myr ?? '',
      operatorCleaningPricingService: first?.service || 'general',
      estimatedTime: property.estimatedTime || '',
      latitude:
        Number.isFinite(property.lat) && !(property.lat === 0 && property.lng === 0) ? String(property.lat) : '',
      longitude:
        Number.isFinite(property.lng) && !(property.lat === 0 && property.lng === 0) ? String(property.lng) : '',
      keyPhoto: property.keyPhoto,
      checklist: property.checklist,
      bedCount: detailNumToForm(property.bedCount),
      roomCount: detailNumToForm(property.roomCount),
      bathroomCount: detailNumToForm(property.bathroomCount),
      kitchen: detailNumToForm(property.kitchen),
      livingRoom: detailNumToForm(property.livingRoom),
      balcony: detailNumToForm(property.balcony),
      staircase: detailNumToForm(property.staircase),
      liftLevel: String(property.liftLevel ?? '').trim(),
      specialAreaCount: detailNumToForm(property.specialAreaCount),
      bindingTeamId: teamIdFromPropertyTeamName(property.team, teams),
    })
  }

  const getGoogleMapUrl = (lat: string, lng: string) => `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`
  const getGoogleMapEmbedUrl = (lat: string, lng: string) =>
    `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=15&output=embed`

  const resolveGoogleMapsLink = (p: Pick<Property, 'googleMapsUrl' | 'googleMapUrl' | 'lat' | 'lng'>) => {
    const stored = String(p.googleMapsUrl || '').trim()
    if (stored) return stored
    if (
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      !(p.lat === 0 && p.lng === 0) &&
      Math.abs(p.lat) <= 90 &&
      Math.abs(p.lng) <= 180
    ) {
      return p.googleMapUrl || getGoogleMapUrl(String(p.lat), String(p.lng))
    }
    return String(p.googleMapUrl || '').trim()
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

  /** Client-created unit: binding client cannot be changed here (backend keeps clientdetail_id). */
  const clientBindingLocked = useMemo(() => {
    if (!editingPropertyId) return false
    const row = properties.find((p) => p.id === editingPropertyId)
    return !!row?.clientPortalOwned
  }, [editingPropertyId, properties])

  /** Client portal–owned unit: only the client may set mailbox / smart door / operator door / security login (API enforces). */
  const operatorDoorSettingsLocked = clientBindingLocked

  const canEditCorePropertyFields = true

  useEffect(() => {
    if (!isAddDialogOpen || !editingPropertyId) {
      setPersistedSecurityCredentials(null)
      setOperatorEditColivingPdId('')
      setEditDialogSmartdoorBindings(null)
      setEditDialogGatewayReady(false)
      operatorDoorAccessModeBaselineRef.current = ''
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
      const pd = String(r.property.colivingPropertydetailId || '').trim()
      setOperatorEditColivingPdId(pd)
      const mode = normalizeOperatorDoorAccessMode(r.property.operatorDoorAccessMode)
      operatorDoorAccessModeBaselineRef.current = mode
      setEditDialogGatewayReady(!!r.property.smartdoorGatewayReady)
      setEditDialogSmartdoorBindings(
        r.property.smartdoorBindings ?? { property: null, rooms: [] }
      )
      const rp = r.property
      const detailRows =
        Array.isArray(rp.operatorCleaningPricingRows) && rp.operatorCleaningPricingRows.length > 0
          ? rp.operatorCleaningPricingRows.map((row: { service?: unknown; line?: unknown; myr?: unknown }) => ({
              service: String(row?.service || 'general').trim() || 'general',
              line: '',
              myr:
                row?.myr != null && Number.isFinite(Number(row.myr)) ? String(row.myr) : '',
            }))
          : null
      const priceMyr = rp.operatorCleaningPriceMyr
      const svc = String(rp.operatorCleaningPricingService || '').trim()
      setPropertyForm((prev) => {
        const nextRows =
          detailRows ||
          (() => {
            const opPrice =
              priceMyr != null && Number.isFinite(Number(priceMyr)) && Number(priceMyr) >= 0
                ? String(priceMyr)
                : ''
            return [{ service: svc || 'general', line: '', myr: opPrice }]
          })()
        const first = nextRows[0]
        return {
          ...prev,
          operatorDoorAccessMode: mode,
          operatorCleaningPricingRows: nextRows,
          operatorCleaningPricingLine: '',
          operatorCleaningPriceMyr: first?.myr ?? prev.operatorCleaningPriceMyr,
          operatorCleaningPricingService: first?.service || prev.operatorCleaningPricingService || 'general',
          estimatedTime: estimateTimeMinutesFromDetail(
            rp as { estimatedTime?: unknown; min_value?: unknown; minValue?: unknown }
          ),
          bedCount: rp.bedCount != null ? String(rp.bedCount) : prev.bedCount,
          roomCount: rp.roomCount != null ? String(rp.roomCount) : prev.roomCount,
          bathroomCount: rp.bathroomCount != null ? String(rp.bathroomCount) : prev.bathroomCount,
          kitchen: rp.kitchen != null ? String(rp.kitchen) : prev.kitchen,
          livingRoom: rp.livingRoom != null ? String(rp.livingRoom) : prev.livingRoom,
          balcony: rp.balcony != null ? String(rp.balcony) : prev.balcony,
          staircase: rp.staircase != null ? String(rp.staircase) : prev.staircase,
          liftLevel: rp.liftLevel != null && String(rp.liftLevel).trim() !== '' ? String(rp.liftLevel).trim() : prev.liftLevel,
          specialAreaCount: rp.specialAreaCount != null ? String(rp.specialAreaCount) : prev.specialAreaCount,
        }
      })
    })()
    return () => {
      cancelled = true
    }
  }, [isAddDialogOpen, editingPropertyId, operatorId, properties])

  const securitySystemSummaryText = useMemo(() => {
    const sys = parseSecuritySystemFromDb(propertyForm.securitySystem)
    const creds =
      !editingPropertyId && insertSecurityCredentials
        ? insertSecurityCredentials
        : persistedSecurityCredentials
    return formatSecuritySystemSummary(sys, creds)
  }, [propertyForm.securitySystem, persistedSecurityCredentials, editingPropertyId, insertSecurityCredentials])

  const openSecurityCredentialsModal = useCallback((fromAdd: boolean) => {
    if (operatorDoorSettingsLocked) {
      toast.error('This unit was created in the client portal. Only the client can change security login and door access.')
      return
    }
    setSecCredModalFromAdd(fromAdd)
    const sys = parseSecuritySystemFromDb(propertyForm.securitySystem)
    setSecCredModalSystem(sys)
    const src = fromAdd ? insertSecurityCredentials : persistedSecurityCredentials
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
  }, [operatorDoorSettingsLocked, propertyForm.securitySystem, persistedSecurityCredentials, insertSecurityCredentials])

  const handleSecurityCredentialsModalSave = useCallback(async () => {
    if (operatorDoorSettingsLocked) return

    const sys = secCredModalSystem
    const prevObj = secCredModalFromAdd ? insertSecurityCredentials : persistedSecurityCredentials
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

    if (secCredModalFromAdd) {
      setPropertyForm((f) => ({ ...f, securitySystem: sys }))
      setInsertSecurityCredentials(body)
      setSecCredModalOpen(false)
      setSecCredModalFromAdd(false)
      toast.success('Security credentials saved — they will be stored when you create the property.')
      return
    }

    if (!editingPropertyId) return
    const colivingPd = String(operatorEditColivingPdId || '').trim()
    if (!colivingPd) {
      toast.error(
        'Link this unit to a Coliving property first (Sync from Coliving). Security login details are stored on the Coliving property row.'
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
        premisesType: propertyForm.siteKind,
        securitySystem: sys,
        securityUsername: null,
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
      if (propertyForm.bindingClientId && bindChanged && !clientBindingLocked) {
        patch.clientdetailId = propertyForm.bindingClientId
        patch.deferClientBinding = true
      } else if (!propertyForm.bindingClientId && !clientBindingLocked && bindChanged) {
        patch.clearClientdetail = true
      }
      const tidSec = String(propertyForm.bindingTeamId || '').trim()
      const nextTeamNameSec = tidSec ? operatorTeamsList.find((x) => x.id === tidSec)?.name?.trim() ?? '' : ''
      if (nextTeamNameSec !== teamNameBaselineRef.current) {
        ;(patch as Record<string, unknown>).teamId = tidSec
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
    operatorDoorSettingsLocked,
    operatorEditColivingPdId,
    secCredModalFromAdd,
    insertSecurityCredentials,
    secCredModalSystem,
    secCredPhone,
    secCredDob,
    secCredUser,
    secCredUserId,
    secCredLoginCode,
    secCredPassword,
    persistedSecurityCredentials,
    propertyForm,
    clientBindingLocked,
    reloadProperties,
    operatorTeamsList,
  ])

  const commitNewApartmentName = () => {
    const trimmed = apartmentBuildingDisplayName(apartmentNameDraft.trim())
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
    if (bulkEditOpen) setBulkEditName(trimmed)
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
              <p
                className={cn(
                  'font-medium',
                  propertyNameWarnMissingAddress(row) && 'text-destructive',
                )}
              >
                {propertyDisplayName(row)}
              </p>
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
      key: 'team',
      label: 'Team',
      sortable: true,
      render: (_, row) => (
        <span className="text-sm text-muted-foreground">{String(row.team || '').trim() || '—'}</span>
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
        setDbDistinctPropertyNames(filterDistinctPropertyNameList(namesR.items))
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
      visible: (row) => !row.clientPortalOwned,
      onClick: (row) => {
        void (async () => {
          const tr = await fetchOperatorTeams(operatorId)
          const teams =
            tr?.ok && Array.isArray(tr.items)
              ? tr.items
                  .map((t: { id?: string; name?: string }) => ({
                    id: String(t.id || '').trim(),
                    name: String(t.name || '').trim(),
                  }))
                  .filter((t: { id: string }) => !!t.id)
              : []
          setOperatorTeamsList(teams)
          setEditingPropertyId(row.id)
          seedFormFromProperty(row, teams)
          setIsAddDialogOpen(true)
        })()
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
      const la = Number(String(propertyForm.latitude ?? '').trim())
      const lo = Number(String(propertyForm.longitude ?? '').trim())
      const ok =
        Number.isFinite(la) &&
        Number.isFinite(lo) &&
        !(la === 0 && lo === 0) &&
        Math.abs(la) <= 90 &&
        Math.abs(lo) <= 180
      const lat = ok ? la : NaN
      const lng = ok ? lo : NaN
      return {
        lat,
        lng,
        googleMapUrl: ok ? getGoogleMapUrl(String(lat), String(lng)) : undefined,
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
    team: (() => {
      const tid = String(propertyForm.bindingTeamId || '').trim()
      if (!tid) return ''
      return operatorTeamsList.find((x) => x.id === tid)?.name?.trim() ?? ''
    })(),
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
    operatorCleaningPricingRows: buildOperatorCleaningPricingRowsApiPayload(propertyForm.operatorCleaningPricingRows),
    operatorCleaningPricingLine: propertyForm.operatorCleaningPricingLine.trim(),
    operatorCleaningPricingService: propertyForm.operatorCleaningPricingService.trim(),
    operatorCleaningPriceMyr: (() => {
      const t = String(propertyForm.operatorCleaningPriceMyr || '').trim()
      if (t === '') return null
      const n = Number(t)
      return Number.isFinite(n) && n >= 0 ? n : null
    })(),
    operatorDoorAccessMode: propertyForm.operatorDoorAccessMode,
    estimatedTime: (() => {
      const v = coerceEstimatedTimeMinutesForApi(propertyForm.estimatedTime)
      return v === '' ? undefined : v
    })(),
    afterCleanPhotoSample: propertyForm.afterCleanPhotoSample,
    keyPhoto: propertyForm.keyPhoto,
    checklist: propertyForm.checklist,
    lastCleaned: undefined,
    premisesType: propertyForm.siteKind,
    bedCount: formDetailOptInt(propertyForm.bedCount) ?? null,
    roomCount: formDetailOptInt(propertyForm.roomCount) ?? null,
    bathroomCount: formDetailOptInt(propertyForm.bathroomCount) ?? null,
    kitchen: formDetailOptInt(propertyForm.kitchen) ?? null,
    livingRoom: formDetailOptInt(propertyForm.livingRoom) ?? null,
    balcony: formDetailOptInt(propertyForm.balcony) ?? null,
    staircase: formDetailOptInt(propertyForm.staircase) ?? null,
    liftLevel: String(propertyForm.liftLevel || '').trim() || null,
    specialAreaCount: formDetailOptInt(propertyForm.specialAreaCount) ?? null,
  })

  /** Create property without latitude/longitude; caller opens map pin step when address is set. */
  const performCreatePropertyOmitCoords = async (): Promise<{
    ok: boolean
    id?: string
    deferClientBinding?: boolean
  }> => {
    const id = `${Date.now()}`
    const next = toPropertyPayload(id, 'active')
    const payload: Record<string, unknown> = {
      name: next.name,
      address: next.address,
      unitNumber: next.unitNumber,
      client: next.client,
      operatorId,
      premisesType: propertyForm.siteKind,
      securitySystem: propertyForm.securitySystem,
      securityUsername: null,
      mailboxPassword: propertyForm.mailboxPasswordValue,
      smartdoorPassword: propertyForm.keyCollection.smartdoorPassword ? propertyForm.smartdoorPasswordValue : '',
      smartdoorTokenEnabled: propertyForm.keyCollection.smartdoorToken,
      smartdoorToken: propertyForm.keyCollection.smartdoorToken ? SMARTDOOR_TOKEN_ENABLED_MARKER : '',
      afterCleanPhotoUrl: propertyForm.afterCleanPhotoSample,
      keyPhotoUrl: propertyForm.keyPhoto,
      clientPortalOwned: 0,
      wazeUrl: propertyForm.wazeUrl.trim(),
      googleMapsUrl: propertyForm.googleMapsUrl.trim(),
      operatorDoorAccessMode: propertyForm.operatorDoorAccessMode,
      operatorCleaningPricingRows: buildOperatorCleaningPricingRowsApiPayload(propertyForm.operatorCleaningPricingRows),
      operatorCleaningPricingLine: propertyForm.operatorCleaningPricingLine.trim(),
      operatorCleaningPricingService: propertyForm.operatorCleaningPricingService.trim() || null,
      operatorCleaningPriceMyr: (() => {
        const t = String(propertyForm.operatorCleaningPriceMyr || '').trim()
        if (t === '') return null
        const n = Number(t)
        return Number.isFinite(n) && n >= 0 ? n : null
      })(),
      bedCount: formDetailOptInt(propertyForm.bedCount),
      roomCount: formDetailOptInt(propertyForm.roomCount),
      bathroomCount: formDetailOptInt(propertyForm.bathroomCount),
      kitchen: formDetailOptInt(propertyForm.kitchen),
      livingRoom: formDetailOptInt(propertyForm.livingRoom),
      balcony: formDetailOptInt(propertyForm.balcony),
      staircase: formDetailOptInt(propertyForm.staircase),
      specialAreaCount: formDetailOptInt(propertyForm.specialAreaCount),
      liftLevel: (() => {
        const ll = String(propertyForm.liftLevel || '').trim().toLowerCase()
        return ll === '' ? undefined : ll
      })(),
      estimatedTime: coerceEstimatedTimeMinutesForApi(propertyForm.estimatedTime),
    }
    const teamTidCreate = String(propertyForm.bindingTeamId || '').trim()
    if (teamTidCreate) payload.teamId = teamTidCreate
    if (propertyForm.bindingClientId) {
      payload.clientdetailId = propertyForm.bindingClientId
      payload.deferClientBinding = true
    }
    const r = await createOperatorProperty(payload)
    if (!r?.ok) {
      toast.error('Failed to add property')
      return { ok: false }
    }
    const namesR = await fetchOperatorDistinctPropertyNames(operatorId)
    if (namesR?.ok && Array.isArray(namesR.items)) {
      setDbDistinctPropertyNames(filterDistinctPropertyNameList(namesR.items))
    }
    return { ok: true, id: String(r.id || id), deferClientBinding: !!r.deferClientBinding }
  }

  /** Update property without latitude/longitude; caller opens map pin step when address is set. */
  const performUpdatePropertyOmitCoords = async (): Promise<{
    ok: boolean
    deferClientBinding?: boolean
  }> => {
    if (!editingPropertyId) return { ok: false }
    const prevRow = properties.find((p) => p.id === editingPropertyId)
    const next = toPropertyPayload(editingPropertyId, prevRow?.status ?? 'active')
    const doorLocked = !!prevRow?.clientPortalOwned
    const patch: Record<string, unknown> = {
      operatorId,
      name: next.name,
      address: next.address,
      unitNumber: next.unitNumber,
      client: next.client,
      premisesType: propertyForm.siteKind,
      afterCleanPhotoUrl: propertyForm.afterCleanPhotoSample,
      keyPhotoUrl: propertyForm.keyPhoto,
      wazeUrl: propertyForm.wazeUrl.trim(),
      googleMapsUrl: propertyForm.googleMapsUrl.trim(),
      operatorCleaningPricingRows: buildOperatorCleaningPricingRowsApiPayload(propertyForm.operatorCleaningPricingRows),
      operatorCleaningPricingLine: propertyForm.operatorCleaningPricingLine.trim(),
      operatorCleaningPricingService: propertyForm.operatorCleaningPricingService.trim() || null,
      operatorCleaningPriceMyr: (() => {
        const t = String(propertyForm.operatorCleaningPriceMyr || '').trim()
        if (t === '') return null
        const n = Number(t)
        return Number.isFinite(n) && n >= 0 ? n : null
      })(),
      bedCount: formDetailOptInt(propertyForm.bedCount),
      roomCount: formDetailOptInt(propertyForm.roomCount),
      bathroomCount: formDetailOptInt(propertyForm.bathroomCount),
      kitchen: formDetailOptInt(propertyForm.kitchen),
      livingRoom: formDetailOptInt(propertyForm.livingRoom),
      balcony: formDetailOptInt(propertyForm.balcony),
      staircase: formDetailOptInt(propertyForm.staircase),
      specialAreaCount: formDetailOptInt(propertyForm.specialAreaCount),
      liftLevel: (() => {
        const ll = String(propertyForm.liftLevel || '').trim().toLowerCase()
        return ll === '' ? undefined : ll
      })(),
      estimatedTime: coerceEstimatedTimeMinutesForApi(propertyForm.estimatedTime),
    }
    if (!doorLocked) {
      patch.securitySystem = propertyForm.securitySystem
      patch.securityUsername = null
      patch.mailboxPassword = propertyForm.mailboxPasswordValue
      patch.smartdoorPassword = propertyForm.keyCollection.smartdoorPassword ? propertyForm.smartdoorPasswordValue : ''
      patch.smartdoorTokenEnabled = propertyForm.keyCollection.smartdoorToken
      if (propertyForm.operatorDoorAccessMode !== operatorDoorAccessModeBaselineRef.current) {
        patch.operatorDoorAccessMode = propertyForm.operatorDoorAccessMode
      }
    }
    const baselineCd = bindingClientIdBaselineRef.current
    const nextCd = String(propertyForm.bindingClientId || '').trim()
    const bindChanged = nextCd !== baselineCd
    if (propertyForm.bindingClientId && bindChanged && !clientBindingLocked) {
      patch.clientdetailId = propertyForm.bindingClientId
      patch.deferClientBinding = true
    } else if (!propertyForm.bindingClientId && !clientBindingLocked && bindChanged) {
      patch.clearClientdetail = true
    }
    const tid = String(propertyForm.bindingTeamId || '').trim()
    const nextTeamName = tid ? operatorTeamsList.find((x) => x.id === tid)?.name?.trim() ?? '' : ''
    if (nextTeamName !== teamNameBaselineRef.current) {
      patch.teamId = tid
    }
    const r = await updateOperatorProperty(editingPropertyId, patch)
    if (!r?.ok) {
      toast.error('Failed to update property')
      return { ok: false }
    }
    const namesR = await fetchOperatorDistinctPropertyNames(operatorId)
    if (namesR?.ok && Array.isArray(namesR.items)) {
      setDbDistinctPropertyNames(filterDistinctPropertyNameList(namesR.items))
    }
    return { ok: true, deferClientBinding: !!patch.deferClientBinding }
  }

  const handleAddProperty = async () => {
    const id = `${Date.now()}`
    const next = toPropertyPayload(id, 'active')
    const payload: Record<string, unknown> = {
      name: next.name,
      address: next.address,
      unitNumber: next.unitNumber,
      client: next.client,
      operatorId,
      premisesType: propertyForm.siteKind,
      securitySystem: propertyForm.securitySystem,
      securityUsername: null,
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
      operatorDoorAccessMode: propertyForm.operatorDoorAccessMode,
      operatorCleaningPricingRows: buildOperatorCleaningPricingRowsApiPayload(propertyForm.operatorCleaningPricingRows),
      operatorCleaningPricingLine: propertyForm.operatorCleaningPricingLine.trim(),
      operatorCleaningPricingService: propertyForm.operatorCleaningPricingService.trim() || null,
      operatorCleaningPriceMyr: (() => {
        const t = String(propertyForm.operatorCleaningPriceMyr || '').trim()
        if (t === '') return null
        const n = Number(t)
        return Number.isFinite(n) && n >= 0 ? n : null
      })(),
      bedCount: formDetailOptInt(propertyForm.bedCount),
      roomCount: formDetailOptInt(propertyForm.roomCount),
      bathroomCount: formDetailOptInt(propertyForm.bathroomCount),
      kitchen: formDetailOptInt(propertyForm.kitchen),
      livingRoom: formDetailOptInt(propertyForm.livingRoom),
      balcony: formDetailOptInt(propertyForm.balcony),
      staircase: formDetailOptInt(propertyForm.staircase),
      specialAreaCount: formDetailOptInt(propertyForm.specialAreaCount),
      liftLevel: (() => {
        const ll = String(propertyForm.liftLevel || '').trim().toLowerCase()
        return ll === '' ? undefined : ll
      })(),
      estimatedTime: coerceEstimatedTimeMinutesForApi(propertyForm.estimatedTime),
    }
    const teamTidAdd = String(propertyForm.bindingTeamId || '').trim()
    if (teamTidAdd) payload.teamId = teamTidAdd
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
      setDbDistinctPropertyNames(filterDistinctPropertyNameList(namesR.items))
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
    const prevRow = properties.find((p) => p.id === editingPropertyId)
    const next = toPropertyPayload(editingPropertyId, prevRow?.status ?? 'active')
    const doorLocked = !!prevRow?.clientPortalOwned
    const patch: Record<string, unknown> = {
      operatorId,
      name: next.name,
      address: next.address,
      unitNumber: next.unitNumber,
      client: next.client,
      premisesType: propertyForm.siteKind,
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
      operatorCleaningPricingRows: buildOperatorCleaningPricingRowsApiPayload(propertyForm.operatorCleaningPricingRows),
      operatorCleaningPricingLine: propertyForm.operatorCleaningPricingLine.trim(),
      operatorCleaningPricingService: propertyForm.operatorCleaningPricingService.trim() || null,
      operatorCleaningPriceMyr: (() => {
        const t = String(propertyForm.operatorCleaningPriceMyr || '').trim()
        if (t === '') return null
        const n = Number(t)
        return Number.isFinite(n) && n >= 0 ? n : null
      })(),
      bedCount: formDetailOptInt(propertyForm.bedCount),
      roomCount: formDetailOptInt(propertyForm.roomCount),
      bathroomCount: formDetailOptInt(propertyForm.bathroomCount),
      kitchen: formDetailOptInt(propertyForm.kitchen),
      livingRoom: formDetailOptInt(propertyForm.livingRoom),
      balcony: formDetailOptInt(propertyForm.balcony),
      staircase: formDetailOptInt(propertyForm.staircase),
      specialAreaCount: formDetailOptInt(propertyForm.specialAreaCount),
      liftLevel: (() => {
        const ll = String(propertyForm.liftLevel || '').trim().toLowerCase()
        return ll === '' ? undefined : ll
      })(),
      estimatedTime: coerceEstimatedTimeMinutesForApi(propertyForm.estimatedTime),
    }
    if (!doorLocked) {
      patch.securitySystem = propertyForm.securitySystem
      patch.securityUsername = null
      patch.mailboxPassword = propertyForm.mailboxPasswordValue
      patch.smartdoorPassword = propertyForm.keyCollection.smartdoorPassword ? propertyForm.smartdoorPasswordValue : ''
      patch.smartdoorTokenEnabled = propertyForm.keyCollection.smartdoorToken
      if (propertyForm.operatorDoorAccessMode !== operatorDoorAccessModeBaselineRef.current) {
        patch.operatorDoorAccessMode = propertyForm.operatorDoorAccessMode
      }
    }
    const baselineCd = bindingClientIdBaselineRef.current
    const nextCd = String(propertyForm.bindingClientId || '').trim()
    const bindChanged = nextCd !== baselineCd
    if (propertyForm.bindingClientId && bindChanged && !clientBindingLocked) {
      patch.clientdetailId = propertyForm.bindingClientId
      patch.deferClientBinding = true
    } else if (!propertyForm.bindingClientId && !clientBindingLocked && bindChanged) {
      patch.clearClientdetail = true
    }
    const tidUp = String(propertyForm.bindingTeamId || '').trim()
    const nextTeamNameUp = tidUp ? operatorTeamsList.find((x) => x.id === tidUp)?.name?.trim() ?? '' : ''
    if (nextTeamNameUp !== teamNameBaselineRef.current) {
      patch.teamId = tidUp
    }
    const r = await updateOperatorProperty(editingPropertyId, patch)
    if (!r?.ok) {
      toast.error('Failed to update property')
      return
    }
    setProperties((prev) => prev.map((item) => (item.id === editingPropertyId ? toPropertyPayload(editingPropertyId, item.status) : item)))
    const namesR = await fetchOperatorDistinctPropertyNames(operatorId)
    if (namesR?.ok && Array.isArray(namesR.items)) {
      setDbDistinctPropertyNames(filterDistinctPropertyNameList(namesR.items))
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

  const validatePropertyBasicsForSave = (): boolean => {
    if (propertyForm.siteKind === 'apartment') {
      const n = propertyForm.name.trim()
      if (!n) {
        toast.error('Select or add a building name for apartment premises')
        return false
      }
    } else if (!propertyForm.name.trim()) {
      toast.error('Enter a property name')
      return false
    }
    return true
  }

  const requestSavePropertyWithMapFlow = async () => {
    if (!validatePropertyBasicsForSave()) return
    const addr = propertyForm.propertyAddress.trim()
    if (!addr) {
      if (editingPropertyId) await handleUpdateProperty()
      else await handleAddProperty()
      return
    }
    setIsPropertyDetailSaving(true)
    try {
      const seed = resolveMapConfirmInitialCoordsFromForm(propertyForm)
      mapConfirmInitialRef.current = seed
      setMapConfirmPinLabel(seed)
      if (editingPropertyId) {
        const pid = editingPropertyId
        const r = await performUpdatePropertyOmitCoords()
        if (!r.ok) return
        await reloadProperties()
        if (r.deferClientBinding) {
          toast.success('Update saved. Client approval is pending for the new binding. Confirm the map pin.')
        } else {
          toast.success('Details saved. Confirm the map pin.')
        }
        pendingCoordsTargetRef.current = { variant: 'single', propertyId: pid }
        setMapConfirmBulkDeferred(false)
        setIsMapConfirmOpen(true)
        setIsAddDialogOpen(false)
        setEditingPropertyId(null)
        resetForm()
      } else {
        const r = await performCreatePropertyOmitCoords()
        if (!r.ok) return
        await reloadProperties()
        const newId = String(r.id || '').trim()
        if (!newId) {
          toast.error('Property was created but no id was returned')
          return
        }
        if (r.deferClientBinding) {
          toast.success('Property saved. Client approval is pending for the binding. Confirm the map pin.')
        } else {
          toast.success('Details saved. Confirm the map pin.')
        }
        pendingCoordsTargetRef.current = { variant: 'single', propertyId: newId }
        setMapConfirmBulkDeferred(false)
        setIsMapConfirmOpen(true)
        setIsAddDialogOpen(false)
        setEditingPropertyId(null)
        resetForm()
      }
    } finally {
      setIsPropertyDetailSaving(false)
    }
  }

  const confirmMapPinAndPatchCoords = async () => {
    const m = mapConfirmMarkerRef.current
    const ll = m?.getLatLng?.()
    const lat = Number(ll?.lat)
    const lng = Number(ll?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      toast.error('Invalid pin position')
      return
    }
    const target = pendingCoordsTargetRef.current
    if (!target) {
      toast.error('Nothing to update')
      return
    }
    setMapConfirmPatching(true)
    try {
      if (target.variant === 'single') {
        const r = await updateOperatorProperty(target.propertyId, { operatorId, latitude: lat, longitude: lng })
        if (!r?.ok) {
          toast.error('Failed to save map pin')
          return
        }
      } else {
        const def = target.deferredFullPatch
        let fail = 0
        if (def && typeof def === 'object') {
          for (const id of target.propertyIds) {
            const r = await updateOperatorProperty(id, {
              ...def,
              operatorId,
              latitude: lat,
              longitude: lng,
            })
            if (!r?.ok) fail += 1
          }
        } else {
          for (const id of target.propertyIds) {
            const r = await updateOperatorProperty(id, { operatorId, latitude: lat, longitude: lng })
            if (!r?.ok) fail += 1
          }
        }
        if (fail) {
          toast.error(`Saved on ${target.propertyIds.length - fail}, failed ${fail}`)
          await reloadProperties()
          pendingCoordsTargetRef.current = null
          setMapConfirmBulkDeferred(false)
          setIsMapConfirmOpen(false)
          return
        }
      }
      await reloadProperties()
      const bulkDidDefer = target.variant === 'bulk' && !!target.deferredFullPatch
      toast.success(bulkDidDefer ? 'Bulk changes and map pin saved' : 'Map pin saved')
      pendingCoordsTargetRef.current = null
      setMapConfirmBulkDeferred(false)
      setIsMapConfirmOpen(false)
    } finally {
      setMapConfirmPatching(false)
    }
  }

  const cancelMapConfirm = () => {
    pendingCoordsTargetRef.current = null
    setMapConfirmBulkDeferred(false)
    setIsMapConfirmOpen(false)
  }

  useEffect(() => {
    if (!isMapConfirmOpen) {
      if (mapConfirmLeafletMapRef.current) {
        try {
          mapConfirmLeafletMapRef.current.remove()
        } catch {
          /* ignore */
        }
        mapConfirmLeafletMapRef.current = null
      }
      mapConfirmMarkerRef.current = null
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const L = await import('leaflet')
        if (cancelled) return
        const el = mapConfirmContainerRef.current
        if (!el) return
        const seed = mapConfirmInitialRef.current
        if (mapConfirmLeafletMapRef.current) {
          try {
            mapConfirmLeafletMapRef.current.remove()
          } catch {
            /* ignore */
          }
          mapConfirmLeafletMapRef.current = null
        }
        mapConfirmMarkerRef.current = null
        const map = L.map(el).setView([seed.lat, seed.lng], 15)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map)
        const pinIcon = L.divIcon({
          className: 'cleanlemon-map-confirm-pin',
          html: '<div style="width:14px;height:14px;background:#dc2626;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        })
        const marker = L.marker([seed.lat, seed.lng], { draggable: true, icon: pinIcon }).addTo(map)
        mapConfirmLeafletMapRef.current = map
        mapConfirmMarkerRef.current = marker
        const syncLabelFromMarker = () => {
          const p = marker.getLatLng()
          setMapConfirmPinLabel({ lat: p.lat, lng: p.lng })
        }
        map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
          marker.setLatLng(e.latlng)
          syncLabelFromMarker()
        })
        marker.on('dragend', syncLabelFromMarker)
        window.setTimeout(() => {
          try {
            map.invalidateSize()
          } catch {
            /* ignore */
          }
        }, 200)
      })()
    }, 80)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (mapConfirmLeafletMapRef.current) {
        try {
          mapConfirmLeafletMapRef.current.remove()
        } catch {
          /* ignore */
        }
        mapConfirmLeafletMapRef.current = null
      }
      mapConfirmMarkerRef.current = null
    }
  }, [isMapConfirmOpen])

  const focusPropertyOnMap = useCallback((property: Property) => {
    setSelectedMapListPropertyId(property.id)
    const ll = overviewLatLngForProperty(property)
    if (!ll) {
      toast.error(
        'No map pin for this property yet. Edit it, save, and confirm the pin — or use Waze/Google links that include coordinates (ll= or @lat,lng).'
      )
      return
    }
    const apply = (): boolean => {
      const map = leafletMapRef.current
      const marker = overviewMarkersByPropertyIdRef.current[property.id]
      if (!map || !marker) return false
      map.setView([ll.lat, ll.lng], Math.max(map.getZoom(), 15), { animate: true })
      marker.openPopup()
      window.setTimeout(() => {
        try {
          map.invalidateSize()
        } catch {
          /* ignore */
        }
      }, 150)
      return true
    }
    if (apply()) return
    let attempts = 0
    const tick = () => {
      attempts += 1
      if (apply()) return
      if (attempts >= 28) {
        toast.error('Map is still loading. Wait a few seconds and tap this property again.')
        return
      }
      window.setTimeout(tick, 120)
    }
    window.setTimeout(tick, 120)
  }, [])

  useEffect(() => {
    if (viewMode !== 'map') {
      setSelectedMapListPropertyId(null)
      setMapSidebarSearch('')
    }
  }, [viewMode])

  useEffect(() => {
    if (viewMode !== 'map') {
      overviewMarkersByPropertyIdRef.current = {}
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const L = await import('leaflet')
        if (cancelled) return
        const el = mapContainerRef.current
        if (!el) return

        const googleHref = (p: Property) => {
          const stored = String(p.googleMapsUrl || '').trim()
          if (stored) return stored
          const fallback = p.googleMapUrl
          if (fallback) return String(fallback)
          const ll = overviewLatLngForProperty(p)
          if (ll) return `https://www.google.com/maps?q=${encodeURIComponent(`${ll.lat},${ll.lng}`)}`
          const q = encodeURIComponent(`${p.name || ''} ${p.address || ''}`.trim() || 'Johor Bahru')
          return `https://www.google.com/maps?q=${q}`
        }

        const pts: Array<{ p: Property; lat: number; lng: number }> = []
        for (const p of visibleListProperties) {
          const ll = overviewLatLngForProperty(p)
          if (!ll) continue
          pts.push({ p, lat: ll.lat, lng: ll.lng })
        }

        if (leafletMapRef.current) {
          leafletMapRef.current.remove()
          leafletMapRef.current = null
        }
        overviewMarkersByPropertyIdRef.current = {}

        const center: [number, number] =
          pts.length > 0 ? [pts[0].lat, pts[0].lng] : [DEFAULT_PROPERTY_MAP_LAT, DEFAULT_PROPERTY_MAP_LNG]
        const map = L.map(el).setView(center, pts.length === 1 ? 15 : pts.length === 0 ? 11 : 12)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map)

        const latlngs: [number, number][] = []
        const byCoord = new Map<string, Array<{ p: Property; lat: number; lng: number }>>()
        for (const item of pts) {
          const k = overviewCoordGroupKey(item.lat, item.lng)
          const arr = byCoord.get(k)
          if (arr) arr.push(item)
          else byCoord.set(k, [item])
        }

        for (const group of byCoord.values()) {
          group.sort((a, b) =>
            String(a.p.name || a.p.id).localeCompare(String(b.p.name || b.p.id), undefined, {
              sensitivity: 'base',
            })
          )
          const { lat, lng } = group[0]
          latlngs.push([lat, lng])
          const propList = group.map((g) => g.p)
          const pinColor = overviewMapPinColorForProperties(propList)
          const count = group.length
          const pinHtml =
            count > 1
              ? `<div style="position:relative;width:30px;height:30px;display:flex;align-items:center;justify-content:center"><div style="width:18px;height:18px;background:${pinColor};border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div><span style="position:absolute;bottom:-3px;right:-6px;min-width:18px;height:18px;padding:0 4px;background:#fff;border:1px solid #ccc;border-radius:9px;font-size:11px;font-weight:600;line-height:16px;text-align:center;color:#374151">${count}</span></div>`
              : `<div style="width:18px;height:18px;background:${pinColor};border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`
          const pinIcon = L.divIcon({
            className: 'cleanlemon-overview-map-pin',
            html: pinHtml,
            iconSize: count > 1 ? [30, 30] : [18, 18],
            iconAnchor: count > 1 ? [15, 15] : [9, 9],
          })
          const m = L.marker([lat, lng], { icon: pinIcon }).addTo(map)
          m.bindPopup(buildCleanlemonOverviewMapPopupHtml(propList, googleHref))
          for (const g of group) {
            overviewMarkersByPropertyIdRef.current[g.p.id] = m
          }
        }

        if (latlngs.length > 1) {
          map.fitBounds(latlngs, { padding: [48, 48], maxZoom: 16 })
        }

        leafletMapRef.current = map
        const bumpInvalidate = () => {
          try {
            map.invalidateSize()
          } catch {
            /* ignore */
          }
        }
        window.setTimeout(bumpInvalidate, 200)
        window.setTimeout(bumpInvalidate, 600)
        requestAnimationFrame(bumpInvalidate)
      })()
    }, 120)

    return () => {
      cancelled = true
      clearTimeout(timer)
      overviewMarkersByPropertyIdRef.current = {}
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
              <MapIcon className="h-4 w-4" />
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
              <DropdownMenuItem
                disabled={viewMode !== 'list' || bulkWorking}
                className="gap-2 cursor-pointer"
                onClick={() => {
                  if (viewMode !== 'list') {
                    toast.error('Switch to list view to use bulk edit')
                    return
                  }
                  if (selectedPropertyIds.size === 0) {
                    toast.error('Tick one or more rows in the table, then open Bulk edit again')
                    return
                  }
                  setBulkEditUsePropertySection(false)
                  setBulkEditUsePricing(false)
                  const first = properties.find((p) => selectedPropertyIds.has(p.id))
                  if (first) {
                    setBulkEditSiteKind(premisesTypeToSiteKind(first.premisesType || ''))
                    setBulkEditName(
                      sanitizedOperatorPropertyDisplayNameForBulk(String(first.name ?? ''), {
                        rowId: first.id,
                        selectedIds: selectedPropertyIds,
                      })
                    )
                    setBulkEditPropertyAddress(first.address)
                    setBulkEditLatitude(Number.isFinite(first.lat) ? String(first.lat) : '')
                    setBulkEditLongitude(Number.isFinite(first.lng) ? String(first.lng) : '')
                  } else {
                    setBulkEditSiteKind('landed')
                    setBulkEditName('')
                    setBulkEditPropertyAddress('')
                    setBulkEditLatitude('')
                    setBulkEditLongitude('')
                  }
                  setBulkBuildingNameInput('')
                  setBulkBuildingComboOpen(false)
                  setBulkAddressSearchItems([])
                  setBulkAddressSuggestOpen(false)
                  setBulkEditService('general')
                  setBulkEditPrice('')
                  setBulkEditUseTeam(false)
                  setBulkEditTeamId('')
                  setBulkEditOpen(true)
                }}
              >
                <Edit className="h-4 w-4 shrink-0" />
                Bulk edit (property / pricing / team)… ({selectedPropertyIds.size})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={viewMode !== 'list' || bulkWorking}
                className="gap-2 cursor-pointer"
                onClick={() => {
                  if (viewMode !== 'list') {
                    toast.error('Switch to list view to select properties')
                    return
                  }
                  if (selectedPropertyIds.size === 0) {
                    toast.error('Tick one or more rows first')
                    return
                  }
                  setAddToOperatorGroupPickId('')
                  setAddToOperatorGroupOpen(true)
                }}
              >
                <Users className="h-4 w-4 shrink-0" />
                Add to operator group… ({selectedPropertyIds.size})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={viewMode !== 'list' || bulkWorking || bookingClients.length === 0}
                className="gap-2 cursor-pointer"
                onClick={() => {
                  if (viewMode !== 'list') {
                    toast.error('Switch to list view to select properties')
                    return
                  }
                  if (selectedPropertyIds.size === 0) {
                    toast.error('Tick one or more rows first')
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
              <div className="space-y-6 py-4">
                <div className="space-y-2">
                  <Label>Binding client</Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                    <Select
                      value={propertyForm.bindingClientId || '__none__'}
                      disabled={clientBindingLocked}
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
                    {!clientBindingLocked ? (
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
                  {clientBindingLocked ? (
                    <p className="text-xs text-muted-foreground">
                      Created by a client: you cannot change who is bound. Use &quot;Remove from my list&quot; to drop this
                      property from your operator view; the client keeps it.
                    </p>
                  ) : null}
                  {bookingClients.length === 0 && (
                    <p className="text-xs text-muted-foreground">No clients linked to this operator yet.</p>
                  )}
                </div>
                {clientBindingLocked ? (
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    Client-registered unit: you cannot change which client is bound here. Use Remove from my list if you no
                    longer service it.
                  </p>
                ) : null}
                <div className="rounded-lg border p-4 space-y-4">
                  <p className="text-sm font-semibold text-foreground">Property &amp; access</p>
                  <p className="text-xs text-muted-foreground">
                    Same layout as client portal: premises, address, unit, links, mailbox and security login.
                  </p>
                <div className="space-y-2">
                  <Label htmlFor="site-kind">Premises type</Label>
                  <Select
                    value={propertyForm.siteKind}
                    disabled={!canEditCorePropertyFields}
                    onValueChange={(value: SiteKind) => {
                      setPropertyForm((prev) => {
                        const next = { ...prev, siteKind: value }
                        if (value === 'apartment' && String(prev.name || '').trim()) {
                          return { ...next, name: apartmentBuildingDisplayName(prev.name) }
                        }
                        return next
                      })
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
                        Selecting a building fills the address from saved hints (all operators). Waze / Google links follow the address when you save.
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
                        No suggestions yet. Try the full building name, add city (e.g. Johor Bahru), fix spelling, fill
                        Property name above, or paste the address manually.
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    OpenStreetMap search (server proxy, Malaysia by default). If your text finds nothing, we also try
                    your Property name above. Choose a result to set the text and map pin.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Waze and Google Maps links are generated from this address when you save (no separate URL fields).
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
                  <div className="space-y-2">
                    <Label htmlFor="op-mailbox-pw">Mailbox password</Label>
                    <Input
                      id="op-mailbox-pw"
                      type="text"
                      autoComplete="off"
                      disabled={operatorDoorSettingsLocked}
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
                            {editingPropertyId
                              ? 'Not configured. Use Edit to choose the system and enter login details (saved in MySQL on the linked Coliving property row).'
                              : 'Not configured. Use Edit to choose the system and enter login details (saved in MySQL when you create the property).'}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0 w-full sm:w-auto"
                        disabled={operatorDoorSettingsLocked}
                        onClick={() => openSecurityCredentialsModal(!editingPropertyId)}
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border p-4 space-y-4">
                  <p className="text-sm font-semibold text-foreground">Operator door access</p>
                  <p className="text-xs text-muted-foreground">
                    How your team may open this unit&apos;s smart door. Modes that use remote unlock need a gateway linked to the lock in Coliving.
                  </p>
                  {operatorDoorSettingsLocked ? (
                    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      This unit was created in the client portal — only the client can change mailbox, smart door, and door
                      access here. You can still edit address, pricing, and property details.
                    </p>
                  ) : null}
                  {editingPropertyId &&
                  ['full_access', 'temporary_password_only', 'working_date_only'].includes(
                    propertyForm.operatorDoorAccessMode
                  ) &&
                  !editDialogGatewayReady ? (
                    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      No gateway linked for remote unlock. Use &quot;Fixed password&quot; or link a gateway in Coliving → Smart door, or remote unlock will not work.
                    </p>
                  ) : null}
                  <div className="space-y-2 max-w-md">
                    <Label className="text-xs">Mode</Label>
                    <Select
                      value={propertyForm.operatorDoorAccessMode}
                      disabled={operatorDoorSettingsLocked}
                      onValueChange={(v) =>
                        setPropertyForm((prev) => ({ ...prev, operatorDoorAccessMode: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full_access">
                          Full access — permanent PIN + remote when gateway is ready
                        </SelectItem>
                        <SelectItem value="temporary_password_only">
                          Temporary password — PIN per job + remote on booking days
                        </SelectItem>
                        <SelectItem value="working_date_only">Booking day only — remote when gateway is ready</SelectItem>
                        <SelectItem value="fixed_password">Fixed password — no remote unlock</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-md border p-3 space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={propertyForm.keyCollection.smartdoorPassword}
                        disabled={operatorDoorSettingsLocked}
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
                        disabled={operatorDoorSettingsLocked}
                        onChange={(e) =>
                          setPropertyForm({ ...propertyForm, smartdoorPasswordValue: e.target.value })
                        }
                        placeholder="Smart door password"
                      />
                    ) : null}
                  </div>
                  <div className="rounded-md border p-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={propertyForm.keyCollection.smartdoorToken}
                        disabled={operatorDoorSettingsLocked}
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
                  {operatorEditColivingPdId ? (
                    <div
                      className={cn(
                        'space-y-3 rounded-md border p-3',
                        clientBindingLocked ? 'bg-muted/30' : 'bg-muted/20 border-primary/20'
                      )}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {clientBindingLocked ? 'Edit utility — smart door (read-only)' : 'Edit utility — smart door'}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {clientBindingLocked
                              ? 'This unit was created in the client portal. Smart door binding is managed by the client in Coliving Edit utility — shown here for reference only.'
                              : 'Binding and lock selection are done in Coliving (same linked property row). Open Coliving below, then Property → ⋮ → Edit utility.'}
                          </p>
                        </div>
                        {!clientBindingLocked ? (
                          <Button variant="default" size="sm" className="shrink-0 gap-2" asChild>
                            <a
                              href={`${COLIVING_PORTAL_ORIGIN}/operator/property`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open Coliving — Edit utility
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        ) : null}
                      </div>
                      <div className="space-y-2 max-w-md">
                        <Label className="text-xs">Smart door</Label>
                        <Input
                          readOnly
                          className="bg-muted cursor-default"
                          value={
                            editDialogSmartdoorBindings?.property?.displayLabel?.trim()
                              ? String(editDialogSmartdoorBindings.property.displayLabel)
                              : '—'
                          }
                        />
                      </div>
                      {editDialogSmartdoorBindings?.rooms && editDialogSmartdoorBindings.rooms.length > 0 ? (
                        <div className="space-y-2">
                          <Label className="text-xs">Room-bound locks</Label>
                          <ul className="text-sm space-y-2 rounded-md border p-3 bg-background">
                            {editDialogSmartdoorBindings.rooms.map((r) => (
                              <li
                                key={r.roomId}
                                className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:items-baseline sm:gap-4"
                              >
                                <span className="text-muted-foreground">{r.roomDisplayLabel}</span>
                                <span className="font-medium">{r.lockDisplayLabel}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {!editDialogSmartdoorBindings?.property &&
                      (!editDialogSmartdoorBindings?.rooms ||
                        editDialogSmartdoorBindings.rooms.length === 0) ? (
                        <p className="text-xs text-muted-foreground">
                          No smart door bound at property or room level in Coliving.
                        </p>
                      ) : null}
                    </div>
                  ) : editingPropertyId ? (
                    <CleanlemonPropertyNativeLocksPanel
                      scope="operator"
                      email={String(user?.email || '')}
                      operatorId={operatorId}
                      propertyId={editingPropertyId}
                      canBindAndUnbind={!operatorDoorSettingsLocked}
                      readOnlyHint={
                        operatorDoorSettingsLocked
                          ? 'This unit was created in the client portal — only the client can link or unlink TTLock here.'
                          : undefined
                      }
                    />
                  ) : null}
                </div>
                <div className="rounded-lg border p-4 space-y-4">
                  <p className="text-sm font-semibold text-foreground">Property details</p>
                  <p className="text-xs text-muted-foreground">
                    Room counts and lift level are stored on this unit (same fields as the client portal property
                    details).
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {(
                      [
                        ['bedCount', 'Bed count'],
                        ['roomCount', 'Room count'],
                        ['bathroomCount', 'Bathroom count'],
                        ['kitchen', 'Kitchen'],
                        ['livingRoom', 'Living room'],
                        ['balcony', 'Balcony'],
                        ['staircase', 'Staircase'],
                        ['specialAreaCount', 'Special area count'],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key} className="space-y-1">
                        <Label className="text-xs">{label}</Label>
                        <Input
                          inputMode="numeric"
                          value={propertyForm[key]}
                          onChange={(e) =>
                            setPropertyForm((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2 max-w-xs">
                    <Label>Lift level</Label>
                    <Select
                      value={propertyForm.liftLevel || '__none__'}
                      onValueChange={(v) =>
                        setPropertyForm((prev) => ({ ...prev, liftLevel: v === '__none__' ? '' : v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        <SelectItem value="slow">slow</SelectItem>
                        <SelectItem value="medium">medium</SelectItem>
                        <SelectItem value="fast">fast</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="rounded-lg border p-4 space-y-4">
                  <p className="text-sm font-semibold text-foreground">Cleaning price</p>
                  <p className="text-xs text-muted-foreground">
                    Choose the service provider and your MYR price for this unit (property size is set above in
                    property details).
                  </p>
                  <div className="space-y-2">
                    <Label>Cleaning price summary</Label>
                    <div className="flex gap-2">
                      <Input value={cleaningPriceSummaryText} readOnly />
                      <Button
                        variant="outline"
                        type="button"
                        disabled={!canEditCorePropertyFields}
                        onClick={() => setIsPriceSummaryOpen(true)}
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border p-4 space-y-4">
                  <p className="text-sm font-semibold text-foreground">Photos &amp; notes</p>
                  <p className="text-xs text-muted-foreground">
                    After-clean sample, key photo, estimated duration (minutes), checklist and remarks.
                  </p>
                <div className="space-y-2 max-w-md">
                  <Label>Default team</Label>
                  <Select
                    value={propertyForm.bindingTeamId ? propertyForm.bindingTeamId : '__none__'}
                    onValueChange={(v) =>
                      setPropertyForm((prev) => ({ ...prev, bindingTeamId: v === '__none__' ? '' : v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="__none__">— Unassigned —</SelectItem>
                      {operatorTeamsList.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name || t.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Default cleaning team for this unit. If the list is empty, add teams under Operator → Team first.
                  </p>
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
                    <img
                      src={
                        normalizeDamageAttachmentUrl(propertyForm.afterCleanPhotoSample) ||
                        propertyForm.afterCleanPhotoSample
                      }
                      alt="After clean sample preview"
                      className="h-28 rounded-md border object-cover"
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="property-estimated-minutes">Estimated time (minutes, optional)</Label>
                  <Input
                    id="property-estimated-minutes"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={propertyForm.estimatedTime}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === '') {
                        setPropertyForm({ ...propertyForm, estimatedTime: '' })
                        return
                      }
                      const n = parseInt(v, 10)
                      if (!Number.isFinite(n) || n < 0) return
                      setPropertyForm({ ...propertyForm, estimatedTime: String(n) })
                    }}
                    placeholder="e.g. 90"
                    disabled={!canEditCorePropertyFields}
                  />
                  <p className="text-xs text-muted-foreground">Enter minutes only (e.g. 1 hour 30 minutes = 90).</p>
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
                    <img
                      src={normalizeDamageAttachmentUrl(propertyForm.keyPhoto) || propertyForm.keyPhoto}
                      alt="Key photo preview"
                      className="h-28 rounded-md border object-cover"
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Checklist</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{propertyForm.checklist.length} item(s)</span>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={!canEditCorePropertyFields}
                      onClick={() => setIsChecklistOpen(true)}
                    >
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
                    disabled={!canEditCorePropertyFields}
                  />
                </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={isPropertyDetailSaving}
                  onClick={() => void requestSavePropertyWithMapFlow()}
                >
                  {isPropertyDetailSaving ? 'Saving…' : editingPropertyId ? 'Save Changes' : 'Add Property'}
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
              Choose the system here and enter login details. Data is saved to MySQL and shown in plain text on this
              screen when you reopen the property. Leave password empty only when saving without changing an existing
              password.
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
            <Button
              type="button"
              style={{ background: 'var(--brand)' }}
              disabled={secCredModalSaving}
              onClick={() => void handleSecurityCredentialsModalSave()}
            >
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
        <Tabs
          value={operatorPortalMainTab}
          onValueChange={(v) => {
            const next = v as 'properties' | 'groups'
            setOperatorPortalMainTab(next)
            if (next === 'properties') {
              setSelectedOperatorGroupIds(new Set())
            }
          }}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
            <TabsTrigger value="groups" className="gap-1.5">
              <Users className="h-4 w-4" />
              Group view
              <span className="text-muted-foreground">({operatorPropertyGroups.length})</span>
            </TabsTrigger>
            <TabsTrigger value="properties" className="gap-1.5">
              Property view
              <span className="text-muted-foreground">({visibleListProperties.length})</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="properties" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <Card className="flex min-h-0 flex-1 flex-col gap-0 border py-4 shadow-sm">
          <CardHeader className="flex flex-col gap-3 px-4 pb-0 pt-0 sm:px-6">
            <div className="min-w-0 space-y-1">
              <CardTitle>Property view</CardTitle>
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
                            <h2
                              className={cn(
                                'text-lg font-bold leading-snug',
                                propertyNameWarnMissingAddress(row) ? 'text-destructive' : 'text-foreground',
                              )}
                            >
                              {propertyDisplayName(row)}
                            </h2>
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
                searchKeys={['name', 'address', 'client', 'unitNumber']}
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
          </TabsContent>
          <TabsContent
            value="groups"
            className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
          >
            <Card className="flex min-h-0 flex-1 flex-col border py-4 shadow-sm">
              <CardHeader className="space-y-1 px-6 pb-2 pt-0">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5" />
                  Group view
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-6 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOperatorGroupCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    New group
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={operatorPropertyGroups.length === 0}
                    onClick={() => {
                      if (selectedOperatorGroupIds.size === operatorPropertyGroups.length) {
                        setSelectedOperatorGroupIds(new Set())
                      } else {
                        setSelectedOperatorGroupIds(new Set(operatorPropertyGroups.map((x) => x.id)))
                      }
                    }}
                  >
                    {selectedOperatorGroupIds.size === operatorPropertyGroups.length && operatorPropertyGroups.length > 0
                      ? 'Clear selection'
                      : 'Select all groups'}
                  </Button>
                  {selectedOperatorGroupIds.size > 0 ? (
                    <span className="text-xs text-muted-foreground">{selectedOperatorGroupIds.size} selected</span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Operator-only groups for routing and scheduling — separate from client portal property groups.
                </p>
                {operatorPropertyGroups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No groups yet. Create one and add properties from Property view → Actions.
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {operatorPropertyGroups.map((g) => {
                      const isOpen = opGroupExpandedId === g.id
                      const cache = opGroupDetailById[g.id]
                      const detail = cache?.detail
                      const loading = !!cache?.loading && !detail
                      return (
                        <li key={g.id} className="overflow-hidden rounded-md border bg-muted/30">
                          <div className="flex flex-wrap items-center gap-2 px-2 py-2 sm:px-3">
                            <div
                              className="flex h-8 w-8 shrink-0 items-center justify-center"
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                checked={selectedOperatorGroupIds.has(g.id)}
                                onCheckedChange={(v) => {
                                  setSelectedOperatorGroupIds((prev) => {
                                    const next = new Set(prev)
                                    if (v === true) next.add(g.id)
                                    else next.delete(g.id)
                                    return next
                                  })
                                }}
                                aria-label={`Select group ${g.name || g.id}`}
                              />
                            </div>
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none ring-offset-background hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => toggleOpGroupRow(g.id)}
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground">
                                {isOpen ? (
                                  <ChevronDown className="h-4 w-4 transition-transform" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 transition-transform" />
                                )}
                              </span>
                              <span className="min-w-0">
                                <span className="font-medium">{g.name || 'Group'}</span>
                                <span className="text-muted-foreground font-normal">
                                  {' '}
                                  · {g.propertyCount} properties
                                </span>
                              </span>
                            </button>
                            <div className="flex shrink-0 items-center gap-2 pl-1">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openManageOperatorGroup(g.id)
                                }}
                              >
                                Manage
                              </Button>
                            </div>
                          </div>
                          {isOpen ? (
                            <div className="space-y-3 border-t border-border/60 bg-background/60 px-3 py-3 sm:px-4">
                              {loading ? (
                                <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                                  <Loader2 className="h-5 w-5 animate-spin" />
                                  <span>Loading details…</span>
                                </div>
                              ) : detail?.properties?.length ? (
                                <>
                                  <div>
                                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Properties</p>
                                    <ul className="space-y-2">
                                      {detail.properties.map((p) => (
                                        <li
                                          key={p.id}
                                          className="flex flex-col gap-1 rounded border border-border/60 bg-background p-2 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                          <div className="min-w-0">
                                            <p
                                              className={cn(
                                                'text-sm font-medium',
                                                propertyGroupMemberNameWarn(p) && 'text-destructive',
                                              )}
                                            >
                                              {propertyGroupMemberLabel(p)}
                                            </p>
                                            <p className="text-xs text-muted-foreground line-clamp-2">{p.address || '—'}</p>
                                          </div>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="shrink-0"
                                            onClick={() => void removePropFromOpGroup(g.id, p.id)}
                                          >
                                            Remove
                                          </Button>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                  <div className="flex justify-end border-t border-border/60 pt-3">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                      onClick={() => void deleteOpGroup(g.id)}
                                    >
                                      Delete group
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <p className="text-xs text-muted-foreground">No properties in this group.</p>
                                  <div className="flex justify-end border-t border-border/60 pt-3">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                      onClick={() => void deleteOpGroup(g.id)}
                                    >
                                      Delete group
                                    </Button>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
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
            {propertiesWithMapCoordinatesCount === 0 && visibleListProperties.length > 0 ? (
              <p className="text-sm text-muted-foreground mb-3">
                No map pins yet: each property needs saved GPS (edit → save → confirm pin on the map), or Waze/Google
                links that contain coordinates (<span className="whitespace-nowrap">ll=</span> or{' '}
                <span className="whitespace-nowrap">@lat,lng</span>). Search-only links do not place a pin.
              </p>
            ) : null}
            <div
              className={cn(
                'flex flex-col md:flex-row rounded-lg border border-border overflow-hidden bg-background flex-1 min-h-[min(70vh,640px)]',
                'max-lg:min-h-0 max-lg:flex-1',
              )}
            >
              <aside className="flex w-full md:w-[min(100%,320px)] md:max-w-[38vw] shrink-0 flex-col border-b md:border-b-0 md:border-r border-border bg-muted/30 max-h-[min(40vh,360px)] md:max-h-none md:h-auto">
                <div className="px-3 py-2.5 border-b border-border text-sm font-semibold text-foreground">
                  Properties ({visibleListProperties.length})
                </div>
                <div className="relative px-2 pt-2 pb-1.5 border-b border-border shrink-0">
                  <Search className="pointer-events-none absolute left-5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search name, address, client…"
                    value={mapSidebarSearch}
                    onChange={(e) => setMapSidebarSearch(e.target.value)}
                    className="h-9 pl-9 text-sm"
                    aria-label="Search properties on map"
                  />
                </div>
                <div className="overflow-y-auto flex-1 p-2 space-y-1 min-h-0">
                  {mapSidebarFilteredProperties.map((property) => {
                    const Icon = typeIcons[property.type]
                    const hasGps = overviewLatLngForProperty(property) !== null
                    return (
                      <button
                        key={property.id}
                        type="button"
                        onClick={() => focusPropertyOnMap(property)}
                        className={cn(
                          'w-full rounded-md border border-transparent px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/80',
                          selectedMapListPropertyId === property.id && 'border border-primary/40 bg-accent',
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${typeColors[property.type].split(' ')[1]}`} />
                          <div className="min-w-0 flex-1">
                            <div
                              className={cn(
                                'font-medium line-clamp-2',
                                propertyNameWarnMissingAddress(property) ? 'text-destructive' : 'text-foreground',
                              )}
                            >
                              {propertyDisplayName(property)}
                            </div>
                            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{property.address}</div>
                            {!hasGps ? (
                              <span className="text-[10px] text-muted-foreground mt-1 block">No GPS saved</span>
                            ) : null}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {property.status === 'inactive' ? (
                                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                  Inactive
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </aside>
              <div className="relative z-0 min-h-[280px] h-[min(52vh,520px)] w-full min-w-0 flex-1 bg-muted md:h-[min(62vh,680px)] md:min-h-[min(62vh,680px)]">
                <div
                  ref={mapContainerRef}
                  className="leaflet-map-host absolute inset-0 min-h-[280px] md:min-h-0"
                />
                {propertiesWithMapCoordinatesCount === 0 && visibleListProperties.length > 0 ? (
                  <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center p-4">
                    <div className="max-w-sm rounded-lg border border-border bg-background/95 px-4 py-3 text-center text-sm text-muted-foreground shadow-sm">
                      No pins to show. Save GPS per property (edit → save → confirm map pin), or use navigation links
                      that embed coordinates — not plain address search links.
                    </div>
                  </div>
                ) : null}
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
                <DialogTitle
                  className={cn(
                    'flex items-center gap-2',
                    propertyNameWarnMissingAddress(selectedProperty) && 'text-destructive',
                  )}
                >
                  {(() => {
                    const Icon = typeIcons[selectedProperty.type]
                    return <Icon className="h-5 w-5" />
                  })()}
                  {propertyDisplayName(selectedProperty)}
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
                    <p className="text-sm text-muted-foreground">Estimated time</p>
                    <p className="text-sm">{selectedProperty.estimatedTime} min</p>
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
            <DialogTitle>Cleaning price</DialogTitle>
            <DialogDescription>
              Choose the same service as on your Pricing page, then enter your MYR price for this unit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground max-w-xl">
                Add a row for each services provider you use for this unit. Property size (beds, rooms, etc.) is set in
                the main form — here you only pick provider and price.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEditCorePropertyFields}
                onClick={() =>
                  setPropertyForm((prev) =>
                    withSyncedLegacyFromCleaningRows(prev, [
                      ...prev.operatorCleaningPricingRows,
                      defaultCleaningPricingRow(),
                    ])
                  )
                }
              >
                <Plus className="h-4 w-4 mr-1" />
                Add row
              </Button>
            </div>
            <div className="max-h-[min(60vh,480px)] overflow-y-auto space-y-4 pr-1">
              {propertyForm.operatorCleaningPricingRows.map((row, idx) => {
                return (
                  <div
                    key={`cleaning-row-${idx}`}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 border-b border-border pb-4 last:border-0 last:pb-0"
                  >
                    <div className="space-y-3 min-w-0">
                      <div className="space-y-2">
                        <Label>Services provider</Label>
                        <Select
                          value={row.service || 'general'}
                          disabled={!canEditCorePropertyFields}
                          onValueChange={(v) => {
                            setPropertyForm((prev) => {
                              const nextRows = prev.operatorCleaningPricingRows.map((r, j) =>
                                j === idx ? { ...r, service: v } : r
                              )
                              return withSyncedLegacyFromCleaningRows(prev, nextRows)
                            })
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select service" />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {(pricingServiceSelectOptions.length ? pricingServiceSelectOptions : PRICING_SERVICES).map(
                              (s) => (
                                <SelectItem key={s.key} value={s.key}>
                                  {s.label}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2 sm:w-[148px] sm:shrink-0">
                      <div className="flex items-start justify-between gap-2">
                        <Label>Price (MYR)</Label>
                        {propertyForm.operatorCleaningPricingRows.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 -mr-1"
                            disabled={!canEditCorePropertyFields}
                            onClick={() => {
                              setPropertyForm((prev) => {
                                if (prev.operatorCleaningPricingRows.length <= 1) return prev
                                const nextRows = prev.operatorCleaningPricingRows.filter((_, j) => j !== idx)
                                return withSyncedLegacyFromCleaningRows(prev, nextRows)
                              })
                            }}
                            aria-label="Remove row"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                      <Input
                        inputMode="decimal"
                        value={row.myr}
                        disabled={!canEditCorePropertyFields}
                        onChange={(e) => {
                          const val = e.target.value
                          setPropertyForm((prev) => {
                            const nextRows = prev.operatorCleaningPricingRows.map((r, j) =>
                              j === idx ? { ...r, myr: val } : r
                            )
                            return withSyncedLegacyFromCleaningRows(prev, nextRows)
                          })
                        }}
                        placeholder="e.g. 180"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPriceSummaryOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => setIsPriceSummaryOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk edit</DialogTitle>
            <DialogDescription>
              Apply the same property details, cleaning pricing, and/or default team to {selectedPropertyIds.size}{' '}
              selected propert
              {selectedPropertyIds.size === 1 ? 'y' : 'ies'}. Navigation links follow the address (no separate Waze /
              Google fields).
            </DialogDescription>
          </DialogHeader>
          <div
            className="rounded-md border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-xs text-foreground space-y-1.5"
            role="note"
          >
            <p className="font-semibold">What gets saved (per property)</p>
            <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
              <li>
                <span className="text-foreground font-medium">Unit number is never sent</span> in bulk edit — the
                server keeps each row&apos;s existing unit.
              </li>
              {bulkEditUsePropertySection ? (
                <>
                  <li>
                    <span className="text-foreground">Premises type</span> → always written:{' '}
                    <span className="font-mono text-foreground">{bulkEditSiteKind}</span>
                  </li>
                  {bulkEditName.trim() ? (
                    <li>
                      <span className="text-foreground">Property name</span> → written (same text for all).
                    </li>
                  ) : (
                    <li>
                      <span className="text-foreground">Property name</span> → not sent; each row keeps its current
                      name.
                    </li>
                  )}
                  {bulkEditPropertyAddress.trim() ? (
                    <li>
                      <span className="text-foreground">Address + Waze/Google links</span> → written from your bulk
                      address. If you confirm the map pin afterwards, <span className="text-foreground">latitude &amp; longitude</span> are written in the same step.
                    </li>
                  ) : (
                    <li>
                      <span className="text-foreground">Address / links / GPS</span> → not sent in this bulk (unchanged
                      until you edit elsewhere).
                    </li>
                  )}
                </>
              ) : null}
              {bulkEditUsePricing ? (
                <li>
                  <span className="text-foreground">Cleaning price</span> → one row (service + MYR) written for each
                  selected property.
                </li>
              ) : null}
              {bulkEditUseTeam ? (
                <li>
                  <span className="text-foreground">Default team</span> →{' '}
                  {bulkEditTeamId
                    ? operatorTeamsList.find((t) => t.id === bulkEditTeamId)?.name || bulkEditTeamId
                    : 'cleared (unassigned)'}{' '}
                  for each selected property.
                </li>
              ) : null}
              {!bulkEditUsePropertySection && !bulkEditUsePricing && !bulkEditUseTeam ? (
                <li>Turn on at least one section above, or nothing will be applied.</li>
              ) : null}
            </ul>
          </div>
          <div className="space-y-6 py-2">
            <div className="rounded-lg border p-4 space-y-4">
              <p className="text-sm font-semibold text-foreground">Property &amp; access</p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-edit-property-section"
                  checked={bulkEditUsePropertySection}
                  onCheckedChange={(c) => setBulkEditUsePropertySection(c === true)}
                />
                <Label htmlFor="bulk-edit-property-section" className="cursor-pointer font-normal">
                  Apply premises, property name, and address to all selected
                </Label>
              </div>
              <div className={`space-y-4 ${bulkEditUsePropertySection ? '' : 'opacity-50 pointer-events-none'}`}>
                <div className="space-y-2">
                  <Label htmlFor="bulk-site-kind">Premises type</Label>
                  <Select
                    value={bulkEditSiteKind}
                    onValueChange={(value: SiteKind) => {
                      setBulkEditSiteKind(value)
                      if (value === 'apartment' && String(bulkEditName || '').trim()) {
                        const cleaned = sanitizedOperatorPropertyDisplayNameForBulk(bulkEditName, {
                          selectedIds: selectedPropertyIds,
                        })
                        setBulkEditName(cleaned ? apartmentBuildingDisplayName(cleaned) : '')
                      }
                    }}
                  >
                    <SelectTrigger id="bulk-site-kind">
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
                  <Label htmlFor={bulkEditSiteKind === 'apartment' ? 'bulk-property-name-select' : 'bulk-property-name'}>
                    Property name
                  </Label>
                  {bulkEditSiteKind === 'apartment' ? (
                    <div className="space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <Popover open={bulkBuildingComboOpen} onOpenChange={setBulkBuildingComboOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                id="bulk-property-name-select"
                                type="button"
                                variant="outline"
                                role="combobox"
                                aria-expanded={bulkBuildingComboOpen}
                                className="h-10 w-full justify-between px-3 font-normal"
                              >
                                <span className={cn('truncate', !bulkEditName.trim() && 'text-muted-foreground')}>
                                  {bulkEditName.trim() || 'Search or select building / condo'}
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
                                  value={bulkBuildingNameInput}
                                  onValueChange={setBulkBuildingNameInput}
                                />
                                <CommandList className="max-h-[min(50vh,18rem)] flex-1">
                                  <CommandEmpty>No building found.</CommandEmpty>
                                  <CommandGroup>
                                    <CommandItem
                                      value="__clear__"
                                      onSelect={() => {
                                        setBulkEditName('')
                                        setBulkBuildingComboOpen(false)
                                      }}
                                    >
                                      Clear selection
                                    </CommandItem>
                                    {filteredBulkBuildingNames.map((n) => (
                                      <CommandItem
                                        key={n}
                                        value={n}
                                        onSelect={() => {
                                          void applyBulkBuildingDefaults(n)
                                          setBulkBuildingComboOpen(false)
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
                        Selecting a building fills the address from saved hints when available.
                      </p>
                    </div>
                  ) : (
                    <Input
                      id="bulk-property-name"
                      value={bulkEditName}
                      onChange={(e) => setBulkEditName(e.target.value)}
                      placeholder="e.g., Sunrise Villa A-12"
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bulk-address">Property address</Label>
                  <div ref={bulkAddressFieldWrapRef} className="relative">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="bulk-address"
                        className="pl-9 pr-9"
                        value={bulkEditPropertyAddress}
                        onChange={(e) => {
                          const v = e.target.value
                          setBulkEditPropertyAddress(v)
                          setBulkEditLatitude('')
                          setBulkEditLongitude('')
                          if (v.trim().length >= 3) setBulkAddressSuggestOpen(true)
                          scheduleBulkAddressSearch(v, bulkEditName)
                        }}
                        onFocus={() => {
                          setBulkAddressSuggestOpen(true)
                          if (bulkEditPropertyAddress.trim().length >= 3) {
                            scheduleBulkAddressSearch(bulkEditPropertyAddress, bulkEditName)
                          }
                        }}
                        placeholder="Type to search (Malaysia) or enter address manually"
                        autoComplete="off"
                      />
                      {bulkAddressSearchLoading ? (
                        <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                      ) : null}
                    </div>
                    {bulkAddressSuggestOpen && bulkAddressSearchItems.length > 0 ? (
                      <ul
                        className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                        role="listbox"
                      >
                        {bulkAddressSearchItems.map((item, idx) => (
                          <li key={`bulk-${item.placeId || 'p'}-${idx}`}>
                            <button
                              type="button"
                              className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => pickBulkAddressSuggestion(item)}
                            >
                              {item.displayName}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {bulkAddressSuggestOpen &&
                    !bulkAddressSearchLoading &&
                    bulkAddressSearchItems.length === 0 &&
                    bulkEditPropertyAddress.trim().length >= 3 ? (
                      <div
                        className="absolute z-50 mt-1 w-full rounded-md border bg-popover px-2 py-2 text-xs text-muted-foreground shadow-md"
                        role="status"
                      >
                        No suggestions yet. Try full building name, add city (e.g. Johor Bahru), fix spelling, or paste
                        the address manually.
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Waze and Google Maps URLs are generated from this address when you apply (same as single-property
                    save).
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-edit-team"
                  checked={bulkEditUseTeam}
                  onCheckedChange={(c) => setBulkEditUseTeam(c === true)}
                />
                <Label htmlFor="bulk-edit-team" className="cursor-pointer font-normal">
                  Set default cleaning team
                </Label>
              </div>
              <div className={`space-y-2 max-w-md ${bulkEditUseTeam ? '' : 'opacity-50 pointer-events-none'}`}>
                <Label>Team</Label>
                <Select
                  value={bulkEditTeamId ? bulkEditTeamId : '__none__'}
                  onValueChange={(v) => setBulkEditTeamId(v === '__none__' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__none__">— Unassigned (clear team) —</SelectItem>
                    {operatorTeamsList.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name || t.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-edit-price"
                  checked={bulkEditUsePricing}
                  onCheckedChange={(c) => setBulkEditUsePricing(c === true)}
                />
                <Label htmlFor="bulk-edit-price" className="cursor-pointer font-normal">
                  Update cleaning pricing (service + MYR)
                </Label>
              </div>
              <div className={`space-y-3 ${bulkEditUsePricing ? '' : 'opacity-50 pointer-events-none'}`}>
                <div className="space-y-2">
                  <Label>Services provider</Label>
                  <Select value={bulkEditService} onValueChange={setBulkEditService}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {(pricingServiceSelectOptions.length ? pricingServiceSelectOptions : PRICING_SERVICES).map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Price (MYR)</Label>
                  <Input
                    inputMode="decimal"
                    value={bulkEditPrice}
                    onChange={(e) => setBulkEditPrice(e.target.value)}
                    placeholder="e.g. 180"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setBulkEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={bulkEditWorking} onClick={() => void runBulkEditApply()}>
              {bulkEditWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addToOperatorGroupOpen}
        onOpenChange={(o) => {
          setAddToOperatorGroupOpen(o)
          if (!o) setAddToOperatorGroupPickId('')
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add to operator group</DialogTitle>
            <DialogDescription>
              Add {selectedPropertyIds.size} selected propert{selectedPropertyIds.size === 1 ? 'y' : 'ies'} to a group.
              This is separate from client portal groups.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="op-add-group">Group</Label>
            {operatorPropertyGroups.length > 0 ? (
              <Select value={addToOperatorGroupPickId || undefined} onValueChange={setAddToOperatorGroupPickId}>
                <SelectTrigger id="op-add-group">
                  <SelectValue placeholder="Select a group…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {operatorPropertyGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name || 'Group'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">Create a group first (Group view → New group).</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setAddToOperatorGroupOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!addToOperatorGroupPickId || addToOperatorGroupBusy || selectedPropertyIds.size === 0}
              onClick={() => void runAddSelectedToOperatorGroup()}
            >
              {addToOperatorGroupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={operatorGroupCreateOpen}
        onOpenChange={(o) => {
          setOperatorGroupCreateOpen(o)
          if (!o) setOperatorNewGroupName('')
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New operator group</DialogTitle>
            <DialogDescription>Name this group for your own use (not visible to clients as a client group).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="op-new-grp">Name</Label>
            <Input
              id="op-new-grp"
              value={operatorNewGroupName}
              onChange={(e) => setOperatorNewGroupName(e.target.value)}
              placeholder="e.g. West JB route"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOperatorGroupCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={operatorGroupCreating} onClick={() => void runCreateOperatorGroup()}>
              {operatorGroupCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
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

      <Dialog
        open={isMapConfirmOpen}
        onOpenChange={(open) => {
          if (!open) cancelMapConfirm()
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw]">
          <DialogHeader>
            <DialogTitle>Confirm map pin</DialogTitle>
            <DialogDescription>
              {mapConfirmBulkDeferred ? (
                <>
                  Bulk changes are <strong>not</strong> saved until you confirm below. Drag the pin, then confirm — all
                  selected properties get the same address/details, pricing (if enabled), and GPS. Starting point uses
                  Waze/Google links when present, otherwise Johor Bahru (not Kuala Lumpur).
                </>
              ) : (
                <>
                  Property details are already saved. Drag the pin to the exact location, then confirm. The starting
                  point uses your Waze/Google links when present, otherwise Johor Bahru (not Kuala Lumpur).
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Latitude {mapConfirmPinLabel.lat.toFixed(6)}, longitude {mapConfirmPinLabel.lng.toFixed(6)}
            </p>
            <div ref={mapConfirmContainerRef} className="rounded-md border overflow-hidden h-[320px] w-full z-0" />
            <a
              href={getGoogleMapUrl(String(mapConfirmPinLabel.lat), String(mapConfirmPinLabel.lng))}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary hover:underline"
            >
              Open this position on Google Maps
            </a>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={mapConfirmPatching} onClick={cancelMapConfirm}>
              {mapConfirmBulkDeferred ? 'Cancel' : 'Skip for now'}
            </Button>
            <Button disabled={mapConfirmPatching} onClick={() => void confirmMapPinAndPatchCoords()}>
              {mapConfirmPatching ? 'Saving…' : 'Confirm pin'}
            </Button>
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
        smartdoorId={doorOpenPayload?.smartdoorId}
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
