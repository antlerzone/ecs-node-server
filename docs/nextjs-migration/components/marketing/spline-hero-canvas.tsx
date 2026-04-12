"use client"

import type { CSSProperties } from "react"
import type { Application } from "@splinetool/runtime"
import Spline from "@splinetool/react-spline"

const SCENE = "https://prod.spline.design/VRX-4LADNUL-UOoF/scene.splinecode"

type SplineHeroCanvasProps = {
  /** 盖住右下角 Spline 水印；与画布同一定位父级，避免与外层 grid 错位 */
  cornerBadgeLabel?: string
  cornerBadgeColor?: string
}

/** Spline 3D 场景，透明背景。 */
export function SplineHeroCanvas({ cornerBadgeLabel, cornerBadgeColor }: SplineHeroCanvasProps) {
  const onLoad = (app: Application) => {
    try {
      app.setBackgroundColor("transparent")
    } catch {
      /* noop */
    }
  }

  return (
    <div className="spline-hero-wrap relative h-[min(560px,72vh)] w-full min-h-[420px] overflow-hidden">
      <Spline
        scene={SCENE}
        onLoad={onLoad}
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
        }}
      />
      {cornerBadgeLabel ? (
        <span
          className="absolute bottom-4 right-3 z-[60] inline-flex h-11 w-[158px] max-w-[calc(100%-0.5rem)] shrink-0 origin-bottom-right cursor-default select-none items-center justify-center rounded-xl border border-border bg-white text-[var(--corner-accent,var(--foreground))] text-sm font-semibold tracking-wide shadow-md [transform:translateZ(0)] transition-[color,background-color,border-color,transform,box-shadow] duration-200 ease-out will-change-transform hover:z-[70] hover:scale-105 hover:border-[var(--corner-accent)] hover:bg-[var(--corner-accent)] hover:text-white hover:shadow-lg motion-reduce:transition-colors motion-reduce:hover:scale-100"
          style={
            cornerBadgeColor
              ? ({
                  "--corner-accent": cornerBadgeColor,
                } as CSSProperties)
              : undefined
          }
        >
          {cornerBadgeLabel}
        </span>
      ) : null}
    </div>
  )
}
