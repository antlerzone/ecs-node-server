"use client"

import Image from "next/image"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { buildGovIdStartUrl } from "@/lib/unified-profile-portal-api"
import { PORTAL_KEYS, getMember } from "@/lib/portal-session"
import { cn } from "@/lib/utils"

export function GovIdConnectButtons({
  returnPath = "/demologin",
  disabled,
  className,
  /** `stacked`: under email/social form. `solo`: dashboard — buttons only, no top divider. */
  variant = "stacked",
  /** `enquiry`: white buttons + official wordmarks (matches Google/Facebook row). `fill`: solid brand buttons (e.g. demologin). */
  appearance = "fill",
  /** When already linked on this portal account, disable starting the same IdP again (Gov ID exclusivity). */
  singpassLinked,
  mydigitalLinked,
}: {
  returnPath?: string
  disabled?: boolean
  className?: string
  variant?: "stacked" | "solo"
  appearance?: "enquiry" | "fill"
  singpassLinked?: boolean
  mydigitalLinked?: boolean
}) {
  const start = (provider: "singpass" | "mydigital") => {
    if (disabled) return
    const jwt = typeof window !== "undefined" ? localStorage.getItem(PORTAL_KEYS.PORTAL_JWT) : null
    if (!getMember()?.email || !jwt) {
      toast.info(
        provider === "singpass"
          ? "Sign in first, then use Retrieve Myinfo with Singpass."
          : "Sign in with email or Google / Facebook first, then connect MyDigital ID."
      )
      return
    }
    if (provider === "singpass") {
      const url = buildGovIdStartUrl("singpass", returnPath)
      if (!url) {
        toast.error("Could not start Singpass. Check NEXT_PUBLIC_ECS_BASE_URL.")
        return
      }
      window.location.href = url
      return
    }
    const url = buildGovIdStartUrl("mydigital", returnPath)
    if (!url) {
      toast.error("Could not start connection. Check API configuration.")
      return
    }
    window.location.href = url
  }

  const showDivider = variant === "stacked"
  const enquiry = appearance === "enquiry"

  return (
    <div className={className}>
      {showDivider ? (
        <div className="relative my-4">
          <span className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </span>
          <span className="relative flex justify-center text-xs uppercase text-muted-foreground bg-background px-2">
            Or government ID
          </span>
        </div>
      ) : null}

      <div className="space-y-3">
        {/* MyDigital ID */}
        <Button
          type="button"
          variant="outline"
          disabled={disabled || mydigitalLinked}
          className={cn(
            "w-full gap-3 shadow-sm justify-start",
            enquiry ? "h-11 rounded-full border-border bg-white hover:bg-muted/50 pl-3 pr-4" : "h-[52px] rounded-full border-0 bg-[#0057b8] text-white hover:bg-[#004a9e] hover:text-white pl-4 pr-5"
          )}
          onClick={() => start("mydigital")}
        >
          {enquiry ? (
            <>
              <span className="relative h-8 shrink-0 flex items-center min-w-0 max-w-[46%]">
                <Image
                  src="/gov-id/mydigital-wordmark.png"
                  alt=""
                  width={140}
                  height={32}
                  className="h-8 w-auto max-w-full object-contain object-left"
                />
              </span>
              <span className="text-sm font-semibold text-foreground text-left leading-tight">Log in with MyDigital ID</span>
            </>
          ) : (
            <>
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/95 p-1">
                <Image
                  src="/gov-id/mydigital-wordmark.png"
                  alt=""
                  width={80}
                  height={32}
                  className="max-h-full max-w-full object-contain"
                />
              </span>
              <span className="flex flex-col items-start text-left min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/85 leading-none mb-0.5">MyDigital ID</span>
                <span className="text-sm font-semibold leading-tight">Log in with MyDigital ID</span>
              </span>
            </>
          )}
        </Button>

        {/* Singpass */}
        <Button
          type="button"
          variant="outline"
          disabled={disabled || singpassLinked}
          className={cn(
            "w-full gap-3 shadow-sm justify-start",
            enquiry
              ? "h-11 rounded-full border-border bg-white hover:bg-muted/50 pl-3 pr-4"
              : "h-[52px] rounded-full border-0 bg-[#e30613] text-white hover:bg-[#cc0511] hover:text-white pl-4 pr-5"
          )}
          onClick={() => start("singpass")}
        >
          {enquiry ? (
            <>
              <span className="relative h-8 shrink-0 flex items-center min-w-0 max-w-[46%]">
                <Image
                  src="/gov-id/singpass-wordmark.png"
                  alt=""
                  width={120}
                  height={28}
                  className="h-7 w-auto max-w-full object-contain object-left"
                />
              </span>
              <span className="text-sm font-semibold text-foreground text-left leading-tight">
                Retrieve Myinfo with Singpass
              </span>
            </>
          ) : (
            <>
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/95 p-1">
                <Image
                  src="/gov-id/singpass-wordmark.png"
                  alt=""
                  width={72}
                  height={28}
                  className="max-h-full max-w-full object-contain"
                />
              </span>
              <span className="flex flex-col items-start text-left min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/85 leading-none mb-0.5">Singapore</span>
                <span className="text-sm font-semibold leading-tight">Retrieve Myinfo with Singpass</span>
              </span>
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
