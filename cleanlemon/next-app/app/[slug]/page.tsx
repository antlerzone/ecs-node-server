/**
 * Single dynamic route for every operator's public price list:
 * `portal.cleanlemons.com/{subdomain}` — same layout for all; data from public API by slug.
 */
import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { getCleanlemonApiBaseForMarketingSsr } from "@/lib/portal-auth-mock"
import { isReservedPublicSubdomain } from "@/lib/cleanlemon-public-subdomain-reserved"
import {
  CleanlemonMarketingPricingPage,
  type PublicMarketingCompany,
  type PublicMarketingPricing,
} from "@/components/cleanlemon-marketing-pricing-page"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ slug: string }> }

const defaultCtaHref =
  (process.env.NEXT_PUBLIC_CLEANLEMONS_MARKETING_CTA_HREF || "/enquiry").trim() || "/enquiry"

export default async function CleanlemonPublicMarketingPage({ params }: PageProps) {
  const { slug: rawSlug } = await params
  const slug = decodeURIComponent(String(rawSlug || ""))
    .trim()
    .toLowerCase()

  if (!slug || isReservedPublicSubdomain(slug)) {
    notFound()
  }

  const h = await headers()
  const host = h.get("x-forwarded-host") || h.get("host")
  const base = getCleanlemonApiBaseForMarketingSsr(host)

  if (!base) {
    return (
      <CleanlemonMarketingPricingPage
        companyName=""
        company={null}
        slug={slug}
        pricing={null}
        errorReason="NOT_CONFIGURED"
        ctaHref={defaultCtaHref}
      />
    )
  }

  const url = `${base}/api/public/cleanlemons-operator-pricing/${encodeURIComponent(slug)}`
  let res: Response
  try {
    res = await fetch(url, { cache: "no-store" })
  } catch {
    return (
      <CleanlemonMarketingPricingPage
        companyName=""
        company={null}
        slug={slug}
        pricing={null}
        errorReason="NOT_CONFIGURED"
        ctaHref={defaultCtaHref}
      />
    )
  }

  let data: {
    ok?: boolean
    companyName?: string
    company?: PublicMarketingCompany | null
    pricing?: unknown
    reason?: string
  } = {}
  try {
    data = await res.json()
  } catch {
    return (
      <CleanlemonMarketingPricingPage
        companyName=""
        company={null}
        slug={slug}
        pricing={null}
        errorReason="NOT_FOUND"
        ctaHref={defaultCtaHref}
      />
    )
  }

  if (!res.ok) {
    if (res.status === 503 && data?.reason === "NOT_CONFIGURED") {
      return (
        <CleanlemonMarketingPricingPage
          companyName=""
          company={null}
          slug={slug}
          pricing={null}
          errorReason="NOT_CONFIGURED"
          ctaHref={defaultCtaHref}
        />
      )
    }
    return (
      <CleanlemonMarketingPricingPage
        companyName=""
        company={null}
        slug={slug}
        pricing={null}
        errorReason="NOT_FOUND"
        ctaHref={defaultCtaHref}
      />
    )
  }

  if (!data.ok) {
    return (
      <CleanlemonMarketingPricingPage
        companyName=""
        company={null}
        slug={slug}
        pricing={null}
        errorReason="NOT_FOUND"
        ctaHref={defaultCtaHref}
      />
    )
  }

  return (
    <CleanlemonMarketingPricingPage
      companyName={String(data.companyName || "")}
      company={(data.company as PublicMarketingCompany) ?? null}
      slug={slug}
      pricing={(data.pricing as PublicMarketingPricing) || null}
      errorReason={null}
      ctaHref={defaultCtaHref}
    />
  )
}
