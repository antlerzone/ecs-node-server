"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import {
  fetchClientPortalInvoices,
  fetchClientPortalOperatorBankTransferInfo,
  postClientPortalInvoicesCreatePayment,
  postClientPortalInvoicesConfirmPayment,
  postClientPortalInvoiceReceiptUpload,
} from '@/lib/cleanlemon-api'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  FileText,
  Download,
  DollarSign,
  CheckCircle2,
  Clock,
  AlertCircle,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Search,
  Loader2,
  Filter,
  ChevronDown,
  FileSpreadsheet,
  ExternalLink,
  Receipt,
  MoreHorizontal,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

type RowStatus = 'paid' | 'pending' | 'overdue'

type InvoiceSortKey = 'invoice' | 'issue' | 'due' | 'balanceTotal' | 'operator' | 'remark' | 'status'

function operatorSortLabel(inv: InvoiceRow, nameById: Map<string, string>): string {
  const n = String(inv.operatorName || '').trim()
  if (n) return n.toLowerCase()
  const oid = String(inv.operatorId || '').trim()
  if (oid && nameById.has(oid)) return String(nameById.get(oid) || '').toLowerCase()
  return ''
}

function SortableTableHead({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
  rightAlign,
}: {
  label: string
  sortKey: InvoiceSortKey
  activeKey: InvoiceSortKey | null
  dir: 'asc' | 'desc'
  onSort: (k: InvoiceSortKey) => void
  className?: string
  rightAlign?: boolean
}) {
  const active = activeKey === sortKey
  return (
    <TableHead className={cn(rightAlign && 'text-right', className)}>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 select-none font-medium text-foreground hover:text-primary hover:underline-offset-2',
          rightAlign ? 'w-full justify-end text-right' : 'text-left',
        )}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        {active ? (
          dir === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          )
        ) : (
          <span className="inline-flex flex-col leading-none opacity-35" aria-hidden>
            <ChevronUp className="h-2.5 w-2.5 -mb-0.5" />
            <ChevronDown className="h-2.5 w-2.5" />
          </span>
        )}
      </button>
    </TableHead>
  )
}

interface InvoiceReceipt {
  receiptUrl: string
  paymentDate: string
  receiptNumber: string
  transactionId?: string
  amount: number | null
  /** Client portal bank-transfer proof; not “paid” until operator confirms */
  isPortalProof?: boolean
}

interface InvoiceRow {
  id: string
  invoiceNumber: string
  property: string
  unit: string
  period: string
  /** YYYY-MM-DD from API issueDate — for year filter */
  issueDateYmd: string
  amount: number
  /** Outstanding MYR (0 when paid). */
  balanceAmount: number
  dueDate: string
  status: RowStatus
  paidDate?: string
  operatorId: string
  operatorName: string
  /** Bukku / portal invoice PDF or short link */
  pdfUrl?: string | null
  /** Latest payment receipt attachment URL */
  receiptUrl?: string | null
  /** All receipt attachments (same invoice) */
  receipts: InvoiceReceipt[]
  /** Unpaid + has client-uploaded portal receipt awaiting operator */
  hasPendingPortalReceipt?: boolean
  /** When invoice is billed to another clientdetail (e.g. property owner) but visible to you via shared property group */
  sharedFromClientRemark?: string | null
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

function isHttpUrl(s: string | null | undefined): s is string {
  const t = String(s || '').trim()
  return /^https?:\/\//i.test(t)
}

function normalizeInvoiceDescription(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'object') {
    try {
      const j = raw as Record<string, unknown>
      const keys = ['line1', 'address', 'street', 'city', 'building', 'name', 'title', 'description'] as const
      const parts = keys
        .map((k) => {
          const v = j[k]
          if (v == null || v === 'undefined') return ''
          const s = String(v).trim()
          if (!s || s === 'undefined') return ''
          return s
        })
        .filter(Boolean)
      if (parts.length) return parts.join(', ')
    } catch {
      /* fall through */
    }
  }
  let s = String(raw).trim()
  s = s.replace(/\bundefined\b/gi, '').replace(/\s+/g, ' ').trim()
  return s || '—'
}

function parseReceiptsList(raw: unknown): InvoiceReceipt[] {
  if (!Array.isArray(raw)) return []
  const out: InvoiceReceipt[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const receiptUrl = String(o.receiptUrl || '').trim()
    if (!isHttpUrl(receiptUrl)) continue
    const isPortalProof =
      o.isPortalProof === true ||
      o.isPortalProof === 1 ||
      String(o.isPortalProof) === '1' ||
      String(o.isPortalProof).toLowerCase() === 'true'
    out.push({
      receiptUrl,
      paymentDate: String(o.paymentDate || '').trim(),
      receiptNumber: String(o.receiptNumber || '').trim(),
      transactionId: String(o.transactionId || '').trim() || undefined,
      amount: o.amount != null && Number.isFinite(Number(o.amount)) ? Number(o.amount) : null,
      isPortalProof,
    })
  }
  return out
}

