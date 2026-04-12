/**
 * Subscription gates for operator portal (`cln_operator_subscription.plan_code`).
 * Keep in sync with `canonicalSubscriptionPlanCode` in `src/modules/cleanlemon/cleanlemon.service.js`.
 */
export type CanonicalOperatorPlan = "starter" | "growth" | "enterprise"

/**
 * Maps DB / API plan codes to a single canonical tier. Unknown or empty values return `null`
 * (do not guess Enterprise — that caused UI to show Enterprise while nav gates stayed off).
 */
export function canonicalOperatorPlanCode(
  planCode: string | undefined | null
): CanonicalOperatorPlan | null {
  const x = String(planCode ?? "")
    .trim()
    .toLowerCase()
  if (!x) return null
  if (x === "basic" || x === "starter") return "starter"
  if (x === "grow" || x === "growth") return "growth"
  if (x === "scale" || x === "enterprise") return "enterprise"
  return null
}

/** Accounting: Growth & Enterprise only (not Starter). */
export function planAllowsAccounting(planCode: string | undefined | null): boolean {
  const c = canonicalOperatorPlanCode(planCode)
  return c === "growth" || c === "enterprise"
}
