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

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <CleanlemonsMarketingLegalHeader brandLine2="Privacy Policy" />

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-black text-foreground leading-tight mb-2">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">
            Last updated: {CLEANLEMONS_MARKETING_LEGAL_LAST_UPDATED} · {CLEANLEMONS_LEGAL_ENTITY}
          </p>
          <p className="text-sm text-muted-foreground mt-1">{CLEANLEMONS_LEGAL_REGISTRATION}</p>
        </div>

        <article className="space-y-8 text-foreground">
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">1. Who we are</h2>
            <p className="text-muted-foreground leading-relaxed">
              This privacy policy applies to the Cleanlemons platform and related websites (including{" "}
              <strong className="text-foreground">portal.cleanlemons.com</strong> and{" "}
              <strong className="text-foreground">demo.cleanlemons.com</strong>) operated by{" "}
              <strong className="text-foreground">{CLEANLEMONS_LEGAL_ENTITY}</strong>. We provide a SaaS (software-as-a-service)
              platform for cleaning operators in <strong className="text-foreground">Malaysia</strong> — including client and
              property records, scheduling and jobs, staff attendance, invoicing and payment tracking, integrations (for
              example accounting and cloud file storage), and related features.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">2. Information we collect</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              We collect information that you provide when using our platform or contacting us, including:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
              <li>Name, email address, phone number, and business or property addresses</li>
              <li>Account and profile data for operators, staff, supervisors, and client portal users</li>
              <li>Operational data you enter (jobs, schedules, pricing, invoices, documents, photos, and similar)</li>
              <li>Bank or payment details where needed for payouts or billing</li>
              <li>Login credentials and, if you choose, sign-in via third-party identity providers (for example Google)</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              We also collect technical and usage data (such as device and browser information, IP address, and how you use
              our sites) for security, troubleshooting, and improving our services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">3. How we use your information</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use the information we collect to provide and operate the platform (accounts, scheduling, invoicing,
              reporting, integrations you enable), to communicate with you, to process subscription payments (including via
              Stripe where applicable), to comply with legal obligations, and to improve our services and security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">4. Cookies and similar technologies</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use cookies and similar technologies where needed for sign-in, session security, preferences, and
              measurement of site usage. You can control or disable cookies through your browser settings; disabling
              certain cookies may affect how the site works.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">5. Sharing and third parties</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may share your information with service providers that help us run the platform (for example cloud hosting,
              payment processing, email delivery, analytics, and accounting integrations such as Bukku or Xero when you
              connect them). We do not sell your personal data to third parties for their marketing. We may disclose
              information where required by law or to protect our rights and safety.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">6. Data retention and security</h2>
            <p className="text-muted-foreground leading-relaxed">
              We retain your information for as long as needed to provide the service, resolve disputes, and comply with
              legal obligations. We take reasonable steps to protect your data; transmission over the internet is not
              completely secure and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">7. Your rights</h2>
            <p className="text-muted-foreground leading-relaxed">
              Depending on applicable law, you may have rights to access, correct, or delete your personal data, or to
              object to or restrict certain processing. To exercise these rights or ask questions about your data, contact
              us at{" "}
              <a
                href={`mailto:${CLEANLEMONS_LEGAL_CONTACT_EMAIL}`}
                className="text-primary font-medium underline hover:no-underline"
              >
                {CLEANLEMONS_LEGAL_CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">8. Platform role and disclaimer</h2>
            <p className="text-muted-foreground leading-relaxed">
              <strong className="text-foreground">{CLEANLEMONS_LEGAL_ENTITY}</strong> operates a{" "}
              <strong className="text-foreground">SaaS platform only</strong>. We provide software and related services to
              operators and their teams. We are <strong className="text-foreground">not a party</strong> to commercial or
              service relationships between an operator and its clients, tenants, or third parties (including cleaning
              outcomes, fees charged by the operator to its clients, or disputes over those arrangements). We do{" "}
              <strong className="text-foreground">not</strong> provide legal advice in respect of those relationships.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              Payments collected by an operator from its own clients are subject to the operator’s own terms. Our{" "}
              <Link href="/refund-policy" className="text-primary font-medium underline hover:no-underline">
                Refund Policy
              </Link>{" "}
              applies to purchases made <strong className="text-foreground">from us</strong> (for example SaaS subscription
              and add-on module fees billed by us), not to payments between an operator and its clients.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">9. Changes and contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this privacy policy from time to time. The “Last updated” line at the top will be revised when
              we do. Continued use of the platform after changes constitutes acceptance of the updated policy. For
              privacy-related questions or complaints, contact{" "}
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
