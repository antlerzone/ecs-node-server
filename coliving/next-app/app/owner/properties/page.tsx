"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Building2, User, Calendar, Banknote, FileText, Download, LayoutList } from "lucide-react"
import {
  TenancyCalendarView,
  type TenancyCal,
  type TenancyCalendarExtraRoom,
  type TenancyCalendarScale,
} from "@/components/operator/tenancy-calendar-view"
import { getTodayMalaysiaYmd, tenancyDbDateToMalaysiaYmd } from "@/lib/dateMalaysia"
import { loadCmsData, getAgreementList, getClientsForOperator } from "@/lib/owner-api"

interface Property {
  _id: string
  shortname?: string
  client_id?: string
}
interface Room {
  _id: string
  roomName?: string
  property?: { _id?: string; shortname?: string } | null
}
interface Operator {
  _id: string
  title?: string
}
interface Tenancy {
  _id: string
  room?: string
  begin?: string
  end?: string
  rental?: number
  tenant?: { fullname?: string }
  property?: { _id: string; shortname?: string }
  agreement?: { _id?: string; pdfurl?: string }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function isCurrentTenancy(end?: string) {
  if (!end) return true
  return new Date(end).getTime() >= Date.now()
}

function tenancyStatusForCal(begin?: string, end?: string): string {
  const now = Date.now()
  const endMs = end ? new Date(end).getTime() : Number.POSITIVE_INFINITY
  const beginMs = begin ? new Date(begin).getTime() : 0
  if (endMs < now) return "Ended"
  if (beginMs > now) return "Upcoming"
  return "Active"
}

export default function OwnerPropertiesPage() {
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list")
  const [calendarScale, setCalendarScale] = useState<TenancyCalendarScale>("day")
  const todayYmd = useMemo(() => getTodayMalaysiaYmd(), [])
  const [calYear, setCalYear] = useState(() => Number(todayYmd.slice(0, 4)))
  const [calMonth, setCalMonth] = useState(() => Number(todayYmd.slice(5, 7)) - 1)

  const [selectedProperty, setSelectedProperty] = useState("all")
  const [selectedOperator, setSelectedOperator] = useState("all")
  const [properties, setProperties] = useState<Property[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailTenancy, setDetailTenancy] = useState<Tenancy | null>(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const [data, clientsRes] = await Promise.all([
          loadCmsData(),
          getClientsForOperator(),
        ])
        if (!data.ok) {
          setError(data.reason || "Unable to load. Please try again or complete your profile.")
          return
        }
        const o = (data.owner as { _id?: string }) || null
        setProperties((data.properties as Property[]) || [])
        setRooms((data.rooms as Room[]) || [])
        if (clientsRes.ok && clientsRes.items && !cancelled) {
          setOperators((clientsRes.items as Operator[]) || [])
        }

        let t: Tenancy[] = (data.tenancies as Tenancy[]) || []
        const agrRes = o?._id ? await getAgreementList({ ownerId: o._id }) : { ok: true as const, items: [] }
        if (agrRes.ok && agrRes.items) {
          const tenancyToAgr = new Map<string, Tenancy["agreement"]>()
          ;(agrRes.items as { tenancyid?: string; agreement?: Tenancy["agreement"] }[]).forEach((a) => {
            if (a.tenancyid) tenancyToAgr.set(a.tenancyid, a.agreement || undefined)
          })
          t = t.map((x) => ({ ...x, agreement: tenancyToAgr.get(x._id) }))
        }
        if (!cancelled) setTenancies(t)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong. Please try again.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  const currentTenancies = tenancies.filter((t) => isCurrentTenancy(t.end))
  const tenanciesByRoomId = currentTenancies.reduce<Record<string, Tenancy[]>>((acc, t) => {
    const rid = typeof t.room === "string" ? t.room : ""
    if (rid) {
      if (!acc[rid]) acc[rid] = []
      acc[rid].push(t)
    }
    return acc
  }, {})

  const roomsByPropertyId = rooms.reduce<Record<string, Room[]>>((acc, r) => {
    const pid = r.property?._id ?? ""
    if (!pid) return acc
    if (!acc[pid]) acc[pid] = []
    acc[pid].push(r)
    return acc
  }, {})

  const filteredProperties = properties.filter((prop) => {
    if (selectedProperty !== "all" && prop._id !== selectedProperty) return false
    if (selectedOperator !== "all" && prop.client_id !== selectedOperator) return false
    return true
  })

  const filteredRoomIds = useMemo(() => {
    const set = new Set<string>()
    for (const prop of filteredProperties) {
      for (const r of roomsByPropertyId[prop._id] || []) {
        set.add(r._id)
      }
    }
    return set
  }, [filteredProperties, roomsByPropertyId])

  const roomMetaById = useMemo(() => {
    const m = new Map<string, Room>()
    for (const r of rooms) m.set(r._id, r)
    return m
  }, [rooms])

  const propertyMetaById = useMemo(() => {
    const m = new Map<string, Property>()
    for (const p of properties) m.set(p._id, p)
    return m
  }, [properties])

  const calendarExtraRooms = useMemo((): TenancyCalendarExtraRoom[] => {
    const out: TenancyCalendarExtraRoom[] = []
    for (const prop of filteredProperties) {
      for (const r of roomsByPropertyId[prop._id] || []) {
        out.push({
          roomId: r._id,
          room: r.roomName || "Room",
          property: prop.shortname || "Unnamed",
          propertyId: prop._id,
        })
      }
    }
    return out
  }, [filteredProperties, roomsByPropertyId])

  const calendarTenancies = useMemo((): TenancyCal[] => {
    return tenancies
      .filter((t) => {
        const rid = typeof t.room === "string" ? t.room : ""
        if (!filteredRoomIds.has(rid)) return false
        const checkIn = tenancyDbDateToMalaysiaYmd(t.begin)
        const checkOut = tenancyDbDateToMalaysiaYmd(t.end)
        return !!checkIn && !!checkOut
      })
      .map((t) => {
        const rid = typeof t.room === "string" ? t.room : ""
        const roomMeta = roomMetaById.get(rid)
        const pid = t.property?._id ?? roomMeta?.property?._id ?? ""
        const propMeta = pid ? propertyMetaById.get(pid) : undefined
        return {
          id: t._id,
          tenant: t.tenant?.fullname || "Unknown",
          roomId: rid,
          room: roomMeta?.roomName || "—",
          property: propMeta?.shortname || t.property?.shortname || "—",
          propertyId: pid || undefined,
          checkIn: tenancyDbDateToMalaysiaYmd(t.begin),
          checkOut: tenancyDbDateToMalaysiaYmd(t.end),
          status: tenancyStatusForCal(t.begin, t.end),
          rental: t.rental ?? null,
        }
      })
  }, [tenancies, filteredRoomIds, roomMetaById, propertyMetaById])

  const openCalendarTenancyDetail = (cal: TenancyCal) => {
    const full = tenancies.find((x) => x._id === cal.id) ?? null
    setDetailTenancy(full)
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-4 lg:p-8">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">My Properties</h1>
        <p className="text-muted-foreground">
          View your properties by room (unit); vacant rooms are listed too.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between mb-4">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "list" | "calendar")}>
          <TabsList className="h-9">
            <TabsTrigger value="list" className="gap-1.5 px-3">
              <LayoutList className="h-4 w-4 shrink-0" />
              List view
            </TabsTrigger>
            <TabsTrigger value="calendar" className="gap-1.5 px-3">
              <Calendar className="h-4 w-4 shrink-0" />
              Calendar view
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {viewMode === "calendar" && (
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            <Button
              type="button"
              variant={calendarScale === "month" ? "default" : "ghost"}
              size="sm"
              className="h-8 rounded-md px-3"
              style={calendarScale === "month" ? { background: "var(--brand)" } : undefined}
              onClick={() => setCalendarScale("month")}
            >
              By month
            </Button>
            <Button
              type="button"
              variant={calendarScale === "day" ? "default" : "ghost"}
              size="sm"
              className="h-8 rounded-md px-3"
              style={calendarScale === "day" ? { background: "var(--brand)" } : undefined}
              onClick={() => setCalendarScale("day")}
            >
              By day
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="w-full sm:w-48">
          <Select value={selectedOperator} onValueChange={setSelectedOperator}>
            <SelectTrigger>
              <SelectValue placeholder="Operator" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Operators</SelectItem>
              {operators.map((op) => (
                <SelectItem key={op._id} value={op._id}>
                  {op.title || "Unnamed Operator"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select value={selectedProperty} onValueChange={setSelectedProperty}>
            <SelectTrigger>
              <SelectValue placeholder="Select Property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Properties</SelectItem>
              {properties.map((prop) => (
                <SelectItem key={prop._id} value={prop._id}>
                  {prop.shortname || "Unnamed"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {viewMode === "calendar" && (
        <div className="mb-6">
          <TenancyCalendarView
            tenancies={calendarTenancies}
            extraRooms={calendarExtraRooms}
            scale={calendarScale}
            year={calYear}
            monthIndex={calMonth}
            onYearChange={setCalYear}
            onMonthChange={setCalMonth}
            todayYmd={todayYmd}
            onTenancyClick={openCalendarTenancyDetail}
            loading={false}
          />
        </div>
      )}

      {viewMode === "list" && (
      <div className="space-y-6">
        {filteredProperties.map((prop) => {
          const propRooms = roomsByPropertyId[prop._id] || []
          const tenantCount = propRooms.reduce((n, r) => {
            return n + (tenanciesByRoomId[r._id]?.length ?? 0)
          }, 0)
          return (
            <Card key={prop._id} className="overflow-hidden">
              <CardHeader className="bg-[var(--brand)]/5 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4 text-primary" />
                  {prop.shortname || "Unnamed"}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {propRooms.length} room{propRooms.length !== 1 ? "s" : ""}
                  {" · "}
                  {tenantCount} current tenant{tenantCount !== 1 ? "s" : ""}
                </p>
              </CardHeader>
              <CardContent className="pt-4">
                {propRooms.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No rooms linked to this property.</p>
                ) : (
                  <div className="space-y-4">
                    {propRooms.map((room) => {
                      const roomTenants = tenanciesByRoomId[room._id] || []
                      return (
                        <div
                          key={room._id}
                          className="rounded-lg border border-border bg-muted/30 p-4 space-y-3"
                        >
                          <p className="text-sm font-semibold text-foreground">
                            {room.roomName || "Room"}
                          </p>
                          {roomTenants.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Vacant — no current tenant</p>
                          ) : (
                            roomTenants.map((t) => (
                              <div key={t._id} className="space-y-3 pt-1 border-t border-border/60 first:border-0 first:pt-0">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <User className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium">{t.tenant?.fullname || "Unknown"}</span>
                                  </div>
                                  {t.agreement?.pdfurl && (
                                    <a
                                      href={t.agreement.pdfurl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      download
                                    >
                                      <Button variant="outline" size="sm" className="gap-1">
                                        <Download className="h-4 w-4" />
                                        Download Agreement
                                      </Button>
                                    </a>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-4 text-sm">
                                  <div className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">Period:</span>
                                    <span className="font-medium">
                                      {t.begin && t.end
                                        ? `${formatDate(t.begin)} - ${formatDate(t.end)}`
                                        : "-"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Banknote className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">Rental:</span>
                                    <span className="font-medium">
                                      {t.rental ? `RM ${t.rental.toLocaleString()}` : "-"}
                                    </span>
                                  </div>
                                </div>
                                {!t.agreement?.pdfurl && (
                                  <p className="text-xs text-muted-foreground">
                                    <FileText className="inline h-3 w-3 mr-1" />
                                    Agreement not yet available
                                  </p>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
      )}

      {viewMode === "list" && filteredProperties.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <Building2 className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">No properties found</h3>
          <p className="text-sm text-muted-foreground">
            Try adjusting your filters to see more results.
          </p>
        </div>
      )}

      <Dialog open={!!detailTenancy} onOpenChange={(open) => { if (!open) setDetailTenancy(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tenancy</DialogTitle>
          </DialogHeader>
          {detailTenancy && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{detailTenancy.tenant?.fullname || "Unknown"}</span>
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Period:</span>
                  <span>
                    {detailTenancy.begin && detailTenancy.end
                      ? `${formatDate(detailTenancy.begin)} - ${formatDate(detailTenancy.end)}`
                      : "-"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Rental:</span>
                  <span>
                    {detailTenancy.rental != null
                      ? `RM ${Number(detailTenancy.rental).toLocaleString()}`
                      : "-"}
                  </span>
                </div>
              </div>
              {detailTenancy.agreement?.pdfurl ? (
                <a
                  href={detailTenancy.agreement.pdfurl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                >
                  <Button variant="outline" size="sm" className="gap-1">
                    <Download className="h-4 w-4" />
                    Download Agreement
                  </Button>
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <FileText className="inline h-3 w-3 mr-1" />
                  Agreement not yet available
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