function mapApiRow(r: Record<string, unknown>): InvoiceRow {
  const id = String(r.id || '')
  const invoiceNumber = String(r.invoiceNo ?? r.invoiceNumber ?? id)
  const description = normalizeInvoiceDescription(r.description ?? r.desc)
  const amount = Number(r.total ?? r.amount ?? 0)
  const balRaw = r.balanceAmount ?? r.balance_amount
  const balanceAmount = Number.isFinite(Number(balRaw)) ? Number(balRaw) : amount
  const st = String(r.status || '').toLowerCase()
  let status: RowStatus = 'pending'
  if (st === 'paid') status = 'paid'
  else if (st === 'overdue') status = 'overdue'
  const issueDate = String(r.issueDate || '').slice(0, 10)
  const dueDate = String(r.dueDate || '').slice(0, 10)
  const paidDate = r.paidDate ? String(r.paidDate).slice(0, 10) : undefined
  const operatorId = String(r.operatorId ?? r.operator_id ?? '').trim()
  const operatorName = String(r.operatorName ?? r.operator_name ?? '').trim()
  const pdfRaw = r.pdfUrl ?? r.pdf_url
  const rcptRaw = r.receiptUrl ?? r.receipt_url
  const pdfUrl = isHttpUrl(String(pdfRaw)) ? String(pdfRaw).trim() : null
  const receiptUrl = isHttpUrl(String(rcptRaw)) ? String(rcptRaw).trim() : null
  const fromApi = parseReceiptsList(r.receipts)
  const receipts =
    fromApi.length > 0
      ? fromApi
      : receiptUrl
        ? [{ receiptUrl, paymentDate: paidDate || '', receiptNumber: '', amount: amount, isPortalProof: false }]
        : []
  const hasPendingPortalReceipt =
    status !== 'paid' && receipts.some((x) => Boolean(x.isPortalProof))
  const sharedRaw = r.sharedFromClientRemark ?? r.shared_from_client_remark
  const sharedFromClientRemark =
    sharedRaw != null && String(sharedRaw).trim() !== '' ? String(sharedRaw).trim() : null
  return {
    id,
    invoiceNumber,
    property: description || '—',
    unit: '',
    period: issueDate ? `Issued ${issueDate}` : '',
    issueDateYmd: issueDate,
    amount,
    balanceAmount,
    dueDate: dueDate || '—',
    status,
    paidDate,
    operatorId,
    operatorName: operatorName || (operatorId ? operatorId.slice(0, 8) + '…' : ''),
    pdfUrl,
    receiptUrl,
    receipts,
    hasPendingPortalReceipt,
    sharedFromClientRemark,
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

/** Not paid — can tick row / header “select all on this page”. */
function isSelectableInvoice(inv: InvoiceRow) {
  return inv.status !== 'paid'
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
  const headers = ['Invoice No', 'Description', 'Issue date', 'Due', 'Status', 'Amount (RM)', 'Operator', 'Bill to (shared)', 'Paid date']
  const data = rows.map((inv) => [
    inv.invoiceNumber,
    inv.property,
    inv.issueDateYmd || '',
    inv.dueDate,
    getStatusInfo(inv.status).label,
    String(inv.amount),
    inv.operatorName,
    inv.sharedFromClientRemark || '',
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

function InvoicesPageClient() {
  const { user } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = String(user?.email || '').trim().toLowerCase()
  const operatorId = String(user?.operatorId || '').trim()
  const receiptFileRef = useRef<HTMLInputElement>(null)
  const checkoutSuccessHandledRef = useRef(false)

  const [checkoutSuccessOpen, setCheckoutSuccessOpen] = useState(false)
  /** True when user returned from Stripe / Billplz / Xendit (not legacy `?checkout=success`). */
  const [checkoutSuccessViaGateway, setCheckoutSuccessViaGateway] = useState(false)
  const [checkoutCtx, setCheckoutCtx] = useState<{ invoiceIds: string[]; operatorId: string } | null>(null)
  const [receiptUploadBusy, setReceiptUploadBusy] = useState(false)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [payLoading, setPayLoading] = useState(false)
  const [bankTransferDialog, setBankTransferDialog] = useState<null | {
    reason:
      | 'STRIPE_CONNECT_REQUIRED'
      | 'AMOUNT_BELOW_STRIPE_MINIMUM'
      | 'AMOUNT_BELOW_ONLINE_MINIMUM'
      | 'BANK_TRANSFER_ONLY'
    totalMyr: number
    operatorName: string
    bankName: string
    accountNumber: string
    accountHolder: string
    companyName: string
    invoiceIds: string[]
    operatorId: string
  }>(null)
  const [bankTransferReceiptOpen, setBankTransferReceiptOpen] = useState(false)
  const [bankTransferReceiptFile, setBankTransferReceiptFile] = useState<File | null>(null)
  const [bankTransferReceiptBusy, setBankTransferReceiptBusy] = useState(false)
  const [receiptsDialogInvoice, setReceiptsDialogInvoice] = useState<InvoiceRow | null>(null)
  const [pageSize, setPageSize] = useState(20)
  const [pageIndex, setPageIndex] = useState(0)
  const [sortKey, setSortKey] = useState<InvoiceSortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [activeTab, setActiveTab] = useState('all')
  /** Default all years — a single calendar year was hiding invoices issued in other years. */
  const [yearFilter, setYearFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [operatorFilter, setOperatorFilter] = useState('all')
  /** Inclusive YYYY-MM-DD on issue date */
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [operatorOptions, setOperatorOptions] = useState<
    Array<{
      id: string
      name: string
      stripeConnected?: boolean
      billplzClientInvoice?: boolean
      xenditClientInvoice?: boolean
    }>
  >([])

  const load = useCallback(async () => {
    if (!email) {
      setLoading(false)
      setInvoices([])
      setOperatorOptions([])
      setLoadError(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const r = await fetchClientPortalInvoices(email, String(operatorId || '').trim(), {
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
      setOperatorOptions(
        ops.map((o) => ({
          id: String(o.id),
          name: String(o.name || o.id),
          stripeConnected: Boolean((o as { stripeConnected?: boolean }).stripeConnected),
          billplzClientInvoice: Boolean((o as { billplzClientInvoice?: boolean }).billplzClientInvoice),
          xenditClientInvoice: Boolean((o as { xenditClientInvoice?: boolean }).xenditClientInvoice),
        })),
      )
    } catch {
      setLoadError('Could not load invoices')
      setInvoices([])
      setOperatorOptions([])
    } finally {
      setLoading(false)
    }
  }, [email, operatorId, operatorFilter])

  const operatorNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of operatorOptions) {
      m.set(o.id, o.name)
    }
    return m
  }, [operatorOptions])

  const formatBalanceTotal = useCallback((inv: InvoiceRow) => {
    const bal = inv.balanceAmount
    const tot = inv.amount
    const fmt = (n: number) =>
      Number(n).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 })
    return `RM ${fmt(bal)} / RM ${fmt(tot)}`
  }, [])

  const displayOperatorName = useCallback(
    (inv: InvoiceRow) => {
      const n = String(inv.operatorName || '').trim()
      if (n) return n
      const oid = String(inv.operatorId || '').trim()
      if (oid && operatorNameById.has(oid)) return String(operatorNameById.get(oid) || '').trim()
      return '—'
    },
    [operatorNameById],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!checkoutSuccessOpen) checkoutSuccessHandledRef.current = false
  }, [checkoutSuccessOpen])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (checkoutSuccessHandledRef.current) return
    const success = searchParams.get('success')
    const legacyCheckout = searchParams.get('checkout')
    const sessionId = String(searchParams.get('session_id') || '').trim()
    const billId = String(
      searchParams.get('bill_id') || searchParams.get('billplz[id]') || '',
    ).trim()
    const checkoutId = String(searchParams.get('checkout_id') || '').trim()
    const provider = String(
      searchParams.get('provider') ||
        (sessionId ? 'stripe' : billId ? 'billplz' : checkoutId ? 'xendit' : ''),
    ).trim()
    const newFlowSuccess = success === '1' && Boolean(sessionId || billId || checkoutId)
    const legacySuccess = legacyCheckout === 'success'
    if (!newFlowSuccess && !legacySuccess) return
    checkoutSuccessHandledRef.current = true
    setCheckoutSuccessViaGateway(Boolean(newFlowSuccess))

    void (async () => {
      if (newFlowSuccess && email) {
        try {
          await postClientPortalInvoicesConfirmPayment({
            email,
            operatorId: String(operatorId || '').trim() || undefined,
            sessionId: sessionId || undefined,
            billId: billId || undefined,
            checkoutId: checkoutId || undefined,
            provider: provider || undefined,
          })
        } catch {
          /* ignore */
        }
      }
      try {
        const raw = sessionStorage.getItem('cln_checkout_ctx')
        if (raw) {
          const o = JSON.parse(raw) as { invoiceIds?: string[]; operatorId?: string }
          setCheckoutCtx({
            invoiceIds: Array.isArray(o.invoiceIds) ? o.invoiceIds.map(String) : [],
            operatorId: String(o.operatorId || '').trim(),
          })
        } else {
          setCheckoutCtx(null)
        }
      } catch {
        setCheckoutCtx(null)
      }
      setCheckoutSuccessOpen(true)
      try {
        sessionStorage.removeItem('cln_checkout_ctx')
      } catch {
        /* ignore */
      }
      const path = pathname || window.location.pathname || '/portal/client/invoices'
      router.replace(path)
      void load()
    })()
  }, [searchParams, pathname, load, email, operatorId, router])

  const stats = useMemo(() => {
    const inYear = invoices.filter((inv) => {
      if (yearFilter === 'all') return true
      if (!inv.issueDateYmd) return true
      return inv.issueDateYmd.startsWith(yearFilter)
    })
    return {
      total: inYear.reduce((acc, inv) => acc + inv.amount, 0),
      paid: inYear.filter((i) => i.status === 'paid').reduce((acc, inv) => acc + inv.amount, 0),
      pending: inYear.filter((i) => i.status === 'pending' || i.status === 'overdue').reduce((acc, inv) => acc + inv.amount, 0),
    }
  }, [invoices, yearFilter])

  const yearFilterLabel = yearFilter === 'all' ? 'All years' : yearFilter

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter((invoice) => {
      if (activeTab !== 'all' && invoice.status !== activeTab) return false
      if (yearFilter !== 'all' && invoice.issueDateYmd && !invoice.issueDateYmd.startsWith(yearFilter)) return false
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

  const handleSortColumn = useCallback((k: InvoiceSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('asc')
    }
  }, [sortKey])

  /** Default: unpaid first (oldest issue date first), then paid. With header sort: user column + direction. */
  const displayInvoices = useMemo(() => {
    const list = [...filteredInvoices]
    const dirMul = sortDir === 'asc' ? 1 : -1
    const ymdTs = (ymd: string) => {
      const s = String(ymd || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.NaN
      return new Date(`${s}T00:00:00.000Z`).getTime()
    }
    const statusRank = (s: RowStatus) => (s === 'overdue' ? 0 : s === 'pending' ? 1 : 2)

    const defaultCmp = (a: InvoiceRow, b: InvoiceRow) => {
      const ra = a.status === 'paid' ? 1 : 0
      const rb = b.status === 'paid' ? 1 : 0
      if (ra !== rb) return ra - rb
      const da = a.issueDateYmd || '9999-99-99'
      const db = b.issueDateYmd || '9999-99-99'
      return da.localeCompare(db)
    }

    const byColumn = (a: InvoiceRow, b: InvoiceRow): number => {
      if (!sortKey) return 0
      switch (sortKey) {
        case 'invoice': {
          const sa = `${a.invoiceNumber}\0${a.property}\0${a.period}`.toLowerCase()
          const sb = `${b.invoiceNumber}\0${b.property}\0${b.period}`.toLowerCase()
          return sa.localeCompare(sb) * dirMul
        }
        case 'issue': {
          const ta = ymdTs(a.issueDateYmd)
          const tb = ymdTs(b.issueDateYmd)
          const na = Number.isFinite(ta)
          const nb = Number.isFinite(tb)
          if (!na && !nb) return 0
          if (!na) return 1
          if (!nb) return -1
          return (ta - tb) * dirMul
        }
        case 'due': {
          const ta = ymdTs(a.dueDate)
          const tb = ymdTs(b.dueDate)
          const na = Number.isFinite(ta)
          const nb = Number.isFinite(tb)
          if (!na && !nb) return 0
          if (!na) return 1
          if (!nb) return -1
          return (ta - tb) * dirMul
        }
        case 'balanceTotal': {
          const c = (a.balanceAmount - b.balanceAmount) * dirMul
          if (c !== 0) return c
          return (a.amount - b.amount) * dirMul
        }
        case 'operator': {
          const sa = operatorSortLabel(a, operatorNameById)
          const sb = operatorSortLabel(b, operatorNameById)
          const c = sa.localeCompare(sb) * dirMul
          if (c !== 0) return c
          return a.invoiceNumber.localeCompare(b.invoiceNumber) * dirMul
        }
        case 'remark': {
          const sa = String(a.sharedFromClientRemark || '').toLowerCase()
          const sb = String(b.sharedFromClientRemark || '').toLowerCase()
          const c = sa.localeCompare(sb) * dirMul
          if (c !== 0) return c
          return a.invoiceNumber.localeCompare(b.invoiceNumber) * dirMul
        }
        case 'status': {
          return (statusRank(a.status) - statusRank(b.status)) * dirMul
        }
        default:
          return 0
      }
    }

    list.sort((a, b) => {
      const col = byColumn(a, b)
      if (col !== 0) return col
      return defaultCmp(a, b)
    })
    return list
  }, [filteredInvoices, sortKey, sortDir, operatorNameById])

  const yearChoices = useMemo(() => {
    const ys = new Set<number>()
    ys.add(new Date().getFullYear())
    for (const inv of invoices) {
      if (inv.issueDateYmd && inv.issueDateYmd.length >= 4) ys.add(Number(inv.issueDateYmd.slice(0, 4)))
    }
    return Array.from(ys).sort((a, b) => b - a)
  }, [invoices])

  const filterSummary = useMemo(() => {
    const parts = [yearFilterLabel, statusLabel(activeTab)]
    if (search.trim()) parts.push(`“${search.trim().slice(0, 24)}${search.trim().length > 24 ? '…' : ''}”`)
    return parts.join(' · ')
  }, [yearFilterLabel, activeTab, search])

  useEffect(() => {
    setPageIndex(0)
  }, [activeTab, yearFilter, search, operatorFilter, dateFrom, dateTo, pageSize, sortKey, sortDir])

  useEffect(() => {
    setSelectedIds((prev) => {
      const allowed = new Set(displayInvoices.map((i) => i.id))
      const next = prev.filter((id) => allowed.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [displayInvoices])

  const maxPageIndex = Math.max(0, Math.ceil(displayInvoices.length / pageSize) - 1)
  useEffect(() => {
    if (pageIndex > maxPageIndex) setPageIndex(maxPageIndex)
  }, [pageIndex, maxPageIndex])

  const pagedInvoices = useMemo(() => {
    const start = pageIndex * pageSize
    return displayInvoices.slice(start, start + pageSize)
  }, [displayInvoices, pageIndex, pageSize])

  const selectedInvoices = useMemo(
    () => displayInvoices.filter((i) => selectedIds.includes(i.id)),
    [displayInvoices, selectedIds],
  )

  /** Operator id sent to checkout when row.operatorId is empty (filter / JWT / single linked operator). */
  const checkoutOperatorIdForRow = useCallback(
    (inv: InvoiceRow) => {
      const r = String(inv.operatorId || '').trim()
      if (r) return r
      if (operatorFilter !== 'all') return String(operatorFilter).trim()
      if (String(operatorId || '').trim()) return String(operatorId).trim()
      if (operatorOptions.length === 1) return String(operatorOptions[0].id || '').trim()
      return ''
    },
    [operatorFilter, operatorId, operatorOptions],
  )

  const selectedCheckoutInvoices = useMemo(() => {
    return selectedInvoices.filter((i) => {
      if (i.status === 'paid') return false
      return Boolean(checkoutOperatorIdForRow(i))
    })
  }, [selectedInvoices, checkoutOperatorIdForRow])

  const selectedPayTotal = useMemo(
    () =>
      selectedCheckoutInvoices.reduce(
        (s, i) => s + (Number.isFinite(i.balanceAmount) ? i.balanceAmount : i.amount),
        0,
      ),
    [selectedCheckoutInvoices],
  )

  const toggleSelectInvoice = useCallback((inv: InvoiceRow, checked: boolean) => {
    if (!isSelectableInvoice(inv)) return
    if (checked) {
      setSelectedIds((prev) => {
        if (prev.includes(inv.id)) return prev
        if (prev.length > 0) {
          const first = displayInvoices.find((x) => x.id === prev[0])
          if (first) {
            const a = String(checkoutOperatorIdForRow(first) || '').trim()
            const b = String(checkoutOperatorIdForRow(inv) || '').trim()
            if (a && b && a !== b) {
              toast.error('Only invoices from the same operator can be selected. Each operator has a separate payment account.')
              return prev
            }
          }
        }
        return [...prev, inv.id]
      })
    } else {
      setSelectedIds((prev) => prev.filter((id) => id !== inv.id))
    }
  }, [displayInvoices, checkoutOperatorIdForRow])

  const openBankDialogForInvoices = useCallback(
    async (
      invs: InvoiceRow[],
      reason:
        | 'STRIPE_CONNECT_REQUIRED'
        | 'AMOUNT_BELOW_STRIPE_MINIMUM'
        | 'AMOUNT_BELOW_ONLINE_MINIMUM'
        | 'BANK_TRANSFER_ONLY',
      checkoutOperatorId?: string,
    ) => {
      const op = String(checkoutOperatorId || invs[0]?.operatorId || '').trim()
      if (!op) {
        toast.error('Missing operator for this invoice.')
        return
      }
      const bt = await fetchClientPortalOperatorBankTransferInfo(email, op)
      if (bt?.ok) {
        const totalMyr = invs.reduce((s, i) => s + i.amount, 0)
        const opLabel =
          String(invs[0]?.operatorName || '').trim() ||
          String(operatorOptions.find((x) => x.id === op)?.name || '').trim()
        setBankTransferDialog({
          reason,
          totalMyr,
          operatorName: opLabel,
          bankName: String(bt.bankName || '').trim(),
          accountNumber: String(bt.accountNumber || '').trim(),
          accountHolder: String(bt.accountHolder || '').trim(),
          companyName: String(bt.companyName || '').trim(),
          invoiceIds: [...new Set(invs.map((i) => i.id))],
          operatorId: op,
        })
      } else {
        toast.error('Could not load bank transfer details. Try again later.')
      }
    },
    [email, operatorOptions],
  )

  const openInvoiceCheckout = useCallback(
    async (ids: string[]) => {
      const idSet = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))]
      const invs = displayInvoices.filter((i) => idSet.includes(i.id) && i.status !== 'paid')
      const resolved = invs
        .map((i) => ({ inv: i, op: checkoutOperatorIdForRow(i) }))
        .filter((x) => Boolean(x.op))
      if (resolved.length === 0) {
        toast.error('Cannot pay: choose Operator filter, or link only one operator to your account.')
        return
      }
      const opSet = new Set(resolved.map((x) => x.op))
      if (opSet.size !== 1) {
        toast.error('Only invoices for the same operator can be paid together.')
        return
      }
      const op = [...opSet][0]
      const payRows = resolved.map((x) => x.inv)
      if (payRows.length === 0) {
        toast.error('No unpaid invoices in selection.')
        return
      }
      const totalPay = payRows.reduce(
        (s, i) => s + (Number.isFinite(i.balanceAmount) ? i.balanceAmount : i.amount),
        0,
      )
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const basePath = pathname || '/portal/client/invoices'
      const pathNorm = basePath.startsWith('/') ? basePath : `/${basePath}`
      setPayLoading(true)
      try {
        const r = await postClientPortalInvoicesCreatePayment({
          email,
          operatorId: op,
          invoiceIds: [...new Set(payRows.map((i) => i.id))],
          returnUrl: `${origin}${pathNorm}?success=1`,
          cancelUrl: `${origin}${pathNorm}?cancel=1`,
        })
        if (!r?.ok || r.type !== 'redirect' || !r.url) {
          const reason = String(r?.reason || 'CREATE_PAYMENT_FAILED')
          if (reason === 'NO_ONLINE_PAYMENT') {
            const opOpt = operatorOptions.find((x) => x.id === op)
            const stripeOnlySub2 =
              Boolean(opOpt?.stripeConnected) &&
              totalPay > 0 &&
              totalPay < 2 &&
              !opOpt?.billplzClientInvoice &&
              !opOpt?.xenditClientInvoice
            const anyGateway =
              Boolean(opOpt?.stripeConnected || opOpt?.billplzClientInvoice || opOpt?.xenditClientInvoice)
            if (totalPay > 0 && totalPay < 1 && anyGateway) {
              await openBankDialogForInvoices(payRows, 'AMOUNT_BELOW_ONLINE_MINIMUM', op)
            } else if (stripeOnlySub2) {
              await openBankDialogForInvoices(payRows, 'AMOUNT_BELOW_STRIPE_MINIMUM', op)
            } else {
              await openBankDialogForInvoices(payRows, 'BANK_TRANSFER_ONLY', op)
            }
            return
          }
          if (reason === 'STRIPE_CONNECT_REQUIRED' || reason === 'AMOUNT_BELOW_STRIPE_MINIMUM') {
            await openBankDialogForInvoices(
              payRows,
              reason as 'STRIPE_CONNECT_REQUIRED' | 'AMOUNT_BELOW_STRIPE_MINIMUM',
              op,
            )
            return
          }
          if (reason === 'AMOUNT_BELOW_MINIMUM') {
            await openBankDialogForInvoices(payRows, 'AMOUNT_BELOW_ONLINE_MINIMUM', op)
            return
          }
          if (
            reason === 'BILLPLZ_NOT_CONFIGURED' ||
            reason === 'XENDIT_NOT_CONFIGURED' ||
            reason === 'API_BASE_URL_MISSING'
          ) {
            toast.error('Online payment is not fully set up for this operator. Use bank transfer instead.')
            await openBankDialogForInvoices(payRows, 'BANK_TRANSFER_ONLY', op)
            return
          }
          toast.error('Could not start payment. Try again or pay one invoice at a time.')
          return
        }
        try {
          sessionStorage.setItem(
            'cln_checkout_ctx',
            JSON.stringify({ invoiceIds: [...new Set(payRows.map((i) => i.id))], operatorId: op }),
          )
        } catch {
          /* ignore */
        }
        window.location.href = r.url
      } finally {
        setPayLoading(false)
      }
    },
    [displayInvoices, email, pathname, openBankDialogForInvoices, checkoutOperatorIdForRow, operatorOptions],
  )

  const totalPages = Math.max(1, Math.ceil(displayInvoices.length / pageSize) || 1)
  const pageNumbersToShow = useMemo(() => {
    const total = totalPages
    const cur = pageIndex
    const max = 9
    if (total <= max) return Array.from({ length: total }, (_, i) => i)
    const half = Math.floor(max / 2)
    let start = Math.max(0, cur - half)
    let end = Math.min(total - 1, start + max - 1)
    start = Math.max(0, end - max + 1)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }, [totalPages, pageIndex])

  if (!email) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Sign in to view invoices.</p>
      </div>
    )
  }

  const invoicePaymentCancelled = searchParams.get('cancel') === '1'

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
            disabled={loading || payLoading || selectedCheckoutInvoices.length === 0}
            onClick={() => void openInvoiceCheckout([...new Set(selectedIds)])}
          >
            <CreditCard className="h-4 w-4" />
            {selectedCheckoutInvoices.length > 0 ? `Pay RM ${selectedPayTotal.toLocaleString()}` : 'Pay'}
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

      {invoicePaymentCancelled ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-medium">Payment was cancelled. You can try again when ready.</span>
          <button
            type="button"
            onClick={() => router.replace(pathname || '/portal/client/invoices')}
            className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {selectedIds.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {selectedCheckoutInvoices[0]
            ? `Pay: ${displayOperatorName(selectedCheckoutInvoices[0])} · `
            : null}
          {selectedIds.length} selected
          {selectedCheckoutInvoices.length < selectedIds.length
            ? ` · ${selectedIds.length - selectedCheckoutInvoices.length} cannot resolve operator (filter by one operator, or use a single linked operator)`
            : ' · one operator per payment'}
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
                <span className="hidden sm:inline">Total billed ({yearFilterLabel})</span>
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
                <span className="hidden sm:inline">Paid ({yearFilterLabel})</span>
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
                <span className="hidden sm:inline">Unpaid / pending ({yearFilterLabel})</span>
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
                  <SelectItem value="all">All years</SelectItem>
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
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        pagedInvoices.filter((i) => isSelectableInvoice(i)).length > 0 &&
                        pagedInvoices.filter((i) => isSelectableInvoice(i)).every((i) => selectedIds.includes(i.id))
                      }
                      disabled={pagedInvoices.filter((i) => isSelectableInvoice(i)).length === 0}
                      onCheckedChange={(v) => {
                        const pageSelectable = pagedInvoices.filter((i) => isSelectableInvoice(i)).map((i) => i.id)
                        if (v === true) {
                          setSelectedIds((prev) => Array.from(new Set([...prev, ...pageSelectable])))
                        } else {
                          setSelectedIds((prev) => prev.filter((id) => !pagedInvoices.some((row) => row.id === id)))
                        }
                      }}
                      aria-label="Select all on this page"
                    />
                  </TableHead>
                  <SortableTableHead label="Invoice" sortKey="invoice" activeKey={sortKey} dir={sortDir} onSort={handleSortColumn} />
                  <SortableTableHead
                    label="Issue"
                    sortKey="issue"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSortColumn}
                    className="hidden md:table-cell"
                  />
                  <SortableTableHead
                    label="Due"
                    sortKey="due"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSortColumn}
                    className="hidden sm:table-cell"
                  />
                  <SortableTableHead
                    label="Balance / total"
                    sortKey="balanceTotal"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSortColumn}
                    className="min-w-[100px]"
                    rightAlign
                  />
                  <SortableTableHead
                    label="Operator"
                    sortKey="operator"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSortColumn}
                    className="hidden sm:table-cell"
                  />
                  <SortableTableHead
                    label="Remark"
                    sortKey="remark"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSortColumn}
                    className="hidden xl:table-cell max-w-[140px]"
                  />
                  <SortableTableHead label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={handleSortColumn} />
                  <TableHead className="text-right w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedInvoices.map((invoice) => {
                  const statusInfo = getStatusInfo(invoice.status)
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="align-top">
                        <Checkbox
                          checked={selectedIds.includes(invoice.id)}
                          disabled={!isSelectableInvoice(invoice)}
                          onCheckedChange={(v) => toggleSelectInvoice(invoice, v === true)}
                          aria-label={`Select invoice ${invoice.invoiceNumber}`}
                        />
                      </TableCell>
                      <TableCell className="align-top min-w-[140px]">
                        <p className="font-medium text-sm">{invoice.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{invoice.property}</p>
                        {invoice.sharedFromClientRemark ? (
                          <p className="text-[10px] text-muted-foreground xl:hidden">Bill to: {invoice.sharedFromClientRemark}</p>
                        ) : null}
                        <p className="text-[10px] text-muted-foreground md:hidden">Issue {invoice.issueDateYmd || '—'}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell align-top text-sm tabular-nums">
                        {invoice.issueDateYmd || '—'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell align-top text-sm tabular-nums">{invoice.dueDate}</TableCell>
                      <TableCell className="align-top text-right text-sm font-semibold tabular-nums text-foreground">
                        {formatBalanceTotal(invoice)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell align-top text-xs max-w-[180px] truncate" title={displayOperatorName(invoice)}>
                        {displayOperatorName(invoice)}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell align-top text-xs max-w-[160px]">
                        {invoice.sharedFromClientRemark ? (
                          <Badge variant="secondary" className="font-normal whitespace-normal text-left">
                            Bill to: {invoice.sharedFromClientRemark}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge className={`text-[10px] ${statusInfo.color}`}>{statusInfo.label}</Badge>
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:items-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Invoice actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {invoice.pdfUrl ? (
                                <DropdownMenuItem asChild>
                                  <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer" className="flex cursor-pointer items-center gap-2">
                                    <FileText className="h-4 w-4" />
                                    Invoice
                                    <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-60" />
                                  </a>
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem disabled>Invoice (no file)</DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                disabled={invoice.receipts.length === 0 || Boolean(invoice.hasPendingPortalReceipt)}
                                title={
                                  invoice.hasPendingPortalReceipt
                                    ? 'Receipt is with your operator for verification. It will open here after approval.'
                                    : undefined
                                }
                                onSelect={(e) => {
                                  e.preventDefault()
                                  if (invoice.receipts.length === 0 || invoice.hasPendingPortalReceipt) return
                                  if (invoice.receipts.length === 1) {
                                    window.open(invoice.receipts[0].receiptUrl, '_blank', 'noopener,noreferrer')
                                  } else {
                                    setReceiptsDialogInvoice(invoice)
                                  }
                                }}
                              >
                                <Receipt className="mr-2 h-4 w-4" />
                                Receipt{invoice.receipts.length > 1 ? `s (${invoice.receipts.length})` : ''}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={
                                  payLoading ||
                                  !isSelectableInvoice(invoice) ||
                                  !checkoutOperatorIdForRow(invoice)
                                }
                                onSelect={(e) => {
                                  e.preventDefault()
                                  void openInvoiceCheckout([invoice.id])
                                }}
                              >
                                <CreditCard className="mr-2 h-4 w-4" />
                                Pay now
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3 sm:px-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</Label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => setPageSize(Number(v) || 20)}
                  disabled={loading}
                >
                  <SelectTrigger className="h-9 w-[88px] border-input bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100, 200].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  {displayInvoices.length} total · {totalPages} page{totalPages !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1 sm:ml-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 min-w-9 px-0 bg-background"
                disabled={pageIndex <= 0 || loading}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {pageNumbersToShow[0] > 0 ? (
                <>
                  <Button
                    type="button"
                    variant={pageIndex === 0 ? 'default' : 'outline'}
                    size="sm"
                    className="h-9 min-w-9 px-0 bg-background"
                    disabled={loading}
                    onClick={() => setPageIndex(0)}
                  >
                    1
                  </Button>
                  {pageNumbersToShow[0] > 1 ? (
                    <span className="px-1 text-xs text-muted-foreground" aria-hidden>
                      …
                    </span>
                  ) : null}
                </>
              ) : null}
              {pageNumbersToShow.map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={p === pageIndex ? 'default' : 'outline'}
                  size="sm"
                  className="h-9 min-w-9 px-0 bg-background"
                  disabled={loading}
                  onClick={() => setPageIndex(p)}
                >
                  {p + 1}
                </Button>
              ))}
              {pageNumbersToShow.length > 0 && pageNumbersToShow[pageNumbersToShow.length - 1] < totalPages - 1 ? (
                <>
                  {pageNumbersToShow[pageNumbersToShow.length - 1] < totalPages - 2 ? (
                    <span className="px-1 text-xs text-muted-foreground" aria-hidden>
                      …
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant={pageIndex === totalPages - 1 ? 'default' : 'outline'}
                    size="sm"
                    className="h-9 min-w-9 px-0 bg-background"
                    disabled={loading}
                    onClick={() => setPageIndex(totalPages - 1)}
                  >
                    {totalPages}
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 min-w-9 px-0 bg-background"
                disabled={pageIndex >= maxPageIndex || loading}
                onClick={() => setPageIndex((p) => Math.min(maxPageIndex, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              </div>
            </div>
          </div>

          {!loading && displayInvoices.length === 0 && (
            <Card className="border-border">
              <CardContent className="p-8 text-center text-muted-foreground">No invoice records match your filters.</CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog open={!!receiptsDialogInvoice} onOpenChange={(o) => !o && setReceiptsDialogInvoice(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Receipts</DialogTitle>
            <DialogDescription className="text-left">
              {receiptsDialogInvoice ? `Invoice ${receiptsDialogInvoice.invoiceNumber}` : ''}
            </DialogDescription>
          </DialogHeader>
          {receiptsDialogInvoice && receiptsDialogInvoice.receipts.length > 0 ? (
            <ul className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-sm">
              {receiptsDialogInvoice.receipts.map((rc, idx) => (
                <li key={`${rc.receiptUrl}-${idx}`} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">
                        {rc.receiptNumber || `Receipt ${idx + 1}`}
                      </p>
                      {rc.paymentDate ? (
                        <p className="text-xs text-muted-foreground">Date: {rc.paymentDate}</p>
                      ) : null}
                      {rc.amount != null ? (
                        <p className="text-xs text-muted-foreground">Amount: RM {rc.amount.toLocaleString()}</p>
                      ) : null}
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a href={rc.receiptUrl} target="_blank" rel="noopener noreferrer">
                        Open
                        <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No receipt files for this invoice.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setReceiptsDialogInvoice(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={checkoutSuccessOpen}
        onOpenChange={(o) => {
          if (!o) {
            setCheckoutSuccessOpen(false)
            setCheckoutSuccessViaGateway(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{checkoutSuccessViaGateway ? 'Payment received' : 'Payment submitted'}</DialogTitle>
            <DialogDescription className="text-left">
              {checkoutSuccessViaGateway
                ? 'Thank you. Your online payment is being confirmed; invoice status should update shortly. No receipt upload is needed.'
                : 'Thank you. If your payment went through, your invoices will update shortly. You can upload a bank receipt or proof here so your operator can match the payment faster.'}
            </DialogDescription>
          </DialogHeader>
          {!checkoutSuccessViaGateway ? (
            <input
              ref={receiptFileRef}
              type="file"
              accept="image/*,.pdf,application/pdf"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                const ids = checkoutCtx?.invoiceIds?.length ? checkoutCtx.invoiceIds : []
                const op = String(checkoutCtx?.operatorId || operatorId || '').trim()
                if (!ids.length || !op) {
                  toast.error('Could not determine which invoices to attach. Open Invoices and upload from receipt menu if needed.')
                  return
                }
                setReceiptUploadBusy(true)
                try {
                  const r = await postClientPortalInvoiceReceiptUpload({
                    email,
                    operatorId: op,
                    invoiceIds: ids,
                    file,
                  })
                  if (!r?.ok) {
                    toast.error(String(r?.reason || 'Upload failed'))
                    return
                  }
                  toast.success('Receipt uploaded')
                  setCheckoutSuccessOpen(false)
                  setCheckoutSuccessViaGateway(false)
                  setCheckoutCtx(null)
                  void load()
                } finally {
                  setReceiptUploadBusy(false)
                }
              }}
            />
          ) : null}
          <DialogFooter className={checkoutSuccessViaGateway ? '' : 'flex-col gap-2 sm:flex-row'}>
            {!checkoutSuccessViaGateway ? (
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                disabled={receiptUploadBusy}
                onClick={() => receiptFileRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {receiptUploadBusy ? 'Uploading…' : 'Upload receipt'}
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => {
                setCheckoutSuccessOpen(false)
                setCheckoutSuccessViaGateway(false)
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!bankTransferDialog}
        onOpenChange={(o) => {
          if (!o) {
            setBankTransferDialog(null)
            setBankTransferReceiptOpen(false)
            setBankTransferReceiptFile(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay by bank transfer</DialogTitle>
            {bankTransferDialog?.reason === 'BANK_TRANSFER_ONLY' ? (
              <DialogDescription className="sr-only">Bank transfer payment details</DialogDescription>
            ) : (
              <DialogDescription className="text-left text-sm text-muted-foreground">
                {bankTransferDialog?.reason === 'AMOUNT_BELOW_STRIPE_MINIMUM'
                  ? 'Card payments require at least RM 2. Pay this amount by bank transfer using the details below.'
                  : bankTransferDialog?.reason === 'AMOUNT_BELOW_ONLINE_MINIMUM'
                    ? 'This total is below RM 1, so the usual online payment link cannot be used. Pay by bank transfer using the details below.'
                    : 'This operator has not connected online card payment. Pay by bank transfer using the details below (same as Company → bank account on the operator side).'}
              </DialogDescription>
            )}
          </DialogHeader>
          {bankTransferDialog ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount to pay</p>
                <p className="text-lg font-bold tabular-nums text-foreground">
                  RM {bankTransferDialog.totalMyr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {bankTransferDialog.operatorName ? (
                  <p className="text-xs text-muted-foreground mt-1">To: {bankTransferDialog.operatorName}</p>
                ) : null}
              </div>
              {bankTransferDialog.bankName ||
              bankTransferDialog.accountNumber ||
              bankTransferDialog.accountHolder ? (
                <dl className="space-y-2">
                  {bankTransferDialog.companyName ? (
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Company</dt>
                      <dd className="font-medium text-foreground">{bankTransferDialog.companyName}</dd>
                    </div>
                  ) : null}
                  {bankTransferDialog.bankName ? (
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Bank name</dt>
                      <dd className="font-medium text-foreground">{bankTransferDialog.bankName}</dd>
                    </div>
                  ) : null}
                  {bankTransferDialog.accountNumber ? (
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Account number</dt>
                      <dd className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-medium text-foreground">{bankTransferDialog.accountNumber}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            void navigator.clipboard.writeText(bankTransferDialog.accountNumber)
                            toast.success('Account number copied')
                          }}
                        >
                          Copy
                        </Button>
                      </dd>
                    </div>
                  ) : null}
                  {bankTransferDialog.accountHolder ? (
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Account holder</dt>
                      <dd className="font-medium text-foreground">{bankTransferDialog.accountHolder}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This operator has not saved bank account details in Company settings yet. Please contact them for payment instructions.
                </p>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              className="gap-2"
              onClick={() => {
                setBankTransferReceiptFile(null)
                setBankTransferReceiptOpen(true)
              }}
            >
              <Upload className="h-4 w-4" />
              Upload receipt
            </Button>
            <Button
              type="button"
              onClick={() => {
                setBankTransferDialog(null)
                setBankTransferReceiptOpen(false)
                setBankTransferReceiptFile(null)
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bankTransferReceiptOpen && !!bankTransferDialog}
        onOpenChange={(o) => {
          if (!o) {
            setBankTransferReceiptOpen(false)
            setBankTransferReceiptFile(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload receipt</DialogTitle>
            <DialogDescription className="text-left text-sm text-muted-foreground">
              Attach a photo or PDF of your bank transfer. It is saved with the invoices you are paying.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="file"
              accept="image/*,.pdf,application/pdf"
              disabled={bankTransferReceiptBusy}
              onChange={(e) => {
                const f = e.target.files?.[0] || null
                setBankTransferReceiptFile(f)
              }}
            />
            {bankTransferReceiptFile ? (
              <p className="text-sm text-muted-foreground truncate" title={bankTransferReceiptFile.name}>
                Selected: {bankTransferReceiptFile.name}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={bankTransferReceiptBusy}
              onClick={() => {
                setBankTransferReceiptOpen(false)
                setBankTransferReceiptFile(null)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={bankTransferReceiptBusy || !bankTransferReceiptFile || !bankTransferDialog?.invoiceIds?.length}
              onClick={async () => {
                const file = bankTransferReceiptFile
                const ctx = bankTransferDialog
                if (!file || !ctx?.invoiceIds?.length || !String(ctx.operatorId || '').trim()) {
                  toast.error('Choose a file first.')
                  return
                }
                setBankTransferReceiptBusy(true)
                try {
                  const r = await postClientPortalInvoiceReceiptUpload({
                    email,
                    operatorId: String(ctx.operatorId).trim(),
                    invoiceIds: ctx.invoiceIds,
                    file,
                  })
                  if (!r?.ok) {
                    toast.error(String(r?.reason || 'Upload failed'))
                    return
                  }
                  toast.success('Receipt uploaded')
                  setBankTransferReceiptOpen(false)
                  setBankTransferReceiptFile(null)
                  void load()
                } finally {
                  setBankTransferReceiptBusy(false)
                }
              }}
            >
              {bankTransferReceiptBusy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-6 text-muted-foreground">Loading…</div>}>
      <InvoicesPageClient />
    </Suspense>
  )
}
