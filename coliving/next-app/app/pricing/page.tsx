"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, Minus, Sparkles } from "lucide-react"
import { PricingPageHeader } from "@/components/marketing/pricing-page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Country = "MY" | "SG" | null

const CURRENCY: Record<NonNullable<Country>, { code: string; symbol: string }> = {
  MY: { code: "MYR", symbol: "RM" },
  SG: { code: "SGD", symbol: "SGD" },
}

const PLAN_COLUMNS = [
  { id: "starter", name: "Starter", recommended: false },
  { id: "seed", name: "Seed", recommended: false },
  { id: "grow", name: "Grow", recommended: true },
  { id: "prime", name: "Prime", recommended: false },
  { id: "elite", name: "Elite", recommended: false },
  { id: "enterprise", name: "Enterprise", recommended: false },
  { id: "enterprise-plus", name: "Enterprise Plus", recommended: false },
]

const PLAN_PRICES = [120, 350, 1200, 3600, 6000, 12000, 30000]

const PLAN_ROWS: { feature: string; values: (string | number | boolean)[] }[] = [
  { feature: "Plan price · credits valid 1 year", values: PLAN_PRICES },
  { feature: "Recommended Room", values: ["1", "1–2", "5–8", "15–25", "40–60", "80–120", "200+"] },
  { feature: "User Accounts Included", values: [1, 1, 1, 2, 2, 3, 4] },
  { feature: "Additional Users", values: ["+{cur}500 / user / year (max 10 users)", "+{cur}500", "+{cur}500", "+{cur}500", "+{cur}500", "+{cur}500", "+{cur}500"] },
  { feature: "Tenant Management", values: [true, true, true, true, true, true, true] },
  { feature: "Room & Property Management", values: [true, true, true, true, true, true, true] },
  { feature: "Rental Payment Tracking", values: [true, true, true, true, true, true, true] },
  { feature: "Agreement Management", values: [true, true, true, true, true, true, true] },
  { feature: "Payment Integration (Stripe & Xendit)", values: [true, true, true, true, true, true, true] },
  { feature: "Accounting Integration", values: [false, false, false, false, "foc", "foc", "foc"] },
  { feature: "3rd Party Integration", values: [false, false, false, false, true, true, true] },
]

/** Add-ons: amount for MY, amountSg for SG; if amountSg omitted, use amount for both. */
const ADDON_PRICES: { name: string; amount: number; amountSg?: number; suffix: string; desc: string }[] = [
  { name: "Extra User Access", amount: 500, suffix: "/ year per user", desc: "Additional user login (max 10 users)" },
  { name: "Bank Bulk Transfer System", amount: 2500, suffix: "/ year", desc: "Bulk bank payout automation (Admin function, MY PBE only)" },
  { name: "Smart Door Hardware (TTLock)", amount: 1000, amountSg: 380, suffix: "/ pcs", desc: "TTLock smart door / lock per piece" },
  { name: "Smart Door Installation", amount: 200, suffix: "/ pcs", desc: "Distance 20km from JB Town. No services in Singapore." },
  { name: "Smart Meter Cnyiot", amount: 150, amountSg: 100, suffix: "/ pcs", desc: "Cnyiot smart meter per piece" },
  { name: "Smart Meter Installation", amount: 250, suffix: "/ pcs", desc: "Distance 20km from JB Town. No services in Singapore. Not including extra wiring and DB cost; may incur extra charge depending on property wiring status." },
]

const ACCOUNTING_PARTNERS: { name: string; logo: string }[] = [
  { name: "Xero", logo: "/accounting/xero.svg" },
  { name: "Bukku", logo: "/accounting/bukku.svg" },
]

const USAGE_ROWS = [
  { usage: "Active Room", cost: "10 credits / room / month" },
  { usage: "Generate Agreement (system generated)", cost: "10 credits / agreement" },
  { usage: "Manual Agreement Upload", cost: "Free" },
  { usage: "Payment Processing (Stripe / Xendit)", cost: "Refer tables below" },
]

const CREDIT_VALUE_MY = [
  { currency: "RM2", credit: "1 flex credit (top-up base, smallest package)" },
  { currency: "RM20", credit: "10 flex credits" },
]

