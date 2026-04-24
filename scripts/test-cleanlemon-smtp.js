/**
 * One-off: verify CLEANLEMON_* SMTP (same as forgot-password). Does not print secrets.
 * Usage: node scripts/test-cleanlemon-smtp.js
 * Optional: set TEST_TO=some@email.com to send one test message after verify.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const nodemailer = require('nodemailer');

async function main() {
  const host = process.env.CLEANLEMON_SMTP_HOST;
  const port = Number(process.env.CLEANLEMON_SMTP_PORT) || 587;
  const secure =
    process.env.CLEANLEMON_SMTP_SECURE === 'true' || process.env.CLEANLEMON_SMTP_SECURE === '1';
  const user = process.env.CLEANLEMON_SMTP_USER;
  /** Gmail app passwords are 16 chars; strip spaces if pasted with groups. */
  const pass = String(process.env.CLEANLEMON_SMTP_PASS || '')
    .replace(/\s+/g, '')
    .trim();
  const fromEmail = process.env.CLEANLEMON_PORTAL_RESET_FROM_EMAIL;
  const fromName = process.env.CLEANLEMON_PORTAL_RESET_FROM_NAME || 'Cleanlemons';

  const missing = [];
  if (!host) missing.push('CLEANLEMON_SMTP_HOST');
  if (!user) missing.push('CLEANLEMON_SMTP_USER');
  if (!pass) missing.push('CLEANLEMON_SMTP_PASS');
  if (!fromEmail) missing.push('CLEANLEMON_PORTAL_RESET_FROM_EMAIL');
  if (missing.length) {
    console.error('[test-cleanlemon-smtp] Missing env:', missing.join(', '));
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  console.log('[test-cleanlemon-smtp] Verifying SMTP connection…', {
    host,
    port,
    secure,
    user,
    passLength: pass.length,
  });
  if (pass.length !== 16) {
    console.warn(
      '[test-cleanlemon-smtp] App password length is',
      pass.length,
      '(expected 16 after removing spaces). Fix CLEANLEMON_SMTP_PASS in .env.'
    );
  }
  try {
    await transporter.verify();
    console.log('[test-cleanlemon-smtp] OK: verify() succeeded (login + connection).');
  } catch (err) {
    console.error('[test-cleanlemon-smtp] FAIL: verify()', err.message || err);
    process.exit(2);
  }

  const testTo = String(process.env.TEST_TO || '').trim();
  if (testTo) {
    try {
      await transporter.sendMail({
        from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
        to: testTo,
        subject: '[Cleanlemons SMTP test] OK',
        text: 'If you see this, CLEANLEMON_* SMTP can send mail.',
      });
      console.log('[test-cleanlemon-smtp] OK: test email sent to', testTo);
    } catch (err) {
      console.error('[test-cleanlemon-smtp] FAIL: sendMail', err.message || err);
      process.exit(3);
    }
  } else {
    console.log('[test-cleanlemon-smtp] Skip send (set TEST_TO=your@email.com to send one test).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
