"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Pencil, Trash2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-context'
import {
  fetchOperatorProperties,
  fetchOperatorContacts,
  fetchOperatorTeams,
  createOperatorTeam,
  updateOperatorTeam,
  deleteOperatorTeam,
} from '@/lib/cleanlemon-api'

type Permission = 'staff' | 'driver' | 'dobi' | 'clients' | 'supervisor'
type EmploymentStatus = 'full-time' | 'part-time'
type TeamAuthorizeMode = 'full' | 'selected'

type PropertyRecord = {
  id: string
  /** Whole estate / district (`cln_property.property_name`); authorisation groups by this, not by unit. */
  propertyName: string
  /** Unit label (`cln_property.unit_name`); second layer in the picker. */
  unitLabel: string
  status: 'active' | 'inactive'
}

type ContactRecord = {
  id: string
  /** `cln_employeedetail.id` — team `member_ids_json` uses this from CSV import; `id` is `cln_employee_operator.id`. */
  employeeDetailId?: string
  name: string
  permissions: Permission[]
  status: 'active' | 'archived' | 'resigned'
  employmentStatus: EmploymentStatus
}

type TeamRecord = {
  id: string
  name: string
  memberIds: string[]
  createdAt: string
  authorizeMode: TeamAuthorizeMode
  selectedPropertyIds: string[]
  restDays: string[]
}

function prettyPermissions(permissions: Permission[]): string {
  return permissions.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
}

const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function normalizePropertyGroupKey(name: string) {
  return name.trim().toLowerCase()
}

function districtGroupKey(p: PropertyRecord): string {
  const n = p.propertyName.trim()
  if (n) return normalizePropertyGroupKey(n)
  return `__row:${p.id}`
}

/** Match contact by junction id or employee (`cln_employeedetail`) id — team members may store either. */
function resolveContact(contacts: ContactRecord[], rawId: string): ContactRecord | undefined {
  const r = String(rawId || '').trim().toLowerCase()
  if (!r) return undefined
  return contacts.find(
    (c) =>
      String(c.id).toLowerCase() === r ||
      (c.employeeDetailId != null && String(c.employeeDetailId).toLowerCase() === r)
  )
}

/** Prefer junction id for pickers when `member_ids_json` has employee id (e.g. CSV import). */
function toJunctionMemberId(contacts: ContactRecord[], rawId: string): string {
  const c = resolveContact(contacts, rawId)
  return c?.id ?? rawId
}

/** Same person may appear as junction id or employee id in `member_ids_json`. */
function canonicalMemberKey(contacts: ContactRecord[], rawId: string): string {
  const c = resolveContact(contacts, rawId)
  if (c?.employeeDetailId) return String(c.employeeDetailId).trim().toLowerCase()
  if (c) return String(c.id).trim().toLowerCase()
  return String(rawId || '').trim().toLowerCase()
}

/** Created date in MY (DD/MM/YYYY) — uses fixed timeZone so SSR and browser match. */
function formatCreatedDateMalaysia(iso: string | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  const { day, month, year } = map
  if (!day || !month || !year) return '—'
  return `${day}/${month}/${year}`
}

const teamBadgeColorClasses = [
  'bg-sky-100 text-sky-800 border border-sky-200',
  'bg-emerald-100 text-emerald-800 border border-emerald-200',
  'bg-violet-100 text-violet-800 border border-violet-200',
  'bg-amber-100 text-amber-800 border border-amber-200',
  'bg-rose-100 text-rose-800 border border-rose-200',
  'bg-cyan-100 text-cyan-800 border border-cyan-200',
]