const CREDIT_VALUE_SG = [
  { currency: "SGD2", credit: "1 flex credit (top-up base, smallest package)" },
  { currency: "SGD20", credit: "10 flex credits" },
]

/** Side-by-side: Stripe | Xendit fees shown on this page (source of truth for operators). null = not offered. */
const FEE_COMPARISON_MY: { method: string; stripe: number | null; xendit: number | string | null }[] = [
  { method: "Credit card (local)", stripe: 4.5, xendit: 3 },
  { method: "Debit card (local)", stripe: 4.5, xendit: 2.2 },
  { method: "Credit / Debit card (foreign)", stripe: 5.5, xendit: 4 },
  { method: "FPX (online banking)", stripe: 4, xendit: "From RM 1.20 + 1%" },
  { method: "GrabPay", stripe: 4, xendit: 2.3 },
  { method: "Virtual account / bank transfer", stripe: null, xendit: 1.5 },
  { method: "Touch N Go / ShopeePay / WeChat Pay", stripe: null, xendit: 2.3 },
  { method: "Alipay", stripe: null, xendit: 2.5 },
  { method: "Alipay+", stripe: null, xendit: 4 },
]

/** Singapore: card, QR (PayNow), e-wallet; no bank transfer in table below. */
const FEE_COMPARISON_SG: { method: string; stripe: number | null; xendit: number | string | null }[] = [
  { method: "PayNow (QR)", stripe: 2.3, xendit: 2 },
  { method: "Credit / Debit card", stripe: 4.4, xendit: 4.3 },
  { method: "GrabPay", stripe: 4.3, xendit: 4 },
  { method: "WeChat Pay", stripe: null, xendit: 3 },
  { method: "eGIRO (direct debit)", stripe: null, xendit: 2.5 },
]

interface CreditPlanItem {
  id: string
  title: string
  sellingprice: number
  credit: number
}

/** Credit plans are fetched via Next API route (server calls ECS with auth). */
function getCreditPlansUrl(): string {
  return "/api/pricing/credit-plans"
}

function TickOrDash({ value }: { value: boolean }) {
  return value ? (
    <Check size={18} className="text-primary shrink-0" strokeWidth={2.5} />
  ) : (
    <Minus size={18} className="text-muted-foreground/50 shrink-0" strokeWidth={2} />
  )
}

type Role = "owner_own" | "owner_looking" | "operator" | null

