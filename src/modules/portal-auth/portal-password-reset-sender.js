/**
 * Send password reset code to user email.
 * - Coliving: PORTAL_RESET_* + SMTP_*
 * - Cleanlemons: CLEANLEMON_PORTAL_RESET_* + CLEANLEMON_SMTP_* (when request is cleanlemons, API listens on 5001,
 *   or local dev: browser Origin is Cleanlemons Next default port — see getPortalProductFromRequest)
 * - Otherwise: log only.
 * See docs/portal-password-reset-email.md for setup (Gmail, SendGrid, SES, etc.).
 */

/**
 * @param {import('express').Request | null | undefined} req
 * @returns {'cleanlemons'|'coliving'}
 */
/**
 * Next `next dev` default port is 3000; `next start` / docs often use 3100. Coliving portal dev uses 3001.
 * Comma-separated override: CLEANLEMON_NEXT_DEV_PORTS=3000,3100
 */
function getCleanlemonsNextDevPorts() {
  const raw = String(process.env.CLEANLEMON_NEXT_DEV_PORTS || '').trim();
  if (raw) {
    const parts = raw.split(/[\s,]+/).map((s) => s.replace(/\D/g, '')).filter(Boolean);
    if (parts.length) return parts;
  }
  const legacy = String(process.env.CLEANLEMON_NEXT_DEV_PORT || '').trim().replace(/\D/g, '');
  if (legacy) return [legacy];
  return ['3000', '3100', '3101'];
}

/**
 * Local: Browser Origin/Referer e.g. http://localhost:3000 — API may be http://127.0.0.1:5000 so Host alone is not enough.
 */
function looksLikeCleanlemonsNextDevBrowserRequest(req) {
  if (!req || typeof req.get !== 'function') return false;
  const ports = getCleanlemonsNextDevPorts();
  const hitPort = (u, port) => {
    const s = String(u || '');
    return (
      s.includes(`localhost:${port}`) ||
      s.includes(`127.0.0.1:${port}`) ||
      s.includes(`[::1]:${port}`)
    );
  };
  const origin = req.get('origin');
  const referer = req.get('referer');
  for (const port of ports) {
    if (hitPort(origin, port) || hitPort(referer, port)) return true;
  }
  return false;
}

function getPortalProductFromRequest(req) {
  if (!req) return 'coliving';
  if (typeof req.get === 'function') {
    const xCln = String(req.get('x-cleanlemons-portal') || '').trim().toLowerCase();
    if (xCln === '1' || xCln === 'true' || xCln === 'yes') return 'cleanlemons';
  }
  try {
    const sock = req.socket || req.connection;
    const localPort = sock && sock.localPort;
    if (Number(localPort) === 5001) return 'cleanlemons';
  } catch (_) {
    /* ignore */
  }
  if (looksLikeCleanlemonsNextDevBrowserRequest(req)) return 'cleanlemons';
  const lower = (v) => String(v || '').toLowerCase();
  const blob = [
    lower(typeof req.get === 'function' ? req.get('host') : ''),
    lower(typeof req.get === 'function' ? req.get('origin') : ''),
    lower(typeof req.get === 'function' ? req.get('referer') : ''),
    lower(typeof req.get === 'function' ? req.get('x-forwarded-host') : ''),
  ]
    .filter(Boolean)
    .join(' ');
  if (blob.includes('cleanlemons')) return 'cleanlemons';
  return 'coliving';
}

