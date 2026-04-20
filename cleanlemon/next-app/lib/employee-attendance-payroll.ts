/**
 * Compare check-in/out (Asia/Kuala_Lumpur same calendar day) vs company working window (HH:mm).
 * Illustrative payroll lines — rates come from UI (not legal advice).
 */

const TZ = "Asia/Kuala_Lumpur"

/** Minutes from midnight local (0–24h scale; use for same-day windows). */
export function localMinutesFromDate(d: Date): number {
  const s = d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
  const [h, m] = s.split(":").map((x) => parseInt(x, 10))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

/** Parse "09:00" or "9:30" → minutes from midnight. */
export function parseHHMMToMinutes(s: string): number | null {
  const t = String(s || "").trim()
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

export type AttendanceEdge = {
  workingInIso: string
  workingOutIso: string | null
}

export type WorkingWindow = {
  fromMin: number
  toMin: number
  /** True if end time is "before" start on clock (e.g. night shift 22:00–06:00 next day) — simplified handling. */
  crossesMidnight: boolean
}

export function buildWorkingWindow(workingHourFrom: string, workingHourTo: string): WorkingWindow | null {
  const a = parseHHMMToMinutes(workingHourFrom)
  const b = parseHHMMToMinutes(workingHourTo)
  if (a == null || b == null) return null
  const crossesMidnight = b <= a
  return { fromMin: a, toMin: b, crossesMidnight }
}

export type DeviationMinutes = {
  earlyArrivalMin: number
  lateMin: number
  earlyLeaveMin: number
  otMin: number
}

/**
 * Same-day office shift (no overnight attendance record split). If window crosses midnight, only use when both times fall in the "late" segment heuristically — otherwise treat as simple same-day [from,to].
 */
export function computeDeviationsMinutes(
  edge: AttendanceEdge,
  win: WorkingWindow | null
): DeviationMinutes | null {
  if (!win || !edge.workingOutIso) return null
  const inD = new Date(edge.workingInIso)
  const outD = new Date(edge.workingOutIso)
  const inM = localMinutesFromDate(inD)
  const outM = localMinutesFromDate(outD)

  if (win.crossesMidnight) {
    return {
      earlyArrivalMin: 0,
      lateMin: 0,
      earlyLeaveMin: 0,
      otMin: 0,
    }
  }

  const { fromMin: startM, toMin: endM } = win

  const earlyArrivalMin = inM < startM ? startM - inM : 0
  const lateMin = inM > startM ? inM - startM : 0
  const earlyLeaveMin = outM < endM ? endM - outM : 0
  const otMin = outM > endM ? outM - endM : 0

  return { earlyArrivalMin, lateMin, earlyLeaveMin, otMin }
}

export type MoneyRates = {
  /** RM per minute — early arrival bonus */
  earlyArrivalPerMin: number
  /** RM per minute — late deduction */
  latePerMin: number
  /** RM per minute — early leave deduction */
  earlyLeavePerMin: number
  /** RM per hour — OT / late exit allowance */
  otPerHour: number
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeMoneyFromDeviations(d: DeviationMinutes, rates: MoneyRates) {
  const allowanceEarly = round2(d.earlyArrivalMin * rates.earlyArrivalPerMin)
  const deductionLate = round2(d.lateMin * rates.latePerMin)
  const deductionEarlyLeave = round2(d.earlyLeaveMin * rates.earlyLeavePerMin)
  const allowanceOt = round2((d.otMin / 60) * rates.otPerHour)
  const netAdjustment = round2(allowanceEarly + allowanceOt - deductionLate - deductionEarlyLeave)
  return {
    allowanceEarly,
    deductionLate,
    deductionEarlyLeave,
    allowanceOt,
    netAdjustment,
  }
}