export default function PricingPage() {
  const router = useRouter()
  const [country, setCountry] = useState<Country>(null)
  const [role, setRole] = useState<Role>(null)
  const [creditPlans, setCreditPlans] = useState<CreditPlanItem[]>([])
  const [creditPlansLoading, setCreditPlansLoading] = useState(false)

  const currency = country ? CURRENCY[country] : null

  useEffect(() => {
    if (!country) return
    setCreditPlansLoading(true)
    fetch(getCreditPlansUrl())
      .then((res) => res.json())
      .then((data: { ok?: boolean; items?: CreditPlanItem[] }) => {
        const items = data?.ok && Array.isArray(data.items) ? data.items : []
        setCreditPlans(items)
      })
      .catch(() => setCreditPlans([]))
      .finally(() => setCreditPlansLoading(false))
  }, [country])

  // Step 1: Choose country
  if (!country) {
    return (
      <div className="min-h-screen bg-background">
        <PricingPageHeader />
        <main className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3" style={{ color: "var(--brand)" }}>
            Pricing
          </p>
          <h1 className="text-3xl sm:text-4xl font-black text-foreground leading-tight mb-4">
            Choose your region
          </h1>
          <p className="text-muted-foreground mb-10">
            We’ll show pricing in your local currency.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setCountry("MY")}
              className="p-8 rounded-2xl border-2 border-border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left group"
            >
              <div className="text-2xl font-bold text-foreground mb-1">Malaysia</div>
              <div className="text-muted-foreground text-sm">View pricing in MYR (RM)</div>
            </button>
            <button
              type="button"
              onClick={() => setCountry("SG")}
              className="p-8 rounded-2xl border-2 border-border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left group"
            >
              <div className="text-2xl font-bold text-foreground mb-1">Singapore</div>
              <div className="text-muted-foreground text-sm">View pricing in SGD</div>
            </button>
          </div>
        </main>
      </div>
    )
  }

  // Step 2: Choose role – Owner manage own / Owner looking for operator → /proposal / Operator → pricing
  if (!role) {
    return (
      <div className="min-h-screen bg-background">
        <PricingPageHeader showChangeRegion onChangeRegion={() => setCountry(null)} />
        <main className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3" style={{ color: "var(--brand)" }}>
            Pricing · {CURRENCY[country].code}
          </p>
          <h1 className="text-3xl sm:text-4xl font-black text-foreground leading-tight mb-4">
            Who are you?
          </h1>
          <p className="text-muted-foreground mb-10">
            Choose the option that best describes you to see the right pricing.
          </p>
          <div className="grid grid-cols-1 gap-4">
            <button
              type="button"
              onClick={() => setRole("owner_own")}
              className="p-6 rounded-2xl border-2 border-border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left"
            >
              <div className="text-xl font-bold text-foreground mb-1">Owner manage own</div>
              <div className="text-muted-foreground text-sm">You manage your own property. View platform pricing.</div>
            </button>
            <button
              type="button"
              onClick={() => router.push("/proposal")}
              className="p-6 rounded-2xl border-2 border-border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left"
            >
              <div className="text-xl font-bold text-foreground mb-1">Owner looking for operator</div>
              <div className="text-muted-foreground text-sm">You need an operator to run your property. View our management & commission options.</div>
            </button>
            <button
              type="button"
              onClick={() => setRole("operator")}
              className="p-6 rounded-2xl border-2 border-border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left"
            >
              <div className="text-xl font-bold text-foreground mb-1">Operator</div>
              <div className="text-muted-foreground text-sm">You operate properties for owners. View platform pricing.</div>
            </button>
          </div>
        </main>
      </div>
    )
  }

  const cur = currency!.symbol
  const curCode = currency!.code

  return (
    <div className="min-h-screen bg-background">
      <PricingPageHeader
        badge={<span className="text-xs font-semibold tracking-widest uppercase text-primary">Pricing · {curCode}</span>}
        showChangeRegion
        onChangeRegion={() => {
          setRole(null)
          setCountry(null)
        }}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="text-center mb-14">
          <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3" style={{ color: "var(--brand)" }}>
            SaaS for Landlords & Operators
          </p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-foreground leading-tight mb-4 text-pretty">
            Pricing to suit all needs
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            All prices in <strong className="text-foreground">{curCode}</strong>. Pay the plan price to receive the same amount in credits, valid for 1 year. When your plan expires, purchase again to renew or upgrade.
          </p>
        </div>

        {/* Main plan comparison table */}
        <section className="mb-16">
          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="w-[220px] min-w-[180px] py-4 px-4 font-semibold text-foreground bg-muted/30">
                      Plan features
                    </TableHead>
                    {PLAN_COLUMNS.map((col) => (
                      <TableHead
                        key={col.id}
                        className="min-w-[100px] sm:min-w-[120px] py-4 px-3 text-center font-semibold text-foreground bg-muted/30"
                      >
                        <div className="flex flex-col items-center gap-1">
                          {col.recommended && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white" style={{ background: "var(--brand)" }}>
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
                  {PLAN_ROWS.map((row, idx) => (
                    <TableRow key={row.feature} className={idx % 2 === 1 ? "bg-muted/20" : undefined}>
                      <TableCell className="py-3 px-4 font-medium text-foreground align-top">
                        {row.feature}
                      </TableCell>
                      {row.values.map((val, i) => (
                        <TableCell key={i} className="py-3 px-3 text-center align-top text-sm">
                          {typeof val === "boolean" ? (
                            <div className="flex justify-center">
                              <TickOrDash value={val} />
                            </div>
                          ) : val === "foc" ? (
                            <span className="text-primary text-sm font-medium">✓ (FOC)</span>
                          ) : row.feature === "Plan price · credits valid 1 year" && typeof val === "number" ? (
                            <span className="font-semibold">{cur} {val.toLocaleString()} <span className="text-muted-foreground font-normal">({val} credits)</span></span>
                          ) : row.feature === "Additional Users" ? (
                            <span>{String(val).replace(/\{cur\}/g, cur)}</span>
                          ) : (
                            <span>{String(val)}</span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>

        {/* Special features */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <Sparkles size={22} style={{ color: "var(--brand)" }} />
            Special features
          </h2>
          <p className="text-muted-foreground mb-6">Optional capabilities for smarter metering and access control.</p>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-2">Parent Meter</h3>
              <p className="text-sm text-muted-foreground">
                Link one main meter (parent) to multiple room or sub-meters (children). The system automatically calculates shared usage (e.g. common areas) as parent usage minus total child usage. Supports Auto (readings from smart meters) or Manual (you enter the main bill). Split costs by percentage, equally, or by active rooms only. Works with Prepaid or Postpaid billing.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-2">Parent Smart Door</h3>
              <p className="text-sm text-muted-foreground">
                Connect a main door lock (parent) with multiple room locks (child locks). Manage access and passcodes from the parent lock; when you extend or update a tenant’s access, the same passcode can be applied to the main door and linked room doors. Ideal for coliving where one entrance leads to several rooms.
              </p>
            </div>
          </div>
        </section>

        {/* Accounting partner */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-foreground mb-6">Our accounting partner</h2>
          <p className="text-muted-foreground mb-6">Accounting integration supports:</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl">
            {ACCOUNTING_PARTNERS.map((partner) => (
              <div
                key={partner.name}
                className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-4 aspect-square text-center shadow-sm"
              >
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center sm:h-[72px] sm:w-[72px]">
                  <Image
                    src={partner.logo}
                    alt=""
                    width={72}
                    height={72}
                    className="h-full w-full object-contain"
                  />
                </div>
                <span className="text-sm font-semibold leading-tight text-foreground">{partner.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Add-On Modules */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <Sparkles size={22} style={{ color: "var(--brand)" }} />
            Add-On Modules
          </h2>
          <p className="text-muted-foreground mb-6">Optional modules that can be added to any plan.</p>
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="py-4 px-4 font-semibold">Add-On</TableHead>
                  <TableHead className="py-4 px-4 font-semibold w-[200px]">Price</TableHead>
                  <TableHead className="py-4 px-4 font-semibold">Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ADDON_PRICES.map((addon) => {
                  const amount = country === "SG" && addon.amountSg != null ? addon.amountSg : addon.amount
                  return (
                    <TableRow key={addon.name}>
                      <TableCell className="py-3 px-4 font-medium">{addon.name}</TableCell>
                      <TableCell className="py-3 px-4">{cur} {amount.toLocaleString()} {addon.suffix}</TableCell>
                      <TableCell className="py-3 px-4 text-muted-foreground">{addon.desc}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* Usage Credit System */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-foreground mb-6">Usage Credit System</h2>
          <p className="text-muted-foreground mb-6">Some operations consume system credits based on usage.</p>
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="py-4 px-4 font-semibold">Usage</TableHead>
                  <TableHead className="py-4 px-4 font-semibold">Credit Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {USAGE_ROWS.map((row) => (
                  <TableRow key={row.usage}>
                    <TableCell className="py-3 px-4 font-medium">{row.usage}</TableCell>
                    <TableCell className="py-3 px-4">{row.cost}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Payment gateway processing fees — table on this page is authoritative */}
          <div className="mt-10">
            <h3 className="text-xl font-bold text-foreground mb-2">Payment gateway processing fees</h3>
            <p className="text-muted-foreground mb-4">
              We support <strong className="text-foreground">Stripe</strong> or <strong className="text-foreground">Xendit</strong> — one payment gateway per company.{" "}
              When tenants pay rent through the platform, <strong className="text-foreground">you receive the net amount after payment processing fees</strong> according to the rates in the table below.{" "}
              Tenant rent collections are <strong className="text-foreground">not</strong> deducted from your subscription credits.
            </p>
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="py-4 px-4 font-semibold">Payment method</TableHead>
                    <TableHead className="py-4 px-4 font-semibold w-[120px] text-right">Stripe</TableHead>
                    <TableHead className="py-4 px-4 font-semibold w-[120px] text-right">Xendit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(country === "MY" ? FEE_COMPARISON_MY : FEE_COMPARISON_SG).map((row) => (
                    <TableRow key={row.method}>
                      <TableCell className="py-3 px-4 font-medium">{row.method}</TableCell>
                      <TableCell className="py-3 px-4 text-right font-semibold">
                        {row.stripe != null ? `${row.stripe}%` : "—"}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-right font-semibold">
                        {row.xendit != null ? (typeof row.xendit === "number" ? `${row.xendit}%` : row.xendit) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              The table above is the reference for fees on this platform ({country === "MY" ? "Malaysia · MYR" : "Singapore · SGD"}). Rates may be updated from time to time; the table will be revised when they change.{" "}
              If you are an operator in Singapore, you have to purchase the Singapore package.
            </p>
          </div>
        </section>

        {/* Credit Value – Core 1:1; Flex from creditplan, no expiry */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-foreground mb-6">Credit Value</h2>
          <div className="space-y-4 mb-6">
            <p className="text-muted-foreground">
              <strong className="text-foreground">Core credit</strong> — From your pricing plan subscription, valid for 1 year. 1:1 (e.g. {country === "MY" ? "RM1 = 1 credit" : "SGD1 = 1 credit"}).
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Flex credit</strong> — No expiry. Top-up packages from the table below (e.g. {country === "MY" ? "RM1,800 → 2,000 credits; RM850 → 1,000; RM160 → 200" : "SGD equivalent bundles"}).
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card overflow-hidden max-w-md">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="py-4 px-4 font-semibold">Currency</TableHead>
                  <TableHead className="py-4 px-4 font-semibold">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(country === "MY" ? CREDIT_VALUE_MY : CREDIT_VALUE_SG).map((row) => (
                  <TableRow key={row.currency}>
                    <TableCell className="py-3 px-4 font-medium">{row.currency}</TableCell>
                    <TableCell className="py-3 px-4">{row.credit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* Flex Credits – from creditplan table (credit, sellingprice, title) */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-foreground mb-6">Top Up Credit</h2>
          <p className="text-muted-foreground mb-4">
            Optional credit top-up packages. We may run promotions (e.g. 1 flex credit = 1 {curCode}).
          </p>
          {creditPlansLoading ? (
            <div className="rounded-xl border border-border bg-muted/10 p-6 text-center text-muted-foreground text-sm">Loading…</div>
          ) : creditPlans.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/10 p-5 max-w-md">
              <p className="text-sm text-muted-foreground">No credit packages configured. Pricing may vary with promotions.</p>
              <p className="text-xs text-muted-foreground mt-2">Credit purchases are final: no refunds, no exchanges. See our <Link href="/refund-policy" className="text-primary font-medium hover:underline">Refund Policy</Link>.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card overflow-hidden max-w-lg">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="py-4 px-4 font-semibold w-[120px] text-right">Credit</TableHead>
                    <TableHead className="py-4 px-4 font-semibold w-[140px] text-right">Selling price</TableHead>
                    <TableHead className="py-4 px-4 font-semibold">Title</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creditPlans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="py-3 px-4 text-right font-medium">{Number(plan.credit)}</TableCell>
                      <TableCell className="py-3 px-4 text-right">{cur} {Number(plan.sellingprice).toLocaleString()}</TableCell>
                      <TableCell className="py-3 px-4 text-muted-foreground">{plan.title || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground p-4 border-t border-border italic">
                We may run promotions (e.g. 1 flex credit = 1 {curCode}). Credit plan and top-up purchases are final: no refunds, no exchanges. See our{" "}
                <Link href="/refund-policy" className="text-primary font-medium hover:underline">Refund Policy</Link>.
              </p>
            </div>
          )}
        </section>

        {/* What Makes This Different */}
        <section className="rounded-2xl border border-border bg-card p-8 sm:p-10">
          <h2 className="text-2xl font-bold text-foreground mb-6">What Makes This Pricing Model Different</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            Our SaaS model combines three revenue streams: <strong className="text-foreground">annual subscription plans</strong>, a <strong className="text-foreground">usage-based credit system</strong>, and <strong className="text-foreground">payment processing margin</strong>. This allows operators to scale from 1 unit to 200+ units without changing platforms.
          </p>
          <Link
            href="/enquiry"
            className="inline-flex items-center gap-2 font-semibold text-sm tracking-widest uppercase px-6 py-3 rounded-full text-white hover:opacity-90 transition-opacity"
            style={{ background: "var(--brand)" }}
          >
            Get in touch
          </Link>
        </section>
      </main>
    </div>
  )
}
