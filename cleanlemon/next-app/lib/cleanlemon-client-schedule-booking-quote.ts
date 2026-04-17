import type { CleanlemonPricingConfig, ClientPortalPropertyDetail } from '@/lib/cleanlemon-api'
import type { ServiceKey } from '@/lib/cleanlemon-pricing-services'
import {
  collectJobAddonOptions,
  jobAddonLineTotal,
  type JobAddonOption,
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
  computeSurchargeApplySegments,
  computeOutOfWorkingHourSurcharge,
  parseMarkupNumeric,
  getBookableDayBoundsMin,
  type OperatorCompanyHoursInput,
} from '@/lib/cleanlemon-company-working-hours'
import { validateBookingLeadTimeForConfig } from '@/lib/cleanlemon-booking-eligibility'
import { PRICING_SERVICES } from '@/lib/cleanlemon-pricing-services'

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

export type ClientScheduleBookingQuote = {
  requiresTime: boolean
  scheduleTimeStepMinutes: number
  scheduleDayBounds: { dayStartMin: number; dayEndMin: number } | undefined
  surchargeSegments: [number, number][]
  scheduleStartTimeOptions: string[]
  scheduleEndTimeOptions: string[]
  createJobAddonOptions: JobAddonOption[]
  createJobSelectedAddonTotal: number
  createJobDurationHours: number | null
  createJobPriceSummary: ReturnType<typeof buildCreateJobPriceSummary>
  createJobMinSelling: number
  createJobCoreSubtotal: number | null
  createJobCoreFloorForCharge: number | null
  createJobOohSurcharge: number
  createJobIndicativeGrandTotal: number | null
  createJobMeetsMinimum: boolean
  leadTimeCheck: ReturnType<typeof validateBookingLeadTimeForConfig>
  computedTotalCharge: number | null
  /** Form/price validity — caller must also require property selection (single or bulk). */
  canSubmitQuote: boolean
}

/**
 * Same pipeline as client schedule page useMemos — used for bulk per-property pricing without hook drift.
 */
