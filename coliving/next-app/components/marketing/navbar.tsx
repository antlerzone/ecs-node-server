"use client"

import Link from "next/link"
import { useState } from "react"
import { Menu, X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

/** Center nav — plain text links only (no current-route highlight). */
const mainNavLinks = [
  { label: "Home", href: "/home" },
  { label: "Platform", href: "/home#platform-steps" },
  { label: "Pricing", href: "/pricing" },
  { label: "Operators", href: "/proposal" },
  { label: "For Owners", href: "/for-owners" },
]

const AVAILABLE_UNIT_HREF = "/available-unit"

const ctaLabelClass = "text-xs font-bold tracking-widest uppercase"

/** One segmented control: browse (quiet) + portal (primary) — avoids two identical brown pills. */
function HeaderActions({
  className,
  onNavigate,
}: {
  className?: string
  /** Close mobile sheet when a link is used (internal link only; external portal keeps menu open until blur). */
  onNavigate?: () => void
}) {
  return (
    <div
      className={className}
      role="group"
      aria-label="Listings and portal access"
    >
      <div className="flex flex-col gap-0 overflow-hidden rounded-2xl border border-border/70 bg-muted/35 shadow-sm sm:flex-row sm:items-stretch sm:rounded-full sm:p-1 sm:pl-1.5">
        <Link
          href={AVAILABLE_UNIT_HREF}
          onClick={onNavigate}
          className={`${ctaLabelClass} flex items-center justify-center px-4 py-3 text-center text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground sm:py-2 sm:hover:bg-background/80`}
        >
          Available Unit
        </Link>
        <span
          className="hidden h-auto w-px shrink-0 self-stretch bg-border/70 sm:my-1.5 sm:block"
          aria-hidden
        />
        <span className="h-px w-full bg-border/70 sm:hidden" aria-hidden />
        <a
          href="https://portal.colivingjb.com"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onNavigate}
          className={`${ctaLabelClass} flex items-center justify-center px-5 py-3 text-primary-foreground transition-opacity hover:opacity-95 sm:rounded-full sm:py-2`}
          style={{ background: "var(--brand)" }}
        >
          Portal
        </a>
      </div>
    </div>
  )
}

const centerNavLinkClass =
  "text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors rounded-full px-4 py-2"

const mobileNavLinkClass =
  "text-sm font-semibold tracking-widest uppercase text-foreground hover:bg-muted/70 rounded-xl px-3 py-3 transition-colors"

export function MarketingNavbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex flex-col leading-tight">
          <span className="text-lg font-black tracking-[0.15em] uppercase" style={{ color: "var(--brand)" }}>
            ColivingJB
          </span>
          <span className="text-[9px] tracking-[0.25em] text-muted-foreground uppercase">
            Operations Platform
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1.5 flex-1 justify-center min-w-0">
          {mainNavLinks.map((link) => (
            <Link key={link.label} href={link.href} className={centerNavLinkClass}>
              {link.label}
            </Link>
          ))}
        </nav>

        <HeaderActions className="hidden md:flex shrink-0" />

        <button
          type="button"
          className="md:hidden p-2 -mr-2"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-background border-b border-border overflow-hidden"
          >
            <nav className="px-6 py-4 flex flex-col gap-1">
              {mainNavLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={mobileNavLinkClass}
                >
                  {link.label}
                </Link>
              ))}
              <HeaderActions className="mt-3" onNavigate={() => setMobileMenuOpen(false)} />
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
