import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "API Docs",
  description:
    "Coliving Management API documentation. Integrate with the operator API for properties, tenancies, and billing.",
  openGraph: {
    title: "API Docs | Coliving Management",
    url: `${SITE_URL}/docs`,
  },
  alternates: { canonical: `${SITE_URL}/docs` },
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
