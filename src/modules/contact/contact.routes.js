/**
 * Contact (Profile page) API – migrated from Wix CMS + backend/access/accountaccess.
 * All endpoints require POST body with email (from Wix JSW) or API auth (Bearer + X-API-Username).
 * Operator API is scoped to api_user.client_id only.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail, getAccessContextByEmailAndClient } = require('../access/access.service');
const contactService = require('./contact.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

/** Resolve req.clientId: from apiClientScope (API user) or from email (portal). */
async function resolveClientId(req, res, next) {
  if (req.clientId) return next();
  const email = getEmail(req);
  const bodyClientId = req.body?.clientId ?? req.query?.clientId ?? null;
  if (bodyClientId && email) {
    try {
      const ctx = await getAccessContextByEmailAndClient(String(email).trim(), String(bodyClientId).trim());
      if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
      if (!ctx.client?.id) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
      req.clientId = ctx.client.id;
      return next();
    } catch (e) {
      return next(e);
    }
  }
  if (req.apiUser && !email) {
    return res.status(403).json({ ok: false, reason: 'API_USER_NOT_BOUND_TO_CLIENT', message: 'API user must be bound to a client to access this resource' });
  }
  if (req.apiUser && email) {
    try {
      const ctx = await getAccessContextByEmail(email);
      if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
      if (!ctx.client?.id) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
      req.clientId = ctx.client.id;
      return next();
    } catch (e) {
      return next(e);
    }
  }
  if (!email) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  try {
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    if (!ctx.client?.id) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    req.clientId = ctx.client.id;
    next();
  } catch (e) {
    next(e);
  }
}

router.use(resolveClientId);

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
    const result = await contactService.getContactList(email, opts, req.clientId);
    const count = Array.isArray(result.items) ? result.items.length : 0;
    console.log('[contact] list', result.ok ? 'ok' : result.reason || 'fail', 'items=' + count, 'total=' + (result.total ?? 0));
    res.json(result);
  } catch (err) {
    console.error('[contact/list]', err?.code || err?.name, err?.message);
    if (err?.sqlMessage) console.error('[contact/list] sqlMessage:', err.sqlMessage);
    next(err);
  }
});

router.post('/owner', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { ownerId } = req.body || {};
    const data = await contactService.getOwner(email, ownerId, req.clientId);
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
    const data = await contactService.getTenant(email, tenantId, req.clientId);
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
    const data = await contactService.getSupplier(email, supplierId, req.clientId);
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
    const result = await contactService.getBanks(email, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/contact/account-system – current client's account system (sql|autocount|bukku|xero) for #inputbukkuid label and which key to read/write in account[]. */
router.post('/account-system', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const provider = await contactService.getAccountProvider(email, req.clientId);
    res.json({ ok: true, provider });
  } catch (err) {
    next(err);
  }
});

/** POST /api/contact/sync-all – direction: 'to-accounting' | 'from-accounting' */
router.post('/sync-all', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const direction = req.body?.direction;
    const result = await contactService.syncAllContacts(email, { direction }, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/owner/update-account', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const contactId = body.contactId !== undefined ? body.contactId : body.bukkuId;
    const result = await contactService.updateOwnerAccount(email, { ownerId: body.ownerId, contactId }, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Owner bank (bankdetail id + account + holder). */
router.post('/owner/update-bank', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const result = await contactService.updateOwnerBankFields(
      email,
      {
        ownerId: body.ownerId,
        bankName: body.bankName,
        bankAccount: body.bankAccount,
        bankHolder: body.bankHolder
      },
      req.clientId
    );
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
    const result = await contactService.updateTenantAccount(email, { tenantId: body.tenantId, contactId }, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/staff/update-account', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const contactId = body.contactId !== undefined ? body.contactId : body.bukkuId;
    const result = await contactService.updateStaffAccount(email, { staffId: body.staffId, contactId }, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** portal_account.phone for contact email (must belong to this client); use before staff sync for phone. */
router.post('/portal-phone', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const result = await contactService.updatePortalPhoneForClientContact(
      email,
      { contactEmail: body.contactEmail ?? body.contact_email, phone: body.phone },
      req.clientId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/owner/delete', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { ownerId, isPending } = req.body || {};
    const result = await contactService.deleteOwnerOrCancel(email, { ownerId, isPending: !!isPending }, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/tenant/delete', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { tenantId, isPending } = req.body || {};
    const result = await contactService.deleteTenantOrCancel(email, { tenantId, isPending: !!isPending }, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/supplier/delete', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { supplierId } = req.body || {};
    const result = await contactService.deleteSupplierAccount(email, { supplierId }, req.clientId);
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
    const result = await contactService.upsertContactTransit(email, payload, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Add/link owner to client. No approval flow: always direct mapping (owner_client). */
router.post('/submit-owner-approval', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const ownerEmail = req.body?.ownerEmail ?? req.body?.email;
    const opts = {
      directMap: req.body?.directMap !== false,
      propertyId: req.body?.propertyId || null
    };
    const result = await contactService.submitOwnerApproval(email, ownerEmail, req.clientId, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Add/link tenant to client. No approval flow: always direct mapping (tenant_client). */
router.post('/submit-tenant-approval', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const tenantEmail = req.body?.tenantEmail ?? req.body?.email;
    const opts = { directMap: req.body?.directMap !== false };
    const result = await contactService.submitTenantApproval(email, tenantEmail, req.clientId, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

function supplierEmailFromBody(req, body) {
  if (body.supplierEmail !== undefined) {
    return String(body.supplierEmail ?? '').trim().toLowerCase();
  }
  const op = String(getEmail(req) || '').trim().toLowerCase();
  const bodyEmail = String(body.email || '').trim().toLowerCase();
  // `post()` always merges operator session into body.email — never use that as supplier email.
  if (bodyEmail && bodyEmail !== op) return bodyEmail;
  return '';
}

router.post('/supplier/create', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const payload = {
      name: body.name,
      email: supplierEmailFromBody(req, body),
      billerCode: body.billerCode,
      bankName: body.bankName,
      bankAccount: body.bankAccount,
      bankHolder: body.bankHolder,
      productid: body.productid
    };
    const syncRes = await contactService.ensureSupplierContactInAccounting(email, payload, req.clientId);
    const contactId = syncRes.ok ? syncRes.contactId : '';
    const result = await contactService.createSupplier(email, payload, contactId, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/staff/create', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const payload = {
      name: body.name,
      staffEmail: body.staffEmail ?? body.email
    };
    const result = await contactService.createStaffContact(email, payload, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/staff/update', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const staffId = body.staffId ?? body.id ?? body.entityId;
    const payload = {
      name: body.name,
      staffEmail: body.staffEmail ?? body.email
    };
    const result = await contactService.updateStaffContact(email, staffId, payload, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/staff/delete', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const staffId = body.staffId ?? body.id ?? body.entityId;
    const result = await contactService.deleteStaffContact(email, staffId, req.clientId);
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
    const supplierEmail =
      body.supplierEmail !== undefined ? String(body.supplierEmail ?? '').trim().toLowerCase() : undefined;
    const result = await contactService.updateSupplier(email, supplierId, {
      name,
      ...(supplierEmail !== undefined ? { email: supplierEmail } : {}),
      billerCode,
      bankName,
      bankAccount,
      bankHolder,
      contactId: contactId !== undefined ? contactId : bukkuId,
      productid
    }, req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
