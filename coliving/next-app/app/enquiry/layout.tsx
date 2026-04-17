import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Enquiry",
  description:
    "Contact Coliving Management. Send an enquiry about available units, pricing, or operator plans in Johor Bahru.",
  openGraph: {
    title: "Enquiry | Coliving Management",
    url: `${SITE_URL}/enquiry`,
  },
  alternates: { canonical: `${SITE_URL}/enquiry` },
}

export default function EnquiryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
