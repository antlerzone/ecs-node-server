"use client"

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Clock,
  MapPin,
  Navigation,
  Users,
  CheckCircle2,
  Play,
  Phone,
  ChevronRight,
  Car,
  ArrowRight,
  Calendar,
} from 'lucide-react'

interface Trip {
  id: string
  type: 'pickup' | 'dropoff'
  status: 'pending' | 'in_progress' | 'completed'
  time: string
  property: string
  address: string
  lat: number
  lng: number
  passengers: Array<{ name: string; role: string; phone: string }>
  notes?: string
}

const allTrips: Trip[] = [
  {
    id: '1',
    type: 'pickup',
    status: 'completed',
    time: '07:30',
    property: 'Staff Quarters',
    address: 'Taman Desa, KL',
    lat: 3.1112,
    lng: 101.6841,
    passengers: [
      { name: 'Ahmad', role: 'Cleaner', phone: '+60123456789' },
      { name: 'Sarah', role: 'Cleaner', phone: '+60123456790' },
      { name: 'Raj', role: 'Supervisor', phone: '+60123456791' },
    ],
  },
  {
    id: '2',
    type: 'dropoff',
    status: 'in_progress',
    time: '08:00',
    property: 'Sunway Velocity',
    address: 'Jalan Cheras, KL',
    lat: 3.1282,
    lng: 101.7256,
    passengers: [
      { name: 'Ahmad', role: 'Cleaner', phone: '+60123456789' },
      { name: 'Sarah', role: 'Cleaner', phone: '+60123456790' },
    ],
    notes: 'Drop at main entrance near guardhouse',
  },
  {
    id: '3',
    type: 'dropoff',
    status: 'pending',
    time: '08:30',
    property: 'Eco Grandeur',
    address: 'Setia Alam, Selangor',
    lat: 3.1067,
    lng: 101.4456,
    passengers: [
      { name: 'Raj', role: 'Supervisor', phone: '+60123456791' },
    ],
  },
  {
    id: '4',
    type: 'pickup',
    status: 'pending',
    time: '17:00',
    property: 'Sunway Velocity',
    address: 'Jalan Cheras, KL',
    lat: 3.1282,
    lng: 101.7256,
    passengers: [
      { name: 'Ahmad', role: 'Cleaner', phone: '+60123456789' },
      { name: 'Sarah', role: 'Cleaner', phone: '+60123456790' },
    ],
  },
  {
    id: '5',
    type: 'pickup',
    status: 'pending',
    time: '17:30',
    property: 'Eco Grandeur',
    address: 'Setia Alam, Selangor',
    lat: 3.1067,
    lng: 101.4456,
    passengers: [
      { name: 'Raj', role: 'Supervisor', phone: '+60123456791' },
    ],
  },
  {
    id: '6',
    type: 'dropoff',
    status: 'pending',
    time: '18:00',
    property: 'Staff Quarters',
    address: 'Taman Desa, KL',
    lat: 3.1112,
    lng: 101.6841,
    passengers: [
      { name: 'Ahmad', role: 'Cleaner', phone: '+60123456789' },
      { name: 'Sarah', role: 'Cleaner', phone: '+60123456790' },
      { name: 'Raj', role: 'Supervisor', phone: '+60123456791' },
    ],
  },
]

