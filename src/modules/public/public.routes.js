const express = require('express');
const router = express.Router();
const {
  getTenantPublicProfileById,
  getTenantInvoiceHistoryById,
  getOwnerPublicProfileById
} = require('../tenancysetting/tenant-review.service');
const cleanlemonSvc = require('../cleanlemon/cleanlemon.service');
const { getObjectStream } = require('../upload/oss.service');

const OPERATOR_TUTORIAL_PDFS = new Set([
  'connect-bukku.pdf',
  'connect-xero.pdf',
  'create-booking.pdf',
  'setup-agreement.pdf',
  'setup-meter.pdf',
  'setup-property.pdf',
  'setup-room.pdf',
  'setup-smart-door.pdf',
  'tenancy-setting.pdf',
]);
const OPERATOR_TUTORIAL_PREFIX = 'portal/tutorial/operator';

/** Marketing homedemo Section 3 phone screenshots (portal/homedemo/* on OSS). */
const HOMEDEMO_SCREENSHOTS = new Set([
  'step-1.jpeg',
  'step-1-2.jpeg',
  'step-2.jpeg',
  'step-2-1.jpeg',
  'step-2-2.jpeg',
  'step-2-3.jpeg',
  'step-2-4.jpeg',
  'step-2-5.jpeg',
  'step-3-0.jpeg',
  'step-3-1.jpeg',
  'step-4.jpeg',
  'step-4-2.jpeg',
  'step-5.jpeg',
  'tenant-smart-door.jpeg',
]);
const HOMEDEMO_PREFIX = 'portal/homedemo';

router.get('/tenant-profile/:id', async (req, res, next) => {
  try {
    const tenantId = req.params?.id ? String(req.params.id).trim() : '';
    const result = await getTenantPublicProfileById(tenantId);
    if (!result?.ok) {
      const status = result?.reason === 'TENANT_NOT_FOUND' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/tenant-profile/:id/invoice-history', async (req, res, next) => {
  try {
    const tenantId = req.params?.id ? String(req.params.id).trim() : '';
    const tenancyId = req.query?.tenancyId ? String(req.query.tenancyId).trim() : null;
    const result = await getTenantInvoiceHistoryById(tenantId, tenancyId);
    if (!result?.ok) {
      const status = result?.reason === 'TENANT_NOT_FOUND' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/owner-profile/:id', async (req, res, next) => {
  try {
    const ownerId = req.params?.id ? String(req.params.id).trim() : '';
    const result = await getOwnerPublicProfileById(ownerId);
    if (!result?.ok) {
      const status = result?.reason === 'OWNER_NOT_FOUND' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Operator tutorial PDFs stored on OSS; streamed through ECS so iframe preview works.
 * (302 to OSS signed URL often sends X-Frame-Options / headers that blank cross-origin iframes.)
 * GET /api/public/operator-tutorial-pdf?file=connect-bukku.pdf
 */
router.get('/operator-tutorial-pdf', async (req, res) => {
  const file = String(req.query.file || '').trim();
  if (!file || !OPERATOR_TUTORIAL_PDFS.has(file)) {
    return res.status(400).json({ ok: false, reason: 'INVALID_FILE' });
  }
  const key = `${OPERATOR_TUTORIAL_PREFIX}/${file}`;
  let stream;
  try {
    const out = await getObjectStream(key);
    stream = out.stream;
  } catch (err) {
    console.error('[public] operator-tutorial-pdf OSS getStream', err?.message || err);
    const status = err?.status === 404 || err?.code === 'NoSuchKey' ? 404 : 503;
    return res.status(status).json({ ok: false, reason: 'PDF_NOT_AVAILABLE' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file)}`);
  res.setHeader('Cache-Control', 'public, max-age=300');
  stream.on('error', (e) => {
    console.error('[public] operator-tutorial-pdf stream', e?.message || e);
    if (!res.headersSent) res.status(500).end();
    else res.destroy(e);
  });
  stream.pipe(res);
});

/**
 * Homedemo landing phone screenshots (private OSS → stream through ECS).
 * GET /api/public/homedemo-screenshot?file=step-1.jpeg
 */
router.head('/homedemo-screenshot', (req, res) => {
  const file = String(req.query.file || '').trim();
  if (!file || !HOMEDEMO_SCREENSHOTS.has(file)) {
    return res.status(400).end();
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).end();
});

router.get('/homedemo-screenshot', async (req, res) => {
  const file = String(req.query.file || '').trim();
  if (!file || !HOMEDEMO_SCREENSHOTS.has(file)) {
    return res.status(400).json({ ok: false, reason: 'INVALID_FILE' });
  }
  const key = `${HOMEDEMO_PREFIX}/${file}`;
  let stream;
  try {
    const out = await getObjectStream(key);
    stream = out.stream;
  } catch (err) {
    console.error('[public] homedemo-screenshot OSS getStream', err?.message || err);
    const status = err?.status === 404 || err?.code === 'NoSuchKey' ? 404 : 503;
    return res.status(status).json({ ok: false, reason: 'IMAGE_NOT_AVAILABLE' });
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  stream.on('error', (e) => {
    console.error('[public] homedemo-screenshot stream', e?.message || e);
    if (!res.headersSent) res.status(500).end();
    else res.destroy(e);
  });
  stream.pipe(res);
});

/** Cleanlemons operator public pricing (no auth). portal.cleanlemons.com/{public_subdomain} */

router.get('/cleanlemons-operator-pricing/:slug', async (req, res, next) => {
  try {
    const slug = req.params?.slug != null ? String(req.params.slug).trim() : '';
    const out = await cleanlemonSvc.getPublicMarketingPricingBySubdomain(slug);
    if (!out.ok) {
      const st =
        out.reason === 'MISSING_SLUG'
          ? 400
          : out.reason === 'NOT_CONFIGURED'
            ? 503
            : 404;
      return res.status(st).json({ ok: false, reason: out.reason || 'NOT_FOUND' });
    }
    res.json({
      ok: true,
      companyName: out.companyName,
      company: out.company || null,
      pricing: out.pricing,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
