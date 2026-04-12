/**
 * Feedback thread:
 *   messages_json: [{ role:'operator'|'tenant', text, at, visibleToTenant?, attachments?: [{src,type}]}]
 *
 * Operator messages may set visibleToTenant=false (internal note); default is visible.
 * Tenant messages are always visible.
 *
 * Legacy feedback.remark is merged as one operator message with visibleToTenant=true.
 */

function parseJsonSafe(s) {
  if (s == null || s === '') return null;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(s)) {
    s = s.toString('utf8');
  }
  if (typeof s === 'string') {
    try {
      return JSON.parse(s);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function isoFromRow(d) {
  if (!d) return new Date().toISOString();
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? new Date().toISOString() : x.toISOString();
}

function detectAttachmentType(src) {
  const s = String(src || '').toLowerCase();
  if (/\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(s)) return 'video';
  return 'image';
}

function normalizeAttachments(value) {
  if (value == null || value === '') return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of arr) {
    if (!item) continue;
    if (typeof item === 'string') {
      const src = item.trim();
      if (!src) continue;
      out.push({ src, type: detectAttachmentType(src) });
      continue;
    }
    if (typeof item === 'object') {
      const src = (item.src || item.url || '').toString().trim();
      if (!src) continue;
      const type = item.type ? String(item.type) : detectAttachmentType(src);
      out.push({ src, type });
    }
  }
  return out;
}

function normalizeMessages(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((m) => m && typeof m === 'object' && (m.role === 'operator' || m.role === 'tenant'))
    .map((m) => {
      const role = m.role;
      const text = m.text == null ? '' : String(m.text).trim();
      const attachments = normalizeAttachments(m.attachments);

      // Keep messages that have either text or attachments.
      if (!text && attachments.length === 0) return null;

      const o = {
        role,
        text,
        at: m.at ? String(m.at) : undefined
      };
      if (role === 'operator') {
        o.visibleToTenant = m.visibleToTenant === false ? false : true;
      }
      if (attachments.length) o.attachments = attachments;
      return o;
    })
    .filter(Boolean);
}

function parseMessagesFromDb(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return normalizeMessages(value);
  if (typeof value === 'string') {
    let p = parseJsonSafe(value);
    if (typeof p === 'string') {
      p = parseJsonSafe(p);
    }
    if (Array.isArray(p)) return normalizeMessages(p);
    if (p && typeof p === 'object') {
      const keys = Object.keys(p);
      if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
        return normalizeMessages(keys.sort((a, b) => Number(a) - Number(b)).map((k) => p[k]));
      }
      return normalizeMessages([p]);
    }
    return [];
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
      return normalizeMessages(keys.sort((a, b) => Number(a) - Number(b)).map((k) => value[k]));
    }
    return normalizeMessages([value]);
  }
  return [];
}

function sortMessagesByAt(messages) {
  const m = normalizeMessages(messages);
  return m.sort((a, b) => {
    const ta = Date.parse(a.at) || 0;
    const tb = Date.parse(b.at) || 0;
    return ta - tb;
  });
}

function loadFeedbackThread(row) {
  let messages = parseMessagesFromDb(row.messages_json);
  if (messages.length === 0) {
    const leg = (row.remark || '').trim();
    if (leg) {
      messages = [
        {
          role: 'operator',
          text: leg,
          at: isoFromRow(row.updated_at || row.created_at),
          visibleToTenant: true
        }
      ];
    }
  }
  // Backfill missing `at` so sorting does not incorrectly push messages to "now".
  // We approximate using feedback row updated_at/created_at.
  const fallbackAt = isoFromRow(row.updated_at || row.created_at);
  messages = messages.map((m) => (m.at ? m : { ...m, at: fallbackAt }));
  return sortMessagesByAt(messages);
}

/**
 * @param {object} [options]
 * @param {string} [options.at] ISO time
 * @param {boolean} [options.visibleToTenant] operator only; default true
 */
function appendMessage(messages, role, text, options = {}) {
  const m = normalizeMessages(messages);
  const t = text == null ? '' : String(text).trim();
  const attachments = normalizeAttachments(options.attachments);
  if (!t && attachments.length === 0) return m;
  const at = options.at || new Date().toISOString();
  const entry = { role, text: t, at };
  if (attachments.length) entry.attachments = attachments;
  if (role === 'operator') {
    entry.visibleToTenant = options.visibleToTenant === false ? false : true;
  }
  m.push(entry);
  return m;
}

function messagePreviewText(msg) {
  if (!msg) return '';
  const text = msg.text == null ? '' : String(msg.text).trim();
  if (text) return text;
  const atts = Array.isArray(msg.attachments) ? msg.attachments : [];
  if (atts.length === 0) return '';
  const first = atts[0] || {};
  return first.type === 'video' ? 'Video attached' : 'Photo attached';
}

/** Last message text (any), by time — operator-internal use. */
function remarkPreview(messages) {
  const sorted = sortMessagesByAt(messages);
  if (!sorted.length) return '';
  return messagePreviewText(sorted[sorted.length - 1]);
}

/** Last message the tenant is allowed to see (for DB remark + tenant list preview). */
function remarkPreviewVisibleToTenant(messages) {
  const sorted = sortMessagesByAt(messages);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const msg = sorted[i];
    if (msg.role === 'tenant' || (msg.role === 'operator' && msg.visibleToTenant !== false)) {
      return messagePreviewText(msg);
    }
  }
  return '';
}

function filterMessagesVisibleToTenant(messages) {
  return sortMessagesByAt(messages).filter(
    (msg) => msg.role === 'tenant' || (msg.role === 'operator' && msg.visibleToTenant !== false)
  );
}

function isMissingMessagesJsonColumn(err) {
  const code = err?.code || err?.name || '';
  const msg = err?.sqlMessage || err?.message || String(err || '');
  return (
    code === 'ER_BAD_FIELD_ERROR' ||
    err?.errno === 1054 ||
    (msg && String(msg).includes('Unknown column') && String(msg).includes('messages_json'))
  );
}

module.exports = {
  parseJsonSafe,
  normalizeMessages,
  parseMessagesFromDb,
  sortMessagesByAt,
  loadFeedbackThread,
  appendMessage,
  remarkPreview,
  remarkPreviewVisibleToTenant,
  filterMessagesVisibleToTenant,
  isMissingMessagesJsonColumn,
  isoFromRow
};
