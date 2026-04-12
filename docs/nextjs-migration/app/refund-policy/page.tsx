"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"

const CONTACT_EMAIL = "colivingmanagement@gmail.com"
const COMPANY = "Coliving Management Sdn Bhd"

export default function RefundPolicyPage() {
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
            Refund Policy
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated: March 2026 · {COMPANY}
          </p>
        </div>

        <article className="space-y-8 text-foreground">
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">Scope of this policy</h2>
            <p className="text-muted-foreground leading-relaxed">
              This Refund Policy applies only to purchases made <strong className="text-foreground">from {COMPANY}</strong> — i.e. subscription plans, credit plans, and credit top-ups (including Flex credits and related packages) that you buy through the Coliving Management platform.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              <strong className="text-foreground">Payments from tenants to operators</strong> (e.g. rent, utilities, or other charges) are <strong className="text-foreground">not</strong> covered by this policy. Refunds and disputes for those payments are governed by the <strong className="text-foreground">operator’s own terms</strong>, tenancy agreement, or refund policy. We are not a party to those transactions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">Credit plan and top-up</h2>
            <p className="text-muted-foreground leading-relaxed">
              The following rules apply to <strong className="text-foreground">credit plans</strong> and <strong className="text-foreground">credit top-ups</strong> purchased from us through the Coliving Management platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">No refunds</h2>
            <p className="text-muted-foreground leading-relaxed">
              All purchases of credit plans and credit top-ups are <strong className="text-foreground">final</strong>. We do <strong className="text-foreground">not</strong> provide refunds for any credit plan or top-up once the purchase has been completed, regardless of whether the credits have been used.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">No exchanges</h2>
            <p className="text-muted-foreground leading-relaxed">
              Credit plans and top-ups <strong className="text-foreground">cannot be exchanged</strong> for another plan, for cash, or for any other product or service. By completing a purchase, you agree to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you have questions about this refund policy, you may contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary font-medium underline hover:no-underline">
                {CONTACT_EMAIL}
              </a>. This policy applies to services offered in Malaysia and Singapore.
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
