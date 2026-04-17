import { useSyncExternalStore } from 'react'

/**
 * Subscribes to window.matchMedia. SSR snapshot should match first paint intent:
 * `false` → treat as narrow until hydrated (mobile Sheet first).
 */
export function useMediaQuery(query: string, getServerSnapshot = false) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => getServerSnapshot,
  )
}
