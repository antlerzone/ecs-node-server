"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"

const CONTACT_EMAIL = "colivingmanagement@gmail.com"
const COMPANY = "Coliving Management Sdn Bhd"

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-lg font-bold tracking-widest text-primary uppercase">Coliving</span>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/pricing" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Pricing
          </Link>
          <Link href="/refund-policy" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Refund Policy
          </Link>
          <Link href="/terms-and-conditions" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Terms & Conditions
          </Link>
          <Link href="/enquiry" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Enquiry
          </Link>
          <a href="https://www.colivingjb.com" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={14} /> Back to Home
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-black text-foreground leading-tight mb-2">
            Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated: March 2026 · {COMPANY}
          </p>
        </div>

        <article className="space-y-8 text-foreground">
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">1. Who we are</h2>
            <p className="text-muted-foreground leading-relaxed">
              This privacy policy applies to the Coliving Management platform and related websites (including portal.colivingjb.com) operated by <strong className="text-foreground">{COMPANY}</strong>. We provide a SaaS (software-as-a-service) platform for property and tenancy management. Our services are used in <strong className="text-foreground">Malaysia</strong> and <strong className="text-foreground">Singapore</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">2. Information we collect</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              We collect information that you provide when using our platform or contacting us, including:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
              <li>Name, email address, phone number, and address</li>
              <li>Identity document details (e.g. NRIC) where required for tenancy or operator use</li>
              <li>Bank or payment details for payouts and payment processing</li>
              <li>Profile and account data for tenants, owners, and operators (staff)</li>
              <li>Login credentials (email and password) and, if you choose, sign-in via Google or Facebook</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              We also collect technical and usage data (e.g. device and browser information, IP address, and how you use our sites) for security, analytics, and improving our services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">3. How we use your information</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use the information we collect to provide and operate the platform (e.g. accounts, tenancy management, agreements, smart door and meter features, payments), to communicate with you, to process payments (including via Stripe and Xendit), to comply with legal obligations, and to improve our services and security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">4. Cookies and tracking</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              We use cookies and similar technologies on our websites. In particular:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
              <li><strong className="text-foreground">Google Analytics</strong> — to understand how visitors use our sites (e.g. pages visited, traffic). Google may collect and process data as described in Google’s privacy policy.</li>
              <li><strong className="text-foreground">Facebook Pixel</strong> — to measure and optimise advertising and to build audiences for marketing. Facebook may collect and process data as described in Meta’s data policy.</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              You can control or disable cookies through your browser settings. Disabling certain cookies may affect how the site works or how we measure usage.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">5. Sharing and third parties</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may share your information with service providers that help us run the platform (e.g. cloud hosting, payment processing, analytics). These include Stripe and Xendit (payments), cloud storage (e.g. for documents and uploads), and providers for smart door and meter integrations. We do not sell your personal data to third parties for their marketing. We may disclose information where required by law or to protect our rights and safety.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">6. Data retention and security</h2>
            <p className="text-muted-foreground leading-relaxed">
              We retain your information for as long as needed to provide the service, resolve disputes, and comply with legal obligations. We take reasonable steps to protect your data; transmission over the internet is not completely secure and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">7. Your rights</h2>
            <p className="text-muted-foreground leading-relaxed">
              Depending on where you are (e.g. Malaysia, Singapore), you may have rights to access, correct, or delete your personal data, or to object to or restrict certain processing. To exercise these rights or ask questions about your data, contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary font-medium underline hover:no-underline">
                {CONTACT_EMAIL}
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">8. Platform role and disclaimer</h2>
            <p className="text-muted-foreground leading-relaxed">
              <strong className="text-foreground">{COMPANY}</strong> operates a <strong className="text-foreground">SaaS platform only</strong>. We provide software and related services to operators, owners, and tenants. We are <strong className="text-foreground">not a party</strong> to any tenancy, lease, or other legal relationship between operators and tenants or between operators and owners. All such relationships and any disputes (including over rent, deposits, agreements, or other obligations) are solely between the operator and the tenant or owner. We do <strong className="text-foreground">not</strong> provide legal advice, protection, or compensation in respect of those relationships or disputes.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              Payments made by tenants to operators (e.g. rent or utilities) are subject to the operator’s own terms and refund policy. Our <Link href="/refund-policy" className="text-primary font-medium underline hover:no-underline">Refund Policy</Link> applies only to purchases made from us (e.g. subscription and credit top-ups), not to tenant–operator payments.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">9. Changes and contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this privacy policy from time to time. The “Last updated” date at the top will be revised when we do. Continued use of the platform after changes constitutes acceptance of the updated policy. For any privacy-related questions or complaints, please contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary font-medium underline hover:no-underline">
                {CONTACT_EMAIL}
              </a>.
            </p>
          </section>
        </article>

        <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-4">
          <Link href="/pricing" className="text-sm font-semibold text-primary hover:underline">
            Pricing
          </Link>
          <Link href="/refund-policy" className="text-sm font-semibold text-primary hover:underline">
            Refund Policy
          </Link>
          <Link href="/terms-and-conditions" className="text-sm font-semibold text-primary hover:underline">
            Terms & Conditions
          </Link>
          <a href="https://www.colivingjb.com" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={14} /> Back to Home
          </a>
        </div>
      </main>
    </div>
  )
}
