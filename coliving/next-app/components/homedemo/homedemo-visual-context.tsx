"use client"

import { createContext, useContext } from "react"

export interface HomedemoVisualState {
  /** 0 = intro hero, 1..5 = portal sections in order */
  activeVisualIndex: number
  reducedMotion: boolean
  scrollProgress01: number
}

export const HomedemoVisualContext = createContext<HomedemoVisualState>({
  activeVisualIndex: 0,
  reducedMotion: false,
  scrollProgress01: 0,
})

export function useHomedemoVisual() {
  return useContext(HomedemoVisualContext)
}
