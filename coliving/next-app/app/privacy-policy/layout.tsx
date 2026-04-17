import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Coliving Management privacy policy. How we collect, use, and protect your personal data. Coliving Management Sdn Bhd.",
  openGraph: {
    title: "Privacy Policy | Coliving Management",
    url: `${SITE_URL}/privacy-policy`,
  },
  alternates: { canonical: `${SITE_URL}/privacy-policy` },
}

export default function PrivacyPolicyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
