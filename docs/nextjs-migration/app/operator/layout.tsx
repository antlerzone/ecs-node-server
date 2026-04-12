import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"
import OperatorLayoutClient from "./operator-layout-client"

export const metadata: Metadata = {
  title: "Operator Portal",
  description:
    "Operator dashboard for Coliving Management. Manage properties, tenancies, billing, agreements, and tenants.",
  openGraph: {
    title: "Operator Portal | Coliving Management",
    url: `${SITE_URL}/operator`,
  },
  alternates: { canonical: `${SITE_URL}/operator` },
}

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return <OperatorLayoutClient>{children}</OperatorLayoutClient>
}
