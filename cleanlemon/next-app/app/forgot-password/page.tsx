"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getCleanlemonApiBase, isDemoCleanlemonsHost } from "@/lib/portal-auth-mock";
import { requestPortalPasswordResetEmail } from "@/lib/cleanlemon-api";

function shouldSkipRealEmailApi(): boolean {
  if (typeof window !== "undefined" && isDemoCleanlemonsHost()) return true;
  return false;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address.");
      return;
    }
    setError("");
    setIsLoading(true);
    try {
      const base = getCleanlemonApiBase().trim();
      if (!base && typeof window !== "undefined" && !isDemoCleanlemonsHost()) {
        setError("API not configured. Add NEXT_PUBLIC_CLEANLEMON_API_URL to cleanlemon/next-app/.env.local (e.g. http://127.0.0.1:5000) and restart Next.");
        return;
      }
      if (shouldSkipRealEmailApi()) {
        setSent(true);
        return;
      }
      const data = await requestPortalPasswordResetEmail(trimmed);
      if (data.ok) {
        setSent(true);
      } else {
        if (data.reason === "NO_EMAIL") {
          setError("Please enter your email.");
        } else if (data.reason === "DB_ERROR") {
          setError("Service temporarily unavailable. Please try again later or contact support.");
        } else {
          setError("Something went wrong. Please try again.");
        }
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Check your email</h1>
          <p className="text-muted-foreground mb-6">
            If an account exists for <strong>{email.trim()}</strong>, we’ve sent a verification code. Use it on the reset
            password page to set a new password. The code expires in 30 minutes.
          </p>
          <Link
            href="/reset-password"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-primary-foreground font-semibold hover:opacity-90 bg-primary"
          >
            Enter code and new password
          </Link>
          <p className="mt-6">
            <Link href="/login" className="text-sm text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full">
        <div className="mb-6">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={15} /> Back to sign in
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Forgot password?</h1>
        <p className="text-muted-foreground mb-6">
          Enter your email and we’ll send you a verification code to reset your password.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          ) : null}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">
              Email address
            </label>
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              className="w-full"
              autoComplete="email"
            />
          </div>
          <Button type="submit" disabled={isLoading} className="w-full gap-2">
            {isLoading ? (
              <>
                <Spinner className="h-4 w-4" /> Sending…
              </>
            ) : (
              <>
                <Mail size={16} /> Send verification code
              </>
            )}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/enquiry" className="text-primary hover:underline">
            New operator enquiry
          </Link>
        </p>
      </div>
    </div>
  );
}
