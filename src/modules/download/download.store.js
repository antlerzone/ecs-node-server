/**
 * In-memory store for one-time file download by token.
 * Used so Node can return a download URL; GET /api/download/:token streams the file and removes it.
 */

const { randomUUID } = require('crypto');

const TTL_MS = 5 * 60 * 1000; // 5 min

const store = new Map(); // token -> { buffer, filename, mimeType, createdAt }

function set(buffer, filename, mimeType = 'application/octet-stream') {
  const token = randomUUID();
  store.set(token, {
    buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    filename: String(filename || 'download'),
    mimeType: String(mimeType),
    createdAt: Date.now()
  });
  return token;
}

function get(token) {
  const entry = store.get(token);
  if (!entry) return null;
  store.delete(token);
  return entry;
}

function cleanup() {
  const now = Date.now();
  for (const [t, e] of store.entries()) {
    if (now - e.createdAt > TTL_MS) store.delete(t);
  }
}

setInterval(cleanup, 60 * 1000);

module.exports = { set, get };
