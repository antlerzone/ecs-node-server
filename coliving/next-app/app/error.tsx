"use client"

import { useEffect } from "react"

/** New deploy → old tab still has old webpack runtime → dynamic import requests a removed chunk → 404 + ChunkLoadError. */
const isChunkLoadError = (e: Error) => {
  const m = typeof e?.message === "string" ? e.message : ""
  return (
    e?.name === "ChunkLoadError" ||
    /Loading chunk \d+ failed/i.test(m) ||
    /Failed to load chunk/i.test(m) ||
    /Failed to fetch dynamically imported module/i.test(m)
  )
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Application error:", error)
  }, [error])

  const chunkError = isChunkLoadError(error)

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <h2 className="text-lg font-semibold text-foreground mb-2">
        {chunkError ? "Update available" : "Something went wrong"}
      </h2>
      <p className="text-sm text-muted-foreground mb-4 max-w-md text-center">
        {chunkError
          ? "A new version of the app was deployed. Please refresh the page to load the latest version."
          : error?.message || "A client-side exception occurred."}
      </p>
      <button
        onClick={() => (chunkError ? window.location.reload() : reset())}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
      >
        {chunkError ? "Refresh page" : "Try again"}
      </button>
      {!chunkError && (
        <p className="text-xs text-muted-foreground mt-6">
          Check the browser console (F12) for details.
        </p>
      )}
    </div>
  )
}
