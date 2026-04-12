"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  fetchOperatorInvoices,
  updateOperatorInvoiceStatus,
  deleteOperatorInvoice,
  fetchOperatorSettings,
  createOperatorInvoice,
  updateOperatorInvoice,
  fetchOperatorInvoiceFormOptions,
  fetchOperatorAccountingMappings,
  fetchCleanlemonPricingConfig,
} from '@/lib/cleanlemon-api'
import { PRICING_SERVICES, type ServiceKey } from '@/lib/cleanlemon-pricing-services'
import { useAuth } from '@/lib/auth-context'
import { useEffectiveOperatorId } from '@/lib/cleanlemon-effective-operator-id'
import {
  Search,
  Filter,
  Plus,
  Send,
  Eye,
  MoreHorizontal,
  FileText,
  Receipt,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowUpDown,
  Trash2,
  Edit,
  Mail,
  Settings2,
  Check,
  ChevronsUpDown,
  Building2,
  Calendar,
  LayoutList,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

interface Invoice {
  id: string
  invoiceNo: string
  client: string
  clientEmail: string
  property: string
  amount: number
  tax: number
  total: number
  status: 'paid' | 'overdue' | 'cancelled'
  issueDate: string
  dueDate: string
  paidDate?: string
  items: Array<{ description: string; quantity: number; rate: number; amount: number }>
}

interface PaymentRecord {
  id: string
  invoiceId: string
  invoiceNo: string
  client: string
  amount: number
  paymentMethod: 'cash' | 'bank'
  paymentDate: string
  status: 'completed' | 'voided'
  voidedAt?: string
}

type AutomationMode = 'during_booking' | 'after_work' | 'monthly'
type MonthlyScheduleMode = 'first_day' | 'last_day' | 'specific_day'

type InvoiceAutomationRow = {
  mode: AutomationMode
  monthlyMode: MonthlyScheduleMode
  specificDay: string
}

function defaultInvoiceAutomationRow(): InvoiceAutomationRow {
  return { mode: 'during_booking', monthlyMode: 'first_day', specificDay: '1' }
}

function fallbackAccountingProductLabels(): string[] {
  return PRICING_SERVICES.map((s) => s.label)
}

type CreateInvoiceLine = {
  id: string
  /** cln_property.id for this line’s unit row */
  propertyId: string
  propertySearch: string
  districtKey: string
  product: string
  qty: number
  rate: number
  description: string
}

type InvoicePropertyRow = {
  id: string
  /** Normalized primary id for display; filtering uses all of clientId / clientdetailId / clientIdRaw. */
  clientId: string
  /** `cln_property.clientdetail_id` when set (B2B Contacts). */
  clientdetailId?: string
  /** Optional legacy company id from API when present (column may be absent post-migration). */
  clientIdRaw?: string
  name: string
  propertyName: string
  unitName: string
}

function invoicePropertyMatchesClient(row: InvoicePropertyRow, selectedClientId: string): boolean {
  const s = String(selectedClientId || '').trim()
  if (!s) return false
  const candidates = [
    row.clientId,
    row.clientdetailId,
    row.clientIdRaw,
  ].map((x) => String(x || '').trim()).filter(Boolean)
  return candidates.includes(s)
}

function normInvoiceDistrictKey(name: string) {
  return name.trim().toLowerCase()
}

function invoiceDistrictGroupKey(p: InvoicePropertyRow): string {
  const n = p.propertyName.trim()
  if (n) return normInvoiceDistrictKey(n)
  return `__row:${p.id}`
}

function newCreateInvoiceLine(): CreateInvoiceLine {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `ln-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return {
    id,
    propertyId: '',
    propertySearch: '',
    districtKey: '',
    product: '',
    qty: 1,
    rate: 0,
    description: '',
  }
}

type InvoiceDistrictGroup = {
  key: string
  districtLabel: string
  units: Array<{ id: string; unitLabel: string }>
}

function filteredDistrictGroupsForLine(
  line: { propertySearch: string; districtKey: string },
  groups: InvoiceDistrictGroup[]
): InvoiceDistrictGroup[] {
  const q = line.propertySearch.trim().toLowerCase()
  let list = groups
  if (q) {
    list = groups.filter(
      (g) =>
        g.districtLabel.toLowerCase().includes(q) ||
        g.units.some((u) => u.unitLabel.toLowerCase().includes(q))
    )
  }
  let out = [...list].sort((a, b) =>
    a.districtLabel.localeCompare(b.districtLabel, undefined, { sensitivity: 'base', numeric: true })
  )
  if (line.districtKey) {
    const sel = groups.find((g) => g.key === line.districtKey)
    if (sel && !out.some((g) => g.key === line.districtKey)) {
      out = [...out, sel].sort((a, b) =>
        a.districtLabel.localeCompare(b.districtLabel, undefined, { sensitivity: 'base', numeric: true })
      )
    }
  }
  return out
}

function invoicePropertyRowLabel(p: InvoicePropertyRow | undefined): string {
  if (!p) return '—'
  if (p.propertyName && p.unitName) return `${p.propertyName} · ${p.unitName}`
  return p.name || p.id
}

function buildAccountingInvoiceDescription(params: {
  dateYmd: string
  lines: Array<{ product: string; description: string; propertyLabel: string }>
}): string {
  const head = [`Date: ${params.dateYmd}`]
  const blocks = params.lines.map((line, i) => {
    const detail = String(line.description || '').trim() || '-'
    const prop = String(line.propertyLabel || '').trim() || '—'
    return [
      `Line ${i + 1}`,
      `Property / unit: ${prop}`,
      `Product: ${line.product}`,
      `Description: ${detail}`,
    ].join('\n')
  })
  return [...head, '', ...blocks].join('\n\n')
}

const statusConfig = {
  paid: { label: 'Paid', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  overdue: { label: 'Overdue', color: 'bg-red-100 text-red-700', icon: AlertCircle },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-500', icon: XCircle },
}

export default function InvoicesPage() {
  const { user } = useAuth()
  const operatorId = useEffectiveOperatorId(user)
  const [activeTab, setActiveTab] = useState('all')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterYear, setFilterYear] = useState('all')
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([])
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false)
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null)
  const [markAsPaidInvoice, setMarkAsPaidInvoice] = useState<Invoice | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank'>('bank')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [deleteInvoice, setDeleteInvoice] = useState<Invoice | null>(null)
  const [viewPayment, setViewPayment] = useState<PaymentRecord | null>(null)
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null)
  const [invoiceAutomationOpen, setInvoiceAutomationOpen] = useState(false)
  /** Product line labels = `cln_account` rows with is_product (same as /operator/accounting). */
  const [accountingProductOptions, setAccountingProductOptions] = useState<string[]>(fallbackAccountingProductLabels)
  const [createLines, setCreateLines] = useState<CreateInvoiceLine[]>(() => [newCreateInvoiceLine()])
  const [createClientId, setCreateClientId] = useState('')
  const [createInvoiceDate, setCreateInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [invoiceClients, setInvoiceClients] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [invoiceProperties, setInvoiceProperties] = useState<InvoicePropertyRow[]>([])
  const [clientPickerOpen, setClientPickerOpen] = useState(false)

  const clientsSortedAZ = useMemo(
    () =>
      [...invoiceClients].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
      ),
    [invoiceClients]
  )

  /** Properties for this bill-to client: match clientdetail_id, client_id, or normalized clientId (legacy / Wix). */
  const invoicePropertiesForClient = useMemo(() => {
    if (!createClientId.trim()) return []
    return invoiceProperties.filter((p) => invoicePropertyMatchesClient(p, createClientId))
  }, [invoiceProperties, createClientId])

  /** Group by property name (district); used by property Select + unit checkbox block. */
  const invoicePropertyGroups = useMemo(() => {
    const map = new Map<
      string,
      { districtLabel: string; units: Array<{ id: string; unitLabel: string }> }
    >()
    for (const p of invoicePropertiesForClient) {
      const key = invoiceDistrictGroupKey(p)
      const unitLabel = p.unitName.trim() || '(No unit)'
      const cur = map.get(key)
      if (cur) {
        cur.units.push({ id: p.id, unitLabel })
        if (p.propertyName.trim()) cur.districtLabel = p.propertyName.trim()
      } else {
        map.set(key, {
          districtLabel: p.propertyName.trim() || p.unitName.trim() || p.id,
          units: [{ id: p.id, unitLabel }],
        })
      }
    }
    for (const g of map.values()) {
      g.units.sort((a, b) =>
        a.unitLabel.localeCompare(b.unitLabel, undefined, { sensitivity: 'base', numeric: true })
      )
    }
    return [...map.entries()]
      .map(([key, g]) => ({ key, districtLabel: g.districtLabel, units: g.units }))
      .sort((a, b) =>
        a.districtLabel.localeCompare(b.districtLabel, undefined, { sensitivity: 'base', numeric: true })
      )
  }, [invoicePropertiesForClient])

  const [hasAccountingIntegration, setHasAccountingIntegration] = useState(false)
  /** Mirrors Pricing → Services Provider (`CleanlemonPricingConfig.selectedServices`). */
  const [invoiceAutomationSelectedServices, setInvoiceAutomationSelectedServices] = useState<ServiceKey[]>([])
  const [invoiceAutomationByService, setInvoiceAutomationByService] = useState<
    Partial<Record<ServiceKey, InvoiceAutomationRow>>
  >({})
  const [payments, setPayments] = useState<PaymentRecord[]>(
    []
  )

  const refreshInvoiceAutomationServices = useCallback(async () => {
    if (!String(operatorId || '').trim()) return
    const r = await fetchCleanlemonPricingConfig(operatorId)
    if (!r?.ok || !r.config) {
      setInvoiceAutomationSelectedServices([])
      return
    }
    const raw = r.config.selectedServices
    const safe = Array.isArray(raw)
      ? raw.filter((key): key is ServiceKey => PRICING_SERVICES.some((s) => s.key === key))
      : []
    setInvoiceAutomationSelectedServices(safe)
  }, [operatorId])

  const invoiceAutomationServiceRows = useMemo(() => {
    const set = new Set(invoiceAutomationSelectedServices)
    return PRICING_SERVICES.filter((s) => set.has(s.key))
  }, [invoiceAutomationSelectedServices])

  const patchInvoiceAutomation = useCallback((key: ServiceKey, patch: Partial<InvoiceAutomationRow>) => {
    setInvoiceAutomationByService((prev) => {
      const cur = { ...defaultInvoiceAutomationRow(), ...prev[key] }
      return { ...prev, [key]: { ...cur, ...patch } }
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorInvoices()
      if (cancelled || !r?.ok) return
      const items: Invoice[] = (r.items || []).map((row: any) => ({
        id: String(row.id),
        invoiceNo: String(row.invoiceNo || row.id),
        client: String(row.client || ''),
        clientEmail: String(row.clientEmail || ''),
        property: String(row.description || ''),
        amount: Number(row.amount || 0),
        tax: Number(row.tax || 0),
        total: Number(row.total || 0),
        status: (row.status === 'paid' ? 'paid' : row.status === 'cancelled' ? 'cancelled' : 'overdue'),
        issueDate: String(row.issueDate || new Date().toISOString().split('T')[0]),
        dueDate: String(row.dueDate || new Date().toISOString().split('T')[0]),
        paidDate: row.paidDate || undefined,
        items: [],
      }))
      setInvoices(items)
      setPayments(
        items
          .filter((inv) => inv.status === 'paid' && inv.paidDate)
          .map((inv) => ({
            id: `PAY-${inv.id}`,
            invoiceId: inv.id,
            invoiceNo: inv.invoiceNo,
            client: inv.client,
            amount: inv.total,
            paymentMethod: 'bank',
            paymentDate: inv.paidDate as string,
            status: 'completed',
          }))
      )
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorInvoiceFormOptions(operatorId)
      if (cancelled || !r?.ok) return
      if (Array.isArray(r.clients)) {
        setInvoiceClients(
          r.clients.map((item: any) => ({
            id: String(item.id),
            name: String(item.name || item.id),
            email: String(item.email || ''),
          }))
        )
      }
      if (Array.isArray(r.properties)) {
        setInvoiceProperties(
          r.properties.map((item: any) => ({
            id: String(item.id),
            clientId: String(item.clientId ?? item.client_id ?? '').trim(),
            clientdetailId: String(item.clientdetailId ?? item.clientdetail_id ?? '').trim(),
            clientIdRaw: String(item.clientIdRaw ?? item.client_id_raw ?? '').trim(),
            name: String(item.name || item.id),
            propertyName: String(item.propertyName ?? item.propertyname ?? '').trim(),
            unitName: String(item.unitName ?? item.unitname ?? '').trim(),
          }))
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  useEffect(() => {
    void refreshInvoiceAutomationServices()
  }, [refreshInvoiceAutomationServices])

  useEffect(() => {
    setCreateLines((prev) =>
      prev.map((l) => ({
        ...l,
        propertyId: '',
        propertySearch: '',
        districtKey: '',
      }))
    )
  }, [createClientId])

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = inv.invoiceNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.property.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesTab = activeTab === 'all' || inv.status === activeTab
    const issueDate = new Date(inv.issueDate)
    const issueMonth = String(issueDate.getMonth() + 1)
    const issueYear = String(issueDate.getFullYear())
    const matchesMonth = filterMonth === 'all' || issueMonth === filterMonth
    const matchesYear = filterYear === 'all' || issueYear === filterYear
    return matchesSearch && matchesTab && matchesMonth && matchesYear
  })

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedInvoices(filteredInvoices.map(inv => inv.id))
    } else {
      setSelectedInvoices([])
    }
  }

  const handleSelectInvoice = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedInvoices(prev => [...prev, id])
    } else {
      setSelectedInvoices(prev => prev.filter(i => i !== id))
    }
  }

  const handleSendInvoice = (invoice: Invoice) => {
    toast.success(`Invoice ${invoice.invoiceNo} sent to ${invoice.clientEmail}`)
  }

  const handleBulkAction = (action: string) => {
    toast.success(`${action} ${selectedInvoices.length} invoices`)
    setSelectedInvoices([])
  }

  const handleOpenMarkAsPaid = (invoice: Invoice) => {
    setMarkAsPaidInvoice(invoice)
    setPaymentMethod('bank')
    setPaymentDate(new Date().toISOString().split('T')[0])
  }

  const handleConfirmMarkAsPaid = async () => {
    if (!markAsPaidInvoice) return
    const inv = markAsPaidInvoice
    const r = await updateOperatorInvoiceStatus(inv.id, 'paid', {
      operatorId,
      paymentMethod,
      paymentDate,
    })
    if (!r?.ok) {
      toast.error(r?.reason || 'Failed to record payment in accounting')
      return
    }

    setInvoices((prev) =>
      prev.map((i) => (i.id === inv.id ? { ...i, status: 'paid', paidDate: paymentDate } : i))
    )

    const paymentRecord: PaymentRecord = {
      id: `PAY-${inv.id}-${Date.now()}`,
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      client: inv.client,
      amount: inv.total,
      paymentMethod,
      paymentDate,
      status: 'completed',
    }
    setPayments((prev) => [paymentRecord, ...prev.filter((p) => p.invoiceId !== inv.id)])

    toast.success(`Invoice ${inv.invoiceNo} marked as paid`)
    setMarkAsPaidInvoice(null)
  }

  const handleVoidPayment = async (invoice: Invoice) => {
    if (invoice.status !== 'paid') return
    const r = await updateOperatorInvoiceStatus(invoice.id, 'overdue', { operatorId })
    if (!r?.ok) {
      toast.error(r?.reason || 'Failed to void payment in accounting')
      return
    }
    const now = new Date().toISOString().split('T')[0]
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === invoice.id ? { ...inv, status: 'overdue', paidDate: undefined } : inv))
    )
    setPayments((prev) =>
      prev.map((payment) =>
        payment.invoiceId === invoice.id
          ? { ...payment, status: 'voided', voidedAt: now }
          : payment
      )
    )
    toast.success(`Payment for ${invoice.invoiceNo} has been voided`)
  }

  const handleDeleteInvoice = async () => {
    if (!deleteInvoice) return
    if (deleteInvoice.status === 'paid') {
      toast.error(`Please void payment for ${deleteInvoice.invoiceNo} before deleting invoice`)
      return
    }
    const r = await deleteOperatorInvoice(deleteInvoice.id, operatorId)
    if (!r?.ok) {
      toast.error(r?.reason || 'Failed to delete invoice')
      return
    }
    setInvoices((prev) => prev.filter((inv) => inv.id !== deleteInvoice.id))
    setSelectedInvoices((prev) => prev.filter((id) => id !== deleteInvoice.id))
    setPayments((prev) => prev.filter((payment) => payment.invoiceId !== deleteInvoice.id))
    if (viewInvoice?.id === deleteInvoice.id) {
      setViewInvoice(null)
    }
    toast.success(`Invoice ${deleteInvoice.invoiceNo} deleted`)
    setDeleteInvoice(null)
  }

  const paymentForInvoice = (invoiceId: string) =>
    payments.find((payment) => payment.invoiceId === invoiceId && payment.status === 'completed')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await fetchOperatorSettings(operatorId)
      if (cancelled || !s?.ok) return
      const parsed = s.settings || {}
      const hasAccounting = Boolean(parsed?.bukku || parsed?.xero)
      setHasAccountingIntegration(hasAccounting)
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorAccountingMappings(operatorId)
      if (cancelled) return
      if (!r?.ok || !Array.isArray(r.items)) {
        setAccountingProductOptions(fallbackAccountingProductLabels())
        return
      }
      const titles = (r.items as Array<{ cleanlemonsAccount?: string; isProduct?: boolean }>)
        .filter((row) => row.isProduct === true)
        .map((row) => String(row.cleanlemonsAccount || '').trim())
        .filter(Boolean)
      setAccountingProductOptions(titles.length > 0 ? titles : fallbackAccountingProductLabels())
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  const handleSaveEditInvoice = () => {
    if (!editInvoice) return
    void updateOperatorInvoice(editInvoice.id, {
      invoiceNo: editInvoice.invoiceNo,
      clientId: invoiceClients.find((c) => c.name === editInvoice.client)?.id || '',
      description: editInvoice.property,
      amount: editInvoice.amount,
      status: editInvoice.status,
    })
    setInvoices((prev) => prev.map((inv) => (inv.id === editInvoice.id ? editInvoice : inv)))
    toast.success(`Invoice ${editInvoice.invoiceNo} updated`)
    setEditInvoice(null)
  }

  const handleCreateInvoice = async () => {
    const selectedClient = invoiceClients.find((c) => c.id === createClientId)
    if (!selectedClient) {
      toast.error('Please select a client')
      return
    }
    for (const row of createLines) {
      if (!row.propertyId.trim()) {
        toast.error('Each line item needs a property and unit')
        return
      }
      const propRow = invoiceProperties.find((p) => p.id === row.propertyId)
      if (!propRow || !invoicePropertyMatchesClient(propRow, createClientId)) {
        toast.error('Line item property must belong to the selected client')
        return
      }
      if (!row.product.trim()) {
        toast.error('Please select a product for each line item')
        return
      }
      if (row.qty <= 0 || row.rate <= 0) {
        toast.error('Quantity and rate must be greater than 0 for each line')
        return
      }
    }
    const amount = Number(
      createLines.reduce((sum, row) => sum + row.qty * row.rate, 0).toFixed(2)
    )
    const tax = 0
    const total = amount
    const invoiceNo = `INV-${Date.now()}`
    const description = buildAccountingInvoiceDescription({
      dateYmd: createInvoiceDate,
      lines: createLines.map((row) => {
        const p = invoiceProperties.find((x) => x.id === row.propertyId)
        return {
          product: row.product.trim(),
          description: row.description,
          propertyLabel: invoicePropertyRowLabel(p),
        }
      }),
    })
    const r = await createOperatorInvoice({
      invoiceNo,
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      description,
      amount,
      issueDate: createInvoiceDate,
      dueDate: createInvoiceDate,
      operatorId,
      lines: createLines.map((row) => {
        const p = invoiceProperties.find((x) => x.id === row.propertyId)
        const propLabel = invoicePropertyRowLabel(p)
        const extra = propLabel && propLabel !== '—' ? `[${propLabel}] ` : ''
        return {
          product: row.product.trim(),
          qty: row.qty,
          rate: row.rate,
          description: `${extra}${String(row.description || '').trim()}`.trim(),
          propertyId: row.propertyId,
        }
      }),
    })
    if (!r?.ok) {
      toast.error(r?.reason || 'Failed to create invoice')
      return
    }
    const finalNo = r.invoiceNo != null && String(r.invoiceNo).trim() !== '' ? String(r.invoiceNo).trim() : invoiceNo
    const created: Invoice = {
      id: String(r.id || invoiceNo),
      invoiceNo: finalNo,
      client: selectedClient.name,
      clientEmail: selectedClient.email,
      property: description,
      amount,
      tax,
      total,
      status: 'overdue',
      issueDate: createInvoiceDate,
      dueDate: createInvoiceDate,
      items: createLines.map((row) => ({
        description: row.product,
        quantity: row.qty,
        rate: row.rate,
        amount: Number((row.qty * row.rate).toFixed(2)),
      })),
    }
    setInvoices((prev) => [created, ...prev])
    setCreateInvoiceOpen(false)
    toast.success('Invoice created')
  }

  const stats = {
    total: invoices.reduce((sum, inv) => sum + inv.total, 0),
    paid: invoices.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + inv.total, 0),
    pending: invoices.filter(inv => inv.status === 'overdue').reduce((sum, inv) => sum + inv.total, 0),
    overdue: invoices.filter(inv => inv.status === 'overdue').reduce((sum, inv) => sum + inv.total, 0),
  }
  const availableYears = Array.from(
    new Set(invoices.map((inv) => String(new Date(inv.issueDate).getFullYear())))
  ).sort((a, b) => Number(b) - Number(a))

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoices & Receipts</h1>
          <p className="text-muted-foreground">Manage billing and payments</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog
            open={invoiceAutomationOpen}
            onOpenChange={(open) => {
              setInvoiceAutomationOpen(open)
              if (open) void refreshInvoiceAutomationServices()
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline">
                <Settings2 className="h-4 w-4 mr-2" />
                Invoice Automation
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Invoice Automation</DialogTitle>
                <DialogDescription>
                  Configure invoice generation timing by service provider
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6 py-2">
                {invoiceAutomationServiceRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No services enabled. Add services under Pricing → Services Provider.
                  </p>
                ) : (
                  invoiceAutomationServiceRows.map((svc) => {
                    const row = { ...defaultInvoiceAutomationRow(), ...invoiceAutomationByService[svc.key] }
                    return (
                      <div key={svc.key} className="space-y-3 rounded-lg border p-4">
                        <h4 className="font-medium">{svc.label}</h4>
                        <Select
                          value={row.mode}
                          onValueChange={(value: AutomationMode) => patchInvoiceAutomation(svc.key, { mode: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="during_booking">Invoice during booking</SelectItem>
                            <SelectItem value="after_work">Invoice after work</SelectItem>
                            <SelectItem value="monthly">Invoice by monthly</SelectItem>
                          </SelectContent>
                        </Select>
                        {row.mode === 'monthly' && (
                          <div className="space-y-3 rounded-md bg-muted/40 p-3">
                            <Label>Monthly schedule</Label>
                            <Select
                              value={row.monthlyMode}
                              onValueChange={(value: MonthlyScheduleMode) =>
                                patchInvoiceAutomation(svc.key, { monthlyMode: value })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="first_day">First day of every month</SelectItem>
                                <SelectItem value="last_day">Last day of every month</SelectItem>
                                <SelectItem value="specific_day">Specific day of every month</SelectItem>
                              </SelectContent>
                            </Select>
                            {row.monthlyMode === 'specific_day' && (
                              <div className="space-y-2">
                                <Label>Day of month</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={31}
                                  value={row.specificDay}
                                  onChange={(e) => patchInvoiceAutomation(svc.key, { specificDay: e.target.value })}
                                  placeholder="1 - 31"
                                />
                                <p className="text-xs text-muted-foreground">
                                  If day 31 is selected, invoice will be generated on the last day for shorter months
                                  (e.g. Feb 28/29).
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInvoiceAutomationOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    toast.success('Invoice automation updated')
                    setInvoiceAutomationOpen(false)
                  }}
                >
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={createInvoiceOpen}
            onOpenChange={(open) => {
              setCreateInvoiceOpen(open)
              if (!open) {
                setCreateLines([newCreateInvoiceLine()])
                setCreateClientId('')
                setCreateInvoiceDate(new Date().toISOString().split('T')[0])
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Invoice
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-5xl">
            <DialogHeader className="space-y-1 border-b border-border/70 bg-muted/20 px-6 py-5 text-left">
              <DialogTitle className="text-xl font-semibold tracking-tight">
                Create New Invoice
              </DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                Pick the bill-to client, then add lines — each line has its own property, unit, and amounts.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 px-6 py-5">
              <div className="space-y-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Receipt className="h-4 w-4" />
                  </div>
                  <div>
                    <Label className="text-base font-medium">Client</Label>
                    <p className="text-xs text-muted-foreground">
                      Required — properties below are filtered to this client.
                    </p>
                  </div>
                </div>
                <Popover modal={false} open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={clientPickerOpen}
                      className="h-11 w-full justify-between border-input bg-background font-normal shadow-none hover:bg-muted/40"
                    >
                      <span className="truncate">
                        {createClientId
                          ? clientsSortedAZ.find((c) => c.id === createClientId)?.name ?? 'Select client'
                          : 'Search or select client…'}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                    onWheelCapture={(e) => e.stopPropagation()}
                  >
                    <Command>
                      <CommandInput placeholder="Search client…" />
                      <CommandList
                        className="max-h-[320px] overflow-y-auto overscroll-contain"
                        onWheelCapture={(e) => e.stopPropagation()}
                      >
                        <CommandEmpty>No client found.</CommandEmpty>
                        <CommandGroup>
                          {clientsSortedAZ.map((client) => (
                            <CommandItem
                              key={client.id}
                              value={`${client.name} ${client.email || ''} ${client.id}`}
                              onSelect={() => {
                                setCreateClientId(client.id)
                                setClientPickerOpen(false)
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4 shrink-0',
                                  createClientId === client.id ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                                <span className="truncate">{client.name}</span>
                                {client.email ? (
                                  <span className="truncate text-xs text-muted-foreground">{client.email}</span>
                                ) : null}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  Invoice date
                </Label>
                <Input
                  type="date"
                  className="h-10 max-w-xs border-border/80 shadow-none"
                  value={createInvoiceDate}
                  onChange={(e) => setCreateInvoiceDate(e.target.value)}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary/40 text-secondary-foreground">
                    <LayoutList className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold leading-none">Line items</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Products match Accounting mappings; each line includes property and unit.
                    </p>
                  </div>
                </div>
                <div className="space-y-4">
                  {createLines.map((line, lineIndex) => {
                    const lineDistrictFiltered = filteredDistrictGroupsForLine(
                      {
                        propertySearch: line.propertySearch,
                        districtKey: line.districtKey,
                      },
                      invoicePropertyGroups
                    )
                    const lineDistrictGroup =
                      invoicePropertyGroups.find((g) => g.key === line.districtKey) ?? null
                    return (
                      <div
                        key={line.id}
                        className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm ring-1 ring-black/[0.02] dark:ring-white/[0.04]"
                      >
                        <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-4 py-3">
                          <Badge
                            variant="secondary"
                            className="h-7 rounded-md border border-border/60 bg-primary/10 px-2.5 font-semibold text-primary hover:bg-primary/15"
                          >
                            Line {lineIndex + 1}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            disabled={createLines.length <= 1}
                            onClick={() =>
                              setCreateLines((prev) => prev.filter((l) => l.id !== line.id))
                            }
                            aria-label="Remove line"
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Remove
                          </Button>
                        </div>

                        <div className="space-y-4 p-4">
                          <div className="space-y-3 rounded-lg border border-secondary/40 bg-secondary/10 p-4 dark:bg-secondary/15">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 shrink-0 text-primary" />
                              <span className="text-sm font-semibold text-foreground">
                                Property & unit
                              </span>
                            </div>
                            {!createClientId ? (
                              <p className="rounded-md border border-dashed border-muted-foreground/30 bg-background/60 px-3 py-2.5 text-sm text-muted-foreground">
                                Select a client above to load their properties.
                              </p>
                            ) : invoicePropertyGroups.length === 0 ? (
                              <p className="rounded-md border border-dashed border-muted-foreground/30 bg-background/60 px-3 py-2.5 text-sm text-muted-foreground">
                                No properties linked to this client yet.
                              </p>
                            ) : (
                              <div className="space-y-3">
                                <div className="relative">
                                  <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                  <Input
                                    className="h-10 border-border/80 bg-background pl-9 shadow-none"
                                    value={line.propertySearch}
                                    onChange={(e) =>
                                      setCreateLines((prev) =>
                                        prev.map((l) =>
                                          l.id === line.id ? { ...l, propertySearch: e.target.value } : l
                                        )
                                      )
                                    }
                                    placeholder="Filter by building name or unit…"
                                  />
                                </div>
                                <Select
                                  value={line.districtKey || undefined}
                                  onValueChange={(key) => {
                                    const g = invoicePropertyGroups.find((x) => x.key === key)
                                    setCreateLines((prev) =>
                                      prev.map((l) => {
                                        if (l.id !== line.id) return l
                                        if (!g) return { ...l, districtKey: key, propertyId: '' }
                                        if (g.units.length === 1) {
                                          return {
                                            ...l,
                                            districtKey: key,
                                            propertyId: g.units[0].id,
                                          }
                                        }
                                        return {
                                          ...l,
                                          districtKey: key,
                                          propertyId: '',
                                        }
                                      })
                                    )
                                  }}
                                >
                                  <SelectTrigger className="h-10 w-full border-border/80 bg-background shadow-none">
                                    <SelectValue placeholder="Choose property title" />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-[240px]">
                                    {lineDistrictFiltered.map((g) => (
                                      <SelectItem key={g.key} value={g.key}>
                                        <span className="font-medium">{g.districtLabel}</span>
                                        <span className="ml-2 text-xs text-muted-foreground">
                                          ({g.units.length} unit{g.units.length === 1 ? '' : 's'})
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {lineDistrictGroup ? (
                                  lineDistrictGroup.units.length === 1 ? (
                                    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-sm">
                                      <span className="text-muted-foreground">Unit</span>
                                      <span className="font-medium tabular-nums text-foreground">
                                        {lineDistrictGroup.units[0].unitLabel}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
                                      <p className="border-b border-border/50 bg-muted/30 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Unit number — pick one
                                      </p>
                                      <div className="max-h-[168px] space-y-0.5 overflow-y-auto p-2">
                                        {lineDistrictGroup.units.map((u) => (
                                          <label
                                            key={u.id}
                                            className={cn(
                                              'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors',
                                              line.propertyId === u.id
                                                ? 'bg-accent/25 ring-1 ring-primary/25'
                                                : 'hover:bg-muted/50'
                                            )}
                                          >
                                            <Checkbox
                                              checked={line.propertyId === u.id}
                                              onCheckedChange={(checked) => {
                                                setCreateLines((prev) =>
                                                  prev.map((l) =>
                                                    l.id === line.id
                                                      ? {
                                                          ...l,
                                                          propertyId: checked
                                                            ? u.id
                                                            : l.propertyId === u.id
                                                              ? ''
                                                              : l.propertyId,
                                                        }
                                                      : l
                                                  )
                                                )
                                              }}
                                            />
                                            <span className="min-w-0 flex-1 break-words font-medium">
                                              {u.unitLabel}
                                            </span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                ) : null}
                                <div
                                  className={cn(
                                    'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5 text-sm',
                                    line.propertyId
                                      ? 'border-primary/20 bg-primary/[0.06]'
                                      : 'border-dashed border-muted-foreground/25 bg-muted/20'
                                  )}
                                >
                                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    Selected
                                  </span>
                                  <span className="font-medium text-foreground">
                                    {line.propertyId
                                      ? invoicePropertyRowLabel(
                                          invoiceProperties.find((p) => p.id === line.propertyId)
                                        )
                                      : 'Not set'}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="rounded-lg border border-border/60 bg-muted/15 p-4">
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Billing
                            </p>
                            <div className="grid grid-cols-12 gap-3 items-end">
                              <div className="col-span-12 space-y-1.5 sm:col-span-5">
                                <span className="text-xs font-medium text-muted-foreground">Product</span>
                                <Select
                                  value={line.product || undefined}
                                  onValueChange={(v) =>
                                    setCreateLines((prev) =>
                                      prev.map((l) => (l.id === line.id ? { ...l, product: v } : l))
                                    )
                                  }
                                >
                                  <SelectTrigger className="h-10 border-border/80 bg-background shadow-none">
                                    <SelectValue placeholder="Select product" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {accountingProductOptions.map((product) => (
                                      <SelectItem key={product} value={product}>
                                        {product}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="col-span-4 space-y-1.5 sm:col-span-2">
                                <span className="text-xs font-medium text-muted-foreground">Qty</span>
                                <Input
                                  type="number"
                                  min={1}
                                  className="h-10 border-border/80 shadow-none"
                                  value={line.qty}
                                  onChange={(e) =>
                                    setCreateLines((prev) =>
                                      prev.map((l) =>
                                        l.id === line.id ? { ...l, qty: Number(e.target.value || 1) } : l
                                      )
                                    )
                                  }
                                />
                              </div>
                              <div className="col-span-4 space-y-1.5 sm:col-span-2">
                                <span className="text-xs font-medium text-muted-foreground">Rate</span>
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className="h-10 border-border/80 shadow-none"
                                  value={line.rate || ''}
                                  onChange={(e) =>
                                    setCreateLines((prev) =>
                                      prev.map((l) =>
                                        l.id === line.id ? { ...l, rate: Number(e.target.value || 0) } : l
                                      )
                                    )
                                  }
                                />
                              </div>
                              <div className="col-span-4 flex flex-col justify-end pb-0.5 sm:col-span-3">
                                <span className="text-xs font-medium text-muted-foreground">Line total</span>
                                <span className="text-base font-semibold tabular-nums text-primary">
                                  RM {(line.qty * line.rate).toFixed(2)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label
                              htmlFor={`inv-line-desc-${line.id}`}
                              className="text-sm font-medium"
                            >
                              Description
                            </Label>
                            <Textarea
                              id={`inv-line-desc-${line.id}`}
                              value={line.description}
                              onChange={(e) =>
                                setCreateLines((prev) =>
                                  prev.map((l) =>
                                    l.id === line.id ? { ...l, description: e.target.value } : l
                                  )
                                )
                              }
                              placeholder="Optional — shown on the accounting line"
                              rows={2}
                              className="min-h-[72px] resize-y border-border/80 bg-background shadow-none"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    className="h-11 w-full border-2 border-dashed border-muted-foreground/30 bg-transparent text-muted-foreground shadow-none transition-colors hover:border-primary/40 hover:bg-accent/30 hover:text-foreground"
                    onClick={() => setCreateLines((prev) => [...prev, newCreateInvoiceLine()])}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add another line
                  </Button>
                </div>
              </div>
            </div>
              <DialogFooter className="gap-2 border-t border-border/70 bg-muted/10 px-6 py-4 sm:justify-end">
                <Button variant="outline" onClick={() => setCreateInvoiceOpen(false)}>
                  Cancel
                </Button>
                <Button className="min-w-[120px] font-semibold shadow-sm" onClick={() => void handleCreateInvoice()}>
                  Create invoice
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Receipt className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Invoiced</p>
                <p className="text-xl font-bold">RM {stats.total.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Paid</p>
                <p className="text-xl font-bold text-green-600">RM {stats.paid.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-xl font-bold text-blue-600">RM {stats.pending.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overdue</p>
                <p className="text-xl font-bold text-red-600">RM {stats.overdue.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="paid">Paid</TabsTrigger>
                <TabsTrigger value="overdue">Overdue</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 lg:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search invoices..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={filterMonth} onValueChange={setFilterMonth}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  <SelectItem value="1">Jan</SelectItem>
                  <SelectItem value="2">Feb</SelectItem>
                  <SelectItem value="3">Mar</SelectItem>
                  <SelectItem value="4">Apr</SelectItem>
                  <SelectItem value="5">May</SelectItem>
                  <SelectItem value="6">Jun</SelectItem>
                  <SelectItem value="7">Jul</SelectItem>
                  <SelectItem value="8">Aug</SelectItem>
                  <SelectItem value="9">Sep</SelectItem>
                  <SelectItem value="10">Oct</SelectItem>
                  <SelectItem value="11">Nov</SelectItem>
                  <SelectItem value="12">Dec</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterYear} onValueChange={setFilterYear}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {availableYears.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <Filter className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setActiveTab('all')}>All</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveTab('paid')}>Paid</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveTab('overdue')}>Overdue</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setFilterMonth('all')}>All Months</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilterYear('all')}>All Years</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selectedInvoices.length > 0 && (
            <div className="flex items-center gap-2 mb-4 p-3 bg-muted rounded-lg">
              <span className="text-sm font-medium">{selectedInvoices.length} selected</span>
              <div className="flex-1" />
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleBulkAction('Delete')}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          )}

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedInvoices.length === filteredInvoices.length && filteredInvoices.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" className="h-auto p-0 font-medium">
                      Invoice
                      <ArrowUpDown className="h-3 w-3 ml-1" />
                    </Button>
                  </TableHead>
                  <TableHead className="hidden md:table-cell">Client</TableHead>
                  <TableHead className="hidden lg:table-cell">Property</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Due Date</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => {
                  const StatusIcon = statusConfig[invoice.status].icon
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedInvoices.includes(invoice.id)}
                          onCheckedChange={(checked) => handleSelectInvoice(invoice.id, !!checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() =>
                            hasAccountingIntegration ? setViewInvoice(invoice) : setEditInvoice(invoice)
                          }
                          className={
                            hasAccountingIntegration
                              ? 'font-medium text-primary hover:underline'
                              : 'font-medium text-foreground hover:underline'
                          }
                        >
                          {invoice.invoiceNo}
                        </button>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{invoice.client}</TableCell>
                      <TableCell
                        className="hidden lg:table-cell max-w-[220px] truncate align-top"
                        title={invoice.property}
                      >
                        {invoice.property}
                      </TableCell>
                      <TableCell className="font-medium">RM {invoice.total.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge className={statusConfig[invoice.status].color}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {statusConfig[invoice.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {new Date(invoice.dueDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {hasAccountingIntegration && (
                              <DropdownMenuItem onClick={() => setViewInvoice(invoice)}>
                                <Eye className="h-4 w-4 mr-2" />
                                Preview Invoice
                              </DropdownMenuItem>
                            )}
                            {hasAccountingIntegration && paymentForInvoice(invoice.id) && (
                              <DropdownMenuItem onClick={() => setViewPayment(paymentForInvoice(invoice.id) || null)}>
                                <Receipt className="h-4 w-4 mr-2" />
                                Preview Payment
                              </DropdownMenuItem>
                            )}
                            {hasAccountingIntegration && <DropdownMenuSeparator />}
                            {invoice.status === 'overdue' && (
                              <DropdownMenuItem onClick={() => handleOpenMarkAsPaid(invoice)}>
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                                Mark as Paid
                              </DropdownMenuItem>
                            )}
                            {invoice.status === 'paid' && (
                              <DropdownMenuItem onClick={() => handleVoidPayment(invoice)}>
                                <XCircle className="h-4 w-4 mr-2" />
                                Void Payment
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setEditInvoice(invoice)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            {invoice.status !== 'paid' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteInvoice(invoice)}>
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Preview Sheet */}
      <Sheet open={!!viewInvoice} onOpenChange={() => setViewInvoice(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {viewInvoice && (
            <>
              <SheetHeader>
                <SheetTitle>Invoice {viewInvoice.invoiceNo}</SheetTitle>
                <SheetDescription>Invoice details and line items</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 py-6">
                {/* Status */}
                <div className="flex items-center justify-between">
                  <Badge className={statusConfig[viewInvoice.status].color}>
                    {statusConfig[viewInvoice.status].label}
                  </Badge>
                </div>

                {/* Client Info */}
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">Bill To</h4>
                  <div>
                    <p className="font-medium">{viewInvoice.client}</p>
                    <p className="text-sm text-muted-foreground">{viewInvoice.clientEmail}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">Accounting description</h4>
                  <p className="text-sm whitespace-pre-wrap rounded-md border bg-muted/30 p-3">
                    {viewInvoice.property || '—'}
                  </p>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Issue Date</p>
                    <p className="font-medium">{new Date(viewInvoice.issueDate).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Due Date</p>
                    <p className="font-medium">{new Date(viewInvoice.dueDate).toLocaleDateString()}</p>
                  </div>
                </div>

                {/* Line Items */}
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">Line Items</h4>
                  <div className="border rounded-lg divide-y">
                    {viewInvoice.items.map((item, idx) => (
                      <div key={idx} className="p-3 flex justify-between">
                        <div>
                          <p className="font-medium">{item.description}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.quantity} x RM {item.rate.toFixed(2)}
                          </p>
                        </div>
                        <p className="font-medium">RM {item.amount.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  {viewInvoice.tax > 0 ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span>Subtotal</span>
                        <span>RM {viewInvoice.amount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Tax</span>
                        <span>RM {viewInvoice.tax.toFixed(2)}</span>
                      </div>
                    </>
                  ) : null}
                  <div className="flex justify-between font-semibold text-lg border-t pt-2">
                    <span>Total</span>
                    <span>RM {viewInvoice.total.toFixed(2)}</span>
                  </div>
                </div>

                {viewInvoice.status === 'paid' && viewInvoice.paidDate && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-green-700">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-medium">Paid on {new Date(viewInvoice.paidDate).toLocaleDateString()}</span>
                    </div>
                  </div>
                )}

                {viewInvoice.status === 'overdue' && (
                  <Button className="w-full">
                    <Mail className="h-4 w-4 mr-2" />
                    Send Payment Reminder
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!markAsPaidInvoice} onOpenChange={(open) => !open && setMarkAsPaidInvoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as Paid</DialogTitle>
            <DialogDescription>
              {markAsPaidInvoice ? `Record payment for ${markAsPaidInvoice.invoiceNo}` : 'Record payment details'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={(value: 'cash' | 'bank') => setPaymentMethod(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Payment Date</Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkAsPaidInvoice(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmMarkAsPaid}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteInvoice} onOpenChange={(open) => !open && setDeleteInvoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Invoice</DialogTitle>
            <DialogDescription>
              {deleteInvoice ? `Delete ${deleteInvoice.invoiceNo}? This action cannot be undone.` : 'Confirm delete invoice'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteInvoice(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteInvoice}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewPayment} onOpenChange={(open) => !open && setViewPayment(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment Preview</DialogTitle>
            <DialogDescription>Payment receipt details</DialogDescription>
          </DialogHeader>
          {viewPayment && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Invoice</p>
                  <p className="font-medium">{viewPayment.invoiceNo}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Client</p>
                  <p className="font-medium">{viewPayment.client}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Amount</p>
                  <p className="font-medium">RM {viewPayment.amount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Payment Method</p>
                  <p className="font-medium">{viewPayment.paymentMethod === 'bank' ? 'Bank' : 'Cash'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Payment Date</p>
                  <p className="font-medium">{new Date(viewPayment.paymentDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Badge className={viewPayment.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}>
                    {viewPayment.status === 'completed' ? 'Completed' : 'Voided'}
                  </Badge>
                </div>
              </div>
              {viewPayment.voidedAt && (
                <p className="text-sm text-muted-foreground">Voided at {new Date(viewPayment.voidedAt).toLocaleDateString()}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editInvoice} onOpenChange={(open) => !open && setEditInvoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Invoice</DialogTitle>
            <DialogDescription>
              {editInvoice ? `Update ${editInvoice.invoiceNo}` : 'Update invoice detail'}
            </DialogDescription>
          </DialogHeader>
          {editInvoice && (
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>Client</Label>
                <Input
                  value={editInvoice.client}
                  onChange={(e) => setEditInvoice((prev) => (prev ? { ...prev, client: e.target.value } : prev))}
                />
              </div>
              <div className="space-y-2">
                <Label>Property</Label>
                <Input
                  value={editInvoice.property}
                  onChange={(e) => setEditInvoice((prev) => (prev ? { ...prev, property: e.target.value } : prev))}
                />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={editInvoice.dueDate}
                  onChange={(e) => setEditInvoice((prev) => (prev ? { ...prev, dueDate: e.target.value } : prev))}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={editInvoice.status}
                  onValueChange={(value: Invoice['status']) =>
                    setEditInvoice((prev) => (prev ? { ...prev, status: value } : prev))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditInvoice(null)}>Cancel</Button>
            <Button onClick={handleSaveEditInvoice}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
