"use client"

import Link from "next/link"
import { ArrowRight, TrendingUp, Shield, Clock, Users, Zap, PiggyBank } from "lucide-react"
import { motion } from "framer-motion"
import { MarketingNavbar } from "@/components/marketing/navbar"
import { MarketingFooter } from "@/components/marketing/footer"
import { ForOwnersFaqSection } from "@/components/marketing/for-owners-faq"

const problems = [
  { icon: Clock, title: "Time-Consuming Management", desc: "Manual tenant coordination, maintenance requests, and WhatsApp overload consume hours daily." },
  { icon: Users, title: "Tenant Turnover Headaches", desc: "Finding reliable tenants, screening, contracts, and onboarding requires constant effort." },
  { icon: Zap, title: "Billing & Meter Complexity", desc: "Manual meter readings, invoice generation, and payment tracking lead to errors and disputes." },
  { icon: Shield, title: "Security & Compliance", desc: "Managing digital access, maintenance records, and legal compliance manually increases risk." },
]

const benefits = [
  { icon: PiggyBank, title: "Maximize Rental Income", desc: "Automated pricing, fewer vacancies, and reduced payment delays mean more money in your pocket." },
  { icon: TrendingUp, title: "Professional Management", desc: "Our platform ensures consistent, professional operations that attract quality tenants." },
  { icon: Users, title: "Vetted Tenant Network", desc: "Access pre-screened, verified tenants ready to move into your properties." },
  { icon: Clock, title: "Save 15+ Hours/Week", desc: "Eliminate manual tasks and focus on growing your portfolio, not managing details." },
]

const process = [
  { num: "01", title: "Submit Your Property", desc: "Tell us about your units—location, size, amenities, desired rental rate." },
  { num: "02", title: "Smart Setup", desc: "We install smart locks, meters, and set up your property dashboard (48 hours)." },
  { num: "03", title: "Tenant Sourcing", desc: "We market, screen, and place quality tenants who fit your property." },
  { num: "04", title: "Hands-Off Operation", desc: "Your tenants pay directly, we handle maintenance, disputes, and compliance." },
  { num: "05", title: "Monthly Payouts", desc: "Transparent reports and automatic transfers to your bank account." },
]

