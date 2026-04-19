import type { Metadata } from "next"
import { SITE_NAME, SITE_URL } from "@/lib/seo"

const desc =
  "Request a tailored proposal for Coliving Management: operator SaaS, credits, and integrations for your coliving or room-rental portfolio in Malaysia and Singapore."

export const metadata: Metadata = {
  title: "Tailored operator proposal",
  description: desc,
  openGraph: {
    title: `Proposal | ${SITE_NAME}`,
    description: desc,
    url: `${SITE_URL}/proposal`,
  },
  alternates: { canonical: `${SITE_URL}/proposal` },
}

export default function ProposalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
