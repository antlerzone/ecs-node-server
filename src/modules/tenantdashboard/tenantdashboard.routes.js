/**
 * Tenant Dashboard API – for Wix tenant dashboard page (租客仪表盘).
 * All endpoints POST with email in body; tenant resolved by email (tenantdetail.email).
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
const { getClientIp } = require('../../utils/requestIp');
const { afterSignUpdate } = require('../agreement/agreement.service');
const {
  getTenantByEmail,
  getTenanciesForTenant,
  getClientsByIds,
  getRoomWithMeter,
  getPropertyWithSmartdoor,
  getBanks,
  updateTenantProfile,
  getAgreementHtml,
  updateAgreementTenantSign,
  getAgreementByIdForTenant,
  getRentalListForTenancy,
  tenantApprove,
  tenantReject,
  generateFromTenancyForTenant,
  syncTenantForClient,
  insertFeedback,
  assertTenancyBelongsToTenant
} = require('./tenantdashboard.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

function withTenant(req, res, handler) {
  const email = getEmail(req);
  if (!email || !String(email).trim()) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  handler(email)
    .then((result) => {
      if (result && result.ok === false && result.reason) {
        const status =
          result.reason === 'TENANT_NOT_FOUND' ? 404 : 403;
        return res.status(status).json(result);
      }
      res.json(result);
    })
    .catch((err) => {
      console.error('[tenantdashboard]', err);
      res.status(500).json({ ok: false, reason: 'BACKEND_ERROR' });
    });
}

/** POST /api/tenantdashboard/init – tenant + tenancies. When no tenant found, return ok with tenant: null, tenancies: [] so public can enter page and edit profile. */
router.post('/init', (req, res) => {
  withTenant(req, res, async (email) => {
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: true, tenant: null, tenancies: [] };
    const tenancies = await getTenanciesForTenant(tenant._id);
    return { ok: true, tenant, tenancies };
  });
});

/** POST /api/tenantdashboard/clients-by-ids – body: { clientIds } */
router.post('/clients-by-ids', (req, res) => {
  withTenant(req, res, async (email) => {
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const clientIds = req.body?.clientIds || [];
    const items = await getClientsByIds(clientIds);
    return { ok: true, items };
  });
});

/** POST /api/tenantdashboard/room – body: { roomId } */
router.post('/room', (req, res) => {
  withTenant(req, res, async (email) => {
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const roomId = req.body?.roomId;
    if (!roomId) return { ok: false, reason: 'MISSING_ROOM_ID' };
    const tenancies = await getTenanciesForTenant(tenant._id);
    const hasRoom = tenancies.some(
      (t) => t.room && (t.room._id === roomId || t.room === roomId)
    );
    if (!hasRoom) return { ok: false, reason: 'TENANCY_MISMATCH' };
    const room = await getRoomWithMeter(roomId);
    if (!room) return { ok: false, reason: 'ROOM_NOT_FOUND' };
    return { ok: true, room };
  });
});

/** POST /api/tenantdashboard/property-with-smartdoor – body: { propertyId, roomId? } */
router.post('/property-with-smartdoor', (req, res) => {
  withTenant(req, res, async (email) => {
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const { propertyId, roomId } = req.body || {};
    if (!propertyId) return { ok: false, reason: 'MISSING_PROPERTY_ID' };
    const tenancies = await getTenanciesForTenant(tenant._id);
    const hasProp = tenancies.some(
      (t) => t.property && (t.property._id === propertyId || t.property === propertyId)
    );
    if (!hasProp) return { ok: false, reason: 'TENANCY_MISMATCH' };
    const data = await getPropertyWithSmartdoor(propertyId, roomId);
    return { ok: true, ...data };
  });
});

/** POST /api/tenantdashboard/banks */
router.post('/banks', (req, res) => {
  getBanks()
    .then((items) => res.json({ ok: true, items }))
    .catch((err) => {
      console.error('[tenantdashboard] banks', err);
      res.status(500).json({ ok: false, reason: 'BACKEND_ERROR' });
    });
});

/** POST /api/tenantdashboard/update-profile – body: profile payload */
router.post('/update-profile', (req, res) => {
  withTenant(req, res, (email) => updateTenantProfile(email, req.body || {}));
});

