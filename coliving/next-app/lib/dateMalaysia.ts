/**
 * Malaysia (UTC+8) calendar dates for portal UI.
 * Aligns with server `src/utils/dateMalaysia.js`: DB stores UTC; display/compare by MY calendar day.
 */

const MY_TZ = "Asia/Kuala_Lumpur"

const MY_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * Parse rental `dueDate` from API (ISO Z, or MySQL "YYYY-MM-DD HH:mm:ss" as Malaysia wall time, or date-only YYYY-MM-DD).
 * Same rules as `coliving/next-app/app/operator/invoice/page.tsx` — keeps tenant vs operator list aligned.
 */
export function parseRentalDateAsMalaysiaWall(d: unknown): Date | null {
  if (d == null || d === "") return null
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d
  if (typeof d !== "string") {
    const t = new Date(d as string)
    return Number.isNaN(t.getTime()) ? null : t
  }
  const s = d.trim()
  if (!s) return null
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)) {
    const t = new Date(s)
    return Number.isNaN(t.getTime()) ? null : t
  }
  const donly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (donly) {
    const t = new Date(`${donly[1]}-${donly[2]}-${donly[3]}T12:00:00+08:00`)
    return Number.isNaN(t.getTime()) ? null : t
  }
  const naive = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2}):(\d{2})(\.\d{1,6})?$/)
  if (naive) {
    const hh = naive[4].padStart(2, "0")
    const t = new Date(`${naive[1]}-${naive[2]}-${naive[3]}T${hh}:${naive[5]}:${naive[6]}+08:00`)
    return Number.isNaN(t.getTime()) ? null : t
  }
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? null : t
}

/** Due line on tenant /payment — fixed Malaysia calendar (not device TZ). */
export function formatRentalDueDateMalaysia(d: unknown): string {
  const t = parseRentalDateAsMalaysiaWall(d)
  if (!t) return "—"
  return t.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: MY_TZ,
  })
}

/** Malaysia `YYYY-MM-DD` for overdue checks (same calendar as `formatRentalDueDateMalaysia`). */
export function rentalDueDateToMalaysiaYmd(d: unknown): string {
  const t = parseRentalDateAsMalaysiaWall(d)
  if (!t) return ""
  return dateInstantToMalaysiaYmd(t)
}

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
