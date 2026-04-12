"use client";

import { useEffect, useState } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { AuthProvider } from "@/lib/auth-context";

export default function RegisterPage() {
  const [redirectTo, setRedirectTo] = useState("/portal/enquiry");

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const plan = String(qs.get("plan") || "").trim();
    const amount = Number(qs.get("amount") || 0);
    const interval = String(qs.get("interval") || "").trim().toLowerCase();
    if (plan) {
      const params = new URLSearchParams();
      params.set("plan", plan);
      if (amount > 0) params.set("amount", String(amount));
      if (interval === "month" || interval === "quarter" || interval === "year") {
        params.set("interval", interval);
      }
      setRedirectTo(`/portal/enquiry?${params.toString()}`);
    }
  }, []);

  return (
    <AuthProvider>
      <main className="min-h-screen bg-background flex flex-col">
        <header className="w-full py-4 px-6 bg-primary">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center">
                <span className="text-accent-foreground font-bold text-lg">CL</span>
              </div>
              <span className="text-primary-foreground font-bold text-xl">Cleanlemons</span>
            </div>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">Create account to continue payment</h1>
              <p className="text-muted-foreground">Register first, then proceed to your selected plan checkout flow.</p>
            </div>
            <LoginForm initialMode="register" redirectTo={redirectTo} />
          </div>
        </div>
      </main>
    </AuthProvider>
  );
}
