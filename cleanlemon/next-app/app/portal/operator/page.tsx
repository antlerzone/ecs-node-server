"use client"

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Users,
  Building2,
  CheckCircle,
  Clock,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  Calendar,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { fetchOperatorDashboard, fetchOperatorDamageReports, type DamageReportItem } from '@/lib/cleanlemon-api'
import { useAuth } from '@/lib/auth-context'
import { useEffectiveOperatorId } from '@/lib/cleanlemon-effective-operator-id'

const statusColors: Record<string, { bg: string; text: string; label: string }> = {
  'completed': { bg: 'bg-green-100', text: 'text-green-800', label: 'Completed' },
  'in-progress': { bg: 'bg-purple-100', text: 'text-purple-800', label: 'In Progress' },
  'pending-checkout': { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Pending Checkout' },
  'ready-to-clean': { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Ready to Clean' },
}
const fallbackStatusColor = { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Unknown' }

export default function OperatorDashboard() {
  const { user } = useAuth()
  const operatorId = useEffectiveOperatorId(user)
  const [dashboard, setDashboard] = useState<any>(null)
  const [damageRecent, setDamageRecent] = useState<DamageReportItem[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorDashboard()
      if (cancelled) return
      if (r?.ok) setDashboard(r)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorDamageReports({ operatorId, limit: 5 })
      if (cancelled) return
      if (r?.ok && Array.isArray(r.items)) setDamageRecent(r.items)
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  const stats = useMemo(() => ([
    { label: 'Total Staff', value: String(dashboard?.stats?.totalStaff ?? 0), icon: Users, change: 'From backend', color: 'text-primary' },
    { label: 'Properties', value: String(dashboard?.stats?.properties ?? 0), icon: Building2, change: 'From backend', color: 'text-secondary-foreground' },
    { label: 'Completed Today', value: String(dashboard?.stats?.completedToday ?? 0), icon: CheckCircle, change: 'From backend', color: 'text-green-600' },
    { label: 'In Progress', value: String(dashboard?.stats?.inProgress ?? 0), icon: Clock, change: 'From backend', color: 'text-amber-600' },
  ]), [dashboard])

  const todayTasks = (dashboard?.todayTasks || []).map((t: any) => ({
    id: t.id,
    property: t.property || 'Property',
    status: t.status || 'in-progress',
    time: t.startTime && t.endTime ? `${t.startTime} - ${t.endTime}` : '-',
    team: t.team || '-',
  }))

  const topPerformers: Array<{ name: string; tasks: number; rating: number; avatar: string }> = []

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Good Morning!</h2>
          <p className="text-muted-foreground">Here&apos;s what&apos;s happening with your operations today.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/operator/schedule">
              <Calendar className="h-4 w-4 mr-2" />
              View Schedule
            </Link>
          </Button>
          <Button asChild>
            <Link href="/operator/property">
              <Building2 className="h-4 w-4 mr-2" />
              Add Property
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.change}</p>
                </div>
                <div className={`p-2 rounded-lg bg-muted`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {damageRecent.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Recent damage reports
              </CardTitle>
              <CardDescription>Property, submit by (staff), client</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/operator/damage">
                View all
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {damageRecent.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 p-3 bg-muted/50 rounded-lg text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{d.propertyName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {d.staffEmail || '—'} · {d.clientName || '—'}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {d.reportedAt
                      ? new Date(d.reportedAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Today's Tasks */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg">Today&apos;s Tasks</CardTitle>
              <CardDescription>{todayTasks.length} tasks scheduled for today</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/operator/schedule">
                View All
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {todayTasks.map((task: any) => {
                const statusUi = statusColors[task.status] || fallbackStatusColor
                return (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{task.property}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{task.time}</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">{task.team}</span>
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className={`${statusUi.bg} ${statusUi.text} ml-2`}
                  >
                    {statusColors[task.status]?.label || task.status || fallbackStatusColor.label}
                  </Badge>
                </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Top Performers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Top Performers
            </CardTitle>
            <CardDescription>This month&apos;s best cleaners</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topPerformers.map((performer, idx) => (
                <div key={performer.name} className="flex items-center gap-3">
                  <div className="relative">
                    <Avatar>
                      <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${performer.name}`} />
                      <AvatarFallback>{performer.avatar}</AvatarFallback>
                    </Avatar>
                    {idx === 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-accent-foreground text-xs rounded-full flex items-center justify-center font-bold">
                        1
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{performer.name}</p>
                    <p className="text-xs text-muted-foreground">{performer.tasks} tasks completed</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-foreground">{performer.rating}</p>
                    <p className="text-xs text-muted-foreground">rating</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Assistant Banner */}
      <Card className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-accent rounded-xl">
                <Sparkles className="h-6 w-6 text-accent-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">AI Task Scheduler</h3>
                <p className="text-primary-foreground/80 text-sm mt-1">
                  Let AI optimize your cleaning schedules. Set rules and let the system automatically assign teams based on location, priority, and workload.
                </p>
              </div>
            </div>
            <Button variant="secondary" className="whitespace-nowrap">
              Configure AI Rules
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" asChild>
          <Link href="/operator/contact">
            <Users className="h-5 w-5" />
            <span>Add Staff</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" asChild>
          <Link href="/operator/property">
            <Building2 className="h-5 w-5" />
            <span>Add Property</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" asChild>
          <Link href="/operator/agreement">
            <AlertCircle className="h-5 w-5" />
            <span>Send Offer</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" asChild>
          <Link href="/operator/kpi">
            <TrendingUp className="h-5 w-5" />
            <span>View KPIs</span>
          </Link>
        </Button>
      </div>

      {/* Monthly Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Monthly Progress</CardTitle>
          <CardDescription>Task completion rate for March 2024</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Tasks Completed</span>
                <span className="font-medium">423 / 450</span>
              </div>
              <Progress value={94} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">On-Time Rate</span>
                <span className="font-medium">89%</span>
              </div>
              <Progress value={89} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Customer Satisfaction</span>
                <span className="font-medium">96%</span>
              </div>
              <Progress value={96} className="h-2" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
