/**
 * Central SEO config for portal.colivingjb.com
 * Used by root layout and page-level metadata.
 */
export const SITE_URL = "https://portal.colivingjb.com"
export const SITE_NAME = "Coliving Management"
export const DEFAULT_DESCRIPTION =
  "Fully automated room management SaaS for Malaysia & Singapore. Coliving and rental operators—tenant portal, owner portal, smart locks, metered billing. One platform for rooms, tenancies, and payments."

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
