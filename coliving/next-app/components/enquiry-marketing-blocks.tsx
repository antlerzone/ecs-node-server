"use client"

import type React from "react"

export const ENQUIRY_PORTAL_PRICING_URL = "https://portal.colivingjb.com/pricing"

export const enquiryBrandGradientStyle: React.CSSProperties = {
  background: "linear-gradient(165deg, var(--brand) 0%, var(--brand-dark) 55%, var(--brand-dark) 100%)",
}

/** Left chocolate column — “Hello, Friend!” / primary CTA slot (button or Link). */
export function EnquiryMarketingSigninColumn({ footerPrimary }: { footerPrimary: React.ReactNode }) {
  return (
    <div
      className="flex h-full min-h-0 flex-col px-6 sm:px-10 lg:px-14 py-8 lg:py-12 text-white overflow-hidden"
      style={enquiryBrandGradientStyle}
    >
      <div className="flex min-h-0 flex-1 flex-col max-w-xl">
        <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3 text-white/90">Get in Touch</p>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight mb-3 text-pretty">
          Interested in Our Platform?
        </h1>
        <p className="text-white/85 leading-relaxed mb-6 text-sm sm:text-base">Register now for a demo account.</p>
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
          href={ENQUIRY_PORTAL_PRICING_URL}
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
        {footerPrimary}
      </div>
    </div>
  )
}

/** Left chocolate column — “Welcome Back!” / primary CTA slot. */
export function EnquiryMarketingSignupColumn({ footerPrimary }: { footerPrimary: React.ReactNode }) {
  return (
    <div
      className="flex h-full min-h-0 flex-col px-6 sm:px-10 lg:px-14 py-8 lg:py-12 text-white overflow-hidden"
      style={enquiryBrandGradientStyle}
    >
      <div className="flex min-h-0 flex-1 flex-col max-w-xl">
        <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3 text-white/90">Get in Touch</p>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight mb-3 text-pretty">
          Interested in Our Platform?
        </h1>
        <p className="text-white/85 leading-relaxed mb-6 text-sm sm:text-base">Register now for a demo account.</p>
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
          href={ENQUIRY_PORTAL_PRICING_URL}
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
        {footerPrimary}
      </div>
    </div>
  )
}

/** Outline pill used on chocolate columns (button or `<Link className={…} />`). */
export const ENQUIRY_MARKETING_OUTLINE_BTN_CLASS =
  "inline-flex items-center justify-center rounded-full border-2 border-white/90 px-8 py-2.5 text-xs font-bold tracking-[0.12em] uppercase text-white hover:bg-white/15 transition-colors"
