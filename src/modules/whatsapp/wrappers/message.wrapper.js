/**
 * WhatsApp Cloud API (Meta) message wrapper.
 * Send text/template; parse webhook payload for incoming messages.
 * All send functions take creds { phoneNumberId, accessToken } (from getWhatsAppCreds).
 */

const { whatsappPost } = require('./whatsappRequest');

/**
 * Normalize phone for API: digits only, no +.
 * @param {string} to - E.164 or local number
 * @returns {string}
 */
function normalizePhone(to) {
  if (!to || typeof to !== 'string') return '';
  return to.replace(/\D/g, '');
}

/**
 * Send a text message.
 * @param {{ phoneNumberId: string, accessToken: string }} creds
 * @param {string} to - Recipient phone (E.164 or digits)
 * @param {string} text - Body
 * @param {boolean} [previewUrl] - Allow link preview
 * @returns {Promise<object>} - API response (messages[].id etc.)
 */
async function sendText(creds, to, text, previewUrl = false) {
  const phone = normalizePhone(to);
  if (!phone) throw new Error('WHATSAPP_SEND_INVALID_TO');
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'text',
    text: {
      body: String(text),
      preview_url: !!previewUrl
    }
  };
  return whatsappPost(`${creds.phoneNumberId}/messages`, creds.accessToken, body);
}

/**
 * Send a template message (for post-24h or approved templates).
 * @param {{ phoneNumberId: string, accessToken: string }} creds
 * @param {string} to - Recipient phone
 * @param {string} name - Template name
 * @param {string} [languageCode] - e.g. "en", "en_US"
 * @param {Array<{ type: string, text?: string, image?: object }>} [components] - Header/body/button components
 * @returns {Promise<object>}
 */
async function sendTemplate(creds, to, name, languageCode = 'en', components = []) {
  const phone = normalizePhone(to);
  if (!phone) throw new Error('WHATSAPP_SEND_INVALID_TO');
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'template',
    template: {
      name,
      language: { code: languageCode },
      ...(components.length ? { components } : {})
    }
  };
  return whatsappPost(`${creds.phoneNumberId}/messages`, creds.accessToken, body);
}

/**
 * Parse Cloud API webhook payload into a flat list of incoming message events.
 * Handles: entry[].changes[].value.messages (and statuses/reactions if needed later).
 * @param {object} payload - Raw webhook body from Meta
 * @returns {Array<{ from: string, messageId: string, timestamp: string, type: string, text?: string, phoneNumberId: string, contact?: { waId: string, profile?: { name: string } } }>}
 */
function parseWebhookPayload(payload) {
  const out = [];
  const entries = payload?.entry ?? [];
  for (const entry of entries) {
    const changes = entry?.changes ?? [];
    for (const change of changes) {
      if (change?.field !== 'messages') continue;
      const value = change?.value ?? {};
      const phoneNumberId = String(value?.metadata?.phone_number_id ?? '');
      const contact = value?.contacts?.[0];
      const from = contact?.wa_id ?? value?.messages?.[0]?.from ?? '';
      const messages = value?.messages ?? [];
      for (const msg of messages) {
        const fromId = msg?.from ?? from;
        const item = {
          from: String(fromId),
          messageId: msg?.id ?? '',
          timestamp: msg?.timestamp ?? '',
          type: msg?.type ?? 'unknown',
          phoneNumberId,
          contact: contact ? { waId: contact.wa_id, profile: contact.profile } : undefined
        };
        if (msg?.type === 'text' && msg?.text) item.text = msg.text.body;
        if (msg?.type === 'button' && msg?.button) {
          item.text = msg.button.text;
          item.buttonId = msg.button.id;
        }
        if (msg?.type === 'interactive' && msg?.interactive) {
          const interactive = msg.interactive;
          if (interactive.type === 'button_reply') item.buttonId = interactive.button_reply?.id;
          if (interactive.type === 'list_reply') item.listId = interactive.list_reply?.id;
          item.text = interactive.button_reply?.title ?? interactive.list_reply?.title ?? interactive.list_reply?.description;
        }
        out.push(item);
      }
    }
  }
  return out;
}

/**
 * Verify webhook: Meta sends GET with hub.mode, hub.verify_token, hub.challenge.
 * Return hub.challenge if mode is "subscribe" and token matches.
 * @param {string} queryMode - req.query['hub.mode']
 * @param {string} queryToken - req.query['hub.verify_token']
 * @param {string} queryChallenge - req.query['hub.challenge']
 * @param {string} expectedToken - Your WHATSAPP_VERIFY_TOKEN
 * @returns {string|null} - Challenge string to send back, or null
 */
function verifyWebhook(queryMode, queryToken, queryChallenge, expectedToken) {
  if (queryMode !== 'subscribe') return null;
  if (queryToken !== expectedToken) return null;
  return queryChallenge ?? null;
}

module.exports = {
  sendText,
  sendTemplate,
  parseWebhookPayload,
  verifyWebhook,
  normalizePhone
};
