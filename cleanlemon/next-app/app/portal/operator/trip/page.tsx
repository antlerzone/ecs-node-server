"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useEffectiveOperatorId } from '@/lib/cleanlemon-effective-operator-id'
import {
  fetchOperatorDriverFleetStatus,
  fetchOperatorDriverEmployees,
  fetchOperatorDriverTrips,
  fetchOperatorTeams,
  postOperatorDriverTripGrab,
  uploadEmployeeFileToOss,
  type ClnDriverFleetStatusRow,
  type ClnDriverTripPayload,
  type ClnOperatorDriverEmployeeRow,
} from '@/lib/cleanlemon-api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DataTable, type Column, type Action } from '@/components/shared/data-table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Loader2, Truck, FileDown } from 'lucide-react'
import { toast } from 'sonner'

const MYT = 'Asia/Kuala_Lumpur'

function formatMyt(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString('en-MY', {
      timeZone: MYT,
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return '—'
  }
}

function formatDateKeyInMyt(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MYT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${day}`
}

function utcIsoToMytDateKey(iso: string | null | undefined): string | null {
  if (!iso || !String(iso).trim()) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return formatDateKeyInMyt(d)
}

function tripAddr(t: ClnDriverTripPayload, which: 'pickup' | 'dropoff') {
  const o = t as {
    pickup?: string
    dropoff?: string
    pickupText?: string
    dropoffText?: string
  }
  if (which === 'pickup') return String(o.pickup ?? o.pickupText ?? '').trim()
  return String(o.dropoff ?? o.dropoffText ?? '').trim()
}

function statusLabel(s: string) {
  const x = String(s || '').toLowerCase()
  if (x === 'pending') return 'Pending'
  if (x === 'driver_accepted') return 'Driver accepted'
  if (x === 'grab_booked') return 'Grab booked'
  if (x === 'completed') return 'Completed'
  if (x === 'cancelled') return 'Cancelled'
  return s || '—'
}

function fleetStatusLabel(s: ClnDriverFleetStatusRow['fleetStatus']) {
  switch (s) {
    case 'vacant':
      return 'Vacant'
    case 'waiting':
      return 'Waiting'
    case 'pickup':
      return 'Pickup'
    case 'ongoing':
      return 'Ongoing'
    case 'off_duty':
      return 'Off duty'
    default:
      return s
  }
}

type Row = ClnDriverTripPayload & { id: string }

type FleetRow = ClnDriverFleetStatusRow & { id: string }

export default function OperatorDriverTripsPage() {
  const { user } = useAuth()
  const operatorId = useEffectiveOperatorId(user)
  const [mainTab, setMainTab] = useState<'routes' | 'status'>('routes')

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [businessDate, setBusinessDate] = useState<string>('')
  const [teamFilter, setTeamFilter] = useState<string>('all')
  const [fulfillmentSlot, setFulfillmentSlot] = useState<string>('all')

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [driverEmployees, setDriverEmployees] = useState<ClnOperatorDriverEmployeeRow[]>([])

  const [teamOptions, setTeamOptions] = useState<string[]>([])
  const [pageSize, setPageSize] = useState(20)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTrip, setDetailTrip] = useState<Row | null>(null)

  const [grabOpen, setGrabOpen] = useState(false)
  const [grabTrip, setGrabTrip] = useState<Row | null>(null)
  const [grabPlate, setGrabPlate] = useState('')
  const [grabPhone, setGrabPhone] = useState('')
  const [grabFile, setGrabFile] = useState<File | null>(null)
  const [grabSubmitting, setGrabSubmitting] = useState(false)

  const [fleetRows, setFleetRows] = useState<FleetRow[]>([])
  const [fleetPendingPool, setFleetPendingPool] = useState(0)
  const [fleetLoading, setFleetLoading] = useState(false)
  const [statusDateFilter, setStatusDateFilter] = useState<string>('')
  const [fleetPageSize, setFleetPageSize] = useState(20)

  const fulfillmentParams = useMemo(() => {
    if (fulfillmentSlot === 'grab') return { fulfillment: 'grab' as const }
    if (fulfillmentSlot === 'A' || fulfillmentSlot === 'B' || fulfillmentSlot === 'C') {
      const idx = fulfillmentSlot === 'A' ? 0 : fulfillmentSlot === 'B' ? 1 : 2
      const id = driverEmployees[idx]?.employeeId
      if (!id) return { fulfillment: 'driver' as const }
      return { fulfillment: 'driver' as const, acceptedDriverEmployeeId: id }
    }
    return {}
  }, [fulfillmentSlot, driverEmployees])

  const loadTeams = useCallback(async () => {
    const oid = String(operatorId || '').trim()
    if (!oid) {
      setTeamOptions([])
      return
    }
    const r = (await fetchOperatorTeams(oid)) as { ok?: boolean; items?: unknown[] }
    const raw = r?.items
    const names: string[] = []
    if (Array.isArray(raw)) {
      for (const t of raw) {
        const o = t as { name?: string; title?: string }
        const n = String(o?.name ?? o?.title ?? '').trim()
        if (n) names.push(n)
      }
    }
    setTeamOptions([...new Set(names)].sort((a, b) => a.localeCompare(b)))
  }, [operatorId])

  const loadDrivers = useCallback(async () => {
    const oid = String(operatorId || '').trim()
    if (!oid) {
      setDriverEmployees([])
      return
    }
    const r = await fetchOperatorDriverEmployees(oid)
    if (r.ok && Array.isArray(r.items)) setDriverEmployees(r.items)
    else setDriverEmployees([])
  }, [operatorId])

  const loadTrips = useCallback(async () => {
    const oid = String(operatorId || '').trim()
    if (!oid) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    const st = statusFilter === 'all' ? undefined : statusFilter
    const tm = teamFilter !== 'all' ? teamFilter : undefined
    const bd = businessDate.trim() || undefined
    const r = await fetchOperatorDriverTrips({
      operatorId: oid,
      status: st,
      limit: 500,
      businessDate: bd,
      team: tm,
      ...fulfillmentParams,
    })
    setLoading(false)
    if (!r.ok) {
      toast.error('Could not load trips')
      setRows([])
      return
    }
    const items = (r.items || []).map((t) => ({ ...t, id: t.id }))
    setRows(items)
  }, [operatorId, statusFilter, businessDate, teamFilter, fulfillmentParams])

  const loadFleet = useCallback(async () => {
    const oid = String(operatorId || '').trim()
    if (!oid) {
      setFleetRows([])
      setFleetPendingPool(0)
      return
    }
    setFleetLoading(true)
    const r = await fetchOperatorDriverFleetStatus(oid)
    setFleetLoading(false)
    if (!r.ok) {
      toast.error('Could not load driver status')
      setFleetRows([])
      setFleetPendingPool(0)
      return
    }
    const items = (r.items || []).map((x) => ({ ...x, id: x.employeeId }))
    setFleetRows(items)
    setFleetPendingPool(r.pendingPoolCount ?? 0)
  }, [operatorId])

  useEffect(() => {
    void loadTeams()
    void loadDrivers()
  }, [loadTeams, loadDrivers])

  useEffect(() => {
    void loadTrips()
  }, [loadTrips])

  useEffect(() => {
    if (mainTab === 'status') void loadFleet()
  }, [mainTab, loadFleet])

  const openDetail = useCallback((row: Row) => {
    setDetailTrip(row)
    setDetailOpen(true)
  }, [])

  const openGrab = useCallback((row: Row) => {
    setGrabTrip(row)
    setGrabPlate('')
    setGrabPhone('')
    setGrabFile(null)
    setGrabOpen(true)
  }, [])

  const submitGrab = async () => {
    const oid = String(operatorId || '').trim()
    const trip = grabTrip
    if (!oid || !trip) return
    const plate = grabPlate.trim()
    const phone = grabPhone.trim()
    if (!plate && !phone && !grabFile) {
      toast.error('Enter plate, phone, or attach an image')
      return
    }
    setGrabSubmitting(true)
    let proofUrl = ''
    if (grabFile) {
      const up = await uploadEmployeeFileToOss(grabFile, oid)
      if (!up.ok || !up.url) {
        toast.error(up.reason || 'Upload failed')
        setGrabSubmitting(false)
        return
      }
      proofUrl = up.url
    }
    const r = await postOperatorDriverTripGrab({
      operatorId: oid,
      tripId: trip.id,
      grabCarPlate: plate || undefined,
      grabPhone: phone || undefined,
      grabProofImageUrl: proofUrl || undefined,
    })
    setGrabSubmitting(false)
    if (!r.ok) {
      toast.error(r.reason === 'TRIP_NOT_OPEN' ? 'Trip is no longer open for Grab.' : 'Could not save Grab details')
      void loadTrips()
      return
    }
    toast.success('Grab details saved — employees will see it on their order.')
    setGrabOpen(false)
    void loadTrips()
    void loadFleet()
  }

  const filterPanelActive = useMemo(() => {
    return (
      Boolean(businessDate.trim()) ||
      teamFilter !== 'all' ||
      statusFilter !== 'all' ||
      fulfillmentSlot !== 'all'
    )
  }, [businessDate, teamFilter, statusFilter, fulfillmentSlot])

  const statusFilterPanelActive = Boolean(statusDateFilter.trim())

  const filterExtra = (
    <div className="grid w-full min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(11.5rem,1fr))]">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Date (MY)</Label>
        <Input
          type="date"
          className="h-10"
          value={businessDate}
          onChange={(e) => setBusinessDate(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Team</Label>
        <Select value={teamFilter} onValueChange={setTeamFilter}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue placeholder="Team" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {teamOptions.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="driver_accepted">Driver accepted</SelectItem>
            <SelectItem value="grab_booked">Grab booked</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Fulfillment（谁送这一单）</Label>
        <Select value={fulfillmentSlot} onValueChange={setFulfillmentSlot}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue placeholder="Fulfillment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="grab">Grab</SelectItem>
            {driverEmployees.slice(0, 3).map((d, i) => (
              <SelectItem key={d.employeeId} value={['A', 'B', 'C'][i]}>
                Driver {['A', 'B', 'C'][i]}
                {d.fullName ? ` (${d.fullName})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground leading-snug">
          用来<strong>筛选</strong>：Grab = 公司已订 Grab；Driver A/B/C = 按你公司司机列表<strong>前 3 位</strong>里由谁接单。
        </p>
      </div>
    </div>
  )

  const columns: Column<Row>[] = useMemo(
    () => [
      {
        key: 'requesterTeamName',
        label: 'Team',
        sortable: true,
        render: (_v, row) => (
          <span className="min-w-0 break-words">{row.requesterTeamName?.trim() || '—'}</span>
        ),
      },
      {
        key: 'createdAtUtc',
        label: 'Submitted',
        sortable: true,
        render: (_v, row) => <span className="whitespace-nowrap">{formatMyt(row.createdAtUtc)}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        sortable: true,
        render: (v) => <Badge variant="secondary">{statusLabel(String(v))}</Badge>,
      },
      {
        key: 'requesterFullName',
        label: 'Employee',
        sortable: true,
        render: (_v, row) => (
          <span className="min-w-0 break-words">
            {row.requesterFullName || row.requesterEmail || '—'}
          </span>
        ),
      },
      {
        key: 'fulfillmentType',
        label: 'Fulfillment',
        render: (_v, row) => {
          if (String(row.status) === 'grab_booked') return <span>Grab</span>
          if (String(row.status) === 'driver_accepted')
            return <span className="break-words">{row.acceptedDriverFullName || 'Driver'}</span>
          return <span className="text-muted-foreground">—</span>
        },
      },
    ],
    []
  )

  const actions: Action<Row>[] = useMemo(
    () => [
      {
        label: 'View detail',
        onClick: (row) => openDetail(row),
      },
      {
        label: 'Grab order',
        onClick: (row) => openGrab(row),
        visible: (row) => String(row.status) === 'pending',
      },
    ],
    [openDetail, openGrab]
  )

  const filteredFleetRows = useMemo(() => {
    const d = statusDateFilter.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return fleetRows
    return fleetRows.filter((r) => {
      const t = r.activeTrip
      if (!t) return true
      const key =
        utcIsoToMytDateKey(t.orderTimeUtc) ||
        utcIsoToMytDateKey(t.createdAtUtc) ||
        utcIsoToMytDateKey(t.acceptedAtUtc)
      return !key || key === d
    })
  }, [fleetRows, statusDateFilter])

  const fleetColumns: Column<FleetRow>[] = useMemo(
    () => [
      {
        key: 'fullName',
        label: 'Driver',
        sortable: true,
        render: (_v, row) => <span className="font-medium">{row.fullName || '—'}</span>,
      },
      {
        key: 'email',
        label: 'Email',
        sortable: true,
        render: (v) => <span className="break-all text-sm">{String(v || '—')}</span>,
      },
      {
        key: 'fleetStatus',
        label: 'Status',
        sortable: true,
        render: (v) => {
          const variant =
            v === 'ongoing'
              ? 'default'
              : v === 'pickup'
                ? 'secondary'
                : v === 'waiting'
                  ? 'outline'
                  : v === 'off_duty'
                    ? 'secondary'
                    : 'outline'
          return <Badge variant={variant}>{fleetStatusLabel(v as FleetRow['fleetStatus'])}</Badge>
        },
      },
      {
        key: 'activeTrip',
        label: 'Current route',
        render: (_v, row) => {
          const t = row.activeTrip
          if (!t) return <span className="text-muted-foreground">—</span>
          return (
            <div className="max-w-md space-y-1 text-sm text-muted-foreground">
              <p className="break-words">
                <span className="font-medium text-foreground">From:</span> {t.pickupText || '—'}
              </p>
              <p className="break-words">
                <span className="font-medium text-foreground">To:</span> {t.dropoffText || '—'}
              </p>
            </div>
          )
        },
      },
    ],
    []
  )

  const exportTripsCsv = () => {
    const headers = ['Team', 'Submitted', 'Status', 'Employee', 'Email', 'From', 'To', 'Fulfillment']
    const lines = rows.map((row) => {
      const ff =
        String(row.status) === 'grab_booked'
          ? 'Grab'
          : String(row.status) === 'driver_accepted'
            ? row.acceptedDriverFullName || 'Driver'
            : ''
      return [
        row.requesterTeamName || '',
        row.createdAtUtc || '',
        row.status || '',
        row.requesterFullName || '',
        row.requesterEmail || '',
        tripAddr(row, 'pickup'),
        tripAddr(row, 'dropoff'),
        ff,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(',')
    })
    const bom = '\ufeff'
    const blob = new Blob([bom + [headers.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `driver-routes-${formatDateKeyInMyt(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success('Downloaded CSV (open with Excel)')
  }

  const exportTripsPdf = async () => {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(11)
    doc.text('Driver routes', 14, 16)
    doc.setFontSize(8)
    doc.text(`Generated ${formatMyt(new Date().toISOString())}`, 14, 22)
    autoTable(doc, {
      startY: 26,
      head: [['Team', 'Submitted', 'Status', 'Employee', 'From', 'To', 'Fulfillment']],
      body: rows.map((row) => [
        row.requesterTeamName || '—',
        formatMyt(row.createdAtUtc),
        statusLabel(row.status),
        row.requesterFullName || row.requesterEmail || '—',
        tripAddr(row, 'pickup'),
        tripAddr(row, 'dropoff'),
        String(row.status) === 'grab_booked'
          ? 'Grab'
          : String(row.status) === 'driver_accepted'
            ? row.acceptedDriverFullName || 'Driver'
            : '—',
      ]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [66, 66, 66] },
    })
    doc.save(`driver-routes-${formatDateKeyInMyt(new Date())}.pdf`)
  }

  const exportFleetCsv = () => {
    const headers = ['Driver', 'Email', 'Status', 'From', 'To', 'Order time MY']
    const lines = filteredFleetRows.map((row) => {
      const t = row.activeTrip
      const ot = t ? formatMyt(t.orderTimeUtc || t.createdAtUtc) : ''
      return [
        row.fullName,
        row.email,
        row.fleetStatus,
        t?.pickupText || '',
        t?.dropoffText || '',
        ot,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(',')
    })
    const bom = '\ufeff'
    const blob = new Blob([bom + [headers.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `driver-status-${formatDateKeyInMyt(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success('Downloaded CSV (open with Excel)')
  }

  const exportFleetPdf = async () => {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF()
    doc.setFontSize(11)
    doc.text('Driver status', 14, 16)
    doc.setFontSize(8)
    doc.text(`Open pool pending: ${fleetPendingPool}. ${formatMyt(new Date().toISOString())}`, 14, 22)
    autoTable(doc, {
      startY: 28,
      head: [['Driver', 'Email', 'Status', 'Route']],
      body: filteredFleetRows.map((row) => {
        const t = row.activeTrip
        const route = t ? `${t.pickupText || ''} → ${t.dropoffText || ''}` : '—'
        return [row.fullName, row.email, fleetStatusLabel(row.fleetStatus), route]
      }),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 66, 66] },
    })
    doc.save(`driver-status-${formatDateKeyInMyt(new Date())}.pdf`)
  }

  const reachTimeLabel = (t: Row) => {
    if (String(t.status) === 'grab_booked') return formatMyt(t.grabBookedAtUtc)
    if (String(t.status) === 'driver_accepted') return formatMyt(t.acceptedAtUtc)
    return '—'
  }

  const fleetFilterExtra = (
    <div className="space-y-2">
      <Label htmlFor="fleet-filter-date" className="text-xs text-muted-foreground">
        Order date (MY)
      </Label>
      <Input
        id="fleet-filter-date"
        type="date"
        className="h-10 w-full"
        value={statusDateFilter}
        onChange={(e) => setStatusDateFilter(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Narrows routes by trip date; vacant drivers stay listed.
      </p>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-10">
      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as 'routes' | 'status')}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
            <TabsTrigger value="routes" className="px-4">
              Driver routed
            </TabsTrigger>
            <TabsTrigger value="status" className="px-4">
              Status
            </TabsTrigger>
          </TabsList>
          {mainTab === 'status' ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="gap-2 self-end sm:self-auto">
                  <FileDown className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void exportFleetPdf()}>Export to PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportFleetCsv()}>Export to Excel (CSV)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="gap-2 self-end sm:self-auto">
                  <FileDown className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void exportTripsPdf()}>Export to PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportTripsCsv()}>Export to Excel (CSV)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <TabsContent value="routes" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <Truck className="h-6 w-6 text-primary" aria-hidden />
                <CardTitle className="text-xl">Driver routes</CardTitle>
              </div>
              <CardDescription>
                Employee orders; drivers accept in the Driver app. Use Grab when your team books a ride — employees see
                plate, phone, and photo after you save.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading…
                </div>
              ) : (
                <DataTable<Row>
                  data={rows}
                  columns={columns}
                  actions={actions}
                  stackedOnNarrow
                  searchKeys={
                    [
                      'pickupText',
                      'dropoffText',
                      'requesterEmail',
                      'requesterFullName',
                      'requesterTeamName',
                    ] as (keyof Row)[]
                  }
                  emptyMessage="No trips for this filter."
                  pageSize={pageSize}
                  collapsibleFilters
                  collapsibleFiltersExtraActive={filterPanelActive}
                  collapsibleFilterExtra={filterExtra}
                  pageSizeSelect={{
                    value: pageSize,
                    onChange: setPageSize,
                    options: [10, 20, 50, 100, 200],
                    id: 'trip-routes-page-size',
                  }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="status" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl">Driver status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {fleetLoading ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading…
                </div>
              ) : (
                <DataTable<FleetRow>
                  data={filteredFleetRows}
                  columns={fleetColumns}
                  stackedOnNarrow
                  searchKeys={['fullName', 'email', 'fleetStatus'] as (keyof FleetRow)[]}
                  emptyMessage="No drivers found."
                  pageSize={fleetPageSize}
                  collapsibleFilters
                  collapsibleFiltersExtraActive={statusFilterPanelActive}
                  collapsibleFilterExtra={fleetFilterExtra}
                  pageSizeSelect={{
                    value: fleetPageSize,
                    onChange: setFleetPageSize,
                    options: [10, 20, 50, 100, 200],
                    id: 'trip-fleet-page-size',
                  }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Trip detail</DialogTitle>
          </DialogHeader>
          {detailTrip ? (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Employee</p>
                <p className="font-medium">{detailTrip.requesterFullName || '—'}</p>
                <p className="break-all text-muted-foreground">{detailTrip.requesterEmail || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Order time (MY)</p>
                <p>{formatMyt(detailTrip.orderTimeUtc || detailTrip.createdAtUtc)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {String(detailTrip.status) === 'grab_booked' ? 'Grab booked (MY)' : 'Driver accepted / reach (MY)'}
                </p>
                <p>{reachTimeLabel(detailTrip)}</p>
              </div>
              {detailTrip.driverStartedAtUtc ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Trip started (MY)</p>
                  <p>{formatMyt(detailTrip.driverStartedAtUtc)}</p>
                </div>
              ) : null}
              <div>
                <p className="text-xs font-medium text-muted-foreground">From</p>
                <p className="break-words">{tripAddr(detailTrip, 'pickup') || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">To</p>
                <p className="break-words">{tripAddr(detailTrip, 'dropoff') || '—'}</p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDetailOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={grabOpen} onOpenChange={setGrabOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Grab order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-2">
              <Label htmlFor="grab-plate">Car plate</Label>
              <Input
                id="grab-plate"
                value={grabPlate}
                onChange={(e) => setGrabPlate(e.target.value)}
                placeholder="Optional"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grab-phone">Driver phone / booking ref</Label>
              <Input
                id="grab-phone"
                value={grabPhone}
                onChange={(e) => setGrabPhone(e.target.value)}
                placeholder="Optional"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grab-file">Photo (optional)</Label>
              <Input
                id="grab-file"
                type="file"
                accept="image/*"
                onChange={(e) => setGrabFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setGrabOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitGrab()} disabled={grabSubmitting}>
              {grabSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
