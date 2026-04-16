"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import {
  EnquiryMarketingSigninColumn,
  EnquiryMarketingSignupColumn,
  ENQUIRY_MARKETING_OUTLINE_BTN_CLASS,
} from "@/components/enquiry-marketing-blocks"

type Page = "signin" | "signup"

/**
 * Enquiry auth: full-width split (no centered “card”); background half slides left ↔ right.
 */
export function EnquirySwapAuthLayout({
  signIn,
  signUp,
  /** Open Create Account first (e.g. `/enquiry?mode=signup`). */
  initialPage = "signin",
}: {
  signIn: React.ReactNode
  signUp: React.ReactNode
  initialPage?: Page
}) {
  const [page, setPage] = useState<Page>(initialPage)

  useEffect(() => {
    setPage(initialPage)
  }, [initialPage])

  const backgroundLayerSignin = (
    <EnquiryMarketingSigninColumn
      footerPrimary={
        <button type="button" onClick={() => setPage("signup")} className={ENQUIRY_MARKETING_OUTLINE_BTN_CLASS}>
          Sign up
        </button>
      }
    />
  )

  const backgroundLayerSignup = (
    <EnquiryMarketingSignupColumn
      footerPrimary={
        <button type="button" onClick={() => setPage("signin")} className={ENQUIRY_MARKETING_OUTLINE_BTN_CLASS}>
          Sign in
        </button>
      }
    />
  )

  const backgroundLayer = page === "signin" ? backgroundLayerSignin : backgroundLayerSignup

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full">
      {/* Mobile: stacked, full-width sections (no floating card) */}
      <div className="md:hidden flex flex-1 flex-col min-h-0 w-full divide-y divide-border overflow-y-auto overscroll-y-contain [webkit-overflow-scrolling:touch]">
        <div className="w-full shrink-0 bg-background">{backgroundLayer}</div>
        <div className="flex shrink-0 border-b border-border p-1 bg-muted/30">
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
        <div className="w-full shrink-0 bg-background px-4 py-8">
          <div className="w-full max-w-[360px] mx-auto">{page === "signin" ? signIn : signUp}</div>
        </div>
      </div>

      {/* Desktop: edge-to-edge split, fills area below header */}
      <div className="hidden md:flex relative w-full flex-1 min-h-0 overflow-hidden">
        <div
          className={cn(
            "absolute inset-y-0 z-[1] w-1/2 flex flex-col transition-[left] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
            page === "signin" ? "left-0" : "left-1/2"
          )}
        >
          {backgroundLayer}
        </div>

        <div
          className={cn(
            "absolute inset-y-0 right-0 z-[2] w-1/2 flex items-center justify-center px-8 lg:px-16 xl:px-24 py-8 bg-background overflow-hidden transition-opacity duration-300",
            page === "signin" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none invisible"
          )}
        >
          <div className="w-full max-w-[400px] min-h-0 max-h-full overflow-y-auto [scrollbar-gutter:stable] py-4">{signIn}</div>
        </div>

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
