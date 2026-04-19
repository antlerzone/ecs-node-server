"use client"

import type React from "react"

export const ENQUIRY_PORTAL_PRICING_URL = "https://www.colivingjb.com/pricing"

export const enquiryBrandGradientStyle: React.CSSProperties = {
  background: "linear-gradient(165deg, var(--brand) 0%, var(--brand-dark) 55%, var(--brand-dark) 100%)",
}

/** Left chocolate column — “Hello, Friend!” / primary CTA slot (button or Link). */
export function EnquiryMarketingSigninColumn({ footerPrimary }: { footerPrimary: React.ReactNode }) {
  return (
    <div
      className="flex h-auto min-h-0 md:h-full flex-col px-4 py-5 sm:px-10 sm:py-8 lg:px-14 lg:py-12 text-white overflow-hidden"
      style={enquiryBrandGradientStyle}
    >
      <div className="flex min-h-0 flex-1 flex-col max-w-xl md:min-h-0">
        <p className="text-[10px] sm:text-xs font-bold tracking-[0.2em] uppercase mb-2 sm:mb-3 text-white/90">
          Get in Touch
        </p>
        <h1 className="text-xl sm:text-3xl lg:text-4xl font-black leading-snug sm:leading-tight mb-2 sm:mb-3 text-pretty">
          Interested in Our Platform?
        </h1>
        <p className="text-white/85 leading-relaxed mb-3 sm:mb-6 text-sm sm:text-base">
          Register now for a demo account.
        </p>
        <div className="mb-4 sm:mb-6 text-xs sm:text-sm max-md:grid max-md:grid-cols-1 max-md:gap-y-1.5">
          <p className="max-md:flex max-md:flex-wrap max-md:gap-x-2 max-md:items-baseline">
            <span className="text-white/70 shrink-0">Email</span>
            <a
              href="mailto:colivingmanagement@gmail.com"
              className="font-semibold text-white underline-offset-2 hover:underline break-all"
            >
              colivingmanagement@gmail.com
            </a>
          </p>
          <p className="max-md:flex max-md:flex-wrap max-md:gap-x-2 max-md:items-baseline">
            <span className="text-white/70 shrink-0">Phone</span>
            <a href="tel:+60198579627" className="font-semibold text-white underline-offset-2 hover:underline">
              60198579627
            </a>
          </p>
          <p className="max-md:flex max-md:flex-wrap max-md:gap-x-2 max-md:items-baseline">
            <span className="text-white/70 shrink-0 md:block">Office</span>
            <span className="font-semibold text-white md:block">Johor Bahru, Malaysia</span>
          </p>
        </div>
        <a
          href={ENQUIRY_PORTAL_PRICING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full sm:w-fit items-center justify-center gap-2 px-4 py-2.5 sm:px-5 rounded-xl border-2 border-white/80 font-semibold text-xs sm:text-sm text-white bg-white/10 hover:bg-white/20 transition-colors max-md:shadow-md"
        >
          View pricing table
        </a>
      </div>

      {/* Desktop only: tab bar below already switches sign in / create account on mobile */}
      <div className="hidden md:block shrink-0 pt-8 mt-auto border-t border-white/20 max-w-xl">
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
      className="flex h-auto min-h-0 md:h-full flex-col px-4 py-5 sm:px-10 sm:py-8 lg:px-14 lg:py-12 text-white overflow-hidden"
      style={enquiryBrandGradientStyle}
    >
      <div className="flex min-h-0 flex-1 flex-col max-w-xl md:min-h-0">
        <p className="text-[10px] sm:text-xs font-bold tracking-[0.2em] uppercase mb-2 sm:mb-3 text-white/90">
          Get in Touch
        </p>
        <h1 className="text-xl sm:text-3xl lg:text-4xl font-black leading-snug sm:leading-tight mb-2 sm:mb-3 text-pretty">
          Interested in Our Platform?
        </h1>
        <p className="text-white/85 leading-relaxed mb-3 sm:mb-6 text-sm sm:text-base">
          Register now for a demo account.
        </p>
        <div className="mb-4 sm:mb-6 text-xs sm:text-sm max-md:grid max-md:grid-cols-1 max-md:gap-y-1.5">
          <p className="max-md:flex max-md:flex-wrap max-md:gap-x-2 max-md:items-baseline">
            <span className="text-white/70 shrink-0">Email</span>
            <a
              href="mailto:colivingmanagement@gmail.com"
              className="font-semibold text-white underline-offset-2 hover:underline break-all"
            >
              colivingmanagement@gmail.com
            </a>
          </p>
          <p className="max-md:flex max-md:flex-wrap max-md:gap-x-2 max-md:items-baseline">
            <span className="text-white/70 shrink-0">Phone</span>
            <a href="tel:+60198579627" className="font-semibold text-white underline-offset-2 hover:underline">
              60198579627
            </a>
          </p>
          <p className="max-md:flex max-md:flex-wrap max-md:gap-x-2 max-md:items-baseline">
            <span className="text-white/70 shrink-0 md:block">Office</span>
            <span className="font-semibold text-white md:block">Johor Bahru, Malaysia</span>
          </p>
        </div>
        <a
          href={ENQUIRY_PORTAL_PRICING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full sm:w-fit items-center justify-center gap-2 px-4 py-2.5 sm:px-5 rounded-xl border-2 border-white/80 font-semibold text-xs sm:text-sm text-white bg-white/10 hover:bg-white/20 transition-colors max-md:shadow-md"
        >
          View pricing table
        </a>
      </div>

      <div className="hidden md:block shrink-0 pt-8 mt-auto border-t border-white/20 max-w-xl">
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