/** POST /api/tenantdashboard/agreement-html – body: { tenancyId, agreementTemplateId?, staffVars? } */
router.post('/agreement-html', (req, res) => {
  withTenant(req, res, async (email) => {
    const { tenancyId, agreementTemplateId, staffVars } = req.body || {};
    if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return getAgreementHtml(email, tenancyId, agreementTemplateId, staffVars);
  });
});

/** POST /api/tenantdashboard/agreement-update-sign – body: { agreementId, tenantsign, status? }. Records client IP. Hook: first sign→locked, full sign→final PDF. */
router.post('/agreement-update-sign', (req, res) => {
  withTenant(req, res, async (email) => {
    const { agreementId, tenantsign, status } = req.body || {};
    if (!agreementId || !tenantsign) {
      return { ok: false, reason: 'MISSING_AGREEMENT_ID_OR_SIGNATURE' };
    }
    const result = await updateAgreementTenantSign(email, agreementId, {
      tenantsign,
      tenantSignedAt: new Date(),
      status,
      tenantSignedIp: getClientIp(req)
    });
    if (result && result.ok) {
      try {
        await afterSignUpdate(agreementId);
      } catch (hookErr) {
        console.error('[tenantdashboard] afterSignUpdate', hookErr?.message || hookErr);
      }
    }
    return result;
  });
});

/** POST /api/tenantdashboard/agreement-get – body: { agreementId } */
router.post('/agreement-get', (req, res) => {
  withTenant(req, res, async (email) => {
    const agreementId = req.body?.agreementId;
    if (!agreementId) return { ok: false, reason: 'MISSING_AGREEMENT_ID' };
    const agreement = await getAgreementByIdForTenant(email, agreementId);
    if (!agreement) return { ok: false, reason: 'NOT_FOUND' };
    return { ok: true, agreement };
  });
});

/** POST /api/tenantdashboard/rental-list – body: { tenancyId } */
router.post('/rental-list', (req, res) => {
  withTenant(req, res, (email) => {
    const tenancyId = req.body?.tenancyId;
    if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return getRentalListForTenancy(email, tenancyId);
  });
});

/** POST /api/tenantdashboard/tenant-approve – body: { clientId } */
router.post('/tenant-approve', (req, res) => {
  withTenant(req, res, (email) => {
    const clientId = req.body?.clientId;
    if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };
    return tenantApprove(email, clientId);
  });
});

/** POST /api/tenantdashboard/tenant-reject – body: { clientId } */
router.post('/tenant-reject', (req, res) => {
  withTenant(req, res, (email) => {
    const clientId = req.body?.clientId;
    if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };
    return tenantReject(email, clientId);
  });
});

/** POST /api/tenantdashboard/generate-from-tenancy – body: { tenancyId } */
router.post('/generate-from-tenancy', (req, res) => {
  withTenant(req, res, (email) => {
    const tenancyId = req.body?.tenancyId;
    if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return generateFromTenancyForTenant(email, tenancyId);
  });
});

/** POST /api/tenantdashboard/sync-tenant-for-client – body: { clientId } */
router.post('/sync-tenant-for-client', (req, res) => {
  withTenant(req, res, (email) => {
    const clientId = req.body?.clientId;
    if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };
    return syncTenantForClient(email, clientId, req.body || {});
  });
});

