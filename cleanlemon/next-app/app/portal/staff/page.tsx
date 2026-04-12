"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { 
  Camera, 
  MapPin, 
  Clock, 
  CheckCircle2,
  AlertCircle,
  Calendar,
  ChevronRight,
  Play,
  Square
} from 'lucide-react'

const mockTasks = [
  {
    id: '1',
    property: 'Sunway Velocity',
    unit: 'A-12-03',
    cleaningType: 'Deep Clean',
    status: 'pending',
    scheduledTime: '09:00 AM',
  },
  {
    id: '2',
    property: 'KLCC Residences',
    unit: 'B-23-05',
    cleaningType: 'Regular Clean',
    status: 'in_progress',
    scheduledTime: '11:00 AM',
    startTime: '10:45 AM',
  },
  {
    id: '3',
    property: 'Mont Kiara',
    unit: 'C-05-12',
    cleaningType: 'Move Out Clean',
    status: 'completed',
    scheduledTime: '02:00 PM',
    completedTime: '03:30 PM',
  },
]

const getStatusInfo = (status: string) => {
  switch (status) {
    case 'completed':
      return { label: 'Completed', color: 'bg-green-100 text-green-800', icon: CheckCircle2 }
    case 'in_progress':
      return { label: 'In Progress', color: 'bg-yellow-100 text-yellow-800', icon: Play }
    case 'pending':
      return { label: 'Pending', color: 'bg-blue-100 text-blue-800', icon: Clock }
    default:
      return { label: 'Unknown', color: 'bg-muted text-muted-foreground', icon: AlertCircle }
  }
}

export default function StaffDashboard() {
  const [isCheckedIn, setIsCheckedIn] = useState(false)
  const completedTasks = mockTasks.filter(t => t.status === 'completed').length
  const totalTasks = mockTasks.length
  const progress = (completedTasks / totalTasks) * 100

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Good Morning!</h1>
        <p className="text-muted-foreground flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          {today}
        </p>
      </div>

      {/* Check In/Out Card */}
      <Card className="border-border overflow-hidden">
        <div className={`p-6 ${isCheckedIn ? 'bg-green-50' : 'bg-accent/30'}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {isCheckedIn ? 'You are checked in' : 'Start your day'}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {isCheckedIn 
                  ? 'Tap to check out when done'
                  : 'Check in to start receiving tasks'
                }
              </p>
              {isCheckedIn && (
                <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    Checked in at 8:30 AM
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    Office HQ
                  </span>
                </div>
              )}
            </div>
            <Button 
              size="lg"
              onClick={() => setIsCheckedIn(!isCheckedIn)}
              className={`rounded-full h-16 w-16 ${
                isCheckedIn 
                  ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' 
                  : 'bg-primary hover:bg-primary/90 text-primary-foreground'
              }`}
            >
              {isCheckedIn ? (
                <Square className="h-6 w-6" />
              ) : (
                <Camera className="h-6 w-6" />
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Progress Card */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium text-foreground">Today's Progress</CardTitle>
          <CardDescription className="text-muted-foreground">
            {completedTasks} of {totalTasks} tasks completed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={progress} className="h-2" />
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="text-muted-foreground">{Math.round(progress)}% complete</span>
            <span className="text-foreground font-medium">
              {totalTasks - completedTasks} remaining
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tasks List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Today's Tasks</h2>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            View All
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <div className="space-y-3">
          {mockTasks.map((task) => {
            const statusInfo = getStatusInfo(task.status)
            return (
              <Card 
                key={task.id} 
                className="border-border hover:border-primary/50 transition-colors cursor-pointer"
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-foreground">{task.property}</p>
                        <Badge variant="outline" className="text-xs">{task.unit}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{task.cleaningType}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {task.scheduledTime}
                        </span>
                        {task.status === 'completed' && task.completedTime && (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="h-3 w-3" />
                            Done at {task.completedTime}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge className={`text-xs shrink-0 ${statusInfo.color}`}>
                      {statusInfo.label}
                    </Badge>
                  </div>
                  
                  {task.status === 'pending' && (
                    <Button 
                      size="sm" 
                      className="w-full mt-4 bg-primary text-primary-foreground"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Start Task
                    </Button>
                  )}
                  
                  {task.status === 'in_progress' && (
                    <Button 
                      size="sm" 
                      className="w-full mt-4 bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Camera className="h-4 w-4 mr-2" />
                      Upload Photos & Complete
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
