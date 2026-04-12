"use client"

import { useState, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Camera, 
  MapPin, 
  Clock, 
  CheckCircle2,
  Upload,
  X,
  Image as ImageIcon
} from 'lucide-react'

interface AttendanceRecord {
  id: string
  type: 'in' | 'out'
  time: string
  date: string
  location: string
  photo?: string
}

const mockHistory: AttendanceRecord[] = [
  {
    id: '1',
    type: 'in',
    time: '08:30 AM',
    date: 'Today',
    location: 'Lat: 3.1234, Lng: 101.6789',
    photo: '/placeholder.svg'
  },
  {
    id: '2',
    type: 'out',
    time: '05:45 PM',
    date: 'Yesterday',
    location: 'Lat: 3.1234, Lng: 101.6789',
    photo: '/placeholder.svg'
  },
  {
    id: '3',
    type: 'in',
    time: '08:15 AM',
    date: 'Yesterday',
    location: 'Lat: 3.1234, Lng: 101.6789',
    photo: '/placeholder.svg'
  },
]

export default function AttendancePage() {
  const [isCheckedIn, setIsCheckedIn] = useState(false)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
  const [currentLocation, setCurrentLocation] = useState<string | null>(null)
  const [isLoadingLocation, setIsLoadingLocation] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleGetLocation = () => {
    setIsLoadingLocation(true)
    // Simulate getting location
    setTimeout(() => {
      setCurrentLocation('Lat: 3.1234, Lng: 101.6789')
      setIsLoadingLocation(false)
    }, 1500)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setSelfiePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = () => {
    if (!selfiePreview || !currentLocation) return
    
    setIsCheckedIn(!isCheckedIn)
    setSelfiePreview(null)
    setCurrentLocation(null)
  }

  const currentTime = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Attendance</h1>
        <p className="text-muted-foreground">Record your check in and check out</p>
      </div>

      {/* Current Status */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Current Status</CardTitle>
              <CardDescription>
                {isCheckedIn ? 'You are currently checked in' : 'You are not checked in'}
              </CardDescription>
            </div>
            <Badge className={isCheckedIn ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}>
              {isCheckedIn ? 'Working' : 'Off'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Selfie Upload */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Selfie Photo
            </label>
            <div className="relative">
              {selfiePreview ? (
                <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
                  <img 
                    src={selfiePreview} 
                    alt="Selfie preview" 
                    className="w-full h-full object-cover"
                  />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-2 right-2 h-8 w-8"
                    onClick={() => setSelfiePreview(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div 
                  className="aspect-video rounded-lg border-2 border-dashed border-border bg-muted/50 flex flex-col items-center justify-center cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-10 w-10 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Tap to take selfie</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Location
            </label>
            {currentLocation ? (
              <div className="p-3 rounded-lg bg-green-50 border border-green-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-800">{currentLocation}</span>
                </div>
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full border-border"
                onClick={handleGetLocation}
                disabled={isLoadingLocation}
              >
                <MapPin className="h-4 w-4 mr-2" />
                {isLoadingLocation ? 'Getting location...' : 'Get Current Location'}
              </Button>
            )}
          </div>

          {/* Current Time */}
          <div className="flex items-center justify-center gap-2 py-4 text-2xl font-bold text-foreground">
            <Clock className="h-6 w-6" />
            {currentTime}
          </div>

          {/* Submit Button */}
          <Button
            size="lg"
            className={`w-full ${
              isCheckedIn 
                ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' 
                : 'bg-primary hover:bg-primary/90 text-primary-foreground'
            }`}
            disabled={!selfiePreview || !currentLocation}
            onClick={handleSubmit}
          >
            {isCheckedIn ? 'Check Out' : 'Check In'}
          </Button>
        </CardContent>
      </Card>

      {/* History */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">Recent History</h2>
        <div className="space-y-3">
          {mockHistory.map((record) => (
            <Card key={record.id} className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {record.photo ? (
                      <img src={record.photo} alt="Attendance" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge className={record.type === 'in' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                        {record.type === 'in' ? 'Check In' : 'Check Out'}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{record.date}</span>
                    </div>
                    <p className="text-sm font-medium text-foreground mt-1">{record.time}</p>
                    <p className="text-xs text-muted-foreground truncate">{record.location}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
