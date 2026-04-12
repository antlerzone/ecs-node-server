"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  Users, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Calendar,
  MapPin,
  Search,
  Filter,
  MoreVertical,
  ChevronRight
} from 'lucide-react'

// Mock data
const mockStats = [
  { label: 'Total Staff', value: '24', icon: Users, color: 'bg-secondary' },
  { label: 'Completed Jobs', value: '18', icon: CheckCircle2, color: 'bg-green-100' },
  { label: 'In Progress', value: '5', icon: Clock, color: 'bg-accent' },
  { label: 'Pending', value: '3', icon: AlertCircle, color: 'bg-destructive/10' },
]

const mockTasks = [
  {
    id: '1',
    property: 'Sunway Velocity',
    unit: 'A-12-03',
    team: 'Team 1',
    status: 'Job Complete',
    time: '09:00 AM',
    staff: { name: 'Ahmad', avatar: '' },
  },
  {
    id: '2',
    property: 'KLCC Residences',
    unit: 'B-23-05',
    team: 'Team 2',
    status: 'Ready to Clean',
    time: '10:30 AM',
    staff: { name: 'Siti', avatar: '' },
  },
  {
    id: '3',
    property: 'Mont Kiara',
    unit: 'C-05-12',
    team: 'Team 3',
    status: 'Pending Check Out',
    time: '02:00 PM',
    staff: { name: 'Ali', avatar: '' },
  },
  {
    id: '4',
    property: 'Bangsar South',
    unit: 'D-18-08',
    team: 'Team 1',
    status: 'In Progress',
    time: '03:30 PM',
    staff: { name: 'Mei Ling', avatar: '' },
  },
]

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Job Complete':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'Ready to Clean':
      return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'Pending Check Out':
      return 'bg-red-100 text-red-800 border-red-200'
    case 'In Progress':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

export default function SupervisorDashboard() {
  const [searchQuery, setSearchQuery] = useState('')
  const [teamFilter, setTeamFilter] = useState('all')
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {today}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="border-border">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
          <Button size="sm" className="bg-primary text-primary-foreground">
            + New Task
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {mockStats.map((stat) => (
          <Card key={stat.label} className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="h-6 w-6 text-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search properties, units, staff..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-background border-input"
          />
        </div>
        <Select value={teamFilter} onValueChange={setTeamFilter}>
          <SelectTrigger className="w-full sm:w-[180px] border-input">
            <SelectValue placeholder="Select Team" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Teams</SelectItem>
            <SelectItem value="team1">Team 1</SelectItem>
            <SelectItem value="team2">Team 2</SelectItem>
            <SelectItem value="team3">Team 3</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tasks List */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-foreground">Today's Tasks</CardTitle>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              View All
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
          <CardDescription className="text-muted-foreground">
            {mockTasks.length} tasks scheduled for today
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {mockTasks.map((task) => (
              <div 
                key={task.id} 
                className="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarImage src={task.staff.avatar} />
                      <AvatarFallback className="bg-accent text-accent-foreground">
                        {task.staff.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-foreground truncate">
                          {task.property}
                        </p>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {task.unit}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {task.team}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {task.time}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={`text-xs ${getStatusColor(task.status)}`}>
                      {task.status}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
