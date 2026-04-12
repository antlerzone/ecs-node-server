import { NextRequest } from "next/server"

const ALLOW = new Set([
  "step-1.jpeg",
  "step-1-2.jpeg",
  "step-2.jpeg",
  "step-2-1.jpeg",
  "step-2-2.jpeg",
  "step-2-3.jpeg",
  "step-2-4.jpeg",
  "step-2-5.jpeg",
  "step-3-0.jpeg",
  "step-3-1.jpeg",
  "step-4.jpeg",
  "step-4-2.jpeg",
  "step-5.jpeg",
  "tenant-smart-door.jpeg",
])

function ecsBase(): string {
  if (process.env.FORCE_LOCAL_BACKEND === "1" || process.env.FORCE_LOCAL_BACKEND === "true") {
    return "http://127.0.0.1:5000"
  }
  const raw = process.env.ECS_BASE_URL || process.env.NEXT_PUBLIC_ECS_BASE_URL || "http://127.0.0.1:5000"
  return String(raw).trim().replace(/\/$/, "")
}

/** Same-origin JPEG stream for homedemo Section 3 (OSS is private; ECS reads OSS). */
export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file")?.trim() || ""
  if (!file || !ALLOW.has(file)) {
    return new Response(JSON.stringify({ ok: false, reason: "INVALID_FILE" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const upstream = `${ecsBase()}/api/public/homedemo-screenshot?file=${encodeURIComponent(file)}`
  let res: Response
  try {
    res = await fetch(upstream, { cache: "no-store" })
  } catch (e) {
    console.error("[homedemo-screenshot] fetch upstream", e)
    return new Response(JSON.stringify({ ok: false, reason: "UPSTREAM_FAILED" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (!res.ok || !res.body) {
    return new Response(null, { status: res.status === 404 ? 404 : 502 })
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=300",
    },
  })
}
