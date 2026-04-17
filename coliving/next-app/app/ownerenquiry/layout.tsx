import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Owner Enquiry",
  description:
    "Owner enquiry form for Coliving Management. Get in touch about listing your property or partnership.",
  openGraph: {
    title: "Owner Enquiry | Coliving Management",
    url: `${SITE_URL}/ownerenquiry`,
  },
  alternates: { canonical: `${SITE_URL}/ownerenquiry` },
}

export default function OwnerEnquiryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
