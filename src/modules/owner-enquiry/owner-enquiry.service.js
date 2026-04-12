/**
 * Owner enquiry – owners looking for operator. No SaaS plan; store in owner_enquiry for proposal follow-up.
 * Body: { name?, company?, email, phone?, units?, message?, country?, currency? }
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');

async function submitOwnerEnquiry(payload) {
  const email = (payload.email || '').trim().toLowerCase();
  if (!email) {
    return { ok: false, reason: 'MISSING_REQUIRED_FIELDS' };
  }

  const id = randomUUID();
  const name = (payload.name || '').trim() || null;
  const company = (payload.company || '').trim() || null;
  const phone = (payload.phone || '').trim() || null;
  const units = payload.units != null ? String(payload.units).trim() || null : null;
  const message = (payload.message || '').trim() || null;
  const country = (payload.country || '').trim() || null;
  const currency = (payload.currency || '').trim() || null;

  await pool.query(
    `INSERT INTO owner_enquiry (id, name, company, email, phone, units, message, country, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, company, email, phone, units, message, country, currency]
  );

  return { ok: true, id, email };
}

module.exports = {
  submitOwnerEnquiry
};
