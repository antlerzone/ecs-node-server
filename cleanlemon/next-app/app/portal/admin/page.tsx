'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, CreditCard, TrendingUp, AlertCircle } from 'lucide-react'
import { fetchAdminSubscriptions } from '@/lib/cleanlemon-api'

const RevenueBar = dynamic(
  () =>
    import('./admin-charts').then((m) => m.RevenueBarChart),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground p-4">Loading chart…</p> }
)

const PlanPie = dynamic(
  () => import('./admin-charts').then((m) => m.PlanPieChart),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground p-4">Loading chart…</p> }
)

const AdminDashboard = () => {
  const [summary, setSummary] = useState({
    totalOperators: 0,
    activeSubscriptions: 0,
    pendingApprovals: 0,
    monthlyRevenue: 0,
  })

  useEffect(() => {
    const load = async () => {
      const result = await fetchAdminSubscriptions()
      if (!result.ok || !Array.isArray(result.items)) return
      const totalOperators = result.items.length
      const activeSubscriptions = result.items.filter((item) => item.status === 'active').length
      const pendingApprovals = result.items.filter((item) => item.approvalStatus === 'pending').length
      const monthlyRevenue = result.items.reduce((sum, item) => sum + Number(item.monthlyPrice || 0), 0)
      setSummary({ totalOperators, activeSubscriptions, pendingApprovals, monthlyRevenue })
    }
    load()
  }, [])

  const platformStats = [
    {
      title: 'Total Operators',
      value: String(summary.totalOperators),
      change: 'live',
      icon: <Users className="w-5 h-5" />,
      color: 'text-blue-600',
    },
    {
      title: 'Active Subscriptions',
      value: String(summary.activeSubscriptions),
      change: 'live',
      icon: <CreditCard className="w-5 h-5" />,
      color: 'text-green-600',
    },
    {
      title: 'Monthly Revenue',
      value: `RM ${summary.monthlyRevenue.toFixed(2)}`,
      change: 'live',
      icon: <TrendingUp className="w-5 h-5" />,
      color: 'text-purple-600',
    },
    {
      title: 'Pending Approval',
      value: String(summary.pendingApprovals),
      change: 'action needed',
      icon: <AlertCircle className="w-5 h-5" />,
      color: 'text-red-600',
    },
  ]

  const revenueData = [
    { month: 'Jan', basic: 8000, grow: 12000, enterprise: 15000 },
    { month: 'Feb', basic: 9200, grow: 14000, enterprise: 18000 },
    { month: 'Mar', basic: 10500, grow: 16000, enterprise: 20000 },
    { month: 'Apr', basic: 11200, grow: 18000, enterprise: 22000 },
    { month: 'May', basic: 12000, grow: 19000, enterprise: 25000 },
    { month: 'Jun', basic: 13500, grow: 21000, enterprise: 28000 },
  ]

  const planDistribution = [
    { name: 'Basic Plan', value: 45 },
    { name: 'Grow Plan', value: 35 },
    { name: 'Enterprise', value: 20 },
  ]

  const colors = ['#A4C8D8', '#FBD437', '#1B2A41']

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Cleanlemons SaaS Admin</h1>
          <p className="text-muted-foreground">Pricing plan adjust + approval + API gate ready</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {platformStats.map((stat, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                  {stat.title}
                  <span className={stat.color}>{stat.icon}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground mb-1">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.change} this month</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Revenue by Plan</CardTitle>
              <CardDescription>Monthly revenue breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              <RevenueBar data={revenueData} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plan Distribution</CardTitle>
              <CardDescription>% of active subscriptions</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <PlanPie data={planDistribution} colors={colors} />
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Signups</CardTitle>
            <CardDescription>Latest operator registrations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { name: 'PT Cleaners Malaysia', plan: 'Grow', date: '2 hours ago' },
                { name: 'Elite Cleaning Services', plan: 'Enterprise', date: '5 hours ago' },
                { name: 'Urban Cleaners KL', plan: 'Basic', date: '1 day ago' },
              ].map((operator, index) => (
                <div key={index} className="flex items-center justify-between p-3 border border-border rounded-lg">
                  <div>
                    <p className="font-medium text-foreground">{operator.name}</p>
                    <p className="text-sm text-muted-foreground">{operator.date}</p>
                  </div>
                  <Badge>{operator.plan}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default AdminDashboard
