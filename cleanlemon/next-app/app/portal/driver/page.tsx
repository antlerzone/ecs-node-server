"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { toast } from 'sonner'
import {
  Clock,
  MapPin,
  Navigation,
  Users,
  Truck,
  CheckCircle2,
  Play,
  Phone,
  Calendar,
  TrendingUp,
} from 'lucide-react'

interface Trip {
  id: string
  type: 'pickup' | 'dropoff'
  status: 'pending' | 'in_progress' | 'completed'
  time: string
  property: string
  address: string
  passengers: Array<{ name: string; role: string }>
}

const todayTrips: Trip[] = [
  {
    id: '1',
    type: 'pickup',
    status: 'completed',
    time: '07:30',
    property: 'Staff Quarters',
    address: 'Taman Desa, KL',
    passengers: [
      { name: 'Ahmad', role: 'Cleaner' },
      { name: 'Sarah', role: 'Cleaner' },
      { name: 'Raj', role: 'Supervisor' },
    ],
  },
  {
    id: '2',
    type: 'dropoff',
    status: 'in_progress',
    time: '08:00',
    property: 'Sunway Velocity',
    address: 'Jalan Cheras, KL',
    passengers: [
      { name: 'Ahmad', role: 'Cleaner' },
      { name: 'Sarah', role: 'Cleaner' },
    ],
  },
  {
    id: '3',
    type: 'dropoff',
    status: 'pending',
    time: '08:30',
    property: 'Eco Grandeur',
    address: 'Setia Alam, Selangor',
    passengers: [
      { name: 'Raj', role: 'Supervisor' },
    ],
  },
  {
    id: '4',
    type: 'pickup',
    status: 'pending',
    time: '17:00',
    property: 'Sunway Velocity',
    address: 'Jalan Cheras, KL',
    passengers: [
      { name: 'Ahmad', role: 'Cleaner' },
      { name: 'Sarah', role: 'Cleaner' },
    ],
  },
]

export default function DriverDashboardPage() {
  const [isOnDuty, setIsOnDuty] = useState(true)
  const [trips, setTrips] = useState<Trip[]>(todayTrips)

  const completedTrips = trips.filter(t => t.status === 'completed').length
  const totalTrips = trips.length
  const currentTrip = trips.find(t => t.status === 'in_progress')
  const nextTrip = trips.find(t => t.status === 'pending')

  const handleStartTrip = (tripId: string) => {
    setTrips(prev => prev.map(t => 
      t.id === tripId ? { ...t, status: 'in_progress' as const } : t
    ))
    toast.success('Trip started - Navigate to destination')
  }

  const handleCompleteTrip = (tripId: string) => {
    setTrips(prev => prev.map(t => 
      t.id === tripId ? { ...t, status: 'completed' as const } : t
    ))
    toast.success('Trip completed')
  }

  const handleToggleDuty = () => {
    setIsOnDuty(!isOnDuty)
    toast.success(isOnDuty ? 'You are now off duty' : 'You are now on duty')
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Good Morning!</h1>
          <p className="text-muted-foreground">Today&apos;s driving schedule</p>
        </div>
        <Button
          variant={isOnDuty ? 'default' : 'outline'}
          onClick={handleToggleDuty}
          className={isOnDuty ? 'bg-green-600 hover:bg-green-700' : ''}
        >
          <Truck className="h-4 w-4 mr-2" />
          {isOnDuty ? 'On Duty' : 'Off Duty'}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Today&apos;s Trips</p>
                <p className="text-xl font-bold">{totalTrips}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-xl font-bold text-green-600">{completedTrips}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Passengers</p>
                <p className="text-xl font-bold">6</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/20">
                <TrendingUp className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">KPI Score</p>
                <p className="text-xl font-bold">92%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Current Trip */}
      {currentTrip && (
        <Card className="border-primary">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge className="bg-orange-100 text-orange-700">
                <Play className="h-3 w-3 mr-1" />
                In Progress
              </Badge>
              <span className="text-sm font-medium">{currentTrip.time}</span>
            </div>
            <CardTitle className="text-lg">
              {currentTrip.type === 'pickup' ? 'Pick Up' : 'Drop Off'} - {currentTrip.property}
            </CardTitle>
            <CardDescription className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {currentTrip.address}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Passengers ({currentTrip.passengers.length})</p>
              <div className="flex flex-wrap gap-2">
                {currentTrip.passengers.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-muted rounded-full px-3 py-1">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">{p.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1">
                <Navigation className="h-4 w-4 mr-2" />
                Navigate
              </Button>
              <Button className="flex-1" onClick={() => handleCompleteTrip(currentTrip.id)}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Complete
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Next Trip */}
      {nextTrip && !currentTrip && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge variant="outline">
                <Clock className="h-3 w-3 mr-1" />
                Next Up
              </Badge>
              <span className="text-sm font-medium">{nextTrip.time}</span>
            </div>
            <CardTitle className="text-lg">
              {nextTrip.type === 'pickup' ? 'Pick Up' : 'Drop Off'} - {nextTrip.property}
            </CardTitle>
            <CardDescription className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {nextTrip.address}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => handleStartTrip(nextTrip.id)}>
              <Play className="h-4 w-4 mr-2" />
              Start Trip
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Today's Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {trips.map((trip, idx) => (
              <div
                key={trip.id}
                className={`flex items-center gap-4 p-3 rounded-lg ${
                  trip.status === 'completed' ? 'bg-green-50 border border-green-200' :
                  trip.status === 'in_progress' ? 'bg-orange-50 border border-orange-200' :
                  'bg-muted'
                }`}
              >
                <div className="text-center min-w-[60px]">
                  <p className="font-semibold">{trip.time}</p>
                  <Badge variant="outline" className="text-xs">
                    {trip.type === 'pickup' ? 'Pick Up' : 'Drop Off'}
                  </Badge>
                </div>
                <div className="flex-1">
                  <p className="font-medium">{trip.property}</p>
                  <p className="text-sm text-muted-foreground">{trip.passengers.length} passengers</p>
                </div>
                <div>
                  {trip.status === 'completed' && (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  )}
                  {trip.status === 'in_progress' && (
                    <Badge className="bg-orange-100 text-orange-700">Active</Badge>
                  )}
                  {trip.status === 'pending' && (
                    <Badge variant="outline">Pending</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
