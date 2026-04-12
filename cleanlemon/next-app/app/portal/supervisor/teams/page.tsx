"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { 
  Users, 
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  MoreVertical,
  Star,
  Clock,
  CheckCircle2
} from 'lucide-react'

interface TeamMember {
  id: string
  name: string
  role: string
  phone: string
  email: string
  avatar: string
  status: 'active' | 'on_leave' | 'offline'
  todayTasks: number
  completedTasks: number
  rating: number
}

interface Team {
  id: string
  name: string
  leader: string
  members: TeamMember[]
  activeJobs: number
  completedToday: number
}

const mockTeams: Team[] = [
  {
    id: '1',
    name: 'Team Alpha',
    leader: 'Ahmad Bin Hassan',
    members: [
      { id: '1', name: 'Ahmad Bin Hassan', role: 'Team Leader', phone: '+60 12-345 6789', email: 'ahmad@cleanlemons.com', avatar: '', status: 'active', todayTasks: 5, completedTasks: 3, rating: 4.8 },
      { id: '2', name: 'Siti Aminah', role: 'Cleaner', phone: '+60 12-456 7890', email: 'siti@cleanlemons.com', avatar: '', status: 'active', todayTasks: 4, completedTasks: 2, rating: 4.5 },
      { id: '3', name: 'Kumar Rajan', role: 'Cleaner', phone: '+60 12-567 8901', email: 'kumar@cleanlemons.com', avatar: '', status: 'offline', todayTasks: 3, completedTasks: 1, rating: 4.2 },
    ],
    activeJobs: 3,
    completedToday: 5,
  },
  {
    id: '2',
    name: 'Team Beta',
    leader: 'Mei Ling Tan',
    members: [
      { id: '4', name: 'Mei Ling Tan', role: 'Team Leader', phone: '+60 12-678 9012', email: 'meiling@cleanlemons.com', avatar: '', status: 'active', todayTasks: 4, completedTasks: 4, rating: 4.9 },
      { id: '5', name: 'Ali Rahman', role: 'Cleaner', phone: '+60 12-789 0123', email: 'ali@cleanlemons.com', avatar: '', status: 'active', todayTasks: 3, completedTasks: 2, rating: 4.3 },
    ],
    activeJobs: 2,
    completedToday: 6,
  },
  {
    id: '3',
    name: 'Team Gamma',
    leader: 'Raj Kumar',
    members: [
      { id: '6', name: 'Raj Kumar', role: 'Team Leader', phone: '+60 12-890 1234', email: 'raj@cleanlemons.com', avatar: '', status: 'on_leave', todayTasks: 0, completedTasks: 0, rating: 4.6 },
      { id: '7', name: 'Nurul Huda', role: 'Cleaner', phone: '+60 12-901 2345', email: 'nurul@cleanlemons.com', avatar: '', status: 'active', todayTasks: 5, completedTasks: 3, rating: 4.4 },
      { id: '8', name: 'David Wong', role: 'Cleaner', phone: '+60 12-012 3456', email: 'david@cleanlemons.com', avatar: '', status: 'active', todayTasks: 4, completedTasks: 2, rating: 4.1 },
    ],
    activeJobs: 4,
    completedToday: 3,
  },
]

const getStatusColor = (status: string) => {
  switch (status) {
    case 'active':
      return 'bg-green-500'
    case 'on_leave':
      return 'bg-yellow-500'
    case 'offline':
      return 'bg-gray-400'
    default:
      return 'bg-gray-400'
  }
}

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'active':
      return 'Active'
    case 'on_leave':
      return 'On Leave'
    case 'offline':
      return 'Offline'
    default:
      return 'Unknown'
  }
}

export default function TeamsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)

  const filteredTeams = mockTeams.filter(team => 
    team.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    team.members.some(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const totalMembers = mockTeams.reduce((acc, team) => acc + team.members.length, 0)
  const activeMembers = mockTeams.reduce((acc, team) => 
    acc + team.members.filter(m => m.status === 'active').length, 0
  )

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Teams Management</h1>
          <p className="text-muted-foreground">
            {totalMembers} total staff, {activeMembers} active now
          </p>
        </div>
        <Button className="bg-primary text-primary-foreground">
          <Plus className="h-4 w-4 mr-2" />
          Add Team
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search teams or staff..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-background border-input"
        />
      </div>

      {/* Teams Grid */}
      <div className="grid gap-6">
        {filteredTeams.map((team) => (
          <Card key={team.id} className="border-border">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
                    <Users className="h-6 w-6 text-accent-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-foreground">{team.name}</CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Led by {team.leader}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{team.activeJobs}</p>
                    <p className="text-xs text-muted-foreground">Active</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-green-600">{team.completedToday}</p>
                    <p className="text-xs text-muted-foreground">Done</p>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 mt-4">
                {team.members.map((member) => (
                  <Dialog key={member.id}>
                    <DialogTrigger asChild>
                      <div 
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                        onClick={() => setSelectedMember(member)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={member.avatar} />
                              <AvatarFallback className="bg-secondary text-secondary-foreground">
                                {member.name.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background ${getStatusColor(member.status)}`} />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{member.name}</p>
                            <p className="text-xs text-muted-foreground">{member.role}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right text-sm">
                            <p className="text-foreground">{member.completedTasks}/{member.todayTasks}</p>
                            <p className="text-xs text-muted-foreground">Tasks</p>
                          </div>
                          <div className="flex items-center gap-1 text-sm">
                            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                            <span className="text-foreground">{member.rating}</span>
                          </div>
                        </div>
                      </div>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Staff Details</DialogTitle>
                        <DialogDescription>
                          View and manage staff information
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-6">
                        <div className="flex items-center gap-4">
                          <Avatar className="h-16 w-16">
                            <AvatarImage src={member.avatar} />
                            <AvatarFallback className="bg-secondary text-secondary-foreground text-xl">
                              {member.name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <h3 className="font-semibold text-foreground">{member.name}</h3>
                            <p className="text-sm text-muted-foreground">{member.role}</p>
                            <Badge className={`mt-1 ${member.status === 'active' ? 'bg-green-100 text-green-800' : member.status === 'on_leave' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>
                              {getStatusLabel(member.status)}
                            </Badge>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center gap-3 text-sm">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span className="text-foreground">{member.phone}</span>
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span className="text-foreground">{member.email}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
                          <div className="text-center">
                            <p className="text-xl font-bold text-foreground">{member.todayTasks}</p>
                            <p className="text-xs text-muted-foreground">Today Tasks</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xl font-bold text-green-600">{member.completedTasks}</p>
                            <p className="text-xs text-muted-foreground">Completed</p>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                              <span className="text-xl font-bold text-foreground">{member.rating}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">Rating</p>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button variant="outline" className="flex-1">
                            <Phone className="h-4 w-4 mr-2" />
                            Call
                          </Button>
                          <Button className="flex-1 bg-primary text-primary-foreground">
                            Assign Task
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
