"use client"

import { useEffect, useMemo } from "react"
import Link from "next/link"
import { ArrowRight, Building2, Users, Zap, Lock, BarChart3, Clock, CheckCircle2 } from "lucide-react"
import { motion, useReducedMotion } from "framer-motion"
import { CampaignHero } from "@/components/marketing/campaign-hero"
import { StickyPhoneScrollSection, type ScrollStep } from "@/components/marketing/sticky-phone-scroll"
import { MarketingNavbar } from "@/components/marketing/navbar"
import { MarketingFooter } from "@/components/marketing/footer"
import { StatsSection } from "@/components/marketing/stats-section"
import { WaterRippleSectionBg } from "@/components/marketing/water-ripple-section-bg"

/** Section 3 phone screenshots: ECS streams from private OSS → /api/homedemo-screenshot (same-origin). */
function homedemoShots(...files: string[]) {
  return files.map((f) => `/api/homedemo-screenshot?file=${encodeURIComponent(f)}`)
}

/** Section 3：`segmentVh` 每步軌道權重（再減半，相對上一版 1）。 */
const HOMEDEMO_SCROLL_UNITS = 0.5

const platformSteps: ScrollStep[] = [
  {
    id: "operator-dashboard",
    headline: "Operator Dashboard",
    body: "Manage all your properties from one place. Track occupancy, pending tasks, maintenance requests, and tenant communications in real-time.",
    screenshot: homedemoShots("step-1.jpeg", "step-1-2.jpeg", "step-2-2.jpeg"),
    bgGradient: "linear-gradient(135deg, #faf8f7 0%, #f3eeec 50%, #e8dcd7 100%)",
  },
  {
    id: "tenant-portal",
    headline: "Tenant Portal",
    body: "Give tenants a seamless self-service experience. Smart door access, meter balance top-ups, rent payments, and maintenance requests - all in one app.",
    screenshot: homedemoShots("step-2.jpeg", "step-2-1.jpeg", "step-2-3.jpeg", "step-2-4.jpeg", "step-2-5.jpeg"),
    bgGradient: "linear-gradient(135deg, #e8dcd7 0%, #d4c4bc 50%, #c9b8ae 100%)",
  },
  {
    id: "owner-portal",
    headline: "Owner Portal",
    body: "Keep property owners informed with transparent reporting. Rental income summaries, payout history, and property performance metrics at their fingertips.",
    screenshot: homedemoShots("step-3-0.jpeg", "step-3-1.jpeg"),
    bgGradient: "linear-gradient(135deg, #f5f0ed 0%, #ebe3de 50%, #ddd3cb 100%)",
  },
  {
    id: "billing-metering",
    headline: "Automated Billing & Metering",
    body: "Say goodbye to manual meter readings and invoice calculations. Our IoT integration automatically tracks usage and generates accurate invoices.",
    screenshot: homedemoShots("step-4.jpeg", "step-4-2.jpeg"),
    bgGradient: "linear-gradient(135deg, #f8f5f3 0%, #eee7e3 50%, #e5dbd5 100%)",
  },
  {
    id: "smart-locks",
    headline: "Smart Lock Integration",
    body: "Secure digital access for every unit. Remote unlock, access history, and temporary keys for guests - all managed through the platform.",
    screenshot: homedemoShots("step-5.jpeg"),
    bgGradient: "linear-gradient(135deg, #fdfcfb 0%, #f7f3f0 50%, #f0ebe7 100%)",
  },
]

const features = [
  {
    icon: Building2,
    title: "Multi-Property Management",
    desc: "Manage unlimited properties and units from a single dashboard with role-based access control.",
  },
  {
    icon: Users,
    title: "Tenant Lifecycle",
    desc: "From enquiry to move-out, automate the entire tenant journey with digital agreements and onboarding.",
  },
  {
    icon: Zap,
    title: "IoT Integrations",
    desc: "Connect smart meters and locks for real-time monitoring and automated billing.",
  },
  {
    icon: Lock,
    title: "Secure Access",
    desc: "Digital keys, access logs, and remote management for smart door systems.",
  },
  {
    icon: BarChart3,
    title: "Financial Reports",
    desc: "Automated owner payouts, expense tracking, and comprehensive financial reporting.",
  },
  {
    icon: Clock,
    title: "Save 10+ Hours/Week",
    desc: "Eliminate manual data entry, reduce WhatsApp chaos, and focus on growing your portfolio.",
  },
]

