"use client"

import Link from "next/link"
import { HOMEDEMO_INTRO, HOMEDEMO_SCROLL_SECTIONS } from "@/lib/homedemo-data"
import { cn } from "@/lib/utils"

interface HomedemoNavProps {
  onNavigate: (sectionDomId: string) => void
  activeSlug: string | null
}

export function HomedemoNav({ onNavigate, activeSlug }: HomedemoNavProps) {
  const items = [
    { id: `section-${HOMEDEMO_INTRO.id}`, label: "Overview" },
    ...HOMEDEMO_SCROLL_SECTIONS.map((s) => ({
      id: `section-${s.slug}`,
      label: s.navLabel,
    })),
  ]

  return (
    <header className="fixed left-0 right-0 top-0 z-50 px-4 pt-4 md:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-2xl border border-white/50 bg-white/70 px-4 py-3 shadow-lg backdrop-blur-md md:px-6">
        <Link
          href="/"
          className="flex flex-col leading-tight transition-opacity hover:opacity-90"
          aria-label="Coliving Management home"
        >
          <span className="text-sm font-bold uppercase tracking-widest text-primary">Coliving</span>
          <span className="text-[10px] tracking-[0.25em] text-muted-foreground uppercase">
            Management
          </span>
        </Link>
        <nav className="hidden max-h-[70vh] flex-1 flex-wrap items-center justify-center gap-x-1 gap-y-1 overflow-y-auto xl:flex">
          {items.map((item) => {
            const slug = item.id.replace("section-", "")
            const isActive =
              slug === HOMEDEMO_INTRO.id ? activeSlug === "intro" : activeSlug === slug
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wider transition-colors rounded-full px-3 py-1.5",
                  isActive
                    ? "text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
                )}
                style={isActive ? { background: "var(--brand)" } : undefined}
              >
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/proposal"
            className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground sm:inline"
          >
            Managed ops
          </Link>
          <Link
            href="/login"
            className="relative rounded-full bg-stone-900 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white transition hover:bg-stone-800"
          >
            <span
              className="pointer-events-none absolute -left-0.5 -top-0.5 h-2 w-2 border-l border-t border-white/70"
              aria-hidden
            />
            <span
              className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-2 w-2 border-b border-r border-white/70"
              aria-hidden
            />
            Sign in
          </Link>
        </div>
      </div>
    </header>
  )
}
