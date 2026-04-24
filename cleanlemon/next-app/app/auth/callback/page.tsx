"use client";

import { useEffect, useRef, useState } from "react";
import { getCleanlemonApiBaseWithDevFallback } from "@/lib/portal-auth-mock";
import { pickFirstClientIdFromMemberRoles, type CleanlemonsJwtContext } from "@/lib/auth-context";
import {
  CLEANLEMONS_ACTIVE_OPERATOR_ID_KEY,
  CLEANLEMONS_AFTER_AUTH_REDIRECT_KEY,
  CLEANLEMONS_OAUTH_POPUP_FLAG_KEY,
  CLEANLEMONS_PORTAL_AUTH_SUCCESS_MSG,
} from "@/lib/cleanlemon-portal-constants";

type VerifyResponse = {
  ok?: boolean;
  email?: string;
  roles?: Array<{ type?: string; clientId?: string; client_id?: string }>;
  cleanlemons?: CleanlemonsJwtContext | null;
};

function pickInitialOperatorId(data: VerifyResponse): string {
  const cln = data.cleanlemons;
  const choices = cln?.operatorChoices;
  if (Array.isArray(choices) && choices.length) {
    let stored = "";
    try {
      stored = localStorage.getItem(CLEANLEMONS_ACTIVE_OPERATOR_ID_KEY) || "";
    } catch {
      /* ignore */
    }
    const match = choices.find((c) => c.operatorId === stored);
    if (match) return match.operatorId;
    return choices[0].operatorId;
  }
  const fromRole = pickFirstClientIdFromMemberRoles(data.roles);
  if (fromRole) return fromRole;
  return "op_demo_001";
}

const VERIFY_TIMEOUT_MS = 30_000;

export default function CleanlemonsAuthCallbackPage() {
  const [error, setError] = useState("");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const qs = new URLSearchParams(window.location.search);
    const token = String(qs.get("token") || "").trim();
    if (!token) {
      setError("Missing auth token.");
      return;
    }
    const apiBase = getCleanlemonApiBaseWithDevFallback();
    if (!apiBase) {
      setError("OAuth verification failed (API base URL not set). Check NEXT_PUBLIC_CLEANLEMON_API_URL and restart dev.");
      return;
    }
    const verifyUrl = `${apiBase}/api/portal-auth/verify?token=${encodeURIComponent(token)}`;
    const ac = new AbortController();
    const t = window.setTimeout(() => ac.abort(), VERIFY_TIMEOUT_MS);
    fetch(verifyUrl, { signal: ac.signal })
      .then(async (r) => {
        const text = await r.text();
        try {
          return JSON.parse(text) as VerifyResponse;
        } catch {
          throw new Error("BAD_JSON");
        }
      })
      .then((data: VerifyResponse) => {
        if (!data?.ok || !data?.email) {
          setError("OAuth verification failed (invalid or expired token). Please try signing in again.");
          return;
        }
        const normalizedEmail = String(data.email).trim().toLowerCase();
        const operatorId = pickInitialOperatorId(data);
        try {
          localStorage.setItem(CLEANLEMONS_ACTIVE_OPERATOR_ID_KEY, operatorId);
        } catch {
          /* ignore */
        }
        const savedUser = {
          id: `google_${Date.now()}`,
          email: normalizedEmail,
          name: normalizedEmail.split("@")[0],
          role: null,
          provider: "google" as const,
          hasPassword: false,
          operatorId,
          cleanlemons: data.cleanlemons ?? null,
          plan: "basic" as const,
        };
        try {
          localStorage.setItem("cleanlemons_portal_jwt", token);
        } catch {
          /* ignore */
        }
        localStorage.setItem("cleanlemons_user", JSON.stringify(savedUser));
        let isPopup = false;
        try {
          isPopup = localStorage.getItem(CLEANLEMONS_OAUTH_POPUP_FLAG_KEY) === "1";
        } catch {
          /* ignore */
        }
        const redirectTarget =
          (() => {
            try {
              return (
                localStorage.getItem(CLEANLEMONS_AFTER_AUTH_REDIRECT_KEY) ||
                sessionStorage.getItem("cleanlemons_after_auth_redirect") ||
                "/portal"
              );
            } catch {
              return sessionStorage.getItem("cleanlemons_after_auth_redirect") || "/portal";
            }
          })();
        try {
          localStorage.removeItem(CLEANLEMONS_OAUTH_POPUP_FLAG_KEY);
          localStorage.removeItem(CLEANLEMONS_AFTER_AUTH_REDIRECT_KEY);
        } catch {
          /* ignore */
        }
        sessionStorage.removeItem("cleanlemons_after_auth_redirect");
        if (isPopup && typeof window !== "undefined") {
          if (window.opener) {
            try {
              window.opener.postMessage(
                { type: CLEANLEMONS_PORTAL_AUTH_SUCCESS_MSG },
                window.location.origin
              );
            } catch {
              /* ignore */
            }
            window.close();
            return;
          }
          window.location.replace(redirectTarget);
          return;
        }
        // Full navigation: client router.replace() after OAuth often fails to leave this page (stuck on "Signing you in…").
        window.location.replace(redirectTarget);
      })
      .catch((e: unknown) => {
        const aborted = e instanceof Error && e.name === "AbortError";
        setError(
          aborted
            ? `OAuth verification timed out (${VERIFY_TIMEOUT_MS / 1000}s). Is the API running at ${apiBase}?`
            : "OAuth verification failed (network or server error)."
        );
      })
      .finally(() => {
        window.clearTimeout(t);
      });
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <p className="text-destructive mb-3">{error}</p>
          <a href="/register" className="text-primary hover:underline">
            Back to register
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <p className="text-muted-foreground">Signing you in with Google...</p>
    </div>
  );
}

