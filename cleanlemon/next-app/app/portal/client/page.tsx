"use client"

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Building2, Calendar, CheckCircle2, Clock, AlertTriangle, ArrowRight } from 'lucide-react'
import {
  fetchOperatorInvoices,
  fetchOperatorProperties,
  fetchOperatorScheduleJobs,
  fetchClientDamageReports,
  type DamageReportItem,
} from '@/lib/cleanlemon-api'
import { ClientDashboardSchedule } from '@/components/portal/client/client-dashboard-schedule'

function ScrollToScheduleWhenTab() {
  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get('tab') !== 'schedule') return
    const id = window.setTimeout(() => {
      document.getElementById('client-schedule')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
    return () => window.clearTimeout(id)
  }, [searchParams])
  return null
}

type Summary = {
  properties: number
  upcoming: number
  completed: number
  pendingInvoices: number
}

export default function ClientDashboardPage() {
  const { user } = useAuth()
  const [damageRecent, setDamageRecent] = useState<DamageReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<Summary>({
    properties: 0,
    upcoming: 0,
    completed: 0,
    pendingInvoices: 0,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const operatorId = String(user?.operatorId || '').trim()
        const [propRes, schRes, invRes, dmgRes] = await Promise.all([
          fetchOperatorProperties(operatorId || undefined),
          fetchOperatorScheduleJobs({ operatorId: operatorId || undefined, limit: 500 }),
          fetchOperatorInvoices(),
          fetchClientDamageReports({ operatorId: operatorId || undefined, limit: 5 }),
        ])

        if (cancelled) return

        if (dmgRes?.ok && Array.isArray(dmgRes.items)) setDamageRecent(dmgRes.items)

        const props = Array.isArray(propRes?.items) ? propRes.items : []
        const schedules = Array.isArray(schRes?.items) ? schRes.items : []
        const invoices = Array.isArray(invRes?.items) ? invRes.items : []
        const email = String(user?.email || '').trim().toLowerCase()

        const upcoming = schedules.filter((x: any) => {
          const st = String(x?.status || '').toLowerCase()
          return !(st.includes('complete') || st.includes('cancel'))
        }).length

        const completed = schedules.filter((x: any) =>
          String(x?.status || '').toLowerCase().includes('complete')
        ).length

        const pendingInvoices = invoices.filter((x: any) => {
          const st = String(x?.status || '').toLowerCase()
          const em = String(x?.clientEmail || '').trim().toLowerCase()
          const mine = !em || em === email
          return mine && (st === 'pending' || st === 'overdue' || st === 'unpaid')
        }).length

        setSummary({
          properties: props.length,
          upcoming,
          completed,
          pendingInvoices,
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.operatorId, user?.email])

  const cards = useMemo(
    () => [
      { label: 'Properties', value: summary.properties, icon: Building2 },
      { label: 'Upcoming Jobs', value: summary.upcoming, icon: Calendar },
      { label: 'Completed Jobs', value: summary.completed, icon: CheckCircle2 },
      { label: 'Pending Invoices', value: summary.pendingInvoices, icon: Clock },
    ],
    [summary]
  )

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Overview for your client account</p>
      </div>
      {loading ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="space-y-6">
          <Suspense fallback={null}>
            <ScrollToScheduleWhenTab />
          </Suspense>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((card) => (
              <Card key={card.label}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <card.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-foreground">{card.value}</p>
                      <p className="text-xs text-muted-foreground">{card.label}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <ClientDashboardSchedule />

          {damageRecent.length > 0 ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    Recent damage reports
                  </CardTitle>
                  <CardDescription>Property, operator, when reported</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/client/damage">
                    View all
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {damageRecent.map((d) => (
                    <div
                      key={d.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 p-3 bg-muted/50 rounded-lg text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{d.propertyName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {d.operatorName || '—'} · {d.staffEmail || '—'}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        {d.reportedAt
                          ? new Date(d.reportedAt).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  )
}
