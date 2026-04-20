"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"
import {
  createOperatorCalendarAdjustment,
  deleteOperatorCalendarAdjustment,
  fetchOperatorCalendarAdjustments,
  fetchOperatorContacts,
  fetchOperatorProperties,
  updateOperatorCalendarAdjustment,
} from "@/lib/cleanlemon-api"

type AdjustmentType = "markup" | "deduction"
type ValueType = "percentage" | "fixed"
type ScopeMode = "all" | "selected"

interface Adjustment {
  id: string
  name: string
  remark: string
  startDate: string
  endDate: string
  adjustmentType: AdjustmentType
  valueType: ValueType
  value: number
  products: string[]
  properties: string[]
  clients: string[]
}

const BASE_PRICE = 100
const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const propertyOptionsFallback = [
  { id: "all-properties", label: "All Properties" },
]
const clientOptionsFallback = [
  { id: "all-clients", label: "All Clients" },
]
const productOptions = [
  { id: "general", label: "General" },
  { id: "deep", label: "Deep" },
  { id: "renovation", label: "Renovation" },
  { id: "homestay", label: "Homestay" },
  { id: "room-rental", label: "Room Rental" },
  { id: "commercial", label: "Commercial" },
  { id: "dobi", label: "Dobi" },
  { id: "other", label: "Other" },
]

function ymd(date: Date) {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, "0")
  const d = `${date.getDate()}`.padStart(2, "0")
  return `${y}-${m}-${d}`
}

