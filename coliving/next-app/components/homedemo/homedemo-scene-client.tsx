"use client"

import { Canvas } from "@react-three/fiber"
import { HomedemoSceneInner } from "./homedemo-scene-inner"

export default function HomedemoSceneClient() {
  const dpr =
    typeof window !== "undefined" ? Math.min(1.75, window.devicePixelRatio || 1) : 1

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 h-[100dvh] w-full">
      <Canvas
        shadows
        camera={{ position: [6, 2, 8], fov: 45, near: 0.1, far: 80 }}
        dpr={dpr}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      >
        <HomedemoSceneInner />
      </Canvas>
    </div>
  )
}
