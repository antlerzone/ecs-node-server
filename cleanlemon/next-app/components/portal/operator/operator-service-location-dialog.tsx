"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, MapPin, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  fetchAddressSearch,
  normalizeServiceAreaZones,
  SERVICE_AREA_RADIUS_KM_MAX,
  SERVICE_AREA_RADIUS_KM_MIN,
  type ServiceAreaZone,
  type ServiceAreaZoneMode,
} from "@/lib/cleanlemon-api"
import "leaflet/dist/leaflet.css"

const DEFAULT_MAP_LAT = 1.492659
const DEFAULT_MAP_LNG = 103.741359

function makeZoneId(): string {
  return `zone-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function cloneZones(zones: ServiceAreaZone[]): ServiceAreaZone[] {
  return zones.map((z) => ({ ...z }))
}

function validateZonesForSave(zones: ServiceAreaZone[]): boolean {
  const hasInclude = zones.some((z) => z.mode === "include")
  const hasExclude = zones.some((z) => z.mode === "exclude")
  if (hasExclude && !hasInclude) {
    toast.error("Add at least one Include zone before using Exclude, or remove Exclude rows.")
    return false
  }
  return true
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  zones: ServiceAreaZone[]
  onCommit: (next: ServiceAreaZone[]) => void | Promise<void>
}

export function OperatorServiceLocationDialog({ open, onOpenChange, zones, onCommit }: Props) {
  const [draft, setDraft] = useState<ServiceAreaZone[]>([])
  const draftSnapshotOnOpen = useRef<ServiceAreaZone[]>([])
  const prevOpenRef = useRef(false)

  const [suggestRowId, setSuggestRowId] = useState<string | null>(null)
  const [suggestItems, setSuggestItems] = useState<Array<{ displayName: string; lat: string; lon: string; placeId: string }>>(
    []
  )
  const [suggestLoading, setSuggestLoading] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mapHostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<import("leaflet").Map | null>(null)
  const layerGroupRef = useRef<import("leaflet").LayerGroup | null>(null)
  const leafletRef = useRef<typeof import("leaflet") | null>(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = open
    if (!open) return
    if (!wasOpen) {
      draftSnapshotOnOpen.current = cloneZones(normalizeServiceAreaZones(zones))
      setDraft(cloneZones(normalizeServiceAreaZones(zones)))
      setSuggestRowId(null)
      setSuggestItems([])
      setSuggestLoading(false)
    }
  }, [open, zones])

  const scheduleAddressSearch = useCallback((rowId: string, raw: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    const q = raw.trim()
    if (q.length < 3) {
      setSuggestItems([])
      setSuggestLoading(false)
      return
    }
    setSuggestLoading(true)
    searchTimerRef.current = setTimeout(() => {
      void (async () => {
        const r = await fetchAddressSearch({ q, limit: 8 })
        setSuggestLoading(false)
        if (!r?.ok || !Array.isArray(r.items)) {
          setSuggestItems([])
          return
        }
        setSuggestItems(r.items)
        setSuggestRowId(rowId)
      })()
    }, 450)
  }, [])

  const updateRow = useCallback((id: string, patch: Partial<ServiceAreaZone>) => {
    setDraft((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)))
  }, [])

  const pickSuggestion = useCallback((rowId: string, item: { displayName: string; lat: string; lon: string }) => {
    const lat = parseFloat(String(item.lat))
    const lng = parseFloat(String(item.lon))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error("Invalid coordinates from search result")
      return
    }
    updateRow(rowId, { label: item.displayName, lat, lng })
    setSuggestItems([])
    setSuggestRowId(null)
  }, [updateRow])

  const handleCancel = () => {
    setDraft(cloneZones(draftSnapshotOnOpen.current))
    setSuggestRowId(null)
    setSuggestItems([])
    onOpenChange(false)
  }

  const handleSave = async () => {
    const normalized = normalizeServiceAreaZones(draft)
    if (!validateZonesForSave(normalized)) return
    await onCommit(normalized)
    onOpenChange(false)
  }

  /** Create Leaflet map once when dialog opens; tear down when it closes. */
  useEffect(() => {
    if (!open) {
      setMapReady(false)
      if (mapRef.current) {
        try {
          mapRef.current.remove()
        } catch {
          /* ignore */
        }
        mapRef.current = null
        layerGroupRef.current = null
        leafletRef.current = null
      }
      return
    }

    let cancelled = false
    const t = window.setTimeout(() => {
      void (async () => {
        const L = await import("leaflet")
        if (cancelled || !open || !mapHostRef.current) return
        leafletRef.current = L
        const el = mapHostRef.current
        if (mapRef.current) {
          try {
            mapRef.current.remove()
          } catch {
            /* ignore */
          }
          mapRef.current = null
          layerGroupRef.current = null
        }
        const map = L.map(el).setView([DEFAULT_MAP_LAT, DEFAULT_MAP_LNG], 11)
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map)
        const group = L.layerGroup().addTo(map)
        mapRef.current = map
        layerGroupRef.current = group
        setMapReady(true)
        window.setTimeout(() => {
          try {
            map.invalidateSize()
          } catch {
            /* ignore */
          }
        }, 200)
      })()
    }, 80)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [open])

  /** Redraw pins/circles when zones change (map must exist). */
  useEffect(() => {
    if (!open || !mapReady) return
    const L = leafletRef.current
    const map = mapRef.current
    const group = layerGroupRef.current
    if (!L || !map || !group) return

    group.clearLayers()
    const circleBounds: import("leaflet").LatLngBounds[] = []
    for (const z of draft) {
      if (!Number.isFinite(z.lat) || !Number.isFinite(z.lng)) continue
      const isExc = z.mode === "exclude"
      const fill = isExc ? "#ef4444" : "#22c55e"
      const stroke = isExc ? "#b91c1c" : "#15803d"
      const circle = L.circle([z.lat, z.lng], {
        radius: z.radiusKm * 1000,
        color: stroke,
        weight: 2,
        fillColor: fill,
        fillOpacity: 0.28,
      }).addTo(group)
      const pinIcon = L.divIcon({
        className: "cleanlemon-service-area-pin",
        html: `<div style="width:14px;height:14px;background:${fill};border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })
      const marker = L.marker([z.lat, z.lng], {
        draggable: true,
        icon: pinIcon,
      }).addTo(group)
      const zoneId = z.id
      marker.on("dragend", () => {
        const p = marker.getLatLng()
        updateRow(zoneId, { lat: p.lat, lng: p.lng })
      })
      circleBounds.push(circle.getBounds())
    }

    if (circleBounds.length > 0) {
      try {
        let combined = circleBounds[0]
        for (let i = 1; i < circleBounds.length; i++) {
          combined = combined.extend(circleBounds[i])
        }
        map.fitBounds(combined, { padding: [24, 24], maxZoom: 15 })
      } catch {
        /* ignore */
      }
    } else {
      map.setView([DEFAULT_MAP_LAT, DEFAULT_MAP_LNG], 11)
    }

    window.setTimeout(() => {
      try {
        map.invalidateSize()
      } catch {
        /* ignore */
      }
    }, 50)
  }, [open, mapReady, draft, updateRow])

  const addRow = () => {
    setDraft((prev) => [
      ...prev,
      {
        id: makeZoneId(),
        lat: DEFAULT_MAP_LAT,
        lng: DEFAULT_MAP_LNG,
        radiusKm: 0.03,
        mode: "include",
        label: "",
      },
    ])
  }

  const removeRow = (id: string) => {
    setDraft((prev) => prev.filter((z) => z.id !== id))
    if (suggestRowId === id) {
      setSuggestRowId(null)
      setSuggestItems([])
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleCancel()}>
      <DialogContent className="max-h-[min(90vh,900px)] w-[min(100vw-2rem,48rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="space-y-1 border-b px-6 py-4 text-left">
          <DialogTitle>Services location</DialogTitle>
          <DialogDescription>
            Search an address, set radius (kilometres), and Include or Exclude. Multiple pins are allowed. Drag a pin
            to fine-tune. Empty list means no geographic limit (same as before).
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[38vh] overflow-y-auto border-b px-6 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">Zones</Label>
            <Button type="button" variant="outline" size="sm" onClick={addRow} className="h-8 gap-1">
              <Plus className="h-3.5 w-3.5" />
              Add row
            </Button>
          </div>
          {draft.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No zones yet. Tap &quot;Add row&quot; to start.</p>
          ) : (
            <ul className="space-y-3">
              {draft.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border bg-muted/20 p-3 space-y-2"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-2">
                    <div className="relative z-10 min-w-0 flex-1">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          className="pl-9 pr-9"
                          value={row.label ?? ""}
                          placeholder="Search address (Malaysia)…"
                          autoComplete="off"
                          onChange={(e) => {
                            const v = e.target.value
                            updateRow(row.id, { label: v })
                            scheduleAddressSearch(row.id, v)
                          }}
                          onFocus={() => {
                            if ((row.label ?? "").trim().length >= 3) {
                              scheduleAddressSearch(row.id, row.label ?? "")
                            }
                          }}
                        />
                        {suggestLoading && suggestRowId === row.id ? (
                          <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                        ) : null}
                      </div>
                      {suggestRowId === row.id && suggestItems.length > 0 ? (
                        <ul
                          className="absolute z-[100] mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                          role="listbox"
                        >
                          {suggestItems.map((item, idx) => (
                            <li key={`${item.placeId || "p"}-${idx}`}>
                              <button
                                type="button"
                                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pickSuggestion(row.id, item)}
                              >
                                {item.displayName}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={SERVICE_AREA_RADIUS_KM_MIN}
                          max={SERVICE_AREA_RADIUS_KM_MAX}
                          step={0.01}
                          className="h-9 w-[5.25rem]"
                          value={row.radiusKm}
                          onChange={(e) => {
                            const n = Number(e.target.value)
                            if (!Number.isFinite(n)) return
                            updateRow(row.id, {
                              radiusKm: Math.min(
                                SERVICE_AREA_RADIUS_KM_MAX,
                                Math.max(SERVICE_AREA_RADIUS_KM_MIN, n)
                              ),
                            })
                          }}
                          aria-label="Radius kilometres"
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">km</span>
                      </div>
                      <Select
                        value={row.mode}
                        onValueChange={(v) => updateRow(row.id, { mode: v as ServiceAreaZoneMode })}
                      >
                        <SelectTrigger className="h-9 w-[8.5rem]" aria-label="Include or exclude">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="include">Include</SelectItem>
                          <SelectItem value="exclude">Exclude</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeRow(row.id)}
                        aria-label="Remove zone"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {Number.isFinite(row.lat) && Number.isFinite(row.lng)
                      ? `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}`
                      : "Pick a search result to set coordinates"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="leaflet-map-host relative h-[min(42vh,360px)] w-full min-h-[240px] bg-muted/30">
          <div ref={mapHostRef} className="absolute inset-0 z-0" />
        </div>

        <DialogFooter className="gap-2 border-t px-6 py-4 sm:justify-end">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
