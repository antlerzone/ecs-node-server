"use client"

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import {
  createClientScheduleJob,
  fetchCleanlemonPricingConfig,
  fetchClientPortalProperties,
  fetchClientPortalPropertyDetail,
  fetchClientScheduleJobs,
  fetchOperatorSettings,
  updateClientScheduleJob,
  type CleanlemonPricingConfig,
  type ClientPortalPropertyDetail,
} from '@/lib/cleanlemon-api'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Clock, Plus, ChevronRight, CheckCircle2 } from 'lucide-react'
import { PRICING_SERVICES, serviceKeyToScheduleServiceProvider, type ServiceKey } from '@/lib/cleanlemon-pricing-services'
import {
  collectJobAddonOptions,
  jobAddonLineTotal,
} from '@/lib/cleanlemon-schedule-pricing-addons'
import {
  buildCreateJobPriceSummary,
  getCreateJobMinSellingPrice,
  type PropertyFeeHints,
} from '@/lib/cleanlemon-create-job-price-summary'
import {
  buildScheduleEndSlotOptions,
  buildScheduleStartSlotOptions,
  getCreateJobScheduleTimeStepMinutes,
  scheduleTimeSlotToMinutes,
} from '@/lib/cleanlemon-schedule-time-slots'
import {
  parseOperatorCompanyHoursFromProfile,
  computeSurchargeApplySegments,
  computeOutOfWorkingHourSurcharge,
  parseMarkupNumeric,
  getBookableDayBoundsMin,
  type OperatorCompanyHoursInput,
} from '@/lib/cleanlemon-company-working-hours'
import {
  getEarliestBookableMalaysiaYmd,
  getMalaysiaCalendarYmd,
  validateBookingLeadTimeForConfig,
} from '@/lib/cleanlemon-booking-eligibility'

interface ScheduleItem {
  id: string
  propertyId?: string
  operatorId?: string
  property: string
  unit: string
  cleaningType: string
  time: string
  /** Normalized API status: pending-checkout, ready-to-clean, in-progress, completed, cancelled */
  scheduleStatus: string
  date: string
  team?: string
}

