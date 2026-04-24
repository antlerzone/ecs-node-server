"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getCleanlemonApiBase, isDemoCleanlemonsHost } from "@/lib/portal-auth-mock";
import { confirmPortalPasswordReset } from "@/lib/cleanlemon-api";

function shouldSkipRealEmailApi(): boolean {
  const base = getCleanlemonApiBase();
  if (!base) return true;
  if (typeof window !== "undefined" && isDemoCleanlemonsHost()) return true;
  return false;
}

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    if (!code.trim()) {
      setError("Please enter the verification code from your email.");
      return;
    }
    if (!newPassword) {
      setError("Please enter a new password.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setIsLoading(true);
    try {
      if (shouldSkipRealEmailApi()) {
        setSuccess(true);
        return;
      }
      const data = await confirmPortalPasswordReset({
        email: email.trim(),
        code: code.trim(),
        newPassword,
      });
      if (data.ok) {
        setSuccess(true);
      } else {
        setError(
          data.reason === "INVALID_OR_EXPIRED_CODE"
            ? "Invalid or expired code. Request a new one from the forgot password page."
            : data.reason === "NO_EMAIL"
              ? "Please enter your email."
              : "Something went wrong. Please try again."
        );
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Password reset</h1>
          <p className="text-muted-foreground mb-6">
            Your password has been updated. You can now sign in with your new password.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-primary-foreground font-semibold hover:opacity-90 bg-primary"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full">
        <div className="mb-6">
          <Link
            href="/forgot-password"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={15} /> Forgot password
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Reset password</h1>
        <p className="text-muted-foreground mb-6">
          Enter your email, the verification code we sent you, and your new password.
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
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">
              Verification code
            </label>
            <Input
              type="text"
              placeholder="e.g. 123456"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError("");
              }}
              className="w-full"
              autoComplete="one-time-code"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">
              New password
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError("");
                }}
                className="w-full pr-10"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">
              Confirm new password
            </label>
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="Repeat new password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError("");
              }}
              className="w-full"
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" disabled={isLoading} className="w-full gap-2">
            {isLoading ? (
              <>
                <Spinner className="h-4 w-4" /> Updating…
              </>
            ) : (
              <>
                <Lock size={16} /> Reset password
              </>
            )}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
