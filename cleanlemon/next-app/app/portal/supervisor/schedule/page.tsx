"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Calendar } from '@/components/ui/calendar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin,
  Users,
  Plus,
  ChevronLeft,
  ChevronRight,
  Filter
} from 'lucide-react'

interface ScheduleItem {
  id: string
  property: string
  unit: string
  cleaningType: string
  team: string
  time: string
  duration: string
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
}

const mockSchedule: Record<string, ScheduleItem[]> = {
  '2024-01-15': [
    { id: '1', property: 'Sunway Velocity', unit: 'A-12-03', cleaningType: 'Deep Clean', team: 'Team Alpha', time: '09:00 AM', duration: '2 hours', status: 'completed' },
    { id: '2', property: 'KLCC Residences', unit: 'B-23-05', cleaningType: 'Regular Clean', team: 'Team Beta', time: '11:00 AM', duration: '1.5 hours', status: 'in_progress' },
    { id: '3', property: 'Mont Kiara', unit: 'C-05-12', cleaningType: 'Move Out Clean', team: 'Team Alpha', time: '02:00 PM', duration: '3 hours', status: 'scheduled' },
  ],
  '2024-01-16': [
    { id: '4', property: 'Bangsar South', unit: 'D-18-08', cleaningType: 'Regular Clean', team: 'Team Gamma', time: '10:00 AM', duration: '1 hour', status: 'scheduled' },
    { id: '5', property: 'Pavilion Residences', unit: 'E-30-01', cleaningType: 'Deep Clean', team: 'Team Beta', time: '01:00 PM', duration: '2.5 hours', status: 'scheduled' },
  ],
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'in_progress':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    case 'scheduled':
      return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'cancelled':
      return 'bg-red-100 text-red-800 border-red-200'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

export default function SchedulePage() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())
  const [teamFilter, setTeamFilter] = useState('all')

  const dateKey = selectedDate?.toISOString().split('T')[0] || ''
  const scheduleItems = mockSchedule[dateKey] || []

  const filteredItems = scheduleItems.filter(item => 
    teamFilter === 'all' || item.team.toLowerCase().includes(teamFilter.toLowerCase())
  )

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Schedule</h1>
          <p className="text-muted-foreground">
            Manage cleaning schedules and assignments
          </p>
        </div>
        <Button className="bg-primary text-primary-foreground">
          <Plus className="h-4 w-4 mr-2" />
          Add Schedule
        </Button>
      </div>

      <div className="grid md:grid-cols-[350px_1fr] gap-6">
        {/* Calendar */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium text-foreground">Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              className="rounded-md"
            />
          </CardContent>
        </Card>

        {/* Schedule List */}
        <div className="space-y-4">
          {/* Date Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">
                {selectedDate ? formatDate(selectedDate) : 'Select a date'}
              </h2>
            </div>
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className="w-[150px] border-input">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter Team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Teams</SelectItem>
                <SelectItem value="alpha">Team Alpha</SelectItem>
                <SelectItem value="beta">Team Beta</SelectItem>
                <SelectItem value="gamma">Team Gamma</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Schedule Items */}
          {filteredItems.length === 0 ? (
            <Card className="border-border">
              <CardContent className="p-8 text-center">
                <CalendarIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">No schedules for this date</p>
                <Button className="mt-4" variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Schedule
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <Card key={item.id} className="border-border hover:border-primary/50 transition-colors cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex gap-4">
                        {/* Time Block */}
                        <div className="flex flex-col items-center justify-center min-w-[60px] py-2 px-3 rounded-lg bg-accent/30">
                          <span className="text-sm font-semibold text-foreground">{item.time.split(' ')[0]}</span>
                          <span className="text-xs text-muted-foreground">{item.time.split(' ')[1]}</span>
                        </div>

                        {/* Details */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-foreground">{item.property}</p>
                            <Badge variant="outline" className="text-xs">{item.unit}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{item.cleaningType}</p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {item.team}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {item.duration}
                            </span>
                          </div>
                        </div>
                      </div>

                      <Badge className={`text-xs shrink-0 ${getStatusColor(item.status)}`}>
                        {item.status.charAt(0).toUpperCase() + item.status.slice(1).replace('_', ' ')}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
