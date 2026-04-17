"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { MousePointer2 } from "lucide-react"
import { HomedemoVisualContext } from "./homedemo-visual-context"
import { HomedemoScene } from "./homedemo-scene"
import { HomedemoNav } from "./homedemo-nav"
import { HomedemoGlassCard } from "./homedemo-glass-card"
import { HomedemoMiniDemo } from "./homedemo-mini-demo"
import {
  HOMEDEMO_INTRO,
  HOMEDEMO_SCROLL_SECTIONS,
  type HomedemoScrollSlug,
} from "@/lib/homedemo-data"

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const fn = () => setReduced(mq.matches)
    mq.addEventListener("change", fn)
    return () => mq.removeEventListener("change", fn)
  }, [])
  return reduced
}

export interface HomedemoPageClientProps {
  initialSlug?: HomedemoScrollSlug | null
}

export function HomedemoPageClient({ initialSlug = null }: HomedemoPageClientProps) {
  const reducedMotion = usePrefersReducedMotion()
  const [webglOk, setWebglOk] = useState(true)
  const [activeVisualIndex, setActiveVisualIndex] = useState(0)
  const [scrollProgress01, setScrollProgress01] = useState(0)
  const lenisRef = useRef<InstanceType<typeof import("lenis").default> | null>(null)
  const initialDoneRef = useRef(false)
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion

  const activeSlug =
    activeVisualIndex === 0 ? "intro" : (HOMEDEMO_SCROLL_SECTIONS[activeVisualIndex - 1]?.slug ?? "intro")

  useEffect(() => {
    try {
      const c = document.createElement("canvas")
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl")
      setWebglOk(!!gl)
    } catch {
      setWebglOk(false)
    }
  }, [])

  const scrollToDomId = useCallback((domId: string) => {
    const el = document.getElementById(domId)
    if (!el) return
    const lenis = lenisRef.current
    if (lenis) {
      lenis.scrollTo(el, { offset: -88, duration: 1.1 })
    } else {
      el.scrollIntoView({ behavior: reducedMotionRef.current ? "auto" : "smooth", block: "start" })
    }
  }, [])

  /** Lenis + ScrollTrigger */
  useEffect(() => {
    if (reducedMotion) return

    let cancelled = false
    let localLenis: InstanceType<typeof import("lenis").default> | null = null
    let localTicker: ((time: number) => void) | null = null
    let localGsap: typeof import("gsap").default | null = null
    let removeResize: (() => void) | null = null

    ;(async () => {
      const Lenis = (await import("lenis")).default
      const gsap = (await import("gsap")).default
      const { ScrollTrigger } = await import("gsap/ScrollTrigger")
      if (cancelled) return

      gsap.registerPlugin(ScrollTrigger)

      const lenis = new Lenis()
      if (cancelled) {
        lenis.destroy()
        return
      }

      localLenis = lenis
      localGsap = gsap
      lenisRef.current = lenis

      lenis.on("scroll", ScrollTrigger.update)

      const tickerFn = (time: number) => {
        lenis.raf(time * 1000)
      }
      localTicker = tickerFn
      gsap.ticker.add(tickerFn)
      gsap.ticker.lagSmoothing(0)

      ScrollTrigger.scrollerProxy(document.documentElement, {
        scrollTop(value) {
          if (arguments.length && value !== undefined) {
            lenis.scrollTo(value, { immediate: true })
          }
          return lenis.scroll
        },
        getBoundingClientRect() {
          return {
            top: 0,
            left: 0,
            width: window.innerWidth,
            height: window.innerHeight,
            right: window.innerWidth,
            bottom: window.innerHeight,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          }
        },
      })

      lenis.on("scroll", (l) => {
        const lim = l.limit
        setScrollProgress01(lim > 0 ? l.scroll / lim : 0)
      })

      const ids = [HOMEDEMO_INTRO.id, ...HOMEDEMO_SCROLL_SECTIONS.map((s) => s.slug)]
      ids.forEach((id, i) => {
        const el = document.getElementById(`section-${id}`)
        if (!el) return
        ScrollTrigger.create({
          trigger: el,
          start: "top 58%",
          end: "bottom 42%",
          onEnter: () => setActiveVisualIndex(i),
          onEnterBack: () => setActiveVisualIndex(i),
        })
      })

      ScrollTrigger.refresh()

      const onResize = () => {
        ScrollTrigger.refresh()
      }
      window.addEventListener("resize", onResize)
      removeResize = () => window.removeEventListener("resize", onResize)

      if (initialSlug && !initialDoneRef.current) {
        initialDoneRef.current = true
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const target = document.getElementById(`section-${initialSlug}`)
            if (target) lenis.scrollTo(target, { offset: -88, duration: 0.35 })
          })
        })
      }
    })()

    return () => {
      cancelled = true
      removeResize?.()
      if (localTicker && localGsap) localGsap.ticker.remove(localTicker)
      localLenis?.destroy()
      lenisRef.current = null
      import("gsap/ScrollTrigger").then(({ ScrollTrigger }) => {
        ScrollTrigger.getAll().forEach((t) => t.kill())
      })
    }
  }, [reducedMotion, initialSlug])

  /** Native scroll: IO + progress */
  useEffect(() => {
    if (!reducedMotion) return

    const ids = [HOMEDEMO_INTRO.id, ...HOMEDEMO_SCROLL_SECTIONS.map((s) => s.slug)]
    const elements = ids
      .map((id) => document.getElementById(`section-${id}`))
      .filter(Boolean) as HTMLElement[]

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return
          const id = en.target.id.replace("section-", "")
          const idx = ids.indexOf(id)
          if (idx >= 0) setActiveVisualIndex(idx)
        })
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    )
    elements.forEach((el) => observer.observe(el))

    const onScroll = () => {
      const doc = document.documentElement
      const max = doc.scrollHeight - window.innerHeight
      setScrollProgress01(max > 0 ? window.scrollY / max : 0)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll()

    if (initialSlug && !initialDoneRef.current) {
      initialDoneRef.current = true
      const target = document.getElementById(`section-${initialSlug}`)
      target?.scrollIntoView({ block: "start" })
    }

    return () => {
      observer.disconnect()
      window.removeEventListener("scroll", onScroll)
    }
  }, [reducedMotion, initialSlug])

  const visual = {
    activeVisualIndex,
    reducedMotion,
    scrollProgress01,
  }

  const firstScrollSlug = HOMEDEMO_SCROLL_SECTIONS[0]?.slug ?? "tenant"

  return (
    <HomedemoVisualContext.Provider value={visual}>
      {webglOk && !reducedMotion ? <HomedemoScene /> : (
        <div
          className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-[#f5eef2] via-[#ebe3e8] to-[#e5d9df]"
          aria-hidden
        />
      )}
      <HomedemoNav onNavigate={scrollToDomId} activeSlug={activeSlug} />

      <main className="relative text-stone-900">
        <section
          id={`section-${HOMEDEMO_INTRO.id}`}
          className="relative flex min-h-[100dvh] flex-col items-center justify-center px-6 pb-24 pt-28 text-center md:px-10"
        >
          <div data-hero-card className="relative z-10 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-stone-500">
              Room management SaaS
            </p>
            <h1 className="mt-4 font-serif text-4xl font-semibold tracking-tight text-stone-900 md:text-6xl">
              {HOMEDEMO_INTRO.headline}
            </h1>
            <p className="mt-4 text-pretty text-lg text-stone-700 md:text-xl">{HOMEDEMO_INTRO.tagline}</p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => scrollToDomId(`section-${firstScrollSlug}`)}
                className="group relative inline-flex items-center rounded-full border border-stone-800/20 bg-white/80 px-8 py-3 text-xs font-bold uppercase tracking-widest text-stone-900 shadow-md backdrop-blur transition hover:bg-white"
              >
                <span
                  className="pointer-events-none absolute -left-1 -top-1 h-3 w-3 border-l-2 border-t-2 border-stone-400"
                  aria-hidden
                />
                <span
                  className="pointer-events-none absolute -bottom-1 -right-1 h-3 w-3 border-b-2 border-r-2 border-stone-400"
                  aria-hidden
                />
                Start the walk
              </button>
              <Link
                href="/register"
                className="rounded-full border border-stone-800/30 px-8 py-3 text-xs font-bold uppercase tracking-widest text-stone-800 hover:bg-white/60"
              >
                Get started
              </Link>
            </div>
          </div>
          <div className="absolute bottom-8 left-6 flex items-center gap-2 text-xs text-stone-500 md:left-10">
            <MousePointer2 className="h-4 w-4" aria-hidden />
            <span>{HOMEDEMO_INTRO.scrollHint}</span>
          </div>
        </section>

        {HOMEDEMO_SCROLL_SECTIONS.map((section) => (
          <section
            key={section.slug}
            id={`section-${section.slug}`}
            className="relative flex min-h-[100dvh] items-center px-6 py-24 md:px-12 lg:px-16"
          >
            <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
              <HomedemoGlassCard
                title={section.title}
                subtitle={section.subtitle}
                bullets={section.bullets}
                accentClass={section.accent}
                portalHref={section.portalHref}
                pricingCta={section.pricingCta}
              />
              <div className="w-full max-w-sm flex-1 rounded-2xl border border-white/30 bg-white/15 p-6 shadow-lg backdrop-blur-md lg:min-h-[280px]">
                <HomedemoMiniDemo slug={section.slug} />
              </div>
            </div>
          </section>
        ))}

        <footer className="relative z-10 border-t border-white/40 bg-white/50 px-6 py-12 backdrop-blur-md md:px-12">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-stone-800">Coliving Management</p>
              <p className="mt-1 text-xs text-stone-600">
                Pricing is highlighted at the end of this walkthrough. Explore portals anytime.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/portal"
                className="rounded-full bg-primary px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-primary-foreground"
              >
                Open portal hub
              </Link>
              <Link
                href="/proposal"
                className="rounded-full border border-stone-400 px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-stone-800"
              >
                Proposal / 託管
              </Link>
            </div>
          </div>
        </footer>
      </main>
    </HomedemoVisualContext.Provider>
  )
}
