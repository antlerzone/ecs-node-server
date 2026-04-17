import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Coliving management pricing plans for operators in Johor Bahru. Starter to Enterprise plans with flexible credits and add-ons.",
  openGraph: {
    title: "Pricing | Coliving Management",
    description:
      "Coliving management pricing plans for operators in Johor Bahru. Starter to Enterprise plans.",
    url: `${SITE_URL}/pricing`,
  },
  alternates: { canonical: `${SITE_URL}/pricing` },
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
