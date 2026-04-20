"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { fetchClientPortalInvoices, postClientPortalInvoicesCheckout } from '@/lib/cleanlemon-api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  Filter,
  ChevronDown,
  FileSpreadsheet,
} from 'lucide-react'
import { toast } from 'sonner'

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

function isPayableInvoice(inv: InvoiceRow) {
  if (inv.status === 'paid') return false
  return Boolean(String(inv.operatorId || '').trim())
}

function statusLabel(s: string) {
  if (s === 'all') return 'All'
  if (s === 'pending') return 'Pending'
  if (s === 'paid') return 'Paid'
  if (s === 'overdue') return 'Overdue'
  return s
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function exportInvoicesCsv(rows: InvoiceRow[]) {
  const headers = ['Invoice No', 'Description', 'Issue date', 'Due', 'Status', 'Amount (RM)', 'Operator', 'Paid date']
  const data = rows.map((inv) => [
    inv.invoiceNumber,
    inv.property,
    inv.issueDateYmd || '',
    inv.dueDate,
    getStatusInfo(inv.status).label,
    String(inv.amount),
    inv.operatorName,
    inv.paidDate || '',
  ])
  const lines = [headers, ...data].map((line) =>
    line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
  )
  const csv = '\uFEFF' + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function exportInvoicesPdf(rows: InvoiceRow[]) {
  const title = 'Invoice report'
  const thead =
    '<tr><th>Invoice</th><th>Description</th><th>Issue</th><th>Due</th><th>Status</th><th>Amount (RM)</th><th>Operator</th><th>Paid</th></tr>'
  const tbody = rows
    .map(
      (inv) =>
        `<tr><td>${escapeHtml(inv.invoiceNumber)}</td><td>${escapeHtml(inv.property)}</td><td>${escapeHtml(inv.issueDateYmd)}</td><td>${escapeHtml(inv.dueDate)}</td><td>${escapeHtml(getStatusInfo(inv.status).label)}</td><td>${inv.amount.toLocaleString()}</td><td>${escapeHtml(inv.operatorName)}</td><td>${escapeHtml(inv.paidDate || '—')}</td></tr>`,
    )
    .join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;padding:20px;color:#111;}
h1{font-size:18px;margin:0 0 12px;}
table{border-collapse:collapse;width:100%;font-size:12px;}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;}
th{background:#f4f4f5;}
@media print{ body{padding:12px;} }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p style="font-size:12px;color:#555;margin:0 0 12px;">${escapeHtml(new Date().toLocaleString())} · ${rows.length} row(s)</p>
<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
</body></html>`
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  const t = window.setTimeout(() => {
    w.print()
    window.clearTimeout(t)
  }, 250)
}

export default function InvoicesPage() {
  const { user } = useAuth()
  const pathname = usePathname()
  const email = String(user?.email || '').trim().toLowerCase()
  const operatorId = String(user?.operatorId || '').trim()

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [payLoading, setPayLoading] = useState(false)

  const [activeTab, setActiveTab] = useState('all')
  const [yearFilter, setYearFilter] = useState(() => String(new Date().getFullYear()))
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [operatorFilter, setOperatorFilter] = useState('all')
  /** Inclusive YYYY-MM-DD on issue date */
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

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
      if (dateFrom && invoice.issueDateYmd && invoice.issueDateYmd < dateFrom) return false
      if (dateTo && invoice.issueDateYmd && invoice.issueDateYmd > dateTo) return false
      if ((dateFrom || dateTo) && !invoice.issueDateYmd) return false
      if (!q) return true
      const hay = [invoice.invoiceNumber, invoice.property, invoice.operatorName, invoice.period]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [invoices, activeTab, yearFilter, search, dateFrom, dateTo])

  /** Unpaid first (oldest issue date first), then paid (oldest first). */
  const displayInvoices = useMemo(() => {
    const list = [...filteredInvoices]
    list.sort((a, b) => {
      const ra = a.status === 'paid' ? 1 : 0
      const rb = b.status === 'paid' ? 1 : 0
      if (ra !== rb) return ra - rb
      const da = a.issueDateYmd || '9999-99-99'
      const db = b.issueDateYmd || '9999-99-99'
      return da.localeCompare(db)
    })
    return list
  }, [filteredInvoices])

  const yearChoices = useMemo(() => {
    const ys = new Set<number>()
    ys.add(new Date().getFullYear())
    for (const inv of invoices) {
      if (inv.issueDateYmd && inv.issueDateYmd.length >= 4) ys.add(Number(inv.issueDateYmd.slice(0, 4)))
    }
    return Array.from(ys).sort((a, b) => b - a)
  }, [invoices])

  const filterSummary = useMemo(() => {
    const parts = [yearFilter, statusLabel(activeTab)]
    if (search.trim()) parts.push(`“${search.trim().slice(0, 24)}${search.trim().length > 24 ? '…' : ''}”`)
    return parts.join(' · ')
  }, [yearFilter, activeTab, search])

  useEffect(() => {
    setSelectedIds((prev) => {
      const allowed = new Set(displayInvoices.map((i) => i.id))
      const next = prev.filter((id) => allowed.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [displayInvoices])

  const selectedInvoices = useMemo(
    () => displayInvoices.filter((i) => selectedIds.includes(i.id)),
    [displayInvoices, selectedIds],
  )

  const selectedPayTotal = useMemo(
    () => selectedInvoices.reduce((s, i) => s + i.amount, 0),
    [selectedInvoices],
  )

  const toggleSelectInvoice = useCallback((inv: InvoiceRow, checked: boolean) => {
    if (!isPayableInvoice(inv)) return
    if (checked) {
      setSelectedIds((prev) => {
        if (prev.includes(inv.id)) return prev
        if (prev.length > 0) {
          const first = displayInvoices.find((x) => x.id === prev[0])
          if (first && String(first.operatorId) !== String(inv.operatorId)) {
            toast.error('Only invoices from the same operator can be selected. Each operator has a separate payment account.')
            return prev
          }
        }
        return [...prev, inv.id]
      })
    } else {
      setSelectedIds((prev) => prev.filter((id) => id !== inv.id))
    }
  }, [displayInvoices])

  const openInvoiceCheckout = useCallback(
    async (ids: string[]) => {
      const invs = displayInvoices.filter((i) => ids.includes(i.id) && isPayableInvoice(i))
      if (invs.length === 0) {
        toast.error('Select unpaid invoices to pay.')
        return
      }
      const op = String(invs[0].operatorId || '').trim()
      if (!op || invs.some((i) => String(i.operatorId) !== op)) {
        toast.error('Only invoices from the same operator can be paid together.')
        return
      }
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const basePath = pathname || '/portal/client/invoices'
      setPayLoading(true)
      try {
        const r = await postClientPortalInvoicesCheckout({
          email,
          operatorId: op,
          invoiceIds: invs.map((i) => i.id),
          successUrl: `${origin}${basePath.startsWith('/') ? basePath : `/${basePath}`}?checkout=success`,
          cancelUrl: `${origin}${basePath.startsWith('/') ? basePath : `/${basePath}`}?checkout=cancelled`,
        })
        if (!r?.ok || !r.url) {
          const reason = String(r?.reason || 'CHECKOUT_FAILED')
          if (reason === 'STRIPE_CONNECT_REQUIRED') {
            toast.error('This operator has not enabled online card payment (Stripe) yet.')
          } else if (reason === 'AMOUNT_BELOW_STRIPE_MINIMUM') {
            toast.error('Total amount is below the minimum for card payment (RM 2).')
          } else {
            toast.error('Could not start payment. Try again or pay one invoice at a time.')
          }
          return
        }
        window.location.href = r.url
      } finally {
        setPayLoading(false)
      }
    },
    [displayInvoices, email, pathname],
  )

  if (!email) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Sign in to view invoices.</p>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoices & Billing</h1>
          <p className="text-muted-foreground">Manage your payments and view billing history</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            className="gap-2 bg-primary text-primary-foreground"
            disabled={loading || payLoading || selectedIds.length === 0}
            onClick={() => void openInvoiceCheckout(selectedIds)}
          >
            <CreditCard className="h-4 w-4" />
            {selectedIds.length > 0 ? `Pay RM ${selectedPayTotal.toLocaleString()}` : 'Pay'}
          </Button>
          <div className="hidden md:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="gap-2" disabled={loading || displayInvoices.length === 0}>
                  <Download className="h-4 w-4" />
                  Export
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => {
                  exportInvoicesPdf(displayInvoices)
                }}
              >
                <FileText className="h-4 w-4" />
                Export as PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => {
                  exportInvoicesCsv(displayInvoices)
                }}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Export as Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {selectedInvoices[0]?.operatorName ? `Paying ${selectedInvoices[0].operatorName} · ` : null}
          {selectedIds.length} selected — same operator only
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-3 lg:gap-4">
        <Card className="flex aspect-square flex-col overflow-hidden rounded-xl shadow-sm sm:aspect-auto sm:min-h-0">
          <CardContent className="flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center sm:flex-row sm:items-center sm:justify-start sm:gap-3 sm:p-4 sm:text-left">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 sm:h-10 sm:w-10 sm:rounded-xl">
              <DollarSign className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 px-0.5">
              <p className="text-sm font-bold tabular-nums text-foreground sm:text-xl">RM {stats.total.toLocaleString()}</p>
              <p className="text-[10px] leading-tight text-muted-foreground sm:text-xs">
                <span className="sm:hidden">Billed</span>
                <span className="hidden sm:inline">Total billed ({yearFilter})</span>
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="flex aspect-square flex-col overflow-hidden rounded-xl shadow-sm sm:aspect-auto sm:min-h-0">
          <CardContent className="flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center sm:flex-row sm:items-center sm:justify-start sm:gap-3 sm:p-4 sm:text-left">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-100 sm:h-10 sm:w-10 sm:rounded-xl">
              <CheckCircle2 className="h-4 w-4 text-green-700 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 px-0.5">
              <p className="text-sm font-bold tabular-nums text-green-700 sm:text-xl">RM {stats.paid.toLocaleString()}</p>
              <p className="text-[10px] leading-tight text-muted-foreground sm:text-xs">
                <span className="sm:hidden">Paid</span>
                <span className="hidden sm:inline">Paid ({yearFilter})</span>
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="flex aspect-square flex-col overflow-hidden rounded-xl shadow-sm sm:aspect-auto sm:min-h-0">
          <CardContent className="flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center sm:flex-row sm:items-center sm:justify-start sm:gap-3 sm:p-4 sm:text-left">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-100 sm:h-10 sm:w-10 sm:rounded-xl">
              <Clock className="h-4 w-4 text-yellow-700 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 px-0.5">
              <p className="text-sm font-bold tabular-nums text-yellow-700 sm:text-xl">RM {stats.pending.toLocaleString()}</p>
              <p className="text-[10px] leading-tight text-muted-foreground sm:text-xs">
                <span className="sm:hidden">Unpaid</span>
                <span className="hidden sm:inline">Unpaid / pending ({yearFilter})</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search invoice, description, operator…"
                className="border-input pl-9"
                disabled={loading}
              />
            </div>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0 gap-2 px-3 sm:min-w-[120px]"
                disabled={loading}
              >
                <span className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filters
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="flex h-auto w-full flex-wrap gap-1 bg-muted/50 p-1">
              <TabsTrigger value="all" className="flex-1 min-w-[4.5rem]">
                All
              </TabsTrigger>
              <TabsTrigger value="pending" className="flex-1 min-w-[4.5rem]">
                Pending
              </TabsTrigger>
              <TabsTrigger value="paid" className="flex-1 min-w-[4.5rem]">
                Paid
              </TabsTrigger>
              <TabsTrigger value="overdue" className="flex-1 min-w-[4.5rem]">
                Overdue
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {!filtersOpen ? (
            <p className="text-xs text-muted-foreground">
              {filterSummary} · {displayInvoices.length} shown
            </p>
          ) : null}
        </div>

        <CollapsibleContent className="mt-3 space-y-4 data-[state=closed]:animate-out">
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Label className="text-sm font-medium text-foreground">Year</Label>
              <Select value={yearFilter} onValueChange={setYearFilter} disabled={loading}>
                <SelectTrigger className="w-full border-input sm:w-[160px]">
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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Label className="text-sm font-medium text-foreground sm:sr-only">Operator</Label>
              <Select value={operatorFilter} onValueChange={setOperatorFilter} disabled={loading}>
                <SelectTrigger className="w-full border-input sm:max-w-md">
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
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="space-y-1 flex-1 min-w-[140px]">
                <Label className="text-xs text-muted-foreground">Issue date from</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value.slice(0, 10))}
                  className="w-full border-input"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1 flex-1 min-w-[140px]">
                <Label className="text-xs text-muted-foreground">Issue date to</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value.slice(0, 10))}
                  className="w-full border-input"
                  disabled={loading}
                />
              </div>
              {(dateFrom || dateTo) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setDateFrom('')
                    setDateTo('')
                  }}
                >
                  Clear dates
                </Button>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading invoices…
        </div>
      ) : (
        <div className="space-y-2 md:space-y-4">
          {displayInvoices.map((invoice) => {
            const statusInfo = getStatusInfo(invoice.status)
            const isExpanded = expandedInvoice === invoice.id

            return (
              <Card key={invoice.id} className="border-border overflow-hidden rounded-lg md:rounded-xl shadow-sm">
                <CardContent className="p-0">
                  <div
                    className="cursor-pointer p-3 transition-colors hover:bg-muted/50 md:p-4"
                    onClick={() => setExpandedInvoice(isExpanded ? null : invoice.id)}
                  >
                    <div className="flex items-start justify-between gap-2 md:gap-4">
                      <div className="flex min-w-0 items-start gap-2 md:gap-3">
                        <div
                          className="flex shrink-0 items-start pt-1"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedIds.includes(invoice.id)}
                            disabled={!isPayableInvoice(invoice)}
                            onCheckedChange={(v) => toggleSelectInvoice(invoice, v === true)}
                            aria-label={`Select invoice ${invoice.invoiceNumber}`}
                          />
                        </div>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted md:h-10 md:w-10">
                          <FileText className="h-4 w-4 text-muted-foreground md:h-5 md:w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                            <p className="text-sm font-semibold text-foreground md:text-base">{invoice.invoiceNumber}</p>
                            <Badge variant="outline" className="max-w-[140px] truncate text-[10px] md:max-w-[200px] md:text-xs">
                              {invoice.property}
                            </Badge>
                            {invoice.operatorName ? (
                              <Badge variant="secondary" className="max-w-[100px] truncate text-[10px] font-normal sm:max-w-[160px] sm:text-xs md:max-w-[160px]">
                                {invoice.operatorName}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground md:text-sm">
                            {invoice.unit ? `Unit ${invoice.unit} · ` : null}
                            {invoice.period}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground md:mt-1 md:gap-3 md:text-xs">
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
                      <div className="flex shrink-0 items-center gap-2 md:gap-3">
                        <div className="text-right">
                          <p className="text-sm font-bold tabular-nums text-foreground md:text-lg">RM {invoice.amount.toLocaleString()}</p>
                          <Badge className={`text-[10px] md:text-xs ${statusInfo.color}`}>{statusInfo.label}</Badge>
                        </div>
                        <ChevronRight
                          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform md:h-5 md:w-5 ${
                            isExpanded ? 'rotate-90' : ''
                          }`}
                        />
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border bg-muted/30 p-3 md:p-4">
                      <p className="mb-2 text-sm font-medium text-foreground md:mb-3">Invoice Items</p>
                      <div className="space-y-2">
                        {invoice.items.map((item, index) => (
                          <div key={index} className="flex items-center justify-between text-sm">
                            <div className="flex-1 min-w-0">
                              <p className="text-foreground truncate">{item.description}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.quantity} x RM {item.unitPrice}
                              </p>
                            </div>
                            <p className="font-medium text-foreground shrink-0">RM {item.total}</p>
                          </div>
                        ))}
                        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
                          <p className="text-foreground">Total</p>
                          <p className="text-foreground">RM {invoice.amount}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-col gap-2 sm:flex-row md:mt-4">
                        <Button variant="outline" size="sm" className="flex-1">
                          <Download className="mr-2 h-4 w-4" />
                          Download PDF
                        </Button>
                        {isPayableInvoice(invoice) && (
                          <Button
                            type="button"
                            size="sm"
                            className="flex-1 bg-primary text-primary-foreground"
                            disabled={payLoading}
                            onClick={(e) => {
                              e.stopPropagation()
                              void openInvoiceCheckout([invoice.id])
                            }}
                          >
                            <CreditCard className="mr-2 h-4 w-4" />
                            Pay now
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
          {!loading && displayInvoices.length === 0 && (
            <Card className="border-border">
              <CardContent className="p-8 text-center text-muted-foreground">No invoice records match your filters.</CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
