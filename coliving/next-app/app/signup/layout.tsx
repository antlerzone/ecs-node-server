import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Create your Coliving Management account. Register as tenant or sign up for operator portal.",
  openGraph: {
    title: "Sign Up | Coliving Management",
    url: `${SITE_URL}/signup`,
  },
  alternates: { canonical: `${SITE_URL}/signup` },
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
