/**
 * Agreement Setting – list/create/update/delete agreement templates from MySQL.
 * Uses table: agreementtemplate (id, client_id, title, templateurl, folderurl, html, mode, created_at, updated_at).
 * HTML preview: calls GAS (Google Apps Script) to convert Google Doc → HTML, then saves to agreementtemplate.html.
 * All FK by client_id; no _wixid in business logic.
 */

const { randomUUID } = require('crypto');
const axios = require('axios');
const pool = require('../../config/db');

const DEFAULT_PAGE_SIZE = 10;
// Same GAS URL as legacy backend/access/agreementhtml.jsw; override via AGREEMENT_HTML_GAS_URL if needed
const AGREEMENT_HTML_GAS_URL = process.env.AGREEMENT_HTML_GAS_URL ||
    'https://script.google.com/macros/s/AKfycbxUahMjh8ja-0W2Rlv_hA1ver-Q6w-1TrmReqj1DoO5w-FzPqz3S9jn5cYiPDiMwZlr/exec';
const MAX_PAGE_SIZE = 100;
const CACHE_LIMIT_MAX = 500;

function orderClause(sort) {
  switch (String(sort || 'new').toLowerCase()) {
    case 'old':
      return 'ORDER BY a.created_at ASC';
    case 'az':
      return 'ORDER BY a.title ASC';
    case 'za':
      return 'ORDER BY a.title DESC';
    case 'new':
    default:
      return 'ORDER BY a.created_at DESC';
  }
}

function listConditions(clientId, opts = {}) {
  const conditions = ['a.client_id = ?'];
  const params = [clientId];
  const search = (opts.search || '').trim();
  const mode = opts.mode === 'ALL' || !opts.mode ? null : opts.mode;
  if (search) {
    conditions.push('(a.title LIKE ?)');
    params.push(`%${search}%`);
  }
  if (mode) {
    conditions.push('a.mode = ?');
    params.push(mode);
  }
  return { whereSql: conditions.join(' AND '), params };
}

/**
 * List agreement templates for a client.
 * @param {string} clientId
 * @param {Object} opts - { search?, mode?, sort?, page?, pageSize?, limit? }
 *   limit: when set, one page with up to limit items (for frontend cache).
 * @returns {Promise<{ items, totalPages, currentPage, total }>}
 */
