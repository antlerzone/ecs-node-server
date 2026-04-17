/**
 * Public API for pricing page: returns credit plans from ECS (creditplan table).
 * Server-side calls ECS with API auth so the browser does not need credentials.
 */

import { NextResponse } from "next/server";

const ECS_BASE = (process.env.ECS_BASE_URL || process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "");
const ECS_TOKEN = process.env.ECS_API_TOKEN || "";
const ECS_USERNAME = process.env.ECS_API_USERNAME || "";

export async function GET() {
  const url = `${ECS_BASE}/api/enquiry/credit-plans`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(ECS_TOKEN ? { Authorization: `Bearer ${ECS_TOKEN}` } : {}),
    ...(ECS_USERNAME ? { "X-API-Username": ECS_USERNAME } : {}),
  };

  try {
    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(data || { ok: false, reason: "UPSTREAM_ERROR" }, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[pricing/credit-plans]", err);
    return NextResponse.json(
      { ok: false, reason: "PROXY_ERROR", items: [] },
      { status: 502 }
    );
  }
}
