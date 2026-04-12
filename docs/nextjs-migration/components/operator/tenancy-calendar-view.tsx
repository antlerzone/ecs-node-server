"use client"

import { Fragment, useMemo, useState, useCallback } from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type TenancyCalendarScale = "month" | "day"

export interface TenancyCal {
  id: string
  tenant: string
  roomId: string
  room: string
  property: string
  /** Stable group key when present; falls back to property name in rows. */
  propertyId?: string
  checkIn: string
  checkOut: string
  status: string
  /** Monthly rental shown on bar as ` (RM…)` when set. */
  rental?: number | null
}

/** Rooms shown on the grid even when there is no tenancy row (e.g. owner portal vacant units). */
export interface TenancyCalendarExtraRoom {
  roomId: string
  room: string
  property: string
  propertyId?: string
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = String(s || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return null
  return { y, m: mo, d: day }
}

function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function formatRentalSuffix(rental: number | null | undefined): string {
  if (rental == null || !Number.isFinite(Number(rental))) return ""
  const v = Number(rental)
  const num =
    Math.abs(v - Math.round(v)) < 1e-9
      ? String(Math.round(v))
      : String(Math.round(v * 100) / 100)
  return ` (RM${num})`
}

/** Tooltip / aria: always chronological (check-out can appear before check-in in raw strings when TZ normalization differs). */
function tenancyStayRangeLabel(t: TenancyCal): string {
  const lo = compareYmd(t.checkIn, t.checkOut) > 0 ? t.checkOut : t.checkIn
  const hi = compareYmd(t.checkIn, t.checkOut) > 0 ? t.checkIn : t.checkOut
  const rent = formatRentalSuffix(t.rental)
  return `${t.tenant}${rent} · ${lo} → ${hi}`
}

/**
 * Pill label: `name (RM600)`. Truncate name (with …) so suffix stays when possible.
 * `spanCols` / `mode` tune char budget for wider bars.
 */
function calendarBarLabel(t: TenancyCal, spanCols: number, mode: "month" | "day"): string {
  const name = String(t.tenant || "").trim() || "—"
  const suffix = formatRentalSuffix(t.rental)
  const perCol = mode === "month" ? 5.5 : 2.4
  let maxChars = Math.floor(spanCols * perCol)
  const suffixLen = suffix.length
  const minForRent = suffixLen > 0 ? 12 + Math.min(suffixLen, 24) : 10
  maxChars = Math.max(suffix ? minForRent : 10, Math.min(mode === "month" ? 44 : 30, maxChars))
  if (!suffix) {
    if (name.length <= maxChars) return name
    if (maxChars <= 3) return "…"
    return `${name.slice(0, maxChars - 1)}…`
  }
  const full = `${name}${suffix}`
  if (full.length <= maxChars) return full
  const nameBudget = maxChars - suffixLen - 1
  if (nameBudget < 1) {
    return suffix.trim().slice(0, Math.max(4, maxChars))
  }
  if (name.length <= nameBudget) return full.slice(0, maxChars)
  return `${name.slice(0, Math.max(0, nameBudget - 1))}…${suffix}`
}

/** Inclusive both ends (calendar days of stay). */
function clipTenancyToRange(checkIn: string, checkOut: string, rangeStart: string, rangeEnd: string): { a: string; b: string } | null {
  const lo = compareYmd(checkIn, checkOut) > 0 ? checkOut : checkIn
  const hi = compareYmd(checkIn, checkOut) > 0 ? checkIn : checkOut
  const a = compareYmd(lo, rangeStart) < 0 ? rangeStart : lo
  const b = compareYmd(hi, rangeEnd) > 0 ? rangeEnd : hi
  if (compareYmd(a, b) > 0) return null
  return { a, b }
}

function lastDayOfMonth(y: number, monthIndex0: number): number {
  return new Date(y, monthIndex0 + 1, 0).getDate()
}

function monthRangeYmd(y: number, monthIndex0: number): { start: string; end: string } {
  const start = `${y}-${pad2(monthIndex0 + 1)}-01`
  const ld = lastDayOfMonth(y, monthIndex0)
  const end = `${y}-${pad2(monthIndex0 + 1)}-${pad2(ld)}`
  return { start, end }
}

function yearRangeYmd(y: number): { start: string; end: string } {
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}

function tenantHue(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 7)) % 360
  return `hsl(${h} 62% 42%)`
}

