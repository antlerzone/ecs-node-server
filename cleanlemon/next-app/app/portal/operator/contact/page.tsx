"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DataTable, Column, Action } from '@/components/shared/data-table'
import {
  Plus,
  Users,
  Building2,
  Eye,
  Archive,
  UserMinus,
  FileText,
  Briefcase,
  RefreshCcw,
  Settings,
  X,
  Pencil,
  Search,
  MoreHorizontal,
  MessageSquare,
} from 'lucide-react'
import { GiveReviewDialog } from '@/components/cleanlemons/give-review-dialog'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { useEffectiveOperatorId } from '@/lib/cleanlemon-effective-operator-id'
import { cn } from '@/lib/utils'
import {
  fetchOperatorContacts,
  createOperatorContact,
  updateOperatorContact,
  fetchOperatorSettings,
  saveOperatorSettings,
  postOperatorContactsSync,
} from '@/lib/cleanlemon-api'

type Permission = 'staff' | 'driver' | 'dobi' | 'clients' | 'supervisor'
type EmploymentStatus = 'full-time' | 'part-time'
type ContactStatus = 'active' | 'archived' | 'resigned'
type TabKey = 'staff' | 'clients'

type AccountEntry = { clientId?: string; provider?: string; id?: string }

type SalaryStatutoryDefaults = {
  epfApplies: boolean
  socsoApplies: boolean
  eisApplies: boolean
  mtdApplies: boolean
}

const DEFAULT_SALARY_STATUTORY: SalaryStatutoryDefaults = {
  epfApplies: true,
  socsoApplies: true,
  eisApplies: true,
  mtdApplies: false,
}

function normalizeSalaryStatutory(
  v: Partial<SalaryStatutoryDefaults> | undefined
): SalaryStatutoryDefaults {
  if (!v || typeof v !== 'object') return { ...DEFAULT_SALARY_STATUTORY }
  return {
    epfApplies: v.epfApplies !== false,
    socsoApplies: v.socsoApplies !== false,
    eisApplies: v.eisApplies !== false,
    mtdApplies: v.mtdApplies === true,
  }
}

type ContactRecord = {
  id: string
  /** API: employee vs B2B client junction row */
  contactSource?: 'employee' | 'client'
  operatorId?: string
  name: string
  email: string
  phone: string
  permissions: Permission[]
  status: ContactStatus
  joinedAt: string
  employmentStatus: EmploymentStatus
  salaryBasic: number
  team?: string
  bankName: string
  bankAccountNo: string
  icCopyUrl: string
  passportCopyUrl: string
  offerLetterUrl?: string
  workingWithUsCount?: number
  /** CRM: default EPF / SOCSO / EIS / MTD for payroll (employee contacts). */
  salaryStatutoryDefaults?: SalaryStatutoryDefaults
  trainings: string[]
  remarkHistory: string[]
  account?: AccountEntry[]
  /** Employee row: cln_employeedetail.id when API provides it. */
  employeeDetailId?: string
}

function mergeAccountEntryLocal(
  account: AccountEntry[],
  operatorId: string,
  provider: string,
  contactId: string
): AccountEntry[] {
  const p = provider.toLowerCase()
  const list = [...(Array.isArray(account) ? account : [])]
  const filtered = list.filter(
    (a) => !(a.clientId === operatorId && String(a.provider || '').toLowerCase() === p)
  )
  if (contactId.trim()) filtered.push({ clientId: operatorId, provider, id: contactId.trim() })
  return filtered
}

/** Accounting contact id for this operator + provider key (bukku / xero). */
function accountIdFromRow(
  row: ContactRecord,
  operatorId: string,
  providerNorm: string
): string {
  const acc = Array.isArray(row.account) ? row.account : []
  const hit = acc.find(
    (a) => a.clientId === operatorId && String(a.provider || '').toLowerCase() === providerNorm
  )
  return hit?.id ? String(hit.id) : ''
}

/** Prefer settings provider; else first account[] row for this operator (so the field is never blank when data exists). */
function accountIdForEditForm(
  row: ContactRecord,
  operatorId: string,
  preferredProvider: string
): string {
  const pref = String(preferredProvider || 'bukku').toLowerCase()
  const byPref = accountIdFromRow(row, operatorId, pref)
  if (byPref) return byPref
  const acc = Array.isArray(row.account) ? row.account : []
  const any = acc.find((a) => a.clientId === operatorId && a?.id)
  return any?.id != null ? String(any.id) : ''
}

/** Employee sub-roles (multi-select; stored in crm_json.portalRoles). */
const employeeRoleOptions: { value: Exclude<Permission, 'clients'>; label: string }[] = [
  { value: 'staff', label: 'Staff' },
  { value: 'driver', label: 'Driver' },
  { value: 'dobi', label: 'Dobi' },
  { value: 'supervisor', label: 'Supervisor' },
]

/** Operator portal sidebar pages — used for per-role access in Contact settings. */
const OPERATOR_PORTAL_PAGES: { href: string; label: string }[] = [
  { href: '/operator', label: 'Dashboard' },
  { href: '/operator/profile', label: 'Profile' },
  { href: '/operator/company', label: 'Company' },
  { href: '/operator/contact', label: 'Contacts' },
  { href: '/operator/approval', label: 'Booking requests' },
  { href: '/operator/team', label: 'Teams' },
  { href: '/operator/property', label: 'Properties' },
  { href: '/operator/smart-door', label: 'Smart Door' },
  { href: '/operator/schedule', label: 'Schedule' },
  { href: '/operator/damage', label: 'Damage' },
  { href: '/operator/agreement', label: 'Agreements' },
  { href: '/operator/invoices', label: 'Invoices' },
  { href: '/operator/pricing', label: 'Pricing' },
  { href: '/operator/calender', label: 'Calender' },
  { href: '/operator/salary', label: 'Salary' },
  { href: '/operator/accounting', label: 'Accounting' },
  { href: '/operator/kpi', label: 'KPI Reports' },
  { href: '/operator/kpi-settings', label: 'KPI Settings' },
]

const PORTAL_PAGES_SPLIT_AT = Math.ceil(OPERATOR_PORTAL_PAGES.length / 2)
const OPERATOR_PORTAL_PAGES_LEFT = OPERATOR_PORTAL_PAGES.slice(0, PORTAL_PAGES_SPLIT_AT)
const OPERATOR_PORTAL_PAGES_RIGHT = OPERATOR_PORTAL_PAGES.slice(PORTAL_PAGES_SPLIT_AT)

const PAGE_ACCESS_OPTIONS = [
  { value: 'none', label: 'No available' },
  { value: 'full', label: 'Full access' },
  { value: 'read', label: 'Read only' },
  { value: 'read_write', label: 'Read & write' },
  { value: 'read_write_delete', label: 'Read & write & delete' },
] as const

type PageAccessLevel = (typeof PAGE_ACCESS_OPTIONS)[number]['value']

const CONTACT_SETTINGS_ROLE_ROWS: { key: Permission; label: string }[] = [
  { key: 'staff', label: 'Staff' },
  { key: 'driver', label: 'Driver' },
  { key: 'dobi', label: 'Dobi' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'clients', label: 'Client (B2B)' },
]

function buildDefaultRolePageAccess(): Record<string, Record<string, PageAccessLevel>> {
  const pageDefaults = Object.fromEntries(
    OPERATOR_PORTAL_PAGES.map((p) => [p.href, 'full' as PageAccessLevel])
  )
  return Object.fromEntries(CONTACT_SETTINGS_ROLE_ROWS.map((r) => [r.key, { ...pageDefaults }]))
}

type ContactPortalSettingsState = {
  /** Custom training labels for create/edit; empty → use built-in presets. */
  trainingRecordNames: string[]
  rolePageAccess: Record<string, Record<string, PageAccessLevel>>
}

function parseTrainingRecordNamesArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out = raw
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(out)]
}

function normalizeContactPortalSettings(raw: unknown): ContactPortalSettingsState {
  const defaults = buildDefaultRolePageAccess()
  if (!raw || typeof raw !== 'object') {
    return { trainingRecordNames: [], rolePageAccess: defaults }
  }
  const o = raw as Record<string, unknown>
  let trainingRecordNames = parseTrainingRecordNamesArray(o.trainingRecordNames)
  if (
    trainingRecordNames.length === 0 &&
    typeof o.trainingRecordName === 'string' &&
    o.trainingRecordName.trim()
  ) {
    trainingRecordNames = [o.trainingRecordName.trim()]
  }
  const rpa = o.rolePageAccess
  const merged: Record<string, Record<string, PageAccessLevel>> = { ...defaults }
  if (rpa && typeof rpa === 'object') {
    for (const row of CONTACT_SETTINGS_ROLE_ROWS) {
      const roleMap = (rpa as Record<string, unknown>)[row.key]
      if (roleMap && typeof roleMap === 'object') {
        merged[row.key] = { ...defaults[row.key] }
        for (const p of OPERATOR_PORTAL_PAGES) {
          const v = (roleMap as Record<string, unknown>)[p.href]
          if (
            v === 'none' ||
            v === 'full' ||
            v === 'read' ||
            v === 'read_write' ||
            v === 'read_write_delete'
          ) {
            merged[row.key][p.href] = v
          }
        }
      }
    }
  }
  return { trainingRecordNames, rolePageAccess: merged }
}

/** Checkbox options on create/edit: only operator-defined names (Contact → Settings). No built-in fallback. */
function getTrainingCheckboxOptions(trainingRecordNames: string[]): string[] {
  const custom = trainingRecordNames.map((s) => s.trim()).filter(Boolean)
  return [...new Set(custom)]
}

function toggleTrainingSelection(trainings: string[], option: string, on: boolean): string[] {
  if (on) {
    if (trainings.includes(option)) return trainings
    return [...trainings, option]
  }
  return trainings.filter((t) => t !== option)
}

const EMPLOYEE_ROLE_VALUES = ['staff', 'driver', 'dobi', 'supervisor'] as const

function toggleEmployeeRole(
  current: Permission[],
  role: Permission,
  checked: boolean
): Permission[] {
  const em = EMPLOYEE_ROLE_VALUES as readonly string[]
  const set = new Set(current.filter((p) => em.includes(p)))
  if (checked) set.add(role)
  else set.delete(role)
  return Array.from(set) as Permission[]
}