export function computeClientScheduleBookingQuote(input: {
  bookingServiceKey: ServiceKey
  pricingConfigCache: Record<string, unknown> | null
  operatorCompanyHours: OperatorCompanyHoursInput | null
  propertyDetail: ClientPortalPropertyDetail | null
  createJobAddonDraft: Record<string, { selected: boolean; qty: number }>
  bookingTimeStart: string
  bookingTimeEnd: string
  bookingDateYmd: string
}): ClientScheduleBookingQuote {
  const {
    bookingServiceKey,
    pricingConfigCache,
    operatorCompanyHours,
    propertyDetail,
    createJobAddonDraft,
    bookingTimeStart,
    bookingTimeEnd,
    bookingDateYmd,
  } = input

  const pricingServiceConfigs =
    pricingConfigCache?.serviceConfigs && typeof pricingConfigCache.serviceConfigs === 'object'
      ? (pricingConfigCache.serviceConfigs as Record<string, unknown>)
      : null

  const requiresTime = bookingServiceKey !== 'homestay'

  const scheduleTimeStepMinutes = getCreateJobScheduleTimeStepMinutes(
    bookingServiceKey,
    pricingServiceConfigs ?? undefined
  )

  let scheduleDayBounds: { dayStartMin: number; dayEndMin: number } | undefined
  if (operatorCompanyHours) {
    const of = String(operatorCompanyHours.outOfWorkingHourFrom || '').trim()
    const ot = String(operatorCompanyHours.outOfWorkingHourTo || '').trim()
    if (of && ot) {
      const b = getBookableDayBoundsMin(of, ot)
      scheduleDayBounds = { dayStartMin: b.dayStartMin, dayEndMin: b.dayEndMin }
    }
  }

  let surchargeSegments: [number, number][] = []
  if (operatorCompanyHours) {
    const wf = String(operatorCompanyHours.workingHourFrom || '').trim()
    const wt = String(operatorCompanyHours.workingHourTo || '').trim()
    const of = String(operatorCompanyHours.outOfWorkingHourFrom || '').trim()
    const ot = String(operatorCompanyHours.outOfWorkingHourTo || '').trim()
    if (wf && wt && of && ot) {
      surchargeSegments = computeSurchargeApplySegments(wf, wt, of, ot)
    }
  }

  const scheduleStartTimeOptions = buildScheduleStartSlotOptions(scheduleTimeStepMinutes, scheduleDayBounds)
  const scheduleEndTimeOptions = bookingTimeStart
    ? buildScheduleEndSlotOptions(bookingTimeStart, scheduleTimeStepMinutes, scheduleDayBounds)
    : []

  const createJobAddonOptions = collectJobAddonOptions(bookingServiceKey, pricingServiceConfigs)

  let createJobSelectedAddonTotal = 0
  for (const o of createJobAddonOptions) {
    if (!createJobAddonDraft[o.id]?.selected) continue
    const qty = o.basis === 'fixed' ? 1 : Math.max(1, Math.floor(createJobAddonDraft[o.id]?.qty ?? 1))
    createJobSelectedAddonTotal += jobAddonLineTotal(o.price, o.basis, qty)
  }
  createJobSelectedAddonTotal = Math.round(createJobSelectedAddonTotal * 100) / 100

  let createJobDurationHours: number | null = null
  if (requiresTime && bookingTimeStart && bookingTimeEnd) {
    const a = scheduleTimeSlotToMinutes(bookingTimeStart)
    const b = scheduleTimeSlotToMinutes(bookingTimeEnd)
    if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) {
      createJobDurationHours = (b - a) / 60
    }
  }

  const propertyFees = propertyFeeHintsFromDetail(propertyDetail)
  const premisesType = propertyDetail?.premisesType

  const createJobPriceSummary = buildCreateJobPriceSummary(bookingServiceKey, pricingServiceConfigs, {
    premisesType,
    durationHours: createJobDurationHours,
    propertyFees,
  })

  const createJobMinSelling = getCreateJobMinSellingPrice(bookingServiceKey, pricingServiceConfigs ?? undefined)

  const createJobCoreSubtotal =
    createJobPriceSummary.indicativeBaseAmount == null
      ? null
      : Math.round((createJobPriceSummary.indicativeBaseAmount + createJobSelectedAddonTotal) * 100) / 100

  const createJobCoreFloorForCharge =
    createJobCoreSubtotal == null
      ? null
      : createJobMinSelling <= 0
        ? createJobCoreSubtotal
        : Math.max(createJobCoreSubtotal, createJobMinSelling)

  let createJobOohSurcharge = 0
  if (requiresTime && bookingTimeStart && bookingTimeEnd && operatorCompanyHours && createJobCoreFloorForCharge != null) {
    const a = scheduleTimeSlotToMinutes(bookingTimeStart)
    const b = scheduleTimeSlotToMinutes(bookingTimeEnd)
    if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) {
      const val = parseMarkupNumeric(operatorCompanyHours)
      createJobOohSurcharge = computeOutOfWorkingHourSurcharge(
        createJobCoreFloorForCharge,
        a,
        b,
        surchargeSegments,
        operatorCompanyHours.outOfWorkingHourMarkupMode,
        val
      )
    }
  }

  const createJobIndicativeGrandTotal =
    createJobCoreFloorForCharge == null
      ? null
      : Math.round((createJobCoreFloorForCharge + createJobOohSurcharge) * 100) / 100

  const createJobMeetsMinimum =
    createJobMinSelling <= 0 || (createJobCoreSubtotal != null && createJobCoreSubtotal >= createJobMinSelling)

  const leadTimeRaw = String(pricingConfigCache?.leadTime || 'same_day')
  const selectedDateYmd = /^\d{4}-\d{2}-\d{2}$/.test(bookingDateYmd) ? bookingDateYmd : ''

  const leadTimeCheck =
    !selectedDateYmd || !pricingConfigCache
      ? ({ ok: false as const, message: 'Loading pricing…' } as const)
      : validateBookingLeadTimeForConfig({
          leadTimeRaw,
          dateYmd: selectedDateYmd,
          timeHm: requiresTime ? bookingTimeStart : undefined,
          isHomestay: bookingServiceKey === 'homestay',
        })

  const computedTotalCharge = createJobIndicativeGrandTotal

  let canSubmitQuote = true
  if (!selectedDateYmd) canSubmitQuote = false
  if (requiresTime && (!bookingTimeStart || !bookingTimeEnd)) canSubmitQuote = false
  if (requiresTime && bookingTimeStart && bookingTimeEnd) {
    const a = scheduleTimeSlotToMinutes(bookingTimeStart)
    const b = scheduleTimeSlotToMinutes(bookingTimeEnd)
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) {
      canSubmitQuote = false
    } else {
      const dur = b - a
      if (dur < scheduleTimeStepMinutes || dur % scheduleTimeStepMinutes !== 0) canSubmitQuote = false
    }
  }
  if (!leadTimeCheck.ok) canSubmitQuote = false
  if (createJobMinSelling > 0 && !createJobMeetsMinimum) canSubmitQuote = false
  if (computedTotalCharge == null || !Number.isFinite(computedTotalCharge)) canSubmitQuote = false

  return {
    requiresTime,
    scheduleTimeStepMinutes,
    scheduleDayBounds,
    surchargeSegments,
    scheduleStartTimeOptions,
    scheduleEndTimeOptions,
    createJobAddonOptions,
    createJobSelectedAddonTotal,
    createJobDurationHours,
    createJobPriceSummary,
    createJobMinSelling,
    createJobCoreSubtotal,
    createJobCoreFloorForCharge,
    createJobOohSurcharge,
    createJobIndicativeGrandTotal,
    createJobMeetsMinimum,
    leadTimeCheck,
    computedTotalCharge,
    canSubmitQuote,
  }
}

export function scheduleServiceOptionsFromPricingConfig(
  pricingConfigCache: Record<string, unknown> | null
): (typeof PRICING_SERVICES)[number][] {
  const cfg = pricingConfigCache as CleanlemonPricingConfig | null
  const keys =
    cfg == null || !Array.isArray(cfg.selectedServices) || cfg.selectedServices.length === 0
      ? PRICING_SERVICES.map((s) => s.key)
      : (cfg.selectedServices as string[])
  const set = new Set(keys)
  return PRICING_SERVICES.filter((s) => set.has(s.key))
}
