/**
 * Contact (Profile page) API – migrated from Wix CMS + backend/access/accountaccess.
 * All endpoints require POST body with email (from Wix JSW). Use apiAuth for token + username.
 */

const express = require('express');
const router = express.Router();
const contactService = require('./contact.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

/** POST /api/contact/list – body: { email, type?, search?, sort?, page?, pageSize?, limit? } */
router.post('/list', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const opts = {
      type: body.type || null,
      search: body.search || null,
      sort: body.sort || null,
      page: body.page,
      pageSize: body.pageSize,
      limit: body.limit
    };
    const result = await contactService.getContactList(email, opts);
    const count = Array.isArray(result.items) ? result.items.length : 0;
    console.log('[contact] list', result.ok ? 'ok' : result.reason || 'fail', 'items=' + count, 'total=' + (result.total ?? 0));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/owner', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { ownerId } = req.body || {};
    const data = await contactService.getOwner(email, ownerId);
    if (!data) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json({ ok: true, ...data });
  } catch (err) {
    next(err);
  }
});

router.post('/tenant', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { tenantId } = req.body || {};
    const data = await contactService.getTenant(email, tenantId);
    if (!data) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json({ ok: true, ...data });
  } catch (err) {
    next(err);
  }
});

router.post('/supplier', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { supplierId } = req.body || {};
    const data = await contactService.getSupplier(email, supplierId);
    if (!data) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json({ ok: true, ...data });
  } catch (err) {
    next(err);
  }
});

/** POST /api/contact/banks – bank list from bankdetail for #dropdownbank (value = id → supplierdetail.bankdetail_id) */
router.post('/banks', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const result = await contactService.getBanks(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/contact/account-system – current client's account system (sql|autocount|bukku|xero) for #inputbukkuid label and which key to read/write in account[]. */
router.post('/account-system', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const provider = await contactService.getAccountProvider(email);
    res.json({ ok: true, provider });
  } catch (err) {
    next(err);
  }
});

router.post('/owner/update-account', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const contactId = body.contactId !== undefined ? body.contactId : body.bukkuId;
    const result = await contactService.updateOwnerAccount(email, { ownerId: body.ownerId, contactId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/tenant/update-account', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const contactId = body.contactId !== undefined ? body.contactId : body.bukkuId;
    const result = await contactService.updateTenantAccount(email, { tenantId: body.tenantId, contactId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/owner/delete', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { ownerId, isPending } = req.body || {};
    const result = await contactService.deleteOwnerOrCancel(email, { ownerId, isPending: !!isPending });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/tenant/delete', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { tenantId, isPending } = req.body || {};
    const result = await contactService.deleteTenantOrCancel(email, { tenantId, isPending: !!isPending });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/supplier/delete', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { supplierId } = req.body || {};
    const result = await contactService.deleteSupplierAccount(email, { supplierId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/upsert-transit', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const payload = {
      name: body.name,
      email: body.email,
      billerCode: body.billerCode,
      bankName: body.bankName,
      bankAccount: body.bankAccount,
      bankHolder: body.bankHolder
    };
    const result = await contactService.upsertContactTransit(email, payload);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/submit-owner-approval', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const ownerEmail = req.body?.ownerEmail ?? req.body?.email;
    const result = await contactService.submitOwnerApproval(email, ownerEmail);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/submit-tenant-approval', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const tenantEmail = req.body?.tenantEmail ?? req.body?.email;
    const result = await contactService.submitTenantApproval(email, tenantEmail);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/supplier/create', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const payload = {
      name: body.name,
      email: body.email,
      billerCode: body.billerCode,
      bankName: body.bankName,
      bankAccount: body.bankAccount,
      bankHolder: body.bankHolder,
      productid: body.productid
    };
    // If client has account integration + pricing plan: find contact by email/name or create in account system; else contactId stays empty.
    const syncRes = await contactService.ensureSupplierContactInAccounting(email, payload);
    const contactId = syncRes.ok ? syncRes.contactId : '';
    const result = await contactService.createSupplier(email, payload, contactId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/supplier/update', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const { supplierId, name, billerCode, bankName, bankAccount, bankHolder, contactId, bukkuId, productid } = body;
    const result = await contactService.updateSupplier(email, supplierId, {
      name,
      email: body.email,
      billerCode,
      bankName,
      bankAccount,
      bankHolder,
      contactId: contactId !== undefined ? contactId : bukkuId,
      productid
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
