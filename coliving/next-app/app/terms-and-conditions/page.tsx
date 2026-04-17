"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"

const CONTACT_EMAIL = "colivingmanagement@gmail.com"
const COMPANY = "Coliving Management Sdn Bhd"

export default function TermsAndConditionsPage() {
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
          <Link href="/privacy-policy" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Privacy Policy
          </Link>
          <Link href="/refund-policy" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Refund Policy
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
          <h1 className="text-3xl sm:text-4xl font-black text-foreground leading-tight mb-2">Terms and Conditions</h1>
          <p className="text-sm text-muted-foreground">Last updated: March 2026 · {COMPANY}</p>
        </div>

        <article className="space-y-8 text-foreground">
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">1. Acceptance of terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using the Coliving Management platform and websites (including portal.colivingjb.com), you agree to these terms and conditions. If you do not agree, do not use the platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">2. Platform role</h2>
            <p className="text-muted-foreground leading-relaxed">
              {COMPANY} provides a SaaS platform for property, tenancy, billing, and related operations. We are not a party to tenancy or lease agreements between operators, owners, and tenants.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">3. Account responsibilities</h2>
            <p className="text-muted-foreground leading-relaxed">
              You are responsible for the accuracy of information submitted, the security of your account credentials, and all actions under your account. You must use the platform in compliance with applicable laws.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">4. Fees and payments</h2>
            <p className="text-muted-foreground leading-relaxed">
              Subscription and credit purchases are billed based on the selected package. Billing terms, payment methods, and the no-refund / no-exchange credit policy are described in our{" "}
              <Link href="/refund-policy" className="text-primary font-medium underline hover:no-underline">
                Refund Policy
              </Link>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">5. Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              Your use of the platform is also governed by our{" "}
              <Link href="/privacy-policy" className="text-primary font-medium underline hover:no-underline">
                Privacy Policy
              </Link>, which explains how we collect and process personal data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">6. Service availability</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update, improve, suspend, or discontinue parts of the platform from time to time. We do not guarantee uninterrupted or error-free service at all times.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">7. Limitation of liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              To the extent permitted by law, {COMPANY} is not liable for indirect, incidental, or consequential losses arising from use of the platform. Operator-tenant-owner disputes remain between those parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">8. Changes and contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may revise these terms and conditions from time to time. Continued use of the platform after updates means you accept the revised terms. For questions, contact{" "}
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
          <Link href="/privacy-policy" className="text-sm font-semibold text-primary hover:underline">
            Privacy Policy
          </Link>
          <Link href="/refund-policy" className="text-sm font-semibold text-primary hover:underline">
            Refund Policy
          </Link>
          <a href="https://www.colivingjb.com" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={14} /> Back to Home
          </a>
        </div>
      </main>
    </div>
  )
}
