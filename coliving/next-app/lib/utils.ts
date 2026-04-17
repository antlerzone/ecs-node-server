import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Convert Wix image URI (wix:image://v1/...) to viewable URL (static.wixstatic.com). Leaves OSS/HTTP URLs unchanged. */
export function wixImageToStatic(url: string): string {
  if (!url || !url.startsWith('wix:image://')) return url
  const m = url.match(/wix:image:\/\/v1\/([^/]+)/)
  return m ? `https://static.wixstatic.com/media/${m[1]}` : url
}

/**
 * Tenant portal img src: OSS signed URLs load directly in the browser (same as NRIC uploads).
 * Avoid routing *.aliyuncs.com through /api/portal/proxy-image — Next can error on large cached bodies (>2MB).
 */
export function tenantPortalImgSrc(storedUrl: string, ecsBaseForRelative: string): string {
  const u = String(storedUrl || "").trim()
  if (!u) return ""
  const base = ecsBaseForRelative.replace(/\/$/, "")
  let abs =
    u.startsWith("http://") || u.startsWith("https://") ? u : `${base}${u.startsWith("/") ? u : `/${u}`}`
  if (abs.startsWith("wix:image://")) return wixImageToStatic(abs)
  try {
    const h = new URL(abs).hostname.toLowerCase()
    if (h.endsWith(".aliyuncs.com") && abs.startsWith("http://")) {
      abs = abs.replace(/^http:\/\//i, "https://")
    }
  } catch {
    /* ignore */
  }
  return abs
}

/**
 * PDF / document URLs on the HTTPS portal: upgrade `http://` on *.aliyuncs.com to `https://` (mixed content).
 * Relative paths are resolved with ecsBase when provided.
 */
export function portalHttpsAssetUrl(url: string | null | undefined, ecsBaseForRelative?: string): string {
  const u = String(url || "").trim()
  if (!u) return ""
  let abs =
    u.startsWith("http://") || u.startsWith("https://")
      ? u
      : ecsBaseForRelative
        ? `${ecsBaseForRelative.replace(/\/$/, "")}${u.startsWith("/") ? u : `/${u}`}`
        : u
  if (!abs.startsWith("http")) return abs
  try {
    const h = new URL(abs).hostname.toLowerCase()
    if (h.endsWith(".aliyuncs.com") && abs.startsWith("http://")) {
      return abs.replace(/^http:\/\//i, "https://")
    }
  } catch {
    /* ignore */
  }
  return abs
}

/**
 * Normalize Google Drive PDF links to preview-friendly URLs.
 * Some saved links are webContent/download endpoints that force download.
 */
export function toDrivePreviewUrl(url: string | null | undefined): string {
  const raw = String(url || "").trim()
  if (!raw) return ""
  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase()
    if (!host.endsWith("drive.google.com")) return raw

    const path = parsed.pathname || ""
    const byPath = path.match(/\/file\/d\/([^/]+)/i)
    if (byPath?.[1]) return `https://drive.google.com/file/d/${byPath[1]}/view`

    const fileId = parsed.searchParams.get("id")
    if (fileId) return `https://drive.google.com/file/d/${fileId}/view`

    return raw
  } catch {
    return raw
  }
}

/**
 * Return a URL suitable for use as img src from the portal.
 * - wix:image://... → static.wixstatic.com (browser can load if CORS allows).
 * - OSS (*.aliyuncs.com) → same-origin proxy (see /api/portal/proxy-image).
 * - Other https/http URLs → returned as-is.
 */
export function toViewableImageUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return ''
  const u = url.trim()
  if (!u) return ''
  if (u.startsWith('wix:image://')) return wixImageToStatic(u)
  try {
    const parsed = new URL(u)
    const h = parsed.hostname.toLowerCase()
    if (h.endsWith('.aliyuncs.com')) {
      return `/api/portal/proxy-image?url=${encodeURIComponent(u)}`
    }
  } catch {
    /* ignore */
  }
  return u
}

/** Backend keys from agreement profile validation (`missingFields`); shown when Prepare PDF fails with `profile_incomplete`. */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  "tenant.fullname": "Tenant full name",
  "tenant.nric": "Tenant NRIC / ID",
  "tenant.address": "Tenant address",
  "tenant.phone": "Tenant phone",
  "tenant.email": "Tenant email",
  "owner.ownername": "Owner name",
  "owner.nric": "Owner NRIC / ID",
  "owner.email": "Owner email",
  "owner.mobilenumber": "Owner mobile",
  "owner.address": "Owner address",
  "operator.client_title": "Company name",
  "operator.client_email": "Company email",
  "operator.company_address": "Company address",
  "operator.company_contact": "Company contact phone",
  "operator.company_ssm_or_uen": "SSM / UEN",
}

/**
 * User-facing text for agreement PDF "profile incomplete" errors.
 * Pass `missingFields` from the API when present.
 */
export function formatProfileIncompleteAlert(missingFields?: string[] | null): string {
  const items = Array.isArray(missingFields) ? missingFields.filter((x) => String(x || "").trim() !== "") : []
  if (items.length === 0) {
    return [
      "Profile incomplete.",
      "No field list was returned. Check tenant / owner profiles and Company settings (name, email, address, contact, SSM/UEN, company chop), then try again.",
    ].join("\n")
  }
  const lines = ["Profile incomplete. Missing:", ...items.map((k) => `• ${PROFILE_FIELD_LABELS[k] ?? k}`)]
  return lines.join("\n")
}
