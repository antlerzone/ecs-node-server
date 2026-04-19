import type { Metadata } from "next"
import { SITE_NAME, SITE_URL } from "@/lib/seo"

const desc =
  "Product tour: Tenant, Owner, Operator, and SaaS Admin flows — coliving & room management SaaS for Malaysia/Singapore: payments, leases, meters, smart access, and billing."

export const metadata: Metadata = {
  title: `Product tour | ${SITE_NAME}`,
  description: desc,
  openGraph: {
    title: `Product tour | ${SITE_NAME}`,
    description: desc,
    url: SITE_URL,
  },
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true },
}

export default function HomedemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
