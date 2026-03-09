/**
 * Get client IP from request. Use when ECS is behind proxy (e.g. apps/webbrowser).
 * Prefer X-Forwarded-For (first IP = client), then X-Real-IP, then req.ip / socket.
 * @param {import('express').Request} req
 * @returns {string} IP string, max 45 chars (IPv6 length); empty if none.
 */
function getClientIp(req) {
  if (!req) return '';
  const forwarded = req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (forwarded) {
    const first = typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0];
    const ip = (first && String(first).trim()) || '';
    if (ip.length > 45) return ip.slice(0, 45);
    return ip;
  }
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || (req.socket && req.socket.remoteAddress) || '';
  const s = String(ip).trim();
  if (s.length > 45) return s.slice(0, 45);
  return s;
}

module.exports = { getClientIp };
