import type { ServiceKey } from '@/lib/cleanlemon-pricing-services'

function num(x: unknown): number {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

/** Parse "HH:mm" to minutes from midnight. */
export function scheduleTimeSlotToMinutes(s: string): number {
  const [h, m] = String(s || '')
    .trim()
    .split(':')
    .map((x) => Number(x))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN
  return h * 60 + m
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function minutesToHHmm(t: number): string {
  const hh = Math.floor(t / 60)
  const mm = t % 60
  return `${pad2(hh)}:${pad2(mm)}`
}

/** Default 30-minute grid; when Pricing uses by-hour, step = configured hours (e.g. 2h → 120 min). */
export function getCreateJobScheduleTimeStepMinutes(
  serviceKey: ServiceKey,
  serviceConfigs: Record<string, unknown> | null | undefined
): number {
  const DEFAULT = 30
  if (serviceKey === 'homestay') return DEFAULT
  const raw = serviceConfigs?.[serviceKey as string]
  if (!raw || typeof raw !== 'object') return DEFAULT
  const c = raw as Record<string, unknown>
  if (!Boolean(c.byHourEnabled)) return DEFAULT
  const byHour = c.byHour && typeof c.byHour === 'object' ? (c.byHour as Record<string, unknown>) : null
  if (!byHour) return DEFAULT
  const hours = Math.max(0, num(byHour.hours))
  if (hours <= 0) return DEFAULT
  const step = Math.round(hours * 60)
  return Math.max(15, step)
}

export type ScheduleDayBounds = {
  /** Minutes from midnight; default 06:00 */
  dayStartMin?: number
  /** Minutes; use 1440 for 24:00 end of day */
  dayEndMin?: number
}

/** Start times from `dayStartMin` (default 06:00); last start so start + step fits before `dayEndMin` (default 24:00). */
export function buildScheduleStartSlotOptions(stepMinutes: number, bounds?: ScheduleDayBounds): string[] {
  const startMin = bounds?.dayStartMin ?? 6 * 60
  const endMin = bounds?.dayEndMin ?? 24 * 60
  const out: string[] = []
  for (let t = startMin; t + stepMinutes <= endMin; t += stepMinutes) {
    out.push(minutesToHHmm(t))
  }
  return out
}

/** End times after `start`: start + step, … until `dayEndMin`. */
export function buildScheduleEndSlotOptions(start: string, stepMinutes: number, bounds?: ScheduleDayBounds): string[] {
  const startM = scheduleTimeSlotToMinutes(start)
  if (Number.isNaN(startM)) return []
  const endMin = bounds?.dayEndMin ?? 24 * 60
  const out: string[] = []
  for (let d = stepMinutes; startM + d <= endMin; d += stepMinutes) {
    out.push(minutesToHHmm(startM + d))
  }
  return out
}