/** POST /api/tenantdashboard/feedback – body: { tenancyId, roomId?, propertyId?, clientId?, description, photo?, video? } */
router.post('/feedback', (req, res) => {
  withTenant(req, res, (email) => {
    const body = req.body || {};
    if (!body.tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return insertFeedback(email, body);
  });
});

/** POST /api/tenantdashboard/create-payment – body: { tenancyId, type: 'meter'|'invoice', amount, referenceNumber, metadata?, returnUrl?, cancelUrl? }
 *  Returns { ok: true, type: 'redirect', url } or { ok: false, reason }.
 *  Stripe Checkout Session; webhook must handle metadata.type (TenantMeter/TenantInvoice) to update meter or rentalcollection.
 */
router.post('/create-payment', (req, res) => {
  withTenant(req, res, async (email) => {
    const { tenancyId, type, amount, referenceNumber, metadata = {}, returnUrl, cancelUrl } = req.body || {};
    if (!tenancyId || !type) {
      return { ok: false, reason: 'MISSING_TENANCY_ID_OR_TYPE' };
    }
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
    if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };

    const amountCents = Math.max(100, Math.round(Number(amount) * 100));
    let clientId = null;
    const [tenancyRows] = await pool.query('SELECT client_id, room_id FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
    if (tenancyRows.length && tenancyRows[0].client_id) clientId = tenancyRows[0].client_id;
    const tenantName = (tenant.fullname || tenant.fullName || 'Tenant').trim().slice(0, 100) || 'Tenant';
    let roomName = '';
    if (tenancyRows.length && tenancyRows[0].room_id) {
      const [roomRows] = await pool.query('SELECT roomname FROM roomdetail WHERE id = ? LIMIT 1', [tenancyRows[0].room_id]);
      if (roomRows.length && roomRows[0].roomname) roomName = String(roomRows[0].roomname).trim().slice(0, 100);
    }
    let typeLabel = type === 'meter' ? 'Meter Top-up' : 'Invoice';
    const invoiceIds = Array.isArray(metadata.invoiceIds) ? metadata.invoiceIds : [];
    if (type === 'invoice' && invoiceIds.length > 0) {
      const [typeRows] = await pool.query(
        'SELECT a.title FROM rentalcollection r JOIN account a ON a.id = r.type_id WHERE r.id = ? AND r.tenancy_id = ? LIMIT 1',
        [invoiceIds[0], tenancyId]
      );
      if (typeRows.length && typeRows[0].title) typeLabel = String(typeRows[0].title).trim().slice(0, 80);
    }
    const description = `${tenantName} - ${typeLabel} - ${roomName || 'Room'}`.trim();
    let meterTransactionId = null;
    if (type === 'meter') {
      const roomId = tenancyRows.length && tenancyRows[0].room_id ? tenancyRows[0].room_id : null;
      if (roomId) {
        const [mRows] = await pool.query(
          'SELECT m.mode FROM roomdetail r INNER JOIN meterdetail m ON m.id = r.meter_id WHERE r.id = ? LIMIT 1',
          [roomId]
        );
        const mode = (mRows && mRows[0] && mRows[0].mode) ? String(mRows[0].mode).toLowerCase() : '';
        if (mode === 'postpaid') {
          return { ok: false, reason: 'METER_POSTPAID_NO_TOPUP' };
        }
      }
      const { randomUUID } = require('crypto');
      let propertyId = null;
      if (roomId) {
        const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [roomId]);
        if (roomRows.length && roomRows[0].property_id) propertyId = roomRows[0].property_id;
      }
      meterTransactionId = randomUUID();
      const amountRm = (amountCents / 100).toFixed(2);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await pool.query(
        `INSERT INTO metertransaction (id, tenant_id, tenancy_id, property_id, amount, ispaid, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
        [meterTransactionId, tenant._id, tenancyId, propertyId, amountRm, now, now]
      );
    }
    const createCheckoutSession = require('../stripe/stripe.service').createCheckoutSession;
    const baseUrl = process.env.PUBLIC_APP_URL || 'https://www.colivingjb.com';
    const successUrl = returnUrl || `${baseUrl}/tenant-dashboard?success=1`;
    const cancelUrlVal = cancelUrl || `${baseUrl}/tenant-dashboard?cancel=1`;
    try {
      const { url } = await createCheckoutSession({
        amountCents,
        currency: 'myr',
        email,
        description,
        returnUrl: successUrl,
        cancelUrl: cancelUrlVal,
        clientId: clientId || undefined,
        metadata: {
          type: type === 'meter' ? 'TenantMeter' : 'TenantInvoice',
          client_id: clientId || '',
          tenancy_id: tenancyId,
          tenant_id: tenant._id,
          reference_number: referenceNumber || '',
          amount_cents: String(amountCents),
          invoice_ids: invoiceIds.join(','),
          ...(meterTransactionId ? { meter_transaction_id: meterTransactionId } : {}),
          ...metadata
        }
      });
      return { ok: true, type: 'redirect', url };
    } catch (e) {
      console.error('[tenantdashboard] create-payment', e);
      return { ok: false, reason: 'PAYMENT_CREATE_FAILED' };
    }
  });
});

module.exports = router;
