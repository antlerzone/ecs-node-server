"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { fetchClientPortalInvoices } from '@/lib/cleanlemon-api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  FileText,
  Download,
  Calendar,
  DollarSign,
  CheckCircle2,
  Clock,
  AlertCircle,
  CreditCard,
  ChevronRight,
  Search,
  Loader2,
} from 'lucide-react'

type RowStatus = 'paid' | 'pending' | 'overdue'

interface InvoiceRow {
  id: string
  invoiceNumber: string
  property: string
  unit: string
  period: string
  /** YYYY-MM-DD from API issueDate — for year filter */
  issueDateYmd: string
  amount: number
  dueDate: string
  status: RowStatus
  paidDate?: string
  operatorId: string
  operatorName: string
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

function mapApiRow(r: Record<string, unknown>): InvoiceRow {
  const id = String(r.id || '')
  const invoiceNumber = String(r.invoiceNo ?? r.invoiceNumber ?? id)
  const description = String(r.description || '').trim()
  const amount = Number(r.total ?? r.amount ?? 0)
  const st = String(r.status || '').toLowerCase()
  let status: RowStatus = 'pending'
  if (st === 'paid') status = 'paid'
  else if (st === 'overdue') status = 'overdue'
  const issueDate = String(r.issueDate || '').slice(0, 10)
  const dueDate = String(r.dueDate || '').slice(0, 10)
  const paidDate = r.paidDate ? String(r.paidDate).slice(0, 10) : undefined
  const operatorId = String(r.operatorId || '')
  const operatorName = String(r.operatorName || '').trim()
  return {
    id,
    invoiceNumber,
    property: description || '—',
    unit: '',
    period: issueDate ? `Issued ${issueDate}` : '',
    issueDateYmd: issueDate,
    amount,
    dueDate: dueDate || '—',
    status,
    paidDate,
    operatorId,
    operatorName: operatorName || (operatorId ? operatorId.slice(0, 8) + '…' : ''),
    items: [
      {
        description: description || 'Invoice',
        quantity: 1,
        unitPrice: amount,
        total: amount,
      },
    ],
  }
}

export default function InvoicesPage() {
  const { user } = useAuth()
  const email = String(user?.email || '').trim().toLowerCase()
  const operatorId = String(user?.operatorId || '').trim()

  const [activeTab, setActiveTab] = useState('all')
  const [yearFilter, setYearFilter] = useState(() => String(new Date().getFullYear()))
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [operatorFilter, setOperatorFilter] = useState('all')
  /** Inclusive YYYY-MM-DD on issue date */
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [operatorOptions, setOperatorOptions] = useState<Array<{ id: string; name: string }>>([])

  const load = useCallback(async () => {
    if (!email || !operatorId) {
      setLoading(false)
      setInvoices([])
      setOperatorOptions([])
      setLoadError(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const r = await fetchClientPortalInvoices(email, operatorId, {
        limit: 500,
        filterOperatorId: operatorFilter !== 'all' ? operatorFilter : undefined,
      })
      if (!r?.ok) {
        setInvoices([])
        setOperatorOptions([])
        setLoadError(String(r?.reason || 'Could not load invoices'))
        return
      }
      const raw = Array.isArray(r.items) ? r.items : []
      setInvoices(raw.map((x) => mapApiRow(x as Record<string, unknown>)))
      const ops = Array.isArray(r.operators) ? r.operators : []
      setOperatorOptions(ops.map((o) => ({ id: String(o.id), name: String(o.name || o.id) })))
    } catch {
      setLoadError('Could not load invoices')
      setInvoices([])
      setOperatorOptions([])
    } finally {
      setLoading(false)
    }
  }, [email, operatorId, operatorFilter])

  useEffect(() => {
    void load()
  }, [load])

  const propertyOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const inv of invoices) {
      const k = inv.property
      if (k && k !== '—') m.set(k, k)
    }
    return Array.from(m.keys()).sort((a, b) => a.localeCompare(b))
  }, [invoices])

  const stats = useMemo(() => {
    const y = yearFilter
    const inYear = invoices.filter((inv) => {
      if (!inv.issueDateYmd) return true
      return inv.issueDateYmd.startsWith(y)
    })
    return {
      total: inYear.reduce((acc, inv) => acc + inv.amount, 0),
      paid: inYear.filter((i) => i.status === 'paid').reduce((acc, inv) => acc + inv.amount, 0),
      pending: inYear.filter((i) => i.status === 'pending' || i.status === 'overdue').reduce((acc, inv) => acc + inv.amount, 0),
    }
  }, [invoices, yearFilter])

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter((invoice) => {
      if (activeTab !== 'all' && invoice.status !== activeTab) return false
      if (invoice.issueDateYmd && !invoice.issueDateYmd.startsWith(yearFilter)) return false
      if (propertyFilter !== 'all' && invoice.property !== propertyFilter) return false
      if (dateFrom && invoice.issueDateYmd && invoice.issueDateYmd < dateFrom) return false
      if (dateTo && invoice.issueDateYmd && invoice.issueDateYmd > dateTo) return false
      if ((dateFrom || dateTo) && !invoice.issueDateYmd) return false
      if (!q) return true
      const hay = [invoice.invoiceNumber, invoice.property, invoice.operatorName, invoice.period]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [invoices, activeTab, yearFilter, propertyFilter, search, dateFrom, dateTo])

  const yearChoices = useMemo(() => {
    const ys = new Set<number>()
    ys.add(new Date().getFullYear())
    for (const inv of invoices) {
      if (inv.issueDateYmd && inv.issueDateYmd.length >= 4) ys.add(Number(inv.issueDateYmd.slice(0, 4)))
    }
    return Array.from(ys).sort((a, b) => b - a)
  }, [invoices])

  if (!email) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Sign in to view invoices.</p>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoices & Billing</h1>
          <p className="text-muted-foreground">Manage your payments and view billing history</p>
        </div>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-[120px] border-input">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {yearChoices.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total billed ({yearFilter})</p>
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
                <p className="text-xs text-muted-foreground">Paid ({yearFilter})</p>
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
                <p className="text-xs text-muted-foreground">Unpaid / pending ({yearFilter})</p>
                <p className="text-xl font-bold text-yellow-700">RM {stats.pending.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
          <TabsTrigger value="overdue">Overdue</TabsTrigger>
        </TabsList>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search invoice, description, operator…"
                className="border-input pl-9"
                disabled={loading}
              />
            </div>
            <Select value={operatorFilter} onValueChange={setOperatorFilter} disabled={loading}>
              <SelectTrigger className="w-full border-input lg:w-[220px]">
                <SelectValue placeholder="Operator" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All operators</SelectItem>
                {operatorOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={propertyFilter} onValueChange={setPropertyFilter} disabled={loading}>
              <SelectTrigger className="w-full border-input lg:w-[220px]">
                <SelectValue placeholder="Description" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All descriptions</SelectItem>
                {propertyOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p.length > 48 ? `${p.slice(0, 48)}…` : p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Issue date from</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value.slice(0, 10))}
                className="w-full border-input sm:w-[160px]"
                disabled={loading}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Issue date to</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value.slice(0, 10))}
                className="w-full border-input sm:w-[160px]"
                disabled={loading}
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setDateFrom(''); setDateTo('') }}>
                Clear dates
              </Button>
            )}
          </div>
        </div>

        <TabsContent value={activeTab} className="mt-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading invoices…
            </div>
          ) : (
            <div className="space-y-4">
              {filteredInvoices.map((invoice) => {
                const statusInfo = getStatusInfo(invoice.status)
                const isExpanded = expandedInvoice === invoice.id

                return (
                  <Card key={invoice.id} className="border-border">
                    <CardContent className="p-0">
                      <div
                        className="cursor-pointer p-4 transition-colors hover:bg-muted/50"
                        onClick={() => setExpandedInvoice(isExpanded ? null : invoice.id)}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                              <FileText className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold text-foreground">{invoice.invoiceNumber}</p>
                                <Badge variant="outline" className="max-w-[200px] truncate text-xs">
                                  {invoice.property}
                                </Badge>
                                {invoice.operatorName ? (
                                  <Badge variant="secondary" className="max-w-[160px] truncate text-xs font-normal">
                                    {invoice.operatorName}
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {invoice.unit ? `Unit ${invoice.unit} · ` : null}
                                {invoice.period}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3 shrink-0" />
                                  Due: {invoice.dueDate}
                                </span>
                                {invoice.paidDate && (
                                  <span className="flex items-center gap-1 text-green-600">
                                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                                    Paid: {invoice.paidDate}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <div className="text-right">
                              <p className="text-lg font-bold text-foreground">RM {invoice.amount.toLocaleString()}</p>
                              <Badge className={`text-xs ${statusInfo.color}`}>{statusInfo.label}</Badge>
                            </div>
                            <ChevronRight
                              className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
                                isExpanded ? 'rotate-90' : ''
                              }`}
                            />
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-border bg-muted/30 p-4">
                          <p className="mb-3 text-sm font-medium text-foreground">Invoice Items</p>
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
                            <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
                              <p className="text-foreground">Total</p>
                              <p className="text-foreground">RM {invoice.amount}</p>
                            </div>
                          </div>

                          <div className="mt-4 flex gap-2">
                            <Button variant="outline" size="sm" className="flex-1">
                              <Download className="mr-2 h-4 w-4" />
                              Download PDF
                            </Button>
                            {(invoice.status === 'pending' || invoice.status === 'overdue') && (
                              <Button size="sm" className="flex-1 bg-primary text-primary-foreground">
                                <CreditCard className="mr-2 h-4 w-4" />
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
              {!loading && filteredInvoices.length === 0 && (
                <Card className="border-border">
                  <CardContent className="p-8 text-center text-muted-foreground">
                    No invoice records match your filters.
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