export default function DriverTaskPage() {
  const [trips, setTrips] = useState<Trip[]>(allTrips)
  const [activeTab, setActiveTab] = useState('all')
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const handleStartTrip = (tripId: string) => {
    setTrips(prev => prev.map(t => 
      t.id === tripId ? { ...t, status: 'in_progress' as const } : t
    ))
    toast.success('Trip started')
    setDetailsOpen(false)
  }

  const handleCompleteTrip = (tripId: string) => {
    setTrips(prev => prev.map(t => 
      t.id === tripId ? { ...t, status: 'completed' as const } : t
    ))
    toast.success('Trip completed')
    setDetailsOpen(false)
  }

  const handleNavigate = (trip: Trip) => {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${trip.lat},${trip.lng}`, '_blank')
  }

  const handleCall = (phone: string) => {
    window.open(`tel:${phone}`, '_self')
  }

  const filteredTrips = trips.filter(trip => {
    if (activeTab === 'all') return true
    if (activeTab === 'pickup') return trip.type === 'pickup'
    if (activeTab === 'dropoff') return trip.type === 'dropoff'
    return trip.status === activeTab
  })

  const morningTrips = filteredTrips.filter(t => parseInt(t.time.split(':')[0]) < 12)
  const afternoonTrips = filteredTrips.filter(t => parseInt(t.time.split(':')[0]) >= 12)

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Tasks</h1>
        <p className="text-muted-foreground">Today&apos;s driving assignments</p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pickup">Pickups</TabsTrigger>
          <TabsTrigger value="dropoff">Dropoffs</TabsTrigger>
          <TabsTrigger value="completed">Done</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Morning Section */}
      {morningTrips.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Morning
          </h2>
          <div className="space-y-3">
            {morningTrips.map(trip => (
              <TripCard
                key={trip.id}
                trip={trip}
                onView={() => {
                  setSelectedTrip(trip)
                  setDetailsOpen(true)
                }}
                onStart={() => handleStartTrip(trip.id)}
                onComplete={() => handleCompleteTrip(trip.id)}
                onNavigate={() => handleNavigate(trip)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Afternoon Section */}
      {afternoonTrips.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Afternoon / Evening
          </h2>
          <div className="space-y-3">
            {afternoonTrips.map(trip => (
              <TripCard
                key={trip.id}
                trip={trip}
                onView={() => {
                  setSelectedTrip(trip)
                  setDetailsOpen(true)
                }}
                onStart={() => handleStartTrip(trip.id)}
                onComplete={() => handleCompleteTrip(trip.id)}
                onNavigate={() => handleNavigate(trip)}
              />
            ))}
          </div>
        </div>
      )}

      {filteredTrips.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center">
            <Car className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No trips in this category</p>
          </CardContent>
        </Card>
      )}

      {/* Trip Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-md">
          {selectedTrip && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={selectedTrip.type === 'pickup' ? 'default' : 'secondary'}>
                    {selectedTrip.type === 'pickup' ? 'Pick Up' : 'Drop Off'}
                  </Badge>
                  <Badge variant="outline">{selectedTrip.time}</Badge>
                </div>
                <DialogTitle>{selectedTrip.property}</DialogTitle>
                <DialogDescription className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {selectedTrip.address}
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                {selectedTrip.notes && (
                  <div className="bg-muted p-3 rounded-lg">
                    <p className="text-sm">{selectedTrip.notes}</p>
                  </div>
                )}

                <div>
                  <h4 className="font-medium mb-2">Passengers ({selectedTrip.passengers.length})</h4>
                  <div className="space-y-2">
                    {selectedTrip.passengers.map((p, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-muted rounded-lg">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>{p.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{p.role}</p>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => handleCall(p.phone)}>
                          <Phone className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" className="flex-1" onClick={() => handleNavigate(selectedTrip)}>
                  <Navigation className="h-4 w-4 mr-2" />
                  Navigate
                </Button>
                {selectedTrip.status === 'pending' && (
                  <Button className="flex-1" onClick={() => handleStartTrip(selectedTrip.id)}>
                    <Play className="h-4 w-4 mr-2" />
                    Start Trip
                  </Button>
                )}
                {selectedTrip.status === 'in_progress' && (
                  <Button className="flex-1" onClick={() => handleCompleteTrip(selectedTrip.id)}>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Complete
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TripCard({ 
  trip, 
  onView, 
  onStart, 
  onComplete, 
  onNavigate 
}: { 
  trip: Trip
  onView: () => void
  onStart: () => void
  onComplete: () => void
  onNavigate: () => void
}) {
  const statusColors = {
    pending: 'border-l-muted-foreground',
    in_progress: 'border-l-orange-500',
    completed: 'border-l-green-500',
  }

  return (
    <Card className={`border-l-4 ${statusColors[trip.status]}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1" onClick={onView}>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={trip.type === 'pickup' ? 'default' : 'secondary'} className="text-xs">
                {trip.type === 'pickup' ? 'Pick Up' : 'Drop Off'}
              </Badge>
              <span className="text-sm font-medium">{trip.time}</span>
              {trip.status === 'completed' && (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
            </div>
            <h3 className="font-semibold">{trip.property}</h3>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {trip.address}
            </p>
            <div className="flex items-center gap-1 mt-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{trip.passengers.length} passengers</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="ghost" size="icon" onClick={onNavigate}>
              <Navigation className="h-4 w-4" />
            </Button>
            {trip.status === 'pending' && (
              <Button size="sm" onClick={onStart}>
                <Play className="h-4 w-4" />
              </Button>
            )}
            {trip.status === 'in_progress' && (
              <Button size="sm" variant="default" onClick={onComplete}>
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
