import Link from "next/link"
import { cn } from "@/lib/utils"

const footerLinks = {
  platform: [
    { label: "Features", href: "/home#platform-steps" },
    { label: "Available Unit", href: "/available-unit" },
    { label: "For Operators", href: "/proposal" },
    { label: "For Owners", href: "/for-owners" },
  ],
  company: [
    { label: "About", href: "/home#about" },
    { label: "Contact", href: "/enquiry" },
  ],
  legal: [
    { label: "Privacy Policy", href: "/privacy-policy" },
    { label: "Terms of Service", href: "/terms-and-conditions" },
  ],
}

export function MarketingFooter({ compact }: { compact?: boolean }) {
  return (
    <footer
      className={cn(
        "bg-foreground text-white/70 px-6",
        compact ? "pb-6 pt-6" : "py-16",
      )}
    >
      <div className="max-w-7xl mx-auto">
        <div
          className={cn(
            "grid grid-cols-1 md:grid-cols-4",
            compact ? "gap-8 mb-8" : "gap-10 mb-12",
          )}
        >
          <div className="md:col-span-1">
            <div className="flex flex-col leading-tight mb-4">
              <span className="text-lg font-black tracking-[0.15em] text-white uppercase">
                ColivingJB
              </span>
              <span className="text-[9px] tracking-[0.25em] text-white/50 uppercase">
                Operations Platform
              </span>
            </div>
            <p className="text-sm text-white/50 leading-relaxed">
              Centralizing coliving operations for Malaysia and Singapore. Save time, reduce manual work, and scale your rental business.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold tracking-widest uppercase text-white mb-4">Platform</h4>
            <ul className="space-y-2">
              {footerLinks.platform.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm text-white/50 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold tracking-widest uppercase text-white mb-4">Company</h4>
            <ul className="space-y-2">
              {footerLinks.company.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm text-white/50 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold tracking-widest uppercase text-white mb-4">Legal</h4>
            <ul className="space-y-2">
              {footerLinks.legal.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm text-white/50 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          className={cn(
            "flex flex-col items-center justify-between gap-4 border-t border-white/10 md:flex-row",
            compact ? "pb-1 pt-6" : "pt-8",
          )}
        >
          <p className="text-xs text-white/40">
            © {new Date().getFullYear()} ColivingJB Sdn Bhd. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <span className="text-xs text-white/40">Serving Malaysia & Singapore</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
