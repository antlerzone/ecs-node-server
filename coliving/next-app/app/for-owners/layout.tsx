import type { Metadata } from "next"
import { SITE_NAME, SITE_URL } from "@/lib/seo"
import { forOwnersFaqPageJsonLd } from "@/lib/for-owners-faq"

const desc =
  "ColivingJB & Coliving Management: professional coliving and room rental operations for property owners in Malaysia & Singapore. Enquiry, pricing, and passive-income management."

export const metadata: Metadata = {
  title: "For property owners — Malaysia & Singapore coliving",
  description: desc,
  openGraph: {
    title: `For property owners | ${SITE_NAME}`,
    description: desc,
    url: `${SITE_URL}/for-owners`,
  },
  alternates: { canonical: `${SITE_URL}/for-owners` },
}

export default function ForOwnersLayout({ children }: { children: React.ReactNode }) {
  const faqLd = forOwnersFaqPageJsonLd()
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      {children}
    </>
  )
}
