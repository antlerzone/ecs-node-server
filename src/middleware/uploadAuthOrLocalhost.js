/**
 * OSS upload (multipart) is proxied by Next.js from the browser to ECS as
 * POST http://127.0.0.1:5000/api/upload — same-machine, no browser Bearer token.
 * apiAuth requires ECS_API_TOKEN on every request; if Next .env is missing/wrong,
 * JSON APIs might still work via other paths but uploads fail with 401.
 *
 * For connections from loopback only, skip apiAuth. Upload handler still requires
 * clientId in the form and writes under uploads/{clientId}/...
 */
const apiAuth = require('./apiAuth');

function isLoopbackAddress(addr) {
  const a = String(addr || '').trim();
  return a === '127.0.0.1' || a === '::ffff:127.0.0.1' || a === '::1';
}

module.exports = function uploadAuthOrLocalhost(req, res, next) {
  const raw = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  if (isLoopbackAddress(raw)) {
    return next();
  }
  return apiAuth(req, res, next);
};
