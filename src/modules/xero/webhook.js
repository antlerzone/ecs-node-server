/**
 * Xero Webhook receiver.
 * Xero sends POST with JSON body and x-xero-signature (HMAC-SHA256 of payload, base64).
 * Must respond 2xx within 5s for valid signature, 401 for invalid.
 * @see https://developer.xero.com/documentation/guides/webhooks/configuring-your-server
 */

const crypto = require('crypto');

/** Coliving default; Cleanlemons host should set CLEANLEMON_XERO_WEBHOOK_KEY for its own Xero app. */
function resolveWebhookKey(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const cleanKey = String(process.env.CLEANLEMON_XERO_WEBHOOK_KEY || '').trim();
  const fallback = String(process.env.XERO_WEBHOOK_KEY || '').trim();
  if (host.includes('cleanlemons')) {
    return cleanKey || fallback;
  }
  return fallback;
}

function verifySignature(rawBody, signature, webhookKey) {
  if (!webhookKey || !signature || typeof signature !== 'string') return false;
  const payload = typeof rawBody === 'string' ? rawBody : (Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : (rawBody?.toString?.() ?? ''));
  const hash = crypto.createHmac('sha256', webhookKey).update(payload).digest('base64');
  if (signature.length !== hash.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(hash, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Express handler. Expects req.body to be raw Buffer (mount with express.raw()).
 */
function webhookHandler(req, res) {
  const signature = req.headers['x-xero-signature'];
  const rawBody = req.body;
  const webhookKey = resolveWebhookKey(req);

  if (!webhookKey) {
    return res.status(501).send('XERO_WEBHOOK_KEY not configured');
  }

  if (!verifySignature(rawBody, signature, webhookKey)) {
    return res.status(401).send('Invalid signature');
  }

  let payload;
  try {
    payload = typeof rawBody === 'object' && Buffer.isBuffer(rawBody)
      ? JSON.parse(rawBody.toString('utf8'))
      : (typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody);
  } catch {
    return res.status(200).send(); // accept anyway, signature was valid
  }

  // Optional: enqueue events for async processing (e.g. sync invoice status)
  const events = payload?.events || [];
  if (events.length > 0) {
    // TODO: e.g. add to queue or log for later processing
  }

  return res.status(200).send();
}

module.exports = { webhookHandler };
