import type { ComponentType } from "react"
import {
  User,
  Shield,
  LayoutGrid,
  Zap,
  FileText,
  CreditCard,
  Lock,
  BarChart3,
  Plug,
  Smartphone,
  Music,
  Coffee,
  TrendingUp,
  AlertTriangle,
  Building2,
} from "lucide-react"

/** Scroll sections only (excludes intro id). */
export type HomedemoScrollSlug =
  | "tenant"
  | "tenant-phone"
  | "owner-lounge"
  | "owner-phone"
  | "operator-office"
  | "operator-dashboard"
  | "living"
  | "summary"

export type HomedemoSlug = HomedemoScrollSlug

export interface HomedemoSection {
  slug: HomedemoScrollSlug
  title: string
  subtitle: string
  /** Shown when present; summary uses `pricingCta` instead. */
  portalHref?: string
  /** Primary CTA on summary — external pricing page. */
  pricingCta?: { href: string; label: string }
  bullets: { icon: ComponentType<{ className?: string; size?: number }>; text: string }[]
  accent: string
  sceneHue: string
  /** Short label for compact nav */
  navLabel: string
}

export const HOMEDEMO_INTRO = {
  id: "intro",
  headline: "Coliving Management",
  tagline: "One platform for tenants, owners, and operators.",
  scrollHint: "Scroll to walk the apartment — then the office.",
}

export const HOMEDEMO_SCROLL_SECTIONS: HomedemoSection[] = [
  {
    slug: "tenant",
    navLabel: "Tenant",
    title: "Tenant",
    subtitle: "A renter in the unit, phone in hand — bills, meters, and access without the spreadsheet chaos.",
    portalHref: "/tenant",
    accent: "from-violet-200/90 to-fuchsia-100/80",
    sceneHue: "#a78bfa",
    bullets: [
      { icon: User, text: "Tenant character in-room; next screen zooms to the app." },
      { icon: Smartphone, text: "One place for invoices, reminders, and payment status." },
      { icon: Lock, text: "Smart access and tenancy-aware permissions." },
    ],
  },
  {
    slug: "tenant-phone",
    navLabel: "Pay",
    title: "Pay on the phone",
    subtitle: "Tenant dashboard: see what’s due, pay online, and track status — no lost chat threads.",
    portalHref: "/tenant",
    accent: "from-violet-200/90 to-fuchsia-100/80",
    sceneHue: "#a78bfa",
    bullets: [
      { icon: CreditCard, text: "Online payments with clear invoice lines." },
      { icon: BarChart3, text: "Dashboard view: usage and approvals at a glance." },
      { icon: FileText, text: "Agreements and profile in one ledger." },
    ],
  },
  {
    slug: "owner-lounge",
    navLabel: "Owner",
    title: "Owner in the lounge",
    subtitle: "In the living room with music on — still in control from the phone.",
    portalHref: "/owner",
    accent: "from-sky-200/90 to-cyan-100/80",
    sceneHue: "#38bdf8",
    bullets: [
      { icon: Music, text: "Lounge scene: relaxed context, serious operations underneath." },
      { icon: Smartphone, text: "Next: pull into the owner app — reports, not guesswork." },
      { icon: Shield, text: "Transparency for payouts and property performance." },
    ],
  },
  {
    slug: "owner-phone",
    navLabel: "Reports",
    title: "Reports & upside",
    subtitle: "Owner phone: performance reports and clarity on revenue and costs.",
    portalHref: "/owner",
    accent: "from-sky-200/90 to-cyan-100/80",
    sceneHue: "#38bdf8",
    bullets: [
      { icon: TrendingUp, text: "Trends and revenue story — fewer spreadsheet fire drills." },
      { icon: BarChart3, text: "Cost and payout visibility where you need it." },
      { icon: FileText, text: "Agreements and versions without hunting PDFs." },
    ],
  },
  {
    slug: "operator-office",
    navLabel: "Ops office",
    title: "Operator — the office",
    subtitle: "Lights dim. You’re in the ops office — the owner’s coffee break before the dashboard deep dive.",
    portalHref: "/operator",
    accent: "from-amber-200/90 to-orange-100/80",
    sceneHue: "#fb923c",
    bullets: [
      { icon: Coffee, text: "Office environment: lead with people, not just tiles." },
      { icon: Building2, text: "From building ops to the same data your team lives in daily." },
      { icon: LayoutGrid, text: "Next screen: the operator dashboard." },
    ],
  },
  {
    slug: "operator-dashboard",
    navLabel: "Dashboard",
    title: "Operator dashboard",
    subtitle: "Properties, rooms, bookings, leases, billing, and roles — one workspace.",
    portalHref: "/operator",
    accent: "from-amber-200/90 to-orange-100/80",
    sceneHue: "#fb923c",
    bullets: [
      { icon: LayoutGrid, text: "Company, properties, rooms, meters, smart doors." },
      { icon: FileText, text: "Leases, invoices, deposits, expenses in one flow." },
      { icon: Plug, text: "Accounting handoff where your plan supports it." },
    ],
  },
  {
    slug: "living",
    navLabel: "Pain",
    title: "Without one stack",
    subtitle: "The pain points Coliving Management removes: scattered tools, opaque rent, and audit gaps.",
    accent: "from-rose-200/90 to-orange-100/80",
    sceneHue: "#fb7185",
    bullets: [
      { icon: AlertTriangle, text: "Rent and access tracked in chats and sheets." },
      { icon: AlertTriangle, text: "Owners and operators maintaining two truths." },
      { icon: AlertTriangle, text: "Scaling breaks when every room is a new exception." },
    ],
  },
  {
    slug: "summary",
    navLabel: "Summary",
    title: "Apartment to office — one product",
    subtitle: "Rent, leases, access, owner reports, and operator ops in one platform built for Malaysia & Singapore operations.",
    pricingCta: {
      href: "https://www.colivingjb.com/pricing",
      label: "View pricing",
    },
    accent: "from-stone-200/90 to-amber-100/80",
    sceneHue: "#d6d3d1",
    bullets: [
      { icon: Building2, text: "Tenant and owner experiences that stay in sync with operations." },
      { icon: LayoutGrid, text: "Operator workspace from vacancy to reconciled rent." },
      { icon: Zap, text: "Credits, meters, and integrations where your plan allows." },
    ],
  },
]

export const HOMEDEMO_SLUGS: HomedemoScrollSlug[] = HOMEDEMO_SCROLL_SECTIONS.map((s) => s.slug)

export function isHomedemoSlug(s: string): s is HomedemoScrollSlug {
  return (HOMEDEMO_SLUGS as string[]).includes(s)
}

/** @deprecated Use HOMEDEMO_SCROLL_SECTIONS */
export const HOMEDEMO_SECTIONS = HOMEDEMO_SCROLL_SECTIONS
