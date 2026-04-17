import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Owner Tutorial",
  description:
    "Owner portal tutorial for Coliving Management. How to manage your property, agreements, reports, and payouts.",
  openGraph: {
    title: "Owner Tutorial | Coliving Management",
    url: `${SITE_URL}/ownertutorial`,
  },
  alternates: { canonical: `${SITE_URL}/ownertutorial` },
}

export default function OwnerTutorialLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
