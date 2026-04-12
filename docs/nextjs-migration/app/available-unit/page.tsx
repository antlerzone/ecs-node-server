"use client"

import { Suspense, useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, Building2, ChevronRight, LayoutGrid, List, ExternalLink, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { wixImageToStatic } from "@/lib/utils"
import { PortalSiteHeader } from "@/components/portal-site-header"
import { toast } from "@/hooks/use-toast"
import { isDemoSite } from "@/lib/portal-api"

// Call Node API directly (public endpoint, no auth). Avoids Nginx routing to Next.
const ECS_BASE = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "");
const LIST_API_URL = `${ECS_BASE}/api/availableunit/list`;

type PropertyOption = { value: string; label: string }
type UnitItem = {
  id: string
  _id?: string
  roomName?: string
  title_fld?: string
  description_fld?: string
  remark?: string
  price?: number | null
  mainPhoto?: string | null
  mediaGallery?: Array<{ src?: string; url?: string; type?: string } | string>
  available?: boolean
  availablesoon?: boolean
  propertyId?: string
  property?: { shortname?: string; _id?: string }
  clientContact?: string | null
  currency?: string
  operatorName?: string | null
  /** Estimated ready date (YYYY-MM-DD) when availablesoon */
  availableFrom?: string | null
  country?: string
}

type ListResponse = {
  ok: boolean
  reason?: string
  items?: UnitItem[]
  properties?: PropertyOption[]
  clientContact?: string | null
  clientCurrency?: string
  totalPages?: number
  currentPage?: number
  total?: number
}

