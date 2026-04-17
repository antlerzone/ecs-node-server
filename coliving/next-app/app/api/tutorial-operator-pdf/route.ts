import { NextRequest } from "next/server"
import { OPERATOR_PDF_TUTORIALS } from "@/app/tutorial/operator-pdfs"

const ALLOW = new Set(OPERATOR_PDF_TUTORIALS.map((p) => p.file))

function ecsBase(): string {
  if (process.env.FORCE_LOCAL_BACKEND === "1" || process.env.FORCE_LOCAL_BACKEND === "true") {
    return "http://127.0.0.1:5000"
  }
  const raw = process.env.ECS_BASE_URL || process.env.NEXT_PUBLIC_ECS_BASE_URL || "http://127.0.0.1:5000"
  return String(raw).trim().replace(/\/$/, "")
}

/** Same-origin PDF stream for react-pdf (avoids cross-origin fetch from portal → api). */
export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file")?.trim() || ""
  if (!file || !ALLOW.has(file)) {
    return new Response(JSON.stringify({ ok: false, reason: "INVALID_FILE" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const upstream = `${ecsBase()}/api/public/operator-tutorial-pdf?file=${encodeURIComponent(file)}`
  let res: Response
  try {
    res = await fetch(upstream, { cache: "no-store" })
  } catch (e) {
    console.error("[tutorial-operator-pdf] fetch upstream", e)
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
      "Content-Type": "application/pdf",
      "Cache-Control": "public, max-age=300",
    },
  })
}
