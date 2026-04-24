"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CLEANLEMONS_PUBLIC_PORTAL_URL } from "@/lib/cleanlemons-marketing-legal";

/** Bottom inline nav on marketing legal pages (matches Coliving policy footers). */
export function CleanlemonsMarketingLegalPageFooter() {
  return (
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
      <Link href="/terms-and-conditions" className="text-sm font-semibold text-primary hover:underline">
        Terms & Conditions
      </Link>
      <a
        href={CLEANLEMONS_PUBLIC_PORTAL_URL}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} /> Back to Portal
      </a>
    </div>
  );
}
