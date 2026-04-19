/** Visible FAQ on /for-owners — must match FAQPage JSON-LD in `app/for-owners/layout.tsx`. */
export const FOR_OWNERS_FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Who is the Coliving Management platform for?",
    answer:
      "Coliving and room-by-room rental operators, and property owners, in Malaysia and Singapore who want tenant and owner portals, automated billing, agreements, and smart access in one system.",
  },
  {
    question: "How do I get a proposal or speak to your team?",
    answer:
      "Use the Enquiry page on this site to describe your property or portfolio. Our team typically responds within one business day with next steps.",
  },
  {
    question: "Do you only serve Johor Bahru?",
    answer:
      "We focus on Malaysia and Singapore. Operators use the platform across the region; on-site services such as smart hardware installation depend on location—details are shown on Pricing and enquiry flows.",
  },
  {
    question: "What is the relationship between ColivingJB and Coliving Management?",
    answer:
      "ColivingJB Sdn Bhd offers the Coliving Management SaaS product—the tenant, owner, and operator portals, billing, and integrations described on www.colivingjb.com.",
  },
  {
    question: "Where can I see operator pricing and credits?",
    answer:
      "Open the Pricing page for plans in MYR and SGD, flex credits, usage (e.g. per room per month), and add-ons such as extra users or smart devices.",
  },
]

export function forOwnersFaqPageJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FOR_OWNERS_FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  }
}
