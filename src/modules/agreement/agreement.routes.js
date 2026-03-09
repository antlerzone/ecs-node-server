/**
 * Agreement context API – migrated from Wix backend/access/agreementdetail.jsw.
 * All endpoints require email (POST body or GET query) for access context.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getTenantAgreementContext,
  getOwnerAgreementContext,
  getOwnerTenantAgreementContext,
  getOwnerTenantAgreementHtml,
  requestPdfGeneration,
  finalizeAgreementPdf,
  isAgreementDataComplete,
  prepareAgreementForSignature,
  tryPrepareDraftForAgreement
} = require('./agreement.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

async function requireAccess(req, res, next) {
  const email = getEmail(req);
  if (!email) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  try {
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }
    req.ctx = ctx;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/agreement/tenant-context
 * Body: { email, tenancyId, agreementTemplateId, staffVars? }
 */
router.post('/tenant-context', requireAccess, async (req, res, next) => {
  try {
    const { tenancyId, agreementTemplateId, staffVars = {} } = req.body || {};
    const result = await getTenantAgreementContext(tenancyId, agreementTemplateId, staffVars);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agreement/owner-context
 * Body: { email, ownerId, propertyId, clientId, agreementTemplateId, staffVars? }
 */
router.post('/owner-context', requireAccess, async (req, res, next) => {
  try {
    const { ownerId, propertyId, clientId, agreementTemplateId, staffVars = {} } = req.body || {};
    const result = await getOwnerAgreementContext(ownerId, propertyId, clientId, agreementTemplateId, staffVars);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agreement/owner-tenant-context
 * Body: { email, tenancyId, agreementTemplateId, staffVars? }
 */
router.post('/owner-tenant-context', requireAccess, async (req, res, next) => {
  try {
    const { tenancyId, agreementTemplateId, staffVars = {} } = req.body || {};
    const result = await getOwnerTenantAgreementContext(tenancyId, agreementTemplateId, staffVars);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agreement/owner-tenant-html
 * Body: { email, tenancyId, agreementTemplateId, staffVars? }
 */
router.post('/owner-tenant-html', requireAccess, async (req, res, next) => {
  try {
    const { tenancyId, agreementTemplateId, staffVars = {} } = req.body || {};
    const result = await getOwnerTenantAgreementHtml(tenancyId, agreementTemplateId, staffVars);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agreement/request-pdf
 * Body: { email, agreementType, agreementTemplateId, staffVars?, variablesOverride?, tenancyId?, ownerId?, propertyId?, clientId? }
 * agreementType: 'tenant_operator' | 'owner_operator' | 'owner_tenant'
 * Creates agreement row, sends payload to GAS; GAS will call /api/agreement/callback with { id, pdfUrl }.
 */
router.post('/request-pdf', requireAccess, async (req, res, next) => {
  try {
    const {
      agreementType,
      agreementTemplateId,
      staffVars = {},
      variablesOverride = {},
      tenancyId,
      ownerId,
      propertyId,
      clientId
    } = req.body || {};
    const result = await requestPdfGeneration({
      agreementType,
      agreementTemplateId,
      staffVars,
      variablesOverride,
      tenancyId,
      ownerId,
      propertyId,
      clientId
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agreement/is-data-complete
 * Body: { email, agreementId }. Returns { ok, reason? } – ok true when owner/tenant/operator data is complete for PDF merge.
 */
router.post('/is-data-complete', requireAccess, async (req, res, next) => {
  try {
    const { agreementId } = req.body || {};
    if (!agreementId) return res.status(400).json({ ok: false, reason: 'agreementId_required' });
    const result = await isAgreementDataComplete(agreementId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agreement/prepare-for-signature
 * Body: { email, agreementId }. When data complete: generates draft PDF, sets hash_draft, status=ready_for_signature.
 * Returns { ok, agreementId, pdfUrl?, hash_draft?, reason? }. Only after this should the agreement show in repeater and allow signing.
 */
router.post('/prepare-for-signature', requireAccess, async (req, res, next) => {
  try {
    const { agreementId } = req.body || {};
    if (!agreementId) return res.status(400).json({ ok: false, reason: 'agreementId_required' });
    const result = await prepareAgreementForSignature(agreementId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agreement/try-prepare-draft
 * Hook 1: when profile/data is complete, generate draft PDF. Idempotent.
 * Body: { email, agreementId }. If agreement has no url and data complete, calls prepare-for-signature.
 */
router.post('/try-prepare-draft', requireAccess, async (req, res, next) => {
  try {
    const { agreementId } = req.body || {};
    if (!agreementId) return res.status(400).json({ ok: false, reason: 'agreementId_required' });
    const result = await tryPrepareDraftForAgreement(agreementId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agreement/callback
 * Called by Google Apps Script after PDF is generated. Body: { id, pdfUrl }.
 * No auth (GAS server-to-server). Optional: validate with a shared secret or IP if needed.
 */
router.post('/callback', async (req, res, next) => {
  try {
    const { id, pdfUrl } = req.body || {};
    const result = await finalizeAgreementPdf(id, pdfUrl);
    res.json(result);
  } catch (err) {
    const msg = err?.message || 'BACKEND_ERROR';
    console.error('[agreement/callback]', msg, err);
    res.status(400).json({ ok: false, reason: msg });
  }
});

module.exports = router;
