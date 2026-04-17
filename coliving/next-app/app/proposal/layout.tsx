import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Proposal",
  description:
    "Request a proposal for Coliving Management operator plans. Get a tailored quote for your property portfolio.",
  openGraph: {
    title: "Proposal | Coliving Management",
    url: `${SITE_URL}/proposal`,
  },
  alternates: { canonical: `${SITE_URL}/proposal` },
}

export default function ProposalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