/** Format YYYY-MM-DD to "15 Mar 2026" */
function formatReadyDate(isoDate: string | null | undefined): string {
  if (!isoDate || typeof isoDate !== "string") return ""
  const d = new Date(isoDate + "T12:00:00")
  if (isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function formatPrice(item: UnitItem, fallbackCurrency: string = "") {
  const currency = (item.currency || fallbackCurrency || "").trim().toUpperCase()
  const price = item.price
  if (price == null || price === "") return `${currency} -`
  const num = Number(price)
  if (isNaN(num)) return `${currency} -`
  const amount = num % 1 === 0 ? String(Math.round(num)) : num.toFixed(2)
  const withCommas = amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${currency} ${withCommas}`
}

function getMediaUrls(item: UnitItem): string[] {
  const urls: string[] = []
  if (item.mainPhoto) urls.push(item.mainPhoto)
  const gallery = item.mediaGallery || []
  for (const m of gallery) {
    const src = typeof m === "string" ? m : (m?.src ?? m?.url)
    if (src) urls.push(src)
  }
  return urls
}

const SORT_OPTIONS = [
  { value: "title", label: "Title A-Z" },
  { value: "title_desc", label: "Title Z-A" },
  { value: "price_asc", label: "Price Low to High" },
  { value: "price_desc", label: "Price High to Low" },
]

const COUNTRY_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "Malaysia", label: "Malaysia" },
  { value: "Singapore", label: "Singapore" },
]

function AvailableUnitContent() {
  const searchParams = useSearchParams()
  const subdomainFromUrl = searchParams?.get("subdomain")?.trim().toLowerCase() || ""

  const [items, setItems] = useState<UnitItem[]>([])
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [clientContact, setClientContact] = useState<string | null>(null)
  const [clientCurrency, setClientCurrency] = useState("")
  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [propertyId, setPropertyId] = useState("ALL")
  const [sort, setSort] = useState("title")
  const [keyword, setKeyword] = useState("")
  const [keywordInput, setKeywordInput] = useState("")
  const [country, setCountry] = useState("ALL")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [selectedUnit, setSelectedUnit] = useState<UnitItem | null>(null)
  const demoUnits: UnitItem[] = [
    { id: "demo-u1", roomName: "Room 101", property: { shortname: "Demo Property", _id: "p1" }, propertyId: "p1", country: "Malaysia", price: 850, available: true, operatorName: "Atlas Living", clientContact: "60123456789", remark: "Fully furnished with balcony", currency: "MYR" },
    { id: "demo-u2", roomName: "Room 206", property: { shortname: "Sunrise Tower", _id: "p2" }, propertyId: "p2", country: "Malaysia", price: 980, availablesoon: true, availableFrom: "2026-04-01", operatorName: "Atlas Living", clientContact: "60123456789", remark: "Near MRT and shopping mall", currency: "MYR" },
    { id: "demo-u3", roomName: "Studio A3", property: { shortname: "Green Residence", _id: "p3" }, propertyId: "p3", country: "Malaysia", price: 1200, available: true, operatorName: "Atlas Living", clientContact: "60123456789", remark: "Private bathroom, high floor", currency: "MYR" },
    { id: "demo-u4", roomName: "Room 508", property: { shortname: "City Central", _id: "p4" }, propertyId: "p4", country: "Singapore", price: 1350, available: true, operatorName: "CityKey SG", clientContact: "6587654321", remark: "CBD access in 10 minutes", currency: "SGD" },
    { id: "demo-u5", roomName: "Room 312", property: { shortname: "Riverside", _id: "p5" }, propertyId: "p5", country: "Malaysia", price: 920, availablesoon: true, availableFrom: "2026-04-12", operatorName: "Riverside Ops", clientContact: "60199887766", remark: "Quiet floor, suitable for WFH", currency: "MYR" },
    { id: "demo-u6", roomName: "Loft B2", property: { shortname: "Marina Point", _id: "p6" }, propertyId: "p6", country: "Singapore", price: 1680, available: true, operatorName: "CityKey SG", clientContact: "6587654321", remark: "Dual-key loft with skyline view", currency: "SGD" },
  ]

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      if (isDemoSite()) {
        let list = [...demoUnits]
        if (country !== "ALL") list = list.filter((u) => (u.country || "").toLowerCase() === country.toLowerCase())
        if (propertyId !== "ALL") list = list.filter((u) => (u.propertyId || u.property?._id) === propertyId)
        if (keyword.trim()) {
          const q = keyword.trim().toLowerCase()
          list = list.filter((u) =>
            `${u.roomName || ""} ${u.title_fld || ""} ${u.property?.shortname || ""} ${u.remark || ""}`.toLowerCase().includes(q)
          )
        }
        if (sort === "title") list.sort((a, b) => String(a.roomName || a.title_fld || "").localeCompare(String(b.roomName || b.title_fld || "")))
        if (sort === "title_desc") list.sort((a, b) => String(b.roomName || b.title_fld || "").localeCompare(String(a.roomName || a.title_fld || "")))
        if (sort === "price_asc") list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0))
        if (sort === "price_desc") list.sort((a, b) => Number(b.price || 0) - Number(a.price || 0))
        setItems(list)
        setProperties([
          { value: "ALL", label: "All" },
          { value: "p1", label: "Demo Property" },
          { value: "p2", label: "Sunrise Tower" },
          { value: "p3", label: "Green Residence" },
          { value: "p4", label: "City Central" },
          { value: "p5", label: "Riverside" },
          { value: "p6", label: "Marina Point" },
        ])
        setClientContact("60123456789")
        setClientCurrency(country === "Singapore" ? "SGD" : "MYR")
        setTotalPages(1)
        setCurrentPage(1)
        setTotal(list.length)
        return
      }
      const opts: Record<string, unknown> = {
        propertyId: propertyId === "ALL" ? undefined : propertyId,
        sort,
        page: currentPage,
        pageSize: 20,
      }
      if (keyword.trim()) opts.keyword = keyword.trim()
      if (country !== "ALL") opts.country = country
      // No subdomain = public page = all operators' available units; ?subdomain=xxx = one client only
      if (subdomainFromUrl) opts.subdomain = subdomainFromUrl

      const res = await fetch(LIST_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      })
      const data: ListResponse = await res.json().catch(() => ({ ok: false }))
      if (!data.ok) {
        setItems([])
        setProperties([])
        setTotal(0)
        setTotalPages(1)
        setCurrentPage(1)
        return
      }
      setItems(data.items || [])
      setProperties(data.properties || [{ value: "ALL", label: "All" }])
      setClientContact(data.clientContact ?? null)
      setClientCurrency((data.clientCurrency || "").trim().toUpperCase())
      setTotalPages(data.totalPages ?? 1)
      setCurrentPage(data.currentPage ?? 1)
      setTotal(data.total ?? 0)
    } catch {
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [subdomainFromUrl, propertyId, sort, currentPage, keyword, country])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Open unit detail when URL has ?unit=id and that unit is in current items
  const unitIdFromUrl = searchParams?.get("unit")?.trim() || null
  useEffect(() => {
    if (!unitIdFromUrl || items.length === 0) return
    const found = items.find((u) => (u.id || u._id) === unitIdFromUrl)
    if (found) setSelectedUnit(found)
  }, [unitIdFromUrl, items])

  useEffect(() => {
    setCurrentPage(1)
  }, [keyword, country, propertyId, sort])

  // Debounce keyword search
  useEffect(() => {
    const t = setTimeout(() => setKeyword(keywordInput), 400)
    return () => clearTimeout(t)
  }, [keywordInput])

  const openWhatsApp = (item: UnitItem) => {
    const contact = item.clientContact ?? clientContact
    const phone = contact ? String(contact).trim().replace(/\D/g, "") : null
    if (!phone) return
    const propName = item.property?.shortname || ""
    const roomName = item.roomName || item.title_fld || ""
    const text = encodeURIComponent(`${propName} ${roomName} enquiry`.trim() || "enquiry")
    window.open(`https://wasap.my/${phone}/${text}`, "_blank", "noopener")
  }

  const shareUnitUrl = (unit: UnitItem) => {
    if (typeof window === "undefined") return ""
    const base = `${window.location.origin}${window.location.pathname}`
    const params = new URLSearchParams()
    params.set("unit", unit.id || (unit._id ?? ""))
    if (subdomainFromUrl) params.set("subdomain", subdomainFromUrl)
    return `${base}?${params.toString()}`
  }

  const handleShareUnit = async (unit: UnitItem, e?: React.MouseEvent) => {
    e?.preventDefault()
    const url = shareUnitUrl(unit)
    if (!url || !(unit.id || unit._id)) return
    const roomName = unit.roomName || unit.title_fld || "Room"
    const title = `${roomName} – Available Unit`
    const text = `Check out this coliving unit: ${roomName}`
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, text, url })
        toast({ title: "Shared!" })
      } else {
        await navigator.clipboard.writeText(url)
        toast({ title: "Link copied" })
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      try {
        await navigator.clipboard.writeText(url)
        toast({ title: "Link copied" })
      } catch {
        toast({ title: "Could not copy link", variant: "destructive" })
      }
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4 mb-3">
            <PortalSiteHeader />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="icon" className="shrink-0">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-foreground">Available Units</h1>
                <p className="text-sm text-muted-foreground">
                  {subdomainFromUrl ? `Subdomain: ${subdomainFromUrl}` : "All properties"}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search by name..."
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              className="max-w-[200px]"
            />
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={propertyId} onValueChange={(v) => { setPropertyId(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Property" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => { setSort(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex rounded-md border border-input">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-r-none"
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-l-none"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-8 w-8 text-primary" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            No available units found. Try adjusting filters.
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((unit) => {
              const urls = getMediaUrls(unit)
              const propName = unit.property?.shortname ?? ""
              const roomName = unit.roomName || unit.title_fld || ""
              const availableText = unit.available ? "Available" : unit.availablesoon ? "Available Soon" : ""
              return (
                <div
                  key={unit.id || unit._id}
                  className="rounded-xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="aspect-[4/3] bg-muted relative">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Building2 className="h-12 w-12 text-muted-foreground/50" />
                    </div>
                    {urls[0] && (
                      <img
                        src={wixImageToStatic(urls[0])}
                        alt={roomName}
                        className="absolute inset-0 w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                      />
                    )}
                    {availableText && (
                      <span
                        className="absolute top-2 right-2 text-xs font-semibold px-2 py-1 rounded-full bg-primary text-primary-foreground"
                      >
                        {unit.availablesoon && unit.availableFrom
                          ? `Available Soon (${formatReadyDate(unit.availableFrom)})`
                          : availableText}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <div>
                        <h3 className="font-semibold text-foreground">{roomName}</h3>
                        <p className="text-sm text-muted-foreground">{propName}</p>
                        <p className="text-xs text-muted-foreground/80 mt-0.5">
                          Operator: {unit.operatorName || "—"}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-primary">{formatPrice(unit, clientCurrency)}</div>
                        <div className="text-xs text-muted-foreground">/ month</div>
                      </div>
                    </div>
                    {unit.remark && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{unit.remark}</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setSelectedUnit(unit)}
                      >
                        View details <ChevronRight className="h-3 w-3 ml-1" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => handleShareUnit(unit, e)}
                        title="Share this room"
                        aria-label="Share this room"
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => openWhatsApp(unit)}
                        disabled={!(unit.clientContact ?? clientContact)}
                        title="Contact via WhatsApp"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((unit) => {
              const propName = unit.property?.shortname ?? ""
              const roomName = unit.roomName || unit.title_fld || ""
              const availableText = unit.available ? "Available" : unit.availablesoon ? "Available Soon" : ""
              return (
                <div
                  key={unit.id || unit._id}
                  className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card"
                >
                  <div className="shrink-0 w-24 h-16 rounded bg-muted overflow-hidden relative">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Building2 className="h-6 w-6 text-muted-foreground/50" />
                    </div>
                    {getMediaUrls(unit)[0] && (
                      <img
                        src={wixImageToStatic(getMediaUrls(unit)[0])}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{roomName}</div>
                    <div className="text-sm text-muted-foreground">{propName} · {formatPrice(unit, clientCurrency)}/mo</div>
                    <div className="text-xs text-muted-foreground/80">Operator: {unit.operatorName || "—"}</div>
                  </div>
                  <span className="text-xs font-medium text-primary shrink-0">
                    {unit.availablesoon && unit.availableFrom
                      ? `Available Soon (${formatReadyDate(unit.availableFrom)})`
                      : availableText}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setSelectedUnit(unit)}>
                    Details
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => handleShareUnit(unit, e)}
                    title="Share this room"
                    aria-label="Share this room"
                    className="shrink-0"
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 shrink-0"
                    onClick={() => openWhatsApp(unit)}
                    disabled={!(unit.clientContact ?? clientContact)}
                  >
                    WhatsApp
                  </Button>
                </div>
              )
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages} ({total} units)
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </main>

      <Dialog open={!!selectedUnit} onOpenChange={(open) => !open && setSelectedUnit(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedUnit?.roomName || selectedUnit?.title_fld || "Unit details"}
            </DialogTitle>
          </DialogHeader>
          {selectedUnit && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Operator: {selectedUnit.operatorName || "—"}</p>
              <div className="grid grid-cols-2 gap-2">
                {getMediaUrls(selectedUnit).map((src, i) => (
                  <img
                    key={i}
                    src={wixImageToStatic(src)}
                    alt=""
                    className="w-full rounded-lg object-cover aspect-square"
                    referrerPolicy="no-referrer"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                  />
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedUnit.description_fld || selectedUnit.remark || "—"}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <span className="font-semibold text-primary">
                  {formatPrice(selectedUnit, clientCurrency)} / month
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => handleShareUnit(selectedUnit, e)}
                    title="Share this room"
                  >
                    <Share2 className="h-4 w-4 mr-1" /> Share
                  </Button>
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => openWhatsApp(selectedUnit)}
                    disabled={!(selectedUnit.clientContact ?? clientContact)}
                  >
                    Contact via WhatsApp <ExternalLink className="h-3 w-3 ml-1 inline" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function AvailableUnitPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    }>
      <AvailableUnitContent />
    </Suspense>
  )
}
