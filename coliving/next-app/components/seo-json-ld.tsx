import {
  SITE_URL,
  SITE_NAME,
  DEFAULT_DESCRIPTION,
  SITE_LOGO_URL,
  getSiteSameAs,
} from "@/lib/seo"

/** JSON-LD: Organization, WebSite, SoftwareApplication — rich results & entity clarity. */
export function SeoJsonLd() {
  const sameAs = getSiteSameAs()

  const organization: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    description: DEFAULT_DESCRIPTION,
    logo: {
      "@type": "ImageObject",
      url: SITE_LOGO_URL,
      width: 180,
      height: 180,
    },
  }
  if (sameAs.length > 0) {
    organization.sameAs = sameAs
  }

  const webSite = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    description: DEFAULT_DESCRIPTION,
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/available-unit?keyword={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  }

  const softwareApplication = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description: DEFAULT_DESCRIPTION,
    image: SITE_LOGO_URL,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "MYR",
      lowPrice: "120",
      highPrice: "30000",
      offerCount: 7,
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/pricing`,
    },
    publisher: {
      "@type": "Organization",
      name: "ColivingJB Sdn Bhd",
      url: SITE_URL,
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webSite) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }}
      />
    </>
  )
}
