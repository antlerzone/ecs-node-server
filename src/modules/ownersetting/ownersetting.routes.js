/**
 * Owner Setting API – list/filters/search/save/delete for Wix owner management page.
 * Requires email for access context.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getOwnerList,
  getOwnerFilters,
  searchOwnerByEmail,
  getPropertyById,
  getAgreementTemplates,
  getPropertiesWithoutOwner,
  saveOwnerInvitation,
  deleteOwnerFromProperty,
  removeOwnerMapping
} = require('./ownersetting.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

async function requireCtx(req, res) {
  const email = getEmail(req);
  if (!email) {
    res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    return null;
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) {
    res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    return null;
  }
  if (!ctx.client?.id) {
    res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    return null;
  }
  return ctx;
}

/** POST /api/ownersetting/list – body: { email, search?, page?, pageSize?, limit? } */
router.post('/list', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const opts = {
      search: req.body?.search,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit
    };
    const result = await getOwnerList(ctx.client.id, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/ownersetting/filters – body: { email } */
router.post('/filters', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const result = await getOwnerFilters(ctx.client.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/ownersetting/search-owner – body: { email, keyword } */
router.post('/search-owner', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const keyword = req.body?.keyword ?? '';
    const result = await searchOwnerByEmail(ctx.client.id, keyword);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/ownersetting/property – body: { email, propertyId } */
router.post('/property', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const propertyId = req.body?.propertyId;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    const result = await getPropertyById(ctx.client.id, propertyId);
    res.json(result || { ok: false, reason: 'NOT_FOUND' });
  } catch (err) {
    next(err);
  }
});

/** POST /api/ownersetting/agreement-templates – body: { email } */
router.post('/agreement-templates', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const result = await getAgreementTemplates(ctx.client.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/ownersetting/properties-without-owner – body: { email } */
router.post('/properties-without-owner', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const result = await getPropertiesWithoutOwner(ctx.client.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/ownersetting/save-invitation – body: { email, ownerId?, email: ownerEmail, propertyId, agreementId, editingPendingContext? } */
router.post('/save-invitation', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const payload = {
      ownerId: req.body?.ownerId,
      email: req.body?.email,
      propertyId: req.body?.propertyId,
      agreementId: req.body?.agreementId,
      editingPendingContext: req.body?.editingPendingContext
    };
    const result = await saveOwnerInvitation(ctx.client.id, payload);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/ownersetting/delete-owner – body: { email, propertyId } */
router.post('/delete-owner', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const propertyId = req.body?.propertyId;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    const result = await deleteOwnerFromProperty(ctx.client.id, propertyId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/remove-owner-mapping', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const ownerId = req.body?.ownerId;
    if (!ownerId) {
      return res.status(400).json({ ok: false, reason: 'NO_OWNER_ID' });
    }
    const result = await removeOwnerMapping(ctx.client.id, ownerId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
