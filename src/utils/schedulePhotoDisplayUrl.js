'use strict';

/**
 * Schedule / damage photo values from DB: Wix imports use `wix:image://v1/{fileId}~mv2.ext/...`;
 * browsers need `https://static.wixstatic.com/media/{fileId}~mv2.ext`.
 * Mirrors {@link cleanlemon/next-app/lib/media-url-kind.ts} `normalizeDamageAttachmentUrl` for images.
 */
function schedulePhotoDisplayUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    if (s.startsWith('http://')) {
      try {
        const h = new URL(s).hostname.toLowerCase();
        if (h.endsWith('.aliyuncs.com')) return s.replace(/^http:\/\//i, 'https://');
      } catch (_) {
        /* ignore */
      }
    }
    return s;
  }
  if (s.toLowerCase().startsWith('wix:image://')) {
    const m = s.match(/wix:image:\/\/v1\/([^/#?]+)/i);
    return m ? `https://static.wixstatic.com/media/${m[1]}` : s;
  }
  return s;
}

module.exports = { schedulePhotoDisplayUrl };
