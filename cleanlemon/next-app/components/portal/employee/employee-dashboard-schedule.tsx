"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import {
  fetchOperatorScheduleJobs,
  updateOperatorScheduleJob,
  uploadEmployeeFileToOss,
  postEmployeeScheduleGroupStart,
  postEmployeeScheduleGroupEnd,
  postEmployeeScheduleDamageReport,
  postEmployeeTaskUnlockTargets,
  postEmployeeTaskUnlock,
  fetchEmployeeJobCompletionAddons,
  type EmployeeUnlockTarget,
  type JobCompletionAddonDef,
} from '@/lib/cleanlemon-api'
import { isProbablyVideoFile } from '@/lib/media-url-kind'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { CleanlemonDoorOpenPanel } from '@/components/cleanlemons/cleanlemon-door-open-dialog'
import {
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  MapPin,
  MoreHorizontal,
  QrCode,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'

interface Task {
  id: string
  date: string
  unitNumber: string
  property: string
  serviceProvider: string
  status: 'pending-checkout' | 'ready-to-clean' | 'in-progress' | 'completed' | 'cancelled'
  estimateKpi: number
  estimatedDuration: number
  completedPhotos: string[]
  staffStartTime?: string
  staffEndTime?: string
  estimateCompleteAt?: string
  colivingPropertydetailId?: string | null
  colivingRoomdetailId?: string | null
  clnOperatorId?: string | null
  teamName?: string | null
  propertyId?: string | null
  remarks?: string
  mailboxPassword?: string
  doorPin?: string
  smartdoorTokenEnabled?: boolean
  propertySmartdoorId?: string | null
  operatorDoorAccessMode?: string
  /** Same-day checkout + check-in — priority flag */
  btob?: boolean
}

type UploadPreview = {
  id: string
  file: File
  url: string
}

/** Mobile strip + pill: match real job status (was wrongly lumping ready-to-clean into "Pending clean"). */
function mobileSchedulePresentation(status: Task['status']) {
  if (status === 'completed') {
    return { label: 'Complete', bar: 'bg-emerald-500', pill: 'bg-emerald-600 text-white' }
  }
  if (status === 'pending-checkout') {
    return { label: 'Not ready', bar: 'bg-red-600', pill: 'bg-red-600 text-white' }
  }
  if (status === 'ready-to-clean') {
    return { label: 'Ready to Clean', bar: 'bg-blue-600', pill: 'bg-blue-600 text-white' }
  }
  if (status === 'in-progress') {
    return { label: 'In progress', bar: 'bg-amber-400', pill: 'bg-amber-400 text-gray-900' }
  }
  if (status === 'cancelled') {
    return { label: 'Cancelled', bar: 'bg-gray-500', pill: 'bg-gray-200 text-gray-700' }
  }
  return { label: 'Pending clean', bar: 'bg-amber-400', pill: 'bg-amber-400 text-gray-900' }
}

function propertyHasSmartDoor(task: Task): boolean {
  return Boolean(task.propertySmartdoorId && String(task.propertySmartdoorId).trim())
}

async function copyAccessText(text: string) {
  const t = String(text || '').trim()
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
    toast.success('Copied')
  } catch {
    toast.error('Could not copy')
  }
}

