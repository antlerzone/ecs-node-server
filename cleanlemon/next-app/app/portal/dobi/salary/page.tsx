"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Wallet,
  Download,
  Calendar,
  TrendingUp,
  CheckCircle2,
  Clock,
  FileText,
} from 'lucide-react'

interface SalaryRecord {
  id: string
  month: string
  basicSalary: number
  kpiBonus: number
  overtime: number
  deductions: number
  netSalary: number
  status: 'paid' | 'pending' | 'processing'
  paidDate?: string
}

const salaryHistory: SalaryRecord[] = [
  { id: '1', month: 'March 2024', basicSalary: 2000, kpiBonus: 200, overtime: 150, deductions: 200, netSalary: 2150, status: 'pending' },
  { id: '2', month: 'February 2024', basicSalary: 2000, kpiBonus: 180, overtime: 100, deductions: 200, netSalary: 2080, status: 'paid', paidDate: '2024-03-05' },
  { id: '3', month: 'January 2024', basicSalary: 2000, kpiBonus: 220, overtime: 200, deductions: 200, netSalary: 2220, status: 'paid', paidDate: '2024-02-05' },
  { id: '4', month: 'December 2023', basicSalary: 2000, kpiBonus: 250, overtime: 180, deductions: 200, netSalary: 2230, status: 'paid', paidDate: '2024-01-05' },
]

const statusConfig = {
  paid: { label: 'Paid', color: 'bg-green-100 text-green-700' },
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700' },
  processing: { label: 'Processing', color: 'bg-blue-100 text-blue-700' },
}

export default function DobiSalaryPage() {
  const [selectedYear, setSelectedYear] = useState('2024')
  const currentMonth = salaryHistory[0]

  const totalEarnings = salaryHistory
    .filter(s => s.status === 'paid')
    .reduce((sum, s) => sum + s.netSalary, 0)

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Salary</h1>
          <p className="text-muted-foreground">View salary and payment history</p>
        </div>
        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2024">2024</SelectItem>
            <SelectItem value="2023">2023</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Current Month Salary */}
      <Card className="bg-primary text-primary-foreground">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-primary-foreground/80 text-sm">{currentMonth.month}</p>
              <p className="text-3xl font-bold mt-1">RM {currentMonth.netSalary.toLocaleString()}</p>
            </div>
            <Badge className={statusConfig[currentMonth.status].color}>
              {currentMonth.status === 'paid' ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
              {statusConfig[currentMonth.status].label}
            </Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-primary-foreground/20">
            <div>
              <p className="text-primary-foreground/70 text-xs">Basic</p>
              <p className="font-semibold">RM {currentMonth.basicSalary.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-primary-foreground/70 text-xs">KPI Bonus</p>
              <p className="font-semibold text-green-300">+RM {currentMonth.kpiBonus}</p>
            </div>
            <div>
              <p className="text-primary-foreground/70 text-xs">Overtime</p>
              <p className="font-semibold text-green-300">+RM {currentMonth.overtime}</p>
            </div>
            <div>
              <p className="text-primary-foreground/70 text-xs">Deductions</p>
              <p className="font-semibold text-red-300">-RM {currentMonth.deductions}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">YTD Earnings</p>
                <p className="text-xl font-bold">RM {totalEarnings.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <Calendar className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Next Pay Date</p>
                <p className="text-xl font-bold">Apr 5</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Salary Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Salary Breakdown - {currentMonth.month}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Basic Salary</span>
              <span className="font-medium">RM {currentMonth.basicSalary.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">KPI Bonus (94% achievement)</span>
              <span className="font-medium text-green-600">+RM {currentMonth.kpiBonus}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Overtime (15 hours)</span>
              <span className="font-medium text-green-600">+RM {currentMonth.overtime}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">EPF (Employee)</span>
              <span className="font-medium text-red-600">-RM 120</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">SOCSO</span>
              <span className="font-medium text-red-600">-RM 50</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">EIS</span>
              <span className="font-medium text-red-600">-RM 30</span>
            </div>
            <div className="flex justify-between py-3 font-semibold text-lg">
              <span>Net Salary</span>
              <span>RM {currentMonth.netSalary.toLocaleString()}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Payment History</CardTitle>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="hidden sm:table-cell">Basic</TableHead>
                  <TableHead className="hidden md:table-cell">Bonus</TableHead>
                  <TableHead>Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salaryHistory.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">{record.month}</TableCell>
                    <TableCell className="hidden sm:table-cell">RM {record.basicSalary.toLocaleString()}</TableCell>
                    <TableCell className="hidden md:table-cell text-green-600">+RM {record.kpiBonus}</TableCell>
                    <TableCell className="font-medium">RM {record.netSalary.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge className={statusConfig[record.status].color}>
                        {statusConfig[record.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon">
                        <FileText className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
