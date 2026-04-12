/**
 * Convert signature value saved by frontend (usually data URL base64) into a public https URL in OSS.
 * Google Docs API can only embed images from public https URLs (not data/base64 strings).
 */

const { uploadToOss } = require('./oss.service');

function isHttpUrl(s) {
  if (s == null) return false;
  return /^https?:\/\//i.test(String(s).trim());
}

function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  return null;
}

function extFromMime(mimeType) {
  const m = String(mimeType || '').toLowerCase();
  if (m === 'image/png') return '.png';
  if (m === 'image/jpeg') return '.jpg';
  if (m === 'image/jpg') return '.jpg';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/gif') return '.gif';
  return '.bin';
}

/**
 * Decode base64 signature input into Buffer.
 * Supports:
 * - data:image/png;base64,xxxx
 * - pure base64 (best-effort mime sniffing by magic bytes)
 */
function decodeSignatureToBuffer(signatureValue) {
  const s = String(signatureValue || '').trim();
  if (!s) return { ok: false, reason: 'EMPTY_SIGNATURE' };

  const dataUrlMatch = s.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1];
    const b64 = dataUrlMatch[2];
    const buf = Buffer.from(b64, 'base64');
    if (!buf || buf.length === 0) return { ok: false, reason: 'DECODE_FAILED' };
    return { ok: true, buffer: buf, mimeType };
  }

  // Pure base64: try decode and infer type by file signature
  const looksLikeB64 = /^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length > 32;
  if (!looksLikeB64) return { ok: false, reason: 'NOT_BASE64_OR_DATA_URL' };
  const buf = Buffer.from(s, 'base64');
  if (!buf || buf.length === 0) return { ok: false, reason: 'DECODE_FAILED' };

  const head = buf.slice(0, 16);
  const hex = head.toString('hex').toLowerCase();

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (hex.startsWith('89504e470d0a1a0a')) return { ok: true, buffer: buf, mimeType: 'image/png' };
  // JPEG: ff d8 ff
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ok: true, buffer: buf, mimeType: 'image/jpeg' };
  // GIF: "GIF87a" or "GIF89a"
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a') {
    return { ok: true, buffer: buf, mimeType: 'image/gif' };
  }
  // WEBP: "RIFF....WEBP"
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return { ok: true, buffer: buf, mimeType: 'image/webp' };
  }

  return { ok: true, buffer: buf, mimeType: 'application/octet-stream' };
}

/**
 * If signatureValue is already an https URL: return as-is.
 * If it's data/base64: upload to OSS and return https URL.
 */
async function signatureValueToPublicUrl(signatureValue, { clientId, signatureKey }) {
  const key = (signatureKey || 'signature').trim();
  if (isHttpUrl(signatureValue)) {
    return { ok: true, value: String(signatureValue).trim(), alreadyPublic: true };
  }

  const decoded = decodeSignatureToBuffer(signatureValue);
  if (!decoded.ok) {
    return { ok: false, reason: decoded.reason || 'DECODE_FAILED' };
  }

  // Keep logs safe: never print base64.
  const mimeType = decoded.mimeType || 'application/octet-stream';
  const ext = extFromMime(mimeType);
  const contentType = mimeFromExt(ext);

  // Guardrail: avoid uploading extremely large blobs due to client bug.
  const maxBytes = 10 * 1024 * 1024; // 10MB
  if (decoded.buffer.length > maxBytes) {
    return { ok: false, reason: 'SIGNATURE_TOO_LARGE' };
  }

  // Upload file with stable name prefix; OSS file name still uses randomUUID internally.
  const originalFilename = `signature-${key}${ext}`;
  const uploadRes = await uploadToOss(decoded.buffer, originalFilename, clientId);
  if (!uploadRes || uploadRes.ok !== true || !uploadRes.url) {
    return { ok: false, reason: uploadRes?.reason || 'OSS_UPLOAD_FAILED' };
  }

  // uploadToOss returns a long-lived signed URL string.
  return { ok: true, value: uploadRes.url, alreadyPublic: false, mimeType, contentType };
}

module.exports = {
  signatureValueToPublicUrl
};

