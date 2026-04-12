"use client"

import { isProbablyVideoUrl } from "@/lib/media-url-kind"

export function DamageMediaAttachments({
  urls,
  emptyLabel = "No attachments.",
}: {
  urls: string[] | undefined
  emptyLabel?: string
}) {
  const list = Array.isArray(urls) ? urls.filter((u) => typeof u === "string" && u.trim()) : []
  if (!list.length) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <div className="grid grid-cols-1 gap-3">
      {list.map((url, i) => {
        const video = isProbablyVideoUrl(url)
        if (video) {
          return (
            <div key={`${url}-${i}`} className="rounded-md border overflow-hidden bg-muted/30">
              <video src={url} controls className="w-full max-h-72" playsInline preload="metadata" />
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-2 py-1.5 text-xs text-primary hover:underline"
              >
                Open video in new tab
              </a>
            </div>
          )
        }
        return (
          <a
            key={`${url}-${i}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md border overflow-hidden bg-muted/30"
          >
            <img src={url} alt="" className="w-full max-h-64 object-contain" />
          </a>
        )
      })}
    </div>
  )
}