function fromYmd(value: string) {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function inRange(target: string, start: string, end: string) {
  return target >= start && target <= end
}

function monthGrid(year: number, monthIndex: number) {
  const firstDay = new Date(year, monthIndex, 1)
  const startWeekDay = firstDay.getDay()
  const start = new Date(year, monthIndex, 1 - startWeekDay)
  const cells: Date[] = []
  for (let i = 0; i < 42; i += 1) {
    cells.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }
  return cells
}

const promotionBadgeColors = [
  "bg-cyan-100 text-cyan-800 hover:bg-cyan-200",
  "bg-violet-100 text-violet-800 hover:bg-violet-200",
  "bg-amber-100 text-amber-800 hover:bg-amber-200",
  "bg-emerald-100 text-emerald-800 hover:bg-emerald-200",
  "bg-rose-100 text-rose-800 hover:bg-rose-200",
  "bg-indigo-100 text-indigo-800 hover:bg-indigo-200",
]

export default function OperatorCalenderPage() {
  const { user } = useAuth()
  const operatorId = user?.operatorId || "op_demo_001"
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [rangeStart, setRangeStart] = useState<string>("")
  const [rangeEnd, setRangeEnd] = useState<string>("")
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [propertyOptions, setPropertyOptions] = useState<Array<{ id: string; label: string }>>(propertyOptionsFallback)
  const [clientOptions, setClientOptions] = useState<Array<{ id: string; label: string }>>(clientOptionsFallback)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [remark, setRemark] = useState("")
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("markup")
  const [valueType, setValueType] = useState<ValueType>("percentage")
  const [value, setValue] = useState(0)
  const [search, setSearch] = useState("")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [productMode, setProductMode] = useState<ScopeMode>("all")
  const [propertyMode, setPropertyMode] = useState<ScopeMode>("all")
  const [clientMode, setClientMode] = useState<ScopeMode>("all")
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([])
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([])
  const [calendarPageTab, setCalendarPageTab] = useState<"calendar" | "list">("calendar")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [adjR, propertyR, contactR] = await Promise.all([
        fetchOperatorCalendarAdjustments(operatorId),
        fetchOperatorProperties(operatorId),
        fetchOperatorContacts(operatorId),
      ])
      if (!cancelled && adjR?.ok && Array.isArray(adjR.items)) {
        setAdjustments(
          adjR.items.map((item: any) => ({
            id: String(item.id),
            name: String(item.name || ""),
            remark: String(item.remark || ""),
            startDate: String(item.startDate || ""),
            endDate: String(item.endDate || ""),
            adjustmentType: item.adjustmentType === "deduction" ? "deduction" : "markup",
            valueType: item.valueType === "fixed" ? "fixed" : "percentage",
            value: Number(item.value || 0),
            products: Array.isArray(item.products) ? item.products : [],
            properties: Array.isArray(item.properties) ? item.properties : [],
            clients: Array.isArray(item.clients) ? item.clients : [],
          }))
        )
      }
      if (!cancelled && propertyR?.ok && Array.isArray(propertyR.items) && propertyR.items.length > 0) {
        setPropertyOptions(
          propertyR.items.map((item: any) => ({
            id: String(item.id),
            label: String(item.name || item.unitNumber || item.id),
          }))
        )
      }
      if (!cancelled && contactR?.ok && Array.isArray(contactR.items) && contactR.items.length > 0) {
        setClientOptions(
          contactR.items.map((item: any) => ({
            id: String(item.id),
            label: String(item.name || item.email || item.id),
          }))
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  const cells = useMemo(() => monthGrid(viewYear, viewMonth), [viewYear, viewMonth])

  const activeStart = useMemo(() => {
    if (!rangeStart) return ""
    if (!rangeEnd) return rangeStart
    return rangeStart <= rangeEnd ? rangeStart : rangeEnd
  }, [rangeStart, rangeEnd])

  const activeEnd = useMemo(() => {
    if (!rangeStart) return ""
    if (!rangeEnd) return rangeStart
    return rangeStart <= rangeEnd ? rangeEnd : rangeStart
  }, [rangeStart, rangeEnd])

  const dayAdjustments = (day: string) =>
    adjustments.filter((adj) => inRange(day, adj.startDate, adj.endDate))

  const filteredAdjustments = useMemo(() => {
    return adjustments.filter((adj) => {
      const q = search.trim().toLowerCase()
      const matchSearch =
        !q ||
        adj.name.toLowerCase().includes(q) ||
        adj.remark.toLowerCase().includes(q) ||
        `${adj.value}`.includes(q)
      const matchFrom = !filterFrom || adj.endDate >= filterFrom
      const matchTo = !filterTo || adj.startDate <= filterTo
      return matchSearch && matchFrom && matchTo
    })
  }, [adjustments, search, filterFrom, filterTo])

  const dayPrice = (day: string) => {
    const adjs = dayAdjustments(day)
    let price = BASE_PRICE
    adjs.forEach((adj) => {
      const delta = adj.valueType === "percentage" ? (BASE_PRICE * adj.value) / 100 : adj.value
      price += adj.adjustmentType === "markup" ? delta : -delta
    })
    return Math.max(0, Math.round(price))
  }

  const promotionColorClass = (id: string) => {
    const sum = id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    return promotionBadgeColors[sum % promotionBadgeColors.length]
  }

  const openCreate = () => {
    if (!activeStart || !activeEnd) {
      toast.error("Please select date range first")
      return
    }
    setEditingId(null)
    setName("")
    setRemark("")
    setAdjustmentType("markup")
    setValueType("percentage")
    setValue(0)
    setProductMode("all")
    setPropertyMode("all")
    setClientMode("all")
    setSelectedProductIds([])
    setSelectedPropertyIds([])
    setSelectedClientIds([])
    setDialogOpen(true)
  }

  const openEdit = (adj: Adjustment) => {
    setEditingId(adj.id)
    setRangeStart(adj.startDate)
    setRangeEnd(adj.endDate)
    setName(adj.name)
    setRemark(adj.remark)
    setAdjustmentType(adj.adjustmentType)
    setValueType(adj.valueType)
    setValue(adj.value)
    const isAllProducts = adj.products.length === productOptions.length
    const isAllProperties = adj.properties.length === propertyOptions.length
    const isAllClients = adj.clients.length === clientOptions.length
    setProductMode(isAllProducts ? "all" : "selected")
    setPropertyMode(isAllProperties ? "all" : "selected")
    setClientMode(isAllClients ? "all" : "selected")
    setSelectedProductIds(isAllProducts ? [] : adj.products)
    setSelectedPropertyIds(isAllProperties ? [] : adj.properties)
    setSelectedClientIds(isAllClients ? [] : adj.clients)
    setDialogOpen(true)
  }

  const save = async () => {
    if (!activeStart || !activeEnd) return toast.error("Start and end date required")
    if (!name.trim()) return toast.error("Name is required")
    if (value <= 0) return toast.error("Value must be greater than 0")
    if (productMode === "selected" && selectedProductIds.length === 0) {
      return toast.error("Select at least one product")
    }
    if (propertyMode === "selected" && selectedPropertyIds.length === 0) {
      return toast.error("Select at least one property")
    }
    if (clientMode === "selected" && selectedClientIds.length === 0) {
      return toast.error("Select at least one client")
    }

    const payload: Adjustment = {
      id: editingId || `ADJ-${Date.now()}`,
      name: name.trim(),
      remark: remark.trim(),
      startDate: activeStart,
      endDate: activeEnd,
      adjustmentType,
      valueType,
      value,
      products: productMode === "all" ? productOptions.map((p) => p.id) : selectedProductIds,
      properties: propertyMode === "all" ? propertyOptions.map((p) => p.id) : selectedPropertyIds,
      clients: clientMode === "all" ? clientOptions.map((c) => c.id) : selectedClientIds,
    }

    const r = editingId
      ? await updateOperatorCalendarAdjustment(editingId, payload)
      : await createOperatorCalendarAdjustment(operatorId, payload)
    if (!r?.ok) {
      toast.error(r?.reason || "Failed to save pricing adjustment")
      return
    }
    setAdjustments((prev) => (editingId ? prev.map((item) => (item.id === editingId ? payload : item)) : [payload, ...prev]))
    setDialogOpen(false)
    toast.success(editingId ? "Pricing adjustment updated" : "Pricing adjustment created")
  }

  const removeAdjustment = async () => {
    if (!editingId) return
    const r = await deleteOperatorCalendarAdjustment(editingId)
    if (!r?.ok) {
      toast.error(r?.reason || "Failed to delete adjustment")
      return
    }
    setAdjustments((prev) => prev.filter((item) => item.id !== editingId))
    setDialogOpen(false)
    toast.success("Pricing adjustment deleted")
  }

  const goPrevMonth = () => {
    const next = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(next.getFullYear())
    setViewMonth(next.getMonth())
  }

  const goNextMonth = () => {
    const next = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(next.getFullYear())
    setViewMonth(next.getMonth())
  }

  const onClickDay = (date: Date) => {
    const key = ymd(date)
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(key)
      setRangeEnd("")
      return
    }
    setRangeEnd(key)
  }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-MY", {
    month: "long",
    year: "numeric",
  })

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <div>
        <h1 className="text-2xl font-bold">Calendar Pricing Adjustment</h1>
        <p className="text-muted-foreground">Large calendar view for pricing markup/deduction</p>
      </div>

      <Tabs value={calendarPageTab} onValueChange={(v) => setCalendarPageTab(v as "calendar" | "list")} className="w-full min-w-0">
        <TabsList className="grid h-auto w-full min-w-0 grid-cols-2 gap-1 p-1 sm:inline-flex sm:h-9 sm:w-auto">
          <TabsTrigger value="calendar" className="w-full sm:w-auto">
            Calendar view
          </TabsTrigger>
          <TabsTrigger value="list" className="w-full sm:w-auto">
            Adjustment list
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-4 space-y-4 outline-none">
          <Card className="overflow-hidden">
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <CardTitle className="text-lg">Calendar</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Button className="shrink-0" onClick={openCreate}>
                    Pricing Adjustment
                  </Button>
                  <div className="flex flex-1 items-center justify-center gap-1 sm:flex-initial sm:justify-end">
                    <Button variant="outline" size="icon" onClick={goPrevMonth} aria-label="Previous month">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Badge variant="secondary" className="max-w-[min(100%,14rem)] shrink truncate px-2 py-1 text-xs sm:text-sm">
                      {monthLabel}
                    </Badge>
                    <Button variant="outline" size="icon" onClick={goNextMonth} aria-label="Next month">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <CardDescription>Select date range by tapping dates, then tap Pricing Adjustment</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto pb-1 -mx-1 px-1 md:mx-0 md:overflow-visible md:px-0">
                <div className="min-w-[560px] md:min-w-0">
                  <div className="grid grid-cols-7 gap-1 md:gap-2">
                    {weekDays.map((d) => (
                      <div key={d} className="px-0.5 text-center text-[10px] font-medium text-muted-foreground sm:text-xs md:px-2">
                        {d}
                      </div>
                    ))}
                  </div>

                  <div className="mt-1 grid grid-cols-7 gap-1 md:gap-2">
                    {cells.map((day) => {
                      const dayKey = ymd(day)
                      const sameMonth = day.getMonth() === viewMonth
                      const selected = activeStart && activeEnd && inRange(dayKey, activeStart, activeEnd)
                      const adjs = dayAdjustments(dayKey)
                      const price = dayPrice(dayKey)

                      return (
                        <button
                          key={dayKey}
                          type="button"
                          onClick={() => onClickDay(day)}
                          className={`min-h-[5.5rem] rounded-lg border p-1.5 text-left align-top transition sm:min-h-[6.5rem] md:h-44 md:min-h-0 md:p-2 ${
                            selected ? "ring-2 ring-primary/40" : ""
                          } ${!sameMonth ? "opacity-50" : ""}`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-semibold leading-none sm:text-sm">{day.getDate()}</span>
                            <span className="text-[10px] font-medium tabular-nums text-muted-foreground sm:text-xs md:text-sm">
                              RM{price}
                            </span>
                          </div>
                          <div className="mt-1 space-y-0.5 md:mt-2 md:min-h-[72px] md:space-y-1">
                            {adjs.map((adj) => (
                              <button
                                key={adj.id}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openEdit(adj)
                                }}
                                className="w-full cursor-pointer text-left"
                                title={`Edit ${adj.name}`}
                              >
                                <Badge
                                  className={`w-full justify-start truncate border-0 px-1 py-0 text-[9px] leading-tight transition-colors sm:text-xs ${promotionColorClass(adj.id)}`}
                                >
                                  <span className="truncate">
                                    {adj.name} {adj.adjustmentType === "markup" ? "+" : "-"}
                                    {adj.value}
                                    {adj.valueType === "percentage" ? "%" : " RM"}
                                  </span>
                                </Badge>
                              </button>
                            ))}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant="secondary" className="max-w-full whitespace-normal text-left text-xs leading-snug">
                  {activeStart ? `Selected: ${activeStart} to ${activeEnd || activeStart}` : "No date selected"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="list" className="mt-4 outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Adjustment List</CardTitle>
              <CardDescription>Search and filter adjustment records</CardDescription>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                <Input placeholder="Search name / remark / value" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
                <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {filteredAdjustments.length === 0 ? (
                <div className="rounded-lg border p-4 text-sm text-muted-foreground">No adjustment found</div>
              ) : (
                filteredAdjustments.map((adj) => (
                  <button
                    key={adj.id}
                    type="button"
                    onClick={() => openEdit(adj)}
                    className="w-full rounded-lg border p-3 text-left transition hover:bg-muted/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{adj.name}</span>
                      <Badge
                        className={`${
                          adj.adjustmentType === "markup"
                            ? adj.valueType === "percentage"
                              ? "bg-cyan-100 text-cyan-800 border-0"
                              : "bg-violet-100 text-violet-800 border-0"
                            : adj.valueType === "percentage"
                              ? "bg-rose-100 text-rose-800 border-0"
                              : "bg-amber-100 text-amber-800 border-0"
                        }`}
                      >
                        {adj.adjustmentType === "markup" ? "+" : "-"}
                        {adj.value}
                        {adj.valueType === "percentage" ? "%" : " RM"}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {adj.startDate} to {adj.endDate}
                      {adj.remark ? ` · ${adj.remark}` : ""}
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Pricing Adjustment" : "Add Pricing Adjustment"}</DialogTitle>
            <DialogDescription>Apply pricing rules for selected date range</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend JB markup" />
            </div>
            <div className="space-y-2">
              <Label>Remark</Label>
              <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional remark" />
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={activeStart} onChange={(e) => setRangeStart(ymd(fromYmd(e.target.value)))} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={activeEnd} onChange={(e) => setRangeEnd(ymd(fromYmd(e.target.value)))} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={adjustmentType} onValueChange={(v: AdjustmentType) => setAdjustmentType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="markup">Markup</SelectItem>
                  <SelectItem value="deduction">Deduction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value Type</Label>
              <Select value={valueType} onValueChange={(v: ValueType) => setValueType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed Amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>{valueType === "percentage" ? "Value (%)" : "Value (RM)"}</Label>
              <Input type="number" min={0} value={value} onChange={(e) => setValue(Number(e.target.value || 0))} />
            </div>
            <div className="space-y-2">
              <Label>Product Scope</Label>
              <Select value={productMode} onValueChange={(v: ScopeMode) => setProductMode(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Product</SelectItem>
                  <SelectItem value="selected">Selected Product</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Property Scope</Label>
              <Select value={propertyMode} onValueChange={(v: ScopeMode) => setPropertyMode(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Property</SelectItem>
                  <SelectItem value="selected">Selected Property</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Client Scope</Label>
              <Select value={clientMode} onValueChange={(v: ScopeMode) => setClientMode(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Client</SelectItem>
                  <SelectItem value="selected">Selected Client</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {productMode === "selected" && (
              <div className="space-y-2 md:col-span-2">
                <Label>Select Product</Label>
                <div className="rounded-lg border p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {productOptions.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedProductIds.includes(item.id)}
                        onCheckedChange={(v) =>
                          setSelectedProductIds((prev) =>
                            v ? [...new Set([...prev, item.id])] : prev.filter((id) => id !== item.id)
                          )
                        }
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {propertyMode === "selected" && (
              <div className="space-y-2 md:col-span-2">
                <Label>Select Property</Label>
                <div className="rounded-lg border p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {propertyOptions.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedPropertyIds.includes(item.id)}
                        onCheckedChange={(v) =>
                          setSelectedPropertyIds((prev) =>
                            v ? [...new Set([...prev, item.id])] : prev.filter((id) => id !== item.id)
                          )
                        }
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {clientMode === "selected" && (
              <div className="space-y-2 md:col-span-2">
                <Label>Select Client</Label>
                <div className="rounded-lg border p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {clientOptions.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedClientIds.includes(item.id)}
                        onCheckedChange={(v) =>
                          setSelectedClientIds((prev) =>
                            v ? [...new Set([...prev, item.id])] : prev.filter((id) => id !== item.id)
                          )
                        }
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            {editingId ? (
              <Button variant="destructive" onClick={() => void removeAdjustment()}>
                Delete
              </Button>
            ) : null}
            <Button onClick={() => void save()}>{editingId ? "Update" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

