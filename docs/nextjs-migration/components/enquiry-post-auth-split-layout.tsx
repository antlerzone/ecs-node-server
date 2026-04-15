"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { EnquiryMarketingSigninColumn, ENQUIRY_MARKETING_OUTLINE_BTN_CLASS } from "@/components/enquiry-marketing-blocks"

/**
 * Same split as `/enquiry` auth (chocolate left + white right), without sign-in/sign-up swap — for e.g. Gov ID demo after login.
 */
export function EnquiryPostAuthSplitLayout({
  children,
  signupHref,
}: {
  children: ReactNode
  /** e.g. `/demologin?mode=signup` — same CTA as marketing “Sign up”. */
  signupHref: string
}) {
  const footerPrimary = (
    <Link href={signupHref} className={ENQUIRY_MARKETING_OUTLINE_BTN_CLASS}>
      Sign up
    </Link>
  )

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full">
      <div className="md:hidden flex flex-1 flex-col min-h-0 w-full divide-y divide-border">
        <div className="w-full bg-background">
          <EnquiryMarketingSigninColumn footerPrimary={footerPrimary} />
        </div>
        <div className="flex flex-1 min-h-0 w-full bg-background px-4 py-8 items-center justify-center">
          <div className="w-full max-w-[360px] min-h-0 max-h-full overflow-y-auto my-auto">{children}</div>
        </div>
      </div>

      <div className="hidden md:flex relative w-full flex-1 min-h-0 overflow-hidden">
        <div className="absolute inset-y-0 left-0 z-[1] w-1/2 flex flex-col">
          <EnquiryMarketingSigninColumn footerPrimary={footerPrimary} />
        </div>
        <div className="absolute inset-y-0 right-0 z-[2] w-1/2 flex items-center justify-center px-8 lg:px-16 xl:px-24 py-8 bg-background overflow-hidden">
          <div className="w-full max-w-[400px] min-h-0 max-h-full overflow-y-auto [scrollbar-gutter:stable] py-4">{children}</div>
        </div>
      </div>
    </div>
  )
}
