"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useAuth } from '@/lib/auth-context'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  fetchAddressSearch,
  fetchRequesterActiveDriverTrip,
  fetchRequesterDriverTripHistory,
  postEmployeeDriverTrip,
  postRequesterCancelDriverTrip,
  type ClnDriverTripPayload,
} from '@/lib/cleanlemon-api'
import { useEffectiveOperatorId } from '@/lib/cleanlemon-effective-operator-id'
import { cn } from '@/lib/utils'
import {
  CalendarRange,
  ChevronDown,
  History,
  Loader2,
  MapPin,
  Navigation,
  Search,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

const MYT = 'Asia/Kuala_Lumpur'

type AddressItem = { displayName: string; lat: string; lon: string; placeId: string }

type ScheduleOffset = 'now' | '15' | '30'

function freqStorageKeyLegacy(email: string) {
  const e = String(email || '')
    .trim()
    .toLowerCase()
  return `cleanlemons_employee_order_freq_dropoff_${e || 'anon'}`
}

function freqStorageKey(email: string) {
  const e = String(email || '')
    .trim()
    .toLowerCase()
  return `cleanlemons_employee_transport_freq_dropoff_${e || 'anon'}`
}

function formatScheduleLabel(offset: ScheduleOffset): string {
  if (offset === 'now') return 'Now'
  const mins = offset === '15' ? 15 : 30
  const d = new Date()
  d.setMinutes(d.getMinutes() + mins)
  const t = d.toLocaleTimeString('en-MY', { timeZone: MYT, hour: '2-digit', minute: '2-digit' })
  return `In ${mins} mins (~${t} MYT)`
}

function formatCreatedMyt(iso: string) {
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

function driverHasStartedTrip(t: ClnDriverTripPayload | null | undefined): boolean {
  const x = t?.driverStartedAtUtc
  return Boolean(x && String(x).trim())
}

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

/** Order time from confirm moment + Now | 15 | 30 mins (wall time interpreted in MYT for the offset). */
function computeOrderTimeIso(createdAtIso: string, scheduleOffset: ScheduleOffset): string {
  const base = new Date(createdAtIso)
  if (Number.isNaN(base.getTime())) return new Date().toISOString()
  if (scheduleOffset === 'now') return base.toISOString()
  const mins = scheduleOffset === '15' ? 15 : 30
  const d = new Date(base.getTime())
  d.setMinutes(d.getMinutes() + mins)
  return d.toISOString()
}

function OrderAddressField({
  id,
  label,
  iconClass,
  value,
  onChange,
  showGpsButton,
  disabled,
}: {
  id: string
  label: string
  iconClass: string
  value: string
  onChange: (v: string) => void
  showGpsButton?: boolean
  disabled?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [items, setItems] = useState<AddressItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onDoc = (e: MouseEvent) => {
      if (!suggestOpen) return
      const t = e.target
      if (t instanceof Node && !el.contains(t)) setSuggestOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [suggestOpen])

  const scheduleSearch = useCallback((raw: string) => {
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
        const r = await fetchAddressSearch({ q, limit: 8 })
        setLoading(false)
        if (!r?.ok || !Array.isArray(r.items)) {
          setItems([])
          return
        }
        setItems(r.items as AddressItem[])
        if (r.items.length > 0) setSuggestOpen(true)
      })()
    }, 450)
  }, [])

  const pickSuggestion = useCallback(
    (item: AddressItem) => {
      onChange(item.displayName)
      setSuggestOpen(false)
      setItems([])
    },
    [onChange]
  )

  const handleGps = useCallback(() => {
    if (disabled) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('Location is not available in this browser')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const r = await fetchAddressSearch({ q: `${lat}, ${lng}`, limit: 5 })
        const first = r?.ok && Array.isArray(r.items) ? r.items[0] : null
        if (first?.displayName) {
          onChange(first.displayName)
          toast.success('Pick up set from current location')
        } else {
          onChange(`${lat.toFixed(6)}, ${lng.toFixed(6)} (GPS)`)
          toast.success('Coordinates saved (type or search to refine)')
        }
      },
      () => toast.error('Unable to read GPS — check permissions'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [onChange, disabled])

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium">
        <MapPin className={cn('h-4 w-4', iconClass)} aria-hidden />
        {label}
      </Label>
      <div className="flex gap-2">
        <div ref={wrapRef} className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={id}
            className="pl-9 pr-9"
            value={value}
            disabled={disabled}
            autoComplete="off"
            placeholder="Type to search (Malaysia) or enter manually"
            onChange={(e) => {
              if (disabled) return
              const v = e.target.value
              onChange(v)
              if (v.trim().length >= 3) {
                setSuggestOpen(true)
                scheduleSearch(v)
              } else {
                setItems([])
                setSuggestOpen(false)
              }
            }}
            onFocus={() => {
              if (disabled) return
              setSuggestOpen(true)
              if (value.trim().length >= 3) scheduleSearch(value)
            }}
          />
          {loading ? (
            <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
          {suggestOpen && items.length > 0 ? (
            <ul
              className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              role="listbox"
            >
              {items.map((item, idx) => (
                <li key={`${item.placeId || 'p'}-${idx}`}>
                  <button
                    type="button"
                    className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(item)}
                  >
                    {item.displayName}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {suggestOpen && !loading && items.length === 0 && value.trim().length >= 3 ? (
            <div
              className="absolute z-50 mt-1 w-full rounded-md border bg-popover px-2 py-2 text-xs text-muted-foreground shadow-md"
              role="status"
            >
              No matches — try area or street name, or paste the full address.
            </div>
          ) : null}
        </div>
        {showGpsButton ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 shrink-0"
            disabled={disabled}
            title="Use current location"
            aria-label="Use current location"
            onClick={handleGps}
          >
            <Navigation className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function scheduleOffsetFromTrip(t: ClnDriverTripPayload): ScheduleOffset {
  const s = String(t.scheduleOffset || '').toLowerCase()
  if (s === '15' || s === '30') return s
  return 'now'
}

function tripAddr(t: ClnDriverTripPayload, which: 'pickup' | 'dropoff') {
  const o = t as { pickup?: string; dropoff?: string; pickupText?: string; dropoffText?: string }
  if (which === 'pickup') return String(o.pickup ?? o.pickupText ?? '')
  return String(o.dropoff ?? o.dropoffText ?? '')
}

export default function EmployeeTransportPage() {
  const { user } = useAuth()
  const operatorId = useEffectiveOperatorId(user)
  const [pickup, setPickup] = useState('')
  const [dropoff, setDropoff] = useState('')
  const [scheduleOffset, setScheduleOffset] = useState<ScheduleOffset>('now')
  const [frequentDropoffs, setFrequentDropoffs] = useState<string[]>([])
  const [activeTrip, setActiveTrip] = useState<ClnDriverTripPayload | null>(null)
  const [tripHistory, setTripHistory] = useState<ClnDriverTripPayload[]>([])
  /** YYYY-MM-DD in MYT — filter history by end / cancel time */
  const [historyDateKey, setHistoryDateKey] = useState<string | null>(null)
  const [historyFilterOpen, setHistoryFilterOpen] = useState(false)
  const [tripLoading, setTripLoading] = useState(true)
  const [transportMainTab, setTransportMainTab] = useState<'transport' | 'history'>('transport')
  const [orderSheetOpen, setOrderSheetOpen] = useState(false)
  const [orderSheetStep, setOrderSheetStep] = useState<1 | 2>(1)
  const [postOrderWaiting, setPostOrderWaiting] = useState(false)
  const [driverOpenJobs, setDriverOpenJobs] = useState<ClnDriverTripPayload[]>([])
  const [driverActive, setDriverActive] = useState<ClnDriverTripPayload | null>(null)
  const [driverPanelLoading, setDriverPanelLoading] = useState(false)

  const isNarrow = useMediaQuery('(max-width: 1023px)', false)

  const emailKey = useMemo(() => String(user?.email || '').trim().toLowerCase(), [user?.email])
  const formLocked = activeTrip != null

  const filteredTripHistory = useMemo(() => {
    if (!historyDateKey) return tripHistory
    return tripHistory.filter((h) => {
      const cancelled = String(h.status) === 'cancelled'
      const endKey = cancelled
        ? utcIsoToMytDateKey(h.updatedAtUtc) || utcIsoToMytDateKey(h.createdAtUtc)
        : utcIsoToMytDateKey(h.completedAtUtc) || utcIsoToMytDateKey(h.updatedAtUtc)
      return endKey === historyDateKey
    })
  }, [tripHistory, historyDateKey])

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(freqStorageKey(emailKey)) ?? localStorage.getItem(freqStorageKeyLegacy(emailKey))
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        setFrequentDropoffs(
          [...new Set(parsed.map((x) => String(x).trim()).filter(Boolean))].slice(0, 10)
        )
      }
    } catch {
      /* ignore */
    }
  }, [emailKey])

  const refreshOrderData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    const oid = String(operatorId || '').trim()
    if (!oid) {
      setActiveTrip(null)
      setTripHistory([])
      setTripLoading(false)
      return
    }
    if (!silent) setTripLoading(true)
    try {
      const [rActive, rHist] = await Promise.all([
        fetchRequesterActiveDriverTrip(oid),
        fetchRequesterDriverTripHistory(oid, 80),
      ])
      if (rActive.ok) setActiveTrip(rActive.trip ?? null)
      else setActiveTrip(null)
      if (rHist.ok && Array.isArray(rHist.items)) setTripHistory(rHist.items)
      else setTripHistory([])
    } catch {
      setActiveTrip(null)
      setTripHistory([])
    } finally {
      if (!silent) setTripLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    void refreshOrderData()
  }, [refreshOrderData])

  useEffect(() => {
    const oid = String(operatorId || '').trim()
    if (!oid) return
    const t = window.setInterval(() => void refreshOrderData({ silent: true }), 12000)
    return () => clearInterval(t)
  }, [operatorId, refreshOrderData])

  useEffect(() => {
    if (!postOrderWaiting || !activeTrip) return
    const st = String(activeTrip.status || '')
    if (st !== 'pending') {
      setPostOrderWaiting(false)
      setOrderSheetOpen(false)
      setOrderSheetStep(1)
      toast.success(
        st === 'grab_booked' ? 'Operator confirmed your route (Grab / booking).' : 'Driver accepted your route.'
      )
    }
  }, [activeTrip, postOrderWaiting])

  useEffect(() => {
    if (!postOrderWaiting) return
    const t = window.setInterval(() => void refreshOrderData({ silent: true }), 2500)
    return () => clearInterval(t)
  }, [postOrderWaiting, refreshOrderData])

  useEffect(() => {
    if (activeTrip) {
      setPickup(tripAddr(activeTrip, 'pickup'))
      setDropoff(tripAddr(activeTrip, 'dropoff'))
      setScheduleOffset(scheduleOffsetFromTrip(activeTrip))
    }
  }, [activeTrip])

  const persistFrequent = useCallback(
    (nextList: string[]) => {
      setFrequentDropoffs(nextList)
      try {
        localStorage.setItem(freqStorageKey(emailKey), JSON.stringify(nextList))
      } catch {
        /* ignore */
      }
    },
    [emailKey]
  )

  const submitOrderRequest = useCallback(
    async (fromMobileWizard: boolean) => {
      if (formLocked) {
        toast.error('You already have a route waiting for a driver. Cancel it first to request again.')
        return false
      }
      const oid = String(operatorId || '').trim()
      if (!oid) {
        toast.error('Select a company (operator) in the header, then try again.')
        return false
      }
      const p = pickup.trim()
      const d = dropoff.trim()
      if (!p || !d) {
        toast.error('Enter pick up and drop off')
        return false
      }
      if (p === d) {
        toast.error('Pick up and drop off must be different')
        return false
      }
      const nextFreq = [d, ...frequentDropoffs.filter((x) => x !== d)].slice(0, 10)
      persistFrequent(nextFreq)

      const createdAtIso = new Date().toISOString()
      const orderTimeIso = computeOrderTimeIso(createdAtIso, scheduleOffset)
      const r = await postEmployeeDriverTrip({
        operatorId: oid,
        pickup: p,
        dropoff: d,
        scheduleOffset,
        orderTimeIso,
      })
      if (!r.ok) {
        if (r.reason === 'ACTIVE_TRIP_EXISTS') {
          toast.error('You already have an active route. Refresh or cancel it first.')
          void refreshOrderData({ silent: true })
        } else {
          toast.error(r.reason === 'OPERATOR_ACCESS_DENIED' ? 'No access to this company.' : 'Could not save route.')
        }
        return false
      }
      setActiveTrip((r.trip as ClnDriverTripPayload) ?? null)
      if (fromMobileWizard) {
        setPostOrderWaiting(true)
      } else {
        toast.success(
          `Route sent · Scheduled ${formatCreatedMyt(orderTimeIso)} (MYT) — waiting for driver`
        )
      }
      return true
    },
    [formLocked, operatorId, pickup, dropoff, scheduleOffset, frequentDropoffs, persistFrequent, refreshOrderData]
  )

  const handleSubmit = () => void submitOrderRequest(false)

  const openOrderSheet = () => {
    if (!String(operatorId || '').trim()) {
      toast.error('Select a company (operator) in the header, then try again.')
      return
    }
    setOrderSheetStep(1)
    setPostOrderWaiting(false)
    setOrderSheetOpen(true)
  }

  const onOrderSheetOpenChange = (open: boolean) => {
    if (!open && postOrderWaiting) return
    setOrderSheetOpen(open)
    if (!open) {
      setOrderSheetStep(1)
      setPostOrderWaiting(false)
    }
  }

  const goSheetNext = () => {
    const p = pickup.trim()
    const d = dropoff.trim()
    if (!p || !d) {
      toast.error('Enter pick up and drop off')
      return
    }
    if (p === d) {
      toast.error('Pick up and drop off must be different')
      return
    }
    setOrderSheetStep(2)
  }

  const handleSheetConfirm = () => void submitOrderRequest(true)

  const handleCancelPending = () => {
    const oid = String(operatorId || '').trim()
    const tid = activeTrip?.id
    if (!tid || !oid) {
      setActiveTrip(null)
      setPickup('')
      setDropoff('')
      setScheduleOffset('now')
      toast.message('Route request cancelled — you can request a new transport')
      return
    }
    void (async () => {
      const r = await postRequesterCancelDriverTrip({ operatorId: oid, tripId: tid })
      if (!r.ok) {
        toast.error(r.reason === 'TRIP_NOT_CANCELLABLE' ? 'This trip can no longer be cancelled.' : 'Could not cancel.')
        void refreshOrderData({ silent: true })
        return
      }
      setActiveTrip(null)
      setPickup('')
      setDropoff('')
      setScheduleOffset('now')
      toast.message('Route request cancelled — you can request a new transport')
      void refreshOrderData({ silent: true })
    })()
  }

  const orderRouteDescription = formLocked ? (
    <CardDescription>
      <span className="font-medium text-amber-800 dark:text-amber-200">
        One active route at a time — cancel below before requesting again.
      </span>
    </CardDescription>
  ) : null

  const orderAddressFields = (
    <>
      <OrderAddressField
        id="order-pickup"
        label="Pick up"
        iconClass="text-emerald-600"
        value={pickup}
        onChange={setPickup}
        showGpsButton
        disabled={formLocked}
      />

      <OrderAddressField
        id="order-dropoff"
        label="Drop off"
        iconClass="text-sky-600"
        value={dropoff}
        onChange={setDropoff}
        disabled={formLocked}
      />

      {frequentDropoffs.length > 0 && !formLocked ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Frequent drop-off</p>
          <div className="flex flex-wrap gap-2">
            {frequentDropoffs.map((loc) => (
              <button
                key={loc}
                type="button"
                className="max-w-full truncate rounded-full border border-border bg-muted/40 px-3 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
                title={loc}
                onClick={() => {
                  setDropoff(loc)
                  toast.message('Drop off filled from history')
                }}
              >
                {loc.length > 48 ? `${loc.slice(0, 48)}…` : loc}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )

  const orderWhenFields = (
    <div className="space-y-2">
      <Label className="text-sm font-medium">When</Label>
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'now' as const, label: 'Now' },
            { id: '15' as const, label: '15 mins' },
            { id: '30' as const, label: '30 mins' },
          ] as const
        ).map((opt) => (
          <Button
            key={opt.id}
            type="button"
            size="sm"
            variant={scheduleOffset === opt.id ? 'default' : 'outline'}
            className={cn(scheduleOffset === opt.id && 'bg-primary')}
            disabled={formLocked}
            onClick={() => setScheduleOffset(opt.id)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {scheduleOffset === 'now'
          ? 'Start as soon as you confirm.'
          : `Approx. arrival window: ${formatScheduleLabel(scheduleOffset)}.`}
      </p>
    </div>
  )

  const orderRouteFields = (
    <fieldset disabled={formLocked} className="min-w-0 space-y-4 border-0 p-0 m-0">
      {orderAddressFields}
      {orderWhenFields}
    </fieldset>
  )

  const orderRouteFooter = (
    <CardFooter className="flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
      <Button type="button" className="w-full sm:w-auto" onClick={handleSubmit} disabled={formLocked}>
        Confirm route
      </Button>
    </CardFooter>
  )

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-3 pb-24 pt-1 sm:px-4 lg:pb-8">
      <Tabs value={transportMainTab} onValueChange={(v) => setTransportMainTab(v as 'transport' | 'history')} className="gap-3">
        <TabsList className="grid h-10 w-full grid-cols-2">
          <TabsTrigger value="transport">Transport</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="transport" className="mt-0 space-y-4 focus-visible:outline-none">
      {tripLoading ? (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading your route status…
          </CardContent>
        </Card>
      ) : null}

      {!tripLoading && !activeTrip ? (
        <div className="hidden lg:block">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Transport route</CardTitle>
              {orderRouteDescription}
            </CardHeader>
            <CardContent className="space-y-4">{orderRouteFields}</CardContent>
            {orderRouteFooter}
          </Card>
        </div>
      ) : null}

      {!tripLoading && !activeTrip ? (
        <div className="flex min-h-[32vh] flex-col items-center justify-center lg:hidden">
          <Button
            type="button"
            size="icon"
            className="h-24 w-24 shrink-0 rounded-full text-lg font-semibold shadow-md"
            onClick={openOrderSheet}
            disabled={!String(operatorId || '').trim()}
          >
            Transport
          </Button>
          <p className="mt-4 max-w-xs text-center text-sm text-muted-foreground">
            {String(operatorId || '').trim()
              ? 'Tap to choose pick up, drop off, and time.'
              : 'Select a company in the header first.'}
          </p>
        </div>
      ) : null}

      {!tripLoading && activeTrip ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <Truck className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 break-words">
                  {String(activeTrip.status) === 'grab_booked' ? 'Grab booked' : 'Driver route'}
                </span>
              </CardTitle>
              <Badge
                variant="secondary"
                className={cn(
                  'w-fit max-w-full shrink-0 self-start whitespace-normal text-left text-xs font-normal leading-snug sm:max-w-[min(100%,14rem)] sm:self-center sm:text-right',
                  String(activeTrip.status) === 'driver_accepted' &&
                    driverHasStartedTrip(activeTrip) &&
                    'border border-emerald-600/35 bg-emerald-100 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-50'
                )}
              >
                {String(activeTrip.status) === 'pending' ? (
                  <>
                    <span className="sm:hidden">Waiting</span>
                    <span className="hidden sm:inline">Waiting for assignment</span>
                  </>
                ) : String(activeTrip.status) === 'driver_accepted' ? (
                  driverHasStartedTrip(activeTrip) ? (
                    <>
                      <span className="sm:hidden">In progress</span>
                      <span className="hidden sm:inline">Trip in progress</span>
                    </>
                  ) : (
                    <>
                      <span className="sm:hidden">Accepted</span>
                      <span className="hidden sm:inline">Driver accepted</span>
                    </>
                  )
                ) : String(activeTrip.status) === 'grab_booked' ? (
                  'Grab'
                ) : (
                  String(activeTrip.status)
                )}
              </Badge>
            </div>
            <CardDescription className="space-y-1">
              <span className="block">
                Submitted{' '}
                {formatCreatedMyt(activeTrip.createdAtUtc || new Date().toISOString())} · Malaysia time (MYT)
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">Scheduled</p>
              <p className="text-base font-semibold text-foreground">
                {formatCreatedMyt(activeTrip.orderTimeUtc || new Date().toISOString())}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {scheduleOffsetFromTrip(activeTrip) === 'now'
                  ? 'As soon as possible (same as submit time).'
                  : `Scheduled ${scheduleOffsetFromTrip(activeTrip) === '15' ? '15' : '30'} minutes after submit.`}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Pick up</p>
              <p className="break-words text-foreground">{tripAddr(activeTrip, 'pickup')}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Drop off</p>
              <p className="break-words text-foreground">{tripAddr(activeTrip, 'dropoff')}</p>
            </div>
            <div className="rounded-md border border-border/80 bg-background/80 px-3 py-2">
              <p className="text-xs text-muted-foreground">When (choice)</p>
              <p className="font-medium text-foreground">{formatScheduleLabel(scheduleOffsetFromTrip(activeTrip))}</p>
            </div>

            {String(activeTrip.status) === 'driver_accepted' ? (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-3 space-y-2">
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">Assigned driver</p>
                {driverHasStartedTrip(activeTrip) ? (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    Heading to drop-off · started {formatCreatedMyt(activeTrip.driverStartedAtUtc || '')}
                  </p>
                ) : null}
                {activeTrip.acceptedDriverFullName ? (
                  <p className="font-medium text-foreground">{activeTrip.acceptedDriverFullName}</p>
                ) : null}
                {activeTrip.acceptedDriverPhone ? (
                  <p className="text-sm text-foreground">
                    <span className="text-muted-foreground">Contact: </span>
                    {activeTrip.acceptedDriverPhone}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Contact: —</p>
                )}
                {activeTrip.acceptedDriverCarPlate ? (
                  <p className="text-sm text-foreground">
                    <span className="text-muted-foreground">Car plate: </span>
                    {activeTrip.acceptedDriverCarPlate}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Car plate: — (driver can add in Driver → Vehicle)</p>
                )}
                {activeTrip.acceptedDriverCarFrontUrl || activeTrip.acceptedDriverCarBackUrl ? (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {activeTrip.acceptedDriverCarFrontUrl ? (
                      <a
                        href={activeTrip.acceptedDriverCarFrontUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-md border border-border bg-background"
                      >
                        <img
                          src={activeTrip.acceptedDriverCarFrontUrl}
                          alt="Car front"
                          className="h-24 w-full object-cover"
                        />
                        <p className="px-1 py-0.5 text-center text-[10px] text-muted-foreground">Front</p>
                      </a>
                    ) : null}
                    {activeTrip.acceptedDriverCarBackUrl ? (
                      <a
                        href={activeTrip.acceptedDriverCarBackUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-md border border-border bg-background"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={activeTrip.acceptedDriverCarBackUrl}
                          alt="Car back"
                          className="h-24 w-full object-cover"
                        />
                        <p className="px-1 py-0.5 text-center text-[10px] text-muted-foreground">Back</p>
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {String(activeTrip.status) === 'grab_booked' ? (
              <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-3 space-y-1.5">
                <p className="text-xs font-semibold text-sky-900 dark:text-sky-100">Grab / operator booking</p>
                <p className="text-sm text-foreground">
                  <span className="text-muted-foreground">Plate: </span>
                  {activeTrip.grabCarPlate || '—'}
                </p>
                <p className="text-sm text-foreground">
                  <span className="text-muted-foreground">Contact: </span>
                  {activeTrip.grabPhone || '—'}
                </p>
                {activeTrip.grabProofImageUrl ? (
                  <a
                    href={activeTrip.grabProofImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-md border border-border bg-background"
                  >
                    <img
                      src={activeTrip.grabProofImageUrl}
                      alt="Booking proof"
                      className="max-h-48 w-full object-contain"
                    />
                    <p className="py-1 text-center text-xs text-primary underline">Open full size</p>
                  </a>
                ) : null}
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="flex-col gap-2 border-t sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={handleCancelPending}
              disabled={String(activeTrip.status) !== 'pending'}
            >
              Cancel request
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      <Sheet open={orderSheetOpen} onOpenChange={onOrderSheetOpenChange}>
        <SheetContent
          side="bottom"
          className="flex max-h-[min(92dvh,880px)] flex-col gap-0 overflow-hidden rounded-t-2xl border-t p-0"
          onPointerDownOutside={(e) => {
            if (postOrderWaiting) e.preventDefault()
          }}
        >
          {postOrderWaiting ? (
            <div className="flex flex-col items-center px-4 py-20">
              <Loader2 className="h-12 w-12 animate-spin text-primary" aria-hidden />
              <p className="mt-6 text-center text-base font-medium">Waiting for driver or operator…</p>
              <p className="mt-2 max-w-xs text-center text-sm text-muted-foreground">
                This closes automatically when someone accepts your route.
              </p>
            </div>
          ) : orderSheetStep === 1 ? (
            <>
              <SheetHeader className="shrink-0 border-b border-border px-4 pb-3 pt-4 text-left">
                <SheetTitle>Route</SheetTitle>
                <SheetDescription>Pick up, drop off, and saved addresses.</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-4">{orderAddressFields}</div>
              </div>
              <div className="shrink-0 border-t border-border p-4">
                <Button type="button" className="w-full" onClick={goSheetNext}>
                  Next
                </Button>
              </div>
            </>
          ) : (
            <>
              <SheetHeader className="shrink-0 border-b border-border px-4 pb-3 pt-4 text-left">
                <SheetTitle>When</SheetTitle>
                <SheetDescription>Choose time window (Malaysia).</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{orderWhenFields}</div>
              <div className="flex shrink-0 gap-2 border-t border-border p-4">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setOrderSheetStep(1)}>
                  Back
                </Button>
                <Button type="button" className="flex-1" onClick={handleSheetConfirm}>
                  Confirm transport
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
        </TabsContent>

        <TabsContent value="history" className="mt-0 focus-visible:outline-none">
      {!tripLoading && String(operatorId || '').trim() ? (
        <Card className="border-border/80">
          <CardHeader className="space-y-0 pb-2">
            <Collapsible open={historyFilterOpen} onOpenChange={setHistoryFilterOpen}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <History className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    <CardTitle className="text-lg">Transport history</CardTitle>
                  </div>
                  <CardDescription>
                    Past routes — completed or cancelled
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
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Filter by end / cancel date (MYT)</p>
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
            {tripHistory.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">No past transports yet.</p>
            ) : filteredTripHistory.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                No routes on this date. Try another day or tap All.
              </p>
            ) : (
              <ul className="space-y-3">
                {filteredTripHistory.map((h) => {
                  const cancelled = String(h.status) === 'cancelled'
                  return (
                    <li
                      key={h.id}
                      className={cn(
                        'rounded-xl border border-border/80 bg-muted/15 px-3 py-3 text-sm',
                        cancelled && 'opacity-90'
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge variant={cancelled ? 'secondary' : 'default'}>
                          {cancelled ? 'Cancelled' : 'Completed'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {cancelled
                            ? formatCreatedMyt(h.updatedAtUtc || h.createdAtUtc)
                            : formatCreatedMyt(h.completedAtUtc || h.updatedAtUtc)}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Pick up</p>
                        <p className="break-words text-foreground">{tripAddr(h, 'pickup')}</p>
                        <p className="pt-1 text-xs font-medium text-muted-foreground">Drop off</p>
                        <p className="break-words text-foreground">{tripAddr(h, 'dropoff')}</p>
                      </div>
                      {!cancelled ? (
                        <div className="mt-3 space-y-1 border-t border-border/50 pt-2 text-xs">
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">Accept</span>
                            <span className="shrink-0 tabular-nums text-foreground">{formatCreatedMyt(h.acceptedAtUtc)}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">Start</span>
                            <span className="shrink-0 tabular-nums text-foreground">{formatCreatedMyt(h.driverStartedAtUtc)}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">End</span>
                            <span className="shrink-0 tabular-nums text-foreground">{formatCreatedMyt(h.completedAtUtc)}</span>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!tripLoading && !String(operatorId || '').trim() ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Select a company in the header to see history.</p>
      ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}
