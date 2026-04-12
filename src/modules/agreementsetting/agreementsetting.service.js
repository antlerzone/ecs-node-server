/**
 * Agreement Setting – list/create/update/delete agreement templates from MySQL.
 * Uses table: agreementtemplate (id, client_id, title, templateurl, folderurl, template_oss_url, html, mode, created_at, updated_at).
 * HTML: Drive API export Google Doc → HTML (OAuth or service account). Preview PDF: Node Docs/Drive API + same auth → OSS on save; download can also generate on the fly.
 * All FK by client_id; no _wixid in business logic.
 */

const { randomUUID } = require('crypto');
const axios = require('axios');
const pool = require('../../config/db');
const { uploadToOss } = require('../upload/oss.service');
const { exportGoogleDocAsHtml } = require('../agreement/google-docs-pdf');
const {
  generateTemplatePreviewPdfUrl,
  generateTemplatePreviewPdfBuffer,
  resolveAgreementPdfAuth
} = require('../agreement/agreement.service');

function extractIdFromUrlOrId(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (/^[\w-]{25,}$/.test(s)) return s;
  const m = s.match(/[-\w]{25,}/);
  return m ? m[0] : null;
}

/**
 * Build template preview PDF via Node (Docs + Drive API), upload to OSS. Async; called after create/update.
 */
async function buildAgreementPreviewPdfFromNode(clientId, templateId) {
  const [rows] = await pool.query(
    'SELECT id, title, templateurl, folderurl, mode FROM agreementtemplate WHERE id = ? AND client_id = ? LIMIT 1',
    [templateId, clientId]
  );
  const row = rows[0];
  if (!row) return;
  const tu = (row.templateurl || '').trim();
  const fu = (row.folderurl || '').trim();
  const title = (row.title || '').trim() || 'Agreement';
  if (!tu || !fu) {
    await pool.query(
      'UPDATE agreementtemplate SET preview_pdf_status = NULL, preview_pdf_oss_url = NULL, preview_pdf_error = NULL WHERE id = ?',
      [templateId]
    );
    return;
  }
  const templateDocId = extractIdFromUrlOrId(tu);
  const folderId = extractIdFromUrlOrId(fu);
  if (!templateDocId || !folderId) {
    await pool.query(
      `UPDATE agreementtemplate SET preview_pdf_status = 'failed', preview_pdf_error = ? WHERE id = ?`,
      ['Invalid template or folder URL', templateId]
    );
    return;
  }
  const authForPdf = await resolveAgreementPdfAuth(clientId);
  if (!authForPdf) {
    await pool.query(
      `UPDATE agreementtemplate SET preview_pdf_status = 'failed', preview_pdf_error = ? WHERE id = ?`,
      [
        'Connect Google Drive in Company Settings or set GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS',
        templateId
      ]
    );
    return;
  }
  await pool.query(
    `UPDATE agreementtemplate SET preview_pdf_status = 'pending', preview_pdf_oss_url = NULL, preview_pdf_error = NULL WHERE id = ?`,
    [templateId]
  );
  try {
    const { pdfBuffer: pdfBuf } = await generateTemplatePreviewPdfBuffer(
      { templateurl: tu, folderurl: fu, title, mode: row.mode || '' },
      { clientId }
    );
    if (!pdfBuf?.length) throw new Error('EMPTY_PDF');
    const up = await uploadToOss(pdfBuf, `agreement-preview-${String(templateId).slice(0, 8)}.pdf`, clientId);
    if (!up.ok) throw new Error(up.reason || 'OSS_UPLOAD_FAILED');
    await pool.query(
      `UPDATE agreementtemplate SET preview_pdf_oss_url = ?, preview_pdf_status = 'ready', preview_pdf_error = NULL WHERE id = ?`,
      [up.url, templateId]
    );
    console.log('[agreementsetting] preview PDF ready templateId=', templateId);
  } catch (e) {
    const msg = (e && e.message) ? String(e.message).slice(0, 500) : 'UNKNOWN';
    await pool.query(
      `UPDATE agreementtemplate SET preview_pdf_status = 'failed', preview_pdf_error = ? WHERE id = ?`,
      [msg, templateId]
    );
    console.error('[agreementsetting] buildAgreementPreviewPdfFromNode', templateId, msg);
  }
}

