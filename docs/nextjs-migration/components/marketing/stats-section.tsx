"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useInView } from "framer-motion"

interface Stat {
  target: number | null
  suffix: string
  prefix?: string
  label: string
  display?: string
}

const stats: Stat[] = [
  { target: 200, suffix: "+", label: "Units Managed" },
  { target: 15, suffix: "+", label: "Partner Operators" },
  { target: 98, suffix: "%", label: "Platform Uptime" },
  { target: null, suffix: "", display: "MY & SG", label: "Markets Served" },
]

function CountUp({
  target,
  suffix,
  prefix = "",
  display,
  triggerKey,
}: {
  target: number | null
  suffix: string
  prefix?: string
  display?: string
  triggerKey: number
}) {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    if (triggerKey === 0 || target === null) return
    setCurrent(0)
    const duration = 1400
    const steps = 60
    const increment = target / steps
    let step = 0
    const timer = setInterval(() => {
      step++
      setCurrent(Math.min(Math.round(increment * step), target))
      if (step >= steps) clearInterval(timer)
    }, duration / steps)
    return () => clearInterval(timer)
  }, [triggerKey, target])

  if (target === null) return <>{display}</>
  return (
    <>
      {prefix}
      {current}
      {suffix}
    </>
  )
}

export function StatsSection() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: false, amount: 0.4 })
  const [triggerKey, setTriggerKey] = useState(0)

  useEffect(() => {
    if (inView) setTriggerKey((k) => k + 1)
  }, [inView])

  return (
    <div className="overflow-hidden">
      <motion.section
        ref={ref}
        initial={{ scale: 1.18, opacity: 0 }}
        animate={inView ? { scale: 1, opacity: 1 } : {}}
        transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        className="py-20 px-6 mx-4 md:mx-10 rounded-3xl"
        style={{ background: "var(--brand)" }}
      >
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 16 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.55 + i * 0.1, ease: "easeOut" }}
              >
                <div className="text-3xl md:text-4xl font-black text-white mb-1 tabular-nums">
                  <CountUp
                    target={stat.target}
                    suffix={stat.suffix}
                    prefix={stat.prefix}
                    display={stat.display}
                    triggerKey={triggerKey}
                  />
                </div>
                <div className="text-xs tracking-widest uppercase text-white/60">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>
    </div>
  )
}
