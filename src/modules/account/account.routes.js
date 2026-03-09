/**
 * Account (SaaS) API – accounting settings: resolve integration, list templates, get one, save mapping, sync Bukku.
 * All POST with email in body; client resolved from access context. Permission: integration or admin.
 */

const express = require('express');
const router = express.Router();
const {
  resolveAccountSystem,
  listAccountTemplates,
  getAccountById,
  saveBukkuAccount,
  syncAccounts
} = require('./account.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

/** POST /api/account/resolve – resolve accounting integration (addonAccount) for current client */
router.post('/resolve', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const result = await resolveAccountSystem(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/account/list – list account templates (bukkuid) with _myAccount for current client */
router.post('/list', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const items = await listAccountTemplates(email);
    console.log('[account] /list response', { itemCount: items.length, firstId: items[0]?._id || null });
    res.json({ ok: true, items });
  } catch (err) {
    console.log('[account] /list error', err.message);
    if (err.message === 'NO_EMAIL' || err.message === 'ACCESS_DENIED' || err.message === 'NO_PERMISSION' || err.message === 'NO_CLIENT') {
      return res.status(403).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/account/get – get one account template by id */
router.post('/get', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const id = req.body?.id ?? req.body?.accountId ?? req.query?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'MISSING_ID' });
    const item = await getAccountById(email, id);
    res.json({ ok: true, item });
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: err.message });
    if (err.message === 'NO_EMAIL_OR_ID' || err.message === 'ACCESS_DENIED' || err.message === 'NO_PERMISSION' || err.message === 'NO_CLIENT') {
      return res.status(403).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/account/save – save client mapping for one account template */
router.post('/save', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const result = await saveBukkuAccount(email, {
      item: body.item,
      clientId: body.clientId,
      system: body.system,
      accountId: body.accountId,
      productId: body.productId
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/account/sync – sync accounts by client's system (xero/bukku: list + map by title, create if missing; autocount/sql: not available) */
router.post('/sync', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const result = await syncAccounts(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
