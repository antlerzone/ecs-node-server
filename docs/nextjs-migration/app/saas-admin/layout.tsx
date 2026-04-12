import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"
import SaasAdminLayoutClient from "./saas-admin-layout-client"

export const metadata: Metadata = {
  title: "SaaS Admin",
  description:
    "SaaS admin dashboard for Coliving Management. Manage clients, credits, pricing plans, and API access.",
  openGraph: {
    title: "SaaS Admin | Coliving Management",
    url: `${SITE_URL}/saas-admin`,
  },
  alternates: { canonical: `${SITE_URL}/saas-admin` },
}

export default function SaasAdminLayout({ children }: { children: React.ReactNode }) {
  return <SaasAdminLayoutClient>{children}</SaasAdminLayoutClient>
}
