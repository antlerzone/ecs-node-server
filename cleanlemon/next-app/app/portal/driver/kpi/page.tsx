"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Target,
  TrendingUp,
  Clock,
  Star,
  CheckCircle2,
  Fuel,
  Car,
  Award,
} from 'lucide-react'

const driverKPIs = [
  { name: 'On-Time Arrival', current: 96, target: 95, unit: '%', trend: 'up', trendValue: 3 },
  { name: 'Trip Completion Rate', current: 100, target: 98, unit: '%', trend: 'stable', trendValue: 0 },
  { name: 'Passenger Rating', current: 4.8, target: 4.5, unit: '/5', trend: 'up', trendValue: 0.1 },
  { name: 'Fuel Efficiency', current: 12, target: 10, unit: 'km/L', trend: 'up', trendValue: 1 },
  { name: 'Safety Score', current: 98, target: 95, unit: '%', trend: 'stable', trendValue: 0 },
]

const monthlyHistory = [
  { month: 'Jan 2024', score: 90, trips: 156, onTime: '94%' },
  { month: 'Feb 2024', score: 93, trips: 148, onTime: '95%' },
  { month: 'Mar 2024', score: 96, trips: 162, onTime: '96%' },
]

export default function DriverKPIPage() {
  const overallScore = Math.round(
    driverKPIs.reduce((sum, kpi) => {
      const achievement = (kpi.current / kpi.target) * 100
      return sum + Math.min(achievement, 110) // Cap at 110%
    }, 0) / driverKPIs.length
  )

  const getGrade = (score: number) => {
    if (score >= 95) return { grade: 'A+', color: 'text-green-600 bg-green-100' }
    if (score >= 90) return { grade: 'A', color: 'text-green-600 bg-green-100' }
    if (score >= 75) return { grade: 'B', color: 'text-blue-600 bg-blue-100' }
    if (score >= 60) return { grade: 'C', color: 'text-yellow-600 bg-yellow-100' }
    return { grade: 'D', color: 'text-red-600 bg-red-100' }
  }

  const gradeInfo = getGrade(overallScore)

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My KPI</h1>
        <p className="text-muted-foreground">Driver performance metrics</p>
      </div>

      {/* Overall Score */}
      <Card className="bg-primary text-primary-foreground">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-primary-foreground/80 text-sm">Overall Score - March 2024</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-5xl font-bold">{overallScore}</span>
                <span className="text-xl">/100</span>
              </div>
            </div>
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${gradeInfo.color}`}>
              <span className="text-3xl font-bold">{gradeInfo.grade}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4 pt-4 border-t border-primary-foreground/20">
            <div>
              <p className="text-primary-foreground/70 text-xs">Total Trips</p>
              <p className="text-xl font-bold">162</p>
            </div>
            <div>
              <p className="text-primary-foreground/70 text-xs">On-Time</p>
              <p className="text-xl font-bold">96%</p>
            </div>
            <div>
              <p className="text-primary-foreground/70 text-xs">Rating</p>
              <p className="text-xl font-bold">4.8</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="current">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="current">Current</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="space-y-4 mt-4">
          {driverKPIs.map((kpi) => {
            const progress = (kpi.current / kpi.target) * 100
            const isGood = kpi.current >= kpi.target

            return (
              <Card key={kpi.name}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-medium">{kpi.name}</h3>
                      <div className="flex items-baseline gap-1 mt-1">
                        <span className="text-2xl font-bold">{kpi.current}</span>
                        <span className="text-muted-foreground">{kpi.unit}</span>
                        <span className="text-sm text-muted-foreground ml-2">
                          / Target: {kpi.target}{kpi.unit}
                        </span>
                      </div>
                    </div>
                    <Badge className={isGood ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                      {kpi.trendValue > 0 ? '+' : ''}{kpi.trendValue}{kpi.unit}
                    </Badge>
                  </div>
                  <Progress value={Math.min(progress, 100)} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-2">
                    {isGood ? 'Target achieved' : `${(kpi.target - kpi.current).toFixed(1)}${kpi.unit} to target`}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          {monthlyHistory.map((month) => {
            const gradeInfo = getGrade(month.score)
            return (
              <Card key={month.month}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">{month.month}</p>
                      <p className="text-2xl font-bold">{month.score}/100</p>
                      <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                        <span>{month.trips} trips</span>
                        <span>{month.onTime} on-time</span>
                      </div>
                    </div>
                    <Badge className={gradeInfo.color}>
                      Grade {gradeInfo.grade}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </TabsContent>
      </Tabs>

      {/* Estimated Bonus */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            Estimated Bonus
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">This month</p>
              <p className="text-3xl font-bold text-green-600">RM 300</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Grade A+ Bonus</p>
              <p className="text-sm">Excellent performance!</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
