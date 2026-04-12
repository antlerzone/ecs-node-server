import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"
import TenantLayoutClient from "./tenant-layout-client"

export const metadata: Metadata = {
  title: "Tenant Portal",
  description:
    "Tenant dashboard for Coliving Management. Manage your room, payments, meter, smart door, and agreements.",
  openGraph: {
    title: "Tenant Portal | Coliving Management",
    url: `${SITE_URL}/tenant`,
  },
  alternates: { canonical: `${SITE_URL}/tenant` },
}

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return <TenantLayoutClient>{children}</TenantLayoutClient>
}
