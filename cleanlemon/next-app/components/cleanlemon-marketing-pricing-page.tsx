"use client"

import { useMemo } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PRICING_SERVICES, type ServiceKey } from "@/lib/cleanlemon-pricing-services"

/** SaaS pricing / merchant signup (live portal). */
const MERCHANT_PRICING_URL = "https://portal.cleanlemons.com/pricing"

export type PublicMarketingPricing = {
  selectedServices?: string[]
  activeServiceTab?: string
  serviceConfigs?: Record<string, unknown>
  bookingMode?: string
  bookingModeByService?: Record<string, string>
  leadTime?: string
} | null

export type PublicMarketingCompany = {
  displayName?: string
  logoUrl?: string
  contact?: string
  address?: string
}

function serviceLabel(key: string): string {
  return PRICING_SERVICES.find((s) => s.key === key)?.label || key
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function telHref(contact: string): string {
  const digits = contact.replace(/[^\d+]/g, "")
  return digits ? `tel:${digits}` : "#"
}

function linesForService(serviceKey: string, raw: unknown): string[] {
  const cfg = asRecord(raw)
  if (!cfg) return ["No saved configuration for this service."]
  if (serviceKey === "dobi") {
    const lines: string[] = []
    const kgOn = !!cfg.dobiByKgEnabled
    const pcsOn = !!cfg.dobiByPcsEnabled
    const bedOn = !!cfg.dobiByBedEnabled
    lines.push(`Modes: laundry by kg ${kgOn ? "on" : "off"}, by pcs ${pcsOn ? "on" : "off"}, by bed ${bedOn ? "on" : "off"}`)
    const kg = Array.isArray(cfg.dobiByKg) ? cfg.dobiByKg : []
    for (const row of kg) {
      const r = asRecord(row)
      if (!r) continue
      const rate = num(r.rate)
      if (rate > 0) lines.push(`  ${String(r.item || "Item")}: RM${rate}/kg`)
    }
    const pcs = Array.isArray(cfg.dobiByPcs) ? cfg.dobiByPcs : []
    for (const row of pcs) {
      const r = asRecord(row)
      if (!r) continue
      const rate = num(r.rate)
      if (rate > 0) lines.push(`  ${String(r.item || "Item")}: RM${rate}/pc`)
    }
    const bed = num(cfg.dobiByBedPrice)
    if (bedOn && bed > 0) lines.push(`  By bed: RM${bed}`)
    const ironKg = Array.isArray(cfg.ironingByKg) ? cfg.ironingByKg : []
    for (const row of ironKg) {
      const r = asRecord(row)
      if (!r) continue
      const rate = num(r.rate)
      if (rate > 0) lines.push(`  Ironing ${String(r.item || "")}: RM${rate}/kg`)
    }
    const ironPcs = Array.isArray(cfg.ironingByPcs) ? cfg.ironingByPcs : []
    for (const row of ironPcs) {
      const r = asRecord(row)
      if (!r) continue
      const rate = num(r.rate)
      if (rate > 0) lines.push(`  Ironing ${String(r.item || "")}: RM${rate}/pc`)
    }
    return lines.length ? lines : ["Dobi pricing not set."]
  }
  if (serviceKey === "homestay") {
    const h = asRecord(cfg.homestay)
    if (!h) return ["Homestay pricing not set."]
    const lines: string[] = [`Mode: ${String(h.mode || "—")}`]
    const pp = asRecord(h.propertyPrices)
    if (pp) {
      for (const [k, v] of Object.entries(pp)) {
        if (num(v) > 0) lines.push(`  ${k}: RM${num(v)}`)
      }
    }
    const bedP = num(h.bedQtyPrice)
    if (bedP > 0) lines.push(`  Extra bed qty: RM${bedP}`)
    const feats = Array.isArray(h.features) ? h.features.filter(Boolean) : []
    if (feats.length) lines.push(`Includes: ${feats.map(String).join(", ")}`)
    return lines
  }
  const lines: string[] = []
  if (cfg.quotationEnabled) {
    lines.push("Quotation-based: price after site visit (no fixed list price).")
  }
  if (cfg.byHourEnabled) {
    const bh = asRecord(cfg.byHour)
    const price = num(bh?.price)
    const hours = num(bh?.hours) || 1
    const workers = num(bh?.workers) || 1
    const minP = num(bh?.minSellingPrice)
    const total = price * hours * workers
    lines.push(
      `By hour: RM${price} × ${hours}h × ${workers} worker(s) → est. RM${total}${minP > 0 ? ` (min. RM${minP})` : ""}`
    )
    const feats = Array.isArray(bh?.features) ? (bh!.features as unknown[]).filter(Boolean) : []
    if (feats.length) lines.push(`  Includes: ${feats.map(String).join(", ")}`)
    const addons = Array.isArray(bh?.addons) ? bh!.addons : []
    for (const a of addons) {
      const ar = asRecord(a)
      if (!ar || !String(ar.name || "").trim()) continue
      if (num(ar.price) > 0) lines.push(`  Add-on: ${ar.name} — RM${num(ar.price)} (${String(ar.basis || "fixed")})`)
    }
  }
  if (cfg.byPropertyEnabled) {
    const bp = asRecord(cfg.byProperty)
    const prices = bp ? asRecord(bp.prices) : null
    lines.push("By property type:")
    if (prices) {
      let any = false
      for (const [k, v] of Object.entries(prices)) {
        if (num(v) > 0) {
          lines.push(`  ${k}: RM${num(v)}`)
          any = true
        }
      }
      if (!any) lines.push("  (no row prices set)")
    }
    const feats = Array.isArray(bp?.features) ? (bp!.features as unknown[]).filter(Boolean) : []
    if (feats.length) lines.push(`  Includes: ${feats.map(String).join(", ")}`)
  }
  if (!lines.length) return ["No pricing mode enabled for this service."]
  return lines
}

function bookingLines(pricing: PublicMarketingPricing): string[] {
  if (!pricing) return []
  const g = pricing.bookingMode === "instant" ? "Instant booking" : "Request & approve"
  const lt = String(pricing.leadTime || "—").replaceAll("_", " ")
  const out = [`Default: ${g}`, `Lead time: ${lt}`]
  const by = pricing.bookingModeByService
  if (by && typeof by === "object") {
    for (const sk of pricing.selectedServices || []) {
      const m = by[sk]
      if (m === "instant" || m === "request_approve") {
        out.push(`  ${serviceLabel(sk)}: ${m === "instant" ? "Instant" : "Request & approve"}`)
      }
    }
  }
  return out
}

function buildFlyerBullets(
  pricing: PublicMarketingPricing,
  title: string,
  contact?: string,
  address?: string
): string[] {
  const bullets: string[] = [title || "Professional cleaning", ""]
  if (contact) bullets.push(`Tel: ${contact}`, "")
  if (address) bullets.push(address, "")
  bullets.push(...bookingLines(pricing))
  bullets.push("")
  const services = Array.isArray(pricing?.selectedServices) ? pricing!.selectedServices! : []
  const sc = pricing?.serviceConfigs || {}
  for (const key of services) {
    bullets.push(`• ${serviceLabel(key)}`)
    for (const line of linesForService(key, sc[key])) {
      bullets.push(`  ${line}`)
    }
    bullets.push("")
  }
  return bullets.filter((_, i, a) => !(i === a.length - 1 && _ === ""))
}

export function CleanlemonMarketingPricingPage({
  companyName,
  company,
  slug,
  pricing,
  errorReason,
  ctaHref = "/enquiry",
}: {
  companyName: string
  company?: PublicMarketingCompany | null
  slug: string
  pricing: PublicMarketingPricing
  errorReason?: string | null
  /** Override with `NEXT_PUBLIC_CLEANLEMONS_MARKETING_CTA_HREF` from server page. */
  ctaHref?: string
}) {
  const displayTitle = String(company?.displayName || companyName || "").trim() || "Cleaning services"
  const logoUrl = String(company?.logoUrl || "").trim()
  const contact = String(company?.contact || "").trim()
  const address = String(company?.address || "").trim()

  const services = useMemo(() => {
    const sel = Array.isArray(pricing?.selectedServices) ? pricing!.selectedServices! : []
    return sel.filter((k): k is ServiceKey => PRICING_SERVICES.some((s) => s.key === k))
  }, [pricing])

  const flyerText = useMemo(
    () => buildFlyerBullets(pricing, displayTitle, contact || undefined, address || undefined),
    [pricing, displayTitle, contact, address]
  )

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://portal.cleanlemons.com"

  const initial = displayTitle.trim().charAt(0).toUpperCase() || "C"

  if (errorReason === "NOT_CONFIGURED") {
    return (
      <main className="min-h-screen bg-background text-foreground p-6">
        <p className="text-muted-foreground">This page is not available (server not configured).</p>
      </main>
    )
  }

  if (errorReason === "NOT_FOUND") {
    return (
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <main className="flex-1 max-w-lg mx-auto px-4 py-16 text-center space-y-5">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-bold mx-auto">
            CL
          </div>
          <h1 className="text-xl font-semibold">No company at this link</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            There is no cleaning company listed at{" "}
            <span className="font-mono text-foreground">/{slug}</span>. Check the link with the operator, or if you
            manage this business set the same value under <strong>Operator → Company → Subdomain</strong> and save.
          </p>
          <Button asChild variant="default">
            <Link href={ctaHref || "/enquiry"}>Looking for a cleaning company</Link>
          </Button>
        </main>
        <footer className="no-print border-t border-border bg-card py-4 px-4 text-center text-xs text-muted-foreground space-y-2">
          <p>
            Become our merchant —{" "}
            <a
              href={MERCHANT_PRICING_URL}
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              click here
            </a>
          </p>
          <p>
            Powered by{" "}
            <Link href="/" className="font-medium text-foreground underline-offset-2 hover:underline">
              Cleanlemons
            </Link>
          </p>
        </footer>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="cln-marketing-screen flex-1">
        <div className="max-w-3xl mx-auto px-4 pt-6 pb-2 lg:px-8">
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="bg-muted/40 border-b border-border px-4 py-5 sm:px-6 sm:py-6">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="shrink-0 flex justify-center sm:justify-start">
                  {logoUrl ? (
                    <div className="relative h-24 w-24 sm:h-28 sm:w-28 rounded-lg bg-white border border-border overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote OSS URLs */}
                      <img
                        src={logoUrl}
                        alt=""
                        className="h-full w-full object-contain p-1"
                      />
                    </div>
                  ) : (
                    <div
                      className="h-24 w-24 sm:h-28 sm:w-28 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-3xl font-bold border border-border"
                      aria-hidden
                    >
                      {initial}
                    </div>
                  )}
                </div>
                <div className="flex-1 text-center sm:text-left space-y-2 min-w-0">
                  <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight">
                    {displayTitle}
                  </h1>
                  <p className="text-sm text-muted-foreground">Cleaning services &amp; rates</p>
                  {contact ? (
                    <p className="text-base font-medium">
                      <a href={telHref(contact)} className="text-primary underline-offset-2 hover:underline">
                        {contact}
                      </a>
                    </p>
                  ) : null}
                  {address ? (
                    <p className="text-sm text-muted-foreground whitespace-pre-line">{address}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground pt-1">{origin}/{slug}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto p-4 lg:p-8 space-y-6">
          <h2 className="text-lg font-semibold text-foreground">Our services &amp; rates</h2>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Services &amp; booking</CardTitle>
              <CardDescription>How customers book and minimum notice</CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-1 text-muted-foreground">
              {bookingLines(pricing).map((line, i) => (
                <p key={`b-${i}`}>{line}</p>
              ))}
            </CardContent>
          </Card>

          {services.length === 0 ? (
            <p className="text-sm text-muted-foreground">No services published yet.</p>
          ) : (
            services.map((sk) => (
              <Card key={sk}>
                <CardHeader>
                  <CardTitle className="text-lg">{serviceLabel(sk)}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1 text-muted-foreground">
                  {linesForService(sk, pricing?.serviceConfigs?.[sk]).map((line, i) => (
                    <p key={`${sk}-${i}`}>{line}</p>
                  ))}
                </CardContent>
              </Card>
            ))
          )}

          <div className="flex justify-end no-print">
            <Button type="button" variant="secondary" onClick={() => window.print()}>
              Print A5 flyer
            </Button>
          </div>

          <section
            className="no-print rounded-xl border border-border bg-muted/50 px-4 py-6 sm:px-6 text-center space-y-3"
            aria-label="Find another company"
          >
            <h2 className="text-base font-semibold text-foreground">Looking for another company?</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Explore other cleaning partners or send an enquiry on Cleanlemons.
            </p>
            <Button asChild variant="default">
              <Link href={ctaHref || "/enquiry"}>Get in touch</Link>
            </Button>
          </section>
        </div>
      </div>

      <footer className="no-print border-t border-border bg-card py-4 px-4 text-center text-xs text-muted-foreground space-y-2">
        <p>
          Become our merchant —{" "}
          <a
            href={MERCHANT_PRICING_URL}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            click here
          </a>
        </p>
        <p>
          Powered by{" "}
          <Link href="/" className="font-medium text-foreground underline-offset-2 hover:underline">
            Cleanlemons
          </Link>
        </p>
      </footer>

      <div className="cln-marketing-flyer-print-only" aria-hidden="true">
        <div className="flyer-print-header">
          <p className="flyer-print-title">{displayTitle}</p>
          {contact ? <p className="flyer-print-contact">{contact}</p> : null}
          {address ? <p className="flyer-print-address">{address}</p> : null}
          <p className="flyer-print-sub">Rates &amp; booking summary</p>
        </div>
        <div className="flyer-print-body">
          {flyerText.map((line, i) => (
            <p key={`fp-${i}`}>{line}</p>
          ))}
        </div>
        <p className="flyer-print-footer">{origin}/{slug}</p>
        <p className="flyer-print-powered">Powered by Cleanlemons</p>
      </div>
    </div>
  )
}
