"use client"

import { useRef, useEffect, useState, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Image from "next/image"

export interface ScrollStep {
  id: string
  headline: string
  body: string
  /** Single URL or ordered list — scroll advances through each image before the next step */
  screenshot: string | string[]
  bgGradient: string
}

function urlsForStep(step: ScrollStep): string[] {
  return Array.isArray(step.screenshot) ? step.screenshot : [step.screenshot]
}

interface StickyPhoneScrollSectionProps {
  steps: ScrollStep[]
  /**
   * Each step advances after ~`segmentVh * 100vh` of scroll within the sticky track (default 3).
   * Total height is `(N * segmentVh + 1) * 100vh` so that `(offsetHeight − viewport) / N ≈ segmentVh * 100vh`.
   * Same thresholds when scrolling up (reverse).
   */
  segmentVh?: number
}

/** Sticky top-16 (4rem) matches marketing navbar */
const STICKY_TOP_PX = 64

const MAX_SCROLL_CLAMP_ITERATIONS = 12

/**
 * Scroll-pinned "phone story": each step ≈ `segmentVh`×100vh scroll；轨道总高含 +100vh 以抵消 scrollable = 高度 − 视口。
 * 快速捲動時不跳步（同向一次只變一步）；從下方區塊向上進入時與捲動位置同步（先 Step 5→4→…），避免 ref 卡在 Step 1 而誤拉。
 */
export function StickyPhoneScrollSection({
  steps,
  segmentVh = 3,
}: StickyPhoneScrollSectionProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [activeFrameIndex, setActiveFrameIndex] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const activeFrameIndexRef = useRef(0)
  const prevScrollYRef = useRef<number | null>(null)

  const scrollFrames = useMemo(() => {
    const out: { stepIndex: number; screenshot: string }[] = []
    steps.forEach((step, stepIndex) => {
      for (const url of urlsForStep(step)) {
        out.push({ stepIndex, screenshot: url })
      }
    })
    return out
  }, [steps])

  const frameCount = Math.max(1, scrollFrames.length)

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReducedMotion(mq.matches)
    const h = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener("change", h)
    return () => mq.removeEventListener("change", h)
  }, [])

  const measureTravel = useCallback((el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect()
    const viewportH = window.innerHeight
    const scrollable = el.offsetHeight - viewportH
    if (scrollable <= 0) return { scrollable: 0, stickyTravel: 0, segment: 0 }
    const stickyTravel = Math.min(Math.max(STICKY_TOP_PX - rect.top, 0), scrollable)
    const segment = scrollable / frameCount
    return { scrollable, stickyTravel, segment }
  }, [frameCount])

  useEffect(() => {
    const el = trackRef.current
    if (!el || steps.length === 0 || frameCount === 0) return

    let raf = 0
    const update = () => {
      const scrollY = window.scrollY
      let deltaY = 0
      if (prevScrollYRef.current === null) {
        prevScrollYRef.current = scrollY
      } else {
        deltaY = scrollY - prevScrollYRef.current
        prevScrollYRef.current = scrollY
      }

      let { scrollable, stickyTravel, segment } = measureTravel(el)

      if (scrollable <= 0) {
        activeFrameIndexRef.current = 0
        setActiveFrameIndex(0)
        return
      }

      const ai = activeFrameIndexRef.current
      const proposedIdx = Math.min(
        frameCount - 1,
        Math.max(0, Math.floor(stickyTravel / segment)),
      )
      const gap = Math.abs(proposedIdx - ai)

      /** 從下方捲上進入（先對齊 Step 5…）或從上方捲下進入；resize/首帧 delta=0 時以捲動位置為準 */
      if (gap > 1) {
        const enterFromBelow = proposedIdx > ai + 1 && deltaY <= 0
        const enterFromAbove = proposedIdx < ai - 1 && deltaY >= 0
        const noVerticalDelta = deltaY === 0
        if (enterFromBelow || enterFromAbove || noVerticalDelta) {
          activeFrameIndexRef.current = proposedIdx
          setActiveFrameIndex(proposedIdx)
          return
        }
      }

      let iteration = 0
      while (iteration < MAX_SCROLL_CLAMP_ITERATIONS) {
        iteration += 1
        const aiLoop = activeFrameIndexRef.current
        const prop = Math.min(
          frameCount - 1,
          Math.max(0, Math.floor(stickyTravel / segment)),
        )

        if (prop <= aiLoop + 1 && prop >= aiLoop - 1) {
          break
        }

        const targetTravel =
          prop > aiLoop + 1 ? (aiLoop + 1) * segment : (aiLoop - 1) * segment
        const delta = stickyTravel - targetTravel
        if (Math.abs(delta) < 0.25) {
          break
        }

        window.scrollBy({ top: -delta, left: 0, behavior: "auto" })
        const next = measureTravel(el)
        stickyTravel = next.stickyTravel
        segment = next.segment
        scrollable = next.scrollable
        activeFrameIndexRef.current = Math.min(
          frameCount - 1,
          Math.max(0, Math.floor(stickyTravel / segment)),
        )
      }

      const idx = Math.min(frameCount - 1, Math.max(0, Math.floor(stickyTravel / segment)))
      activeFrameIndexRef.current = idx
      setActiveFrameIndex(idx)
    }

    const onScrollOrResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }

    window.addEventListener("scroll", onScrollOrResize, { passive: true })
    window.addEventListener("resize", onScrollOrResize)
    update()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("scroll", onScrollOrResize)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [steps.length, frameCount, segmentVh, measureTravel])

  const currentFrame = scrollFrames[activeFrameIndex] ?? scrollFrames[0]
  const currentStep = currentFrame ? steps[currentFrame.stepIndex] : steps[0]
  if (!steps.length || !currentStep || !currentFrame) return null

  const activeStepIndex = currentFrame.stepIndex

  /** +1×100vh：使 (offsetHeight − innerHeight) / N ≈ segmentVh×100vh；N = 截圖幀數 */
  const trackHeightVh = frameCount * segmentVh + 1

  const phoneContent = (
    <div className="relative w-[260px] h-[540px] flex-shrink-0">
      <div className="absolute inset-0 bg-neutral-900 rounded-[3rem] shadow-2xl">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-7 bg-neutral-900 rounded-b-2xl z-20" />
        <div className="absolute inset-[10px] bg-white rounded-[2.4rem] overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${currentStep.id}-frame-${activeFrameIndex}`}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: reducedMotion ? 0 : 0.45, ease: "easeInOut" }}
              className="absolute inset-0"
            >
              <Image
                src={currentFrame.screenshot}
                alt={currentStep.headline}
                fill
                className="object-cover"
                priority
              />
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-24 h-1 bg-white/40 rounded-full" />
      </div>
    </div>
  )

  const stepDots = (
    <div className="flex gap-2 mt-8">
      {steps.map((_, i) => (
        <div
          key={i}
          className="h-1.5 rounded-full transition-all duration-300"
          style={{
            width: activeStepIndex === i ? "2rem" : "0.5rem",
            background: activeStepIndex === i ? "var(--brand)" : "var(--border)",
          }}
        />
      ))}
    </div>
  )

  return (
    <div
      ref={trackRef}
      className="relative w-full"
      style={{ height: `${trackHeightVh * 100}vh` }}
      aria-label="Platform feature steps"
    >
      <div
        className="sticky top-16 flex h-[calc(100vh-4rem)] w-full items-center justify-center"
        style={{ background: "var(--background)" }}
      >
        {/* lg+：文案 + 手机作为一整块在视口正中，sticky 至整段轨道滚完（Step 1→5） */}
        <div className="hidden h-full w-full items-center justify-center px-6 lg:flex xl:px-10">
          <div className="flex w-full max-w-6xl flex-col items-center justify-center gap-10 lg:flex-row lg:gap-14 xl:gap-16">
            <div className="flex w-full max-w-md flex-shrink-0 flex-col justify-center lg:max-w-[26rem]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep.id}
                  initial={{ opacity: 0, y: 28 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: reducedMotion ? 0 : 0.4, ease: "easeOut" }}
                  className="flex flex-col"
                >
                  <span
                    className="mb-5 text-xs font-bold uppercase tracking-[0.3em]"
                    style={{ color: "var(--brand)" }}
                  >
                    Step {activeStepIndex + 1} of {steps.length}
                  </span>
                  <h3 className="mb-5 text-balance text-4xl font-black leading-tight text-foreground lg:text-5xl">
                    {currentStep.headline}
                  </h3>
                  <p className="text-lg leading-relaxed text-muted-foreground">{currentStep.body}</p>
                </motion.div>
              </AnimatePresence>
              {stepDots}
              <p className="mt-8 text-xs uppercase tracking-widest text-muted-foreground/50">
                {activeFrameIndex < frameCount - 1 ? "Scroll to continue" : "Scroll to proceed"}
              </p>
            </div>

            <div className="flex flex-shrink-0 items-center justify-center">{phoneContent}</div>
          </div>
        </div>

        <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-6 lg:hidden">
          <div className="relative h-[414px] w-[200px] flex-shrink-0">
            <div className="absolute inset-0 rounded-[2.5rem] bg-neutral-900 shadow-2xl">
              <div className="absolute top-0 left-1/2 z-20 h-6 w-20 -translate-x-1/2 rounded-b-xl bg-neutral-900" />
              <div className="absolute inset-[8px] overflow-hidden rounded-[2rem] bg-white">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${currentStep.id}-frame-${activeFrameIndex}`}
                    initial={{ opacity: 0, scale: 1.04 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: reducedMotion ? 0 : 0.4 }}
                    className="absolute inset-0"
                  >
                    <Image src={currentFrame.screenshot} alt={currentStep.headline} fill className="object-cover" />
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="absolute bottom-2 left-1/2 h-1 w-16 -translate-x-1/2 rounded-full bg-white/40" />
            </div>
          </div>

          <div className="relative h-40 w-full text-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: reducedMotion ? 0 : 0.35 }}
                className="absolute inset-0 flex flex-col items-center"
              >
                <span
                  className="mb-2 text-[11px] font-bold uppercase tracking-[0.3em]"
                  style={{ color: "var(--brand)" }}
                >
                  Step {activeStepIndex + 1} of {steps.length}
                </span>
                <h3 className="mb-2 text-balance text-2xl font-black text-foreground">{currentStep.headline}</h3>
                <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{currentStep.body}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex gap-2">
            {steps.map((_, i) => (
              <div
                key={i}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: activeStepIndex === i ? "1.5rem" : "0.375rem",
                  background: activeStepIndex === i ? "var(--brand)" : "var(--border)",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
