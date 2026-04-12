import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your Coliving Management tenant, owner, or operator account.",
  openGraph: {
    title: "Sign In | Coliving Management",
    url: `${SITE_URL}/login`,
  },
  alternates: { canonical: `${SITE_URL}/login` },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
