import type { CleanlemonOperatorServiceKey } from './cleanlemon-operator-services'

/** Representative selling price (RM) for KPI point preview — same spirit as Pricing summaries. */
export function getReferenceSellingPrice(
  serviceKey: CleanlemonOperatorServiceKey,
  rawConfig: unknown,
): number {
  const cfg = rawConfig as Record<string, unknown> | null | undefined
  if (!cfg || typeof cfg !== 'object') return 0

  if (serviceKey === 'dobi') {
    const rates: number[] = []
    const pushRates = (arr: unknown) => {
      if (!Array.isArray(arr)) return
      for (const x of arr) {
        if (x && typeof x === 'object' && 'rate' in x) {
          rates.push(Number((x as { rate: unknown }).rate) || 0)
        }
      }
    }
    pushRates(cfg.dobiByKg)
    pushRates(cfg.dobiByPcs)
    pushRates(cfg.ironingByKg)
    pushRates(cfg.ironingByPcs)
    const bed = Number(cfg.dobiByBedPrice) || 0
    return Math.max(0, ...rates, bed)
  }

  if (serviceKey === 'homestay') {
    const h = cfg.homestay as Record<string, unknown> | undefined
    if (!h || typeof h !== 'object') return 0
    const pp = h.propertyPrices as Record<string, unknown> | undefined
    const prices =
      pp && typeof pp === 'object' ? Object.values(pp).map((n) => Number(n) || 0) : []
    const bed = Number(h.bedQtyPrice) || 0
    return Math.max(0, ...prices, bed)
  }

  const byHour = cfg.byHour as Record<string, unknown> | undefined
  const byProperty = cfg.byProperty as { prices?: Record<string, unknown> } | undefined
  let hourEst = 0
  if (byHour && typeof byHour === 'object') {
    const price = Number(byHour.price) || 0
    const hours = Number(byHour.hours) || 1
    const workers = Number(byHour.workers) || 1
    const minSp = Number(byHour.minSellingPrice) || 0
    hourEst = minSp > 0 ? minSp : price * hours * workers
  }
  let maxProp = 0
  const prices = byProperty?.prices
  if (prices && typeof prices === 'object') {
    maxProp = Math.max(0, ...Object.values(prices).map((n) => Number(n) || 0))
  }
  return Math.max(hourEst, maxProp)
}

export function previewKpiPointsFromRule(
  mode: 'percentage_of_price' | 'fixed_points',
  value: number,
  referenceSellingPrice: number,
): number {
  if (mode === 'fixed_points') return Math.max(0, value)
  const pct = Math.max(0, Math.min(100, value))
  const raw = (referenceSellingPrice * pct) / 100
  return Math.round(raw * 100) / 100
}
