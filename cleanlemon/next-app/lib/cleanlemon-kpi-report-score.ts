/** Operator KPI Report: map schedule job.serviceProvider to pricing / KPI rule keys. */
export function scheduleProviderToServiceKey(serviceProvider: string): string {
  const p = String(serviceProvider || '')
    .toLowerCase()
    .replace(/_/g, '-')
  if (p.includes('dobi')) return 'dobi'
  if (p.includes('homestay')) return 'homestay'
  if (p.includes('room-rental') || p.includes('roomrental')) return 'room-rental'
  if (p.includes('commercial')) return 'commercial'
  if (p.includes('office')) return 'office'
  if (p.includes('renovation')) return 'renovation'
  if (p.includes('warm')) return 'warm'
  if (p.includes('deep')) return 'deep'
  return 'general'
}

export type StaffKpiRuleCard = {
  id: string
  serviceProvider: string
  countBy: 'by_price' | 'by_room' | 'by_job'
  rewardMode: 'fixed' | 'percentage'
  rewardValue: number
  createdAt?: string
}

type ServicePointRuleRow = { mode: 'percentage_of_price' | 'fixed_points'; value: number }

function findStaffKpiRule(
  rules: StaffKpiRuleCard[] | undefined | null,
  serviceKey: string,
): StaffKpiRuleCard | null {
  if (!Array.isArray(rules)) return null
  return rules.find((r) => String(r.serviceProvider || '').trim() === serviceKey) || null
}

function legacyRuleForService(
  servicePointRules: Record<string, ServicePointRuleRow> | undefined,
  serviceKey: string,
): StaffKpiRuleCard | null {
  if (!servicePointRules || typeof servicePointRules !== 'object') return null
  const row = servicePointRules[serviceKey]
  if (!row) return null
  return {
    id: `legacy-${serviceKey}`,
    serviceProvider: serviceKey,
    countBy: 'by_price',
    rewardMode: row.mode === 'percentage_of_price' ? 'percentage' : 'fixed',
    rewardValue: Number(row.value) || 0,
    createdAt: '',
  }
}

/** Points for one schedule job toward KPI report (completed jobs only). */
export function computeCompletedJobKpiPoints(
  job: { serviceProvider?: string; price?: number; bedCount?: number; status?: string },
  staffKpiRules: StaffKpiRuleCard[] | undefined,
  servicePointRules: Record<string, ServicePointRuleRow> | undefined,
): number {
  const st = String(job.status || '').toLowerCase()
  if (st !== 'completed') return 0
  const key = scheduleProviderToServiceKey(String(job.serviceProvider || ''))
  const rule =
    findStaffKpiRule(staffKpiRules, key) || legacyRuleForService(servicePointRules, key)
  if (!rule) return 10
  const price = Number(job.price) > 0 ? Number(job.price) : 0
  const rooms = Math.max(1, Math.floor(Number(job.bedCount) || 1))
  const rv = Number(rule.rewardValue) || 0
  if (rule.countBy === 'by_job') return Math.max(0, rv)
  if (rule.countBy === 'by_room') return Math.max(0, rv * rooms)
  if (rule.countBy === 'by_price') {
    if (rule.rewardMode === 'percentage') {
      const raw = (price * Math.min(100, Math.max(0, rv))) / 100
      return Math.round(raw * 100) / 100
    }
    return Math.max(0, rv)
  }
  return 10
}

export type JobStaffPersonFields = {
  staffName?: string
  cleanerName?: string
  assignedTo?: string
  staffEmail?: string
  staffStartEmail?: string
  staffEndEmail?: string
  staffStartFullName?: string
  staffEndFullName?: string
  readyToCleanByEmail?: string
  createdByEmail?: string
}

/** Primary email for KPI grouping (end → primary → start → ready → created). */
export function getPrimaryStaffEmail(job: JobStaffPersonFields): string {
  const se = String(job.staffEndEmail || job.staffEmail || job.staffStartEmail || '').trim()
  if (se) return se
  const rt = String(job.readyToCleanByEmail || '').trim()
  if (rt) return rt
  return String(job.createdByEmail || '').trim()
}

/** Stable key for aggregating one person (lowercased email, or shared unknown bucket). */
export function resolveReportPersonKey(job: JobStaffPersonFields): string {
  const em = getPrimaryStaffEmail(job)
  if (em) return em.toLowerCase()
  return '__unknown_staff__'
}

/** UI label: prefer `Full name (email)` when both exist (name from job fields or employeedetail). */
export function formatReportPersonDisplay(job: JobStaffPersonFields): string {
  const email = getPrimaryStaffEmail(job)
  const nameFromFields = String(job.staffName || job.cleanerName || job.assignedTo || '').trim()
  const nameFromMaster = String(job.staffEndFullName || job.staffStartFullName || '').trim()
  const name = nameFromFields || nameFromMaster
  if (name && email) return `${name} (${email})`
  if (email) return email
  if (name) return name
  return 'Unknown Staff'
}

/** When merging labels for the same email across jobs, prefer `Name (email)` over bare email. */
export function pickBetterPersonDisplay(prev: string | undefined, next: string): string {
  const a = String(prev || '')
  const b = String(next || '')
  const rank = (s: string) => (s.includes('(') && s.includes('@') ? 2 : s.includes('@') ? 1 : 0)
  if (rank(b) > rank(a)) return b
  if (rank(b) < rank(a)) return a
  return b.length >= a.length ? b : a
}

/** @deprecated Prefer formatReportPersonDisplay / resolveReportPersonKey for KPI. */
export function resolveReportStaffLabel(job: JobStaffPersonFields): string {
  return formatReportPersonDisplay(job)
}

export function jobYmdInGoalRange(
  jobYmd: string | undefined,
  goalFrom: string | undefined,
  goalTo: string | undefined,
): boolean {
  const d = String(jobYmd || '').trim().slice(0, 10)
  const f = String(goalFrom || '').trim().slice(0, 10)
  const t = String(goalTo || '').trim().slice(0, 10)
  if (!f || !t) return true
  if (!d) return false
  return d >= f && d <= t
}