function isoDateLocal(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Normalize stored joinedAt to yyyy-MM-dd for input type="date". */
function joinedAtToInputValue(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''
  const s = raw.trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

/** Default employee role when opening Add Contact from Staff tab */
const staffTabDefaultRole: Permission = 'staff'

function contactSaveError(res: { reason?: string; message?: string }, fallback: string) {
  if (
    (res.reason === 'SUPERVISOR_EMAIL_IN_USE' ||
      res.reason === 'EMAIL_IN_USE' ||
      res.reason === 'ARCHIVE_REQUIRES_RESIGN' ||
      res.reason === 'SINGLE_ROLE_REQUIRED') &&
    typeof res.message === 'string'
  ) {
    return res.message
  }
  if (typeof res.message === 'string' && res.message) return res.message
  if (typeof res.reason === 'string' && res.reason) return res.reason
  return fallback
}

function normalizeContactEmail(email: string): string {
  return String(email || '')
    .trim()
    .toLowerCase()
}

/** Union of permissions for each email (same person may have employee + client junction rows). */
function buildEmailPermissionMap(contacts: ContactRecord[]): Map<string, Set<Permission>> {
  const m = new Map<string, Set<Permission>>()
  for (const c of contacts) {
    const k = normalizeContactEmail(c.email)
    if (!k) continue
    if (!m.has(k)) m.set(k, new Set())
    for (const p of c.permissions) m.get(k)!.add(p)
  }
  return m
}

function hasEmployeeRolePermission(perms: Set<Permission>): boolean {
  return (
    perms.has('staff') ||
    perms.has('driver') ||
    perms.has('dobi') ||
    perms.has('supervisor')
  )
}

function hasTabPermission(
  record: ContactRecord,
  tab: TabKey,
  emailPerms: Map<string, Set<Permission>>
): boolean {
  const perms = emailPerms.get(normalizeContactEmail(record.email))
  if (!perms) return false
  if (tab === 'staff') return hasEmployeeRolePermission(perms)
  return perms.has('clients')
}

/** One row per email per tab: prefer employee junction on staff tabs, client junction on Clients tab. */
function dedupeContactsForTab(rows: ContactRecord[], tab: TabKey): ContactRecord[] {
  const byEmail = new Map<string, ContactRecord>()
  const preferClient = tab === 'clients'
  for (const c of rows) {
    const k = normalizeContactEmail(c.email)
    if (!k) continue
    const prev = byEmail.get(k)
    if (!prev) {
      byEmail.set(k, c)
      continue
    }
    const cIsClient = c.contactSource === 'client'
    const pIsClient = prev.contactSource === 'client'
    if (preferClient) {
      if (cIsClient && !pIsClient) byEmail.set(k, c)
      else if (!cIsClient && pIsClient) byEmail.set(k, prev)
    } else {
      if (!cIsClient && pIsClient) byEmail.set(k, c)
      else if (cIsClient && !pIsClient) byEmail.set(k, prev)
    }
  }
  return Array.from(byEmail.values())
}

function enrichRowMergedPermissions(
  row: ContactRecord,
  emailPerms: Map<string, Set<Permission>>
): ContactRecord {
  const k = normalizeContactEmail(row.email)
  const merged = emailPerms.get(k)
  if (!merged || merged.size === 0) return row
  return { ...row, permissions: Array.from(merged) as Permission[] }
}

function prettyPermissions(permissions: Permission[]): string {
  return permissions.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
}

/** Offer letters target operator staff roles only (not clients-only). */
function isOfferLetterStaffContact(r: ContactRecord): boolean {
  return (
    r.permissions.includes('staff') ||
    r.permissions.includes('driver') ||
    r.permissions.includes('dobi') ||
    r.permissions.includes('supervisor')
  )
}

function isClientContact(r: ContactRecord): boolean {
  if (r.contactSource === 'client') return true
  if (r.contactSource === 'employee') return false
  return r.permissions.includes('clients')
}

/** Real uploaded asset URL (hide placeholder `#`, `-`, empty). */
function isPreviewableAssetUrl(raw: string | undefined | null): boolean {
  if (raw == null || typeof raw !== 'string') return false
  const t = raw.trim()
  if (!t || t === '#' || t === '-') return false
  try {
    const u = new URL(t)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function docUrlLooksLikePdf(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

function ContactIdentityDocPreview({ url, label }: { url: string; label: string }) {
  const [useIframe, setUseIframe] = useState(docUrlLooksLikePdf(url))
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="overflow-hidden rounded-md border bg-muted/30">
        {useIframe ? (
          <iframe title={label} src={url} className="h-[min(40vh,320px)] w-full border-0 bg-background" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- runtime URL from CRM/OSS
          <img
            src={url}
            alt={label}
            className="mx-auto max-h-[min(40vh,320px)] w-full object-contain bg-background"
            onError={() => setUseIframe(true)}
          />
        )}
      </div>
    </div>
  )
}

export default function ContactPage() {
  const router = useRouter()
  const { user } = useAuth()
  const operatorId = useEffectiveOperatorId(user)
  const [activeTab, setActiveTab] = useState<TabKey>('staff')
  const [mobileContactSearch, setMobileContactSearch] = useState('')
  const [mobileContactStatus, setMobileContactStatus] = useState('all')
  const [mobileContactEmployment, setMobileContactEmployment] = useState('all')
  const [contacts, setContacts] = useState<ContactRecord[]>([])
  const [contactsLoading, setContactsLoading] = useState(true)
  const [accountingConnected, setAccountingConnected] = useState(false)
  const [accountingProvider, setAccountingProvider] = useState('')
  const [showSyncDialog, setShowSyncDialog] = useState(false)
  const [syncDirection, setSyncDirection] = useState<'to-accounting' | 'from-accounting'>('to-accounting')
  const [syncingContacts, setSyncingContacts] = useState(false)
  const [contactPortalSettings, setContactPortalSettings] = useState<ContactPortalSettingsState>(() =>
    normalizeContactPortalSettings(null)
  )
  const [contactSettingsOpen, setContactSettingsOpen] = useState(false)
  const [contactSettingsDraft, setContactSettingsDraft] = useState<ContactPortalSettingsState>(() =>
    normalizeContactPortalSettings(null)
  )
  const [contactSettingsSaving, setContactSettingsSaving] = useState(false)
  const [newTrainingNameInput, setNewTrainingNameInput] = useState('')
  const [staffReviewOpen, setStaffReviewOpen] = useState(false)
  const [staffReviewContact, setStaffReviewContact] = useState<ContactRecord | null>(null)

  const loadContacts = useCallback(async () => {
    setContactsLoading(true)
    try {
      const res = await fetchOperatorContacts(operatorId)
      if (!res.ok) {
        toast.error(typeof res.reason === 'string' ? res.reason : 'Failed to load contacts')
        setContacts([])
        return
      }
      setContacts((res.items || []) as ContactRecord[])
    } finally {
      setContactsLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  useEffect(() => {
    setMobileContactSearch('')
    setMobileContactStatus('all')
    setMobileContactEmployment('all')
  }, [activeTab])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await fetchOperatorSettings(operatorId)
      if (cancelled || !r?.ok) return
      const s = r.settings ?? r
      const bukku = Boolean(s?.bukku)
      const xero = Boolean(s?.xero)
      setAccountingConnected(bukku || xero)
      setAccountingProvider(bukku ? 'bukku' : xero ? 'xero' : '')
      setContactPortalSettings(normalizeContactPortalSettings(s?.contactPortalSettings))
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  useEffect(() => {
    if (contactSettingsOpen) {
      setContactSettingsDraft(contactPortalSettings)
      setNewTrainingNameInput('')
    }
  }, [contactSettingsOpen, contactPortalSettings])

  const trainingCheckboxOptions = useMemo(
    () => getTrainingCheckboxOptions(contactPortalSettings.trainingRecordNames),
    [contactPortalSettings.trainingRecordNames]
  )

  const addDraftTrainingName = useCallback(() => {
    const v = newTrainingNameInput.trim()
    if (!v) return
    setContactSettingsDraft((d) => {
      if (d.trainingRecordNames.includes(v)) return d
      return { ...d, trainingRecordNames: [...d.trainingRecordNames, v] }
    })
    setNewTrainingNameInput('')
  }, [newTrainingNameInput])

  const removeDraftTrainingName = useCallback((name: string) => {
    setContactSettingsDraft((d) => ({
      ...d,
      trainingRecordNames: d.trainingRecordNames.filter((x) => x !== name),
    }))
  }, [])

  const saveContactPortalSettings = useCallback(async () => {
    setContactSettingsSaving(true)
    try {
      const res = await saveOperatorSettings(operatorId, {
        contactPortalSettings: contactSettingsDraft,
      })
      if (!res?.ok) {
        toast.error(typeof res?.reason === 'string' ? res.reason : 'Failed to save settings')
        return
      }
      setContactPortalSettings(contactSettingsDraft)
      toast.success('Settings saved')
      setContactSettingsOpen(false)
    } finally {
      setContactSettingsSaving(false)
    }
  }, [operatorId, contactSettingsDraft])

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  /** Add dialog: B2B client vs employee — drives which fields are shown. */
  const [addContactKind, setAddContactKind] = useState<'client' | 'employee'>('employee')
  const [newContact, setNewContact] = useState<{
    name: string
    email: string
    phone: string
    joinedAt: string
    salaryBasic: number
    employmentStatus: EmploymentStatus
    workingWithUsCount: number
    permissions: Permission[]
    trainings: string[]
    salaryStatutoryDefaults: SalaryStatutoryDefaults
  }>({
    name: '',
    email: '',
    phone: '',
    joinedAt: isoDateLocal(),
    salaryBasic: 0,
    employmentStatus: 'part-time',
    workingWithUsCount: 0,
    permissions: ['staff'],
    trainings: [],
    salaryStatutoryDefaults: { ...DEFAULT_SALARY_STATUTORY },
  })
  const [createRemark, setCreateRemark] = useState('')

  useEffect(() => {
    if (!isAddDialogOpen) return
    setCreateRemark('')
    const kind = activeTab === 'clients' ? 'client' : 'employee'
    setAddContactKind(kind)
    setNewContact({
      name: '',
      email: '',
      phone: '',
      joinedAt: isoDateLocal(),
      salaryBasic: 0,
      employmentStatus: 'part-time',
      workingWithUsCount: 0,
      permissions: kind === 'client' ? ['clients'] : [staffTabDefaultRole],
      trainings: [],
      salaryStatutoryDefaults: { ...DEFAULT_SALARY_STATUTORY },
    })
  }, [isAddDialogOpen, activeTab])

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<ContactRecord | null>(null)
  const [editingRemark, setEditingRemark] = useState('')
  const [editAccountingId, setEditAccountingId] = useState('')

  const refreshContactPortalSettings = useCallback(async () => {
    const r = await fetchOperatorSettings(operatorId)
    if (r?.ok) {
      const s = r.settings ?? r
      setContactPortalSettings(normalizeContactPortalSettings(s?.contactPortalSettings))
    }
  }, [operatorId])

  useEffect(() => {
    if (!isAddDialogOpen && !isEditDialogOpen) return
    void refreshContactPortalSettings()
  }, [isAddDialogOpen, isEditDialogOpen, operatorId, refreshContactPortalSettings])

  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false)
  const [detailContact, setDetailContact] = useState<ContactRecord | null>(null)

  const [isResignDialogOpen, setIsResignDialogOpen] = useState(false)
  const [resignContact, setResignContact] = useState<ContactRecord | null>(null)
  const [resignDate, setResignDate] = useState('')
  const [resignRemark, setResignRemark] = useState('')

  const emailPermissionMap = useMemo(() => buildEmailPermissionMap(contacts), [contacts])

  const currentData = useMemo(() => {
    const filtered = contacts.filter((c) => hasTabPermission(c, activeTab, emailPermissionMap))
    const deduped = dedupeContactsForTab(filtered, activeTab)
    return deduped.map((r) => enrichRowMergedPermissions(r, emailPermissionMap))
  }, [contacts, activeTab, emailPermissionMap])

  /** Mobile list (matches client /properties: search + filters + stacked rows, no DataTable). */
  const mobileFilteredContacts = useMemo(() => {
    let rows = currentData
    const q = mobileContactSearch.trim().toLowerCase()
    if (q) {
      rows = rows.filter((r) => {
        const parts = [r.name, r.email, r.phone]
        if (activeTab === 'staff') parts.push(r.team || '')
        return parts.some((f) => String(f || '').toLowerCase().includes(q))
      })
    }
    if (mobileContactStatus !== 'all') {
      rows = rows.filter((r) => r.status === mobileContactStatus)
    }
    if (activeTab === 'staff' && mobileContactEmployment !== 'all') {
      rows = rows.filter((r) => r.employmentStatus === mobileContactEmployment)
    }
    return rows
  }, [
    currentData,
    mobileContactSearch,
    mobileContactStatus,
    mobileContactEmployment,
    activeTab,
  ])

  const statusClass = (status: ContactStatus) => {
    if (status === 'active') return 'bg-green-100 text-green-800'
    if (status === 'archived') return 'bg-amber-100 text-amber-800'
    return 'bg-gray-100 text-gray-800'
  }

  const columns: Column<ContactRecord>[] = useMemo(() => {
    const nameCol: Column<ContactRecord> = {
      key: 'name',
      label: 'Name',
      sortable: true,
      render: (_, row) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar className="h-7 w-7 shrink-0 sm:h-8 sm:w-8">
            <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${row.name}`} />
            <AvatarFallback>{row.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="hidden text-xs text-muted-foreground md:block">{prettyPermissions(row.permissions)}</p>
          </div>
        </div>
      ),
    }
    const emailCol: Column<ContactRecord> = {
      key: 'email',
      label: 'Email',
      sortable: true,
      render: (value) => (
        <span className="block max-w-[10rem] truncate text-sm sm:max-w-none" title={String(value)}>
          {String(value)}
        </span>
      ),
    }
    const contactCol: Column<ContactRecord> = {
      key: 'phone',
      label: 'Contact',
      render: (value) => (
        <span className="block max-w-[7rem] truncate text-sm sm:max-w-none" title={String(value)}>
          {String(value || '—')}
        </span>
      ),
    }
    const statusCol: Column<ContactRecord> = {
      key: 'status',
      label: 'Status',
      sortable: true,
      filterable: true,
      filterOptions: [
        { label: 'Active', value: 'active' },
        { label: 'Archived', value: 'archived' },
        { label: 'Resigned', value: 'resigned' },
      ],
      render: (value) => (
        <Badge variant="secondary" className={cn('capitalize', statusClass(value as ContactStatus))}>
          {String(value)}
        </Badge>
      ),
    }
    if (activeTab === 'clients') {
      return [nameCol, emailCol, contactCol, statusCol]
    }
    const teamCol: Column<ContactRecord> = {
      key: 'team',
      label: 'Team',
      render: (value) => (
        <span className="block max-w-[6rem] truncate text-sm sm:max-w-none" title={value ? String(value) : undefined}>
          {value ? String(value) : '—'}
        </span>
      ),
    }
    const employmentCol: Column<ContactRecord> = {
      key: 'employmentStatus',
      label: 'Employment',
      filterable: true,
      filterOptions: [
        { label: 'Full-time', value: 'full-time' },
        { label: 'Part-time', value: 'part-time' },
      ],
      render: (value) => <Badge variant="outline" className="capitalize">{String(value)}</Badge>,
    }
    return [nameCol, emailCol, contactCol, teamCol, statusCol, employmentCol]
  }, [activeTab])

  const addContact = async () => {
    const name = newContact.name.trim()
    const email = newContact.email.trim()
    const phone = newContact.phone.trim()
    const empPerms = newContact.permissions.filter((p) =>
      (EMPLOYEE_ROLE_VALUES as readonly string[]).includes(p)
    )
    const perms =
      addContactKind === 'client' ? (['clients'] as Permission[]) : (empPerms as Permission[])

    if (!name) {
      toast.error('Please enter a name')
      return
    }
    if (addContactKind === 'client') {
      if (!email && !phone) {
        toast.error('Please provide at least email or phone')
        return
      }
    } else {
      if (empPerms.length < 1) {
        toast.error('Select at least one role (Staff, Driver, Dobi, or Supervisor)')
        return
      }
      if (empPerms.includes('supervisor') && !email) {
        toast.error('Supervisor requires an email')
        return
      }
    }

    const emailNorm = email.toLowerCase()
    if (
      emailNorm &&
      contacts.some(
        (c) => c.email.trim().toLowerCase() === emailNorm && c.status === 'active'
      )
    ) {
      toast.error('This email is already used by another contact in your directory.')
      return
    }
    const remarkHistory: string[] = []
    if (createRemark.trim()) {
      remarkHistory.push(`${new Date().toLocaleString('en-MY')}: ${createRemark.trim()}`)
    }
    remarkHistory.push(`${new Date().toLocaleString('en-MY')}: profile created`)
    const payload = {
      operatorId,
      name,
      email,
      phone: phone || '-',
      permissions: perms,
      status: 'active',
      joinedAt: newContact.joinedAt.trim() || isoDateLocal(),
      employmentStatus: newContact.employmentStatus,
      salaryBasic: newContact.salaryBasic,
      bankName: '-',
      bankAccountNo: '-',
      icCopyUrl: '#',
      passportCopyUrl: '#',
      trainings: newContact.trainings,
      remarkHistory,
      workingWithUsCount: newContact.workingWithUsCount,
      ...(addContactKind === 'employee'
        ? { salaryStatutoryDefaults: normalizeSalaryStatutory(newContact.salaryStatutoryDefaults) }
        : {}),
    }
    const res = await createOperatorContact(payload)
    if (!res.ok) {
      toast.error(contactSaveError(res, 'Failed to add contact'))
      return
    }
    await loadContacts()
    setIsAddDialogOpen(false)
    toast.success(`${name} added`)
  }

  const openEdit = (row: ContactRecord) => {
    setEditingContact({
      ...row,
      salaryStatutoryDefaults: normalizeSalaryStatutory(row.salaryStatutoryDefaults),
    })
    setEditingRemark('')
    setEditAccountingId(accountIdForEditForm(row, operatorId, accountingProvider || 'bukku'))
    setIsEditDialogOpen(true)
  }

  const saveEdit = async () => {
    if (!editingContact) return
    const emailNorm = editingContact.email.trim().toLowerCase()
    const dupOther = contacts.find(
      (c) =>
        c.id !== editingContact.id &&
        c.email.trim().toLowerCase() === emailNorm &&
        c.status === 'active'
    )
    if (dupOther) {
      toast.error('This email is already used by another contact in your directory.')
      return
    }
    let joinedNorm = joinedAtToInputValue(editingContact.joinedAt)
    if (!joinedNorm) {
      if (isClientContact(editingContact)) {
        joinedNorm = isoDateLocal()
      } else {
        toast.error('Please set a valid joined date')
        return
      }
    }

    let outPermissions = editingContact.permissions
    if (isClientContact(editingContact)) {
      outPermissions = ['clients']
    } else {
      outPermissions = editingContact.permissions.filter((p) =>
        (EMPLOYEE_ROLE_VALUES as readonly string[]).includes(p)
      ) as Permission[]
      if (outPermissions.length < 1) {
        toast.error('Select at least one employee role')
        return
      }
      if (outPermissions.includes('supervisor') && !editingContact.email.trim()) {
        toast.error('Supervisor requires an email')
        return
      }
    }

    const nextRemarkHistory = [...editingContact.remarkHistory]
    if (editingRemark.trim()) nextRemarkHistory.unshift(`${new Date().toLocaleString('en-MY')}: ${editingRemark.trim()}`)
    let nextAccount = Array.isArray(editingContact.account) ? editingContact.account : []
    const accountProvider = (accountingProvider || 'bukku').trim() || 'bukku'
    nextAccount = mergeAccountEntryLocal(
      nextAccount,
      operatorId,
      accountProvider,
      editAccountingId
    )
    const payload = {
      ...editingContact,
      operatorId,
      permissions: outPermissions,
      joinedAt: joinedNorm,
      remarkHistory: nextRemarkHistory,
      account: nextAccount,
      ...(!isClientContact(editingContact)
        ? { salaryStatutoryDefaults: normalizeSalaryStatutory(editingContact.salaryStatutoryDefaults) }
        : {}),
    }
    const res = await updateOperatorContact(editingContact.id, payload)
    if (!res.ok) {
      toast.error(contactSaveError(res, 'Update failed'))
      return
    }
    await loadContacts()
    setIsEditDialogOpen(false)
    setEditingContact(null)
    toast.success('Contact updated')
    setEditAccountingId('')
  }

  const handleConfirmSyncAll = async () => {
    setSyncingContacts(true)
    try {
      const res = (await postOperatorContactsSync(operatorId, syncDirection)) as {
        ok?: boolean
        reason?: string
        provider?: string
        scanned?: number
        synced?: number
        linked?: number
        created?: number
        failed?: number
        skipped?: number
        failureSamples?: Array<{ stage?: string; reason?: string; email?: string; name?: string; remoteId?: string }>
      }
      if (res?.ok === false) {
        toast.error(res?.reason || 'Sync failed')
        return
      }
      const prov = String(res?.provider || accountingProvider || 'accounting').toUpperCase()
      const okCount = (res?.synced ?? 0) + (res?.linked ?? 0)
      const skipped = res?.skipped ?? 0
      const samples = res?.failureSamples ?? []
      const sampleText =
        samples.length > 0
          ? ` ${samples
              .slice(0, 3)
              .map((s) => s.reason || s.stage || '')
              .filter(Boolean)
              .join('; ')}`
          : ''
      const skipPart = skipped > 0 ? `, skipped ${skipped} (e.g. supplier-only in Bukku)` : ''
      toast.success(
        `${prov}: scanned ${res?.scanned ?? 0}, ok ${okCount}, created ${res?.created ?? 0}, failed ${res?.failed ?? 0}${skipPart}.${sampleText}`
      )
      setShowSyncDialog(false)
      await loadContacts()
    } finally {
      setSyncingContacts(false)
    }
  }

  const archiveContact = async (row: ContactRecord) => {
    if (!isClientContact(row) && row.status !== 'resigned') {
      toast.error('Archive is only allowed after resign for staff/driver/dobi/supervisor.')
      return
    }
    const res = await updateOperatorContact(row.id, { status: 'archived' })
    if (!res.ok) {
      toast.error(contactSaveError(res, 'Archive failed'))
      return
    }
    await loadContacts()
    toast.success(`${row.name} archived`)
  }

  const openResignDialog = (row: ContactRecord) => {
    if (isClientContact(row)) {
      toast.error('Client does not use resign. Use Archive.')
      return
    }
    setResignContact(row)
    setResignDate('')
    setResignRemark('')
    setIsResignDialogOpen(true)
  }

  const submitResign = async () => {
    if (!resignContact) return
    if (!resignDate || !resignRemark.trim()) return toast.error('Please select resign date and fill remark')
    const entry = `${new Date().toLocaleString('en-MY')}: resigned at ${resignDate} - ${resignRemark.trim()}`
    const res = await updateOperatorContact(resignContact.id, {
      status: 'resigned',
      remarkHistory: [entry, ...resignContact.remarkHistory],
    })
    if (!res.ok) {
      toast.error(typeof res.reason === 'string' ? res.reason : 'Save failed')
      return
    }
    await loadContacts()
    setIsResignDialogOpen(false)
    setResignContact(null)
    toast.success('Resign saved')
  }

  const viewDetail = (row: ContactRecord) => {
    setDetailContact(row)
    setIsDetailDialogOpen(true)
  }

  const viewOfferLetter = (row: ContactRecord) => {
    if (!row.offerLetterUrl) return
    window.open(row.offerLetterUrl, '_blank', 'noopener,noreferrer')
  }

  const goCreateOfferLetter = (row: ContactRecord) => {
    router.push(
      `/portal/operator/agreement?createAgreement=1&contactId=${encodeURIComponent(row.id)}`
    )
  }

  const actions: Action<ContactRecord>[] = [
    { label: 'Edit', icon: <Pencil className="h-4 w-4 mr-2" />, onClick: openEdit },
    { label: 'View Detail', icon: <Eye className="h-4 w-4 mr-2" />, onClick: viewDetail },
    {
      label: 'Give review',
      icon: <MessageSquare className="h-4 w-4 mr-2" />,
      onClick: (row) => {
        setStaffReviewContact(row)
        setStaffReviewOpen(true)
      },
      visible: (r) => !isClientContact(r) && r.status === 'active',
    },
    {
      label: 'Create Offer Letter',
      icon: <Briefcase className="h-4 w-4 mr-2" />,
      onClick: goCreateOfferLetter,
      visible: (r) => isOfferLetterStaffContact(r) && !r.offerLetterUrl,
    },
    {
      label: 'View Offer Letter',
      icon: <FileText className="h-4 w-4 mr-2" />,
      onClick: viewOfferLetter,
      visible: (r) => !!r.offerLetterUrl,
    },
    {
      label: 'Archive',
      icon: <Archive className="h-4 w-4 mr-2" />,
      onClick: archiveContact,
      visible: (r) => (isClientContact(r) && r.status === 'active') || (!isClientContact(r) && r.status === 'resigned'),
    },
    {
      label: 'Resign',
      icon: <UserMinus className="h-4 w-4 mr-2" />,
      onClick: openResignDialog,
      visible: (r) => !isClientContact(r) && r.status === 'active',
    },
  ]

  const stats = useMemo(() => {
    const map = new Map<string, Set<Permission>>()
    for (const c of contacts) {
      if (c.status !== 'active') continue
      const k = normalizeContactEmail(c.email)
      if (!k) continue
      if (!map.has(k)) map.set(k, new Set())
      for (const p of c.permissions) map.get(k)!.add(p)
    }
    let staffDir = 0
    let clients = 0
    for (const perms of map.values()) {
      if (hasEmployeeRolePermission(perms)) staffDir += 1
      if (perms.has('clients')) clients += 1
    }
    return { staffDir, clients }
  }, [contacts])

  return (
    <div className="space-y-6 px-3 pb-20 pt-0 sm:px-4 md:px-0 lg:pb-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground">Contact Management</h2>
          <p className="text-muted-foreground">Profile, permission, employment and remark history.</p>
        </div>
        <div className="flex w-full min-w-0 flex-nowrap items-center justify-end gap-1.5 overflow-x-auto pb-0.5 sm:gap-2 md:w-auto md:overflow-visible md:pb-0">
          <Button
            variant="outline"
            className="h-9 shrink-0 gap-1.5 px-2.5 text-xs sm:h-10 sm:gap-2 sm:px-4 sm:text-sm"
            type="button"
            disabled={!accountingConnected}
            title={
              accountingConnected
                ? 'Sync contacts with Bukku or Xero'
                : 'Connect Bukku or Xero under Operator → Accounting (or API integration) to enable sync'
            }
            onClick={() => setShowSyncDialog(true)}
          >
            <RefreshCcw className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Sync Contact</span>
          </Button>
          <Button
            variant="outline"
            className="h-9 shrink-0 gap-1.5 px-2.5 text-xs sm:h-10 sm:gap-2 sm:px-4 sm:text-sm"
            type="button"
            onClick={() => setContactSettingsOpen(true)}
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Settings</span>
          </Button>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="h-9 shrink-0 gap-1.5 px-2.5 text-xs sm:h-10 sm:gap-2 sm:px-4 sm:text-sm">
              <Plus className="h-4 w-4 shrink-0 sm:mr-0" />
              <span className="whitespace-nowrap">Add Contact</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Contact</DialogTitle>
              <DialogDescription>
                {addContactKind === 'client'
                  ? 'B2B client: name, email and phone only.'
                  : 'Employee: select one or more roles, training records, employment and salary.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Contact type</Label>
                <Select
                  value={addContactKind}
                  onValueChange={(v) => {
                    const kind = v as 'client' | 'employee'
                    setAddContactKind(kind)
                    if (kind === 'client') {
                      setNewContact((p) => ({ ...p, permissions: ['clients'] }))
                    } else {
                      setNewContact((p) => ({ ...p, permissions: ['staff'] }))
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee (Staff / Driver / Dobi / Supervisor)</SelectItem>
                    <SelectItem value="client">Client (B2B)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={newContact.name}
                    onChange={(e) => setNewContact((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    value={newContact.email}
                    onChange={(e) => setNewContact((p) => ({ ...p, email: e.target.value }))}
                    type="email"
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Phone</Label>
                  <Input
                    value={newContact.phone}
                    onChange={(e) => setNewContact((p) => ({ ...p, phone: e.target.value }))}
                  />
                </div>
              </div>

              {addContactKind === 'employee' ? (
                <>
                  <div className="space-y-3">
                    <Label>Roles (select all that apply)</Label>
                    <p className="text-xs text-muted-foreground">
                      One contact can have multiple roles (e.g. Staff + Driver).
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border p-3">
                      {employeeRoleOptions.map((opt) => {
                        const checked = newContact.permissions.includes(opt.value)
                        return (
                          <label
                            key={opt.value}
                            className="flex items-center gap-2 text-sm cursor-pointer capitalize font-medium"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                setNewContact((p) => ({
                                  ...p,
                                  permissions: toggleEmployeeRole(
                                    p.permissions,
                                    opt.value,
                                    Boolean(v)
                                  ),
                                }))
                              }
                            />
                            {opt.label}
                          </label>
                        )
                      })}
                    </div>
                    {newContact.permissions.includes('supervisor') ? (
                      <p className="text-xs text-muted-foreground">
                        Supervisor: email is required; this email cannot already be registered as a supervisor for
                        another operator.
                      </p>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Joined date</Label>
                      <Input
                        type="date"
                        value={newContact.joinedAt}
                        onChange={(e) => setNewContact((p) => ({ ...p, joinedAt: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Salary setting (Basic only)</Label>
                      <Input
                        type="number"
                        value={newContact.salaryBasic}
                        onChange={(e) =>
                          setNewContact((p) => ({ ...p, salaryBasic: Number(e.target.value || 0) }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Employment Status</Label>
                      <Select
                        value={newContact.employmentStatus}
                        onValueChange={(value) =>
                          setNewContact((p) => ({ ...p, employmentStatus: value as EmploymentStatus }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full-time">Full-time</SelectItem>
                          <SelectItem value="part-time">Part-time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Working with us (times) — part-time</Label>
                      <Input
                        type="number"
                        value={newContact.workingWithUsCount}
                        onChange={(e) =>
                          setNewContact((p) => ({
                            ...p,
                            workingWithUsCount: Number(e.target.value || 0),
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                    <Label className="text-xs font-semibold">Payroll — statutory defaults (Malaysia)</Label>
                    <p className="text-xs text-muted-foreground">
                      Default flags for EPF, SOCSO, EIS and MTD (can be changed later in Edit).
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          ['epfApplies', 'EPF'] as const,
                          ['socsoApplies', 'SOCSO'] as const,
                          ['eisApplies', 'EIS'] as const,
                          ['mtdApplies', 'MTD'] as const,
                        ]
                      ).map(([key, label]) => {
                        const sd = normalizeSalaryStatutory(newContact.salaryStatutoryDefaults)
                        const checked = sd[key]
                        return (
                          <label
                            key={key}
                            className="flex cursor-pointer items-center gap-2 text-sm font-medium"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                setNewContact((p) => ({
                                  ...p,
                                  salaryStatutoryDefaults: {
                                    ...normalizeSalaryStatutory(p.salaryStatutoryDefaults),
                                    [key]: Boolean(v),
                                  },
                                }))
                              }
                            />
                            {label}
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Training records</Label>
                    {trainingCheckboxOptions.length === 0 ? (
                      <p className="text-sm text-muted-foreground rounded-md border border-dashed px-3 py-3">
                        Add training names in Contact → Settings (per operator).
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border p-3">
                        {trainingCheckboxOptions.map((opt) => {
                          const checked = newContact.trainings.includes(opt)
                          return (
                            <label
                              key={opt}
                              className="flex items-center gap-2 text-sm cursor-pointer"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => {
                                  setNewContact((p) => ({
                                    ...p,
                                    trainings: toggleTrainingSelection(p.trainings, opt, Boolean(v)),
                                  }))
                                }}
                              />
                              <span>{opt}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Remark (new entry)</Label>
                    <Textarea
                      value={createRemark}
                      onChange={(e) => setCreateRemark(e.target.value)}
                      placeholder="Add internal remark. It will be saved to history."
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label>Remark (optional)</Label>
                  <Textarea
                    value={createRemark}
                    onChange={(e) => setCreateRemark(e.target.value)}
                    placeholder="Optional internal note — saved to remark history."
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void addContact()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-xl">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.staffDir}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="md:hidden">Staff</span>
                  <span className="hidden md:inline">Staff (incl. driver, dobi, supervisor)</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <Building2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.clients}</p>
                <p className="text-sm text-muted-foreground">Clients</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="flex min-h-0 flex-col gap-3 border py-4 shadow-sm">
        <CardHeader className="flex flex-col gap-3 px-4 pb-0 pt-0 sm:px-6">
          <div className="min-w-0 space-y-1">
            <CardTitle>Directory</CardTitle>
            <CardDescription className="hidden md:block">Filter & search enabled.</CardDescription>
          </div>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)} className="w-full">
            <TabsList className="grid h-auto w-full max-w-md grid-cols-2">
              <TabsTrigger value="staff">Staff</TabsTrigger>
              <TabsTrigger value="clients">Client</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-0 px-4 pb-2 pt-0 sm:px-6">
          {contactsLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading contacts…</p>
          ) : (
            <>
              {/* Mobile: same pattern as client /properties — stacked rows, no horizontal table scroll */}
              <div className="flex flex-col gap-3 md:hidden">
                <p className="text-xs text-muted-foreground">
                  Tap a contact to edit. Use the menu for more actions.
                </p>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search…"
                    value={mobileContactSearch}
                    onChange={(e) => setMobileContactSearch(e.target.value)}
                    className="h-10 pl-9"
                    aria-label="Search contacts"
                  />
                </div>
                <div
                  className={
                    activeTab === 'staff'
                      ? 'grid grid-cols-2 gap-2'
                      : 'grid grid-cols-1 gap-2'
                  }
                >
                  {activeTab === 'staff' ? (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Employment</Label>
                      <Select
                        value={mobileContactEmployment}
                        onValueChange={setMobileContactEmployment}
                      >
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue placeholder="All employment" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All employment</SelectItem>
                          <SelectItem value="full-time">Full-time</SelectItem>
                          <SelectItem value="part-time">Part-time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={mobileContactStatus} onValueChange={setMobileContactStatus}>
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue placeholder="All status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All status</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                        <SelectItem value="resigned">Resigned</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="divide-y divide-border rounded-md border border-border bg-card">
                  {mobileFilteredContacts.length === 0 ? (
                    <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                      {activeTab === 'clients' ? 'No client contacts yet.' : 'No staff contacts yet.'}
                    </div>
                  ) : (
                    mobileFilteredContacts.map((row) => {
                      const visibleActions = actions.filter((a) => !a.visible || a.visible(row))
                      return (
                        <div key={row.id} className="flex items-center gap-2 px-3 py-4">
                          <button
                            type="button"
                            className="min-w-0 flex-1 space-y-1.5 text-left"
                            onClick={() => openEdit(row)}
                          >
                            <h2 className="text-lg font-bold leading-snug text-foreground">{row.name}</h2>
                            <p className="break-all text-sm text-muted-foreground">{row.email}</p>
                            <p className="text-sm text-foreground">{row.phone || '—'}</p>
                            {activeTab === 'staff' ? (
                              <>
                                <p className="text-sm text-muted-foreground">
                                  Team: {row.team ? String(row.team) : '—'}
                                </p>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="secondary"
                                    className={cn('capitalize', statusClass(row.status))}
                                  >
                                    {row.status}
                                  </Badge>
                                  <Badge variant="outline" className="capitalize">
                                    {row.employmentStatus}
                                  </Badge>
                                </div>
                              </>
                            ) : (
                              <Badge
                                variant="secondary"
                                className={cn('capitalize', statusClass(row.status))}
                              >
                                {row.status}
                              </Badge>
                            )}
                          </button>
                          {visibleActions.length > 0 ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 shrink-0 self-center"
                                  aria-label="Contact actions"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                {visibleActions.map((action, idx) => (
                                  <DropdownMenuItem
                                    key={idx}
                                    onClick={() => action.onClick(row)}
                                    className={
                                      action.variant === 'destructive' ? 'text-destructive' : ''
                                    }
                                  >
                                    {action.icon}
                                    {action.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              <div className="hidden min-h-0 flex-1 flex-col md:flex">
                <DataTable
                  data={currentData}
                  columns={columns}
                  actions={actions}
                  searchKeys={
                    activeTab === 'clients'
                      ? ['name', 'email', 'phone']
                      : ['name', 'email', 'phone', 'team']
                  }
                  pageSize={10}
                  emptyMessage={
                    activeTab === 'clients' ? 'No client contacts yet.' : 'No staff contacts yet.'
                  }
                  noHorizontalScroll
                  nowrapFilters={activeTab === 'staff'}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
            <DialogDescription>
              {editingContact && isClientContact(editingContact)
                ? 'B2B client: name, email and phone only.'
                : 'Update profile, permission, salary setting, employment status and remark.'}
            </DialogDescription>
          </DialogHeader>
          {editingContact && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={editingContact.name}
                    onChange={(e) => setEditingContact({ ...editingContact, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    value={editingContact.email}
                    onChange={(e) => setEditingContact({ ...editingContact, email: e.target.value })}
                    type="email"
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Phone</Label>
                  <Input
                    value={editingContact.phone}
                    onChange={(e) => setEditingContact({ ...editingContact, phone: e.target.value })}
                  />
                </div>
                {!isClientContact(editingContact) ? (
                  <>
                    <div className="space-y-2">
                      <Label>Salary setting (Basic only)</Label>
                      <Input
                        type="number"
                        value={editingContact.salaryBasic}
                        onChange={(e) =>
                          setEditingContact({
                            ...editingContact,
                            salaryBasic: Number(e.target.value || 0),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Employment Status</Label>
                      <Select
                        value={editingContact.employmentStatus}
                        onValueChange={(value) =>
                          setEditingContact({
                            ...editingContact,
                            employmentStatus: value as EmploymentStatus,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full-time">Full-time</SelectItem>
                          <SelectItem value="part-time">Part-time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Working with us (times) - for part-time</Label>
                      <Input
                        type="number"
                        value={editingContact.workingWithUsCount ?? 0}
                        onChange={(e) =>
                          setEditingContact({
                            ...editingContact,
                            workingWithUsCount: Number(e.target.value || 0),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Joined date</Label>
                      <Input
                        type="date"
                        value={joinedAtToInputValue(editingContact.joinedAt)}
                        onChange={(e) =>
                          setEditingContact({ ...editingContact, joinedAt: e.target.value })
                        }
                      />
                    </div>
                  </>
                ) : null}
              </div>
              {!isClientContact(editingContact) ? (
                <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                  <Label className="text-xs font-semibold">Payroll — statutory defaults (Malaysia)</Label>
                  <p className="text-xs text-muted-foreground">
                    Tick whether EPF, SOCSO, EIS and MTD apply by default for this employee (used as defaults for
                    salary / payroll).
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(
                      [
                        ['epfApplies', 'EPF'] as const,
                        ['socsoApplies', 'SOCSO'] as const,
                        ['eisApplies', 'EIS'] as const,
                        ['mtdApplies', 'MTD'] as const,
                      ]
                    ).map(([key, label]) => {
                      const sd = normalizeSalaryStatutory(editingContact.salaryStatutoryDefaults)
                      const checked = sd[key]
                      return (
                        <label
                          key={key}
                          className="flex cursor-pointer items-center gap-2 text-sm font-medium"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setEditingContact({
                                ...editingContact,
                                salaryStatutoryDefaults: {
                                  ...sd,
                                  [key]: Boolean(v),
                                },
                              })
                            }
                          />
                          {label}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Roles</Label>
                {isClientContact(editingContact) ? (
                  <p className="text-sm rounded-md border px-3 py-2 bg-muted/40">Client (B2B)</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-2 gap-3 rounded-md border p-3">
                    {employeeRoleOptions.map((opt) => {
                      const checked = editingContact.permissions.includes(opt.value)
                      return (
                        <label
                          key={opt.value}
                          className="flex items-center gap-2 text-sm capitalize font-medium"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setEditingContact({
                                ...editingContact,
                                permissions: toggleEmployeeRole(
                                  editingContact.permissions,
                                  opt.value,
                                  Boolean(v)
                                ),
                              })
                            }
                          />
                          {opt.label}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
                <Label className="text-xs font-semibold">Account ID</Label>
                <Input
                  value={editAccountingId}
                  onChange={(e) => setEditAccountingId(e.target.value)}
                  className="mt-1"
                  placeholder="Account ID"
                />
                {!accountingConnected ? (
                  <p className="text-xs text-muted-foreground">
                    Connect Bukku or Xero under Operator → Accounting / API integration to use Sync Contact; you can
                    still save an ID here.
                  </p>
                ) : null}
              </div>
              {!isClientContact(editingContact) ? (
                <div className="space-y-2">
                  <Label>Training records</Label>
                  {trainingCheckboxOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground rounded-md border border-dashed px-3 py-3">
                      Add training names in Contact → Settings (per operator).
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border p-3">
                      {trainingCheckboxOptions.map((opt) => {
                        const checked = editingContact.trainings.includes(opt)
                        return (
                          <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                setEditingContact({
                                  ...editingContact,
                                  trainings: toggleTrainingSelection(
                                    editingContact.trainings,
                                    opt,
                                    Boolean(v)
                                  ),
                                })
                              }
                            />
                            <span>{opt}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                  {editingContact.trainings.some((t) => !trainingCheckboxOptions.includes(t)) ? (
                    <p className="text-xs text-muted-foreground">
                      Other recorded trainings:{' '}
                      {editingContact.trainings
                        .filter((t) => !trainingCheckboxOptions.includes(t))
                        .join(', ')}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Remark (new entry)</Label>
                <Textarea
                  value={editingRemark}
                  onChange={(e) => setEditingRemark(e.target.value)}
                  placeholder="Add internal remark. It will be saved to history."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Profile Detail</DialogTitle>
            <DialogDescription>
              {detailContact && isClientContact(detailContact)
                ? 'Personal profile, bank detail, IC/passport copy, and remark history.'
                : 'Personal profile, bank detail, IC/passport copy, offer letter, training and remark history.'}
            </DialogDescription>
          </DialogHeader>
          {detailContact && (
            <div className="space-y-5 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground">Name</p>
                  <p className="font-medium">{detailContact.name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Email</p>
                  <p className="font-medium">{detailContact.email}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Phone</p>
                  <p className="font-medium">{detailContact.phone}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Permission</p>
                  <p className="font-medium capitalize">{prettyPermissions(detailContact.permissions)}</p>
                </div>
                {!isClientContact(detailContact) ? (
                  <>
                    <div>
                      <p className="text-muted-foreground">Employment</p>
                      <p className="font-medium capitalize">{detailContact.employmentStatus}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Salary (Basic)</p>
                      <p className="font-medium">RM {detailContact.salaryBasic.toLocaleString('en-MY')}</p>
                    </div>
                  </>
                ) : null}
                <div>
                  <p className="text-muted-foreground">Bank</p>
                  <p className="font-medium">{detailContact.bankName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Bank Account</p>
                  <p className="font-medium">{detailContact.bankAccountNo}</p>
                </div>
              </div>
              {!isClientContact(detailContact) && detailContact.employmentStatus === 'part-time' ? (
                <div className="rounded-md border p-3">
                  <p className="font-medium mb-2">Part-time records</p>
                  <p>Working with us: {detailContact.workingWithUsCount ?? 0} times</p>
                </div>
              ) : null}
              {isPreviewableAssetUrl(detailContact.icCopyUrl) ||
              isPreviewableAssetUrl(detailContact.passportCopyUrl) ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {isPreviewableAssetUrl(detailContact.icCopyUrl) ? (
                    <ContactIdentityDocPreview url={detailContact.icCopyUrl} label="IC copy" />
                  ) : null}
                  {isPreviewableAssetUrl(detailContact.passportCopyUrl) ? (
                    <ContactIdentityDocPreview
                      url={detailContact.passportCopyUrl}
                      label="Passport copy"
                    />
                  ) : null}
                </div>
              ) : null}
              {!isClientContact(detailContact) ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {detailContact.offerLetterUrl ? (
                    <a
                      className="underline text-primary"
                      href={detailContact.offerLetterUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View offer letter
                    </a>
                  ) : (
                    <p className="text-muted-foreground">No offer letter uploaded.</p>
                  )}
                </div>
              ) : null}
              {!isClientContact(detailContact) ? (
                <div>
                  <p className="font-medium mb-2">Training history</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {detailContact.trainings.length > 0 ? (
                      detailContact.trainings.map((t, i) => <li key={`${t}-${i}`}>{t}</li>)
                    ) : (
                      <li>No training record yet.</li>
                    )}
                  </ul>
                </div>
              ) : null}
              <div>
                <p className="font-medium mb-2">Remark history</p>
                <div className="rounded-md border p-3 space-y-2">
                  {detailContact.remarkHistory.length > 0 ? (
                    detailContact.remarkHistory.map((r, i) => <p key={`${r}-${i}`}>- {r}</p>)
                  ) : (
                    <p className="text-muted-foreground">No remark history.</p>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIsDetailDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contactSettingsOpen} onOpenChange={setContactSettingsOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Contact settings</DialogTitle>
            <DialogDescription className="sr-only">Training list and access by role</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <Label>Training record names</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  id="cln-training-record-add"
                  value={newTrainingNameInput}
                  onChange={(e) => setNewTrainingNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addDraftTrainingName()
                    }
                  }}
                  placeholder="Type a name"
                  className="sm:flex-1"
                />
                <Button type="button" variant="secondary" className="shrink-0" onClick={addDraftTrainingName}>
                  Add
                </Button>
              </div>
              {contactSettingsDraft.trainingRecordNames.length > 0 ? (
                <ul className="rounded-md border divide-y max-h-40 overflow-y-auto">
                  {contactSettingsDraft.trainingRecordNames.map((name) => (
                    <li
                      key={name}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span className="break-words">{name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-8 w-8"
                        onClick={() => removeDraftTrainingName(name)}
                        aria-label={`Remove ${name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">Access by role</p>
              <div className="space-y-4 max-h-[min(55vh,480px)] overflow-y-auto pr-1">
                {CONTACT_SETTINGS_ROLE_ROWS.map((roleRow) => (
                  <div key={roleRow.key} className="rounded-lg border bg-muted/20 p-3 space-y-3">
                    <p className="text-sm font-semibold">{roleRow.label}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {[OPERATOR_PORTAL_PAGES_LEFT, OPERATOR_PORTAL_PAGES_RIGHT].map((chunk, chunkIdx) => (
                        <div
                          key={`${roleRow.key}-col-${chunkIdx}`}
                          className="rounded-lg border bg-background divide-y min-w-0"
                        >
                          {chunk.map((page) => {
                            const current =
                              contactSettingsDraft.rolePageAccess[roleRow.key]?.[page.href] ?? 'full'
                            return (
                              <div
                                key={`${roleRow.key}-${page.href}`}
                                className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                              >
                                <span className="text-sm text-foreground shrink min-w-0">{page.label}</span>
                                <Select
                                  value={current}
                                  onValueChange={(v) =>
                                    setContactSettingsDraft((d) => ({
                                      ...d,
                                      rolePageAccess: {
                                        ...d.rolePageAccess,
                                        [roleRow.key]: {
                                          ...(d.rolePageAccess[roleRow.key] || {}),
                                          [page.href]: v as PageAccessLevel,
                                        },
                                      },
                                    }))
                                  }
                                >
                                  <SelectTrigger className="w-full sm:w-[200px] shrink-0">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PAGE_ACCESS_OPTIONS.map((opt) => (
                                      <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setContactSettingsOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveContactPortalSettings()} disabled={contactSettingsSaving}>
              {contactSettingsSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSyncDialog} onOpenChange={setShowSyncDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sync Contact</DialogTitle>
            <DialogDescription>
              Sync with your connected accounting (Bukku / Xero). Staff directory maps to accounting employees; Client directory to customers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
              <input
                type="radio"
                name="clnSyncDirection"
                checked={syncDirection === 'to-accounting'}
                onChange={() => setSyncDirection('to-accounting')}
                className="mt-1"
              />
              <div>
                <p className="font-medium">Export to accounting</p>
                <p className="text-sm text-muted-foreground">
                  Push Cleanlemons contacts to accounting (create or update by email/name).
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
              <input
                type="radio"
                name="clnSyncDirection"
                checked={syncDirection === 'from-accounting'}
                onChange={() => setSyncDirection('from-accounting')}
                className="mt-1"
              />
              <div>
                <p className="font-medium">Import from accounting</p>
                <p className="text-sm text-muted-foreground">
                  Pull accounting contacts into Cleanlemons; match by email/name or create rows.
                </p>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSyncDialog(false)}>Cancel</Button>
            <Button onClick={() => void handleConfirmSyncAll()} disabled={syncingContacts}>
              {syncingContacts ? 'Syncing…' : 'Start sync'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isResignDialogOpen} onOpenChange={setIsResignDialogOpen}><DialogContent><DialogHeader><DialogTitle>Resign Confirmation</DialogTitle><DialogDescription>{resignContact ? `Set resign date and remark for ${resignContact.name}.` : 'Set resign details.'}</DialogDescription></DialogHeader><div className="space-y-4 py-2"><div className="space-y-2"><Label>Resign Date</Label><Input type="date" value={resignDate} onChange={(e) => setResignDate(e.target.value)} /></div><div className="space-y-2"><Label>Remark</Label><Textarea value={resignRemark} onChange={(e) => setResignRemark(e.target.value)} placeholder="Reason or notes" /></div></div><DialogFooter><Button variant="outline" onClick={() => setIsResignDialogOpen(false)}>Cancel</Button><Button onClick={submitResign}>Confirm Resign</Button></DialogFooter></DialogContent></Dialog>

      <GiveReviewDialog
        open={staffReviewOpen}
        onOpenChange={(o) => {
          setStaffReviewOpen(o)
          if (!o) setStaffReviewContact(null)
        }}
        reviewKind="operator_to_staff"
        operatorId={operatorId}
        employeeContactId={String(staffReviewContact?.employeeDetailId || staffReviewContact?.id || '').trim() || undefined}
        title={staffReviewContact ? `Rate ${staffReviewContact.name}` : 'Give review'}
      />
    </div>
  )
}
