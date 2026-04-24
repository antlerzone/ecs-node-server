"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, Minus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { fetchClnPricingPlans, fetchClmAddonCatalog, type ClmAddonCatalogItem } from "@/lib/cleanlemon-api";
import { CLN_ADDON_CATALOG_FALLBACK } from "@/lib/types";
import { CleanlemonsMarketingLegalHeader } from "@/components/marketing/cleanlemons-marketing-legal-header";

/** Row label matched in useMemo / table rendering for dynamic prices */
const PLAN_PRICE_ROW_FEATURE = "Plan price (selected billing period)";

const PLAN_COLUMNS = [
  { id: "starter", name: "Starter", recommended: false, apiPlan: "starter" as const },
  { id: "growth", name: "Growth", recommended: true, apiPlan: "growth" as const },
  { id: "enterprise", name: "Enterprise", recommended: false, apiPlan: "enterprise" as const },
];

const PLAN_ROWS_STATIC: { feature: string; values: (string | number | boolean)[] }[] = [
  { feature: PLAN_PRICE_ROW_FEATURE, values: [600, 1200, 1800] },
  {
    feature: "Operator access",
    values: [
      "One operator account · one login email",
      "One operator account · one login email",
      "One operator account · one login email",
    ],
  },
  { feature: "Client & Property Management", values: [true, true, true] },
  { feature: "Task & Schedule Management", values: [true, true, true] },
  { feature: "Staff attendance & punch card", values: [true, true, true] },
  { feature: "Invoice & Payment Tracking", values: [true, true, true] },
  { feature: "Calendar-adjusted pricing", values: [true, true, true] },
  { feature: "AI-assisted job scheduling", values: [true, true, true] },
  { feature: "Agreement settings", values: [true, true, true] },
  { feature: "Invoice automation", values: [true, true, true] },
  { feature: "Payslip automation", values: [true, true, true] },
  { feature: "Marketing page", values: [true, true, true] },
  { feature: "Property settings", values: [true, true, true] },
  { feature: "Photo completion verification", values: [true, true, true] },
  { feature: "Client reporting", values: [true, true, true] },
  { feature: "Accounting integration (Bukku & Xero)", values: [false, true, true] },
  { feature: "KPI Settings", values: [false, false, true] },
  { feature: "Dobi management", values: [false, false, true] },
  { feature: "Driver management", values: [false, false, true] },
  { feature: "Customization (branding, fields & workflows)", values: [false, false, true] },
];

const PLAN_CHOICES_FALLBACK = [
  {
    id: "starter",
    name: "Starter",
    amount: 600,
    subtitle: "Best for small teams getting started",
  },
  {
    id: "growth",
    name: "Growth",
    amount: 1200,
    subtitle: "Accounting integration (Bukku & Xero) included",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    amount: 1800,
    subtitle: "KPI, Dobi & Driver, customization, priority support, custom reports",
  },
];

function TickOrDash({ value }: { value: boolean }) {
  return value ? (
    <Check size={18} className="text-primary shrink-0" strokeWidth={2.5} />
  ) : (
    <Minus size={18} className="text-muted-foreground/50 shrink-0" strokeWidth={2} />
  );
}

function renderPlanCellValue(
  val: string | number | boolean,
  row: { feature: string; values: (string | number | boolean)[] },
  billingPeriod: BillingPeriod
) {
  if (typeof val === "boolean") {
    return (
      <div className="flex justify-center w-full">
        <TickOrDash value={val} />
      </div>
    );
  }
  if (row.feature === PLAN_PRICE_ROW_FEATURE && typeof val === "number") {
    const periodLabel =
      billingPeriod === "yearly" ? "year" : billingPeriod === "quarterly" ? "quarter" : "month";
    return (
      <span className="font-semibold text-sm sm:text-base">
        RM {val.toLocaleString()}{" "}
        <span className="text-muted-foreground font-normal text-xs block sm:inline sm:text-sm">
          ({periodLabel} total, subscription)
        </span>
      </span>
    );
  }
  return <span className="text-sm text-right leading-snug max-w-[11rem]">{String(val)}</span>;
}

