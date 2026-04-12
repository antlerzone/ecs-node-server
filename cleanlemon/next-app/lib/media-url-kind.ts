/** URL path extension → treat as video in damage / attachment previews. */
const VIDEO_PATH_EXT = /\.(mp4|webm|mov|mkv|avi|3gp|m4v|ogv)$/i

export function isProbablyVideoUrl(url: string): boolean {
  const raw = String(url || '').trim()
  if (!raw) return false
  let path = raw
  try {
    path = new URL(raw).pathname
  } catch {
    path = raw.split('?')[0] || raw
  }
  return VIDEO_PATH_EXT.test(path)
}

export function isProbablyVideoFile(file: File): boolean {
  const t = String(file.type || '').toLowerCase()
  if (t.startsWith('video/')) return true
  const n = String(file.name || '')
  return /\.(mp4|webm|mov|mkv|avi|3gp|m4v|ogv)$/i.test(n)
}
