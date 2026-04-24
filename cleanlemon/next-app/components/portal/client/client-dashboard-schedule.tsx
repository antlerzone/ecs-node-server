"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import {
  fetchClientPortalProperties,
  fetchClientPropertyGroups,
  fetchClientPropertyGroupDetail,
  fetchClientScheduleJobs,
  updateClientScheduleJob,
  deleteClientScheduleJob,
} from '@/lib/cleanlemon-api'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Clock, Download, Eye, Loader2, MessageSquare, X } from 'lucide-react'
import { GiveReviewDialog } from '@/components/cleanlemons/give-review-dialog'
import { addDaysToMalaysiaYmd, getMalaysiaCalendarYmd } from '@/lib/cleanlemon-booking-eligibility'
import { StatusBadge } from '@/components/shared/status-badge'
import { normalizeDamageAttachmentUrl } from '@/lib/media-url-kind'
import type { TaskStatus } from '@/lib/types'

type ScheduleItem = {
  id: string
  propertyId?: string
  operatorId?: string
  property: string
  unit: string
  cleaningType: string
  time: string
  /** Same as operator schedule API (`normalizeScheduleStatus`). */
  normalizedStatus: TaskStatus
  /** Raw `cln_schedule.status` — distinguish Customer Missing vs pending-checkout. */
  statusRaw?: string
  date: string
  team?: string
  /** Completion photo URLs (same as operator schedule). */
  completedPhotos?: string[]
  /** Same-day checkout + check-in — operator priority flag */
  btob?: boolean
}

type DayMode = 'today' | 'tomorrow' | 'custom'

type SortKey = 'date' | 'property' | 'unit' | 'service' | 'time' | 'status'

/** Align with backend `normalizeScheduleStatus` for dropdown value + API. */
function canonicalClientScheduleStatus(s: string) {
  const raw = String(s ?? '').trim()
  if (raw === '') return 'pending-checkout'
  const x = raw.toLowerCase().replace(/\s+/g, '-')
  if (x.includes('complete') || x === 'done') return 'completed'
  if (x.includes('progress')) return 'in-progress'
  if (x.includes('cancel')) return 'cancelled'
  if (
    x.includes('checkout') ||
    x.includes('check-out') ||
    x === 'pending-checkout' ||
    x === 'pending-check-out'
  ) {
    return 'pending-checkout'
  }
  if (x.includes('customer') && x.includes('missing')) return 'pending-checkout'
  if (x.includes('ready') && x.includes('clean')) return 'ready-to-clean'
  return 'pending-checkout'
}

