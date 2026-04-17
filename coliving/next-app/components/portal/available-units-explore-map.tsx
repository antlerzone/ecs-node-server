"use client"

import { useEffect, useRef } from "react"
import "leaflet/dist/leaflet.css"

/** Johor Bahru fallback when no pins */
const DEFAULT_LAT = 1.492659
const DEFAULT_LNG = 103.741359

/** Align with portal `PUBLIC_FX_SGD_TO_MYR` / server `FX_SGD_TO_MYR` default. */
const FX_SGD_TO_MYR = 3.5

function convertPriceForCompare(
  price: number | null | undefined,
  listingCurrency: string | undefined,
  compare: "MYR" | "SGD" | "OFF",
): { amount: number; displayCurrency: string } {
  const p = Number(price)
  if (price == null || !Number.isFinite(p)) return { amount: NaN, displayCurrency: "MYR" }
  const c = (listingCurrency || "").trim().toUpperCase()
  if (compare === "OFF") {
    const cur = c || "MYR"
    return { amount: p, displayCurrency: cur }
  }
  if (compare === "MYR") {
    const a = c === "SGD" ? p * FX_SGD_TO_MYR : p
    return { amount: a, displayCurrency: "MYR" }
  }
  const a = c === "MYR" ? p / FX_SGD_TO_MYR : p
  return { amount: a, displayCurrency: "SGD" }
}

export type ExploreMapUnit = {
  id: string
  _id?: string
  price?: number | null
  currency?: string
  roomName?: string
  title_fld?: string
  /** roomdetail.listing_scope — public listing kind */
  listingScope?: "room" | "entire_unit"
  operatorName?: string | null
  propertyId?: string
  property?: {
    shortname?: string
    apartmentName?: string | null
    _id?: string
    latitude?: number | null
    longitude?: number | null
  }
}

function formatMarkerPrice(currency: string, price: number | null | undefined): string {
  const c = (currency || "MYR").trim().toUpperCase()
  if (price == null) return "—"
  const num = Number(price)
  if (!Number.isFinite(num)) return "—"
  const rounded = String(Math.round(num))
  if (c === "MYR") return `RM${rounded}`
  if (c === "SGD") return `S$${rounded}`
  return `${c} ${rounded}`
}

function propertyKey(u: ExploreMapUnit): string {
  return String(u.propertyId || u.property?._id || "")
}

/** One GPS point per property — no per-room jitter (rooms stack at same building). */
function rawPropertyCoords(unit: ExploreMapUnit): [number, number] | null {
  const lat = unit.property?.latitude
  const lng = unit.property?.longitude
  if (lat == null || lng == null) return null
  const la = Number(lat)
  const lo = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null
  return [la, lo]
}

function buildingTitle(units: ExploreMapUnit[]): string {
  const u0 = units[0]
  const apt = u0.property?.apartmentName?.trim()
  if (apt) return apt
  const sn = (u0.property?.shortname ?? "").trim()
  return sn || "Building"
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function groupUnitsByProperty(items: ExploreMapUnit[]): ExploreMapUnit[][] {
  const map = new Map<string, ExploreMapUnit[]>()
  for (const u of items) {
    const k = propertyKey(u)
    if (!k) continue
    const arr = map.get(k)
    if (arr) arr.push(u)
    else map.set(k, [u])
  }
  return Array.from(map.values()).filter((g) => rawPropertyCoords(g[0]) != null)
}

function markerPriceLabel(
  units: ExploreMapUnit[],
  clientCurrency: string,
  priceCompare: "MYR" | "SGD" | "OFF",
): string {
  const amounts = units.map((u) => {
    const { amount } = convertPriceForCompare(u.price, u.currency, priceCompare)
    return amount
  })
  const finite = amounts.filter((n) => Number.isFinite(n)) as number[]
  if (finite.length === 0) return "—"
  const min = Math.min(...finite)
  const cur =
    priceCompare === "OFF"
      ? (units[0].currency || clientCurrency || "MYR").trim().toUpperCase()
      : priceCompare
  const one = formatMarkerPrice(cur, min)
  return units.length > 1 ? `${one}+` : one
}

function groupSelected(units: ExploreMapUnit[], selectedUnitId: string | null): boolean {
  if (!selectedUnitId) return false
  return units.some((u) => (u.id || u._id) === selectedUnitId)
}

function listingTypeLabel(u: ExploreMapUnit): string {
  return u.listingScope === "entire_unit" ? "Entire unit" : "Room"
}

function buildPopupHtml(
  units: ExploreMapUnit[],
  clientCurrency: string,
  priceCompare: "MYR" | "SGD" | "OFF",
): string {
  const sorted = [...units].sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0))
  const title = escapeHtml(buildingTitle(units))
  const rows = sorted
    .map((u) => {
      const id = escapeHtml(u.id || u._id || "")
      const room = (u.roomName || u.title_fld || "Room").trim() || "Room"
      const op = (u.operatorName || "").trim()
      const roomEsc = escapeHtml(room)
      const typeEsc = escapeHtml(listingTypeLabel(u))
      const opEsc = op ? escapeHtml(op) : ""
      const metaLines = opEsc
        ? `<span style="font-size:11px;line-height:1.3;color:#555;font-weight:500">${typeEsc}</span><span style="font-size:11px;line-height:1.3;color:#777;word-break:break-word">${opEsc}</span>`
        : `<span style="font-size:11px;line-height:1.3;color:#555;font-weight:500">${typeEsc}</span>`
      const { amount, displayCurrency } = convertPriceForCompare(u.price, u.currency, priceCompare)
      const price = escapeHtml(formatMarkerPrice(displayCurrency, amount))
      return `<button type="button" class="au-map-unit-row" data-unit-id="${id}" style="display:flex;width:100%;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 12px;border:none;background:transparent;border-bottom:1px solid rgba(0,0,0,.08);cursor:pointer;text-align:left;line-height:1.35;color:#111"><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;align-items:flex-start"><span style="font-size:13px;font-weight:600;line-height:1.3;word-break:break-word">${roomEsc}</span><span style="display:flex;flex-direction:column;gap:2px;align-items:flex-start;width:100%">${metaLines}</span></span><strong style="flex-shrink:0;font-size:13px;font-weight:700;padding-top:1px">${price}</strong></button>`
    })
    .join("")
  return `<div class="au-map-popup" style="min-width:220px;max-width:300px;font-family:system-ui,sans-serif"><div style="font-weight:700;font-size:14px;padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.1);color:#111">${title}</div><div style="max-height:220px;overflow-y:auto">${rows}</div></div>`
}

