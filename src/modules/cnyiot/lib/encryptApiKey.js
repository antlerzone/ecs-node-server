/**
 * Encrypt apiKey for CNYIoT API (AES-ECB, PKCS7).
 * Must match Wix CryptoJS: AES.encrypt(rawApiKey, key, { mode: ECB, padding: Pkcs7 }).
 * Env: CNYIOT_AES_KEY (UTF-8 secret, 16 or 32 bytes for AES-128/256-ECB).
 */

const crypto = require('crypto');

function getKeyBuffer(secretKey) {
  if (!secretKey) throw new Error('CNYIOT_AES_KEY_MISSING');
  const buf = Buffer.from(secretKey, 'utf8');
  if (buf.length >= 32) return buf.subarray(0, 32);
  if (buf.length >= 16) return Buffer.concat([buf, Buffer.alloc(32 - buf.length, 0)]);
  return Buffer.concat([buf, Buffer.alloc(16 - buf.length, 0)]);
}

/**
 * @param {string} rawApiKey - Plain apiKey from login
 * @param {string} secretKey - CNYIOT_AES_KEY (from env)
 * @returns {string} - URL-encoded base64 (no trailing =)
 */
function encryptApiKey(rawApiKey, secretKey) {
  const key = getKeyBuffer(secretKey);
  const algorithm = key.length === 32 ? 'aes-256-ecb' : 'aes-128-ecb';
  const cipher = crypto.createCipheriv(algorithm, key, Buffer.alloc(0));
  const enc = Buffer.concat([cipher.update(rawApiKey, 'utf8'), cipher.final()]);
  let base64 = enc.toString('base64').replace(/=+$/, '');
  return encodeURIComponent(base64);
}

module.exports = { encryptApiKey };
