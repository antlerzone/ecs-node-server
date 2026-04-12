"use client"

import { useState, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Camera,
  MapPin,
  Clock,
  CheckCircle2,
  Play,
  Upload,
  X,
  Calendar,
  BedDouble,
  AlertCircle,
  ChevronRight,
  Image as ImageIcon,
  LogOut,
  Timer,
  Info
} from 'lucide-react'

// ─── Status types for homestay cleaning ───────────────────────────────────────
// pending_checkout  → Guest hasn't checked out yet
// ready_to_clean    → Guest checked out, unit is ready for cleaning
// in_progress       → Cleaner has started cleaning
// job_complete      → Cleaner uploaded photos and marked done
// issue             → Problem reported (e.g. damage, missing items)

type TaskStatus = 'pending_checkout' | 'ready_to_clean' | 'in_progress' | 'job_complete' | 'issue'

interface TaskPhoto {
  id: string
  url: string
  timestamp: string
  location: string
}

interface Task {
  id: string
  property: string
  unit: string
  cleaningType: string
  status: TaskStatus
  checkoutTime?: string
  scheduledTime: string
  startTime?: string
  endTime?: string
  photos?: TaskPhoto[]
  notes?: string
  guestName?: string
}

const initialTasks: Task[] = [
  {
    id: '1',
    property: 'Sunway Velocity',
    unit: 'A-12-03',
    cleaningType: 'Homestay Turnover',
    status: 'pending_checkout',
    scheduledTime: '11:00 AM',
    checkoutTime: '12:00 PM',
    guestName: 'Mr. Lim Wei Jie',
  },
  {
    id: '2',
    property: 'KLCC Residences',
    unit: 'B-23-05',
    cleaningType: 'Homestay Turnover',
    status: 'ready_to_clean',
    scheduledTime: '09:00 AM',
    checkoutTime: '10:00 AM',
    guestName: 'Ms. Sarah',
  },
  {
    id: '3',
    property: 'Mont Kiara',
    unit: 'C-05-12',
    cleaningType: 'Deep Clean',
    status: 'in_progress',
    scheduledTime: '08:00 AM',
    startTime: '08:15 AM',
  },
  {
    id: '4',
    property: 'Bangsar South',
    unit: 'D-18-08',
    cleaningType: 'Homestay Turnover',
    status: 'job_complete',
    scheduledTime: '07:00 AM',
    startTime: '07:30 AM',
    endTime: '09:00 AM',
    photos: [
      { id: 'p1', url: '/placeholder.svg', timestamp: '08:45 AM · 11 Mar 2026', location: 'Bangsar South, KL' },
      { id: 'p2', url: '/placeholder.svg', timestamp: '08:50 AM · 11 Mar 2026', location: 'Bangsar South, KL' },
      { id: 'p3', url: '/placeholder.svg', timestamp: '08:55 AM · 11 Mar 2026', location: 'Bangsar South, KL' },
    ],
  },
]

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<TaskStatus, { label: string; badgeClass: string; dot: string }> = {
  pending_checkout: {
    label: 'Pending Check Out',
    badgeClass: 'bg-red-100 text-red-800 border-red-200',
    dot: 'bg-red-500',
  },
  ready_to_clean: {
    label: 'Ready to Clean',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
    dot: 'bg-blue-500',
  },
  in_progress: {
    label: 'In Progress',
    badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    dot: 'bg-yellow-500',
  },
  job_complete: {
    label: 'Job Complete',
    badgeClass: 'bg-green-100 text-green-800 border-green-200',
    dot: 'bg-green-500',
  },
  issue: {
    label: 'Issue Reported',
    badgeClass: 'bg-destructive/10 text-destructive border-destructive/20',
    dot: 'bg-destructive',
  },
}