async function getAgreementList(clientId, opts = {}) {
  const limit = opts.limit != null ? Math.min(CACHE_LIMIT_MAX, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;
  const page = useLimit ? 1 : Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = useLimit ? limit : Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const { whereSql, params } = listConditions(clientId, opts);
  const orderSql = orderClause(opts.sort || 'new');

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM agreementtemplate a WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = useLimit ? 1 : Math.max(1, Math.ceil(total / pageSize));

  const [rows] = await pool.query(
    `SELECT a.id, a.title, a.templateurl, a.folderurl, a.mode, a.created_at
       FROM agreementtemplate a
       WHERE ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const items = (rows || []).map(r => ({
    _id: r.id,
    id: r.id,
    title: r.title || '',
    templateurl: r.templateurl || '',
    folderurl: r.folderurl || '',
    mode: r.mode || null,
    created_at: r.created_at
  }));

  return { items, totalPages, currentPage: page, total };
}

/**
 * Filters for agreement list: modes (static) and sort options.
 * @param {string} clientId - unused for modes (fixed list); kept for API consistency.
 * @returns {Promise<{ modes }>}
 */
async function getAgreementFilters(clientId) {
  const modes = [
    { value: 'owner_tenant', label: 'Owner & Tenant' },
    { value: 'owner_operator', label: 'Owner & Operator' },
    { value: 'tenant_operator', label: 'Tenant & Operator' }
  ];
  return { modes };
}

/**
 * Get one agreement template by id; must belong to client.
 */
async function getAgreement(clientId, id) {
  const [rows] = await pool.query(
    'SELECT id, title, templateurl, folderurl, mode, created_at FROM agreementtemplate WHERE id = ? AND client_id = ? LIMIT 1',
    [id, clientId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    _id: r.id,
    id: r.id,
    title: r.title || '',
    templateurl: r.templateurl || '',
    folderurl: r.folderurl || '',
    mode: r.mode || null,
    created_at: r.created_at
  };
}

/**
 * Create agreement template. Returns inserted row shape.
 */
async function createAgreement(clientId, data) {
  const id = randomUUID();
  const title = (data.title || '').trim();
  const templateurl = (data.templateurl || '').trim();
  const folderurl = (data.folderurl || '').trim();
  const mode = data.mode || null;

  await pool.query(
    `INSERT INTO agreementtemplate (id, client_id, title, templateurl, folderurl, mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [id, clientId, title, templateurl, folderurl, mode]
  );

  return {
    _id: id,
    id,
    title,
    templateurl,
    folderurl,
    mode,
    created_at: new Date()
  };
}

/**
 * Update agreement template. Returns { updated: true }.
 */
async function updateAgreement(clientId, id, data) {
  const [rows] = await pool.query(
    'SELECT id FROM agreementtemplate WHERE id = ? AND client_id = ? LIMIT 1',
    [id, clientId]
  );
  if (!rows.length) return { updated: false };

  const updates = [];
  const params = [];
  if (data.title !== undefined) {
    updates.push('title = ?');
    params.push(String(data.title).trim());
  }
  if (data.templateurl !== undefined) {
    updates.push('templateurl = ?');
    params.push(String(data.templateurl).trim());
  }
  if (data.folderurl !== undefined) {
    updates.push('folderurl = ?');
    params.push(String(data.folderurl).trim());
  }
  if (data.mode !== undefined) {
    updates.push('mode = ?');
    params.push(data.mode || null);
  }
  if (updates.length === 0) return { updated: true };
  params.push(id);
  await pool.query(
    `UPDATE agreementtemplate SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
    params
  );
  return { updated: true };
}

/**
 * Delete agreement template. Must belong to client.
 */
async function deleteAgreement(clientId, id) {
  const [result] = await pool.query(
    'DELETE FROM agreementtemplate WHERE id = ? AND client_id = ?',
    [id, clientId]
  );
  return { deleted: result.affectedRows > 0 };
}

function isStrictGoogleDoc(url) {
  if (!url) return false;
  return /^https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9-_]{20,}/i.test(url);
}

function extractDocId(url) {
  const match = String(url).match(/\/d\/([a-zA-Z0-9-_]{20,})/);
  return match ? match[1] : null;
}

/**
 * Generate HTML from Google Doc via GAS and save to agreementtemplate.html.
 *
 * @param {string} clientId - for ownership check
 * @param {string} agreementTemplateId
 * @returns {Promise<{ ok: boolean, htmlLength?: number }>}
 */
async function generateAgreementHtmlPreview(clientId, agreementTemplateId) {
  if (!agreementTemplateId) return { ok: false };

  const [rows] = await pool.query(
    'SELECT id, templateurl, html FROM agreementtemplate WHERE id = ? AND client_id = ? LIMIT 1',
    [agreementTemplateId, clientId]
  );
  const item = rows[0];
  if (!item) return { ok: false };

  const templateUrl = item.templateurl;
  if (!templateUrl || !isStrictGoogleDoc(templateUrl)) return { ok: false };

  const docId = extractDocId(templateUrl);
  if (!docId) return { ok: false };

  if (!AGREEMENT_HTML_GAS_URL) {
    console.error('[agreementsetting] AGREEMENT_HTML_GAS_URL not set');
    return { ok: false };
  }

  try {
    const resp = await axios.post(AGREEMENT_HTML_GAS_URL, { mode: 'html', templateId: docId }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 25000,
      responseType: 'json',
      validateStatus: () => true
    });
    if (resp.status !== 200) throw new Error(`GAS_HTTP_${resp.status}`);
    const result = resp.data;
    if (!result || result.status !== 'ok' || typeof result.html !== 'string') {
      throw new Error('GAS_STATUS_NOT_OK');
    }

    await pool.query(
      'UPDATE agreementtemplate SET html = ?, updated_at = NOW() WHERE id = ?',
      [result.html, agreementTemplateId]
    );
    return { ok: true, htmlLength: result.html.length };
  } catch (err) {
    console.error('[agreementsetting generateHtml]', err.message);
    return { ok: false };
  }
}

module.exports = {
  getAgreementList,
  getAgreementFilters,
  getAgreement,
  createAgreement,
  updateAgreement,
  deleteAgreement,
  generateAgreementHtmlPreview
};
