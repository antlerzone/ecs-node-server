import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"
import OwnerLayoutClient from "./owner-layout-client"

export const metadata: Metadata = {
  title: "Owner Portal",
  description:
    "Owner portal for Coliving Management. View properties, tenancies, agreements, reports, and payouts.",
  openGraph: {
    title: "Owner Portal | Coliving Management",
    url: `${SITE_URL}/owner`,
  },
  alternates: { canonical: `${SITE_URL}/owner` },
}

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <OwnerLayoutClient>{children}</OwnerLayoutClient>
}
