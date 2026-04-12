'use client'

import { useEffect } from 'react'

/**
 * 部署后旧标签页仍引用已删除的 `/_next/static/chunks/*.js` 时会触发 ChunkLoadError。
 * 自动整页重载一次以拉取新 HTML；若仍失败则不再循环，避免死循环。
 */
const STORAGE_KEY = '__cl_chunk_reload_pending'

export function ChunkLoadRecovery() {
  useEffect(() => {
    const clearPendingAfterQuietLoad = () => {
      window.setTimeout(() => {
        try {
          sessionStorage.removeItem(STORAGE_KEY)
        } catch {
          /* ignore */
        }
      }, 3000)
    }
    window.addEventListener('load', clearPendingAfterQuietLoad)

    const isChunkFailure = (msg: string) => {
      if (!msg) return false
      return (
        /ChunkLoadError/i.test(msg) ||
        /Loading chunk \d+ failed/i.test(msg) ||
        /Failed to fetch dynamically imported module/i.test(msg) ||
        /Failed to load chunk/i.test(msg) ||
        /Importing a module script failed/i.test(msg)
      )
    }

    const tryReloadOnce = () => {
      try {
        if (sessionStorage.getItem(STORAGE_KEY) === '1') {
          sessionStorage.removeItem(STORAGE_KEY)
          return
        }
        sessionStorage.setItem(STORAGE_KEY, '1')
      } catch {
        /* private mode */
      }
      window.location.reload()
    }

    const onError = (event: ErrorEvent) => {
      if (isChunkFailure(event.message || '')) tryReloadOnce()
    }

    const onRejection = (event: PromiseRejectionEvent) => {
      const r = event.reason
      const msg =
        typeof r === 'object' && r !== null && 'message' in r
          ? String((r as Error).message)
          : String(r ?? '')
      if (isChunkFailure(msg)) tryReloadOnce()
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    return () => {
      window.removeEventListener('load', clearPendingAfterQuietLoad)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
