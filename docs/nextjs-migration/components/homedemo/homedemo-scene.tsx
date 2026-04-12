"use client"

import dynamic from "next/dynamic"

export const HomedemoScene = dynamic(() => import("./homedemo-scene-client"), {
  ssr: false,
  loading: () => (
    <div
      className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-[#f5eef2] to-[#ebe3e8]"
      aria-hidden
    />
  ),
})
