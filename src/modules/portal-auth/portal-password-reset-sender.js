/**
 * Send password reset code to user email.
 * - If SMTP_* and PORTAL_RESET_FROM_EMAIL are set in env: send real email via nodemailer.
 * - Otherwise: log only (user won't receive email; check pm2 logs for the code).
 * See docs/portal-password-reset-email.md for setup (Gmail, SendGrid, SES, etc.).
 */

async function sendPasswordResetCode(email, code) {
  const fromEmail = process.env.PORTAL_RESET_FROM_EMAIL;
  const fromName = process.env.PORTAL_RESET_FROM_NAME || 'Coliving Management';
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  const hasSmtp = smtpHost && smtpPort && smtpUser && smtpPass && fromEmail;

  if (hasSmtp) {
    try {
      const nodemailer = require('nodemailer');
      const secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1';
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort) || 587,
        secure,
        auth: { user: smtpUser, pass: smtpPass }
      });
      await transporter.sendMail({
        from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
        to: email,
        subject: 'Your password reset code',
        text: `Your verification code is: ${code}\n\nThis code expires in 30 minutes. If you didn't request this, you can ignore this email.`,
        html: `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 30 minutes. If you didn't request this, you can ignore this email.</p>`
      });
      console.log('[portal-password-reset] Email sent to', email);
      return;
    } catch (err) {
      console.error('[portal-password-reset] Send failed:', err?.message || err);
      console.log('[portal-password-reset] Code for', email, ':', code, '(fallback: use this if email failed)');
      return;
    }
  }

  console.log('[portal-password-reset] Code for', email, ':', code, '(no SMTP configured; set SMTP_* and PORTAL_RESET_FROM_EMAIL to send real email)');
}

module.exports = { sendPasswordResetCode };
