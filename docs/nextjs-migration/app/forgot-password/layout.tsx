import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Forgot Password",
  description: "Reset your Coliving Management password. Enter your email to receive a reset link.",
  openGraph: {
    title: "Forgot Password | Coliving Management",
    url: `${SITE_URL}/forgot-password`,
  },
  alternates: { canonical: `${SITE_URL}/forgot-password` },
}

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
