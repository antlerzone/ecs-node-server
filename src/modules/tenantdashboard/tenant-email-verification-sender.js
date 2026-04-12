/**
 * Send verification code to new email for tenant email change.
 * Default: log only. Override sendVerificationCode to use nodemailer/SES/SendGrid etc.
 */

async function sendVerificationCode(newEmail, code) {
  console.log('[tenant-email-verification] Code for', newEmail, ':', code);
}

module.exports = { sendVerificationCode };
