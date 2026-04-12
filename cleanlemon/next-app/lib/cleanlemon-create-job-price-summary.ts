import type { ServiceKey } from '@/lib/cleanlemon-pricing-services'

export type CreateJobPriceSummary = {
  /** Human-readable lines (reference only; actual invoice may differ). */
  lines: Array<{ text: string; strong?: boolean }>
  /** Single number suitable for “base + add-ons” when unambiguous; otherwise null. */
  indicativeBaseAmount: number | null
}

/** Optional per-property fees (`cln_property` / merged detail) — when set &gt; 0 they override operator Pricing for Create Job estimate. */
export type PropertyFeeHints = {
  /** General cleaning: `generalcleaning` */
  generalCleaning?: number | null
  /** Homestay: maps to `cleaning_fees` */
  cleaningFees?: number | null
  warmCleaning?: number | null
  deepCleaning?: number | null
  renovationCleaning?: number | null
}

function num(x: unknown): number {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/**
 * Minimum selling price from Pricing → by-hour (when enabled). 0 = no floor.
 */
export function getCreateJobMinSellingPrice(
  serviceKey: ServiceKey,
  serviceConfigs: Record<string, unknown> | null | undefined
): number {
  const raw = serviceConfigs?.[serviceKey as string]
  if (!raw || typeof raw !== 'object') return 0
  const c = raw as Record<string, unknown>
  if (!Boolean(c.byHourEnabled)) return 0
  const byHour = c.byHour && typeof c.byHour === 'object' ? (c.byHour as Record<string, unknown>) : null
  if (!byHour) return 0
  return Math.max(0, num(byHour.minSellingPrice))
}

/**
 * Reference pricing for the Create Job dialog Summary (from saved operator Pricing).
 * Not a quote: quotation-only or ambiguous configs return null `indicativeBaseAmount`.
 *
 * Priority when `propertyFees` is passed: **property row first** (general, homestay, warm, deep, renovation); if no
 * positive amount on the property, fall through to **Finance → Pricing** for that service.
 */
export function buildCreateJobPriceSummary(
  serviceKey: ServiceKey,
  serviceConfigs: Record<string, unknown> | null | undefined,
  opts?: {
    premisesType?: string
    /** Selected time window length in hours (From–To). When set, by-hour estimate uses this instead of Pricing “block” hours. */
    durationHours?: number | null
    propertyFees?: PropertyFeeHints | null
  }
): CreateJobPriceSummary {
  const lines: Array<{ text: string; strong?: boolean }> = []
  let indicativeBaseAmount: number | null = null

  const pf = opts?.propertyFees
  const raw = serviceConfigs?.[serviceKey as string]

  // --- Property-level overrides before operator Pricing ---

  if (serviceKey === 'general' && pf?.generalCleaning != null && num(pf.generalCleaning) > 0) {
    const v = Math.round(num(pf.generalCleaning) * 100) / 100
    return {
      lines: [{ text: `General cleaning (property generalcleaning): RM ${fmtMoney(v)}`, strong: true }],
      indicativeBaseAmount: v,
    }
  }

  if (serviceKey === 'homestay' && pf?.cleaningFees != null && num(pf.cleaningFees) > 0) {
    const v = Math.round(num(pf.cleaningFees) * 100) / 100
    lines.push({ text: `Homestay (property cleaning_fees): RM ${fmtMoney(v)}`, strong: true })
    if (raw && typeof raw === 'object') {
      lines.push(...collectHomestayAddonHint(raw as Record<string, unknown>))
    }
    return { lines, indicativeBaseAmount: v }
  }

  if (serviceKey === 'warm' && pf?.warmCleaning != null && num(pf.warmCleaning) > 0) {
    const v = Math.round(num(pf.warmCleaning) * 100) / 100
    return {
      lines: [{ text: `Warm cleaning (property warmcleaning): RM ${fmtMoney(v)}`, strong: true }],
      indicativeBaseAmount: v,
    }
  }

  if (serviceKey === 'deep' && pf?.deepCleaning != null && num(pf.deepCleaning) > 0) {
    const v = Math.round(num(pf.deepCleaning) * 100) / 100
    return {
      lines: [{ text: `Deep cleaning (property deepcleaning): RM ${fmtMoney(v)}`, strong: true }],
      indicativeBaseAmount: v,
    }
  }

  if (serviceKey === 'renovation' && pf?.renovationCleaning != null && num(pf.renovationCleaning) > 0) {
    const v = Math.round(num(pf.renovationCleaning) * 100) / 100
    return {
      lines: [{ text: `Renovation cleaning (property renovationcleaning): RM ${fmtMoney(v)}`, strong: true }],
      indicativeBaseAmount: v,
    }
  }

  if (!raw || typeof raw !== 'object') {
    return {
      lines: [{ text: 'No pricing saved for this service — set amounts under Finance → Pricing.' }],
      indicativeBaseAmount: null,
    }
  }

  const c = raw as Record<string, unknown>
  const quotationEnabled = Boolean(c.quotationEnabled)
  const byHourEnabled = Boolean(c.byHourEnabled)
  const byPropertyEnabled = Boolean(c.byPropertyEnabled)

  if (serviceKey === 'homestay') {
    const h = c.homestay && typeof c.homestay === 'object' ? (c.homestay as Record<string, unknown>) : null
    if (h) {
      const pp = h.propertyPrices && typeof h.propertyPrices === 'object' ? (h.propertyPrices as Record<string, number>) : {}
      const vals = Object.values(pp)
        .map((n) => num(n))
        .filter((n) => n > 0)
      if (vals.length) {
        const min = Math.min(...vals)
        const max = Math.max(...vals)
        lines.push({
          text:
            min === max
              ? `Homestay base (from Pricing): RM ${min.toLocaleString('en-MY')}`
              : `Homestay base range: RM ${min.toLocaleString('en-MY')} – ${max.toLocaleString('en-MY')} (by property name)`,
          strong: true,
        })
        indicativeBaseAmount = min
      }
      const bed = num(h.bedQtyPrice)
      if (bed > 0 && String(h.mode) === 'fixed_property_plus_bed') {
        lines.push({ text: `Per bed add-on: RM ${bed.toLocaleString('en-MY')} each` })
      }
    }
    lines.push(...collectHomestayAddonHint(c))
    if (lines.length === 0) {
      lines.push({ text: 'Homestay pricing incomplete — complete Finance → Pricing for this service.' })
    }
    return { lines, indicativeBaseAmount }
  }

  if (serviceKey === 'dobi') {
    lines.push({
      text: 'Dobi / laundry pricing uses weight or piece rates in Pricing — see Finance → Pricing for tables.',
    })
    return { lines, indicativeBaseAmount: null }
  }

  if (quotationEnabled && !byHourEnabled && !byPropertyEnabled) {
    lines.push({
      text: 'Quotation mode: no fixed job price until after site visit (Finance → Pricing).',
    })
    return { lines, indicativeBaseAmount: null }
  }

  const byHour = c.byHour && typeof c.byHour === 'object' ? (c.byHour as Record<string, unknown>) : null
  if (byHourEnabled && byHour) {
    const price = Math.max(0, num(byHour.price))
    const blockHours = Math.max(0, num(byHour.hours))
    const workers = Math.max(0, num(byHour.workers))
    const dur =
      opts?.durationHours != null && Number.isFinite(opts.durationHours) && opts.durationHours > 0
        ? opts.durationHours
        : null
    const billHours = dur != null ? dur : blockHours
    const total = Math.round(price * billHours * workers * 100) / 100
    const minSp = Math.max(0, num(byHour.minSellingPrice))
    if (total > 0) {
      const unit = `${billHours}h × ${workers} worker(s) × RM ${price.toLocaleString('en-MY')}`
      const tail =
        dur != null
          ? ` (${unit}, selected window)`
          : ` (${unit} — choose From/To to match duration)`
      lines.push({
        text: `By-hour reference: RM ${total.toLocaleString('en-MY')}${tail}`,
        strong: true,
      })
      indicativeBaseAmount = total
    }
    if (minSp > 0) {
      lines.push({ text: `Minimum selling (by hour): RM ${minSp.toLocaleString('en-MY')}` })
    }
  }

  if (byPropertyEnabled && c.byProperty && typeof c.byProperty === 'object') {
    const bp = c.byProperty as Record<string, unknown>
    const prices = bp.prices && typeof bp.prices === 'object' ? (bp.prices as Record<string, number>) : {}
    const pt = String(opts?.premisesType || '').trim().toLowerCase()
    const mapPremisesToRow: Record<string, string> = {
      apartment: '2 bedroom',
      landed: 'Double storey',
      office: 'Office 500 sqft',
      commercial: 'Office 1000 sqft',
      other: 'Studio',
    }
    const rowKey = mapPremisesToRow[pt]
    const picked = rowKey != null && prices[rowKey] != null ? num(prices[rowKey]) : null
    if (picked != null && picked > 0) {
      lines.push({
        text: `By property layout (“${rowKey}”): RM ${picked.toLocaleString('en-MY')}`,
        strong: true,
      })
      if (indicativeBaseAmount == null) indicativeBaseAmount = picked
    } else {
      const nums = Object.values(prices)
        .map((n) => num(n))
        .filter((n) => n > 0)
      if (nums.length) {
        const mn = Math.min(...nums)
        const mx = Math.max(...nums)
        lines.push({
          text:
            mn === mx
              ? `By property layout: RM ${mn.toLocaleString('en-MY')}`
              : `By property layout: RM ${mn.toLocaleString('en-MY')} – ${mx.toLocaleString('en-MY')} (rows in Pricing)`,
          strong: indicativeBaseAmount == null,
        })
        if (indicativeBaseAmount == null) indicativeBaseAmount = mn
      }
    }
  }

  if (lines.length === 0) {
    lines.push({ text: 'No reference price in Pricing for this service yet.' })
  }

  return { lines, indicativeBaseAmount }
}

function collectHomestayAddonHint(c: Record<string, unknown>): Array<{ text: string }> {
  const h = c.homestay && typeof c.homestay === 'object' ? (c.homestay as Record<string, unknown>) : null
  if (!h || !Array.isArray(h.addons)) return []
  const out: Array<{ text: string }> = []
  for (const item of h.addons) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = String(o.name || '').trim()
    const price = num(o.price)
    if (!name || price <= 0) continue
    out.push({ text: `Listed add-on (homestay): ${name} — RM ${price.toLocaleString('en-MY')}` })
  }
  return out.slice(0, 3)
}
