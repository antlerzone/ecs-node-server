"use client"

import Link from "next/link"

const HOME_URL = "https://www.colivingjb.com"
const PORTAL_LOGIN_URL = "https://portal.colivingjb.com"

/** Logo + Home + Login Portal links for portal site (landing, available-unit, etc.) */
export function PortalSiteHeader({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-6 ${className}`}>
      <Link
        href={HOME_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col leading-tight hover:opacity-90 transition-opacity"
        aria-label="Coliving Management – Home"
      >
        <span className="text-lg font-bold tracking-widest text-primary uppercase">Coliving</span>
        <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
      </Link>
      <nav className="flex items-center gap-6">
        <a
          href={HOME_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
        >
          Home
        </a>
        <a
          href={PORTAL_LOGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
        >
          Login Portal
        </a>
      </nav>
    </div>
  )
}
