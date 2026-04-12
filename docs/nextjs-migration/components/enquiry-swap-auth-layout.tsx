"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

const PORTAL_PRICING_URL = "https://portal.colivingjb.com/pricing"

const brandGradientStyle: React.CSSProperties = {
  background: "linear-gradient(165deg, var(--brand) 0%, var(--brand-dark) 55%, var(--brand-dark) 100%)",
}

type Page = "signin" | "signup"

/**
 * Enquiry auth: full-width split (no centered “card”); background half slides left ↔ right.
 */
export function EnquirySwapAuthLayout({
  signIn,
  signUp,
}: {
  signIn: React.ReactNode
  signUp: React.ReactNode
}) {
  const [page, setPage] = useState<Page>("signin")

  /** Page 1: full-height chocolate column — same as page 2, bottom = Hello Friend */
  const backgroundLayerSignin = (
    <div
      className="flex h-full min-h-0 flex-col px-6 sm:px-10 lg:px-14 py-8 lg:py-12 text-white overflow-hidden"
      style={brandGradientStyle}
    >
      <div className="flex min-h-0 flex-1 flex-col max-w-xl">
        <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3 text-white/90">Get in Touch</p>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight mb-3 text-pretty">
          Interested in Our Platform?
        </h1>
        <p className="text-white/85 leading-relaxed mb-6 text-sm sm:text-base">
          Register now for a demo account.
        </p>
        <div className="space-y-2.5 mb-6 text-sm">
          <p>
            <span className="text-white/70">Email</span>
            <br />
            <span className="font-semibold text-white">colivingmanagement@gmail.com</span>
          </p>
          <p>
            <span className="text-white/70">Phone</span>
            <br />
            <span className="font-semibold text-white">60198579627</span>
          </p>
          <p>
            <span className="text-white/70">Office</span>
            <br />
            <span className="font-semibold text-white">Johor Bahru, Malaysia</span>
          </p>
        </div>
        <a
          href={PORTAL_PRICING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-2 px-5 py-2.5 rounded-xl border-2 border-white/80 font-semibold text-sm text-white hover:bg-white/10 transition-colors"
        >
          View pricing table
        </a>
      </div>

      <div className="shrink-0 pt-8 mt-auto border-t border-white/20 max-w-xl">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-2">Hello, Friend!</h2>
        <p className="text-sm leading-relaxed text-white/90 mb-5 max-w-md">
          Register with your personal details to use all of site features
        </p>
        <button
          type="button"
          onClick={() => setPage("signup")}
          className="inline-flex items-center justify-center rounded-full border-2 border-white/90 px-8 py-2.5 text-xs font-bold tracking-[0.12em] uppercase text-white hover:bg-white/15 transition-colors"
        >
          Sign up
        </button>
      </div>
    </div>
  )

  /** Page 2: full-height single brand panel */
  const backgroundLayerSignup = (
    <div
      className="flex h-full min-h-0 flex-col px-6 sm:px-10 lg:px-14 py-8 lg:py-12 text-white overflow-hidden"
      style={brandGradientStyle}
    >
      <div className="flex min-h-0 flex-1 flex-col max-w-xl">
        <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3 text-white/90">Get in Touch</p>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight mb-3 text-pretty">
          Interested in Our Platform?
        </h1>
        <p className="text-white/85 leading-relaxed mb-6 text-sm sm:text-base">
          Register now for a demo account.
        </p>
        <div className="space-y-2.5 mb-6 text-sm">
          <p>
            <span className="text-white/70">Email</span>
            <br />
            <span className="font-semibold text-white">colivingmanagement@gmail.com</span>
          </p>
          <p>
            <span className="text-white/70">Phone</span>
            <br />
            <span className="font-semibold text-white">60198579627</span>
          </p>
          <p>
            <span className="text-white/70">Office</span>
            <br />
            <span className="font-semibold text-white">Johor Bahru, Malaysia</span>
          </p>
        </div>
        <a
          href={PORTAL_PRICING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-2 px-5 py-2.5 rounded-xl border-2 border-white/80 font-semibold text-sm text-white hover:bg-white/10 transition-colors"
        >
          View pricing table
        </a>
      </div>

      <div className="shrink-0 pt-8 mt-auto border-t border-white/20 max-w-xl">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-2">Welcome Back!</h2>
        <p className="text-sm leading-relaxed text-white/90 mb-5 max-w-md">
          Already have an account? Sign in to continue onboarding.
        </p>
        <button
          type="button"
          onClick={() => setPage("signin")}
          className="inline-flex items-center justify-center rounded-full border-2 border-white/90 px-8 py-2.5 text-xs font-bold tracking-[0.12em] uppercase text-white hover:bg-white/15 transition-colors"
        >
          Sign in
        </button>
      </div>
    </div>
  )

  const backgroundLayer = page === "signin" ? backgroundLayerSignin : backgroundLayerSignup

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full">
      {/* Mobile: stacked, full-width sections (no floating card) */}
      <div className="md:hidden flex flex-1 flex-col min-h-0 w-full divide-y divide-border">
        <div className="w-full bg-background">{backgroundLayer}</div>
        <div className="flex border-b border-border p-1 bg-muted/30">
          <button
            type="button"
            onClick={() => setPage("signin")}
            className={cn(
              "flex-1 rounded-lg py-3 text-sm font-semibold transition-colors",
              page === "signin" ? "text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
            style={page === "signin" ? { background: "var(--brand)" } : undefined}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setPage("signup")}
            className={cn(
              "flex-1 rounded-lg py-3 text-sm font-semibold transition-colors",
              page === "signup" ? "text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
            style={page === "signup" ? { background: "var(--brand)" } : undefined}
          >
            Create account
          </button>
        </div>
        <div className="flex flex-1 min-h-0 w-full bg-background px-4 py-8 items-center justify-center">
          <div className="w-full max-w-[360px] min-h-0 max-h-full overflow-y-auto my-auto">{page === "signin" ? signIn : signUp}</div>
        </div>
      </div>

      {/* Desktop: edge-to-edge split, fills area below header */}
      <div className="hidden md:flex relative w-full flex-1 min-h-0 overflow-hidden">
        {/* Background layer — moves left ↔ right, true half viewport */}
        <div
          className={cn(
            "absolute inset-y-0 z-[1] w-1/2 flex flex-col transition-[left] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
            page === "signin" ? "left-0" : "left-1/2"
          )}
        >
          {backgroundLayer}
        </div>

        {/* Sign In — right column on page 1 */}
        <div
          className={cn(
            "absolute inset-y-0 right-0 z-[2] w-1/2 flex items-center justify-center px-8 lg:px-16 xl:px-24 py-8 bg-background overflow-hidden transition-opacity duration-300",
            page === "signin" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none invisible"
          )}
        >
          <div className="w-full max-w-[400px] min-h-0 max-h-full overflow-y-auto [scrollbar-gutter:stable] py-4">{signIn}</div>
        </div>

        {/* Create Account — left column on page 2 */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 z-[2] w-1/2 flex items-center justify-center px-8 lg:px-16 xl:px-24 py-8 bg-background overflow-hidden transition-opacity duration-300",
            page === "signup" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none invisible"
          )}
        >
          <div className="w-full max-w-[400px] min-h-0 max-h-full overflow-y-auto [scrollbar-gutter:stable] py-4">{signUp}</div>
        </div>
      </div>
    </div>
  )
}
