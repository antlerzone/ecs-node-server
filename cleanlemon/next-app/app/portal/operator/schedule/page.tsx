"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import 'leaflet/dist/leaflet.css'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  Plus,
  Search,
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Pencil,
  Eye,
  ChevronDown,
  Check,
  ChevronsUpDown,
  Loader2,
  ListFilter,
  ChevronLeft,
  X,
  MessageSquare,
  Trash2,
} from 'lucide-react'
import { GiveReviewDialog } from '@/components/cleanlemons/give-review-dialog'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-context'
import { useEffectiveOperatorId } from '@/lib/cleanlemon-effective-operator-id'
import { StatusBadge } from '@/components/shared/status-badge'
import type { TaskStatus } from '@/lib/types'
import {
  fetchOperatorScheduleJobs,
  fetchOperatorTeams,
  fetchOperatorContacts,
  fetchOperatorProperties,
  fetchCleanlemonPricingConfig,
  updateOperatorScheduleJob,
  deleteOperatorScheduleJob,
  createOperatorScheduleJob,
  postOperatorBulkHomestayByPropertyName,
  fetchOperatorSettings,
  fetchOperatorScheduleAiSettings,
  saveOperatorScheduleAiSettings,
  fetchOperatorPropertyGroups,
  fetchOperatorPropertyGroupDetail,
  type OperatorRegionGroup,
  type OperatorPropertyGroupRow,
} from '@/lib/cleanlemon-api'
import { malaysiaYmdForDayOffset } from '@/lib/malaysia-calendar'
import { OPERATOR_SCHEDULE_AI_DISPLAY_NAME } from '@/lib/cleanlemon-operator-ai-brand'
import {
  OPERATOR_SCHEDULE_AI_TEAM_APPLIED_EVENT,
  writeScheduleAiContextWorkingDay,
} from '@/lib/cleanlemon-operator-ai-messages'
import {
  PRICING_SERVICES,
  serviceKeyToScheduleServiceProvider,
  type ServiceKey,
} from '@/lib/cleanlemon-pricing-services'
import {
  collectJobAddonOptions,
  jobAddonBasisLabel,
  jobAddonLineTotal,
} from '@/lib/cleanlemon-schedule-pricing-addons'
import {
  buildCreateJobPriceSummary,
  getCreateJobMinSellingPrice,
} from '@/lib/cleanlemon-create-job-price-summary'
import {
  buildScheduleEndSlotOptions,
  buildScheduleStartSlotOptions,
  getCreateJobScheduleTimeStepMinutes,
  scheduleTimeSlotToMinutes,
  type ScheduleDayBounds,
} from '@/lib/cleanlemon-schedule-time-slots'
import { normalizeDamageAttachmentUrl } from '@/lib/media-url-kind'
import {
  parseOperatorCompanyHoursFromProfile,
  computeSurchargeApplySegments,
  computeOutOfWorkingHourSurcharge,
  parseMarkupNumeric,
  getBookableDayBoundsMin,
  buildCompanyOohSummaryLines,
  type OperatorCompanyHoursInput,
} from '@/lib/cleanlemon-company-working-hours'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

const DEFAULT_AREA_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2', '#ea580c']

function normalizeRegionGroupsClient(raw: unknown): OperatorRegionGroup[] {
  if (!Array.isArray(raw)) return []
  return raw.map((g, i) => {
    const row = g as Record<string, unknown>
    const id = String(row?.id || `area-${i + 1}`).trim() || `area-${i + 1}`
    const name = String(row?.name || `Area ${String.fromCharCode(65 + (i % 26))}`).trim() || `Area ${i + 1}`
    const color = String(row?.color || '').trim() || DEFAULT_AREA_COLORS[i % DEFAULT_AREA_COLORS.length]
    const propertyIds = Array.isArray(row?.propertyIds)
      ? row.propertyIds.map((x) => String(x).trim()).filter(Boolean)
      : []
    return { id, name, color, propertyIds }
  })
}

/** One row from `fetchOperatorProperties` — used for Create Job pricing hints. */
type SchedulePropertyRow = {
  id: string
  name: string
  unitNumber: string
  label: string
  premisesType?: string
  generalCleaning?: number
  cleaningFees?: number
  warmCleaning?: number
  deepCleaning?: number
  renovationCleaning?: number
  wazeUrl?: string
  googleMapsUrl?: string
  latitude?: number | null
  longitude?: number | null
}

/**
 * Same math as single-property Create Job summary — used for bulk create (per property).
 */
function computeCreateJobChargesForScheduleRow(
  row: SchedulePropertyRow | undefined,
  args: {
    serviceKey: ServiceKey
    pricingServiceConfigs: Record<string, unknown> | null
    durationHours: number | null
    addonTotal: number
    minSelling: number
    requiresTime: boolean
    timeStart: string
    timeEnd: string
    operatorCompanyHours: OperatorCompanyHoursInput | null
    surchargeSegments: [number, number][]
  }
): {
  coreSubtotal: number | null
  grandTotal: number | null
  meetsMinimum: boolean
  label: string
} {
  const fees = row
    ? {
        generalCleaning: row.generalCleaning,
        cleaningFees: row.cleaningFees,
        warmCleaning: row.warmCleaning,
        deepCleaning: row.deepCleaning,
        renovationCleaning: row.renovationCleaning,
      }
    : null
  const summary = buildCreateJobPriceSummary(args.serviceKey, args.pricingServiceConfigs, {
    premisesType: row?.premisesType,
    durationHours: args.durationHours,
    propertyFees: fees,
  })
  const base = summary.indicativeBaseAmount
  const label = row?.label || row?.name || row?.id || '—'
  if (base == null) {
    return {
      coreSubtotal: null,
      grandTotal: null,
      meetsMinimum: args.minSelling <= 0,
      label,
    }
  }
  const coreSubtotal = Math.round((base + args.addonTotal) * 100) / 100
  const meetsMinimum = args.minSelling <= 0 || coreSubtotal >= args.minSelling
  let floor = coreSubtotal
  if (args.minSelling > 0) floor = Math.max(floor, args.minSelling)

  if (!args.requiresTime || !args.timeStart.trim() || !args.timeEnd.trim() || !args.operatorCompanyHours) {
    return { coreSubtotal, grandTotal: Math.round(floor * 100) / 100, meetsMinimum, label }
  }
  const a = scheduleTimeSlotToMinutes(args.timeStart)
  const b = scheduleTimeSlotToMinutes(args.timeEnd)
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) {
    return { coreSubtotal, grandTotal: Math.round(floor * 100) / 100, meetsMinimum, label }
  }
  const val = parseMarkupNumeric(args.operatorCompanyHours)
  const ooh = computeOutOfWorkingHourSurcharge(
    floor,
    a,
    b,
    args.surchargeSegments,
    args.operatorCompanyHours.outOfWorkingHourMarkupMode,
    val
  )
  return {
    coreSubtotal,
    grandTotal: Math.round((floor + ooh) * 100) / 100,
    meetsMinimum,
    label,
  }
}

function schedulePropertyRowKey(job: Pick<Job, 'property' | 'unitNumber' | 'address'>) {
  return `${job.property}-${job.unitNumber || ''}-${job.address}`
}

/** When Waze/Google URLs have no parseable coordinates, spread pins around JB (same default as property page), not KL. */
const DEFAULT_AREA_MAP_LAT = 1.492659
const DEFAULT_AREA_MAP_LNG = 103.741359

function latLngJitterForPropertyId(id: string): { lat: number; lng: number } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const r = (h % 1000) / 80000
  const r2 = ((h >> 8) % 1000) / 80000
  return { lat: DEFAULT_AREA_MAP_LAT + r, lng: DEFAULT_AREA_MAP_LNG + r2 }
}

/** Same parsing as operator property page — coords from Waze `ll=` or Google `@lat,lng`. */
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

interface Team {
  id: string
  name: string
  members: string[]
}

interface Job {
  id: string
  property: string
  unitNumber?: string
  client: string
  address: string
  price?: number
  propertyType: 'homestay' | 'office' | 'residential' | 'commercial'
  serviceProvider: string
  date: string
  time?: string
  status: TaskStatus
  /** Raw `cln_schedule.status` when present — used to distinguish Customer Missing vs pending-checkout in UI. */
  statusRaw?: string
  estimateKpi: number
  teamId: string | null
  /** When set, schedule row had a team name in DB that did not match an operator team id. */
  teamName?: string | null
  remarks?: string
  pricingAddons?: Array<{
    id?: string
    name: string
    basis: string
    price: number
    quantity: number
    subtotal?: number
  }>
  lat: number
  lng: number
  /** cln_property.id — used for area / map coloring */
  propertyId?: string
  staffStartTime?: string
  staffEndTime?: string
  staffRemark?: string
  completedPhotos?: string[]
  aiAssignmentLocked?: boolean
  /** Who created this schedule row (when column exists). */
  createdByEmail?: string
  /** Who first moved status to ready-to-clean (when column exists). */
  readyToCleanByEmail?: string
  readyToCleanAt?: string
  /** Same-day checkout + check-in — client / operator priority flag */
  btob?: boolean
}
interface PropertyGroup {
  property: string
  unitNumber?: string
  /** cln_property.id from first job in group */
  propertyId?: string
  client: string
  address: string
  totalPrice: number
  lat: number
  lng: number
  jobs: Job[]
  teamNames: string[]
  unassignedCount: number
  averageKpi: number
}

function schedulePropertyGroupIsFullyCompleted(group: PropertyGroup): boolean {
  return group.jobs.length > 0 && group.jobs.every((j) => j.status === 'completed')
}

function collectCompletionPhotoUrls(job: Job, group: PropertyGroup | undefined): string[] {
  const jobs =
    group && schedulePropertyGroupIsFullyCompleted(group) ? group.jobs : [job]
  const seen = new Set<string>()
  const out: string[] = []
  for (const j of jobs) {
    for (const u of j.completedPhotos ?? []) {
      const s = String(u || '').trim()
      if (!s) continue
      const display = normalizeDamageAttachmentUrl(s)
      if (!display || seen.has(display)) continue
      seen.add(display)
      out.push(display)
    }
  }
  return out
}

const SCHEDULE_TIME_SELECT_EMPTY = '__none__'

function deriveServiceKeyFromJob(job: Job, allowedKeys: ServiceKey[]): ServiceKey {
  const sp = String(job.serviceProvider || '').trim()
  const hit = allowedKeys.find((k) => serviceKeyToScheduleServiceProvider(k) === sp)
  return hit ?? 'general'
}

function parseJobTimeSlots(timeStr: string | undefined): { start: string; end: string } {
  if (!timeStr) return { start: '', end: '' }
  const m = timeStr.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)
  if (!m) return { start: '', end: '' }
  const pad = (t: string) => {
    const [h, mm] = t.split(':')
    const hh = Math.min(23, Math.max(0, parseInt(h, 10) || 0))
    return `${String(hh).padStart(2, '0')}:${mm || '00'}`
  }
  return { start: pad(m[1]), end: pad(m[2]) }
}

function formatPropertyRowLabel(name: string, unitNumber: string): string {
  const apt = (name || '').trim()
  const unit = (unitNumber || '').trim()
  if (apt && unit) return `${apt} · ${unit}`
  if (apt) return apt
  if (unit) return unit
  return '—'
}

/** Multi-select: empty `selected` = no filter (all). Checkbox “all on” when empty. */
function toggleStringInMultiFilter(opt: string, options: string[], selected: string[]): string[] {
  if (options.length === 0) return []
  if (selected.length === 0) {
    return options.filter((o) => o !== opt)
  }
  if (selected.includes(opt)) {
    const next = selected.filter((o) => o !== opt)
    return next.length === 0 ? [] : next
  }
  const next = [...selected, opt]
  return next.length === options.length ? [] : next
}

function isCheckedInMultiFilter(opt: string, options: string[], selected: string[]): boolean {
  if (options.length === 0) return false
  return selected.length === 0 || selected.includes(opt)
}

function multiFilterSummary(
  options: string[],
  selected: string[],
  allLabel: string,
  countNoun: string
): string {
  if (selected.length === 0) return allLabel
  if (selected.length === 1) return selected[0]
  if (options.length > 0 && selected.length === options.length) return allLabel
  return `${selected.length} ${countNoun}`
}

/** Status values allowed in job-list quick `<select>` (excludes cancelled, completed = read-only badge). */
const JOB_LIST_QUICK_STATUS_KEYS = new Set([
  'pending-checkout',
  'ready-to-clean',
  'in-progress',
  'customer-missing',
])

