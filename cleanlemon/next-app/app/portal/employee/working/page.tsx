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
import { employeeCheckIn, employeeCheckOut, fetchEmployeeAttendance, uploadEmployeeFileToOss } from '@/lib/cleanlemon-api'
import { EmployeeWorkingPayrollTable } from '@/components/portal/employee/employee-working-payroll-table'

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

export default function WorkingPage() {
  const UTC8_TIME_ZONE = 'Asia/Kuala_Lumpur'
  const { user } = useAuth()
  const operatorId = user?.operatorId || 'op_demo_001'
  const [isWorking, setIsWorking] = useState(false)
  const [workStartTime, setWorkStartTime] = useState<Date | null>(null)
  const [workEndTime, setWorkEndTime] = useState<Date | null>(null)
  const [showCheckInDialog, setShowCheckInDialog] = useState(false)
  const [showCheckOutDialog, setShowCheckOutDialog] = useState(false)
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null)
  const [location, setLocation] = useState<GeoLocationState | null>(null)
  const [checkInLocation, setCheckInLocation] = useState<GeoLocationState | null>(null)
  const [checkInProof, setCheckInProof] = useState<CheckInProof | null>(null)
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [isCapturing, setIsCapturing] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Clock in, selfie & GPS for attendance</p>
        <Badge
          variant={isWorking ? 'default' : 'secondary'}
          className={`shrink-0 h-7 px-2.5 text-[11px] font-medium ${isWorking ? 'bg-green-600 hover:bg-green-600' : ''}`}
        >
          <Clock className="mr-1 h-3 w-3" aria-hidden />
          {isWorking ? 'On duty' : 'Off duty'}
        </Badge>
      </div>

      <Card className={isWorking ? 'border-green-500' : ''}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                  isWorking ? 'bg-green-100' : 'bg-muted'
                }`}
              >
                {isWorking ? (
                  <Clock className="h-5 w-5 text-green-600" />
                ) : (
                  <Play className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 space-y-1 text-left">
                <Badge variant={isWorking ? 'default' : 'secondary'} className={isWorking ? 'bg-green-600' : ''}>
                  {isWorking ? 'Working' : 'Not working'}
                </Badge>
                <p className="text-sm text-muted-foreground">
                  Start{' '}
                  <span className="font-mono text-foreground">{formatUtc8Time(workStartTime)}</span>
                  {workEndTime && !isWorking ? (
                    <>
                      {' '}
                      · End <span className="font-mono text-foreground">{formatUtc8Time(workEndTime)}</span>
                    </>
                  ) : null}
                  <span className="text-muted-foreground"> · UTC+8</span>
                </p>
              </div>
            </div>
            <Button
              className={`w-full shrink-0 sm:w-auto ${isWorking ? 'bg-destructive hover:bg-destructive/90' : ''}`}
              onClick={isWorking ? handleEndWork : handleStartWork}
            >
              {isWorking ? (
                <>
                  <Square className="mr-2 h-4 w-4" />
                  End work
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Start work
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">My attendance records</CardTitle>
          <CardDescription>Times in UTC+8</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 md:hidden">
            {attendanceRecords.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No check-in record yet.</p>
            ) : (
              attendanceRecords.map((record) => (
                <div key={record.dateKey} className="rounded-xl border bg-card p-3 text-sm shadow-sm">
                  <p className="font-medium text-foreground">{formatUtc8Date(new Date(record.workingInIso))}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                    <span>
                      In <span className="font-mono text-foreground">{formatUtc8Time(new Date(record.workingInIso))}</span>
                    </span>
                    <span>
                      Out{' '}
                      <span className="font-mono text-foreground">
                        {record.workingOutIso ? formatUtc8Time(new Date(record.workingOutIso)) : '—'}
                      </span>
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">In</th>
                  <th className="px-3 py-2 text-left font-medium">Out</th>
                </tr>
              </thead>
              <tbody>
                {attendanceRecords.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-muted-foreground" colSpan={3}>
                      No check-in record yet.
                    </td>
                  </tr>
                ) : (
                  attendanceRecords.map((record) => (
                    <tr key={record.dateKey} className="border-t">
                      <td className="px-3 py-2 font-mono">{formatUtc8Date(new Date(record.workingInIso))}</td>
                      <td className="px-3 py-2 font-mono">{formatUtc8Time(new Date(record.workingInIso))}</td>
                      <td className="px-3 py-2 font-mono">
                        {record.workingOutIso ? formatUtc8Time(new Date(record.workingOutIso)) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {user?.email ? (
        <EmployeeWorkingPayrollTable
          operatorId={operatorId}
          email={user.email}
          attendanceRecords={attendanceRecords}
        />
      ) : null}

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
