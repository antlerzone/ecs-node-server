"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CLEANLEMONS_PUBLIC_PORTAL_URL } from "@/lib/cleanlemons-marketing-legal";

export type CleanlemonsMarketingLegalHeaderProps = {
  /** Second line under the Cleanlemons wordmark, e.g. "Pricing" or "Privacy Policy". */
  brandLine2: string;
  /** Optional e.g. "Malaysia Only · MYR" on `/pricing`. */
  badge?: ReactNode;
};

function policyLinkClass() {
  return "text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors";
}

function sheetNavItemClass(isButton?: boolean) {
  return cn(
    "w-full rounded-xl px-3 py-3.5 text-sm font-semibold tracking-widest uppercase transition-colors",
    "text-foreground hover:bg-muted/70 active:bg-muted/90",
    isButton && "text-left"
  );
}

export function CleanlemonsMarketingLegalHeader({
  brandLine2,
  badge,
}: CleanlemonsMarketingLegalHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const linkClass = policyLinkClass();

  const NavLinks = ({ vertical }: { vertical?: boolean }) => (
    <>
      <Link
        href="/pricing"
        className={vertical ? cn(sheetNavItemClass(), "block") : linkClass}
        onClick={() => setMenuOpen(false)}
      >
        Pricing
      </Link>
      <Link
        href="/privacy-policy"
        className={vertical ? cn(sheetNavItemClass(), "block") : linkClass}
        onClick={() => setMenuOpen(false)}
      >
        Privacy Policy
      </Link>
      <Link
        href="/refund-policy"
        className={vertical ? cn(sheetNavItemClass(), "block") : linkClass}
        onClick={() => setMenuOpen(false)}
      >
        Refund Policy
      </Link>
      <Link
        href="/terms-and-conditions"
        className={vertical ? cn(sheetNavItemClass(), "block") : linkClass}
        onClick={() => setMenuOpen(false)}
      >
        Terms & Conditions
      </Link>
      <Link
        href="/enquiry"
        className={vertical ? cn(sheetNavItemClass(), "block") : linkClass}
        onClick={() => setMenuOpen(false)}
      >
        Enquiry
      </Link>
      <a
        href={CLEANLEMONS_PUBLIC_PORTAL_URL}
        className={
          vertical
            ? cn(
                "mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              )
            : "inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        }
        onClick={() => setMenuOpen(false)}
      >
        <ArrowLeft size={vertical ? 16 : 14} className={cn("shrink-0", vertical && "opacity-70")} />
        Back to Portal
      </a>
    </>
  );

  return (
    <header className="border-b border-border bg-card px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
      <div className="flex flex-col leading-tight shrink-0 min-w-0">
        <span className="text-lg font-bold tracking-widest text-primary uppercase">Cleanlemons</span>
        <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">{brandLine2}</span>
      </div>

      <div className="hidden md:flex items-center gap-4 flex-wrap justify-end min-w-0">
        {badge}
        <NavLinks />
      </div>

      <div className="flex md:hidden items-center shrink-0 gap-2">
        {badge ? (
          <span className="text-[10px] font-semibold tracking-widest uppercase text-primary whitespace-nowrap max-w-[9rem] truncate">
            {badge}
          </span>
        ) : null}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="p-2 -mr-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-[22px] w-[22px]" strokeWidth={2} />
            </button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[min(100vw-1.5rem,18.5rem)] border-l border-border/80 bg-card p-0 gap-0 sm:max-w-[18.5rem]"
          >
            <div className="border-b border-border/70 px-5 pb-4 pt-2">
              <div className="flex flex-col leading-tight mb-3">
                <span className="text-[10px] tracking-[0.28em] text-muted-foreground uppercase">Cleanlemons</span>
                <span className="text-xs font-bold tracking-widest uppercase text-primary">{brandLine2}</span>
              </div>
            </div>
            <nav className="flex flex-col gap-0.5 p-2 pb-6">
              <NavLinks vertical />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
