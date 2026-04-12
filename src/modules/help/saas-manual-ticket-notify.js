/**
 * Email SaaS ops when an operator submits a manual (~24h) billing or top-up ticket.
 * Uses SMTP_* + PORTAL_RESET_FROM_EMAIL (same as portal password reset) when configured.
 * Recipients: SAAS_MANUAL_TICKET_NOTIFY_TO (comma/semicolon), default colivingmanagement@gmail.com
 */

function parseNotifyTo() {
  const raw = process.env.SAAS_MANUAL_TICKET_NOTIFY_TO || 'colivingmanagement@gmail.com';
  return String(raw)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {{ mode: string, ticketid: string, description: string, submitterEmail?: string|null, clientId?: string|null }} opts
 */
async function notifySaasManualTicket(opts) {
  const mode = String(opts?.mode || '').trim();
  const ticketid = String(opts?.ticketid || '').trim();
  const description = String(opts?.description || '').trim();
  const submitterEmail = opts?.submitterEmail ? String(opts.submitterEmail).trim() : '';
  const clientId = opts?.clientId ? String(opts.clientId).trim() : '';

  const toList = parseNotifyTo();
  if (toList.length === 0) {
    console.warn('[saas-manual-ticket-notify] no SAAS_MANUAL_TICKET_NOTIFY_TO recipients');
    return;
  }

  const fromEmail = process.env.PORTAL_RESET_FROM_EMAIL;
  const fromName = process.env.PORTAL_RESET_FROM_NAME || 'Coliving SaaS';
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const hasSmtp = smtpHost && smtpPort && smtpUser && smtpPass && fromEmail;

  const adminUrl =
    process.env.SAAS_PORTAL_ADMIN_ENQUIRY_URL || 'https://portal.colivingjb.com/saas-admin?tab=enquiry';

  const subject = `[Coliving SaaS] Manual ticket ${ticketid || '(no id)'} (${mode})`;
  const text = [
    'An operator submitted a manual payment request (typically processed within ~24 hours).',
    '',
    `Ticket ID: ${ticketid || '—'}`,
    `Mode: ${mode}`,
    clientId ? `Client ID: ${clientId}` : '',
    submitterEmail ? `Submitter email: ${submitterEmail}` : '',
    '',
    'Description:',
    description || '—',
    '',
    `Open SaaS Admin: ${adminUrl}`,
    ''
  ]
    .filter(Boolean)
    .join('\n');

  const html = `<p>An operator submitted a <strong>manual</strong> payment request (~24h processing).</p>
<p><strong>Ticket ID:</strong> ${escapeHtml(ticketid || '—')}<br/>
<strong>Mode:</strong> ${escapeHtml(mode)}<br/>
${clientId ? `<strong>Client ID:</strong> ${escapeHtml(clientId)}<br/>` : ''}
${submitterEmail ? `<strong>Submitter:</strong> ${escapeHtml(submitterEmail)}<br/>` : ''}</p>
<p><strong>Description</strong></p><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(description || '—')}</pre>
<p><a href="${escapeAttr(adminUrl)}">Open SaaS Admin (Enquiry)</a></p>`;

  if (!hasSmtp) {
    console.log('[saas-manual-ticket-notify] (no SMTP) would email:', toList.join(', '));
    console.log('[saas-manual-ticket-notify] subject:', subject);
    return;
  }

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
      to: toList.join(', '),
      subject,
      text,
      html
    });
    console.log('[saas-manual-ticket-notify] Email sent for ticket', ticketid, '→', toList.join(', '));
  } catch (err) {
    console.error('[saas-manual-ticket-notify] Send failed:', err?.message || err);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

module.exports = { notifySaasManualTicket };