interface RoomRow {
  roomId: string
  property: string
  propertyId?: string
  /** Group key: property UUID when available, else property title. */
  groupKey: string
  room: string
  /** Room title only (shown under property group). */
  roomLabel: string
}

interface PropertyGroup {
  groupKey: string
  title: string
  rooms: RoomRow[]
}

function buildRoomRows(tenancies: TenancyCal[]): RoomRow[] {
  const m = new Map<string, RoomRow>()
  for (const t of tenancies) {
    const id = String(t.roomId || "").trim()
    if (!id) continue
    const propTitle = String(t.property || "—").trim() || "—"
    const pid = String(t.propertyId || "").trim()
    const groupKey = pid || propTitle
    if (!m.has(id)) {
      m.set(id, {
        roomId: id,
        property: propTitle,
        propertyId: pid || undefined,
        groupKey,
        room: t.room || "—",
        roomLabel: String(t.room || "—").trim() || "—",
      })
    }
  }
  return Array.from(m.values()).sort((a, b) => {
    const p = a.property.localeCompare(b.property, "en", { sensitivity: "base" })
    if (p !== 0) return p
    return a.room.localeCompare(b.room, "en", { sensitivity: "base" })
  })
}

function mergeRoomRowsWithExtras(
  tenancies: TenancyCal[],
  extraRooms: TenancyCalendarExtraRoom[] | undefined
): RoomRow[] {
  const base = buildRoomRows(tenancies)
  if (!extraRooms?.length) return base
  const m = new Map<string, RoomRow>()
  for (const r of base) m.set(r.roomId, r)
  for (const e of extraRooms) {
    const id = String(e.roomId || "").trim()
    if (!id || m.has(id)) continue
    const propTitle = String(e.property || "—").trim() || "—"
    const pid = String(e.propertyId || "").trim()
    const groupKey = pid || propTitle
    const label = String(e.room || "—").trim() || "—"
    m.set(id, {
      roomId: id,
      property: propTitle,
      propertyId: pid || undefined,
      groupKey,
      room: label,
      roomLabel: label,
    })
  }
  return Array.from(m.values()).sort((a, b) => {
    const p = a.property.localeCompare(b.property, "en", { sensitivity: "base" })
    if (p !== 0) return p
    return a.room.localeCompare(b.room, "en", { sensitivity: "base" })
  })
}

function buildPropertyGroups(rooms: RoomRow[]): PropertyGroup[] {
  const map = new Map<string, { title: string; rooms: RoomRow[] }>()
  for (const r of rooms) {
    const k = r.groupKey
    if (!map.has(k)) {
      map.set(k, { title: r.property, rooms: [] })
    }
    map.get(k)!.rooms.push(r)
  }
  for (const g of map.values()) {
    g.rooms.sort((a, b) => a.room.localeCompare(b.room, "en", { sensitivity: "base" }))
  }
  return Array.from(map.entries())
    .map(([groupKey, v]) => ({ groupKey, title: v.title, rooms: v.rooms }))
    .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }))
}

