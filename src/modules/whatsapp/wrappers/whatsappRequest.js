/**
 * WhatsApp Cloud API (Meta Graph API) HTTP helper.
 * Base: https://graph.facebook.com/v18.0
 * Auth: Bearer accessToken.
 */

const BASE = process.env.WHATSAPP_GRAPH_BASE || 'https://graph.facebook.com/v18.0';

/**
 * POST to Graph API.
 * @param {string} path - e.g. "123456789/messages" (phone_number_id/messages)
 * @param {string} accessToken - Meta app / WABA access token
 * @param {object} body - JSON body
 * @returns {Promise<object>} - JSON response
 */
async function whatsappPost(path, accessToken, body) {
  const url = `${BASE}/${path.replace(/^\//, '')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`WHATSAPP_NON_JSON_RESPONSE: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const errMsg = json?.error?.message || json?.error?.error_user_msg || text.slice(0, 200);
    const err = new Error(`WHATSAPP_API_ERROR: ${errMsg}`);
    err.statusCode = res.status;
    err.code = json?.error?.code;
    throw err;
  }
  return json;
}

module.exports = { whatsappPost };
