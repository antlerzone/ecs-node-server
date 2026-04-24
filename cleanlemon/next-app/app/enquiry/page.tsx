"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { getCleanlemonApiBase } from "@/lib/portal-auth-mock";

type SubmitState = "idle" | "submitting" | "success" | "error";

type GateState = "loading" | "ready";

const INTERVAL_LABEL: Record<"month" | "quarter" | "year", string> = {
  month: "Monthly",
  quarter: "Quarterly",
  year: "Yearly",
};

/** Same-origin when `getCleanlemonApiBase()` is "" (localhost + loopback API env → Next rewrites `/api/cleanlemon/*`). */
function cleanlemonApiPath(path: string): string {
  const base = String(getCleanlemonApiBase() || "").trim().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

type OnboardingEnquiryStatus = {
  ok?: boolean;
  companyExists?: boolean;
  redirectToCompany?: boolean;
  profile?: { title: string; contact: string; email: string; operatorId: string } | null;
};

export default function EnquiryPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [contact, setContact] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("");
  const [selectedAmount, setSelectedAmount] = useState(0);
  const [billingInterval, setBillingInterval] = useState<"month" | "quarter" | "year">("year");
  const [gateState, setGateState] = useState<GateState>("loading");
  const [existingProfileHint, setExistingProfileHint] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const qs = new URLSearchParams(window.location.search);
      setSelectedPlan(String(qs.get("plan") || "").trim());
      setSelectedAmount(Number(qs.get("amount") || 0));
      const iv = String(qs.get("interval") || "").trim().toLowerCase();
      if (iv === "month" || iv === "quarter" || iv === "year") setBillingInterval(iv);

      let loginEmail = "";
      try {
        const rawUser = localStorage.getItem("cleanlemons_user");
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          loginEmail = String(parsed?.email || "").trim().toLowerCase();
          if (loginEmail) setEmail(loginEmail);
        }
      } catch {
        // noop
      }

      if (!loginEmail) {
        setGateState("ready");
        return;
      }

      try {
        const r = await fetch(
          `${cleanlemonApiPath("/api/cleanlemon/operator/onboarding-enquiry-status")}?email=${encodeURIComponent(loginEmail)}`
        );
        const data = (await r.json().catch(() => ({}))) as OnboardingEnquiryStatus;
        if (cancelled) return;

        if (data.redirectToCompany) {
          router.replace("/operator/company");
          return;
        }

        if (data.companyExists && data.profile) {
          setTitle(String(data.profile.title || "").trim());
          setContact(String(data.profile.contact || "").trim());
          setExistingProfileHint(true);
        }
      } catch {
        if (!cancelled) {
          // Network errors: still allow manual entry
        }
      }
      if (!cancelled) setGateState("ready");
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitState("submitting");
    setMessage("");

    const payload = {
      title: title.trim(),
      email: email.trim().toLowerCase(),
      contact: contact.trim(),
      country: "Malaysia",
      currency: "MYR",
      note: "",
      selectedPlan,
      selectedAmount,
      billingInterval,
    };
    try {
      const profileRes = await fetch(cleanlemonApiPath("/api/cleanlemon/operator/onboarding-profile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: payload.title,
          email: payload.email,
          contact: payload.contact,
        }),
      });
      const profileData = await profileRes.json().catch(() => ({}));
      if (!profileRes.ok || profileData?.ok === false || !profileData?.clientId) {
        throw new Error(profileData?.reason || "PROFILE_SAVE_FAILED");
      }
      sessionStorage.setItem(
        "cleanlemons_checkout_profile",
        JSON.stringify({
          ...payload,
          operatorId: String(profileData.clientId),
        })
      );
    } catch (err) {
      setSubmitState("error");
      setMessage(err instanceof Error ? err.message : "Failed to save profile.");
      return;
    }
    const params = new URLSearchParams();
    if (selectedPlan) params.set("plan", selectedPlan);
    if (selectedAmount > 0) params.set("amount", String(selectedAmount));
    params.set("interval", billingInterval);
    router.push(`/portal/payment?${params.toString()}`);
  }

  if (gateState === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Checking your account…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-lg font-bold tracking-widest text-primary uppercase">Cleanlemons</span>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Enquiry</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-xs font-semibold tracking-widest uppercase text-primary">Malaysia Only · MYR</span>
          <Link href="/pricing" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Pricing
          </Link>
          <Link
            href="/forgot-password"
            className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
          >
            Forgot password
          </Link>
          <a href="https://portal.cleanlemons.com" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={14} /> Back to Portal
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <section className="text-center mb-10">
          <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3 text-primary">Step 2 of 3</p>
          <h1 className="text-3xl sm:text-4xl font-black text-foreground leading-tight mb-4">
            Confirm your personal information
          </h1>
          <p className="text-muted-foreground">
            Review your details before continuing to payment.
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          {existingProfileHint ? (
            <div className="mb-5 rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              Your company profile is already on file for this email. Review the details below and continue to payment to
              complete or retry subscription — each email can only register once.
            </div>
          ) : null}

          {selectedPlan ? (
            <div className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">Selected Plan</p>
              <p className="text-lg font-bold text-foreground">
                {selectedPlan}
                {selectedAmount > 0 ? ` · RM ${selectedAmount.toLocaleString()}` : ""}
                <span className="text-sm font-semibold text-muted-foreground">
                  {" "}
                  · {INTERVAL_LABEL[billingInterval]}
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">Next step: continue to payment for this selected plan.</p>
            </div>
          ) : null}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="title">Company / Name</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. ABC Cleaning Sdn Bhd"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                placeholder="name@company.com"
                required
                readOnly
              />
              <p className="text-xs text-red-600 leading-snug">
                Don&apos;t use a company email — you may need to verify your identity.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact">Phone / WhatsApp</Label>
              <Input
                id="contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="e.g. +60 12-345 6789"
                required
              />
            </div>

            <Button type="submit" className="w-full sm:w-auto" disabled={submitState === "submitting"}>
              {submitState === "submitting" ? "Continuing..." : "Continue to Payment"}
            </Button>

            {message ? (
              <p className={`text-sm ${submitState === "success" ? "text-primary" : "text-destructive"}`}>{message}</p>
            ) : null}
          </form>
        </section>
      </main>
    </div>
  );
}