export default function ForOwnersPage() {
  return (
    <div className="bg-background">
      <MarketingNavbar />

      <section className="pt-28 pb-16 md:pt-32 md:pb-24 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-block text-xs font-bold tracking-[0.3em] uppercase mb-4 md:mb-6"
            style={{ color: "var(--brand)" }}
          >
            For Property Owners
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-6xl font-black text-foreground leading-[1.1] text-balance mb-6"
          >
            Your Property Deserves Passive Income,<br className="hidden md:inline" /> Not Constant Headaches
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8 max-w-2xl"
          >
            Professional coliving management for Malaysian & Singaporean property owners. Vetted tenants, automated billing, smart access control—all handled by experts.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4"
          >
            <Link
              href="/enquiry"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full text-sm font-bold tracking-widest uppercase text-white"
              style={{ background: "var(--brand)" }}
            >
              Get Started <ArrowRight size={16} />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full text-sm font-bold tracking-widest uppercase border-2"
              style={{ borderColor: "var(--brand)", color: "var(--brand)" }}
            >
              See Platform Demo
            </Link>
          </motion.div>
        </div>
      </section>

      <section className="py-20 md:py-32 px-6" style={{ background: "var(--brand-muted)" }}>
        <div className="max-w-5xl mx-auto">
          <div className="mb-12 md:mb-16">
            <motion.span
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-xs font-bold tracking-[0.3em] uppercase text-muted-foreground block mb-4"
            >
              The Problem
            </motion.span>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-3xl md:text-5xl font-black text-foreground text-balance"
            >
              Running a coliving property shouldn&apos;t consume your entire life.
            </motion.h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {problems.map((p, i) => (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-card border border-border rounded-2xl p-6 md:p-8"
              >
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                  style={{ background: "var(--background)" }}
                >
                  <p.icon size={24} style={{ color: "var(--brand)" }} />
                </div>
                <h3 className="font-bold text-foreground text-lg mb-2">{p.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{p.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-32 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-12 md:mb-16">
            <motion.span
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-xs font-bold tracking-[0.3em] uppercase mb-4 block"
              style={{ color: "var(--brand)" }}
            >
              The Solution
            </motion.span>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-3xl md:text-5xl font-black text-foreground text-balance"
            >
              Professional management. Real passive income.
            </motion.h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {benefits.map((b, i) => (
              <motion.div
                key={b.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-gradient-to-br from-card to-secondary/50 border border-border rounded-2xl p-6 md:p-8"
              >
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                  style={{ background: "var(--brand-muted)" }}
                >
                  <b.icon size={24} style={{ color: "var(--brand)" }} />
                </div>
                <h3 className="font-bold text-foreground text-lg mb-2">{b.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{b.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-32 px-6" style={{ background: "var(--secondary)" }}>
        <div className="max-w-5xl mx-auto">
          <div className="mb-12 md:mb-16">
            <motion.span
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-xs font-bold tracking-[0.3em] uppercase text-muted-foreground block mb-4"
            >
              How It Works
            </motion.span>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-3xl md:text-5xl font-black text-foreground text-balance"
            >
              Five steps to stress-free income.
            </motion.h2>
          </div>

          <div className="space-y-6 md:space-y-0 md:grid md:grid-cols-5 md:gap-4">
            {process.map((p, i) => (
              <motion.div
                key={p.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative"
              >
                {i < process.length - 1 && (
                  <div
                    className="hidden md:block absolute top-20 left-1/2 w-full h-0.5"
                    style={{ background: "var(--brand-muted)" }}
                  />
                )}

                <div className="bg-card border border-border rounded-2xl p-6 md:p-4 relative z-10">
                  <div
                    className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center text-white font-black text-sm md:text-base mb-4"
                    style={{ background: "var(--brand)" }}
                  >
                    {p.num}
                  </div>
                  <h3 className="font-bold text-foreground text-base md:text-lg mb-2">{p.title}</h3>
                  <p className="text-muted-foreground text-xs md:text-sm leading-relaxed">{p.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24 px-6" style={{ background: "var(--brand)" }}>
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { num: "200+", label: "Units Managed" },
              { num: "95%", label: "Occupancy Rate" },
              { num: "15+", label: "Partner Operators" },
              { num: "MY & SG", label: "Markets Served" },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-3xl md:text-4xl font-black text-white mb-1">{stat.num}</div>
                <div className="text-xs md:text-sm tracking-widest uppercase text-white/60 font-semibold">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-32 px-6">
        <div className="max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-card border border-border rounded-3xl p-8 md:p-12 text-center shadow-lg"
          >
            <h2 className="text-3xl md:text-4xl font-black text-foreground mb-4">Ready to turn your property into income?</h2>
            <p className="text-muted-foreground mb-8 text-base md:text-lg leading-relaxed">
              Connect with our team to discuss your property and goals. We&apos;ll provide a customized proposal within 24 hours.
            </p>

            <Link
              href="/enquiry"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full text-sm font-bold tracking-widest uppercase text-white mb-6"
              style={{ background: "var(--brand)" }}
            >
              Send Inquiry <ArrowRight size={16} />
            </Link>

            <p className="text-xs text-muted-foreground">
              You&apos;ll complete the inquiry on our enquiry page. By submitting, you agree to be contacted about your property management inquiry. We respect your privacy.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 md:py-24 px-6 bg-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">Stop Managing. Start Earning.</h2>
          <p className="text-white/60 text-base md:text-lg mb-8 leading-relaxed">
            Join successful property owners who now enjoy true passive income through professional coliving management.
          </p>
          <Link
            href="/enquiry"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-full text-sm font-bold tracking-widest uppercase text-foreground bg-white hover:bg-white/90 transition-colors"
          >
            Schedule Consultation <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <ForOwnersFaqSection />

      <MarketingFooter />
    </div>
  )
}