type CatalogMap = Record<string, { month: number; quarter: number; year: number }>;

function buildCatalogMap(items: NonNullable<Awaited<ReturnType<typeof fetchClnPricingPlans>>["items"]>): CatalogMap {
  const m: CatalogMap = {};
  for (const it of items) {
    const pc = String(it.planCode || "").toLowerCase();
    if (!["starter", "growth", "enterprise"].includes(pc)) continue;
    if (!m[pc]) m[pc] = { month: 0, quarter: 0, year: 0 };
    const iv = String(it.intervalCode || "").toLowerCase();
    const amt = Number(it.amountMyr || 0);
    if (iv === "month") m[pc].month = amt;
    else if (iv === "quarter") m[pc].quarter = amt;
    else if (iv === "year") m[pc].year = amt;
  }
  return m;
}

type BillingPeriod = "monthly" | "quarterly" | "yearly";

function periodAmounts(c: CatalogMap | null, apiPlan: "starter" | "growth" | "enterprise", fallback: { m: number; q: number; y: number }) {
  const row = c?.[apiPlan];
  const month = row?.month && row.month > 0 ? row.month : fallback.m;
  const quarter = row?.quarter && row.quarter > 0 ? row.quarter : fallback.q;
  const year = row?.year && row.year > 0 ? row.year : fallback.y;
  return { month, quarter, year };
}

function displayForPeriod(period: BillingPeriod, month: number, quarter: number, year: number) {
  if (period === "yearly") {
    return {
      bigPerMo: Math.round(year / 12),
      subLine: `${year.toLocaleString()}/year`,
      subPrefix: "RM ",
      periodTotal: year,
    };
  }
  if (period === "quarterly") {
    return {
      bigPerMo: Math.round(quarter / 3),
      subLine: `${quarter.toLocaleString()}/quarter`,
      subPrefix: "RM ",
      periodTotal: quarter,
    };
  }
  return {
    bigPerMo: month,
    subLine: `${month.toLocaleString()}/month`,
    subPrefix: "RM ",
    periodTotal: month,
  };
}

const FALLBACK_AMOUNTS: Record<string, { m: number; q: number; y: number }> = {
  starter: { m: 600, q: 1710, y: 5760 },
  growth: { m: 1200, q: 3420, y: 11520 },
  enterprise: { m: 1800, q: 5130, y: 17280 },
};

