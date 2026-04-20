"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  acceptDriverTripRequest,
  fetchActiveDriverTrip,
  fetchDriverTripHistory,
  fetchDriverVehicle,
  fetchPendingDriverTrips,
  finishDriverTripRequest,
  postDriverTripReleaseAccept,
  postDriverTripStart,
  saveDriverVehicle,
  uploadDriverVehiclePhoto,
  type ClnDriverTripPayload,
} from '@/lib/cleanlemon-api'

function tripPickup(t: ClnDriverTripPayload) {
  return String((t as { pickup?: string }).pickup ?? (t as { pickupText?: string }).pickupText ?? '')
}
function tripDropoff(t: ClnDriverTripPayload) {
  return String((t as { dropoff?: string }).dropoff ?? (t as { dropoffText?: string }).dropoffText ?? '')
}
import { cn } from '@/lib/utils'
import { filterOperatorsForPortal } from '@/lib/cleanlemons-portal-helpers'
import {
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MapPin,
  Navigation,
  Settings,
  Truck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const MYT = 'Asia/Kuala_Lumpur'

type NavApp = 'google' | 'waze'
const NAV_STORAGE_KEY = 'cleanlemons_driver_nav_app'

function openNavigation(
  app: NavApp,
  opts: { leg: 'pickup' | 'dropoff' | 'route'; pickup: string; dropoff: string }
) {
  const pickup = String(opts.pickup || '').trim()
  const dropoff = String(opts.dropoff || '').trim()

  if (opts.leg === 'pickup') {
    const dest = pickup || dropoff
    if (!dest) return
    if (app === 'waze') {
      window.open(`https://waze.com/ul?q=${encodeURIComponent(dest)}&navigate=yes`, '_blank', 'noopener,noreferrer')
    } else {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`,
        '_blank',
        'noopener,noreferrer'
      )
    }
    return
  }
  if (opts.leg === 'dropoff') {
    const dest = dropoff || pickup
    if (!dest) return
    if (app === 'waze') {
      window.open(`https://waze.com/ul?q=${encodeURIComponent(dest)}&navigate=yes`, '_blank', 'noopener,noreferrer')
    } else {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`,
        '_blank',
        'noopener,noreferrer'
      )
    }
    return
  }
  if (!pickup && !dropoff) return
  if (!pickup) {
    openNavigation(app, { leg: 'dropoff', pickup, dropoff })
    return
  }
  if (!dropoff) {
    openNavigation(app, { leg: 'pickup', pickup, dropoff })
    return
  }
  if (app === 'google') {
    window.open(
      `https://www.google.com/maps/dir/${encodeURIComponent(pickup)}/${encodeURIComponent(dropoff)}`,
      '_blank',
      'noopener,noreferrer'
    )
  } else {
    window.open(`https://waze.com/ul?q=${encodeURIComponent(pickup)}&navigate=yes`, '_blank', 'noopener,noreferrer')
  }
}

function formatMyt(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString('en-MY', {
      timeZone: MYT,
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return '—'
  }
}

/** Calendar date YYYY-MM-DD in Malaysia for an instant (for date filters). */
function formatDateKeyInMyt(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MYT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${day}`
}

function utcIsoToMytDateKey(iso: string | null | undefined): string | null {
  if (!iso || !String(iso).trim()) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return formatDateKeyInMyt(d)
}

export default function DriverDashboardPage() {
  const { user } = useAuth()
  const [operatorId, setOperatorId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<ClnDriverTripPayload[]>([])
  const [activeTrip, setActiveTrip] = useState<ClnDriverTripPayload | null>(null)
  const [openJobs, setOpenJobs] = useState<ClnDriverTripPayload[]>([])
  const [carPlate, setCarPlate] = useState('')
  const [carFrontUrl, setCarFrontUrl] = useState('')
  const [carBackUrl, setCarBackUrl] = useState('')
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [uploading, setUploading] = useState<'front' | 'back' | null>(null)
  const [navApp, setNavApp] = useState<NavApp>('google')
  const [startingTrip, setStartingTrip] = useState(false)
  const [releasingAccept, setReleasingAccept] = useState(false)
  /** YYYY-MM-DD in MYT, or null = show all completed trips */
  const [historyDateKey, setHistoryDateKey] = useState<string | null>(null)
  const [historyFilterOpen, setHistoryFilterOpen] = useState(false)
  const [driverMainTab, setDriverMainTab] = useState<'order' | 'history'>('order')

  useEffect(() => {
    try {
      const s = localStorage.getItem(NAV_STORAGE_KEY)
      if (s === 'waze' || s === 'google') setNavApp(s)
    } catch {
      /* ignore */
    }
  }, [])

  const persistNavApp = (v: NavApp) => {
    setNavApp(v)
    try {
      localStorage.setItem(NAV_STORAGE_KEY, v)
    } catch {
      /* ignore */
    }
  }

  const hasDriverStarted = useMemo(() => {
    const t = activeTrip?.driverStartedAtUtc
    return Boolean(t && String(t).trim())
  }, [activeTrip])

  const driverOperators = useMemo(
    () => filterOperatorsForPortal(user?.cleanlemons, 'driver'),
    [user?.cleanlemons]
  )

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('cleanlemons_employee_operator_id') : ''
    const first = driverOperators[0]?.id
    if (stored && driverOperators.some((o) => o.id === stored)) {
      setOperatorId(stored)
    } else if (first) {
      setOperatorId(first)
      try {
        localStorage.setItem('cleanlemons_employee_operator_id', first)
      } catch {
        /* ignore */
      }
    } else {
      setOperatorId('')
    }
  }, [driverOperators])

  const refresh = useCallback(async () => {
    const oid = String(operatorId || '').trim()
    if (!oid) {
      setLoading(false)
      setActiveTrip(null)
      setHistory([])
      setOpenJobs([])
      return
    }
    setLoading(true)
    try {
      const [a, h, oj] = await Promise.all([
        fetchActiveDriverTrip(oid),
        fetchDriverTripHistory(oid, 200),
        fetchPendingDriverTrips(oid),
      ])
      if (a.ok) setActiveTrip(a.trip ?? null)
      else setActiveTrip(null)
      if (h.ok && Array.isArray(h.items)) setHistory(h.items)
      else setHistory([])
      if (oj.ok && Array.isArray(oj.items)) setOpenJobs(oj.items)
      else setOpenJobs([])
    } catch {
      setActiveTrip(null)
      setHistory([])
      setOpenJobs([])
    } finally {
      setLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const loadVehicle = useCallback(async () => {
    const r = await fetchDriverVehicle()
    if (r?.ok && r.vehicle) {
      setCarPlate(r.vehicle.carPlate || '')
      setCarFrontUrl(r.vehicle.carFrontUrl || '')
      setCarBackUrl(r.vehicle.carBackUrl || '')
    }
  }, [])

  useEffect(() => {
    if (settingsOpen) void loadVehicle()
  }, [settingsOpen, loadVehicle])

  const handleUpload = async (which: 'front' | 'back', file: File | null) => {
    if (!file) return
    setUploading(which)
    try {
      const up = await uploadDriverVehiclePhoto(file)
      if (!up.ok || !up.url) {
        toast.error(up.reason || 'Upload failed')
        return
      }
      if (which === 'front') setCarFrontUrl(up.url)
      else setCarBackUrl(up.url)
      toast.success('Photo uploaded')
    } finally {
      setUploading(null)
    }
  }

  const handleSaveVehicle = async () => {
    setSavingVehicle(true)
    try {
      const r = await saveDriverVehicle({
        carPlate,
        carFrontUrl,
        carBackUrl,
      })
      if (!r.ok) {
        toast.error(r.reason || 'Could not save')
        return
      }
      toast.success('Vehicle saved')
      setSettingsOpen(false)
    } finally {
      setSavingVehicle(false)
    }
  }

  const handleAcceptJob = async (tripId: string) => {
    const oid = String(operatorId || '').trim()
    if (!oid) return
    const r = await acceptDriverTripRequest(tripId, oid)
    if (!r.ok) {
      const reason = String(r.reason || '')
      const msg =
        reason === 'CANNOT_ACCEPT_OWN_TRIP'
          ? 'You cannot accept your own order. Use another driver account, or ask a colleague to accept.'
          : reason === 'TRIP_NOT_OPEN'
            ? 'This job is no longer open (someone else accepted or it was cancelled).'
            : reason === 'ACTIVE_TRIP_EXISTS'
              ? 'Finish your current trip before accepting another.'
              : reason === 'MISSING_FIELDS'
                ? 'Missing trip — refresh the page and try again.'
                : reason || 'Could not accept this job.'
      toast.error(msg)
      void refresh()
      return
    }
    toast.success('Job accepted')
    void refresh()
  }

  const handleStartTrip = async () => {
    const oid = String(operatorId || '').trim()
    const tid = activeTrip?.id
    if (!oid || !tid) return
    setStartingTrip(true)
    try {
      const r = await postDriverTripStart(tid, oid)
      if (!r.ok) {
        const reason = String(r.reason || '')
        const msg =
          reason === 'MIGRATION_REQUIRED'
            ? 'Server needs a database update before “Start trip”. Ask your admin.'
            : reason === 'TRIP_NOT_ACCEPTED'
              ? 'This trip is not active — refresh and try again.'
              : reason || 'Could not start trip.'
        toast.error(msg)
        void refresh()
        return
      }
      toast.success('Trip started — drive to drop-off')
      void refresh()
    } finally {
      setStartingTrip(false)
    }
  }

  const handleReleaseAccept = async () => {
    const oid = String(operatorId || '').trim()
    const tid = activeTrip?.id
    if (!oid || !tid) return
    setReleasingAccept(true)
    try {
      const r = await postDriverTripReleaseAccept(tid, oid)
      if (!r.ok) {
        const reason = String(r.reason || '')
        const msg =
          reason === 'RELEASE_AFTER_START'
            ? 'You already started this trip — use Finish when done.'
            : reason || 'Could not cancel acceptance.'
        toast.error(msg)
        void refresh()
        return
      }
      toast.success('Acceptance cancelled')
      void refresh()
    } finally {
      setReleasingAccept(false)
    }
  }

  const handleFinishTrip = async () => {
    const oid = String(operatorId || '').trim()
    const tid = activeTrip?.id
    if (!oid || !tid) return
    const r = await finishDriverTripRequest(tid, oid)
    if (!r.ok) {
      const reason = String(r.reason || '')
      const msg =
        reason === 'TRIP_FINISH_DENIED'
          ? 'Cannot finish this trip'
          : reason === 'TRIP_NOT_STARTED'
            ? 'Tap “Start trip” after pick-up before finishing.'
            : 'Finish failed'
      toast.error(msg)
      return
    }
    toast.success('Trip finished')
    void refresh()
  }

  const filteredHistory = useMemo(() => {
    if (!historyDateKey) return history
    return history.filter((t) => {
      const endKey = utcIsoToMytDateKey(t.completedAtUtc) || utcIsoToMytDateKey(t.updatedAtUtc)
      return endKey === historyDateKey
    })
  }, [history, historyDateKey])

  const completedCount = history.length

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-3 pb-20 sm:px-4 lg:pb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Driver</h1>
          <p className="text-sm text-muted-foreground">Trips & vehicle</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 rounded-full"
          aria-label="Vehicle settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-5 w-5" />
        </Button>
      </div>

      {driverOperators.length > 1 ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Operator</Label>
          <Select
            value={operatorId}
            onValueChange={(v) => {
              setOperatorId(v)
              try {
                localStorage.setItem('cleanlemons_employee_operator_id', v)
              } catch {
                /* ignore */
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select operator" />
            </SelectTrigger>
            <SelectContent>
              {driverOperators.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <Tabs value={driverMainTab} onValueChange={(v) => setDriverMainTab(v as 'order' | 'history')} className="gap-3">
        <TabsList className="grid h-10 w-full grid-cols-2">
          <TabsTrigger value="order" className="gap-1.5">
            Order
            {openJobs.length > 0 ? (
              <span className="rounded-full bg-primary px-1.5 py-0 text-[10px] font-semibold text-primary-foreground">
                {openJobs.length}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="order" className="mt-0 space-y-4 focus-visible:outline-none">
          {!activeTrip && !loading && operatorId ? (
            <Card className="border-dashed border-primary/30">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-lg">Open jobs</CardTitle>
                  {openJobs.length > 0 ? (
                    <Badge variant="default" className="shrink-0">
                      {openJobs.length} trip{openJobs.length === 1 ? '' : 's'} pending driver accept
                    </Badge>
                  ) : null}
                </div>
                <CardDescription>Accept a route others ordered — team and pick-up point are shown on each job.</CardDescription>
              </CardHeader>
              <CardContent>
                {openJobs.length === 0 ? (
                  <p className="py-2 text-center text-sm text-muted-foreground">No open jobs right now.</p>
                ) : (
                  <ul className="space-y-3">
                    {openJobs.map((job) => (
                      <li key={job.id} className="rounded-xl border border-border/80 bg-muted/15 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge variant="secondary">Open</Badge>
                          <span className="text-xs text-muted-foreground">{formatMyt(job.orderTimeUtc)}</span>
                        </div>
                        <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Team</p>
                          <p className="text-base font-semibold text-foreground">
                            {job.requesterTeamName?.trim() ? job.requesterTeamName : '—'}
                          </p>
                          {job.requesterFullName ? (
                            <p className="mt-1 text-xs text-muted-foreground">Requester: {job.requesterFullName}</p>
                          ) : null}
                        </div>
                        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                          <div className="flex items-start gap-2">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                                Pick up point
                              </p>
                              <p className="break-words text-sm font-medium text-foreground">{tripPickup(job)}</p>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 space-y-1 text-sm">
                          <p className="text-xs font-medium text-muted-foreground">Drop off</p>
                          <p className="break-words">{tripDropoff(job)}</p>
                        </div>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:flex-1"
                            onClick={() =>
                              openNavigation(navApp, {
                                leg: 'route',
                                pickup: tripPickup(job),
                                dropoff: tripDropoff(job),
                              })
                            }
                          >
                            <Navigation className="mr-2 h-4 w-4" />
                            Navigate
                          </Button>
                          <Button type="button" className="w-full sm:flex-1" onClick={() => void handleAcceptJob(job.id)}>
                            Accept job
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          {activeTrip ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <Badge className="bg-emerald-600 text-white">On trip</Badge>
            </div>
            <CardTitle className="text-base leading-snug">Active route</CardTitle>
            <CardDescription>
              {hasDriverStarted
                ? 'Finish this trip before accepting another job. You cannot cancel after starting.'
                : 'Go to pick-up first. You can cancel acceptance before you start the trip — you cannot accept another job until this is cleared or finished.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="text-xs font-medium text-muted-foreground">Pick up</p>
                <p className="break-words">{tripPickup(activeTrip)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
              <div>
                <p className="text-xs font-medium text-muted-foreground">Drop off</p>
                <p className="break-words">{tripDropoff(activeTrip)}</p>
              </div>
            </div>
            <div className="rounded-md border border-emerald-500/25 bg-background/60 px-3 py-2 text-xs">
              <p className="mb-1.5 font-semibold text-foreground">Times (Malaysia)</p>
              <div className="space-y-1">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Accept</span>
                  <span className="shrink-0 tabular-nums text-foreground">{formatMyt(activeTrip.acceptedAtUtc)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Start</span>
                  <span className="shrink-0 tabular-nums text-foreground">
                    {hasDriverStarted ? formatMyt(activeTrip.driverStartedAtUtc) : '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">End</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">—</span>
                </div>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center"
                onClick={() =>
                  openNavigation(navApp, {
                    leg: hasDriverStarted ? 'dropoff' : 'pickup',
                    pickup: tripPickup(activeTrip),
                    dropoff: tripDropoff(activeTrip),
                  })
                }
              >
                <Navigation className="mr-2 h-4 w-4" />
                Navigate
              </Button>
              {!hasDriverStarted ? (
                <>
                  <Button
                    type="button"
                    className="w-full justify-center"
                    disabled={startingTrip}
                    onClick={() => void handleStartTrip()}
                  >
                    {startingTrip ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Start trip
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full justify-center"
                    disabled={releasingAccept}
                    onClick={() => void handleReleaseAccept()}
                  >
                    {releasingAccept ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                    Cancel acceptance
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  className="w-full justify-center"
                  onClick={() => void handleFinishTrip()}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Finish trip
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
        </TabsContent>

        <TabsContent value="history" className="mt-0 focus-visible:outline-none">
      <Card>
        <CardHeader className="space-y-4 pb-2">
          <div className="flex items-center gap-3 rounded-xl border border-border/80 bg-muted/20 px-4 py-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <Truck className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Completed trips</p>
              <p className="text-2xl font-semibold tabular-nums">{loading ? '—' : completedCount}</p>
            </div>
          </div>
          <Collapsible open={historyFilterOpen} onOpenChange={setHistoryFilterOpen}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-lg">Trip history</CardTitle>
                <CardDescription>
                  Routes you finished for this operator
                  {historyDateKey ? ` · ${historyDateKey}` : ' · All dates'} (MYT).
                </CardDescription>
              </div>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 gap-1.5 self-start sm:self-center"
                  aria-expanded={historyFilterOpen}
                >
                  <CalendarRange className="h-4 w-4" aria-hidden />
                  Filter
                  <ChevronDown
                    className={cn('h-4 w-4 transition-transform', historyFilterOpen && 'rotate-180')}
                    aria-hidden
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div className="mt-3 rounded-md border border-border/60 bg-muted/30 px-3 py-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Filter by end date (MYT)</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={historyDateKey === formatDateKeyInMyt(new Date()) ? 'default' : 'outline'}
                    className="h-9"
                    onClick={() => setHistoryDateKey(formatDateKeyInMyt(new Date()))}
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      historyDateKey === formatDateKeyInMyt(new Date(Date.now() - 86400000))
                        ? 'default'
                        : 'outline'
                    }
                    className="h-9"
                    onClick={() => setHistoryDateKey(formatDateKeyInMyt(new Date(Date.now() - 86400000)))}
                  >
                    Yesterday
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={historyDateKey === null ? 'default' : 'outline'}
                    className="h-9"
                    onClick={() => setHistoryDateKey(null)}
                  >
                    All
                  </Button>
                  <Input
                    type="date"
                    className="h-9 w-[11rem] shrink-0"
                    value={historyDateKey ?? ''}
                    onChange={(e) => setHistoryDateKey(e.target.value.trim() || null)}
                    aria-label="Pick a date"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : !operatorId ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Select an operator to see history.</p>
          ) : history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No trips yet.</p>
          ) : filteredHistory.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No completed trips on this date. Try another day or tap All.
            </p>
          ) : (
            <ul className="space-y-3">
              {filteredHistory.map((t) => (
                <li
                  key={t.id}
                  className={cn(
                    'rounded-xl border border-border/80 bg-muted/20 px-3 py-3',
                    'text-sm'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="break-words font-medium leading-snug text-foreground">{tripPickup(t)}</p>
                      <p className="break-words font-medium leading-snug text-foreground">{tripDropoff(t)}</p>
                    </div>
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                  </div>
                  <div className="mt-3 space-y-1 border-t border-border/50 pt-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Accept</span>
                      <span className="shrink-0 tabular-nums text-foreground">{formatMyt(t.acceptedAtUtc)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Start</span>
                      <span className="shrink-0 tabular-nums text-foreground">{formatMyt(t.driverStartedAtUtc)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">End</span>
                      <span className="shrink-0 tabular-nums text-foreground">{formatMyt(t.completedAtUtc)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Driver settings</DialogTitle>
            <DialogDescription>Navigation app, plate number, and car photos (stored on your profile).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Navigate with</Label>
              <Select value={navApp} onValueChange={(v) => persistNavApp(v as NavApp)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Maps app" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="google">Google Maps</SelectItem>
                  <SelectItem value="waze">Waze</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="car-plate">Car plate</Label>
              <Input
                id="car-plate"
                value={carPlate}
                onChange={(e) => setCarPlate(e.target.value)}
                placeholder="e.g. ABC 1234"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Front</Label>
                <Input
                  type="file"
                  accept="image/*"
                  className="cursor-pointer text-xs"
                  disabled={uploading === 'front'}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    void handleUpload('front', f || null)
                    e.target.value = ''
                  }}
                />
                {carFrontUrl ? (
                  <p className="truncate text-xs text-muted-foreground" title={carFrontUrl}>
                    Saved
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Back</Label>
                <Input
                  type="file"
                  accept="image/*"
                  className="cursor-pointer text-xs"
                  disabled={uploading === 'back'}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    void handleUpload('back', f || null)
                    e.target.value = ''
                  }}
                />
                {carBackUrl ? (
                  <p className="truncate text-xs text-muted-foreground" title={carBackUrl}>
                    Saved
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={savingVehicle} onClick={() => void handleSaveVehicle()}>
              {savingVehicle ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