export function TenancyCalendarView({
  tenancies,
  extraRooms,
  scale,
  year,
  monthIndex,
  onYearChange,
  onMonthChange,
  todayYmd,
  onTenancyClick,
  loading,
}: {
  tenancies: TenancyCal[]
  /** Additional room rows (vacant / no lease) merged with rooms inferred from tenancies. */
  extraRooms?: TenancyCalendarExtraRoom[]
  scale: TenancyCalendarScale
  year: number
  monthIndex: number
  onYearChange: (y: number) => void
  onMonthChange: (m: number) => void
  todayYmd: string
  onTenancyClick: (t: TenancyCal) => void
  loading?: boolean
}) {
  const rooms = useMemo(
    () => mergeRoomRowsWithExtras(tenancies, extraRooms),
    [tenancies, extraRooms]
  )
  const propertyGroups = useMemo(() => buildPropertyGroups(rooms), [rooms])

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))
  }, [])

  const byRoom = useMemo(() => {
    const map = new Map<string, TenancyCal[]>()
    for (const t of tenancies) {
      const id = String(t.roomId || "").trim()
      if (!id) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id)!.push(t)
    }
    return map
  }, [tenancies])

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Loading calendar…
      </div>
    )
  }

  if (rooms.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No rooms in the current list — adjust filters or add tenancies.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Previous year"
            onClick={() => onYearChange(year - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[4rem] text-center text-sm font-semibold tabular-nums">{year}</span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Next year"
            onClick={() => onYearChange(year + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {scale === "day" && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Previous month"
              onClick={() => {
                if (monthIndex <= 0) {
                  onYearChange(year - 1)
                  onMonthChange(11)
                } else {
                  onMonthChange(monthIndex - 1)
                }
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[8rem] text-center text-sm font-medium">
              {MONTH_LABELS[monthIndex]} {year}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Next month"
              onClick={() => {
                if (monthIndex >= 11) {
                  onYearChange(year + 1)
                  onMonthChange(0)
                } else {
                  onMonthChange(monthIndex + 1)
                }
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        {scale === "month" ? (
          <MonthGrid
            year={year}
            propertyGroups={propertyGroups}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            byRoom={byRoom}
            todayYmd={todayYmd}
            onTenancyClick={onTenancyClick}
          />
        ) : (
          <DayGrid
            year={year}
            monthIndex={monthIndex}
            rooms={rooms}
            propertyGroups={propertyGroups}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            byRoom={byRoom}
            todayYmd={todayYmd}
            onTenancyClick={onTenancyClick}
          />
        )}
      </div>
    </div>
  )
}

function MonthGrid({
  year,
  propertyGroups,
  collapsedGroups,
  onToggleGroup,
  byRoom,
  todayYmd,
  onTenancyClick,
}: {
  year: number
  propertyGroups: PropertyGroup[]
  collapsedGroups: Record<string, boolean>
  onToggleGroup: (groupKey: string) => void
  byRoom: Map<string, TenancyCal[]>
  todayYmd: string
  onTenancyClick: (t: TenancyCal) => void
}) {
  const yr = yearRangeYmd(year)
  const colCount = 12

  return (
    <table className="w-max min-w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-border bg-muted/40">
          <th className="sticky left-0 z-20 min-w-[200px] max-w-[280px] border-r border-border bg-muted/40 px-2 py-2 text-left font-semibold text-muted-foreground">
            Property / Room
          </th>
          {MONTH_LABELS.map((lab, i) => {
            const inMonth = (() => {
              const t = parseYmd(todayYmd)
              return t && t.y === year && t.m === i + 1
            })()
            return (
              <th
                key={lab}
                className={cn(
                  "min-w-[56px] px-1 py-2 text-center font-medium text-muted-foreground",
                  inMonth && "bg-primary/15 text-primary"
                )}
              >
                {lab}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {propertyGroups.map((g) => {
          const collapsed = collapsedGroups[g.groupKey] === true
          return (
            <Fragment key={g.groupKey}>
              <tr className="border-b border-border bg-muted/60">
                <td className="sticky left-0 z-[11] max-w-[280px] border-r border-border bg-muted/70 px-1.5 py-1 align-middle shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                  <button
                    type="button"
                    onClick={() => onToggleGroup(g.groupKey)}
                    className="flex w-full min-w-0 items-start gap-1 rounded-md px-1 py-0.5 text-left text-[11px] font-bold text-foreground hover:bg-muted/80"
                    aria-expanded={!collapsed}
                  >
                    <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
                      {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </span>
                    <span className="line-clamp-2 leading-snug">{g.title}</span>
                  </button>
                </td>
                <td colSpan={colCount} className="bg-muted/50 p-0" />
              </tr>
              {!collapsed &&
                g.rooms.map((row, ri) => {
                  const list = byRoom.get(row.roomId) || []
                  const segments = layoutMonthSegments(list, year, yr)
                  return (
                    <tr
                      key={row.roomId}
                      className={cn("border-b border-border", ri % 2 === 1 && "bg-muted/15")}
                    >
                      <td className="sticky left-0 z-10 max-w-[280px] border-r border-border bg-background px-2 py-1.5 pl-6 align-top text-[11px] font-medium leading-snug shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                        <span className="line-clamp-2 text-muted-foreground">{row.roomLabel}</span>
                      </td>
                      <td colSpan={colCount} className="relative p-0 align-top" style={{ minHeight: 40 }}>
                        <div
                          className="relative grid h-full min-h-[36px] w-full"
                          style={{
                            gridTemplateColumns: `repeat(${colCount}, minmax(52px, 1fr))`,
                          }}
                        >
                          {MONTH_LABELS.map((_, mi) => (
                            <div key={mi} className="border-r border-border/60 bg-background/50" />
                          ))}
                          {segments.map((seg) => (
                            <button
                              key={seg.key}
                              type="button"
                              title={tenancyStayRangeLabel(seg.t)}
                              className="absolute top-1 z-[1] flex h-[26px] max-w-full items-center overflow-hidden rounded-md border px-1.5 text-left text-[10px] font-semibold text-white shadow-sm transition hover:brightness-110"
                              style={{
                                left: `calc(${(seg.startCol / colCount) * 100}% + 2px)`,
                                width: `calc(${(seg.span / colCount) * 100}% - 4px)`,
                                background: tenantHue(seg.t.id + seg.t.tenant),
                                borderColor: tenantHue(seg.t.id + seg.t.tenant),
                              }}
                              onClick={() => onTenancyClick(seg.t)}
                            >
                              <span className="truncate">{calendarBarLabel(seg.t, seg.span, "month")}</span>
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

function layoutMonthSegments(list: TenancyCal[], year: number, yr: { start: string; end: string }) {
  const out: { key: string; t: TenancyCal; startCol: number; span: number }[] = []
  for (const t of list) {
    const clip = clipTenancyToRange(t.checkIn, t.checkOut, yr.start, yr.end)
    if (!clip) continue
    const ps = parseYmd(clip.a)
    const pe = parseYmd(clip.b)
    if (!ps || !pe) continue
    const sm = ps.y < year ? 0 : ps.m - 1
    const em = pe.y > year ? 11 : pe.m - 1
    const startCol = Math.max(0, Math.min(11, sm))
    const endCol = Math.max(0, Math.min(11, em))
    const span = endCol - startCol + 1
    out.push({
      key: `${t.id}-${year}-${startCol}-${endCol}`,
      t,
      startCol,
      span,
    })
  }
  return out
}

function DayGrid({
  year,
  monthIndex,
  rooms,
  propertyGroups,
  collapsedGroups,
  onToggleGroup,
  byRoom,
  todayYmd,
  onTenancyClick,
}: {
  year: number
  monthIndex: number
  rooms: RoomRow[]
  propertyGroups: PropertyGroup[]
  collapsedGroups: Record<string, boolean>
  onToggleGroup: (groupKey: string) => void
  byRoom: Map<string, TenancyCal[]>
  todayYmd: string
  onTenancyClick: (t: TenancyCal) => void
}) {
  const { start, end } = monthRangeYmd(year, monthIndex)
  const days = lastDayOfMonth(year, monthIndex)
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  return (
    <table className="w-max min-w-full border-collapse text-[11px]">
      <thead>
        <tr className="border-b border-border bg-muted/40">
          <th
            rowSpan={2}
            className="sticky left-0 z-20 min-w-[200px] max-w-[280px] border-r border-border bg-muted/40 px-2 py-2 text-left align-bottom font-semibold text-muted-foreground"
          >
            Property / Room
          </th>
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1
            const ymd = `${year}-${pad2(monthIndex + 1)}-${pad2(d)}`
            const date = new Date(year, monthIndex, d)
            const w = date.getDay()
            const isSun = w === 0
            const isToday = ymd === todayYmd
            return (
              <th
                key={ymd}
                className={cn(
                  "min-w-[40px] border-r border-border/70 px-0.5 py-1 text-center font-medium",
                  isSun && "text-red-600 dark:text-red-400",
                  isToday && "bg-primary/20 text-primary"
                )}
              >
                <div className="leading-tight">{d}</div>
                <div className={cn("text-[9px] font-normal opacity-80", isSun && "text-red-600/90")}>{dow[w]}</div>
              </th>
            )
          })}
        </tr>
        <tr className="border-b border-border bg-muted/20">
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1
            const ymd = `${year}-${pad2(monthIndex + 1)}-${pad2(d)}`
            const occ = occupancyForDay(rooms, byRoom, ymd)
            return (
              <th key={`o-${ymd}`} className="min-w-[40px] border-r border-border/50 px-0.5 py-0.5 text-center text-[9px] text-muted-foreground">
                {occ.occ} | {occ.tot}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {propertyGroups.map((g) => {
          const collapsed = collapsedGroups[g.groupKey] === true
          return (
            <Fragment key={g.groupKey}>
              <tr className="border-b border-border bg-muted/60">
                <td className="sticky left-0 z-[11] max-w-[280px] border-r border-border bg-muted/70 px-1.5 py-1 align-middle shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                  <button
                    type="button"
                    onClick={() => onToggleGroup(g.groupKey)}
                    className="flex w-full min-w-0 items-start gap-1 rounded-md px-1 py-0.5 text-left text-[11px] font-bold text-foreground hover:bg-muted/80"
                    aria-expanded={!collapsed}
                  >
                    <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
                      {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </span>
                    <span className="line-clamp-2 leading-snug">{g.title}</span>
                  </button>
                </td>
                <td colSpan={days} className="bg-muted/50 p-0" />
              </tr>
              {!collapsed &&
                g.rooms.map((row, ri) => {
                  const list = byRoom.get(row.roomId) || []
                  const segments = layoutDaySegments(list, start, end, days)
                  return (
                    <tr
                      key={row.roomId}
                      className={cn("border-b border-border", ri % 2 === 1 && "bg-muted/15")}
                    >
                      <td className="sticky left-0 z-10 max-w-[280px] border-r border-border bg-background px-2 py-1 pl-6 align-top text-[11px] font-medium leading-snug shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                        <span className="line-clamp-2 text-muted-foreground">{row.roomLabel}</span>
                      </td>
                      <td colSpan={days} className="relative p-0 align-top" style={{ minHeight: 44 }}>
                        <div
                          className="relative grid min-h-[40px] w-full"
                          style={{
                            gridTemplateColumns: `repeat(${days}, minmax(36px, 1fr))`,
                          }}
                        >
                          {Array.from({ length: days }, (_, i) => {
                            const d = i + 1
                            const ymd = `${year}-${pad2(monthIndex + 1)}-${pad2(d)}`
                            const vacant = !list.some((t) => dayOverlapsTenancy(t, ymd))
                            return (
                              <div
                                key={ymd}
                                className={cn(
                                  "border-r border-border/50 bg-muted/5",
                                  vacant && "bg-emerald-500/[0.04]",
                                  ymd === todayYmd && "bg-primary/10"
                                )}
                              />
                            )
                          })}
                          {segments.map((seg) => (
                            <button
                              key={seg.key}
                              type="button"
                              title={tenancyStayRangeLabel(seg.t)}
                              className="absolute top-1 z-[1] flex h-[26px] max-w-full items-center overflow-hidden rounded-md border px-1 text-left text-[9px] font-bold text-white shadow-sm transition hover:brightness-110"
                              style={{
                                left: `calc(${(seg.startCol / days) * 100}% + 1px)`,
                                width: `calc(${(seg.span / days) * 100}% - 2px)`,
                                background: tenantHue(seg.t.id + seg.t.tenant),
                                borderColor: tenantHue(seg.t.id + seg.t.tenant),
                              }}
                              onClick={() => onTenancyClick(seg.t)}
                            >
                              <span className="truncate">{calendarBarLabel(seg.t, seg.span, "day")}</span>
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

function occupancyForDay(
  rooms: RoomRow[],
  byRoom: Map<string, TenancyCal[]>,
  ymd: string
): { occ: number; tot: number } {
  let occ = 0
  for (const r of rooms) {
    const list = byRoom.get(r.roomId) || []
    if (list.some((t) => dayOverlapsTenancy(t, ymd))) occ += 1
  }
  return { occ, tot: rooms.length }
}

function dayOverlapsTenancy(t: TenancyCal, ymd: string): boolean {
  const clip = clipTenancyToRange(t.checkIn, t.checkOut, ymd, ymd)
  return clip !== null
}

function layoutDaySegments(list: TenancyCal[], monthStart: string, monthEnd: string, days: number) {
  const out: { key: string; t: TenancyCal; startCol: number; span: number }[] = []
  for (const t of list) {
    const clip = clipTenancyToRange(t.checkIn, t.checkOut, monthStart, monthEnd)
    if (!clip) continue
    const ps = parseYmd(clip.a)
    const pe = parseYmd(clip.b)
    if (!ps || !pe) continue
    const startCol = ps.d - 1
    const endCol = pe.d - 1
    const sc = Math.max(0, Math.min(days - 1, startCol))
    const ec = Math.max(0, Math.min(days - 1, endCol))
    const span = ec - sc + 1
    out.push({
      key: `${t.id}-${monthStart}-${sc}-${ec}`,
      t,
      startCol: sc,
      span,
    })
  }
  return out
}
