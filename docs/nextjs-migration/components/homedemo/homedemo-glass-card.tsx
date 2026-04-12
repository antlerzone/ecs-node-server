"use client"

import Link from "next/link"
import type { ComponentType } from "react"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface HomedemoGlassCardProps {
  title: string
  subtitle: string
  bullets: { icon: ComponentType<{ className?: string; size?: number }>; text: string }[]
  accentClass: string
  portalHref?: string
  pricingCta?: { href: string; label: string }
  ctaLabel?: string
}

export function HomedemoGlassCard({
  title,
  subtitle,
  bullets,
  portalHref,
  pricingCta,
  accentClass,
  ctaLabel = "Open in Portal",
}: HomedemoGlassCardProps) {
  const showPortal = Boolean(portalHref) && !pricingCta
  const showPricing = Boolean(pricingCta)

  return (
    <div
      className={cn(
        "relative max-w-lg rounded-2xl border border-white/40 bg-gradient-to-br p-8 shadow-2xl backdrop-blur-xl",
        "before:pointer-events-none before:absolute before:inset-3 before:rounded-xl before:border before:border-white/25",
        accentClass
      )}
    >
      <div className="relative z-10">
        <h2 className="font-serif text-3xl font-semibold tracking-tight text-stone-900 md:text-4xl">
          {title}
        </h2>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-stone-800/90 md:text-base">
          {subtitle}
        </p>
        <ul className="mt-6 space-y-3">
          {bullets.map((b) => (
            <li key={b.text} className="flex gap-3 text-sm text-stone-800/95">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/50 text-stone-700 shadow-sm">
                <b.icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="pt-1 leading-snug">{b.text}</span>
            </li>
          ))}
        </ul>
        {(showPortal || showPricing) && (
          <div className="mt-8 flex flex-wrap gap-3">
            {showPricing && pricingCta && (
              <a
                href={pricingCta.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative inline-flex items-center gap-2 rounded-full bg-stone-900 px-6 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-lg transition hover:bg-stone-800"
              >
                <span
                  className="pointer-events-none absolute -left-1 -top-1 h-3 w-3 border-l-2 border-t-2 border-white/80"
                  aria-hidden
                />
                <span
                  className="pointer-events-none absolute -bottom-1 -right-1 h-3 w-3 border-b-2 border-r-2 border-white/80"
                  aria-hidden
                />
                {pricingCta.label}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </a>
            )}
            {showPortal && portalHref && (
              <Link
                href={portalHref}
                className="group relative inline-flex items-center gap-2 rounded-full bg-stone-900 px-6 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-lg transition hover:bg-stone-800"
              >
                <span
                  className="pointer-events-none absolute -left-1 -top-1 h-3 w-3 border-l-2 border-t-2 border-white/80"
                  aria-hidden
                />
                <span
                  className="pointer-events-none absolute -bottom-1 -right-1 h-3 w-3 border-b-2 border-r-2 border-white/80"
                  aria-hidden
                />
                {ctaLabel}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
