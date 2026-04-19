import type { Metadata } from "next"
import { SITE_NAME, SITE_URL } from "@/lib/seo"

const desc =
  "B2B enquiry for Coliving Management: operator SaaS plans, credits, and onboarding for coliving & room rental in Malaysia and Singapore. No obligation — our team replies quickly."

export const metadata: Metadata = {
  title: "Operator & SaaS enquiry — Malaysia & Singapore",
  description: desc,
  openGraph: {
    title: `Operator enquiry | ${SITE_NAME}`,
    description: desc,
    url: `${SITE_URL}/enquiry`,
  },
  alternates: { canonical: `${SITE_URL}/enquiry` },
}

export default function EnquiryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
