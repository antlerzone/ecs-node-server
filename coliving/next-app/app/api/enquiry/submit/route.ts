/**
 * Enquiry submit – proxy to ECS to register client (for later manual billing).
 * Body: { title, email, currency?, country?, contact?, ... } – forwarded as-is to ECS.
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

  const url = `${ECS_BASE}/api/enquiry/submit`;
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
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[enquiry/submit]", err);
    return NextResponse.json(
      { ok: false, reason: "PROXY_ERROR" },
      { status: 502 }
    );
  }
}
