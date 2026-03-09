/**
 * Get Bukku token and subdomain for the current client.
 * Expects req.client to have bukku_token and bukku_subdomain
 * (e.g. from clientresolver or client_integration where provider=bukku).
 * @param {object} req - Express request (req.client must be set)
 * @returns {{ token: string, subdomain: string }}
 */
function getBukkuCreds(req) {
  if (!req.client) {
    throw new Error('missing client');
  }
  const token = req.client.bukku_token ?? req.client.bukku_secretKey;
  const subdomain = req.client.bukku_subdomain;
  if (!token || !subdomain) {
    throw new Error('missing bukku token or subdomain for this client');
  }
  return { token, subdomain };
}

module.exports = { getBukkuCreds };
