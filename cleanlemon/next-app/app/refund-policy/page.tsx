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

export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <CleanlemonsMarketingLegalHeader brandLine2="Refund Policy" />

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-black text-foreground leading-tight mb-2">Refund Policy</h1>
          <p className="text-sm text-muted-foreground">
            Last updated: {CLEANLEMONS_MARKETING_LEGAL_LAST_UPDATED} · {CLEANLEMONS_LEGAL_ENTITY}
          </p>
          <p className="text-sm text-muted-foreground mt-1">{CLEANLEMONS_LEGAL_REGISTRATION}</p>
        </div>

        <article className="space-y-8 text-foreground">
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">Scope of this policy</h2>
            <p className="text-muted-foreground leading-relaxed">
              This Refund Policy applies to purchases made <strong className="text-foreground">from {CLEANLEMONS_LEGAL_ENTITY}</strong>{" "}
              through the Cleanlemons platform — for example <strong className="text-foreground">SaaS subscription</strong> fees
              (Starter, Growth, Enterprise and other plans we offer) and <strong className="text-foreground">optional add-on</strong>{" "}
              module fees that we bill directly as part of your Cleanlemons subscription or checkout flow.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              <strong className="text-foreground">Payments between an operator and its own clients</strong> (for example
              cleaning fees, deposits, or other charges you collect outside of our SaaS subscription) are{" "}
              <strong className="text-foreground">not</strong> covered by this policy. Refunds and disputes for those
              payments are governed by the <strong className="text-foreground">operator’s own terms</strong> and agreements
              with its clients. We are not a party to those transactions.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              Cleanlemons SaaS plans are billed in <strong className="text-foreground">MYR</strong> as described on our{" "}
              <Link href="/pricing" className="text-primary font-medium underline hover:no-underline">
                pricing page
              </Link>
              . The platform does <strong className="text-foreground">not</strong> use a prepaid “credits” wallet for
              subscriptions; this policy focuses on subscription and related fees we charge operators.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">Subscription and add-on fees</h2>
            <p className="text-muted-foreground leading-relaxed">
              Unless we expressly offer a trial or promotional term in writing at checkout, fees for your selected billing
              period (monthly, quarterly, or yearly) and for any optional add-on modules purchased from us are generally{" "}
              <strong className="text-foreground">non-refundable</strong> once the charge has successfully completed. This
              reflects the immediate delivery of software access for the purchased period.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">Billing errors and chargebacks</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you believe you were charged in error (for example duplicate charge or wrong plan amount), contact us
              promptly at{" "}
              <a
                href={`mailto:${CLEANLEMONS_LEGAL_CONTACT_EMAIL}`}
                className="text-primary font-medium underline hover:no-underline"
              >
                {CLEANLEMONS_LEGAL_CONTACT_EMAIL}
              </a>{" "}
              with your account email and transaction details. We will review in good faith. Nothing in this policy limits
              any non-waivable rights you may have under applicable consumer law in Malaysia.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              Questions about this refund policy:{" "}
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
