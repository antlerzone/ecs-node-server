import { NextRequest, NextResponse } from "next/server";
import {
  getCleanlemonApiBaseForRequest,
  isPortalAuthMockExplicit,
  isLivePortalCleanlemonsHostname,
  isLivePortalCleanlemonsBuild,
} from "@/lib/portal-auth-mock";

function shouldUseMockOAuthServer(request: NextRequest): boolean {
  const host = request.headers.get("host");
  if (isLivePortalCleanlemonsHostname(host) || isLivePortalCleanlemonsBuild()) return false;
  if (isPortalAuthMockExplicit()) return true;
  const base = getCleanlemonApiBaseForRequest(host);
  return !base;
}

/**
 * Fallback when the client still navigates here (old bundle or edge case).
 * Demo/mock → 307 to /auth/demo-google; real API → proxy to ECS OAuth start URL.
 */
export function GET(request: NextRequest) {
  const frontend = request.nextUrl.searchParams.get("frontend")?.trim() || "";
  const q = frontend
    ? `?frontend=${encodeURIComponent(frontend)}`
    : "";

  if (!shouldUseMockOAuthServer(request)) {
    const api = getCleanlemonApiBaseForRequest(request.headers.get("host"));
    if (!api) {
      return NextResponse.redirect(
        new URL(`/login?error=oauth_config`, request.url).toString(),
        307
      );
    }
    return NextResponse.redirect(`${api}/api/portal-auth/google${q}`, 307);
  }

  let targetOrigin = request.nextUrl.origin;
  if (frontend) {
    try {
      const u = new URL(frontend);
      if (u.hostname === request.nextUrl.hostname) targetOrigin = u.origin;
    } catch {
      /* keep request origin */
    }
  }

  return NextResponse.redirect(new URL("/auth/demo-google", targetOrigin).toString(), 307);
}
