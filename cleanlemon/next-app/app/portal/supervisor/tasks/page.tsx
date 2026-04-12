"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { 
  Search,
  Plus,
  Clock,
  MapPin,
  Users,
  Camera,
  CheckCircle2,
  AlertCircle,
  MoreVertical,
  Image as ImageIcon,
  Calendar
} from 'lucide-react'

interface TaskPhoto {
  url: string
  timestamp: string
  location: string
}

interface Task {
  id: string
  property: string
  unit: string
  cleaningType: string
  team: string
  assignee: { name: string; avatar: string }
  scheduledTime: string
  status: 'pending' | 'in_progress' | 'completed' | 'issue'
  photos?: TaskPhoto[]
  notes?: string
}

const mockTasks: Task[] = [
  {
    id: '1',
    property: 'Sunway Velocity',
    unit: 'A-12-03',
    cleaningType: 'Deep Clean',
    team: 'Team Alpha',
    assignee: { name: 'Ahmad', avatar: '' },
    scheduledTime: '09:00 AM',
    status: 'completed',
    photos: [
      { url: '/placeholder.svg', timestamp: '10:30 AM, Jan 15', location: 'Lat: 3.1234, Lng: 101.6789' },
      { url: '/placeholder.svg', timestamp: '10:35 AM, Jan 15', location: 'Lat: 3.1234, Lng: 101.6789' },
      { url: '/placeholder.svg', timestamp: '10:40 AM, Jan 15', location: 'Lat: 3.1234, Lng: 101.6789' },
    ],
    notes: 'Extra cleaning required for kitchen area. All done well.'
  },
  {
    id: '2',
    property: 'KLCC Residences',
    unit: 'B-23-05',
    cleaningType: 'Regular Clean',
    team: 'Team Beta',
    assignee: { name: 'Siti', avatar: '' },
    scheduledTime: '11:00 AM',
    status: 'in_progress',
    photos: [
      { url: '/placeholder.svg', timestamp: '11:15 AM, Jan 15', location: 'Lat: 3.1580, Lng: 101.7116' },
    ],
  },
  {
    id: '3',
    property: 'Mont Kiara',
    unit: 'C-05-12',
    cleaningType: 'Move Out Clean',
    team: 'Team Alpha',
    assignee: { name: 'Kumar', avatar: '' },
    scheduledTime: '02:00 PM',
    status: 'pending',
  },
  {
    id: '4',
    property: 'Bangsar South',
    unit: 'D-18-08',
    cleaningType: 'Regular Clean',
    team: 'Team Gamma',
    assignee: { name: 'Ali', avatar: '' },
    scheduledTime: '03:30 PM',
    status: 'issue',
    notes: 'Unable to access unit. Key missing.'
  },
]

const getStatusInfo = (status: string) => {
  switch (status) {
    case 'completed':
      return { label: 'Completed', color: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle2 }
    case 'in_progress':
      return { label: 'In Progress', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: Clock }
    case 'pending':
      return { label: 'Pending', color: 'bg-blue-100 text-blue-800 border-blue-200', icon: Clock }
    case 'issue':
      return { label: 'Issue', color: 'bg-red-100 text-red-800 border-red-200', icon: AlertCircle }
    default:
      return { label: 'Unknown', color: 'bg-muted text-muted-foreground', icon: AlertCircle }
  }
}

export default function TasksPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const filteredTasks = mockTasks.filter(task => {
    const matchesSearch = task.property.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         task.unit.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         task.assignee.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesTab = activeTab === 'all' || task.status === activeTab
    return matchesSearch && matchesTab
  })

  const stats = {
    all: mockTasks.length,
    pending: mockTasks.filter(t => t.status === 'pending').length,
    in_progress: mockTasks.filter(t => t.status === 'in_progress').length,
    completed: mockTasks.filter(t => t.status === 'completed').length,
    issue: mockTasks.filter(t => t.status === 'issue').length,
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tasks Management</h1>
          <p className="text-muted-foreground">
            {stats.all} total tasks, {stats.in_progress} in progress
          </p>
        </div>
        <Button className="bg-primary text-primary-foreground">
          <Plus className="h-4 w-4 mr-2" />
          Create Task
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search tasks, properties, staff..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-background border-input"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="all">All ({stats.all})</TabsTrigger>
          <TabsTrigger value="pending">Pending ({stats.pending})</TabsTrigger>
          <TabsTrigger value="in_progress">In Progress ({stats.in_progress})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({stats.completed})</TabsTrigger>
          <TabsTrigger value="issue">Issues ({stats.issue})</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <div className="space-y-3">
            {filteredTasks.map((task) => {
              const statusInfo = getStatusInfo(task.status)
              return (
                <Card key={task.id} className="border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarImage src={task.assignee.avatar} />
                          <AvatarFallback className="bg-accent text-accent-foreground">
                            {task.assignee.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-foreground">{task.property}</p>
                            <Badge variant="outline" className="text-xs">{task.unit}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{task.cleaningType}</p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {task.team}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {task.scheduledTime}
                            </span>
                            {task.photos && task.photos.length > 0 && (
                              <span className="flex items-center gap-1 text-primary">
                                <Camera className="h-3 w-3" />
                                {task.photos.length} photos
                              </span>
                            )}
                          </div>
                          {task.notes && (
                            <p className="text-xs text-muted-foreground mt-2 bg-muted/50 p-2 rounded">
                              {task.notes}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={`text-xs ${statusInfo.color}`}>
                          {statusInfo.label}
                        </Badge>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => setSelectedTask(task)}
                              disabled={!task.photos || task.photos.length === 0}
                            >
                              <ImageIcon className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>Task Photos - {task.property} {task.unit}</DialogTitle>
                              <DialogDescription>
                                Photos uploaded by {task.assignee.name}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
                              {task.photos?.map((photo, index) => (
                                <div key={index} className="space-y-2">
                                  <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                                    <img src={photo.url} alt={`Photo ${index + 1}`} className="w-full h-full object-cover" />
                                  </div>
                                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {photo.timestamp}
                                    </span>
                                    <span className="flex items-center gap-1">
                                      <MapPin className="h-3 w-3" />
                                      {photo.location}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
