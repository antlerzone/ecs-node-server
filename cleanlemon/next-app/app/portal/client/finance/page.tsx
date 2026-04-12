'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { Calendar, AlertCircle, TrendingUp, Clock } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

const ClientFinancePage = () => {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('2024-06')

  const financialData = [
    { month: 'Jan', revenue: 2400, expenses: 1800, profit: 600 },
    { month: 'Feb', revenue: 2210, expenses: 1500, profit: 710 },
    { month: 'Mar', revenue: 2290, expenses: 1900, profit: 390 },
    { month: 'Apr', revenue: 2000, expenses: 1300, profit: 700 },
    { month: 'May', revenue: 2181, expenses: 1600, profit: 581 },
    { month: 'Jun', revenue: 2500, expenses: 1800, profit: 700 },
  ]

  const expenseBreakdown = [
    { name: 'Labor', value: 40, color: '#FBD437' },
    { name: 'Equipment', value: 25, color: '#A4C8D8' },
    { name: 'Transportation', value: 20, color: '#1B2A41' },
    { name: 'Supplies', value: 15, color: '#B03060' },
  ]

  const invoices = [
    {
      id: 'INV-001',
      date: '2024-06-15',
      amount: 2500,
      status: 'paid',
      dueDate: '2024-06-30',
      items: 8,
    },
    {
      id: 'INV-002',
      date: '2024-06-01',
      amount: 1800,
      status: 'pending',
      dueDate: '2024-06-15',
      items: 6,
    },
    {
      id: 'INV-003',
      date: '2024-05-20',
      amount: 3200,
      status: 'overdue',
      dueDate: '2024-06-05',
      items: 10,
    },
  ]

  const financialMetrics = [
    {
      title: 'Total Revenue',
      value: 'RM 12,381',
      change: '+8.2%',
      icon: <TrendingUp className="w-5 h-5" />,
      color: 'text-green-600',
    },
    {
      title: 'Total Expenses',
      value: 'RM 8,900',
      change: '-2.1%',
      icon: <Clock className="w-5 h-5" />,
      color: 'text-orange-600',
    },
    {
      title: 'Net Profit',
      value: 'RM 3,481',
      change: '+15.3%',
      icon: <TrendingUp className="w-5 h-5" />,
      color: 'text-green-600',
    },
    {
      title: 'Outstanding',
      value: 'RM 5,000',
      change: '3 invoices',
      icon: <AlertCircle className="w-5 h-5" />,
      color: 'text-red-600',
    },
  ]

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Financial Overview</h1>
          <p className="text-muted-foreground">Track your cleaning service finances and invoices</p>
        </div>

        {/* Financial Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {financialMetrics.map((metric, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                  {metric.title}
                  <span className={metric.color}>{metric.icon}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground mb-1">{metric.value}</div>
                <p className="text-xs text-muted-foreground">{metric.change}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Alert */}
        <Alert className="mb-8 border-l-4 border-l-red-600">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You have 1 overdue invoice (INV-003) for RM 3,200. Please settle by June 5, 2024.
          </AlertDescription>
        </Alert>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Revenue vs Expenses</CardTitle>
              <CardDescription>Monthly financial comparison</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={financialData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="revenue" fill="#FBD437" />
                  <Bar dataKey="expenses" fill="#A4C8D8" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Expense Breakdown</CardTitle>
              <CardDescription>Current month distribution</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={expenseBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {expenseBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Invoices Table */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
            <CardDescription>View and manage your invoices</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex gap-2">
              <Input placeholder="Search invoices..." className="flex-1" />
              <Button variant="outline">Export</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-input">
                    <th className="text-left py-3 px-4 font-medium text-foreground">Invoice #</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Date</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Amount</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Items</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Due Date</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-input hover:bg-muted/50">
                      <td className="py-3 px-4 text-foreground font-medium">{invoice.id}</td>
                      <td className="py-3 px-4 text-foreground">{invoice.date}</td>
                      <td className="py-3 px-4 text-foreground font-medium">RM {invoice.amount}</td>
                      <td className="py-3 px-4 text-foreground">{invoice.items}</td>
                      <td className="py-3 px-4 text-foreground">{invoice.dueDate}</td>
                      <td className="py-3 px-4">
                        <Badge
                          className={
                            invoice.status === 'paid'
                              ? 'bg-green-100 text-green-800'
                              : invoice.status === 'pending'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                          }
                        >
                          {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
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

export default ClientFinancePage
