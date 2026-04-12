"use client"

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Play,
  Square,
  Clock,
  Camera,
  MapPin,
  CheckCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-context'
import { employeeCheckIn, employeeCheckOut, fetchEmployeeAttendance, fetchOperatorSettings, uploadEmployeeFileToOss } from '@/lib/cleanlemon-api'

interface GeoLocationState {
  lat: number
  lng: number
  address: string
}

interface CheckInProof {
  locationHash: string
  hashedAtIso: string
}

interface AttendanceRecord {
  dateKey: string
  workingInIso: string
  workingOutIso: string | null
}

interface AttendancePolicy {
  enabled: boolean
  scheduledInMinutes: number
  scheduledOutMinutes: number
  deductionPerLateMinute: number
}

export default function WorkingPage() {
  const UTC8_TIME_ZONE = 'Asia/Kuala_Lumpur'
  const { user } = useAuth()
  const operatorId = user?.operatorId || 'op_demo_001'
  const [isWorking, setIsWorking] = useState(false)
  const [workStartTime, setWorkStartTime] = useState<Date | null>(null)
  const [workEndTime, setWorkEndTime] = useState<Date | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [showCheckInDialog, setShowCheckInDialog] = useState(false)
  const [showCheckOutDialog, setShowCheckOutDialog] = useState(false)
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null)
  const [location, setLocation] = useState<GeoLocationState | null>(null)
  const [checkInLocation, setCheckInLocation] = useState<GeoLocationState | null>(null)
  const [checkInProof, setCheckInProof] = useState<CheckInProof | null>(null)
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [attendancePolicy, setAttendancePolicy] = useState<AttendancePolicy>({
    enabled: false,
    scheduledInMinutes: 8 * 60,
    scheduledOutMinutes: 18 * 60,
    deductionPerLateMinute: 1,
  })
  const [isCapturing, setIsCapturing] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isWorking && workStartTime) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - workStartTime.getTime()) / 1000))
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [isWorking, workStartTime])

  useEffect(() => {
    let cancelled = false

    const parseTimeToMinutes = (value: unknown, fallbackMinutes: number) => {
      if (typeof value !== 'string') return fallbackMinutes
      const [h, m] = value.split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) return fallbackMinutes
      return h * 60 + m
    }

    ;(async () => {
      const response = await fetchOperatorSettings(operatorId)
      if (!response?.ok || cancelled) return

      const settings = response.settings || {}
      const policy = settings.attendancePolicy || settings.attendanceLatePolicy || {}

      const enabled = Boolean(
        policy.enabled ||
          settings.attendanceLateEnabled ||
          settings.enableAttendanceDeduction
      )
      const scheduledInMinutes = parseTimeToMinutes(
        policy.workingInTime || settings.workingInTime,
        8 * 60
      )
      const scheduledOutMinutes = parseTimeToMinutes(
        policy.workingOutTime || settings.workingOutTime,
        18 * 60
      )
      const deductionPerLateMinute = Number(
        policy.deductionPerLateMinute ?? settings.deductionPerLateMinute ?? 1
      )

      setAttendancePolicy({
        enabled,
        scheduledInMinutes,
        scheduledOutMinutes,
        deductionPerLateMinute: Number.isFinite(deductionPerLateMinute)
          ? Math.max(0, deductionPerLateMinute)
          : 1,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [operatorId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const email = String(user?.email || '').trim()
      if (!email) return
      const r = await fetchEmployeeAttendance(email, operatorId)
      if (cancelled || !r?.ok || !Array.isArray(r.items)) return
      const records = r.items.map((item: any) => ({
        dateKey: String(item.dateKey || ''),
        workingInIso: String(item.workingInIso || ''),
        workingOutIso: item.workingOutIso ? String(item.workingOutIso) : null,
      }))
      setAttendanceRecords(records)
      const openRecord = records.find((x) => !x.workingOutIso)
      if (openRecord) {
        const start = new Date(openRecord.workingInIso)
        setWorkStartTime(start)
        setIsWorking(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email, operatorId])

  // Format time
  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const formatUtc8Time = (value: Date | null) =>
    value
      ? value.toLocaleTimeString('en-MY', {
          timeZone: UTC8_TIME_ZONE,
          hour: '2-digit',
          minute: '2-digit',
        })
      : '--:--'

  const formatUtc8Date = (value: Date | null) =>
    value
      ? value.toLocaleDateString('en-MY', {
          timeZone: UTC8_TIME_ZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
      : '--/--/----'

  const getUtc8DateKey = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: UTC8_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value)

  const getUtc8MinutesOfDay = (value: Date) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: UTC8_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(value)

    const hour = Number(parts.find((item) => item.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find((item) => item.type === 'minute')?.value ?? 0)
    return hour * 60 + minute
  }

  const getAttendanceLateInfo = (record: AttendanceRecord) => {
    if (!attendancePolicy.enabled) {
      return {
        isLateIn: false,
        isLateOut: false,
        deduction: 0,
      }
    }

    const workingIn = new Date(record.workingInIso)
    const inMinutes = getUtc8MinutesOfDay(workingIn)
    const lateInMinutes = Math.max(0, inMinutes - attendancePolicy.scheduledInMinutes)

    let lateOutMinutes = 0
    if (record.workingOutIso) {
      const workingOut = new Date(record.workingOutIso)
      const outMinutes = getUtc8MinutesOfDay(workingOut)
      lateOutMinutes = Math.max(0, outMinutes - attendancePolicy.scheduledOutMinutes)
    }

    const totalLateMinutes = lateInMinutes + lateOutMinutes
    const deduction = totalLateMinutes * attendancePolicy.deductionPerLateMinute

    return {
      isLateIn: lateInMinutes > 0,
      isLateOut: lateOutMinutes > 0,
      deduction,
    }
  }

  const hashLocationAndTime = async (locationValue: GeoLocationState, timeIso: string) => {
    const raw = `${locationValue.lat.toFixed(6)},${locationValue.lng.toFixed(6)}|${timeIso}`
    const encoded = new TextEncoder().encode(raw)
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  const mapEmbedUrl = (pos: GeoLocationState | null) => {
    if (!pos) return ''
    const delta = 0.01
    const left = pos.lng - delta
    const right = pos.lng + delta
    const top = pos.lat + delta
    const bottom = pos.lat - delta
    return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${pos.lat}%2C${pos.lng}`
  }

  // Get location
  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            address: 'Loading address...',
          })
          // In production, use reverse geocoding to get address
          setTimeout(() => {
            setLocation((prev) => prev ? { ...prev, address: '123 Jalan Bersih, Petaling Jaya' } : null)
          }, 1000)
        },
        (error) => {
          toast.error('Unable to get location. Please enable GPS.')
        }
      )
    }
  }

  // Camera handling
  const startCamera = async () => {
    setIsCapturing(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' } 
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch (error) {
      toast.error('Unable to access camera')
      setIsCapturing(false)
    }
  }

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current
      const video = videoRef.current
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(video, 0, 0)
        const dataUrl = canvas.toDataURL('image/jpeg')
        setSelfieUrl(dataUrl)
        
        // Stop camera
        const stream = video.srcObject as MediaStream
        stream?.getTracks().forEach(track => track.stop())
        setIsCapturing(false)
      }
    }
  }

  const handleStartWork = () => {
    setSelfieUrl(null)
    setLocation(null)
    setShowCheckInDialog(true)
    getCurrentLocation()
  }

  const handleEndWork = () => {
    setSelfieUrl(null)
    // End work must use the locked check-in location.
    setLocation(checkInLocation)
    setShowCheckOutDialog(true)
    if (!checkInLocation) {
      getCurrentLocation()
    }
  }

  const confirmCheckIn = async () => {
    if (!selfieUrl) {
      toast.error('Please take a selfie')
      return
    }
    if (!location) {
      toast.error('Please wait for location')
      return
    }

    const checkInAt = new Date()
    const locationHash = await hashLocationAndTime(location, checkInAt.toISOString())
    let uploadedSelfieUrl = ''
    if (selfieUrl) {
      const blob = await (await fetch(selfieUrl)).blob()
      const file = new File([blob], `checkin-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const up = await uploadEmployeeFileToOss(file, String(operatorId || 'op_demo_001'))
      if (up?.ok && up.url) uploadedSelfieUrl = up.url
    }
    const dateKey = getUtc8DateKey(checkInAt)
    const saveR = await employeeCheckIn({
      email: user?.email || '',
      operatorId,
      dateKey,
      workingInIso: checkInAt.toISOString(),
      checkinLocation: location,
      checkinPhotoUrl: uploadedSelfieUrl || null,
      checkinProofHash: locationHash,
    })
    if (!saveR?.ok) {
      toast.error(`Check in failed (${saveR?.reason || 'unknown'})`)
      return
    }

    setIsWorking(true)
    setWorkStartTime(checkInAt)
    setWorkEndTime(null)
    setCheckInLocation(location)
    setCheckInProof({
      locationHash,
      hashedAtIso: checkInAt.toISOString(),
    })
    setAttendanceRecords((prev) => {
      const existingIndex = prev.findIndex((item) => item.dateKey === dateKey)
      const next = [...prev]
      if (existingIndex >= 0) {
        next[existingIndex] = {
          ...next[existingIndex],
          workingInIso: checkInAt.toISOString(),
          workingOutIso: null,
        }
        return next
      }
      return [
        {
          dateKey,
          workingInIso: checkInAt.toISOString(),
          workingOutIso: null,
        },
        ...next,
      ]
    })
    setShowCheckInDialog(false)
    toast.success('Work started with selfie + location hash + time!')
  }

  const confirmCheckOut = async () => {
    if (!selfieUrl) {
      toast.error('Please take a selfie')
      return
    }
    
    const checkOutAt = new Date()
    let uploadedSelfieUrl = ''
    if (selfieUrl) {
      const blob = await (await fetch(selfieUrl)).blob()
      const file = new File([blob], `checkout-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const up = await uploadEmployeeFileToOss(file, String(operatorId || 'op_demo_001'))
      if (up?.ok && up.url) uploadedSelfieUrl = up.url
    }
    const dateKey = getUtc8DateKey(workStartTime ?? checkOutAt)
    const saveR = await employeeCheckOut({
      email: user?.email || '',
      operatorId,
      dateKey,
      workingOutIso: checkOutAt.toISOString(),
      checkoutLocation: location,
      checkoutPhotoUrl: uploadedSelfieUrl || null,
    })
    if (!saveR?.ok) {
      toast.error(`Check out failed (${saveR?.reason || 'unknown'})`)
      return
    }
    setIsWorking(false)
    setWorkEndTime(checkOutAt)
    setAttendanceRecords((prev) => {
      const currentDateKey = getUtc8DateKey(workStartTime ?? checkOutAt)
      const currentIndex = prev.findIndex((item) => item.dateKey === currentDateKey)
      const firstOpenIndex = prev.findIndex((item) => !item.workingOutIso)
      const targetIndex = currentIndex >= 0 ? currentIndex : firstOpenIndex

      if (targetIndex === -1) {
        return [
          {
            dateKey: currentDateKey,
            workingInIso: (workStartTime ?? checkOutAt).toISOString(),
            workingOutIso: checkOutAt.toISOString(),
          },
          ...prev,
        ]
      }

      const next = [...prev]
      next[targetIndex] = {
        ...next[targetIndex],
        workingOutIso: checkOutAt.toISOString(),
      }
      return next
    })
    setShowCheckOutDialog(false)
    toast.success('Work ended. Great job today!')
  }

  return (
    <div className="space-y-6">
      {/* Main Clock Card */}
      <Card className={`${isWorking ? 'border-green-500' : ''}`}>
        <CardContent className="p-8">
          <div className="flex flex-col items-center text-center">
            <div className={`w-32 h-32 rounded-full flex items-center justify-center mb-6 ${
              isWorking ? 'bg-green-100' : 'bg-muted'
            }`}>
              {isWorking ? (
                <Clock className="h-16 w-16 text-green-600" />
              ) : (
                <Play className="h-16 w-16 text-muted-foreground" />
              )}
            </div>
            
            <h2 className="text-4xl font-bold font-mono mb-2">
              {formatTime(elapsedTime)}
            </h2>
            
            <Badge variant={isWorking ? 'default' : 'secondary'} className={`mb-6 ${
              isWorking ? 'bg-green-600' : ''
            }`}>
              {isWorking ? 'Working' : 'Not Working'}
            </Badge>

            {workStartTime && (
              <p className="text-muted-foreground mb-6">
                Started at {formatUtc8Time(workStartTime)} (UTC+8)
              </p>
            )}

            <Button 
              size="lg" 
              className={`w-full max-w-xs ${isWorking ? 'bg-destructive hover:bg-destructive/90' : ''}`}
              onClick={isWorking ? handleEndWork : handleStartWork}
            >
              {isWorking ? (
                <>
                  <Square className="h-5 w-5 mr-2" />
                  End Work
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 mr-2" />
                  Start Work
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Start Time</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-mono font-bold">{formatUtc8Time(workStartTime)}</p>
            <p className="text-xs text-muted-foreground mt-1">UTC+8</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">End Time</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-mono font-bold">{formatUtc8Time(workEndTime)}</p>
            <p className="text-xs text-muted-foreground mt-1">UTC+8</p>
          </CardContent>
        </Card>
      </div>

      {checkInProof && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Check-In Verification</CardTitle>
            <CardDescription>Selfie captured + location hash + timestamp</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Hash Time: {new Date(checkInProof.hashedAtIso).toLocaleString('en-MY', { timeZone: UTC8_TIME_ZONE })} (UTC+8)
            </p>
            <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs break-all">
              {checkInProof.locationHash}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attendance Records */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">My Attendance Records</CardTitle>
          <CardDescription>All times shown in UTC+8</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Date</th>
                  <th className="text-left font-medium px-4 py-3">Working In</th>
                  <th className="text-left font-medium px-4 py-3">Working Out</th>
                  <th className="text-left font-medium px-4 py-3">Deduction</th>
                </tr>
              </thead>
              <tbody>
                {attendanceRecords.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-muted-foreground" colSpan={4}>
                      No check-in record yet.
                    </td>
                  </tr>
                ) : (
                  attendanceRecords.map((record) => {
                    const lateInfo = getAttendanceLateInfo(record)

                    return (
                      <tr key={record.dateKey} className="border-t">
                        <td className="px-4 py-3 font-mono">
                          {formatUtc8Date(new Date(record.workingInIso))}
                        </td>
                        <td className={`px-4 py-3 font-mono ${lateInfo.isLateIn ? 'text-red-600 font-semibold' : ''}`}>
                          {formatUtc8Time(new Date(record.workingInIso))}
                        </td>
                        <td className={`px-4 py-3 font-mono ${lateInfo.isLateOut ? 'text-red-600 font-semibold' : ''}`}>
                          {record.workingOutIso ? formatUtc8Time(new Date(record.workingOutIso)) : '--:--'}
                        </td>
                        <td className={`px-4 py-3 font-mono ${lateInfo.deduction > 0 ? 'text-red-600 font-semibold' : ''}`}>
                          RM {lateInfo.deduction.toFixed(2)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Current Session (UTC+8) */}
      {(workStartTime || workEndTime) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Current Session</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Working In (UTC+8)</p>
              <p className="text-xl font-mono font-bold">{formatUtc8Time(workStartTime)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Working Out (UTC+8)</p>
              <p className="text-xl font-mono font-bold">{formatUtc8Time(workEndTime)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Check In Dialog */}
      <Dialog open={showCheckInDialog} onOpenChange={setShowCheckInDialog}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Start Work</DialogTitle>
            <DialogDescription>
              Take a selfie and confirm your location to check in
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Camera Section */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Selfie</label>
              <div className="aspect-video bg-muted rounded-lg overflow-hidden relative">
                {isCapturing ? (
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="w-full h-full object-cover"
                  />
                ) : selfieUrl ? (
                  <img src={selfieUrl} alt="Selfie" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Camera className="h-12 w-12 text-muted-foreground" />
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex gap-2">
                {!isCapturing && !selfieUrl && (
                  <Button onClick={startCamera} className="flex-1">
                    <Camera className="h-4 w-4 mr-2" />
                    Open Camera
                  </Button>
                )}
                {isCapturing && (
                  <Button onClick={capturePhoto} className="flex-1">
                    <Camera className="h-4 w-4 mr-2" />
                    Capture
                  </Button>
                )}
                {selfieUrl && (
                  <Button variant="outline" onClick={() => {
                    setSelfieUrl(null)
                    startCamera()
                  }} className="flex-1">
                    Retake
                  </Button>
                )}
              </div>
            </div>

            {/* Location Section */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Location</label>
              <div className="p-3 bg-muted rounded-lg">
                {location ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <MapPin className="h-5 w-5 text-green-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">{location.address}</p>
                        <p className="text-xs text-muted-foreground">
                          {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                        </p>
                        <p className="text-xs text-amber-600 mt-1">
                          Location locked by system (employee cannot change location)
                        </p>
                      </div>
                    </div>
                    <div className="w-full h-64 rounded-lg overflow-hidden border bg-background">
                      <iframe
                        title="Check in location map"
                        src={mapEmbedUrl(location)}
                        className="w-full h-full pointer-events-none"
                        loading="lazy"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                    <span className="text-sm">Getting location...</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCheckInDialog(false)}>
              Cancel
            </Button>
            <Button onClick={confirmCheckIn} disabled={!selfieUrl || !location}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Confirm Check In
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check Out Dialog */}
      <Dialog open={showCheckOutDialog} onOpenChange={setShowCheckOutDialog}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>End Work</DialogTitle>
            <DialogDescription>
              Take a selfie to confirm check out
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-2xl font-bold font-mono">{formatTime(elapsedTime)}</p>
              <p className="text-sm text-muted-foreground">Total working time</p>
            </div>

            {/* Camera Section */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Selfie</label>
              <div className="aspect-video bg-muted rounded-lg overflow-hidden relative">
                {isCapturing ? (
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="w-full h-full object-cover"
                  />
                ) : selfieUrl ? (
                  <img src={selfieUrl} alt="Selfie" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Camera className="h-12 w-12 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                {!isCapturing && !selfieUrl && (
                  <Button onClick={startCamera} className="flex-1">
                    <Camera className="h-4 w-4 mr-2" />
                    Open Camera
                  </Button>
                )}
                {isCapturing && (
                  <Button onClick={capturePhoto} className="flex-1">
                    <Camera className="h-4 w-4 mr-2" />
                    Capture
                  </Button>
                )}
                {selfieUrl && (
                  <Button variant="outline" onClick={() => {
                    setSelfieUrl(null)
                    startCamera()
                  }} className="flex-1">
                    Retake
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Locked Work Location</label>
              <div className="p-3 bg-muted rounded-lg">
                {location ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <MapPin className="h-5 w-5 text-green-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">{location.address}</p>
                        <p className="text-xs text-muted-foreground">
                          {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                        </p>
                        <p className="text-xs text-amber-600 mt-1">
                          End work uses the same locked location from start work
                        </p>
                      </div>
                    </div>
                    <div className="w-full h-64 rounded-lg overflow-hidden border bg-background">
                      <iframe
                        title="Check out location map"
                        src={mapEmbedUrl(location)}
                        className="w-full h-full pointer-events-none"
                        loading="lazy"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                    <span className="text-sm">Getting location...</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCheckOutDialog(false)}>
              Cancel
            </Button>
            <Button onClick={confirmCheckOut} disabled={!selfieUrl} variant="destructive">
              <Square className="h-4 w-4 mr-2" />
              Confirm Check Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
