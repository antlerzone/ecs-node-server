import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * When portal hostname sends all traffic to Next first, Xero POST never reaches Node.
 * Proxy to local Cleanlemons API (same host ECS: PM2 port 5001).
 *
 * Override if your Node listens elsewhere: CLEANLEMON_INTERNAL_API_ORIGIN=http://127.0.0.1:5001
 */
function upstreamOrigin(): string {
  const fromEnv = process.env.CLEANLEMON_INTERNAL_API_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "http://127.0.0.1:5001";
}

/**
 * Xero "Intent to receive" and invoice/contact webhooks — preserve raw body + signature for HMAC.
 */
export async function POST(request: NextRequest) {
  const sig = request.headers.get("x-xero-signature") || "";
  const ct =
    request.headers.get("content-type") || "application/json; charset=utf-8";
  const body = await request.arrayBuffer();

  const url = `${upstreamOrigin()}/api/xero/webhook`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": ct,
        "x-xero-signature": sig,
      },
      body,
    });
  } catch (e) {
    console.error("[xero webhook] upstream fetch failed", e);
    return new NextResponse("Upstream unreachable", { status: 502 });
  }

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") || "text/plain; charset=utf-8",
    },
  });
}
