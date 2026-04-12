/**
 * Available Unit list – public page (no login).
 * Proxies POST to ECS /api/availableunit/list so portal can call same-origin.
 * No subdomain = all operators' available units; ?subdomain=xxx = one client only.
 * Nginx: route /api/available-unit/ to Next (3001), not Node.
 */

import { NextRequest, NextResponse } from "next/server";

const ECS_BASE = (process.env.ECS_BASE_URL || process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "");
const ECS_TOKEN = process.env.ECS_API_TOKEN || "";
const ECS_USERNAME = process.env.ECS_API_USERNAME || "";

export async function POST(request: NextRequest) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "INVALID_JSON" }, { status: 400 });
  }

  const url = `${ECS_BASE}/api/availableunit/list`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(ECS_TOKEN ? { Authorization: `Bearer ${ECS_TOKEN}` } : {}),
    ...(ECS_USERNAME ? { "X-API-Username": ECS_USERNAME } : {}),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[available-unit/list]", err);
    return NextResponse.json(
      { ok: false, reason: "PROXY_ERROR" },
      { status: 502 }
    );
  }
}
