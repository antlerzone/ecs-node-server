/**
 * WhatsApp Business API credentials (per channel / client).
 * For now: pass { phoneNumberId, accessToken } from caller (env or future channel table).
 * Later: load from DB by clientId + channel id.
 */

/**
 * Get WhatsApp API credentials for a given context.
 * @param {string} [clientId] - Our client id (for future DB lookup)
 * @param {{ phoneNumberId?: string, accessToken?: string }} [overrides] - Override env; e.g. from channel config
 * @returns {Promise<{ phoneNumberId: string, accessToken: string }>}
 */
async function getWhatsAppCreds(clientId, overrides = {}) {
  const phoneNumberId = overrides.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = overrides.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error('WHATSAPP_CREDENTIALS_MISSING: set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN, or pass phoneNumberId + accessToken');
  }
  return { phoneNumberId, accessToken };
}

/**
 * Get creds from Express req (req.client.id). Optional req.body or req.query channel overrides.
 * @param {object} req - Express request
 * @returns {Promise<{ phoneNumberId: string, accessToken: string }>}
 */
async function getWhatsAppCredsFromReq(req) {
  const clientId = req?.client?.id;
  const overrides = req?.body?.whatsapp ?? req?.query?.whatsapp ?? {};
  return getWhatsAppCreds(clientId, overrides);
}

module.exports = { getWhatsAppCreds, getWhatsAppCredsFromReq };
