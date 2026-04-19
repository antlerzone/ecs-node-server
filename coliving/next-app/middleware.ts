import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const WWW = "www.colivingjb.com"
const APEX = "colivingjb.com"
const PORTAL = "portal.colivingjb.com"

function host(req: NextRequest): string {
  return (req.headers.get("host") ?? "").split(":")[0].toLowerCase()
}

const LOCAL_DEV = new Set(["localhost", "127.0.0.1", "::1"])

export function middleware(request: NextRequest) {
  const h = host(request)
  const { pathname, search } = request.nextUrl

  // Local dev: keep / → /login (same as former next.config)
  if (LOCAL_DEV.has(h) && (pathname === "/" || pathname === "")) {
    return NextResponse.redirect(new URL(`/login${search}`, request.url), 308)
  }

  // www + apex: product landing at / (same content as /home)
  if (h === WWW || h === APEX) {
    if (pathname === "/home" || pathname === "/home/") {
      return NextResponse.redirect(new URL(`/${search}`, request.url), 308)
    }
    if (pathname === "/" || pathname === "") {
      return NextResponse.rewrite(new URL("/home", request.url))
    }
  }

  // portal: login at /; marketing pages served here too (rewrite, not redirect to www).
  // Redirecting portal → www would loop if Nginx/DNS still sends www → portal (common during cutover).
  if (h === PORTAL) {
    const marketingExact = ["/pricing", "/proposal", "/for-owners", "/for-owner"]
    if (pathname === "/home" || pathname === "/home/" || pathname.startsWith("/home/")) {
      const destPath =
        pathname === "/home/" ? "/home" : pathname
      return NextResponse.rewrite(new URL(`${destPath}${search}`, request.url))
    }
    if (marketingExact.includes(pathname)) {
      const path = pathname === "/for-owner" ? "/for-owners" : pathname
      return NextResponse.rewrite(new URL(`${path}${search}`, request.url))
    }
    if (pathname === "/" || pathname === "") {
      return NextResponse.redirect(new URL(`/login${search}`, request.url), 308)
    }
  }

  if (pathname === "/for-owner" || pathname === "/for-owner/") {
    return NextResponse.redirect(new URL(`/for-owners${search}`, request.url), 308)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|woff|woff2)$).*)",
  ],
}
