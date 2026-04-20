"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  AlertTriangle,
  Pencil,
  ChevronDown,
  Check,
  ChevronsUpDown,
  Sparkles,
  Send,
  RefreshCw,
  HelpCircle,
  Loader2,
  ListFilter,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-context'
import { StatusBadge } from '@/components/shared/status-badge'
import type { TaskStatus } from '@/lib/types'
import {
  fetchOperatorScheduleJobs,
  fetchOperatorTeams,
  fetchOperatorContacts,
  fetchOperatorProperties,
  fetchCleanlemonPricingConfig,
  updateOperatorScheduleJob,
  createOperatorScheduleJob,
  fetchOperatorSettings,
  fetchOperatorScheduleAiSettings,
  saveOperatorScheduleAiSettings,
  fetchOperatorScheduleAiChat,
  postOperatorScheduleAiChat,
  postOperatorScheduleAiSuggest,
  type OperatorScheduleAiPrefs,
  type OperatorRegionGroup,
  type SaasadminAiMdItem,
} from '@/lib/cleanlemon-api'
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

function formatPlatformRuleAddedAt(raw: string | undefined): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      dateStyle: 'medium',
      timeStyle: 'medium',
      hour12: false,
    }).format(d) + ' MYT'
  )
}

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

function schedulePropertyRowKey(job: Pick<Job, 'property' | 'unitNumber' | 'address'>) {
  return `${job.property}-${job.unitNumber || ''}-${job.address}`
}

type AiTeamAssignmentMode = 'prefer_same' | 'rotate_same_property' | 'balanced'

function teamAssignmentModeFromPrefs(p: OperatorScheduleAiPrefs): AiTeamAssignmentMode {
  const m = p.aiScheduleTeamAssignmentMode
  if (m === 'rotate_same_property' || m === 'prefer_same' || m === 'balanced') return m
  if (p.aiScheduleSamePropertyDifferentTeamAlways) return 'rotate_same_property'
  if (p.aiSchedulePreferSameTeamWhenPossible) return 'prefer_same'
  return 'balanced'
}

function withTeamAssignmentMode(p: OperatorScheduleAiPrefs, mode: AiTeamAssignmentMode): OperatorScheduleAiPrefs {
  return {
    ...p,
    aiScheduleTeamAssignmentMode: mode,
    aiSchedulePreferSameTeamWhenPossible: mode === 'prefer_same',
    aiScheduleSamePropertyDifferentTeamAlways: mode === 'rotate_same_property',
  }
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

function ScheduleAiHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 align-middle text-muted-foreground hover:text-foreground"
          aria-label="Help"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-sm leading-snug">
        {children}
      </TooltipContent>
    </Tooltip>
  )
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

