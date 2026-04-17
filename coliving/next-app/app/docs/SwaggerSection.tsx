"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"

import "swagger-ui-react/swagger-ui.css"

const SwaggerUI = dynamic(
  () => import("swagger-ui-react").then((mod) => mod.default),
  { ssr: false }
)

export function SwaggerSection() {
  const [spec, setSpec] = useState<object | null>(null)

  useEffect(() => {
    const base =
      typeof window !== "undefined"
        ? (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
        : "https://api.colivingjb.com"
    fetch("/openapi.json")
      .then((r) => r.json())
      .then((data) => {
        if (data.servers?.[0]) {
          data.servers[0].url = `${base}/api`
        }
        setSpec(data)
      })
      .catch(() => setSpec(null))
  }, [])

  if (!spec) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Loading OpenAPI doc…
      </div>
    )
  }

  return (
    <div className="swagger-wrap rounded-xl border border-border bg-card overflow-hidden">
      <SwaggerUI spec={spec} docExpansion="list" defaultModelsExpandDepth={0} />
    </div>
  )
}
