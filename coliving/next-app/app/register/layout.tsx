import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Register",
  description: "Register for Coliving Management. Create an account to access tenant or operator services.",
  openGraph: {
    title: "Register | Coliving Management",
    url: `${SITE_URL}/register`,
  },
  alternates: { canonical: `${SITE_URL}/register` },
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
