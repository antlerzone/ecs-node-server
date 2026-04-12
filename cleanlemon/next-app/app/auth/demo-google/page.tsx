"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import {
  CLEANLEMONS_AFTER_AUTH_REDIRECT_KEY,
  CLEANLEMONS_OAUTH_POPUP_FLAG_KEY,
  CLEANLEMONS_PORTAL_AUTH_SUCCESS_MSG,
} from "@/lib/cleanlemon-portal-constants";

function DemoGoogleInner() {
  const router = useRouter();
  const { loginWithGoogle } = useAuth();
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await loginWithGoogle();
      if (cancelled) return;
      if (!ok) {
        setErr("Demo sign-in failed.");
        return;
      }
      let isPopup = false;
      try {
        isPopup = localStorage.getItem(CLEANLEMONS_OAUTH_POPUP_FLAG_KEY) === "1";
      } catch {
        /* ignore */
      }
      const target =
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
      if (isPopup && typeof window !== "undefined" && window.opener) {
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
      router.replace(target);
    })();
    return () => {
      cancelled = true;
    };
  }, [loginWithGoogle, router]);

  if (err) {
    return (
      <p className="p-6 text-center text-destructive" role="alert">
        {err}
      </p>
    );
  }
  return (
    <p className="p-6 text-center text-muted-foreground">Signing you in…</p>
  );
}

export default function DemoGooglePage() {
  return (
    <AuthProvider>
      <DemoGoogleInner />
    </AuthProvider>
  );
}
