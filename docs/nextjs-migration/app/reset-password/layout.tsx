import type { Metadata } from "next"
import { SITE_URL } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Set a new password for your Coliving Management account.",
  openGraph: {
    title: "Reset Password | Coliving Management",
    url: `${SITE_URL}/reset-password`,
  },
  alternates: { canonical: `${SITE_URL}/reset-password` },
}

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
