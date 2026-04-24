/** Cleanlemons primary market: business calendar in Malaysia (UTC+8), aligned with MySQL rows stored in UTC+0. */
export const MALAYSIA_TZ = 'Asia/Kuala_Lumpur'

/** Current calendar date YYYY-MM-DD in Malaysia. */
export function malaysiaYmdFromDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MALAYSIA_TZ }).format(d)
}

/**
 * Malaysia calendar day + offset (whole days).
 * Used for schedule toolbar "today / tomorrow" so it matches DB + AI chat (`contextWorkingDay`).
 */
export function malaysiaYmdForDayOffset(offsetDays: number, fromDate: Date = new Date()): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: MALAYSIA_TZ }).format(fromDate)
  const [y, m, d] = ymd.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d + offsetDays)
  return new Intl.DateTimeFormat('en-CA', { timeZone: MALAYSIA_TZ }).format(new Date(ms))
}
