/**
 * Malaysia (UTC+8) calendar dates for portal UI.
 * Aligns with server `src/utils/dateMalaysia.js`: DB stores UTC; display/compare by MY calendar day.
 */

const MY_OFFSET_MS = 8 * 60 * 60 * 1000

function parseUtcInstant(v: string | Date): Date | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v
  }
  const s = String(v || "").trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && s.length === 10) {
    return null
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d/.test(s) && !/[zZ+]/.test(s.slice(-6))) {
    const d = new Date(s.replace(" ", "T") + "Z")
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * UTC instant from DB/API → Malaysia `YYYY-MM-DD` (same formula as `utcDatetimeFromDbToMalaysiaDateOnly`).
 */
export function utcInstantToMalaysiaYmd(utcStrOrDate: string | Date | null | undefined): string {
  if (utcStrOrDate == null || utcStrOrDate === "") return ""
  if (typeof utcStrOrDate === "string") {
    const t = utcStrOrDate.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(t) && t.length === 10) {
      return t
    }
  }
  const d = parseUtcInstant(utcStrOrDate as string | Date)
  if (!d) return ""
  const myMs = d.getTime() + MY_OFFSET_MS
  return new Date(myMs).toISOString().substring(0, 10)
}

/**
 * Prefer Malaysia YMD from a DB datetime; if the value is already date-only `YYYY-MM-DD`, treat as MY calendar date.
 */
export function tenancyDbDateToMalaysiaYmd(v: unknown): string {
  if (v == null || v === "") return ""
  if (typeof v === "string") {
    const t = v.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(t) && t.length === 10) return t
  }
  return utcInstantToMalaysiaYmd(v as string | Date)
}

/**
 * Any JS Date instant → Malaysia calendar `YYYY-MM-DD` (Asia/Kuala_Lumpur).
 * Use this instead of `toISOString().slice(0, 10)` (UTC calendar day).
 */
export function dateInstantToMalaysiaYmd(d: Date): string {
  if (Number.isNaN(d.getTime())) return ""
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d)
  const y = parts.find((p) => p.type === "year")?.value
  const m = parts.find((p) => p.type === "month")?.value
  const day = parts.find((p) => p.type === "day")?.value
  if (y && m && day) return `${y}-${m}-${day}`
  return ""
}

/** Jan 1 of the Malaysia calendar year containing `ref` (e.g. year in Kuala Lumpur). */
export function getMalaysiaFirstDayOfYearYmd(ref: Date = new Date()): string {
  const y = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  })
    .formatToParts(ref)
    .find((p) => p.type === "year")?.value
  if (!y) return `${ref.getFullYear()}-01-01`
  return `${y}-01-01`
}

/**
 * Portal filters: `YYYY-MM-DD` from `<input type="date">` is kept as-is (Malaysia business day).
 * `Date` values are serialized to Malaysia calendar day (not UTC `toISOString` date).
 */
export function portalDateInputToMalaysiaYmd(v: string | Date): string {
  if (typeof v === "string") {
    const t = v.trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  }
  const d = v instanceof Date ? v : new Date(v as string)
  if (Number.isNaN(d.getTime())) return ""
  return dateInstantToMalaysiaYmd(d)
}

/** Current calendar day in Asia/Kuala_Lumpur. */
export function getTodayMalaysiaYmd(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === "year")?.value
  const m = parts.find((p) => p.type === "month")?.value
  const d = parts.find((p) => p.type === "day")?.value
  if (y && m && d) return `${y}-${m}-${d}`
  const x = new Date()
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`
}

/**
 * Add N calendar days to a Malaysia `YYYY-MM-DD` (anchor noon MY).
 */
export function addDaysMalaysiaYmd(isoYmd: string, days: number): string {
  const s = String(isoYmd || "").trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ""
  const d = new Date(`${s}T12:00:00+08:00`)
  if (Number.isNaN(d.getTime())) return ""
  d.setDate(d.getDate() + days)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d)
  const y = parts.find((p) => p.type === "year")?.value
  const m = parts.find((p) => p.type === "month")?.value
  const day = parts.find((p) => p.type === "day")?.value
  if (y && m && day) return `${y}-${m}-${day}`
  return d.toISOString().slice(0, 10)
}

/**
 * Previous calendar month in Asia/Kuala_Lumpur (first / last day as YYYY-MM-DD).
 * Used for operator finance default date ranges (invoice list, expenses, reports).
 */
export function getPreviousMonthRangeMalaysiaYmd(): { from: string; to: string } {
  const today = getTodayMalaysiaYmd()
  const [ys, ms] = today.split("-").map(Number)
  let y = ys
  let m = ms - 1
  if (m < 1) {
    m = 12
    y -= 1
  }
  const from = `${y}-${String(m).padStart(2, "0")}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  return { from, to }
}
