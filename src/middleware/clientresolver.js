const pool = require('../config/db');

module.exports = async function (req, res, next) {
  try {
    // Use originalUrl so path is full (e.g. /api/portal-auth/google) regardless of router mount.
    const path = (req.originalUrl || req.url || req.path || '').split('?')[0];
    // Subdomain → client applies only to API routes. Next.js assets (/_next/*), /, etc. must not
    // hit MySQL here — if Nginx misroutes portal static files to this Node process, a DB error
    // would otherwise surface as 500 on .css/.js (ChunkLoadError in the browser).
    if (!path.startsWith('/api/')) {
      return next();
    }
    // Public or platform routes: no client required (no subdomain → client lookup).
    if (
      path.startsWith('/api/availableunit') ||
      path.startsWith('/api/available-unit') ||
      path.startsWith('/api/cleanlemon') ||
      path.startsWith('/api/public')
    ) {
      return next();
    }
    // Tenant dashboard: client from tenancy/email in body, not from subdomain (fixes "client not found" when frontend calls api.colivingjb.com directly for meter topup etc).
    if (path.startsWith('/api/tenantdashboard')) {
      return next();
    }
    // Portal login/register/OAuth and member-roles (used from api.colivingjb.com, no client).
    if (path.startsWith('/api/portal-auth') || path.startsWith('/api/access')) {
      if (path.startsWith('/api/portal-auth')) {
        console.log('[clientresolver] skip portal-auth, path=', path);
      }
      return next();
    }

    const host = (req.headers.host || '').split(':')[0];

    if (!host) {
      return res.status(400).json({ ok: false, message: 'missing host' });
    }

    // Same-ECS proxy (Next → Node on 127.0.0.1): skip subdomain lookup; routes get client from body/query.
    if (host === '127.0.0.1' || host === 'localhost') {
      return next();
    }

    // API canonical host (e.g. api.colivingjb.com): client from body/session/state, not subdomain; skip to avoid "client not found".
    const publicAppUrl = process.env.PUBLIC_APP_URL && String(process.env.PUBLIC_APP_URL).trim();
    if (publicAppUrl) {
      try {
        const apiHost = new URL(publicAppUrl).hostname;
        if (apiHost && host === apiHost) return next();
      } catch (_) {}
    }

    const subdomain = host.split('.')[0];

    const [rows] = await pool.query(
      'select * from clients where subdomain = ?',
      [subdomain]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: 'client not found' });
    }

    req.client = rows[0];

    next();
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};