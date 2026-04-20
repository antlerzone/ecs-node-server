"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AlertTriangle, CircleHelp, Plus, Settings2, Trash2, ChevronRight, ChevronLeft } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"
import {
  fetchCleanlemonPricingConfig,
  saveCleanlemonPricingConfig,
  fetchOperatorPortalSetupStatus,
  type CleanlemonPricingConfig,
  type OperatorPortalSetupStatus,
} from "@/lib/cleanlemon-api"
import { PRICING_SERVICES, type ServiceKey } from "@/lib/cleanlemon-pricing-services"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type AddonBasis = "fixed" | "quantity" | "bed" | "room"
type BookingMode = "instant" | "request_approve"
type LeadTime =
  | "twelve_hour"
  | "same_day"
  | "one_day"
  | "two_day"
  | "three_day"
  | "four_day"
  | "five_day"
  | "six_day"
  | "one_week"
  | "two_week"
  | "three_week"
  | "four_week"
  | "one_month"

const LEAD_TIME_SELECT_OPTIONS: { value: LeadTime; label: string }[] = [
  { value: "twelve_hour", label: "12 hour before" },
  { value: "same_day", label: "Same day" },
  { value: "one_day", label: "One day before" },
  { value: "two_day", label: "Two days before" },
  { value: "three_day", label: "Three days before" },
  { value: "four_day", label: "Four days before" },
  { value: "five_day", label: "Five days before" },
  { value: "six_day", label: "Six days before" },
  { value: "one_week", label: "One week before" },
  { value: "two_week", label: "Two weeks before" },
  { value: "three_week", label: "Three weeks before" },
  { value: "four_week", label: "Four weeks before" },
  { value: "one_month", label: "One month before" },
]

function isLeadTime(s: string): s is LeadTime {
  return LEAD_TIME_SELECT_OPTIONS.some((o) => o.value === s)
}
type DetailType = "by_hour" | "by_property" | "homestay" | "dobi_kg" | "dobi_pcs" | "dobi_bed"
type HomestayMode = "fixed_property" | "fixed_property_plus_bed"

/** Short labels for Homestay mode select (value keys unchanged in saved config). */
const HOMESTAY_MODE_LABEL: Record<HomestayMode, string> = {
  fixed_property: "Fixed per property",
  fixed_property_plus_bed: "Property + beds",
}

type DobiItemRate = { item: string; rate: number }

interface AddonItem {
  id: string
  name: string
  basis: AddonBasis
  price: number
}

interface ByHourSetting {
  hours: number
  workers: number
  price: number
  minSellingPrice: number
  features: string[]
  onSpotAddonPercent: number
  addons: AddonItem[]
}

interface ByPropertySetting {
  prices: Record<string, number>
  features: string[]
  addons: AddonItem[]
}

interface HomestaySetting {
  mode: HomestayMode
  propertyPrices: Record<string, number>
  bedQtyPrice: number
  features: string[]
  addons: AddonItem[]
}

interface ServiceConfig {
  byHourEnabled: boolean
  byPropertyEnabled: boolean
  quotationEnabled: boolean
  dobiByKgEnabled: boolean
  dobiByPcsEnabled: boolean
  dobiByBedEnabled: boolean
  dobiByKg: DobiItemRate[]
  dobiByPcs: DobiItemRate[]
  dobiByBedPrice: number
  ironingByKg: DobiItemRate[]
  ironingByPcs: DobiItemRate[]
  byHour: ByHourSetting
  byProperty: ByPropertySetting
  homestay: HomestaySetting
}

const SERVICES = PRICING_SERVICES

const PROPERTY_ROWS = [
  "Studio",
  "1 bedroom",
  "2 bedroom",
  "3 bedroom",
  "4 bedroom",
  "5 bedroom",
  "Single storey",
  "Double storey",
  "Cluster",
  "Semi-D",
  "Bungalow",
  "Office 500 sqft",
  "Office 1000 sqft",
  "Office 1500 sqft",
  "Office 2000 sqft",
]
const DOBI_ITEMS = ["Pillow case", "Bedsheet", "Linens", "Towel", "Bathmat"]

