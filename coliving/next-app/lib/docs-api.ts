/**
 * API Docs (/docs) auth – login with username + password; cookie docs_session is set on portal origin via /api/docs-auth proxy.
 */

const DOCS_AUTH_BASE = "/api/docs-auth";

export interface DocsUser {
  id: string;
  username: string;
  /** API key (token) for Authorization: Bearer; only present when logged in to /docs. */
  token?: string | null;
}

export async function docsAuthMe(): Promise<{ ok: boolean; user?: DocsUser; reason?: string }> {
  const res = await fetch(`${DOCS_AUTH_BASE}/me`, { method: "GET", credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: (data as { reason?: string }).reason || "NOT_LOGGED_IN" };
  return { ok: true, user: (data as { user?: DocsUser }).user };
}

export async function docsAuthLogin(username: string, password: string): Promise<{ ok: boolean; user?: DocsUser; reason?: string }> {
  const res = await fetch(`${DOCS_AUTH_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: (data as { reason?: string }).reason || "LOGIN_FAILED" };
  return { ok: true, user: (data as { user?: DocsUser }).user };
}

export async function docsAuthLogout(): Promise<void> {
  await fetch(`${DOCS_AUTH_BASE}/logout`, { method: "POST", credentials: "include" });
}
