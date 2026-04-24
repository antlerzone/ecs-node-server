"use client"

import { useMemo, useState } from "react"
import {
  isProbablyVideoUrl,
  normalizeDamageAttachmentUrl,
  wixVideoPosterUrlFromRaw,
  wixVideoPlayUrlFromRaw,
} from "@/lib/media-url-kind"
import type { DamagePhotoAttachment } from "@/lib/cleanlemon-api"

type Resolved = { url: string; kind: "image" | "video"; posterUrl?: string }

export function DamageMediaAttachments({
  urls,
  attachments,
  emptyLabel = "No attachments.",
}: {
  urls: string[] | undefined
  attachments?: DamagePhotoAttachment[] | undefined
  emptyLabel?: string
}) {
  const list: Resolved[] = useMemo(() => {
    if (attachments?.length) {
      return attachments
        .map((a) => {
          const url = normalizeDamageAttachmentUrl(a.url)
          if (!url) return null
          const poster =
            a.posterUrl != null && String(a.posterUrl).trim()
              ? normalizeDamageAttachmentUrl(String(a.posterUrl))
              : undefined
          const kind = a.kind === "video" || isProbablyVideoUrl(url) ? "video" : "image"
          return { url, kind, posterUrl: poster }
        })
        .filter((x): x is Resolved => x != null)
    }
    const raw = Array.isArray(urls) ? urls.filter((u) => typeof u === "string" && u.trim()) : []
    const out: Resolved[] = []
    for (const u of raw) {
      const s = String(u).trim()
      if (s.startsWith("wix:video://")) {
        const play = wixVideoPlayUrlFromRaw(s)
        if (play) {
          const poster = wixVideoPosterUrlFromRaw(s)
          out.push({
            url: play,
            kind: "video",
            posterUrl: poster || undefined,
          })
        }
        continue
      }
      const url = normalizeDamageAttachmentUrl(s)
      if (!url) continue
      out.push({
        url,
        kind: isProbablyVideoUrl(url) ? "video" : "image",
      })
    }
    return out
  }, [urls, attachments])

  const [videoFailed, setVideoFailed] = useState<Record<string, boolean>>({})

  if (!list.length) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {list.map((item, i) => {
        const key = `${item.url}-${i}`
        const failKey = `${i}:${item.url}`
        const failed = videoFailed[failKey]
        if (item.kind === "video" && !failed) {
          return (
            <div key={key} className="rounded-md border overflow-hidden bg-muted/30">
              <video
                src={item.url}
                poster={item.posterUrl}
                controls
                className="w-full max-h-72"
                playsInline
                preload="metadata"
                onError={() => setVideoFailed((prev) => ({ ...prev, [failKey]: true }))}
              />
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-2 py-1.5 text-xs text-primary hover:underline"
              >
                Open video in new tab
              </a>
            </div>
          )
        }
        if (item.kind === "video" && failed && item.posterUrl) {
          return (
            <div key={key} className="space-y-2 rounded-md border overflow-hidden bg-muted/30 p-2">
              <p className="text-xs text-muted-foreground">Preview unavailable — poster or open link.</p>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md border overflow-hidden bg-muted/30"
              >
                <img src={item.posterUrl} alt="" className="w-full max-h-64 object-contain" />
              </a>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-2 py-1 text-xs text-primary hover:underline"
              >
                Try opening video in new tab
              </a>
            </div>
          )
        }
        if (item.kind === "video" && failed) {
          return (
            <div key={key} className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Video could not be played in the browser.{" "}
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                Open link
              </a>
            </div>
          )
        }
        return (
          <a
            key={key}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md border overflow-hidden bg-muted/30"
          >
            <img src={item.url} alt="" className="w-full max-h-64 object-contain" />
          </a>
        )
      })}
    </div>
  )
}
