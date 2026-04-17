"use client"

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import {
  createClientScheduleJob,
  fetchCleanlemonPricingConfig,
  fetchClientPortalProperties,
  fetchClientPortalPropertyDetail,
  fetchClientPropertyGroups,
  fetchClientPropertyGroupDetail,
  fetchOperatorSettings,
  type CleanlemonPricingConfig,
  type ClientPortalPropertyDetail,
} from '@/lib/cleanlemon-api'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Building2, Check, ChevronsUpDown, ChevronLeft } from 'lucide-react'
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
import { computeClientScheduleBookingQuote } from '@/lib/cleanlemon-client-schedule-booking-quote'

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

export default function ClientBookingPage() {
  const { user } = useAuth()
  const [properties, setProperties] = useState<
    Array<{ id: string; name: string; unitNumber?: string; operatorId?: string }>
  >([])
  const [bookingMode, setBookingMode] = useState<'single' | 'bulk' | 'group'>('single')
  /** Group booking: all units in this group share the same job settings (same as bulk payload). */
  const [bookingGroupId, setBookingGroupId] = useState('')
  const [bulkPropertyIds, setBulkPropertyIds] = useState<string[]>([])
  const [bulkPropertyDetails, setBulkPropertyDetails] = useState<Record<string, ClientPortalPropertyDetail | null>>({})
  const [propertySearchQuery, setPropertySearchQuery] = useState('')
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
  const [propertyGroups, setPropertyGroups] = useState<Array<{ id: string; name: string }>>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [groupPropertyIds, setGroupPropertyIds] = useState<Set<string>>(new Set())
  /** Desktop booking dialog: property vs services/date (mobile stays single scroll). */
  const [bookingDesktopStep, setBookingDesktopStep] = useState<'property' | 'schedule'>('property')
  /** Single-booking property combobox (search in dropdown). */
  const [singlePropertyPickerOpen, setSinglePropertyPickerOpen] = useState(false)

  const displayProperties = useMemo(() => {
    if (!selectedGroupId) return properties
    if (groupPropertyIds.size === 0) return []
    return properties.filter((p) => groupPropertyIds.has(p.id))
  }, [properties, selectedGroupId, groupPropertyIds])

  const selectedProperty = useMemo(
    () => displayProperties.find((p) => p.id === bookingPropertyId),
    [displayProperties, bookingPropertyId]
  )

  const isBulkLikeBooking = bookingMode === 'bulk' || bookingMode === 'group'

  const operatorIdForBooking = useMemo(() => {
    const u = String(user?.operatorId || '').trim()
    if (isBulkLikeBooking && bulkPropertyIds.length > 0) {
      const p = properties.find((x) => x.id === bulkPropertyIds[0])
      return String(p?.operatorId || u).trim()
    }
    if (bookingMode === 'single' && bookingPropertyId) {
      const p = displayProperties.find((x) => x.id === bookingPropertyId)
      return String(p?.operatorId || u).trim()
    }
    return u
  }, [isBulkLikeBooking, bookingMode, bookingPropertyId, bulkPropertyIds, displayProperties, properties, user?.operatorId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const email = String(user?.email || '').trim().toLowerCase()
      const operatorId = String(user?.operatorId || '').trim()
      if (!email) {
        setProperties([])
        return
      }
      const [propRes, grpRes] = await Promise.all([
        fetchClientPortalProperties(email, operatorId),
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
      if (grpRes?.ok && Array.isArray(grpRes.items)) {
        setPropertyGroups(grpRes.items.map((g) => ({ id: g.id, name: g.name || 'Group' })))
      } else {
        setPropertyGroups([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email, user?.operatorId, selectedGroupId])

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

  useEffect(() => {
    if (bookingMode !== 'group') {
      return
    }
    if (!bookingGroupId) {
      setBulkPropertyIds([])
      return
    }
    let cancelled = false
    const email = String(user?.email || '').trim().toLowerCase()
    const operatorId = String(user?.operatorId || '').trim()
    if (!email || !operatorId) return
    ;(async () => {
      const d = await fetchClientPropertyGroupDetail(email, operatorId, bookingGroupId)
      if (cancelled) return
      if (d?.ok && Array.isArray(d.group?.properties) && d.group.properties.length > 0) {
        const allowed = new Set(properties.map((p) => p.id))
        const list = d.group.properties
          .map((x) => String(x.id || '').trim())
          .filter(Boolean)
          .filter((id) => allowed.has(id))
        setBulkPropertyIds(list)
      } else {
        setBulkPropertyIds([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bookingMode, bookingGroupId, user?.email, user?.operatorId, properties])

  useEffect(() => {
    if (!operatorIdForBooking || !user?.email) {
      setPricingConfigCache(null)
      setOperatorCompanyHours(null)
      setBookingServiceKey('general')
      setBookingTimeStart('')
      setBookingTimeEnd('')
      setCreateJobAddonDraft({})
      return
    }
    let cancelled = false
    ;(async () => {
      const [cfgRes, settingsRes] = await Promise.all([
        fetchCleanlemonPricingConfig(operatorIdForBooking),
        fetchOperatorSettings(operatorIdForBooking),
      ])
      if (cancelled) return
      const cfg = (cfgRes?.config || {}) as Record<string, unknown>
      setPricingConfigCache(cfg)
      const s = (settingsRes as { settings?: { companyProfile?: Record<string, unknown> } })?.settings || {}
      setOperatorCompanyHours(parseOperatorCompanyHoursFromProfile(s.companyProfile && typeof s.companyProfile === 'object' ? s.companyProfile : null))

      const selectedServices = Array.isArray(cfg.selectedServices) ? (cfg.selectedServices as string[]) : []
      const keys = selectedServices.length === 0 ? PRICING_SERVICES.map((s) => s.key) : selectedServices
      const set = new Set(keys)
      const firstAllowed = PRICING_SERVICES.find((s) => set.has(s.key))?.key ?? 'general'
      setBookingServiceKey((prev) => (set.has(prev) ? prev : firstAllowed))
    })()
    return () => {
      cancelled = true
    }
  }, [operatorIdForBooking, user?.email])

  useEffect(() => {
    if (bookingMode !== 'single' || !bookingPropertyId || !operatorIdForBooking || !user?.email) {
      if (bookingMode !== 'single') setPropertyDetail(null)
      return
    }
    let cancelled = false
    const email = String(user.email || '').trim().toLowerCase()
    ;(async () => {
      const detailRes = await fetchClientPortalPropertyDetail(email, operatorIdForBooking, bookingPropertyId)
      if (cancelled) return
      if (detailRes?.ok && detailRes.property) setPropertyDetail(detailRes.property)
      else setPropertyDetail(null)
    })()
    return () => {
      cancelled = true
    }
  }, [bookingMode, bookingPropertyId, operatorIdForBooking, user?.email])

  useEffect(() => {
    if (!isBulkLikeBooking || bulkPropertyIds.length === 0 || !operatorIdForBooking || !user?.email) {
      setBulkPropertyDetails({})
      return
    }
    let cancelled = false
    const email = String(user.email || '').trim().toLowerCase()
    ;(async () => {
      const pairs = await Promise.all(
        bulkPropertyIds.map(async (id) => {
          const r = await fetchClientPortalPropertyDetail(email, operatorIdForBooking, id)
          return [id, r?.ok && r.property ? r.property : null] as const
        })
      )
      if (cancelled) return
      setBulkPropertyDetails(Object.fromEntries(pairs))
    })()
    return () => {
      cancelled = true
    }
  }, [isBulkLikeBooking, bulkPropertyIds, operatorIdForBooking, user?.email])

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

  const bulkQuotes = useMemo(() => {
    if (!isBulkLikeBooking) return []
    return bulkPropertyIds.map((id) =>
      computeClientScheduleBookingQuote({
        bookingServiceKey,
        pricingConfigCache,
        operatorCompanyHours,
        propertyDetail: bulkPropertyDetails[id] ?? null,
        createJobAddonDraft,
        bookingTimeStart,
        bookingTimeEnd,
        bookingDateYmd,
      })
    )
  }, [
    isBulkLikeBooking,
    bulkPropertyIds,
    bulkPropertyDetails,
    bookingServiceKey,
    pricingConfigCache,
    operatorCompanyHours,
    createJobAddonDraft,
    bookingTimeStart,
    bookingTimeEnd,
    bookingDateYmd,
  ])

  const bulkGrandTotal = useMemo(() => {
    if (!isBulkLikeBooking || bulkQuotes.length === 0) return null
    let sum = 0
    for (const q of bulkQuotes) {
      if (q.computedTotalCharge == null) return null
      sum += q.computedTotalCharge
    }
    return Math.round(sum * 100) / 100
  }, [isBulkLikeBooking, bulkQuotes])

  const canSubmitBooking = useMemo(() => {
    if (isBulkLikeBooking) {
      if (bulkPropertyIds.length === 0 || scheduleServiceOptions.length === 0) return false
      if (bookingMode === 'group' && !bookingGroupId) return false
      if (bulkQuotes.length !== bulkPropertyIds.length) return false
      return bulkQuotes.every((q) => q.canSubmitQuote)
    }
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
    isBulkLikeBooking,
    bookingMode,
    bookingGroupId,
    bulkPropertyIds,
    bulkQuotes,
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

  useEffect(() => {
    if (!bookingPropertyId || !earliestBookableYmd) return
    if (bookingDateYmd && bookingDateYmd < earliestBookableYmd) {
      setBookingDateYmd(earliestBookableYmd)
    }
  }, [bookingPropertyId, earliestBookableYmd, bookingDateYmd])

  const handleBookCleaning = async () => {
    const email = String(user?.email || '').trim().toLowerCase()
    const oid = operatorIdForBooking
    if (!email || !oid) {
      toast.error('Sign in required')
      return
    }
    if (!canSubmitBooking) {
      if (bookingMode === 'single' && computedTotalCharge == null) {
        toast.error('Total cannot be calculated — ask your operator to set Pricing for this service.')
      } else if (isBulkLikeBooking) {
        toast.error('Please complete all required fields for every selected unit.')
      } else {
        toast.error('Please complete all required fields.')
      }
      return
    }

    const addonsPayload = createJobAddonOptions
      .filter((o) => createJobAddonDraft[o.id]?.selected)
      .map((o) => {
        const qty = o.basis === 'fixed' ? 1 : Math.max(1, Math.floor(createJobAddonDraft[o.id]?.qty ?? 1))
        return {
          id: o.id,
          name: o.name,
          basis: o.basis,
          price: o.price,
          quantity: qty,
        }
      })

    setSubmittingBooking(true)
    try {
      const date = selectedDateYmd

      const groupIdForJob =
        bookingMode === 'group' && bookingGroupId
          ? bookingGroupId
          : selectedGroupId
            ? selectedGroupId
            : undefined

      if (isBulkLikeBooking) {
        let okCount = 0
        for (let i = 0; i < bulkPropertyIds.length; i++) {
          const pid = bulkPropertyIds[i]
          const q = bulkQuotes[i]
          const price = q?.computedTotalCharge
          if (price == null || !Number.isFinite(price)) {
            throw new Error(`Could not calculate price for a unit.`)
          }
          const res = await createClientScheduleJob({
            email,
            operatorId: oid,
            propertyId: pid,
            serviceProvider: serviceKeyToScheduleServiceProvider(bookingServiceKey),
            date,
            time: q.requiresTime ? bookingTimeStart : '09:00',
            ...(q.requiresTime && bookingTimeEnd ? { timeEnd: bookingTimeEnd } : {}),
            ...(addonsPayload.length > 0 ? { addons: addonsPayload } : {}),
            price,
            ...(bookingRemark.trim() ? { clientRemark: bookingRemark.trim() } : {}),
            ...(groupIdForJob ? { groupId: groupIdForJob } : {}),
          })
          if (!res?.ok) {
            const msg =
              (res as { message?: string })?.message ||
              (typeof res?.reason === 'string' ? res.reason : 'Booking failed')
            throw new Error(msg)
          }
          okCount += 1
        }
        if (isInstantBooking) {
          toast.success(okCount > 1 ? `${okCount} bookings confirmed` : 'Booking confirmed')
        } else {
          toast.success(okCount > 1 ? `${okCount} requests submitted` : 'Request submitted — pending operator approval')
        }
        setBookingPropertyId('')
        setBulkPropertyIds([])
        setBookingGroupId('')
        return
      }

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
        ...(groupIdForJob ? { groupId: groupIdForJob } : {}),
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
      setBookingPropertyId('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Booking failed')
    } finally {
      setSubmittingBooking(false)
    }
  }

  const filteredBookingProperties = useMemo(() => {
    const pool = bookingMode === 'bulk' ? properties : displayProperties
    const q = propertySearchQuery.trim().toLowerCase()
    if (!q) return pool
    return pool.filter((p) => {
      const name = String(p.name || '').toLowerCase()
      const unit = String(p.unitNumber || '').toLowerCase()
      return name.includes(q) || unit.includes(q) || `${name} ${unit}`.includes(q)
    })
  }, [bookingMode, properties, displayProperties, propertySearchQuery])

  const hasBookingSelection =
    (bookingMode === 'single' && !!bookingPropertyId) ||
    (isBulkLikeBooking && bulkPropertyIds.length > 0)

  const isDesktopBooking = useMediaQuery('(min-width: 768px)', false)

  const bookingFormInner = (
            <div
              className={cn(
                'space-y-4 py-2',
                isDesktopBooking &&
                  bookingDesktopStep === 'property' &&
                  isBulkLikeBooking &&
                  'flex min-h-0 flex-1 flex-col',
                isDesktopBooking && bookingDesktopStep === 'property' && bookingMode === 'single' && 'shrink-0',
                isDesktopBooking && bookingDesktopStep === 'schedule' && 'min-h-0 flex-1'
              )}
            >
              {(!isDesktopBooking || bookingDesktopStep === 'property') && (
              <div
                className={cn(
                  'w-full min-h-0 space-y-4',
                  isDesktopBooking &&
                    bookingDesktopStep === 'property' &&
                    isBulkLikeBooking &&
                    'flex min-h-0 flex-1 flex-col overflow-hidden'
                )}
              >
              <div className="w-full min-w-0 shrink-0 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Booking type</p>
                <div className="inline-flex max-w-full flex-wrap rounded-lg border border-border bg-muted/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setBookingMode('single')
                      setBookingGroupId('')
                      setBulkPropertyIds([])
                      setBulkPropertyDetails({})
                      setSinglePropertyPickerOpen(false)
                    }}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm',
                      bookingMode === 'single'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Single booking
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBookingMode('bulk')
                      setBookingGroupId('')
                      setBulkPropertyIds([])
                      setBulkPropertyDetails({})
                      setBookingPropertyId('')
                      setPropertyDetail(null)
                      setSinglePropertyPickerOpen(false)
                    }}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm',
                      bookingMode === 'bulk'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Bulk booking
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBookingMode('group')
                      setBookingPropertyId('')
                      setPropertyDetail(null)
                      setSinglePropertyPickerOpen(false)
                      setBookingGroupId('')
                      setBulkPropertyIds([])
                      setBulkPropertyDetails({})
                    }}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm',
                      bookingMode === 'group'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Group booking
                  </button>
                </div>
              </div>

              {bookingMode === 'single' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Property</label>
                  <Popover open={singlePropertyPickerOpen} onOpenChange={setSinglePropertyPickerOpen} modal={false}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={singlePropertyPickerOpen}
                        className="h-10 w-full justify-between font-normal"
                      >
                        <span className="truncate text-left">
                          {selectedProperty
                            ? `${selectedProperty.name}${selectedProperty.unitNumber ? ` — ${selectedProperty.unitNumber}` : ''}`
                            : displayProperties.length
                              ? 'Search or choose property…'
                              : 'No properties'}
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
                        <CommandInput placeholder="Search name or unit…" />
                        <CommandList
                          className="max-h-[min(280px,50vh)] overflow-y-auto overscroll-contain"
                          onWheelCapture={(e) => e.stopPropagation()}
                        >
                          <CommandEmpty>No property found.</CommandEmpty>
                          <CommandGroup>
                            {displayProperties.map((p) => (
                              <CommandItem
                                key={p.id}
                                value={`${p.name} ${p.unitNumber || ''} ${p.id}`}
                                onSelect={() => {
                                  setBookingPropertyId(p.id)
                                  setSinglePropertyPickerOpen(false)
                                }}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4 shrink-0',
                                    bookingPropertyId === p.id ? 'opacity-100' : 'opacity-0'
                                  )}
                                />
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                                  <span className="truncate font-medium">{p.name || '—'}</span>
                                  {p.unitNumber ? (
                                    <span className="truncate text-xs text-muted-foreground">Unit {p.unitNumber}</span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              ) : bookingMode === 'bulk' ? (
                <div
                  className={cn(
                    'flex min-h-0 flex-1 flex-col space-y-2',
                    isDesktopBooking && bookingDesktopStep === 'property' && 'min-h-[min(36dvh,320px)]'
                  )}
                >
                  <Label className="text-sm font-medium">Search units</Label>
                  <Input
                    type="search"
                    value={propertySearchQuery}
                    onChange={(e) => setPropertySearchQuery(e.target.value)}
                    placeholder="Name or unit number…"
                    className="border-input"
                    autoComplete="off"
                  />
                  <div
                    className={cn(
                      'min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-lg border border-border/60 p-2',
                      isDesktopBooking && bookingDesktopStep === 'property'
                        ? 'min-h-[min(52dvh,480px)] max-h-[min(72dvh,640px)]'
                        : 'max-h-[min(40vh,280px)]'
                    )}
                  >
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {filteredBookingProperties.map((p) => {
                        const checked = bulkPropertyIds.includes(p.id)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            aria-pressed={checked}
                            onClick={() =>
                              setBulkPropertyIds((prev) =>
                                prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                              )
                            }
                            className={cn(
                              'flex min-h-[6.5rem] w-full flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-colors',
                              checked
                                ? 'border-emerald-700 bg-emerald-600 text-white shadow-sm'
                                : 'border-border bg-card text-foreground hover:bg-muted/50'
                            )}
                          >
                            <Building2
                              className={cn('h-4 w-4 shrink-0', checked ? 'text-white' : 'text-muted-foreground')}
                            />
                            <span
                              className={cn(
                                'line-clamp-2 w-full text-[11px] font-semibold leading-snug',
                                checked ? 'text-white' : 'text-foreground'
                              )}
                            >
                              {p.name}
                            </span>
                            {p.unitNumber ? (
                              <span
                                className={cn(
                                  'line-clamp-1 w-full text-[10px]',
                                  checked ? 'text-emerald-100' : 'text-muted-foreground'
                                )}
                              >
                                {p.unitNumber}
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                    {filteredBookingProperties.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">No units match this search.</p>
                    ) : null}
                  </div>
                  {bulkPropertyIds.length > 0 ? (
                    <p className="text-center text-[11px] text-muted-foreground">
                      Selected: {bulkPropertyIds.length} unit(s)
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3 py-1">
                  <Label className="text-sm font-medium">Group</Label>
                  {propertyGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No groups yet. Create one under Properties first.</p>
                  ) : (
                    <>
                      <Select
                        value={bookingGroupId || '__none'}
                        onValueChange={(v) => setBookingGroupId(v === '__none' ? '' : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a group" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">Select a group…</SelectItem>
                          {propertyGroups.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {bookingGroupId && bulkPropertyIds.length > 0 ? (
                        <p className="text-xs text-muted-foreground">{bulkPropertyIds.length} unit(s) in this group.</p>
                      ) : bookingGroupId ? (
                        <p className="text-xs text-muted-foreground">No units in this group for your account.</p>
                      ) : null}
                    </>
                  )}
                </div>
              )}
              </div>
              )}

              {isDesktopBooking && bookingDesktopStep === 'property' && (
                <div className="mt-auto shrink-0 border-t border-border bg-background pt-4">
                  <Button
                    type="button"
                    className="w-full bg-primary text-primary-foreground"
                    disabled={!hasBookingSelection}
                    onClick={() => setBookingDesktopStep('schedule')}
                  >
                    Next
                  </Button>
                </div>
              )}

              {hasBookingSelection && (!isDesktopBooking || bookingDesktopStep === 'schedule') && (
                <>
                  {isDesktopBooking ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="mb-2 -ml-2 h-9 justify-start px-2 text-muted-foreground hover:text-foreground"
                      onClick={() => setBookingDesktopStep('property')}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4 shrink-0" />
                      Back
                    </Button>
                  ) : null}
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
                                <p>
                                  If Company sets working hours and out-of-hours from/to, those drive OOH surcharge and the
                                  bookable dropdown range (same as operator Create Job).
                                </p>
                              )}
                              <p className="border-t border-white/20 pt-2 text-zinc-100">
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
                    {isBulkLikeBooking ? (
                      <>
                        <div className="space-y-0.5 text-[13px]">
                          <p>
                            <span className="text-muted-foreground">Service</span>{' '}
                            {PRICING_SERVICES.find((s) => s.key === bookingServiceKey)?.label ?? bookingServiceKey}
                          </p>
                          {bookingMode === 'group' && bookingGroupId ? (
                            <p>
                              <span className="text-muted-foreground">Group</span>{' '}
                              {propertyGroups.find((g) => g.id === bookingGroupId)?.name ?? bookingGroupId}
                            </p>
                          ) : null}
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Properties
                          </p>
                          <ul className="max-h-[min(36vh,220px)] space-y-2 overflow-y-auto overscroll-y-contain pr-0.5">
                            {bulkPropertyIds.map((id, i) => {
                              const meta = properties.find((x) => x.id === id)
                              const q = bulkQuotes[i]
                              const label = meta
                                ? `${meta.name}${meta.unitNumber ? ` (${meta.unitNumber})` : ''}`
                                : id
                              return (
                                <li
                                  key={id}
                                  className="flex items-start justify-between gap-2 border-b border-border/50 pb-2 text-[13px] leading-snug last:border-0 last:pb-0"
                                >
                                  <span className="min-w-0 flex-1 text-left">{label}</span>
                                  <span className="shrink-0 tabular-nums font-semibold text-foreground">
                                    {q?.computedTotalCharge != null
                                      ? `RM ${q.computedTotalCharge.toLocaleString('en-MY')}`
                                      : '—'}
                                  </span>
                                </li>
                              )
                            })}
                          </ul>
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
                        <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Total (all units)
                          </p>
                          <p className="text-2xl font-bold tabular-nums">
                            {bulkGrandTotal != null ? `RM ${bulkGrandTotal.toLocaleString('en-MY')}` : '—'}
                          </p>
                        </div>
                        {bulkGrandTotal == null && (
                          <p className="text-xs text-destructive">
                            Pricing incomplete for one or more units — check Finance → Pricing.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
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
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Total charge
                          </p>
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
                          <p className="text-xs text-destructive">
                            Pricing incomplete — your operator must set Finance → Pricing.
                          </p>
                        )}
                      </>
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
                      (bookingMode === 'single' && createJobMinSelling > 0 && !createJobMeetsMinimum)
                    }
                  >
                    {submittingBooking
                      ? 'Submitting…'
                      : isBulkLikeBooking
                        ? isInstantBooking
                          ? bulkPropertyIds.length > 1
                            ? 'Confirm bookings'
                            : 'Confirm booking'
                          : bulkPropertyIds.length > 1
                            ? 'Submit requests'
                            : 'Submit request'
                        : isInstantBooking
                          ? 'Confirm booking'
                          : 'Submit request'}
                  </Button>
                </>
              )}
            </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Book a cleaning</h1>
        <p className="text-muted-foreground">
          Total charge is calculated from your operator&apos;s pricing — it cannot be edited here.
        </p>
        {propertyGroups.length > 0 ? (
          <div className="mt-4 max-w-xs space-y-1">
            <Label className="text-xs text-muted-foreground">Group</Label>
            <Select value={selectedGroupId || 'all'} onValueChange={(v) => setSelectedGroupId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9">
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
      </div>

      <Card className="w-full border-border shadow-sm">
        <CardContent className="p-4 md:p-6">{bookingFormInner}</CardContent>
      </Card>
    </div>
  )
}
