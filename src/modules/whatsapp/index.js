/**
 * WhatsApp Business API (Meta Cloud API) – service wrapper.
 * Use for omnichannel later: send messages, parse webhook.
 *
 * Usage:
 *   const whatsapp = require('./src/modules/whatsapp');
 *   const creds = await whatsapp.getWhatsAppCreds(clientId);
 *   await whatsapp.sendText(creds, '+60123456789', 'Hello');
 *   const events = whatsapp.parseWebhookPayload(req.body);
 */

const { getWhatsAppCreds, getWhatsAppCredsFromReq } = require('./lib/whatsappCreds');
const {
  sendText,
  sendTemplate,
  parseWebhookPayload,
  verifyWebhook,
  normalizePhone
} = require('./wrappers/message.wrapper');

module.exports = {
  getWhatsAppCreds,
  getWhatsAppCredsFromReq,
  sendText,
  sendTemplate,
  parseWebhookPayload,
  verifyWebhook,
  normalizePhone
};
