"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { 
  DollarSign, 
  Calendar,
  Clock,
  TrendingUp,
  Download,
  ChevronRight,
  CheckCircle2,
  Briefcase
} from 'lucide-react'

interface PaymentRecord {
  id: string
  period: string
  amount: number
  status: 'paid' | 'pending' | 'processing'
  paidDate?: string
  breakdown: {
    baseSalary: number
    overtime: number
    bonus: number
    deductions: number
  }
}

const mockPayments: PaymentRecord[] = [
  {
    id: '1',
    period: 'January 2024',
    amount: 3200,
    status: 'paid',
    paidDate: 'Jan 5, 2024',
    breakdown: {
      baseSalary: 2500,
      overtime: 450,
      bonus: 300,
      deductions: 50
    }
  },
  {
    id: '2',
    period: 'December 2023',
    amount: 3100,
    status: 'paid',
    paidDate: 'Dec 5, 2023',
    breakdown: {
      baseSalary: 2500,
      overtime: 400,
      bonus: 250,
      deductions: 50
    }
  },
  {
    id: '3',
    period: 'November 2023',
    amount: 2900,
    status: 'paid',
    paidDate: 'Nov 5, 2023',
    breakdown: {
      baseSalary: 2500,
      overtime: 300,
      bonus: 150,
      deductions: 50
    }
  },
]

const currentMonthStats = {
  daysWorked: 18,
  totalDays: 22,
  hoursWorked: 144,
  overtimeHours: 12,
  tasksCompleted: 85,
  estimatedSalary: 3150
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'paid':
      return 'bg-green-100 text-green-800'
    case 'pending':
      return 'bg-yellow-100 text-yellow-800'
    case 'processing':
      return 'bg-blue-100 text-blue-800'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

export default function SalaryPage() {
  const [selectedYear, setSelectedYear] = useState('2024')

  const progress = (currentMonthStats.daysWorked / currentMonthStats.totalDays) * 100

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Salary & Payments</h1>
          <p className="text-muted-foreground">
            Track your earnings and payment history
          </p>
        </div>
        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-[120px] border-input">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2024">2024</SelectItem>
            <SelectItem value="2023">2023</SelectItem>
            <SelectItem value="2022">2022</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Current Month Estimate */}
      <Card className="border-border bg-gradient-to-br from-primary/10 to-accent/20">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Estimated This Month</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                RM {currentMonthStats.estimatedSalary.toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Based on current progress
              </p>
            </div>
            <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-accent-foreground" />
            </div>
          </div>
          
          <div className="mt-6">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">Month Progress</span>
              <span className="font-medium text-foreground">
                {currentMonthStats.daysWorked} / {currentMonthStats.totalDays} days
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
                <Calendar className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{currentMonthStats.daysWorked}</p>
                <p className="text-xs text-muted-foreground">Days Worked</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                <Clock className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{currentMonthStats.hoursWorked}</p>
                <p className="text-xs text-muted-foreground">Hours Worked</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-yellow-700" />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{currentMonthStats.overtimeHours}</p>
                <p className="text-xs text-muted-foreground">Overtime Hours</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <Briefcase className="h-5 w-5 text-green-700" />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{currentMonthStats.tasksCompleted}</p>
                <p className="text-xs text-muted-foreground">Tasks Done</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payment History */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-foreground">Payment History</CardTitle>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              View All
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {mockPayments.map((payment) => (
              <div 
                key={payment.id} 
                className="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-green-700" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{payment.period}</p>
                      {payment.paidDate && (
                        <p className="text-xs text-muted-foreground">
                          Paid on {payment.paidDate}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-semibold text-foreground">
                        RM {payment.amount.toLocaleString()}
                      </p>
                      <Badge className={`text-xs ${getStatusColor(payment.status)}`}>
                        {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                      </Badge>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Download className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>

                {/* Breakdown */}
                <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Base Salary</p>
                    <p className="font-medium text-foreground">RM {payment.breakdown.baseSalary}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Overtime</p>
                    <p className="font-medium text-green-600">+RM {payment.breakdown.overtime}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Bonus</p>
                    <p className="font-medium text-green-600">+RM {payment.breakdown.bonus}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Deductions</p>
                    <p className="font-medium text-red-600">-RM {payment.breakdown.deductions}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