export default function TeamPage() {
  const { user } = useAuth()
  const operatorId = user?.operatorId || 'op_demo_001'
  const [properties, setProperties] = useState<PropertyRecord[]>([])
  const [contacts, setContacts] = useState<ContactRecord[]>([])
  const [teams, setTeams] = useState<TeamRecord[]>([])
  const [pageLoading, setPageLoading] = useState(true)
  /** Avoid hydration mismatch: calendar uses `new Date()` (server clock ≠ client). */
  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    setHasMounted(true)
  }, [])

  const refreshAll = useCallback(async () => {
    setPageLoading(true)
    try {
      const [pr, cr, tr] = await Promise.all([
        fetchOperatorProperties(operatorId),
        fetchOperatorContacts(operatorId),
        fetchOperatorTeams(operatorId),
      ])
      if (pr.ok && Array.isArray(pr.items)) {
        setProperties(
          pr.items.map((p: { id: string; name?: string; unitNumber?: string }) => ({
            id: p.id,
            propertyName: String(p.name ?? '').trim(),
            unitLabel: String(p.unitNumber ?? '').trim(),
            status: 'active' as const,
          }))
        )
      } else {
        setProperties([])
      }
      if (cr.ok && Array.isArray(cr.items)) {
        setContacts(
          cr.items.map(
            (c: {
              id: string
              employeeDetailId?: string
              name: string
              permissions: Permission[]
              status: ContactRecord['status']
              employmentStatus: EmploymentStatus
            }) => ({
              id: c.id,
              employeeDetailId:
                c.employeeDetailId != null && String(c.employeeDetailId).trim() !== ''
                  ? String(c.employeeDetailId).trim()
                  : undefined,
              name: c.name,
              permissions: c.permissions,
              status: c.status,
              employmentStatus: c.employmentStatus,
            })
          )
        )
      } else {
        setContacts([])
      }
      if (tr.ok && Array.isArray(tr.items)) {
        setTeams(tr.items as TeamRecord[])
      } else {
        setTeams([])
      }
      const failed = [pr, cr, tr].filter((r) => !r.ok)
      if (failed.length) {
        toast.error('Could not load all operator data (properties / contacts / teams). Check API and MySQL.')
      }
    } finally {
      setPageLoading(false)
    }
  }, [operatorId])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isMemberPickerOpen, setIsMemberPickerOpen] = useState(false)

  const [teamName, setTeamName] = useState('')
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<string[]>([])
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)

  const [authorizeMode, setAuthorizeMode] = useState<TeamAuthorizeMode>('full')
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([])
  const [selectedRestDays, setSelectedRestDays] = useState<string[]>([])

  const [memberSearch, setMemberSearch] = useState('')
  const [propertySearch, setPropertySearch] = useState('')
  /** Picker: which district row is being configured (propertyDistrictGroups[].key). */
  const [authDistrictKey, setAuthDistrictKey] = useState('')
  const [authUnitScope, setAuthUnitScope] = useState<'all' | 'individual'>('all')
  const [authDraftUnitIds, setAuthDraftUnitIds] = useState<string[]>([])
  const [employmentFilter, setEmploymentFilter] = useState<'all' | EmploymentStatus>('all')
  const [memberDraftSelected, setMemberDraftSelected] = useState<string[]>([])
  const [viewTab, setViewTab] = useState<'list' | 'calendar'>('list')

  const memberOptions = useMemo(
    () => contacts.filter((c) => c.status === 'active' && c.permissions.includes('staff')),
    [contacts]
  )

  const activeProperties = useMemo(
    () => properties.filter((p) => p.status === 'active'),
    [properties]
  )

  /** Layer 1: district (`property_name`). Layer 2: rows = units (`unit_name` + id). */
  const propertyDistrictGroups = useMemo(() => {
    const map = new Map<
      string,
      { districtLabel: string; units: { id: string; unitLabel: string }[] }
    >()
    for (const p of activeProperties) {
      const key = districtGroupKey(p)
      const unitLabel = p.unitLabel.trim() || '(No unit)'
      const cur = map.get(key)
      if (cur) {
        cur.units.push({ id: p.id, unitLabel })
        if (p.propertyName.trim()) cur.districtLabel = p.propertyName.trim()
      } else {
        map.set(key, {
          districtLabel: p.propertyName.trim() || p.unitLabel.trim() || p.id,
          units: [{ id: p.id, unitLabel }],
        })
      }
    }
    for (const g of map.values()) {
      g.units.sort((a, b) =>
        a.unitLabel.localeCompare(b.unitLabel, undefined, { sensitivity: 'base' })
      )
    }
    return Array.from(map.entries()).map(([key, g]) => ({
      key,
      districtLabel: g.districtLabel,
      units: g.units,
      ids: g.units.map((u) => u.id),
    }))
  }, [activeProperties])

  /** Districts for step-1 dropdown: filter by search, always A–Z; keep current pick visible even if filtered out. */
  const districtsForPicker = useMemo(() => {
    const q = propertySearch.trim().toLowerCase()
    let list = propertyDistrictGroups
    if (q) {
      list = list.filter(
        (g) =>
          g.districtLabel.toLowerCase().includes(q) ||
          g.units.some((u) => u.unitLabel.toLowerCase().includes(q))
      )
    }
    let out = [...list].sort((a, b) =>
      a.districtLabel.localeCompare(b.districtLabel, undefined, { sensitivity: 'base' })
    )
    if (authDistrictKey) {
      const sel = propertyDistrictGroups.find((g) => g.key === authDistrictKey)
      if (sel && !out.some((g) => g.key === authDistrictKey)) {
        out = [...out, sel].sort((a, b) =>
          a.districtLabel.localeCompare(b.districtLabel, undefined, { sensitivity: 'base' })
        )
      }
    }
    return out
  }, [propertyDistrictGroups, propertySearch, authDistrictKey])

  const selectedAuthGroup = useMemo(
    () => propertyDistrictGroups.find((g) => g.key === authDistrictKey) ?? null,
    [propertyDistrictGroups, authDistrictKey]
  )

  /** Districts that currently contribute at least one id to authorisation. */
  const authSummaryByDistrict = useMemo(() => {
    const idSet = new Set(selectedPropertyIds)
    return propertyDistrictGroups
      .map((g) => {
        const picked = g.ids.filter((id) => idSet.has(id))
        if (picked.length === 0) return null
        const all = picked.length === g.ids.length
        return {
          key: g.key,
          label: g.districtLabel,
          all,
          count: picked.length,
          total: g.ids.length,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
  }, [propertyDistrictGroups, selectedPropertyIds])

  useEffect(() => {
    if (!authDistrictKey) return
    const g = propertyDistrictGroups.find((x) => x.key === authDistrictKey)
    if (!g) return
    const sel = g.ids.filter((id) => selectedPropertyIds.includes(id))
    if (sel.length === g.ids.length && g.ids.length > 0) {
      setAuthUnitScope('all')
      setAuthDraftUnitIds([...g.ids])
    } else if (sel.length > 0) {
      setAuthUnitScope('individual')
      setAuthDraftUnitIds(sel)
    } else {
      setAuthUnitScope('all')
      setAuthDraftUnitIds([])
    }
  }, [authDistrictKey, propertyDistrictGroups, selectedPropertyIds])

  const filteredMemberOptions = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    return memberOptions.filter((m) => {
      const bySearch = !q || m.name.toLowerCase().includes(q)
      const byEmployment = employmentFilter === 'all' || m.employmentStatus === employmentFilter
      return bySearch && byEmployment
    })
  }, [memberOptions, memberSearch, employmentFilter])

  const propertyLabelById = (id: string) => {
    const p = properties.find((x) => x.id === id)
    if (!p) return id
    if (p.propertyName && p.unitLabel) return `${p.propertyName} · ${p.unitLabel}`
    return p.propertyName || p.unitLabel || id
  }

  const toggleAuthDraftUnit = (unitId: string, checked: boolean) => {
    setAuthDraftUnitIds((prev) => {
      if (checked) return prev.includes(unitId) ? prev : [...prev, unitId]
      return prev.filter((id) => id !== unitId)
    })
  }

  const applyDistrictAuthorisation = () => {
    const g = propertyDistrictGroups.find((x) => x.key === authDistrictKey)
    if (!g) {
      toast.error('Choose a property first')
      return
    }
    let nextIds: string[]
    if (authUnitScope === 'all') {
      nextIds = [...g.ids]
    } else {
      if (authDraftUnitIds.length === 0) {
        toast.error('Pick at least one unit, or choose Select all units')
        return
      }
      nextIds = [...authDraftUnitIds]
    }
    setSelectedPropertyIds((prev) => {
      const rest = prev.filter((id) => !g.ids.includes(id))
      return [...new Set([...rest, ...nextIds])]
    })
    toast.success(`Authorisation updated for ${g.districtLabel}`)
  }

  const removeDistrictFromAuth = (districtKey: string) => {
    const g = propertyDistrictGroups.find((x) => x.key === districtKey)
    if (!g) return
    setSelectedPropertyIds((prev) => prev.filter((id) => !g.ids.includes(id)))
    if (authDistrictKey === districtKey) {
      setAuthDistrictKey('')
      setAuthUnitScope('all')
      setAuthDraftUnitIds([])
    }
  }

  const onAuthUnitScopeChange = (scope: 'all' | 'individual') => {
    setAuthUnitScope(scope)
    const g = propertyDistrictGroups.find((x) => x.key === authDistrictKey)
    if (!g) return
    if (scope === 'all') {
      setAuthDraftUnitIds([...g.ids])
    } else {
      const saved = g.ids.filter((id) => selectedPropertyIds.includes(id))
      setAuthDraftUnitIds(saved.length > 0 ? saved : [...g.ids])
    }
  }

  const calendarCells = useMemo(() => {
    if (!hasMounted) {
      return { cells: [] as Array<{ day: number; date: Date } | null>, monthLabel: '' }
    }
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const firstDay = new Date(year, month, 1)
    const startWeekday = firstDay.getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: Array<{ day: number; date: Date } | null> = []
    for (let i = 0; i < startWeekday; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, date: new Date(year, month, d) })
    while (cells.length % 7 !== 0) cells.push(null)
    return { cells, monthLabel: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }) }
  }, [hasMounted])

  const weekdayName = (date: Date) =>
    date.toLocaleString('en-US', { weekday: 'long' })

  const teamsRestingOn = (date: Date) => {
    const day = weekdayName(date)
    return teams.filter((t) => t.restDays.includes(day))
  }

  /** Same rest logic as calendar cells, keyed by full weekday name (matches `weekDays`). */
  const teamsRestingOnWeekday = (dayName: string) =>
    teams.filter((t) => t.restDays.includes(dayName))

  const teamBadgeClass = (teamId: string) => {
    const index = teams.findIndex((t) => t.id === teamId)
    if (index < 0) return teamBadgeColorClasses[0]
    return teamBadgeColorClasses[index % teamBadgeColorClasses.length]
  }

  const findOtherTeamByMemberId = (memberId: string): TeamRecord | null => {
    const key = canonicalMemberKey(contacts, memberId)
    if (!key) return null
    return (
      teams.find(
        (t) =>
          t.id !== editingTeamId &&
          t.memberIds.some((mid) => canonicalMemberKey(contacts, mid) === key)
      ) || null
    )
  }

  const resetTeamEditor = () => {
    setEditingTeamId(null)
    setTeamName('')
    setSelectedTeamMembers([])
    setMemberSearch('')
    setPropertySearch('')
    setAuthDistrictKey('')
    setAuthUnitScope('all')
    setAuthDraftUnitIds([])
    setEmploymentFilter('all')
    setMemberDraftSelected([])
    setAuthorizeMode('full')
    setSelectedPropertyIds([])
    setSelectedRestDays([])
  }

  const openCreateDialog = () => setIsCreateOpen(true)

  const openEditTeam = (team: TeamRecord) => {
    setEditingTeamId(team.id)
    setTeamName(team.name)
    setSelectedTeamMembers(team.memberIds.map((mid) => toJunctionMemberId(contacts, mid)))
    setAuthorizeMode(team.authorizeMode)
    setSelectedPropertyIds([...team.selectedPropertyIds])
    setSelectedRestDays([...team.restDays])
    setIsCreateOpen(true)
  }

  const openMemberPicker = () => {
    setMemberDraftSelected([...selectedTeamMembers])
    setMemberSearch('')
    setEmploymentFilter('all')
    setIsMemberPickerOpen(true)
  }

  const confirmMembers = () => {
    const conflict = memberDraftSelected.find((id) => findOtherTeamByMemberId(id))
    if (conflict) {
      const memberName = contacts.find((c) => c.id === conflict)?.name || conflict
      const teamName = findOtherTeamByMemberId(conflict)?.name || 'another team'
      toast.error(`${memberName} is already assigned to ${teamName}`)
      return
    }
    setSelectedTeamMembers([...memberDraftSelected])
    setIsMemberPickerOpen(false)
  }

  const toggleDraftMember = (id: string, checked: boolean) => {
    setMemberDraftSelected((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id]
      return prev.filter((x) => x !== id)
    })
  }

  const toggleRestDay = (day: string, checked: boolean) => {
    setSelectedRestDays((prev) => {
      if (checked) return prev.includes(day) ? prev : [...prev, day]
      return prev.filter((d) => d !== day)
    })
  }

  const submitTeam = async () => {
    if (!teamName.trim() || selectedTeamMembers.length === 0) {
      toast.error('Please set team name and at least one member')
      return
    }
    if (authorizeMode === 'selected' && selectedPropertyIds.length === 0) {
      toast.error('Please select at least one property for selected authorise')
      return
    }
    const conflict = selectedTeamMembers.find((id) => findOtherTeamByMemberId(id))
    if (conflict) {
      const memberName = contacts.find((c) => c.id === conflict)?.name || conflict
      const otherName = findOtherTeamByMemberId(conflict)?.name || 'another team'
      toast.error(`${memberName} is already assigned to ${otherName}`)
      return
    }

    if (editingTeamId) {
      const res = await updateOperatorTeam(editingTeamId, {
        operatorId,
        name: teamName.trim(),
        memberIds: [...selectedTeamMembers],
        authorizeMode,
        selectedPropertyIds: [...selectedPropertyIds],
        restDays: [...selectedRestDays],
      })
      if (!res.ok) {
        toast.error(typeof res.reason === 'string' ? res.reason : 'Update failed')
        return
      }
      toast.success('Team updated')
    } else {
      const res = await createOperatorTeam({
        operatorId,
        name: teamName.trim(),
        memberIds: [...selectedTeamMembers],
        createdAt: new Date().toISOString().slice(0, 10),
        authorizeMode,
        selectedPropertyIds: [...selectedPropertyIds],
        restDays: [...selectedRestDays],
      })
      if (!res.ok) {
        toast.error(typeof res.reason === 'string' ? res.reason : 'Create failed')
        return
      }
      toast.success('Team created')
    }

    setIsCreateOpen(false)
    resetTeamEditor()
    await refreshAll()
  }

  const teamAuthoriseLabel = (t: TeamRecord) =>
    t.authorizeMode === 'full'
      ? 'full authorise'
      : `selected: ${[...new Set(t.selectedPropertyIds.map(propertyLabelById))].join(', ') || '-'}`

  const membersLabel = (t: TeamRecord) =>
    t.memberIds.map((id) => resolveContact(contacts, id)?.name ?? id).join(', ') || '—'

  const deleteTeam = async (team: TeamRecord) => {
    const res = await deleteOperatorTeam(team.id, operatorId)
    if (!res.ok) {
      toast.error(typeof res.reason === 'string' ? res.reason : 'Delete failed')
      return
    }
    if (editingTeamId === team.id) {
      setIsCreateOpen(false)
      resetTeamEditor()
    }
    toast.success(`Team ${team.name} deleted`)
    await refreshAll()
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {pageLoading && (
        <p className="text-sm text-muted-foreground">Loading teams and directory…</p>
      )}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground">Team Management</h2>
          <p className="text-muted-foreground text-sm sm:text-base">Create, edit and delete team at operator level.</p>
        </div>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <Tabs
            value={viewTab}
            onValueChange={(v) => setViewTab(v as 'list' | 'calendar')}
            className="w-full min-w-0 sm:w-auto"
          >
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:inline-flex sm:w-auto">
              <TabsTrigger value="list" className="flex-1 sm:flex-initial">
                Team List
              </TabsTrigger>
              <TabsTrigger value="calendar" className="flex-1 sm:flex-initial">
                Calendar
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Dialog
            open={isCreateOpen}
            onOpenChange={(open) => {
              setIsCreateOpen(open)
              if (!open) resetTeamEditor()
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} className="w-full shrink-0 sm:w-auto" size="default">
                <Plus className="h-4 w-4 sm:mr-2" />
                Create Team
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTeamId ? 'Edit Team' : 'Create Team'}</DialogTitle>
              <DialogDescription>
                Set team name, authorise mode, then add members.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Team Name</Label>
                <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Example: Team Bravo" />
              </div>

              <div className="space-y-2">
                <Label>Authorisation</Label>
                <Select value={authorizeMode} onValueChange={(v) => setAuthorizeMode(v as TeamAuthorizeMode)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select authorisation mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">full authorise</SelectItem>
                    <SelectItem value="selected">selected authorise</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {authorizeMode === 'selected' && (
                <div className="space-y-3">
                  <Label>Selected authorise properties</Label>
                  <p className="text-xs text-muted-foreground">
                    Step 1: pick the estate / district (e.g. Space Residency). Step 2: choose{' '}
                    <span className="font-medium">Select all units</span> or{' '}
                    <span className="font-medium">Individual units</span>, then apply. Repeat for more
                    properties.
                  </p>

                  <div className="rounded-md border p-3 space-y-4 bg-muted/20">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">
                        1. Property (district)
                      </Label>
                      <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
                        <Input
                          className="pl-9"
                          value={propertySearch}
                          onChange={(e) => setPropertySearch(e.target.value)}
                          placeholder="Search to filter list…"
                        />
                      </div>
                      {districtsForPicker.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">
                          {propertyDistrictGroups.length === 0
                            ? 'No properties loaded.'
                            : 'No properties match your search.'}
                        </p>
                      ) : (
                        <Select
                          value={authDistrictKey || undefined}
                          onValueChange={(v) => setAuthDistrictKey(v)}
                        >
                          <SelectTrigger className="w-full bg-background">
                            <SelectValue placeholder="Choose property e.g. Space Residency" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[240px]">
                            {districtsForPicker.map((g) => (
                              <SelectItem key={g.key} value={g.key}>
                                <span className="font-medium">{g.districtLabel}</span>
                                <span className="text-muted-foreground text-xs ml-2">
                                  ({g.units.length} unit{g.units.length === 1 ? '' : 's'})
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    <div
                      className={`space-y-3 ${!authDistrictKey ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">
                        2. Units in this property
                      </Label>
                      <RadioGroup
                        value={authUnitScope}
                        onValueChange={(v) => onAuthUnitScopeChange(v as 'all' | 'individual')}
                        className="gap-3"
                      >
                        <div className="flex items-start gap-3 rounded-md border bg-background p-3">
                          <RadioGroupItem value="all" id="auth-scope-all" className="mt-0.5" />
                          <div className="grid gap-0.5">
                            <Label htmlFor="auth-scope-all" className="font-medium cursor-pointer">
                              Select all units
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              Authorise every unit under this property ({selectedAuthGroup?.ids.length ?? 0}{' '}
                              total).
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3 rounded-md border bg-background p-3">
                          <RadioGroupItem value="individual" id="auth-scope-ind" className="mt-0.5" />
                          <div className="grid gap-0.5 flex-1 min-w-0">
                            <Label htmlFor="auth-scope-ind" className="font-medium cursor-pointer">
                              Individual units
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              Tick only the units this team may access.
                            </p>
                          </div>
                        </div>
                      </RadioGroup>

                      {authUnitScope === 'individual' && selectedAuthGroup ? (
                        <div className="rounded-md border bg-background max-h-[200px] overflow-y-auto p-2 space-y-1">
                          {selectedAuthGroup.units.map((u) => (
                            <label
                              key={u.id}
                              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-2 py-1"
                            >
                              <Checkbox
                                checked={authDraftUnitIds.includes(u.id)}
                                onCheckedChange={(v) => toggleAuthDraftUnit(u.id, Boolean(v))}
                              />
                              <span className="min-w-0 break-words">{u.unitLabel}</span>
                            </label>
                          ))}
                        </div>
                      ) : null}

                      <Button
                        type="button"
                        className="w-full sm:w-auto"
                        onClick={applyDistrictAuthorisation}
                        disabled={!authDistrictKey}
                      >
                        Apply for this property
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">
                      Authorised for this team
                    </Label>
                    {authSummaryByDistrict.length === 0 ? (
                      <p className="text-sm text-muted-foreground border rounded-md p-3">
                        Nothing added yet. Choose a property above and click Apply.
                      </p>
                    ) : (
                      <ul className="rounded-md border divide-y text-sm">
                        {authSummaryByDistrict.map((row) => (
                          <li
                            key={row.key}
                            className="flex flex-wrap items-center justify-between gap-2 p-2.5"
                          >
                            <div className="min-w-0">
                              <span className="font-medium">{row.label}</span>{' '}
                              <Badge variant="secondary" className="text-xs font-normal">
                                {row.all ? 'All units' : `${row.count} / ${row.total} units`}
                              </Badge>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive shrink-0"
                              onClick={() => removeDistrictFromAuth(row.key)}
                            >
                              Remove
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Selected Members</Label>
                <div className="rounded-md border p-3 text-sm space-y-1">
                  {selectedTeamMembers.length === 0 ? (
                    <p className="text-muted-foreground">No member added yet.</p>
                  ) : (
                    selectedTeamMembers.map((id) => {
                      const m = contacts.find((c) => c.id === id)
                      return <p key={id}>- {m?.name ?? id}</p>
                    })
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Rest Days</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border p-3">
                  {weekDays.map((day) => (
                    <label key={day} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedRestDays.includes(day)}
                        onCheckedChange={(v) => toggleRestDay(day, Boolean(v))}
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </div>

              <Button type="button" variant="outline" onClick={openMemberPicker}>
                Add Member
              </Button>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetTeamEditor() }}>
                Cancel
              </Button>
              <Button onClick={submitTeam}>{editingTeamId ? 'Save Team' : 'Create Team'}</Button>
            </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {viewTab === 'list' ? (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Team List</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 space-y-0 px-4 sm:px-6">
            {/* Desktop: wide table scrolls inside viewport */}
            <div className="hidden md:block overflow-x-auto rounded-md border">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3">Team</th>
                    <th className="text-left p-3">Members</th>
                    <th className="text-left p-3">Created</th>
                    <th className="text-left p-3">Authorise</th>
                    <th className="text-left p-3">Rest Days</th>
                    <th className="text-left p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-muted-foreground">
                        No teams created.
                      </td>
                    </tr>
                  ) : (
                    teams.map((t) => (
                      <tr key={t.id} className="border-t">
                        <td className="p-3 font-medium">{t.name}</td>
                        <td className="p-3 max-w-[220px] whitespace-normal break-words">{membersLabel(t)}</td>
                        <td className="p-3 whitespace-nowrap">{formatCreatedDateMalaysia(t.createdAt)}</td>
                        <td className="p-3 max-w-[280px] whitespace-normal break-words capitalize">
                          {teamAuthoriseLabel(t)}
                        </td>
                        <td className="p-3 max-w-[200px] whitespace-normal break-words">
                          {t.restDays.length > 0 ? t.restDays.join(', ') : '-'}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => openEditTeam(t)}>
                              <Pencil className="h-4 w-4 mr-1" />
                              Edit Team
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => void deleteTeam(t)}>
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete Team
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked rows — no horizontal table scroll */}
            <div className="md:hidden rounded-md border border-border bg-card divide-y divide-border">
              {teams.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">No teams created.</div>
              ) : (
                teams.map((t) => (
                  <div key={t.id} className="px-3 py-4 space-y-3">
                    <div className="space-y-2 min-w-0">
                      <h3 className="text-lg font-bold leading-snug text-foreground">{t.name}</h3>
                      <div className="space-y-1 text-sm">
                        <p>
                          <span className="text-muted-foreground">Members · </span>
                          <span className="text-foreground break-words">{membersLabel(t)}</span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">Created · </span>
                          {new Date(t.createdAt).toLocaleDateString('en-MY')}
                        </p>
                        <p className="break-words capitalize">
                          <span className="text-muted-foreground">Authorise · </span>
                          {teamAuthoriseLabel(t)}
                        </p>
                        <p className="break-words">
                          <span className="text-muted-foreground">Rest days · </span>
                          {t.restDays.length > 0 ? t.restDays.join(', ') : '—'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="flex-1 min-w-[120px]" onClick={() => openEditTeam(t)}>
                        <Pencil className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1 min-w-[120px]"
                        onClick={() => void deleteTeam(t)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Calendar</CardTitle>
            <CardDescription className="hidden md:block">
              Rest-day badge by team ({hasMounted ? calendarCells.monthLabel || '—' : '…'})
            </CardDescription>
            <CardDescription className="md:hidden">Which teams are off each weekday</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 px-4 pb-4 pt-0 sm:px-6">
            {/* Mobile: one block per weekday — no cramped month grid */}
            <div className="md:hidden divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {weekDays.map((day) => {
                const off = teamsRestingOnWeekday(day)
                return (
                  <div key={day} className="px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</p>
                    {off.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">—</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {off.map((t) => (
                          <Badge
                            key={t.id}
                            variant="secondary"
                            className={`text-xs font-normal ${teamBadgeClass(t.id)}`}
                          >
                            {t.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Desktop: month grid */}
            <div className="hidden w-full max-w-full md:block">
              <div className="mb-2 grid grid-cols-7 gap-1 text-[10px] font-medium text-muted-foreground sm:gap-2 sm:text-xs">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="truncate py-0.5 text-center">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 auto-rows-min items-start gap-1 sm:gap-2">
                {calendarCells.cells.map((cell, idx) =>
                  cell ? (
                    <div
                      key={idx}
                      className="flex min-h-0 flex-col gap-1 rounded-md border border-border bg-background p-1 sm:p-1.5"
                    >
                      <span className="text-[11px] font-semibold tabular-nums leading-none text-foreground sm:text-sm">
                        {cell.day}
                      </span>
                      <div className="flex min-h-0 flex-col gap-0.5">
                        {teamsRestingOn(cell.date).length === 0 ? (
                          <span className="text-[9px] text-muted-foreground/70 sm:text-[11px]">·</span>
                        ) : (
                          teamsRestingOn(cell.date).map((t) => (
                            <Badge
                              key={`${t.id}-${cell.day}`}
                              variant="secondary"
                              className={`w-full justify-center whitespace-normal break-words px-1 py-0.5 text-center text-[9px] leading-tight sm:text-xs ${teamBadgeClass(t.id)}`}
                            >
                              {t.name}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    <div key={idx} className="min-h-0" aria-hidden />
                  )
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={isMemberPickerOpen} onOpenChange={setIsMemberPickerOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Select Active Staff</DialogTitle>
            <DialogDescription>
              Search/filter then tick checkbox. Confirm to write into selected members.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Search staff name"
                />
              </div>

              <Select value={employmentFilter} onValueChange={(v) => setEmploymentFilter(v as 'all' | EmploymentStatus)}>
                <SelectTrigger>
                  <SelectValue placeholder="Employment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employment</SelectItem>
                  <SelectItem value="full-time">Full-time</SelectItem>
                  <SelectItem value="part-time">Part-time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border max-h-[360px] overflow-y-auto">
              {filteredMemberOptions.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No active staff matched filter.</div>
              ) : (
                <div className="divide-y">
                  {filteredMemberOptions.map((m) => {
                    const checked = memberDraftSelected.includes(m.id)
                    const assignedTeam = findOtherTeamByMemberId(m.id)
                    const disabled = Boolean(assignedTeam)
                    return (
                      <label
                        key={m.id}
                        className={`flex items-start gap-3 p-3 text-sm ${
                          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-muted/40'
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(v) => toggleDraftMember(m.id, Boolean(v))}
                        />
                        <div>
                          <p className="font-medium">{m.name}</p>
                          <p className="text-muted-foreground text-xs">{prettyPermissions(m.permissions)} • {m.employmentStatus}</p>
                          {assignedTeam ? (
                            <p className="text-[11px] text-amber-700 mt-1">
                              Already in {assignedTeam.name}
                            </p>
                          ) : null}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMemberPickerOpen(false)}>Cancel</Button>
            <Button onClick={confirmMembers}>Confirm Members</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
