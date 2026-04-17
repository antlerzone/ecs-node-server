import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Portal",
  description:
    "Choose your portal: Tenant, Owner, Operator, or SaaS Admin. Sign in to manage your coliving account.",
  openGraph: {
    title: "Portal | Coliving Management",
    description: "Tenant, Owner, and Operator portals for coliving management.",
    url: `${SITE_URL}/portal`,
  },
  alternates: { canonical: `${SITE_URL}/portal` },
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
