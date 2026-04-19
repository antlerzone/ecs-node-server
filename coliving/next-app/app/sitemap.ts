import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/seo"

const now = new Date()

/** Public routes for SEO; auth/dashboard routes excluded (noindex or low value for discovery). */
const publicPaths = [
  { path: "", priority: 1, changeFrequency: "weekly" as const },
  { path: "/pricing", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/available-unit", priority: 0.9, changeFrequency: "daily" as const },
  { path: "/portal", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/login", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/signup", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/register", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/forgot-password", priority: 0.4, changeFrequency: "monthly" as const },
  { path: "/reset-password", priority: 0.4, changeFrequency: "monthly" as const },
  { path: "/tutorial", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/ownertutorial", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/privacy-policy", priority: 0.6, changeFrequency: "yearly" as const },
  { path: "/terms-and-conditions", priority: 0.6, changeFrequency: "yearly" as const },
  { path: "/refund-policy", priority: 0.6, changeFrequency: "yearly" as const },
  { path: "/proposal", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/for-owners", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/enquiry", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/ownerenquiry", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/docs", priority: 0.7, changeFrequency: "monthly" as const },
]

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }))
}
