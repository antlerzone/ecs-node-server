import type { ServiceKey } from '@/lib/cleanlemon-pricing-services'

export type JobAddonBasis = 'fixed' | 'quantity' | 'bed' | 'room'

export interface JobAddonOption {
  id: string
  name: string
  basis: JobAddonBasis
  price: number
  section: 'byHour' | 'byProperty' | 'homestay'
}

function isAddonBasis(x: unknown): x is JobAddonBasis {
  return x === 'fixed' || x === 'quantity' || x === 'bed' || x === 'room'
}

function parseAddonList(
  raw: unknown,
  section: JobAddonOption['section'],
  seen: Set<string>,
  out: JobAddonOption[]
) {
  if (!Array.isArray(raw)) return
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = String(o.name || '').trim()
    if (!name) continue
    const basis = isAddonBasis(o.basis) ? o.basis : 'fixed'
    const price = Math.max(0, Number(o.price) || 0)
    const idRaw = String(o.id || '').trim()
    const dedupeKey = idRaw || `${section}:${name}:${basis}:${price}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push({
      id: idRaw || dedupeKey,
      name,
      basis,
      price,
      section,
    })
  }
}

/**
 * Add-ons configured under Operator Pricing for the given service.
 * - Homestay service: `homestay.addons`
 * - Other services: `byHour.addons` + `byProperty.addons` (deduped)
 */
export function collectJobAddonOptions(
  serviceKey: ServiceKey,
  serviceConfigs: Record<string, unknown> | null | undefined
): JobAddonOption[] {
  if (!serviceConfigs || typeof serviceConfigs !== 'object') return []
  const svc = serviceConfigs[serviceKey as string]
  if (!svc || typeof svc !== 'object') return []
  const c = svc as Record<string, unknown>
  const out: JobAddonOption[] = []
  const seen = new Set<string>()

  if (serviceKey === 'homestay') {
    const h = c.homestay
    if (h && typeof h === 'object') {
      parseAddonList((h as Record<string, unknown>).addons, 'homestay', seen, out)
    }
    return out
  }

  const byHour = c.byHour && typeof c.byHour === 'object' ? (c.byHour as Record<string, unknown>) : null
  const byProperty =
    c.byProperty && typeof c.byProperty === 'object' ? (c.byProperty as Record<string, unknown>) : null

  if (byHour) parseAddonList(byHour.addons, 'byHour', seen, out)
  if (byProperty) parseAddonList(byProperty.addons, 'byProperty', seen, out)
  return out
}

export function jobAddonBasisLabel(b: JobAddonBasis): string {
  switch (b) {
    case 'fixed':
      return 'Fix price'
    case 'quantity':
      return 'By quantity'
    case 'bed':
      return 'By number of bed'
    case 'room':
      return 'By number of room'
    default:
      return b
  }
}

export function jobAddonLineTotal(price: number, basis: JobAddonBasis, qty: number): number {
  const q = basis === 'fixed' ? 1 : Math.max(1, Math.floor(Number(qty)) || 1)
  return Math.round(price * q * 100) / 100
}
