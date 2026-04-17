/**
 * Image proxy for OSS URLs – fetches from Aliyun OSS and streams back.
 * Used so <img> on the portal can show OSS images without OSS CORS.
 * GET /api/portal/proxy-image?url=https://{bucket}.oss-{region}.aliyuncs.com/...
 */

import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

/** Route must stay dynamic — avoid Next trying to persist large image bodies in the data cache. */
export const dynamic = "force-dynamic";

/** Allow Aliyun OSS virtual-host URLs (bucket/region vary per env). */
function isAllowedOssImageHost(hostname: string): boolean {
  return hostname.toLowerCase().endsWith(".aliyuncs.com");
}

export async function GET(request: NextRequest) {
  noStore();
  const url = request.nextUrl.searchParams.get("url");
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Invalid scheme" }, { status: 400 });
  }
  if (!isAllowedOssImageHost(parsed.hostname)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }
  try {
    // Do not use next.revalidate / force-cache — Next data cache rejects bodies >2MB and breaks large photos (avatars/NRIC).
    const res = await fetch(url, {
      headers: { Accept: "image/*" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Upstream error" }, { status: res.status });
    }
    const contentType = res.headers.get("content-type") || "image/png";
    const body = res.body;
    if (!body) {
      return NextResponse.json({ error: "No body" }, { status: 502 });
    }
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    console.error("[proxy-image]", e);
    return NextResponse.json({ error: "Proxy failed" }, { status: 502 });
  }
}