/** Section 2：滚入视口时的编排动效（错开 + 弹簧，减弱动效时缩短） */
function usePlatformIntroMotion() {
  const reduce = useReducedMotion()
  return useMemo(() => {
    const spring = { type: "spring" as const, stiffness: 88, damping: 20, mass: 0.85 }
    const soft = { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const }

    if (reduce) {
      return {
        viewport: { once: false, amount: 0.35 },
        container: {
          initial: "hidden",
          whileInView: "visible",
          variants: {
            hidden: {},
            visible: { transition: { staggerChildren: 0.05, delayChildren: 0 } },
          },
        },
        item: {
          variants: {
            hidden: { opacity: 0.01 },
            visible: { opacity: 1, transition: { duration: 0.2 } },
          },
        },
        line: {
          variants: {
            hidden: { scaleX: 0 },
            visible: { scaleX: 1, transition: { duration: 0.25 } },
          },
        },
      }
    }

    return {
      viewport: { once: false, amount: 0.38, margin: "-12% 0px -8% 0px" },
      container: {
        initial: "hidden",
        whileInView: "visible",
        variants: {
          hidden: {},
          visible: {
            transition: { staggerChildren: 0.13, delayChildren: 0.12 },
          },
        },
      },
      item: {
        variants: {
          hidden: { opacity: 0, y: 52 },
          visible: { opacity: 1, y: 0, transition: spring },
        },
      },
      line: {
        variants: {
          hidden: { scaleX: 0, opacity: 0 },
          visible: {
            scaleX: 1,
            opacity: 1,
            transition: { ...soft, delay: 0.45 },
          },
        },
      },
    }
  }, [reduce])
}

