"use client"

import { useEffect, useState } from "react"
import type { User } from "./auth-context"
import { CLEANLEMONS_ACTIVE_OPERATOR_ID_KEY } from "./cleanlemon-portal-constants"

const DEMO_FALLBACK = "op_demo_001"

/**
 * Same operator scope as OAuth callback + operator layout switcher:
 * prefer auth user, then legacy `cleanlemons_active_operator_id`, then `cleanlemons_user.operatorId`.
 * Avoids invoice/contact APIs querying under `op_demo_001` while real data is under `cln_operatordetail.id`.
 */
export function getEffectiveOperatorId(user: User | null | undefined, fallback = DEMO_FALLBACK): string {
  const fromUser = String(user?.operatorId ?? "").trim()
  if (fromUser) return fromUser
  if (typeof window === "undefined") return fallback
  try {
    const active = localStorage.getItem(CLEANLEMONS_ACTIVE_OPERATOR_ID_KEY)?.trim()
    if (active) return active
    const raw = localStorage.getItem("cleanlemons_user")
    if (raw) {
      const parsed = JSON.parse(raw) as { operatorId?: string }
      const fromStored = String(parsed?.operatorId ?? "").trim()
      if (fromStored) return fromStored
    }
  } catch {
    /* ignore */
  }
  return fallback
}

/** Re-resolve after auth hydrates from localStorage (first paint may be stale). */
export function useEffectiveOperatorId(user: User | null | undefined): string {
  const [operatorId, setOperatorId] = useState(() => getEffectiveOperatorId(user))

  useEffect(() => {
    setOperatorId(getEffectiveOperatorId(user))
  }, [user?.operatorId, user?.email, user])

  return operatorId
}
