/**
 * Agreement Setting API – list/filters/get/create/update/delete/generate-html for agreement templates.
 * All POST with email in body; client from access context.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail, getAccessContextByEmailAndClient } = require('../access/access.service');
const {
  listOfficialTemplates,
  purchaseOfficialTemplates,
  exportOfficialTemplateDocx
} = require('./official-template.service');
const {
  getAgreementList,
  getAgreementFilters,
  getAgreement,
  createAgreement,
  updateAgreement,
  deleteAgreement,
  generateAgreementHtmlPreview,
  previewPdf,
  previewPdfBuffer
} = require('./agreementsetting.service');
const { getAgreementVariablesReference } = require('../agreement/agreement.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

async function requireClient(req, res, next) {
  if (req.clientId != null && req.client) {
    req.ctx = { client: req.client };
    return next();
  }
  const email = getEmail(req);
  if (req.apiUser && !email) {
    return res.status(403).json({ ok: false, reason: 'API_USER_NOT_BOUND_TO_CLIENT', message: 'API user must be bound to a client to access this resource' });
  }
  if (req.apiUser && email) {
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const clientId = ctx.client?.id;
    if (!clientId) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    req.ctx = ctx;
    req.clientId = clientId;
    return next();
  }
  if (!email) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
  const clientId = ctx.client?.id;
  if (!clientId) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
  req.ctx = ctx;
  req.clientId = clientId;
  next();
}

/** POST /api/agreementsetting/list – body: { email, search?, mode?, sort?, page?, pageSize?, limit? } */
router.post('/list', requireClient, async (req, res, next) => {
  try {
    const opts = {
      search: req.body?.search,
      mode: req.body?.mode,
      sort: req.body?.sort,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit
    };
    const result = await getAgreementList(req.clientId, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/filters – body: { email } → { modes } */
router.post('/filters', requireClient, async (req, res, next) => {
  try {
    const result = await getAgreementFilters(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/get – body: { email, id } */
router.post('/get', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) {
      return res.status(400).json({ ok: false, reason: 'NO_ID' });
    }
    const item = await getAgreement(req.clientId, id);
    if (!item) {
      return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/create – body: { email, title, templateurl?, folderurl?, mode } */
router.post('/create', requireClient, async (req, res, next) => {
  try {
    const { title, templateurl, folderurl, mode } = req.body || {};
    const inserted = await createAgreement(req.clientId, { title, templateurl, folderurl, mode });
    res.json(inserted);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/update – body: { email, id, title?, templateurl?, folderurl?, mode? } */
router.post('/update', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) {
      return res.status(400).json({ ok: false, reason: 'NO_ID' });
    }
    const result = await updateAgreement(req.clientId, id, {
      title: req.body?.title,
      templateurl: req.body?.templateurl,
      folderurl: req.body?.folderurl,
      mode: req.body?.mode
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/delete – body: { email, id } */
router.post('/delete', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) {
      return res.status(400).json({ ok: false, reason: 'NO_ID' });
    }
    const result = await deleteAgreement(req.clientId, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/generate-html – body: { email, id } – Drive API export Doc → HTML, save to DB */
router.post('/generate-html', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) {
      return res.status(400).json({ ok: false, reason: 'NO_ID' });
    }
    const result = await generateAgreementHtmlPreview(req.clientId, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/preview-pdf – body: { email, id } – generate PDF with sample variables, replaced text in red; returns { ok, pdfUrl? } */
router.post('/preview-pdf', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) {
      return res.status(400).json({ ok: false, reason: 'NO_ID' });
    }
    const result = await previewPdf(req.clientId, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/preview-pdf-download – body: { email, id } – PDF binary: prefer OSS cache; else generate via Google Docs/Drive (OAuth/SA), same as agreement PDF. */
router.post('/preview-pdf-download', requireClient, async (req, res, next) => {
  const t0 = Date.now();
  const id = req.body?.id;
  console.log(`[preview] ${new Date().toISOString()} ROUTE_PREVIEW_PDF_DOWNLOAD_RECEIVED id=${id} clientId=${req.clientId}`);
  try {
    if (!id) {
      return res.status(400).json({ ok: false, reason: 'NO_ID' });
    }
    const buffer = await previewPdfBuffer(req.clientId, id);
    const filename = `agreement-preview-${id.slice(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
    console.log(`[preview] ${new Date().toISOString()} ROUTE_PREVIEW_PDF_DOWNLOAD_SENT ms=${Date.now() - t0} bufferLength=${buffer?.length}`);
  } catch (err) {
    const msg = err?.message || '';
    console.error(`[preview] ROUTE_PREVIEW_PDF_DOWNLOAD_ERROR message=${msg}`);
    if (msg === 'PREVIEW_NOT_READY') {
      return res.status(404).json({ ok: false, reason: 'PREVIEW_NOT_READY', message: 'Preview not ready. Save template with Folder URL + Template URL to generate.' });
    }
    if (msg === 'MISSING_TEMPLATE_OR_FOLDER') {
      return res.status(400).json({
        ok: false,
        reason: 'MISSING_URLS',
        message: 'Add both Google Doc template URL and Drive folder URL for this template.'
      });
    }
    if (msg === 'GOOGLE_CREDENTIALS_NOT_CONFIGURED') {
      return res.status(400).json({
        ok: false,
        reason: 'GOOGLE_AUTH_REQUIRED',
        message: 'Connect Google Drive in Company Settings or configure GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS.'
      });
    }
    if (msg.includes('missing template url') || msg.includes('missing folder url')) {
      return res.status(400).json({
        ok: false,
        reason: 'INVALID_URLS',
        message: 'Could not read Doc or folder ID from the pasted links. Check the URLs.'
      });
    }
    if (msg === 'NOT_FOUND' || msg === 'NO_ID') {
      return res.status(404).json({ ok: false, reason: msg });
    }
    next(err);
  }
});

/** POST /api/agreementsetting/variables-reference – returns variable names per mode (from agreement.service) */
router.post('/variables-reference', requireClient, async (req, res, next) => {
  try {
    const ref = getAgreementVariablesReference();
    res.json(ref);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/official-templates/list – catalog + owned flag */
router.post('/official-templates/list', requireClient, async (req, res, next) => {
  try {
    const items = await listOfficialTemplates(req.clientId);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/official-templates/purchase – finance/billing only */
router.post('/official-templates/purchase', requireClient, async (req, res, next) => {
  try {
    const email = getEmail(req);
    const ctx = await getAccessContextByEmailAndClient(email, req.clientId);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }
    const result = await purchaseOfficialTemplates({
      clientId: req.clientId,
      templateIds: req.body?.templateIds,
      staffPermission: ctx.staff?.permission,
      staffDetailId: ctx.staffDetailId
    });
    if (!result.ok) {
      const st =
        result.reason === 'NO_PERMISSION'
          ? 403
          : result.reason === 'NOT_PURCHASED' || result.reason === 'INVALID_TEMPLATE'
            ? 400
            : 400;
      return res.status(st).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agreementsetting/official-template-download – .docx attachment (purchased + Drive export) */
router.post('/official-template-download', requireClient, async (req, res, next) => {
  try {
    const templateId = req.body?.templateId;
    if (!templateId) {
      return res.status(400).json({ ok: false, reason: 'NO_TEMPLATE_ID' });
    }
    const out = await exportOfficialTemplateDocx(req.clientId, templateId);
    if (!out.ok) {
      return res.status(out.status || 502).json({
        ok: false,
        reason: out.reason,
        message: out.message
      });
    }
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename.replace(/"/g, '')}"`);
    res.send(out.buffer);
  } catch (err) {
    next(err);
  }
});

router.requireClient = requireClient;

module.exports = router;
