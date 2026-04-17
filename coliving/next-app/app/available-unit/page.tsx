"use client"

import {
  Suspense,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  List,
  Map as MapIcon,
  MapPin,
  Search,
  Share2,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"
import { Spinner } from "@/components/ui/spinner"
import { wixImageToStatic, cn } from "@/lib/utils"
import { PortalSiteHeader } from "@/components/portal-site-header"
import { toast } from "@/hooks/use-toast"
import { isDemoSite } from "@/lib/portal-api"
import {
  AvailableUnitsExploreMap,
  countMappableUnits,
} from "@/components/portal/available-units-explore-map"

const ECS_BASE = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
const LIST_API_URL = `${ECS_BASE}/api/availableunit/list`

type PropertyOption = { value: string; label: string }
type UnitItem = {
  id: string
  _id?: string
  roomName?: string
  /** roomdetail.listing_scope — public listing kind */
  listingScope?: "room" | "entire_unit"
  title_fld?: string
  description_fld?: string
  remark?: string
  price?: number | null
  mainPhoto?: string | null
  mediaGallery?: Array<{ src?: string; url?: string; type?: string } | string>
  available?: boolean
  availablesoon?: boolean
  propertyId?: string
  property?: {
    shortname?: string
    apartmentName?: string | null
    _id?: string
    latitude?: number | null
    longitude?: number | null
  }
  clientContact?: string | null
  currency?: string
  operatorName?: string | null
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

function formatReadyDate(isoDate: string | null | undefined): string {
  if (!isoDate || typeof isoDate !== "string") return ""
  const d = new Date(isoDate + "T12:00:00")
  if (isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/** Monthly rent slider upper bound (must match `availableunit.service.js` PRICE_RANGE_MAX). */
const PRICE_SLIDER_MAX = 10000
const PRICE_SLIDER_STEP = 50

/** 1 SGD → MYR for slider filter when comparing in MYR (align with server `FX_SGD_TO_MYR` default). */
const PUBLIC_FX_SGD_TO_MYR = 3.5

/** Convert listing rent to the currency used for min/max slider comparison (demo + display). */
function comparableMonthlyForFilter(
  price: number | null | undefined,
  listingCurrency: string | undefined,
  compareIn: "MYR" | "SGD" | "OFF",
): number {
  if (compareIn === "OFF") return Number(price ?? 0)
  const p = Number(price ?? 0)
  const c = (listingCurrency || "").toUpperCase()
  if (compareIn === "MYR") return c === "SGD" ? p * PUBLIC_FX_SGD_TO_MYR : p
  return c === "MYR" ? p / PUBLIC_FX_SGD_TO_MYR : p
}

/** Slider / API priceCompareCurrency: FX basis only — does not hide listings (country filter uses property). */
const MONTHLY_PRICE_IN_OPTIONS: { value: "MYR" | "SGD" | "OFF"; label: string }[] = [
  { value: "MYR", label: "MYR" },
  { value: "SGD", label: "SGD" },
  { value: "OFF", label: "Native" },
]

/** Slider / chip labels: when `currency` is null (all countries, no subdomain), show plain numbers — amounts are not one FX unit. */
function formatSliderMoney(amount: number, currency: string | null | undefined): string {
  const c = currency?.trim().toUpperCase()
  const n = Math.round(amount)
  const withCommas = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  if (!c) return withCommas
  if (c === "MYR") return `RM${withCommas}`
  if (c === "SGD") return `S$${withCommas}`
  return `${c} ${withCommas}`
}

function formatPrice(item: UnitItem, fallbackCurrency: string = "") {
  const currency = (item.currency || fallbackCurrency || "").trim().toUpperCase()
  const price = item.price
  if (price == null || price === "") return `${currency ? `${currency} ` : ""}—`
  const num = Number(price)
  if (isNaN(num)) return `${currency ? `${currency} ` : ""}—`
  const amount = num % 1 === 0 ? String(Math.round(num)) : num.toFixed(2)
  const withCommas = amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const prefix = currency === "MYR" ? "RM" : currency === "SGD" ? "S$" : `${currency} `
  if (currency === "MYR" || currency === "SGD") return `${prefix}${withCommas}`
  return `${currency} ${withCommas}`
}

/** Listing cards / dialog: show rent in the visitor’s “Monthly price in” choice (whole numbers, same FX as slider/API). */
function displayMonthlyPrice(
  item: UnitItem,
  compare: "MYR" | "SGD" | "OFF",
  fallbackCurrency: string = "",
): string {
  if (compare === "OFF") return formatPrice(item, fallbackCurrency)
  if (item.price == null || item.price === "") return "—"
  const raw = comparableMonthlyForFilter(item.price, item.currency, compare)
  if (!Number.isFinite(raw)) return "—"
  const n = Math.round(raw)
  const withCommas = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  if (compare === "MYR") return `RM${withCommas}`
  return `S$${withCommas}`
}

function propertyDisplayName(unit: UnitItem): string {
  const apt = unit.property?.apartmentName?.trim()
  if (apt) return apt
  return (unit.property?.shortname ?? "").trim() || "Coliving"
}

/** Google / Waze deep links: coordinates when available, else building name search. */
function navigationUrlsForUnit(unit: UnitItem): { google: string; waze: string } {
  const lat = unit.property?.latitude
  const lng = unit.property?.longitude
  const la = lat != null ? Number(lat) : NaN
  const lo = lng != null ? Number(lng) : NaN
  const valid =
    Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180
  if (valid) {
    const pair = `${la},${lo}`
    return {
      google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pair)}`,
      waze: `https://waze.com/ul?ll=${la}%2C${lo}&navigate=yes`,
    }
  }
  const label = encodeURIComponent(propertyDisplayName(unit))
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${label}`,
    waze: `https://waze.com/ul?q=${label}`,
  }
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

const COUNTRY_OPTIONS = [
  { value: "ALL", label: "All countries" },
  { value: "Malaysia", label: "Malaysia" },
  { value: "Singapore", label: "Singapore" },
]

type FilterPanelProps = {
  keywordInput: string
  setKeywordInput: (v: string) => void
  country: string
  setCountry: (v: string) => void
  priceCompareCurrency: "MYR" | "SGD" | "OFF"
  setPriceCompareCurrency: (v: "MYR" | "SGD" | "OFF") => void
  propertyId: string
  setPropertyId: (v: string) => void
  properties: PropertyOption[]
  listingScope: string
  setListingScope: (v: string) => void
  sort: string
  setSort: (v: string) => void
  resetPage: () => void
  priceRange: [number, number]
  setPriceRange: (v: [number, number]) => void
  /** MYR/SGD for slider labels; null = show plain numbers (native / mixed) */
  priceCurrency: string | null
}

function AvailableUnitsFilterPanel({
  keywordInput,
  setKeywordInput,
  country,
  setCountry,
  priceCompareCurrency,
  setPriceCompareCurrency,
  propertyId,
  setPropertyId,
  properties,
  listingScope,
  setListingScope,
  sort,
  setSort,
  resetPage,
  priceRange,
  setPriceRange,
  priceCurrency,
}: FilterPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0">
        <label className="mb-1.5 block text-[13px] font-medium text-neutral-600">Search</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input
            placeholder="Room name or title"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            className="h-11 rounded-xl border-neutral-200 bg-neutral-50/80 pl-10 text-[15px] focus-visible:bg-white"
          />
        </div>
      </div>
      <div className="min-w-0">
        <label className="mb-1.5 block text-[13px] font-medium text-neutral-600">Country</label>
        <Select
          value={country}
          onValueChange={(v) => {
            setCountry(v)
            resetPage()
          }}
        >
          <SelectTrigger className="h-11 w-full min-w-0 rounded-xl border-neutral-200 bg-neutral-50/80 focus-visible:bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
            {COUNTRY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <label className="mb-1.5 block text-[13px] font-medium text-neutral-600">Building</label>
        <Select
          value={propertyId}
          onValueChange={(v) => {
            setPropertyId(v)
            resetPage()
          }}
        >
          <SelectTrigger className="h-11 w-full min-w-0 rounded-xl border-neutral-200 bg-neutral-50/80 focus-visible:bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)] max-h-60">
            {properties.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <label className="mb-1.5 block text-[13px] font-medium text-neutral-600">Listing type</label>
        <Select
          value={listingScope}
          onValueChange={(v) => {
            setListingScope(v)
            resetPage()
          }}
        >
          <SelectTrigger className="h-11 w-full min-w-0 rounded-xl border-neutral-200 bg-neutral-50/80 focus-visible:bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="ROOM">Room</SelectItem>
            <SelectItem value="ENTIRE_UNIT">Entire unit</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <label className="mb-1.5 block text-[13px] font-medium text-neutral-600">Monthly price in</label>
        <Select
          value={priceCompareCurrency}
          onValueChange={(v) => {
            setPriceCompareCurrency(v as "MYR" | "SGD" | "OFF")
            resetPage()
          }}
        >
          <SelectTrigger className="h-11 w-full min-w-0 rounded-xl border-neutral-200 bg-neutral-50/80 focus-visible:bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
            {MONTHLY_PRICE_IN_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <div className="mb-1.5 flex flex-wrap items-end justify-between gap-x-2 gap-y-0.5">
          <label className="text-[13px] font-medium text-neutral-600">Monthly price</label>
          <span className="text-right text-[11px] tabular-nums leading-tight text-neutral-500">
            {formatSliderMoney(priceRange[0], priceCurrency)} – {formatSliderMoney(priceRange[1], priceCurrency)}
          </span>
        </div>
        <Slider
          min={0}
          max={PRICE_SLIDER_MAX}
          step={PRICE_SLIDER_STEP}
          value={priceRange}
          onValueChange={(v) => {
            const lo = Math.min(v[0] ?? 0, v[1] ?? PRICE_SLIDER_MAX)
            const hi = Math.max(v[0] ?? 0, v[1] ?? PRICE_SLIDER_MAX)
            setPriceRange([lo, hi])
          }}
          className="py-2.5"
          aria-label="Filter by monthly price range"
        />
        <p className="text-[11px] leading-snug text-neutral-400">
          0 – {PRICE_SLIDER_MAX.toLocaleString()} · drag both handles
          {!priceCurrency && priceCompareCurrency === "OFF" ? " · each card shows that operator's currency" : ""}
        </p>
      </div>
      <div className="min-w-0">
        <label className="mb-1.5 block text-[13px] font-medium text-neutral-600">Sort by price</label>
        <Select
          value={sort}
          onValueChange={(v) => {
            setSort(v)
            resetPage()
          }}
        >
          <SelectTrigger className="h-11 w-full min-w-0 rounded-xl border-neutral-200 bg-neutral-50/80 focus-visible:bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
            <SelectItem value="price_asc">Low → high</SelectItem>
            <SelectItem value="price_desc">High → low</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function AvailableUnitsFilterMenuPopover({
  open,
  onOpenChange,
  panelProps,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  panelProps: FilterPanelProps
  children: ReactNode
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-[min(100vw-1.5rem,22rem)] max-h-[min(85vh,32rem)] overflow-y-auto p-4"
        align="end"
        sideOffset={8}
      >
        <p className="mb-3 text-sm font-semibold text-neutral-900">Filters</p>
        <AvailableUnitsFilterPanel {...panelProps} />
        <Button type="button" className="mt-4 w-full rounded-xl" variant="secondary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </PopoverContent>
    </Popover>
  )
}

const JB_COORDS: Record<string, { latitude: number; longitude: number }> = {
  p1: { latitude: 1.4928, longitude: 103.739 },
  p2: { latitude: 1.486, longitude: 103.748 },
  p3: { latitude: 1.501, longitude: 103.755 },
  p4: { latitude: 1.3048, longitude: 103.8318 },
  p5: { latitude: 1.478, longitude: 103.722 },
  p6: { latitude: 1.2895, longitude: 103.85 },
}

function UnitImageCarousel({ urls, alt }: { urls: string[]; alt: string }) {
  const [api, setApi] = useState<CarouselApi | null>(null)
  const [snap, setSnap] = useState(0)

  useEffect(() => {
    if (!api) return
    const onSel = () => setSnap(api.selectedScrollSnap())
    onSel()
    api.on("select", onSel)
    return () => {
      api.off("select", onSel)
    }
  }, [api])

  if (urls.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-neutral-100">
        <Building2 className="h-14 w-14 text-neutral-300" />
      </div>
    )
  }

  if (urls.length === 1) {
    return (
      <img
        src={wixImageToStatic(urls[0])}
        alt={alt}
        className="absolute inset-0 h-full w-full object-cover"
        referrerPolicy="no-referrer"
        onError={(e) => {
          ;(e.target as HTMLImageElement).style.display = "none"
        }}
      />
    )
  }

  return (
    <Carousel className="h-full w-full" opts={{ loop: true, align: "start" }} setApi={setApi}>
      <CarouselContent className="-ml-0 h-full">
        {urls.map((src, i) => (
          <CarouselItem key={i} className="h-full basis-full pl-0">
            <img
              src={wixImageToStatic(src)}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = "none"
              }}
            />
          </CarouselItem>
        ))}
      </CarouselContent>
      <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center gap-1">
        {urls.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors",
              i === snap ? "bg-white shadow-sm" : "bg-white/50",
            )}
          />
        ))}
      </div>
    </Carousel>
  )
}

