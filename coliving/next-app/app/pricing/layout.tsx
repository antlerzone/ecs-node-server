import type { Metadata } from "next"
import { SITE_NAME, SITE_URL } from "@/lib/seo"

const desc =
  "Coliving & room management SaaS pricing for operators: MYR/SGD plans (Starter through Enterprise Plus), flex credits, per-room usage, and add-ons — Malaysia & Singapore."

export const metadata: Metadata = {
  title: "Operator pricing — MYR & SGD plans",
  description: desc,
  openGraph: {
    title: `Pricing | ${SITE_NAME}`,
    description: desc,
    url: `${SITE_URL}/pricing`,
  },
  alternates: { canonical: `${SITE_URL}/pricing` },
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
