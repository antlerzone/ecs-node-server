/**
 * Xero Webhook receiver.
 * Xero sends POST with JSON body and x-xero-signature (HMAC-SHA256 of payload, base64).
 * Must respond 2xx within 5s for valid signature, 401 for invalid.
 * @see https://developer.xero.com/documentation/guides/webhooks/configuring-your-server
 */

const crypto = require('crypto');

const WEBHOOK_KEY = process.env.XERO_WEBHOOK_KEY;

function verifySignature(rawBody, signature) {
  if (!WEBHOOK_KEY || !signature || typeof signature !== 'string') return false;
  const payload = typeof rawBody === 'string' ? rawBody : (Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : (rawBody?.toString?.() ?? ''));
  const hash = crypto.createHmac('sha256', WEBHOOK_KEY).update(payload).digest('base64');
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

  if (!WEBHOOK_KEY) {
    return res.status(501).send('XERO_WEBHOOK_KEY not configured');
  }

  if (!verifySignature(rawBody, signature)) {
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
