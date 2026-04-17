import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/seo"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/auth/", "/operator/", "/owner/", "/tenant/", "/saas-admin/"],
      },
      {
        userAgent: "Googlebot",
        allow: "/",
        disallow: ["/auth/", "/operator/", "/owner/", "/tenant/", "/saas-admin/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
