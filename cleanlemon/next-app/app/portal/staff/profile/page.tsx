"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { 
  User, 
  Phone,
  Mail,
  MapPin,
  Calendar,
  Star,
  Award,
  Clock,
  Bell,
  Shield,
  LogOut,
  Camera,
  Edit2,
  ChevronRight,
  CheckCircle2
} from 'lucide-react'

const mockProfile = {
  name: 'Ahmad Bin Hassan',
  email: 'ahmad@cleanlemons.com',
  phone: '+60 12-345 6789',
  address: '123 Jalan Ampang, 50450 Kuala Lumpur',
  joinDate: 'March 2022',
  team: 'Team Alpha',
  role: 'Senior Cleaner',
  avatar: '',
  stats: {
    totalTasks: 1250,
    rating: 4.8,
    yearsOfService: 2,
    awards: 5
  }
}

const achievements = [
  { id: '1', title: 'Perfect Attendance', description: 'No absences for 3 months', icon: Calendar, color: 'bg-green-100 text-green-700' },
  { id: '2', title: 'Top Performer', description: 'Highest ratings in December', icon: Star, color: 'bg-yellow-100 text-yellow-700' },
  { id: '3', title: 'Speed Champion', description: 'Fastest task completion', icon: Clock, color: 'bg-blue-100 text-blue-700' },
  { id: '4', title: 'Customer Favorite', description: '50+ 5-star reviews', icon: Award, color: 'bg-purple-100 text-purple-700' },
]

export default function ProfilePage() {
  const [notifications, setNotifications] = useState(true)
  const [locationTracking, setLocationTracking] = useState(true)

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Profile Header */}
      <Card className="border-border overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-primary to-primary/70" />
        <CardContent className="relative pt-0 pb-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div className="flex items-end gap-4 -mt-12">
              <div className="relative">
                <Avatar className="h-24 w-24 border-4 border-background">
                  <AvatarImage src={mockProfile.avatar} />
                  <AvatarFallback className="bg-accent text-accent-foreground text-2xl">
                    {mockProfile.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <Button 
                  size="icon" 
                  className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-primary text-primary-foreground"
                >
                  <Camera className="h-4 w-4" />
                </Button>
              </div>
              <div className="pb-2">
                <h1 className="text-xl font-bold text-foreground">{mockProfile.name}</h1>
                <p className="text-sm text-muted-foreground">{mockProfile.role} - {mockProfile.team}</p>
              </div>
            </div>
            <Button variant="outline" size="sm">
              <Edit2 className="h-4 w-4 mr-2" />
              Edit Profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border">
          <CardContent className="p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-accent mx-auto flex items-center justify-center mb-2">
              <CheckCircle2 className="h-5 w-5 text-accent-foreground" />
            </div>
            <p className="text-2xl font-bold text-foreground">{mockProfile.stats.totalTasks}</p>
            <p className="text-xs text-muted-foreground">Tasks Completed</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-yellow-100 mx-auto flex items-center justify-center mb-2">
              <Star className="h-5 w-5 text-yellow-700" />
            </div>
            <p className="text-2xl font-bold text-foreground">{mockProfile.stats.rating}</p>
            <p className="text-xs text-muted-foreground">Average Rating</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-secondary mx-auto flex items-center justify-center mb-2">
              <Calendar className="h-5 w-5 text-secondary-foreground" />
            </div>
            <p className="text-2xl font-bold text-foreground">{mockProfile.stats.yearsOfService}</p>
            <p className="text-xs text-muted-foreground">Years of Service</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-green-100 mx-auto flex items-center justify-center mb-2">
              <Award className="h-5 w-5 text-green-700" />
            </div>
            <p className="text-2xl font-bold text-foreground">{mockProfile.stats.awards}</p>
            <p className="text-xs text-muted-foreground">Awards Earned</p>
          </CardContent>
        </Card>
      </div>

      {/* Personal Information */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Personal Information</CardTitle>
          <CardDescription className="text-muted-foreground">
            Your contact and personal details
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-medium text-foreground">{mockProfile.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Phone className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="font-medium text-foreground">{mockProfile.phone}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Address</p>
              <p className="font-medium text-foreground">{mockProfile.address}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Joined</p>
              <p className="font-medium text-foreground">{mockProfile.joinDate}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Achievements */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Achievements</CardTitle>
          <CardDescription className="text-muted-foreground">
            Your earned badges and awards
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {achievements.map((achievement) => (
              <div 
                key={achievement.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
              >
                <div className={`w-10 h-10 rounded-full ${achievement.color} flex items-center justify-center shrink-0`}>
                  <achievement.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-foreground text-sm truncate">{achievement.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{achievement.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Settings */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Settings</CardTitle>
          <CardDescription className="text-muted-foreground">
            Manage your preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">Push Notifications</p>
                <p className="text-xs text-muted-foreground">Receive task and schedule updates</p>
              </div>
            </div>
            <Switch checked={notifications} onCheckedChange={setNotifications} />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">Location Tracking</p>
                <p className="text-xs text-muted-foreground">Allow GPS for attendance</p>
              </div>
            </div>
            <Switch checked={locationTracking} onCheckedChange={setLocationTracking} />
          </div>
          <Separator />
          <Button variant="ghost" className="w-full justify-between text-muted-foreground">
            <span className="flex items-center gap-3">
              <Shield className="h-5 w-5" />
              Change Password
            </span>
            <ChevronRight className="h-5 w-5" />
          </Button>
          <Button variant="ghost" className="w-full justify-between text-destructive hover:text-destructive hover:bg-destructive/10">
            <span className="flex items-center gap-3">
              <LogOut className="h-5 w-5" />
              Log Out
            </span>
            <ChevronRight className="h-5 w-5" />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
