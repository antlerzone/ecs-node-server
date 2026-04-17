import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "Coliving Management refund policy. Terms and conditions for refunds and cancellations.",
  openGraph: {
    title: "Refund Policy | Coliving Management",
    url: `${SITE_URL}/refund-policy`,
  },
  alternates: { canonical: `${SITE_URL}/refund-policy` },
}

export default function RefundPolicyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
