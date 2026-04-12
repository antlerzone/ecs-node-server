import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Terms and Conditions",
  description:
    "Coliving Management terms and conditions for using the platform, services, and website.",
  openGraph: {
    title: "Terms and Conditions | Coliving Management",
    url: `${SITE_URL}/terms-and-conditions`,
  },
  alternates: { canonical: `${SITE_URL}/terms-and-conditions` },
}

export default function TermsAndConditionsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