function formatScheduleAuditWhen(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const SCHEDULE_TIME_SELECT_EMPTY = '__none__'

function formatPropertyRowLabel(name: string, unitNumber: string): string {
  const apt = (name || '').trim()
  const unit = (unitNumber || '').trim()
  if (apt && unit) return `${apt} · ${unit}`
  if (apt) return apt
  if (unit) return unit
  return '—'
}

function localYmdForOffset(daysFromToday: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + daysFromToday)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
  const operatorId = user?.operatorId || 'op_demo_001'
  const operatorEmail = String(user?.email || '').trim().toLowerCase()
  const [scheduleDay, setScheduleDay] = useState(() => localYmdForOffset(0))
  const [teams, setTeams] = useState<Team[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [scheduleLoading, setScheduleLoading] = useState(true)
  const [propertyRows, setPropertyRows] = useState<
    Array<{
      id: string
      name: string
      unitNumber: string
      label: string
      premisesType?: string
      /** From `cln_property` — used for Create Job estimate priority over operator Pricing. */
      generalCleaning?: number
      cleaningFees?: number
      warmCleaning?: number
      deepCleaning?: number
      renovationCleaning?: number
      /** Saved on property; Areas map uses these to place pins when job coords are missing. */
      wazeUrl?: string
      googleMapsUrl?: string
      /** `cln_property.latitude` / `longitude` (WGS84) when set. */
      latitude?: number | null
      longitude?: number | null
    }>
  >([])
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

  const [opAiConnected, setOpAiConnected] = useState(false)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [aiPrefs, setAiPrefs] = useState<OperatorScheduleAiPrefs>({})
  const [platformRules, setPlatformRules] = useState<SaasadminAiMdItem[]>([])
  const [aiPromptExtra, setAiPromptExtra] = useState('')
  const [aiPinnedJson, setAiPinnedJson] = useState('[]')
  const [aiChatInput, setAiChatInput] = useState('')
  const [aiChatItems, setAiChatItems] = useState<Array<{ id: string; role: string; content: string; createdAt: string }>>(
    []
  )
  const [aiMergeRulesFromChat, setAiMergeRulesFromChat] = useState(false)
  const [aiSettingsLoading, setAiSettingsLoading] = useState(false)
  const [aiLastCronDayYmd, setAiLastCronDayYmd] = useState<string | null>(null)
  const [regionGroups, setRegionGroups] = useState<OperatorRegionGroup[]>([])
  const [areasEditorOpen, setAreasEditorOpen] = useState(false)
  const [aiChatSending, setAiChatSending] = useState(false)
  const [aiSaveSettingsRunning, setAiSaveSettingsRunning] = useState(false)
  const [aiRebalanceLoading, setAiRebalanceLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'team' | 'job' | 'map'>('team')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedClients, setSelectedClients] = useState<string[]>([])
  const [selectedProperties, setSelectedProperties] = useState<string[]>([])
  const [teamFilter, setTeamFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'priority' | 'kpi-high' | 'kpi-low'>('priority')
  const [selectedPropertyKeys, setSelectedPropertyKeys] = useState<string[]>([])
  const [teamEditOpen, setTeamEditOpen] = useState(false)
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [newTaskServiceKey, setNewTaskServiceKey] = useState<ServiceKey>('general')
  const [newTaskPropertyId, setNewTaskPropertyId] = useState('')
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false)
  const [newTaskDate, setNewTaskDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [newTaskTimeStart, setNewTaskTimeStart] = useState('')
  const [newTaskTimeEnd, setNewTaskTimeEnd] = useState('')
  const [newTaskRemark, setNewTaskRemark] = useState('')
  /** Create Job: final RM total (markup); synced from estimate unless operator edits. */
  const [createJobPriceInput, setCreateJobPriceInput] = useState('')
  const [createJobPriceDirty, setCreateJobPriceDirty] = useState(false)
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [statusTargetJob, setStatusTargetJob] = useState<Job | null>(null)
  const [nextStatus, setNextStatus] = useState<'ready-to-clean' | 'in-progress' | 'pending-checkout'>('ready-to-clean')
  /** When status is Extend (in-progress), new cleaning working day (YYYY-MM-DD). */
  const [extendWorkingDayYmd, setExtendWorkingDayYmd] = useState('')
  const [bulkExtendDialogOpen, setBulkExtendDialogOpen] = useState(false)
  const [bulkExtendYmd, setBulkExtendYmd] = useState('')
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [detailTargetJob, setDetailTargetJob] = useState<Job | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const leafletMapRef = useRef<any>(null)
  const jobMapContainerRef = useRef<HTMLDivElement | null>(null)
  const jobLeafletMapRef = useRef<any>(null)
  const areasMapContainerRef = useRef<HTMLDivElement | null>(null)
  const areasLeafletMapRef = useRef<any>(null)

  const aiScheduleDisabledHint =
    'Enable AI under Company settings and add your model API key under API Integration (AI Agent). Then reload this page.'

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await fetchOperatorSettings(operatorId)
      if (cancelled || !r?.ok) return
      const s = (r as { settings?: { ai?: boolean; aiKeyConfigured?: boolean; companyProfile?: Record<string, unknown> } })
        .settings || {}
      setOpAiConnected(!!s.ai && !!s.aiKeyConfigured)
      const cp = s.companyProfile
      setOperatorCompanyHours(
        parseOperatorCompanyHoursFromProfile(cp && typeof cp === 'object' ? cp : null)
      )
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  const loadAiPanel = useCallback(async () => {
    setAiSettingsLoading(true)
    try {
      const [st, ch] = await Promise.all([
        fetchOperatorScheduleAiSettings(operatorId),
        fetchOperatorScheduleAiChat(operatorId, 50),
      ])
      if (st?.ok && st.data) {
        setAiPrefs(st.data.schedulePrefs || {})
        setAiPromptExtra(st.data.promptExtra || '')
        setAiPinnedJson(JSON.stringify(st.data.pinnedConstraints || [], null, 2))
        setAiLastCronDayYmd(st.data.lastScheduleAiCronDayYmd ?? null)
        setRegionGroups(normalizeRegionGroupsClient(st.data.regionGroups))
        setPlatformRules(Array.isArray(st.data.platformRules) ? st.data.platformRules : [])
      } else if (st?.reason === 'CLN_OPERATOR_AI_MIGRATION_REQUIRED') {
        toast.error('Run DB migration 0231_cln_operator_ai.sql, then retry.')
      }
      if (ch?.ok && Array.isArray(ch.items)) setAiChatItems(ch.items)
    } finally {
      setAiSettingsLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    if (!aiSettingsOpen) return
    void loadAiPanel()
  }, [aiSettingsOpen, loadAiPanel])

  const saveAiSettings = async () => {
    let pinned: unknown[] = []
    try {
      pinned = JSON.parse(aiPinnedJson || '[]') as unknown[]
      if (!Array.isArray(pinned)) throw new Error('not array')
    } catch {
      toast.error('Pinned constraints must be valid JSON array')
      return
    }
    setAiSaveSettingsRunning(true)
    try {
      const r = await saveOperatorScheduleAiSettings(operatorId, {
        schedulePrefs: aiPrefs,
        promptExtra: aiPromptExtra,
        pinnedConstraints: pinned,
        regionGroups: normalizeRegionGroupsClient(regionGroups),
      })
      if (!r.ok) {
        toast.error(typeof r.reason === 'string' ? r.reason : 'Save failed')
        return
      }
      toast.success('AI schedule settings saved')
      if (opAiConnected) {
        const sr = await postOperatorScheduleAiSuggest(operatorId, scheduleDay, true)
        if (!sr.ok) {
          toast.error(typeof sr.reason === 'string' ? sr.reason : 'AI suggest failed')
          return
        }
        const n = sr.applied ?? 0
        toast.success(`AI updated ${n} job(s) for ${scheduleDay}`)
        await loadSchedulePage()
      }
    } finally {
      setAiSaveSettingsRunning(false)
    }
  }

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

  const sendAiChat = async () => {
    const msg = aiChatInput.trim()
    if (!msg) return
    setAiChatSending(true)
    try {
      const r = await postOperatorScheduleAiChat(operatorId, msg, aiMergeRulesFromChat)
      setAiChatInput('')
      if (!r.ok) {
        toast.error(typeof r.reason === 'string' ? r.reason : 'Chat failed')
        return
      }
      if (r.pinnedMerged || r.schedulePrefsMerged) {
        const parts = [r.pinnedMerged && 'team/property pins', r.schedulePrefsMerged && 'automation preferences'].filter(
          Boolean
        )
        toast.success(`Updated from chat: ${parts.join(' & ')}`)
      }
      await loadAiPanel()
    } finally {
      setAiChatSending(false)
    }
  }

  const runAiRebalance = async () => {
    if (!opAiConnected) return
    setAiRebalanceLoading(true)
    try {
      const r = await postOperatorScheduleAiSuggest(operatorId, scheduleDay, true, {
        mode: 'rebalance',
        force: true,
      })
      if (!r.ok) {
        toast.error(typeof r.reason === 'string' ? r.reason : 'Rebalance failed')
        return
      }
      if (r.skipped && r.reason === 'PROGRESS_WATCH_DISABLED') {
        toast.error('Rebalance is unavailable (progress watch)')
        return
      }
      if (r.message === 'NO_REBALANCE_TARGETS') {
        toast.message('No rebalance targets for this day (need ready-to-clean jobs with a team).')
        return
      }
      const n = r.applied ?? 0
      const rej = (r.rejected || []).length
      if (n > 0) {
        toast.success(`Rebalance: updated ${n} job(s) for ${scheduleDay}${rej ? ` (${rej} rejected)` : ''}`)
        await loadSchedulePage()
      } else {
        toast.message(
          rej
            ? `Rebalance: no changes applied (${rej} rejected). Check AI settings or team rules.`
            : 'Rebalance: no team changes suggested for this day.'
        )
      }
    } finally {
      setAiRebalanceLoading(false)
    }
  }

  const loadSchedulePage = useCallback(async () => {
    setScheduleLoading(true)
    try {
      const [tj, tt, tc, tp, pc, aiSt] = await Promise.all([
        fetchOperatorScheduleJobs({ operatorId, limit: 800 }),
        fetchOperatorTeams(operatorId),
        fetchOperatorContacts(operatorId),
        fetchOperatorProperties(operatorId),
        fetchCleanlemonPricingConfig(operatorId),
        fetchOperatorScheduleAiSettings(operatorId),
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
    } finally {
      setScheduleLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    void loadSchedulePage()
  }, [loadSchedulePage])

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

  useEffect(() => {
    setNewTaskTimeStart('')
    setNewTaskTimeEnd('')
  }, [newTaskServiceKey, scheduleTimeStepMinutes, scheduleDayBounds])

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
        const color = meta?.color || '#64748b'
        const areaName = meta?.name || 'Unassigned'
        const selected = group.jobs.some((job) => selectedPropertyKeys.includes(schedulePropertyRowKey(job)))

        const marker = L.circleMarker([group.lat, group.lng], {
          radius: selected ? 11 : 9,
          color,
          fillColor: color,
          fillOpacity: selected ? 0.92 : 0.55,
          weight: selected ? 3 : 2,
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
        const color = meta?.color || '#64748b'
        const areaName = meta?.name || 'Unassigned'
        bounds.push([group.lat, group.lng])

        const marker = L.circleMarker([group.lat, group.lng], {
          radius: selected ? 12 : 9,
          color,
          fillColor: color,
          fillOpacity: selected ? 0.95 : 0.52,
          weight: selected ? 4 : 2,
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

  const runJobAction = (label: string, job: Job) => {
    toast.success(`${label}: ${job.property}`)
  }

  const openStatusDialog = (job: Job) => {
    setStatusTargetJob(job)
    setNextStatus('ready-to-clean')
    const d = String(job.date || '').slice(0, 10)
    setExtendWorkingDayYmd(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : scheduleDay)
    setStatusDialogOpen(true)
  }

  const submitStatusUpdate = async () => {
    if (!statusTargetJob) return
    if (nextStatus === 'in-progress') {
      const wd = String(extendWorkingDayYmd || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) {
        toast.error('Choose a valid extend / new working day')
        return
      }
    }
    const res = await updateOperatorScheduleJob(statusTargetJob.id, {
      status: nextStatus,
      operatorId,
      ...(nextStatus === 'in-progress'
        ? { workingDay: String(extendWorkingDayYmd || '').slice(0, 10) }
        : {}),
      ...(nextStatus === 'ready-to-clean' && operatorEmail ? { statusSetByEmail: operatorEmail } : {}),
    })
    if (!res.ok) {
      toast.error(typeof res.reason === 'string' ? res.reason : 'Status update failed')
      return
    }
    await loadSchedulePage()
    toast.success(`Status updated for ${statusTargetJob.property}`)
    setStatusDialogOpen(false)
    setStatusTargetJob(null)
  }

  const openDetailDialog = (job: Job) => {
    setDetailTargetJob(job)
    setDetailDialogOpen(true)
  }

  const openCreateJobDialog = () => {
    setNewTaskServiceKey((prev) => {
      const opts = scheduleServiceOptions
      if (opts.some((o) => o.key === prev)) return prev
      return opts[0]?.key ?? 'general'
    })
    setNewTaskOpen(true)
  }

  const createTask = async () => {
    if (!newTaskPropertyId) {
      toast.error('Please select property')
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

    const res = await createOperatorScheduleJob({
      operatorId,
      propertyId: newTaskPropertyId,
      date: newTaskDate,
      serviceProvider: serviceKeyToScheduleServiceProvider(newTaskServiceKey),
      status: 'ready-to-clean',
      source: 'operator_portal',
      price: finalCharge,
      remarks: requiresTime
        ? `${newTaskTimeStart} - ${newTaskTimeEnd} ${newTaskRemark}`.trim()
        : newTaskRemark,
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
      {scheduleLoading && (
        <p className="text-sm text-muted-foreground">Loading schedules from database…</p>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Schedule</h2>
          <p className="text-muted-foreground">Team list, job list, and map assignment workflow</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {opAiConnected ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="gap-1.5">
                  Action
                  <ChevronDown className="h-4 w-4 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  className="gap-2"
                  onClick={() => setAiSettingsOpen(true)}
                >
                  <Sparkles className="h-4 w-4 shrink-0" />
                  AI Setting
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  disabled={aiRebalanceLoading}
                  onClick={() => void runAiRebalance()}
                >
                  <RefreshCw className={cn('h-4 w-4 shrink-0', aiRebalanceLoading && 'animate-spin')} />
                  Rebalance
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button type="button" variant="outline" disabled className="gap-1.5">
                    Action
                    <ChevronDown className="h-4 w-4 opacity-70" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-balance">
                {aiScheduleDisabledHint}
              </TooltipContent>
            </Tooltip>
          )}
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
                    variant={scheduleDay === localYmdForOffset(0) ? 'default' : 'outline'}
                    className="w-full px-2.5 sm:w-auto sm:px-3"
                    onClick={() => setScheduleDay(localYmdForOffset(0))}
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={scheduleDay === localYmdForOffset(1) ? 'default' : 'outline'}
                    className="w-full px-2.5 sm:w-auto sm:px-3"
                    onClick={() => setScheduleDay(localYmdForOffset(1))}
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
                      <SelectItem value="pending-checkout">Pending checkout</SelectItem>
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

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'team' | 'job' | 'map')}>
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
            <div className="flex items-center gap-2">
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
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="text-xs text-muted-foreground">{selectedPropertyKeys.length} row(s) selected</span>
            </div>
            <Card>
              <CardContent className="p-0">
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[36px]">
                          <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleSelectAllProperties(Boolean(checked))} />
                        </TableHead>
                        <TableHead>Property</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[80px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {propertyGroups.map((group) => (
                        <TableRow key={`${group.property}-${group.unitNumber || ''}-${group.address}`} className={group.unassignedCount > 0 ? 'bg-amber-50/40' : undefined}>
                          <TableCell className="py-2">
                            <Checkbox
                              checked={selectedPropertyKeys.includes(`${group.property}-${group.unitNumber || ''}-${group.address}`)}
                              onCheckedChange={(checked) => togglePropertySelection(`${group.property}-${group.unitNumber || ''}-${group.address}`, Boolean(checked))}
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
                            {group.teamNames.length > 0 ? group.teamNames.join(', ') : 'Unassigned'}
                            {group.unassignedCount > 0 && <Badge className="ml-2 bg-amber-500">+{group.unassignedCount}</Badge>}
                          </TableCell>
                          <TableCell className="py-2">
                            <StatusBadge status={group.jobs[0]?.status || 'ready-to-clean'} size="sm" />
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => openStatusDialog(group.jobs[0])}>
                                Update Status
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost">
                                    Action
                                    <ChevronDown className="ml-1 h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openStatusDialog(group.jobs[0])}>
                                    Update Status
                                  </DropdownMenuItem>
                                  {group.jobs.some((job) => job.status === 'completed') && (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        openDetailDialog(group.jobs.find((job) => job.status === 'completed') || group.jobs[0])
                                      }
                                    >
                                      View Detail
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                              {group.jobs.some((job) => job.status === 'completed') && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openDetailDialog(group.jobs.find((job) => job.status === 'completed') || group.jobs[0])}
                                >
                                  View Detail
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="md:hidden space-y-3 p-3">
                  {propertyGroups.map((group) => {
                    const rowKey = `${group.property}-${group.unitNumber || ''}-${group.address}`
                    return (
                      <div
                        key={rowKey}
                        className={cn(
                          'rounded-lg border border-border bg-background p-4 space-y-3',
                          group.unassignedCount > 0 && 'bg-amber-50/40'
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
                              <p className="mt-0.5 text-sm">
                                {group.teamNames.length > 0 ? group.teamNames.join(', ') : 'Unassigned'}
                                {group.unassignedCount > 0 ? (
                                  <Badge className="ml-2 align-middle bg-amber-500">+{group.unassignedCount}</Badge>
                                ) : null}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Status</p>
                              <div className="mt-1">
                                <StatusBadge status={group.jobs[0]?.status || 'ready-to-clean'} size="sm" />
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
                          <Button size="sm" variant="outline" className="w-full" onClick={() => openStatusDialog(group.jobs[0])}>
                            Update Status
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="secondary" className="w-full">
                                Action
                                <ChevronDown className="ml-1 h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="center" className="w-[min(100vw-2rem,280px)]">
                              <DropdownMenuItem onClick={() => openStatusDialog(group.jobs[0])}>
                                Update Status
                              </DropdownMenuItem>
                              {group.jobs.some((job) => job.status === 'completed') && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    openDetailDialog(group.jobs.find((job) => job.status === 'completed') || group.jobs[0])
                                  }
                                >
                                  View Detail
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {group.jobs.some((job) => job.status === 'completed') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="w-full"
                              onClick={() => openDetailDialog(group.jobs.find((job) => job.status === 'completed') || group.jobs[0])}
                            >
                              View Detail
                            </Button>
                          )}
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
                <CardDescription>
                  Points are colored by Area (AI schedule settings). Hover for jobs; selected rows from the Job tab show
                  stronger markers.
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
              return (
              <label key={job.id} className="flex items-start gap-3 rounded-md border p-3">
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
            setPropertyPickerOpen(false)
            setCreateJobAddonDraft({})
            setNewTaskTimeStart('')
            setNewTaskTimeEnd('')
            setCreateJobPriceInput('')
            setCreateJobPriceDirty(false)
          } else {
            setCreateJobPriceDirty(false)
          }
        }}
      >
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Job</DialogTitle>
            <DialogDescription>
              Create a schedule job. Unassigned jobs are prioritized at the top in Job List view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select services</Label>
              <Select
                value={newTaskServiceKey}
                onValueChange={(value: ServiceKey) => setNewTaskServiceKey(value)}
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
                                disabled={!selected}
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
              <Label>Select property</Label>
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
            <div className="space-y-2">
              <Label>Select date</Label>
              <Input type="date" value={newTaskDate} onChange={(e) => setNewTaskDate(e.target.value)} />
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
                          For AI scheduling rules, open the <span className="text-foreground font-medium">AI schedule</span>{' '}
                          dialog (toolbar on this page).
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
                      disabled={!newTaskTimeStart}
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
              <Textarea value={newTaskRemark} onChange={(e) => setNewTaskRemark(e.target.value)} placeholder="Optional operator notes" rows={3} />
            </div>
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
                <p>
                  <span className="text-muted-foreground">Property</span>{' '}
                  {propertyRows.find((p) => p.id === newTaskPropertyId)?.label || '—'}
                </p>
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
                    Total charge (editable — markup OK)
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
                      className="h-12 min-w-0 flex-1 text-2xl font-bold tabular-nums tracking-tight"
                    />
                  </div>
                  {createJobIndicativeGrandTotal != null ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2">
                      <p className="text-xs text-muted-foreground">
                        Pricing estimate: RM {createJobIndicativeGrandTotal.toLocaleString('en-MY')}
                      </p>
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
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTaskOpen(false)}>Cancel</Button>
            <Button
              onClick={createTask}
              disabled={
                scheduleServiceOptions.length === 0 || (createJobMinSelling > 0 && !createJobMeetsMinimum)
              }
            >
              Create Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update Status</DialogTitle>
            <DialogDescription>
              {statusTargetJob ? `Update status for ${statusTargetJob.property}` : 'Update job status'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Select status</Label>
            <Select
              value={nextStatus}
              onValueChange={(value: 'ready-to-clean' | 'in-progress' | 'pending-checkout') => {
                setNextStatus(value)
                if (value === 'in-progress' && statusTargetJob) {
                  const d = String(statusTargetJob.date || '').slice(0, 10)
                  setExtendWorkingDayYmd(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : scheduleDay)
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ready-to-clean">Ready to Clean</SelectItem>
                <SelectItem value="in-progress">Extend</SelectItem>
                <SelectItem value="pending-checkout">Customer Missing</SelectItem>
              </SelectContent>
            </Select>
            {nextStatus === 'in-progress' ? (
              <div className="space-y-2 pt-2">
                <Label htmlFor="extend-working-day">New working day (extended checkout)</Label>
                <Input
                  id="extend-working-day"
                  type="date"
                  value={extendWorkingDayYmd}
                  onChange={(e) => setExtendWorkingDayYmd(e.target.value)}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitStatusUpdate}>Save</Button>
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

      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Job detail</DialogTitle>
            <DialogDescription>
              {detailTargetJob ? `${detailTargetJob.property} — staff completion & audit` : 'Job detail'}
            </DialogDescription>
          </DialogHeader>
          {detailTargetJob && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground mb-2">Audit</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <p className="text-muted-foreground">Created by</p>
                    <p className="font-medium break-all">{detailTargetJob.createdByEmail || '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Ready to clean by</p>
                    <p className="font-medium break-all">{detailTargetJob.readyToCleanByEmail || '—'}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-muted-foreground">First ready-to-clean at</p>
                    <p className="font-medium">{formatScheduleAuditWhen(detailTargetJob.readyToCleanAt)}</p>
                  </div>
                </div>
              </div>
              {Array.isArray(detailTargetJob.pricingAddons) && detailTargetJob.pricingAddons.length > 0 ? (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Pricing add-ons (job)</p>
                  <ul className="space-y-1 text-sm rounded-md border p-3">
                    {detailTargetJob.pricingAddons.map((a, i) => (
                      <li key={`${a.name}-${i}`} className="flex justify-between gap-2">
                        <span className="min-w-0">
                          {a.name}
                          <span className="text-muted-foreground">
                            {' '}
                            ×{a.quantity} @ RM {Number(a.price).toLocaleString('en-MY')}
                          </span>
                        </span>
                        {a.subtotal != null ? (
                          <span className="shrink-0 font-medium tabular-nums">
                            RM {Number(a.subtotal).toLocaleString('en-MY')}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Staff Start Time</p>
                  <p className="font-medium">{detailTargetJob.staffStartTime || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Staff End Time</p>
                  <p className="font-medium">{detailTargetJob.staffEndTime || '-'}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Staff Remark</p>
                <p className="text-sm">{detailTargetJob.staffRemark || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Complete Photo</p>
                <div className="grid grid-cols-2 gap-3">
                  {(detailTargetJob.completedPhotos || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No completed photo uploaded.</p>
                  ) : (
                    (detailTargetJob.completedPhotos || []).map((url) => (
                      <img key={url} src={url} alt="Completed photo" className="w-full h-40 rounded-md border object-cover" />
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aiSettingsOpen} onOpenChange={setAiSettingsOpen}>
        <DialogContent className="max-h-[90vh] w-full max-w-5xl overflow-y-auto p-4 md:p-6">
          <DialogHeader>
            <DialogTitle>Operator AI — schedule &amp; rules</DialogTitle>
            <DialogDescription className="text-sm">
              Same layout as SaaS Admin → AI rules: <strong>platform rules</strong> apply to every operator first; then
              your own automation and chat (uses your API key from{' '}
              <span className="font-medium">Company → Connect AI</span>) only change{' '}
              <strong>this operator&apos;s</strong> schedules — never another company&apos;s data.
            </DialogDescription>
          </DialogHeader>
          {aiSettingsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>AI chat</CardTitle>
                  <CardDescription>
                    Ask for scheduling rules, team pins, or automation (e.g. preferred run time in{' '}
                    <code className="text-xs">schedulePrefs</code>). Turn on merge below so the assistant can write into
                    your saved pins and automation fields.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={aiMergeRulesFromChat}
                      onCheckedChange={(c) => setAiMergeRulesFromChat(Boolean(c))}
                    />
                    Apply AI suggestions from chat (team/property pins + automation preferences, experimental)
                  </label>
                  <ScrollArea className="h-[320px] rounded-md border p-3">
                    <div className="space-y-3 pr-3 text-sm">
                      {aiChatItems.length === 0 && (
                        <p className="text-muted-foreground">
                          Example: “Set daily auto-assign horizon to 3 days and prefer same team when possible.” With merge
                          on, the assistant can end with <code className="text-xs">EXTRACT_JSON:</code> to save pins or
                          preferences.
                        </p>
                      )}
                      {aiChatItems.map((m) => (
                        <div
                          key={m.id}
                          className={
                            m.role === 'user' ? 'rounded-md bg-muted/60 p-2' : 'rounded-md border bg-background p-2'
                          }
                        >
                          <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">{m.role}</div>
                          <div className="whitespace-pre-wrap break-words">{m.content}</div>
                        </div>
                      ))}
                      {aiChatSending && (
                        <div className="text-muted-foreground flex items-center gap-2 text-xs">
                          <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Message…"
                      value={aiChatInput}
                      onChange={(e) => setAiChatInput(e.target.value)}
                      className="min-h-[80px] flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void sendAiChat()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      onClick={() => void sendAiChat()}
                      disabled={aiChatSending || !aiChatInput.trim()}
                    >
                      {aiChatSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Platform rules (read-only)</CardTitle>
                  <CardDescription>
                    Managed in Admin → AI rules. The scheduling model always receives these before your operator
                    settings.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {platformRules.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No platform rules yet — SaaS Admin can add them.</p>
                  ) : (
                    <ul className="space-y-4">
                      {platformRules.map((row) => (
                        <li key={row.id} className="rounded-lg border p-4">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary" className="font-mono text-xs">
                                {row.ruleCode || '—'}
                              </Badge>
                              <span className="font-medium">{row.title}</span>
                            </div>
                            <div className="text-muted-foreground text-xs">
                              Added (Malaysia): {formatPlatformRuleAddedAt(row.createdAt)}
                            </div>
                            <div className="text-muted-foreground whitespace-pre-wrap text-sm">{row.bodyMd || '—'}</div>
                            <div className="text-muted-foreground text-xs">order: {row.sortOrder}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Your operator automation &amp; model</CardTitle>
                  <CardDescription>
                    Manual controls for the same data the chat can adjust. Save runs assign for the working day selected
                    on the schedule toolbar when AI is connected.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                <div className="space-y-2 rounded-md border p-3">
                  <Label className="text-xs text-muted-foreground">Automation</Label>
                  <div className="space-y-3">
                    {(
                      [
                        [
                          'aiScheduleCronEnabled',
                          'Daily auto-assign (UTC+8 00:00)',
                          <>
                            Runs at <strong>midnight UTC+8</strong> to assign teams for empty slots across the number of
                            calendar days below. Server needs{' '}
                            <code className="text-[10px]">CLEANLEMON_SCHEDULE_AI_MIDNIGHT_POLL_MINUTES</code> or cron{' '}
                            <code className="text-[10px]">POST /api/internal/cleanlemon-schedule-ai-midnight</code> with{' '}
                            <code className="text-[10px]">X-Internal-Secret</code>.
                          </>,
                        ],
                        [
                          'aiScheduleOnJobCreate',
                          'Also run when creating a job',
                          <>If the new job’s day is <strong>today</strong> (UTC+8), run assign once for that day.</>,
                        ],
                        [
                          'aiScheduleRebalanceOnTaskComplete',
                          'Rebalance after staff completes (group-end)',
                          <>
                            When staff finish jobs via group-end, optionally <strong>re-run</strong> reassignment for{' '}
                            <strong>today</strong> (UTC+8) if the board still has movable jobs.
                          </>,
                        ],
                        [
                          'aiScheduleProgressWatchEnabled',
                          'Fair to all team',
                          <>
                            The server can <strong>every so often</strong> ask AI to lightly re-check who should cover
                            which <strong>still-open</strong> jobs today (see{' '}
                            <code className="text-[10px]">CLEANLEMON_SCHEDULE_AI_REBALANCE_TIMER_MINUTES</code> on the
                            API). <strong>Finished / cancelled jobs stay on the same team</strong> — only work that is
                            not done yet can move.
                          </>,
                        ],
                      ] as const
                    ).map(([k, label, hint]) => (
                      <label key={k} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          className="mt-0.5"
                          checked={!!aiPrefs[k]}
                          onCheckedChange={(c) => setAiPrefs((p) => ({ ...p, [k]: Boolean(c) }))}
                        />
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                          {label}
                          <ScheduleAiHint>{hint}</ScheduleAiHint>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="ai-team-mode">Team routing</Label>
                    <ScheduleAiHint>
                      How the model should prefer teams when multiple jobs exist: keep one team on nearby work, rotate
                      teams when the same property has repeat visits, or aim for a fair split across teams.
                    </ScheduleAiHint>
                  </div>
                  <Select
                    value={teamAssignmentModeFromPrefs(aiPrefs)}
                    onValueChange={(v) =>
                      setAiPrefs((p) => withTeamAssignmentMode(p, v as AiTeamAssignmentMode))
                    }
                  >
                    <SelectTrigger id="ai-team-mode" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prefer_same">Prefer same team when possible</SelectItem>
                      <SelectItem value="rotate_same_property">Rotate teams for same property</SelectItem>
                      <SelectItem value="balanced">Fair to all teams</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="ai-horizon">Daily arrange jobs — days ahead (1–7)</Label>
                    <ScheduleAiHint>
                      When the nightly job runs (UTC+8 midnight), how many consecutive <strong>calendar days</strong> to
                      fill: day 1 is the anchor day, plus the next N−1 days. Example: <strong>3</strong> = today + 2 more
                      days.
                    </ScheduleAiHint>
                  </div>
                  <Input
                    id="ai-horizon"
                    type="number"
                    min={1}
                    max={7}
                    className="h-9 w-[8rem]"
                    value={Math.min(7, Math.max(1, Math.floor(Number(aiPrefs.aiSchedulePlanningHorizonDays) || 1)))}
                    onChange={(e) => {
                      const n = Math.min(7, Math.max(1, Math.floor(Number(e.target.value) || 1)))
                      setAiPrefs((p) => ({ ...p, aiSchedulePlanningHorizonDays: n }))
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Last successful nightly run (UTC+8 anchor date):{' '}
                    <span className="font-mono text-foreground">{aiLastCronDayYmd || '—'}</span>
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="ai-max-team">Max jobs per team / day</Label>
                    <ScheduleAiHint>Soft cap sent to the model so it does not overload a single team.</ScheduleAiHint>
                  </div>
                  <Input
                    id="ai-max-team"
                    type="number"
                    min={1}
                    className="h-9 w-[8rem]"
                    value={aiPrefs.maxJobsPerTeamPerDay ?? 15}
                    onChange={(e) =>
                      setAiPrefs((p) => ({
                        ...p,
                        maxJobsPerTeamPerDay: Math.max(1, Math.floor(Number(e.target.value) || 15)),
                      }))
                    }
                  />
                </div>
                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm">Buffers & homestay window</Label>
                    <ScheduleAiHint>
                      Sent to the model: minimum gap between consecutive jobs on the same team — shorter when staying at
                      the same property, longer when driving to another. Homestay jobs use a service window (UTC+8);
                      pending-checkout still gets a team in the plan; cleaning starts only after ready-to-clean.
                    </ScheduleAiHint>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="ai-buffer-same" className="text-xs">
                          Same property (min)
                        </Label>
                        <ScheduleAiHint>Handover gap when the next job is at the same property.</ScheduleAiHint>
                      </div>
                      <Input
                        id="ai-buffer-same"
                        type="number"
                        min={0}
                        max={240}
                        className="h-9"
                        value={Math.min(
                          240,
                          Math.max(
                            0,
                            Math.floor(
                              Number(aiPrefs.aiScheduleMinBufferMinutesSameLocation) ||
                                Number(aiPrefs.aiScheduleMinBufferMinutesBetweenJobs) ||
                                15
                            ) || 0
                          )
                        )}
                        onChange={(e) =>
                          setAiPrefs((p) => ({
                            ...p,
                            aiScheduleMinBufferMinutesSameLocation: Math.min(
                              240,
                              Math.max(0, Math.floor(Number(e.target.value) || 0))
                            ),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="ai-buffer-diff" className="text-xs">
                          Different property (min)
                        </Label>
                        <ScheduleAiHint>Travel + parking gap when the next job is at another property.</ScheduleAiHint>
                      </div>
                      <Input
                        id="ai-buffer-diff"
                        type="number"
                        min={0}
                        max={240}
                        className="h-9"
                        value={Math.min(
                          240,
                          Math.max(
                            0,
                            Math.floor(
                              Number(aiPrefs.aiScheduleMinBufferMinutesDifferentLocation) ||
                                Number(aiPrefs.aiScheduleMinBufferMinutesBetweenJobs) ||
                                30
                            ) || 0
                          )
                        )}
                        onChange={(e) =>
                          setAiPrefs((p) => ({
                            ...p,
                            aiScheduleMinBufferMinutesDifferentLocation: Math.min(
                              240,
                              Math.max(0, Math.floor(Number(e.target.value) || 0))
                            ),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="ai-hs-start" className="text-xs">
                        Homestay window from (UTC+8)
                      </Label>
                      <Input
                        id="ai-hs-start"
                        type="time"
                        className="h-9"
                        value={
                          (aiPrefs.aiScheduleHomestayWindowStartLocal || '11:00').slice(0, 5) || '11:00'
                        }
                        onChange={(e) =>
                          setAiPrefs((p) => ({ ...p, aiScheduleHomestayWindowStartLocal: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="ai-hs-end" className="text-xs">
                        Homestay window to (UTC+8)
                      </Label>
                      <Input
                        id="ai-hs-end"
                        type="time"
                        className="h-9"
                        value={(aiPrefs.aiScheduleHomestayWindowEndLocal || '16:00').slice(0, 5) || '16:00'}
                        onChange={(e) =>
                          setAiPrefs((p) => ({ ...p, aiScheduleHomestayWindowEndLocal: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">Areas</span>
                    <ScheduleAiHint>
                      Group properties into zones for map colors and for the model to split teams by area. Each property
                      belongs to at most one area.
                    </ScheduleAiHint>
                    <span className="text-xs text-muted-foreground">({regionGroups.length} configured)</span>
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setAreasEditorOpen(true)}>
                    Edit areas &amp; map
                  </Button>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="ai-prompt-extra">Extra prompt for this model</Label>
                    <ScheduleAiHint>
                      Optional text appended to the scheduling model (rules, exceptions, priorities). Stored with this
                      operator&apos;s AI settings.
                    </ScheduleAiHint>
                  </div>
                  <Textarea
                    id="ai-prompt-extra"
                    rows={3}
                    value={aiPromptExtra}
                    onChange={(e) => setAiPromptExtra(e.target.value)}
                    placeholder="e.g. Team A rests on Sunday…"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Pinned constraints</Label>
                  <p className="text-xs text-muted-foreground">Read-only. Shown for your reference; editing is disabled.</p>
                  <div className="max-h-36 overflow-auto rounded-md border bg-muted/30 p-3">
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(aiPinnedJson || '[]'), null, 2)
                        } catch {
                          return aiPinnedJson || '[]'
                        }
                      })()}
                    </pre>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  <strong>Save settings</strong> stores preferences and, when AI is connected, assigns teams for{' '}
                  <span className="font-medium text-foreground">{scheduleDay}</span> — the day selected on the schedule
                  toolbar above (not only midnight cron).
                </p>
                <Button type="button" disabled={aiSaveSettingsRunning} onClick={() => void saveAiSettings()}>
                  {aiSaveSettingsRunning ? 'Saving…' : 'Save settings'}
                </Button>
                </CardContent>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAiSettingsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAreasEditorOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