/** Map first job in row → `<select>` value (internal keys). */
function jobRowStatusSelectValue(job: Job | undefined): string {
  if (!job) return 'pending-checkout'
  const raw = String(job.statusRaw || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
  if (job.status === 'pending-checkout') {
    if (raw.includes('customer') && raw.includes('missing')) return 'customer-missing'
    return 'pending-checkout'
  }
  return String(job.status || 'pending-checkout')
}

/** Job-list row sort: workflow order (low = earlier in pipeline). */
function jobListGroupStatusRank(group: PropertyGroup): number {
  const v = jobRowStatusSelectValue(group.jobs[0])
  const m: Record<string, number> = {
    'pending-checkout': 10,
    'ready-to-clean': 20,
    'in-progress': 30,
    'customer-missing': 35,
    completed: 40,
  }
  return m[v] ?? 50
}

function jobListGroupTeamSortLabel(group: PropertyGroup): string {
  if (!group.teamNames.length) return ''
  return [...group.teamNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).join(', ')
}

/** DB status string for PATCH. */
function mapStatusSelectKeyToDbStatus(key: string): string {
  if (key === 'customer-missing') return 'Customer Missing'
  return key
}

/** Plain HTML select: avoids Radix Select mount sync firing parent setState during subtree commit (dev warning). */
function ScheduleJobQuickStatusSelect({
  value,
  disabled,
  className,
  onCommit,
}: {
  value: string
  disabled?: boolean
  className?: string
  onCommit: (next: string) => void
}) {
  return (
    <select
      className={cn(
        'rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value
        if (v === value) return
        onCommit(v)
      }}
    >
      <option value="pending-checkout">Pending check out</option>
      <option value="ready-to-clean">Ready to clean</option>
      <option value="in-progress">Customer extend</option>
      <option value="customer-missing" style={{ color: 'rgb(220 38 38)' }}>
        Customer missing
      </option>
      <option value="completed">Completed</option>
    </select>
  )
}

function ScheduleMultiCheckboxFilter({
  label,
  optionsSorted,
  selected,
  onSelectedChange,
  allLabel,
  countNoun,
}: {
  label: string
  optionsSorted: string[]
  selected: string[]
  onSelectedChange: (next: string[]) => void
  allLabel: string
  countNoun: string
}) {
  const [open, setOpen] = useState(false)
  const summary = multiFilterSummary(optionsSorted, selected, allLabel, countNoun)

  return (
    <div className="min-w-0">
      <Label className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full justify-between gap-2 px-3 font-normal"
            aria-expanded={open}
          >
            <span className="truncate text-left">{summary}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            {selected.length > 0 ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onSelectedChange([])}>
                Show all
              </Button>
            ) : null}
          </div>
          <ScrollArea className="h-64">
            <div className="p-2 space-y-0.5">
              {optionsSorted.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-3">No options for current jobs</p>
              ) : (
                optionsSorted.map((opt) => (
                  <label
                    key={opt}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm',
                      'hover:bg-accent/80'
                    )}
                  >
                    <Checkbox
                      checked={isCheckedInMultiFilter(opt, optionsSorted, selected)}
                      onCheckedChange={() => onSelectedChange(toggleStringInMultiFilter(opt, optionsSorted, selected))}
                    />
                    <span className="min-w-0 flex-1 leading-snug">{opt}</span>
                  </label>
                ))
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default function SchedulePage() {
  const { user } = useAuth()
  const router = useRouter()
  const operatorId = useEffectiveOperatorId(user)
  const operatorEmail = String(user?.email || '').trim().toLowerCase()
  const [scheduleDay, setScheduleDay] = useState(() => malaysiaYmdForDayOffset(0))
  useEffect(() => {
    const y = String(scheduleDay || '').trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(y)) return
    writeScheduleAiContextWorkingDay(operatorId, y)
  }, [scheduleDay, operatorId])
  const [teams, setTeams] = useState<Team[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [propertyRows, setPropertyRows] = useState<SchedulePropertyRow[]>([])
  /** `null` = not loaded yet; empty = loaded with no selection (fallback to all service keys). */
  const [pricingSelectedServices, setPricingSelectedServices] = useState<ServiceKey[] | null>(null)
  /** Operator Pricing → Section 2 service configs (add-ons per service). */
  const [pricingServiceConfigs, setPricingServiceConfigs] = useState<Record<string, unknown> | null>(null)
  /** Booking mode / lead time (for info; operator Create Job is always instant). */
  const [pricingBookingMeta, setPricingBookingMeta] = useState<{
    bookingMode: string
    bookingModeByService?: Record<string, string>
    leadTime: string
  } | null>(null)
  /** Company → working / out-of-hours (for time bounds + surcharge). */
  const [operatorCompanyHours, setOperatorCompanyHours] = useState<OperatorCompanyHoursInput | null>(null)
  const [createJobAddonDraft, setCreateJobAddonDraft] = useState<
    Record<string, { selected: boolean; qty: number }>
  >({})

  const [regionGroups, setRegionGroups] = useState<OperatorRegionGroup[]>([])
  const [areasEditorOpen, setAreasEditorOpen] = useState(false)
  const [areasSaveRunning, setAreasSaveRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<'team' | 'job' | 'map'>('team')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedClients, setSelectedClients] = useState<string[]>([])
  const [selectedProperties, setSelectedProperties] = useState<string[]>([])
  const [teamFilter, setTeamFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'priority' | 'kpi-high' | 'kpi-low'>('priority')
  type JobListGroupSortKey = 'default' | 'property' | 'client' | 'price' | 'team' | 'status'
  const [jobListGroupSort, setJobListGroupSort] = useState<{ key: JobListGroupSortKey; asc: boolean }>({
    key: 'default',
    asc: false,
  })
  const [selectedPropertyKeys, setSelectedPropertyKeys] = useState<string[]>([])
  const [teamEditOpen, setTeamEditOpen] = useState(false)
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [btobSavingGroupKey, setBtobSavingGroupKey] = useState<string | null>(null)
  const [teamSavingGroupKey, setTeamSavingGroupKey] = useState<string | null>(null)
  const [statusSavingGroupKey, setStatusSavingGroupKey] = useState<string | null>(null)
  const [editingScheduleJobId, setEditingScheduleJobId] = useState<string | null>(null)
  /** Completed jobs: same dialog as edit but inputs disabled (no save). */
  const [scheduleJobDialogReadOnly, setScheduleJobDialogReadOnly] = useState(false)
  /** URLs from `completedPhotos` (merged for fully-completed property row when `group` passed to view). */
  const [viewDetailCompletionPhotos, setViewDetailCompletionPhotos] = useState<string[]>([])
  /** In-page zoom for completion photos (no new tab). */
  const [completionPhotoLightboxUrl, setCompletionPhotoLightboxUrl] = useState<string | null>(null)
  const [clientReviewOpen, setClientReviewOpen] = useState(false)
  const [clientReviewJob, setClientReviewJob] = useState<Job | null>(null)
  const [clientReviewPhotoUrls, setClientReviewPhotoUrls] = useState<string[]>([])
  /** Schedule row id shown in Edit / View detail header (copy); cleared on create or close. */
  const [scheduleJobDialogJobId, setScheduleJobDialogJobId] = useState<string | null>(null)
  const skipNextAddonSignatureEffectRef = useRef(false)
  /** When opening Edit job, skip Dialog `onOpenChange(true)` resetting price dirty (would fight openEdit prefill). */
  const suppressDialogOpenPriceDirtyResetRef = useRef(false)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  /** Align with client booking: single / bulk (list) / group (operator property group). */
  const [createJobMode, setCreateJobMode] = useState<'single' | 'bulk' | 'group'>('single')
  /** Wizard: property → service & time → summary (same flow as client /portal/client booking). */
  const [createJobStep, setCreateJobStep] = useState<'property' | 'schedule' | 'summary'>('property')
  const [createJobGroupId, setCreateJobGroupId] = useState('')
  const [operatorPropertyGroups, setOperatorPropertyGroups] = useState<OperatorPropertyGroupRow[]>([])
  const [bulkCreatePropertyIds, setBulkCreatePropertyIds] = useState<string[]>([])
  const [createJobPropertyFilter, setCreateJobPropertyFilter] = useState('')
  const [newTaskServiceKey, setNewTaskServiceKey] = useState<ServiceKey>('general')
  const [newTaskPropertyId, setNewTaskPropertyId] = useState('')
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false)
  const [newTaskDate, setNewTaskDate] = useState(() => malaysiaYmdForDayOffset(0))
  const [newTaskTimeStart, setNewTaskTimeStart] = useState('')
  const [newTaskTimeEnd, setNewTaskTimeEnd] = useState('')
  const [newTaskRemark, setNewTaskRemark] = useState('')
  /** Create Job: final RM total (markup); synced from estimate unless operator edits. */
  const [createJobPriceInput, setCreateJobPriceInput] = useState('')
  const [createJobPriceDirty, setCreateJobPriceDirty] = useState(false)
  const [bulkExtendDialogOpen, setBulkExtendDialogOpen] = useState(false)
  const [bulkExtendYmd, setBulkExtendYmd] = useState('')
  const [bulkHomestayDialogOpen, setBulkHomestayDialogOpen] = useState(false)
  const [bulkHomestayNameContains, setBulkHomestayNameContains] = useState('arc')
  const [bulkHomestayRunning, setBulkHomestayRunning] = useState(false)
  /** Job list: pick new working day before applying `in-progress` (customer extend). */
  const [rowExtendDialogOpen, setRowExtendDialogOpen] = useState(false)
  const [rowExtendGroup, setRowExtendGroup] = useState<PropertyGroup | null>(null)
  const [rowExtendYmd, setRowExtendYmd] = useState('')
  /** Job list row: confirm delete one or more schedule rows for the same property/unit group. */
  const [deleteJobsConfirmGroup, setDeleteJobsConfirmGroup] = useState<PropertyGroup | null>(null)
  const [deleteJobsSaving, setDeleteJobsSaving] = useState(false)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const leafletMapRef = useRef<any>(null)
  const jobMapContainerRef = useRef<HTMLDivElement | null>(null)
  const jobLeafletMapRef = useRef<any>(null)
  const areasMapContainerRef = useRef<HTMLDivElement | null>(null)
  const areasLeafletMapRef = useRef<any>(null)

  useEffect(() => {
    if (!completionPhotoLightboxUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCompletionPhotoLightboxUrl(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [completionPhotoLightboxUrl])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await fetchOperatorSettings(operatorId)
      if (cancelled || !r?.ok) return
      const s = (r as { settings?: { companyProfile?: Record<string, unknown> } }).settings || {}
      const cp = s.companyProfile
      setOperatorCompanyHours(
        parseOperatorCompanyHoursFromProfile(cp && typeof cp === 'object' ? cp : null)
      )
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  const addRegionGroup = () => {
    setRegionGroups((prev) => [
      ...prev,
      {
        id: `area-${Date.now()}`,
        name: `Area ${String.fromCharCode(65 + (prev.length % 26))}`,
        color: DEFAULT_AREA_COLORS[prev.length % DEFAULT_AREA_COLORS.length],
        propertyIds: [],
      },
    ])
  }

  const updateRegionGroup = (index: number, patch: Partial<OperatorRegionGroup>) => {
    setRegionGroups((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const removeRegionGroup = (index: number) => {
    setRegionGroups((prev) => prev.filter((_, i) => i !== index))
  }

  const togglePropertyInRegion = (areaIndex: number, propertyId: string) => {
    setRegionGroups((prev) => {
      const next = prev.map((r) => ({ ...r, propertyIds: [...r.propertyIds] }))
      const target = next[areaIndex]
      if (!target) return prev
      const set = new Set(target.propertyIds)
      if (set.has(propertyId)) {
        set.delete(propertyId)
      } else {
        for (let i = 0; i < next.length; i++) {
          if (i !== areaIndex) {
            next[i].propertyIds = next[i].propertyIds.filter((id) => id !== propertyId)
          }
        }
        set.add(propertyId)
      }
      target.propertyIds = [...set]
      return next
    })
  }

  const loadSchedulePage = useCallback(async (opts?: { bustScheduleCache?: boolean }) => {
    const [tj, tt, tc, tp, pc, aiSt] = await Promise.all([
      fetchOperatorScheduleJobs({ operatorId, limit: 800, bustCache: !!opts?.bustScheduleCache }),
      fetchOperatorTeams(operatorId),
      fetchOperatorContacts(operatorId),
      fetchOperatorProperties(operatorId),
      fetchCleanlemonPricingConfig(operatorId),
      fetchOperatorScheduleAiSettings(operatorId, { email: operatorEmail }),
    ])
    const contactItems = tc.ok && Array.isArray(tc.items) ? tc.items : []
    const teamItems = tt.ok && Array.isArray(tt.items) ? tt.items : []
    const teamList: Team[] = teamItems.map(
      (t: { id: string; name: string; memberIds?: string[] }) => ({
        id: t.id,
        name: t.name,
        members: (t.memberIds || [])
          .map((mid: string) => contactItems.find((c: { id: string }) => c.id === mid)?.name || mid)
          .filter(Boolean),
      })
    )
    setTeams(teamList)
    if (tj.ok && Array.isArray(tj.items)) {
      setJobs(tj.items as Job[])
    } else {
      setJobs([])
      if (!tj.ok) toast.error('Failed to load schedule jobs')
    }
    if (pc.ok && pc.config && Array.isArray(pc.config.selectedServices)) {
      const safe = pc.config.selectedServices.filter((key): key is ServiceKey =>
        PRICING_SERVICES.some((s) => s.key === key)
      )
      setPricingSelectedServices(safe)
    } else {
      setPricingSelectedServices([])
    }
    if (pc.ok && pc.config?.serviceConfigs && typeof pc.config.serviceConfigs === 'object') {
      setPricingServiceConfigs(pc.config.serviceConfigs as Record<string, unknown>)
    } else {
      setPricingServiceConfigs(null)
    }
    if (pc.ok && pc.config && typeof pc.config === 'object') {
      const cfg = pc.config as {
        bookingMode?: string
        bookingModeByService?: Record<string, string>
        leadTime?: string
      }
      setPricingBookingMeta({
        bookingMode: String(cfg.bookingMode || 'instant'),
        bookingModeByService:
          cfg.bookingModeByService && typeof cfg.bookingModeByService === 'object'
            ? cfg.bookingModeByService
            : undefined,
        leadTime: String(cfg.leadTime || 'same_day'),
      })
    } else {
      setPricingBookingMeta(null)
    }
    if (tp.ok && Array.isArray(tp.items)) {
      const fee = (v: unknown) => {
        if (v == null || v === '') return undefined
        const n = Number(v)
        return Number.isFinite(n) && n > 0 ? n : undefined
      }
      setPropertyRows(
        tp.items.map(
          (p: {
            id: string
            name?: string
            unitNumber?: string
            premisesType?: string
            cleaningFees?: unknown
            generalCleaning?: unknown
            warmCleaning?: unknown
            deepCleaning?: unknown
            renovationCleaning?: unknown
            wazeUrl?: string
            googleMapsUrl?: string
            latitude?: unknown
            longitude?: unknown
          }) => {
            const name = (p.name || '').trim()
            const unitNumber = (p.unitNumber || '').trim()
            const premisesType = String(p.premisesType || '').trim()
            const wz = String(p.wazeUrl || '').trim()
            const gz = String(p.googleMapsUrl || '').trim()
            const la = p.latitude != null && String(p.latitude).trim() !== '' ? Number(p.latitude) : NaN
            const lo = p.longitude != null && String(p.longitude).trim() !== '' ? Number(p.longitude) : NaN
            const hasDbCoords =
              Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180
            return {
              id: p.id,
              name,
              unitNumber,
              label: formatPropertyRowLabel(name, unitNumber),
              ...(premisesType ? { premisesType } : {}),
              ...(fee(p.cleaningFees) != null ? { cleaningFees: fee(p.cleaningFees) } : {}),
              ...(fee(p.generalCleaning) != null ? { generalCleaning: fee(p.generalCleaning) } : {}),
              ...(fee(p.warmCleaning) != null ? { warmCleaning: fee(p.warmCleaning) } : {}),
              ...(fee(p.deepCleaning) != null ? { deepCleaning: fee(p.deepCleaning) } : {}),
              ...(fee(p.renovationCleaning) != null ? { renovationCleaning: fee(p.renovationCleaning) } : {}),
              ...(wz ? { wazeUrl: wz } : {}),
              ...(gz ? { googleMapsUrl: gz } : {}),
              ...(hasDbCoords ? { latitude: la, longitude: lo } : {}),
            }
          }
        )
      )
    } else {
      setPropertyRows([])
    }
    if (aiSt?.ok && aiSt.data?.regionGroups) {
      setRegionGroups(normalizeRegionGroupsClient(aiSt.data.regionGroups))
    }
  }, [operatorId, operatorEmail])

  const saveAreasFromEditor = useCallback(async () => {
    setAreasSaveRunning(true)
    try {
      const r = await saveOperatorScheduleAiSettings(
        operatorId,
        { regionGroups: normalizeRegionGroupsClient(regionGroups) },
        { email: operatorEmail }
      )
      if (!r.ok) {
        toast.error(typeof r.reason === 'string' ? r.reason : 'Save failed')
        return
      }
      toast.success('Areas saved')
      setAreasEditorOpen(false)
      await loadSchedulePage()
    } finally {
      setAreasSaveRunning(false)
    }
  }, [operatorId, operatorEmail, regionGroups, loadSchedulePage])

  useEffect(() => {
    void loadSchedulePage()
  }, [loadSchedulePage])

  useEffect(() => {
    const onJarvisTeamApplied = (ev: Event) => {
      const ce = ev as CustomEvent<{ operatorId?: string; workingDay?: string }>
      const wid = String(operatorId || '').trim()
      const oid = String(ce.detail?.operatorId || '').trim()
      if (oid && wid && oid !== wid) return
      // #region agent log
      fetch('http://127.0.0.1:7739/ingest/e3e79611-3662-4b91-9509-c2e13537425d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ec8515' },
        body: JSON.stringify({
          sessionId: 'ec8515',
          hypothesisId: 'H9_UI_REFRESH',
          location: 'schedule/page.tsx:onJarvisTeamApplied',
          message: 'schedule refetch triggered',
          data: { operatorId: wid, detailOid: oid, workingDay: String(ce.detail?.workingDay || '').slice(0, 12) },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
      void loadSchedulePage({ bustScheduleCache: true }).then(() => {
        try {
          router.refresh()
        } catch {
          /* ignore */
        }
      })
    }
    window.addEventListener(OPERATOR_SCHEDULE_AI_TEAM_APPLIED_EVENT, onJarvisTeamApplied)
    return () => window.removeEventListener(OPERATOR_SCHEDULE_AI_TEAM_APPLIED_EVENT, onJarvisTeamApplied)
  }, [loadSchedulePage, operatorId, router])

  const scheduleServiceOptions = useMemo(() => {
    const keys =
      pricingSelectedServices == null || pricingSelectedServices.length === 0
        ? PRICING_SERVICES.map((s) => s.key)
        : pricingSelectedServices
    const set = new Set(keys)
    return PRICING_SERVICES.filter((s) => set.has(s.key))
  }, [pricingSelectedServices])

  const requiresTime = newTaskServiceKey !== 'homestay'

  const scheduleTimeStepMinutes = useMemo(
    () => getCreateJobScheduleTimeStepMinutes(newTaskServiceKey, pricingServiceConfigs ?? undefined),
    [newTaskServiceKey, pricingServiceConfigs]
  )

  /** Bookable clock range from Company → out-of-working hours (e.g. 7:00–24:00). */
  const scheduleDayBounds: ScheduleDayBounds | undefined = useMemo(() => {
    if (!operatorCompanyHours) return undefined
    const of = String(operatorCompanyHours.outOfWorkingHourFrom || '').trim()
    const ot = String(operatorCompanyHours.outOfWorkingHourTo || '').trim()
    if (!of || !ot) return undefined
    const b = getBookableDayBoundsMin(of, ot)
    return { dayStartMin: b.dayStartMin, dayEndMin: b.dayEndMin }
  }, [operatorCompanyHours])

  const surchargeSegments = useMemo(() => {
    if (!operatorCompanyHours) return [] as [number, number][]
    const wf = String(operatorCompanyHours.workingHourFrom || '').trim()
    const wt = String(operatorCompanyHours.workingHourTo || '').trim()
    const of = String(operatorCompanyHours.outOfWorkingHourFrom || '').trim()
    const ot = String(operatorCompanyHours.outOfWorkingHourTo || '').trim()
    if (!wf || !wt || !of || !ot) return []
    return computeSurchargeApplySegments(wf, wt, of, ot)
  }, [operatorCompanyHours])

  const companyOohSummaryLines = useMemo(
    () => (operatorCompanyHours ? buildCompanyOohSummaryLines(operatorCompanyHours) : []),
    [operatorCompanyHours]
  )

  const scheduleStartTimeOptions = useMemo(
    () => buildScheduleStartSlotOptions(scheduleTimeStepMinutes, scheduleDayBounds),
    [scheduleTimeStepMinutes, scheduleDayBounds]
  )

  const scheduleEndTimeOptions = useMemo(() => {
    if (!newTaskTimeStart) return []
    return buildScheduleEndSlotOptions(newTaskTimeStart, scheduleTimeStepMinutes, scheduleDayBounds)
  }, [newTaskTimeStart, scheduleTimeStepMinutes, scheduleDayBounds])

  const hasCreateJobPropertySelection = useMemo(() => {
    if (createJobMode === 'single') return !!newTaskPropertyId
    if (createJobMode === 'group') return !!createJobGroupId && bulkCreatePropertyIds.length > 0
    return bulkCreatePropertyIds.length > 0
  }, [createJobMode, newTaskPropertyId, createJobGroupId, bulkCreatePropertyIds])

  const createJobScheduleStepValid = useMemo(() => {
    if (scheduleServiceOptions.length === 0) return false
    const d = String(newTaskDate || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
    if (!requiresTime) return true
    if (!newTaskTimeStart?.trim() || !newTaskTimeEnd?.trim()) return false
    const a = scheduleTimeSlotToMinutes(newTaskTimeStart)
    const b = scheduleTimeSlotToMinutes(newTaskTimeEnd)
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return false
    const dur = b - a
    return dur >= scheduleTimeStepMinutes && dur % scheduleTimeStepMinutes === 0
  }, [
    scheduleServiceOptions.length,
    newTaskDate,
    requiresTime,
    newTaskTimeStart,
    newTaskTimeEnd,
    scheduleTimeStepMinutes,
  ])

  useEffect(() => {
    if (!newTaskOpen || !operatorId) return
    let cancelled = false
    void (async () => {
      const r = await fetchOperatorPropertyGroups(operatorId)
      if (cancelled || !r?.ok) return
      setOperatorPropertyGroups(Array.isArray(r.items) ? r.items : [])
    })()
    return () => {
      cancelled = true
    }
  }, [newTaskOpen, operatorId])

  useEffect(() => {
    if (createJobMode !== 'group' || !operatorId) return
    if (!createJobGroupId) {
      setBulkCreatePropertyIds([])
      return
    }
    let cancelled = false
    void (async () => {
      const d = await fetchOperatorPropertyGroupDetail(operatorId, createJobGroupId)
      if (cancelled) return
      const allowed = new Set(propertyRows.map((p) => p.id))
      if (d?.ok && Array.isArray(d.group?.properties) && d.group.properties.length > 0) {
        const list = d.group.properties
          .map((x) => String(x.id || '').trim())
          .filter(Boolean)
          .filter((id) => allowed.has(id))
        setBulkCreatePropertyIds(list)
      } else {
        setBulkCreatePropertyIds([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [createJobMode, createJobGroupId, operatorId, propertyRows])

  useEffect(() => {
    if (editingScheduleJobId || scheduleJobDialogReadOnly) return
    setNewTaskTimeStart('')
    setNewTaskTimeEnd('')
  }, [newTaskServiceKey, scheduleTimeStepMinutes, scheduleDayBounds, editingScheduleJobId, scheduleJobDialogReadOnly])

  const clientBookingLabelForService = useMemo(() => {
    if (!pricingBookingMeta) return null
    const bySvc = pricingBookingMeta.bookingModeByService?.[newTaskServiceKey]
    const mode = String(bySvc || pricingBookingMeta.bookingMode || 'instant').toLowerCase()
    if (mode.includes('request') && !mode.includes('instant')) return 'Request booking & approve'
    return 'Accept booking instant'
  }, [pricingBookingMeta, newTaskServiceKey])

  const createJobMinSelling = useMemo(
    () => getCreateJobMinSellingPrice(newTaskServiceKey, pricingServiceConfigs ?? undefined),
    [newTaskServiceKey, pricingServiceConfigs]
  )

  const createJobAddonOptions = useMemo(
    () => collectJobAddonOptions(newTaskServiceKey, pricingServiceConfigs),
    [newTaskServiceKey, pricingServiceConfigs]
  )

  const createJobAddonSignature = useMemo(
    () => createJobAddonOptions.map((o) => `${o.id}:${o.name}:${o.basis}:${o.price}`).join('|'),
    [createJobAddonOptions]
  )

  useEffect(() => {
    if (skipNextAddonSignatureEffectRef.current) {
      skipNextAddonSignatureEffectRef.current = false
      return
    }
    const opts = collectJobAddonOptions(newTaskServiceKey, pricingServiceConfigs)
    setCreateJobAddonDraft((prev) => {
      const next: Record<string, { selected: boolean; qty: number }> = {}
      for (const o of opts) {
        const p = prev[o.id]
        next[o.id] = {
          selected: p?.selected ?? false,
          qty: Math.max(1, Math.floor(p?.qty ?? 1)),
        }
      }
      return next
    })
  }, [createJobAddonSignature, newTaskServiceKey, pricingServiceConfigs])

  const createJobSelectedAddonTotal = useMemo(() => {
    let sum = 0
    for (const o of createJobAddonOptions) {
      if (!createJobAddonDraft[o.id]?.selected) continue
      const qty =
        o.basis === 'fixed' ? 1 : Math.max(1, Math.floor(createJobAddonDraft[o.id]?.qty ?? 1))
      sum += jobAddonLineTotal(o.price, o.basis, qty)
    }
    return Math.round(sum * 100) / 100
  }, [createJobAddonOptions, createJobAddonDraft])

  /** Hours between From and To — drives by-hour RM estimate (price × hours × workers). */
  const createJobDurationHours = useMemo(() => {
    if (!requiresTime || !newTaskTimeStart || !newTaskTimeEnd) return null
    const a = scheduleTimeSlotToMinutes(newTaskTimeStart)
    const b = scheduleTimeSlotToMinutes(newTaskTimeEnd)
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null
    return (b - a) / 60
  }, [requiresTime, newTaskTimeStart, newTaskTimeEnd])

  const createJobPropertyFees = useMemo(() => {
    const p = propertyRows.find((row) => row.id === newTaskPropertyId)
    if (!p) return null
    return {
      generalCleaning: p.generalCleaning,
      cleaningFees: p.cleaningFees,
      warmCleaning: p.warmCleaning,
      deepCleaning: p.deepCleaning,
      renovationCleaning: p.renovationCleaning,
    }
  }, [propertyRows, newTaskPropertyId])

  const createJobPriceSummary = useMemo(() => {
    const premisesType = propertyRows.find((row) => row.id === newTaskPropertyId)?.premisesType
    return buildCreateJobPriceSummary(newTaskServiceKey, pricingServiceConfigs, {
      premisesType,
      durationHours: createJobDurationHours,
      propertyFees: createJobPropertyFees,
    })
  }, [
    newTaskServiceKey,
    pricingServiceConfigs,
    newTaskPropertyId,
    propertyRows,
    createJobDurationHours,
    createJobPropertyFees,
  ])

  /** Raw service + add-ons (before minimum floor and before out-of-hours). */
  const createJobCoreSubtotal = useMemo(() => {
    const base = createJobPriceSummary.indicativeBaseAmount
    if (base == null) return null
    return Math.round((base + createJobSelectedAddonTotal) * 100) / 100
  }, [createJobPriceSummary.indicativeBaseAmount, createJobSelectedAddonTotal])

  /**
   * Amount the OOH % applies to: core subtotal, then raised to minimum selling when set.
   * Out-of-hours is calculated on this amount — it does not count toward satisfying the minimum.
   */
  const createJobCoreFloorForCharge = useMemo(() => {
    if (createJobCoreSubtotal == null) return null
    if (createJobMinSelling <= 0) return createJobCoreSubtotal
    return Math.max(createJobCoreSubtotal, createJobMinSelling)
  }, [createJobCoreSubtotal, createJobMinSelling])

  const createJobOohSurcharge = useMemo(() => {
    if (!requiresTime || !newTaskTimeStart || !newTaskTimeEnd || !operatorCompanyHours) return 0
    const a = scheduleTimeSlotToMinutes(newTaskTimeStart)
    const b = scheduleTimeSlotToMinutes(newTaskTimeEnd)
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0
    const baseForOoh = createJobCoreFloorForCharge
    if (baseForOoh == null) return 0
    const val = parseMarkupNumeric(operatorCompanyHours)
    return computeOutOfWorkingHourSurcharge(
      baseForOoh,
      a,
      b,
      surchargeSegments,
      operatorCompanyHours.outOfWorkingHourMarkupMode,
      val
    )
  }, [
    requiresTime,
    newTaskTimeStart,
    newTaskTimeEnd,
    operatorCompanyHours,
    surchargeSegments,
    createJobCoreFloorForCharge,
  ])

  const createJobIndicativeGrandTotal = useMemo(() => {
    if (createJobCoreFloorForCharge == null) return null
    return Math.round((createJobCoreFloorForCharge + createJobOohSurcharge) * 100) / 100
  }, [createJobCoreFloorForCharge, createJobOohSurcharge])

  /** Minimum applies to service + add-ons only; OOH is extra on top (cannot satisfy min). */
  const createJobMeetsMinimum =
    createJobMinSelling <= 0 ||
    (createJobCoreSubtotal != null && createJobCoreSubtotal >= createJobMinSelling)

  const filteredCreateJobPropertyRows = useMemo(() => {
    const q = createJobPropertyFilter.trim().toLowerCase()
    if (!q) return propertyRows
    return propertyRows.filter((p) => {
      const name = String(p.name || '').toLowerCase()
      const unit = String(p.unitNumber || '').toLowerCase()
      const lab = String(p.label || '').toLowerCase()
      return (
        name.includes(q) ||
        unit.includes(q) ||
        lab.includes(q) ||
        String(p.id)
          .toLowerCase()
          .includes(q)
      )
    })
  }, [propertyRows, createJobPropertyFilter])

  const bulkCreateJobPricingRows = useMemo(() => {
    const isBulkLike = createJobMode === 'bulk' || createJobMode === 'group'
    if (!isBulkLike || bulkCreatePropertyIds.length === 0) return []
    return bulkCreatePropertyIds.map((propertyId) => {
      const row = propertyRows.find((r) => r.id === propertyId)
      const charges = computeCreateJobChargesForScheduleRow(row, {
        serviceKey: newTaskServiceKey,
        pricingServiceConfigs,
        durationHours: createJobDurationHours,
        addonTotal: createJobSelectedAddonTotal,
        minSelling: createJobMinSelling,
        requiresTime,
        timeStart: newTaskTimeStart,
        timeEnd: newTaskTimeEnd,
        operatorCompanyHours,
        surchargeSegments,
      })
      return { propertyId, ...charges }
    })
  }, [
    createJobMode,
    bulkCreatePropertyIds,
    propertyRows,
    newTaskServiceKey,
    pricingServiceConfigs,
    createJobDurationHours,
    createJobSelectedAddonTotal,
    createJobMinSelling,
    requiresTime,
    newTaskTimeStart,
    newTaskTimeEnd,
    operatorCompanyHours,
    surchargeSegments,
  ])

  const bulkCreateJobPricingOk =
    (createJobMode !== 'bulk' && createJobMode !== 'group') ||
    (bulkCreateJobPricingRows.length > 0 &&
      bulkCreateJobPricingRows.every(
        (r) => r.meetsMinimum && r.grandTotal != null && Number.isFinite(r.grandTotal)
      ))

  useEffect(() => {
    if (!newTaskOpen || createJobPriceDirty) return
    if (createJobIndicativeGrandTotal != null && Number.isFinite(createJobIndicativeGrandTotal)) {
      setCreateJobPriceInput(String(Math.round(createJobIndicativeGrandTotal * 100) / 100))
    } else {
      setCreateJobPriceInput('')
    }
  }, [newTaskOpen, createJobIndicativeGrandTotal, createJobPriceDirty])

  const resolveTeamLabel = (job: Job) => {
    if (job.teamId) {
      const t = teams.find((team) => team.id === job.teamId)
      if (t) return t.name
    }
    if (job.teamName) return job.teamName
    return 'Unassigned'
  }

  const jobMatchesTeamFilter = (job: Job, teamFilterId: string) => {
    if (job.teamId === teamFilterId) return true
    const selected = teams.find((t) => t.id === teamFilterId)
    if (selected && job.teamName && job.teamName === selected.name) return true
    return false
  }

  const filteredJobs = useMemo(() => {
    let data = [...jobs]

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase()
      data = data.filter((job) => {
        const tl = resolveTeamLabel(job).toLowerCase()
        return (
          job.property.toLowerCase().includes(q) ||
          (job.unitNumber || '').toLowerCase().includes(q) ||
          job.client.toLowerCase().includes(q) ||
          job.address.toLowerCase().includes(q) ||
          tl.includes(q)
        )
      })
    }

    if (statusFilter !== 'all') {
      data = data.filter((job) => job.status === statusFilter)
    }
    if (selectedClients.length > 0) {
      data = data.filter((job) => selectedClients.includes(job.client))
    }
    if (selectedProperties.length > 0) {
      data = data.filter((job) => selectedProperties.includes(job.property))
    }
    if (teamFilter !== 'all') {
      if (teamFilter === 'unassigned') {
        data = data.filter((job) => !job.teamId && !job.teamName)
      } else {
        data = data.filter((job) => jobMatchesTeamFilter(job, teamFilter))
      }
    }
    data = data.filter((job) => job.date === scheduleDay)

    const isAssigned = (j: Job) => Boolean(j.teamId || j.teamName)
    if (sortBy === 'priority') {
      data = [...data].sort((a, b) => {
        if (!isAssigned(a) && isAssigned(b)) return -1
        if (isAssigned(a) && !isAssigned(b)) return 1
        return b.estimateKpi - a.estimateKpi
      })
    } else if (sortBy === 'kpi-high') {
      data = [...data].sort((a, b) => b.estimateKpi - a.estimateKpi)
    } else {
      data = [...data].sort((a, b) => a.estimateKpi - b.estimateKpi)
    }

    return data
  }, [jobs, searchTerm, sortBy, statusFilter, selectedClients, selectedProperties, teamFilter, scheduleDay, teams])

  /** Coords for Areas map: `cln_property.latitude/longitude` → Waze/Google → loaded jobs (backend uses same order). */
  const propertyIdToLatLng = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number }>()
    for (const p of propertyRows) {
      const la = p.latitude != null ? Number(p.latitude) : NaN
      const lo = p.longitude != null ? Number(p.longitude) : NaN
      if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
        m.set(p.id, { lat: la, lng: lo })
      }
    }
    for (const p of propertyRows) {
      if (m.has(p.id)) continue
      const parsed = parseLatLngFromNavigationUrls(p.wazeUrl || '', p.googleMapsUrl || '')
      if (parsed) m.set(p.id, parsed)
    }
    for (const j of jobs) {
      const pid = String(j.propertyId || '').trim()
      if (!pid || !Number.isFinite(j.lat) || !Number.isFinite(j.lng)) continue
      m.set(pid, { lat: j.lat, lng: j.lng })
    }
    return m
  }, [jobs, propertyRows])

  const unassignedCount = filteredJobs.filter((job) => !job.teamId && !job.teamName).length
  const clientOptions = useMemo(
    () => Array.from(new Set(jobs.map((job) => job.client).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [jobs]
  )
  const propertyOptions = useMemo(
    () => Array.from(new Set(jobs.map((job) => job.property).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [jobs]
  )

  useEffect(() => {
    setSelectedClients((prev) => prev.filter((c) => clientOptions.includes(c)))
  }, [clientOptions])

  useEffect(() => {
    setSelectedProperties((prev) => prev.filter((p) => propertyOptions.includes(p)))
  }, [propertyOptions])

  const jobsByTeam = useMemo(
    () =>
      teams.map((team) => {
        const teamJobs = filteredJobs.filter(
          (job) => job.teamId === team.id || (!job.teamId && job.teamName === team.name)
        )
        const avgKpi = teamJobs.length > 0 ? Math.round(teamJobs.reduce((sum, job) => sum + job.estimateKpi, 0) / teamJobs.length) : 0
        return { team, teamJobs, avgKpi }
      }),
    [filteredJobs, teams]
  )

  const mapGroups = useMemo(() => {
    const group = new Map<string, { lat: number; lng: number; property: string; jobs: Job[] }>()
    filteredJobs.forEach((job) => {
      const key = `${job.property}-${job.lat}-${job.lng}`
      const existing = group.get(key)
      if (existing) {
        existing.jobs.push(job)
      } else {
        group.set(key, {
          lat: job.lat,
          lng: job.lng,
          property: job.property,
          jobs: [job],
        })
      }
    })
    return Array.from(group.values())
  }, [filteredJobs])

  const propertyGroups = useMemo<PropertyGroup[]>(() => {
    const map = new Map<string, PropertyGroup>()
    filteredJobs.forEach((job) => {
      const key = `${job.property}-${job.unitNumber || ''}-${job.address}`
      const existing = map.get(key)
      if (!existing) {
        map.set(key, {
          property: job.property,
          unitNumber: job.unitNumber || '',
          propertyId: job.propertyId || '',
          client: job.client,
          address: job.address,
          totalPrice: Number(job.price || 0),
          lat: job.lat,
          lng: job.lng,
          jobs: [job],
          teamNames: job.teamId || job.teamName ? [resolveTeamLabel(job)] : [],
          unassignedCount: job.teamId || job.teamName ? 0 : 1,
          averageKpi: job.estimateKpi,
        })
        return
      }
      existing.jobs.push(job)
      existing.totalPrice += Number(job.price || 0)
      if (job.teamId || job.teamName) {
        const tn = resolveTeamLabel(job)
        if (!existing.teamNames.includes(tn)) {
          existing.teamNames.push(tn)
        }
      } else {
        existing.unassignedCount += 1
      }
      existing.averageKpi = Math.round(existing.jobs.reduce((sum, row) => sum + row.estimateKpi, 0) / existing.jobs.length)
    })
    return Array.from(map.values()).sort((a, b) => {
      if (a.unassignedCount > 0 && b.unassignedCount === 0) return -1
      if (a.unassignedCount === 0 && b.unassignedCount > 0) return 1
      return b.averageKpi - a.averageKpi
    })
  }, [filteredJobs, teams])

  const jobListPropertyGroups = useMemo(() => {
    if (jobListGroupSort.key === 'default') return propertyGroups
    const dir = jobListGroupSort.asc ? 1 : -1
    return [...propertyGroups].sort((a, b) => {
      let cmp = 0
      switch (jobListGroupSort.key) {
        case 'property':
          cmp = `${a.property}\0${a.unitNumber || ''}`.localeCompare(`${b.property}\0${b.unitNumber || ''}`, undefined, {
            sensitivity: 'base',
          })
          break
        case 'client':
          cmp = a.client.localeCompare(b.client, undefined, { sensitivity: 'base' })
          break
        case 'price':
          cmp = a.totalPrice - b.totalPrice
          break
        case 'team':
          cmp = jobListGroupTeamSortLabel(a).localeCompare(jobListGroupTeamSortLabel(b), undefined, { sensitivity: 'base' })
          break
        case 'status':
          cmp = jobListGroupStatusRank(a) - jobListGroupStatusRank(b)
          break
        default:
          return 0
      }
      return cmp * dir
    })
  }, [propertyGroups, jobListGroupSort])

  const onJobListColumnSort = useCallback((col: Exclude<JobListGroupSortKey, 'default'>) => {
    setJobListGroupSort((s) => {
      if (s.key !== col) {
        const ascDefault = col === 'property' || col === 'client' || col === 'team'
        return { key: col, asc: ascDefault }
      }
      return { key: col, asc: !s.asc }
    })
  }, [])

  const areaMetaForPropertyId = useMemo(() => {
    const m = new Map<string, { color: string; name: string }>()
    for (const r of regionGroups) {
      for (const pid of r.propertyIds) {
        if (!m.has(pid)) m.set(pid, { color: r.color, name: r.name })
      }
    }
    return m
  }, [regionGroups])

  useEffect(() => {
    let cancelled = false

    const initMap = async () => {
      if (activeTab !== 'map') return
      if (!mapContainerRef.current) return
      if (typeof window === 'undefined') return

      const L = await import('leaflet')
      if (cancelled) return

      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }

      const initial = mapGroups[0] || { lat: DEFAULT_AREA_MAP_LAT, lng: DEFAULT_AREA_MAP_LNG }
      const map = L.map(mapContainerRef.current).setView([initial.lat, initial.lng], 10)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)

      const bounds: Array<[number, number]> = []

      mapGroups.forEach((group) => {
        bounds.push([group.lat, group.lng])
        const pid = String(group.jobs[0]?.propertyId || '').trim()
        const meta = pid ? areaMetaForPropertyId.get(pid) : undefined
        const hasBtob = group.jobs.some((j) => j.btob)
        const color = hasBtob ? '#dc2626' : meta?.color || '#64748b'
        const areaName = meta?.name || 'Unassigned'
        const selected = group.jobs.some((job) => selectedPropertyKeys.includes(schedulePropertyRowKey(job)))

        const marker = L.circleMarker([group.lat, group.lng], {
          radius: selected ? 11 : 9,
          color,
          fillColor: color,
          fillOpacity: selected ? 0.92 : 0.55,
          weight: hasBtob ? (selected ? 5 : 4) : selected ? 3 : 2,
        }).addTo(map)

        marker.bindTooltip(
          `<div style="min-width:180px">
            <strong>${group.property}</strong><br/>
            ${areaName}<br/>
            Total Jobs: ${group.jobs.length}
          </div>`,
          { direction: 'top' }
        )

        marker.bindPopup(
          `<div style="min-width:220px">
            <strong>${group.property}</strong><br/>
            <span style="color:${color}">${areaName}</span><br/>
            Total Jobs: ${group.jobs.length}<br/>
            ${group.jobs.map((job) => `- ${job.property} (${resolveTeamLabel(job)})`).join('<br/>')}
          </div>`
        )
      })

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [24, 24] })
      }

      leafletMapRef.current = map
      requestAnimationFrame(() => {
        map.invalidateSize()
        setTimeout(() => map.invalidateSize(), 250)
      })
    }

    void initMap()
    return () => {
      cancelled = true
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
    }
  }, [activeTab, mapGroups, teams, areaMetaForPropertyId, selectedPropertyKeys])

  useEffect(() => {
    let cancelled = false

    const initJobMap = async () => {
      if (activeTab !== 'job') return
      if (!jobMapContainerRef.current) return
      if (typeof window === 'undefined') return

      const L = await import('leaflet')
      if (cancelled) return

      if (jobLeafletMapRef.current) {
        jobLeafletMapRef.current.remove()
        jobLeafletMapRef.current = null
      }

      const groups = propertyGroups.filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lng))
      const initial = groups[0] || { lat: DEFAULT_AREA_MAP_LAT, lng: DEFAULT_AREA_MAP_LNG }
      const map = L.map(jobMapContainerRef.current).setView([initial.lat, initial.lng], 11)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)

      const bounds: Array<[number, number]> = []

      groups.forEach((group) => {
        const rowKey = `${group.property}-${group.unitNumber || ''}-${group.address}`
        const selected = selectedPropertyKeys.includes(rowKey)
        const pid = String(group.propertyId || '').trim()
        const meta = pid ? areaMetaForPropertyId.get(pid) : undefined
        const hasBtob = group.jobs.some((j) => j.btob)
        const color = hasBtob ? '#dc2626' : meta?.color || '#64748b'
        const areaName = meta?.name || 'Unassigned'
        bounds.push([group.lat, group.lng])

        const marker = L.circleMarker([group.lat, group.lng], {
          radius: selected ? 12 : 9,
          color,
          fillColor: color,
          fillOpacity: selected ? 0.95 : 0.52,
          weight: hasBtob ? (selected ? 5 : 4) : selected ? 4 : 2,
        }).addTo(map)

        marker.bindTooltip(
          `<div style="min-width:160px">
            <strong>${group.property}</strong><br/>
            ${areaName}<br/>
            Jobs: ${group.jobs.length}${selected ? '<br/><em>Row selected</em>' : ''}
          </div>`,
          { direction: 'top' }
        )
      })

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [20, 20] })
      }

      jobLeafletMapRef.current = map
      requestAnimationFrame(() => {
        map.invalidateSize()
        setTimeout(() => map.invalidateSize(), 250)
      })
    }

    void initJobMap()
    return () => {
      cancelled = true
      if (jobLeafletMapRef.current) {
        jobLeafletMapRef.current.remove()
        jobLeafletMapRef.current = null
      }
    }
  }, [activeTab, propertyGroups, areaMetaForPropertyId, selectedPropertyKeys])

  useEffect(() => {
    if (activeTab === 'map' && leafletMapRef.current) {
      const map = leafletMapRef.current
      const timer = setTimeout(() => map.invalidateSize(), 300)
      return () => clearTimeout(timer)
    }
    if (activeTab === 'job' && jobLeafletMapRef.current) {
      const map = jobLeafletMapRef.current
      const timer = setTimeout(() => map.invalidateSize(), 300)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [activeTab])

  useEffect(() => {
    let cancelled = false
    const initAreasMap = async () => {
      if (!areasEditorOpen) return
      if (!areasMapContainerRef.current) return
      if (typeof window === 'undefined') return
      const L = await import('leaflet')
      if (cancelled) return
      if (areasLeafletMapRef.current) {
        areasLeafletMapRef.current.remove()
        areasLeafletMapRef.current = null
      }
      const map = L.map(areasMapContainerRef.current).setView([DEFAULT_AREA_MAP_LAT, DEFAULT_AREA_MAP_LNG], 11)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)
      const bounds: Array<[number, number]> = []
      for (const p of propertyRows) {
        const fromJob = propertyIdToLatLng.get(p.id)
        const jitter = latLngJitterForPropertyId(p.id)
        const lat = fromJob?.lat ?? jitter.lat
        const lng = fromJob?.lng ?? jitter.lng
        bounds.push([lat, lng])
        const meta = areaMetaForPropertyId.get(p.id)
        const color = meta?.color || '#64748b'
        const marker = L.circleMarker([lat, lng], {
          radius: 8,
          color,
          fillColor: color,
          fillOpacity: 0.72,
          weight: 2,
        }).addTo(map)
        marker.bindTooltip(
          `<div style="min-width:140px"><strong>${p.label}</strong><br/>${meta?.name || 'Unassigned'}</div>`,
          { direction: 'top' }
        )
      }
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [28, 28] })
      }
      areasLeafletMapRef.current = map
      requestAnimationFrame(() => {
        map.invalidateSize()
        setTimeout(() => map.invalidateSize(), 250)
      })
    }
    void initAreasMap()
    return () => {
      cancelled = true
      if (areasLeafletMapRef.current) {
        areasLeafletMapRef.current.remove()
        areasLeafletMapRef.current = null
      }
    }
  }, [areasEditorOpen, propertyRows, propertyIdToLatLng, areaMetaForPropertyId])

  useEffect(() => {
    if (!areasEditorOpen || !areasLeafletMapRef.current) return
    const map = areasLeafletMapRef.current
    const timer = setTimeout(() => map.invalidateSize(), 300)
    return () => clearTimeout(timer)
  }, [areasEditorOpen])

  const openTeamEditor = (teamId: string) => {
    setEditingTeamId(teamId)
    setTeamEditOpen(true)
  }

  const toggleJobForTeam = async (jobId: string, teamId: string, checked: boolean) => {
    const res = await updateOperatorScheduleJob(jobId, {
      teamId: checked ? teamId : null,
      operatorId,
      aiAssignmentLocked: !!(checked && teamId),
    })
    if (!res.ok) {
      toast.error(typeof res.reason === 'string' ? res.reason : 'Failed to update team assignment')
      return
    }
    await loadSchedulePage()
    toast.success('Team assignment saved')
  }

  const setGroupScheduleBtob = async (group: PropertyGroup, checked: boolean) => {
    const rowKey = `${group.property}-${group.unitNumber || ''}-${group.address}`
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    setBtobSavingGroupKey(rowKey)
    try {
      const results = await Promise.all(
        group.jobs.map((job) => updateOperatorScheduleJob(job.id, { operatorId, btob: checked }))
      )
      if (results.some((r) => !r.ok)) {
        toast.error('Could not update BTOB for all rows')
        return
      }
      await loadSchedulePage()
    } finally {
      setBtobSavingGroupKey(null)
    }
  }

  const propertyGroupTeamSelectValue = useCallback(
    (group: PropertyGroup): string => {
      if (!group.jobs.length) return '__unassigned__'
      const ids = group.jobs.map((j) => (j.teamId ? String(j.teamId) : ''))
      const withId = ids.filter(Boolean)
      if (withId.length === group.jobs.length) {
        const s = new Set(withId)
        if (s.size === 1) return [...s][0]!
        return '__mixed__'
      }
      if (withId.length > 0) return '__mixed__'
      const nameOnlyRows = group.jobs.filter((j) => !j.teamId && j.teamName)
      if (nameOnlyRows.length === group.jobs.length) {
        const names = new Set(nameOnlyRows.map((j) => String(j.teamName || '')))
        if (names.size === 1) {
          const onlyName = [...names][0]
          const t = teams.find((x) => x.name === onlyName)
          if (t) return t.id
        }
      }
      return '__unassigned__'
    },
    [teams]
  )

  const setGroupScheduleTeam = useCallback(
    async (group: PropertyGroup, selectValue: string) => {
      if (selectValue === '__mixed__') return
      const rowKey = `${group.property}-${group.unitNumber || ''}-${group.address}`
      await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
      setTeamSavingGroupKey(rowKey)
      try {
        const teamId = selectValue === '__unassigned__' ? null : selectValue
        const results = await Promise.all(
          group.jobs.map((job) =>
            updateOperatorScheduleJob(job.id, {
              operatorId,
              teamId,
              aiAssignmentLocked: Boolean(teamId),
            })
          )
        )
        const failed = results.find((r) => !r.ok)
        if (failed) {
          toast.error(typeof failed.reason === 'string' ? failed.reason : 'Could not update team for all rows')
          return
        }
        await loadSchedulePage()
        toast.success(teamId ? 'Team updated' : 'Team cleared')
      } finally {
        setTeamSavingGroupKey(null)
      }
    },
    [operatorId, loadSchedulePage]
  )

  const onJobListTeamSelectCommit = useCallback(
    (group: PropertyGroup, selectValue: string) => {
      if (selectValue === '__mixed__') return
      const cur = propertyGroupTeamSelectValue(group)
      if (selectValue === cur) return
      void setGroupScheduleTeam(group, selectValue)
    },
    [propertyGroupTeamSelectValue, setGroupScheduleTeam]
  )

  const applyGroupJobListStatus = async (group: PropertyGroup, selectKey: string, workingDayYmd?: string) => {
    const rowKey = `${group.property}-${group.unitNumber || ''}-${group.address}`
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    setStatusSavingGroupKey(rowKey)
    try {
      if (selectKey === 'in-progress') {
        const wd = String(workingDayYmd || '').slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) {
          toast.error('Choose a valid extend working day')
          return
        }
        const results = await Promise.all(
          group.jobs.map((job) =>
            updateOperatorScheduleJob(job.id, {
              status: 'in-progress',
              operatorId,
              workingDay: wd,
            })
          )
        )
        if (results.some((r) => !r.ok)) {
          toast.error('Status update failed for some rows')
          return
        }
      } else {
        const dbStatus = mapStatusSelectKeyToDbStatus(selectKey)
        const results = await Promise.all(
          group.jobs.map((job) =>
            updateOperatorScheduleJob(job.id, {
              status: dbStatus,
              operatorId,
              ...(selectKey === 'ready-to-clean' && operatorEmail ? { statusSetByEmail: operatorEmail } : {}),
            })
          )
        )
        if (results.some((r) => !r.ok)) {
          toast.error('Status update failed for some rows')
          return
        }
      }
      await loadSchedulePage()
      toast.success('Status updated')
    } finally {
      setStatusSavingGroupKey(null)
    }
  }

  const onJobListStatusSelectCommit = (group: PropertyGroup, selectKey: string) => {
    if (selectKey === 'in-progress') {
      const d = String(group.jobs[0]?.date || '').slice(0, 10)
      setRowExtendGroup(group)
      setRowExtendYmd(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : scheduleDay)
      setRowExtendDialogOpen(true)
      return
    }
    void applyGroupJobListStatus(group, selectKey)
  }

  const runJobAction = (label: string, job: Job) => {
    toast.success(`${label}: ${job.property}`)
  }

  const prefillScheduleJobDialogFromJob = (job: Job) => {
    suppressDialogOpenPriceDirtyResetRef.current = true
    const allowedKeys = scheduleServiceOptions.map((s) => s.key)
    const sk = deriveServiceKeyFromJob(job, allowedKeys)
    const { start, end } = parseJobTimeSlots(job.time)
    skipNextAddonSignatureEffectRef.current = true
    const opts = collectJobAddonOptions(sk, pricingServiceConfigs)
    const draft: Record<string, { selected: boolean; qty: number }> = {}
    for (const o of opts) {
      const hit = job.pricingAddons?.find((a) => String(a.name || '').trim() === o.name.trim())
      draft[o.id] = {
        selected: Boolean(hit),
        qty: Math.max(1, Math.floor(Number(hit?.quantity) || 1)),
      }
    }
    setCreateJobAddonDraft(draft)
    setCreateJobMode('single')
    setCreateJobStep('schedule')
    setNewTaskPropertyId(String(job.propertyId || '').trim())
    setNewTaskDate(String(job.date || '').slice(0, 10) || scheduleDay)
    setNewTaskServiceKey(sk)
    setNewTaskTimeStart(start)
    setNewTaskTimeEnd(end)
    const rem = String(job.remarks || '').trim()
    setNewTaskRemark(rem)
    setCreateJobPriceInput(job.price != null && Number.isFinite(Number(job.price)) ? String(job.price) : '')
    setCreateJobPriceDirty(true)
  }

  const openViewJobDetailDialog = (job: Job, group?: PropertyGroup) => {
    prefillScheduleJobDialogFromJob(job)
    setViewDetailCompletionPhotos(collectCompletionPhotoUrls(job, group))
    setScheduleJobDialogJobId(String(job.id || '').trim() || null)
    setScheduleJobDialogReadOnly(true)
    setEditingScheduleJobId(null)
    setNewTaskOpen(true)
  }

  const openGiveClientReviewDialog = (job: Job, group?: PropertyGroup) => {
    setClientReviewJob(job)
    setClientReviewPhotoUrls(
      collectCompletionPhotoUrls(job, group)
        .map((u) => normalizeDamageAttachmentUrl(String(u)))
        .filter(Boolean)
    )
    setClientReviewOpen(true)
  }

  const openEditBookingDialog = (job: Job, group?: PropertyGroup) => {
    if (job.status === 'completed') {
      openViewJobDetailDialog(job, group)
      return
    }
    if (!String(job.propertyId || '').trim()) {
      toast.error('Cannot edit this row (missing property).')
      return
    }
    prefillScheduleJobDialogFromJob(job)
    setViewDetailCompletionPhotos([])
    setScheduleJobDialogJobId(String(job.id || '').trim() || null)
    setScheduleJobDialogReadOnly(false)
    setEditingScheduleJobId(job.id)
    setNewTaskOpen(true)
  }

  const runDeleteJobsFromConfirm = async () => {
    const g = deleteJobsConfirmGroup
    if (!g?.jobs.length) return
    setDeleteJobsSaving(true)
    try {
      for (const job of g.jobs) {
        const jid = String(job.id || '').trim()
        if (!jid) continue
        const res = await deleteOperatorScheduleJob(jid, operatorId)
        if (!res.ok) {
          toast.error(typeof res.reason === 'string' ? res.reason : 'Delete failed')
          setDeleteJobsConfirmGroup(null)
          await loadSchedulePage()
          return
        }
      }
      toast.success(g.jobs.length > 1 ? `Deleted ${g.jobs.length} jobs` : 'Job deleted')
      setDeleteJobsConfirmGroup(null)
      await loadSchedulePage()
    } finally {
      setDeleteJobsSaving(false)
    }
  }

  const openCreateJobDialog = () => {
    suppressDialogOpenPriceDirtyResetRef.current = false
    setScheduleJobDialogJobId(null)
    setScheduleJobDialogReadOnly(false)
    setViewDetailCompletionPhotos([])
    setEditingScheduleJobId(null)
    setCreateJobStep('property')
    setCreateJobMode('single')
    setCreateJobGroupId('')
    setBulkCreatePropertyIds([])
    setCreateJobPropertyFilter('')
    setNewTaskServiceKey((prev) => {
      const opts = scheduleServiceOptions
      if (opts.some((o) => o.key === prev)) return prev
      return opts[0]?.key ?? 'general'
    })
    setNewTaskOpen(true)
  }

  const createTask = async () => {
    if (scheduleJobDialogReadOnly) return
    const isBulkLikeCreateJob = createJobMode === 'bulk' || createJobMode === 'group'
    const propertyIds = isBulkLikeCreateJob
      ? bulkCreatePropertyIds
      : newTaskPropertyId
        ? [newTaskPropertyId]
        : []
    if (propertyIds.length === 0) {
      toast.error(
        createJobMode === 'single'
          ? 'Please select property'
          : createJobMode === 'group'
            ? 'Choose a group with units'
            : 'Select at least one property',
      )
      return
    }
    if (requiresTime) {
      if (!newTaskTimeStart.trim() || !newTaskTimeEnd.trim()) {
        toast.error('Please select start and end time')
        return
      }
      const a = scheduleTimeSlotToMinutes(newTaskTimeStart)
      const b = scheduleTimeSlotToMinutes(newTaskTimeEnd)
      if (Number.isNaN(a) || Number.isNaN(b) || b <= a) {
        toast.error('End time must be after start time')
        return
      }
      const dur = b - a
      if (dur < scheduleTimeStepMinutes || dur % scheduleTimeStepMinutes !== 0) {
        toast.error(
          `Time window must use blocks of ${scheduleTimeStepMinutes >= 60 ? `${scheduleTimeStepMinutes / 60} hour(s)` : `${scheduleTimeStepMinutes} minutes`} (from Pricing).`
        )
        return
      }
    }

    const addonsPayload = createJobAddonOptions
      .filter((o) => createJobAddonDraft[o.id]?.selected)
      .map((o) => {
        const qty =
          o.basis === 'fixed'
            ? 1
            : Math.max(1, Math.floor(createJobAddonDraft[o.id]?.qty ?? 1))
        return {
          id: o.id,
          name: o.name,
          basis: o.basis,
          price: o.price,
          quantity: qty,
        }
      })

    const remarksPayload = requiresTime
      ? `${newTaskTimeStart} - ${newTaskTimeEnd} ${newTaskRemark}`.trim()
      : newTaskRemark

    if (createJobMode === 'single') {
      if (createJobMinSelling > 0 && !createJobMeetsMinimum) {
        toast.error(
          `Service + add-ons (before out-of-hours) must reach at least RM ${createJobMinSelling.toLocaleString(
            'en-MY'
          )} — out-of-hours extra cannot count toward this minimum.`
        )
        return
      }
      const priceRaw = createJobPriceInput.trim().replace(/,/g, '')
      const parsedCharge = parseFloat(priceRaw)
      if (!Number.isFinite(parsedCharge) || parsedCharge < 0) {
        toast.error('Enter a valid total charge (RM) at the bottom of Summary.')
        return
      }
      const finalCharge = Math.round(parsedCharge * 100) / 100
      if (editingScheduleJobId) {
        const res = await updateOperatorScheduleJob(editingScheduleJobId, {
          operatorId,
          propertyId: newTaskPropertyId,
          date: newTaskDate,
          timeStart: requiresTime ? newTaskTimeStart : '09:00',
          serviceProvider: serviceKeyToScheduleServiceProvider(newTaskServiceKey),
          price: finalCharge,
          remarks: remarksPayload,
          addons: addonsPayload,
        })
        if (!res.ok) {
          toast.error(typeof res.reason === 'string' ? res.reason : 'Could not save booking')
          return
        }
        await loadSchedulePage()
        setEditingScheduleJobId(null)
        setNewTaskOpen(false)
        setNewTaskPropertyId('')
        setNewTaskTimeStart('')
        setNewTaskTimeEnd('')
        setNewTaskRemark('')
        setPropertyPickerOpen(false)
        setCreateJobAddonDraft({})
        toast.success('Booking updated.')
        return
      }
      const res = await createOperatorScheduleJob({
        operatorId,
        propertyId: newTaskPropertyId,
        date: newTaskDate,
        serviceProvider: serviceKeyToScheduleServiceProvider(newTaskServiceKey),
        status: 'pending-checkout',
        source: 'operator_portal',
        price: finalCharge,
        remarks: remarksPayload,
        ...(operatorEmail ? { createdByEmail: operatorEmail } : {}),
        ...(addonsPayload.length > 0 ? { addons: addonsPayload } : {}),
      })
      if (!res.ok) {
        toast.error(typeof res.reason === 'string' ? res.reason : 'Create job failed')
        return
      }
      await loadSchedulePage()
      setNewTaskOpen(false)
      setNewTaskPropertyId('')
      setNewTaskTimeStart('')
      setNewTaskTimeEnd('')
      setNewTaskRemark('')
      setPropertyPickerOpen(false)
      setCreateJobAddonDraft({})
      toast.success('Job created.')
      return
    }

    const failedMin = bulkCreateJobPricingRows.filter((r) => !r.meetsMinimum)
    if (failedMin.length > 0) {
      toast.error(
        `Minimum not met for: ${failedMin.map((r) => r.label).join(', ')} — extend hours or add-ons (OOH cannot count).`
      )
      return
    }
    const badQuote = bulkCreateJobPricingRows.find((r) => r.grandTotal == null || !Number.isFinite(r.grandTotal))
    if (badQuote) {
      toast.error(
        `Cannot compute price for “${badQuote.label}”. Set Pricing and/or property line amounts, then try again.`
      )
      return
    }

    let ok = 0
    let fail = 0
    for (const row of bulkCreateJobPricingRows) {
      const finalCharge = Math.round(Number(row.grandTotal) * 100) / 100
      const res = await createOperatorScheduleJob({
        operatorId,
        propertyId: row.propertyId,
        date: newTaskDate,
        serviceProvider: serviceKeyToScheduleServiceProvider(newTaskServiceKey),
        status: 'pending-checkout',
        source: 'operator_portal',
        price: finalCharge,
        remarks: remarksPayload,
        ...(operatorEmail ? { createdByEmail: operatorEmail } : {}),
        ...(addonsPayload.length > 0 ? { addons: addonsPayload } : {}),
      })
      if (res.ok) ok += 1
      else fail += 1
    }
    await loadSchedulePage()
    setNewTaskOpen(false)
    setNewTaskPropertyId('')
    setBulkCreatePropertyIds([])
    setCreateJobPropertyFilter('')
    setNewTaskTimeStart('')
    setNewTaskTimeEnd('')
    setNewTaskRemark('')
    setPropertyPickerOpen(false)
    setCreateJobAddonDraft({})
    if (fail > 0) {
      toast.error(`Created ${ok} job(s), ${fail} failed`)
    } else {
      toast.success(ok === 1 ? 'Job created.' : `${ok} jobs created.`)
    }
  }

  const editingTeamJobs = editingTeamId
    ? filteredJobs.filter((job) => {
        if (job.teamId === editingTeamId) return true
        if (!job.teamId && !job.teamName) return true
        const t = teams.find((x) => x.id === editingTeamId)
        if (t && !job.teamId && job.teamName === t.name) return true
        return false
      })
    : []
  /** Team editor: only the first BTOB row per property gets a red fill (same address key). */
  const teamEditBtobFillJobIdByPropertyKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const j of editingTeamJobs) {
      if (!j.btob) continue
      const k = String(j.propertyId || `${j.property}-${j.unitNumber || ''}-${j.address}`)
      if (!m.has(k)) m.set(k, j.id)
    }
    return m
  }, [editingTeamJobs])
  const allVisiblePropertyKeys = propertyGroups.map((group) => `${group.property}-${group.unitNumber || ''}-${group.address}`)
  const allSelected = allVisiblePropertyKeys.length > 0 && allVisiblePropertyKeys.every((key) => selectedPropertyKeys.includes(key))

  const togglePropertySelection = (key: string, checked: boolean) => {
    setSelectedPropertyKeys((prev) => (checked ? [...new Set([...prev, key])] : prev.filter((item) => item !== key)))
  }

  const toggleSelectAllProperties = (checked: boolean) => {
    if (checked) {
      setSelectedPropertyKeys(allVisiblePropertyKeys)
      return
    }
    setSelectedPropertyKeys([])
  }

  const bulkUpdateStatus = async (status: TaskStatus, label: string, workingDayYmd?: string) => {
    if (selectedPropertyKeys.length === 0) {
      toast.error('Please select at least one row for bulk edit')
      return false
    }
    if (status === 'in-progress') {
      const wd = String(workingDayYmd || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) {
        toast.error('Choose a valid extend / new working day')
        return false
      }
    }

    const toUpdate = filteredJobs.filter((job) =>
      selectedPropertyKeys.includes(`${job.property}-${job.unitNumber || ''}-${job.address}`)
    )
    const results = await Promise.all(
      toUpdate.map((job) =>
        updateOperatorScheduleJob(job.id, {
          status,
          operatorId,
          ...(status === 'in-progress' && workingDayYmd ? { workingDay: String(workingDayYmd).slice(0, 10) } : {}),
          ...(status === 'ready-to-clean' && operatorEmail ? { statusSetByEmail: operatorEmail } : {}),
        })
      )
    )
    if (results.some((r) => !r.ok)) {
      toast.error('Some rows failed to update')
      await loadSchedulePage()
      return false
    }
    toast.success(`Bulk ${label} updated (${toUpdate.length} job(s))`)
    await loadSchedulePage()
    return true
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Schedule</h2>
          <p className="text-muted-foreground">Team list, job list, and map assignment workflow</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <Button onClick={openCreateJobDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Create Job
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold">Filters</CardTitle>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <ListFilter className="h-4 w-4" />
              Filter
              <ChevronDown
                className={cn('h-4 w-4 opacity-70 transition-transform', filtersOpen && 'rotate-180')}
              />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-0">
          <div className="border-b border-border pb-5">
            <div className="space-y-2 min-w-0">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Working day
              </Label>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-2">
                <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={scheduleDay === malaysiaYmdForDayOffset(0) ? 'default' : 'outline'}
                    className="w-full px-2.5 sm:w-auto sm:px-3"
                    onClick={() => setScheduleDay(malaysiaYmdForDayOffset(0))}
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={scheduleDay === malaysiaYmdForDayOffset(1) ? 'default' : 'outline'}
                    className="w-full px-2.5 sm:w-auto sm:px-3"
                    onClick={() => setScheduleDay(malaysiaYmdForDayOffset(1))}
                  >
                    Tomorrow
                  </Button>
                </div>
                <div className="min-w-0 w-full sm:w-[11rem] sm:shrink-0">
                  <Label htmlFor="schedule-day-picker" className="sr-only">
                    Date
                  </Label>
                  <Input
                    id="schedule-day-picker"
                    type="date"
                    value={scheduleDay}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v) setScheduleDay(v)
                    }}
                    className="h-9 w-full min-w-0"
                  />
                </div>
              </div>
            </div>
          </div>

          {filtersOpen ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:items-end">
                <div className="sm:col-span-2 lg:col-span-6">
                  <Label htmlFor="schedule-search" className="sr-only">
                    Search
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      id="schedule-search"
                      className="pl-9 h-9 w-full"
                      placeholder="Search property, client, address, team…"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
                <div className="lg:col-span-3">
                  <ScheduleMultiCheckboxFilter
                    label="Client"
                    optionsSorted={clientOptions}
                    selected={selectedClients}
                    onSelectedChange={setSelectedClients}
                    allLabel="All clients"
                    countNoun="clients"
                  />
                </div>
                <div className="lg:col-span-3">
                  <ScheduleMultiCheckboxFilter
                    label="Property"
                    optionsSorted={propertyOptions}
                    selected={selectedProperties}
                    onSelectedChange={setSelectedProperties}
                    allLabel="All properties"
                    countNoun="properties"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:items-end">
                <div className="lg:col-span-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All status</SelectItem>
                      <SelectItem value="pending-checkout">Pending check out</SelectItem>
                      <SelectItem value="ready-to-clean">Ready to clean</SelectItem>
                      <SelectItem value="in-progress">In progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="lg:col-span-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Team</Label>
                  <Select value={teamFilter} onValueChange={setTeamFilter}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder="Team" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All teams</SelectItem>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2 lg:col-span-6">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Sort</Label>
                  <Select value={sortBy} onValueChange={(v: 'priority' | 'kpi-high' | 'kpi-low') => setSortBy(v)}>
                    <SelectTrigger className="h-9 w-full">
                      <ArrowUpDown className="h-4 w-4 mr-2 shrink-0 opacity-60" />
                      <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="priority">Priority (unassigned first)</SelectItem>
                      <SelectItem value="kpi-high">KPI high → low</SelectItem>
                      <SelectItem value="kpi-low">KPI low → high</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          queueMicrotask(() => setActiveTab(value as 'team' | 'job' | 'map'))
        }}
      >
        <TabsList className="grid h-10 w-full max-w-3xl grid-cols-3">
          <TabsTrigger value="team" className="text-sm">
            Team list
          </TabsTrigger>
          <TabsTrigger value="job" className="text-sm">
            Job list
          </TabsTrigger>
          <TabsTrigger value="map" className="text-sm">
            Map
          </TabsTrigger>
        </TabsList>

        {activeTab === 'team' && (
          <div className="mt-4 space-y-4">
            <Card>
              <CardContent className="p-0">
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Team</TableHead>
                        <TableHead>Members</TableHead>
                        <TableHead>Total Job</TableHead>
                        <TableHead>Estimate KPI</TableHead>
                        <TableHead className="w-[80px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobsByTeam.map(({ team, teamJobs, avgKpi }) => (
                        <TableRow key={team.id}>
                          <TableCell className="py-2 font-medium">
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {team.name}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-muted-foreground">{team.members.length}</TableCell>
                          <TableCell className="py-2">{teamJobs.length}</TableCell>
                          <TableCell className="py-2">{avgKpi}</TableCell>
                          <TableCell className="py-2 text-right">
                            <Button size="sm" variant="ghost" onClick={() => openTeamEditor(team.id)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="md:hidden space-y-3 p-3">
                  {jobsByTeam.map(({ team, teamJobs, avgKpi }) => (
                    <div key={team.id} className="rounded-lg border border-border bg-background p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-muted-foreground">Team</p>
                          <p className="mt-0.5 font-medium leading-snug">
                            <span className="inline-flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="break-words">{team.name}</span>
                            </span>
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          onClick={() => openTeamEditor(team.id)}
                          aria-label="Edit team"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                      <dl className="space-y-2 text-sm">
                        <div>
                          <dt className="text-xs text-muted-foreground">Members</dt>
                          <dd className="mt-0.5">{team.members.length}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Total job</dt>
                          <dd className="mt-0.5">{teamJobs.length}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Estimate KPI</dt>
                          <dd className="mt-0.5">{avgKpi}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'job' && (
          <div className="mt-4 space-y-4">
            {unassignedCount > 0 && (
              <Card className="border-amber-400/60 bg-amber-50/60">
                <CardContent className="pt-6 flex items-center gap-3 text-amber-900">
                  <AlertTriangle className="h-5 w-5" />
                  <span>{unassignedCount} unassigned job(s) are pinned at top for operator priority.</span>
                </CardContent>
              </Card>
            )}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      Bulk Action
                      <ChevronDown className="ml-1 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => bulkUpdateStatus('ready-to-clean', 'Ready to Clean')}>
                      Bulk Ready to Clean
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setBulkExtendYmd(scheduleDay)
                        setBulkExtendDialogOpen(true)
                      }}
                    >
                      Bulk Extend
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setBulkHomestayNameContains('arc')
                        setBulkHomestayDialogOpen(true)
                      }}
                    >
                      Bulk homestay (match property name)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="text-xs text-muted-foreground">{selectedPropertyKeys.length} row(s) selected</span>
              </div>
              <div className="md:hidden space-y-1">
                <Label className="text-xs text-muted-foreground">Sort job list</Label>
                <Select
                  value={
                    jobListGroupSort.key === 'default'
                      ? 'default'
                      : `${jobListGroupSort.key}:${jobListGroupSort.asc ? 'asc' : 'desc'}`
                  }
                  onValueChange={(v) => {
                    if (v === 'default') {
                      setJobListGroupSort({ key: 'default', asc: false })
                      return
                    }
                    const i = v.lastIndexOf(':')
                    const k = (i > 0 ? v.slice(0, i) : v) as JobListGroupSortKey
                    const d = i > 0 ? v.slice(i + 1) : 'asc'
                    if (k === 'default') {
                      setJobListGroupSort({ key: 'default', asc: false })
                      return
                    }
                    setJobListGroupSort({ key: k, asc: d === 'asc' })
                  }}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default (unassigned first, then KPI)</SelectItem>
                    <SelectItem value="property:asc">Property A → Z</SelectItem>
                    <SelectItem value="property:desc">Property Z → A</SelectItem>
                    <SelectItem value="client:asc">Client A → Z</SelectItem>
                    <SelectItem value="client:desc">Client Z → A</SelectItem>
                    <SelectItem value="price:asc">Price low → high</SelectItem>
                    <SelectItem value="price:desc">Price high → low</SelectItem>
                    <SelectItem value="team:asc">Team A → Z</SelectItem>
                    <SelectItem value="team:desc">Team Z → A</SelectItem>
                    <SelectItem value="status:asc">Status (early → late)</SelectItem>
                    <SelectItem value="status:desc">Status (late → early)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Card>
              <CardContent className="p-0">
                {jobListGroupSort.key !== 'default' ? (
                  <div className="hidden md:flex border-b border-border px-3 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground"
                      onClick={() => setJobListGroupSort({ key: 'default', asc: false })}
                    >
                      Reset table sort
                    </Button>
                  </div>
                ) : null}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[36px]">
                          <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleSelectAllProperties(Boolean(checked))} />
                        </TableHead>
                        <TableHead>
                          <button
                            type="button"
                            className={cn(
                              '-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-left font-semibold hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              jobListGroupSort.key === 'property' ? 'text-foreground' : 'text-muted-foreground',
                            )}
                            onClick={() => onJobListColumnSort('property')}
                          >
                            Property
                            {jobListGroupSort.key === 'property' ? (
                              jobListGroupSort.asc ? (
                                <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
                            )}
                          </button>
                        </TableHead>
                        <TableHead>
                          <button
                            type="button"
                            className={cn(
                              '-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-left font-semibold hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              jobListGroupSort.key === 'client' ? 'text-foreground' : 'text-muted-foreground',
                            )}
                            onClick={() => onJobListColumnSort('client')}
                          >
                            Client
                            {jobListGroupSort.key === 'client' ? (
                              jobListGroupSort.asc ? (
                                <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
                            )}
                          </button>
                        </TableHead>
                        <TableHead>
                          <button
                            type="button"
                            className={cn(
                              '-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-left font-semibold hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              jobListGroupSort.key === 'price' ? 'text-foreground' : 'text-muted-foreground',
                            )}
                            onClick={() => onJobListColumnSort('price')}
                          >
                            Price
                            {jobListGroupSort.key === 'price' ? (
                              jobListGroupSort.asc ? (
                                <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
                            )}
                          </button>
                        </TableHead>
                        <TableHead>
                          <button
                            type="button"
                            className={cn(
                              '-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-left font-semibold hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              jobListGroupSort.key === 'team' ? 'text-foreground' : 'text-muted-foreground',
                            )}
                            onClick={() => onJobListColumnSort('team')}
                          >
                            Team
                            {jobListGroupSort.key === 'team' ? (
                              jobListGroupSort.asc ? (
                                <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
                            )}
                          </button>
                        </TableHead>
                        <TableHead className="w-[100px] text-center">BTOB</TableHead>
                        <TableHead>
                          <button
                            type="button"
                            className={cn(
                              '-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-left font-semibold hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              jobListGroupSort.key === 'status' ? 'text-foreground' : 'text-muted-foreground',
                            )}
                            onClick={() => onJobListColumnSort('status')}
                          >
                            Status
                            {jobListGroupSort.key === 'status' ? (
                              jobListGroupSort.asc ? (
                                <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
                            )}
                          </button>
                        </TableHead>
                        <TableHead className="w-[80px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobListPropertyGroups.map((group) => {
                        const rowKey = `${group.property}-${group.unitNumber || ''}-${group.address}`
                        const fullyDone = schedulePropertyGroupIsFullyCompleted(group)
                        const allBtob = group.jobs.length > 0 && group.jobs.every((j) => j.btob)
                        const someBtob = group.jobs.some((j) => j.btob)
                        const rowStatusSelectVal = jobRowStatusSelectValue(group.jobs[0])
                        const canRowStatusSelect =
                          group.jobs.length > 0 &&
                          JOB_LIST_QUICK_STATUS_KEYS.has(rowStatusSelectVal) &&
                          group.jobs.every((j) => jobRowStatusSelectValue(j) === rowStatusSelectVal)
                        const teamSelectVal = propertyGroupTeamSelectValue(group)
                        const teamSelectMixed = teamSelectVal === '__mixed__'
                        const teamSelectUnknown =
                          teamSelectVal !== '__mixed__' &&
                          teamSelectVal !== '__unassigned__' &&
                          !teams.some((t) => t.id === teamSelectVal)
                        return (
                        <TableRow
                          key={rowKey}
                          className={cn(
                            group.unassignedCount > 0 && 'bg-amber-50/40',
                            group.jobs.some((j) => j.btob) && 'border-4 border-red-600',
                          )}
                        >
                          <TableCell className="py-2">
                            <Checkbox
                              checked={selectedPropertyKeys.includes(rowKey)}
                              onCheckedChange={(checked) => togglePropertySelection(rowKey, Boolean(checked))}
                            />
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="font-medium leading-tight">{group.property}</div>
                            <div className="text-xs text-muted-foreground">
                              {group.unitNumber ? `Unit No. ${group.unitNumber}` : 'Unit No. -'}
                            </div>
                          </TableCell>
                          <TableCell className="py-2">{group.client}</TableCell>
                          <TableCell className="py-2">RM {group.totalPrice.toLocaleString('en-MY')}</TableCell>
                          <TableCell className="py-2 text-sm">
                            <div className="flex flex-col items-start gap-1.5 min-w-[140px] max-w-[220px]">
                              <Select
                                value={teamSelectVal ?? '__unassigned__'}
                                onValueChange={(v) => onJobListTeamSelectCommit(group, v)}
                                disabled={fullyDone || teamSavingGroupKey === rowKey}
                              >
                                <SelectTrigger className="h-8 w-full text-left">
                                  <SelectValue placeholder={teamSelectMixed ? 'Mixed teams' : 'Team'} />
                                </SelectTrigger>
                                <SelectContent>
                                  {teamSelectMixed ? (
                                    <SelectItem value="__mixed__" disabled>
                                      Mixed teams — pick one
                                    </SelectItem>
                                  ) : null}
                                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                                  {teamSelectUnknown ? (
                                    <SelectItem value={teamSelectVal}>
                                      {group.teamNames[0] || 'Current team'}
                                    </SelectItem>
                                  ) : null}
                                  {teams.map((t) => (
                                    <SelectItem key={t.id} value={t.id}>
                                      {t.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="flex justify-center">
                              <Checkbox
                                checked={allBtob ? true : someBtob ? 'indeterminate' : false}
                                disabled={fullyDone || btobSavingGroupKey === rowKey}
                                onCheckedChange={(c) => void setGroupScheduleBtob(group, c === true)}
                                aria-label={`BTOB ${group.property}`}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="py-2">
                            {canRowStatusSelect ? (
                              <ScheduleJobQuickStatusSelect
                                value={rowStatusSelectVal}
                                disabled={statusSavingGroupKey === rowKey}
                                className="h-8 min-w-[min(100%,280px)] max-w-[320px]"
                                onCommit={(v) => onJobListStatusSelectCommit(group, v)}
                              />
                            ) : jobRowStatusSelectValue(group.jobs[0]) === 'customer-missing' ? (
                              <Badge variant="outline" className="border-red-300 bg-red-50 text-xs font-medium text-red-700">
                                Customer missing
                              </Badge>
                            ) : (
                              <StatusBadge status={group.jobs[0]?.status || 'pending-checkout'} size="sm" />
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost">
                                  Action
                                  <ChevronDown className="ml-1 h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {fullyDone ? (
                                  <>
                                    <DropdownMenuItem onClick={() => openViewJobDetailDialog(group.jobs[0], group)}>
                                      <Eye className="mr-2 h-4 w-4" />
                                      View detail
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => openGiveClientReviewDialog(group.jobs[0], group)}>
                                      <MessageSquare className="mr-2 h-4 w-4" />
                                      Give review
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => setDeleteJobsConfirmGroup(group)}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Delete job{group.jobs.length > 1 ? 's' : ''}
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <>
                                    <DropdownMenuItem onClick={() => openEditBookingDialog(group.jobs[0], group)}>
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => setDeleteJobsConfirmGroup(group)}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Delete job{group.jobs.length > 1 ? 's' : ''}
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="md:hidden space-y-3 p-3">
                  {jobListPropertyGroups.map((group) => {
                    const rowKey = `${group.property}-${group.unitNumber || ''}-${group.address}`
                    const fullyDoneM = schedulePropertyGroupIsFullyCompleted(group)
                    const rowStatusSelectValM = jobRowStatusSelectValue(group.jobs[0])
                    const canRowStatusSelectM =
                      group.jobs.length > 0 &&
                      JOB_LIST_QUICK_STATUS_KEYS.has(rowStatusSelectValM) &&
                      group.jobs.every((j) => jobRowStatusSelectValue(j) === rowStatusSelectValM)
                    const teamSelectValM = propertyGroupTeamSelectValue(group)
                    const teamSelectMixedM = teamSelectValM === '__mixed__'
                    const teamSelectUnknownM =
                      teamSelectValM !== '__mixed__' &&
                      teamSelectValM !== '__unassigned__' &&
                      !teams.some((t) => t.id === teamSelectValM)
                    return (
                      <div
                        key={rowKey}
                        className={cn(
                          'rounded-lg border border-border bg-background p-4 space-y-3',
                          group.unassignedCount > 0 && 'bg-amber-50/40',
                          group.jobs.some((j) => j.btob) && 'border-4 border-red-600',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            className="mt-1 shrink-0"
                            checked={selectedPropertyKeys.includes(rowKey)}
                            onCheckedChange={(checked) => togglePropertySelection(rowKey, Boolean(checked))}
                          />
                          <div className="min-w-0 flex-1 space-y-3">
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Property</p>
                              <p className="mt-0.5 font-medium leading-snug break-words">{group.property}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {group.unitNumber ? `Unit No. ${group.unitNumber}` : 'Unit No. -'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Client</p>
                              <p className="mt-0.5 break-words">{group.client}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Price</p>
                              <p className="mt-0.5">RM {group.totalPrice.toLocaleString('en-MY')}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Team</p>
                              <div className="mt-1.5 space-y-1.5">
                                <Select
                                  value={teamSelectValM ?? '__unassigned__'}
                                  onValueChange={(v) => onJobListTeamSelectCommit(group, v)}
                                  disabled={fullyDoneM || teamSavingGroupKey === rowKey}
                                >
                                  <SelectTrigger className="h-9 w-full min-w-0 text-left">
                                    <SelectValue placeholder={teamSelectMixedM ? 'Mixed teams' : 'Team'} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {teamSelectMixedM ? (
                                      <SelectItem value="__mixed__" disabled>
                                        Mixed teams — pick one
                                      </SelectItem>
                                    ) : null}
                                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                                    {teamSelectUnknownM ? (
                                      <SelectItem value={teamSelectValM}>
                                        {group.teamNames[0] || 'Current team'}
                                      </SelectItem>
                                    ) : null}
                                    {teams.map((t) => (
                                      <SelectItem key={t.id} value={t.id}>
                                        {t.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Status</p>
                              <div className="mt-1">
                                {canRowStatusSelectM ? (
                                  <ScheduleJobQuickStatusSelect
                                    value={rowStatusSelectValM}
                                    disabled={statusSavingGroupKey === rowKey}
                                    className="h-9 w-full min-w-0"
                                    onCommit={(v) => onJobListStatusSelectCommit(group, v)}
                                  />
                                ) : jobRowStatusSelectValue(group.jobs[0]) === 'customer-missing' ? (
                                  <Badge variant="outline" className="border-red-300 bg-red-50 text-xs font-medium text-red-700">
                                    Customer missing
                                  </Badge>
                                ) : (
                                  <StatusBadge status={group.jobs[0]?.status || 'pending-checkout'} size="sm" />
                                )}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">BTOB</p>
                              <div className="mt-1 flex items-center gap-2">
                                <Checkbox
                                  checked={
                                    group.jobs.length > 0 && group.jobs.every((j) => j.btob)
                                      ? true
                                      : group.jobs.some((j) => j.btob)
                                        ? 'indeterminate'
                                        : false
                                  }
                                  disabled={fullyDoneM || btobSavingGroupKey === rowKey}
                                  onCheckedChange={(c) => void setGroupScheduleBtob(group, c === true)}
                                />
                                <span className="text-xs">Same-day turnover</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="secondary" className="w-full">
                                Action
                                <ChevronDown className="ml-1 h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="center" className="w-[min(100vw-2rem,280px)]">
                              {fullyDoneM ? (
                                <>
                                  <DropdownMenuItem onClick={() => openViewJobDetailDialog(group.jobs[0], group)}>
                                    <Eye className="mr-2 h-4 w-4" />
                                    View detail
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openGiveClientReviewDialog(group.jobs[0], group)}>
                                    <MessageSquare className="mr-2 h-4 w-4" />
                                    Give review
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <DropdownMenuItem onClick={() => openEditBookingDialog(group.jobs[0], group)}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'map' && (
          <div className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Map View</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    Points are coloured by saved area groups. Hover for jobs; selected rows from the Job tab show
                    stronger markers.
                  </span>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary underline underline-offset-2 hover:no-underline"
                    onClick={() => setAreasEditorOpen(true)}
                  >
                    Edit area groups
                  </button>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="relative z-0 w-full overflow-hidden rounded-md border"
                  style={{ height: 500, minHeight: 500 }}
                >
                  <div
                    ref={mapContainerRef}
                    className="leaflet-map-host h-full w-full"
                    style={{ height: '100%', minHeight: 500 }}
                  />
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {mapGroups.map((group) => (
                    <div key={`${group.property}-${group.lat}`} className="rounded-md border p-3">
                      <div className="font-medium">{group.property}</div>
                      <div className="text-sm text-muted-foreground mb-2">Total Jobs: {group.jobs.length}</div>
                      <div className="space-y-1">
                        {group.jobs.map((job) => (
                          <div key={job.id} className="text-sm">
                            {job.property} - {resolveTeamLabel(job)}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </Tabs>

      <Dialog open={teamEditOpen} onOpenChange={setTeamEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Team Unit Assignment</DialogTitle>
            <DialogDescription>One job can only belong to one team. Selecting it here automatically reserves it for this team.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[50vh] overflow-y-auto">
            {editingTeamJobs.map((job) => {
              const editTeam = editingTeamId ? teams.find((x) => x.id === editingTeamId) : undefined
              const assignedHere =
                job.teamId === editingTeamId ||
                Boolean(editTeam && !job.teamId && job.teamName && job.teamName === editTeam.name)
              const rowKey = String(job.propertyId || `${job.property}-${job.unitNumber || ''}-${job.address}`)
              const btobFill =
                job.btob && teamEditBtobFillJobIdByPropertyKey.get(rowKey) === job.id
              return (
              <label
                key={job.id}
                className={cn(
                  'flex items-start gap-3 rounded-md border p-3',
                  job.btob && btobFill && 'border-4 border-red-700 bg-red-50',
                  job.btob && !btobFill && 'border-4 border-red-500',
                )}
              >
                <Checkbox
                  checked={assignedHere}
                  onCheckedChange={(checked) => {
                    if (!editingTeamId) return
                    void toggleJobForTeam(job.id, editingTeamId, Boolean(checked))
                  }}
                />
                <div>
                  <p className="font-medium">{job.property}</p>
                  <p className="text-sm text-muted-foreground">{job.address}</p>
                  <p className="text-xs text-muted-foreground">Current: {resolveTeamLabel(job)}</p>
                  {job.btob ? (
                    <p className="mt-1 text-xs font-medium text-red-700">BTOB — same-day turnover</p>
                  ) : null}
                </div>
              </label>
            )})}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTeamEditOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newTaskOpen}
        onOpenChange={(open) => {
          setNewTaskOpen(open)
          if (!open) {
            suppressDialogOpenPriceDirtyResetRef.current = false
            setScheduleJobDialogReadOnly(false)
            setViewDetailCompletionPhotos([])
            setScheduleJobDialogJobId(null)
            setCompletionPhotoLightboxUrl(null)
            setEditingScheduleJobId(null)
            setPropertyPickerOpen(false)
            setCreateJobAddonDraft({})
            setNewTaskTimeStart('')
            setNewTaskTimeEnd('')
            setCreateJobPriceInput('')
            setCreateJobPriceDirty(false)
            setCreateJobMode('single')
            setCreateJobStep('property')
            setCreateJobGroupId('')
            setBulkCreatePropertyIds([])
            setCreateJobPropertyFilter('')
          } else if (!suppressDialogOpenPriceDirtyResetRef.current) {
            setCreateJobPriceDirty(false)
          } else {
            suppressDialogOpenPriceDirtyResetRef.current = false
          }
        }}
      >
        <DialogContent
          showCloseButton
          className={cn(
            'flex max-h-[min(92dvh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl',
          )}
        >
          <div className="shrink-0 border-b border-border px-6 py-4">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-xl">
                {scheduleJobDialogReadOnly ? 'Job detail' : editingScheduleJobId ? 'Edit job' : 'Create job'}
              </DialogTitle>
              {(editingScheduleJobId || scheduleJobDialogReadOnly) && scheduleJobDialogJobId ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-0.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">ID</span>
                  <code className="max-w-[min(100%,280px)] truncate rounded border border-border/80 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {scheduleJobDialogJobId}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => {
                      const id = scheduleJobDialogJobId
                      if (!id) return
                      void (async () => {
                        try {
                          await navigator.clipboard.writeText(id)
                          toast.success('ID copied')
                        } catch {
                          toast.error('Could not copy (browser blocked clipboard)')
                        }
                      })()
                    }}
                  >
                    Copy
                  </Button>
                </div>
              ) : null}
              <DialogDescription>
                {scheduleJobDialogReadOnly
                  ? 'This job is completed. You can review details only.'
                  : editingScheduleJobId
                    ? 'Update service, time, price, and notes for this booking.'
                    : 'Like client booking: step 1 property (single, bulk list, or group), step 2 service &amp; time, step 3 summary.'}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 pt-2 md:px-6">
            <div className="space-y-4">
              {scheduleJobDialogReadOnly ? (
                <p className="text-[11px] font-medium text-muted-foreground">View only — completed job</p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span className={createJobStep === 'property' ? 'font-semibold text-foreground' : ''}>1 Property</span>
                  <span aria-hidden>·</span>
                  <span className={createJobStep === 'schedule' ? 'font-semibold text-foreground' : ''}>
                    2 Service &amp; time
                  </span>
                  <span aria-hidden>·</span>
                  <span className={createJobStep === 'summary' ? 'font-semibold text-foreground' : ''}>3 Summary</span>
                </div>
              )}

              {createJobStep === 'property' && (
                <>
                  <div className="w-full min-w-0 shrink-0 space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Booking type</p>
                    <div className="inline-flex max-w-full flex-wrap rounded-lg border border-border bg-muted/40 p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setCreateJobMode('single')
                          setBulkCreatePropertyIds([])
                          setCreateJobGroupId('')
                        }}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm',
                          createJobMode === 'single'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Single
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCreateJobMode('bulk')
                          setNewTaskPropertyId('')
                          setPropertyPickerOpen(false)
                          setCreateJobGroupId('')
                        }}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm',
                          createJobMode === 'bulk'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Bulk
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCreateJobMode('group')
                          setNewTaskPropertyId('')
                          setPropertyPickerOpen(false)
                          setCreateJobGroupId('')
                          setBulkCreatePropertyIds([])
                        }}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm',
                          createJobMode === 'group'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Group
                      </button>
                    </div>
                  </div>

                  {createJobMode === 'single' ? (
                <div className="space-y-2">
                  <Label>Property</Label>
                  <Popover modal={false} open={propertyPickerOpen} onOpenChange={setPropertyPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={propertyPickerOpen}
                        className="h-10 w-full justify-between font-normal"
                      >
                        <span className="truncate text-left">
                          {newTaskPropertyId
                            ? propertyRows.find((p) => p.id === newTaskPropertyId)?.label ?? 'Choose property'
                            : propertyRows.length
                              ? 'Search or select property…'
                              : 'No properties in database'}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                      align="start"
                      onWheelCapture={(e) => e.stopPropagation()}
                    >
                      <Command>
                        <CommandInput placeholder="Search property or unit…" />
                        <CommandList
                          className="max-h-[280px] overflow-y-auto overscroll-contain"
                          onWheelCapture={(e) => e.stopPropagation()}
                        >
                          <CommandEmpty>No property found.</CommandEmpty>
                          <CommandGroup>
                            {propertyRows.map((p) => (
                              <CommandItem
                                key={p.id}
                                value={`${p.label} ${p.name} ${p.unitNumber} ${p.id}`}
                                onSelect={() => {
                                  setNewTaskPropertyId(p.id)
                                  setPropertyPickerOpen(false)
                                }}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4 shrink-0',
                                    newTaskPropertyId === p.id ? 'opacity-100' : 'opacity-0'
                                  )}
                                />
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                                  <span className="truncate font-medium">{p.name || '—'}</span>
                                  <span className="truncate text-xs text-muted-foreground">
                                    {p.unitNumber ? `Unit ${p.unitNumber}` : 'Unit —'}
                                  </span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              ) : createJobMode === 'bulk' ? (
                <div className="flex min-h-0 flex-col space-y-2">
                  <Label>Properties</Label>
                  <Input
                    type="search"
                    value={createJobPropertyFilter}
                    onChange={(e) => setCreateJobPropertyFilter(e.target.value)}
                    placeholder="Name or unit number…"
                    className="border-input"
                    autoComplete="off"
                  />
                  <ScrollArea className="h-[min(280px,42vh)] rounded-lg border border-border/60">
                    <div className="divide-y divide-border/60">
                      {filteredCreateJobPropertyRows.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">No properties match.</p>
                      ) : (
                        filteredCreateJobPropertyRows.map((p) => {
                          const checked = bulkCreatePropertyIds.includes(p.id)
                          return (
                            <label
                              key={p.id}
                              className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/50"
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={checked}
                                onCheckedChange={(c) => {
                                  const on = c === true
                                  setBulkCreatePropertyIds((prev) =>
                                    on ? [...new Set([...prev, p.id])] : prev.filter((x) => x !== p.id),
                                  )
                                }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium leading-snug">{p.name || '—'}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  {p.unitNumber ? `Unit ${p.unitNumber}` : 'Unit —'}
                                </span>
                              </span>
                            </label>
                          )
                        })
                      )}
                    </div>
                  </ScrollArea>
                  {bulkCreatePropertyIds.length > 0 ? (
                    <p className="text-center text-[11px] text-muted-foreground">
                      Selected: {bulkCreatePropertyIds.length} unit(s)
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3 py-1">
                  <Label>Group</Label>
                  {operatorPropertyGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No groups yet. Create one under Property first.</p>
                  ) : (
                    <>
                      <Select
                        value={createJobGroupId || '__none'}
                        onValueChange={(v) => setCreateJobGroupId(v === '__none' ? '' : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a group" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">Select a group…</SelectItem>
                          {operatorPropertyGroups.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {createJobGroupId && bulkCreatePropertyIds.length > 0 ? (
                        <p className="text-xs text-muted-foreground">{bulkCreatePropertyIds.length} unit(s) in this group.</p>
                      ) : createJobGroupId ? (
                        <p className="text-xs text-muted-foreground">No units in this group.</p>
                      ) : null}
                    </>
                  )}
                </div>
              )}
                </>
              )}

              {createJobStep === 'schedule' && (
                <>
                  {!editingScheduleJobId && !scheduleJobDialogReadOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="-ml-2 mb-1 h-9 justify-start px-2 text-muted-foreground hover:text-foreground"
                      onClick={() => setCreateJobStep('property')}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4 shrink-0" />
                      Back
                    </Button>
                  ) : null}
              <div className="space-y-2">
                <Label>Service</Label>
                <Select
                  value={newTaskServiceKey}
                  onValueChange={(value: ServiceKey) => setNewTaskServiceKey(value)}
                  disabled={scheduleJobDialogReadOnly}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose service" />
                  </SelectTrigger>
                  <SelectContent>
                    {scheduleServiceOptions.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {scheduleServiceOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No services enabled. Add services under Pricing → Services Provider.
                  </p>
                ) : null}
              </div>

              {createJobAddonOptions.length > 0 ? (
                <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                  <div>
                    <Label>Add-ons (from Pricing)</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Optional extras configured under Finance → Pricing for this service.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {createJobAddonOptions.map((o) => {
                      const selected = createJobAddonDraft[o.id]?.selected ?? false
                      const qty = Math.max(1, Math.floor(createJobAddonDraft[o.id]?.qty ?? 1))
                      const line = jobAddonLineTotal(o.price, o.basis, qty)
                      const showQty = o.basis !== 'fixed'
                      return (
                        <div
                          key={o.id}
                          className="flex flex-col gap-2 rounded-md border border-border/80 bg-background p-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <label className="flex cursor-pointer items-start gap-2 min-w-0 sm:items-center sm:flex-1">
                            <Checkbox
                              checked={selected}
                              disabled={scheduleJobDialogReadOnly}
                              onCheckedChange={(c) =>
                                setCreateJobAddonDraft((d) => ({
                                  ...d,
                                  [o.id]: {
                                    selected: Boolean(c),
                                    qty: Math.max(1, Math.floor(d[o.id]?.qty ?? 1)),
                                  },
                                }))
                              }
                              className="mt-0.5 sm:mt-0"
                            />
                            <span className="min-w-0 flex-1 leading-snug">
                              <span className="font-medium">{o.name}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  {jobAddonBasisLabel(o.basis)}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  RM {o.price.toLocaleString('en-MY')}
                                  {showQty ? ' each' : ''}
                                </span>
                              </span>
                            </span>
                          </label>
                          <div className="flex shrink-0 items-center gap-2 pl-7 sm:pl-0">
                            {showQty ? (
                              <div className="flex items-center gap-1.5">
                                <Label htmlFor={`addon-qty-${o.id}`} className="text-xs text-muted-foreground whitespace-nowrap">
                                  Qty
                                </Label>
                                <Input
                                  id={`addon-qty-${o.id}`}
                                  type="number"
                                  min={1}
                                  step={1}
                                  className="h-8 w-[4.5rem]"
                                  disabled={!selected || scheduleJobDialogReadOnly}
                                  value={qty}
                                  onChange={(e) => {
                                    const v = Math.max(1, Math.floor(Number(e.target.value) || 1))
                                    setCreateJobAddonDraft((d) => ({
                                      ...d,
                                      [o.id]: {
                                        selected: d[o.id]?.selected ?? false,
                                        qty: v,
                                      },
                                    }))
                                  }}
                                />
                              </div>
                            ) : null}
                            {selected ? (
                              <span className="text-xs font-medium tabular-nums text-foreground whitespace-nowrap">
                                = RM {line.toLocaleString('en-MY')}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Select date</Label>
                <Input
                  type="date"
                  value={newTaskDate}
                  onChange={(e) => setNewTaskDate(e.target.value)}
                  disabled={scheduleJobDialogReadOnly}
                />
              </div>
            {requiresTime && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="mb-0">Time window</Label>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full border border-border/80 bg-background text-[11px] font-semibold leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Time window: pricing, company hours, and surcharges"
                      >
                        ?
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      sideOffset={8}
                      className="z-[600] max-w-sm text-left text-xs leading-relaxed"
                    >
                      <div className="space-y-2">
                        <p>
                          {scheduleTimeStepMinutes >= 60
                            ? `By-hour pricing: blocks of ${scheduleTimeStepMinutes / 60} hour(s) (from Finance → Pricing). End must be a multiple of that duration after start.`
                            : 'Choose start and end (30-minute steps).'}
                        </p>
                        {operatorCompanyHours &&
                        String(operatorCompanyHours.workingHourFrom || '').trim() &&
                        String(operatorCompanyHours.workingHourTo || '').trim() ? (
                          <p>
                            Company working hours: {operatorCompanyHours.workingHourFrom}–
                            {operatorCompanyHours.workingHourTo}
                            {String(operatorCompanyHours.outOfWorkingHourFrom || '').trim() &&
                            String(operatorCompanyHours.outOfWorkingHourTo || '').trim()
                              ? ` · Bookable window: ${operatorCompanyHours.outOfWorkingHourFrom}–${operatorCompanyHours.outOfWorkingHourTo}`
                              : null}
                          </p>
                        ) : null}
                        {companyOohSummaryLines.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                        <p className="border-t border-border/60 pt-2 text-muted-foreground">
                          Use{' '}
                          <span className="text-foreground font-medium">{OPERATOR_SCHEDULE_AI_DISPLAY_NAME}</span> chat
                          (bottom-right) for AI preferences and auto-assign. Map zone colours: open the{' '}
                          <span className="text-foreground font-medium">Map</span> tab →{' '}
                          <span className="text-foreground font-medium">Edit area groups</span>.
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-1.5">
                    <span className="text-xs text-muted-foreground">From</span>
                    <Select
                      value={newTaskTimeStart || SCHEDULE_TIME_SELECT_EMPTY}
                      disabled={scheduleJobDialogReadOnly}
                      onValueChange={(v) => {
                        const next = v === SCHEDULE_TIME_SELECT_EMPTY ? '' : v
                        setNewTaskTimeStart(next)
                        if (!next) {
                          setNewTaskTimeEnd('')
                          return
                        }
                        const ends = buildScheduleEndSlotOptions(next, scheduleTimeStepMinutes, scheduleDayBounds)
                        if (newTaskTimeEnd && !ends.includes(newTaskTimeEnd)) {
                          setNewTaskTimeEnd('')
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Start time" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[min(280px,50vh)]">
                        <SelectItem value={SCHEDULE_TIME_SELECT_EMPTY}>Select start…</SelectItem>
                        {scheduleStartTimeOptions.map((slot) => (
                          <SelectItem key={slot} value={slot}>
                            {slot}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <span className="text-xs text-muted-foreground">To</span>
                    <Select
                      value={newTaskTimeEnd || SCHEDULE_TIME_SELECT_EMPTY}
                      onValueChange={(v) => setNewTaskTimeEnd(v === SCHEDULE_TIME_SELECT_EMPTY ? '' : v)}
                      disabled={scheduleJobDialogReadOnly || !newTaskTimeStart}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="End time" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[min(280px,50vh)]">
                        <SelectItem value={SCHEDULE_TIME_SELECT_EMPTY}>Select end…</SelectItem>
                        {scheduleEndTimeOptions.map((slot) => (
                          <SelectItem key={slot} value={slot}>
                            {slot}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Edit remark</Label>
              <Textarea
                value={newTaskRemark}
                onChange={(e) => setNewTaskRemark(e.target.value)}
                placeholder="Optional operator notes"
                rows={3}
                readOnly={scheduleJobDialogReadOnly}
                disabled={scheduleJobDialogReadOnly}
              />
            </div>
                </>
              )}

              {createJobStep === 'summary' && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="-ml-2 mb-1 h-9 justify-start px-2 text-muted-foreground hover:text-foreground"
                    onClick={() => setCreateJobStep('schedule')}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4 shrink-0" />
                    Back
                  </Button>
            <div className="rounded-md bg-muted p-3 text-sm space-y-2">
              <div className="flex items-center gap-1.5">
                <p className="font-medium">Summary</p>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
                      aria-label="How Create Job relates to booking and pricing"
                      title="Jobs here save as ready to clean (instant). Client booking rules are under Finance → Pricing. Hover for details."
                    >
                      <span className="text-xs font-semibold leading-none">(!)</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className="z-[600] max-w-sm text-left text-xs leading-relaxed">
                    <p className="font-medium text-foreground mb-1.5">Create Job on this page</p>
                    <p className="text-muted-foreground">
                      Saves as <span className="text-foreground">ready to clean</span> (instant). Lead-time rules for
                      clients do not apply here.
                    </p>
                    {clientBookingLabelForService && pricingBookingMeta ? (
                      <p className="text-muted-foreground mt-2">
                        <span className="text-foreground">Client self-booking</span> uses Finance → Pricing:{' '}
                        {clientBookingLabelForService}
                        {pricingBookingMeta.leadTime
                          ? ` · lead ${String(pricingBookingMeta.leadTime).replaceAll('_', ' ')}`
                          : ''}
                        .
                      </p>
                    ) : null}
                    <p className="text-muted-foreground mt-2 border-t border-border/60 pt-2">
                      Amounts are indicative from your Pricing settings, not a final invoice.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="space-y-1 text-[13px]">
                <p>
                  <span className="text-muted-foreground">Service</span>{' '}
                  {PRICING_SERVICES.find((s) => s.key === newTaskServiceKey)?.label ?? newTaskServiceKey}
                </p>
                {createJobMode === 'bulk' || createJobMode === 'group' ? (
                  <>
                    {createJobMode === 'group' && createJobGroupId ? (
                      <p>
                        <span className="text-muted-foreground">Group</span>{' '}
                        {operatorPropertyGroups.find((g) => g.id === createJobGroupId)?.name ?? createJobGroupId}
                      </p>
                    ) : null}
                    <p>
                      <span className="text-muted-foreground">Properties</span>{' '}
                      {bulkCreatePropertyIds.length > 0
                        ? `${bulkCreatePropertyIds.length} selected`
                        : '—'}
                    </p>
                  </>
                ) : (
                  <p>
                    <span className="text-muted-foreground">Property</span>{' '}
                    {propertyRows.find((p) => p.id === newTaskPropertyId)?.label || '—'}
                  </p>
                )}
                <p>
                  <span className="text-muted-foreground">Date</span> {newTaskDate}
                </p>
                <p>
                  <span className="text-muted-foreground">Time</span>{' '}
                  {requiresTime
                    ? [newTaskTimeStart, newTaskTimeEnd].filter(Boolean).join(' – ') || '—'
                    : '— (homestay)'}
                </p>
              </div>
              {createJobMode === 'bulk' || createJobMode === 'group' ? (
                <div className="space-y-2 border-t border-border/60 pt-2">
                  <p className="text-xs text-muted-foreground">Per property (one job each)</p>
                  {bulkCreatePropertyIds.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">Select units in the list above.</p>
                  ) : (
                    <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
                      {bulkCreateJobPricingRows.map((r) => (
                        <div
                          key={r.propertyId}
                          className={cn(
                            'flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 rounded-md border px-2 py-1.5 text-[13px]',
                            createJobMinSelling > 0 && !r.meetsMinimum
                              ? 'border-destructive/35 bg-destructive/5'
                              : 'border-border/70 bg-background/80'
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                          <span className="shrink-0 tabular-nums font-medium">
                            {r.grandTotal != null && Number.isFinite(r.grandTotal) ? (
                              <>RM {r.grandTotal.toLocaleString('en-MY')}</>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                          {createJobMinSelling > 0 && !r.meetsMinimum ? (
                            <span className="w-full text-[11px] text-destructive">Below min. selling</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Totals include add-ons and out-of-hours from Pricing where applicable.
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-1 border-t border-border/60 pt-2">
                    <p className="text-xs text-muted-foreground">Reference from Pricing</p>
                    {createJobPriceSummary.lines.map((line, i) => (
                      <p
                        key={i}
                        className={cn(
                          'text-[13px] leading-snug',
                          line.strong ? 'font-medium text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {line.text}
                      </p>
                    ))}
                  </div>
                  {createJobSelectedAddonTotal > 0 ? (
                    <p className="text-[13px] font-medium text-foreground">
                      Add-ons +RM {createJobSelectedAddonTotal.toLocaleString('en-MY')}
                    </p>
                  ) : null}
                  {createJobOohSurcharge > 0 ? (
                    <p className="text-[13px] font-medium text-foreground">
                      Out-of-hours extra +RM {createJobOohSurcharge.toLocaleString('en-MY')}
                    </p>
                  ) : null}
                  {createJobIndicativeGrandTotal != null ? (
                    <div
                      className={cn(
                        'rounded-lg border px-4 py-3 mt-1',
                        createJobMinSelling > 0 && !createJobMeetsMinimum
                          ? 'border-destructive/40 bg-destructive/5'
                          : 'border-primary/25 bg-primary/8'
                      )}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {scheduleJobDialogReadOnly ? 'Total charge' : 'Total charge (editable — markup OK)'}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xl font-semibold text-muted-foreground shrink-0">RM</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                          value={createJobPriceInput}
                          onChange={(e) => {
                            setCreateJobPriceDirty(true)
                            setCreateJobPriceInput(e.target.value)
                          }}
                          disabled={scheduleJobDialogReadOnly}
                          readOnly={scheduleJobDialogReadOnly}
                          className="h-12 min-w-0 flex-1 text-2xl font-bold tabular-nums tracking-tight"
                        />
                      </div>
                      {createJobIndicativeGrandTotal != null ? (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2">
                          <p className="text-xs text-muted-foreground">
                            Pricing estimate: RM {createJobIndicativeGrandTotal.toLocaleString('en-MY')}
                          </p>
                          {!scheduleJobDialogReadOnly ? (
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto p-0 text-xs"
                              onClick={() => {
                                setCreateJobPriceDirty(false)
                                setCreateJobPriceInput(
                                  String(Math.round(createJobIndicativeGrandTotal * 100) / 100)
                                )
                              }}
                            >
                              Use estimate
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {createJobMinSelling > 0 ? (
                        <div className="text-sm mt-2 space-y-1">
                          <p
                            className={cn(
                              createJobMeetsMinimum ? 'text-muted-foreground' : 'text-destructive font-medium'
                            )}
                          >
                            Min. selling (service + add-ons, excl. OOH): RM{' '}
                            {createJobMinSelling.toLocaleString('en-MY')}
                            {createJobMeetsMinimum ? ' ✓' : ' — extend hours or add-ons; OOH cannot count'}
                          </p>
                          {createJobCoreSubtotal != null ? (
                            <p className="text-xs text-muted-foreground">
                              Core before OOH: RM {createJobCoreSubtotal.toLocaleString('en-MY')} · out-of-hours is on top
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1.5">
                          Indicative from Pricing; not a final invoice.
                        </p>
                      )}
                    </div>
                  ) : createJobMinSelling > 0 ? (
                    <p className="text-[13px] border-t border-border/60 pt-2 text-muted-foreground">
                      Min. RM {createJobMinSelling.toLocaleString('en-MY')} — set Pricing/property for an estimate
                    </p>
                  ) : null}
                </>
              )}
            </div>
                </>
              )}
              {scheduleJobDialogReadOnly && viewDetailCompletionPhotos.length > 0 ? (
                <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Completion photos
                  </Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {viewDetailCompletionPhotos.map((url, i) => (
                      <button
                        key={`${url}-${i}`}
                        type="button"
                        onClick={() => setCompletionPhotoLightboxUrl(url)}
                        className="block w-full overflow-hidden rounded-md border border-border/80 bg-background text-left shadow-sm outline-none ring-offset-background transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- OSS / Wix CDN URLs */}
                        <img
                          src={url}
                          alt={`Completion photo ${i + 1}`}
                          className="aspect-square h-auto w-full object-cover pointer-events-none"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Click a photo to enlarge. Click outside or press Esc to close.</p>
                </div>
              ) : null}
          </div>
          </div>
          <DialogFooter className="flex flex-col gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
            {scheduleJobDialogReadOnly ? (
              <>
                {createJobStep === 'summary' ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={() => setCreateJobStep('schedule')}
                  >
                    Back
                  </Button>
                ) : null}
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setNewTaskOpen(false)}>
                  Close
                </Button>
                {createJobStep === 'schedule' ? (
                  <Button
                    type="button"
                    className="w-full bg-primary text-primary-foreground sm:w-auto"
                    disabled={!createJobScheduleStepValid}
                    onClick={() => setCreateJobStep('summary')}
                  >
                    Next
                  </Button>
                ) : null}
              </>
            ) : createJobStep === 'property' ? (
              <>
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setNewTaskOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="w-full bg-primary text-primary-foreground sm:w-auto"
                  disabled={!hasCreateJobPropertySelection}
                  onClick={() => setCreateJobStep('schedule')}
                >
                  Next
                </Button>
              </>
            ) : createJobStep === 'schedule' ? (
              <>
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setNewTaskOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="w-full bg-primary text-primary-foreground sm:w-auto"
                  disabled={!createJobScheduleStepValid}
                  onClick={() => setCreateJobStep('summary')}
                >
                  Next
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setNewTaskOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="w-full bg-primary text-primary-foreground sm:w-auto"
                  onClick={createTask}
                  disabled={
                    scheduleServiceOptions.length === 0 ||
                    (createJobMode === 'single' && createJobMinSelling > 0 && !createJobMeetsMinimum) ||
                    ((createJobMode === 'bulk' || createJobMode === 'group') && !bulkCreateJobPricingOk)
                  }
                >
                  {editingScheduleJobId ? 'Save changes' : 'Create Job'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkExtendDialogOpen} onOpenChange={setBulkExtendDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk Extend</DialogTitle>
            <DialogDescription>
              Choose the new working day for all selected rows. The same job rows are kept; only working day updates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="bulk-extend-day">New working day</Label>
            <Input
              id="bulk-extend-day"
              type="date"
              value={bulkExtendYmd}
              onChange={(e) => setBulkExtendYmd(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkExtendDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void (async () => {
                  const ok = await bulkUpdateStatus('in-progress', 'Extend', bulkExtendYmd)
                  if (ok) setBulkExtendDialogOpen(false)
                })()
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkHomestayDialogOpen} onOpenChange={setBulkHomestayDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk homestay (property name)</DialogTitle>
            <DialogDescription>
              Create one <span className="font-medium">homestay cleaning</span> job (pending check out) for every
              property whose name contains the text below, for working day <span className="font-medium">{scheduleDay}</span>.
              Units that already have a schedule row that day are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="bulk-homestay-needle">Name contains (min. 2 characters)</Label>
            <Input
              id="bulk-homestay-needle"
              value={bulkHomestayNameContains}
              onChange={(e) => setBulkHomestayNameContains(e.target.value)}
              placeholder="e.g. arc"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkHomestayDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={bulkHomestayRunning || bulkHomestayNameContains.trim().length < 2}
              onClick={() => {
                void (async () => {
                  setBulkHomestayRunning(true)
                  try {
                    const r = await postOperatorBulkHomestayByPropertyName(operatorId, scheduleDay, bulkHomestayNameContains, {
                      email: operatorEmail || undefined,
                    })
                    if (!r.ok) {
                      toast.error(typeof r.reason === 'string' ? r.reason : 'Bulk create failed')
                      return
                    }
                    const cr = Number(r.created) || 0
                    const sk = Number(r.skipped) || 0
                    const er = Array.isArray(r.errors) ? r.errors.length : 0
                    toast.success(
                      `Created ${cr} job(s). Skipped ${sk} (already had a row that day).${er ? ` ${er} row(s) failed.` : ''}`
                    )
                    setBulkHomestayDialogOpen(false)
                    await loadSchedulePage({ bustScheduleCache: true })
                  } finally {
                    setBulkHomestayRunning(false)
                  }
                })()
              }}
            >
              {bulkHomestayRunning ? 'Running…' : 'Create jobs'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rowExtendDialogOpen}
        onOpenChange={(open) => {
          setRowExtendDialogOpen(open)
          if (!open) setRowExtendGroup(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Customer extend</DialogTitle>
            <DialogDescription>
              Choose the new working day for this row. Status will be set to <span className="font-medium">in progress</span>{' '}
              (extended checkout).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="row-extend-day">New working day</Label>
            <Input
              id="row-extend-day"
              type="date"
              value={rowExtendYmd}
              onChange={(e) => setRowExtendYmd(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRowExtendDialogOpen(false)
                setRowExtendGroup(null)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!rowExtendGroup) return
                void (async () => {
                  await applyGroupJobListStatus(rowExtendGroup, 'in-progress', rowExtendYmd)
                  setRowExtendDialogOpen(false)
                  setRowExtendGroup(null)
                })()
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteJobsConfirmGroup}
        onOpenChange={(open) => {
          if (!open && !deleteJobsSaving) setDeleteJobsConfirmGroup(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job{deleteJobsConfirmGroup && deleteJobsConfirmGroup.jobs.length > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteJobsConfirmGroup ? (
                <>
                  This permanently removes{' '}
                  <span className="font-medium text-foreground">
                    {deleteJobsConfirmGroup.jobs.length} cleaning job
                    {deleteJobsConfirmGroup.jobs.length > 1 ? 's' : ''}
                  </span>{' '}
                  for <span className="font-medium text-foreground">{deleteJobsConfirmGroup.property}</span>
                  {deleteJobsConfirmGroup.unitNumber ? ` (unit ${deleteJobsConfirmGroup.unitNumber})` : ''}. Linked
                  damage reports for those rows are removed first. This cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteJobsSaving}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteJobsSaving}
              className="inline-flex items-center gap-2"
              onClick={() => void runDeleteJobsFromConfirm()}
            >
              {deleteJobsSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={areasEditorOpen} onOpenChange={setAreasEditorOpen}>
        <DialogContent className="max-h-[90vh] w-full max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Areas &amp; map</DialogTitle>
            <DialogDescription className="text-sm">
              One property per area. Pins use <strong>saved latitude/longitude</strong> on the property when set, then
              Waze / Google links, then loaded jobs; otherwise a small spread around the default map center.
            </DialogDescription>
          </DialogHeader>
          <div
            className="relative z-0 w-full overflow-hidden rounded-md border"
            style={{ height: 280, minHeight: 280 }}
          >
            <div
              ref={areasMapContainerRef}
              className="leaflet-map-host h-full w-full"
              style={{ height: '100%', minHeight: 280 }}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={addRegionGroup}>
              Add area
            </Button>
          </div>
          {regionGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No areas yet — add one and pick properties.</p>
          ) : (
            <div className="space-y-3">
              {regionGroups.map((rg, idx) => (
                <div key={rg.id} className="space-y-2 rounded-md border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[8rem] flex-1 space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        className="h-9"
                        value={rg.name}
                        onChange={(e) => updateRegionGroup(idx, { name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Color</Label>
                      <Input
                        type="color"
                        className="h-9 w-14 cursor-pointer p-1"
                        value={rg.color}
                        onChange={(e) => updateRegionGroup(idx, { color: e.target.value })}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => removeRegionGroup(idx)}
                    >
                      Remove
                    </Button>
                  </div>
                  <div>
                    <Label className="text-xs">Properties in this area</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="mt-1 w-full justify-between">
                          {rg.propertyIds.length} selected
                          <ChevronsUpDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[min(100vw-2rem,22rem)] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search property…" />
                          <CommandList>
                            <CommandEmpty>No property.</CommandEmpty>
                            <CommandGroup>
                              {propertyRows.map((p) => (
                                <CommandItem
                                  key={p.id}
                                  value={`${p.label} ${p.id}`}
                                  onSelect={() => togglePropertyInRegion(idx, p.id)}
                                >
                                  <Check
                                    className={cn(
                                      'mr-2 h-4 w-4',
                                      rg.propertyIds.includes(p.id) ? 'opacity-100' : 'opacity-0'
                                    )}
                                  />
                                  {p.label}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setAreasEditorOpen(false)} disabled={areasSaveRunning}>
              Cancel
            </Button>
            <Button type="button" disabled={areasSaveRunning} onClick={() => void saveAreasFromEditor()}>
              {areasSaveRunning ? 'Saving…' : 'Save areas'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GiveReviewDialog
        open={clientReviewOpen}
        onOpenChange={setClientReviewOpen}
        reviewKind="operator_to_client"
        operatorId={String(operatorId || '').trim()}
        scheduleId={clientReviewJob?.id}
        syncPhotoUrls={clientReviewPhotoUrls}
        title="Rate this client (job)"
      />

      {completionPhotoLightboxUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged photo"
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-4 sm:p-8"
          onClick={() => setCompletionPhotoLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setCompletionPhotoLightboxUrl(null)}
            className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-black/50 text-white shadow-md outline-none hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Close enlarged photo"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={completionPhotoLightboxUrl}
            alt=""
            className="max-h-[min(92vh,1200px)] max-w-full object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  )
}
