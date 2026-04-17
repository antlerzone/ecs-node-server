"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

type PanelMode = "signin" | "signup"

const brandPanelStyle: React.CSSProperties = {
  background: "linear-gradient(165deg, var(--brand) 0%, var(--brand-dark) 55%, var(--brand-dark) 100%)",
}

/**
 * Sliding brand panel + left Sign In / right Sign Up.
 * Uses `globals.css` --brand / --brand-dark (not blue).
 * `defaultMode="signup"` → land on Create Account (overlay on the left).
 */
export function PortalSlidingAuthCard({
  defaultMode = "signin",
  signIn,
  signUp,
  className,
}: {
  defaultMode?: PanelMode
  signIn: React.ReactNode
  signUp: React.ReactNode
  className?: string
}) {
  const [mode, setMode] = useState<PanelMode>(defaultMode)
  const signup = mode === "signup"

  return (
    <div
      className={cn(
        "relative w-full max-w-[880px] mx-auto overflow-hidden rounded-[22px] bg-card border border-border shadow-[0_25px_50px_-12px_rgba(60,40,35,0.18)] flex flex-col",
        className
      )}
    >
      <div className="flex flex-1 min-h-[min(520px,80vh)] relative w-full">
        {/* Left: Sign In */}
        <section className="flex-1 flex flex-col items-center justify-center text-center px-6 sm:px-10 py-10 sm:py-12 z-[1] min-w-0 bg-[var(--brand-muted)]/50">
          {signIn}
        </section>

        {/* Right: Sign Up */}
        <section className="flex-1 flex flex-col items-center justify-center text-center px-6 sm:px-10 py-10 sm:py-12 z-[1] min-w-0 bg-[var(--brand-muted)]/50">
          {signUp}
        </section>

        {/* Sliding brand overlay */}
        <div
          className={cn(
            "absolute top-0 h-full w-1/2 z-[4] overflow-hidden transition-[left] duration-[650ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            signup ? "left-0 rounded-r-[22px]" : "left-1/2 rounded-l-[22px]"
          )}
        >
          <div
            className={cn(
              "flex h-full w-[200%] transition-transform duration-[650ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
              signup ? "translate-x-0" : "-translate-x-1/2"
            )}
          >
            <div
              className="flex-[0_0_50%] flex flex-col items-center justify-center px-6 sm:px-9 py-10 text-center text-white"
              style={brandPanelStyle}
            >
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Welcome Back!</h2>
              <p className="text-sm sm:text-[0.95rem] leading-relaxed opacity-95 max-w-[280px] mb-7">
                Enter your personal details to use all of site features
              </p>
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="px-9 py-2.5 rounded-full border-2 border-white/90 text-white text-xs font-bold tracking-[0.12em] uppercase hover:bg-white/15 transition-colors"
              >
                Sign in
              </button>
            </div>
            <div
              className="flex-[0_0_50%] flex flex-col items-center justify-center px-6 sm:px-9 py-10 text-center text-white"
              style={brandPanelStyle}
            >
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Hello, Friend!</h2>
              <p className="text-sm sm:text-[0.95rem] leading-relaxed opacity-95 max-w-[280px] mb-7">
                Register with your personal details to use all of site features
              </p>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="px-9 py-2.5 rounded-full border-2 border-white/90 text-white text-xs font-bold tracking-[0.12em] uppercase hover:bg-white/15 transition-colors"
              >
                Sign up
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