type Props = {
  items: ExploreMapUnit[]
  clientCurrency: string
  /** When MYR/SGD, marker and popup amounts match portal “Monthly price in” (integer rounding). */
  priceCompareCurrency?: "MYR" | "SGD" | "OFF"
  selectedUnitId: string | null
  onMarkerClick: (unit: ExploreMapUnit) => void
  className?: string
}

export function AvailableUnitsExploreMap({
  items,
  clientCurrency,
  priceCompareCurrency = "OFF",
  selectedUnitId,
  onMarkerClick,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<import("leaflet").Map | null>(null)
  const markersRef = useRef<import("leaflet").Marker[]>([])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let cancelled = false
    const run = async () => {
      const L = await import("leaflet")
      if (cancelled) return

      for (const m of markersRef.current) {
        try {
          m.remove()
        } catch {
          /* ignore */
        }
      }
      markersRef.current = []
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }

      const groups = groupUnitsByProperty(items)
      const center: [number, number] =
        groups.length > 0 ? rawPropertyCoords(groups[0][0])! : [DEFAULT_LAT, DEFAULT_LNG]
      const map = L.map(el).setView(center, groups.length === 0 ? 11 : groups.length === 1 ? 14 : 12)
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
      }).addTo(map)

      const bounds: [number, number][] = []

      for (const units of groups) {
        const [lat, lng] = rawPropertyCoords(units[0])!
        const selected = groupSelected(units, selectedUnitId)
        const label = markerPriceLabel(units, clientCurrency, priceCompareCurrency)
        const html = `<div style="display:flex;justify-content:center;align-items:flex-end;width:100px;height:40px;margin:0;padding:0"><div style="padding:6px 12px;background:${selected ? "#111" : "#fff"};color:${selected ? "#fff" : "#111"};border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,0.18);font-weight:700;font-size:13px;font-family:system-ui,sans-serif;white-space:nowrap;border:1px solid ${selected ? "#111" : "rgba(0,0,0,0.06)"};line-height:1.2">${label}</div></div>`
        const icon = L.divIcon({
          className: "available-unit-price-marker",
          html,
          iconSize: [100, 40],
          iconAnchor: [50, 40],
        })
        const marker = L.marker([lat, lng], { icon }).addTo(map)

        const popupHtml = buildPopupHtml(units, clientCurrency, priceCompareCurrency)
        marker.bindPopup(popupHtml, {
          closeButton: false,
          autoClose: false,
          closeOnClick: false,
          className: "au-map-popup-wrap",
          offset: [0, -36],
        })

        let closeTimer: ReturnType<typeof setTimeout> | null = null
        const clearClose = () => {
          if (closeTimer != null) {
            window.clearTimeout(closeTimer)
            closeTimer = null
          }
        }
        const scheduleClose = () => {
          clearClose()
          closeTimer = window.setTimeout(() => {
            marker.closePopup()
            closeTimer = null
          }, 220)
        }

        marker.on("mouseover", () => {
          clearClose()
          marker.openPopup()
        })
        marker.on("mouseout", () => {
          scheduleClose()
        })
        marker.on("click", () => {
          clearClose()
          marker.openPopup()
        })

        marker.on("popupopen", () => {
          const popup = marker.getPopup()
          const pu = popup?.getElement()
          if (!pu) return
          const onEnter = () => clearClose()
          const onLeave = () => scheduleClose()
          pu.addEventListener("mouseenter", onEnter)
          pu.addEventListener("mouseleave", onLeave)

          const onRowClick = (ev: Event) => {
            const t = (ev.target as HTMLElement).closest("button[data-unit-id]")
            if (!t) return
            const id = t.getAttribute("data-unit-id")
            const unit = units.find((u) => (u.id || u._id) === id)
            if (unit) onMarkerClick(unit)
            marker.closePopup()
          }
          pu.addEventListener("click", onRowClick)

          const cleanup = () => {
            pu.removeEventListener("mouseenter", onEnter)
            pu.removeEventListener("mouseleave", onLeave)
            pu.removeEventListener("click", onRowClick)
            popup?.off("remove", cleanup)
          }
          popup?.on("remove", cleanup)
        })

        markersRef.current.push(marker)
        bounds.push([lat, lng])
      }

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [56, 56], maxZoom: 15 })
      }
      mapRef.current = map
      window.setTimeout(() => map.invalidateSize(), 120)
    }

    void run()

    return () => {
      cancelled = true
      for (const m of markersRef.current) {
        try {
          m.remove()
        } catch {
          /* ignore */
        }
      }
      markersRef.current = []
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [items, clientCurrency, priceCompareCurrency, selectedUnitId, onMarkerClick])

  return <div ref={containerRef} className={className ?? ""} />
}

/** Number of map pins (one per property with GPS). */
export function countMappableUnits(items: ExploreMapUnit[]): number {
  return groupUnitsByProperty(items).length
}
