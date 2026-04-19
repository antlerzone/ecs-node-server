/**
 * Central SEO config (canonical marketing URL: www.colivingjb.com).
 * Used by root layout and page-level metadata.
 */
/** Canonical public marketing site (portal app still served on portal.* for login). */
export const SITE_URL = "https://www.colivingjb.com"
export const SITE_NAME = "Coliving Management"
export const DEFAULT_DESCRIPTION =
  "Fully automated room management SaaS for Malaysia & Singapore. Coliving and rental operators—tenant portal, owner portal, smart locks, metered billing. One platform for rooms, tenancies, and payments."

/** Public path; must match `app/layout.tsx` icons / deployed asset. */
export const SITE_LOGO_PATH = "/apple-icon-cm.png"

export const SITE_LOGO_URL = `${SITE_URL}${SITE_LOGO_PATH}`

/**
 * Official profile URLs for JSON-LD `sameAs` (LinkedIn, Facebook, etc.).
 * Set `NEXT_PUBLIC_SITE_SAME_AS` to comma- or space-separated URLs at build time.
 */
export function getSiteSameAs(): string[] {
  const raw = process.env.NEXT_PUBLIC_SITE_SAME_AS
  if (!raw || typeof raw !== "string") return []
  return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
}

export const defaultOpenGraph = {
  type: "website" as const,
  locale: "en_MY" as const,
  siteName: SITE_NAME,
  url: SITE_URL,
  description: DEFAULT_DESCRIPTION,
}

export const defaultTwitter = {
  card: "summary_large_image" as const,
  title: SITE_NAME,
  description: DEFAULT_DESCRIPTION,
}
