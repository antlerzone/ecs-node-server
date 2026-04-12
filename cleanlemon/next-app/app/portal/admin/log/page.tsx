'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search } from 'lucide-react'
import {
  fetchAdminLockUnlockLogLockOptions,
  fetchAdminLockUnlockLogs,
  type AdminLockUnlockLogRow,
} from '@/lib/cleanlemon-api'

function defaultDateRange() {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 14)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(from), to: fmt(to) }
}

export default function AdminLockUnlockLogPage() {
  const { from: defFrom, to: defTo } = defaultDateRange()
  const [from, setFrom] = useState(defFrom)
  const [to, setTo] = useState(defTo)
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [lockdetailId, setLockdetailId] = useState<string>('')
  const [lockOptions, setLockOptions] = useState<{ lockdetailId: string; label: string }[]>([])
  const [items, setItems] = useState<AdminLockUnlockLogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 50
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadOptions = useCallback(async () => {
    const r = await fetchAdminLockUnlockLogLockOptions()
    if (r.ok && Array.isArray(r.items)) setLockOptions(r.items)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchAdminLockUnlockLogs({
        q: appliedQ.trim() || undefined,
        lockdetailId: lockdetailId || undefined,
        from,
        to,
        page,
        pageSize,
      })
      if (!r.ok) {
        setError(r.reason || 'Failed to load')
        setItems([])
        setTotal(0)
        return
      }
      setItems(r.items || [])
      setTotal(r.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [appliedQ, lockdetailId, from, to, page])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Door unlock log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Remote unlocks initiated through our platform (Node → TTLock). Not TTLock app Bluetooth.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Search by email, date range, and lock.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="q">Email contains</Label>
              <Input
                id="q"
                placeholder="user@example.com"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(1)
                    setAppliedQ(q)
                  }
                }}
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1 min-w-[200px]">
              <Label>Lock</Label>
              <Select
                value={lockdetailId || '__all__'}
                onValueChange={(v) => {
                  setLockdetailId(v === '__all__' ? '' : v)
                  setPage(1)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All locks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All locks</SelectItem>
                  {lockOptions.map((o) => (
                    <SelectItem key={o.lockdetailId} value={o.lockdetailId}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              onClick={() => {
                setPage(1)
                setAppliedQ(q)
              }}
              disabled={loading}
            >
              <Search className="w-4 h-4 mr-2" />
              Search
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
          <CardDescription>
            {total} row(s) · page {page} of {totalPages}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Lock</TableHead>
                  <TableHead>TTLock ID</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Job</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      No rows.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {row.createdAt
                          ? new Date(row.createdAt).toLocaleString()
                          : '—'}
                      </TableCell>
                      <TableCell className="text-sm">{row.actorEmail || '—'}</TableCell>
                      <TableCell className="text-sm max-w-[220px] truncate" title={row.lockAlias || row.lockName || row.lockdetailId}>
                        {row.lockAlias || row.lockName || row.lockdetailId}
                      </TableCell>
                      <TableCell className="text-sm font-mono">{row.ttlockLockId ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.portalSource || '—'}</TableCell>
                      <TableCell className="text-sm font-mono">{row.jobId || '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-between items-center mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
