"use client"

import { useEffect, useState } from "react"
import { tenantPortalImgSrc } from "@/lib/utils"

function avatarDisplaySrc(raw: string): string {
  const ecsBase = process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com"
  return tenantPortalImgSrc(raw, ecsBase)
}

type Props = {
  /** Stored URL (DB / profile.avatar_url) */
  avatarUrl?: string | null
  /** Shown when no URL or image fails */
  initials: string
  title?: string
  className?: string
  textClassName?: string
}

/**
 * Tenant profile photo or initials — direct OSS URL in img (same as NRIC), no proxy.
 */
export function TenantAvatarCircle({
  avatarUrl,
  initials,
  title,
  className = "w-9 h-9 rounded-full text-sm",
  textClassName = "text-sm font-bold",
}: Props) {
  const raw = typeof avatarUrl === "string" ? avatarUrl.trim() : ""
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [raw])
  const src = raw && !failed ? avatarDisplaySrc(raw) : ""

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden text-white ${className}`}
      style={{ background: "var(--brand)" }}
      title={title}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={textClassName}>{initials}</span>
      )}
    </div>
  )
}
