/**
 * Proxy for API docs auth – so docs_session cookie is set on portal domain.
 * GET /api/docs-auth/me, POST /api/docs-auth/login, POST /api/docs-auth/logout → ECS /api/docs-auth/*
 * Forwards Cookie to ECS and Set-Cookie from ECS to client.
 */
import { NextRequest, NextResponse } from "next/server";

const ECS_BASE =
  process.env.ECS_BASE_URL ||
  process.env.NEXT_PUBLIC_ECS_BASE_URL ||
  "http://127.0.0.1:5000";

function getPath(path: string[] | undefined): string {
  if (!path || path.length === 0) return "me";
  return path.join("/");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  const subPath = getPath(path);
  const url = `${ECS_BASE.replace(/\/$/, "")}/api/docs-auth/${subPath}`;
  const cookie = request.headers.get("cookie") || "";
  const res = await fetch(url, {
    method: "GET",
    headers: { cookie },
  });
  const data = await res.json().catch(() => ({}));
  const nextRes = NextResponse.json(data, { status: res.status });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) nextRes.headers.set("Set-Cookie", setCookie);
  return nextRes;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  const subPath = getPath(path);
  const url = `${ECS_BASE.replace(/\/$/, "")}/api/docs-auth/${subPath}`;
  const cookie = request.headers.get("cookie") || "";
  let body: string;
  try {
    const json = await request.json();
    body = JSON.stringify(json);
  } catch {
    body = "{}";
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie,
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  const nextRes = NextResponse.json(data, { status: res.status });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) nextRes.headers.set("Set-Cookie", setCookie);
  return nextRes;
}
