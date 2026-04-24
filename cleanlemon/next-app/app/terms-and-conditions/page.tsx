"use client";

import Link from "next/link";
import { CleanlemonsMarketingLegalHeader } from "@/components/marketing/cleanlemons-marketing-legal-header";
import { CleanlemonsMarketingLegalPageFooter } from "@/components/marketing/cleanlemons-marketing-legal-page-footer";
import {
  CLEANLEMONS_LEGAL_CONTACT_EMAIL,
  CLEANLEMONS_LEGAL_ENTITY,
  CLEANLEMONS_LEGAL_REGISTRATION,
  CLEANLEMONS_MARKETING_LEGAL_LAST_UPDATED,
} from "@/lib/cleanlemons-marketing-legal";

export default function TermsAndConditionsPage() {
  return (
    <div className="min-h-screen bg-background">
      <CleanlemonsMarketingLegalHeader brandLine2="Terms & Conditions" />

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-black text-foreground leading-tight mb-2">Terms and Conditions</h1>
          <p className="text-sm text-muted-foreground">
            Last updated: {CLEANLEMONS_MARKETING_LEGAL_LAST_UPDATED} · {CLEANLEMONS_LEGAL_ENTITY}
          </p>
          <p className="text-sm text-muted-foreground mt-1">{CLEANLEMONS_LEGAL_REGISTRATION}</p>
        </div>

        <article className="space-y-8 text-foreground">
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">1. Acceptance of terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using the Cleanlemons platform and websites (including portal.cleanlemons.com and
              demo.cleanlemons.com), you agree to these terms and conditions. If you do not agree, do not use the
              platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">2. Platform role</h2>
            <p className="text-muted-foreground leading-relaxed">
              {CLEANLEMONS_LEGAL_ENTITY} provides a SaaS platform for cleaning operators — including scheduling, client and
              property records, staff tools, invoicing and related features. We are not a party to agreements between an
              operator and its own clients or third parties for cleaning or other services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">3. Account responsibilities</h2>
            <p className="text-muted-foreground leading-relaxed">
              You are responsible for the accuracy of information submitted, the security of your account credentials, and all
              actions under your account. You must use the platform in compliance with applicable laws in Malaysia.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">4. Fees and payments</h2>
            <p className="text-muted-foreground leading-relaxed">
              Subscription and add-on fees are billed in MYR as shown on our{" "}
              <Link href="/pricing" className="text-primary font-medium underline hover:no-underline">
                pricing page
              </Link>
              . Payment processing may be handled by third-party providers (for example Stripe). Refund and billing-error
              rules are described in our{" "}
              <Link href="/refund-policy" className="text-primary font-medium underline hover:no-underline">
                Refund Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">5. Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              Your use of the platform is also governed by our{" "}
              <Link href="/privacy-policy" className="text-primary font-medium underline hover:no-underline">
                Privacy Policy
              </Link>
              , which explains how we collect and process personal data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">6. Service availability</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update, improve, suspend, or discontinue parts of the platform from time to time. We do not guarantee
              uninterrupted or error-free service at all times.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">7. Limitation of liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              To the extent permitted by law, {CLEANLEMONS_LEGAL_ENTITY} is not liable for indirect, incidental, or
              consequential losses arising from use of the platform. Disputes between operators and their clients remain
              between those parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">8. Changes and contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may revise these terms from time to time. Continued use after updates means you accept the revised terms.
              For questions, contact{" "}
              <a
                href={`mailto:${CLEANLEMONS_LEGAL_CONTACT_EMAIL}`}
                className="text-primary font-medium underline hover:no-underline"
              >
                {CLEANLEMONS_LEGAL_CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </article>

        <CleanlemonsMarketingLegalPageFooter />
      </main>
    </div>
  );
}
