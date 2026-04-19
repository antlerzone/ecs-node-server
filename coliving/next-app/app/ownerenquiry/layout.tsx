import type { Metadata } from "next"
import { SITE_NAME, SITE_URL } from "@/lib/seo"

const desc =
  "Owner enquiry for Coliving Management: list your property, partnership, or management questions — Malaysia & Singapore coliving and room rentals."

export const metadata: Metadata = {
  title: "Owner enquiry — list & partnership",
  description: desc,
  openGraph: {
    title: `Owner enquiry | ${SITE_NAME}`,
    description: desc,
    url: `${SITE_URL}/ownerenquiry`,
  },
  alternates: { canonical: `${SITE_URL}/ownerenquiry` },
}

export default function OwnerEnquiryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