/** Match operator `jobRowStatusSelectValue` — Customer Missing vs pending-checkout. */
function clientJobRowStatusSelectValue(job: ScheduleItem | undefined): string {
  if (!job) return 'pending-checkout'
  const raw = String(job.statusRaw || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
  if (job.normalizedStatus === 'pending-checkout') {
    if (raw.includes('customer') && raw.includes('missing')) return 'customer-missing'
    return 'pending-checkout'
  }
  return job.normalizedStatus
}

function mapClientStatusKeyToApi(key: string): string {
  if (key === 'customer-missing') return 'Customer Missing'
  return key
}

/** Values allowed in the quick `<select>` (must match `<option value>`). */
const CLIENT_SCHEDULE_SELECT_VALUES = new Set([
  'pending-checkout',
  'ready-to-clean',
  'in-progress',
  'customer-missing',
  'completed',
])

function safeClientScheduleStatusSelectValue(job: ScheduleItem): string {
  const v = clientJobRowStatusSelectValue(job)
  return CLIENT_SCHEDULE_SELECT_VALUES.has(v) ? v : 'pending-checkout'
}

/** Action = View detail (completed) / Reschedule (other active). Hidden for pending checkout & ready to clean. */
function clientScheduleShowActionMenu(item: ScheduleItem): boolean {
  if (item.normalizedStatus === 'completed' || item.normalizedStatus === 'cancelled') return true
  const sel = safeClientScheduleStatusSelectValue(item)
  if (sel === 'pending-checkout' || sel === 'ready-to-clean') return false
  return true
}

function isClientScheduleStatusDropdownLocked(item: ScheduleItem): boolean {
  if (item.normalizedStatus === 'cancelled') return true
  if (item.normalizedStatus === 'completed') return true
  return safeClientScheduleStatusSelectValue(item) === 'completed'
}

/** Plain HTML select (same options as operator `ScheduleJobQuickStatusSelect`). */
function ClientScheduleJobQuickStatusSelect({
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

function clientStatusBadge(task: ScheduleItem) {
  const sel = clientJobRowStatusSelectValue(task)
  if (sel === 'customer-missing') {
    return (
      <Badge variant="outline" className="border-red-300 bg-red-50 text-xs font-medium text-red-700">
        Customer missing
      </Badge>
    )
  }
  const st = task.normalizedStatus
  if (
    st === 'pending-checkout' ||
    st === 'ready-to-clean' ||
    st === 'in-progress' ||
    st === 'completed' ||
    st === 'cancelled'
  ) {
    return <StatusBadge status={st} size="sm" />
  }
  return <StatusBadge status="pending-checkout" size="sm" />
}

function formatDisplayDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function ymdInRange(ymd: string, from: string, to: string): boolean {
  const d = String(ymd || '').slice(0, 10)
  return d >= from && d <= to
}

function fileExtForCompletionPhoto(url: string, contentType: string | null): string {
  try {
    const u = new URL(url)
    const path = u.pathname
    const m = /\.([a-zA-Z0-9]{1,8})$/.exec(path)
    if (m && !/^(html?|php|asp|jsp)$/i.test(m[1])) {
      return `.${m[1].toLowerCase()}`
    }
  } catch {
    /* relative URL */
    const m = /\.([a-zA-Z0-9]{1,8})(?:\?|$)/.exec(url)
    if (m && !/^(html?|php)$/i.test(m[1])) return `.${m[1].toLowerCase()}`
  }
  const ct = String(contentType || '').toLowerCase()
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg'
  if (ct.includes('png')) return '.png'
  if (ct.includes('webp')) return '.webp'
  if (ct.includes('gif')) return '.gif'
  if (ct.includes('heic')) return '.heic'
  return '.jpg'
}

export function ClientDashboardSchedule() {
  const { user } = useAuth()
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])
  const [properties, setProperties] = useState<
    Array<{ id: string; name: string; unitNumber?: string; operatorId?: string }>
  >([])
  const [propertyGroups, setPropertyGroups] = useState<Array<{ id: string; name: string }>>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [groupPropertyIds, setGroupPropertyIds] = useState<Set<string>>(new Set())
  const [scheduleRefreshTick, setScheduleRefreshTick] = useState(0)
  const [dayMode, setDayMode] = useState<DayMode>('today')
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [rescheduleTarget, setRescheduleTarget] = useState<ScheduleItem | null>(null)
  const [rescheduleYmd, setRescheduleYmd] = useState('')
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false)
  const [extendDeleteOpen, setExtendDeleteOpen] = useState(false)
  const [extendDeleteTarget, setExtendDeleteTarget] = useState<ScheduleItem | null>(null)
  const [extendDeleteSubmitting, setExtendDeleteSubmitting] = useState(false)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)
  const [btobUpdatingId, setBtobUpdatingId] = useState<string | null>(null)
  const [jobDetailOpen, setJobDetailOpen] = useState(false)
  const [jobDetailItem, setJobDetailItem] = useState<ScheduleItem | null>(null)
  const [jobDetailPhotoUrls, setJobDetailPhotoUrls] = useState<string[]>([])
  const [completionZipDownloading, setCompletionZipDownloading] = useState(false)
  const [completionPhotoLightboxUrl, setCompletionPhotoLightboxUrl] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<ScheduleItem | null>(null)

  const todayYmd = useMemo(() => getMalaysiaCalendarYmd(), [])
  const tomorrowYmd = useMemo(() => addDaysToMalaysiaYmd(todayYmd, 1), [todayYmd])

  useEffect(() => {
    if (!completionPhotoLightboxUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCompletionPhotoLightboxUrl(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [completionPhotoLightboxUrl])

  const displayProperties = useMemo(() => {
    if (!selectedGroupId) return properties
    if (groupPropertyIds.size === 0) return []
    return properties.filter((p) => groupPropertyIds.has(p.id))
  }, [properties, selectedGroupId, groupPropertyIds])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const email = String(user?.email || '').trim().toLowerCase()
      const operatorId = String(user?.operatorId || '').trim()
      if (!email) {
        setProperties([])
        setSchedules([])
        return
      }
      const [propRes, jobRes, grpRes] = await Promise.all([
        fetchClientPortalProperties(email, operatorId),
        fetchClientScheduleJobs(email, operatorId, {
          limit: 500,
          groupId: selectedGroupId || undefined,
        }),
        fetchClientPropertyGroups(email, operatorId),
      ])
      if (cancelled) return
      const propItems = Array.isArray(propRes?.items) ? propRes.items : []
      setProperties(
        propItems.map((p: { id?: string; name?: string; unitNumber?: string; operatorId?: string }) => ({
          id: String(p.id || ''),
          name: String(p.name || 'Property'),
          unitNumber: String(p.unitNumber || ''),
          operatorId: String(p.operatorId || operatorId || ''),
        }))
      )
      const jobs = Array.isArray(jobRes?.items) ? jobRes.items : []
      const mapped: ScheduleItem[] = jobs.map((j: Record<string, unknown>) => {
        const rawStatus = String(j.status ?? '').trim()
        const normalizedStatus = canonicalClientScheduleStatus(rawStatus) as TaskStatus
        const photos = Array.isArray(j.completedPhotos)
          ? (j.completedPhotos as unknown[])
              .map((u) => String(u || '').trim())
              .filter(Boolean)
          : []
        const sr = j.statusRaw
        return {
          id: String(j.id || ''),
          propertyId: String(j.propertyId || ''),
          operatorId: String(j.clnOperatorId || j.operatorId || ''),
          property: String(j.property || ''),
          unit: String(j.unit || j.unitNumber || ''),
          cleaningType: String(j.cleaningType || 'General Cleaning'),
          time: String(j.time || ''),
          normalizedStatus,
          statusRaw: sr != null && String(sr).trim() !== '' ? String(sr).trim() : undefined,
          completedPhotos: photos,
          date: String(j.date || j.workingDay || new Date().toISOString()).slice(0, 10),
          team: String(j.team || j.teamName || ''),
          btob: Boolean(j.btob),
        }
      })
      setSchedules(mapped)
      if (grpRes?.ok && Array.isArray(grpRes.items)) {
        setPropertyGroups(grpRes.items.map((g) => ({ id: g.id, name: g.name || 'Group' })))
      } else {
        setPropertyGroups([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email, user?.operatorId, scheduleRefreshTick, selectedGroupId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!selectedGroupId) {
        setGroupPropertyIds(new Set())
        return
      }
      const email = String(user?.email || '').trim().toLowerCase()
      const operatorId = String(user?.operatorId || '').trim()
      if (!email) return
      const d = await fetchClientPropertyGroupDetail(email, operatorId, selectedGroupId)
      if (cancelled) return
      if (d?.ok && d.group?.properties?.length) {
        setGroupPropertyIds(new Set(d.group.properties.map((x) => String(x.id || '').trim()).filter(Boolean)))
      } else {
        setGroupPropertyIds(new Set())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedGroupId, user?.email, user?.operatorId])

  const filteredByProperty = useMemo(
    () => schedules.filter((s) => propertyFilter === 'all' || s.propertyId === propertyFilter),
    [schedules, propertyFilter]
  )

  const dateFiltered = useMemo(() => {
    return filteredByProperty.filter((s) => {
      const d = String(s.date || '').slice(0, 10)
      if (dayMode === 'today') return d === todayYmd
      if (dayMode === 'tomorrow') return d === tomorrowYmd
      if (dayMode === 'custom' && customFrom && customTo) return ymdInRange(d, customFrom, customTo)
      return true
    })
  }, [filteredByProperty, dayMode, todayYmd, tomorrowYmd, customFrom, customTo])

  const sortedRows = useMemo(() => {
    const rows = [...dateFiltered]
    const dir = sortDir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      const cmp = (x: string | number, y: string | number) => (x < y ? -1 : x > y ? 1 : 0)
      switch (sortKey) {
        case 'date':
          return cmp(a.date, b.date) * dir
        case 'property':
          return cmp(a.property, b.property) * dir
        case 'unit':
          return cmp(a.unit, b.unit) * dir
        case 'service':
          return cmp(a.cleaningType, b.cleaningType) * dir
        case 'time':
          return cmp(a.time || '', b.time || '') * dir
        case 'status':
          return cmp(a.normalizedStatus, b.normalizedStatus) * dir
        default:
          return 0
      }
    })
    return rows
  }, [dateFiltered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortHead({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k
    return (
      <Button
        type="button"
        variant="ghost"
        className={cn(
          '-ml-3 h-8 gap-1 px-3 font-semibold hover:bg-transparent',
          active ? 'text-foreground' : 'text-muted-foreground'
        )}
        onClick={() => toggleSort(k)}
      >
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
        )}
      </Button>
    )
  }

  const customSummary =
    dayMode === 'custom' && customFrom && customTo
      ? `${formatDisplayDate(customFrom)} – ${formatDisplayDate(customTo)}`
      : null

  function openCustomize() {
    setDraftFrom(customFrom || todayYmd)
    setDraftTo(customTo || addDaysToMalaysiaYmd(todayYmd, 7))
    setCustomizeOpen(true)
  }

  async function applyScheduleBtob(item: ScheduleItem, nextBtob: boolean) {
    const email = String(user?.email || '').trim().toLowerCase()
    const op = String(item.operatorId || user?.operatorId || '').trim()
    if (!email || !op) {
      toast.error('Sign in required')
      return
    }
    setBtobUpdatingId(item.id)
    try {
      const r = await updateClientScheduleJob({
        email,
        operatorId: op,
        scheduleId: item.id,
        btob: nextBtob,
        ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
      })
      if (!r.ok) {
        toast.error(typeof r.reason === 'string' ? r.reason : 'Update failed')
        return
      }
      toast.success(nextBtob ? 'Marked as same-day turnover' : 'BTOB cleared')
      setScheduleRefreshTick((t) => t + 1)
    } finally {
      setBtobUpdatingId(null)
    }
  }

  function openCompletedJobDetail(item: ScheduleItem) {
    setJobDetailItem(item)
    setJobDetailPhotoUrls(
      (item.completedPhotos ?? []).map((u) => normalizeDamageAttachmentUrl(String(u))).filter(Boolean)
    )
    setJobDetailOpen(true)
  }

  const downloadCompletionPhotosZip = useCallback(async () => {
    if (jobDetailPhotoUrls.length === 0) return
    setCompletionZipDownloading(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      for (let i = 0; i < jobDetailPhotoUrls.length; i++) {
        const url = jobDetailPhotoUrls[i]
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
        if (!res.ok) {
          throw new Error(`Photo ${i + 1} could not be loaded (${res.status})`)
        }
        const blob = await res.blob()
        const ext = fileExtForCompletionPhoto(url, res.headers.get('content-type'))
        zip.file(`photo-${String(i + 1).padStart(3, '0')}${ext}`, blob)
      }
      const out = await zip.generateAsync({ type: 'blob' })
      const idPart = jobDetailItem?.id ? String(jobDetailItem.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) : 'job'
      const datePart = jobDetailItem?.date ? String(jobDetailItem.date).slice(0, 10) : 'photos'
      const name = `completion-photos-${idPart}-${datePart}.zip`
      const a = document.createElement('a')
      const href = URL.createObjectURL(out)
      a.href = href
      a.download = name
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
      toast.success('ZIP download started')
    } catch (e) {
      console.error('[client schedule] completion zip', e)
      toast.error(
        'Could not download ZIP. If photos are on another domain, open each image in a new tab or try again later.'
      )
    } finally {
      setCompletionZipDownloading(false)
    }
  }, [jobDetailPhotoUrls, jobDetailItem])

  async function applyScheduleStatus(item: ScheduleItem, nextStatus: string) {
    const email = String(user?.email || '').trim().toLowerCase()
    const op = String(item.operatorId || user?.operatorId || '').trim()
    if (!email || !op) {
      toast.error('Sign in required')
      return
    }
    const current = clientJobRowStatusSelectValue(item)
    if (nextStatus === current) return
    if (nextStatus === 'in-progress') {
      setExtendDeleteTarget(item)
      setExtendDeleteOpen(true)
      return
    }
    setStatusUpdatingId(item.id)
    try {
      const r = await updateClientScheduleJob({
        email,
        operatorId: op,
        scheduleId: item.id,
        status: mapClientStatusKeyToApi(nextStatus),
        statusSetByEmail: email,
        ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
      })
      if (!r.ok) {
        toast.error(typeof r.reason === 'string' ? r.reason : 'Update failed')
        return
      }
      toast.success('Status updated')
      setScheduleRefreshTick((t) => t + 1)
    } finally {
      setStatusUpdatingId(null)
    }
  }

  return (
    <>
    <GiveReviewDialog
      open={reviewOpen}
      onOpenChange={setReviewOpen}
      reviewKind="client_to_operator"
      operatorId={String(reviewTarget?.operatorId || user?.operatorId || '').trim()}
      scheduleId={reviewTarget?.id}
      syncPhotoUrls={
        reviewTarget
          ? (reviewTarget.completedPhotos ?? [])
              .map((u) => normalizeDamageAttachmentUrl(String(u)))
              .filter(Boolean)
          : []
      }
      title="Rate your cleaning operator"
    />
    <Card id="client-schedule" className="w-full scroll-mt-16 border-border shadow-sm md:scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Schedule</CardTitle>
        <CardDescription className="text-pretty break-words">
          Change status from the dropdown when the job is active (completed rows: dropdown is read-only). Pending check out
          and Ready to clean: no Action menu. Other active rows: Action → Reschedule / extend date. Customer extend
          confirms, then removes that schedule. Completed: Action → View detail for photos.
        </CardDescription>
        {propertyGroups.length > 0 ? (
          <div className="flex w-full min-w-0 flex-col gap-1.5 pt-2 sm:flex-row sm:items-start sm:gap-3">
            <Label className="text-xs text-muted-foreground shrink-0 pt-2 sm:pt-2">
              Property group
            </Label>
            <Select value={selectedGroupId || 'all'} onValueChange={(v) => setSelectedGroupId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9 min-w-0 w-full flex-1 border-input sm:max-w-md sm:flex-none">
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups (show every property)</SelectItem>
                {propertyGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="inline-flex w-full max-w-none shrink-0 rounded-lg border border-border bg-muted/40 p-0.5 sm:max-w-md">
            <Button
              type="button"
              variant="ghost"
              className={cn(
                'flex-1 rounded-md text-sm font-medium',
                dayMode === 'today' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
              )}
              onClick={() => setDayMode('today')}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn(
                'flex-1 rounded-md text-sm font-medium',
                dayMode === 'tomorrow' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
              )}
              onClick={() => setDayMode('tomorrow')}
            >
              Tomorrow
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn(
                'flex-1 rounded-md text-sm font-medium',
                dayMode === 'custom' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
              )}
              onClick={() => openCustomize()}
            >
              Customize
            </Button>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-1.5 sm:ml-auto sm:w-auto sm:max-w-md sm:flex-row sm:items-center sm:justify-end sm:gap-2">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">Property</span>
            <Select value={propertyFilter} onValueChange={setPropertyFilter}>
              <SelectTrigger className="h-10 min-w-0 w-full border-input sm:h-9 sm:min-w-[12rem] sm:max-w-[min(100%,20rem)] sm:flex-none">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All properties</SelectItem>
                {displayProperties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {customSummary ? (
          <p className="text-sm text-muted-foreground">
            Custom range: <span className="font-medium text-foreground">{customSummary}</span>
          </p>
        ) : null}

        {/* Mobile: single column — status full width under title (no side-by-side squeeze) */}
        <div className="md:hidden divide-y divide-border overflow-x-hidden rounded-md border border-border bg-card">
          {sortedRows.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">No jobs in this view.</div>
          ) : (
            sortedRows.map((item) => {
              const statusLocked = isClientScheduleStatusDropdownLocked(item)
              const showCancelledBadge = item.normalizedStatus === 'cancelled'
              const dateLine = `${formatDisplayDate(item.date)}${item.time ? ` · ${item.time}` : ''}`
              return (
                <div
                  key={item.id}
                  className={cn(
                    'min-w-0 space-y-3 px-3 py-4',
                    item.btob && 'border-l-4 border-l-red-600 bg-red-50/40',
                  )}
                >
                  <div className="min-w-0 space-y-1.5">
                    <h2 className="break-words text-base font-bold leading-snug text-foreground">
                      {item.property || '—'}
                    </h2>
                    <p className="text-sm text-muted-foreground">{item.unit || '—'}</p>
                    <p className="text-sm text-foreground">{item.cleaningType}</p>
                    <p className="text-sm text-muted-foreground">{dateLine}</p>
                  </div>

                  <div className="min-w-0 space-y-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Status</span>
                    {showCancelledBadge ? (
                      <div className="flex flex-wrap gap-2">{clientStatusBadge(item)}</div>
                    ) : (
                      <ClientScheduleJobQuickStatusSelect
                        value={safeClientScheduleStatusSelectValue(item)}
                        disabled={statusLocked || statusUpdatingId === item.id}
                        className="h-10 w-full max-w-full text-xs"
                        onCommit={(v) => void applyScheduleStatus(item, v)}
                      />
                    )}
                  </div>

                  <label className="flex items-start gap-2.5 text-xs text-muted-foreground">
                    <Checkbox
                      className="mt-0.5 shrink-0"
                      checked={!!item.btob}
                      disabled={btobUpdatingId === item.id || statusLocked}
                      onCheckedChange={(c) => void applyScheduleBtob(item, c === true)}
                      aria-label="Same-day turnover BTOB"
                    />
                    <span className="min-w-0 leading-snug">Same-day turnover (BTOB)</span>
                  </label>

                  {clientScheduleShowActionMenu(item) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="h-9 w-full gap-1 text-xs">
                          Action
                          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="z-[200] w-[min(100vw-2rem,260px)]">
                        {item.normalizedStatus === 'completed' ? (
                          <>
                            <DropdownMenuItem onClick={() => openCompletedJobDetail(item)}>
                              <Eye className="mr-2 h-4 w-4" />
                              View detail
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setReviewTarget(item)
                                setReviewOpen(true)
                              }}
                            >
                              <MessageSquare className="mr-2 h-4 w-4" />
                              Give review
                            </DropdownMenuItem>
                          </>
                        ) : item.normalizedStatus === 'cancelled' ? (
                          <DropdownMenuItem disabled>No actions</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => {
                              setRescheduleTarget(item)
                              const d = String(item.date || '').slice(0, 10)
                              setRescheduleYmd(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10))
                              setRescheduleOpen(true)
                            }}
                          >
                            Reschedule / extend date
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">—</p>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="hidden md:block rounded-md border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-[100px]">
                  <SortHead label="Date" k="date" />
                </TableHead>
                <TableHead className="min-w-[120px]">
                  <SortHead label="Property" k="property" />
                </TableHead>
                <TableHead className="min-w-[72px]">
                  <SortHead label="Unit" k="unit" />
                </TableHead>
                <TableHead className="min-w-[120px]">
                  <SortHead label="Service" k="service" />
                </TableHead>
                <TableHead className="min-w-[88px]">
                  <SortHead label="Time" k="time" />
                </TableHead>
                <TableHead className="min-w-[100px]">
                  <SortHead label="Status" k="status" />
                </TableHead>
                <TableHead className="w-[100px] text-center">BTOB</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                    No jobs in this view.
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((item) => {
                  const statusLocked = isClientScheduleStatusDropdownLocked(item)
                  const showCancelledBadge = item.normalizedStatus === 'cancelled'
                  return (
                  <TableRow
                    key={item.id}
                    className={cn(item.btob && 'border-2 border-red-600 bg-red-50/30')}
                  >
                    <TableCell className="align-top text-sm whitespace-nowrap">{formatDisplayDate(item.date)}</TableCell>
                    <TableCell className="align-top font-medium">{item.property}</TableCell>
                    <TableCell className="align-top text-sm">{item.unit}</TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">{item.cleaningType}</TableCell>
                    <TableCell className="align-top text-sm whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3 shrink-0 opacity-60" />
                        {item.time || '—'}
                      </span>
                    </TableCell>
                    <TableCell className="align-top">
                      {showCancelledBadge ? (
                        clientStatusBadge(item)
                      ) : (
                        <ClientScheduleJobQuickStatusSelect
                          value={safeClientScheduleStatusSelectValue(item)}
                          disabled={statusLocked || statusUpdatingId === item.id}
                          className="h-8 min-w-[min(100%,280px)] max-w-[320px]"
                          onCommit={(v) => void applyScheduleStatus(item, v)}
                        />
                      )}
                    </TableCell>
                    <TableCell className="align-top text-center">
                      <Checkbox
                        checked={!!item.btob}
                        disabled={btobUpdatingId === item.id || statusLocked}
                        onCheckedChange={(c) => void applyScheduleBtob(item, c === true)}
                        aria-label="Same-day turnover BTOB"
                      />
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {clientScheduleShowActionMenu(item) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1">
                              Action
                              <ChevronDown className="ml-1 h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {item.normalizedStatus === 'completed' ? (
                              <>
                                <DropdownMenuItem onClick={() => openCompletedJobDetail(item)}>
                                  <Eye className="mr-2 h-4 w-4" />
                                  View detail
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setReviewTarget(item)
                                    setReviewOpen(true)
                                  }}
                                >
                                  <MessageSquare className="mr-2 h-4 w-4" />
                                  Give review
                                </DropdownMenuItem>
                              </>
                            ) : item.normalizedStatus === 'cancelled' ? (
                              <DropdownMenuItem disabled>No actions</DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => {
                                  setRescheduleTarget(item)
                                  const d = String(item.date || '').slice(0, 10)
                                  setRescheduleYmd(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10))
                                  setRescheduleOpen(true)
                                }}
                              >
                                Reschedule / extend date
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

      <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Custom date range</DialogTitle>
            <DialogDescription>Choose from and to (Malaysia calendar days).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="dash-from">From</Label>
              <Input id="dash-from" type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value.slice(0, 10))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dash-to">To</Label>
              <Input id="dash-to" type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value.slice(0, 10))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setCustomizeOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const a = String(draftFrom || '').slice(0, 10)
                const b = String(draftTo || '').slice(0, 10)
                if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) {
                  toast.error('Please choose valid dates')
                  return
                }
                if (a > b) {
                  toast.error('“From” must be on or before “To”')
                  return
                }
                setCustomFrom(a)
                setCustomTo(b)
                setDayMode('custom')
                setCustomizeOpen(false)
              }}
            >
              Confirm filter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={extendDeleteOpen}
        onOpenChange={(o) => {
          setExtendDeleteOpen(o)
          if (!o) setExtendDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this job?</DialogTitle>
            <DialogDescription>
              Customer extend means this cleaning is no longer needed. This will delete the row from the schedule.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={extendDeleteSubmitting}
              onClick={() => {
                setExtendDeleteOpen(false)
                setExtendDeleteTarget(null)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={extendDeleteSubmitting}
              onClick={() => {
                void (async () => {
                  const email = String(user?.email || '').trim().toLowerCase()
                  const op = String(extendDeleteTarget?.operatorId || user?.operatorId || '').trim()
                  if (!extendDeleteTarget || !email || !op) {
                    toast.error('Sign in required')
                    return
                  }
                  setExtendDeleteSubmitting(true)
                  try {
                    const r = await deleteClientScheduleJob({
                      email,
                      operatorId: op,
                      scheduleId: extendDeleteTarget.id,
                      ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
                    })
                    if (!r.ok) {
                      toast.error(typeof r.reason === 'string' ? r.reason : 'Could not remove job')
                      return
                    }
                    toast.success('Schedule removed')
                    setExtendDeleteOpen(false)
                    setExtendDeleteTarget(null)
                    setScheduleRefreshTick((t) => t + 1)
                  } finally {
                    setExtendDeleteSubmitting(false)
                  }
                })()
              }}
            >
              {extendDeleteSubmitting ? 'Removing…' : 'Confirm remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule / Extend</DialogTitle>
            <DialogDescription>
              {rescheduleTarget
                ? `Choose the new working day for ${rescheduleTarget.property}.`
                : 'Choose a new date'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="dash-reschedule-day">New working day</Label>
              <Input
                id="dash-reschedule-day"
                type="date"
                value={rescheduleYmd}
                onChange={(e) => setRescheduleYmd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={rescheduleSubmitting}
              onClick={() => {
                void (async () => {
                  const email = String(user?.email || '').trim().toLowerCase()
                  const op = String(rescheduleTarget?.operatorId || user?.operatorId || '').trim()
                  if (!rescheduleTarget || !email || !op) return
                  const wd = String(rescheduleYmd || '').slice(0, 10)
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) {
                    toast.error('Please choose a valid date')
                    return
                  }
                  setRescheduleSubmitting(true)
                  try {
                    const r = await updateClientScheduleJob({
                      email,
                      operatorId: op,
                      scheduleId: rescheduleTarget.id,
                      workingDay: wd,
                      status: 'in-progress',
                      ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
                    })
                    if (!r.ok) {
                      toast.error(typeof r.reason === 'string' ? r.reason : 'Update failed')
                      return
                    }
                    toast.success('Schedule updated')
                    setRescheduleOpen(false)
                    setRescheduleTarget(null)
                    setScheduleRefreshTick((t) => t + 1)
                  } finally {
                    setRescheduleSubmitting(false)
                  }
                })()
              }}
            >
              {rescheduleSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={jobDetailOpen}
        onOpenChange={(o) => {
          setJobDetailOpen(o)
          if (!o) {
            setJobDetailItem(null)
            setJobDetailPhotoUrls([])
          }
        }}
      >
        <DialogContent className="max-h-[min(90vh,800px)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Job detail</DialogTitle>
            <DialogDescription>
              {jobDetailItem ? `${jobDetailItem.property} · ${jobDetailItem.unit || '—'}` : 'Completed cleaning'}
            </DialogDescription>
          </DialogHeader>
          {jobDetailItem ? (
            <div className="space-y-3 py-1 text-sm">
              <div className="flex justify-between gap-3 border-b border-border/60 pb-2">
                <span className="text-muted-foreground">Date</span>
                <span className="text-right font-medium">{formatDisplayDate(jobDetailItem.date)}</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-border/60 pb-2">
                <span className="text-muted-foreground">Time</span>
                <span className="text-right font-medium">{jobDetailItem.time || '—'}</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-border/60 pb-2">
                <span className="text-muted-foreground">Service</span>
                <span className="text-right font-medium">{jobDetailItem.cleaningType}</span>
              </div>
              {jobDetailItem.team ? (
                <div className="flex justify-between gap-3 border-b border-border/60 pb-2">
                  <span className="text-muted-foreground">Team</span>
                  <span className="text-right font-medium">{jobDetailItem.team}</span>
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5 border-b border-border/60 pb-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-muted-foreground">Status</span>
                <div className="sm:text-right">{clientStatusBadge(jobDetailItem)}</div>
              </div>
              <p className="text-xs text-muted-foreground break-all">
                Job ID: <span className="font-mono text-foreground">{jobDetailItem.id}</span>
              </p>
              {jobDetailPhotoUrls.length > 0 ? (
                <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Completion photos
                  </Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {jobDetailPhotoUrls.map((url, i) => (
                      <button
                        key={`${url}-${i}`}
                        type="button"
                        onClick={() => setCompletionPhotoLightboxUrl(url)}
                        className="block w-full overflow-hidden rounded-md border border-border/80 bg-background text-left shadow-sm outline-none ring-offset-background transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- OSS / Wix CDN */}
                        <img
                          src={url}
                          alt={`Completion photo ${i + 1}`}
                          className="pointer-events-none aspect-square h-auto w-full object-cover"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Tap a photo to enlarge. Press Esc or click outside to close.</p>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-muted-foreground">
                  No completion photos uploaded for this job.
                </p>
              )}
            </div>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setJobDetailOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="gap-2"
              disabled={jobDetailPhotoUrls.length === 0 || completionZipDownloading}
              onClick={() => void downloadCompletionPhotosZip()}
            >
              {completionZipDownloading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4 shrink-0" aria-hidden />
              )}
              Download ZIP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </>
  )
}
