"use client"

import Link from "next/link"
import { ArrowRight, Building2, MapPin, Users } from "lucide-react"
import { motion } from "framer-motion"
import { MarketingNavbar } from "@/components/marketing/navbar"
import { MarketingFooter } from "@/components/marketing/footer"

const operators = [
  {
    name: "Vibrant Coliving",
    location: "Johor Bahru",
    units: 45,
    description: "Premium coliving spaces for young professionals in JB city center.",
  },
  {
    name: "Urban Nest",
    location: "Skudai",
    units: 32,
    description: "Affordable student accommodation near UTM and other universities.",
  },
  {
    name: "Horizon Living",
    location: "Iskandar Puteri",
    units: 58,
    description: "Modern coliving with smart home features in the heart of Iskandar.",
  },
  {
    name: "SG Colive",
    location: "Singapore",
    units: 24,
    description: "Budget-friendly coliving for working professionals in Singapore.",
  },
  {
    name: "KL Rooms",
    location: "Kuala Lumpur",
    units: 67,
    description: "Central KL locations with excellent transport links.",
  },
  {
    name: "Penang Stay",
    location: "Penang",
    units: 28,
    description: "Heritage-area coliving combining modern comfort with local charm.",
  },
]

export default function ProposalPage() {
  return (
    <div className="bg-background">
      <MarketingNavbar />

      <section
        className="pt-32 pb-16 px-6 text-center"
        style={{ background: "linear-gradient(180deg, var(--brand-light) 0%, var(--background) 100%)" }}
      >
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-block text-xs font-bold tracking-[0.3em] uppercase mb-4"
          style={{ color: "var(--brand)" }}
        >
          Our Partners
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-5xl md:text-6xl font-black text-foreground mb-6 text-balance"
        >
          Trusted by Leading Operators
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8"
        >
          Join the growing network of coliving operators in Malaysia and Singapore who use ColivingJB to streamline their operations.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-full text-sm font-bold tracking-widest uppercase text-white"
            style={{ background: "var(--brand)" }}
          >
            Become a Partner <ArrowRight size={16} />
          </Link>
        </motion.div>
      </section>

      <section className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {operators.map((op, i) => (
              <motion.div
                key={op.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-card border border-border rounded-2xl p-6 hover:shadow-lg transition-shadow"
              >
                <div
                  className="w-16 h-16 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: "var(--brand-muted)" }}
                >
                  <Building2 size={28} style={{ color: "var(--brand)" }} />
                </div>

                <h3 className="text-xl font-bold text-foreground mb-1">{op.name}</h3>

                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3 flex-wrap">
                  <span className="flex items-center gap-1">
                    <MapPin size={14} /> {op.location}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={14} /> {op.units} units
                  </span>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed">{op.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6" style={{ background: "var(--brand)" }}>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-black text-white mb-4 text-balance">Ready to Join Our Network?</h2>
          <p className="text-white/70 text-lg mb-8">
            Whether you manage 10 units or 1,000, our platform scales with your business.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full text-sm font-bold tracking-widest uppercase bg-white hover:bg-white/90 transition-colors"
              style={{ color: "var(--brand)" }}
            >
              Get Started <ArrowRight size={16} />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full text-sm font-bold tracking-widest uppercase text-white border-2 border-white/30 hover:bg-white/10 transition-colors"
            >
              For Property Owners
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
