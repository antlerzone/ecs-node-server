'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { Search, Filter, Download } from 'lucide-react'

const DobiKPIPage = () => {
  const [searchTerm, setSearchTerm] = useState('')
  const [dateRange, setDateRange] = useState('month')

  const kpiData = [
    { month: 'Jan', completed: 45, target: 50, efficiency: 90 },
    { month: 'Feb', completed: 52, target: 50, efficiency: 104 },
    { month: 'Mar', completed: 48, target: 50, efficiency: 96 },
    { month: 'Apr', completed: 61, target: 50, efficiency: 122 },
    { month: 'May', completed: 55, target: 50, efficiency: 110 },
    { month: 'Jun', completed: 67, target: 50, efficiency: 134 },
  ]

  const kpiMetrics = [
    {
      title: 'Tasks Completed',
      value: '67',
      change: '+12%',
      target: '50/month',
      status: 'success',
    },
    {
      title: 'Quality Score',
      value: '4.8/5',
      change: '+0.2',
      target: '4.5+',
      status: 'success',
    },
    {
      title: 'On-time Rate',
      value: '98%',
      change: '+2%',
      target: '95%+',
      status: 'success',
    },
    {
      title: 'Attendance',
      value: '99%',
      change: '+1%',
      target: '98%+',
      status: 'success',
    },
  ]

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">KPI Dashboard</h1>
          <p className="text-muted-foreground">Monitor your performance metrics and targets</p>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Search KPI..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <select className="px-4 py-2 border border-input rounded-lg bg-background text-foreground">
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
            <option value="year">This Year</option>
          </select>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="w-4 h-4" />
            Filter
          </Button>
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {kpiMetrics.map((metric, index) => (
            <Card key={index} className="border-l-4 border-l-accent">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">{metric.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-2xl font-bold text-foreground">{metric.value}</div>
                    <p className="text-xs text-muted-foreground mt-1">Target: {metric.target}</p>
                  </div>
                  <Badge className={metric.status === 'success' ? 'bg-green-100 text-green-800' : ''}>
                    {metric.change}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Tasks Completed vs Target</CardTitle>
              <CardDescription>Monthly performance tracking</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={kpiData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="completed" fill="#FBD437" />
                  <Bar dataKey="target" fill="#E5DFD0" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Efficiency Rate</CardTitle>
              <CardDescription>% of target completed</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={kpiData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="efficiency" stroke="#FBD437" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Monthly Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Breakdown</CardTitle>
            <CardDescription>Detailed KPI performance by month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-input">
                    <th className="text-left py-3 px-4 font-medium text-foreground">Month</th>
                    <th className="text-right py-3 px-4 font-medium text-foreground">Completed</th>
                    <th className="text-right py-3 px-4 font-medium text-foreground">Target</th>
                    <th className="text-right py-3 px-4 font-medium text-foreground">Achievement %</th>
                    <th className="text-right py-3 px-4 font-medium text-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {kpiData.map((row, index) => (
                    <tr key={index} className="border-b border-input hover:bg-muted/50">
                      <td className="py-3 px-4 text-foreground font-medium">{row.month}</td>
                      <td className="py-3 px-4 text-right text-foreground">{row.completed}</td>
                      <td className="py-3 px-4 text-right text-foreground">{row.target}</td>
                      <td className="py-3 px-4 text-right text-foreground">{row.efficiency}%</td>
                      <td className="py-3 px-4 text-right">
                        <Badge className={row.efficiency >= 100 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}>
                          {row.efficiency >= 100 ? 'On Track' : 'Below Target'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default DobiKPIPage
