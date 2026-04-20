"use client"

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import {
  fetchClientPortalProperties,
  fetchClientPropertyGroups,
  fetchClientPropertyGroupDetail,
  fetchClientScheduleJobs,
  updateClientScheduleJob,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { ArrowDown, ArrowUp, ArrowUpDown, Clock } from 'lucide-react'
import { addDaysToMalaysiaYmd, getMalaysiaCalendarYmd } from '@/lib/cleanlemon-booking-eligibility'

type ScheduleItem = {
  id: string
  propertyId?: string
  operatorId?: string
  property: string
  unit: string
  cleaningType: string
  time: string
  scheduleStatus: string
  date: string
  team?: string
}

type DayMode = 'today' | 'tomorrow' | 'custom'

type SortKey = 'date' | 'property' | 'unit' | 'service' | 'time' | 'status'

function clientScheduleBadgeLabel(status: string): string {
  const s = String(status || '').toLowerCase()
  if (s === 'pending-checkout') return 'Pending approval'
  if (s === 'ready-to-clean') return 'Confirmed'
  if (s.includes('progress')) return 'In progress'
  if (s.includes('complete') || s === 'done') return 'Completed'
  if (s.includes('cancel')) return 'Cancelled'
  return 'Scheduled'
}

/** Align with backend `normalizeScheduleStatus` for dropdown value + API. */
function canonicalClientScheduleStatus(s: string) {
  const x = String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
  if (x.includes('complete') || x === 'done') return 'completed'
  if (x.includes('progress')) return 'in-progress'
  if (x.includes('cancel')) return 'cancelled'
  if (x.includes('checkout') || x === 'pending-checkout') return 'pending-checkout'
  return 'ready-to-clean'
}

const CLIENT_SCHEDULE_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'pending-checkout', label: 'Pending approval' },
  { value: 'ready-to-clean', label: 'Ready to clean' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800'
    case 'cancelled':
      return 'bg-red-100 text-red-800'
    case 'pending-checkout':
      return 'bg-amber-100 text-amber-900'
    case 'ready-to-clean':
    case 'in-progress':
      return 'bg-blue-100 text-blue-800'
    default:
      return 'bg-muted text-muted-foreground'
  }
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
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)

  const todayYmd = useMemo(() => getMalaysiaCalendarYmd(), [])
  const tomorrowYmd = useMemo(() => addDaysToMalaysiaYmd(todayYmd, 1), [todayYmd])

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
        const st = String(j.status || '').toLowerCase()
        return {
          id: String(j.id || ''),
          propertyId: String(j.propertyId || ''),
          operatorId: String(j.clnOperatorId || j.operatorId || ''),
          property: String(j.property || ''),
          unit: String(j.unit || j.unitNumber || ''),
          cleaningType: String(j.cleaningType || 'General Cleaning'),
          time: String(j.time || ''),
          scheduleStatus: st,
          date: String(j.date || j.workingDay || new Date().toISOString()).slice(0, 10),
          team: String(j.team || j.teamName || ''),
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
          return cmp(a.scheduleStatus, b.scheduleStatus) * dir
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

  async function applyScheduleStatus(item: ScheduleItem, nextStatus: string) {
    const email = String(user?.email || '').trim().toLowerCase()
    const op = String(item.operatorId || user?.operatorId || '').trim()
    if (!email || !op) {
      toast.error('Sign in required')
      return
    }
    const current = canonicalClientScheduleStatus(item.scheduleStatus)
    if (nextStatus === current) return
    setStatusUpdatingId(item.id)
    try {
      const r = await updateClientScheduleJob({
        email,
        operatorId: op,
        scheduleId: item.id,
        status: nextStatus,
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
    <Card id="client-schedule" className="w-full scroll-mt-16 border-border shadow-sm md:scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Schedule</CardTitle>
        <CardDescription>
          Jobs for the selected day or range. On desktop, sort columns in the table header; on mobile, change status from
          the dropdown on each job.
        </CardDescription>
        {propertyGroups.length > 0 ? (
          <div className="flex w-full min-w-0 flex-col gap-1.5 pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <Label className="text-xs text-muted-foreground shrink-0">Group</Label>
            <Select value={selectedGroupId || 'all'} onValueChange={(v) => setSelectedGroupId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9 min-w-0 w-full flex-1 border-input sm:max-w-xs sm:flex-none">
                <SelectValue placeholder="All properties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All properties</SelectItem>
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
          <div className="inline-flex w-full max-w-md shrink-0 rounded-lg border border-border bg-muted/40 p-0.5">
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
          <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto sm:max-w-md sm:justify-end">
            <span className="text-sm text-muted-foreground shrink-0">Property</span>
            <Select value={propertyFilter} onValueChange={setPropertyFilter}>
              <SelectTrigger className="min-w-0 flex-1 border-input sm:min-w-[12rem] sm:max-w-[min(100%,20rem)] sm:flex-none">
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

        {/* Mobile: stacked rows, no horizontal scroll; status dropdown on the right */}
        <div className="md:hidden divide-y divide-border rounded-md border border-border bg-card">
          {sortedRows.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">No jobs in this view.</div>
          ) : (
            sortedRows.map((item) => {
              const statusVal = canonicalClientScheduleStatus(item.scheduleStatus)
              const dateLine = `${formatDisplayDate(item.date)}${item.time ? ` · ${item.time}` : ''}`
              return (
                <div key={item.id} className="flex gap-2 px-3 py-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="text-lg font-bold leading-snug text-foreground">{item.property || '—'}</h2>
                    <p className="text-sm text-muted-foreground">{item.unit || '—'}</p>
                    <p className="text-sm text-foreground">{item.cleaningType}</p>
                    <p className="text-sm text-muted-foreground">{dateLine}</p>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => {
                        setRescheduleTarget(item)
                        const d = String(item.date || '').slice(0, 10)
                        setRescheduleYmd(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10))
                        setRescheduleOpen(true)
                      }}
                    >
                      Reschedule / extend date
                    </Button>
                  </div>
                  <div className="flex w-[min(9.5rem,42vw)] shrink-0 flex-col justify-start gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Status</span>
                    <Select
                      value={statusVal}
                      disabled={statusUpdatingId === item.id}
                      onValueChange={(v) => void applyScheduleStatus(item, v)}
                    >
                      <SelectTrigger className="h-9 w-full text-left text-xs" aria-label="Change job status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" className="z-[200]">
                        {CLIENT_SCHEDULE_STATUS_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                <TableHead className="w-[120px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No jobs in this view.
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((item) => (
                  <TableRow key={item.id}>
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
                      <Badge className={`text-xs ${getStatusColor(item.scheduleStatus)}`}>
                        {clientScheduleBadgeLabel(item.scheduleStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                          setRescheduleTarget(item)
                          const d = String(item.date || '').slice(0, 10)
                          setRescheduleYmd(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10))
                          setRescheduleOpen(true)
                        }}
                      >
                        Reschedule
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
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
    </>
  )
}
