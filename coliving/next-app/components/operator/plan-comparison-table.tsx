"use client"

import type { ReactNode } from "react"
import { CheckCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type PlanRow = { id: string; title: string; sellingprice?: number; corecredit?: number }

type PlanTier =
  | "starter"
  | "seed"
  | "grow"
  | "prime"
  | "elite"
  | "enterprise"
  | "enterprise_plus"
  | "unknown"

function inferPlanTier(title: string): PlanTier {
  const t = String(title || "").toLowerCase()
  if (t.includes("enterprise plus")) return "enterprise_plus"
  if (t.includes("enterprise")) return "enterprise"
  if (t.includes("elite")) return "elite"
  if (t.includes("prime")) return "prime"
  if (t.includes("grow")) return "grow"
  if (t.includes("seed")) return "seed"
  if (t.includes("starter")) return "starter"
  return "unknown"
}

function formatPlanMoney(currency: string, amount: number): string {
  const c = String(currency || "").toUpperCase()
  const n = Number(amount) || 0
  const formatted = n.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  if (c === "MYR") return `RM ${formatted}`
  if (c === "SGD") return `S$ ${formatted}`
  return `${c} ${formatted}`
}

function additionalUsersLabel(currency: string, tier: PlanTier): string {
  const c = String(currency || "").toUpperCase()
  const sym = c === "MYR" ? "RM" : c === "SGD" ? "S$" : c
  const unit = sym.length <= 3 ? `+${sym}500` : `+500 ${c}`
  if (tier === "starter") return `${unit} / user / year (max 10 users)`
  if (tier === "unknown") return "—"
  return unit
}

const TIER_CAPACITY: Record<
  PlanTier,
  { rooms: string; usersIncluded: string; recommended?: boolean; accounting: boolean; thirdParty: boolean }
> = {
  starter: {
    rooms: "1",
    usersIncluded: "1",
    accounting: false,
    thirdParty: false,
  },
  seed: {
    rooms: "1–2",
    usersIncluded: "1",
    accounting: false,
    thirdParty: false,
  },
  grow: {
    rooms: "5–8",
    usersIncluded: "1",
    recommended: true,
    accounting: false,
    thirdParty: false,
  },
  prime: {
    rooms: "15–25",
    usersIncluded: "2",
    accounting: false,
    thirdParty: false,
  },
  elite: {
    rooms: "25–50",
    usersIncluded: "2",
    accounting: true,
    thirdParty: true,
  },
  enterprise: {
    rooms: "50–100",
    usersIncluded: "3",
    accounting: true,
    thirdParty: true,
  },
  enterprise_plus: {
    rooms: "100+",
    usersIncluded: "3",
    accounting: true,
    thirdParty: true,
  },
  unknown: {
    rooms: "—",
    usersIncluded: "—",
    accounting: false,
    thirdParty: false,
  },
}

function CellCheck({ included }: { included: boolean }) {
  if (included) {
    return <span className="text-green-600 font-semibold" aria-label="Included">✓</span>
  }
  return <span className="text-muted-foreground">—</span>
}

export interface PlanComparisonTableProps {
  plans: PlanRow[]
  currency: string
  currentPlanId: string | null
  selectedPlanId: string | null
  onSelectPlan: (planId: string) => void
}

export function PlanComparisonTable({
  plans,
  currency,
  currentPlanId,
  selectedPlanId,
  onSelectPlan,
}: PlanComparisonTableProps) {
  if (plans.length === 0) {
    return <p className="text-sm text-muted-foreground">No plans available.</p>
  }

  /** Full-column highlight: same bg + vertical borders on every cell in that plan column */
  function columnHighlightClass(planId: string) {
    const isSelected = planId === selectedPlanId
    const isCurrentOnly = planId === currentPlanId && !isSelected
    return cn(
      "transition-colors",
      isSelected && "bg-primary/10 dark:bg-primary/20 border-l-2 border-r-2 border-primary",
      isCurrentOnly && "bg-green-50/90 dark:bg-green-950/30 border-l-2 border-r-2 border-green-600/45",
    )
  }

  const featureRows: { label: string; render: (tier: PlanTier) => ReactNode }[] = [
    { label: "Tenant Management", render: () => <CellCheck included /> },
    { label: "Room & Property Management", render: () => <CellCheck included /> },
    { label: "Rental Payment Tracking", render: () => <CellCheck included /> },
    { label: "Agreement Management", render: () => <CellCheck included /> },
    { label: "Payment Integration (Stripe & Xendit)", render: () => <CellCheck included /> },
    {
      label: "Accounting Integration",
      render: (t) => <CellCheck included={TIER_CAPACITY[t].accounting} />,
    },
    {
      label: "3rd Party Integration",
      render: (t) => <CellCheck included={TIER_CAPACITY[t].thirdParty} />,
    },
  ]

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-5 md:px-6 border-b border-border bg-muted/20">
        <h3 className="text-center text-xl font-bold tracking-tight">Pricing to suit all needs</h3>
        <p className="text-center text-sm text-muted-foreground mt-2 max-w-2xl mx-auto">
          All prices in <strong>{String(currency || "MYR").toUpperCase()}</strong>. Pay the plan price to receive the same
          amount in credits, valid for 1 year. When your plan expires, purchase again to renew or upgrade.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="sticky left-0 z-20 bg-card text-left py-3 px-3 md:px-4 font-semibold text-muted-foreground align-bottom min-w-[160px] shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]"
              >
                Plan features
              </th>
              {plans.map((plan) => {
                const tier = inferPlanTier(plan.title)
                const isCurrent = plan.id === currentPlanId
                const isSelected = plan.id === selectedPlanId
                return (
                  <th
                    key={plan.id}
                    scope="col"
                    className={cn(
                      "py-3 px-2 md:px-3 text-center align-bottom min-w-[120px] cursor-pointer select-none",
                      columnHighlightClass(plan.id),
                    )}
                    onClick={() => onSelectPlan(plan.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onSelectPlan(plan.id)
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-pressed={isSelected}
                    aria-label={`Select ${plan.title}`}
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      {TIER_CAPACITY[tier].recommended && (
                        <Badge
                          className="text-[10px] px-2 py-0 h-5 font-semibold uppercase tracking-wide"
                          style={{ background: "var(--brand)", color: "var(--brand-foreground, #fff)" }}
                        >
                          Recommended
                        </Badge>
                      )}
                      <span className="font-bold text-foreground leading-tight">{plan.title}</span>
                      {isCurrent && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-green-700 dark:text-green-400">
                          <CheckCircle size={12} className="shrink-0" />
                          Current
                        </span>
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border bg-muted/10">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-muted/10 text-left py-3 px-3 md:px-4 font-medium text-foreground shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]"
              >
                Plan price — credits valid 1 year
              </th>
              {plans.map((plan) => {
                return (
                  <td
                    key={plan.id}
                    className={cn(
                      "py-3 px-2 text-center align-top cursor-pointer",
                      columnHighlightClass(plan.id),
                    )}
                    onClick={() => onSelectPlan(plan.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onSelectPlan(plan.id)
                      }
                    }}
                    aria-label={`Select ${plan.title} at ${formatPlanMoney(currency, plan.sellingprice ?? 0)}`}
                  >
                    <div className="font-bold text-foreground">
                      {formatPlanMoney(currency, plan.sellingprice ?? 0)}
                    </div>
                    <div className="text-muted-foreground text-xs mt-0.5">
                      ({Number(plan.corecredit ?? 0).toLocaleString("en-MY")} credits)
                    </div>
                    {plan.id === currentPlanId && (
                      <div className="text-[11px] text-amber-800 dark:text-amber-200 font-medium mt-1">Renew only</div>
                    )}
                  </td>
                )
              })}
            </tr>
            <tr className="border-b border-border">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card text-left py-2.5 px-3 md:px-4 font-normal text-muted-foreground shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]"
              >
                Recommended room
              </th>
              {plans.map((plan) => (
                <td
                  key={plan.id}
                  className={cn(
                    "py-2.5 px-2 text-center text-foreground cursor-pointer",
                    columnHighlightClass(plan.id),
                  )}
                  onClick={() => onSelectPlan(plan.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSelectPlan(plan.id)
                    }
                  }}
                  aria-label={`Select ${plan.title}`}
                >
                  {TIER_CAPACITY[inferPlanTier(plan.title)].rooms}
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card text-left py-2.5 px-3 md:px-4 font-normal text-muted-foreground shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]"
              >
                User accounts included
              </th>
              {plans.map((plan) => (
                <td
                  key={plan.id}
                  className={cn(
                    "py-2.5 px-2 text-center text-foreground cursor-pointer",
                    columnHighlightClass(plan.id),
                  )}
                  onClick={() => onSelectPlan(plan.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSelectPlan(plan.id)
                    }
                  }}
                  aria-label={`Select ${plan.title}`}
                >
                  {TIER_CAPACITY[inferPlanTier(plan.title)].usersIncluded}
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card text-left py-2.5 px-3 md:px-4 font-normal text-muted-foreground shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]"
              >
                Additional users
              </th>
              {plans.map((plan) => {
                const tier = inferPlanTier(plan.title)
                return (
                  <td
                    key={plan.id}
                    className={cn(
                      "py-2.5 px-2 text-center text-foreground text-xs leading-snug cursor-pointer",
                      columnHighlightClass(plan.id),
                    )}
                    onClick={() => onSelectPlan(plan.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onSelectPlan(plan.id)
                      }
                    }}
                    aria-label={`Select ${plan.title}`}
                  >
                    {additionalUsersLabel(currency, tier)}
                  </td>
                )
              })}
            </tr>
            {featureRows.map((row) => (
              <tr key={row.label} className="border-b border-border last:border-b-0">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card text-left py-2.5 px-3 md:px-4 font-normal text-foreground shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]"
                >
                  {row.label}
                </th>
                {plans.map((plan) => (
                  <td
                    key={plan.id}
                    className={cn("py-2.5 px-2 text-center cursor-pointer", columnHighlightClass(plan.id))}
                    onClick={() => onSelectPlan(plan.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onSelectPlan(plan.id)
                      }
                    }}
                    aria-label={`Select ${plan.title}`}
                  >
                    {row.render(inferPlanTier(plan.title))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground px-4 py-3 border-t border-border bg-muted/10">
        Tap anywhere in a plan column to select it. Room and user limits are a guide; add-ons apply as on the Add-ons
        section below.
      </p>
    </div>
  )
}