export function HomedemoLanding() {
  const introMotion = usePlatformIntroMotion()
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    document.documentElement.classList.add("homedemo-scroll-snap")
    return () => document.documentElement.classList.remove("homedemo-scroll-snap")
  }, [])

  return (
    <div className="bg-background">
      <MarketingNavbar />

      {/* 第 1 屏：Hero；底部渐变衔接 section 2，减轻硬切 */}
      <div className="relative snap-start snap-always min-h-[100dvh]">
        <CampaignHero fullViewport />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[25] h-[min(22vh,11rem)] bg-gradient-to-b from-transparent via-background/45 to-background"
        />
      </div>

      {/* 第 2 屏：水纹 + 顶部与 Hero 色带过渡；整段轻微滚入 */}
      <motion.section
        id="platform"
        className="relative flex min-h-[100dvh] snap-start snap-always flex-col items-center justify-center overflow-hidden bg-background px-6 py-16"
        initial={prefersReducedMotion ? false : { opacity: 0.88, y: 14 }}
        whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: false, amount: 0.22 }}
        transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-[min(18vh,9rem)] bg-gradient-to-b from-[color-mix(in_oklab,var(--brand-light)_28%,var(--background))] via-background/40 to-transparent"
        />
        <motion.div
          className="absolute inset-0 z-0"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={introMotion.viewport}
          transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
        >
          <WaterRippleSectionBg />
        </motion.div>
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background:
              "radial-gradient(ellipse 130% 100% at 50% 50%, color-mix(in oklab, var(--background) 72%, transparent) 0%, color-mix(in oklab, var(--background) 38%, transparent) 62%, transparent 85%)",
          }}
          aria-hidden
        />

        <motion.div
          className="relative z-10 w-full max-w-3xl px-6 text-center md:px-8"
          initial={introMotion.container.initial}
          whileInView={introMotion.container.whileInView}
          viewport={introMotion.viewport}
          variants={introMotion.container.variants}
        >
          <motion.span
            variants={introMotion.item.variants}
            className="mb-4 inline-block text-xs font-bold uppercase tracking-[0.3em]"
            style={{ color: "var(--brand)" }}
          >
            Platform Features
          </motion.span>
          <motion.h2
            variants={introMotion.item.variants}
            className="mb-4 text-balance text-4xl font-black text-foreground md:text-5xl"
          >
            Everything You Need to Run Coliving
          </motion.h2>
          <motion.p
            variants={introMotion.item.variants}
            className="text-lg text-muted-foreground"
          >
            From tenant onboarding to owner payouts, our platform handles the entire rental operations workflow.
          </motion.p>
          <motion.div
            variants={introMotion.line.variants}
            className="mx-auto mt-8 h-1 w-24 origin-center rounded-full"
            style={{ background: "var(--brand)" }}
          />
        </motion.div>
      </motion.section>

      {/* 第 3 屏：Step 1 of 5 … group scroll（长滚动 + sticky 手机） */}
      <section
        id="platform-steps"
        className="homedemo-platform-steps relative min-h-[100dvh] snap-start"
        aria-label="Platform feature walkthrough"
      >
        <StickyPhoneScrollSection steps={platformSteps} segmentVh={HOMEDEMO_SCROLL_UNITS} />
      </section>

      {/* Section 4：功能卡 + Stats 橫幅（同一 section，與 Section 5 分開 snap） */}
      <section
        className="snap-start bg-background"
        aria-label="Platform features and statistics"
      >
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-card border border-border rounded-2xl p-6 hover:shadow-lg transition-shadow"
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: "var(--brand-muted)" }}
                >
                  <f.icon size={22} style={{ color: "var(--brand)" }} />
                </div>
                <h3 className="font-bold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="pb-10 pt-2">
          <StatsSection />
        </div>
      </section>

      {/* Section 5：Why ColivingJB（#about）— full viewport height */}
      <section
        id="about"
        className="snap-start flex min-h-[100dvh] flex-col justify-center border-t border-border/50 px-6 py-16 md:py-24 bg-secondary/30"
      >
        <div className="max-w-7xl mx-auto w-full">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span
                className="inline-block text-xs font-bold tracking-[0.3em] uppercase mb-4"
                style={{ color: "var(--brand)" }}
              >
                Why ColivingJB
              </span>
              <h2 className="text-4xl font-black text-foreground mb-6 text-balance">
                Built for Coliving Operators in Malaysia & Singapore
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                We understand the unique challenges of running coliving spaces in Southeast Asia. From multi-tenant billing to smart lock integrations, our platform is designed specifically for your needs.
              </p>
              <ul className="space-y-4">
                {[
                  "Localized for Malaysia & Singapore (RM/SGD, SST/GST)",
                  "Integrations with local payment gateways",
                  "Support for prepaid and postpaid meter billing",
                  "Multi-language support (EN, BM, ZH)",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 size={20} style={{ color: "var(--brand)" }} className="flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-card border border-border rounded-3xl p-8 md:p-12 shadow-xl">
              <h3 className="text-2xl font-black text-foreground mb-4">Ready to streamline your operations?</h3>
              <p className="text-muted-foreground mb-8">
                Join leading coliving operators who have already transformed their rental management with ColivingJB.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href="/pricing"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full text-sm font-bold tracking-widest uppercase text-white"
                  style={{ background: "var(--brand)" }}
                >
                  View Pricing <ArrowRight size={16} />
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full text-sm font-bold tracking-widest uppercase border"
                  style={{ borderColor: "var(--brand)", color: "var(--brand)" }}
                >
                  For Property Owners
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 6：同一 section — 上區 CTA 垂直置中；下為完整 MarketingFooter（四欄 + © / Serving，不分離） */}
      <section
        className="snap-start flex min-h-[100dvh] w-full flex-col bg-foreground"
        aria-label="Call to action and footer"
      >
        <div className="flex min-h-0 flex-1 flex-col justify-center px-6 py-10 md:py-12">
          <div className="mx-auto w-full max-w-3xl text-center">
            <h2 className="mb-3 text-balance text-4xl font-black text-white md:mb-4">
              Transform Your Rental Operations Today
            </h2>
            <p className="mb-6 text-lg text-white/60 md:mb-7">
              Start managing your coliving properties smarter. No credit card required.
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-sm font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-white/90"
            >
              Get Started <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <div className="shrink-0">
          <MarketingFooter compact />
        </div>
      </section>
    </div>
  )
}
