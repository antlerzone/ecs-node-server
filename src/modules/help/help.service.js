/**
 * Help – FAQ list + ticket submit, for Wix Help page.
 * Uses MySQL: faq, ticket.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { notifySaasManualTicket } = require('./saas-manual-ticket-notify');

const DEFAULT_PAGE_SIZE = 10;

/**
 * FAQ list, paginated. Newest first.
 * @param {number} page - 1-based
 * @param {number} pageSize
 * @returns {Promise<{ ok: boolean, items: Array<{ _id: string, title: string, docs?: string, _createdDate: string }>, totalCount: number }>}
 */
async function getFaqPage(page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.max(1, Math.min(100, parseInt(pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (p - 1) * ps;

  const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM faq');
  const totalCount = Number(countRows[0]?.total) || 0;

  const [rows] = await pool.query(
    'SELECT id, title, docs, created_at FROM faq ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [ps, offset]
  );

  const items = (rows || []).map((r) => ({
    _id: r.id,
    title: r.title || '',
    docs: r.docs || undefined,
    _createdDate: r.created_at ? new Date(r.created_at).toISOString() : ''
  }));

  return { ok: true, items, totalCount };
}

/**
 * Submit a ticket (request/feedback/help).
 * @param {string} email - submitter email
 * @param {{ mode: string, description: string, video?: string, photo?: string, clientId?: string, ticketId?: string }} payload
 */
async function submitTicket(email, payload) {
  const mode = String(payload?.mode || 'help').trim() || 'help';
  const description = String(payload?.description || '').trim();
  if (!description) throw new Error('DESCRIPTION_REQUIRED');

  const ticketId = payload?.ticketId || generateTicketId();
  const id = randomUUID();
  const video = payload?.video ? String(payload.video).trim() : null;
  const photo = payload?.photo ? String(payload.photo).trim() : null;
  const clientId = payload?.clientId || null;
  const emailVal = email ? String(email).trim() : null;

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  await pool.query(
    `INSERT INTO ticket (id, mode, description, video, photo, client_id, email, ticketid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, mode, description, video, photo, clientId, emailVal, ticketId, now, now]
  );

  if (mode === 'topup_manual' || mode === 'billing_manual') {
    void notifySaasManualTicket({
      mode,
      ticketid: ticketId,
      description,
      submitterEmail: emailVal,
      clientId
    });
  }

  return { ok: true, ticketId };
}

function generateTicketId() {
  const now = new Date();
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `T${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${rand}`;
}

/**
 * Record API error to ticket table for later review (page, when, what clicked, which function, path, reason).
 * Call when any API returns { ok: false } or when uncaught error is sent. Frontend should send page, action, functionName in body.
 * @param {object} req - Express request (req.path, req.method, req.body, req.client?.id)
 * @param {{ reason?: string, message?: string }} responseBody - the response body with ok: false
 * @returns {Promise<void>}
 */
async function recordApiError(req, responseBody) {
  if (!req || !responseBody) return;
  const reason = responseBody.reason || responseBody.message || 'UNKNOWN_ERROR';
  const body = req.body || {};
  const page = body.page != null ? String(body.page).trim().slice(0, 255) : null;
  const actionClicked = body.action != null ? String(body.action).trim().slice(0, 255) : (body.actionClicked != null ? String(body.actionClicked).trim().slice(0, 255) : null);
  const functionName = body.functionName != null ? String(body.functionName).trim().slice(0, 255) : (body.function != null ? String(body.function).trim().slice(0, 255) : null);
  const apiPath = req.path ? String(req.path).trim().slice(0, 500) : null;
  const apiMethod = req.method ? String(req.method).trim().slice(0, 10) : null;
  const email = body.email != null ? String(body.email).trim().slice(0, 255) : null;
  const clientId = req.client?.id || body.clientId || null;

  const id = randomUUID();
  const ticketId = generateTicketId();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const descParts = [reason.slice(0, 65535)];
  if (page) descParts.push(`page: ${page}`);
  if (apiPath) descParts.push(`path: ${apiPath}`);
  if (apiMethod) descParts.push(`method: ${apiMethod}`);
  if (actionClicked) descParts.push(`action: ${actionClicked}`);
  if (functionName) descParts.push(`function: ${functionName}`);
  const description = descParts.join(' | ');

  try {
    await pool.query(
      `INSERT INTO ticket (id, mode, description, client_id, email, ticketid, created_at, updated_at)
       VALUES (?, 'api_error', ?, ?, ?, ?, ?, ?)`,
      [id, description.slice(0, 65535), clientId, email, ticketId, now, now]
    );
  } catch (err) {
    console.error('[help] recordApiError insert failed', err.message);
  }
}

/**
 * Record accounting failure to ticket table (mode=accounting_error) for support review.
 * Use when invoice/receipt/purchase creation fails in backend (no API res.json).
 * @param {string} clientId
 * @param {{ context: string, reason: string, ids?: string[], provider?: string }} payload
 * @returns {Promise<void>}
 */
async function recordAccountingError(clientId, payload) {
  if (!clientId || !payload || !payload.reason) return;
  const context = String(payload.context || 'accounting').trim().slice(0, 255);
  const reason = String(payload.reason).slice(0, 65535);
  const ids = Array.isArray(payload.ids) ? payload.ids.slice(0, 50) : [];
  const provider = payload.provider ? String(payload.provider).trim().slice(0, 50) : null;
  const description = [context, reason, ids.length ? `ids: ${ids.join(', ')}` : '', provider ? `provider: ${provider}` : ''].filter(Boolean).join(' | ');

  const id = randomUUID();
  const ticketId = generateTicketId();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  try {
    await pool.query(
      `INSERT INTO ticket (id, mode, description, client_id, ticketid, created_at, updated_at)
       VALUES (?, 'accounting_error', ?, ?, ?, ?, ?)`,
      [id, description.slice(0, 65535), clientId, ticketId, now, now]
    );
  } catch (err) {
    console.error('[help] recordAccountingError insert failed', err.message);
  }
}

/**
 * Record manual billing (pricing plan upgrade/renew) so it appears in help/ticket for staff to see and process.
 * @param {string} clientId
 * @param {string|null} email
 * @param {{ scenario: string, referenceNumber: string, amount: number, currency: string, planTitle: string }} payload
 */
async function recordManualBillingTicket(clientId, email, payload) {
  if (!clientId || !payload) return;
  const scenario = String(payload.scenario || 'plan').trim().slice(0, 50);
  const ref = String(payload.referenceNumber || '').trim().slice(0, 100);
  const amount = Number(payload.amount) || 0;
  const currency = String(payload.currency || '').trim().slice(0, 10);
  const planTitle = String(payload.planTitle || '').trim().slice(0, 255);
  const description = `[billing_manual] Client needs ${scenario}. Ref: ${ref}. Amount: ${currency} ${amount}. Plan: ${planTitle}. Please send invoice and update plan manually.`;

  const id = randomUUID();
  const ticketId = generateTicketId();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  await pool.query(
    `INSERT INTO ticket (id, mode, description, client_id, email, ticketid, created_at, updated_at)
     VALUES (?, 'billing_manual', ?, ?, ?, ?, ?, ?)`,
    [id, description.slice(0, 65535), clientId, email || null, ticketId, now, now]
  );

  void notifySaasManualTicket({
    mode: 'billing_manual',
    ticketid: ticketId,
    description: description.slice(0, 65535),
    submitterEmail: email || null,
    clientId
  });
}

module.exports = {
  getFaqPage,
  submitTicket,
  recordApiError,
  recordAccountingError,
  recordManualBillingTicket
};