export default function PricingPage() {
  const [catalog, setCatalog] = useState<CatalogMap | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("yearly");
  const [addonCatalog, setAddonCatalog] = useState<ClmAddonCatalogItem[]>(
    () => CLN_ADDON_CATALOG_FALLBACK as unknown as ClmAddonCatalogItem[]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchClnPricingPlans();
      if (cancelled || !r?.ok || !r.items?.length) return;
      setCatalog(buildCatalogMap(r.items));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchClmAddonCatalog();
      if (cancelled || !r?.ok || !r.items?.length) return;
      setAddonCatalog(r.items);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const planChoices = useMemo(() => {
    return PLAN_CHOICES_FALLBACK.map((p, i) => {
      const col = PLAN_COLUMNS[i];
      const fb = FALLBACK_AMOUNTS[col.apiPlan] || { m: p.amount, q: p.amount * 3, y: p.amount * 12 };
      const { month, quarter, year } = periodAmounts(catalog, col.apiPlan, fb);
      const d = displayForPeriod(billingPeriod, month, quarter, year);
      const intervalParam = billingPeriod === "yearly" ? "year" : billingPeriod === "quarterly" ? "quarter" : "month";
      return {
        ...p,
        bigPerMo: d.bigPerMo,
        subLine: d.subLine,
        subPrefix: d.subPrefix,
        registerAmount: d.periodTotal,
        intervalParam,
      };
    });
  }, [catalog, billingPeriod]);

  const planRows = useMemo(() => {
    return PLAN_ROWS_STATIC.map((row) => {
      if (row.feature !== PLAN_PRICE_ROW_FEATURE) return row;
      const values = PLAN_COLUMNS.map((col, i) => {
        const fb = FALLBACK_AMOUNTS[col.apiPlan] || {
          m: PLAN_ROWS_STATIC[0].values[i] as number,
          q: (PLAN_ROWS_STATIC[0].values[i] as number) * 3,
          y: (PLAN_ROWS_STATIC[0].values[i] as number) * 12,
        };
        const { month, quarter, year } = periodAmounts(catalog, col.apiPlan, fb);
        const d = displayForPeriod(billingPeriod, month, quarter, year);
        return d.periodTotal;
      });
      return { ...row, values };
    });
  }, [catalog, billingPeriod]);

  return (
    <div className="min-h-screen bg-background">
      <CleanlemonsMarketingLegalHeader
        brandLine2="Pricing"
        badge={<span className="text-xs font-semibold tracking-widest uppercase text-primary">Malaysia Only · MYR</span>}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <section className="text-center mb-10">
          <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3 text-primary">SaaS Pricing</p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-foreground leading-tight text-pretty">
            Simple pricing for Malaysia operators
          </h1>
        </section>

        <section className="mb-14">
          <div className="flex justify-center mb-8">
            <Tabs
              value={billingPeriod}
              onValueChange={(v) => {
                if (v === "monthly" || v === "quarterly" || v === "yearly") setBillingPeriod(v);
              }}
              className="w-full max-w-md"
            >
              <TabsList className="grid w-full grid-cols-3 h-auto p-1">
                <TabsTrigger value="monthly" className="text-xs sm:text-sm">
                  Monthly
                </TabsTrigger>
                <TabsTrigger value="quarterly" className="text-xs sm:text-sm">
                  Quarterly
                </TabsTrigger>
                <TabsTrigger value="yearly" className="text-xs sm:text-sm gap-1">
                  Yearly
                  <Badge variant="secondary" className="hidden sm:inline-flex text-[10px] px-1.5 py-0">
                    Save
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {/* Mobile: one full-width card per plan — no horizontal table scroll */}
          <div className="md:hidden space-y-6 mb-8">
            {PLAN_COLUMNS.map((col, colIndex) => {
              const plan = planChoices[colIndex];
              return (
                <div
                  key={col.id}
                  className="rounded-2xl border border-border bg-card p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                    <p className="text-sm font-semibold text-primary uppercase tracking-wider">{plan.name}</p>
                    {col.recommended ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white bg-primary shrink-0">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="text-3xl font-bold text-foreground tracking-tight mb-1">
                    RM {plan.bigPerMo.toLocaleString()}
                    <span className="text-base font-semibold text-muted-foreground">/mo</span>
                  </p>
                  <p className="text-sm text-muted-foreground mb-2">
                    {plan.subPrefix}
                    {plan.subLine}
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">{plan.subtitle}</p>
                  <Link
                    href={`/register?plan=${encodeURIComponent(plan.name)}&amount=${plan.registerAmount}&interval=${plan.intervalParam}`}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold px-4 py-2.5 hover:opacity-90 transition-opacity mb-5"
                  >
                    Register & Select {plan.name}
                  </Link>
                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-3">
                      Plan features
                    </p>
                    <ul className="divide-y divide-border">
                      {planRows.map((row) => (
                        <li key={`${col.id}-${row.feature}`} className="flex gap-3 py-3 first:pt-0">
                          <span className="flex-1 min-w-0 text-sm text-foreground leading-snug">{row.feature}</span>
                          <span className="shrink-0 flex items-start justify-end pt-0.5">
                            {renderPlanCellValue(row.values[colIndex], row, billingPeriod)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: compact plan cards + comparison table */}
          <div className="hidden md:grid md:grid-cols-3 md:items-stretch gap-4 mb-8">
            {planChoices.map((plan) => (
              <div
                key={plan.id}
                className="flex h-full min-h-0 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm"
              >
                <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-2">{plan.name}</p>
                <p className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight mb-1">
                  RM {plan.bigPerMo.toLocaleString()}
                  <span className="text-base sm:text-lg font-semibold text-muted-foreground">/mo</span>
                </p>
                <p className="text-sm text-muted-foreground mb-3">
                  {plan.subPrefix}
                  {plan.subLine}
                </p>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{plan.subtitle}</p>
                <Link
                  href={`/register?plan=${encodeURIComponent(plan.name)}&amount=${plan.registerAmount}&interval=${plan.intervalParam}`}
                  className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold px-4 py-2.5 hover:opacity-90 transition-opacity"
                >
                  Register & Select {plan.name}
                </Link>
              </div>
            ))}
          </div>

          <div className="hidden md:block rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-[220px] min-w-[180px] py-4 px-4 font-semibold text-foreground bg-muted/30">
                    Plan features
                  </TableHead>
                  {PLAN_COLUMNS.map((col) => (
                    <TableHead
                      key={col.id}
                      className="min-w-[140px] py-4 px-3 text-center font-semibold text-foreground bg-muted/30"
                    >
                      <div className="flex flex-col items-center gap-1">
                        {col.recommended && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white bg-primary">
                            Recommended
                          </span>
                        )}
                        <span>{col.name}</span>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {planRows.map((row, idx) => (
                  <TableRow key={row.feature} className={idx % 2 === 1 ? "bg-muted/20" : undefined}>
                    <TableCell className="py-3 px-4 font-medium text-foreground align-top">{row.feature}</TableCell>
                    {row.values.map((val, i) => (
                      <TableCell key={`${row.feature}-${i}`} className="py-3 px-3 text-center align-top text-sm">
                        {renderPlanCellValue(val, row, billingPeriod)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="text-2xl font-bold text-foreground mb-6">Add-ons</h2>
          <div className="grid gap-3 md:hidden">
            {addonCatalog.map((addon) => (
              <div
                key={addon.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-sm"
              >
                <p className="font-semibold text-foreground leading-snug">{addon.title}</p>
                <p className="text-sm font-medium text-primary mt-2">
                  RM {addon.amountMyr.toLocaleString()} / year
                </p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  {addon.description || "—"}
                </p>
              </div>
            ))}
          </div>
          <div className="hidden md:block rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <Table containerClassName="overflow-x-auto">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="py-4 px-4 font-semibold">Module</TableHead>
                  <TableHead className="py-4 px-4 font-semibold w-[220px]">Price</TableHead>
                  <TableHead className="py-4 px-4 font-semibold">Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {addonCatalog.map((addon) => (
                  <TableRow key={addon.id}>
                    <TableCell className="py-3 px-4 font-medium">{addon.title}</TableCell>
                    <TableCell className="py-3 px-4 whitespace-nowrap">
                      RM {addon.amountMyr.toLocaleString()} / year
                    </TableCell>
                    <TableCell className="py-3 px-4 text-muted-foreground whitespace-normal">
                      {addon.description || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-8 sm:p-10">
          <h2 className="text-2xl font-bold text-foreground mb-4">Need help choosing a plan?</h2>
          <p className="text-muted-foreground mb-6">
            Tell us how you run operations and which integrations you need. We will recommend the right plan.
          </p>
          <Link
            href="/enquiry"
            className="inline-flex items-center gap-2 font-semibold text-sm tracking-widest uppercase px-6 py-3 rounded-full text-white bg-primary hover:opacity-90 transition-opacity"
          >
            Contact us
          </Link>
        </section>
      </main>
    </div>
  );
}