// ─── Photo preview with timeline watermark ───────────────────────────────────
function PhotoCard({ photo, onRemove }: { photo: { url: string; timestamp: string; location: string }; onRemove?: () => void }) {
  return (
    <div className="relative rounded-xl overflow-hidden border border-border">
      <img src={photo.url} alt="Task photo" className="w-full aspect-video object-cover" />
      {/* Watermark overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-2">
        <div className="flex items-center gap-2 text-white text-xs">
          <Clock className="h-3 w-3 shrink-0" />
          <span>{photo.timestamp}</span>
        </div>
        <div className="flex items-center gap-2 text-white/80 text-xs mt-0.5">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{photo.location}</span>
        </div>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-destructive text-white flex items-center justify-center"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// ─── Task card ────────────────────────────────────────────────────────────────
function TaskCard({ task, onAction }: { task: Task; onAction: (id: string, action: string) => void }) {
  const cfg = STATUS_CONFIG[task.status]

  return (
    <Card className="border-border overflow-hidden">
      {/* Status stripe */}
      <div className={`h-1 w-full ${cfg.dot}`} />
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-foreground">{task.property}</p>
              <Badge variant="outline" className="text-xs font-medium">{task.unit}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{task.cleaningType}</p>
            {task.guestName && (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <BedDouble className="h-3 w-3" /> Guest: {task.guestName}
              </p>
            )}
          </div>
          <Badge className={`text-xs shrink-0 ${cfg.badgeClass}`}>
            {cfg.label}
          </Badge>
        </div>

        {/* Timeline */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Scheduled: {task.scheduledTime}
          </span>
          {task.checkoutTime && task.status === 'pending_checkout' && (
            <span className="flex items-center gap-1 text-red-600 font-medium">
              <Timer className="h-3 w-3" />
              Check out by: {task.checkoutTime}
            </span>
          )}
          {task.startTime && (
            <span className="flex items-center gap-1 text-yellow-600">
              <Play className="h-3 w-3" />
              Started: {task.startTime}
            </span>
          )}
          {task.endTime && (
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3 w-3" />
              Done: {task.endTime}
            </span>
          )}
        </div>

        {/* Completed photos strip */}
        {task.status === 'job_complete' && task.photos && task.photos.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              <ImageIcon className="h-3 w-3 inline mr-1" />
              {task.photos.length} photos submitted
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {task.photos.map((ph) => (
                <div key={ph.id} className="shrink-0 w-24 relative rounded-lg overflow-hidden border border-border">
                  <img src={ph.url} alt="task" className="w-full aspect-square object-cover" />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1">
                    <p className="text-white text-[9px] leading-tight truncate">{ph.timestamp}</p>
                    <p className="text-white/70 text-[9px] leading-tight truncate">{ph.location}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons based on status */}
        {task.status === 'pending_checkout' && (
          <div className="pt-1 space-y-2">
            <p className="text-xs text-muted-foreground bg-muted rounded-lg p-2 flex items-start gap-2">
              <Info className="h-3 w-3 shrink-0 mt-0.5 text-red-500" />
              Waiting for guest to check out. You can mark as ready once the unit is vacated.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-blue-200 text-blue-700 hover:bg-blue-50"
                onClick={() => onAction(task.id, 'mark_ready')}
              >
                <LogOut className="h-3 w-3 mr-1" />
                Guest Checked Out
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive/5"
                onClick={() => onAction(task.id, 'report_issue')}
              >
                <AlertCircle className="h-3 w-3 mr-1" />
                Report Issue
              </Button>
            </div>
          </div>
        )}

        {task.status === 'ready_to_clean' && (
          <div className="pt-1">
            <Button
              size="sm"
              className="w-full bg-primary text-primary-foreground"
              onClick={() => onAction(task.id, 'start')}
            >
              <Play className="h-4 w-4 mr-2" />
              Start Cleaning
            </Button>
          </div>
        )}

        {task.status === 'in_progress' && (
          <div className="pt-1 grid grid-cols-2 gap-2">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => onAction(task.id, 'complete')}
            >
              <Camera className="h-4 w-4 mr-1" />
              Submit Photos
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/30 text-destructive hover:bg-destructive/5"
              onClick={() => onAction(task.id, 'report_issue')}
            >
              <AlertCircle className="h-4 w-4 mr-1" />
              Report Issue
            </Button>
          </div>
        )}

        {task.status === 'job_complete' && (
          <div className="flex items-center justify-center gap-2 py-1 text-green-600 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4" />
            Task completed successfully
          </div>
        )}

        {task.status === 'issue' && (
          <div className="pt-1 p-2 bg-destructive/5 rounded-lg">
            <p className="text-xs text-destructive font-medium flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Issue reported — supervisor notified
            </p>
            {task.notes && <p className="text-xs text-muted-foreground mt-1">{task.notes}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [activeTab, setActiveTab] = useState('all')

  // Dialog state
  const [completeDialog, setCompleteDialog] = useState<string | null>(null)
  const [issueDialog, setIssueDialog] = useState<string | null>(null)
  const [uploadedPhotos, setUploadedPhotos] = useState<{ url: string; timestamp: string; location: string }[]>([])
  const [issueNote, setIssueNote] = useState('')
  const [isGettingLocation, setIsGettingLocation] = useState(false)
  const [capturedLocation, setCapturedLocation] = useState('Kuala Lumpur, Malaysia')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAction = (id: string, action: string) => {
    if (action === 'mark_ready') {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'ready_to_clean' as TaskStatus } : t))
    } else if (action === 'start') {
      const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'in_progress' as TaskStatus, startTime: now } : t))
    } else if (action === 'complete') {
      setCompleteDialog(id)
      setUploadedPhotos([])
    } else if (action === 'report_issue') {
      setIssueDialog(id)
      setIssueNote('')
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const now = new Date()
        const ts = now.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', year: 'numeric' }).replace(',', ' ·')
        setUploadedPhotos(prev => [...prev, {
          url: reader.result as string,
          timestamp: ts,
          location: capturedLocation,
        }])
      }
      reader.readAsDataURL(file)
    })
  }

  const handleGetLocation = () => {
    setIsGettingLocation(true)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCapturedLocation(`Lat: ${pos.coords.latitude.toFixed(4)}, Lng: ${pos.coords.longitude.toFixed(4)}`)
          setIsGettingLocation(false)
        },
        () => {
          setCapturedLocation('Kuala Lumpur, Malaysia')
          setIsGettingLocation(false)
        }
      )
    } else {
      setTimeout(() => {
        setCapturedLocation('Lat: 3.1390, Lng: 101.6869')
        setIsGettingLocation(false)
      }, 1000)
    }
  }

  const handleSubmitComplete = () => {
    if (!completeDialog || uploadedPhotos.length === 0) return
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    setTasks(prev => prev.map(t =>
      t.id === completeDialog
        ? {
            ...t,
            status: 'job_complete' as TaskStatus,
            endTime: now,
            photos: uploadedPhotos.map((p, i) => ({ id: `new-${i}`, ...p })),
          }
        : t
    ))
    setCompleteDialog(null)
    setUploadedPhotos([])
  }

  const handleSubmitIssue = () => {
    if (!issueDialog) return
    setTasks(prev => prev.map(t =>
      t.id === issueDialog ? { ...t, status: 'issue' as TaskStatus, notes: issueNote } : t
    ))
    setIssueDialog(null)
    setIssueNote('')
  }

  const counts = {
    all: tasks.length,
    pending_checkout: tasks.filter(t => t.status === 'pending_checkout').length,
    ready_to_clean: tasks.filter(t => t.status === 'ready_to_clean').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    job_complete: tasks.filter(t => t.status === 'job_complete').length,
  }

  const filtered = activeTab === 'all' ? tasks : tasks.filter(t => t.status === activeTab)

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Tasks</h1>
        <p className="text-muted-foreground text-sm flex items-center gap-1 mt-0.5">
          <Calendar className="h-4 w-4" /> {today}
        </p>
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap gap-2">
        {(Object.entries(STATUS_CONFIG) as [TaskStatus, typeof STATUS_CONFIG[TaskStatus]][]).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
            {cfg.label}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full overflow-x-auto flex justify-start gap-1 h-auto flex-wrap">
          <TabsTrigger value="all" className="text-xs">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="pending_checkout" className="text-xs">Checkout ({counts.pending_checkout})</TabsTrigger>
          <TabsTrigger value="ready_to_clean" className="text-xs">Ready ({counts.ready_to_clean})</TabsTrigger>
          <TabsTrigger value="in_progress" className="text-xs">Active ({counts.in_progress})</TabsTrigger>
          <TabsTrigger value="job_complete" className="text-xs">Done ({counts.job_complete})</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4 space-y-3">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No tasks in this category</p>
            </div>
          ) : (
            filtered.map(task => (
              <TaskCard key={task.id} task={task} onAction={handleAction} />
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* ── Complete Task Dialog ── */}
      <Dialog open={!!completeDialog} onOpenChange={(open) => { if (!open) { setCompleteDialog(null); setUploadedPhotos([]) } }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submit Cleaning Photos</DialogTitle>
            <DialogDescription>
              Upload before &amp; after photos. Each photo will be automatically stamped with time and location.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Location */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted border border-border">
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-foreground">{capturedLocation}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={handleGetLocation} disabled={isGettingLocation}>
                {isGettingLocation ? 'Getting...' : 'Update'}
              </Button>
            </div>

            {/* Uploaded photos */}
            {uploadedPhotos.length > 0 && (
              <div className="grid grid-cols-1 gap-3">
                {uploadedPhotos.map((photo, i) => (
                  <PhotoCard
                    key={i}
                    photo={photo}
                    onRemove={() => setUploadedPhotos(prev => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
              </div>
            )}

            {/* Upload zone */}
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground font-medium">Tap to upload photos</p>
              <p className="text-xs text-muted-foreground mt-1">Multiple selection allowed</p>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />

            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              disabled={uploadedPhotos.length === 0}
              onClick={handleSubmitComplete}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Mark Job Complete ({uploadedPhotos.length} {uploadedPhotos.length === 1 ? 'photo' : 'photos'})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Report Issue Dialog ── */}
      <Dialog open={!!issueDialog} onOpenChange={(open) => { if (!open) { setIssueDialog(null); setIssueNote('') } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Report an Issue</DialogTitle>
            <DialogDescription>
              Describe the problem. Your supervisor will be notified immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="issue-note">Issue Description</Label>
              <Textarea
                id="issue-note"
                placeholder="e.g. Guest has not checked out yet, unit is still occupied..."
                value={issueNote}
                onChange={(e) => setIssueNote(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
            <Button
              className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!issueNote.trim()}
              onClick={handleSubmitIssue}
            >
              <AlertCircle className="h-4 w-4 mr-2" />
              Submit Report
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
