import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Available Units",
  description:
    "Browse available coliving rooms and units in Johor Bahru. View photos, amenities, and pricing. Contact for viewing or booking.",
  openGraph: {
    title: "Available Units | Coliving Management",
    description: "Browse available coliving rooms and units in Johor Bahru.",
    url: `${SITE_URL}/available-unit`,
  },
  alternates: { canonical: `${SITE_URL}/available-unit` },
}

export default function AvailableUnitLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
