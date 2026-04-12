"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  FileText, 
  Download,
  Eye,
  Calendar,
  DollarSign,
  CheckCircle2,
  Clock,
  AlertCircle,
  CreditCard,
  ChevronRight,
  Filter
} from 'lucide-react'

interface Invoice {
  id: string
  invoiceNumber: string
  property: string
  unit: string
  period: string
  amount: number
  dueDate: string
  status: 'paid' | 'pending' | 'overdue'
  paidDate?: string
  items: {
    description: string
    quantity: number
    unitPrice: number
    total: number
  }[]
}

const getStatusInfo = (status: string) => {
  switch (status) {
    case 'paid':
      return { label: 'Paid', color: 'bg-green-100 text-green-800', icon: CheckCircle2 }
    case 'pending':
      return { label: 'Pending', color: 'bg-yellow-100 text-yellow-800', icon: Clock }
    case 'overdue':
      return { label: 'Overdue', color: 'bg-red-100 text-red-800', icon: AlertCircle }
    default:
      return { label: 'Unknown', color: 'bg-muted text-muted-foreground', icon: AlertCircle }
  }
}

export default function InvoicesPage() {
  const [activeTab, setActiveTab] = useState('all')
  const [yearFilter, setYearFilter] = useState('2024')
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null)
  const invoices: Invoice[] = []

  const stats = {
    total: invoices.reduce((acc, inv) => acc + inv.amount, 0),
    paid: invoices.filter(i => i.status === 'paid').reduce((acc, inv) => acc + inv.amount, 0),
    pending: invoices.filter(i => i.status === 'pending').reduce((acc, inv) => acc + inv.amount, 0),
  }

  const filteredInvoices = invoices.filter(invoice =>
    activeTab === 'all' || invoice.status === activeTab
  )

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoices & Billing</h1>
          <p className="text-muted-foreground">
            Manage your payments and view billing history
          </p>
        </div>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-[120px] border-input">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2024">2024</SelectItem>
            <SelectItem value="2023">2023</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Billed</p>
                <p className="text-xl font-bold text-foreground">RM {stats.total.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-700" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Paid</p>
                <p className="text-xl font-bold text-green-700">RM {stats.paid.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center">
                <Clock className="h-5 w-5 text-yellow-700" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Payment</p>
                <p className="text-xl font-bold text-yellow-700">RM {stats.pending.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
          <TabsTrigger value="overdue">Overdue</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <div className="space-y-4">
            {filteredInvoices.map((invoice) => {
              const statusInfo = getStatusInfo(invoice.status)
              const StatusIcon = statusInfo.icon
              const isExpanded = expandedInvoice === invoice.id

              return (
                <Card key={invoice.id} className="border-border">
                  <CardContent className="p-0">
                    <div 
                      className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setExpandedInvoice(isExpanded ? null : invoice.id)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-foreground">{invoice.invoiceNumber}</p>
                              <Badge variant="outline" className="text-xs">{invoice.property}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{invoice.period}</p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Due: {invoice.dueDate}
                              </span>
                              {invoice.paidDate && (
                                <span className="flex items-center gap-1 text-green-600">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Paid: {invoice.paidDate}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-lg font-bold text-foreground">
                              RM {invoice.amount.toLocaleString()}
                            </p>
                            <Badge className={`text-xs ${statusInfo.color}`}>
                              {statusInfo.label}
                            </Badge>
                          </div>
                          <ChevronRight 
                            className={`h-5 w-5 text-muted-foreground transition-transform ${
                              isExpanded ? 'rotate-90' : ''
                            }`} 
                          />
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="border-t border-border p-4 bg-muted/30">
                        <p className="text-sm font-medium text-foreground mb-3">Invoice Items</p>
                        <div className="space-y-2">
                          {invoice.items.map((item, index) => (
                            <div key={index} className="flex items-center justify-between text-sm">
                              <div className="flex-1">
                                <p className="text-foreground">{item.description}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.quantity} x RM {item.unitPrice}
                                </p>
                              </div>
                              <p className="font-medium text-foreground">RM {item.total}</p>
                            </div>
                          ))}
                          <div className="flex items-center justify-between pt-2 border-t border-border font-semibold">
                            <p className="text-foreground">Total</p>
                            <p className="text-foreground">RM {invoice.amount}</p>
                          </div>
                        </div>

                        <div className="flex gap-2 mt-4">
                          <Button variant="outline" size="sm" className="flex-1">
                            <Download className="h-4 w-4 mr-2" />
                            Download PDF
                          </Button>
                          {invoice.status === 'pending' && (
                            <Button size="sm" className="flex-1 bg-primary text-primary-foreground">
                              <CreditCard className="h-4 w-4 mr-2" />
                              Pay Now
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
            {filteredInvoices.length === 0 && (
              <Card className="border-border">
                <CardContent className="p-8 text-center text-muted-foreground">
                  No invoice records found.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