function scheduleAgreementPreviewBuild(clientId, templateId) {
  setImmediate(() => {
    buildAgreementPreviewPdfFromNode(clientId, templateId).catch((err) =>
      console.error('[agreementsetting] scheduleAgreementPreviewBuild', err)
    );
  });
}

const DEFAULT_PAGE_SIZE = 10;
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

  let rows;
  try {
    [rows] = await pool.query(
      `SELECT a.id, a.title, a.templateurl, a.folderurl, a.template_oss_url, a.mode, a.created_at,
              a.preview_pdf_oss_url, a.preview_pdf_status, a.preview_pdf_error
         FROM agreementtemplate a
         WHERE ${whereSql}
         ${orderSql}
         LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
  } catch (err) {
    const msg = (err && err.message) ? String(err.message) : '';
    if (msg.includes('preview_pdf_oss_url') || msg.includes('Unknown column')) {
      [rows] = await pool.query(
        `SELECT a.id, a.title, a.templateurl, a.folderurl, a.template_oss_url, a.mode, a.created_at
           FROM agreementtemplate a
           WHERE ${whereSql}
           ${orderSql}
           LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );
    } else {
      throw err;
    }
  }

  const items = (rows || []).map(r => ({
    _id: r.id,
    id: r.id,
    title: r.title || '',
    templateurl: r.templateurl || '',
    folderurl: r.folderurl || '',
    template_oss_url: r.template_oss_url || '',
    mode: r.mode || null,
    created_at: r.created_at,
    preview_pdf_oss_url: r.preview_pdf_oss_url != null ? String(r.preview_pdf_oss_url) : '',
    preview_pdf_status: r.preview_pdf_status != null ? String(r.preview_pdf_status) : '',
    preview_pdf_error: r.preview_pdf_error != null ? String(r.preview_pdf_error) : ''
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
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT id, title, templateurl, folderurl, template_oss_url, mode, created_at,
              preview_pdf_oss_url, preview_pdf_status, preview_pdf_error
         FROM agreementtemplate WHERE id = ? AND client_id = ? LIMIT 1`,
      [id, clientId]
    );
  } catch (err) {
    const msg = (err && err.message) ? String(err.message) : '';
    if (msg.includes('preview_pdf_oss_url') || msg.includes('Unknown column')) {
      [rows] = await pool.query(
        'SELECT id, title, templateurl, folderurl, template_oss_url, mode, created_at FROM agreementtemplate WHERE id = ? AND client_id = ? LIMIT 1',
        [id, clientId]
      );
    } else {
      throw err;
    }
  }
  const r = rows[0];
  if (!r) return null;
  return {
    _id: r.id,
    id: r.id,
    title: r.title || '',
    templateurl: r.templateurl || '',
    folderurl: r.folderurl || '',
    template_oss_url: r.template_oss_url || '',
    mode: r.mode || null,
    created_at: r.created_at,
    preview_pdf_oss_url: r.preview_pdf_oss_url != null ? String(r.preview_pdf_oss_url) : '',
    preview_pdf_status: r.preview_pdf_status != null ? String(r.preview_pdf_status) : '',
    preview_pdf_error: r.preview_pdf_error != null ? String(r.preview_pdf_error) : ''
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
    `INSERT INTO agreementtemplate (id, client_id, title, templateurl, folderurl, template_oss_url, mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NOW(), NOW())`,
    [id, clientId, title, templateurl, folderurl, mode]
  );
  if ((templateurl || '').trim() && (folderurl || '').trim()) {
    scheduleAgreementPreviewBuild(clientId, id);
  }

  return {
    _id: id,
    id,
    title,
    templateurl,
    folderurl,
    template_oss_url: '',
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
  const [after] = await pool.query(
    'SELECT templateurl, folderurl FROM agreementtemplate WHERE id = ? AND client_id = ? LIMIT 1',
    [id, clientId]
  );
  const ar = after[0];
  if (ar && (ar.templateurl || '').trim() && (ar.folderurl || '').trim()) {
    scheduleAgreementPreviewBuild(clientId, id);
  } else {
    await pool.query(
      'UPDATE agreementtemplate SET preview_pdf_oss_url = NULL, preview_pdf_status = NULL, preview_pdf_error = NULL WHERE id = ?',
      [id]
    );
  }
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
 * Generate HTML from Google Doc via Drive API export and save to agreementtemplate.html.
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

  const authForPdf = await resolveAgreementPdfAuth(clientId);
  if (!authForPdf) {
    console.error('[agreementsetting] generateAgreementHtmlPreview: no Google auth (Company Settings or service account)');
    return { ok: false };
  }

  try {
    const html = await exportGoogleDocAsHtml(docId, authForPdf);
    await pool.query(
      'UPDATE agreementtemplate SET html = ?, updated_at = NOW() WHERE id = ?',
      [html, agreementTemplateId]
    );
    return { ok: true, htmlLength: html.length };
  } catch (err) {
    console.error('[agreementsetting generateHtml]', err.message);
    return { ok: false };
  }
}

/**
 * Generate preview PDF for a template: replace {{variables}} with sample values and style replaced text red. Returns PDF URL for download.
 * @param {string} clientId
 * @param {string} templateId
 * @returns {Promise<{ ok: true, pdfUrl: string } | { ok: false, reason: string }>}
 */
async function previewPdf(clientId, templateId) {
  if (!templateId) return { ok: false, reason: 'NO_ID' };
  const item = await getAgreement(clientId, templateId);
  if (!item) return { ok: false, reason: 'NOT_FOUND' };
  if (!item.templateurl?.trim()) return { ok: false, reason: 'MISSING_TEMPLATE_URL' };
  if (!item.folderurl?.trim()) return { ok: false, reason: 'MISSING_FOLDER_URL' };
  try {
    const result = await generateTemplatePreviewPdfUrl(
      {
        templateurl: item.templateurl,
        folderurl: item.folderurl,
        title: item.title || 'Agreement',
        mode: item.mode || ''
      },
      { clientId }
    );
    return { ok: true, pdfUrl: result.pdfUrl };
  } catch (err) {
    console.error('[agreementsetting previewPdf]', err.message);
    return { ok: false, reason: err.message || 'PDF_GENERATION_FAILED' };
  }
}

/**
 * Preview PDF for download: prefer OSS copy from last save; if missing, generate on the fly with Node + OAuth/SA (same as agreement PDF).
 */
async function previewPdfBuffer(clientId, templateId) {
  if (!templateId) throw new Error('NO_ID');
  const item = await getAgreement(clientId, templateId);
  if (!item) throw new Error('NOT_FOUND');
  if (!item.templateurl?.trim() || !item.folderurl?.trim()) {
    throw new Error('MISSING_TEMPLATE_OR_FOLDER');
  }
  const preUrl = (item.preview_pdf_oss_url || '').trim();
  if (preUrl) {
    const pdfRes = await axios.get(preUrl, { responseType: 'arraybuffer', timeout: 60000, maxRedirects: 5 });
    if (pdfRes.status !== 200 || !pdfRes.data) throw new Error('PREVIEW_OSS_FETCH_FAILED');
    return Buffer.from(pdfRes.data);
  }
  const { pdfBuffer } = await generateTemplatePreviewPdfBuffer(
    {
      templateurl: item.templateurl,
      folderurl: item.folderurl,
      title: item.title || 'Agreement',
      mode: item.mode || ''
    },
    { clientId }
  );
  if (!pdfBuffer?.length) throw new Error('EMPTY_PDF');
  return pdfBuffer;
}

module.exports = {
  getAgreementList,
  getAgreementFilters,
  getAgreement,
  createAgreement,
  updateAgreement,
  deleteAgreement,
  generateAgreementHtmlPreview,
  previewPdf,
  previewPdfBuffer
};