function PricingHint({
  label,
  description,
  examples,
}: {
  label: string
  description: string
  examples: string[]
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`What is ${label}?`}
        >
          <CircleHelp className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="z-[60] max-w-sm px-3 py-2 text-left text-xs leading-snug"
      >
        <p className="mb-2 font-normal">{description}</p>
        <p className="mb-1 font-medium">Examples:</p>
        <ul className="list-disc space-y-0.5 pl-4 font-normal">
          {examples.map((ex, i) => (
            <li key={`${ex}-${i}`}>{ex}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

function LabelWithHint({
  text,
  hintLabel,
  description,
  examples,
}: {
  text: string
  hintLabel: string
  description: string
  examples: string[]
}) {
  return (
    <div className="flex items-center gap-0.5">
      <Label className="leading-tight">{text}</Label>
      <PricingHint label={hintLabel} description={description} examples={examples} />
    </div>
  )
}

const emptyAddon = (): AddonItem => ({ id: `addon-${Date.now()}-${Math.random()}`, name: "", basis: "fixed", price: 0 })

const makeDefaultConfig = (): ServiceConfig => ({
  byHourEnabled: true,
  byPropertyEnabled: false,
  quotationEnabled: false,
  dobiByKgEnabled: true,
  dobiByPcsEnabled: false,
  dobiByBedEnabled: false,
  dobiByKg: DOBI_ITEMS.map((item) => ({ item, rate: 0 })),
  dobiByPcs: DOBI_ITEMS.map((item) => ({ item, rate: 0 })),
  dobiByBedPrice: 0,
  ironingByKg: DOBI_ITEMS.map((item) => ({ item, rate: 0 })),
  ironingByPcs: DOBI_ITEMS.map((item) => ({ item, rate: 0 })),
  byHour: {
    hours: 1,
    workers: 1,
    price: 0,
    minSellingPrice: 0,
    features: [],
    onSpotAddonPercent: 10,
    addons: [],
  },
  byProperty: {
    prices: Object.fromEntries(PROPERTY_ROWS.map((p) => [p, 0])),
    features: [],
    addons: [],
  },
  homestay: {
    mode: "fixed_property",
    propertyPrices: Object.fromEntries(PROPERTY_ROWS.map((p) => [p, 0])),
    bedQtyPrice: 0,
    features: [],
    addons: [],
  },
})

export default function OperatorPricingPage() {
  const { user } = useAuth()
  const operatorId = user?.operatorId || "op_demo_001"
  const [selectedServices, setSelectedServices] = useState<ServiceKey[]>(["general", "homestay"])
  const [activeServiceTab, setActiveServiceTab] = useState<ServiceKey>("general")
  const [serviceConfigs, setServiceConfigs] = useState<Record<ServiceKey, ServiceConfig>>({
    general: makeDefaultConfig(),
    warm: makeDefaultConfig(),
    deep: makeDefaultConfig(),
    renovation: makeDefaultConfig(),
    homestay: makeDefaultConfig(),
    "room-rental": makeDefaultConfig(),
    commercial: makeDefaultConfig(),
    office: makeDefaultConfig(),
    dobi: makeDefaultConfig(),
    other: makeDefaultConfig(),
  })

  const [bookingMode, setBookingMode] = useState<BookingMode>("instant")
  /** Optional override per service key — saved as `bookingModeByService` on operator pricing config. */
  const [bookingModeByService, setBookingModeByService] = useState<Partial<Record<ServiceKey, BookingMode>>>({})
  const [leadTime, setLeadTime] = useState<LeadTime>("same_day")
  /** Per service — saved as `leadTimeByService`; falls back to global `leadTime`. */
  const [leadTimeByService, setLeadTimeByService] = useState<Partial<Record<ServiceKey, LeadTime>>>({})
  const [portalSetupGate, setPortalSetupGate] = useState<OperatorPortalSetupStatus | null>(null)

  const [serviceDialogOpen, setServiceDialogOpen] = useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [detailType, setDetailType] = useState<DetailType>("by_hour")
  /** By Hour / By Property detail dialog: must reach Summary before Save commits. */
  const [detailWizardStep, setDetailWizardStep] = useState<"edit" | "summary">("edit")
  const detailSessionSnapshotRef = useRef<ServiceConfig | null>(null)
  const detailSaveCommittedRef = useRef(false)
  const [isSavingRemote, setIsSavingRemote] = useState(false)
  const [isLoadingRemote, setIsLoadingRemote] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setIsLoadingRemote(true)
      const r = await fetchCleanlemonPricingConfig(operatorId)
      if (cancelled) return
      if (!r.ok) {
        setIsLoadingRemote(false)
        return
      }
      if (r.config) {
        const config = r.config as Partial<CleanlemonPricingConfig>
        const safeServices = Array.isArray(config.selectedServices)
          ? config.selectedServices.filter((key): key is ServiceKey => SERVICES.some((service) => service.key === key))
          : []
        if (safeServices.length > 0) {
          setSelectedServices(safeServices)
        }
        if (
          typeof config.activeServiceTab === "string" &&
          SERVICES.some((service) => service.key === config.activeServiceTab)
        ) {
          setActiveServiceTab(config.activeServiceTab as ServiceKey)
        } else if (safeServices.length > 0) {
          setActiveServiceTab(safeServices[0])
        }
        if (config.serviceConfigs && typeof config.serviceConfigs === "object") {
          setServiceConfigs((prev) => ({ ...prev, ...(config.serviceConfigs as Record<ServiceKey, ServiceConfig>) }))
        }
        if (config.bookingMode === "instant" || config.bookingMode === "request_approve") {
          setBookingMode(config.bookingMode)
        }
        if (config.bookingModeByService && typeof config.bookingModeByService === "object") {
          const o = config.bookingModeByService as Record<string, string>
          const next: Partial<Record<ServiceKey, BookingMode>> = {}
          for (const k of SERVICES.map((s) => s.key)) {
            const v = o[k]
            if (v === "instant" || v === "request_approve") next[k] = v
          }
          setBookingModeByService(next)
        }
        if (typeof config.leadTime === "string") {
          setLeadTime(config.leadTime as LeadTime)
        }
        if (config.leadTimeByService && typeof config.leadTimeByService === "object") {
          const o = config.leadTimeByService as Record<string, string>
          const next: Partial<Record<ServiceKey, LeadTime>> = {}
          for (const k of SERVICES.map((s) => s.key)) {
            const v = o[k]
            if (v && isLeadTime(v)) next[k] = v
          }
          setLeadTimeByService(next)
        }
      }
      setIsLoadingRemote(false)
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  useEffect(() => {
    if (!operatorId || !user?.email) {
      setPortalSetupGate(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorPortalSetupStatus({
        operatorId,
        email: String(user.email).trim().toLowerCase(),
      })
      if (!cancelled && r?.ok) setPortalSetupGate(r)
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId, user?.email])

  const pricingGateHighlight =
    portalSetupGate?.ok === true && portalSetupGate.firstIncomplete === "pricing"

  const activeConfig = serviceConfigs[activeServiceTab]

  const updateConfig = (service: ServiceKey, updater: (cfg: ServiceConfig) => ServiceConfig) => {
    setServiceConfigs((prev) => ({ ...prev, [service]: updater(prev[service]) }))
  }

  const openDetail = (type: DetailType) => {
    if (type === "by_hour" || type === "by_property") {
      detailSessionSnapshotRef.current = JSON.parse(JSON.stringify(serviceConfigs[activeServiceTab])) as ServiceConfig
      setDetailWizardStep("edit")
    }
    setDetailType(type)
    setDetailDialogOpen(true)
  }

  const toggleService = (key: ServiceKey, checked: boolean) => {
    setSelectedServices((prev) => {
      const next = checked ? [...new Set([...prev, key])] : prev.filter((s) => s !== key)
      if (next.length === 0) return prev
      if (!next.includes(activeServiceTab)) setActiveServiceTab(next[0])
      return next
    })
  }

  const addFeature = (scope: "byHour" | "byProperty" | "homestay") => {
    updateConfig(activeServiceTab, (cfg) => {
      const label = ""
      if (scope === "byHour") return { ...cfg, byHour: { ...cfg.byHour, features: [...cfg.byHour.features, label] } }
      if (scope === "byProperty") return { ...cfg, byProperty: { ...cfg.byProperty, features: [...cfg.byProperty.features, label] } }
      return { ...cfg, homestay: { ...cfg.homestay, features: [...cfg.homestay.features, label] } }
    })
  }

  const addAddon = (scope: "byHour" | "byProperty" | "homestay") => {
    updateConfig(activeServiceTab, (cfg) => {
      if (scope === "byHour") return { ...cfg, byHour: { ...cfg.byHour, addons: [...cfg.byHour.addons, emptyAddon()] } }
      if (scope === "byProperty") return { ...cfg, byProperty: { ...cfg.byProperty, addons: [...cfg.byProperty.addons, emptyAddon()] } }
      return { ...cfg, homestay: { ...cfg.homestay, addons: [...cfg.homestay.addons, emptyAddon()] } }
    })
  }

  const summary = useMemo(() => {
    if (activeServiceTab === "dobi") {
      const kgCount = activeConfig.dobiByKg.filter((i) => i.rate > 0).length
      const pcsCount = activeConfig.dobiByPcs.filter((i) => i.rate > 0).length
      return `Dobi modes: by kg ${activeConfig.dobiByKgEnabled ? "on" : "off"}, by pcs ${activeConfig.dobiByPcsEnabled ? "on" : "off"}, by bed ${activeConfig.dobiByBedEnabled ? "on" : "off"} · priced items: kg ${kgCount}, pcs ${pcsCount}, bed RM${activeConfig.dobiByBedPrice}`
    }
    if (activeServiceTab === "homestay") {
      const pricedRows = Object.values(activeConfig.homestay.propertyPrices).filter((v) => v > 0).length
      return `Homestay mode: ${HOMESTAY_MODE_LABEL[activeConfig.homestay.mode]}, priced properties: ${pricedRows}, features: ${activeConfig.homestay.features.length}, add-ons: ${activeConfig.homestay.addons.length}`
    }
    const byHourTotal = activeConfig.byHour.price * activeConfig.byHour.hours * activeConfig.byHour.workers
    const pricedRows = Object.values(activeConfig.byProperty.prices).filter((v) => v > 0).length
    return `By hour est: RM${byHourTotal}, by property rows priced: ${pricedRows}, by hour features: ${activeConfig.byHour.features.length}, by property features: ${activeConfig.byProperty.features.length}`
  }, [activeConfig, activeServiceTab])

  const renderAddonRows = (addons: AddonItem[], onChange: (next: AddonItem[]) => void) => (
    <div className="space-y-2">
      {addons.map((addon, idx) => (
        <div key={addon.id} className="grid grid-cols-12 gap-2 items-center">
          <Input
            className="col-span-5"
            value={addon.name}
            onChange={(e) => onChange(addons.map((a, i) => (i === idx ? { ...a, name: e.target.value } : a)))}
            placeholder="Add-on service"
          />
          <Select
            value={addon.basis}
            onValueChange={(v: AddonBasis) => onChange(addons.map((a, i) => (i === idx ? { ...a, basis: v } : a)))}
          >
            <SelectTrigger className="col-span-4"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fix Price</SelectItem>
              <SelectItem value="quantity">By Quantity</SelectItem>
              <SelectItem value="bed">By Number of Bed</SelectItem>
              <SelectItem value="room">By Number of Room</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="col-span-2"
            type="number"
            value={addon.price}
            onChange={(e) => onChange(addons.map((a, i) => (i === idx ? { ...a, price: Number(e.target.value || 0) } : a)))}
            placeholder="Price"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="col-span-1"
            onClick={() => onChange(addons.filter((_, i) => i !== idx))}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  )

  const addDobiItem = (scope: "dobiByKg" | "dobiByPcs" | "ironingByKg" | "ironingByPcs") => {
    updateConfig(activeServiceTab, (cfg) => ({
      ...cfg,
      [scope]: [...cfg[scope], { item: "", rate: 0 }],
    }))
  }

  const persistPricingConfig = useCallback(async () => {
    if (isLoadingRemote) return
    setIsSavingRemote(true)
    try {
      const prevR = await fetchCleanlemonPricingConfig(operatorId)
      const prev = (prevR.ok && prevR.config ? prevR.config : {}) as Partial<CleanlemonPricingConfig>
      const payload: CleanlemonPricingConfig = {
        ...prev,
        selectedServices,
        activeServiceTab,
        serviceConfigs,
        bookingMode,
        bookingModeByService: Object.fromEntries(
          Object.entries(bookingModeByService).filter(([, v]) => v === "instant" || v === "request_approve")
        ) as CleanlemonPricingConfig["bookingModeByService"],
        leadTime,
        leadTimeByService: Object.fromEntries(
          Object.entries(leadTimeByService).filter(([, v]) => typeof v === "string" && isLeadTime(v))
        ) as CleanlemonPricingConfig["leadTimeByService"],
      }
      const r = await saveCleanlemonPricingConfig(operatorId, payload)
      if (!r.ok) {
        toast.error(`Save failed (${r.reason || "UNKNOWN"})`)
      } else {
        try {
          const setup = await fetchOperatorPortalSetupStatus({
            operatorId,
            email: String(user?.email || "").trim().toLowerCase(),
          })
          if (setup?.ok) setPortalSetupGate(setup)
        } catch {
          /* ignore */
        }
      }
    } finally {
      setIsSavingRemote(false)
    }
  }, [
    operatorId,
    isLoadingRemote,
    selectedServices,
    activeServiceTab,
    serviceConfigs,
    bookingMode,
    bookingModeByService,
    leadTime,
    leadTimeByService,
    user?.email,
  ])

  const handleServiceDialogOpenChange = (open: boolean) => {
    if (!open) void persistPricingConfig()
    setServiceDialogOpen(open)
  }

  const handleDetailDialogOpenChange = (open: boolean) => {
    if (!open) {
      const isHourPropertyWizard = detailType === "by_hour" || detailType === "by_property"
      if (isHourPropertyWizard) {
        if (!detailSaveCommittedRef.current && detailSessionSnapshotRef.current) {
          const snap = detailSessionSnapshotRef.current
          setServiceConfigs((prev) => ({ ...prev, [activeServiceTab]: snap }))
        }
        detailSaveCommittedRef.current = false
        detailSessionSnapshotRef.current = null
        setDetailWizardStep("edit")
      } else {
        void persistPricingConfig()
      }
    }
    setDetailDialogOpen(open)
  }

  const handleDetailSaveFromSummary = () => {
    detailSaveCommittedRef.current = true
    void persistPricingConfig()
    handleDetailDialogOpenChange(false)
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <div>
        <h1 className="text-2xl font-bold">Pricing</h1>
        <p className="text-muted-foreground">Services setup, booking settings and detailed pricing configuration</p>
        <div className="mt-2 flex items-center gap-2">
          {isSavingRemote ? (
            <span className="text-xs text-muted-foreground">Saving...</span>
          ) : null}
          {isLoadingRemote ? (
            <span className="text-xs text-muted-foreground">Loading saved config...</span>
          ) : (
            <span className="text-xs text-muted-foreground">Operator: {operatorId}</span>
          )}
        </div>
      </div>

      {pricingGateHighlight ? (
        <Alert variant="destructive" className="border-destructive/60">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Finish pricing setup</AlertTitle>
          <AlertDescription>
            Open <strong className="text-foreground">Services Provider</strong> and select at least one service. Each
            selected service has its own booking mode and lead time. Saving happens when you close the dialog or a detail
            panel.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card
        className={cn(
          pricingGateHighlight &&
            "rounded-lg ring-2 ring-destructive ring-offset-2 ring-offset-background"
        )}
      >
        <CardHeader>
          <CardTitle>Section 1 - Services & Booking</CardTitle>
          <CardDescription>
            Choose services, then set <strong className="text-foreground">booking mode</strong> and{" "}
            <strong className="text-foreground">lead time</strong> for each service (not one global default).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setServiceDialogOpen(true)}>
            Services Provider
          </Button>
          <Badge variant="secondary">{selectedServices.length} service(s) selected</Badge>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="min-w-0 space-y-3">
          <CardTitle>Section 2 - Pricing Setting</CardTitle>
          <CardDescription className="max-w-full">
            Switch service with the menu below (on larger screens you will see tabs instead).
          </CardDescription>
          {/* Mobile: single dropdown — avoids horizontal tab overflow */}
          <div className="w-full min-w-0 max-w-full md:hidden">
            <Label htmlFor="pricing-service-mobile" className="mb-1.5 block text-xs text-muted-foreground">
              Service
            </Label>
            <Select
              value={activeServiceTab}
              onValueChange={(v) => setActiveServiceTab(v as ServiceKey)}
            >
              <SelectTrigger
                id="pricing-service-mobile"
                className="h-auto min-h-9 w-full min-w-0 max-w-full whitespace-normal py-2 text-left shadow-xs [&_[data-slot=select-value]]:line-clamp-2 [&_[data-slot=select-value]]:whitespace-normal"
              >
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                className="max-w-[min(calc(100vw-2rem),var(--radix-select-trigger-width))]"
              >
                {selectedServices.map((service) => (
                  <SelectItem key={service} value={service}>
                    {SERVICES.find((s) => s.key === service)?.label || service}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Desktop: horizontal tabs */}
          <Tabs
            value={activeServiceTab}
            onValueChange={(v) => setActiveServiceTab(v as ServiceKey)}
            className="hidden min-w-0 w-full md:block"
          >
            <div className="w-full min-w-0 overflow-x-auto">
              <TabsList className="inline-flex w-max max-w-full flex-nowrap whitespace-nowrap">
                {selectedServices.map((service) => (
                  <TabsTrigger key={service} value={service} className="shrink-0">
                    {SERVICES.find((s) => s.key === service)?.label || service}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          {activeServiceTab !== "homestay" && activeServiceTab !== "dobi" && (
            <>
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={activeConfig.byHourEnabled}
                      onCheckedChange={(v) => updateConfig(activeServiceTab, (cfg) => ({ ...cfg, byHourEnabled: !!v }))}
                    />
                    Section mode: By Hour
                  </label>
                  <Button variant="outline" size="sm" disabled={!activeConfig.byHourEnabled} onClick={() => openDetail("by_hour")}>
                    <Settings2 className="h-4 w-4 mr-1" />
                    Detail
                  </Button>
                </div>
              </div>

              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={activeConfig.byPropertyEnabled}
                      onCheckedChange={(v) => updateConfig(activeServiceTab, (cfg) => ({ ...cfg, byPropertyEnabled: !!v }))}
                    />
                    Section mode: By Property Type
                  </label>
                  <Button variant="outline" size="sm" disabled={!activeConfig.byPropertyEnabled} onClick={() => openDetail("by_property")}>
                    <Settings2 className="h-4 w-4 mr-1" />
                    Detail
                  </Button>
                </div>
              </div>

              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={activeConfig.quotationEnabled}
                      onCheckedChange={(v) => updateConfig(activeServiceTab, (cfg) => ({ ...cfg, quotationEnabled: !!v }))}
                    />
                    Section mode: Base on quotation
                  </label>
                  <Badge variant="outline">No accurate price, quote after site visit</Badge>
                </div>
              </div>
            </>
          )}

          {activeServiceTab === "dobi" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="border rounded-lg p-3 text-sm space-y-2">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={activeConfig.dobiByKgEnabled}
                    onCheckedChange={(v) => updateConfig(activeServiceTab, (cfg) => ({ ...cfg, dobiByKgEnabled: !!v }))}
                  />
                  section mode: by kg
                </label>
                <Button variant="outline" size="sm" disabled={!activeConfig.dobiByKgEnabled} onClick={() => openDetail("dobi_kg")}>
                  <Settings2 className="h-4 w-4 mr-1" />
                  Detail
                </Button>
              </div>
              <div className="border rounded-lg p-3 text-sm space-y-2">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={activeConfig.dobiByPcsEnabled}
                    onCheckedChange={(v) => updateConfig(activeServiceTab, (cfg) => ({ ...cfg, dobiByPcsEnabled: !!v }))}
                  />
                  section mode: by pcs
                </label>
                <Button variant="outline" size="sm" disabled={!activeConfig.dobiByPcsEnabled} onClick={() => openDetail("dobi_pcs")}>
                  <Settings2 className="h-4 w-4 mr-1" />
                  Detail
                </Button>
              </div>
              <div className="border rounded-lg p-3 text-sm space-y-2">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={activeConfig.dobiByBedEnabled}
                    onCheckedChange={(v) => updateConfig(activeServiceTab, (cfg) => ({ ...cfg, dobiByBedEnabled: !!v }))}
                  />
                  section mode: by bed
                </label>
                <Button variant="outline" size="sm" disabled={!activeConfig.dobiByBedEnabled} onClick={() => openDetail("dobi_bed")}>
                  <Settings2 className="h-4 w-4 mr-1" />
                  Detail
                </Button>
              </div>
            </div>
          )}
          {activeServiceTab === "homestay" && (
            <div className="min-w-0 space-y-2 overflow-hidden rounded-lg border p-3">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <Label className="min-w-0 shrink">Homestay Mode</Label>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => openDetail("homestay")}>
                  <Settings2 className="h-4 w-4 mr-1" />
                  Detail
                </Button>
              </div>
              <Select
                value={activeConfig.homestay.mode}
                onValueChange={(v: HomestayMode) => updateConfig(activeServiceTab, (cfg) => ({ ...cfg, homestay: { ...cfg.homestay, mode: v } }))}
              >
                <SelectTrigger className="h-9 w-full min-w-0 max-w-full text-left shadow-xs [&_[data-slot=select-value]]:truncate">
                  <SelectValue>{HOMESTAY_MODE_LABEL[activeConfig.homestay.mode]}</SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="max-w-[min(calc(100vw-2rem),var(--radix-select-trigger-width))]"
                >
                  <SelectItem
                    value="fixed_property"
                    title="Price by property type only; bed count does not change the rate."
                  >
                    {HOMESTAY_MODE_LABEL.fixed_property}
                  </SelectItem>
                  <SelectItem
                    value="fixed_property_plus_bed"
                    title="Property base price plus an extra amount calculated from bed quantity."
                  >
                    {HOMESTAY_MODE_LABEL.fixed_property_plus_bed}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}


          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{summary}</CardContent>
          </Card>
        </CardContent>
      </Card>

      <Dialog open={serviceDialogOpen} onOpenChange={handleServiceDialogOpenChange}>
        <DialogContent className="max-h-[88vh] max-w-[95vw] overflow-y-auto sm:max-w-lg md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Services Provider</DialogTitle>
            <DialogDescription>
              Tick each service you offer. For each selected service, set client booking mode and lead time (defaults
              below use your saved global values when a row has no override yet).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 border-b border-border pb-3 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Defaults (for new rows):</span> booking{" "}
              {bookingMode === "instant" ? "Instant" : "Request & approve"} · lead{" "}
              {LEAD_TIME_SELECT_OPTIONS.find((o) => o.value === leadTime)?.label ?? leadTime}
            </p>
            <div className="flex flex-wrap gap-2">
              <div className="flex min-w-[140px] flex-1 flex-col gap-1">
                <Label className="text-[11px]">Adjust default booking mode</Label>
                <Select value={bookingMode} onValueChange={(v: BookingMode) => setBookingMode(v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instant">Accept booking instant</SelectItem>
                    <SelectItem value="request_approve">Request booking & approve</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex min-w-[140px] flex-1 flex-col gap-1">
                <Label className="text-[11px]">Adjust default lead time</Label>
                <Select value={leadTime} onValueChange={(v: LeadTime) => setLeadTime(v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_TIME_SELECT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="max-h-[min(50vh,24rem)] space-y-3 overflow-y-auto pr-1">
            {SERVICES.map((service) => {
              const on = selectedServices.includes(service.key)
              return (
                <div
                  key={service.key}
                  className={cn(
                    "space-y-2 rounded-lg border border-border p-3",
                    pricingGateHighlight && !on && selectedServices.length === 0 && "border-destructive/60 bg-destructive/[0.04]"
                  )}
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) => toggleService(service.key, !!v)}
                    />
                    {service.label}
                  </label>
                  {on ? (
                    <div className="grid grid-cols-1 gap-3 pl-0 sm:grid-cols-2 sm:pl-6">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Booking mode</Label>
                        <Select
                          value={bookingModeByService[service.key] ?? bookingMode}
                          onValueChange={(v: BookingMode) =>
                            setBookingModeByService((prev) => ({ ...prev, [service.key]: v }))
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="instant">Accept booking instant</SelectItem>
                            <SelectItem value="request_approve">Request booking & approve</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Lead time</Label>
                        <Select
                          value={leadTimeByService[service.key] ?? leadTime}
                          onValueChange={(v: LeadTime) =>
                            setLeadTimeByService((prev) => ({ ...prev, [service.key]: v }))
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LEAD_TIME_SELECT_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailDialogOpen} onOpenChange={handleDetailDialogOpenChange}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detailType === "by_hour" && "By Hour Detail"}
              {detailType === "by_property" && "By Property Detail"}
              {detailType === "homestay" && "Homestay Detail"}
              {detailType === "dobi_kg" && "Dobi Services Detail - By KG"}
              {detailType === "dobi_pcs" && "Dobi Services Detail - By PCS"}
              {detailType === "dobi_bed" && "Dobi Services Detail - By Bed"}
            </DialogTitle>
            <DialogDescription>
              {detailType === "by_hour" || detailType === "by_property" ? (
                detailWizardStep === "edit" ? (
                  <>
                    Step 1 of 2 — edit details, then go to Summary to save.
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={detailWizardStep === "edit" ? "default" : "outline"}>1. Details</Badge>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                      <Badge variant="outline">2. Summary</Badge>
                    </span>
                  </>
                ) : (
                  <>
                    Step 2 of 2 — review and save.
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">1. Details</Badge>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                      <Badge variant="default">2. Summary</Badge>
                    </span>
                  </>
                )
              ) : (
                "Configure all fields for this section mode"
              )}
            </DialogDescription>
          </DialogHeader>

          {detailType === "by_hour" && detailWizardStep === "summary" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Summary — By hour</CardTitle>
                  <CardDescription>
                    Service: <span className="font-medium text-foreground">{SERVICES.find((s) => s.key === activeServiceTab)?.label ?? activeServiceTab}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">Hours × workers × rate</span>
                      <p className="font-medium tabular-nums">
                        {activeConfig.byHour.hours} × {activeConfig.byHour.workers} × RM {activeConfig.byHour.price} → est. RM{" "}
                        {(activeConfig.byHour.hours * activeConfig.byHour.workers * activeConfig.byHour.price).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Minimum selling price</span>
                      <p className="font-medium tabular-nums">RM {activeConfig.byHour.minSellingPrice.toLocaleString()}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground">On-the-spot add-on</span>
                      <p className="font-medium">{activeConfig.byHour.onSpotAddonPercent}%</p>
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 font-medium">Features ({activeConfig.byHour.features.filter((x) => String(x).trim()).length})</p>
                    <ul className="list-inside list-disc text-muted-foreground">
                      {activeConfig.byHour.features.filter((x) => String(x).trim()).map((f, i) => (
                        <li key={`sum-f-${i}`}>{f}</li>
                      ))}
                      {activeConfig.byHour.features.every((x) => !String(x).trim()) ? (
                        <li className="list-none text-xs">No feature lines yet</li>
                      ) : null}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 font-medium">Add-ons ({activeConfig.byHour.addons.length})</p>
                    {activeConfig.byHour.addons.length === 0 ? (
                      <p className="text-xs text-muted-foreground">None</p>
                    ) : (
                      <ul className="space-y-1 text-muted-foreground">
                        {activeConfig.byHour.addons.map((a) => (
                          <li key={a.id} className="text-xs">
                            {a.name || "(unnamed)"} — {a.basis} — RM {a.price}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {detailType === "by_property" && detailWizardStep === "summary" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Summary — By property type</CardTitle>
                  <CardDescription>
                    Service: <span className="font-medium text-foreground">{SERVICES.find((s) => s.key === activeServiceTab)?.label ?? activeServiceTab}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <p className="mb-2 font-medium">Property prices</p>
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border bg-muted/20 p-2">
                      {PROPERTY_ROWS.filter((row) => (activeConfig.byProperty.prices[row] || 0) > 0).length === 0 ? (
                        <p className="text-xs text-muted-foreground">No property rows with a price above 0</p>
                      ) : (
                        PROPERTY_ROWS.filter((row) => (activeConfig.byProperty.prices[row] || 0) > 0).map((row) => (
                          <div key={row} className="flex justify-between gap-2 text-xs">
                            <span>{row}</span>
                            <span className="tabular-nums font-medium">RM {(activeConfig.byProperty.prices[row] || 0).toLocaleString()}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 font-medium">Features ({activeConfig.byProperty.features.filter((x) => String(x).trim()).length})</p>
                    <ul className="list-inside list-disc text-muted-foreground">
                      {activeConfig.byProperty.features.filter((x) => String(x).trim()).map((f, i) => (
                        <li key={`sum-pf-${i}`}>{f}</li>
                      ))}
                      {activeConfig.byProperty.features.every((x) => !String(x).trim()) ? (
                        <li className="list-none text-xs">No feature lines yet</li>
                      ) : null}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 font-medium">Add-ons ({activeConfig.byProperty.addons.length})</p>
                    {activeConfig.byProperty.addons.length === 0 ? (
                      <p className="text-xs text-muted-foreground">None</p>
                    ) : (
                      <ul className="space-y-1 text-muted-foreground">
                        {activeConfig.byProperty.addons.map((a) => (
                          <li key={a.id} className="text-xs">
                            {a.name || "(unnamed)"} — {a.basis} — RM {a.price}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {detailType === "by_hour" && detailWizardStep === "edit" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="space-y-2">
                  <LabelWithHint
                    text="How many hour"
                    hintLabel="How many hour"
                    description="Number of hours covered by one hourly package or price block. Used with worker count and rate to describe what the customer books."
                    examples={["2 hours for a standard flat", "4 hours for deep cleaning", "3 hours for move-out clean"]}
                  />
                  <Input
                    type="number"
                    value={activeConfig.byHour.hours}
                    onChange={(e) =>
                      updateConfig(activeServiceTab, (cfg) => ({ ...cfg, byHour: { ...cfg.byHour, hours: Number(e.target.value || 1) } }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <LabelWithHint
                    text="How many worker"
                    hintLabel="How many worker"
                    description="How many cleaners are included in that hourly price. More workers usually mean faster coverage or heavier jobs."
                    examples={["1 cleaner for small units", "2 cleaners for large homes", "2 workers for same-day turnaround"]}
                  />
                  <Input
                    type="number"
                    value={activeConfig.byHour.workers}
                    onChange={(e) =>
                      updateConfig(activeServiceTab, (cfg) => ({ ...cfg, byHour: { ...cfg.byHour, workers: Number(e.target.value || 1) } }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <LabelWithHint
                    text="How much"
                    hintLabel="How much"
                    description="Your rate per worker per hour (RM). The summary multiplies hours × workers × this rate for a quick estimate."
                    examples={["RM 45 per hour per worker", "RM 38 for standard cleaning", "RM 55 for weekend rate"]}
                  />
                  <Input
                    type="number"
                    value={activeConfig.byHour.price}
                    onChange={(e) =>
                      updateConfig(activeServiceTab, (cfg) => ({ ...cfg, byHour: { ...cfg.byHour, price: Number(e.target.value || 0) } }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <LabelWithHint
                    text="Minimum selling price"
                    hintLabel="Minimum selling price"
                    description="Lowest price you will charge for this hourly package after discounts or promos. Helps protect margin on small jobs."
                    examples={["Same as base package total", "RM 90 floor even if formula is lower", "RM 120 minimum for weekend"]}
                  />
                  <Input
                    type="number"
                    value={activeConfig.byHour.minSellingPrice}
                    onChange={(e) =>
                      updateConfig(activeServiceTab, (cfg) => ({
                        ...cfg,
                        byHour: { ...cfg.byHour, minSellingPrice: Number(e.target.value || 0) },
                      }))
                    }
                  />
                </div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-0.5">
                    <span>Feature (by hour)</span>
                    <PricingHint
                      label="Feature (by hour)"
                      description="Short lines that describe what is included in the hourly service so customers know the scope before booking."
                      examples={["Vacuum all rooms and corridors", "Mop hard floors", "Wipe kitchen counters and exterior of appliances", "Clean bathrooms (sink, toilet, shower)"]}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {activeConfig.byHour.features.map((f, idx) => (
                    <div key={`byhour-feature-${idx}`} className="flex gap-2">
                      <Input
                        value={f}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            byHour: { ...cfg.byHour, features: cfg.byHour.features.map((item, i) => (i === idx ? e.target.value : item)) },
                          }))
                        }
                        placeholder="Feature service"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            byHour: { ...cfg.byHour, features: cfg.byHour.features.filter((_, i) => i !== idx) },
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" onClick={() => addFeature("byHour")}><Plus className="h-4 w-4 mr-1" />Add Feature</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-0.5">
                    <span>Optional (by hour)</span>
                    <PricingHint
                      label="Optional (by hour)"
                      description="Extra percentage applied when the customer adds work during the visit (on the spot), on top of the agreed hourly package."
                      examples={["10% surcharge for same-day add-ons", "15% if scope expands at the door", "0% if you do not charge on-the-spot extras"]}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LabelWithHint
                    text="On the spot add on charge (%)"
                    hintLabel="On the spot add on charge (%)"
                    description="Enter a percentage (e.g. 10 = 10%). This stacks on top of the job when extras are agreed during service."
                    examples={["10 for a 10% add-on fee", "0 if not used", "20 for heavy last-minute scope changes"]}
                  />
                  <Input
                    type="number"
                    value={activeConfig.byHour.onSpotAddonPercent}
                    onChange={(e) =>
                      updateConfig(activeServiceTab, (cfg) => ({
                        ...cfg,
                        byHour: { ...cfg.byHour, onSpotAddonPercent: Number(e.target.value || 0) },
                      }))
                    }
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-0.5">
                    <span>Add on (by hour)</span>
                    <PricingHint
                      label="Add on (by hour)"
                      description="Optional extra services with their own name, pricing rule, and amount. Use Fix Price for a flat fee; other bases charge per quantity, bed count, or room count."
                      examples={["Inside oven — Fix Price RM 30", "Extra balcony — By Number of Room RM 25", "Laundry load — By Quantity RM 15 per load"]}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {renderAddonRows(activeConfig.byHour.addons, (next) =>
                    updateConfig(activeServiceTab, (cfg) => ({ ...cfg, byHour: { ...cfg.byHour, addons: next } }))
                  )}
                  <Button variant="outline" onClick={() => addAddon("byHour")}><Plus className="h-4 w-4 mr-1" />Add Add-on</Button>
                </CardContent>
              </Card>
            </div>
          )}

          {detailType === "by_property" && detailWizardStep === "edit" && (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Property Price Matrix</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {PROPERTY_ROWS.map((row) => (
                    <div key={row} className="grid grid-cols-12 gap-2 items-center">
                      <Label className="col-span-7">{row}</Label>
                      <Input
                        className="col-span-5"
                        type="number"
                        value={activeConfig.byProperty.prices[row] || 0}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            byProperty: { ...cfg.byProperty, prices: { ...cfg.byProperty.prices, [row]: Number(e.target.value || 0) } },
                          }))
                        }
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Feature (by property)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {activeConfig.byProperty.features.map((f, idx) => (
                    <div key={`byprop-feature-${idx}`} className="flex gap-2">
                      <Input
                        value={f}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            byProperty: {
                              ...cfg.byProperty,
                              features: cfg.byProperty.features.map((item, i) => (i === idx ? e.target.value : item)),
                            },
                          }))
                        }
                        placeholder="Feature service"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            byProperty: { ...cfg.byProperty, features: cfg.byProperty.features.filter((_, i) => i !== idx) },
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" onClick={() => addFeature("byProperty")}><Plus className="h-4 w-4 mr-1" />Add Feature</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Add on (by property)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {renderAddonRows(activeConfig.byProperty.addons, (next) =>
                    updateConfig(activeServiceTab, (cfg) => ({ ...cfg, byProperty: { ...cfg.byProperty, addons: next } }))
                  )}
                  <Button variant="outline" onClick={() => addAddon("byProperty")}><Plus className="h-4 w-4 mr-1" />Add Add-on</Button>
                </CardContent>
              </Card>
            </div>
          )}

          {detailType === "dobi_kg" && (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Section 1 - Dobi Services (by kg)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {activeConfig.dobiByKg.map((row, idx) => (
                    <div key={`kg-${row.item}-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                      <Input
                        className="col-span-7"
                        value={row.item}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            dobiByKg: cfg.dobiByKg.map((r, i) => (i === idx ? { ...r, item: e.target.value } : r)),
                          }))
                        }
                        placeholder="Item name"
                      />
                      <Input
                        className="col-span-5"
                        type="number"
                        value={row.rate}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            dobiByKg: cfg.dobiByKg.map((r, i) => (i === idx ? { ...r, rate: Number(e.target.value || 0) } : r)),
                          }))
                        }
                        placeholder="RM/kg"
                      />
                    </div>
                  ))}
                  <Button type="button" variant="outline" onClick={() => addDobiItem("dobiByKg")}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Item
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Section 2 - Ironing (by kg)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {activeConfig.ironingByKg.map((row, idx) => (
                    <div key={`iron-kg-${row.item}-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                      <Input
                        className="col-span-7"
                        value={row.item}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            ironingByKg: cfg.ironingByKg.map((r, i) => (i === idx ? { ...r, item: e.target.value } : r)),
                          }))
                        }
                        placeholder="Item name"
                      />
                      <Input
                        className="col-span-5"
                        type="number"
                        value={row.rate}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            ironingByKg: cfg.ironingByKg.map((r, i) => (i === idx ? { ...r, rate: Number(e.target.value || 0) } : r)),
                          }))
                        }
                        placeholder="RM/kg"
                      />
                    </div>
                  ))}
                  <Button type="button" variant="outline" onClick={() => addDobiItem("ironingByKg")}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Item
                  </Button>
                </CardContent>
              </Card>

            </div>
          )}

          {detailType === "dobi_pcs" && (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Section 1 - Dobi Services (by pcs)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {activeConfig.dobiByPcs.map((row, idx) => (
                    <div key={`pcs-${row.item}-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                      <Input
                        className="col-span-7"
                        value={row.item}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            dobiByPcs: cfg.dobiByPcs.map((r, i) => (i === idx ? { ...r, item: e.target.value } : r)),
                          }))
                        }
                        placeholder="Item name"
                      />
                      <Input
                        className="col-span-5"
                        type="number"
                        value={row.rate}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            dobiByPcs: cfg.dobiByPcs.map((r, i) => (i === idx ? { ...r, rate: Number(e.target.value || 0) } : r)),
                          }))
                        }
                        placeholder="RM/qty"
                      />
                    </div>
                  ))}
                  <Button type="button" variant="outline" onClick={() => addDobiItem("dobiByPcs")}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Item
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Section 2 - Ironing (by pcs)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {activeConfig.ironingByPcs.map((row, idx) => (
                    <div key={`iron-pcs-${row.item}-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                      <Input
                        className="col-span-7"
                        value={row.item}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            ironingByPcs: cfg.ironingByPcs.map((r, i) => (i === idx ? { ...r, item: e.target.value } : r)),
                          }))
                        }
                        placeholder="Item name"
                      />
                      <Input
                        className="col-span-5"
                        type="number"
                        value={row.rate}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            ironingByPcs: cfg.ironingByPcs.map((r, i) => (i === idx ? { ...r, rate: Number(e.target.value || 0) } : r)),
                          }))
                        }
                        placeholder="RM/qty"
                      />
                    </div>
                  ))}
                  <Button type="button" variant="outline" onClick={() => addDobiItem("ironingByPcs")}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Item
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {detailType === "dobi_bed" && (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Dobi Services - section mode: by bed</CardTitle></CardHeader>
                <CardContent>
                  <Label>Bed: fix price / bed</Label>
                  <Input
                    type="number"
                    value={activeConfig.dobiByBedPrice}
                    onChange={(e) =>
                      updateConfig(activeServiceTab, (cfg) => ({ ...cfg, dobiByBedPrice: Number(e.target.value || 0) }))
                    }
                    placeholder="RM/bed"
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {detailType === "homestay" && (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Section 1 - Setup property fix price</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {PROPERTY_ROWS.map((row) => (
                    <div key={row} className="grid grid-cols-12 gap-2 items-center">
                      <Label className="col-span-7">{row}</Label>
                      <Input
                        className="col-span-5"
                        type="number"
                        value={activeConfig.homestay.propertyPrices[row] || 0}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            homestay: {
                              ...cfg.homestay,
                              propertyPrices: { ...cfg.homestay.propertyPrices, [row]: Number(e.target.value || 0) },
                            },
                          }))
                        }
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {activeConfig.homestay.mode === "fixed_property_plus_bed" && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Section 2 - Bed qty</CardTitle></CardHeader>
                  <CardContent>
                    <Label>Price / bed qty</Label>
                    <Input
                      type="number"
                      value={activeConfig.homestay.bedQtyPrice}
                      onChange={(e) =>
                        updateConfig(activeServiceTab, (cfg) => ({
                          ...cfg,
                          homestay: { ...cfg.homestay, bedQtyPrice: Number(e.target.value || 0) },
                        }))
                      }
                    />
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader><CardTitle className="text-base">Section 3 - Feature</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {activeConfig.homestay.features.map((f, idx) => (
                    <div key={`homestay-feature-${idx}`} className="flex gap-2">
                      <Input
                        value={f}
                        onChange={(e) =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            homestay: { ...cfg.homestay, features: cfg.homestay.features.map((item, i) => (i === idx ? e.target.value : item)) },
                          }))
                        }
                        placeholder="Feature service"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          updateConfig(activeServiceTab, (cfg) => ({
                            ...cfg,
                            homestay: { ...cfg.homestay, features: cfg.homestay.features.filter((_, i) => i !== idx) },
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" onClick={() => addFeature("homestay")}><Plus className="h-4 w-4 mr-1" />Add Feature</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Section 4 - Add on</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {renderAddonRows(activeConfig.homestay.addons, (next) =>
                    updateConfig(activeServiceTab, (cfg) => ({ ...cfg, homestay: { ...cfg.homestay, addons: next } }))
                  )}
                  <Button variant="outline" onClick={() => addAddon("homestay")}><Plus className="h-4 w-4 mr-1" />Add Add-on</Button>
                </CardContent>
              </Card>
            </div>
          )}

          <DialogFooter>
            {detailType === "by_hour" || detailType === "by_property" ? (
              detailWizardStep === "edit" ? (
                <>
                  <Button type="button" variant="outline" onClick={() => handleDetailDialogOpenChange(false)}>
                    Close
                  </Button>
                  <Button type="button" onClick={() => setDetailWizardStep("summary")}>
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setDetailWizardStep("edit")}>
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                  <Button type="button" onClick={handleDetailSaveFromSummary}>
                    Save
                  </Button>
                </>
              )
            ) : (
              <>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Close
                  </Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button type="button">Save</Button>
                </DialogClose>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

