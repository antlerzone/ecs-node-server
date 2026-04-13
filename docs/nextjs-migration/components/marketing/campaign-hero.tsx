"use client"

import { useRef, useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { ArrowRight } from "lucide-react"
import { motion } from "framer-motion"
import { SplineHeroCanvas } from "@/components/marketing/spline-hero-canvas"

export interface HeroTheme {
  headline: string
  subheadline: string
  ctaLabel: string
  ctaHref: string
  secondaryLabel?: string
  secondaryHref?: string
  backgroundImage?: string
  backgroundColor?: string
  accentColor?: string
  textColor?: string
  decorativeShapes?: boolean
}

const defaultTheme: HeroTheme = {
  headline: "Automate Your Coliving Operations",
  subheadline: "Save time, reduce manual work, and centralize operations for your rental business in Malaysia & Singapore.",
  ctaLabel: "Get Started",
  ctaHref: "https://portal.colivingjb.com",
  secondaryLabel: "See How It Works",
  /** Section 3：sticky phone walkthrough (`#platform` = section 2 copy block) */
  secondaryHref: "#platform-steps",
  backgroundColor: "linear-gradient(135deg, var(--brand-light) 0%, var(--background) 100%)",
  accentColor: "var(--brand)",
  textColor: "var(--foreground)",
  decorativeShapes: true,
}

interface CampaignHeroProps {
  theme?: Partial<HeroTheme>
  /** 100dvh hero for full-viewport scroll-snap (e.g. /home) */
  fullViewport?: boolean
  /** When set with `fullViewport`, min-height is this many vh (e.g. 300 for 3×100vh blocks). */
  fullViewportMinVh?: number
}

export function CampaignHero({ theme = {}, fullViewport = false, fullViewportMinVh }: CampaignHeroProps) {
  const t = { ...defaultTheme, ...theme }
  const containerRef = useRef<HTMLDivElement>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2
      setMousePos({ x, y })
    }
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  const fullMin =
    fullViewport && fullViewportMinVh != null && fullViewportMinVh > 0
      ? `${fullViewportMinVh}vh`
      : null

  return (
    <section
      ref={containerRef}
      className={`relative flex items-center overflow-hidden ${
        fullViewport ? (fullMin ? "" : "min-h-[100dvh]") : "min-h-[85vh]"
      }`}
      style={{
        background: t.backgroundImage ? undefined : t.backgroundColor,
        ...(fullMin ? { minHeight: fullMin } : {}),
      }}
    >
      {t.backgroundImage && (
        <>
          <Image
            src={t.backgroundImage}
            alt="Hero background"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-black/40" />
        </>
      )}

      {t.decorativeShapes && !t.backgroundImage && (
        <>
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `linear-gradient(var(--brand) 1px, transparent 1px), linear-gradient(90deg, var(--brand) 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.15 }}
            transition={{ duration: 1 }}
            className="absolute top-20 right-[15%] w-64 h-64 rounded-full blur-3xl"
            style={{ background: t.accentColor }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.1 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="absolute bottom-20 left-[10%] w-48 h-48 rounded-full blur-3xl"
            style={{ background: t.accentColor }}
          />
          <svg
            className="absolute bottom-0 left-0 right-0 h-32 opacity-5"
            viewBox="0 0 1200 100"
            preserveAspectRatio="none"
          >
            <path
              d="M0,80 Q200,60 400,70 T800,50 T1200,60"
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2"
            />
            <path
              d="M0,90 Q300,70 600,80 T1200,70"
              fill="none"
              stroke="var(--brand)"
              strokeWidth="1.5"
            />
          </svg>
        </>
      )}

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-24 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          <div className="max-w-2xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-8 flex flex-wrap gap-3 lg:mb-0"
            >
              {/* MY & SG：大屏叠在 Spline 右下角水印上；小屏 Spline 隐藏故仍放在此处 */}
              <span
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold tracking-wide bg-white/80 backdrop-blur-sm border border-border shadow-sm lg:hidden"
                style={{ color: t.accentColor }}
              >
                MY & SG
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-5xl md:text-6xl lg:text-7xl font-black leading-[0.95] mb-6 text-balance"
              style={{ color: t.backgroundImage ? "#fff" : t.textColor }}
            >
              {t.headline}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg md:text-xl leading-relaxed mb-10 max-w-xl"
              style={{ color: t.backgroundImage ? "rgba(255,255,255,0.8)" : "var(--muted-foreground)" }}
            >
              {t.subheadline}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-wrap gap-4"
            >
              <Link
                href={t.ctaHref}
                className="inline-flex items-center gap-2 px-8 py-4 rounded-full text-sm font-bold tracking-widest uppercase text-white transition-all hover:opacity-90 shadow-lg"
                style={{ background: t.accentColor }}
              >
                {t.ctaLabel} <ArrowRight size={16} />
              </Link>
              {t.secondaryLabel && t.secondaryHref && (
                <Link
                  href={t.secondaryHref}
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-full text-sm font-bold tracking-widest uppercase border-2 transition-all hover:bg-black/5"
                  style={{
                    color: t.backgroundImage ? "#fff" : t.accentColor,
                    borderColor: t.backgroundImage ? "rgba(255,255,255,0.3)" : t.accentColor,
                  }}
                >
                  {t.secondaryLabel}
                </Link>
              )}
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.6, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{
              duration: 1.2,
              delay: 0.5,
              type: "spring",
              stiffness: 100,
              damping: 15,
            }}
            className="relative hidden lg:block w-full max-w-xl"
            style={{
              transform: `translate(${mousePos.x * 12}px, ${mousePos.y * 12}px)`,
              transition: "transform 0.2s ease-out",
            }}
          >
            <SplineHeroCanvas cornerBadgeLabel="MY & SG" cornerBadgeColor={t.accentColor} />
          </motion.div>
        </div>
      </div>
    </section>
  )
}
