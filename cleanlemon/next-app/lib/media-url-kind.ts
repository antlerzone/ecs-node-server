/** URL path extension → treat as video in damage / attachment previews. */
const VIDEO_PATH_EXT = /\.(mp4|webm|mov|mkv|avi|3gp|m4v|ogv)$/i

/** Wix `wix:video://v1/{fileId}/{file}.mp4` → same CDN rule as backend (`cleanlemon.service.js`). */
export function wixVideoPlayUrlFromRaw(raw: string): string {
  const s = String(raw || "").trim()
  if (!s.startsWith("wix:video://")) return ""
  const m = s.match(/wix:video:\/\/v1\/([^/]+)\/([^#?]+)/i)
  if (!m) return ""
  const fileId = m[1]
  const fileName = m[2]
  return `https://video.wixstatic.com/video/${fileId}/720p/mp4/${fileName}`
}

export function wixVideoPosterUrlFromRaw(raw: string): string {
  const s = String(raw || "")
  const poster = s.match(/[#&]posterUri=([^&]+)/)
  if (!poster?.[1]) return ""
  const id = decodeURIComponent(String(poster[1]).trim())
  return id ? `https://static.wixstatic.com/media/${id}` : ""
}

/** Wix images → static; Wix videos → playable MP4; OSS http → https. */
export function normalizeDamageAttachmentUrl(raw: string): string {
  const s = String(raw || "").trim()
  if (!s) return ""
  if (s.startsWith("wix:image://")) {
    const m = s.match(/wix:image:\/\/v1\/([^/#?]+)/)
    return m ? `https://static.wixstatic.com/media/${m[1]}` : s
  }
  if (s.startsWith("wix:video://")) {
    return wixVideoPlayUrlFromRaw(s) || s
  }
  if (s.startsWith("http://")) {
    try {
      const h = new URL(s).hostname.toLowerCase()
      if (h.endsWith(".aliyuncs.com")) return s.replace(/^http:\/\//i, "https://")
    } catch {
      /* ignore */
    }
  }
  return s
}

export function isProbablyVideoUrl(url: string): boolean {
  const raw = String(url || "").trim()
  if (!raw) return false
  const lower = raw.toLowerCase()
  if (lower.includes("video.wixstatic.com/video")) return true
  let path = raw
  try {
    path = new URL(raw).pathname
  } catch {
    path = raw.split("?")[0] || raw
  }
  return VIDEO_PATH_EXT.test(path)
}

export function isProbablyVideoFile(file: File): boolean {
  const t = String(file.type || '').toLowerCase()
  if (t.startsWith('video/')) return true
  const n = String(file.name || '')
  return /\.(mp4|webm|mov|mkv|avi|3gp|m4v|ogv)$/i.test(n)
}
