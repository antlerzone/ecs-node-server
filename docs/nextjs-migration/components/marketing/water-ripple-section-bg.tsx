"use client"

import { useEffect, useRef } from "react"
import { useReducedMotion } from "framer-motion"

type Ripple = {
  r: number
  alpha: number
}

/** 与画面中心对齐（区块正中） */
const EPICENTER_Y = 0.5
const RIPPLE_SPEED = 46
const MAX_RIPPLES = 18

/** 与 globals.css `water-drop-from-top` 周期一致（水滴落下 → 撞击 → 涟漪爆发） */
export const WATER_DROP_CYCLE_MS = 3800
/** 周期内撞击时刻（0–1），须与 CSS 关键帧 68%–74% 对齐 */
const IMPACT_PHASE = 0.71

/** 外圈平滑淡出：近中心保持清晰，接近 maxR 时渐隐（避免硬切边） */
function rippleOuterFade(r: number, maxR: number): number {
  const t0 = maxR * 0.34
  const t1 = maxR * 0.97
  if (r <= t0) return 1
  if (r >= t1) return 0
  const u = (r - t0) / (t1 - t0)
  const s = u * u * (3 - 2 * u)
  return 1 - s
}

/**
 * Section 2：Canvas 俯视水面 + 撞击涟漪（与纯 CSS 水滴下落同步）。
 * 水滴造型见 globals `.water-drop-css`（教程式写法，参考 https://www.youtube.com/watch?v=cIYSY9TQnoI ）。
 */
export function WaterRippleSectionBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (reduceMotion) return

    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const ripples: Ripple[] = []
    let lastT = 0
    let rafId = 0
    let bgFill =
      getComputedStyle(wrap).getPropertyValue("--background").trim() || "oklch(0.985 0.003 60)"

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      bgFill =
        getComputedStyle(wrap).getPropertyValue("--background").trim() || "oklch(0.985 0.003 60)"
    }

    const drawBg = (w: number, h: number) => {
      const bg = bgFill
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      const cx = w / 2
      const cy = h * EPICENTER_Y
      const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.72)
      g2.addColorStop(0, "rgba(255,255,255,0.07)")
      g2.addColorStop(0.55, "rgba(255,255,255,0)")
      g2.addColorStop(1, "rgba(40, 30, 25, 0.03)")
      ctx.fillStyle = g2
      ctx.fillRect(0, 0, w, h)
    }

    const strokeWavyRing = (
      cx: number,
      cy: number,
      baseR: number,
      stroke: string,
      lineWidth: number,
      phase: number
    ) => {
      const segments = 96
      ctx.beginPath()
      for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2
        const wobble =
          3.2 * Math.sin(t * 9 + phase) +
          1.8 * Math.sin(t * 5 - phase * 0.7) +
          1.2 * Math.sin(t * 14 + phase * 1.3)
        const rr = Math.max(4, baseR + wobble)
        const x = cx + Math.cos(t) * rr
        const y = cy + Math.sin(t) * rr
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.strokeStyle = stroke
      ctx.lineWidth = lineWidth
      ctx.lineJoin = "round"
      ctx.stroke()
    }

    const burstRipples = () => {
      while (ripples.length > MAX_RIPPLES - 8) {
        ripples.shift()
      }
      for (let k = 0; k < 7; k++) {
        ripples.push({ r: 6 + k * 2.2, alpha: 0.52 - k * 0.045 })
      }
    }

    const tick = (now: number) => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w < 2 || h < 2) {
        rafId = requestAnimationFrame(tick)
        return
      }

      const rawDt = lastT ? (now - lastT) / 1000 : 1 / 60
      const dt = Math.min(0.05, rawDt)
      const prevT = lastT || now - 16
      lastT = now

      drawBg(w, h)

      const cx = w / 2
      const cy = h * EPICENTER_Y
      /** 中心到四角距离，略放大使波纹贴满全宽/全高直至裁切 */
      const toCorner = Math.hypot(w / 2, h / 2)
      const maxR = toCorner * 1.18

      const phasePrev = ((prevT % WATER_DROP_CYCLE_MS) + WATER_DROP_CYCLE_MS) % WATER_DROP_CYCLE_MS
      const phaseNow = ((now % WATER_DROP_CYCLE_MS) + WATER_DROP_CYCLE_MS) % WATER_DROP_CYCLE_MS
      const p0 = phasePrev / WATER_DROP_CYCLE_MS
      const p1 = phaseNow / WATER_DROP_CYCLE_MS
      if (p0 < IMPACT_PHASE && p1 >= IMPACT_PHASE) {
        burstRipples()
      }

      for (const rip of ripples) {
        rip.r += RIPPLE_SPEED * dt
      }

      while (ripples.length && ripples[0].r > maxR * 1.05) {
        ripples.shift()
      }

      const phase = now * 0.0012
      for (let i = 0; i < ripples.length; i++) {
        const rip = ripples[i]
        if (!rip) continue
        const inner = Math.max(0, 1 - rip.r / maxR)
        const outer = rippleOuterFade(rip.r, maxR)
        const a = rip.alpha * inner * inner * outer
        strokeWavyRing(
          cx,
          cy,
          rip.r,
          `rgba(162, 111, 92, ${0.06 + a * 0.28})`,
          1.2,
          phase + i * 0.4
        )
        strokeWavyRing(
          cx,
          cy,
          rip.r * 0.997,
          `rgba(90, 62, 52, ${0.08 + a * 0.2})`,
          0.85,
          phase * 0.9 + i
        )
      }

      const spec = ctx.createRadialGradient(cx - 12, cy - 18, 0, cx, cy, maxR * 0.28)
      spec.addColorStop(0, "rgba(255,255,255,0.12)")
      spec.addColorStop(0.55, "rgba(255,255,255,0)")
      ctx.fillStyle = spec
      ctx.fillRect(0, 0, w, h)

      rafId = requestAnimationFrame(tick)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    lastT = performance.now()
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [reduceMotion])

  if (reduceMotion) {
    return (
      <div className="pointer-events-none absolute inset-0 z-0 bg-background" aria-hidden />
    )
  }

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none absolute inset-y-0 left-1/2 z-0 min-h-full w-[100vw] max-w-none min-w-full -translate-x-1/2 bg-background"
      style={{ ["--water-cycle" as string]: `${WATER_DROP_CYCLE_MS}ms` }}
    >
      <canvas ref={canvasRef} className="relative z-0 block h-full w-full" aria-hidden />

      {/* 纯 CSS 水滴；不裁切，波纹由下层 Canvas 全宽绘制 */}
      <div className="pointer-events-none absolute inset-0 z-[1]">
        <div
          className="water-drop-fall-layer absolute left-1/2 h-[2.55rem] w-[2.05rem] md:h-[2.75rem] md:w-[2.15rem]"
          aria-hidden
        >
          <div className="water-drop-css" />
        </div>
      </div>
    </div>
  )
}