function malaysiaDateString(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function buildUserMatchKeys(user: { email?: string; name?: string; id?: string } | null): Set<string> {
  const keys = new Set<string>()
  const email = String(user?.email || '').trim().toLowerCase()
  const name = String(user?.name || '').trim().toLowerCase()
  const id = String(user?.id || '').trim().toLowerCase()
  if (email) keys.add(email)
  if (email.includes('@')) keys.add(email.split('@')[0] || '')
  if (name) keys.add(name)
  if (id) keys.add(id)
  return keys
}

function jobMatchesEmployee(job: Task, keys: Set<string>): boolean {
  if (keys.size === 0) return true
  const rawSubmit = typeof job.remarks === 'string' ? job.remarks : ''
  let submitStr = rawSubmit
  try {
    const p = JSON.parse(rawSubmit)
    if (p && typeof p === 'object') submitStr = JSON.stringify(p)
  } catch {
    /* plain string */
  }
  const candidates = [submitStr, String((job as any).staffEmail || ''), String((job as any).staffName || '')]
    .map((x) => String(x).trim().toLowerCase())
    .filter(Boolean)
  return candidates.some((x) => {
    if (keys.has(x)) return true
    for (const key of keys) {
      if (!key) continue
      if (x.includes(key) || key.includes(x)) return true
    }
    return false
  })
}

function normalizeTaskStatus(status: string): Task['status'] {
  const raw = String(status ?? '').trim()
  if (raw === '') return 'pending-checkout'
  const x = raw.toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-')
  if (x.includes('complete')) return 'completed'
  if (x.includes('progress')) return 'in-progress'
  if (x.includes('cancel')) return 'cancelled'
  if (x.includes('checkout') || x.includes('check-out')) return 'pending-checkout'
  if (x.includes('customer') && x.includes('missing')) return 'pending-checkout'
  if (x.includes('ready') && x.includes('clean')) return 'ready-to-clean'
  return 'pending-checkout'
}

export function EmployeeDashboardSchedule() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(() => malaysiaDateString())
  const [startDialogOpen, setStartDialogOpen] = useState(false)
  const [startingTask, setStartingTask] = useState<Task | null>(null)
  const [estimateCompleteAt, setEstimateCompleteAt] = useState('')
  const [estimatePhotoCount, setEstimatePhotoCount] = useState('3')
  const [endDialogOpen, setEndDialogOpen] = useState(false)
  const [endingTask, setEndingTask] = useState<Task | null>(null)
  const [endRemark, setEndRemark] = useState('')
  const [endPhotoPreviews, setEndPhotoPreviews] = useState<UploadPreview[]>([])
  const [addonCatalog, setAddonCatalog] = useState<JobCompletionAddonDef[]>([])
  const [endCleanAddonIds, setEndCleanAddonIds] = useState<string[]>([])
  const [groupEndAddonIds, setGroupEndAddonIds] = useState<string[]>([])
  const [savingEnd, setSavingEnd] = useState(false)
  const [damageDialogOpen, setDamageDialogOpen] = useState(false)
  const [damageTask, setDamageTask] = useState<Task | null>(null)
  const [damageRemark, setDamageRemark] = useState('')
  const [damagePhotoPreviews, setDamagePhotoPreviews] = useState<UploadPreview[]>([])
  const [savingDamage, setSavingDamage] = useState(false)
  const [groupStartJobs, setGroupStartJobs] = useState<Task[] | null>(null)
  const [groupEndJobs, setGroupEndJobs] = useState<Task[] | null>(null)
  const [savingGroupStart, setSavingGroupStart] = useState(false)
  const [savingGroupEnd, setSavingGroupEnd] = useState(false)
  const [unlockState, setUnlockState] = useState<{
    task: Task
    targets: EmployeeUnlockTarget[]
    selectedLockDetailId: string
  } | null>(null)
  const [unlockLoadingId, setUnlockLoadingId] = useState<string | null>(null)
  const [unlockSubmitting, setUnlockSubmitting] = useState(false)
  const [groupEndRemark, setGroupEndRemark] = useState('')
  const [groupEndPhotoPreviews, setGroupEndPhotoPreviews] = useState<UploadPreview[]>([])
  const [propertyAccessTask, setPropertyAccessTask] = useState<Task | null>(null)

  const canWebBluetooth =
    typeof navigator !== 'undefined' && typeof navigator.bluetooth !== 'undefined'

  const reloadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const op =
        typeof window !== 'undefined' ? localStorage.getItem('cleanlemons_employee_operator_id') || '' : ''
      const r = await fetchOperatorScheduleJobs({ operatorId: op.trim() || undefined, limit: 800 })
      const items = Array.isArray(r?.items) ? r.items : []
      const mapped: Task[] = items.map((x: any) => ({
        id: String(x.id),
        date: String(x.date || '').slice(0, 10),
        unitNumber: String(x.unitNumber || '-'),
        property: String(x.property || '-'),
        serviceProvider: String(x.serviceProvider || '-'),
        status: normalizeTaskStatus(x.status || 'ready-to-clean'),
        estimateKpi: Number(x.estimateKpi) || 0,
        estimatedDuration: 45,
        completedPhotos: Array.isArray(x.completedPhotos) ? x.completedPhotos : [],
        staffStartTime: x.staffStartTime ? String(x.staffStartTime) : undefined,
        staffEndTime: x.staffEndTime ? String(x.staffEndTime) : undefined,
        estimateCompleteAt: x.estimateCompleteAt ? String(x.estimateCompleteAt) : undefined,
        colivingPropertydetailId: x.colivingPropertydetailId ? String(x.colivingPropertydetailId) : null,
        colivingRoomdetailId: x.colivingRoomdetailId ? String(x.colivingRoomdetailId) : null,
        clnOperatorId: x.clnOperatorId ? String(x.clnOperatorId) : null,
        teamName: x.teamName != null ? String(x.teamName) : null,
        propertyId: x.propertyId ? String(x.propertyId) : null,
        remarks: x.remarks != null ? String(x.remarks) : undefined,
        mailboxPassword:
          x.mailboxPassword != null && String(x.mailboxPassword).trim()
            ? String(x.mailboxPassword).trim()
            : undefined,
        doorPin:
          x.doorPin != null && String(x.doorPin).trim() ? String(x.doorPin).trim() : undefined,
        smartdoorTokenEnabled: !!x.smartdoorTokenEnabled,
        propertySmartdoorId:
          x.propertySmartdoorId != null && String(x.propertySmartdoorId).trim()
            ? String(x.propertySmartdoorId).trim()
            : null,
        btob: Boolean(x.btob),
      }))
      setTasks(mapped)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await reloadTasks()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [reloadTasks])

  const visibleTasks = useMemo(() => {
    const keys = buildUserMatchKeys(user)
    const matched = tasks.filter((t) => jobMatchesEmployee(t, keys))
    if (matched.length > 0) return matched
    return tasks
  }, [tasks, user])

  const filteredTasks = useMemo(
    () => visibleTasks.filter((t) => t.date === selectedDate),
    [visibleTasks, selectedDate],
  )

  const groupBuckets = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of filteredTasks) {
      const pid = t.colivingPropertydetailId && String(t.colivingPropertydetailId).trim()
      if (!pid) continue
      const key = `${pid}|${t.date}`
      const arr = m.get(key) || []
      arr.push(t)
      m.set(key, arr)
    }
    return m
  }, [filteredTasks])

  const groupActions = useMemo(() => {
    const out: { key: string; label: string; ready: Task[]; progress: Task[] }[] = []
    for (const [, jobs] of groupBuckets.entries()) {
      if (jobs.length < 2) continue
      const ready = jobs.filter((j) => j.status === 'ready-to-clean')
      const progress = jobs.filter((j) => normalizeTaskStatus(j.status) === 'in-progress')
      const label = jobs[0]?.property || 'Property group'
      out.push({ key: `${jobs[0]?.colivingPropertydetailId}|${jobs[0]?.date}`, label, ready, progress })
    }
    return out
  }, [groupBuckets])

  const openStartDialog = (task: Task) => {
    if (task.status !== 'ready-to-clean') {
      toast.error('Only Ready to Clean unit can start clean.')
      return
    }
    const now = new Date()
    const eta = new Date(now.getTime() + task.estimatedDuration * 60000)
    setEstimateCompleteAt(eta.toISOString().slice(0, 16))
    setEstimatePhotoCount('3')
    setStartingTask(task)
    setStartDialogOpen(true)
  }

  const confirmStartClean = async () => {
    if (!startingTask) return
    const r = await updateOperatorScheduleJob(startingTask.id, {
      status: 'in-progress',
      startTime: new Date().toISOString(),
      submitByMeta: {
        action: 'start-clean',
        estimateCompleteAt,
        estimatePhotoCount: Number(estimatePhotoCount) || 3,
      },
    })
    if (!r?.ok) {
      toast.error(`Start clean failed (${r?.reason || 'unknown'})`)
      return
    }
    setTasks((prev) =>
      prev.map((x) =>
        x.id === startingTask.id
          ? {
              ...x,
              status: 'in-progress',
              staffStartTime: new Date().toTimeString().slice(0, 5),
              estimateCompleteAt,
            }
          : x,
      ),
    )
    toast.success(`Started cleaning ${startingTask.unitNumber}`)
    setStartDialogOpen(false)
    setStartingTask(null)
  }

  const openEndDialog = (task: Task) => {
    setEndingTask(task)
    setEndRemark('')
    setEndPhotoPreviews([])
    setEndDialogOpen(true)
  }

  const openDamageDialog = (task: Task) => {
    setDamageTask(task)
    setDamageRemark('')
    setDamagePhotoPreviews([])
    setDamageDialogOpen(true)
  }

  useEffect(() => {
    return () => {
      for (const p of endPhotoPreviews) {
        URL.revokeObjectURL(p.url)
      }
    }
  }, [endPhotoPreviews])

  useEffect(() => {
    return () => {
      for (const p of damagePhotoPreviews) {
        URL.revokeObjectURL(p.url)
      }
    }
  }, [damagePhotoPreviews])

  useEffect(() => {
    return () => {
      for (const p of groupEndPhotoPreviews) {
        URL.revokeObjectURL(p.url)
      }
    }
  }, [groupEndPhotoPreviews])

  const onSelectEndPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const next = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      url: URL.createObjectURL(file),
    }))
    setEndPhotoPreviews((prev) => [...prev, ...next])
    e.currentTarget.value = ''
  }

  const removeEndPhoto = (id: string) => {
    setEndPhotoPreviews((prev) => {
      const target = prev.find((x) => x.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((x) => x.id !== id)
    })
  }

  const onSelectDamagePhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const next = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      url: URL.createObjectURL(file),
    }))
    setDamagePhotoPreviews((prev) => [...prev, ...next])
    e.currentTarget.value = ''
  }

  const removeDamagePhoto = (id: string) => {
    setDamagePhotoPreviews((prev) => {
      const target = prev.find((x) => x.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((x) => x.id !== id)
    })
  }

  const getCurrentLocation = async (): Promise<{ lat: number | null; lng: number | null }> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return { lat: null, lng: null }
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve({ lat: null, lng: null }),
        { timeout: 8000, enableHighAccuracy: true },
      )
    })
  }

  const confirmEndClean = async () => {
    if (!endingTask) return
    setSavingEnd(true)
    const timeNow = new Date().toISOString()
    const loc = await getCurrentLocation()
    const operatorOrClientId =
      (typeof window !== 'undefined' ? localStorage.getItem('cleanlemons_employee_operator_id') : '') ||
      user?.operatorId ||
      user?.id ||
      'op_demo_001'
    const uploadedUrls: string[] = []
    for (const p of endPhotoPreviews) {
      const f = p.file
      const up = await uploadEmployeeFileToOss(f, String(operatorOrClientId))
      if (up?.ok && up.url) uploadedUrls.push(up.url)
    }
    const completionAddons = addonCatalog
      .filter((a) => endCleanAddonIds.includes(a.id))
      .map((a) => ({ id: a.id, name: a.name, priceMyr: a.priceMyr }))
    const patchPayload = {
      status: 'completed',
      endTime: timeNow,
      photos: uploadedUrls,
      submitByMeta: {
        action: 'end-clean',
        remark: endRemark.trim(),
        completedAt: timeNow,
        location: loc,
        ...(completionAddons.length ? { completionAddons } : {}),
      },
    }
    const r = await updateOperatorScheduleJob(endingTask.id, patchPayload)
    setSavingEnd(false)
    if (!r?.ok) {
      toast.error(`End clean failed (${r?.reason || 'unknown'})`)
      return
    }
    setTasks((prev) =>
      prev.map((x) =>
        x.id === endingTask.id
          ? {
              ...x,
              status: 'completed',
              staffEndTime: new Date().toTimeString().slice(0, 5),
              completedPhotos: [...x.completedPhotos, ...uploadedUrls],
            }
          : x,
      ),
    )
    setEndDialogOpen(false)
    toast.success(`Ended cleaning ${endingTask.unitNumber}`)
  }

  const submitDamageReport = async () => {
    if (!damageTask) return
    if (!damageRemark.trim()) {
      toast.error('Please input remark before submit.')
      return
    }
    setSavingDamage(true)
    const loc = await getCurrentLocation()
    const operatorOrClientId =
      (typeof window !== 'undefined' ? localStorage.getItem('cleanlemons_employee_operator_id') : '') ||
      user?.operatorId ||
      user?.id ||
      'op_demo_001'
    const uploadedUrls: string[] = []
    for (const p of damagePhotoPreviews) {
      const up = await uploadEmployeeFileToOss(p.file, String(operatorOrClientId))
      if (up?.ok && up.url) uploadedUrls.push(up.url)
    }
    const r = await postEmployeeScheduleDamageReport(damageTask.id, {
      operatorId: String(operatorOrClientId),
      remark: damageRemark.trim(),
      photos: uploadedUrls,
      location: loc,
    })
    setSavingDamage(false)
    if (!r?.ok) {
      toast.error(`Damage report failed (${r?.reason || 'unknown'})`)
      return
    }
    setDamageDialogOpen(false)
    toast.success(`Damage report submitted for ${damageTask.unitNumber}`)
  }

  const getEmployeeOperatorId = () =>
    (typeof window !== 'undefined' ? localStorage.getItem('cleanlemons_employee_operator_id') : '') ||
    String(user?.operatorId || '').trim() ||
    ''

  const openGroupStartDialog = (jobs: Task[]) => {
    if (jobs.length < 2) return
    const now = new Date()
    const eta = new Date(now.getTime() + jobs[0].estimatedDuration * 60000)
    setEstimateCompleteAt(eta.toISOString().slice(0, 16))
    setEstimatePhotoCount('3')
    setGroupStartJobs(jobs)
  }

  const confirmGroupStartClean = async () => {
    if (!groupStartJobs || groupStartJobs.length < 2) return
    const operatorId = getEmployeeOperatorId()
    if (!operatorId) {
      toast.error('Select operator in the header first.')
      return
    }
    setSavingGroupStart(true)
    const r = await postEmployeeScheduleGroupStart({
      operatorId,
      jobIds: groupStartJobs.map((j) => j.id),
      estimateCompleteAt,
      estimatePhotoCount: Number(estimatePhotoCount) || 3,
    })
    setSavingGroupStart(false)
    if (!r?.ok) {
      toast.error(`Group start failed (${r?.reason || 'unknown'})`)
      return
    }
    toast.success(`Started ${groupStartJobs.length} jobs together`)
    setGroupStartJobs(null)
    await reloadTasks()
  }

  const openGroupEndDialog = (jobs: Task[]) => {
    if (jobs.length < 2) return
    setGroupEndJobs(jobs)
    setGroupEndRemark('')
    setGroupEndPhotoPreviews([])
    setGroupEndAddonIds([])
    void loadAddonCatalog()
  }

  const onSelectGroupEndPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const next = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      url: URL.createObjectURL(file),
    }))
    setGroupEndPhotoPreviews((prev) => [...prev, ...next])
    e.currentTarget.value = ''
  }

  const removeGroupEndPhoto = (id: string) => {
    setGroupEndPhotoPreviews((prev) => {
      const target = prev.find((x) => x.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((x) => x.id !== id)
    })
  }

  const confirmGroupEndClean = async () => {
    if (!groupEndJobs || groupEndJobs.length < 2) return
    const operatorId = getEmployeeOperatorId()
    if (!operatorId) {
      toast.error('Select operator in the header first.')
      return
    }
    setSavingGroupEnd(true)
    const operatorOrClientId = operatorId
    const uploadedUrls: string[] = []
    for (const p of groupEndPhotoPreviews) {
      const up = await uploadEmployeeFileToOss(p.file, String(operatorOrClientId))
      if (up?.ok && up.url) uploadedUrls.push(up.url)
    }
    const r = await postEmployeeScheduleGroupEnd({
      operatorId,
      jobIds: groupEndJobs.map((j) => j.id),
      photos: uploadedUrls,
      remark: groupEndRemark.trim(),
    })
    setSavingGroupEnd(false)
    if (!r?.ok) {
      toast.error(`Group end failed (${r?.reason || 'unknown'})`)
      return
    }
    toast.success(`Completed ${groupEndJobs.length} jobs together`)
    setGroupEndJobs(null)
    setGroupEndRemark('')
    setGroupEndPhotoPreviews([])
    await reloadTasks()
  }

  const runUnlock = async (task: Task, lockDetailId: string) => {
    const operatorId = getEmployeeOperatorId()
    if (!operatorId) {
      toast.error('Select operator in the header first.')
      return
    }
    setUnlockSubmitting(true)
    const r = await postEmployeeTaskUnlock(operatorId, task.id, lockDetailId)
    setUnlockSubmitting(false)
    if (!r?.ok) {
      toast.error(r.reason || 'Unlock failed')
      return
    }
    toast.success('Door unlock sent')
    setUnlockState(null)
  }

  return (
    <div id="employee-schedule" className="scroll-mt-24 space-y-6 pb-0 lg:pb-0">
      <div>
        <h2 className="text-xl font-bold text-foreground">Schedule</h2>
        <p className="text-muted-foreground text-sm">
          Dates use Malaysia time (MYT). Pick operator in the header if you have more than one.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job List</CardTitle>
          <CardDescription>Default selected date is today.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <Label className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Date
            </Label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          {groupActions.some((g) => g.ready.length >= 2) ? (
            <div className="rounded-lg border border-dashed bg-muted/20 p-4 space-y-3">
              <p className="text-sm font-medium">Group start (same Coliving property, MYT date)</p>
              <p className="text-xs text-muted-foreground">
                Start all ready jobs for one property together (2+ jobs). Each job must be Ready to Clean.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {groupActions
                  .filter((g) => g.ready.length >= 2)
                  .map((g) => (
                    <Button
                      key={`gs-${g.key}`}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => openGroupStartDialog(g.ready)}
                    >
                      Group start — {g.label} ({g.ready.length})
                    </Button>
                  ))}
              </div>
            </div>
          ) : null}

          {groupActions.some((g) => g.progress.length >= 2) ? (
            <div className="rounded-lg border border-dashed bg-muted/20 p-4 space-y-3">
              <p className="text-sm font-medium">Group end (same property)</p>
              <p className="text-xs text-muted-foreground">
                End all in-progress jobs together with shared photos and remark.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {groupActions
                  .filter((g) => g.progress.length >= 2)
                  .map((g) => (
                    <Button
                      key={`ge-${g.key}`}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => openGroupEndDialog(g.progress)}
                    >
                      Group end — {g.label} ({g.progress.length})
                    </Button>
                  ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-3 md:hidden">
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading jobs…</p>
            ) : filteredTasks.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No jobs for selected date.</p>
            ) : (
              filteredTasks.map((task) => {
                const vis = mobileSchedulePresentation(task.status)
                return (
                  <div
                    key={task.id}
                    className={cn(
                      'flex gap-3 rounded-xl border bg-card p-3 shadow-sm',
                      task.btob && 'border-2 border-red-600 bg-red-50/40',
                    )}
                  >
                    <div className={cn('w-2 shrink-0 self-stretch rounded-full', vis.bar)} aria-hidden />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{task.unitNumber}</p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{task.property}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="shrink-0 gap-1"
                          onClick={() => setPropertyAccessTask(task)}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          Access
                        </Button>
                      </div>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Service · </span>
                        <span className="text-foreground">{task.serviceProvider}</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {task.status === 'ready-to-clean' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="default"
                            className="h-8 gap-1 rounded-full px-3 text-xs font-semibold shadow-sm"
                            onClick={() => openStartDialog(task)}
                          >
                            <Sparkles className="h-3.5 w-3.5 shrink-0" />
                            {vis.label}
                          </Button>
                        ) : (
                          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', vis.pill)}>
                            {vis.label}
                          </span>
                        )}
                        <button
                          type="button"
                          className="text-xs text-primary underline-offset-2 hover:underline"
                          onClick={() => openDamageDialog(task)}
                        >
                          Damage
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Loading jobs…
                    </TableCell>
                  </TableRow>
                ) : filteredTasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No jobs for selected date.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTasks.map((task) => {
                    const vis = mobileSchedulePresentation(task.status)
                    return (
                      <TableRow key={task.id} className={cn(task.btob && 'border-2 border-red-600 bg-red-50/30')}>
                        <TableCell>
                          <div className="font-medium">{task.unitNumber}</div>
                          <div className="text-xs text-muted-foreground">{task.property}</div>
                        </TableCell>
                        <TableCell className="max-w-[14rem] truncate">{task.serviceProvider}</TableCell>
                        <TableCell>
                          {task.status === 'ready-to-clean' ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="default"
                              className="h-8 gap-1 rounded-full px-3 text-xs font-semibold shadow-sm"
                              onClick={() => openStartDialog(task)}
                            >
                              <Sparkles className="h-3.5 w-3.5 shrink-0" />
                              {vis.label}
                            </Button>
                          ) : (
                            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', vis.pill)}>
                              {vis.label}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => setPropertyAccessTask(task)}
                            >
                              <KeyRound className="mr-1 h-3.5 w-3.5" />
                              Access
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => toast.info(`QR code: ${task.unitNumber}`)}>
                                  <QrCode className="mr-2 h-4 w-4" />
                                  QR Code
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openDamageDialog(task)}>
                                  <ShieldAlert className="mr-2 h-4 w-4" />
                                  Damage Report
                                </DropdownMenuItem>
                                {normalizeTaskStatus(task.status) === 'in-progress' ? (
                                  <DropdownMenuItem onClick={() => openEndDialog(task)}>
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                    End Cleaning
                                  </DropdownMenuItem>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={propertyAccessTask != null} onOpenChange={(open) => !open && setPropertyAccessTask(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          {propertyAccessTask ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5" />
                  Property access
                </DialogTitle>
                <DialogDescription>
                  {propertyAccessTask.unitNumber} · {propertyAccessTask.property}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {canWebBluetooth && propertyHasSmartDoor(propertyAccessTask) ? (
                  <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    Bluetooth is available on this device — use Open door when you are at the lock.
                  </p>
                ) : null}
                {propertyHasSmartDoor(propertyAccessTask) ? (
                  <CleanlemonDoorOpenPanel
                    smartdoorId={propertyAccessTask.propertySmartdoorId}
                    operatorDoorAccessMode={propertyAccessTask.operatorDoorAccessMode}
                    smartdoorGatewayReady={undefined}
                    hasBookingToday={propertyAccessTask.date === malaysiaDateString()}
                    mailboxPassword={propertyAccessTask.mailboxPassword}
                    smartdoorPassword={propertyAccessTask.doorPin}
                    onUnlock={async () => {
                      const task = propertyAccessTask
                      const operatorId = getEmployeeOperatorId()
                      if (!operatorId) {
                        return { ok: false, reason: 'Select operator in the header first.' }
                      }
                      setUnlockLoadingId(task.id)
                      const r = await postEmployeeTaskUnlockTargets(operatorId, task.id)
                      setUnlockLoadingId(null)
                      if (!r?.ok) {
                        return { ok: false, reason: r.reason || 'Could not load locks' }
                      }
                      const targets = r.targets || []
                      if (targets.length === 0) {
                        return { ok: false, reason: 'No smart door is bound for this job.' }
                      }
                      if (targets.length > 1) {
                        setUnlockState({
                          task,
                          targets,
                          selectedLockDetailId: targets[0].lockDetailId,
                        })
                        return {
                          ok: false,
                          reason: 'Multiple locks — pick one in the list below.',
                        }
                      }
                      setUnlockSubmitting(true)
                      const ur = await postEmployeeTaskUnlock(operatorId, task.id, targets[0].lockDetailId)
                      setUnlockSubmitting(false)
                      return { ok: !!ur?.ok, reason: ur?.reason }
                    }}
                  />
                ) : (
                  <>
                    {propertyAccessTask.mailboxPassword ? (
                      <div className="space-y-1">
                        <Label>Mailbox PIN</Label>
                        <div className="flex gap-2">
                          <Input readOnly value={propertyAccessTask.mailboxPassword} className="font-mono" />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => void copyAccessText(propertyAccessTask.mailboxPassword || '')}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No smart lock or mailbox PIN on file for this property.
                      </p>
                    )}
                  </>
                )}
                <div className="space-y-2 border-t pt-4">
                  {propertyAccessTask.status === 'ready-to-clean' ? (
                    <Button
                      className="w-full"
                      type="button"
                      onClick={() => {
                        const job = propertyAccessTask
                        setPropertyAccessTask(null)
                        openStartDialog(job)
                      }}
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      Start work
                    </Button>
                  ) : null}
                  {normalizeTaskStatus(propertyAccessTask.status) === 'in-progress' ? (
                    <Button
                      className="w-full"
                      type="button"
                      onClick={() => {
                        const job = propertyAccessTask
                        setPropertyAccessTask(null)
                        openEndDialog(job)
                      }}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      End work
                    </Button>
                  ) : null}
                  {propertyAccessTask.status === 'completed' ? (
                    <p className="text-center text-sm text-muted-foreground">Job completed.</p>
                  ) : null}
                  {propertyAccessTask.status === 'pending-checkout' ? (
                    <p className="text-center text-sm text-muted-foreground">Not ready to clean yet.</p>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={startDialogOpen} onOpenChange={setStartDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Clean</DialogTitle>
            <DialogDescription>
              Confirm estimate complete time and required photo count before start clean.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Unit:</span>{' '}
              <span className="font-medium">{startingTask?.unitNumber || '-'}</span>
            </div>
            <div className="space-y-2">
              <Label>Estimate Complete</Label>
              <Input
                type="datetime-local"
                value={estimateCompleteAt}
                onChange={(e) => setEstimateCompleteAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Photo Required</Label>
              <Input
                type="number"
                min={1}
                value={estimatePhotoCount}
                onChange={(e) => setEstimatePhotoCount(e.target.value)}
              />
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              After start clean, status changes to <span className="font-medium text-foreground">In Progress</span>.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmStartClean}>
              <Check className="h-4 w-4 mr-1" />
              Confirm Start Clean
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={endDialogOpen} onOpenChange={setEndDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End Cleaning</DialogTitle>
            <DialogDescription>
              Visitor can upload photo and remark if needed. Save will include time and location.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Unit:</span>{' '}
              <span className="font-medium">{endingTask?.unitNumber || '-'}</span>
            </div>
            <div className="space-y-2">
              <Label>Upload Photo (optional)</Label>
              <Input
                type="file"
                multiple
                accept="image/*"
                onChange={onSelectEndPhotos}
              />
              {endPhotoPreviews.length > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground">{endPhotoPreviews.length} file(s) selected</p>
                  <div className="grid grid-cols-3 gap-2">
                    {endPhotoPreviews.map((p) => (
                      <div key={p.id} className="relative rounded-md border overflow-hidden bg-muted">
                        <button
                          type="button"
                          className="block w-full"
                          onClick={() => window.open(p.url, '_blank', 'noopener,noreferrer')}
                          title="Preview image"
                        >
                          <img src={p.url} alt="Preview" className="h-20 w-full object-cover" />
                        </button>
                        <button
                          type="button"
                          className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white"
                          onClick={() => removeEndPhoto(p.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Remark (optional)</Label>
              <Textarea
                value={endRemark}
                onChange={(e) => setEndRemark(e.target.value)}
                placeholder="Any visitor remark or issue..."
              />
            </div>
            {addonCatalog.length > 0 ? (
              <div className="space-y-2">
                <Label>Add-on items (optional)</Label>
                <p className="text-xs text-muted-foreground">
                  Operator-defined extras; paid items increase the job fee when invoiced.
                </p>
                <div className="space-y-2 rounded-md border border-border/60 p-3">
                  {addonCatalog.map((a) => (
                    <div key={a.id} className="flex items-start gap-2">
                      <Checkbox
                        id={`end-addon-${a.id}`}
                        checked={endCleanAddonIds.includes(a.id)}
                        onCheckedChange={(c) => {
                          const on = c === true
                          setEndCleanAddonIds((prev) =>
                            on ? [...prev, a.id] : prev.filter((x) => x !== a.id),
                          )
                        }}
                      />
                      <label htmlFor={`end-addon-${a.id}`} className="text-sm leading-tight cursor-pointer">
                        <span className="font-medium">{a.name}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          {a.priceMyr > 0 ? `(+RM ${a.priceMyr})` : '(free — recorded)'}
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                Save will include device location if permission is allowed.
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEndDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmEndClean} disabled={savingEnd}>
              {savingEnd ? 'Saving...' : 'Save End Cleaning'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!groupStartJobs?.length}
        onOpenChange={(o) => {
          if (!o) setGroupStartJobs(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Group start clean</DialogTitle>
            <DialogDescription>
              {groupStartJobs?.length ?? 0} jobs will move to In Progress with the same start time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-48 overflow-y-auto text-sm">
            {groupStartJobs?.map((j) => (
              <div key={j.id} className="flex justify-between gap-2 border-b border-border/60 pb-2">
                <span className="font-medium">{j.unitNumber}</span>
                <span className="text-muted-foreground truncate">{j.property}</span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Estimate Complete</Label>
            <Input
              type="datetime-local"
              value={estimateCompleteAt}
              onChange={(e) => setEstimateCompleteAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Photo Required</Label>
            <Input
              type="number"
              min={1}
              value={estimatePhotoCount}
              onChange={(e) => setEstimatePhotoCount(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setGroupStartJobs(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmGroupStartClean} disabled={savingGroupStart}>
              {savingGroupStart ? 'Starting…' : 'Confirm group start'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!groupEndJobs?.length}
        onOpenChange={(o) => {
          if (!o) {
            setGroupEndJobs(null)
            setGroupEndRemark('')
            setGroupEndPhotoPreviews([])
            setGroupEndAddonIds([])
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Group end cleaning</DialogTitle>
            <DialogDescription>
              Shared photos and remark apply to all {groupEndJobs?.length ?? 0} jobs. All must be In Progress.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-40 overflow-y-auto text-sm">
            {groupEndJobs?.map((j) => (
              <div key={j.id} className="flex justify-between gap-2 border-b border-border/60 pb-2">
                <span className="font-medium">{j.unitNumber}</span>
                <span className="text-muted-foreground truncate">{j.property}</span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Upload Photo (optional)</Label>
            <Input type="file" multiple accept="image/*" onChange={onSelectGroupEndPhotos} />
            {groupEndPhotoPreviews.length > 0 ? (
              <p className="text-xs text-muted-foreground">{groupEndPhotoPreviews.length} file(s) selected</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>Remark (optional)</Label>
            <Textarea
              value={groupEndRemark}
              onChange={(e) => setGroupEndRemark(e.target.value)}
              placeholder="Shared note for the whole group…"
            />
          </div>
          {addonCatalog.length > 0 ? (
            <div className="space-y-2">
              <Label>Add-on items (optional)</Label>
              <div className="space-y-2 rounded-md border border-border/60 p-3">
                {addonCatalog.map((a) => (
                  <div key={a.id} className="flex items-start gap-2">
                    <Checkbox
                      id={`group-end-addon-${a.id}`}
                      checked={groupEndAddonIds.includes(a.id)}
                      onCheckedChange={(c) => {
                        const on = c === true
                        setGroupEndAddonIds((prev) =>
                          on ? [...prev, a.id] : prev.filter((x) => x !== a.id),
                        )
                      }}
                    />
                    <label htmlFor={`group-end-addon-${a.id}`} className="text-sm leading-tight cursor-pointer">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        {a.priceMyr > 0 ? `(+RM ${a.priceMyr})` : '(free — recorded)'}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setGroupEndJobs(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmGroupEndClean} disabled={savingGroupEnd}>
              {savingGroupEnd ? 'Saving…' : 'Confirm group end'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!unlockState}
        onOpenChange={(o) => {
          if (!o) setUnlockState(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose lock to open</DialogTitle>
            <DialogDescription>
              {unlockState?.task.unitNumber} — {unlockState?.task.property}
            </DialogDescription>
          </DialogHeader>
          {unlockState ? (
            <RadioGroup
              className="py-2"
              value={unlockState.selectedLockDetailId}
              onValueChange={(v) =>
                setUnlockState((s) => (s ? { ...s, selectedLockDetailId: v } : s))
              }
            >
              {unlockState.targets.map((t) => (
                <div key={t.lockDetailId} className="flex items-center gap-2">
                  <RadioGroupItem value={t.lockDetailId} id={`lock-${t.lockDetailId}`} />
                  <Label htmlFor={`lock-${t.lockDetailId}`} className="font-normal cursor-pointer">
                    {t.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          ) : null}
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setUnlockState(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={unlockSubmitting || !unlockState}
              onClick={() => {
                if (!unlockState) return
                void runUnlock(unlockState.task, unlockState.selectedLockDetailId)
              }}
            >
              {unlockSubmitting ? 'Unlocking…' : 'Unlock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={damageDialogOpen} onOpenChange={setDamageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Damage Report</DialogTitle>
            <DialogDescription>
              Upload photos or short videos, preview/delete, then submit with a remark.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Unit:</span>{' '}
              <span className="font-medium">{damageTask?.unitNumber || '-'}</span>
            </div>
            <div className="space-y-2">
              <Label>Upload photo or video</Label>
              <Input
                type="file"
                multiple
                accept="image/*,video/*"
                onChange={onSelectDamagePhotos}
              />
              <p className="text-xs text-muted-foreground">Large files may take longer to upload (max ~100MB per file).</p>
              {damagePhotoPreviews.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {damagePhotoPreviews.map((p) => (
                    <div key={p.id} className="relative rounded-md border overflow-hidden bg-muted">
                      {isProbablyVideoFile(p.file) ? (
                        <div className="w-full">
                          <video
                            src={p.url}
                            className="h-20 w-full object-cover bg-black"
                            controls
                            muted
                            playsInline
                            preload="metadata"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="block w-full"
                          onClick={() => window.open(p.url, '_blank', 'noopener,noreferrer')}
                          title="Preview image"
                        >
                          <img src={p.url} alt="Damage preview" className="h-20 w-full object-cover" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white"
                        onClick={() => removeDamagePhoto(p.id)}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Remark</Label>
              <Textarea
                value={damageRemark}
                onChange={(e) => setDamageRemark(e.target.value)}
                placeholder="Describe the damage..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDamageDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitDamageReport} disabled={savingDamage}>
              {savingDamage ? 'Submitting...' : 'Submit Damage Report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
