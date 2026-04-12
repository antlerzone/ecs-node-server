import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/seo"

export const metadata: Metadata = {
  title: `Product tour | ${SITE_NAME}`,
  description:
    "Scroll through Tenant, Owner, Operator, SaaS Admin, and API capabilities — coliving room management with payments, leases, meters, and smart access.",
  robots: { index: true, follow: true },
}

export default function HomedemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
