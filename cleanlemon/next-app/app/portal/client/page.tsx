"use client"

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ArrowRight, Sparkles } from 'lucide-react'
import { useClientBookingNav } from '@/components/portal/client/client-booking-overlay'
import {
  fetchClientPortalInvoices,
  fetchOperatorProperties,
  fetchOperatorScheduleJobs,
  fetchClientDamageReports,
  type DamageReportItem,
} from '@/lib/cleanlemon-api'
import { damageReportDateLabel } from '@/lib/damage-report-dates'
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
  const { openBooking } = useClientBookingNav()
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
        const email = String(user?.email || '').trim().toLowerCase()
        const [propRes, schRes, invRes, dmgRes] = await Promise.all([
          fetchOperatorProperties(operatorId || undefined),
          fetchOperatorScheduleJobs({ operatorId: operatorId || undefined, limit: 500 }),
          email && operatorId
            ? fetchClientPortalInvoices(email, operatorId, { limit: 200 })
            : Promise.resolve({ ok: false as const, items: [] }),
          email
            ? fetchClientDamageReports({ email, operatorId: operatorId || undefined, limit: 5 })
            : Promise.resolve({ ok: false as const, items: [] as DamageReportItem[] }),
        ])

        if (cancelled) return

        if (dmgRes?.ok && Array.isArray(dmgRes.items)) setDamageRecent(dmgRes.items)

        const props = Array.isArray(propRes?.items) ? propRes.items : []
        const schedules = Array.isArray(schRes?.items) ? schRes.items : []
        const invoices = Array.isArray(invRes?.items) ? invRes.items : []
        const upcoming = schedules.filter((x: any) => {
          const st = String(x?.status || '').toLowerCase()
          return !(st.includes('complete') || st.includes('cancel'))
        }).length

        const completed = schedules.filter((x: any) =>
          String(x?.status || '').toLowerCase().includes('complete')
        ).length

        const pendingInvoices = invoices.filter((x: any) => {
          const st = String(x?.status || '').toLowerCase()
          return st === 'pending' || st === 'overdue' || st === 'unpaid'
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
    () =>
      [
        { label: 'Properties', shortLabel: 'Props', value: summary.properties },
        { label: 'Upcoming Jobs', shortLabel: 'Upcoming', value: summary.upcoming },
        { label: 'Completed Jobs', shortLabel: 'Completed', value: summary.completed },
        { label: 'Pending Invoices', shortLabel: 'Unpaid', value: summary.pendingInvoices },
      ] as const,
    [summary]
  )

  return (
    <div className="space-y-3 px-4 pb-6 pt-2 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground md:text-base">Overview for your client account</p>
        </div>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="hidden shrink-0 gap-2 md:inline-flex"
          onClick={() => openBooking()}
        >
          <Sparkles className="h-4 w-4" />
          Booking
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 md:gap-6">
          <Suspense fallback={null}>
            <ScrollToScheduleWhenTab />
          </Suspense>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4 lg:gap-4">
            {cards.map((card) => (
              <Card
                key={card.label}
                className="flex w-full min-w-0 flex-col gap-0 overflow-visible rounded-xl border-0 p-0 py-0 shadow-sm"
              >
                <CardContent className="flex w-full flex-col items-center justify-center gap-1 px-1.5 py-3 text-center sm:gap-1.5 sm:px-4 sm:py-4 md:py-5">
                  <p className="text-base font-bold tabular-nums leading-tight text-foreground sm:text-xl">
                    {card.value}
                  </p>
                  <p className="w-full max-w-full text-balance text-[10px] leading-normal text-muted-foreground sm:text-xs">
                    <span className="sm:hidden">{card.shortLabel}</span>
                    <span className="hidden sm:inline">{card.label}</span>
                  </p>
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
                  <CardDescription>Property, operator, date</CardDescription>
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
                        {damageReportDateLabel(d)}
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
