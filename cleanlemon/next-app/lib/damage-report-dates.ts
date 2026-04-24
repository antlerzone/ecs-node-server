import type { DamageReportItem } from "@/lib/cleanlemon-api"

/** YYYY-MM-DD for filters / sorting — job date first, else reported (UTC calendar day from DB). */
export function damageReportDateYmd(r: Pick<DamageReportItem, "jobDate" | "reportedAt">): string {
  const jd = (r.jobDate || "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(jd)) return jd.slice(0, 10)
  if (r.reportedAt) {
    const d = new Date(r.reportedAt)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  return ""
}

/** Table / export / preview — date only, or em dash. */
export function damageReportDateLabel(r: Pick<DamageReportItem, "jobDate" | "reportedAt">): string {
  return damageReportDateYmd(r) || "—"
}
