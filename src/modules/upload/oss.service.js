/**
 * 阿里云 OSS 上传：上传到 bucket，返回可访问的签名 URL（私有桶）。
 * 表里已有 URL（如 Wix）保持不变；新上传统一走此服务，存 OSS 返回的 URL。
 */

const OSS = require('ali-oss');
const { randomUUID } = require('crypto');
const path = require('path');

const SIGNED_URL_EXPIRES = 365 * 24 * 3600; // 1 年，用于存 DB 的展示链接

function getClient() {
  const region = process.env.OSS_REGION;
  const bucket = process.env.OSS_BUCKET;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error('OSS config missing: OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET');
  }
  return new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret
  });
}

/** 只允许 clientId 含字母数字、横线、下划线，避免路径穿越 */
function sanitizeClientId(clientId) {
  const s = typeof clientId === 'string' ? clientId.trim() : '';
  return s.replace(/[^a-zA-Z0-9_-]/g, '') || null;
}

/**
 * 生成 OSS 对象路径：uploads/{clientId}/YYYY/MM/uuid.ext，按 client 分类便于 SaaS 隔离与按租户管理
 */
function objectName(originalFilename, clientId) {
  const ext = path.extname(originalFilename || '').toLowerCase() || '.bin';
  const safeExt = /^\.([a-z0-9]+)$/i.test(ext) ? ext : '.bin';
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const name = `${randomUUID()}${safeExt}`;
  const prefix = clientId ? `uploads/${clientId}/${y}/${m}` : `uploads/shared/${y}/${m}`;
  return `${prefix}/${name}`;
}

/**
 * 上传 buffer 到 OSS，返回可访问的签名 URL（长期有效，用于存入 DB、前端展示）。
 * @param {Buffer} buffer - 文件内容
 * @param {string} originalFilename - 原始文件名（用于取扩展名）
 * @param {string} [clientId] - 租户 client_id，用于路径 uploads/{clientId}/YYYY/MM/；不传则用 uploads/shared/
 * @returns {Promise<{ ok: true, url: string, key: string } | { ok: false, reason: string }>}
 */
async function uploadToOss(buffer, originalFilename, clientId) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, reason: 'FILE_EMPTY' };
  }
  const safeClientId = clientId != null ? sanitizeClientId(String(clientId)) : null;
  try {
    const client = getClient();
    const key = objectName(originalFilename, safeClientId);
    // Helps browsers/Google Docs treat it as an image when uploading from base64.
    const ext = (path.extname(originalFilename || '').toLowerCase() || '');
    const contentType =
      ext === '.png'
        ? 'image/png'
        : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
          : ext === '.webp' ? 'image/webp'
            : ext === '.gif' ? 'image/gif'
              : ext === '.mp4' || ext === '.m4v' ? 'video/mp4'
                : ext === '.webm' ? 'video/webm'
                  : ext === '.mov' ? 'video/quicktime'
                    : ext === '.mkv' ? 'video/x-matroska'
                      : ext === '.avi' ? 'video/x-msvideo'
                        : ext === '.3gp' ? 'video/3gpp'
                          : ext === '.ogv' ? 'video/ogg'
                            : null;
    if (contentType) {
      await client.put(key, buffer, { contentType });
    } else {
      await client.put(key, buffer);
    }
    let url = client.signatureUrl(key, { expires: SIGNED_URL_EXPIRES });
    // Portal is HTTPS — http:// OSS links trigger mixed-content / blocked loads in browsers
    if (typeof url === 'string' && url.startsWith('http://')) {
      url = url.replace(/^http:\/\//i, 'https://');
    }
    return { ok: true, url, key };
  } catch (err) {
    console.error('[oss] upload failed', err?.message || err);
    return {
      ok: false,
      reason: err?.code === 'InvalidAccessKeyId' ? 'OSS_CREDENTIAL_INVALID' : 'OSS_UPLOAD_FAILED'
    };
  }
}

/**
 * 为已有 OSS key 生成签名 URL（用于私有桶下按 key 展示）。
 * 表里若存的是 key 而非完整 URL，可调此方法生成临时展示链接。
 * @param {string} key - OSS 对象 key
 * @param {number} [expires=3600] - 过期秒数
 * @returns {Promise<{ ok: true, url: string } | { ok: false, reason: string }>}
 */
async function getSignedUrl(key, expires = 3600) {
  if (!key || typeof key !== 'string' || !key.trim()) {
    return { ok: false, reason: 'KEY_REQUIRED' };
  }
  try {
    const client = getClient();
    const url = client.signatureUrl(key.trim(), { expires });
    return { ok: true, url };
  } catch (err) {
    console.error('[oss] signatureUrl failed', err?.message || err);
    return { ok: false, reason: 'OSS_SIGN_FAILED' };
  }
}

/**
 * Read object as a stream (for proxying PDF/images without exposing signed URLs / iframe-safe headers).
 * @param {string} key - OSS object key
 * @returns {Promise<{ stream: import('stream').Readable, res: object }>}
 */
async function getObjectStream(key) {
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error('KEY_REQUIRED');
  }
  const client = getClient();
  return client.getStream(key.trim());
}

module.exports = {
  uploadToOss,
  getSignedUrl,
  getObjectStream
};
