/**
 * Working / out-of-working hours and surcharge — aligned with
 * `app/portal/operator/company/page.tsx` (surcharge preview).
 */

export type OperatorCompanyHoursInput = {
  workingHourFrom: string
  workingHourTo: string
  outOfWorkingHourFrom: string
  outOfWorkingHourTo: string
  outOfWorkingHourMarkupMode: 'percentage' | 'fixed_amount'
  /** Raw display string from profile; parsed to number where possible */
  outOfWorkingHourMarkupValue: string
}

function parseHMToMinutes(s: string): number | null {
  const t = String(s || '').trim()
  if (!t) return null
  if (t === '24:00' || /^24:00(?::00)?$/i.test(t)) return 1440
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t)
  if (!m) return null
  let h = parseInt(m[1], 10)
  let mm = parseInt(m[2], 10)
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null
  h = Math.max(0, Math.min(23, h))
  mm = Math.max(0, Math.min(59, mm))
  return h * 60 + mm
}

function intersectHalfOpen(a: [number, number], b: [number, number]): [number, number] | null {
  const s = Math.max(a[0], b[0])
  const e = Math.min(a[1], b[1])
  if (s >= e) return null
  return [s, e]
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((x, y) => x[0] - y[0])
  const out: [number, number][] = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (!last || iv[0] > last[1]) {
      out.push([iv[0], iv[1]])
    } else {
      last[1] = Math.max(last[1], iv[1])
    }
  }
  return out
}

export function formatMinuteClock(m: number): string {
  if (m >= 1440) return '24:00'
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function formatIntervalRangeMm([s, e]: [number, number]): string {
  return `${formatMinuteClock(s)}–${formatMinuteClock(e)}`
}

/**
 * Where surcharge applies: (times not in working hours) ∩ out-of-hours window.
 */
export function computeSurchargeApplySegments(
  workingFrom: string,
  workingTo: string,
  oohFrom: string,
  oohTo: string
): [number, number][] {
  const wS = parseHMToMinutes(workingFrom)
  const wE = parseHMToMinutes(workingTo)
  const oS = parseHMToMinutes(oohFrom)
  const oE = parseHMToMinutes(oohTo)
  if (wS === null || wE === null || oS === null || oE === null) return []

  let outside: [number, number][]
  if (wS < wE) {
    outside = [
      [0, wS],
      [wE, 1440],
    ]
  } else if (wS > wE) {
    outside = [[wE, wS]]
  } else {
    outside = [[0, 1440]]
  }

  let ooh: [number, number][]
  if (oS < oE) {
    ooh = [[oS, oE]]
  } else if (oS > oE) {
    ooh = [
      [oS, 1440],
      [0, oE],
    ]
  } else {
    return []
  }

  const raw: [number, number][] = []
  for (const o of outside) {
    for (const h of ooh) {
      const x = intersectHalfOpen(o, h)
      if (x) raw.push(x)
    }
  }
  return mergeIntervals(raw)
}

export function overlapMinutesWindowWithSegments(
  windowStartMin: number,
  windowEndMin: number,
  segments: [number, number][]
): number {
  if (windowEndMin <= windowStartMin) return 0
  let sum = 0
  for (const [a, b] of segments) {
    const lo = Math.max(windowStartMin, a)
    const hi = Math.min(windowEndMin, b)
    if (hi > lo) sum += hi - lo
  }
  return sum
}

/**
 * Extra charge for the selected window: fixed once if any overlap; percentage prorated by time in surcharge zones.
 */
export function computeOutOfWorkingHourSurcharge(
  baseAmount: number,
  windowStartMin: number,
  windowEndMin: number,
  surchargeSegments: [number, number][],
  mode: 'percentage' | 'fixed_amount',
  value: number | null
): number {
  const total = windowEndMin - windowStartMin
  if (total <= 0 || value == null || !Number.isFinite(value) || value < 0) return 0
  const overlap = overlapMinutesWindowWithSegments(windowStartMin, windowEndMin, surchargeSegments)
  if (overlap <= 0) return 0
  if (mode === 'fixed_amount') return Math.round(value * 100) / 100
  const pct = value / 100
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) return 0
  const ratio = overlap / total
  return Math.round(baseAmount * pct * ratio * 100) / 100
}

