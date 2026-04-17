"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft, Menu } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const HOME_EXTERNAL = "https://www.colivingjb.com"

export type PricingPageHeaderProps = {
  /** Optional label e.g. Pricing · MYR (desktop + inside mobile sheet) */
  badge?: ReactNode
  showChangeRegion?: boolean
  onChangeRegion?: () => void
}

function policyLinkClass() {
  return "text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
}

/** Mobile sheet rows — align with MarketingNavbar mobile (`text-sm` / full-width tap) */
function sheetNavItemClass(isButton?: boolean) {
  return cn(
    "w-full rounded-xl px-3 py-3.5 text-sm font-semibold tracking-widest uppercase transition-colors",
    "text-foreground hover:bg-muted/70 active:bg-muted/90",
    isButton && "text-left"
  )
}

export function PricingPageHeader({ badge, showChangeRegion, onChangeRegion }: PricingPageHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  const linkClass = policyLinkClass()

  const NavLinks = ({ vertical }: { vertical?: boolean }) => (
    <>
      {showChangeRegion && onChangeRegion && (
        <button
          type="button"
          onClick={() => {
            onChangeRegion()
            setMenuOpen(false)
          }}
          className={vertical ? sheetNavItemClass(true) : linkClass}
        >
          Change region
        </button>
      )}
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
      <Link href="/enquiry" className={vertical ? cn(sheetNavItemClass(), "block") : linkClass} onClick={() => setMenuOpen(false)}>
        Enquiry
      </Link>
      <a
        href={HOME_EXTERNAL}
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
        Back to Home
      </a>
    </>
  )

  return (
    <header className="border-b border-border bg-card px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
      <div className="flex flex-col leading-tight shrink-0 min-w-0">
        <span className="text-lg font-bold tracking-widest text-primary uppercase">Coliving</span>
        <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
      </div>

      {/* Desktop / tablet: single row */}
      <div className="hidden md:flex items-center gap-4 flex-wrap justify-end min-w-0">
        {badge}
        <NavLinks />
      </div>

      {/* Mobile: same affordance as MarketingNavbar (ghost icon, no heavy outline) */}
      <div className="flex md:hidden items-center shrink-0">
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
                <span className="text-[10px] tracking-[0.28em] text-muted-foreground uppercase">Coliving</span>
                <span className="text-xs font-bold tracking-widest uppercase text-primary">Management</span>
              </div>
              {badge ? (
                <div className="inline-flex items-center rounded-full border border-border/80 bg-muted/40 px-3 py-1.5 text-[11px] font-semibold tracking-widest uppercase text-foreground">
                  {badge}
                </div>
              ) : null}
            </div>
            <nav className="flex flex-col gap-0.5 p-2 pb-6">
              <NavLinks vertical />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}