function propertyFeeHintsFromDetail(prop: ClientPortalPropertyDetail | null): PropertyFeeHints | null {
  if (!prop?.pricing?.length) return null
  const pickNum = (key: string) => {
    const row = prop.pricing.find((p) => p.key === key)
    if (!row?.display) return null
    const n = parseFloat(String(row.display).replace(/[^\d.]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return {
    generalCleaning: pickNum('generalCleaning'),
    cleaningFees: pickNum('homestayCleaning'),
    warmCleaning: pickNum('warmCleaning'),
    deepCleaning: pickNum('deepCleaning'),
    renovationCleaning: pickNum('renovationCleaning'),
  }
}

function pickBookingModeForService(
  cfg: Record<string, unknown> | null | undefined,
  serviceKey: ServiceKey
): 'instant' | 'request_approve' {
  if (!cfg || typeof cfg !== 'object') return 'instant'
  const globalMode = String((cfg as CleanlemonPricingConfig).bookingMode || 'instant')
    .trim()
    .toLowerCase()
  const bySvc = (cfg as CleanlemonPricingConfig).bookingModeByService
  const o =
    bySvc && typeof bySvc === 'object' ? String((bySvc as Record<string, string>)[serviceKey] || '').trim().toLowerCase() : ''
  const g = o || globalMode
  if (g === 'request_approve' || (g.includes('request') && !g.includes('instant'))) return 'request_approve'
  return 'instant'
}

function clientScheduleBadgeLabel(status: string): string {
  const s = String(status || '').toLowerCase()
  if (s === 'pending-checkout') return 'Pending approval'
  if (s === 'ready-to-clean') return 'Confirmed'
  if (s.includes('progress')) return 'In progress'
  if (s.includes('complete') || s === 'done') return 'Completed'
  if (s.includes('cancel')) return 'Cancelled'
  return 'Scheduled'
}

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

export default function ClientSchedulePage() {
  const { user } = useAuth()
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [showNewBooking, setShowNewBooking] = useState(false)
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])
  const [properties, setProperties] = useState<
    Array<{ id: string; name: string; unitNumber?: string; operatorId?: string }>
  >([])
  const [bookingPropertyId, setBookingPropertyId] = useState('')
  const [bookingServiceKey, setBookingServiceKey] = useState<ServiceKey>('general')
  /** YYYY-MM-DD — same control as operator/schedule Create Job (`Input type="date"`). */
  const [bookingDateYmd, setBookingDateYmd] = useState(() => getMalaysiaCalendarYmd())
  const [bookingTimeStart, setBookingTimeStart] = useState('')
  const [bookingTimeEnd, setBookingTimeEnd] = useState('')
  const [pricingConfigCache, setPricingConfigCache] = useState<Record<string, unknown> | null>(null)
  const [operatorCompanyHours, setOperatorCompanyHours] = useState<OperatorCompanyHoursInput | null>(null)
  const [propertyDetail, setPropertyDetail] = useState<ClientPortalPropertyDetail | null>(null)
  const [createJobAddonDraft, setCreateJobAddonDraft] = useState<Record<string, { selected: boolean; qty: number }>>({})
  const [bookingRemark, setBookingRemark] = useState('')
  const [submittingBooking, setSubmittingBooking] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [rescheduleTarget, setRescheduleTarget] = useState<ScheduleItem | null>(null)
  const [rescheduleYmd, setRescheduleYmd] = useState('')
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false)
  const [scheduleRefreshTick, setScheduleRefreshTick] = useState(0)

  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === bookingPropertyId),
    [properties, bookingPropertyId]
  )
  const propertyOperatorId = String(selectedProperty?.operatorId || user?.operatorId || '').trim()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const email = String(user?.email || '').trim().toLowerCase()
      const operatorId = String(user?.operatorId || '').trim()
      if (!email || !operatorId) {
        setProperties([])
        setSchedules([])
        return
      }
      const [propRes, jobRes] = await Promise.all([
        fetchClientPortalProperties(email, operatorId),
        fetchClientScheduleJobs(email, operatorId, { limit: 200 }),
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
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email, user?.operatorId, scheduleRefreshTick])

  useEffect(() => {
    if (!bookingPropertyId || !propertyOperatorId || !user?.email) {
      setPricingConfigCache(null)
      setOperatorCompanyHours(null)
      setPropertyDetail(null)
      setBookingServiceKey('general')
      setBookingTimeStart('')
      setBookingTimeEnd('')
      setCreateJobAddonDraft({})
      return
    }
    let cancelled = false
    const email = String(user.email || '').trim().toLowerCase()
    ;(async () => {
      const [cfgRes, settingsRes, detailRes] = await Promise.all([
        fetchCleanlemonPricingConfig(propertyOperatorId),
        fetchOperatorSettings(propertyOperatorId),
        fetchClientPortalPropertyDetail(email, propertyOperatorId, bookingPropertyId),
      ])
      if (cancelled) return
      const cfg = (cfgRes?.config || {}) as Record<string, unknown>
      setPricingConfigCache(cfg)
      const s = (settingsRes as { settings?: { companyProfile?: Record<string, unknown> } })?.settings || {}
      setOperatorCompanyHours(parseOperatorCompanyHoursFromProfile(s.companyProfile && typeof s.companyProfile === 'object' ? s.companyProfile : null))
      if (detailRes?.ok && detailRes.property) setPropertyDetail(detailRes.property)
      else setPropertyDetail(null)

      const selectedServices = Array.isArray(cfg.selectedServices) ? (cfg.selectedServices as string[]) : []
      const keys = selectedServices.length === 0 ? PRICING_SERVICES.map((s) => s.key) : selectedServices
      const set = new Set(keys)
      const firstAllowed = PRICING_SERVICES.find((s) => set.has(s.key))?.key ?? 'general'
      setBookingServiceKey((prev) => (set.has(prev) ? prev : firstAllowed))
    })()
    return () => {
      cancelled = true
    }
  }, [bookingPropertyId, propertyOperatorId, user?.email])

  const scheduleServiceOptions = useMemo(() => {
    const cfg = pricingConfigCache
    const keys =
      cfg == null || !Array.isArray((cfg as CleanlemonPricingConfig).selectedServices) || (cfg as CleanlemonPricingConfig).selectedServices!.length === 0
        ? PRICING_SERVICES.map((s) => s.key)
        : ((cfg as CleanlemonPricingConfig).selectedServices as string[])
    const set = new Set(keys)
    return PRICING_SERVICES.filter((s) => set.has(s.key))
  }, [pricingConfigCache])

  const pricingServiceConfigs = useMemo(() => {
    const c = pricingConfigCache?.serviceConfigs
    return c && typeof c === 'object' ? (c as Record<string, unknown>) : null
  }, [pricingConfigCache])

  const requiresTime = bookingServiceKey !== 'homestay'

  const scheduleTimeStepMinutes = useMemo(
    () => getCreateJobScheduleTimeStepMinutes(bookingServiceKey, pricingServiceConfigs ?? undefined),
    [bookingServiceKey, pricingServiceConfigs]
  )

  const scheduleDayBounds = useMemo(() => {
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

  const scheduleStartTimeOptions = useMemo(
    () => buildScheduleStartSlotOptions(scheduleTimeStepMinutes, scheduleDayBounds),
    [scheduleTimeStepMinutes, scheduleDayBounds]
  )

  const scheduleEndTimeOptions = useMemo(() => {
    if (!bookingTimeStart) return []
    return buildScheduleEndSlotOptions(bookingTimeStart, scheduleTimeStepMinutes, scheduleDayBounds)
  }, [bookingTimeStart, scheduleTimeStepMinutes, scheduleDayBounds])

  /** Same rules as operator/schedule Create Job: slots from Company out-of-hours from/to (bookable window); step from Pricing. */
  const timeWindowGateHints = useMemo(() => {
    const stepLabel =
      scheduleTimeStepMinutes >= 60
        ? `${scheduleTimeStepMinutes / 60} hour(s) per block (Finance → Pricing)`
        : `${scheduleTimeStepMinutes} min steps (Finance → Pricing)`
    if (!operatorCompanyHours) {
      return {
        stepLabel,
        workingLine: null as string | null,
        bookableLine:
          'Start/end lists use 06:00–24:00 until Company sets out-of-hours from/to (same as operator schedule).',
      }
    }
    const wf = String(operatorCompanyHours.workingHourFrom || '').trim()
    const wt = String(operatorCompanyHours.workingHourTo || '').trim()
    const of = String(operatorCompanyHours.outOfWorkingHourFrom || '').trim()
    const ot = String(operatorCompanyHours.outOfWorkingHourTo || '').trim()
    const workingLine = wf && wt ? `Company working hours: ${wf}–${wt} (used for out-of-hours surcharge)` : null
    const bookableLine =
      of && ot
        ? `Bookable slot range: ${of}–${ot} (from Company out-of-hours — matches operator Create Job)`
        : 'Set Company out-of-hours from/to to limit slots; otherwise 06:00–24:00.'
    return { stepLabel, workingLine, bookableLine }
  }, [operatorCompanyHours, scheduleTimeStepMinutes])

  useEffect(() => {
    setBookingTimeStart('')
    setBookingTimeEnd('')
  }, [bookingServiceKey, scheduleTimeStepMinutes, scheduleDayBounds])

  const createJobAddonOptions = useMemo(
    () => collectJobAddonOptions(bookingServiceKey, pricingServiceConfigs),
    [bookingServiceKey, pricingServiceConfigs]
  )

  const createJobAddonSignature = useMemo(
    () => createJobAddonOptions.map((o) => `${o.id}:${o.name}:${o.basis}:${o.price}`).join('|'),
    [createJobAddonOptions]
  )

  useEffect(() => {
    const opts = collectJobAddonOptions(bookingServiceKey, pricingServiceConfigs)
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
  }, [createJobAddonSignature, bookingServiceKey, pricingServiceConfigs])

  const createJobSelectedAddonTotal = useMemo(() => {
    let sum = 0
    for (const o of createJobAddonOptions) {
      if (!createJobAddonDraft[o.id]?.selected) continue
      const qty = o.basis === 'fixed' ? 1 : Math.max(1, Math.floor(createJobAddonDraft[o.id]?.qty ?? 1))
      sum += jobAddonLineTotal(o.price, o.basis, qty)
    }
    return Math.round(sum * 100) / 100
  }, [createJobAddonOptions, createJobAddonDraft])

  const createJobDurationHours = useMemo(() => {
    if (!requiresTime || !bookingTimeStart || !bookingTimeEnd) return null
    const a = scheduleTimeSlotToMinutes(bookingTimeStart)
    const b = scheduleTimeSlotToMinutes(bookingTimeEnd)
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null
    return (b - a) / 60
  }, [requiresTime, bookingTimeStart, bookingTimeEnd])

  const propertyFees = useMemo(() => propertyFeeHintsFromDetail(propertyDetail), [propertyDetail])

  const createJobPriceSummary = useMemo(() => {
    const premisesType = propertyDetail?.premisesType
    return buildCreateJobPriceSummary(bookingServiceKey, pricingServiceConfigs, {
      premisesType,
      durationHours: createJobDurationHours,
      propertyFees,
    })
  }, [bookingServiceKey, pricingServiceConfigs, propertyDetail, createJobDurationHours, propertyFees])

  const createJobMinSelling = useMemo(
    () => getCreateJobMinSellingPrice(bookingServiceKey, pricingServiceConfigs ?? undefined),
    [bookingServiceKey, pricingServiceConfigs]
  )

  const createJobCoreSubtotal = useMemo(() => {
    const base = createJobPriceSummary.indicativeBaseAmount
    if (base == null) return null
    return Math.round((base + createJobSelectedAddonTotal) * 100) / 100
  }, [createJobPriceSummary.indicativeBaseAmount, createJobSelectedAddonTotal])

  const createJobCoreFloorForCharge = useMemo(() => {
    if (createJobCoreSubtotal == null) return null
    if (createJobMinSelling <= 0) return createJobCoreSubtotal
    return Math.max(createJobCoreSubtotal, createJobMinSelling)
  }, [createJobCoreSubtotal, createJobMinSelling])

  const createJobOohSurcharge = useMemo(() => {
    if (!requiresTime || !bookingTimeStart || !bookingTimeEnd || !operatorCompanyHours) return 0
    const a = scheduleTimeSlotToMinutes(bookingTimeStart)
    const b = scheduleTimeSlotToMinutes(bookingTimeEnd)
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
  }, [requiresTime, bookingTimeStart, bookingTimeEnd, operatorCompanyHours, surchargeSegments, createJobCoreFloorForCharge])

  /** Same pipeline as operator Summary: buildCreateJobPriceSummary → +addons → max(min selling) → +OOH → total. */
  const createJobIndicativeGrandTotal = useMemo(() => {
    if (createJobCoreFloorForCharge == null) return null
    return Math.round((createJobCoreFloorForCharge + createJobOohSurcharge) * 100) / 100
  }, [createJobCoreFloorForCharge, createJobOohSurcharge])

  const createJobMeetsMinimum =
    createJobMinSelling <= 0 || (createJobCoreSubtotal != null && createJobCoreSubtotal >= createJobMinSelling)

  const leadTimeRaw = String(pricingConfigCache?.leadTime || 'same_day')

  const earliestBookableYmd = useMemo(
    () => getEarliestBookableMalaysiaYmd(leadTimeRaw),
    [leadTimeRaw]
  )

  const selectedDateYmd = /^\d{4}-\d{2}-\d{2}$/.test(bookingDateYmd) ? bookingDateYmd : ''

  const leadTimeCheck = useMemo(() => {
    if (!selectedDateYmd || !pricingConfigCache) return { ok: false as const, message: 'Loading pricing…' }
    return validateBookingLeadTimeForConfig({
      leadTimeRaw,
      dateYmd: selectedDateYmd,
      timeHm: requiresTime ? bookingTimeStart : undefined,
      isHomestay: bookingServiceKey === 'homestay',
    })
  }, [selectedDateYmd, pricingConfigCache, leadTimeRaw, requiresTime, bookingTimeStart, bookingServiceKey])

  const isInstantBooking = pickBookingModeForService(pricingConfigCache, bookingServiceKey) === 'instant'

  /** Client cannot edit RM — only system-calculated total (same formula as operator Summary). */
  const computedTotalCharge = createJobIndicativeGrandTotal

  const canSubmitBooking = useMemo(() => {
    if (!bookingPropertyId || !scheduleServiceOptions.length) return false
    if (!selectedDateYmd) return false
    if (requiresTime && (!bookingTimeStart || !bookingTimeEnd)) return false
    if (requiresTime) {
      const a = scheduleTimeSlotToMinutes(bookingTimeStart)
      const b = scheduleTimeSlotToMinutes(bookingTimeEnd)
      if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return false
      const dur = b - a
      if (dur < scheduleTimeStepMinutes || dur % scheduleTimeStepMinutes !== 0) return false
    }
    if (!leadTimeCheck.ok) return false
    if (createJobMinSelling > 0 && !createJobMeetsMinimum) return false
    if (computedTotalCharge == null || !Number.isFinite(computedTotalCharge)) return false
    return true
  }, [
    bookingPropertyId,
    scheduleServiceOptions.length,
    selectedDateYmd,
    requiresTime,
    bookingTimeStart,
    bookingTimeEnd,
    scheduleTimeStepMinutes,
    leadTimeCheck.ok,
    createJobMinSelling,
    createJobMeetsMinimum,
    computedTotalCharge,
  ])

  const openBookingDialog = (open: boolean) => {
    setShowNewBooking(open)
    if (open) {
      setBookingDateYmd(getMalaysiaCalendarYmd())
      setBookingPropertyId('')
      setBookingServiceKey('general')
      setBookingTimeStart('')
      setBookingTimeEnd('')
      setBookingRemark('')
    }
  }

  useEffect(() => {
    if (!bookingPropertyId || !earliestBookableYmd) return
    if (bookingDateYmd && bookingDateYmd < earliestBookableYmd) {
      setBookingDateYmd(earliestBookableYmd)
    }
  }, [bookingPropertyId, earliestBookableYmd, bookingDateYmd])

  const handleBookCleaning = async () => {
    const email = String(user?.email || '').trim().toLowerCase()
    const oid = propertyOperatorId
    if (!email || !oid) {
      toast.error('Sign in required')
      return
    }
    if (!canSubmitBooking) {
      if (computedTotalCharge == null) {
        toast.error('Total cannot be calculated — ask your operator to set Pricing for this service.')
      } else {
        toast.error('Please complete all required fields.')
      }
      return
    }
    setSubmittingBooking(true)
    try {
      const date = selectedDateYmd
      const addonsPayload = createJobAddonOptions
        .filter((o) => createJobAddonDraft[o.id]?.selected)
        .map((o) => {
          const qty =
            o.basis === 'fixed' ? 1 : Math.max(1, Math.floor(createJobAddonDraft[o.id]?.qty ?? 1))
          return {
            id: o.id,
            name: o.name,
            basis: o.basis,
            price: o.price,
            quantity: qty,
          }
        })
      const res = await createClientScheduleJob({
        email,
        operatorId: oid,
        propertyId: bookingPropertyId,
        serviceProvider: serviceKeyToScheduleServiceProvider(bookingServiceKey),
        date,
        time: requiresTime ? bookingTimeStart : '09:00',
        ...(requiresTime && bookingTimeEnd ? { timeEnd: bookingTimeEnd } : {}),
        ...(addonsPayload.length > 0 ? { addons: addonsPayload } : {}),
        price: computedTotalCharge!,
        ...(bookingRemark.trim() ? { clientRemark: bookingRemark.trim() } : {}),
      })
      if (!res?.ok) {
        const msg =
          (res as { message?: string })?.message ||
          (typeof res?.reason === 'string' ? res.reason : 'Booking failed')
        throw new Error(msg)
      }
      if (isInstantBooking) {
        toast.success('Booking confirmed')
      } else {
        toast.success('Request submitted — pending operator approval')
      }
      openBookingDialog(false)
      setBookingPropertyId('')
      setScheduleRefreshTick((t) => t + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Booking failed')
    } finally {
      setSubmittingBooking(false)
    }
  }

  const filteredSchedules = useMemo(
    () => schedules.filter((s) => propertyFilter === 'all' || s.propertyId === propertyFilter),
    [schedules, propertyFilter]
  )

  const upcomingSchedules = filteredSchedules.filter(
    (s) => s.scheduleStatus !== 'completed' && !s.scheduleStatus.includes('complete') && s.scheduleStatus !== 'cancelled' && !s.scheduleStatus.includes('cancel')
  )
  const completedSchedules = filteredSchedules.filter(
    (s) => s.scheduleStatus === 'completed' || s.scheduleStatus.includes('complete')
  )

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cleaning Schedule</h1>
          <p className="text-muted-foreground">{upcomingSchedules.length} upcoming cleanings</p>
        </div>
        <Dialog open={showNewBooking} onOpenChange={openBookingDialog}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground">
              <Plus className="h-4 w-4 mr-2" />
              Book Cleaning
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Book a Cleaning</DialogTitle>
              <DialogDescription className="text-sm">
                Total charge is calculated from your operator&apos;s pricing — it cannot be edited here.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Property</label>
                <Select
                  value={bookingPropertyId}
                  onValueChange={(v) => {
                    setBookingPropertyId(v)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose property" />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.unitNumber ? ` - ${p.unitNumber}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {bookingPropertyId && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Service</label>
                    <Select value={bookingServiceKey} onValueChange={(v) => setBookingServiceKey(v as ServiceKey)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {scheduleServiceOptions.map((opt) => (
                          <SelectItem key={opt.key} value={opt.key}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {createJobAddonOptions.length > 0 && (
                    <div className="space-y-2 border rounded-md p-3">
                      <span className="text-sm font-medium">Add-ons</span>
                      <div className="space-y-2">
                        {createJobAddonOptions.map((o) => (
                          <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                            <Checkbox
                              checked={!!createJobAddonDraft[o.id]?.selected}
                              onCheckedChange={(c) =>
                                setCreateJobAddonDraft((prev) => ({
                                  ...prev,
                                  [o.id]: {
                                    selected: c === true,
                                    qty: prev[o.id]?.qty ?? 1,
                                  },
                                }))
                              }
                            />
                            <span className="flex-1">
                              {o.name}{' '}
                              <span className="text-muted-foreground">
                                (RM {o.price.toLocaleString('en-MY')}
                                {o.basis !== 'fixed' ? ` / ${o.basis}` : ''})
                              </span>
                            </span>
                            {createJobAddonDraft[o.id]?.selected && o.basis !== 'fixed' && (
                              <Input
                                type="number"
                                min={1}
                                className="w-20 h-8"
                                value={createJobAddonDraft[o.id]?.qty ?? 1}
                                onChange={(e) =>
                                  setCreateJobAddonDraft((prev) => ({
                                    ...prev,
                                    [o.id]: {
                                      selected: true,
                                      qty: Math.max(1, parseInt(e.target.value, 10) || 1),
                                    },
                                  }))
                                }
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Select date</Label>
                    <Input
                      type="date"
                      className="border-input"
                      value={bookingDateYmd}
                      min={earliestBookableYmd}
                      onChange={(e) => setBookingDateYmd(e.target.value.slice(0, 10))}
                    />
                    <p className="text-xs text-muted-foreground">Earliest: {earliestBookableYmd}</p>
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
                              aria-label="Time window: pricing step, bookable range, working hours, surcharges"
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
                                  ? `By-hour pricing: blocks of ${scheduleTimeStepMinutes / 60} hour(s) (Finance → Pricing). End must align with that step after start.`
                                  : `Start/end use ${scheduleTimeStepMinutes}-minute steps from Pricing.`}
                              </p>
                              {operatorCompanyHours &&
                              String(operatorCompanyHours.workingHourFrom || '').trim() &&
                              String(operatorCompanyHours.workingHourTo || '').trim() ? (
                                <p>
                                  Company working hours: {operatorCompanyHours.workingHourFrom}–
                                  {operatorCompanyHours.workingHourTo}
                                  {String(operatorCompanyHours.outOfWorkingHourFrom || '').trim() &&
                                  String(operatorCompanyHours.outOfWorkingHourTo || '').trim()
                                    ? ` · Bookable slot window: ${operatorCompanyHours.outOfWorkingHourFrom}–${operatorCompanyHours.outOfWorkingHourTo}`
                                    : null}
                                </p>
                              ) : (
                                <p className="text-muted-foreground">
                                  If Company sets working hours and out-of-hours from/to, those drive OOH surcharge and the
                                  bookable dropdown range (same as operator Create Job).
                                </p>
                              )}
                              <p className="border-t border-border/60 pt-2 text-muted-foreground">
                                Total charge uses base (Pricing) + add-ons, applies min. selling when set, then adds
                                out-of-hours when the job window overlaps non-working time.
                              </p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Start time</Label>
                          <Select value={bookingTimeStart} onValueChange={setBookingTimeStart}>
                            <SelectTrigger>
                              <SelectValue placeholder="Start" />
                            </SelectTrigger>
                            <SelectContent>
                              {scheduleStartTimeOptions.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>End time</Label>
                          <Select value={bookingTimeEnd} onValueChange={setBookingTimeEnd}>
                            <SelectTrigger>
                              <SelectValue placeholder="End" />
                            </SelectTrigger>
                            <SelectContent>
                              {scheduleEndTimeOptions.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {timeWindowGateHints.workingLine ? (
                          <p className="leading-snug">{timeWindowGateHints.workingLine}</p>
                        ) : null}
                        <p className="leading-snug">{timeWindowGateHints.bookableLine}</p>
                        <p className="leading-snug">{timeWindowGateHints.stepLabel}</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Remark</Label>
                    <Textarea
                      value={bookingRemark}
                      onChange={(e) => setBookingRemark(e.target.value)}
                      placeholder="Optional (shown to operator)"
                      rows={2}
                      className="resize-y min-h-[56px]"
                    />
                  </div>

                  <div className="rounded-md bg-muted p-3 text-sm space-y-2">
                    <p className="font-medium">Summary</p>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      Base uses this property&apos;s saved rates when set (same priority as operator schedule); otherwise
                      Finance → Pricing. Then + add-ons; min. selling if set; + out-of-hours when applicable.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isInstantBooking ? 'Instant · ready-to-clean when submitted' : 'Pending operator approval'}
                    </p>
                    <div className="space-y-0.5 text-[13px]">
                      <p>
                        <span className="text-muted-foreground">Service</span>{' '}
                        {PRICING_SERVICES.find((s) => s.key === bookingServiceKey)?.label ?? bookingServiceKey}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Property</span>{' '}
                        {selectedProperty
                          ? `${selectedProperty.name}${selectedProperty.unitNumber ? ` — ${selectedProperty.unitNumber}` : ''}`
                          : '—'}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Date</span> {bookingDateYmd || '—'}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Time</span>{' '}
                        {requiresTime
                          ? [bookingTimeStart, bookingTimeEnd].filter(Boolean).join(' – ') || '—'
                          : '—'}
                      </p>
                    </div>
                    <div className="space-y-1 border-t border-border/60 pt-2">
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
                        Out-of-hours +RM {createJobOohSurcharge.toLocaleString('en-MY')}
                      </p>
                    ) : null}

                    <div
                      className={cn(
                        'rounded-lg border px-3 py-2.5 mt-1',
                        createJobMinSelling > 0 && !createJobMeetsMinimum
                          ? 'border-destructive/40 bg-destructive/5'
                          : 'border-border bg-background'
                      )}
                    >
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total charge</p>
                      <p className="text-2xl font-bold tabular-nums mt-1">
                        {computedTotalCharge != null
                          ? `RM ${computedTotalCharge.toLocaleString('en-MY')}`
                          : '—'}
                      </p>
                      {createJobMinSelling > 0 ? (
                        <p
                          className={cn(
                            'text-xs mt-1',
                            createJobMeetsMinimum ? 'text-muted-foreground' : 'text-destructive font-medium'
                          )}
                        >
                          Min. (excl. OOH): RM {createJobMinSelling.toLocaleString('en-MY')}
                          {createJobMeetsMinimum ? '' : ' — below minimum'}
                        </p>
                      ) : null}
                    </div>

                    {computedTotalCharge == null && (
                      <p className="text-xs text-destructive">Pricing incomplete — your operator must set Finance → Pricing.</p>
                    )}

                    {!leadTimeCheck.ok && (
                      <p className="text-destructive text-xs">{leadTimeCheck.message || 'Lead time not met.'}</p>
                    )}
                  </div>

                  <Button
                    className="w-full bg-primary text-primary-foreground"
                    onClick={() => void handleBookCleaning()}
                    disabled={
                      submittingBooking ||
                      !canSubmitBooking ||
                      scheduleServiceOptions.length === 0 ||
                      (createJobMinSelling > 0 && !createJobMeetsMinimum)
                    }
                  >
                    {submittingBooking ? 'Submitting…' : isInstantBooking ? 'Confirm booking' : 'Submit request'}
                  </Button>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">Filter</span>
        <Select value={propertyFilter} onValueChange={setPropertyFilter}>
          <SelectTrigger className="w-[200px] border-input">
            <SelectValue placeholder="Filter by property" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Upcoming</h2>
          <Badge variant="outline" className="text-primary">
            {upcomingSchedules.length} scheduled
          </Badge>
        </div>

        <div className="space-y-3">
          {upcomingSchedules.map((item) => (
            <Card key={item.id} className="border-border hover:border-primary/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-4">
                    <div className="flex flex-col items-center justify-center min-w-[60px] py-3 px-3 rounded-lg bg-accent/30">
                      <span className="text-xs text-muted-foreground uppercase">{formatDate(item.date).split(' ')[0]}</span>
                      <span className="text-xl font-bold text-foreground">{formatDate(item.date).split(' ')[1]}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(item.date).split(' ')[2]}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground">{item.property}</p>
                        <Badge variant="outline" className="text-xs">
                          {item.unit}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{item.cleaningType}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {item.time || '—'}
                        </span>
                        {item.team && <span className="text-primary font-medium">{item.team}</span>}
                      </div>
                    </div>
                  </div>
                  <Badge className={`text-xs shrink-0 ${getStatusColor(item.scheduleStatus)}`}>
                    {clientScheduleBadgeLabel(item.scheduleStatus)}
                  </Badge>
                </div>
                <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setRescheduleTarget(item)
                      const d = String(item.date || '').slice(0, 10)
                      setRescheduleYmd(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10))
                      setRescheduleOpen(true)
                    }}
                  >
                    Reschedule / Extend
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 text-destructive border-destructive/50 hover:bg-destructive/10">
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {upcomingSchedules.length === 0 && (
            <Card className="border-border">
              <CardContent className="p-8 text-center text-muted-foreground">No upcoming cleaning schedules.</CardContent>
            </Card>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Past Cleanings</h2>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            View All
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
        <div className="space-y-3">
          {completedSchedules.map((item) => (
            <Card key={item.id} className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-green-700" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{item.property}</p>
                        <Badge variant="outline" className="text-xs">
                          {item.unit}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(item.date)} - {item.cleaningType}
                      </p>
                    </div>
                  </div>
                  <Badge className={`text-xs ${getStatusColor(item.scheduleStatus)}`}>Completed</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
          {completedSchedules.length === 0 && (
            <Card className="border-border">
              <CardContent className="p-8 text-center text-muted-foreground">No past cleaning records.</CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule / Extend</DialogTitle>
            <DialogDescription>
              {rescheduleTarget
                ? `Choose the new working day for ${rescheduleTarget.property}. The same booking row is updated.`
                : 'Choose a new date'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="client-reschedule-day">New working day</Label>
              <Input id="client-reschedule-day" type="date" value={rescheduleYmd} onChange={(e) => setRescheduleYmd(e.target.value)} />
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
    </div>
  )
}
