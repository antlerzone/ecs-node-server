"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type BillingInterval = "month" | "quarter" | "year";

type CheckoutProfile = {
  title: string;
  email: string;
  contact: string;
  country: string;
  currency: string;
  note?: string;
  selectedPlan?: string;
  selectedAmount?: number;
  billingInterval?: BillingInterval;
};

const PLAN_PRICING: Record<string, Record<BillingInterval, number>> = {
  starter: { month: 600, quarter: 1710, year: 5760 },
  growth: { month: 1200, quarter: 3420, year: 11520 },
  enterprise: { month: 1800, quarter: 5130, year: 17280 },
};

const INTERVAL_LABELS: Record<BillingInterval, string> = {
  month: "Monthly",
  quarter: "Quarterly",
  year: "Yearly",
};

export default function PortalPaymentPage() {
  const [profile, setProfile] = useState<CheckoutProfile | null>(null);
  const [interval, setInterval] = useState<BillingInterval>("year");
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const qs = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const urlIv = qs?.get("interval");
    const fromUrl =
      urlIv === "month" || urlIv === "quarter" || urlIv === "year" ? (urlIv as BillingInterval) : null;

    const raw = sessionStorage.getItem("cleanlemons_checkout_profile");
    if (!raw) {
      if (fromUrl) setInterval(fromUrl);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as CheckoutProfile;
      setProfile(parsed);
      if (fromUrl) {
        setInterval(fromUrl);
        return;
      }
      const bi = parsed.billingInterval;
      if (bi === "month" || bi === "quarter" || bi === "year") {
        setInterval(bi);
      }
    } catch {
      setProfile(null);
      if (fromUrl) setInterval(fromUrl);
    }
  }, []);

  const normalizedPlan = useMemo(() => {
    const raw = String(profile?.selectedPlan || "").trim().toLowerCase();
    if (raw === "scale") return "enterprise";
    if (raw === "starter" || raw === "growth" || raw === "enterprise") return raw;
    return "starter";
  }, [profile?.selectedPlan]);

  const successUrl = "https://portal.cleanlemons.com/portal?payment=success";
  const cancelUrl = "https://portal.cleanlemons.com/portal/payment?payment=cancelled";
  const selectedAmount = PLAN_PRICING[normalizedPlan]?.[interval] || 0;

  async function handlePayNow() {
    if (!profile) return;
    setIsPaying(true);
    setError("");
    try {
      const res = await fetch("/api/cleanlemon/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: normalizedPlan,
          interval,
          checkoutAction: 'subscribe',
          name: profile.title,
          email: profile.email,
          successUrl,
          cancelUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false || !data?.url) {
        throw new Error(data?.reason || "PAYMENT_SUBMIT_FAILED");
      }
      window.location.href = String(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed. Please try again.");
    } finally {
      setIsPaying(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-lg font-bold tracking-widest text-primary uppercase">Cleanlemons</span>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Payment</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-xs font-semibold tracking-widest uppercase text-primary">Step 3 of 3</span>
          <Link href="/portal/enquiry" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Back to Info
          </Link>
          <a href="https://portal.cleanlemons.com" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={14} /> Back to Portal
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-12 sm:py-16 space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <h1 className="text-3xl font-black text-foreground mb-3">Confirm and Pay</h1>
          <p className="text-muted-foreground">After successful payment, you will be redirected back to your portal.</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 space-y-4">
          <h2 className="text-lg font-bold text-foreground">Order Summary</h2>
          {profile ? (
            <>
              <div className="text-sm text-muted-foreground space-y-1">
                <p><span className="font-medium text-foreground">Company/Name:</span> {profile.title || "-"}</p>
                <p><span className="font-medium text-foreground">Email:</span> {profile.email || "-"}</p>
                <p><span className="font-medium text-foreground">Contact:</span> {profile.contact || "-"}</p>
                <p><span className="font-medium text-foreground">Plan:</span> {profile.selectedPlan || "-"}</p>
                <p><span className="font-medium text-foreground">Cycle:</span> {INTERVAL_LABELS[interval]}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button type="button" variant={interval === "month" ? "default" : "outline"} onClick={() => setInterval("month")}>Monthly</Button>
                <Button type="button" variant={interval === "quarter" ? "default" : "outline"} onClick={() => setInterval("quarter")}>Quarterly</Button>
                <Button type="button" variant={interval === "year" ? "default" : "outline"} onClick={() => setInterval("year")}>Yearly</Button>
              </div>
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">Pricing comparison</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(["month", "quarter", "year"] as BillingInterval[]).map((cycle) => {
                    const amount = PLAN_PRICING[normalizedPlan]?.[cycle] || 0;
                    const active = interval === cycle;
                    return (
                      <button
                        key={cycle}
                        type="button"
                        onClick={() => setInterval(cycle)}
                        className={`rounded-xl border p-3 text-left transition-colors ${
                          active
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "border-border bg-background hover:border-primary/40"
                        }`}
                      >
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">{INTERVAL_LABELS[cycle]}</p>
                        <p className="text-xl font-bold text-foreground mt-1">RM {amount.toLocaleString()}</p>
                        {active ? <p className="text-xs text-primary font-semibold mt-1">Selected</p> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Amount to be charged now</p>
                <p className="text-2xl font-black text-foreground mt-1">RM {selectedAmount.toLocaleString()}</p>
              </div>
              <Button onClick={handlePayNow} disabled={isPaying} className="w-full sm:w-auto">
                {isPaying ? "Redirecting to Stripe..." : "Pay with Stripe"}
              </Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              Missing checkout profile. Please return to <Link href="/portal/enquiry" className="text-primary hover:underline">Confirm Info</Link>.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
          <p className="text-sm text-muted-foreground">
            This step submits your selected plan request and confirms payment flow. Once completed, you will be redirected back to your portal.
          </p>
        </div>
      </main>
    </div>
  );
}