/** Gmail app passwords are often shown as xxxx xxxx xxxx xxxx — strip spaces. */
function normalizeSmtpPass(p) {
  return String(p || '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * @param {'cleanlemons'|'coliving'} portalProduct
 */
function resolveSmtpMailConfig(portalProduct) {
  const isCln = portalProduct === 'cleanlemons';
  if (isCln) {
    const fromEmail = process.env.CLEANLEMON_PORTAL_RESET_FROM_EMAIL || process.env.PORTAL_RESET_FROM_EMAIL;
    const fromName =
      process.env.CLEANLEMON_PORTAL_RESET_FROM_NAME || process.env.PORTAL_RESET_FROM_NAME || 'Cleanlemons';
    const smtpHost = process.env.CLEANLEMON_SMTP_HOST || process.env.SMTP_HOST;
    const smtpPort = process.env.CLEANLEMON_SMTP_PORT || process.env.SMTP_PORT;
    const smtpUser = process.env.CLEANLEMON_SMTP_USER || process.env.SMTP_USER;
    const smtpPass = normalizeSmtpPass(process.env.CLEANLEMON_SMTP_PASS || process.env.SMTP_PASS);
    const secureRaw = process.env.CLEANLEMON_SMTP_SECURE ?? process.env.SMTP_SECURE;
    return { fromEmail, fromName, smtpHost, smtpPort, smtpUser, smtpPass, secureRaw };
  }
  const fromEmail = process.env.PORTAL_RESET_FROM_EMAIL;
  const fromName = process.env.PORTAL_RESET_FROM_NAME || 'Coliving Management';
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = normalizeSmtpPass(process.env.SMTP_PASS);
  const secureRaw = process.env.SMTP_SECURE;
  return { fromEmail, fromName, smtpHost, smtpPort, smtpUser, smtpPass, secureRaw };
}

/**
 * @param {string} email
 * @param {string} code
 * @param {{ portalProduct?: 'cleanlemons'|'coliving' }} [options]
 */
async function sendPasswordResetCode(email, code, options = {}) {
  const portalProduct = options.portalProduct || 'coliving';
  const { fromEmail, fromName, smtpHost, smtpPort, smtpUser, smtpPass, secureRaw } =
    resolveSmtpMailConfig(portalProduct);

  const hasSmtp = smtpHost && smtpPort && smtpUser && smtpPass && fromEmail;

  if (hasSmtp) {
    try {
      const nodemailer = require('nodemailer');
      const secure = secureRaw === 'true' || secureRaw === '1';
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort) || 587,
        secure,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({
        from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
        to: email,
        subject: 'Your password reset code',
        text: `Your verification code is: ${code}\n\nThis code expires in 30 minutes. If you didn't request this, you can ignore this email.`,
        html: `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 30 minutes. If you didn't request this, you can ignore this email.</p>`,
      });
      console.log('[portal-password-reset] Email sent to', email, 'product=', portalProduct);
      return;
    } catch (err) {
      console.error('[portal-password-reset] Send failed:', err?.message || err);
      console.log('[portal-password-reset] Code for', email, ':', code, '(fallback: use this if email failed)');
      return;
    }
  }

  console.log(
    '[portal-password-reset] Code for',
    email,
    ':',
    code,
    `(no SMTP for product=${portalProduct}; set CLEANLEMON_* or PORTAL_RESET_* + SMTP_* to send)`
  );
}

/**
 * Generic OTP / notice email (email change, phone verification code sent to inbox when SMS not wired).
 * @param {{ portalProduct?: 'cleanlemons'|'coliving' }} [options]
 */
async function sendPortalOtpEmail(to, subject, textBody, htmlBody, options = {}) {
  const portalProduct = options.portalProduct || 'coliving';
  const { fromEmail, fromName, smtpHost, smtpPort, smtpUser, smtpPass, secureRaw } =
    resolveSmtpMailConfig(portalProduct);
  const hasSmtp = smtpHost && smtpPort && smtpUser && smtpPass && fromEmail;

  if (hasSmtp) {
    try {
      const nodemailer = require('nodemailer');
      const secure = secureRaw === 'true' || secureRaw === '1';
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort) || 587,
        secure,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({
        from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
        to,
        subject,
        text: textBody,
        html: htmlBody,
      });
      console.log('[portal-otp-email] sent to', to, 'product=', portalProduct);
      return;
    } catch (err) {
      console.error('[portal-otp-email] Send failed:', err?.message || err);
    }
  }
  console.log('[portal-otp-email] Code notice (no SMTP or send failed). To:', to, 'Subject:', subject, 'Body:', textBody);
}

/**
 * Same SMTP pool as password reset / OTP; returns outcome for API callers.
 * @param {'cleanlemons'|'coliving'} portalProduct
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function sendTransactionalEmail(portalProduct, to, subject, textBody, htmlBody) {
  const product = portalProduct === 'cleanlemons' ? 'cleanlemons' : 'coliving';
  const { fromEmail, fromName, smtpHost, smtpPort, smtpUser, smtpPass, secureRaw } =
    resolveSmtpMailConfig(product);
  const hasSmtp = smtpHost && smtpPort && smtpUser && smtpPass && fromEmail;
  if (!hasSmtp) return { ok: false, reason: 'SMTP_NOT_CONFIGURED' };
  try {
    const nodemailer = require('nodemailer');
    const secure = secureRaw === 'true' || secureRaw === '1';
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort) || 587,
      secure,
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transporter.sendMail({
      from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
      to,
      subject,
      text: textBody,
      html: htmlBody,
    });
    console.log('[portal-transactional-email] sent to', to, 'product=', product);
    return { ok: true };
  } catch (err) {
    const msg = String(err?.message || err || 'SEND_FAILED').slice(0, 240);
    console.error('[portal-transactional-email] Send failed:', msg);
    return { ok: false, reason: msg || 'SEND_FAILED' };
  }
}

module.exports = {
  sendPasswordResetCode,
  sendPortalOtpEmail,
  sendTransactionalEmail,
  getPortalProductFromRequest,
  resolveSmtpMailConfig,
};
