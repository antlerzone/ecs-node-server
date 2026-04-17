import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Tutorial",
  description:
    "Step-by-step tutorial for Coliving Management: operator, owner, and tenant guides. Learn how to use the portal.",
  openGraph: {
    title: "Tutorial | Coliving Management",
    description: "Step-by-step guides for operators, owners, and tenants.",
    url: `${SITE_URL}/tutorial`,
  },
  alternates: { canonical: `${SITE_URL}/tutorial` },
}

export default function TutorialLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