/** Human-readable surcharge windows + charge line (for Summary). */
export function buildCompanyOohSummaryLines(h: OperatorCompanyHoursInput | null): string[] {
  if (!h) return []
  const wf = String(h.workingHourFrom || '').trim()
  const wt = String(h.workingHourTo || '').trim()
  const of = String(h.outOfWorkingHourFrom || '').trim()
  const ot = String(h.outOfWorkingHourTo || '').trim()
  if (!wf || !wt) {
    return ['Set working hours under Company to see out-of-hours surcharge windows.']
  }
  if (!of || !ot) {
    return ['Set out-of-working hours under Company to see surcharge windows.']
  }
  const segs = computeSurchargeApplySegments(wf, wt, of, ot)
  if (!segs.length) {
    return ['No surcharge window (adjust Company working / out-of-hours so ranges overlap).']
  }
  const rangeStr = segs.map(formatIntervalRangeMm).join(' & ')
  const valRaw = String(h.outOfWorkingHourMarkupValue || '').trim()
  const amt = valRaw === '' ? null : Number(valRaw.replace(',', '.'))
  const lines: string[] = [`Out-of-hours windows: ${rangeStr} (vs working ${wf}–${wt}).`]
  if (amt !== null && Number.isFinite(amt) && amt >= 0) {
    if (h.outOfWorkingHourMarkupMode === 'fixed_amount') {
      lines.push(
        `Extra when the job overlaps those windows: RM ${amt.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} fixed (once per job).`
      )
    } else {
      lines.push(`Extra when the job overlaps those windows: ${amt}% of base, prorated by time in those windows.`)
    }
  } else {
    lines.push('Set out-of-hours charge under Company to see the amount.')
  }
  return lines
}

/**
 * Bookable clock range from “out of working hours” fields (e.g. 7:00–24:00). Falls back to full day.
 */
export function getBookableDayBoundsMin(oohFrom: string, oohTo: string): { dayStartMin: number; dayEndMin: number } {
  const oS = parseHMToMinutes(oohFrom)
  const oE = parseHMToMinutes(oohTo)
  if (oS === null || oE === null) {
    return { dayStartMin: 6 * 60, dayEndMin: 24 * 60 }
  }
  if (oS < oE) {
    return { dayStartMin: oS, dayEndMin: oE }
  }
  if (oS > oE) {
    return { dayStartMin: oS, dayEndMin: 24 * 60 }
  }
  return { dayStartMin: 6 * 60, dayEndMin: 24 * 60 }
}

function numToDisplayStr(v: unknown): string {
  if (v === undefined || v === null || v === '') return ''
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? String(n) : ''
}

/** Same rules as operator Company page `parseOutOfWorkingHourMarkupFromProfile`. */
function parseOutOfWorkingHourMarkupFromProfile(raw: Record<string, unknown>): {
  mode: 'percentage' | 'fixed_amount'
  valueStr: string
} {
  const modeRaw =
    raw.outOfWorkingHourMarkupMode ??
    raw.out_of_working_hour_markup_mode ??
    raw.outOfWorkingHourMarkupKind
  const fixedRaw =
    raw.outOfWorkingHourMarkupFixedMyr ??
    raw.out_of_working_hour_markup_fixed_myr ??
    raw.outOfWorkingHourMarkupFixedAmount
  const pctRaw = raw.outOfWorkingHourMarkupPercent ?? raw.out_of_working_hour_markup_percent

  const m = String(modeRaw || '')
    .trim()
    .toLowerCase()
  let mode: 'percentage' | 'fixed_amount' = 'percentage'
  if (m === 'fixed_amount' || m === 'fixed') mode = 'fixed_amount'
  else if (m === 'percentage' || m === 'percent') mode = 'percentage'
  else if (!m) {
    const fs = numToDisplayStr(fixedRaw)
    const ps = numToDisplayStr(pctRaw)
    if (fs && !ps) mode = 'fixed_amount'
    else mode = 'percentage'
  }

  if (mode === 'fixed_amount') {
    return { mode, valueStr: numToDisplayStr(fixedRaw) }
  }
  return { mode: 'percentage', valueStr: numToDisplayStr(pctRaw) }
}

export function parseOperatorCompanyHoursFromProfile(
  raw: Record<string, unknown> | null | undefined
): OperatorCompanyHoursInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const wf = String(r.workingHourFrom || r.working_hour_from || '').trim()
  const wt = String(r.workingHourTo || r.working_hour_to || '').trim()
  const of = String(r.outOfWorkingHourFrom || r.out_of_working_hour_from || '').trim()
  const ot = String(r.outOfWorkingHourTo || r.out_of_working_hour_to || '').trim()
  const oohMk = parseOutOfWorkingHourMarkupFromProfile(r)
  return {
    workingHourFrom: wf,
    workingHourTo: wt,
    outOfWorkingHourFrom: of,
    outOfWorkingHourTo: ot,
    outOfWorkingHourMarkupMode: oohMk.mode,
    outOfWorkingHourMarkupValue: oohMk.valueStr,
  }
}

export function parseMarkupNumeric(h: OperatorCompanyHoursInput): number | null {
  const valRaw = String(h.outOfWorkingHourMarkupValue || '').trim()
  if (valRaw === '') return null
  const n = Number(valRaw.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}