function AvailableUnitContent() {
  const router = useRouter()
  const pathname = usePathname()
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
  const [listingScopeFilter, setListingScopeFilter] = useState("ALL")
  const [sort, setSort] = useState("price_asc")
  const [keyword, setKeyword] = useState("")
  const [keywordInput, setKeywordInput] = useState("")
  const [country, setCountry] = useState("ALL")
  /** Slider / API: MYR or SGD converts the other currency for min–max only (`FX_SGD_TO_MYR` on server). */
  const [priceCompareCurrency, setPriceCompareCurrency] = useState<"MYR" | "SGD" | "OFF">("MYR")
  const [priceRange, setPriceRange] = useState<[number, number]>([0, PRICE_SLIDER_MAX])
  const [priceQuery, setPriceQuery] = useState<[number, number]>([0, PRICE_SLIDER_MAX])
  const [selectedUnit, setSelectedUnit] = useState<UnitItem | null>(null)
  const [surface, setSurface] = useState<"list" | "map">("list")
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [mapsMenuOpen, setMapsMenuOpen] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const resetPage = useCallback(() => setCurrentPage(1), [])

  /** Deep link: /available-unit?view=map (mount only; avoids fighting router.replace) */
  useLayoutEffect(() => {
    if (searchParams?.get("view") === "map") setSurface("map")
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read initial URL once
  }, [])

  /** Browser back/forward and URL bar changes */
  useEffect(() => {
    const onPop = () => {
      try {
        const q = new URLSearchParams(window.location.search)
        setSurface(q.get("view") === "map" ? "map" : "list")
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  const goToMap = useCallback(() => {
    setFilterMenuOpen(false)
    setSurface("map")
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    params.set("view", "map")
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  const goToList = useCallback(() => {
    setFilterMenuOpen(false)
    setSurface("list")
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    params.delete("view")
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  const demoUnits: UnitItem[] = useMemo(
    () => [
      {
        id: "demo-u1",
        roomName: "Room 101",
        listingScope: "room",
        property: { apartmentName: "Marina View Tower A", shortname: "Demo Property", _id: "p1", ...JB_COORDS.p1 },
        propertyId: "p1",
        country: "Malaysia",
        price: 850,
        available: true,
        operatorName: "Atlas Living",
        clientContact: "60123456789",
        remark: "Fully furnished with balcony",
        currency: "MYR",
      },
      {
        id: "demo-u2",
        roomName: "Room 206",
        property: { apartmentName: "Sunrise Tower", shortname: "Sunrise Tower", _id: "p2", ...JB_COORDS.p2 },
        propertyId: "p2",
        country: "Malaysia",
        price: 980,
        availablesoon: true,
        availableFrom: "2026-04-01",
        operatorName: "Atlas Living",
        clientContact: "60123456789",
        remark: "Near MRT and shopping mall",
        currency: "MYR",
      },
      {
        id: "demo-u3",
        roomName: "Whole unit — Green Residence",
        listingScope: "entire_unit",
        property: { apartmentName: "Green Residence", shortname: "Green Residence", _id: "p3", ...JB_COORDS.p3 },
        propertyId: "p3",
        country: "Malaysia",
        price: 1200,
        available: true,
        operatorName: "Atlas Living",
        clientContact: "60123456789",
        remark: "Private bathroom, high floor",
        currency: "MYR",
      },
      {
        id: "demo-u4",
        roomName: "Room 508",
        property: { apartmentName: "City Central Plaza", shortname: "City Central", _id: "p4", ...JB_COORDS.p4 },
        propertyId: "p4",
        country: "Singapore",
        price: 1350,
        available: true,
        operatorName: "CityKey SG",
        clientContact: "6587654321",
        remark: "CBD access in 10 minutes",
        currency: "SGD",
      },
      {
        id: "demo-u5",
        roomName: "Room 312",
        property: { apartmentName: "Riverside Court", shortname: "Riverside", _id: "p5", ...JB_COORDS.p5 },
        propertyId: "p5",
        country: "Malaysia",
        price: 920,
        availablesoon: true,
        availableFrom: "2026-04-12",
        operatorName: "Riverside Ops",
        clientContact: "60199887766",
        remark: "Quiet floor, suitable for WFH",
        currency: "MYR",
      },
      {
        id: "demo-u6",
        roomName: "Loft B2",
        property: { apartmentName: "Marina Point Lofts", shortname: "Marina Point", _id: "p6", ...JB_COORDS.p6 },
        propertyId: "p6",
        country: "Singapore",
        price: 1680,
        available: true,
        operatorName: "CityKey SG",
        clientContact: "6587654321",
        remark: "Dual-key loft with skyline view",
        currency: "SGD",
      },
    ],
    [],
  )

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
            `${u.roomName || ""} ${u.title_fld || ""} ${u.property?.shortname || ""} ${u.remark || ""}`
              .toLowerCase()
              .includes(q),
          )
        }
        const [pMin, pMax] = priceQuery
        if (pMin > 0) {
          list = list.filter(
            (u) => comparableMonthlyForFilter(u.price, u.currency, priceCompareCurrency) >= pMin,
          )
        }
        if (pMax < PRICE_SLIDER_MAX) {
          list = list.filter(
            (u) => comparableMonthlyForFilter(u.price, u.currency, priceCompareCurrency) <= pMax,
          )
        }
        if (listingScopeFilter === "ROOM") {
          list = list.filter((u) => (u.listingScope || "room") !== "entire_unit")
        } else if (listingScopeFilter === "ENTIRE_UNIT") {
          list = list.filter((u) => u.listingScope === "entire_unit")
        }
        if (sort === "price_asc") list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0))
        if (sort === "price_desc") list.sort((a, b) => Number(b.price || 0) - Number(a.price || 0))
        setItems(list)
        setProperties([
          { value: "ALL", label: "All properties" },
          { value: "p1", label: "Marina View Tower A" },
          { value: "p2", label: "Sunrise Tower" },
          { value: "p3", label: "Green Residence" },
          { value: "p4", label: "City Central Plaza" },
          { value: "p5", label: "Riverside Court" },
          { value: "p6", label: "Marina Point Lofts" },
        ])
        setClientContact("60123456789")
        setClientCurrency(
          priceCompareCurrency === "SGD" ? "SGD" : priceCompareCurrency === "MYR" ? "MYR" : "",
        )
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
      if (subdomainFromUrl) opts.subdomain = subdomainFromUrl
      const [qMin, qMax] = priceQuery
      if (qMin > 0) opts.priceMin = qMin
      if (qMax < PRICE_SLIDER_MAX) opts.priceMax = qMax
      if (listingScopeFilter !== "ALL") opts.listingScope = listingScopeFilter
      opts.priceCompareCurrency = priceCompareCurrency

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
      setProperties(data.properties || [{ value: "ALL", label: "All properties" }])
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
  }, [
    subdomainFromUrl,
    propertyId,
    listingScopeFilter,
    sort,
    currentPage,
    keyword,
    country,
    priceCompareCurrency,
    priceQuery,
    demoUnits,
  ])

  useEffect(() => {
    loadData()
  }, [loadData])

  const unitIdFromUrl = searchParams?.get("unit")?.trim() || null
  useEffect(() => {
    if (!unitIdFromUrl || items.length === 0) return
    const found = items.find((u) => (u.id || u._id) === unitIdFromUrl)
    if (found) setSelectedUnit(found)
  }, [unitIdFromUrl, items])

  useEffect(() => {
    setCurrentPage(1)
  }, [keyword, country, priceCompareCurrency, propertyId, listingScopeFilter, sort, priceQuery])

  useEffect(() => {
    const t = setTimeout(() => setKeyword(keywordInput), 400)
    return () => clearTimeout(t)
  }, [keywordInput])

  useEffect(() => {
    const t = setTimeout(() => setPriceQuery(priceRange), 400)
    return () => clearTimeout(t)
  }, [priceRange])

  const mappableCount = useMemo(() => countMappableUnits(items), [items])

  /** Currency labels on the monthly price slider (subdomain client default, else FX basis from filter). */
  const priceFilterCurrency = useMemo((): string | null => {
    const c = (clientCurrency || "").trim().toUpperCase()
    if (c && subdomainFromUrl) return c
    if (priceCompareCurrency === "MYR" || priceCompareCurrency === "SGD") return priceCompareCurrency
    return null
  }, [clientCurrency, subdomainFromUrl, priceCompareCurrency])

  const onMapMarkerClick = useCallback((u: UnitItem) => {
    setSelectedUnit(u)
  }, [])

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

  const headline = subdomainFromUrl ? `Homes · ${subdomainFromUrl}` : "Homes nearby"
  const sublineParts: string[] = []
  if (country !== "ALL") sublineParts.push(country)
  if (priceCompareCurrency === "MYR" || priceCompareCurrency === "SGD") {
    sublineParts.push(`Prices in ${priceCompareCurrency}`)
  } else {
    sublineParts.push("Prices: native amounts")
  }
  if (keyword.trim()) sublineParts.push(`“${keyword.trim()}”`)
  if (propertyId !== "ALL") {
    const lab = properties.find((p) => p.value === propertyId)?.label
    if (lab) sublineParts.push(lab)
  }
  if (listingScopeFilter === "ROOM") sublineParts.push("Room listings")
  if (listingScopeFilter === "ENTIRE_UNIT") sublineParts.push("Entire unit")
  const [pqMin, pqMax] = priceQuery
  if (pqMin > 0 || pqMax < PRICE_SLIDER_MAX) {
    sublineParts.push(`${formatSliderMoney(pqMin, priceFilterCurrency)}–${formatSliderMoney(pqMax, priceFilterCurrency)}`)
  }
  const subline =
    sublineParts.length > 0 ? sublineParts.join(" · ") : `${total} listing${total === 1 ? "" : "s"} · Coliving JB`

  const filterPanelProps: FilterPanelProps = {
    keywordInput,
    setKeywordInput,
    country,
    setCountry,
    priceCompareCurrency,
    setPriceCompareCurrency,
    propertyId,
    setPropertyId,
    properties,
    listingScope: listingScopeFilter,
    setListingScope: setListingScopeFilter,
    sort,
    setSort,
    resetPage,
    priceRange,
    setPriceRange,
    priceCurrency: priceFilterCurrency,
  }

  return (
    <div className="min-h-screen bg-[#f7f7f7] text-neutral-900">
      {surface === "list" ? (
        <div className="border-b border-neutral-200/90 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PortalSiteHeader className="shrink-0" />
            </div>
            <div className="mt-3 flex min-h-[52px] items-center gap-2 sm:gap-3">
              <div className="flex min-h-[48px] min-w-0 flex-1 flex-col justify-center rounded-2xl border border-neutral-200/90 bg-neutral-50/60 px-4 py-2.5">
                <p className="truncate text-[15px] font-semibold leading-tight tracking-tight sm:text-base">{headline}</p>
                <p className="mt-0.5 truncate text-xs leading-snug text-neutral-500 sm:text-sm">{subline}</p>
              </div>
              <AvailableUnitsFilterMenuPopover open={filterMenuOpen} onOpenChange={setFilterMenuOpen} panelProps={filterPanelProps}>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-full border-neutral-200 bg-white shadow-sm"
                  aria-label="Open filters"
                >
                  <SlidersHorizontal className="h-5 w-5" />
                </Button>
              </AvailableUnitsFilterMenuPopover>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 shrink-0 gap-2 rounded-full border-neutral-200 bg-white px-4 text-sm font-semibold shadow-sm"
                onClick={goToMap}
                aria-label="Open map view"
              >
                <MapIcon className="h-4 w-4 shrink-0" />
                Map
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none fixed left-0 right-0 top-0 z-40 flex justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="pointer-events-auto flex h-[52px] w-full max-w-lg items-center gap-2 rounded-full border border-neutral-200/90 bg-white/95 px-1.5 shadow-lg backdrop-blur-md">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-full"
              onClick={() => goToList()}
              aria-label="Back to list"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-sm font-semibold leading-tight">Map</p>
              <p className="truncate text-xs text-neutral-500">
                {mappableCount > 0 ? `${mappableCount} building${mappableCount === 1 ? "" : "s"}` : "Add property GPS for pins"}
              </p>
            </div>
            <AvailableUnitsFilterMenuPopover open={filterMenuOpen} onOpenChange={setFilterMenuOpen} panelProps={filterPanelProps}>
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full" aria-label="Filters">
                <SlidersHorizontal className="h-5 w-5" />
              </Button>
            </AvailableUnitsFilterMenuPopover>
          </div>
        </div>
      )}

      {surface === "map" ? (
        <div className="fixed inset-0 z-30 pt-0">
          <AvailableUnitsExploreMap
            items={items}
            clientCurrency={clientCurrency}
            priceCompareCurrency={priceCompareCurrency}
            selectedUnitId={selectedUnit?.id || selectedUnit?._id || null}
            onMarkerClick={onMapMarkerClick}
            className="h-full w-full"
          />
          {!loading && mappableCount === 0 && (
            <div className="pointer-events-none absolute left-3 right-3 top-[4.5rem] z-[35] mx-auto max-w-lg rounded-2xl border border-neutral-200/80 bg-white/95 px-4 py-3 text-center text-sm leading-snug text-neutral-700 shadow-lg backdrop-blur-sm sm:left-1/2 sm:right-auto sm:w-full sm:-translate-x-1/2">
              No map pins for this filter. Save GPS on each property in Operator to show grouped listings here.
            </div>
          )}
          <div className="pointer-events-none fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-0 right-0 z-[60] flex justify-center px-4">
            <Button
              type="button"
              className="pointer-events-auto rounded-full border border-neutral-200 bg-white px-6 py-6 text-base font-semibold text-neutral-900 shadow-xl hover:bg-neutral-50"
              onClick={() => goToList()}
            >
              <List className="mr-2 h-5 w-5" />
              List
            </Button>
          </div>
        </div>
      ) : (
        <main className="relative mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 sm:pb-32 sm:pt-6">
          {loading ? (
            <div className="flex justify-center py-24">
              <Spinner className="h-9 w-9 text-primary" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl bg-white py-20 text-center text-neutral-500 shadow-sm">
              No listings match your filters. Try clearing search or country.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-10 lg:grid-cols-3">
              {items.map((unit) => {
                const urls = getMediaUrls(unit)
                const propName = propertyDisplayName(unit)
                const roomName = unit.roomName || unit.title_fld || "Room"
                const uid = unit.id || unit._id || ""
                const badge =
                  unit.availablesoon && unit.availableFrom
                    ? `Soon · ${formatReadyDate(unit.availableFrom)}`
                    : unit.available
                      ? "Available"
                      : unit.availablesoon
                        ? "Soon"
                        : ""
                return (
                  <article
                    key={uid}
                    className="group cursor-pointer"
                    onClick={() => setSelectedUnit(unit)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setSelectedUnit(unit)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="relative aspect-[20/19] overflow-hidden rounded-2xl bg-neutral-200 shadow-sm ring-1 ring-black/5 transition-shadow group-hover:shadow-md">
                      <UnitImageCarousel urls={urls} alt={roomName} />
                      {badge ? (
                        <span className="absolute left-3 top-3 rounded-md bg-white/95 px-2.5 py-1 text-xs font-semibold text-neutral-900 shadow-sm backdrop-blur-sm">
                          {badge}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 space-y-1 px-0.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate text-[15px] font-semibold tracking-tight text-neutral-900">{propName}</h2>
                          <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">{roomName}</p>
                        </div>
                        <span
                          className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold leading-tight ${
                            unit.listingScope === "entire_unit"
                              ? "bg-violet-100 text-violet-800"
                              : "bg-neutral-200/90 text-neutral-600"
                          }`}
                        >
                          {unit.listingScope === "entire_unit" ? "Entire unit" : "Room"}
                        </span>
                      </div>
                      <p className="line-clamp-1 text-xs text-neutral-400">{unit.operatorName || "Verified operator"}</p>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-2 px-0.5">
                      <span className="text-[15px] font-semibold text-neutral-900">
                        {displayMonthlyPrice(unit, priceCompareCurrency, clientCurrency)}
                        <span className="font-normal text-neutral-500"> / month</span>
                      </span>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          {totalPages > 1 && !loading && items.length > 0 && (
            <div className="mt-10 flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full border-neutral-300"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-neutral-500">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full border-neutral-300"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}

          {!loading && (
            <div className="pointer-events-none fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-0 right-0 z-[60] flex justify-center px-4">
              <Button
                type="button"
                className="pointer-events-auto rounded-full bg-neutral-900 px-7 py-6 text-base font-semibold text-white shadow-2xl hover:bg-neutral-800"
                onClick={() => goToMap()}
              >
                <MapIcon className="mr-2 h-5 w-5" />
                Map
              </Button>
            </div>
          )}
        </main>
      )}

      <Dialog
        open={!!selectedUnit}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedUnit(null)
            setMapsMenuOpen(false)
            setLightboxSrc(null)
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => {
            if (lightboxSrc) {
              e.preventDefault()
              setLightboxSrc(null)
            } else if (mapsMenuOpen) {
              e.preventDefault()
              setMapsMenuOpen(false)
            }
          }}
          className="flex max-h-[min(90vh,90dvh)] max-w-lg flex-col gap-0 overflow-hidden rounded-2xl border-neutral-200 p-0 sm:rounded-2xl"
        >
          {selectedUnit && (
            <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
              <div className="relative shrink-0 border-b border-white/10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 px-5 pb-5 pt-6 pr-14 text-white shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 h-9 w-9 rounded-full text-white/90 hover:bg-white/10 hover:text-white"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </DialogClose>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[1.05rem] font-semibold leading-snug tracking-tight text-white">
                      {propertyDisplayName(selectedUnit)}
                    </h2>
                    <p className="mt-1.5 line-clamp-2 text-sm font-medium text-slate-300">
                      {selectedUnit.roomName || selectedUnit.title_fld || "—"}
                    </p>
                    <p className="mt-2">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${
                          selectedUnit.listingScope === "entire_unit"
                            ? "bg-violet-500/30 text-violet-100"
                            : "bg-white/15 text-slate-200"
                        }`}
                      >
                        {selectedUnit.listingScope === "entire_unit" ? "Entire unit" : "Room"}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-1.5 pt-0.5">
                    <span className="text-2xl font-bold tabular-nums tracking-tight text-white">
                      {displayMonthlyPrice(selectedUnit, priceCompareCurrency, clientCurrency)}
                    </span>
                    <span className="text-sm font-medium text-slate-400">/ month</span>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <p className="mb-3 text-xs text-neutral-500">Operator: {selectedUnit.operatorName || "—"}</p>
                <div className="grid grid-cols-2 gap-2">
                  {getMediaUrls(selectedUnit).map((src, i) => {
                    const staticSrc = wixImageToStatic(src)
                    return (
                      <button
                        key={i}
                        type="button"
                        className="group relative aspect-square w-full overflow-hidden rounded-xl text-left ring-1 ring-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                        aria-label="View larger photo"
                        onClick={() => {
                          setMapsMenuOpen(false)
                          setLightboxSrc(staticSrc)
                        }}
                      >
                        <img
                          src={staticSrc}
                          alt=""
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02] group-active:scale-[1.04]"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).style.display = "none"
                          }}
                        />
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 to-transparent py-2 text-center text-[10px] font-medium text-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                          Tap to enlarge
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-4 space-y-3">
                  {(selectedUnit.description_fld || "").trim() ? (
                    <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-700">{selectedUnit.description_fld}</p>
                  ) : (
                    <p className="text-sm text-neutral-400">No description</p>
                  )}
                  {(selectedUnit.remark || "").trim() ? (
                    <p className="whitespace-pre-line border-t border-neutral-100 pt-3 text-xs leading-relaxed text-neutral-500">
                      {selectedUnit.remark}
                    </p>
                  ) : null}
                </div>
                <div className="mt-6 flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
                  <Button variant="outline" size="sm" className="rounded-full" onClick={(e) => handleShareUnit(selectedUnit, e)}>
                    <Share2 className="mr-1.5 h-4 w-4" /> Share
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      setLightboxSrc(null)
                      setMapsMenuOpen(true)
                    }}
                  >
                    <MapPin className="mr-1.5 h-4 w-4" /> Address
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-full bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => openWhatsApp(selectedUnit)}
                    disabled={!(selectedUnit.clientContact ?? clientContact)}
                  >
                    WhatsApp <ExternalLink className="ml-1 inline h-3 w-3" />
                  </Button>
                </div>
                <Button variant="ghost" className="mt-2 w-full text-neutral-500" onClick={() => setSelectedUnit(null)}>
                  Close
                </Button>
              </div>

              {mapsMenuOpen && (
                <div
                  role="presentation"
                  className="absolute inset-0 z-[60] flex flex-col justify-end bg-black/50 sm:items-center sm:justify-center sm:p-4"
                  onClick={() => setMapsMenuOpen(false)}
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="maps-menu-title"
                    className="w-full max-w-lg rounded-t-2xl border border-neutral-200 bg-white p-4 shadow-2xl sm:max-w-sm sm:rounded-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p id="maps-menu-title" className="mb-1 text-sm font-semibold text-neutral-900">
                      Open location
                    </p>
                    <p className="mb-3 text-xs text-neutral-500">Choose an app to navigate.</p>
                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        className="w-full rounded-xl"
                        onClick={() => {
                          const { google } = navigationUrlsForUnit(selectedUnit)
                          window.open(google, "_blank", "noopener,noreferrer")
                          setMapsMenuOpen(false)
                        }}
                      >
                        Google Maps
                        <ExternalLink className="ml-2 inline h-3.5 w-3.5 opacity-70" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full rounded-xl"
                        onClick={() => {
                          const { waze } = navigationUrlsForUnit(selectedUnit)
                          window.open(waze, "_blank", "noopener,noreferrer")
                          setMapsMenuOpen(false)
                        }}
                      >
                        Waze
                        <ExternalLink className="ml-2 inline h-3.5 w-3.5 opacity-70" />
                      </Button>
                      <Button type="button" variant="ghost" className="w-full rounded-xl text-neutral-600" onClick={() => setMapsMenuOpen(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {lightboxSrc && (
                <div
                  role="presentation"
                  className="absolute inset-0 z-[70] flex flex-col bg-black/95"
                  onClick={() => setLightboxSrc(null)}
                >
                  <div className="flex shrink-0 justify-end p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-full text-white hover:bg-white/10"
                      aria-label="Close photo"
                      onClick={() => setLightboxSrc(null)}
                    >
                      <X className="h-6 w-6" />
                    </Button>
                  </div>
                  <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">
                    <img
                      src={lightboxSrc}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function AvailableUnitPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f7f7f7]">
          <Spinner className="h-9 w-9 text-primary" />
        </div>
      }
    >
      <AvailableUnitContent />
    </Suspense>
  )
}
