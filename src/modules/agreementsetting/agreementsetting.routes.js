/**
 * Agreement Setting API – list/filters/get/create/update/delete/generate-html for agreement templates.
 * All POST with email in body; client from access context.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getAgreementList,
  getAgreementFilters,
  getAgreement,
  createAgreement,
  updateAgreement,
  deleteAgreement,
  generateAgreementHtmlPreview
} = require('./agreementsetting.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

async function requireClient(req, res, next) {
  const email = getEmail(req);
  if (!email) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) {
    return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
  }
  const clientId = ctx.client?.id;
  if (!clientId) {
    return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
  }
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

/** POST /api/agreementsetting/create – body: { email, title, templateurl, folderurl?, mode } */
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

/** POST /api/agreementsetting/generate-html – body: { email, id } – call GAS and save html to DB */
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

module.exports = router;
