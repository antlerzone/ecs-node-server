import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * PDF / document URLs: upgrade `http://` on *.aliyuncs.com to `https://` (mixed content).
 * Relative paths resolve with ecsBase when provided (same idea as Coliving portal).
 */
export function portalHttpsAssetUrl(url: string | null | undefined, ecsBaseForRelative?: string): string {
  const u = String(url || '').trim()
  if (!u) return ''
  const abs =
    u.startsWith('http://') || u.startsWith('https://')
      ? u
      : ecsBaseForRelative
        ? `${ecsBaseForRelative.replace(/\/$/, '')}${u.startsWith('/') ? u : `/${u}`}`
        : u
  if (!abs.startsWith('http')) return abs
  try {
    const h = new URL(abs).hostname.toLowerCase()
    if (h.endsWith('.aliyuncs.com') && abs.startsWith('http://')) {
      return abs.replace(/^http:\/\//i, 'https://')
    }
  } catch {
    /* ignore */
  }
  return abs
}

/** Normalize Google Drive PDF links so opening in a new tab prefers view over forced download. */
export function toDrivePreviewUrl(url: string | null | undefined): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase()
    if (!host.endsWith('drive.google.com')) return raw

    const path = parsed.pathname || ''
    const byPath = path.match(/\/file\/d\/([^/]+)/i)
    if (byPath?.[1]) return `https://drive.google.com/file/d/${byPath[1]}/view`

    const fileId = parsed.searchParams.get('id')
    if (fileId) return `https://drive.google.com/file/d/${fileId}/view`

    return raw
  } catch {
    return raw
  }
}
