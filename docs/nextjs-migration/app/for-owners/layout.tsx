import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "For Property Owners",
  description:
    "Professional coliving management for property owners in Malaysia and Singapore. Passive income without constant headaches.",
  openGraph: {
    title: "For Property Owners | Coliving Management",
    url: `${SITE_URL}/for-owners`,
  },
  alternates: { canonical: `${SITE_URL}/for-owners` },
}

export default function ForOwnersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
