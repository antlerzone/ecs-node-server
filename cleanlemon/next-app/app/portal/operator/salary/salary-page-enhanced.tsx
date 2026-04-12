"use client"

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DataTable, Column, Action } from '@/components/shared/data-table'
import {
  Download,
  Send,
  Eye,
  Archive,
  Pencil,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-context'
import { fetchOperatorSalaries } from '@/lib/cleanlemon-api'

type SalaryStatus = 'pending' | 'paid' | 'void' | 'archived'
type PaymentMethod = 'bank_transfer' | 'cash' | 'duitnow' | 'cheque'

interface SalaryRecord {
  id: string
  name: string
  role: string
  baseSalary: number
  bonus: number
  deductions: number
  totalTasks: number
  total: number
  status: SalaryStatus
  period: string
  paymentMethod?: PaymentMethod
  paidDate?: string
}

const monthOptions = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
]

const paymentMethodOptions: { value: PaymentMethod; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'duitnow', label: 'DuitNow' },
  { value: 'cheque', label: 'Cheque' },
]

export default function SalaryPageEnhanced() {
  const { user } = useAuth()
  const operatorId = user?.operatorId || ''
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [month, setMonth] = useState('03')
  const [year, setYear] = useState('2024')
  const [selectedRecord, setSelectedRecord] = useState<SalaryRecord | null>(null)
  const [recordForMarkPaid, setRecordForMarkPaid] = useState<SalaryRecord | null>(null)
  const [recordForEdit, setRecordForEdit] = useState<SalaryRecord | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer')
  const [paymentDate, setPaymentDate] = useState('')
  const [editBaseSalary, setEditBaseSalary] = useState('')
  const [editBonus, setEditBonus] = useState('')
  const [editDeductions, setEditDeductions] = useState('')
  const [editTasks, setEditTasks] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!operatorId) {
      setRecords([])
      return () => {
        cancelled = true
      }
    }
    ;(async () => {
      const r = await fetchOperatorSalaries(operatorId)
      if (cancelled || !r?.ok) return
      setRecords(r.items || [])
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  const selectedPeriod = `${year}-${month}`
  const filteredSalaries = useMemo(() => records.filter((record) => record.period === selectedPeriod), [records, selectedPeriod])

  const summaryStats = useMemo(() => {
    const totalPayroll = filteredSalaries.reduce((sum, record) => sum + record.total, 0)
    const pendingPayments = filteredSalaries.filter((record) => record.status === 'pending').reduce((sum, record) => sum + record.total, 0)
    const paidThisMonth = filteredSalaries.filter((record) => record.status === 'paid').reduce((sum, record) => sum + record.total, 0)
    const totalStaff = filteredSalaries.filter((record) => record.status !== 'archived').length
    return { totalPayroll, pendingPayments, paidThisMonth, totalStaff }
  }, [filteredSalaries])

  const yearOptions = useMemo(() => {
    const yearsFromData = Array.from(new Set(records.map((record) => record.period.slice(0, 4))))
    return yearsFromData.sort((a, b) => Number(b) - Number(a))
  }, [records])

  const getStatusBadge = (status: SalaryStatus) => {
    if (status === 'paid') return <Badge variant="secondary" className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" /> Paid</Badge>
    if (status === 'void') return <Badge variant="secondary" className="bg-red-100 text-red-800"><XCircle className="h-3 w-3 mr-1" /> Void</Badge>
    if (status === 'archived') return <Badge variant="secondary" className="bg-zinc-200 text-zinc-800"><Archive className="h-3 w-3 mr-1" /> Archived</Badge>
    return <Badge variant="secondary" className="bg-amber-100 text-amber-800"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>
  }

  const openMarkAsPaidDialog = (row: SalaryRecord) => {
    if (row.status === 'archived') return toast.error('Archived salary cannot be paid')
    setRecordForMarkPaid(row)
    setPaymentMethod(row.paymentMethod || 'bank_transfer')
    setPaymentDate(row.paidDate || new Date().toISOString().slice(0, 10))
  }

  const confirmMarkAsPaid = () => {
    if (!recordForMarkPaid) return
    if (!paymentMethod || !paymentDate) return toast.error('Please select payment method and payment date')
    setRecords((prev) => prev.map((record) => (record.id === recordForMarkPaid.id ? { ...record, status: 'paid', paymentMethod, paidDate: paymentDate } : record)))
    toast.success(`${recordForMarkPaid.name} marked as paid`)
    setRecordForMarkPaid(null)
  }

  const voidPayment = (row: SalaryRecord) => {
    if (row.status !== 'paid') return toast.error('Only paid salary can be voided')
    setRecords((prev) => prev.map((record) => (record.id === row.id ? { ...record, status: 'void', paymentMethod: undefined, paidDate: undefined } : record)))
    toast.success(`${row.name} payment has been voided`)
  }

  const archiveSalary = (row: SalaryRecord) => {
    if (row.status === 'archived') return toast.info(`${row.name} is already archived`)
    setRecords((prev) => prev.map((record) => (record.id === row.id ? { ...record, status: 'archived' } : record)))
    toast.success(`${row.name} salary archived`)
  }

  const openEditDialog = (row: SalaryRecord) => {
    if (row.status === 'archived') return toast.error('Archived salary cannot be edited')
    setRecordForEdit(row)
    setEditBaseSalary(String(row.baseSalary))
    setEditBonus(String(row.bonus))
    setEditDeductions(String(row.deductions))
    setEditTasks(String(row.totalTasks))
  }

  const saveEditedSalary = () => {
    if (!recordForEdit) return
    const baseSalary = Number(editBaseSalary || 0)
    const bonus = Number(editBonus || 0)
    const deductions = Number(editDeductions || 0)
    const totalTasks = Number(editTasks || 0)
    if ([baseSalary, bonus, deductions, totalTasks].some(Number.isNaN)) return toast.error('Please enter valid numeric values')
    const total = Math.max(0, baseSalary + bonus - deductions)
    setRecords((prev) => prev.map((record) => (record.id === recordForEdit.id ? { ...record, baseSalary, bonus, deductions, totalTasks, total } : record)))
    toast.success(`${recordForEdit.name} salary updated`)
    setRecordForEdit(null)
  }

  const columns: Column<SalaryRecord>[] = [
    {
      key: 'name',
      label: 'Staff',
      sortable: true,
      render: (_, row) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${row.name}`} />
            <AvatarFallback>{row.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{row.name}</p>
            <p className="text-xs text-muted-foreground">{row.role}</p>
          </div>
        </div>
      ),
    },
    { key: 'baseSalary', label: 'Base Salary', sortable: true, render: (value) => `RM ${Number(value).toLocaleString()}` },
    { key: 'bonus', label: 'Bonus', render: (value) => <span className="text-green-600">+RM {Number(value).toLocaleString()}</span> },
    { key: 'deductions', label: 'Deductions', render: (value) => <span className="text-red-600">-RM {Number(value).toLocaleString()}</span> },
    { key: 'totalTasks', label: 'Tasks', sortable: true },
    { key: 'total', label: 'Total', sortable: true, render: (value) => <span className="font-semibold">RM {Number(value).toLocaleString()}</span> },
    {
      key: 'status',
      label: 'Status',
      filterable: true,
      filterOptions: [{ label: 'Pending', value: 'pending' }, { label: 'Paid', value: 'paid' }, { label: 'Void', value: 'void' }, { label: 'Archived', value: 'archived' }],
      render: (value) => getStatusBadge(value as SalaryStatus),
    },
  ]

  const actions: Action<SalaryRecord>[] = [
    {
      label: 'View Details',
      icon: <Eye className="h-4 w-4 mr-2" />,
      onClick: (row) => setSelectedRecord(row),
      visible: (row) => row.status === 'pending' || row.status === 'paid',
    },
    {
      label: 'Mark as Paid',
      icon: <CheckCircle className="h-4 w-4 mr-2" />,
      onClick: openMarkAsPaidDialog,
      visible: (row) => row.status === 'pending',
    },
    {
      label: 'Void Payment',
      icon: <XCircle className="h-4 w-4 mr-2" />,
      variant: 'destructive',
      onClick: voidPayment,
      visible: (row) => row.status === 'paid',
    },
    {
      label: 'Archive Salary',
      icon: <Archive className="h-4 w-4 mr-2" />,
      onClick: archiveSalary,
      visible: (row) => row.status === 'pending',
    },
    {
      label: 'Edit Salary',
      icon: <Pencil className="h-4 w-4 mr-2" />,
      onClick: openEditDialog,
      visible: (row) => row.status === 'pending',
    },
    {
      label: 'Download Slip',
      icon: <Download className="h-4 w-4 mr-2" />,
      onClick: (row) => toast.info(`Downloading salary slip for ${row.name}`),
      visible: (row) => row.status === 'paid',
    },
  ]

  const handleBulkPayment = () => {
    const pendingCount = filteredSalaries.filter((row) => row.status === 'pending').length
    toast.success(`Bulk payment initiated for ${pendingCount} pending salaries`)
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Salary Management</h2>
          <p className="text-muted-foreground">Manage payroll and salary payments</p>
        </div>
        <div className="flex gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>{monthOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>{yearOptions.map((optionYear) => <SelectItem key={optionYear} value={optionYear}>{optionYear}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline"><Download className="h-4 w-4 mr-2" />Export</Button>
          <Button onClick={handleBulkPayment}><Send className="h-4 w-4 mr-2" />Bulk Transfer</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Total Payroll</p><p className="text-2xl font-bold mt-1">RM {summaryStats.totalPayroll.toLocaleString()}</p></div><div className="p-2 rounded-lg bg-primary/10"><DollarSign className="h-5 w-5 text-primary" /></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Pending</p><p className="text-2xl font-bold mt-1 text-amber-600">RM {summaryStats.pendingPayments.toLocaleString()}</p></div><div className="p-2 rounded-lg bg-amber-100"><Clock className="h-5 w-5 text-amber-600" /></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Paid</p><p className="text-2xl font-bold mt-1 text-green-600">RM {summaryStats.paidThisMonth.toLocaleString()}</p></div><div className="p-2 rounded-lg bg-green-100"><CheckCircle className="h-5 w-5 text-green-600" /></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Total Staff</p><p className="text-2xl font-bold mt-1">{summaryStats.totalStaff}</p></div><div className="p-2 rounded-lg bg-secondary/30"><Users className="h-5 w-5 text-secondary-foreground" /></div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Salary Records</CardTitle>
          <CardDescription>{monthOptions.find((option) => option.value === month)?.label} {year} payroll</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable data={filteredSalaries} columns={columns} actions={actions} searchKeys={['name', 'role']} pageSize={10} emptyMessage="No salary records found for this period." />
        </CardContent>
      </Card>

      <Dialog open={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
        <DialogContent className="max-w-md">
          {selectedRecord && (
            <>
              <DialogHeader>
                <DialogTitle>Salary Details</DialogTitle>
                <DialogDescription>{selectedRecord.name} - {monthOptions.find((option) => option.value === month)?.label} {year}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <Avatar><AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedRecord.name}`} /><AvatarFallback>{selectedRecord.name.charAt(0)}</AvatarFallback></Avatar>
                  <div><p className="font-medium">{selectedRecord.name}</p><p className="text-sm text-muted-foreground">{selectedRecord.role}</p></div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between py-2 border-b"><span className="text-muted-foreground">Base Salary</span><span>RM {selectedRecord.baseSalary.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 border-b"><span className="text-muted-foreground">Performance Bonus</span><span className="text-green-600">+RM {selectedRecord.bonus.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 border-b"><span className="text-muted-foreground">Deductions</span><span className="text-red-600">-RM {selectedRecord.deductions.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 border-b"><span className="text-muted-foreground">Tasks Completed</span><span>{selectedRecord.totalTasks} tasks</span></div>
                  <div className="flex justify-between py-3 font-semibold text-lg"><span>Total</span><span>RM {selectedRecord.total.toLocaleString()}</span></div>
                </div>
                <div className="flex justify-center">{getStatusBadge(selectedRecord.status)}</div>
                {selectedRecord.status === 'paid' && selectedRecord.paymentMethod && selectedRecord.paidDate && (
                  <div className="text-sm text-muted-foreground">Paid via {paymentMethodOptions.find((option) => option.value === selectedRecord.paymentMethod)?.label} on {selectedRecord.paidDate}</div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedRecord(null)}>Close</Button>
                <Button><Download className="h-4 w-4 mr-2" />Download Slip</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!recordForMarkPaid} onOpenChange={() => setRecordForMarkPaid(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Mark Salary as Paid</DialogTitle><DialogDescription>{recordForMarkPaid ? `Set payment details for ${recordForMarkPaid.name}` : 'Set payment details'}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Payment Method</p>
              <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{paymentMethodOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Payment Date</p>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setRecordForMarkPaid(null)}>Cancel</Button><Button onClick={confirmMarkAsPaid}>Confirm Paid</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!recordForEdit} onOpenChange={() => setRecordForEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Salary</DialogTitle><DialogDescription>{recordForEdit ? `Update payroll values for ${recordForEdit.name}` : 'Update payroll values'}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><p className="text-sm font-medium">Base Salary</p><Input type="number" min="0" value={editBaseSalary} onChange={(e) => setEditBaseSalary(e.target.value)} /></div>
              <div className="space-y-2"><p className="text-sm font-medium">Bonus</p><Input type="number" min="0" value={editBonus} onChange={(e) => setEditBonus(e.target.value)} /></div>
              <div className="space-y-2"><p className="text-sm font-medium">Deductions</p><Input type="number" min="0" value={editDeductions} onChange={(e) => setEditDeductions(e.target.value)} /></div>
              <div className="space-y-2"><p className="text-sm font-medium">Tasks</p><Input type="number" min="0" value={editTasks} onChange={(e) => setEditTasks(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setRecordForEdit(null)}>Cancel</Button><Button onClick={saveEditedSalary}>Save Changes</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
